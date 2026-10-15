// Games: start a new game (own name/code, with or without demo players), save the running game, load another one
// (the running game is saved first), move a saved game via a file. Gates keep their token rule after a load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, GameConfig } from '../src/server/game.ts';

const cfg = (extra: Partial<GameConfig> = {}): GameConfig => ({ dbPath: ':memory:', gameCode: 'TEST', adminKey: 'adm', seed: 4, timeScale: 1, initialOccupied: 12, demoBot: false, autoArrivals: false, ...extra });
const steps = (g: Game, sec: number) => { for (let i = 0; i < Math.round(sec / 0.05); i++) g.simStep(0.05); };

test('games: new game, save, load and file round trip restore scores, tasks, traffic and settings', () => {
  const g = new Game(cfg());
  g.setSchedulerConfig({ enabled: false });
  assert.throws(() => g.newGame({ name: 'x', code: 'ABCD' }), (e: any) => e.code === 'invalid_name');
  assert.throws(() => g.newGame({ name: 'Teamuitje', code: 'a b' }), (e: any) => e.code === 'invalid_code');
  g.newGame({ name: 'Teamuitje', code: 'zomer25', demoPlayers: false, initialOccupied: 20, seed: 9 });
  assert.equal(g.gameInfo().code, 'ZOMER25');
  assert.equal(g.leaderboard().length, 0, 'no demo players');
  assert.throws(() => g.join('HARDER', 'Piet'), (e: any) => e.code === 'bad_game_code');
  const { playerId } = g.join('ZOMER25', 'Piet') as any;
  g.adjustScore(playerId, 120, 'startbonus');
  steps(g, 20);
  const saved = g.saveGame('Na ronde 1');
  assert.equal(saved.players, 1); assert.equal(saved.gameName, 'Teamuitje'); assert.ok(saved.sameMap);
  const tAtSave = g.park.t, vehAtSave = g.park.traffic.vehicles.length;
  // play on, change things
  g.adjustScore(playerId, 30, 'extra');
  g.setDisplay({ popupSeconds: 40 });
  steps(g, 30);
  // a second game in between
  g.newGame({ name: 'Andere groep', code: 'HERFST', demoPlayers: true, initialOccupied: 5 });
  assert.equal(g.leaderboard().length, 10);
  assert.ok(g.listSaves().some((s) => s.auto && s.name.includes('Andere groep')), 'running game saved before new game');
  // load the first save
  g.loadGame(saved.id);
  assert.equal(g.gameInfo().name, 'Teamuitje'); assert.equal(g.gameInfo().code, 'ZOMER25');
  assert.equal(g.leaderboard().length, 1); assert.equal(g.leaderboard()[0].score, 120);
  assert.ok(Math.abs(g.park.t - tAtSave) < 0.5, 'sim time restored'); assert.equal(g.park.traffic.vehicles.length, vehAtSave);
  assert.equal(g.display.popupSeconds, 15, 'settings belong to the saved game');
  assert.ok(g.listSaves().some((s) => s.auto && s.name.includes('Na ronde 1')), 'running game saved before load');
  assert.ok(g.join('ZOMER25', 'Klaas'), 'players can join with the loaded game code');
  steps(g, 30); // simulation continues normally
  // file round trip
  const file = g.saveFile(saved.id);
  assert.throws(() => g.importSave({ format: 'iets anders' } as any), (e: any) => e.code === 'invalid_save');
  const imp = g.importSave(file, 'Kopie');
  assert.equal(imp.players, 1);
  g.loadGame(imp.id);
  assert.equal(g.leaderboard()[0].score, 120);
  g.deleteSave(imp.id);
  assert.ok(!g.listSaves().some((s) => s.id === imp.id));
  g.db.close();
});

test('games: a planned session spreads check-ins and check-outs over its time and pauses at the end', () => {
  const g = new Game(cfg({ autoArrivals: true }));
  g.setSchedulerConfig({ enabled: false });
  g.setFlag('autoGate', true); // check-in/out tasks are completed by the system (gate tokens as usual)
  assert.throws(() => g.newGame({ name: 'Kort', code: 'KORT', endsAt: Date.now() + 60000 }), (e: any) => e.code === 'invalid_end');
  assert.throws(() => g.newGame({ name: 'Te veel weg', code: 'WEG1', initialOccupied: 2, endsAt: Date.now() + 3600000, arrivals: 1, departures: 9 }), (e: any) => e.code === 'invalid_departures');
  g.newGame({ name: 'Event', code: 'EVENT1', initialOccupied: 10, endsAt: Date.now() + 15 * 60000, arrivals: 6, departures: 4 });
  const s0 = g.sessionDto()!;
  assert.equal(s0.arrivalsLeft, 6); assert.equal(s0.departuresLeft, 4);
  const spread = g.session!.arrivals;
  assert.ok(spread[spread.length - 1] - spread[0] > 60000, 'moments are spread, not all at once');
  for (let i = 0; i < Math.round((16 * 60) / 0.05) && !g.paused; i++) g.simStep(0.05);
  const s1 = g.sessionDto()!;
  assert.equal(s1.arrivalsLeft, 0); assert.equal(s1.departuresLeft, 0);
  assert.ok(s1.ended && g.paused, 'session ended and the game paused');
  assert.ok(g.eventsAfter(0, 5000).some((e: any) => e.type === 'game.ended'));
  const bookings = [...g.park.bookings.values()];
  assert.ok(bookings.filter((b) => b.status !== 'in_house' || b.history.length > 1).length >= 6, 'arrivals and departures happened');
  g.db.close();
});

test('games: a reset without a seed starts a different game (other first tasks and guests)', () => {
  const g = new Game(cfg());
  const sig = () => g.listTasks().filter((t) => t.kind === 'incident').map((t) => t.template).sort().join(',') + '|' + g.bookingsDto().map((b: any) => b.household).sort().join(',');
  const seen = new Set<string>();
  for (let i = 0; i < 3; i++) { g.resetGame(Math.floor(Math.random() * 1e6), false); seen.add(sig()); }
  assert.ok(seen.size >= 2, 'resets with a random seed differ');
  g.db.close();
});

test('gates: only the car standing at the barrier requests check-in; cars behind it wait without a task', () => {
  const g = new Game(cfg({ autoArrivals: false }));
  g.setSchedulerConfig({ enabled: false });
  g.setStoryConfig({ enabled: false });
  for (let i = 0; i < 4; i++) g.park.scheduleArrival();
  let sawQueue = false;
  for (let i = 0; i < Math.round(240 / 0.05); i++) {
    g.simStep(0.05);
    if (i % 20) continue;
    for (const gs of g.park.traffic.gates.values()) {
      const tasks = g.listTasks().filter((t) => t.kind === 'checkin' && t.gateId === gs.id && t.state === 'offered');
      if (gs.queue.length >= 2) sawQueue = true;
      // every open check-in belongs to the first car in that queue, which stands at the stop line
      for (const t of tasks) assert.equal(gs.queue[0], t.vehicleId, `task ${t.id} is not for the car at the barrier`);
      assert.ok(tasks.length <= 1, 'at most one open check-in per barrier');
    }
  }
  assert.ok(sawQueue, 'a queue of several cars formed');
  assert.ok(g.listTasks().some((t) => t.kind === 'checkin'), 'the front car got its check-in');
  g.db.close();
});
