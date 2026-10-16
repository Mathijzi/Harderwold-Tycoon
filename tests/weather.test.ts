// Weather: plausible changes over time, game-master control, influence on which tasks happen, the storm crisis
// brings a thunderstorm, and the weather belongs to a saved game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newWeather, stepWeather, WEATHER_KINDS, groupFactor } from '../src/shared/weather.ts';
import { rng } from '../src/shared/geom.ts';
import { Game, GameConfig } from '../src/server/game.ts';

const cfg = (extra: Partial<GameConfig> = {}): GameConfig => ({ dbPath: ':memory:', gameCode: 'TEST', adminKey: 'adm', seed: 4, timeScale: 1, initialOccupied: 12, demoBot: false, autoArrivals: false, ...extra });

test('weather: changes over two game days with plausible durations and temperatures', () => {
  const r = rng(7);
  const w = newWeather(0, 12, r.next);
  const seen = new Set<string>([w.kind]);
  let changes = 0, prev = w.kind;
  for (let m = 0; m < 48 * 60; m += 5) {
    stepWeather(w, m * 60000, (m / 60) % 24, r.next);
    assert.ok(WEATHER_KINDS.includes(w.kind));
    assert.ok(w.tempC >= 2 && w.tempC <= 20, `temp ${w.tempC}`);
    assert.ok(w.until > m * 60000 - 5 * 60000);
    assert.equal(w.forecast.length, 3);
    if (w.kind !== prev) { changes++; prev = w.kind; seen.add(w.kind); }
  }
  assert.ok(changes >= 12 && changes <= 80, `${changes} changes in 48 h`);
  assert.ok(seen.size >= 4, `kinds seen: ${[...seen]}`);
  assert.ok(groupFactor('regen', 'terrein') > 1 && groupFactor('regen', 'water') < 1 && groupFactor('zon', 'water') > 1 && groupFactor('onweer', 'golf') < 1);
});

test('weather: game master sets it, the scheduler follows it, a storm crisis brings thunder, a save keeps it', () => {
  const g = new Game(cfg());
  assert.ok(g.weather && WEATHER_KINDS.includes(g.weather.kind));
  assert.throws(() => g.setWeather('sneeuwstorm'), (e: any) => e.code === 'invalid_weather');
  assert.throws(() => g.setWeather('regen', 1), (e: any) => e.code === 'invalid_weather');
  g.setWeather('regen', 120);
  assert.equal(g.weather.kind, 'regen'); assert.ok(g.weather.locked);
  assert.equal((g.parkSummary() as any).weather.name, 'Regen');
  // the scheduler picks more outdoor/maintenance jobs in the rain than in the sun
  const count = (kind: string) => {
    g.setWeather(kind, 600);
    const env = (g as any).schedEnv();
    let outdoor = 0, bikes = 0;
    for (let i = 0; i < 600; i++) { const s = g.scheduler.suggest({ ...env, lastAt: () => undefined, busy: new Set() }); const tp = s && (g as any).constructor && s.code; if (!tp) continue; if (/^GRD_|^MAINT_/.test(s.code)) outdoor++; if (/^WATER_|^GOLF_/.test(s.code)) bikes++; }
    return { outdoor, bikes };
  };
  const rain = count('regen'), sun = count('zon');
  assert.ok(rain.outdoor > sun.outdoor, `rain ${rain.outdoor} vs sun ${sun.outdoor} outdoor jobs`);
  assert.ok(rain.bikes < sun.bikes, `rain ${rain.bikes} vs sun ${sun.bikes} bike jobs`);
  // the storm crisis brings the thunderstorm
  g.setWeather('zon', 60);
  g.createCrisis({ code: 'CRISIS_STORM' });
  assert.equal(g.weather.kind, 'onweer');
  // weather is part of a saved game
  const saved = g.saveGame('Met onweer');
  g.setWeather('mist', 60);
  g.loadGame(saved.id);
  assert.equal(g.weather.kind, 'onweer');
  g.db.close();
});
