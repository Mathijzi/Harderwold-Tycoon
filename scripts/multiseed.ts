import { runStress } from './stress.ts';
const seeds = process.argv.slice(3).map(Number);
const minutes = Number(process.argv[2] ?? 20);
let bad = 0;
for (const seed of seeds) {
  const r = runStress(minutes, seed, { quiet: true });
  const ok = r.collisions === 0 && r.illegalGateCrossings === 0 && r.wrongWay === 0 && r.maxGridlockSeconds < 30;
  if (!ok) bad++;
  console.log(`seed ${seed}: botsingen=${r.collisions} illegaal=${r.illegalGateCrossings} spook=${r.wrongWay} failsafe=${r.failsafeInterventions} cycli=${JSON.stringify(r.gateCycles)} vertrokken=${r.exited} langste_stilstand=${r.maxGridlockSeconds}s golfkar-taken=${r.techJobs}`);
}
console.log(bad ? `PROBLEMEN in ${bad} runs` : 'alle runs schoon');
