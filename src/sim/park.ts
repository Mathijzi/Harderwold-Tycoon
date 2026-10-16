// Park layer on top of the traffic sim: bookings/households, guests on foot, service vehicles.
// It never opens a gate itself: passage tokens come exclusively from the authorizer (task completion).
import { Network, findRoute, visitorPortal } from './network.ts';
import { TrafficSim, TrafficHooks, Vehicle, VehicleSpec, Pedestrian, Mission } from './traffic.ts';
import { Vec, add, mul, sub, norm, rng, Rng, dist } from '../shared/geom.ts';
import { Guest, Household, makeHousehold } from '../shared/guestlib.ts';
export type { Guest, Household };

export type BookingStatus =
  | 'arriving' | 'queued_in' | 'checked_in' | 'driving_in' | 'parked' | 'in_house'
  | 'departing' | 'queued_out' | 'checked_out' | 'exited';

export interface Booking {
  id: string; household: string; guests: Guest[]; profile?: Household; houseNumber: number; stallId: string; vehicleId: string;
  status: BookingStatus; satisfaction: number; createdAt: number; queuedAt?: number; arrivedAt?: number; departedAt?: number;
  history: { t: number; status: BookingStatus; note?: string }[];
}
export type HouseState = 'vacant' | 'reserved' | 'occupied' | 'needs_cleaning' | 'cleaning';
/** A technical-service job: a golf cart drives from the TD post to the reported location while the task is being handled. */
export interface TechJob { taskId: string; houseNumber: number; cartId?: string; stallId?: string; phase: 'pending' | 'driving' | 'working' | 'walking_back' | 'returning'; released: boolean; techInside: boolean; createdAt: number }

export interface ParkHooks extends Pick<TrafficHooks, 'consumeToken' | 'onPassageDone' | 'servicePass'> {
  onEvent(type: string, payload: Record<string, unknown>): void;
  onQueued(b: Booking, gateId: string, direction: 'inbound' | 'outbound', slot: number): void;
  /** the car of this booking stands at the barrier (first in line, at the stop line): now check-in/out is requested */
  onAtGate?(b: Booking, gateId: string, direction: 'inbound' | 'outbound'): void;
}

const CAR_COLORS = ['#e9ecef', '#1f2326', '#9aa3ab', '#2f4f7f', '#8e1d24', '#cfd4d8', '#3c4b3a', '#5a6470', '#f2f2ee', '#273441', '#6b2f2a', '#b7b9b2'];

export class ParkSim {
  traffic: TrafficSim;
  net: Network;
  bookings = new Map<string, Booking>();
  houses = new Map<number, { state: HouseState; bookingId?: string }>();
  rand: Rng;
  private seq = 0;
  private serviceNext = 30;
  techJobs = new Map<string, TechJob>();
  hooks: ParkHooks;
  private gateCache = new Map<number, { in: string; out: string }>();
  /** service entrances (emergency exits used by service vehicles) */
  readonly servicePortals: string[];
  /** visitors enter and leave the park at the public entrance */
  readonly visitorPortal: string;
  /** turning circles a patrolling maintenance van can visit */
  private patrolLoops: string[];

  private readonly seed: number;

  constructor(net: Network, hooks: ParkHooks, seed = 7) {
    this.seed = seed;
    this.net = net;
    this.hooks = hooks;
    this.rand = rng(seed * 7919 + 13);
    this.visitorPortal = visitorPortal(net);
    this.servicePortals = [...net.portals.values()].filter((p) => p.kind === 'service' && p.spawnEdge && p.despawnEdge).map((p) => p.id);
    this.patrolLoops = [...net.edges.values()].filter((e) => e.kind === 'loop' && e.service && e.cls === 'park').map((e) => e.id).sort();
    for (const st of net.stalls.values()) if (st.houseNumber > 0) this.houses.set(st.houseNumber, { state: 'vacant' });
    this.traffic = new TrafficSim(net, {
      consumeToken: (vid, gid) => hooks.consumeToken(vid, gid),
      // without a backend (tests, stress runs) the simulation issues the staff pass itself
      servicePass: (vid, gid) => (hooks.servicePass ? hooks.servicePass(vid, gid) : `svc-pass-${vid}-${gid}-${this.traffic.t.toFixed(1)}`),
      onPassageDone: (pid, status) => hooks.onPassageDone?.(pid, status),
      onEvent: (t, p) => this.onTrafficEvent(t, p),
      onQueued: (veh, gate, slot) => {
        const b = this.bookingOfVehicle(veh.spec.id);
        if (!b) return;
        this.setStatus(b, gate.direction === 'inbound' ? 'queued_in' : 'queued_out');
        b.queuedAt = this.traffic.t;
        hooks.onQueued(b, gate.id, gate.direction, slot);
      },
      onAtGate: (veh, gate) => { const b = this.bookingOfVehicle(veh.spec.id); if (b) hooks.onAtGate?.(b, gate.id, gate.direction); },
      onParked: (veh) => this.onParked(veh),
      onExited: (veh) => this.onExited(veh),
      onPedestrianDone: (p) => this.onPedDone(p),
    }, seed);
  }

  get t() { return this.traffic.t; }
  private id(prefix: string) { return `${prefix}-${(++this.seq).toString().padStart(3, '0')}`; }
  bookingOfVehicle(vid: string) { for (const b of this.bookings.values()) if (b.vehicleId === vid) return b; return undefined; }
  private setStatus(b: Booking, s: BookingStatus, note?: string) {
    b.status = s; b.history.push({ t: +this.t.toFixed(1), status: s, note });
    this.hooks.onEvent('booking.updated', { bookingId: b.id, status: s, houseNumber: b.houseNumber, household: b.household });
  }
  private onTrafficEvent(type: string, payload: Record<string, unknown>) {
    this.hooks.onEvent(type, payload);
    const vid = payload.vehicleId as string | undefined;
    const b = vid ? this.bookingOfVehicle(vid) : undefined;
    if (!b) return;
    if (type === 'vehicle.passed_gate') this.setStatus(b, b.status === 'queued_in' || b.status === 'checked_in' ? 'driving_in' : 'checked_out');
  }

  /** Household (guestlib: family, songwriting camp or well-to-do guests) from its own seeded stream, so guest profiles never change the traffic randomness. */
  private makeGuests(bookingId: string) {
    let h = Math.imul(this.seed, 2654435761) >>> 0;
    for (const ch of bookingId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    // a cameo guest stays in at most one villa at a time
    const taken = new Set<string>();
    for (const b of this.bookings.values()) if (b.status !== 'exited' && b.profile?.celebrity) taken.add(b.profile.celebrity);
    const { household, guests } = makeHousehold(rng(h), taken);
    return { household: household.name, guests, profile: household };
  }
  private makeCar(id: string): VehicleSpec {
    const model = this.rand.pick(['hatch', 'suv', 'wagon', 'suv', 'hatch'] as const);
    const len = model === 'suv' ? 4.6 : model === 'wagon' ? 4.75 : 4.2;
    const L = 'BDFGHJKLNPRSTVXZ';
    const plate = `${L[this.rand.int(0, 15)]}${L[this.rand.int(0, 15)]}-${this.rand.int(100, 999)}-${L[this.rand.int(0, 15)]}`;
    return { id, kind: 'visitor', model, len, wid: model === 'suv' ? 1.88 : 1.8, color: this.rand.pick(CAR_COLORS), plate };
  }

  /** bookable: vacant and its stall not temporarily used by a TD golf cart */
  vacantHouses() {
    return [...this.houses.entries()].filter(([n, h]) => h.state === 'vacant' && !this.stallBusy(this.net.stallsByHouse.get(n)!.id)).map(([n]) => n);
  }

  /** Create a booking that arrives now via the public approach (west portal). Returns null if no bungalow is free. */
  scheduleArrival(opts: { houseNumber?: number; delaySec?: number } = {}): Booking | null {
    const free = this.vacantHouses();
    const house = opts.houseNumber && free.includes(opts.houseNumber) ? opts.houseNumber : free.length ? this.rand.pick(free) : null;
    if (house === null) return null;
    const st = this.net.stallsByHouse.get(house)!;
    const id = this.id('B');
    const vid = this.id('car');
    const b: Booking = {
      id, ...this.makeGuests(id), houseNumber: house, stallId: st.id, vehicleId: vid,
      status: 'arriving', satisfaction: this.rand.range(0.78, 0.92), createdAt: this.t, history: [],
    };
    this.bookings.set(id, b);
    this.houses.set(house, { state: 'reserved', bookingId: id });
    this.setStatus(b, 'arriving');
    this.traffic.enqueueArrival(this.makeCar(vid), { type: 'arrive', bookingId: id, stallId: st.id, gateId: this.gatesFor(house).in }, this.visitorPortal, this.t + (opts.delaySec ?? 0));
    return b;
  }

  /** Put households into some bungalows at start (parked car, guests inside). */
  seedOccupied(count: number) {
    const free = this.vacantHouses();
    for (let i = 0; i < count && free.length; i++) {
      const house = free.splice(this.rand.int(0, free.length - 1), 1)[0];
      const st = this.net.stallsByHouse.get(house)!;
      const id = this.id('B'), vid = this.id('car');
      const b: Booking = { id, ...this.makeGuests(id), houseNumber: house, stallId: st.id, vehicleId: vid, status: 'in_house', satisfaction: this.rand.range(0.75, 0.95), createdAt: this.t, history: [] };
      this.bookings.set(id, b);
      this.houses.set(house, { state: 'occupied', bookingId: id });
      this.traffic.placeParked(this.makeCar(vid), { type: 'arrive', bookingId: id, stallId: st.id, gateId: this.gatesFor(house).in }, st.id);
      this.setStatus(b, 'in_house', 'startbezetting');
    }
  }

  /** Household leaves: guests walk to the car, then the car waits for outbound queue capacity. */
  depart(opts: { houseNumber?: number; bookingId?: string } = {}): Booking | null {
    const cands = [...this.bookings.values()].filter((b) => b.status === 'in_house');
    const b = opts.bookingId ? cands.find((x) => x.id === opts.bookingId) : opts.houseNumber ? cands.find((x) => x.houseNumber === opts.houseNumber) : cands.length ? this.rand.pick(cands) : undefined;
    if (!b) return null;
    const veh = this.traffic.vehicles.find((v) => v.spec.id === b.vehicleId);
    if (!veh) return null;
    this.setStatus(b, 'departing');
    const house = this.net.houses.find((h) => h.number === b.houseNumber)!;
    veh.boarding = b.guests.length;
    this.traffic.requestDeparture(veh.spec.id, { type: 'depart', bookingId: b.id, stallId: b.stallId, gateId: this.gatesFor(b.houseNumber).out, portal: this.visitorPortal });
    b.guests.forEach((g, i) => {
      const path = this.walkPath(house.door, veh, i);
      this.traffic.spawnPedestrian({ name: g.name, color: g.color, path, purpose: 'to_car', bookingId: b.id, vehicleId: veh.spec.id, speed: 1.15 + i * 0.07 });
    });
    return b;
  }

  private walkPath(door: Vec, veh: Vehicle, i: number): Vec[] {
    const side = { x: Math.cos(veh.heading + Math.PI / 2), y: Math.sin(veh.heading + Math.PI / 2) };
    const fwd = { x: Math.cos(veh.heading), y: Math.sin(veh.heading) };
    const carSide = add(add({ x: veh.x, y: veh.y }, mul(side, (i % 2 ? -1 : 1) * 1.35)), mul(fwd, (i < 2 ? 0.6 : -0.9)));
    const mid = add(mul(add(door, carSide), 0.5), mul(norm(sub(door, carSide)), 0));
    return [door, mid, carSide];
  }

  private onParked(veh: Vehicle) {
    const b = this.bookingOfVehicle(veh.spec.id);
    if (!b) return;
    b.arrivedAt = this.t;
    this.setStatus(b, 'parked');
    const house = this.net.houses.find((h) => h.number === b.houseNumber)!;
    b.guests.forEach((g, i) => {
      const path = this.walkPath(house.door, veh, i).reverse();
      this.traffic.spawnPedestrian({ name: g.name, color: g.color, path, purpose: 'to_house', bookingId: b.id, speed: 1.1 + i * 0.08 });
    });
    this.houses.set(b.houseNumber, { state: 'occupied', bookingId: b.id });
  }

  private onPedDone(p: Pedestrian) {
    if (p.purpose === 'to_house' && p.bookingId) {
      const b = this.bookings.get(p.bookingId);
      if (b && b.status === 'parked' && !this.traffic.peds.some((q) => q !== p && q.bookingId === p.bookingId && q.state !== 'done')) this.setStatus(b, 'in_house');
    }
    if (p.purpose === 'to_car' && p.vehicleId) {
      const veh = this.traffic.vehicles.find((v) => v.spec.id === p.vehicleId);
      if (veh && veh.boarding) veh.boarding--;
    }
    if (p.purpose === 'tech_in' && p.bookingId) {
      const j = this.techJobs.get(p.bookingId);
      if (j) { j.techInside = true; this.hooks.onEvent('service.working', { kind: 'technische_dienst', taskId: j.taskId, houseNumber: j.houseNumber }); if (j.released) this.techWalkBack(j); }
    }
    if (p.purpose === 'tech_out' && p.bookingId) {
      const j = this.techJobs.get(p.bookingId);
      if (j && j.released) this.returnCart(j);
      else if (j) { j.phase = 'working'; this.techWalkIn(j); } // re-claimed while walking back: go back inside
    }
    if (p.purpose === 'clean_in') {
      // cleaner works inside for a while, then walks back
      const back = p.path.slice().reverse();
      this.traffic.spawnPedestrian({ name: p.name, color: p.color, path: [back[0], back[0], ...back], purpose: 'clean_out', vehicleId: p.vehicleId, speed: 1.2 });
    }
    if (p.purpose === 'clean_out' && p.vehicleId) {
      const veh = this.traffic.vehicles.find((v) => v.spec.id === p.vehicleId);
      if (veh && veh.mission.type === 'service' && veh.mission.job === 'clean' && veh.mission.houseNumber && this.houses.get(veh.mission.houseNumber)?.state === 'cleaning') {
        this.houses.set(veh.mission.houseNumber, { state: 'vacant' });
        this.hooks.onEvent('house.cleaned', { houseNumber: veh.mission.houseNumber });
        if (veh.state === 'dwell') veh.dwellUntil = this.t; // leave now
      }
    }
  }

  private onExited(veh: Vehicle) {
    const b = this.bookingOfVehicle(veh.spec.id);
    if (b) {
      b.departedAt = this.t;
      this.setStatus(b, 'exited');
      this.houses.set(b.houseNumber, { state: 'needs_cleaning' });
      this.hooks.onEvent('house.needs_cleaning', { houseNumber: b.houseNumber });
    }
  }

  // ---------------------------------------------------------------- service vehicles
  private serviceSpec(kind: 'onderhoud' | 'schoonmaak'): VehicleSpec {
    return kind === 'onderhoud'
      ? { id: this.id('svc-onderhoud'), kind: 'service', model: 'van', len: 5.3, wid: 2.0, color: '#ffffff', plate: 'Onderhoud', label: 'Onderhoud' }
      : { id: this.id('svc-schoonmaak'), kind: 'service', model: 'cart', len: 3.7, wid: 1.5, color: '#ffffff', plate: 'Schoonmaak', label: 'Schoonmaak' };
  }
  private serviceActive(prefix: string) { return this.traffic.vehicles.some((v) => v.spec.id.startsWith(prefix)) || this.traffic.buffer.some((b) => b.spec.id.startsWith(prefix)); }

  private dispatchService() {
    // cleaning cart: drive to a vacated bungalow's stall, cleaner walks in, then leave
    if (!this.serviceActive('svc-schoonmaak')) {
      const dirty = [...this.houses.entries()].find(([, h]) => h.state === 'needs_cleaning');
      if (dirty && !this.stallBusy(this.net.stallsByHouse.get(dirty[0])!.id)) {
        const [num] = dirty;
        const st = this.net.stallsByHouse.get(num)!;
        const [portal, exitPortal] = this.servicePair(st.inEdge, st.outEdge);
        this.houses.set(num, { state: 'cleaning' });
        this.traffic.buffer.push({ spec: this.serviceSpec('schoonmaak'), mission: { type: 'service', job: 'clean', stallId: st.id, dwellSec: 240, exitPortal, houseNumber: num }, portal, readyAt: this.t });
        this.hooks.onEvent('service.dispatched', { kind: 'schoonmaak', houseNumber: num });
      }
    }
    // maintenance van: patrol from a service entrance to a turning circle in the same part of the park and back
    if (!this.serviceActive('svc-onderhoud') && this.t >= this.serviceNext) {
      const [portal, exitPortal] = this.servicePair();
      this.traffic.buffer.push({ spec: this.serviceSpec('onderhoud'), mission: { type: 'service', job: 'patrol', exitPortal }, portal, readyAt: this.t });
      this.serviceNext = this.t + this.rand.range(70, 160);
    }
  }

  /** Entry and exit service entrance for a job at (toEdge -> fromEdge): preferably both reachable WITHOUT a barrier
   *  (the East and West parts of the park are only connected through the barriers); otherwise a staff pass is needed. */
  private servicePair(toEdge?: string, fromEdge?: string): [string, string] {
    const ps = this.servicePortals;
    if (!ps.length) return ['', ''];
    const reach = (p: string) => this.serviceRegion(p);
    const entries = toEdge ? ps.filter((p) => reach(p).fwd.has(toEdge)) : ps;
    const entry = entries.length ? entries[this.rand.int(0, entries.length - 1)] : ps[this.rand.int(0, ps.length - 1)];
    const exits = fromEdge ? ps.filter((p) => reach(p).back.has(fromEdge)) : ps.filter((p) => p !== entry && reach(entry).fwd.has(this.net.portals.get(p)!.despawnEdge!));
    const exit = exits.length ? exits[this.rand.int(0, exits.length - 1)] : entry;
    return [entry, exit];
  }
  private regions = new Map<string, { fwd: Set<string>; back: Set<string> }>();
  /** edges a service vehicle reaches from (fwd) / can leave through (back) a service entrance without a barrier */
  serviceRegion(portalId: string) {
    const hit = this.regions.get(portalId);
    if (hit) return hit;
    const p = this.net.portals.get(portalId)!;
    // staff barriers are part of the service network (a staff pass opens them); visitor barriers are not
    const gates = new Set([...this.net.gates.values()].filter((g) => !g.staff).map((g) => g.edge));
    const ok = (id: string) => { const e = this.net.edges.get(id)!; return e.service && !gates.has(id) && e.kind !== 'reverse'; };
    const walk = (start: string, dir: 'next' | 'prev') => {
      const seen = new Set([start]); const st = [start];
      while (st.length) { const u = st.pop()!; for (const n of this.net.edges.get(u)![dir]) if (!seen.has(n) && (ok(n) || this.net.edges.get(n)!.kind === 'reverse')) { seen.add(n); st.push(n); } }
      return seen;
    };
    const res = { fwd: walk(p.spawnEdge!, 'next'), back: walk(p.despawnEdge!, 'prev') };
    this.regions.set(portalId, res);
    return res;
  }

  /** Called by the traffic sim when a cleaning cart has parked (dwell) */
  private startCleaner(veh: Vehicle) {
    if (veh.mission.type !== 'service' || veh.mission.job !== 'clean' || !veh.mission.houseNumber) return;
    const house = this.net.houses.find((h) => h.number === (veh.mission as { houseNumber: number }).houseNumber)!;
    const path = this.walkPath(house.door, veh, 0).reverse();
    this.traffic.spawnPedestrian({ name: 'Schoonmaker', color: '#1fa7a8', path, purpose: 'clean_in', vehicleId: veh.spec.id, speed: 1.3 });
  }

  // ---------------------------------------------------------------- technical service (golf carts)
  /** Park the TD golf carts in their depot stalls at the TD post next to reception. */
  seedService() {
    const depot = [...this.net.stalls.values()].filter((s) => s.kind === 'depot');
    depot.forEach((st, i) => {
      if (this.traffic.vehicles.some((v) => v.spec.id === `tdkar-${i + 1}`)) return;
      this.traffic.placeParked({ id: `tdkar-${i + 1}`, kind: 'service', model: 'golfcart', len: 2.8, wid: 1.35, color: '#ffffff', plate: `TD-${i + 1}`, label: 'Technische dienst' },
        { type: 'service', job: 'return', stallId: st.id, exitPortal: '' }, st.id);
    });
  }
  private stallBusy(stallId: string, except?: string) {
    const st = this.net.stalls.get(stallId)!;
    if (this.traffic.vehicles.some((v) => v.spec.id !== except && v.state !== 'despawned' && (st.inEdges.includes(v.route[v.route.length - 1]) || st.outEdges.includes(v.route[v.ri])))) return true;
    if (this.traffic.buffer.some((b) => 'stallId' in b.mission && b.mission.stallId === stallId)) return true;
    for (const j of this.techJobs.values()) if (j.stallId === stallId && j.cartId !== except) return true;
    return false;
  }
  private cartStall(cartId: string) {
    const v = this.traffic.vehicles.find((x) => x.spec.id === cartId);
    if (!v) return undefined;
    const e = this.net.edges.get(v.route[v.route.length - 1]);
    return e?.stallId ? this.net.stalls.get(e.stallId) : undefined;
  }
  dispatchTechnician(taskId: string, houseNumber: number): boolean {
    const prev = this.techJobs.get(taskId);
    if (prev) { prev.released = false; return true; } // re-claimed before the cart left: keep the same mechanic on the job
    if (!this.net.houses.some((h) => h.number === houseNumber)) return false;
    this.techJobs.set(taskId, { taskId, houseNumber, phase: 'pending', released: false, techInside: false, createdAt: this.t });
    this.hooks.onEvent('service.requested', { kind: 'technische_dienst', taskId, houseNumber });
    return true;
  }
  releaseTechnician(taskId: string) {
    const j = this.techJobs.get(taskId);
    if (!j) return;
    j.released = true;
    if (j.phase === 'pending') { this.techJobs.delete(taskId); return; }
    if (j.phase === 'working' && j.techInside) this.techWalkBack(j);
  }
  /** Where the mechanic for this task is; onSite only once they have actually walked into the bungalow. */
  techStatus(taskId: string) {
    const j = this.techJobs.get(taskId);
    if (!j || j.released) return undefined;
    return { phase: j.phase, onSite: j.phase === 'working' && j.techInside, vehicleId: j.cartId ?? null, houseNumber: j.houseNumber };
  }
  private tryAssignTech() {
    for (const j of this.techJobs.values()) {
      if (j.phase !== 'pending') continue;
      const house = this.net.houses.find((h) => h.number === j.houseNumber)!;
      const busyCarts = new Set([...this.techJobs.values()].map((x) => x.cartId).filter(Boolean));
      const carts = this.traffic.vehicles.filter((v) => v.spec.model === 'golfcart' && v.state === 'parked' && !busyCarts.has(v.spec.id) && !(v as Vehicle & { departPending?: boolean }).departPending);
      if (!carts.length) return;
      // candidate stalls: free service (spare/depot) stalls close to the bungalow's door
      // service/spare stalls, or the stall of a vacant bungalow (it cannot be booked while the cart stands there)
      const cands = [...this.net.stalls.values()].filter((s) => s.kind !== 'house' || this.houses.get(s.houseNumber)?.state === 'vacant')
        .map((s) => ({ s, d: dist({ x: s.parkedPose.x, y: s.parkedPose.y }, house.door) })).filter((c) => c.d < 48).sort((a, b) => a.d - b.d);
      let pick: { cart: Vehicle; stall: string } | null = null;
      for (const c of cands) {
        const own = carts.find((v) => this.cartStall(v.spec.id)?.id === c.s.id);
        if (own) { pick = { cart: own, stall: c.s.id }; break; }
        if (!this.stallBusy(c.s.id)) { pick = { cart: carts[0], stall: c.s.id }; break; }
      }
      if (!pick) continue;
      j.cartId = pick.cart.spec.id; j.stallId = pick.stall;
      this.hooks.onEvent('service.dispatched', { kind: 'technische_dienst', taskId: j.taskId, houseNumber: j.houseNumber, vehicleId: j.cartId });
      if (this.cartStall(j.cartId)?.id === pick.stall) { j.phase = 'working'; this.techWalkIn(j); }
      else {
        j.phase = 'driving';
        this.traffic.requestDeparture(j.cartId, { type: 'service', job: 'repair', stallId: pick.stall, dwellSec: -1, exitPortal: '', houseNumber: j.houseNumber, taskId: j.taskId });
      }
    }
  }
  private techWalkIn(j: TechJob) {
    const cart = this.traffic.vehicles.find((v) => v.spec.id === j.cartId)!;
    const house = this.net.houses.find((h) => h.number === j.houseNumber)!;
    if (j.released) { this.returnCart(j); return; }
    this.traffic.spawnPedestrian({ name: 'Monteur', color: '#f08a24', path: this.walkPath(house.door, cart, 0).reverse(), purpose: 'tech_in', vehicleId: cart.spec.id, bookingId: j.taskId, speed: 1.35 });
  }
  private techWalkBack(j: TechJob) {
    const cart = this.traffic.vehicles.find((v) => v.spec.id === j.cartId);
    const house = this.net.houses.find((h) => h.number === j.houseNumber)!;
    if (!cart) { this.techJobs.delete(j.taskId); return; }
    j.phase = 'walking_back'; j.techInside = false;
    this.traffic.spawnPedestrian({ name: 'Monteur', color: '#f08a24', path: this.walkPath(house.door, cart, 0), purpose: 'tech_out', vehicleId: cart.spec.id, bookingId: j.taskId, speed: 1.35 });
  }
  private returnCart(j: TechJob) {
    const cart = this.traffic.vehicles.find((v) => v.spec.id === j.cartId);
    const here = j.cartId ? this.cartStall(j.cartId) : undefined;
    this.techJobs.delete(j.taskId);
    if (!cart || here?.kind === 'depot') return; // already at the TD post
    const home = [...this.net.stalls.values()].filter((s) => s.kind === 'depot' && !this.stallBusy(s.id, cart.spec.id))[0];
    if (!home) { this.traffic.releaseDwell(cart.spec.id, { type: 'service', job: 'repair', stallId: here?.id, dwellSec: -1, exitPortal: '' }); return; }
    this.traffic.releaseDwell(cart.spec.id, { type: 'service', job: 'return', stallId: home.id, exitPortal: '' });
    this.hooks.onEvent('service.returning', { kind: 'technische_dienst', taskId: j.taskId, vehicleId: cart.spec.id });
  }
  private stepTech() {
    this.tryAssignTech();
    for (const j of this.techJobs.values()) {
      if (j.phase !== 'driving') continue;
      const cart = this.traffic.vehicles.find((v) => v.spec.id === j.cartId);
      if (cart && cart.state === 'dwell') { j.phase = 'working'; this.techWalkIn(j); }
    }
  }

  // ---------------------------------------------------------------- tick
  step(dt: number) {
    const before = new Set(this.traffic.vehicles.filter((v) => v.state === 'dwell').map((v) => v.spec.id));
    // service routing needs via-points for the patrol: inject before spawn
    this.routePatrols();
    this.traffic.step(dt);
    for (const v of this.traffic.vehicles) if (v.state === 'dwell' && !before.has(v.spec.id)) this.startCleaner(v);
    if (Math.floor(this.t / 2) !== Math.floor((this.t - dt) / 2)) this.dispatchService();
    if (Math.floor(this.t) !== Math.floor(this.t - dt)) this.stepTech();
    // waiting in a queue costs satisfaction (bounded)
    for (const b of this.bookings.values()) {
      if ((b.status === 'queued_in' || b.status === 'queued_out') && b.queuedAt !== undefined && this.t - b.queuedAt > 120) b.satisfaction = Math.max(0.2, b.satisfaction - 0.0004 * dt);
    }
    // drop finished bookings after a while
    for (const [id, b] of this.bookings) if (b.status === 'exited' && b.departedAt !== undefined && this.t - b.departedAt > 600) this.bookings.delete(id);
  }

  private portalOf(spawnEdge: string) { return [...this.net.portals.values()].find((p) => p.spawnEdge === spawnEdge)?.id ?? this.servicePortals[0]; }

  /** Which inbound / outbound gate a household of this bungalow uses: the one on the shortest legal route. */
  gatesFor(house: number): { in: string; out: string } {
    const hit = this.gateCache.get(house);
    if (hit) return hit;
    const st = this.net.stallsByHouse.get(house);
    if (!st) return { in: '', out: '' };
    const portal = this.net.portals.get(this.visitorPortal)!;
    const pick = (dir: 'inbound' | 'outbound', from: string, to: string) => {
      let best = { id: '', len: Infinity };
      for (const g of this.net.gates.values()) {
        if (g.direction !== dir || g.staff) continue;
        const a = findRoute(this.net, from, g.edge, 'visitor'), b = a ? findRoute(this.net, g.edge, to, 'visitor') : null;
        if (!a || !b) continue;
        const len = this.traffic.routeLength([...a, ...b.slice(1)]);
        if (len < best.len) best = { id: g.id, len };
      }
      return best.id;
    };
    const res = { in: pick('inbound', portal.spawnEdge!, st.inEdge), out: pick('outbound', st.outEdge, portal.despawnEdge!) };
    this.gateCache.set(house, res);
    return res;
  }

  /** Patrol vans: replace the plain portal->portal route by portal -> turning circle -> portal once spawned. */
  private routePatrols() {
    for (const v of this.traffic.vehicles) {
      if (v.mission.type !== 'service' || v.mission.job !== 'patrol' || (v as Vehicle & { patrolRouted?: boolean }).patrolRouted) continue;
      if (v.ri !== 0) continue;
      const exit = this.net.portals.get(v.mission.exitPortal)!.despawnEdge!;
      const region = this.serviceRegion(this.portalOf(v.route[0]));
      const loops = this.patrolLoops.filter((l) => region.fwd.has(l) && this.serviceRegion(v.mission.type === 'service' ? v.mission.exitPortal : '').back.has(l));
      const pool = loops.length ? loops : this.patrolLoops;
      const loop = pool.length ? pool[Math.abs(hashStr(v.spec.id)) % pool.length] : '';
      const a = loop ? findRoute(this.net, v.route[0], loop, 'service') : null;
      const b = a ? findRoute(this.net, loop, exit, 'service') : null;
      if (a && b) {
        const s = v.s;
        const route = [...a, ...b.slice(1)];
        v.route = route; v.cum = []; let c = 0; for (const id of route) { v.cum.push(c); c += this.net.edges.get(id)!.line.length; }
        v.s = s; v.ri = 0;
      }
      (v as Vehicle & { patrolRouted?: boolean }).patrolRouted = true;
    }
  }

  averageSatisfaction() {
    const act = [...this.bookings.values()].filter((b) => b.status !== 'exited');
    if (!act.length) return 0.82;
    return act.reduce((a, b) => a + b.satisfaction, 0) / act.length;
  }

  serialize() {
    return JSON.stringify({ seq: this.seq, rng: this.rand.state(), serviceNext: this.serviceNext, bookings: [...this.bookings.values()], houses: [...this.houses.entries()], techJobs: [...this.techJobs.values()], traffic: this.traffic.serialize() });
  }
  restore(json: string) {
    const d = JSON.parse(json);
    this.seq = d.seq; this.rand.setState(d.rng); this.serviceNext = d.serviceNext;
    this.bookings = new Map(d.bookings.map((b: Booking) => [b.id, b]));
    this.houses = new Map(d.houses);
    this.techJobs = new Map((d.techJobs ?? []).map((j: TechJob) => [j.taskId, j]));
    this.traffic.restore(d.traffic);
  }
}

export type { Mission };
export { dist };

function hashStr(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
