// Task library + scheduler (V3: 100+ validated templates in 10 groups; 2-4 normal tasks per daytime hour, fewer at
// night, 1-3 major incidents per day over seeded 48 h runs; escalations bounded; crises with independent subtasks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, CRISES, validateLibrary, templateByCode } from '../src/shared/tasklib.ts';
import { Scheduler } from '../src/sim/scheduler.ts';
import { Game, GameConfig, pointsFor } from '../src/server/game.ts';
import { loadMapJson } from '../src/sim/load.ts';

const cfg = (extra: Partial<GameConfig> = {}): GameConfig => ({ dbPath: ':memory:', gameCode: 'TEST', adminKey: 'adm', seed: 4, timeScale: 1, initialOccupied: 12, demoBot: false, autoArrivals: false, ...extra });
const steps = (g: Game, sec: number) => { for (let i = 0; i < Math.round(sec / 0.05); i++) g.simStep(0.05); };

test('library: at least 100 distinct schedulable templates, 10 per group, every field valid against the map', () => {
  const facilityKeys = new Set((loadMapJson().sector.facilities as { key: string }[]).map((f) => f.key));
  assert.deepEqual(validateLibrary(facilityKeys), []);
  const normal = TEMPLATES.filter((t) => !t.crisisOnly && t.weight > 0);
  assert.ok(new Set(normal.map((t) => t.code)).size >= 100, `${normal.length} schedulable templates`);
  const groups = new Map<string, number>();
  for (const t of normal) groups.set(t.group, (groups.get(t.group) ?? 0) + 1);
  assert.equal(groups.size, 10);
  for (const [g, n] of groups) assert.ok(n >= 10, `group ${g}: ${n}`);
  for (const t of TEMPLATES) assert.ok(pointsFor(t.difficulty, t.urgency) > 0 && pointsFor(t.difficulty, t.urgency) % 5 === 0, t.code);
  assert.ok(CRISES.length >= 5);
  for (const c of ['CRISIS_WATER_MAIN', 'CRISIS_BLACKOUT', 'CRISIS_CHECKIN', 'CRISIS_POOL_CLOSED', 'CRISIS_MASCOT']) assert.ok(CRISES.some((x) => x.code === c), c);
});

test('scheduler: seeded 48 h runs give 2-4 normal tasks per daytime hour, fewer at night, 1-3 crises per day, cooldowns respected', () => {
  const houses = Array.from({ length: 341 }, (_, i) => `H${i + 1}`);
  const facilities = new Map('ACDEFGHIJKLMOQRSTUVWXYZ'.split('').map((k) => [k, [`F-${k}`]]));
  let dayRate = 0, nightRate = 0, majorsTotal = 0, days = 0;
  const seeds = [1, 2, 3, 4, 5, 6];
  for (const seed of seeds) {
    const s = new Scheduler({}, seed);
    const last = new Map<string, number>();
    const open: { loc: string; until: number }[] = [];
    let dN = 0, nN = 0, dMin = 0, nMin = 0;
    const perDay = [0, 0];
    for (let m = 0; m < 48 * 60; m++) {
      const hour = (m / 60) % 24;
      for (let i = open.length - 1; i >= 0; i--) if (open[i].until <= m) open.splice(i, 1);
      const r = s.tick({ nowMin: m, hour, dayIndex: Math.floor(m / 1440), occupied: houses.slice(0, 170), vacant: houses.slice(170), houses, facilities, occupancy: 0.5, openNormal: open.length, busy: new Set(open.map((o) => o.loc)), lastAt: (c, l) => last.get(l ? `${c}|${l}` : c) }, 1);
      for (const x of r.normal) {
        const prev = last.get(`${x.code}|${x.location}`);
        assert.ok(prev === undefined || m - prev >= templateByCode.get(x.code)!.cooldownMin, `${x.code} at ${x.location} within its cooldown`);
        last.set(x.code, m); last.set(`${x.code}|${x.location}`, m); open.push({ loc: x.location, until: m + 20 });
        if (s.isDay(hour)) dN++; else nN++;
      }
      if (r.major) { last.set(r.major.code, m); last.set(`${r.major.code}|${r.major.location}`, m); perDay[Math.floor(m / 1440)]++; }
      if (s.isDay(hour)) dMin++; else nMin++;
    }
    for (const n of perDay) assert.ok(n <= 3, `at most 3 crises a day (seed ${seed}: ${perDay})`);
    dayRate += dN / (dMin / 60); nightRate += nN / (nMin / 60); majorsTotal += perDay[0] + perDay[1]; days += 2;
  }
  dayRate /= seeds.length; nightRate /= seeds.length;
  assert.ok(dayRate >= 2 && dayRate <= 4, `daytime ${dayRate.toFixed(2)} per hour`);
  assert.ok(nightRate < dayRate / 2, `night ${nightRate.toFixed(2)} per hour`);
  const majorsPerDay = majorsTotal / days;
  assert.ok(majorsPerDay >= 1 && majorsPerDay <= 3, `${majorsPerDay.toFixed(2)} crises per day`);
});

test('game: library incidents get a location, copy and points; completion improves the location; flood cap holds', () => {
  const g = new Game(cfg());
  const t = g.createIncident({ template: 'POOL_SLIPPERY_FLOOR' });
  assert.equal(t.locationId, 'F-J');
  assert.match(t.description, /douches/);
  assert.equal(t.points, pointsFor('easy', 'high'));
  const h = g.createIncident({ template: 'HK_MUDDY_FLOOR', houseNumber: 501 });
  assert.equal(h.locationId, 'H501'); assert.match(h.title, /\(501\)/); assert.match(h.description, /bungalow 501/);
  assert.throws(() => g.createIncident({ template: 'NOPE' }), (e: any) => e.status === 422);
  // completion effect on the location (via the regular API)
  const p = g.db.prepare("SELECT * FROM players WHERE display_name = 'Sanne'").get() as any;
  const before = g.locations().find((l: any) => l.id === 'F-J') as any;
  g.claim(t.id, p, 'k-claim-1'); g.complete(t.id, p, 'k-done-1');
  const after = g.locations().find((l: any) => l.id === 'F-J') as any;
  assert.ok(after.condition.mood > before.condition.mood, 'pool mood went up');
  assert.ok(g.parkSummary().health.overall > 0);
  // flood protection: the scheduler never pushes the number of open normal tasks over maxOpen
  g.setSchedulerConfig({ normalPerHourDay: 20, nightFactor: 1, maxOpen: 6 });
  steps(g, 3600);
  const open = (g.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE kind = 'incident' AND parent_id IS NULL AND state IN ('offered','claimed')").get() as any).n;
  assert.ok(open <= 6, `${open} open`);
  assert.throws(() => g.setSchedulerConfig({ maxOpen: 0 }), (e: any) => e.status === 422);
  g.db.close();
});

test('game: unclaimed tasks expire with timeout effects and escalate once (bounded); claimed timeouts reoffer', () => {
  const g = new Game(cfg());
  g.setSchedulerConfig({ enabled: false });
  const t = g.createIncident({ template: 'MAINT_LEAKING_TAP', houseNumber: 554 });
  steps(g, 46 * 60); // offered for longer than offeredMaxMin (45 game minutes)
  const row = g.getTask(t.id)!;
  assert.equal(row.state, 'expired');
  const follow = g.db.prepare("SELECT * FROM tasks WHERE template = 'MAINT_WATER_DAMAGE' AND location_id = 'H554'").all() as any[];
  assert.equal(follow.length, 1, 'one escalation to water damage');
  assert.equal(follow[0].depth, 1);
  steps(g, 46 * 60); // the follow-up expires as well, but has no further escalation
  assert.equal((g.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE location_id = 'H554' AND kind = 'incident'").get() as any).n, 2, 'no runaway chain');
  // claimed timeout -> reoffered (attempt + 1), not expired
  const c = g.createIncident({ template: 'HK_MISSING_TOWELS', houseNumber: 555 });
  const p = g.db.prepare("SELECT * FROM players WHERE display_name = 'Tom'").get() as any;
  g.claim(c.id, p, 'k-claim-2');
  steps(g, 11 * 60);
  const cr = g.getTask(c.id)!;
  assert.equal(cr.state, 'offered'); assert.equal(cr.attempt, 2);
  g.db.close();
});

test('game: a crisis is a process: reports follow each other over time, the status panel tracks it, it resolves when all are done', () => {
  const g = new Game(cfg());
  g.setSchedulerConfig({ enabled: false });
  g.setStoryConfig({ enabled: false });
  const c = g.createCrisis({ code: 'CRISIS_POOL_CLOSED' });
  assert.equal(c.state, 'active'); assert.equal(c.tasks.length, 1, 'starts with one report, not all at once');
  assert.throws(() => g.createCrisis({ code: 'CRISIS_POOL_CLOSED' }), (e: any) => e.status === 409, 'not twice at the same time');
  const st0 = g.crisisStatus()[0];
  assert.equal(st0.total, 5); assert.equal(st0.stages, 5); assert.ok(st0.nextAt! > st0.startedAt);
  const players = g.db.prepare('SELECT * FROM players WHERE is_test = 1').all() as any[];
  let maxOpen = 0, k = 0;
  for (let min = 0; min < 70 && g.incidentDto(c.id).state === 'active'; min++) {
    const now = g.incidentDto(c.id);
    maxOpen = Math.max(maxOpen, now.tasks.filter((t: any) => t.state === 'offered').length);
    for (const t of now.tasks.filter((x: any) => x.state === 'offered')) {
      const p = players[k++ % players.length];
      assert.equal(g.claim(t.id, p, `cc-${t.id}`).status, 200); assert.equal(g.complete(t.id, p, `cd-${t.id}`).status, 200);
    }
    steps(g, 60);
  }
  const done = g.incidentDto(c.id);
  assert.equal(done.state, 'resolved'); assert.equal(done.tasks.length, 5);
  assert.ok(maxOpen <= 1, 'reports arrive one after another');
  assert.equal(g.crisisStatus().length, 0, 'status panel cleared once resolved');
  const evs = g.eventsAfter(0, 5000).map((e: any) => e.type);
  for (const kk of ['incident.started', 'incident.escalated', 'incident.resolved']) assert.ok(evs.includes(kk), kk);
  g.db.close();
});

test('library: every crisis is a process of 4-8 reports over at least 40 minutes', () => {
  for (const c of CRISES) {
    const n = c.stages.reduce((a, s) => a + s.tasks.length, 0);
    assert.ok(n >= 4 && n <= 8, `${c.code}: ${n} reports`);
    assert.ok(c.stages[c.stages.length - 1].afterMin >= 40, `${c.code} lasts long enough`);
    assert.ok(c.stages[0].tasks.length <= 2, `${c.code} starts with at most two reports`);
  }
  assert.ok(CRISES.length >= 10);
});
