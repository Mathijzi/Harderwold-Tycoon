// Server-authoritative traffic simulation: fixed-step, deterministic, collision-safe.
// Vehicles move ONLY forward along legal directed edges (reverse manoeuvres are explicit edges).
// Barriers open ONLY when the authorizer (backed by completed check-in/check-out tasks) hands out
// a single-use passage token for the exact vehicle at the head of that gate's queue.
import { Network, Edge, Zone, ZoneMember, GateDef, findRoute, VEH } from './network.ts';
import { OBB, obbOverlap, Vec, rng, Rng, cross, dist, clamp } from '../shared/geom.ts';

export type VehKind = 'visitor' | 'service';
export type Model = 'hatch' | 'suv' | 'wagon' | 'van' | 'cart' | 'golfcart';
export interface VehicleSpec { id: string; kind: VehKind; model: Model; len: number; wid: number; color: string; plate: string; label?: string }

export type Mission =
  | { type: 'arrive'; bookingId: string; stallId: string; gateId: string }
  | { type: 'depart'; bookingId: string; stallId: string; gateId: string; portal: string }
  | { type: 'service'; job: 'patrol' | 'clean' | 'repair' | 'return'; stallId?: string; dwellSec?: number; exitPortal: string; houseNumber?: number; taskId?: string };

export type VehState = 'buffer' | 'driving' | 'parked' | 'dwell' | 'despawned';

export interface Vehicle {
  spec: VehicleSpec;
  state: VehState;
  mission: Mission;
  route: string[];
  cum: number[];
  ri: number;
  /** arc length of the vehicle CENTRE on route[ri] */
  s: number;
  v: number;
  a: number;
  x: number; y: number; heading: number;
  grants: Record<string, { since: number; entered: boolean }>;
  /** atGate: first in line and standing at the stop line (only then a check-in/check-out is requested) */
  queue?: { gateId: string; slot: number; atGate?: boolean };
  passedGates: string[];
  waitStart?: number;
  dwellUntil?: number;
  switchUntil?: number;
  signal: number;
  brake: boolean;
  spawnedAt: number;
  /** guests still walking to/from the car (departure waits until boarded) */
  boarding?: number;
  lastWaitReason?: string;
  /** driving slowly back into its own stall after a blocked reverse-out manoeuvre */
  retreat?: boolean;
  /** out-manoeuvres of the stall not to use again for a while (edge id -> until sim time) */
  avoidOut?: Record<string, number>;
}

export type GatePhase = 'CLOSED' | 'OPENING' | 'OPEN' | 'CLOSING';
export interface GateState {
  id: string; phase: GatePhase; since: number; authorizedVehicle?: string; passageId?: string;
  queue: string[]; passedFront: boolean; lastEvent?: string;
}

export interface Pedestrian {
  id: string; bookingId?: string; name: string; color: string; path: Vec[]; i: number; x: number; y: number; heading: number;
  speed: number; state: 'walking' | 'waiting' | 'done'; purpose: 'to_house' | 'to_car' | 'clean_in' | 'clean_out' | 'tech_in' | 'tech_out'; vehicleId?: string; wait?: number;
}

export interface TrafficHooks {
  /** Called when a vehicle joins a gate queue (create/link the check-in or check-out task). */
  onQueued?(veh: Vehicle, gate: GateDef, slot: number): void;
  /** the vehicle is first in line and stands at the stop line of the barrier */
  onAtGate?(veh: Vehicle, gate: GateDef): void;
  /** Return a passage id if a valid, unused token exists for (vehicle, gate) and consume it atomically. */
  consumeToken(vehicleId: string, gateId: string): string | null;
  onPassageDone?(passageId: string, status: 'completed' | 'aborted'): void;
  /** Staff pass ("dienstpas") for a SERVICE vehicle at the head of a gate queue: the backend issues and logs a passage.
   *  Never used for visitors - their barrier only opens on a completed check-in/check-out token. */
  servicePass?(vehicleId: string, gateId: string): string | null;
  onParked?(veh: Vehicle): void;
  onExited?(veh: Vehicle): void;
  onPedestrianDone?(p: Pedestrian): void;
  onEvent?(type: string, payload: Record<string, unknown>): void;
}

export interface TrafficStats {
  ticks: number;
  collisions: number;
  illegalGateCrossings: number;
  wrongWay: number;
  failsafeInterventions: number;
  hardGateStops: number;
  maxQueue: Record<string, number>;
  gateCycles: Record<string, number>;
  minHeadway: number;
  publicRoadStopSeconds: number;
  log: string[];
}

const P = {
  aMax: 1.4, bComf: 2.0, bMax: 7.0, T: 1.3, s0: 2.2, s0Stop: 0.35, s0Ped: 2.6,
  gapTime: 5.0, gapTimeEq: 3.5, grantTimeout: 15, reqMin: 8, look: 34, dt: 0.05,
};

export interface TrafficSnapshot {
  t: number;
  vehicles: { id: string; kind: VehKind; model: Model; color: string; label?: string; job?: string; x: number; y: number; h: number; v: number; brake: boolean; signal: number; reverse: boolean; state: VehState; len: number; wid: number }[];
  gates: { id: string; phase: GatePhase; since: number; authorizedVehicle?: string; queue: string[]; openSec: number; closeSec: number }[];
  pedestrians: { id: string; x: number; y: number; h: number; walking: boolean; color: string }[];
}

export class TrafficSim {
  net: Network;
  t = 0;
  vehicles: Vehicle[] = [];
  gates = new Map<string, GateState>();
  peds: Pedestrian[] = [];
  buffer: { spec: VehicleSpec; mission: Mission; portal: string; readyAt: number }[] = [];
  stats: TrafficStats;
  hooks: TrafficHooks;
  rand: Rng;
  private pedSeq = 0;
  private intents = new Map<string, { veh: Vehicle; stream: string; prio: number; entry: number; eta: number; granted: boolean }[]>();

  constructor(net: Network, hooks: TrafficHooks, seed = 1) {
    this.net = net;
    this.hooks = hooks;
    this.rand = rng(seed);
    for (const g of net.gates.values()) this.gates.set(g.id, { id: g.id, phase: 'CLOSED', since: 0, queue: [], passedFront: false });
    this.stats = { ticks: 0, collisions: 0, illegalGateCrossings: 0, wrongWay: 0, failsafeInterventions: 0, hardGateStops: 0, maxQueue: {}, gateCycles: {}, minHeadway: Infinity, publicRoadStopSeconds: 0, log: [] };
  }

  // ------------------------------------------------------------------ helpers
  edge(id: string): Edge { const e = this.net.edges.get(id); if (!e) throw new Error(`unknown edge ${id}`); return e; }
  private setRoute(v: Vehicle, route: string[], s: number) {
    v.route = route; v.ri = 0; v.s = s; v.cum = [];
    let c = 0; for (const id of route) { v.cum.push(c); c += this.edge(id).line.length; }
  }
  pathPos(v: Vehicle) { return v.cum[v.ri] + v.s; }
  /** sample a point at absolute path distance d along v.route */
  pathSample(v: Vehicle, d: number) {
    let j = v.ri;
    while (j < v.route.length - 1 && d > v.cum[j] + this.edge(v.route[j]).line.length) j++;
    while (j > 0 && d < v.cum[j]) j--;
    const e = this.edge(v.route[j]);
    const s = d - v.cum[j];
    const p = e.line.sample(s);
    const t = e.line.tangent(clamp(s, 0, e.line.length), 0.6);
    return { x: p.x, y: p.y, tx: t.x, ty: t.y, edge: e, j, s };
  }
  pathEnd(v: Vehicle) { return v.cum[v.route.length - 1] + this.edge(v.route[v.route.length - 1]).line.length; }
  obbOf(v: Vehicle, x = v.x, y = v.y, h = v.heading): OBB {
    return { cx: x, cy: y, ux: Math.cos(h), uy: Math.sin(h), hl: v.spec.len / 2, hw: v.spec.wid / 2 };
  }
  private pose(v: Vehicle) {
    const e = this.edge(v.route[v.ri]);
    const p = e.line.sample(v.s);
    const t = e.line.tangent(clamp(v.s, 0, e.line.length), 0.7);
    let h = Math.atan2(t.y, t.x);
    if (e.reverseMotion) h += Math.PI;
    return { x: p.x, y: p.y, h };
  }
  log(msg: string) { this.stats.log.push(`[t=${this.t.toFixed(1)}] ${msg}`); if (this.stats.log.length > 400) this.stats.log.shift(); }
  emit(type: string, payload: Record<string, unknown>) { this.hooks.onEvent?.(type, { ...payload, simTime: +this.t.toFixed(2) }); }

  /** Number of vehicles that will still need the given gate (spawned, not yet passed) plus buffered ones dispatched to it. */
  gateReservations(gateId: string): number {
    let n = 0;
    for (const v of this.vehicles) if (v.state !== 'despawned' && 'gateId' in v.mission && v.mission.gateId === gateId && !v.passedGates.includes(gateId) && v.state !== 'parked') n++;
    return n;
  }

  // ------------------------------------------------------------------ spawning
  /** Queue an arrival in the abstract off-screen approach buffer. It is released only when the inbound queue has room. */
  enqueueArrival(spec: VehicleSpec, mission: Mission, portal: string, readyAt = this.t) {
    this.buffer.push({ spec, mission, portal, readyAt });
    this.emit('vehicle.buffered', { vehicleId: spec.id, bookingId: 'bookingId' in mission ? mission.bookingId : undefined });
  }

  private trySpawnFromBuffer() {
    for (let i = 0; i < this.buffer.length; i++) {
      const b = this.buffer[i];
      if (b.readyAt > this.t) continue;
      const portal = this.net.portals.get(b.portal);
      if (!portal?.spawnEdge) continue;
      if ('gateId' in b.mission) {
        const g = this.net.gates.get(b.mission.gateId)!;
        if (this.gateReservations(g.id) >= g.queueSlots) continue; // hold off-screen: queue capacity reached
      }
      const route = this.planBest([portal.spawnEdge], this.destinations(b.mission), b.mission, b.spec);
      if (!route) { this.log(`geen legale route voor ${b.spec.id} vanaf ${b.portal}; wacht buiten beeld`); continue; }
      // spawn point must be clear
      const veh = this.makeVehicle(b.spec, b.mission, route, b.spec.len / 2 + 0.5);
      const box = this.obbOf(veh);
      if (this.vehicles.some((o) => o.state !== 'despawned' && dist(o, veh) < 14 && obbOverlap(box, this.obbOf(o), 2.0))) continue;
      this.buffer.splice(i, 1); i--;
      this.vehicles.push(veh);
      this.emit('vehicle.arrived', { vehicleId: veh.spec.id, kind: veh.spec.kind, portal: b.portal, bookingId: 'bookingId' in b.mission ? b.mission.bookingId : undefined });
      // only one spawn per portal per tick
      break;
    }
  }

  private makeVehicle(spec: VehicleSpec, mission: Mission, route: string[], s: number): Vehicle {
    const v: Vehicle = {
      spec, state: 'driving', mission, route: [], cum: [], ri: 0, s: 0, v: 0, a: 0, x: 0, y: 0, heading: 0,
      grants: {}, passedGates: [], signal: 0, brake: false, spawnedAt: this.t,
    };
    this.setRoute(v, route, s);
    const p = this.pose(v); v.x = p.x; v.y = p.y; v.heading = p.h;
    v.v = 3.0;
    return v;
  }

  /** Shortest legal route; a visitor mission with a gate is routed THROUGH that gate (the park has two accesses). */
  planRoute(from: string, to: string, m: Mission, spec: VehicleSpec): string[] | null {
    const opts = { uturn: spec.model === 'golfcart' };
    const gate = 'gateId' in m ? this.net.gates.get(m.gateId) : undefined;
    if (!gate) return findRoute(this.net, from, to, spec.kind, opts);
    const a = findRoute(this.net, from, gate.edge, spec.kind, opts);
    const b = a ? findRoute(this.net, gate.edge, to, spec.kind, opts) : null;
    return a && b ? [...a, ...b.slice(1)] : null;
  }
  routeLength(route: string[]) { return route.reduce((n, id) => n + this.edge(id).line.length, 0); }

  /** possible final edges: every way into the stall (from this side or turning in from the opposite lane), or the exit */
  private destinations(m: Mission): string[] {
    const stall = (id: string) => this.net.stalls.get(id)?.inEdges ?? [];
    const exit = (id: string) => { const e = this.net.portals.get(id)?.despawnEdge; return e ? [e] : []; };
    if (m.type === 'arrive') return stall(m.stallId);
    if (m.type === 'depart') return exit(m.portal);
    if (m.type === 'service') return m.stallId ? stall(m.stallId) : exit(m.exitPortal);
    return [];
  }
  /** shortest legal route over all start / end alternatives (e.g. leaving a stall to the left or to the right) */
  planBest(froms: string[], tos: string[], m: Mission, spec: VehicleSpec): string[] | null {
    let best: string[] | null = null, bestLen = Infinity;
    for (const f of froms) for (const t of tos) {
      const r = this.planRoute(f, t, m, spec);
      if (!r) continue;
      const len = this.routeLength(r);
      if (len < bestLen) { best = r; bestLen = len; }
    }
    return best;
  }

  /** Place a vehicle already parked in a stall (initial occupancy / restore). */
  placeParked(spec: VehicleSpec, mission: Mission, stallId: string): Vehicle {
    const st = this.net.stalls.get(stallId)!;
    const v = this.makeVehicle(spec, mission, [st.inEdge], st.parkS);
    v.v = 0; v.state = 'parked';
    this.vehicles.push(v);
    return v;
  }

  stallOccupant(stallId: string): Vehicle | undefined {
    const st = this.net.stalls.get(stallId)!;
    const ins = st.inEdges, outs = st.outEdges;
    return this.vehicles.find((v) => v.state !== 'despawned' && (v.route.some((e) => ins.includes(e)) || outs.includes(v.route[v.ri])) &&
      (v.state === 'parked' || v.state === 'dwell' || ins.includes(v.route[v.ri]) || outs.includes(v.route[v.ri]) || ins.includes(v.route[v.route.length - 1])));
  }

  /** Start a departure for a parked vehicle. Waits (parked) until the outbound queue has capacity. */
  requestDeparture(vehicleId: string, mission: Mission): boolean {
    const v = this.vehicles.find((x) => x.spec.id === vehicleId);
    if (!v || v.state !== 'parked') return false;
    v.mission = mission;
    (v as Vehicle & { departPending?: boolean }).departPending = true;
    return true;
  }

  /** does a parked / dwelling vehicle stand in the swept path of this out-manoeuvre (first 14 m)? */
  private outBlocked(v: Vehicle, edgeId: string) {
    const e = this.edge(edgeId);
    const others = this.vehicles.filter((o) => o !== v && (o.state === 'parked' || o.state === 'dwell') && Math.abs(o.x - v.x) < 25 && Math.abs(o.y - v.y) < 25);
    if (!others.length) return false;
    const st = e.stallId ? this.net.stalls.get(e.stallId) : undefined;
    for (let s0 = st && e.kind === 'reverse' ? st.parkBack : 0; s0 <= Math.min(e.line.length, 14); s0 += 0.5) {
      const p = e.line.sample(s0), t = e.line.tangent(clamp(s0, 0, e.line.length), 0.7);
      const h = Math.atan2(t.y, t.x) + (e.reverseMotion ? Math.PI : 0);
      const box = this.obbOf(v, p.x, p.y, h);
      if (others.some((o) => obbOverlap(box, this.obbOf(o), 0.1))) return true;
    }
    return false;
  }

  private startPendingDepartures() {
    for (const v of this.vehicles as (Vehicle & { departPending?: boolean })[]) {
      if (!v.departPending || v.state !== 'parked' || (v.boarding ?? 0) > 0) continue;
      const m = v.mission;
      if ('gateId' in m) {
        const g = this.net.gates.get(m.gateId)!;
        if (this.gateReservations(g.id) >= g.queueSlots) { v.lastWaitReason = 'uitgaande wachtrij vol'; continue; }
      }
      const curEdge = this.edge(v.route[v.ri]);
      const st = curEdge.stallId ? this.net.stalls.get(curEdge.stallId)! : null;
      if (!st) continue;
      // only out-manoeuvres that a parked vehicle does not block (and not one that just failed)
      const outs = st.outEdges.filter((id) => !((v.avoidOut?.[id] ?? 0) > this.t) && !this.outBlocked(v, id));
      if (!outs.length) { v.lastWaitReason = 'uitrijbaan geblokkeerd'; continue; }
      const route = this.planBest(outs, this.destinations(m), m, v.spec);
      if (!route) { v.lastWaitReason = 'geen legale route'; continue; }
      const sOnRev = st.parkBack;
      v.departPending = false;
      this.setRoute(v, route, sOnRev);
      v.state = 'driving';
      v.v = 0;
      v.switchUntil = this.t + 1.0;
      this.emit('vehicle.departing', { vehicleId: v.spec.id, bookingId: 'bookingId' in m ? m.bookingId : undefined, stallId: st.id });
    }
  }

  // ------------------------------------------------------------------ main step
  step(dt = P.dt) {
    this.t += dt;
    this.stats.ticks++;
    this.trySpawnFromBuffer();
    this.startPendingDepartures();
    this.collectIntents();
    const active = this.vehicles.filter((v) => v.state === 'driving' || v.state === 'dwell');
    for (const v of active) this.stepVehicle(v, dt);
    this.stepGates();
    this.stepPedestrians(dt);
    this.monitor(dt);
    this.vehicles = this.vehicles.filter((v) => v.state !== 'despawned');
  }

  // upcoming zone members along the path within the horizon
  private upcomingMembers(v: Vehicle, horizon: number) {
    const pos = this.pathPos(v);
    const out: { zone: Zone; member: ZoneMember; entry: number; exit: number; j: number }[] = [];
    for (let j = v.ri; j < v.route.length; j++) {
      if (v.cum[j] - pos > horizon) break;
      const list = this.net.zonesByEdge.get(v.route[j]);
      if (!list) continue;
      for (const { zone, member } of list) {
        const entry = v.cum[j] + member.s0, exit = v.cum[j] + member.s1;
        if (exit + v.spec.len / 2 < pos) continue; // completely behind
        out.push({ zone, member, entry, exit, j });
      }
    }
    out.sort((a, b) => a.entry - b.entry);
    return out;
  }

  private collectIntents() {
    this.intents.clear();
    for (const v of this.vehicles) {
      if (v.state !== 'driving') continue;
      const pos = this.pathPos(v), lead = pos + v.spec.len / 2;
      for (const u of this.upcomingMembers(v, 45)) {
        const key = `${u.zone.id}|${u.member.stream}`;
        const entryDist = u.entry - lead;
        const list = this.intents.get(u.zone.id) ?? this.intents.set(u.zone.id, []).get(u.zone.id)!;
        if (list.some((x) => x.veh === v && x.stream === u.member.stream)) continue;
        list.push({ veh: v, stream: u.member.stream, prio: u.member.prio, entry: entryDist, eta: entryDist / Math.max(v.v, 0.5), granted: !!v.grants[key] });
      }
    }
  }

  private conflicts(z: Zone, a: string, b: string) { return a !== b && (z.exclusive.has(a) || z.exclusive.has(b)); }

  private occupies(v: Vehicle, m: ZoneMember, margin = 0.9): boolean {
    const b = this.obbOf(v);
    const hl = b.hl + margin, hw = b.hw + margin;
    for (const p of m.samples) {
      const dx = p.x - b.cx, dy = p.y - b.cy;
      if (Math.abs(dx * b.ux + dy * b.uy) <= hl && Math.abs(-dx * b.uy + dy * b.ux) <= hw) return true;
    }
    return false;
  }

  private canGrant(v: Vehicle, z: Zone, stream: string, prio: number, myEntry: number): { ok: boolean; why?: string } {
    // 1. nobody may hold a conflicting stream
    for (const o of this.vehicles) {
      if (o === v || o.state === 'despawned') continue;
      // a grant its holder cannot use because it stands still behind ME is no reason to wait (deadlock breaker:
      // it is waiting for me to clear the way; physical clearance is still checked by the swept-path test)
      if (o.v < 0.05 && o.waitStart !== undefined && this.t - o.waitStart > 4 && this.waitsOn(o, v)) continue;
      for (const key of Object.keys(o.grants)) {
        const [zid, st] = splitKey(key);
        if (zid === z.id && (z.single || this.conflicts(z, st, stream))) return { ok: false, why: `wacht op ${o.spec.id}` };
      }
    }
    // 2. right-of-way against vehicles that are about to use a conflicting stream
    const waited = v.waitStart !== undefined ? this.t - v.waitStart : 0;
    const mine = z.approachDir[stream], myPos = z.approachPos[stream];
    for (const it of this.intents.get(z.id) ?? []) {
      if (it.veh === v || it.granted || !this.conflicts(z, it.stream, stream)) continue;
      const o = it.veh;
      const stopDist = (o.v * o.v) / (2 * 4.0) + 1.0;
      if (o.v > 1.2 && it.entry < stopDist && it.entry > -o.spec.len) return { ok: false, why: `${o.spec.id} kan niet meer stoppen` };
      if (it.prio > prio && it.eta < P.gapTime && waited < 30) return { ok: false, why: `voorrang voor ${o.spec.id}` };
      if (it.prio === prio && it.eta < P.gapTimeEq && waited < 12) {
        const od = z.approachDir[it.stream], op = z.approachPos[it.stream];
        if (mine && od && myPos && op) {
          // o comes from my right if its approach position lies to my right
          const rel = { x: op.x - myPos.x, y: op.y - myPos.y };
          const fromRight = cross(mine, rel) > 0.5;
          if (fromRight) return { ok: false, why: `rechts heeft voorrang (${o.spec.id})` };
          if (Math.abs(cross(mine, rel)) <= 0.5 && o.spec.id < v.spec.id && it.entry < myEntry) return { ok: false, why: `eerst ${o.spec.id}` };
        }
      }
    }
    return { ok: true };
  }

  private stepVehicle(v: Vehicle, dt: number) {
    const e0 = this.edge(v.route[v.ri]);
    const pos = this.pathPos(v);
    const L = v.spec.len;
    const lead = pos + L / 2;
    const end = this.pathEnd(v);
    let aMin = Infinity;
    let why = '';
    const idm = (gap: number, vObj: number, s0: number, label: string) => {
      const vv = v.v;
      const sStar = s0 + Math.max(0, vv * P.T + (vv * (vv - vObj)) / (2 * Math.sqrt(P.aMax * P.bComf)));
      const a = gap <= 0.02 ? -P.bMax : -P.aMax * (sStar / gap) ** 2;
      if (a < aMin) { aMin = a; why = label; }
    };

    if (v.state === 'dwell') {
      if (v.dwellUntil !== undefined && this.t >= v.dwellUntil) this.finishDwell(v);
      return;
    }
    // gear change pause (stopped)
    if (v.switchUntil !== undefined && this.t < v.switchUntil) { v.v = 0; v.a = 0; v.brake = true; return; }
    // stuck while reversing out of a stall behind a vehicle that has parked in the way: pull slowly back into the
    // own stall along the same path (no teleport) and pick another way out
    if (v.retreat || (e0.kind === 'reverse' && e0.stallId && v.ri === 0 && v.v < 0.05 && v.waitStart !== undefined && this.t - v.waitStart > 6 && this.blockedByParked(v))) {
      const st = this.net.stalls.get(e0.stallId!)!;
      if (!v.retreat) { v.retreat = true; v.switchUntil = this.t + 0.9; this.log(`${v.spec.id} rijdt terug het vak in (uitrijden geblokkeerd)`); return; }
      const sNew = Math.max(st.parkBack, v.s - 0.8 * dt);
      const old = v.s; v.s = sNew;
      const p = this.pose(v);
      const box = this.obbOf(v, p.x, p.y, p.h);
      if (this.vehicles.some((o) => o !== v && o.state !== 'despawned' && o.state !== 'buffer' && Math.abs(o.x - p.x) < 12 && Math.abs(o.y - p.y) < 12 && obbOverlap(box, this.obbOf(o), 0.05))) { v.s = old; v.v = 0; return; }
      v.x = p.x; v.y = p.y; v.heading = p.h; v.v = 0.8; v.brake = false; v.lastWaitReason = 'terug het vak in';
      if (v.s <= st.parkBack + 1e-6) {
        v.retreat = false; v.v = 0; v.state = 'parked'; v.waitStart = undefined;
        v.avoidOut = { ...(v.avoidOut ?? {}), [e0.id]: this.t + 120 };
        for (const k of Object.keys(v.grants)) delete v.grants[k];
        (v as Vehicle & { departPending?: boolean }).departPending = true;
      }
      return;
    }
    // explicit manoeuvre end: stopped at the end of an edge whose successor has the opposite motion direction
    if (v.ri < v.route.length - 1 && v.s >= e0.line.length - 0.02 && this.edge(v.route[v.ri + 1]).reverseMotion !== e0.reverseMotion) {
      v.ri++; v.s = 0; v.v = 0; v.switchUntil = this.t + 0.9;
      return;
    }

    // --- desired speed with braking-feasible look-ahead of the speed profile
    let v0 = Infinity;
    for (let x = 0; x <= Math.min(P.look, end - pos + 1); x += 1.0) {
      const sm = this.pathSample(v, pos + x);
      const vm = sm.edge.vmax[Math.max(0, Math.min(sm.edge.vmax.length - 1, Math.round(sm.s)))];
      const allowed = Math.sqrt(vm * vm + 2 * P.bComf * Math.max(0, x - 2));
      if (allowed < v0) v0 = allowed;
    }
    v0 = Math.max(0.6, v0);
    const aFree = P.aMax * (1 - (v.v / v0) ** 4);

    // --- direction switch at the end of a reverse edge: stop exactly at the node
    if (v.ri < v.route.length - 1) {
      const nxt = this.edge(v.route[v.ri + 1]);
      if (nxt.reverseMotion !== e0.reverseMotion) {
        const endCentre = v.cum[v.ri] + e0.line.length;
        idm(endCentre - pos + 0.05, 0, 0.05, 'richtingswissel');
      }
    }
    // --- destination
    const finalEdge = this.edge(v.route[v.route.length - 1]);
    let destCentre: number | null = null;
    if (finalEdge.kind === 'driveway') {
      const st = this.net.stalls.get(finalEdge.stallId!)!;
      destCentre = v.cum[v.route.length - 1] + finalEdge.line.length - st.parkBack;
      idm(destCentre - pos + P.s0Stop, 0, P.s0Stop, 'bestemming');
    }

    // --- gates on the route
    for (const g of this.net.gates.values()) {
      const j = v.route.indexOf(g.edge, v.ri);
      if (j < 0 || v.passedGates.includes(g.id)) continue;
      const gs = this.gates.get(g.id)!;
      const stopAbs = v.cum[j] + g.stopS;
      const authorized = gs.phase === 'OPEN' && gs.authorizedVehicle === v.spec.id;
      if (!authorized) {
        if (lead <= stopAbs + 0.3) idm(stopAbs - lead, 0, P.s0Stop, `slagboom ${g.id} dicht`);
        // queue slot target
        if (v.queue && v.queue.gateId === g.id) {
          const slotCentre = v.cum[j] + g.slotS[Math.min(v.queue.slot, g.slotS.length - 1)];
          idm(slotCentre - pos + P.s0Stop, 0, P.s0Stop, `wachtrij plek ${v.queue.slot + 1}`);
        }
      }
    }

    // --- vehicles and pedestrians ahead (swept footprint along the path)
    const sweep = this.sweep(v, pos, Math.min(P.look, end - pos + L));
    // --- conflict zones (only the first vehicle in line may request: a follower never holds a grant it cannot use)
    const members = this.upcomingMembers(v, 45);
    const reqDist = Math.max(P.reqMin, (v.v * v.v) / (2 * P.bComf) + 6);
    const pending: Map<string, { zone: Zone; member: ZoneMember; entry: number; j: number }[]> = new Map();
    for (const u of members) {
      const key = `${u.zone.id}|${u.member.stream}`;
      if (v.grants[key]) continue;
      const entryLead = u.entry - lead;
      if (entryLead > reqDist) continue;
      if (sweep && !sweep.ped && sweep.gap < entryLead - 0.3) continue;
      const gkey = `${u.j}`;
      (pending.get(gkey) ?? pending.set(gkey, []).get(gkey)!).push(u);
    }
    // try to obtain grants edge by edge, in path order
    const groups = [...pending.values()].sort((a, b) => a[0].entry - b[0].entry);
    for (const grp of groups) {
      let ok = true, reason = '';
      for (const u of grp) {
        const r = this.canGrant(v, u.zone, u.member.stream, u.member.prio, u.entry - lead);
        if (!r.ok) { ok = false; reason = r.why ?? ''; break; }
      }
      // don't block the box: the exit of a junction connector must have room
      if (ok) {
        const ej = this.edge(v.route[grp[0].j]);
        if (ej.kind === 'connector') {
          const exitCentre = v.cum[grp[0].j] + ej.line.length + L / 2 + 1.5;
          if (exitCentre < end && this.blockedAt(v, exitCentre)) { ok = false; reason = 'uitgang kruising bezet'; }
        }
      }
      if (ok) {
        for (const u of grp) v.grants[`${u.zone.id}|${u.member.stream}`] = { since: this.t, entered: false };
      } else {
        const entryLead = Math.min(...grp.map((u) => u.entry)) - lead;
        idm(entryLead - 0.6, 0, P.s0Stop, reason || 'voorrang');
        break;
      }
    }

    if (sweep) idm(sweep.gap, sweep.vObj, sweep.ped ? P.s0Ped : P.s0, sweep.label);

    let a = Math.min(aFree, aMin === Infinity ? aFree : aFree + aMin);
    if (aMin !== Infinity && aFree + aMin < a) a = aFree + aMin;
    a = clamp(a, -P.bMax, P.aMax);
    let vNew = Math.max(0, v.v + a * dt);
    let ds = ((v.v + vNew) / 2) * dt;
    // never overshoot a hard stop (closed gate / destination)
    for (const g of this.net.gates.values()) {
      const j = v.route.indexOf(g.edge, v.ri);
      if (j < 0 || v.passedGates.includes(g.id)) continue;
      const gs = this.gates.get(g.id)!;
      if (gs.phase === 'OPEN' && gs.authorizedVehicle === v.spec.id) continue;
      const stopAbs = v.cum[j] + g.stopS;
      if (lead <= stopAbs && lead + ds > stopAbs - 0.02) {
        ds = Math.max(0, stopAbs - 0.02 - lead); vNew = 0;
        if (v.v > 0.5) { this.stats.hardGateStops++; this.log(`harde stop voor ${g.id}: ${v.spec.id} v=${v.v.toFixed(2)}`); }
      }
    }
    if (destCentre !== null && pos + ds > destCentre) { ds = Math.max(0, destCentre - pos); vNew = 0; }
    if (v.ri < v.route.length - 1 && this.edge(v.route[v.ri + 1]).reverseMotion !== e0.reverseMotion) {
      const endCentre = v.cum[v.ri] + e0.line.length;
      if (pos + ds > endCentre) { ds = Math.max(0, endCentre - pos); vNew = 0; }
    }

    // --- tentative move + failsafe geometric check
    const oldRi = v.ri, oldS = v.s;
    this.advance(v, ds);
    const p = this.pose(v);
    const box = this.obbOf(v, p.x, p.y, p.h);
    let blocked: Vehicle | null = null;
    for (const o of this.vehicles) {
      if (o === v || o.state === 'despawned' || o.state === 'buffer') continue;
      if (Math.abs(o.x - p.x) > 12 || Math.abs(o.y - p.y) > 12) continue;
      if (obbOverlap(box, this.obbOf(o), 0.05)) { blocked = o; break; }
    }
    if (blocked && ds > 0) {
      v.ri = oldRi; v.s = oldS; vNew = 0; ds = 0;
      this.stats.failsafeInterventions++;
      if (this.stats.failsafeInterventions < 60) this.log(`failsafe: ${v.spec.id} stopt voor ${blocked.spec.id} (${why})`);
    } else { v.x = p.x; v.y = p.y; v.heading = p.h; }
    v.a = ds > 0 || vNew > 0 ? a : Math.min(a, 0);
    v.v = vNew;
    v.brake = a < -0.5 || (v.v < 0.2 && aMin !== Infinity);
    v.lastWaitReason = v.v < 0.2 ? why : undefined;
    if (v.v < 0.2) { if (v.waitStart === undefined) v.waitStart = this.t; } else v.waitStart = undefined;

    // turn signal: only for real turns - a junction connector or a driveway within 30 m ahead
    // (a bend in the road itself, e.g. the curve towards the barrier, never triggers the indicator)
    v.signal = 0;
    const curE = this.edge(v.route[v.ri]);
    if (!curE.reverseMotion) {
      const p0 = this.pathPos(v) + v.spec.len / 2;
      for (let j = v.ri; j < v.route.length; j++) {
        if (v.cum[j] - p0 > 30) break;
        const e = this.edge(v.route[j]);
        if (j === v.ri && e.kind !== 'connector' && e.kind !== 'driveway') continue;
        if (e.kind === 'driveway') {
          // into a stall: indicate towards the stall side (right, or left on a one-way road)
          const a = e.line.tangent(0, 1.0), b = e.line.tangent(e.line.length, 1.0);
          v.signal = Math.sign(Math.atan2(cross(a, b), a.x * b.x + a.y * b.y)) || 1;
          break;
        }
        if (e.kind === 'connector') {
          if (v.cum[j] + e.line.length < p0 - v.spec.len) continue; // already through it
          const a = e.line.tangent(0, 1.0), b = e.line.tangent(e.line.length, 1.0);
          const ang = Math.atan2(cross(a, b), a.x * b.x + a.y * b.y);
          if (Math.abs(ang) > 0.5) v.signal = Math.sign(ang);
          break;
        }
      }
    }

    this.afterMove(v);
  }

  /** Is there a (slow) vehicle occupying the path position `d` (vehicle centre) of v? */
  private blockedAt(v: Vehicle, d: number): boolean {
    const sm = this.pathSample(v, d);
    const h = Math.atan2(sm.ty, sm.tx);
    const box = this.obbOf(v, sm.x, sm.y, h);
    return this.vehicles.some((o) => o !== v && o.state !== 'despawned' && obbOverlap(box, this.obbOf(o), 0.4) && o.v < 1.5);
  }

  /** Safety margin of the forward sweep against o. Two stopped vehicles that each see the other in their swept path
   *  (e.g. a car turning into a stall whose nose comes within the margin of a passing van) would wait forever; after
   *  3 s one of them (fixed order), and after 6 s the other, may creep on with a small margin. Real overlap stays
   *  forbidden: the probe still has to be clear of o's body. */
  /** does o (directly or through a short chain of stopped vehicles) wait for v? (wait-for cycle = deadlock) */
  private waitsOn(o: Vehicle, v: Vehicle, depth = 5): boolean {
    let cur: Vehicle | undefined = o;
    const seen = new Set<Vehicle>();
    for (let i = 0; i < depth && cur && !seen.has(cur); i++) {
      seen.add(cur);
      const r: string | undefined = cur.lastWaitReason;
      if (!r || cur.v > 0.05) return false;
      if (r.includes(v.spec.id)) return true;
      const me: Vehicle = cur;
      cur = this.vehicles.find((x) => x !== me && x.state !== 'despawned' && (r.endsWith(x.spec.id) || r.includes(`${x.spec.id})`)));
    }
    return false;
  }

  /** stopped behind a vehicle that is parked or dwelling (it will not move away) */
  private blockedByParked(v: Vehicle) {
    const r = v.lastWaitReason;
    if (!r?.startsWith('achter ')) return false;
    const o = this.vehicles.find((x) => x.spec.id === r.slice(7));
    return !!o && (o.state === 'parked' || o.state === 'dwell');
  }

  private mutualMargin(v: Vehicle, o: Vehicle) {
    if (v.v > 0.2 || o.v > 0.2 || v.waitStart === undefined || v.lastWaitReason !== `achter ${o.spec.id}`) return 0.22;
    const waited = this.t - v.waitStart;
    // relaxed, but still above the failsafe margin (0.05) so a creeping vehicle never runs into the failsafe
    // a) both see the other as the obstacle ahead: one of them (by id) goes first
    if (o.lastWaitReason === `achter ${v.spec.id}`) return waited > (v.spec.id < o.spec.id ? 3 : 6) ? 0.07 : 0.22;
    // b) the other one waits for me for another reason (e.g. it yields to me at a junction while its body is
    //    within my safety margin on a narrow two-lane path): I may pass it close by, it cannot move first
    if (o.lastWaitReason?.includes(v.spec.id)) return waited > 3 ? 0.07 : 0.22;
    return 0.22;
  }

  private sweep(v: Vehicle, pos: number, look: number): { gap: number; vObj: number; label: string; ped: boolean } | null {
    const cand = this.vehicles.filter((o) => o !== v && o.state !== 'despawned' && Math.abs(o.x - v.x) < look + 8 && Math.abs(o.y - v.y) < look + 8);
    const peds = this.peds.filter((p) => p.state !== 'done' && Math.abs(p.x - v.x) < look + 4 && Math.abs(p.y - v.y) < look + 4);
    if (!cand.length && !peds.length) return null;
    const end = this.pathEnd(v);
    for (let x = 0.4; x <= look; x += 0.5) {
      if (pos + x > end + 0.01) break;
      const sm = this.pathSample(v, pos + x);
      const h = Math.atan2(sm.ty, sm.tx);
      const probe: OBB = { cx: sm.x, cy: sm.y, ux: Math.cos(h), uy: Math.sin(h), hl: v.spec.len / 2, hw: v.spec.wid / 2 };
      for (const o of cand) {
        const ob = this.obbOf(o);
        if (obbOverlap(probe, ob, this.mutualMargin(v, o))) {
          const along = o.v * (Math.cos(o.heading) * sm.tx + Math.sin(o.heading) * sm.ty) * (this.edge(o.route[o.ri]).reverseMotion ? -1 : 1);
          return { gap: Math.max(0, x - 0.4), vObj: Math.max(0, along), label: `achter ${o.spec.id}`, ped: false };
        }
      }
      for (const p of peds) {
        const pb: OBB = { cx: p.x, cy: p.y, ux: 1, uy: 0, hl: 0.35, hw: 0.35 };
        if (obbOverlap(probe, pb, 0.5)) return { gap: Math.max(0, x - 0.4), vObj: 0, label: `voetganger ${p.name}`, ped: true };
      }
    }
    return null;
  }

  private advance(v: Vehicle, ds: number) {
    v.s += ds;
    while (v.ri < v.route.length - 1 && v.s > this.edge(v.route[v.ri]).line.length) {
      const prev = this.edge(v.route[v.ri]);
      v.s -= prev.line.length;
      v.ri++;
      const ne = this.edge(v.route[v.ri]);
      if (ne.reverseMotion !== prev.reverseMotion) v.switchUntil = this.t + 0.9;
    }
  }

  private afterMove(v: Vehicle) {
    const pos = this.pathPos(v), lead = pos + v.spec.len / 2;
    // grants: mark entered / release when clear / timeout
    for (const key of Object.keys(v.grants)) {
      const [zid, st] = splitKey(key);
      const g = v.grants[key];
      const z = this.net.zones.find((zz) => zz.id === zid)!;
      const mem = z.members.filter((m) => m.stream === st);
      const occ = mem.some((m) => this.occupies(v, m));
      if (occ) g.entered = true;
      else if (g.entered) delete v.grants[key];
      else if (this.t - g.since > P.grantTimeout) { delete v.grants[key]; this.log(`grant timeout ${v.spec.id} ${key}`); }
    }
    // gate bookkeeping
    for (const g of this.net.gates.values()) {
      if (v.passedGates.includes(g.id)) continue;
      const j = v.route.indexOf(g.edge);
      if (j < 0 || v.ri < j) continue;
      const gs = this.gates.get(g.id)!;
      // join the queue when entering the gate's approach lane
      if (!v.queue && v.ri === j) {
        const slot = gs.queue.length;
        gs.queue.push(v.spec.id);
        v.queue = { gateId: g.id, slot };
        this.stats.maxQueue[g.id] = Math.max(this.stats.maxQueue[g.id] ?? 0, gs.queue.length);
        this.emit('vehicle.queued', { vehicleId: v.spec.id, gateId: g.id, slot: slot + 1, bookingId: 'bookingId' in v.mission ? v.mission.bookingId : undefined });
        this.emit('queue.updated', { gateId: g.id, queue: [...gs.queue] });
        this.hooks.onQueued?.(v, g, slot);
      }
      const stopAbs = v.cum[j] + g.stopS;
      if (v.queue && !v.queue.atGate && gs.queue[0] === v.spec.id && stopAbs - lead < 3.0 && v.v < 0.4) {
        v.queue.atGate = true;
        this.emit('vehicle.at_gate', { vehicleId: v.spec.id, gateId: g.id });
        this.hooks.onAtGate?.(v, g);
      }
      if (lead > stopAbs) {
        const legal = gs.phase === 'OPEN' && gs.authorizedVehicle === v.spec.id;
        if (!legal) { this.stats.illegalGateCrossings++; this.log(`ILLEGALE PASSAGE ${v.spec.id} bij ${g.id} (fase ${gs.phase})`); }
        v.passedGates.push(g.id);
        if (gs.queue[0] === v.spec.id) gs.queue.shift(); else gs.queue = gs.queue.filter((id) => id !== v.spec.id);
        v.queue = undefined;
        gs.passedFront = true;
        for (const id of gs.queue) { const o = this.vehicles.find((x) => x.spec.id === id); if (o?.queue) o.queue.slot = gs.queue.indexOf(id); }
        this.emit('queue.updated', { gateId: g.id, queue: [...gs.queue] });
        this.emit('vehicle.passed_gate', { vehicleId: v.spec.id, gateId: g.id });
      }
    }
    // destination reached?
    const finalEdge = this.edge(v.route[v.route.length - 1]);
    if (v.ri === v.route.length - 1) {
      if (finalEdge.kind === 'driveway') {
        const st = this.net.stalls.get(finalEdge.stallId!)!;
        if (v.v < 0.05 && Math.abs(v.s - (finalEdge.line.length - st.parkBack)) < 0.25) {
          if (v.mission.type === 'service' && v.mission.job === 'return') {
            v.state = 'parked';
            this.emit('vehicle.parked', { vehicleId: v.spec.id, stallId: st.id, depot: true });
          } else if (v.mission.type === 'service') {
            v.state = 'dwell'; v.dwellUntil = v.mission.dwellSec === undefined ? this.t + 30 : v.mission.dwellSec < 0 ? Infinity : this.t + v.mission.dwellSec;
            this.emit('vehicle.service_stop', { vehicleId: v.spec.id, stallId: st.id, houseNumber: v.mission.houseNumber });
          } else {
            v.state = 'parked';
            this.emit('vehicle.parked', { vehicleId: v.spec.id, stallId: st.id, houseNumber: st.houseNumber, bookingId: 'bookingId' in v.mission ? v.mission.bookingId : undefined });
            this.hooks.onParked?.(v);
          }
          for (const k2 of Object.keys(v.grants)) delete v.grants[k2];
        }
      } else if (v.s >= finalEdge.line.length - 0.1 && finalEdge.to.startsWith('P_')) {
        v.state = 'despawned';
        this.emit('vehicle.exited', { vehicleId: v.spec.id, portal: finalEdge.to, bookingId: 'bookingId' in v.mission ? v.mission.bookingId : undefined });
        this.hooks.onExited?.(v);
      }
    }
  }

  /** End an (open-ended) service stop: the vehicle leaves its stall on a new mission. */
  releaseDwell(vehicleId: string, mission: Mission): boolean {
    const v = this.vehicles.find((x) => x.spec.id === vehicleId);
    if (!v || (v.state !== 'dwell' && v.state !== 'parked')) return false;
    v.dwellUntil = undefined; v.state = 'parked'; v.mission = mission;
    (v as Vehicle & { departPending?: boolean }).departPending = true;
    return true;
  }

  private finishDwell(v: Vehicle) {
    if (v.mission.type !== 'service') return;
    if (v.mission.job === 'repair') return; // open-ended: released by the park layer when the task is done
    const m = v.mission;
    const e = this.edge(v.route[v.ri]);
    v.dwellUntil = undefined;
    v.state = 'parked';
    v.mission = { type: 'service', job: 'patrol', exitPortal: m.exitPortal };
    if (e.stallId) (v as Vehicle & { departPending?: boolean }).departPending = true;
  }

  // ------------------------------------------------------------------ gates
  private stepGates() {
    for (const g of this.net.gates.values()) {
      const gs = this.gates.get(g.id)!;
      const el = this.t - gs.since;
      const crossBox: OBB = {
        cx: g.stopPoint.x + g.laneDir.x * g.crossLen / 2, cy: g.stopPoint.y + g.laneDir.y * g.crossLen / 2,
        ux: g.laneDir.x, uy: g.laneDir.y, hl: g.crossLen / 2 + 0.3, hw: 1.5,
      };
      const crossingOccupied = () => this.vehicles.some((o) => o.state !== 'despawned' && obbOverlap(crossBox, this.obbOf(o), 0));
      const set = (phase: GatePhase, ev: string) => {
        gs.phase = phase; gs.since = this.t; gs.lastEvent = ev;
        this.emit(ev, { gateId: g.id, vehicleId: gs.authorizedVehicle, passageId: gs.passageId });
      };
      if (gs.phase === 'CLOSED') {
        const headId = gs.queue[0];
        const head = headId ? this.vehicles.find((x) => x.spec.id === headId) : undefined;
        if (head && head.state === 'driving') {
          const j = head.route.indexOf(g.edge);
          const lead = this.pathPos(head) + head.spec.len / 2;
          const atLine = j >= 0 && head.ri === j && g.stopS - lead < 1.4 && head.v < 0.3;
          if (atLine) {
            // visitor barrier: the token of a completed check-in/check-out (a service vehicle may fall back on a staff
            // pass); staff barrier: only a staff pass, and only for a service vehicle
            const passage = g.staff
              ? (head.spec.kind === 'service' ? this.hooks.servicePass?.(head.spec.id, g.id) ?? null : null)
              : this.hooks.consumeToken(head.spec.id, g.id) ?? (head.spec.kind === 'service' ? this.hooks.servicePass?.(head.spec.id, g.id) ?? null : null);
            if (passage) {
              gs.authorizedVehicle = head.spec.id; gs.passageId = passage; gs.passedFront = false;
              this.emit('gate.pass_authorized', { gateId: g.id, vehicleId: head.spec.id, passageId: passage });
              set('OPENING', 'gate.opening');
            }
          }
        }
      } else if (gs.phase === 'OPENING') {
        if (el >= g.openSec) set('OPEN', 'gate.opened');
      } else if (gs.phase === 'OPEN') {
        const av = this.vehicles.find((x) => x.spec.id === gs.authorizedVehicle);
        const cleared = !av || (av.passedGates.includes(g.id) && (() => {
          const j = av.route.indexOf(g.edge);
          const centre = j >= 0 && av.ri === j ? av.s : Infinity;
          return av.ri > j || centre - av.spec.len / 2 > g.stopS + g.crossLen + 0.4;
        })());
        if (cleared && !crossingOccupied()) {
          this.hooks.onPassageDone?.(gs.passageId!, 'completed');
          this.stats.gateCycles[g.id] = (this.stats.gateCycles[g.id] ?? 0) + 1;
          set('CLOSING', 'gate.closing');
        } else if (el > 60 && av && !av.passedGates.includes(g.id) && !crossingOccupied()) {
          this.log(`slagboom ${g.id}: veiligheidstimeout, ${av.spec.id} is niet doorgereden; sluit veilig`);
          this.hooks.onPassageDone?.(gs.passageId!, 'aborted');
          set('CLOSING', 'gate.closing');
        }
      } else if (gs.phase === 'CLOSING') {
        if (crossingOccupied()) {
          this.log(`slagboom ${g.id}: voertuig in doorrijzone tijdens sluiten -> heropenen`);
          gs.phase = 'OPENING'; gs.since = this.t - g.openSec * (1 - Math.min(1, el / g.closeSec));
        } else if (el >= g.closeSec) {
          gs.authorizedVehicle = undefined; gs.passageId = undefined;
          set('CLOSED', 'gate.closed');
        }
      }
    }
  }

  /** Arm opening fraction 0 (closed) .. 1 (open) */
  armFraction(gateId: string, t = this.t): number {
    const g = this.net.gates.get(gateId)!, gs = this.gates.get(gateId)!;
    const el = t - gs.since;
    const ease = (x: number) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
    switch (gs.phase) {
      case 'CLOSED': return 0;
      case 'OPENING': return ease(el / g.openSec);
      case 'OPEN': return 1;
      case 'CLOSING': return 1 - ease(el / g.closeSec);
    }
  }

  // ------------------------------------------------------------------ pedestrians
  spawnPedestrian(p: Omit<Pedestrian, 'id' | 'i' | 'x' | 'y' | 'heading' | 'state' | 'speed'> & { speed?: number }): Pedestrian {
    const ped: Pedestrian = { ...p, id: `ped-${++this.pedSeq}`, i: 0, x: p.path[0].x, y: p.path[0].y, heading: 0, state: 'walking', speed: p.speed ?? 1.25 };
    this.peds.push(ped);
    return ped;
  }

  private stepPedestrians(dt: number) {
    for (const p of this.peds) {
      if (p.state === 'done') continue;
      const tgt = p.path[p.i + 1];
      if (!tgt) { p.state = 'done'; this.hooks.onPedestrianDone?.(p); continue; }
      // crossing check: wait if a moving vehicle is close and heading our way
      const danger = this.vehicles.some((o) => o.state === 'driving' && o.v > 0.3 && dist(o, p) < 9 &&
        ((p.x - o.x) * Math.cos(o.heading) + (p.y - o.y) * Math.sin(o.heading)) > 0);
      const nearCar = this.vehicles.some((o) => o.state === 'driving' && dist(o, p) < 3.2);
      if (danger && !nearCar && p.state === 'walking' && this.onLane(p)) { /* already on the road: keep walking to clear it */ }
      else if (danger && !this.onLane(p) && this.segmentCrossesLane(p)) { p.state = 'waiting'; continue; }
      p.state = 'walking';
      const dx = tgt.x - p.x, dy = tgt.y - p.y, d = Math.hypot(dx, dy);
      const step = p.speed * dt;
      p.heading = Math.atan2(dy, dx);
      if (d <= step) { p.x = tgt.x; p.y = tgt.y; p.i++; } else { p.x += (dx / d) * step; p.y += (dy / d) * step; }
    }
    this.peds = this.peds.filter((p) => p.state !== 'done');
  }
  private onLane(p: { x: number; y: number }) {
    for (const e of this.net.edges.values()) {
      if (e.kind !== 'lane') continue;
      if (Math.abs(e.line.pts[0].x - p.x) > 200) continue;
      const pr = e.line.project(p);
      if (pr.d < 1.6) return true;
    }
    return false;
  }
  private segmentCrossesLane(p: Pedestrian) {
    const tgt = p.path[p.i + 1];
    for (let f = 0.2; f <= 1; f += 0.2) if (this.onLane({ x: p.x + (tgt.x - p.x) * f, y: p.y + (tgt.y - p.y) * f })) return true;
    return false;
  }

  // ------------------------------------------------------------------ monitoring
  private monitor(dt: number) {
    const live = this.vehicles.filter((v) => v.state !== 'despawned');
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (Math.abs(a.x - b.x) > 8 || Math.abs(a.y - b.y) > 8) continue;
      if (obbOverlap(this.obbOf(a), this.obbOf(b), -0.02)) {
        this.stats.collisions++;
        if (this.stats.collisions < 30) this.log(`BOTSING ${a.spec.id} x ${b.spec.id}`);
      }
    }
    for (const v of live) {
      if (v.state !== 'driving') continue;
      const e = this.edge(v.route[v.ri]);
      if (e.cls === 'public' && v.v < 0.3) this.stats.publicRoadStopSeconds += dt;
      // wrong way: heading must agree with the lane direction (or be opposite on explicit reverse edges)
      const t = e.line.tangent(clamp(v.s, 0, e.line.length), 0.7);
      const facing = Math.cos(v.heading) * t.x + Math.sin(v.heading) * t.y;
      if ((e.reverseMotion ? -facing : facing) < 0.3) { this.stats.wrongWay++; if (this.stats.wrongWay < 20) this.log(`SPOOKRIJDER? ${v.spec.id} op ${e.id}`); }
    }
  }

  // ------------------------------------------------------------------ snapshots / persistence
  snapshot(): TrafficSnapshot {
    return {
      t: +this.t.toFixed(3),
      vehicles: this.vehicles.filter((v) => v.state !== 'despawned').map((v) => ({
        id: v.spec.id, kind: v.spec.kind, model: v.spec.model, color: v.spec.color, label: v.spec.label, job: v.mission.type === 'service' ? v.mission.job : undefined,
        x: +v.x.toFixed(3), y: +v.y.toFixed(3), h: +v.heading.toFixed(4), v: +v.v.toFixed(2), brake: v.state === 'driving' && v.brake, signal: v.state === 'driving' ? v.signal : 0,
        reverse: this.edge(v.route[v.ri]).reverseMotion && v.state === 'driving', state: v.state, len: v.spec.len, wid: v.spec.wid,
      })),
      gates: [...this.gates.values()].map((g) => ({ id: g.id, phase: g.phase, since: +g.since.toFixed(3), authorizedVehicle: g.authorizedVehicle, queue: [...g.queue], openSec: this.net.gates.get(g.id)!.openSec, closeSec: this.net.gates.get(g.id)!.closeSec })),
      pedestrians: this.peds.map((p) => ({ id: p.id, x: +p.x.toFixed(2), y: +p.y.toFixed(2), h: +p.heading.toFixed(3), walking: p.state === 'walking', color: p.color })),
    };
  }

  debugInfo() {
    return {
      vehicles: this.vehicles.map((v) => {
        const pos = this.pathPos(v);
        const pts: number[][] = [];
        if (v.state === 'driving') for (let x = 0; x <= Math.min(60, this.pathEnd(v) - pos); x += 2) { const s = this.pathSample(v, pos + x); pts.push([+s.x.toFixed(2), +s.y.toFixed(2)]); }
        return { id: v.spec.id, state: v.state, edge: v.route[v.ri], s: +v.s.toFixed(2), v: +v.v.toFixed(2), why: v.lastWaitReason, grants: Object.keys(v.grants), queue: v.queue, route: pts, box: obbCornersArr(this.obbOf(v)) };
      }),
      gates: [...this.gates.values()],
      buffer: this.buffer.map((b) => ({ id: b.spec.id, portal: b.portal, readyAt: b.readyAt })),
      stats: { ...this.stats, log: this.stats.log.slice(-40) },
    };
  }

  serialize() {
    return JSON.stringify({
      t: this.t, rng: this.rand.state(), pedSeq: this.pedSeq,
      vehicles: this.vehicles, gates: [...this.gates.values()], peds: this.peds, buffer: this.buffer,
      stats: { ...this.stats, minHeadway: Number.isFinite(this.stats.minHeadway) ? this.stats.minHeadway : null },
    });
  }
  restore(json: string) {
    const d = JSON.parse(json);
    this.t = d.t; this.rand.setState(d.rng); this.pedSeq = d.pedSeq ?? 0;
    this.vehicles = d.vehicles.filter((v: Vehicle) => v.route.every((id) => this.net.edges.has(id)));
    for (const g of d.gates) if (this.gates.has(g.id)) this.gates.set(g.id, g);
    this.peds = d.peds ?? []; this.buffer = d.buffer ?? [];
    if (d.stats) this.stats = { ...this.stats, ...d.stats, minHeadway: d.stats.minHeadway ?? Infinity };
  }
}

function splitKey(k: string): [string, string] { const i = k.indexOf('|'); return [k.slice(0, i), k.slice(i + 1)]; }
function obbCornersArr(b: OBB) {
  const rx = -b.uy, ry = b.ux;
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, c]) => [+(b.cx + b.ux * b.hl * a + rx * b.hw * c).toFixed(2), +(b.cy + b.uy * b.hl * a + ry * b.hw * c).toFixed(2)]);
}
export { VEH };
