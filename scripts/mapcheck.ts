// Bouwt het wegennet uit data/map en toont de validatie (aantallen, waarschuwingen). Gebruik: node --import tsx scripts/mapcheck.ts
import { loadNetwork } from '../src/sim/load.ts';
const t0 = Date.now();
const net = loadNetwork();
console.log(`opgebouwd in ${Date.now() - t0} ms: ${net.edges.size} rijstroken/verbindingen, ${net.zones.length} conflictzones, ${net.stalls.size} parkeervakken, ${net.houses.length} huizen, ${net.gates.size} slagbomen`);
const noStall = net.houses.filter((h) => !net.stallsByHouse.has(h.number)).map((h) => h.number);
console.log(`huizen zonder vak (${noStall.length}): ${noStall.join(', ')}`);
const by = new Map<string, number>();
for (const v of net.validation) { const k = `${v.level}: ${v.msg.replace(/[0-9.]+/g, '#').slice(0, 70)}`; by.set(k, (by.get(k) ?? 0) + 1); }
for (const [k, n] of [...by].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(4)}  ${k}`);
if (process.argv.includes('-v')) for (const v of net.validation) console.log(v.level, v.msg);
