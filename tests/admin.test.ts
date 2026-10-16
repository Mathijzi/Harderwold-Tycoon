// Game Master dashboard backend: score corrections go through the ledger with an audit entry; own names and tasks are
// validated, persist in the database (also across a reset and a restart) and are used by the game; export is complete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Game, GameConfig } from '../src/server/game.ts';
import { templateByCode } from '../src/shared/tasklib.ts';
import { customNames, makeHousehold } from '../src/shared/guestlib.ts';
import { rng } from '../src/shared/geom.ts';

const cfg = (extra: Partial<GameConfig> = {}): GameConfig => ({ dbPath: ':memory:', gameCode: 'TEST', adminKey: 'adm', seed: 4, timeScale: 1, initialOccupied: 12, demoBot: false, autoArrivals: false, ...extra });

test('admin: score corrections are ledger rows with a reason and an audit entry; score always equals the ledger sum', () => {
  const g = new Game(cfg());
  const p = (g.players() as any[])[0];
  assert.throws(() => g.adjustScore(p.id, 50, ''), (e: any) => e.code === 'reason_required');
  assert.throws(() => g.adjustScore(p.id, 0, 'nul'), (e: any) => e.code === 'invalid_delta');
  assert.throws(() => g.adjustScore(p.id, 1.5, 'half'), (e: any) => e.code === 'invalid_delta');
  assert.throws(() => g.adjustScore('nope', 5, 'bestaat niet'), (e: any) => e.status === 404);
  const r = g.adjustScore(p.id, 75, 'Bonus voor de beste samenwerking');
  assert.equal(r.after, r.before + 75);
  g.adjustScore(p.id, -25, 'Correctie dubbele punten');
  const sum = (g.db.prepare('SELECT SUM(points) AS s FROM score_ledger WHERE player_id = ?').get(p.id) as any).s;
  assert.equal((g.players() as any[])[0].score, sum);
  assert.equal(sum, 50);
  const audit = g.auditLog(10).filter((a: any) => a.action === 'score_adjust');
  assert.equal(audit.length, 2);
  assert.equal((audit[0].detail as any).reason, 'Correctie dubbele punten');
  assert.ok((g.ledger(5) as any[]).some((l) => l.reason === 'admin:Bonus voor de beste samenwerking' && l.displayName === p.displayName));
  g.db.close();
});

test('admin: own tasks and names are validated, used by the game and kept across a reset and a restart; export is complete', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aht-admin-'));
  const dbPath = join(dir, 'g.sqlite');
  try {
    let g = new Game(cfg({ dbPath }));
    assert.throws(() => g.saveCustomTask({ group: 'receptie', title: 'x', text: 'kort' } as any), (e: any) => e.code === 'invalid_content' && e.extra.problems.length >= 2);
    assert.throws(() => g.saveCustomTask({ group: 'golf', title: 'Golftas kwijt', text: 'Een gast is zijn golftas kwijt op de range. Zoek mee.', difficulty: 'easy', urgency: 'normal', location: { kind: 'facility', facilities: ['ZZ'] }, weight: 1, when: 'altijd' }), (e: any) => e.code === 'invalid_content');
    const ct = g.saveCustomTask({ group: 'golf', title: 'Golftas kwijt', text: 'Een gast is de golftas kwijt geraakt op de driving range. Zoek mee bij de ballenautomaat.', difficulty: 'easy', urgency: 'high', location: { kind: 'facility', facilities: ['R'] }, weight: 1.5, when: 'dag' });
    assert.match(ct.code, /^CUST_/);
    assert.ok(templateByCode.get(ct.code));
    const task = g.createIncident({ template: ct.code });
    assert.equal(task.category, 'Golf'); assert.ok(task.locationId?.startsWith('F-R'));
    const edited = g.saveCustomTask({ ...ct, title: 'Golftas zoek' });
    assert.equal(edited.code, ct.code); assert.equal(templateByCode.get(ct.code)!.title, 'Golftas zoek');
    assert.throws(() => g.setNames({ cameos: [{ name: 'Test Persoon', role: 'astronaut' as any, tagline: '' }] }), (e: any) => e.code === 'invalid_content');
    g.setNames({ first: ['Ferdinand', 'Ferdinand', 'X'], surnames: ['Van Testenburg'], kids: [], cameos: [{ name: 'Test Persoon', role: 'zanger', tagline: 'zanger op schrijverskamp' }] });
    assert.deepEqual(customNames.first, ['Ferdinand'], 'deduplicated, too short dropped');
    let seenCameo = false, seenSurname = false;
    for (let i = 0; i < 3000; i++) { const h = makeHousehold(rng(i)); if (h.household.celebrity === 'eigen-test-persoon') seenCameo = true; if (h.household.name.includes('Van Testenburg')) seenSurname = true; }
    assert.ok(seenCameo && seenSurname, 'own names are used for new guests');
    g.resetGame(5, false);
    assert.equal(g.content.tasks.length, 1, 'kept across a reset');
    const ex = g.exportAll();
    for (const k of ['players', 'ledger', 'tasks', 'incidents', 'stories', 'audit', 'config', 'content', 'leaderboard']) assert.ok(k in ex, k);
    assert.equal(ex.content.names.cameos[0].name, 'Test Persoon');
    g.stop();
    // restart on the same database: content is loaded again
    g = new Game(cfg({ dbPath }));
    assert.ok(templateByCode.get(ct.code), 'own task registered after restart');
    assert.equal(g.content.names().cameos.length, 1);
    g.deleteCustomTask(ct.code);
    assert.equal(templateByCode.get(ct.code), undefined);
    g.setNames({});
    g.stop();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('admin: popup duration is validated, persisted and sent to the projector', () => {
  const g = new Game(cfg());
  assert.throws(() => g.setDisplay({ popupSeconds: 2 }), (e: any) => e.code === 'invalid_config');
  assert.throws(() => g.setDisplay({ popupSeconds: 500 }), (e: any) => e.code === 'invalid_config');
  g.setDisplay({ popupSeconds: 30 });
  assert.equal((g.projectorState().park as any).display.popupSeconds, 30);
  g.resetGame(4, false);
  assert.equal(g.display.popupSeconds, 30, 'kept across a reset');
  g.db.close();
});

test('backups: a consistent copy of the whole database, listed newest first and pruned to the limit', async () => {
  const { Backups } = await import('../src/server/backup.ts');
  const { DatabaseSync } = await import('node:sqlite');
  const dir = mkdtempSync(join(tmpdir(), 'aht-bk-'));
  try {
    const g = new Game(cfg({ dbPath: join(dir, 'g.sqlite') }));
    g.saveGame('Voor de back-up');
    const b = new Backups(g.db, join(dir, 'backups'), 2, () => g.save());
    const first = b.make('test');
    assert.ok(first.bytes > 10_000);
    const copy = new DatabaseSync(join(dir, 'backups', first.file));
    assert.equal((copy.prepare('SELECT COUNT(*) AS n FROM saves').get() as any).n, 1);
    assert.equal((copy.prepare('SELECT COUNT(*) AS n FROM players').get() as any).n, 10);
    copy.close();
    await new Promise((r) => setTimeout(r, 1100)); b.make('a');
    await new Promise((r) => setTimeout(r, 1100)); b.make('b');
    assert.equal(b.list().length, 2, 'pruned to keep=2');
    assert.equal(b.path('../g.sqlite'), null, 'no path tricks');
    g.stop();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
