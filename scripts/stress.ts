// Reproducible accelerated traffic stress test (acceptance test 8).
// Usage: node --import tsx scripts/stress.ts [minutes=20] [seed=42]
import { writeFileSync, mkdirSync } from 'node:fs';
import { loadNetwork } from '../src/sim/load.ts';
import { ParkSim } from '../src/sim/park.ts';

export function runStress(minutes = 20, seed = 42, opts: { quiet?: boolean } = {}) {
  const net = loadNetwork();
  const tokens = new Map<string, string>();
  const used = new Set<string>();
  let pid = 0;
  const pending: { at: number; vid: string; gid: string }[] = [];
  const counters = { techJobs: 0, queued: 0, tokensIssued: 0, tokensConsumed: 0, arrivalsScheduled: 0, departures: 0, exited: 0, parked: 0, gateOpenings: 0 };
  const events: string[] = [];
  const park: ParkSim = new ParkSim(net, {
    servicePass: (vid) => `svc-pass-${vid}-${++pid}`,
    consumeToken: (vid, gid) => {
      const k = `${vid}|${gid}`;
      const t = tokens.get(k);
      if (!t || used.has(t)) return null;
      used.add(t); tokens.delete(k); counters.tokensConsumed++;
      return t;
    },
    onEvent: (type) => {
      if (type === 'vehicle.exited') counters.exited++;
      if (type === 'vehicle.parked') counters.parked++;
      if (type === 'gate.opening') counters.gateOpenings++;
      if (type.startsWith('gate.') || type.startsWith('vehicle.')) events.push(`${park.t.toFixed(1)} ${type}`);
    },
    onQueued: (b, gid) => {
      counters.queued++;
      // a player completes the task after 8-90 s (random, seeded)
      pending.push({ at: park.t + park.rand.range(8, 90), vid: b.vehicleId, gid });
    },
  }, seed);
  park.seedOccupied(4);
  park.seedService();
  let nextTech = 30, techSeq = 0; const techOpen: { id: string; until: number }[] = [];
  const focus = net.houses.filter((h) => h.focus).map((h) => h.number);
  const dt = 0.05;
  const steps = Math.round((minutes * 60) / dt);
  let nextArrival = 5, nextDeparture = 60;
  let frozen = 0, maxFrozen = 0;
  for (let i = 0; i < steps; i++) {
    park.step(dt);
    // gridlock metric: vehicles waiting for each other while nothing moves
    const drv = park.traffic.vehicles.filter((v) => v.state === 'driving');
    const moving = drv.some((v) => v.v > 0.05);
    const blocked = drv.filter((v) => /achter|wacht op|bezet|kan niet/.test(v.lastWaitReason ?? '')).length;
    if (!moving && blocked >= 2) { frozen += dt; maxFrozen = Math.max(maxFrozen, frozen); } else frozen = 0;
    for (let j = pending.length - 1; j >= 0; j--) if (pending[j].at <= park.t) {
      const p = pending.splice(j, 1)[0];
      tokens.set(`${p.vid}|${p.gid}`, `pass-${++pid}`); counters.tokensIssued++;
    }
    // bursts: occasionally 3-5 arrivals at once, otherwise single
    if (park.t >= nextArrival) {
      const burst = park.rand.next() < 0.3 ? park.rand.int(3, 5) : 1;
      for (let b = 0; b < burst; b++) if (park.scheduleArrival()) counters.arrivalsScheduled++;
      nextArrival = park.t + park.rand.range(25, 90);
    }
    if (park.t >= nextTech) {
      const id = `TJ${++techSeq}`;
      if (park.dispatchTechnician(id, park.rand.pick(focus))) { techOpen.push({ id, until: park.t + park.rand.range(40, 160) }); counters.techJobs++; }
      nextTech = park.t + park.rand.range(45, 120);
    }
    // a player can only complete once the mechanic is on site; after a long wait the claim expires (released anyway)
    for (let j = techOpen.length - 1; j >= 0; j--) {
      const o = techOpen[j];
      if (o.until > park.t) continue;
      if (park.techStatus(o.id)?.onSite || park.t > o.until + 480) { park.releaseTechnician(o.id); techOpen.splice(j, 1); }
    }
    if (park.t >= nextDeparture) {
      const burst = park.rand.next() < 0.3 ? 3 : 1;
      for (let b = 0; b < burst; b++) if (park.depart()) counters.departures++;
      nextDeparture = park.t + park.rand.range(40, 110);
    }
  }
  const s = park.traffic.stats;
  const report = {
    seed, simulatedMinutes: minutes, ticks: s.ticks,
    collisions: s.collisions, illegalGateCrossings: s.illegalGateCrossings, wrongWay: s.wrongWay,
    failsafeInterventions: s.failsafeInterventions, hardGateStops: s.hardGateStops, publicRoadStopSeconds: +s.publicRoadStopSeconds.toFixed(1),
    maxQueue: s.maxQueue, gateCycles: s.gateCycles, ...counters,
    tokensLeftUnused: tokens.size,
    maxGridlockSeconds: +maxFrozen.toFixed(1),
    vehiclesStillActive: park.traffic.vehicles.map((v) => `${v.spec.id}:${v.state}:${v.route[v.ri]}:${v.lastWaitReason ?? ''}`),
    buffer: park.traffic.buffer.length,
    techJobsOpenAtEnd: [...park.techJobs.values()].map((j) => `${j.taskId}:${j.phase}`),
    log: s.log.slice(-30),
  };
  if (!opts.quiet) {
    mkdirSync('reports', { recursive: true });
    writeFileSync(`reports/stress_seed${seed}_${minutes}min.json`, JSON.stringify(report, null, 2));
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const minutes = Number(process.argv[2] ?? 20), seed = Number(process.argv[3] ?? 42);
  const t0 = Date.now();
  const r = runStress(minutes, seed);
  console.log(JSON.stringify(r, null, 2));
  console.log(`klaar in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
