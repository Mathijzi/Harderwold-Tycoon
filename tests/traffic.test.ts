// Mandatory traffic acceptance tests (V3 spec, section "Mandatory traffic acceptance tests").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadNetwork, loadMapJson } from '../src/sim/load.ts';
import { ParkSim, Booking } from '../src/sim/park.ts';
import { Vehicle } from '../src/sim/traffic.ts';
import { obbOverlap } from '../src/shared/geom.ts';
import { runStress } from '../scripts/stress.ts';

const net = loadNetwork();

/** Park with an in-memory token store; tokens are only issued by calling authorize() (= a completed task). */
function harness(seed = 3) {
  const tokens = new Map<string, number>();
  const queued: { b: Booking; gate: string; t: number }[] = [];
  const events: { type: string; p: Record<string, unknown> }[] = [];
  let consumed = 0;
  const park = new ParkSim(net, {
    consumeToken: (vid, gid) => { const k = `${vid}|${gid}`; const n = tokens.get(k) ?? 0; if (n <= 0) return null; tokens.set(k, n - 1); consumed++; return `P-${vid}-${gid}`; },
    onEvent: (type, p) => events.push({ type, p }),
    onQueued: (b, gate) => queued.push({ b, gate, t: park.t }),
  }, seed);
  const authorize = (vid: string, gid: string) => tokens.set(`${vid}|${gid}`, (tokens.get(`${vid}|${gid}`) ?? 0) + 1);
  const run = (sec: number, each?: () => void) => { for (let i = 0; i < Math.round(sec / 0.05); i++) { park.step(0.05); each?.(); } };
  const veh = (id: string) => park.traffic.vehicles.find((v) => v.spec.id === id);
  return { park, tokens, queued, events, authorize, run, veh, consumedCount: () => consumed };
}
const lead = (h: ReturnType<typeof harness>, v: Vehicle, gid = 'gate-in') => h.park.traffic.pathPos(v) + v.spec.len / 2 - v.cum[v.route.indexOf(net.gates.get(gid)!.edge)];
// Harderwold has one access (barrier point by the hart): every villa uses gate-in / gate-out
const probe = new ParkSim(net, { consumeToken: () => null, onEvent: () => {}, onQueued: () => {} }, 1);
const via = (gin: string, gout?: string) => net.houses.map((x) => x.number).filter((n) => net.stallsByHouse.has(n) && probe.gatesFor(n).in === gin && (!gout || probe.gatesFor(n).out === gout));
const WEST = via('gate-in', 'gate-out');
const arriveAt = (h: ReturnType<typeof harness>, list: number[]) => {
  const free = new Set(h.park.vacantHouses());
  const n = list.find((x) => free.has(x));
  return h.park.scheduleArrival({ houseNumber: n })!;
};

test('1. arriving car stops before the CLOSED inbound gate, gets a check-in task, and never passes without it (2 h)', () => {
  const h = harness();
  const b = arriveAt(h, WEST);
  const g = net.gates.get('gate-in')!;
  let maxLead = -Infinity;
  h.run(2 * 3600, () => { const v = h.veh(b.vehicleId); if (v && v.ri >= v.route.indexOf(g.edge)) maxLead = Math.max(maxLead, lead(h, v)); });
  assert.equal(h.queued.length, 1, 'check-in task requested exactly once');
  assert.equal(h.queued[0].b.vehicleId, b.vehicleId);
  assert.ok(maxLead <= g.stopS + 0.01, `front bumper stayed before the stop line (max ${maxLead.toFixed(2)} vs ${g.stopS.toFixed(2)})`);
  assert.ok(maxLead > g.stopS - 1.5, 'and actually reached the stop line');
  assert.equal(h.park.traffic.gates.get('gate-in')!.phase, 'CLOSED');
  assert.equal(h.park.traffic.stats.illegalGateCrossings, 0);
});

test('2. completing that exact check-in opens the gate for ONLY that car; the second queued car does not tailgate', () => {
  const h = harness();
  const b1 = arriveAt(h, WEST), b2 = arriveAt(h, WEST);
  h.run(120);
  assert.equal(h.queued.length, 2);
  const phases: string[] = [h.park.traffic.gates.get('gate-in')!.phase];
  h.authorize(b1.vehicleId, 'gate-in');
  h.run(600, () => { const p = h.park.traffic.gates.get('gate-in')!.phase; if (phases[phases.length - 1] !== p) phases.push(p); });
  const v1 = h.veh(b1.vehicleId), v2 = h.veh(b2.vehicleId)!;
  assert.ok(!v1 || v1.passedGates.includes('gate-in'), 'first car passed');
  assert.ok(!v2.passedGates.includes('gate-in'), 'second car did NOT pass without its own check-in');
  assert.deepEqual(phases, ['CLOSED', 'OPENING', 'OPEN', 'CLOSING', 'CLOSED'], 'one full cycle, closed after clearance');
  assert.equal(h.park.traffic.gates.get('gate-in')!.queue[0], b2.vehicleId, 'second car is now head of the queue');
  h.authorize(b2.vehicleId, 'gate-in');
  h.run(120);
  assert.ok(h.veh(b2.vehicleId)!.passedGates.includes('gate-in'));
  assert.equal(h.park.traffic.stats.gateCycles['gate-in'], 2);
  assert.equal(h.park.traffic.stats.illegalGateCrossings, 0);
});

test('3. a departing car queues on the outbound lane; its check-out alone opens the outbound barrier', () => {
  const h = harness();
  h.park.seedOccupied(40);
  const occ = [...h.park.bookings.values()].find((x) => x.status === 'in_house' && probe.gatesFor(x.houseNumber).out === 'gate-out')!;
  const b = h.park.depart({ bookingId: occ.id })!;
  // the park is large (up to ~1.5 km to the barrier): wait until the car stands in the outbound queue
  for (let t = 0; t < 900 && !h.queued.length; t += 10) h.run(10);
  h.run(20);
  const v = h.veh(b.vehicleId)!;
  assert.equal(h.queued.length, 1);
  assert.equal(h.queued[0].gate, 'gate-out');
  assert.equal(v.route[v.ri], net.gates.get('gate-out')!.edge, 'waiting on the outbound lane');
  assert.equal(h.park.traffic.gates.get('gate-out')!.phase, 'CLOSED');
  assert.equal(h.park.traffic.gates.get('gate-in')!.phase, 'CLOSED', 'inbound barrier untouched');
  h.authorize(b.vehicleId, 'gate-in'); // wrong gate: must not help
  h.run(60);
  assert.ok(!v.passedGates.includes('gate-out'));
  h.authorize(b.vehicleId, 'gate-out');
  h.run(300);
  assert.equal(h.events.filter((e) => e.type === 'vehicle.exited' && e.p.vehicleId === b.vehicleId).length, 1, 'left the sector beyond the public approach');
  const opened = (gid: string) => h.events.filter((e) => e.type === 'gate.opening' && e.p.gateId === gid && e.p.vehicleId === b.vehicleId).length;
  assert.equal(opened('gate-out'), 1);
  assert.equal(opened('gate-in'), 0, 'the inbound barrier never opened for the departing car');
});

test('4. ten simultaneous arrivals use distinct queue slots or the off-screen buffer: no overlap, wrong way or public-road blockage', () => {
  const h = harness(9);
  const made: Booking[] = [];
  for (let i = 0; i < 10; i++) { const b = arriveAt(h, WEST); if (b) made.push(b); }
  assert.equal(made.length, 10);
  let maxQueue = 0, maxBuffered = 0;
  const g = net.gates.get('gate-in')!;
  h.run(300, () => {
    const gs = h.park.traffic.gates.get('gate-in')!;
    maxQueue = Math.max(maxQueue, gs.queue.length);
    maxBuffered = Math.max(maxBuffered, h.park.traffic.buffer.length);
    const slots = gs.queue.map((id) => h.veh(id)!.queue!.slot);
    assert.equal(new Set(slots).size, slots.length, 'distinct slots');
  });
  assert.ok(maxQueue <= g.queueSlots, `queue never exceeds ${g.queueSlots} slots (max ${maxQueue})`);
  assert.ok(maxBuffered >= 10 - g.queueSlots, 'surplus arrivals wait in the abstract off-screen buffer');
  const s = h.park.traffic.stats;
  assert.equal(s.collisions, 0); assert.equal(s.wrongWay, 0); assert.equal(s.illegalGateCrossings, 0);
  assert.equal(s.publicRoadStopSeconds, 0, 'nobody waits on the public road');
  // geometric check of the final state
  const vs = h.park.traffic.vehicles;
  for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) assert.ok(!obbOverlap(h.park.traffic.obbOf(vs[i]), h.park.traffic.obbOf(vs[j]), -0.02));
});

test('5. cars at intersections negotiate right of way; followers keep a safe gap', () => {
  const h = harness(5);
  h.park.seedOccupied(4);
  const arr = [h.park.scheduleArrival()!, h.park.scheduleArrival()!];
  let minGap = Infinity;
  const pending = new Set<string>();
  h.run(900, () => {
    for (const q of h.queued) if (!pending.has(q.b.vehicleId + q.gate)) { pending.add(q.b.vehicleId + q.gate); h.authorize(q.b.vehicleId, q.gate); }
    if (Math.abs(h.park.t - 60) < 0.03 || Math.abs(h.park.t - 75) < 0.03) h.park.depart();
    // bumper-to-bumper gap between consecutive cars on the same lane
    const byEdge = new Map<string, Vehicle[]>();
    for (const v of h.park.traffic.vehicles) if (v.state === 'driving') (byEdge.get(v.route[v.ri]) ?? byEdge.set(v.route[v.ri], []).get(v.route[v.ri])!).push(v);
    for (const list of byEdge.values()) {
      list.sort((a, b) => a.s - b.s);
      for (let i = 1; i < list.length; i++) minGap = Math.min(minGap, list[i].s - list[i - 1].s - (list[i].spec.len + list[i - 1].spec.len) / 2);
    }
  });
  const s = h.park.traffic.stats;
  assert.equal(s.collisions, 0); assert.equal(s.failsafeInterventions, 0, 'no emergency interventions needed');
  assert.ok(minGap > 0.25, `minimum following gap ${minGap.toFixed(2)} m`);
  for (const b of arr) assert.ok(['parked', 'in_house', 'departing'].includes(h.park.bookings.get(b.id)!.status), `${b.id} reached its bungalow`);
  assert.ok(h.events.filter((e) => e.type === 'vehicle.exited').length >= 2, 'departures crossed the junctions and left');
});

test('6. vehicles only use legal directed edges, stay on the network and park in their own stall', () => {
  const h = harness(11);
  const bs = [h.park.scheduleArrival()!, h.park.scheduleArrival()!, h.park.scheduleArrival()!];
  const seen = new Set<string>();
  h.run(700, () => {
    for (const q of h.queued) if (!seen.has(q.b.vehicleId)) { seen.add(q.b.vehicleId); h.authorize(q.b.vehicleId, q.gate); }
    for (const v of h.park.traffic.vehicles) {
      for (let i = 1; i < v.route.length; i++) assert.ok(net.edges.get(v.route[i - 1])!.next.includes(v.route[i]), `illegal transition ${v.route[i - 1]} -> ${v.route[i]}`);
      if (v.spec.kind === 'visitor') assert.ok(net.edges.get(v.route[v.ri])!.visitor, 'visitor on visitor-allowed edge');
    }
  });
  for (const b of bs) {
    const v = h.veh(b.vehicleId)!;
    const st = net.stalls.get(b.stallId)!;
    assert.equal(v.state, 'parked');
    assert.ok(Math.hypot(v.x - st.parkedPose.x, v.y - st.parkedPose.y) < 0.3, 'parked on its pad');
  }
  assert.equal(h.park.traffic.stats.wrongWay, 0);
  assert.equal(h.park.traffic.stats.collisions, 0);
});

test('8. reproducible 20-minute accelerated stress test: zero illegal crossings, collisions and wrong-way moves', () => {
  for (const seed of [42, 7]) {
    const r = runStress(20, seed, { quiet: true });
    assert.equal(r.collisions, 0, `seed ${seed} collisions`);
    assert.equal(r.illegalGateCrossings, 0, `seed ${seed} illegal`);
    assert.equal(r.wrongWay, 0, `seed ${seed} wrong way`);
    assert.ok(r.exited >= 10, `seed ${seed}: traffic keeps flowing through the whole park (${r.exited} exits)`);
    assert.ok(r.maxGridlockSeconds < 30, `seed ${seed}: no gridlock (longest standstill ${r.maxGridlockSeconds} s)`);
    assert.ok(r.techJobs >= 8, `seed ${seed}: golf carts exercised (${r.techJobs} jobs)`);
  }
});

test('10. full demo cycle: arrival -> queue -> check-in -> gate -> bungalow -> park -> depart -> queue -> check-out -> gate -> exit', () => {
  const h = harness(21);
  const b = h.park.scheduleArrival()!;
  const authorized = new Set<string>();
  let departed = false;
  h.run(1500, () => {
    for (const q of h.queued) if (!authorized.has(q.b.vehicleId + q.gate)) { authorized.add(q.b.vehicleId + q.gate); h.authorize(q.b.vehicleId, q.gate); }
    if (!departed && h.park.bookings.get(b.id)?.status === 'in_house') { departed = true; h.park.depart({ bookingId: b.id }); }
  });
  const statuses = b.history.map((x) => x.status);
  const want = ['arriving', 'queued_in', 'driving_in', 'parked', 'in_house', 'departing', 'queued_out', 'checked_out', 'exited'];
  let k = 0; for (const s of statuses) if (s === want[k]) k++;
  assert.equal(k, want.length, `lifecycle in order, got ${statuses.join(' > ')}`);
  assert.equal(h.consumedCount(), 2, 'exactly two passage tokens consumed (in + out)');
});

test('turn signals only for real turns: never in the bend towards the barrier, always into a parking stall', () => {
  const h = harness(4);
  for (let i = 0; i < 3; i++) arriveAt(h, WEST);
  let bendSamples = 0, bendSignals = 0, drvSamples = 0, drvSignals = 0;
  const g = net.gates.get('gate-in')!;
  h.run(400, () => {
    for (const q of h.queued) h.authorize(q.b.vehicleId, q.gate);
    for (const v of h.park.traffic.vehicles) {
      if (v.state !== 'driving' || v.v < 0.2) continue;
      const e = net.edges.get(v.route[v.ri])!;
      // approach and bend to the barrier; the last 35 m before the gate junction may announce the turn after it
      if (e.id === g.edge && v.s < Math.min(g.stopS + 25, e.line.length - 35)) { bendSamples++; if (v.signal) bendSignals++; }
      if (e.kind === 'driveway') { drvSamples++; if (v.signal !== 0) drvSignals++; }
    }
  });
  assert.ok(bendSamples > 100);
  assert.equal(bendSignals, 0, 'no indicator on the approach and bend to the barrier');
  assert.ok(drvSamples > 20 && drvSignals === drvSamples, 'indicator on when turning into the stall');
});

// ---------------------------------------------------------------- whole park: one access, dead ends, service passes
test('whole park: every villa has its own stall and a legal route in and out through exactly one barrier each way', () => {
  assert.ok(net.houses.length >= 330, `all villas of the plan (${net.houses.length})`);
  const inGates = new Set([...net.gates.values()].filter((g) => g.direction === 'inbound').map((g) => g.edge));
  const outGates = new Set([...net.gates.values()].filter((g) => g.direction === 'outbound').map((g) => g.edge));
  const W = net.portals.get(probe.visitorPortal)!;
  const without = net.houses.filter((x) => !net.stallsByHouse.has(x.number)).map((x) => x.number);
  assert.ok(without.length <= 5, `at most a handful of villas without a stall (map editor): ${without.join(', ')}`);
  for (const hs of net.houses) {
    const st = net.stallsByHouse.get(hs.number);
    if (!st) continue;
    const g = probe.gatesFor(hs.number);
    assert.ok(g.in === 'gate-in' && g.out === 'gate-out', `gates for ${hs.number}: ${g.in}/${g.out}`);
    const r1 = probe.traffic.planRoute(W.spawnEdge!, st!.inEdge, { type: 'arrive', bookingId: 'x', stallId: st!.id, gateId: g.in }, { id: 'x', kind: 'visitor', model: 'hatch', len: 4.2, wid: 1.8, color: '#fff', plate: '' } as any)!;
    const r2 = probe.traffic.planRoute(st!.outEdge, W.despawnEdge!, { type: 'depart', bookingId: 'x', stallId: st!.id, gateId: g.out, portal: probe.visitorPortal }, { id: 'x', kind: 'visitor', model: 'hatch', len: 4.2, wid: 1.8, color: '#fff', plate: '' } as any)!;
    assert.ok(r1 && r2, `routes for ${hs.number}`);
    assert.equal(r1.filter((e) => inGates.has(e)).length, 1, `${hs.number}: one inbound barrier`);
    assert.equal(r1.filter((e) => outGates.has(e)).length, 0);
    assert.equal(r2.filter((e) => outGates.has(e)).length, 1, `${hs.number}: one outbound barrier`);
    assert.equal(r2.filter((e) => inGates.has(e)).length, 0);
  }
  assert.equal(WEST.length, net.houses.filter((x) => net.stallsByHouse.has(x.number)).length, 'all villas use the one access');
});

test('every lane continues: dead-end villa streets end in a turning loop, nobody needs to reverse onto a street', () => {
  const stuck = net.validation.filter((v) => v.msg.includes('geen vervolg'));
  assert.deepEqual(stuck.map((v) => v.msg), []);
  const { net: json } = loadMapJson();
  const dead = Object.entries(json.nodes).filter(([, n]) => n.kind === 'deadend');
  assert.ok(dead.length >= 10, `turning loops at the end of the villa streets (${dead.length})`);
  for (const [id] of dead) assert.ok([...net.edges.values()].some((e) => e.kind === 'loop' && e.from === id), `turning loop at ${id}`);
});

test('the inbound queue fits on the entrance road and never reaches back to the public road', () => {
  const g = net.gates.get('gate-in')!;
  assert.ok(g.queueSlots >= 5, `room for ${g.queueSlots} cars`);
  assert.ok(g.slotS[g.slotS.length - 1] > g.slotSpacing, 'the last slot still lies on the entrance road');
  assert.equal(net.edges.get(g.edge)!.cls, 'arrival');
});

test('service vehicles bypass both visitor barriers on the service roads (never queueing between check-ins) and open the staff barrier only with a staff pass', () => {
  const passes: string[] = [];
  const h = (() => {
    const tokens = new Map<string, number>();
    const park = new ParkSim(net, {
      consumeToken: (vid, gid) => { const k = `${vid}|${gid}`; const n = tokens.get(k) ?? 0; if (n <= 0) return null; tokens.set(k, n - 1); return `P-${vid}`; },
      servicePass: (vid, gid) => { passes.push(`${vid}@${gid}`); return `S-${vid}-${gid}`; },
      onEvent: () => {}, onQueued: () => {},
    }, 17);
    return { park, tokens };
  })();
  h.park.seedService();
  const lanes = new Set<string>();
  for (let i = 0; i < 2400 * 20; i++) {
    h.park.step(0.05);
    if (i % 2400 === 0) { const b = h.park.scheduleArrival(); void b; }
    for (const v of h.park.traffic.vehicles.values()) {
      if (!/^(svc|tdkar)/.test(v.spec.id)) continue;
      const road = String(v.route[v.ri] ?? '').split(':')[0];
      if (road.startsWith('dienst') || road === 'td-pad') lanes.add(road);
      assert.ok(![...net.gates.values()].some((g) => !g.staff && g.edge.split(':')[0] === road), `${v.spec.id} drives on visitor barrier road ${road}`);
    }
    // visitors never come near the staff road
    for (const v of h.park.traffic.vehicles.values()) if (v.spec.kind === 'visitor') assert.ok(!/^(dienstweg|td-pad)/.test(String(v.route[v.ri] ?? '')), `${v.spec.id} on a service road`);
  }
  const staffGates = new Set([...net.gates.values()].filter((g) => g.staff).map((g) => g.id));
  assert.equal(staffGates.size, 2, 'staff barrier on the staff road (one arm per lane)');
  assert.ok(passes.length > 0, 'service vehicles crossed the staff barrier');
  assert.deepEqual(passes.filter((p) => !staffGates.has(p.split('@')[1])), [], 'no service vehicle needed a pass through a visitor barrier');
  assert.ok(lanes.has('dienstweg-zuid') && lanes.has('dienstweg-loods'), `service lanes used: ${[...lanes].join(', ')}`);
  assert.equal(h.park.traffic.stats.illegalGateCrossings, 0);
  assert.equal(h.park.traffic.stats.collisions, 0);
});

test('stalls: turning in from and reversing out to the opposite lane (no detour via a turning point); lane traffic always has priority', () => {
  const two = [...net.stalls.values()].filter((s) => s.kind !== 'spare' && !net.edges.get(net.edges.get(s.inEdge)!.prev[0] ?? '')?.oneway);
  const cross = two.filter((s) => s.inEdges.length > 1 && s.outEdges.length > 1);
  assert.ok(cross.length >= two.length * 0.8, `cross movements for ${cross.length} of ${two.length} stalls on two-way roads`);
  assert.ok([...net.stalls.values()].filter((s) => s.kind === 'depot').every((s) => s.inEdges.length > 1 && s.outEdges.length > 1), 'TD golf carts can turn left directly');
  const park = new ParkSim(net, { consumeToken: (v: string) => `p-${v}`, onEvent: () => {}, onQueued: () => {} } as any, 11);
  park.seedOccupied(30); park.seedService();
  const crossEdge = (id: string) => /^(DX|RX|XO):/.test(id);
  const was = new Map<string, string>();
  let usedIn = 0, usedOut = 0;
  for (let i = 0; i < 20 * 60 * 20; i++) {
    park.step(0.05);
    if (i % 400 === 0) park.scheduleArrival();
    if (i % 700 === 0) park.depart({});
    for (const v of park.traffic.vehicles) {
      const e = String(v.route[v.ri] ?? ''), prev = was.get(v.spec.id);
      was.set(v.spec.id, e);
      if (!crossEdge(e) || prev === e || (prev && crossEdge(prev))) continue;
      if (e.startsWith('DX')) usedIn++; else if (e.startsWith('RX')) usedOut++;
      // the moment a vehicle starts to cross: no lane vehicle may be coming up to the crossing within the gap time
      if ((v.waitStart !== undefined ? park.traffic.t - v.waitStart : 0) >= 30) continue; // anti-deadlock rule after 30 s
      const start = net.edges.get(e)!.line.sample(0);
      for (const o of park.traffic.vehicles) {
        if (o === v || o.v < 1.5 || net.edges.get(String(o.route[o.ri]))?.kind !== 'lane') continue;
        const dx = start.x - o.x, dy = start.y - o.y, dd = Math.hypot(dx, dy);
        const towards = (dx * Math.cos(o.heading) + dy * Math.sin(o.heading)) / (dd || 1);
        assert.ok(!(towards > 0.5 && dd / o.v < 2.0 && dd < 14), `${v.spec.id} started ${e} while ${o.spec.id} was ${dd.toFixed(1)} m away at ${o.v.toFixed(1)} m/s`);
      }
    }
  }
  assert.ok(usedIn > 0 && usedOut > 0, `cross movements used: in ${usedIn}, out ${usedOut}`);
  assert.equal(park.traffic.stats.collisions, 0);
  assert.equal(park.traffic.stats.wrongWay, 0);
});
