// Guests (Hilversum media households) and storylines: valid library, seeded households, a full storyline through the
// regular task API, and the bad endings (chapter not picked up, household leaves).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORIES, validateStories, makeHousehold, CELEBRITIES, MEDIA_ROLES } from '../src/shared/guestlib.ts';
import { templateByCode, TEMPLATES } from '../src/shared/tasklib.ts';
import { rng } from '../src/shared/geom.ts';
import { Game, GameConfig } from '../src/server/game.ts';

const cfg = (extra: Partial<GameConfig> = {}): GameConfig => ({ dbPath: ':memory:', gameCode: 'TEST', adminKey: 'adm', seed: 4, timeScale: 1, initialOccupied: 40, demoBot: false, autoArrivals: false, ...extra });
const steps = (g: Game, sec: number) => { for (let i = 0; i < Math.round(sec / 0.05); i++) g.simStep(0.05); };

test('guests: storyline library is valid, story tasks are never scheduled on their own, households are seeded and themed', () => {
  assert.deepEqual(validateStories(templateByCode), []);
  assert.ok(STORIES.length >= 12);
  assert.ok(TEMPLATES.filter((t) => t.storyOnly).every((t) => t.weight === 0), 'story tasks only come from a storyline');
  const a = makeHousehold(rng(42)), b = makeHousehold(rng(42));
  assert.deepEqual(a, b, 'same seed, same household');
  let celebs = 0;
  for (let i = 0; i < 2000; i++) {
    const h = makeHousehold(rng(i * 7 + 1));
    assert.ok(h.guests.length >= 1 && h.guests.length <= 5);
    assert.ok(!/Microfoon|Zendmast|Autocue/.test(h.household.name), 'no silly made-up surnames');
    if (h.household.celebrity) { celebs++; assert.ok(CELEBRITIES.some((c) => c.key === h.household.celebrity)); assert.ok(MEDIA_ROLES.includes(h.guests[0].role)); continue; }
    assert.match(h.household.name, /^Familie /);
  }
  assert.ok(celebs > 1500, `most households are BN'ers (${celebs}/2000)`);
  // each BN'er at most once in the park: with all of them taken, the next household is an ordinary family
  const all = new Set(CELEBRITIES.map((c) => c.key));
  assert.equal(makeHousehold(rng(5), all).household.celebrity, undefined);
  // storylines never put an invented conflict on a real person
  for (const s of STORIES) if (s.celebrities) for (const k of s.celebrities) if (k !== '*') assert.ok(CELEBRITIES.some((c) => c.key === k), s.code);
  assert.ok(STORIES.find((s) => s.code === 'STORY_TALKSHOW_FEUD')!.noRealPeople);
});

test('stories: a storyline runs chapter by chapter through claim/complete and ends well; a missed chapter or departure ends it', () => {
  const g = new Game(cfg());
  g.setSchedulerConfig({ enabled: false });
  g.setStoryConfig({ enabled: false });
  const players = g.db.prepare('SELECT * FROM players WHERE is_test = 1').all() as any[];
  const s = g.startStory({});
  assert.equal(s.state, 'active'); assert.equal(s.chapter, 1); assert.ok(s.taskId);
  const bookingHouse = s.houseNumber;
  assert.ok(g.bookingsDto().find((b: any) => b.houseNumber === bookingHouse && b.story?.id === s.id), 'booking shows its story');
  for (let ch = 1; ch <= s.chapters; ch++) {
    const cur = g.stories.list().find((x) => x.id === s.id)!;
    assert.equal(cur.chapter, ch);
    const tid = cur.taskId!;
    const p = players[ch % players.length];
    assert.equal(g.claim(tid, p, `sc-${ch}`).status, 200);
    // a chapter at the bungalow may need the TD mechanic on site first
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) { try { ok = g.complete(tid, p, `sd-${ch}-${i}`).status === 200; } catch (e: any) { if (e.code !== 'technician_not_on_site') throw e; steps(g, 15); } }
    assert.ok(ok, `chapter ${ch} completed`);
    steps(g, 31 * 60);
  }
  const done = g.stories.list(true).find((x) => x.id === s.id)!;
  assert.equal(done.state, 'completed'); assert.ok(done.endText);
  // bad ending 1: nobody picks up the chapter in time
  const s2 = g.startStory({});
  steps(g, 41 * 60);
  const f2 = g.stories.list(true).find((x) => x.id === s2.id)!;
  assert.equal(f2.state, 'failed'); assert.equal(f2.outcome, 'expired');
  // bad ending 2: the household leaves; its open chapter task is withdrawn
  const s3 = g.startStory({});
  g.park.depart({ houseNumber: s3.houseNumber });
  steps(g, 15);
  const f3 = g.stories.list(true).find((x) => x.id === s3.id)!;
  assert.equal(f3.state, 'failed'); assert.equal(f3.outcome, 'household_left');
  assert.equal(g.getTask(s3.taskId!)!.state, 'cancelled');
  const evs = g.eventsAfter(0, 5000).map((e: any) => e.type);
  for (const k of ['story.started', 'story.chapter', 'story.ended']) assert.ok(evs.includes(k), k);
  g.db.close();
});

test('stories: the director starts storylines by itself in daytime and respects the maximum', () => {
  const g = new Game(cfg());
  g.setSchedulerConfig({ enabled: false });
  g.setStoryConfig({ enabled: true, perHourDay: 20, maxActive: 2 });
  // make it daytime for the director regardless of the wall clock
  (g.scheduler as any).isDay = () => true;
  steps(g, 30 * 60);
  const act = g.stories.list();
  assert.ok(act.length >= 1 && act.length <= 2, `active ${act.length}`);
  assert.equal(new Set(act.map((x) => x.houseNumber)).size, act.length, 'one storyline per household');
  g.db.close();
});
