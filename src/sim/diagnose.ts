// Map diagnostics for the editor: build the network from an edited map bundle and report what the simulation
// makes of it (problems, resolved house positions, parking stalls, gate queue slots, routes per bungalow).
// Pure function of the bundle; runs in a worker thread on the server (a full-park build takes a few seconds).
import { buildNetwork, findRoute, Network } from './network.ts';
import { checkBundle, MapBundle, Problem } from '../shared/mapdoc.ts';
import type { Vec } from '../shared/geom.ts';

const VISITOR_PORTAL = 'P_W';

export interface DiagHouse { number: number; pt: number[]; frontDeg: number; scale: number; adjustedM: number; stallId?: string; stallDistM?: number; gateIn?: string; gateOut?: string; routeM?: number }
export interface Diagnosis {
  ok: boolean;
  problems: Problem[];
  summary: { houses: number; stalls: number; housesWithStall: number; unreachable: number; adjustedHouses: number; farStalls: number; gateUse: Record<string, number>; buildMs: number };
  derived: {
    houses: DiagHouse[];
    stalls: { id: string; house: number; kind: string; pad: number[][] }[];
    gates: { id: string; label?: string; direction: string; staff: boolean; stop: number[]; slots: number[][]; queueSlots: number }[];
  };
}

export function toPtFn(b: MapBundle) {
  const k = b.park.metersPerPt, o = b.park.originPt;
  return (v: Vec) => [+(v.x / k + o[0]).toFixed(2), +(v.y / k + o[1]).toFixed(2)];
}

export function buildFromBundle(b: MapBundle): Network {
  return buildNetwork(b.network, b.park);
}

const routeLen = (net: Network, r: string[]) => r.reduce((n, id) => n + net.edges.get(id)!.line.length, 0);

/** in/out gate of a bungalow = the one on the shortest legal visitor route (same rule as ParkSim.gatesFor) */
export function houseRoutes(net: Network, house: number) {
  const st = net.stallsByHouse.get(house);
  const portal = net.portals.get(VISITOR_PORTAL);
  if (!st || !portal?.spawnEdge || !portal.despawnEdge) return null;
  const pick = (dir: 'inbound' | 'outbound', from: string, to: string) => {
    let best: { id: string; route: string[]; len: number } | null = null;
    for (const g of net.gates.values()) {
      if (g.direction !== dir || g.staff) continue;
      const a = findRoute(net, from, g.edge, 'visitor'), c = a ? findRoute(net, g.edge, to, 'visitor') : null;
      if (!a || !c) continue;
      const route = [...a, ...c.slice(1)], len = routeLen(net, route);
      if (!best || len < best.len) best = { id: g.id, route, len };
    }
    return best;
  };
  return { in: pick('inbound', portal.spawnEdge, st.inEdge), out: pick('outbound', st.outEdge, portal.despawnEdge) };
}

export function routePts(net: Network, b: MapBundle, route: string[]) {
  const toPt = toPtFn(b), out: number[][] = [];
  for (const id of route) {
    const pts = net.edges.get(id)!.line.pts;
    const step = Math.max(1, Math.floor(pts.length / 40));
    for (let i = 0; i < pts.length; i += step) out.push(toPt(pts[i]));
  }
  return out;
}

export function diagnose(b: MapBundle): { diag: Diagnosis; net: Network | null } {
  const t0 = Date.now();
  const problems: Problem[] = checkBundle(b);
  const empty: Diagnosis = { ok: false, problems, summary: { houses: 0, stalls: 0, housesWithStall: 0, unreachable: 0, adjustedHouses: 0, farStalls: 0, gateUse: {}, buildMs: 0 }, derived: { houses: [], stalls: [], gates: [] } };
  if (problems.some((p) => p.level === 'error')) return { diag: empty, net: null };
  let net: Network;
  try { net = buildFromBundle(b); } catch (e) {
    problems.push({ level: 'error', msg: `Wegennet kan niet worden opgebouwd: ${(e as Error).message}` });
    return { diag: { ...empty, problems }, net: null };
  }
  for (const v of net.validation) {
    const h = v.msg.match(/^Huis (\d+)/), g = v.msg.match(/^Slagboom ([\w-]+)/), r = v.msg.match(/^Rijstrook ([^:~\s]+)/);
    const ref = h ? { kind: 'house', id: h[1] } : g ? { kind: 'gate', id: g[1] } : r ? { kind: 'road', id: r[1] } : undefined;
    problems.push({ level: v.level, msg: v.msg, ref });
  }
  const toPt = toPtFn(b);
  const gateUse: Record<string, number> = {};
  let unreachable = 0, farStalls = 0;
  const houses: DiagHouse[] = net.houses.map((h, i) => {
    const st = net.stallsByHouse.get(h.number);
    const src = b.park.houses[i];
    const d: DiagHouse = {
      number: h.number, pt: toPt(h.pos), frontDeg: +((Math.atan2(h.front.y, h.front.x) * 180) / Math.PI).toFixed(1), scale: +(h.scale ?? 1).toFixed(2),
      adjustedM: +(Math.hypot(h.pos.x - (src.pt[0] - b.park.originPt[0]) * b.park.metersPerPt, h.pos.y - (src.pt[1] - b.park.originPt[1]) * b.park.metersPerPt)).toFixed(1),
    };
    if (!st) { problems.push({ level: 'error', msg: `Huis ${h.number} heeft geen parkeervak`, ref: { kind: 'house', id: String(h.number) } }); return d; }
    d.stallId = st.id;
    const pc = st.pad.reduce((q, w) => ({ x: q.x + w.x / st.pad.length, y: q.y + w.y / st.pad.length }), { x: 0, y: 0 });
    d.stallDistM = +Math.hypot(pc.x - h.pos.x, pc.y - h.pos.y).toFixed(1);
    if (d.stallDistM > 35) { farStalls++; problems.push({ level: 'warn', msg: `Huis ${h.number}: parkeervak ligt ${d.stallDistM} m van het huis`, ref: { kind: 'house', id: String(h.number) } }); }
    const r = houseRoutes(net, h.number);
    if (!r?.in || !r.out) {
      unreachable++;
      problems.push({ level: 'error', msg: `Huis ${h.number}: geen legale route ${!r?.in ? 'naar binnen' : 'naar buiten'} via een slagboom`, ref: { kind: 'house', id: String(h.number) } });
      return d;
    }
    d.gateIn = r.in.id; d.gateOut = r.out.id; d.routeM = Math.round(r.in.len + r.out.len);
    gateUse[r.in.id] = (gateUse[r.in.id] ?? 0) + 1; gateUse[r.out.id] = (gateUse[r.out.id] ?? 0) + 1;
    return d;
  });
  const stalls = [...net.stalls.values()].map((s) => ({ id: s.id, house: s.houseNumber, kind: s.kind, pad: s.pad.map(toPt) }));
  const gates = [...net.gates.values()].map((g) => {
    const e = net.edges.get(g.edge)!;
    const src = b.network.gates.find((q) => q.id === g.id);
    return { id: g.id, label: src?.label, direction: g.direction, staff: !!g.staff, stop: toPt(e.line.sample(g.stopS)), slots: g.slotS.map((s) => toPt(e.line.sample(s))), queueSlots: g.queueSlots };
  });
  const summary = {
    houses: houses.length, stalls: stalls.length, housesWithStall: houses.filter((h) => h.stallId).length, unreachable,
    adjustedHouses: houses.filter((h) => h.adjustedM > 0.3).length, farStalls, gateUse, buildMs: Date.now() - t0,
  };
  return { diag: { ok: !problems.some((p) => p.level === 'error'), problems, summary, derived: { houses, stalls, gates } }, net };
}
