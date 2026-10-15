import { loadNetwork } from '../src/sim/load.ts';
import { ParkSim } from '../src/sim/park.ts';
const net = loadNetwork();
console.log('edges', net.edges.size, 'zones', net.zones.length, 'stalls', net.stalls.size, 'gates', [...net.gates.keys()], 'houses', net.houses.length);
for (const v of net.validation) console.log(v.level, v.msg);
const tokens = new Set<string>();
const park = new ParkSim(net, {
  consumeToken: (vid, gid) => tokens.has(vid + gid) ? (tokens.delete(vid + gid), 'pass-' + vid) : null,
  onEvent: (t, p) => { if (!t.startsWith('booking')) console.log(park ? park.t.toFixed(1) : '', t, JSON.stringify(p)); },
  onQueued: (b, gid) => { setTimeoutSim(b.vehicleId, gid); },
}, 3);
const pendingAuth: { at: number; key: string }[] = [];
function setTimeoutSim(vid: string, gid: string) { pendingAuth.push({ at: park.t + 20, key: vid + gid }); }
park.seedOccupied(2);
park.scheduleArrival(); park.scheduleArrival();
for (let i = 0; i < 20 * 420; i++) {
  park.step(0.05);
  for (const p of pendingAuth.splice(0)) { if (p.at <= park.t) tokens.add(p.key); else pendingAuth.push(p); }
  if (i === 20 * 120) park.depart();
}
console.log(JSON.stringify(park.traffic.stats, null, 1).slice(0, 3000));
for (const v of park.traffic.vehicles) console.log(v.spec.id, v.state, v.route[v.ri], v.s.toFixed(1), v.lastWaitReason);
