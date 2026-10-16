// Builds the directed lane graph from the editable road-network JSON (PDF-point coordinates).
// Everything here is deterministic: the same JSON always yields the same graph and ids.
import {
  Vec, Polyline, catmullRom, resample, offsetPolyline, cubicBezier, rightOf, norm, sub, add, mul, dist, dot,
  polylineDistance, clamp, OBB, obbOverlap, cross, pointInPolygon,
} from '../shared/geom.ts';
import { houseSize, houseFootprint, footprintSamples } from '../shared/house.ts';

export type RoadClass = 'public' | 'arrival' | 'park' | 'service' | 'scenery';
export type EdgeKind = 'lane' | 'connector' | 'loop' | 'driveway' | 'reverse';

export interface Edge {
  id: string;
  kind: EdgeKind;
  line: Polyline;
  from: string;
  to: string;
  roadId?: string;
  dir?: 'f' | 'b';
  cls: RoadClass;
  priority: number;
  baseSpeed: number;
  /** speed limit sampled per metre (includes curvature & local limits) */
  vmax: Float32Array;
  next: string[];
  prev: string[];
  /** vehicle body faces opposite to its direction of motion (explicit reverse manoeuvre) */
  reverseMotion: boolean;
  visitor: boolean;
  service: boolean;
  stallId?: string;
  laneHalfWidth: number;
  /** U-turn inside a junction: only for small service carts (golf carts) */
  uturn?: boolean;
  /** lane of a one-way road (centre line; parking allowed on both sides) */
  oneway?: boolean;
}

export interface ZoneMember { edge: string; s0: number; s1: number; stream: string; prio: number; samples: Vec[] }
export interface Zone {
  id: string;
  kind: 'junction' | 'parking';
  node: string;
  members: ZoneMember[];
  /** streams that conflict with every other stream; non-exclusive streams may coexist */
  exclusive: Set<string>;
  /** approach direction (unit) per stream, used for right-before-left */
  approachDir: Record<string, Vec>;
  approachPos: Record<string, Vec>;
  /** at most one vehicle in the zone at a time (turning loop) */
  single?: boolean;
}

export interface Stall {
  id: string;
  clusterId: string;
  /** 'house' = assigned to a bungalow, 'spare' = free service/visitor stall, 'depot' = home of a service cart */
  kind: 'house' | 'spare' | 'depot';
  houseNumber: number;
  attachNode: string;
  inEdge: string;
  outEdge: string;
  /** all ways in (inEdge first; plus turning in from the opposite lane) and out (outEdge first; plus reversing out
   *  towards the opposite lane); every in-edge ends, and every out-edge starts, at the same parked position */
  inEdges: string[];
  outEdges: string[];
  /** centre-of-vehicle arc length on inEdge where the parked car stands */
  parkS: number;
  /** distance from the end of any in-edge (start of any out-edge) to the parked vehicle centre */
  parkBack: number;
  pad: Vec[];
  parkedPose: { x: number; y: number; heading: number };
}

export interface GateDef {
  id: string;
  direction: 'inbound' | 'outbound';
  /** staff barrier (personeelsslagboom): opens only with a logged staff pass for a service vehicle, never for visitors */
  staff?: boolean;
  edge: string;
  stopS: number;
  crossLen: number;
  /** vehicle-centre targets per slot (index 0 = at the stop line) */
  slotS: number[];
  slotSpacing: number;
  queueSlots: number;
  armPivot: Vec;
  armDir: Vec;
  armLen: number;
  laneDir: Vec;
  openSec: number;
  closeSec: number;
  stopPoint: Vec;
  kiosk: Vec;
  crossingPoly: Vec[];
  limitation?: string;
  /** 'West' / 'Oost' */
  label?: string;
}

export interface Portal { id: string; node: string; kind: 'public' | 'service'; spawnEdge?: string; despawnEdge?: string; label: string }

export interface RoadRender {
  id: string; name: string; cls: RoadClass; center: Vec[]; halfWidth: number[]; markings?: string; surface?: 'asphalt' | 'pavers'; hidden?: boolean;
  /** end nodes (absent for turning-circle discs) */
  from?: string; to?: string;
}

export interface HouseInfo {
  id: string; number: number; legendType: string | null; typeConfidence: string; pos: Vec; rotation: number;
  /** unit vector the front/door faces */
  front: Vec; petsAllowed: boolean; focus: boolean; door: Vec; adjusted?: string;
  /** art scale so the house (incl. annex and patio) fits its square in the PDF */
  scale?: number;
  stallId?: string;
}

export interface Network {
  edges: Map<string, Edge>;
  nodes: Map<string, { id: string; pos: Vec; kind: string }>;
  zones: Zone[];
  zonesByEdge: Map<string, { zone: Zone; member: ZoneMember }[]>;
  stalls: Map<string, Stall>;
  stallsByHouse: Map<number, Stall>;
  gates: Map<string, GateDef>;
  portals: Map<string, Portal>;
  roads: RoadRender[];
  islands: Vec[][];
  houses: HouseInfo[];
  toWorld: (pt: number[]) => Vec;
  bounds: { w: number; h: number };
  validation: { level: 'info' | 'warn'; msg: string }[];
}

export interface NetworkJson {
  nodes: Record<string, { pt: number[]; kind: string; radius?: number; portal?: 'public' | 'service'; label?: string; turnRadiusM?: number }>;
  roads: {
    id: string; name: string; from: string; to: string; class: RoadClass; speedKmh: number; priority: number; laneOffsetM: number;
    pts: number[][]; markings?: string; surface?: 'asphalt' | 'pavers';
    /** one-way road: only the 'f' (from -> to) or 'b' (to -> from) lane exists, on the centre line */
    oneway?: 'f' | 'b';
    /** drawn by something else (e.g. the aisle of the car park): no road surface of its own */
    hidden?: boolean;
    gatePlaza?: { fromPt: number[]; toPt: number[]; forwardOffsetM: number; backwardOffsetM: number; rampM: number };
  }[];
  gates: { id: string; direction: 'inbound' | 'outbound'; road: string; lane: 'forward' | 'backward'; stopPt: number[]; queueSlots: number; slotSpacingM: number; openSec: number; closeSec: number;
    /** side of the lane where the arm pivots: 'left' = on the central island (default), 'right' = at the road edge */
    armSide?: 'left' | 'right'; label?: string;
    /** staff barrier on a service road: only service vehicles with a staff pass */
    staff?: boolean }[];
}

export interface SectorJson {
  viewPts: number[]; originPt: number[]; metersPerPt: number;
  houses: { id: string; number: number; pt: number[]; legendType: string | null; typeConfidence: string; pdfRotationDeg?: number; petsAllowed?: boolean;
    /** map editor overrides: front direction (degrees, 0 = east, 90 = south), fixed art scale, and 'locked' = the
     *  position is placed by hand and is never nudged by the free-space pass (conflicts are reported instead) */
    frontDeg?: number; scale?: number; locked?: boolean }[];
  parkingClusters: { id: string; kind?: 'house' | 'depot'; pt: number[]; stalls: number; serves: number[]; stall?: Partial<StallSize> }[];
  [k: string]: unknown;
}

export const VEH = { carLen: 4.7, carWid: 1.9 };
/** Centre-line distance below which two junction movements conflict when at least one of them turns. */
const TURN_CLEARANCE = 3.3;
const RT = 5.0, STRAIGHT = 3.6, SP = 3.1;
/** Stall dimensions: car stalls by default, smaller for golf-cart depots. */
export interface StallSize { rt: number; straight: number; width: number; vehLen: number; vehWid: number }
export const CAR_STALL: StallSize = { rt: RT, straight: STRAIGHT, width: SP, vehLen: VEH.carLen, vehWid: VEH.carWid };
/** Driveway geometry: smooth curve from the lane (arc length sAttach) to the pad entry E, which faces direction rc;
 *  then straight into the pad. Pads of one cluster share rc and lie on a straight baseline (parallel stalls). */
export function stallGeometry(lane: Polyline, sAttach: number, E: Vec, rc: Vec, sz: StallSize = CAR_STALL) {
  const A0 = lane.sample(sAttach);
  const A = { x: A0.x, y: A0.y };
  const d = lane.tangent(sAttach, 1.0);
  const h = Math.max(2.2, dist(A, E) * 0.55);
  const curve = cubicBezier(A, add(A, mul(d, h)), sub(E, mul(rc, h)), E, 0.3);
  const end = add(E, mul(rc, sz.straight));
  const line = new Polyline(resample([...curve, end], 0.35));
  const padC = add(E, mul(rc, sz.straight - sz.vehLen / 2 - 0.4));
  const parked: OBB = { cx: padC.x, cy: padC.y, ux: rc.x, uy: rc.y, hl: sz.vehLen / 2, hw: sz.vehWid / 2 };
  return { A, d, r: rc, end, line, padC, parked, E };
}

const A_LAT = 1.7; // comfortable lateral acceleration m/s^2

export function buildNetwork(net: NetworkJson, sector: SectorJson): Network {
  const k = sector.metersPerPt;
  const o = sector.originPt;
  const toWorld = (pt: number[]): Vec => ({ x: (pt[0] - o[0]) * k, y: (pt[1] - o[1]) * k });
  const validation: Network['validation'] = [];
  const nodes = new Map<string, { id: string; pos: Vec; kind: string }>();
  for (const [id, n] of Object.entries(net.nodes)) nodes.set(id, { id, pos: toWorld(n.pt), kind: n.kind });

  const edges = new Map<string, Edge>();
  const roads: RoadRender[] = [];
  const islands: Vec[][] = [];

  const clsFlags = (c: RoadClass) => ({
    visitor: c === 'public' || c === 'arrival' || c === 'park',
    service: c === 'park' || c === 'service' || c === 'arrival',
  });

  const mkEdge = (e: Omit<Edge, 'vmax' | 'next' | 'prev'> & { vmax?: Float32Array }): Edge => {
    const full: Edge = { ...e, vmax: e.vmax ?? new Float32Array(0), next: [], prev: [] };
    edges.set(full.id, full);
    return full;
  };

  // ---- 1. roads -> centrelines -> lanes
  const laneOf: Record<string, { f?: string; b?: string }> = {};
  for (const r of net.roads) {
    const nf = net.nodes[r.from], nt = net.nodes[r.to];
    const ctrl = [nf.pt, ...r.pts, nt.pt].map(toWorld);
    const centre = new Polyline(resample(catmullRom(ctrl, 0.4), 0.5));
    const trim = (n: typeof nf) => (n.kind === 'junction' ? n.radius ?? 6 : n.kind === 'deadend' ? (n.turnRadiusM ?? 6) : 0);
    const t0 = trim(nf), t1 = trim(nt);
    const core = centre.slice(t0, centre.length - t1);
    const base = r.laneOffsetM;
    let offF = (_s: number) => base, offB = (_s: number) => base;
    if (r.gatePlaza) {
      const g = r.gatePlaza;
      const sa = core.project(toWorld(g.fromPt)).s, sb = core.project(toWorld(g.toPt)).s;
      const ramp = g.rampM;
      const w = (s: number) => {
        if (s < sa - ramp || s > sb + ramp) return 0;
        if (s >= sa && s <= sb) return 1;
        const t = s < sa ? (s - (sa - ramp)) / ramp : ((sb + ramp) - s) / ramp;
        return t * t * (3 - 2 * t);
      };
      offF = (s) => base + (g.forwardOffsetM - base) * w(s);
      offB = (s) => base + (g.backwardOffsetM - base) * w(s);
      // island polygon between the lanes (for rendering)
      const left: Vec[] = [], right: Vec[] = [];
      for (let s = sa - ramp * 0.3; s <= sb + ramp * 0.3; s += 0.5) {
        const p = core.sample(s), t = core.tangent(s), rn = rightOf(t);
        const ww = w(s);
        if (ww < 0.35) continue;
        const a = offF(s) - 1.55, b = -(offB(s) - 1.55);
        right.push(add(p, mul(rn, Math.max(b + 0.05, a))));
        left.push(add(p, mul(rn, b)));
      }
      if (left.length > 2) islands.push([...right, ...left.reverse()]);
    }
    if (nt.kind === 'deadend' || nf.kind === 'deadend') {
      // widen towards a turning circle so entering and leaving vehicles keep clear of each other
      const atEnd = nt.kind === 'deadend';
      const wEnd = (s: number) => {
        const x = atEnd ? (s - (core.length - 14)) / 14 : (14 - s) / 14;
        const t = clamp(x, 0, 1); return t * t * (3 - 2 * t);
      };
      const f0 = offF, b0 = offB;
      const wide = Math.min(2.5, (atEnd ? nt : nf).turnRadiusM ? ((atEnd ? nt : nf).turnRadiusM! * 0.4) : 2.5);
      offF = (s) => Math.max(f0(s), base + Math.max(0, wide - base) * wEnd(s));
      offB = (s) => Math.max(b0(s), base + Math.max(0, wide - base) * wEnd(s));
    }
    const flags = clsFlags(r.class);
    const speed = r.speedKmh / 3.6;
    if (!r.oneway && !r.gatePlaza && base > 0) {
      // widen two-way roads in bends: a car's body cuts the inside of a curve (off-tracking ~ wheelbase^2 / 2R), so
      // oncoming vehicles need a little more room there
      const bendAt = (s: number) => {
        const a = core.tangent(clamp(s - 3, 0, core.length), 1), b = core.tangent(clamp(s + 3, 0, core.length), 1);
        const ang = Math.abs(Math.atan2(cross(a, b), a.x * b.x + a.y * b.y));
        return ang / 6; // curvature 1/R over a 6 m window
      };
      const step = 1, n = Math.max(1, Math.ceil(core.length / step));
      const kap = Array.from({ length: n + 1 }, (_, i) => bendAt(i * step));
      // averaged over +-10 m (no visible bulges), at most 0.6 m per lane
      const wid = kap.map((_, i) => { let m = 0, c = 0; for (let j = Math.max(0, i - 10); j <= Math.min(n, i + 10); j++) { m += kap[j]; c++; } return Math.min(0.6, 4.0 * m / c); });
      const extra = (s: number) => { const i = clamp(s / step, 0, n); const i0 = Math.floor(i), i1 = Math.min(n, i0 + 1); return wid[i0] + (wid[i1] - wid[i0]) * (i - i0); };
      const f0 = offF, b0 = offB;
      offF = (s) => f0(s) + extra(s);
      offB = (s) => b0(s) + extra(s);
    }
    const fLine = new Polyline(offsetPolyline(core, offF, 0.5));
    const bLine = new Polyline(offsetPolyline(core, (s) => -offB(s), 0.5)).reversed();
    const ef = r.oneway === 'b' ? undefined : mkEdge({ id: `${r.id}:f`, kind: 'lane', line: fLine, from: r.from, to: r.to, roadId: r.id, dir: 'f', cls: r.class, priority: r.priority, baseSpeed: speed, reverseMotion: false, ...flags, laneHalfWidth: 1.45, oneway: !!r.oneway });
    const eb = r.oneway === 'f' ? undefined : mkEdge({ id: `${r.id}:b`, kind: 'lane', line: bLine, from: r.to, to: r.from, roadId: r.id, dir: 'b', cls: r.class, priority: r.priority, baseSpeed: speed, reverseMotion: false, ...flags, laneHalfWidth: 1.45, oneway: !!r.oneway });
    laneOf[r.id] = { f: ef?.id, b: eb?.id };
    // render geometry: full centre (untrimmed) with half widths (accounting for the plaza widening)
    const hw: number[] = [];
    const cpts: Vec[] = [];
    for (let s = 0; s <= centre.length; s += 1) {
      const cs = clamp(s - t0, 0, core.length);
      const p = centre.sample(s);
      cpts.push({ x: p.x, y: p.y });
      hw.push(Math.max(offF(cs), offB(cs)) + (r.surface === 'pavers' ? 0.9 : 1.5));
    }
    roads.push({ id: r.id, name: r.name, cls: r.class, center: cpts, halfWidth: hw, markings: r.markings, surface: r.surface, from: r.from, to: r.to, hidden: r.hidden });
  }

  // ---- 2. parking: each cluster picks its lane; ALL stalls along one lane side are laid out as one row, so stalls of
  // neighbouring clusters never overlap. Stalls that do not fit (or clash with another row or lane) move to the next
  // best lane in a following round. Positions are design assumptions; every shift is reported.
  interface StallPlan { key: string; cluster: string; house: number; lane: string; s: number; E: Vec; rc: Vec; sz: StallSize; kind: Stall['kind']; sid?: string;
    /** filled while building: geometry and nodes for the cross movements over the opposite lane */
    G?: ReturnType<typeof stallGeometry>; stallNode?: string; near?: Polyline; far?: { lane: string; cIn: ExtraCut; cOut: ExtraCut; X: Vec; line: Polyline } }
  /** an extra split point on a lane (turning in from / out to the opposite lane of a stall) */
  interface ExtraCut { key: string; s: number; extra: true; dead?: boolean }
  interface Demand { cluster: string; key: string; house: number; kind: Stall['kind']; sz: StallSize; p: Vec; order: number; avoid: Set<string> }
  const demands: Demand[] = [];
  for (const c of sector.parkingClusters) {
    const sz: StallSize = c.stall ? { ...CAR_STALL, ...c.stall } : CAR_STALL;
    for (let i = 0; i < c.stalls; i++) {
      const house = c.serves[i] ?? -1;
      demands.push({ cluster: c.id, key: `${c.id}:${c.serves[i] ?? `v${i + 1}`}`, house, kind: c.kind === 'depot' ? 'depot' : house > 0 ? 'house' : 'spare', sz, p: toWorld(c.pt), order: i, avoid: new Set() });
    }
  }
  const clusterKind = new Map(sector.parkingClusters.map((c) => [c.id, c.kind]));
  const bestLane = (d: Demand) => {
    let best: { lane: string; s: number; d: number; side: number } | null = null;
    const depot = clusterKind.get(d.cluster) === 'depot';
    for (const e of edges.values()) {
      if (e.kind !== 'lane' || d.avoid.has(e.id)) continue;
      if (depot ? e.cls !== 'service' : e.cls !== 'park') continue;
      // a lane that starts or ends at a portal (service entrance) is never reached / left by a visitor
      if (!depot && (net.nodes[e.from]?.kind === 'portal' || net.nodes[e.to]?.kind === 'portal')) continue;
      if (best && e.line.bboxDist(d.p) > best.d) continue;
      const pr = e.line.project(d.p);
      // must not lie on the far side of the road (= other lane's right side); a one-way lane serves both sides
      if (pr.lateral <= -0.9 && !e.oneway) continue;
      if (!best || pr.d < best.d) best = { lane: e.id, s: pr.s, d: pr.d, side: e.oneway && pr.lateral < 0 ? -1 : 1 };
    }
    return best;
  };
  // water from the PDF segmentation: no pad may lie (partly) in a pond or ditch
  const waterW = (((sector as { terrain?: { water?: number[][][] } }).terrain?.water) ?? []).map((w) => w.map(toWorld));
  const inWater = (q: Vec) => waterW.some((w) => pointInPolygon(q, w));
  // turning circles are drawn as discs of radius R + 1.7 m: no pad may reach into one
  const circles = Object.entries(net.nodes).filter(([, nd]) => nd.kind === 'deadend').map(([, nd]) => ({ c: toWorld(nd.pt), r: (nd.turnRadiusM ?? 6) + 1.7 + 0.4 }));
  const inCircle = (q: Vec) => circles.some((cc) => dist(cc.c, q) < cc.r);
  const plans: StallPlan[] = [];
  const placedOBB: { plan: StallPlan; obb: OBB; row: string }[] = [];
  let pending = demands;
  for (let round = 0; round < 30 && pending.length; round++) {
    const rows = new Map<string, { lane: string; side: number; sz: StallSize; items: { d: Demand; pref: number; dist: number }[] }>();
    const next: Demand[] = [];
    for (const d of pending) {
      const bl = bestLane(d);
      if (!bl) { validation.push({ level: 'warn', msg: `Parkeervak ${d.key}: geen geschikte rijstrook gevonden` }); continue; }
      const key = `${bl.lane}|${bl.side}|${d.sz.width}`;
      const row = rows.get(key) ?? rows.set(key, { lane: bl.lane, side: bl.side, sz: d.sz, items: [] }).get(key)!;
      row.items.push({ d, pref: bl.s + d.sz.rt * 0.6, dist: bl.d });
    }
    for (const [rowKey, row] of rows) {
      const sz = row.sz, RT = sz.rt, STRAIGHT = sz.straight;
      const laneLine = edges.get(row.lane)!.line, L = laneLine.length;
      // keep cluster order: sort by preferred position, members of one cluster spread around it
      const byCluster = new Map<string, typeof row.items>();
      for (const it of row.items) (byCluster.get(it.d.cluster) ?? byCluster.set(it.d.cluster, []).get(it.d.cluster)!).push(it);
      const items: { d: Demand; pref: number }[] = [];
      for (const list of byCluster.values()) {
        list.sort((x, y) => x.d.order - y.d.order);
        list.forEach((it, i) => items.push({ d: it.d, pref: it.pref + (i - (list.length - 1) / 2) * sz.width }));
      }
      items.sort((x, y) => x.pref - y.pref);
      const lo = 5 + RT, hi = L - 7;
      const bl = sz === CAR_STALL ? 2.4 : sz.vehLen / 2 + 0.05, bw = sz === CAR_STALL ? 0.975 : sz.vehWid / 2 + 0.05;
      const layout = (use: typeof items, sp: number) => {
        const centres = use.map((x) => x.pref);
        for (let i = 0; i < centres.length; i++) centres[i] = Math.max(centres[i], i ? centres[i - 1] + sp : lo);
        if (centres.length && centres[centres.length - 1] > hi) {
          centres[centres.length - 1] = hi;
          for (let i = centres.length - 2; i >= 0; i--) centres[i] = Math.min(centres[i], centres[i + 1] - sp);
        }
        const entries: Vec[] = [], rcs: Vec[] = [], ss: number[] = [];
        for (const sc of centres) {
          const B0 = laneLine.sample(sc), dc = laneLine.tangent(sc, 2);
          const rc = mul(rightOf(dc), row.side);
          const E = add({ x: B0.x, y: B0.y }, mul(rc, RT));
          entries.push(E); rcs.push(rc);
          ss.push(clamp(laneLine.project(sub(sub(E, mul(rc, RT)), mul(dc, RT * 0.95))).s, 3, L - 3));
        }
        const geo = ss.map((sA, i) => stallGeometry(laneLine, sA, entries[i], rcs[i], sz));
        // culprits: stalls whose driveway sweeps through a parked position (this row or rows placed before), whose pad
        // is too close to the own lane, or whose parked car comes near another lane
        const bad = new Set<number>();
        for (let i = 1; i < ss.length; i++) if (ss[i] - ss[i - 1] <= 1.0) bad.add(i);
        const mine: OBB[] = geo.map((g) => ({ ...g.parked, hl: bl, hw: bw }));
        const near = placedOBB.filter((o) => geo.some((g) => dist({ x: o.obb.cx, y: o.obb.cy }, { x: g.parked.cx, y: g.parked.cy }) < 30)).map((o) => o.obb);
        for (let j = 0; j < geo.length; j++) {
          for (let x = 0.9; x <= geo[j].line.length - sz.vehLen / 2 - 0.4; x += 0.4) {
            const q = geo[j].line.sample(x), t = geo[j].line.tangent(x, 0.5);
            const box: OBB = { cx: q.x, cy: q.y, ux: t.x, uy: t.y, hl: bl, hw: bw };
            let hit = false;
            for (let k = 0; k < mine.length && !hit; k++) if (k !== j && obbOverlap(box, mine[k], 0.26)) { hit = true; bad.add(Math.abs(k - j) === 1 ? Math.max(j, k) : j); }
            for (const o of near) if (!hit && obbOverlap(box, o, 0.26)) { hit = true; bad.add(j); }
            if (hit) break;
          }
          { const pk = geo[j].parked; const ux = pk.ux * pk.hl, uy = pk.uy * pk.hl, vx = -pk.uy * pk.hw, vy = pk.ux * pk.hw;
            if ([[1, 1], [1, -1], [-1, 1], [-1, -1], [0, 0]].some(([a, b]) => { const q = { x: pk.cx + a * ux + b * vx, y: pk.cy + a * uy + b * vy }; return inWater(q) || inCircle(q); })) bad.add(j); }
          const nearLane = laneLine.project(add(entries[j], mul(rcs[j], STRAIGHT - sz.vehLen - 0.4)));
          if (nearLane.d < (sz === CAR_STALL ? 2.6 : 1.9)) bad.add(j);
          const pc = geo[j].parked;
          for (const e of edges.values()) {
            if (e.kind !== 'lane' || e.id === row.lane || e.line.bboxDist({ x: pc.cx, y: pc.cy }) > 4) continue;
            if (e.line.project({ x: pc.cx, y: pc.cy }).d < bw + 1.5) { bad.add(j); break; }
          }
        }
        return { centres, entries, rcs, ss, geo, bad };
      };
      // capacity first, then a few wider spacings; finally drop only the culprit stalls (they try another lane)
      let use = items.slice(0, Math.max(0, Math.min(items.length, Math.floor((hi - lo) / sz.width) + 1)));
      const overflow = items.slice(use.length);
      let res = layout(use, sz.width);
      for (let sp = sz.width + 0.3; res.bad.size && sp <= sz.width + 1.2 && (use.length - 1) * sp <= hi - lo; sp += 0.3) {
        const r2 = layout(use, sp);
        if (r2.bad.size < res.bad.size) res = r2;
      }
      for (let guard = 0; res.bad.size && guard < 40; guard++) {
        const drop = [...res.bad].sort((x, y) => y - x)[0];
        overflow.push(use[drop]);
        use = use.filter((_, i) => i !== drop);
        res = layout(use, sz.width);
      }
      const { centres, entries, rcs, ss, geo } = res;
      const fit = use.length;
      items.splice(0, items.length, ...use, ...overflow);
      for (const it of items.slice(fit)) { it.d.avoid.add(row.lane); next.push(it.d); }
      items.slice(0, fit).forEach((it, i) => {
        const plan: StallPlan = { key: it.d.key, cluster: it.d.cluster, house: it.d.house, lane: row.lane, s: ss[i], E: entries[i], rc: rcs[i], sz, kind: it.d.kind };
        plans.push(plan);
        placedOBB.push({ plan, obb: { ...geo[i].parked, hl: bl, hw: bw }, row: rowKey });
        const shift = centres[i] - it.pref;
        if (Math.abs(shift) > 8) validation.push({ level: 'info', msg: `Vak ${it.d.key}: ${shift.toFixed(1)} m verschoven langs ${row.lane} (ruimte/kruising)` });
      });
    }
    pending = next;
  }
  for (const d of pending) validation.push({ level: 'warn', msg: `Parkeervak ${d.key} (huis ${d.house}) kon nergens worden geplaatst` });
  // stable stall ids: cluster + running number in lane order (a cluster may now span more than one lane)
  const perCluster = new Map<string, StallPlan[]>();
  for (const p of plans) (perCluster.get(p.cluster) ?? perCluster.set(p.cluster, []).get(p.cluster)!).push(p);
  for (const list of perCluster.values()) {
    list.sort((a, b) => (a.lane === b.lane ? a.s - b.s : a.lane < b.lane ? -1 : 1));
    list.forEach((p, i) => { p.sid = `${p.cluster}-${i + 1}`; });
  }
  // split lanes at attach points
  const splitsByLane = new Map<string, (StallPlan | ExtraCut)[]>();
  for (const p of plans) {
    const L = edges.get(p.lane)!;
    if (p.s < 4 || p.s > L.line.length - 4) validation.push({ level: 'warn', msg: `Vak voor huis ${p.house} ligt te dicht bij een kruising (s=${p.s.toFixed(1)})` });
    p.s = clamp(p.s, 4, L.line.length - 4);
    (splitsByLane.get(p.lane) ?? splitsByLane.set(p.lane, []).get(p.lane)!).push(p);
  }
  // turning in from and out to the opposite lane (client, 13-10-2026: no detour via a turning point; traffic on the
  // lanes always has priority). Only on two-way roads, away from the lane ends (junctions).
  for (const p of plans) {
    const L = edges.get(p.lane)!;
    if (L.oneway || !L.roadId || p.kind === 'spare') continue;
    const F = edges.get(`${L.roadId}:${L.dir === 'f' ? 'b' : 'f'}`);
    if (!F || F.kind !== 'lane') continue;
    const G = stallGeometry(L.line, p.s, p.E, p.rc, p.sz);
    const pe = F.line.project(G.A);                         // the attach point on the near lane, across from it
    if (pe.d > 6) continue;
    const sIn = pe.s - 3.5;                                 // start of the left turn, upstream on the opposite lane
    const X = L.line.sample(Math.min(L.line.length - 1, p.s + 3.0 + p.sz.vehLen / 2)); // rear swings downstream
    const sOut = F.line.project(X).s + 4.5;                 // merge point, downstream on the opposite lane
    if (sIn < 5 || sOut > F.line.length - 5 || sOut < 5 || sIn > F.line.length - 5) continue;
    const cIn: ExtraCut = { key: `${p.key}>in`, s: sIn, extra: true }, cOut: ExtraCut = { key: `${p.key}>out`, s: sOut, extra: true };
    p.far = { lane: F.id, cIn, cOut, X: { x: X.x, y: X.y }, line: F.line };
    (splitsByLane.get(F.id) ?? splitsByLane.set(F.id, []).get(F.id)!).push(cIn, cOut);
  }
  const crossLinks: [string, string][] = [];
  const stalls = new Map<string, Stall>();
  const stallsByHouse = new Map<number, Stall>();
  const pieceMap = new Map<string, { id: string; s0: number; s1: number }[]>(); // original lane -> pieces
  for (const [laneId, ps] of splitsByLane) {
    ps.sort((a, b) => a.s - b.s);
    // stalls on both sides of a one-way lane may attach at the same point: keep lane pieces at least 1 m long
    for (let i = 1; i < ps.length; i++) if (ps[i].s < ps[i - 1].s + 1.0) ps[i].s = ps[i - 1].s + 1.0;
    const L = edges.get(laneId)!;
    // an extra cut pushed against the lane end is dropped (its cross movement is then not built)
    for (let i = ps.length - 1; i >= 0; i--) { const c = ps[i]; if ('extra' in c && c.s > L.line.length - 1.5) { c.dead = true; ps.splice(i, 1); } }
    edges.delete(laneId);
    const cuts = [0, ...ps.map((p) => p.s), L.line.length];
    const pieces: { id: string; s0: number; s1: number }[] = [];
    let prevNode = L.from;
    for (let i = 0; i < cuts.length - 1; i++) {
      const id = `${laneId}~${i}`;
      const toNode = i < ps.length ? `AT:${ps[i].key}` : L.to;
      if (i < ps.length) nodes.set(toNode, { id: toNode, pos: L.line.sample(cuts[i + 1]), kind: 'attach' });
      mkEdge({ ...L, id, line: L.line.slice(cuts[i], cuts[i + 1]), from: prevNode, to: toNode });
      pieces.push({ id, s0: cuts[i], s1: cuts[i + 1] });
      prevNode = toNode;
    }
    pieceMap.set(laneId, pieces);
    // driveways
    (ps.filter((c) => !('extra' in c)) as StallPlan[]).forEach((p) => {
      const at = `AT:${p.key}`;
      const G = stallGeometry(L.line, p.s, p.E, p.rc, p.sz);
      p.G = G; p.near = L.line;
      const STRAIGHT = p.sz.straight, depot = p.kind === 'depot';
      const A = G.A, d = G.d, r = G.r, end = G.end, inLine = G.line;
      const stallNode = `ST:${p.key}`;
      const padC = G.padC;
      nodes.set(stallNode, { id: stallNode, pos: end, kind: 'stall' });
      p.stallNode = stallNode;
      const sid = p.sid!;
      const inE = mkEdge({ id: `DW:${sid}`, kind: 'driveway', line: inLine, from: at, to: stallNode, cls: 'park', priority: 0, baseSpeed: 2.2, reverseMotion: false, visitor: !depot, service: true, stallId: sid, laneHalfWidth: 1.3 });
      const outE = mkEdge({ id: `RV:${sid}`, kind: 'reverse', line: inLine.reversed(), from: stallNode, to: at, cls: 'park', priority: 0, baseSpeed: 1.3, reverseMotion: true, visitor: !depot, service: true, stallId: sid, laneHalfWidth: 1.3 });
      const half = p.sz.width / 2 - 0.1;
      const dd = rightOf({ x: -r.x, y: -r.y });
      const E0 = G.E;
      const pad = [
        add(add(E0, mul(dd, -half)), mul(r, -0.4)), add(add(E0, mul(dd, half)), mul(r, -0.4)),
        add(add(E0, mul(dd, half)), mul(r, STRAIGHT + 0.5)), add(add(E0, mul(dd, -half)), mul(r, STRAIGHT + 0.5)),
      ];
      const st: Stall = {
        id: sid, clusterId: p.cluster, kind: p.kind, houseNumber: p.house, attachNode: at, inEdge: inE.id, outEdge: outE.id,
        inEdges: [inE.id], outEdges: [outE.id],
        parkS: inLine.length - p.sz.vehLen / 2 - 0.4, parkBack: p.sz.vehLen / 2 + 0.4, pad,
        parkedPose: { x: padC.x, y: padC.y, heading: Math.atan2(r.y, r.x) },
      };
      stalls.set(sid, st);
      if (p.house > 0) stallsByHouse.set(p.house, st);
    });
  }

  // cross movements over the opposite lane (now that every lane is split at its attach points)
  for (const p of plans) {
    const f = p.far, G = p.G, st = p.sid ? stalls.get(p.sid) : undefined;
    if (!f || !G || !st || !p.stallNode || f.cIn.dead || f.cOut.dead) continue;
    const inNode = `AT:${f.cIn.key}`, outNode = `AT:${f.cOut.key}`;
    if (!nodes.has(inNode) || !nodes.has(outNode)) continue;
    const depot = p.kind === 'depot', sid = p.sid!;
    // in: left turn from the opposite lane straight into the stall (same final straight as the normal driveway)
    const P0 = nodes.get(inNode)!.pos, t0 = f.line.tangent(f.cIn.s, 1.2);
    const hIn = Math.max(2.5, dist(P0, G.E) * 0.55);
    const inPts = [...cubicBezier(P0, add(P0, mul(t0, hIn)), sub(G.E, mul(G.r, hIn)), G.E, 0.3), G.end];
    const dx = mkEdge({ id: `DX:${sid}`, kind: 'driveway', line: new Polyline(resample(inPts, 0.35)), from: inNode, to: p.stallNode, cls: 'park', priority: 0, baseSpeed: 2.0, reverseMotion: false, visitor: !depot, service: true, stallId: sid, laneHalfWidth: 1.3 });
    // out: reverse out with the rear swinging downstream (ends on the near lane facing the other way) ...
    const X = f.X, tX = p.near!.tangent(p.near!.project(X).s, 1.2);
    const hR = Math.max(2.2, dist(G.E, X) * 0.55);
    const rvPts = [G.end, ...cubicBezier(G.E, sub(G.E, mul(G.r, hR)), sub(X, mul(tX, hR)), X, 0.3)];
    const xNode = `RX:${p.key}`;
    nodes.set(xNode, { id: xNode, pos: X, kind: 'attach' });
    const rx = mkEdge({ id: `RX:${sid}`, kind: 'reverse', line: new Polyline(resample(rvPts, 0.35)), from: p.stallNode, to: xNode, cls: 'park', priority: 0, baseSpeed: 1.3, reverseMotion: true, visitor: !depot, service: true, stallId: sid, laneHalfWidth: 1.3 });
    // ... then forward across onto the opposite lane
    const P3 = nodes.get(outNode)!.pos, t3 = f.line.tangent(f.cOut.s, 1.2), back = { x: -tX.x, y: -tX.y };
    const hO = Math.max(2.0, dist(X, P3) * 0.45);
    const xo = mkEdge({ id: `XO:${sid}`, kind: 'connector', line: new Polyline(resample(cubicBezier(X, add(X, mul(back, hO)), sub(P3, mul(t3, hO)), P3, 0.3), 0.3)), from: xNode, to: outNode, cls: 'park', priority: 0, baseSpeed: 2.2, reverseMotion: false, visitor: !depot, service: true, laneHalfWidth: 1.3 });
    st.inEdges.push(dx.id); st.outEdges.push(rx.id);
    crossLinks.push([rx.id, xo.id], [xo.id, outNode]);
  }

  // ---- 3. junction connectors and dead-end loop
  const incoming = (node: string) => [...edges.values()].filter((e) => e.kind === 'lane' && e.to === node);
  const outgoing = (node: string) => [...edges.values()].filter((e) => e.kind === 'lane' && e.from === node);
  for (const [nid, n] of Object.entries(net.nodes)) {
    if (n.kind === 'junction') {
      for (const ein of incoming(nid)) for (const eout of outgoing(nid)) {
        if (ein.roadId === eout.roadId) {
          // U-turn in the junction box: only for golf carts (tight turning circle), never for cars
          const p0 = ein.line.sample(ein.line.length), p3 = eout.line.sample(0);
          const t0 = ein.line.tangent(ein.line.length, 1.2), t3 = eout.line.tangent(0, 1.2);
          const hh = Math.max(4.5, (net.nodes[nid].radius ?? 6) * 0.8);
          const pts = cubicBezier(p0, add(p0, mul(t0, hh)), sub(p3, mul(t3, hh)), p3, 0.25);
          const id = `UT:${nid}:${ein.roadId}${ein.dir}`;
          mkEdge({ id, kind: 'connector', line: new Polyline(resample(pts, 0.3)), from: nid, to: nid, cls: ein.cls, priority: 1, baseSpeed: 2.2, reverseMotion: false, visitor: false, service: ein.service && eout.service, laneHalfWidth: 1.2, uturn: true });
          link(ein.id, id); link(id, eout.id);
          continue;
        }
        const p0 = ein.line.sample(ein.line.length), p3 = eout.line.sample(0);
        const t0 = ein.line.tangent(ein.line.length, 1.2), t3 = eout.line.tangent(0, 1.2);
        const dd = dist(p0, p3);
        const turn = Math.abs(Math.atan2(t0.x * t3.y - t0.y * t3.x, dot(t0, t3)));
        const h = dd * (turn > 1.2 ? 0.5 : 0.42);
        const pts = cubicBezier(p0, add(p0, mul(t0, h)), sub(p3, mul(t3, h)), p3, 0.3);
        const id = `CN:${nid}:${ein.roadId}${ein.dir}>${eout.roadId}${eout.dir}`;
        const visitor = ein.visitor && eout.visitor, service = ein.service && eout.service;
        mkEdge({ id, kind: 'connector', line: new Polyline(resample(pts, 0.3)), from: nid, to: nid, cls: ein.cls, priority: ein.priority, baseSpeed: Math.min(ein.baseSpeed, eout.baseSpeed), reverseMotion: false, visitor, service, laneHalfWidth: 1.45 });
        link(ein.id, id); link(id, eout.id);
      }
    } else if (n.kind === 'deadend') {
      const ins = incoming(nid), outs = outgoing(nid);
      if (ins.length !== 1 || outs.length !== 1) { validation.push({ level: 'warn', msg: `Doodlopend punt ${nid} heeft geen enkele in/uit-rijstrook` }); continue; }
      const ein = ins[0], eout = outs[0];
      const C = nodes.get(nid)!.pos;
      const P0 = ein.line.sample(ein.line.length), P3 = eout.line.sample(0);
      const f = ein.line.tangent(ein.line.length, 1.5), r = rightOf(f);
      const R = n.turnRadiusM ?? 6;
      const pts: Vec[] = [P0, add(P0, mul(f, 1.2))];
      for (let a = -55; a <= 235; a += 10) {
        const th = (a * Math.PI) / 180;
        pts.push(add(C, add(mul(r, R * Math.cos(th)), mul(f, R * Math.sin(th)))));
      }
      pts.push(sub(P3, mul(eout.line.tangent(0, 1.5), 1.2)), P3);
      const id = `LP:${nid}`;
      mkEdge({ id, kind: 'loop', line: new Polyline(resample(catmullRom(pts, 0.3), 0.3)), from: nid, to: nid, cls: ein.cls, priority: 1, baseSpeed: 3.2, reverseMotion: false, visitor: ein.visitor, service: ein.service, laneHalfWidth: 1.45 });
      link(ein.id, id); link(id, eout.id);
      const srf = net.roads.find((r) => r.id === ein.roadId)?.surface;
      roads.push({ id: `circle:${nid}`, name: 'Keerlus', cls: ein.cls, center: [C], halfWidth: [R + (srf === 'pavers' ? 1.1 : 1.7)], surface: srf });
    }
  }
  function link(a: string, b: string) {
    const A = edges.get(a)!, B = edges.get(b)!;
    if (!A.next.includes(b)) A.next.push(b);
    if (!B.prev.includes(a)) B.prev.push(a);
  }
  // lane pieces and driveways
  for (const e of edges.values()) {
    if (e.kind === 'lane') for (const e2 of edges.values()) if (e2.kind === 'lane' && e2.from === e.to && e.to.startsWith('AT:')) link(e.id, e2.id);
    if (e.kind === 'driveway') { /* attach node -> driveway */ for (const p of edges.values()) if (p.kind === 'lane' && p.to === e.from) link(p.id, e.id); }
    if (e.kind === 'reverse') { for (const n2 of edges.values()) if (n2.kind === 'lane' && n2.from === e.to) link(e.id, n2.id); }
  }
  for (const [a, b] of crossLinks) {
    if (edges.has(b)) link(a, b);
    else for (const n2 of edges.values()) if (n2.kind === 'lane' && n2.from === b) link(a, n2.id);   // node id: the lane piece starting there
  }

  // ---- 4. speed profiles
  for (const e of edges.values()) {
    const n = Math.max(2, Math.ceil(e.line.length) + 1);
    const vm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const kappa = Math.max(e.line.curvature(Math.min(i, e.line.length), 2.0), 1e-4);
      vm[i] = Math.min(e.baseSpeed, Math.sqrt(A_LAT / kappa));
    }
    e.vmax = vm;
  }

  // ---- 5. gates
  const gates = new Map<string, GateDef>();
  for (const g of net.gates) {
    const laneId = (g.lane === 'forward' ? laneOf[g.road]?.f : laneOf[g.road]?.b) ?? `${g.road}:${g.lane === 'forward' ? 'f' : 'b'}`;
    const e = edges.get(laneId);
    if (!e) { validation.push({ level: 'warn', msg: `Slagboom ${g.id}: rijstrook ${laneId} niet gevonden` }); continue; }
    const sp = toWorld(g.stopPt);
    const stopS = e.line.project(sp).s;
    const slotS: number[] = [];
    let limitation: string | undefined;
    for (let i = 0; i < g.queueSlots; i++) {
      const s = stopS - VEH.carLen / 2 - 0.4 - i * g.slotSpacingM;
      if (s < VEH.carLen / 2 + 1) { limitation = `Slagboom ${g.id}: slechts ${i} van ${g.queueSlots} opstelplaatsen passen op de rijstrook (${stopS.toFixed(1)} m beschikbaar).`; break; }
      slotS.push(s);
    }
    if (limitation) validation.push({ level: 'warn', msg: limitation });
    else validation.push({ level: 'info', msg: `Slagboom ${g.id}: ${slotS.length} opstelplaatsen x ${g.slotSpacingM} m, stopstreep op s=${stopS.toFixed(1)} m van ${laneId}` });
    const P = e.line.sample(stopS), t = e.line.tangent(stopS, 1.0), r = rightOf(t);
    // speed limit near the gate (10 km/h)
    for (let i = Math.max(0, Math.floor(stopS - 14)); i < Math.min(e.vmax.length, Math.ceil(stopS + 10)); i++) e.vmax[i] = Math.min(e.vmax[i], 2.8);
    const side = g.armSide === 'right' ? 1 : -1;
    const armPivot = add(P, mul(r, 1.75 * side));
    const crossLen = 3.0;
    const crossingPoly = [add(P, mul(r, -1.5)), add(P, mul(r, 1.5)), add(add(P, mul(r, 1.5)), mul(t, crossLen)), add(add(P, mul(r, -1.5)), mul(t, crossLen))];
    gates.set(g.id, {
      id: g.id, direction: g.direction, staff: !!g.staff, edge: laneId, stopS, crossLen, slotS, slotSpacing: g.slotSpacingM, queueSlots: slotS.length,
      armPivot, armDir: mul(r, -side), armLen: 3.4, laneDir: t, openSec: g.openSec, closeSec: g.closeSec, stopPoint: { x: P.x, y: P.y },
      kiosk: add(add(P, mul(r, 2.1 * side)), mul(t, -1.2)), crossingPoly, limitation, label: g.label ?? g.id,
    });
  }

  // ---- 6. portals
  const portals = new Map<string, Portal>();
  for (const [nid, n] of Object.entries(net.nodes)) {
    if (n.kind !== 'portal') continue;
    const spawn = [...edges.values()].find((e) => e.kind === 'lane' && e.from === nid);
    const despawn = [...edges.values()].find((e) => e.kind === 'lane' && e.to === nid);
    portals.set(nid, { id: nid, node: nid, kind: n.portal ?? 'public', spawnEdge: spawn?.id, despawnEdge: despawn?.id, label: n.label ?? nid });
  }

  // ---- 7. conflict zones
  const zones: Zone[] = [];
  const memberSamples = (e: Edge, s0: number, s1: number) => {
    const out: Vec[] = [];
    for (let s = s0; s <= s1 + 1e-6; s += 0.6) { const p = e.line.sample(s); out.push({ x: p.x, y: p.y }); }
    return out;
  };
  // junction pairwise conflicts
  const conns = [...edges.values()].filter((e) => e.kind === 'connector');
  for (let i = 0; i < conns.length; i++) for (let j = i + 1; j < conns.length; j++) {
    const a = conns[i], b = conns[j];
    if (a.from !== b.from) continue;
    if (a.prev[0] === b.prev[0]) continue; // diverging from the same lane: sequential, handled by car following
    const merge = a.next[0] === b.next[0];
    const ba = a.line.bbox, bb = b.line.bbox;
    const gap = Math.hypot(Math.max(ba.x0 - bb.x1, bb.x0 - ba.x1, 0), Math.max(ba.y0 - bb.y1, bb.y0 - ba.y1, 0));
    if (!merge && gap > TURN_CLEARANCE) continue;
    const dmin = polylineDistance(a.line, b.line);
    // Turning vehicles off-track: a van's body cuts the inside of a bend by up to ~1 m, so two movements whose
    // centre lines stay ~3 m apart still meet when at least one of them turns. Straight opposing traffic may pass.
    const turns = (e: Edge) => { const t0 = e.line.tangent(0, 1), t1 = e.line.tangent(e.line.length, 1); return Math.abs(Math.atan2(cross(t0, t1), t0.x * t1.x + t0.y * t1.y)) > 0.5; };
    if (!merge && dmin > VEH.carWid + 0.6 && !(dmin < TURN_CLEARANCE && (turns(a) || turns(b)))) continue;
    const z: Zone = {
      id: `Z:${a.from}:${zones.length}`, kind: 'junction', node: a.from,
      members: [
        { edge: a.id, s0: 0, s1: a.line.length, stream: a.id, prio: a.priority, samples: memberSamples(a, 0, a.line.length) },
        { edge: b.id, s0: 0, s1: b.line.length, stream: b.id, prio: b.priority, samples: memberSamples(b, 0, b.line.length) },
      ],
      exclusive: new Set([a.id, b.id]),
      approachDir: { [a.id]: a.line.tangent(0, 1), [b.id]: b.line.tangent(0, 1) },
      approachPos: { [a.id]: a.line.sample(0), [b.id]: b.line.sample(0) },
    };
    zones.push(z);
  }
  // parking clusters: one zone per cluster; reverse manoeuvres exclusive
  const byCluster = new Map<string, Stall[]>();
  for (const s of stalls.values()) (byCluster.get(s.clusterId) ?? byCluster.set(s.clusterId, []).get(s.clusterId)!).push(s);
  for (const [cid, sts] of byCluster) {
    const z: Zone = { id: `ZP:${cid}`, kind: 'parking', node: cid, members: [], exclusive: new Set(), approachDir: {}, approachPos: {} };
    const attachPts = sts.flatMap((s) => [s.attachNode, ...s.inEdges.slice(1).map((id) => edges.get(id)!.from)]).map((n) => nodes.get(n)!.pos);
    const near = (p: Vec) => attachPts.some((a) => dist(a, p) < 11);
    // lane members (both directions) around the cluster
    for (const e of edges.values()) {
      if (e.kind !== 'lane') continue;
      if (!attachPts.some((a) => e.line.bboxDist(a) < 11)) continue;
      let s0 = -1, s1 = -1;
      for (let s = 0; s <= e.line.length; s += 0.5) {
        if (near(e.line.sample(s))) { if (s0 < 0) s0 = s; s1 = s; }
      }
      if (s0 < 0) continue;
      const stream = `lane:${e.roadId}:${e.dir}`;
      z.members.push({ edge: e.id, s0, s1, stream, prio: 2, samples: memberSamples(e, s0, s1) });
      z.approachDir[stream] = e.line.tangent(s0, 1);
      z.approachPos[stream] = e.line.sample(s0);
    }
    for (const s of sts) {
      const ie = edges.get(s.inEdge)!, oe = edges.get(s.outEdge)!;
      z.members.push({ edge: ie.id, s0: 0, s1: Math.min(4, ie.line.length), stream: `in:${s.id}`, prio: 1, samples: memberSamples(ie, 0, Math.min(4, ie.line.length)) });
      z.members.push({ edge: oe.id, s0: 0, s1: oe.line.length, stream: `out:${s.id}`, prio: 0, samples: memberSamples(oe, 0, oe.line.length) });
      z.exclusive.add(`out:${s.id}`);
      // crossing the other lane: lowest priority and exclusive, so lane traffic always goes first
      for (const id of s.inEdges.slice(1)) { const e = edges.get(id)!; z.members.push({ edge: id, s0: 0, s1: e.line.length, stream: `xin:${s.id}`, prio: 0, samples: memberSamples(e, 0, e.line.length) }); z.exclusive.add(`xin:${s.id}`); }
      for (const id of s.outEdges.slice(1)) {
        const e = edges.get(id)!; z.members.push({ edge: id, s0: 0, s1: e.line.length, stream: `xrv:${s.id}`, prio: 0, samples: memberSamples(e, 0, e.line.length) }); z.exclusive.add(`xrv:${s.id}`);
        const xo = edges.get(e.next[0] ?? '');
        if (xo) { z.members.push({ edge: xo.id, s0: 0, s1: xo.line.length, stream: `xout:${s.id}`, prio: 0, samples: memberSamples(xo, 0, xo.line.length) }); z.exclusive.add(`xout:${s.id}`); }
      }
    }
    zones.push(z);
  }
  for (const e of edges.values()) {
    if (e.kind !== 'loop') continue;
    zones.push({
      id: `ZL:${e.from}`, kind: 'junction', node: e.from,
      members: [{ edge: e.id, s0: 0, s1: e.line.length, stream: 'loop', prio: 1, samples: memberSamples(e, 0, e.line.length) }],
      exclusive: new Set(['loop']), approachDir: {}, approachPos: {}, single: true,
    });
  }
  const zonesByEdge = new Map<string, { zone: Zone; member: ZoneMember }[]>();
  for (const z of zones) for (const m of z.members) (zonesByEdge.get(m.edge) ?? zonesByEdge.set(m.edge, []).get(m.edge)!).push({ zone: z, member: m });

  // ---- 8. houses (world position, orientation facing the nearest lane)
  const laneEdges = [...edges.values()].filter((e) => e.kind === 'lane' || e.kind === 'loop');
  const houses: HouseInfo[] = sector.houses.map((h) => {
    const pos = toWorld(h.pt);
    let best = { d: Infinity, p: pos };
    for (const e of laneEdges) {
      if (e.line.bboxDist(pos) >= best.d) continue;
      const pr = e.line.project(pos);
      if (pr.d < best.d) { const q = e.line.sample(pr.s); best = { d: pr.d, p: { x: q.x, y: q.y } }; }
    }
    let front = norm(sub(best.p, pos));
    if (best.d > 40) front = { x: 0, y: 1 };
    // snap to the PDF square orientation (rotation mod 90 -> four candidate directions)
    const rot = ((h.pdfRotationDeg ?? 0) * Math.PI) / 180;
    let snap = front, bestDot = h.frontDeg !== undefined ? 2 : -2;
    if (h.frontDeg !== undefined) snap = { x: Math.cos((h.frontDeg * Math.PI) / 180), y: Math.sin((h.frontDeg * Math.PI) / 180) };
    for (let q = 0; q < 4 && h.frontDeg === undefined; q++) {
      const a = rot + (q * Math.PI) / 2;
      const c = { x: Math.cos(a), y: Math.sin(a) };
      const dd = dot(c, front);
      if (dd > bestDot) { bestDot = dd; snap = c; }
    }
    const st = stallsByHouse.get(h.number);
    return {
      id: h.id, number: h.number, legendType: h.legendType, typeConfidence: h.typeConfidence, pos, rotation: Math.atan2(snap.y, snap.x),
      front: snap, petsAllowed: !!h.petsAllowed, focus: !!st, door: add(pos, mul(snap, 4.2)), stallId: st?.id,
    };
  });
  // Keep every bungalow (its real footprint: body, side annex, front patio) clear of road surfaces, junctions,
  // turning circles, parking pads and the other bungalows. Houses are nudged away in small steps; a house that ends
  // up further from its road gets a sand path in the projector. Every shift is reported (artistic adjustment).
  const roadLike = [...edges.values()].filter((e) => (e.kind === 'lane' || e.kind === 'loop' || (e.kind === 'connector' && !e.uturn)));
  const need = (e: Edge) => (e.kind === 'loop' ? 2.7 : 2.4); // lane centre -> road edge (1.5 m) + margin
  const padPolys = [...stalls.values()].map((st) => ({ pts: st.pad, c: mul(st.pad.reduce((q, w) => add(q, w), { x: 0, y: 0 }), 1 / st.pad.length) }));
  const sizes = houses.map((hs, i) => houseSize(hs.legendType, (sector.houses[i] as { footprintPts?: number }).footprintPts ? (sector.houses[i] as { footprintPts?: number }).footprintPts! * k : undefined, hs.number));
  houses.forEach((hs, i) => { const fixed = sector.houses[i].scale; if (fixed) sizes[i].scale = Math.max(0.5, Math.min(1.2, fixed)); hs.scale = sizes[i].scale; });
  const locked = new Set(houses.map((_, i) => i).filter((i) => sector.houses[i].locked));
  const start = houses.map((hs) => ({ ...hs.pos }));
  const fp = (i: number) => houseFootprint(houses[i].pos, houses[i].front, sizes[i], houses[i].number);
  const body = (i: number) => houseFootprint(houses[i].pos, houses[i].front, sizes[i], houses[i].number, { patio: false });
  // candidate roads / pads / neighbours per house, computed once (houses move at most ~15 m)
  const nearEdges = houses.map((hs) => roadLike.filter((e) => e.line.bboxDist(hs.pos) < 30));
  const nearPads = houses.map((hs) => padPolys.filter((pd) => dist(pd.c, hs.pos) < 30));
  const nearHouses = houses.map((hs, i) => houses.map((_, j) => j).filter((j) => j !== i && dist(houses[j].pos, hs.pos) < 30));
  const open = new Set(houses.map((_, i) => i).filter((i) => !locked.has(i)));
  for (let iter = 0; iter < 120 && open.size; iter++) {
    for (const i of [...open]) {
      const f = fp(i);
      const pts = footprintSamples(f, 6, 4);
      let px = 0, py = 0, hit = false;
      const c = { x: f.cx, y: f.cy };
      for (const e of nearEdges[i]) {
        if (e.line.bboxDist(c) > f.hl + f.hw + 3) continue;
        const nd = need(e);
        let pen = 0;
        for (const q of pts) { const d = e.line.project(q).d; if (d < nd) pen = Math.max(pen, nd - d); }
        if (!pen) continue;
        // one decided direction per obstacle, so pushes from both sides never cancel out (a house on a turning circle
        // or straddling a road): out of a turning circle radially, away from a road towards the side the house is on
        let dx: number, dy: number;
        if (e.kind === 'loop') { const nc = nodes.get(e.from)!.pos; dx = c.x - nc.x; dy = c.y - nc.y; }
        else { const on = e.line.sample(e.line.project(c).s); dx = c.x - on.x; dy = c.y - on.y; }
        let l = Math.hypot(dx, dy);
        if (l < 0.2) { dx = -houses[i].front.x; dy = -houses[i].front.y; l = 1; }
        px += (dx / l) * pen; py += (dy / l) * pen; hit = true;
      }
      for (const pd of nearPads[i]) {
        for (const q of pts) if (pointInPolygon(q, pd.pts)) { const dx = f.cx - pd.c.x, dy = f.cy - pd.c.y, l = Math.hypot(dx, dy) || 1; px += dx / l * 0.5; py += dy / l * 0.5; hit = true; }
      }
      const bi = body(i);
      for (const j of nearHouses[i]) {
        if (obbOverlap(bi, body(j), 0.3)) { const dx = houses[i].pos.x - houses[j].pos.x, dy = houses[i].pos.y - houses[j].pos.y, l = Math.hypot(dx, dy) || 1; px += dx / l * (locked.has(j) ? 1.2 : 0.6); py += dy / l * (locked.has(j) ? 1.2 : 0.6); hit = true; if (!locked.has(j)) open.add(j); }
      }
      if (!hit) { open.delete(i); continue; }
      // still squeezed after a long way: make this bungalow a little smaller (never below 0.65)
      if ((dist(houses[i].pos, start[i]) > 9 || iter > 40) && !sector.houses[i].scale && sizes[i].scale > 0.66 && iter % 6 === 5) { sizes[i].scale = Math.max(0.65, sizes[i].scale - 0.05); houses[i].scale = sizes[i].scale; }
      // squeezed between two things that push in opposite directions (road and parking pad): slide sideways
      if (iter > 60) { const sgn = houses[i].number % 2 ? 1 : -1, m = Math.max(0.5, Math.hypot(px, py)); px += -houses[i].front.y * sgn * m; py += houses[i].front.x * sgn * m; }
      const l = Math.hypot(px, py) || 1, step = Math.max(0.15, Math.min(0.5, l));
      houses[i].pos = add(houses[i].pos, { x: (px / l) * step, y: (py / l) * step });
    }
  }
  // last resort for the few that are still squeezed: search rings around the PDF position for the nearest free spot
  const clear = (i: number) => {
    const f = fp(i), pts = footprintSamples(f, 6, 4), bi = body(i);
    if (nearEdges[i].some((e) => e.line.bboxDist({ x: f.cx, y: f.cy }) <= f.hl + f.hw + 3 && pts.some((q) => e.line.project(q).d < need(e)))) return false;
    if (nearPads[i].some((pd) => pts.some((q) => pointInPolygon(q, pd.pts)))) return false;
    return !nearHouses[i].some((j) => obbOverlap(bi, body(j), 0.3));
  };
  for (const i of [...open]) {
    found: for (let r = 1; r <= 18; r++) for (let a = 0; a < 24; a++) {
      const th = (a / 24) * Math.PI * 2;
      houses[i].pos = { x: start[i].x + Math.cos(th) * r, y: start[i].y + Math.sin(th) * r };
      if (clear(i)) { open.delete(i); break found; }
    }
    if (open.has(i)) houses[i].pos = start[i];
  }
  houses.forEach((hs, i) => {
    const moved = dist(hs.pos, start[i]);
    if (moved > 0.3) hs.adjusted = `${moved.toFixed(1)} m verschoven zodat het huis vrij van weg, kruising, parkeervak en buren staat`;
    // the door: front edge of the patio (bungalows) or just in front of the facade (villas)
    hs.door = add(hs.pos, mul(hs.front, sizes[i].doorM * sizes[i].scale));
  });
  for (const i of open) {
    // diagnose what still blocks the house
    const f = fp(i), pts = footprintSamples(f, 6, 4);
    const roadsHit = nearEdges[i].filter((e) => pts.some((q) => e.line.project(q).d < need(e))).map((e) => e.id);
    const padsHit = nearPads[i].filter((pd) => pts.some((q) => pointInPolygon(q, pd.pts))).length;
    const housesHit = nearHouses[i].filter((j) => obbOverlap(body(i), body(j), 0.3)).map((j) => houses[j].number);
    validation.push({ level: 'warn', msg: `Huis ${houses[i].number}: geen vrije plek gevonden (weg: ${roadsHit.slice(0, 3).join(',') || '-'}; vakken: ${padsHit}; buren: ${housesHit.join(',') || '-'})` });
  }
  for (const i of locked) if (!clear(i)) validation.push({ level: 'warn', msg: `Huis ${houses[i].number}: met de hand vastgezet, maar raakt een weg, parkeervak of buurhuis` });
  for (const hs of houses) if (hs.adjusted) validation.push({ level: 'info', msg: `Huis ${hs.number}: ${hs.adjusted}` });

  // ---- 9. validation of the graph
  for (const e of edges.values()) {
    if (e.next.length === 0 && !e.to.startsWith('P_') && e.kind !== 'driveway' && e.cls !== 'scenery')
      validation.push({ level: 'warn', msg: `Rijstrook ${e.id} heeft geen vervolg (doodlopend zonder keerlus)` });
  }
  const viewW = (sector.viewPts[2] - sector.viewPts[0]) * k, viewH = (sector.viewPts[3] - sector.viewPts[1]) * k;
  return { edges, nodes, zones, zonesByEdge, stalls, stallsByHouse, gates, portals, roads, islands, houses, toWorld, bounds: { w: viewW, h: viewH }, validation };
}

/** The public entrance where visitors arrive and leave (the first public portal of the map). */
export function visitorPortal(net: Pick<Network, 'portals'>): string {
  return [...net.portals.values()].filter((p) => p.kind === 'public').map((p) => p.id).sort()[0] ?? '';
}

/** Dijkstra over legal directed edges. Returns the list of edge ids from `fromEdge` (inclusive) to `toEdge` (inclusive). */
export function findRoute(net: Network, fromEdge: string, toEdge: string, kind: 'visitor' | 'service', opts: { uturn?: boolean } = {}): string[] | null {
  // service vehicles avoid visitor barriers: a visitor barrier costs 20 km extra, so their own service roads (with
  // a staff barrier where needed) always win where one exists, however long the detour (Harderwold: ~2 km)
  const gateEdges = new Set([...net.gates.values()].filter((g) => !g.staff).map((g) => g.edge));
  const allowed = (e: Edge) => (kind === 'visitor' ? e.visitor : e.service);
  const distM = new Map<string, number>([[fromEdge, 0]]);
  const prev = new Map<string, string>();
  const open = new MinHeap<string>();
  open.push(0, fromEdge);
  const done = new Set<string>();
  while (open.size) {
    const [d, id] = open.pop()!;
    if (done.has(id)) continue;
    done.add(id);
    if (id === toEdge) break;
    const e = net.edges.get(id)!;
    for (const nid of e.next) {
      const n = net.edges.get(nid)!;
      if (!allowed(n) && nid !== toEdge) continue;
      // never route through somebody's driveway/reverse unless it is the destination or origin
      if ((n.kind === 'driveway') && nid !== toEdge) continue;
      if (n.kind === 'reverse') continue;
      if (n.uturn && !opts.uturn) continue;
      const nd = d + e.line.length + (kind === 'service' && gateEdges.has(nid) ? 20000 : 0);
      if (nd < (distM.get(nid) ?? Infinity)) { distM.set(nid, nd); prev.set(nid, id); open.push(nd, nid); }
    }
  }
  if (!done.has(toEdge)) return null;
  const path = [toEdge];
  while (path[0] !== fromEdge) { const p = prev.get(path[0]); if (!p) return null; path.unshift(p); }
  return path;
}

/** Binary min-heap keyed by number (Dijkstra open set). */
class MinHeap<T> {
  private k: number[] = []; private v: T[] = [];
  get size() { return this.k.length; }
  push(key: number, val: T) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop(): [number, T] | undefined {
    const k = this.k, v = this.v; if (!k.length) return undefined;
    const top: [number, T] = [k[0], v[0]]; const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      let i = 0; const n = k.length;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i, mk = lk;
        if (l < n && k[l] < mk) { m = l; mk = k[l]; } if (r < n && k[r] < mk) { m = r; mk = k[r]; }
        if (m === i) break; k[i] = k[m]; v[i] = v[m]; i = m; }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}
