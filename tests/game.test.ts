// Task engine, scoring, gate tokens, persistence and HTTP API tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import { Game, GameConfig } from '../src/server/game.ts';
import { startHttp } from '../src/server/http.ts';

const cfg = (dbPath: string, extra: Partial<GameConfig> = {}): GameConfig => ({ dbPath, gameCode: 'TEST', adminKey: 'adm', seed: 4, timeScale: 1, initialOccupied: 2, demoBot: false, autoArrivals: false, ...extra });
const silence = () => { const l = console.log; console.log = () => {}; return () => { console.log = l; }; };
const steps = (g: Game, sec: number, each?: () => void) => { for (let i = 0; i < Math.round(sec / 0.05); i++) { g.simStep(0.05); each?.(); } };
const playerByName = (g: Game, n: string) => g.db.prepare('SELECT * FROM players WHERE display_name = ?').get(n) as any;
/** an arrival at a bungalow served by the West barrier (the park has two accesses) */
const arriveWest = (g: Game) => {
  const n = g.park.vacantHouses().find((x) => g.park.gatesFor(x).in === 'gate-in' && g.park.gatesFor(x).out === 'gate-out');
  return g.park.scheduleArrival({ houseNumber: n })!;
};

test('7a. claim timeout re-offers the check-in task; the barrier stays closed and no token exists', () => {
  const g = new Game(cfg(':memory:'));
  const b = arriveWest(g);
  steps(g, 120);
  const t = g.getTask(`T-checkin-${b.vehicleId}`)!;
  assert.equal(t.state, 'offered');
  const sophie = playerByName(g, 'Sophie');
  assert.equal(g.claim(t.id, sophie, 'k-claim-1').status, 200);
  steps(g, 320); // claim_seconds = 300 -> expires
  const t2 = g.getTask(t.id)!;
  assert.equal(t2.state, 'offered', 'released back to all players');
  assert.equal(t2.attempt, 2);
  assert.equal(g.park.traffic.gates.get('gate-in')!.phase, 'CLOSED');
  assert.equal((g.db.prepare("SELECT COUNT(*) n FROM gate_passages WHERE source = 'task'").get() as any).n, 0, 'no visitor token (staff passes of service vans are separate)');
  assert.ok(g.park.traffic.vehicles.find((v) => v.spec.id === b.vehicleId)!.queue, 'vehicle stays in the queue');
});

test('7b. duplicate completion cannot open twice or score twice; restart neither opens the barrier nor duplicates tokens', () => {
  const dir = mkdtempSync(join(tmpdir(), 'at-'));
  const db = join(dir, 'g.sqlite');
  let g = new Game(cfg(db));
  const b = arriveWest(g);
  steps(g, 120);
  const id = `T-checkin-${b.vehicleId}`;
  const p = playerByName(g, 'Mike');
  g.claim(id, p, 'claim-1');
  // car is not yet necessarily at the stop line; complete now, then retry with same key and a new key
  const r1 = g.complete(id, p, 'done-1'), r2 = g.complete(id, p, 'done-1'), r3 = g.complete(id, p, 'done-2');
  assert.equal(r1.status, 200); assert.equal((r1.body as any).pointsAwarded, 25);
  assert.equal(r2.status, 200); assert.equal((r2.body as any).replayed, true);
  assert.equal(r3.status, 200); assert.equal((r3.body as any).pointsAwarded, 0); assert.equal((r3.body as any).alreadyCompleted, true);
  const other = playerByName(g, 'Laura');
  assert.equal(g.complete(id, other, 'other-1').status, 409, 'other player cannot complete');
  assert.equal((g.db.prepare('SELECT COUNT(*) n FROM score_ledger WHERE task_id = ?').get(id) as any).n, 1);
  assert.equal((g.db.prepare('SELECT COUNT(*) n FROM gate_passages WHERE vehicle_id = ?').get(b.vehicleId) as any).n, 1);
  assert.equal(playerByName(g, 'Mike').score, 25);
  // persist WITHOUT having consumed the token, then "crash" and restart
  g.save(); g.db.close();
  const restore = silence();
  g = new Game(cfg(db));
  restore();
  assert.equal(g.park.traffic.gates.get('gate-in')!.phase, 'CLOSED', 'restart does not open the barrier');
  assert.equal((g.db.prepare('SELECT COUNT(*) n FROM gate_passages WHERE vehicle_id = ?').get(b.vehicleId) as any).n, 1, 'no duplicate token');
  let opened = 0;
  steps(g, 240, () => { /* count openings */ });
  opened = (g.db.prepare("SELECT COUNT(*) n FROM events WHERE type = 'gate.opening' AND json_extract(payload, '$.vehicleId') = ?").get(b.vehicleId) as any).n;
  assert.equal(opened, 1, 'the single token opens the gate exactly once after restart');
  assert.ok(g.park.traffic.vehicles.find((v) => v.spec.id === b.vehicleId)?.passedGates.includes('gate-in') ?? true);
  assert.equal(g.park.traffic.stats.illegalGateCrossings, 0);
  g.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('scoring defaults: difficulty x urgency, rounded to 5, persisted at creation', async () => {
  const { pointsFor } = await import('../src/server/game.ts');
  assert.equal(pointsFor('easy', 'normal'), 25);
  assert.equal(pointsFor('medium', 'high'), 65); // 62.5 -> 65 (round to nearest 5)
  assert.equal(pointsFor('hard', 'critical'), 150);
  assert.equal(pointsFor('crisis', 'high'), 190); // 187.5 -> 190
});

test('HTTP API: auth, 10 concurrent claims -> exactly one winner, claim limit 3, idempotent completion, admin separation', async () => {
  const g = new Game(cfg(':memory:'));
  const restore = silence();
  const srv = startHttp(g, { port: 0, host: '127.0.0.1', webRoot: '/nonexistent', publicRoot: '/nonexistent' });
  await new Promise((r) => srv.once('listening', r));
  restore();
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/v1`;
  const req = async (m: string, p: string, body?: unknown, h: Record<string, string> = {}) => {
    const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) as any };
  };
  // join
  assert.equal((await req('POST', '/sessions/join', { gameCode: 'WRONG', displayName: 'X' })).status, 403);
  assert.equal((await req('POST', '/sessions/join', { gameCode: 'TEST', displayName: 'Sophie' })).status, 409, 'name taken');
  const toks: string[] = [];
  for (let i = 0; i < 10; i++) { const r = await req('POST', '/sessions/join', { gameCode: 'TEST', displayName: `Racer${i}` }); assert.equal(r.status, 200); toks.push(r.body.token); }
  assert.equal((await req('GET', '/tasks')).status, 401);
  // pick an incident task and race 10 claims
  const inc = await req('POST', '/admin/incidents', {}, { 'X-Admin-Key': 'adm' });
  assert.equal(inc.status, 200);
  const tid = inc.body.id;
  const results = await Promise.all(toks.map((t, i) => req('POST', `/tasks/${tid}/claim`, { idempotencyKey: `race-${i}` }, { Authorization: `Bearer ${t}` })));
  const wins = results.filter((r) => r.status === 200);
  assert.equal(wins.length, 1, 'exactly one winner');
  assert.ok(results.filter((r) => r.status === 409).every((r) => r.body.error === 'already_claimed'));
  // claim limit
  const me = toks[1];
  const extra = [];
  for (let i = 0; i < 4; i++) extra.push((await req('POST', '/admin/incidents', {}, { 'X-Admin-Key': 'adm' })).body.id);
  const lim = [];
  for (let i = 0; i < 4; i++) lim.push(await req('POST', `/tasks/${extra[i]}/claim`, { idempotencyKey: `lim-${i}` }, { Authorization: `Bearer ${me}` }));
  assert.deepEqual(lim.map((r) => r.status), [200, 200, 200, 409]);
  assert.equal(lim[3].body.error, 'claim_limit');
  // idempotent completion and points exactly once
  assert.equal((await req('POST', `/tasks/${extra[0]}/complete`, {}, { Authorization: `Bearer ${me}` })).status, 422, 'idempotencyKey required');
  // a TD incident (maintenance/nature) can only be completed once the mechanic is on site
  if (g.park.techStatus(extra[0])) {
    const early = await req('POST', `/tasks/${extra[0]}/complete`, { idempotencyKey: 'done-1' }, { Authorization: `Bearer ${me}` });
    assert.equal(early.status, 409); assert.equal(early.body.error, 'technician_not_on_site'); assert.ok(early.body.technician);
    for (let n = 0; n < 12000 && !g.park.techStatus(extra[0])!.onSite; n++) g.simStep(0.05);
  }
  const c1 = await req('POST', `/tasks/${extra[0]}/complete`, { idempotencyKey: 'done-1' }, { Authorization: `Bearer ${me}` });
  const c2 = await req('POST', `/tasks/${extra[0]}/complete`, { idempotencyKey: 'done-1' }, { Authorization: `Bearer ${me}` });
  assert.equal(c1.status, 200); assert.equal(c2.status, 200); assert.equal(c2.body.replayed, true);
  const meInfo = await req('GET', '/me', undefined, { Authorization: `Bearer ${me}` });
  assert.equal(meInfo.body.score, c1.body.pointsAwarded);
  // completing someone else's task
  const winnerIdx = results.findIndex((r) => r.status === 200);
  const notWinner = toks[(winnerIdx + 1) % 10];
  assert.equal((await req('POST', `/tasks/${tid}/complete`, { idempotencyKey: 'steal' }, { Authorization: `Bearer ${notWinner}` })).status, 403);
  // admin separation
  assert.equal((await req('GET', '/admin/state', undefined, { Authorization: `Bearer ${me}` })).status, 401, 'player token is not an admin key');
  assert.equal((await req('GET', '/admin/state', undefined, { 'X-Admin-Key': 'nope' })).status, 403);
  // debug endpoint exposes routes, boxes, queue slots and gate states (acceptance test 9)
  const dbg = await req('GET', '/admin/debug', undefined, { 'X-Admin-Key': 'adm' });
  assert.equal(dbg.status, 200); assert.ok(Array.isArray(dbg.body.vehicles) && dbg.body.vehicles[0].box.length === 4); assert.deepEqual(dbg.body.gates.map((x: any) => x.id).sort(), ['gate-in', 'gate-out', 'gate-personeel-in', 'gate-personeel-uit']);
  // events polling fallback
  const ev = await req('GET', '/events?after=0&limit=5');
  assert.equal(ev.status, 200); assert.ok(ev.body.events.length > 0);
  srv.close(); g.db.close();
});

test('TD golf cart: claim sends a cart from the TD post at De loods to the bungalow and back, never through a barrier', () => {
  const g = new Game(cfg(':memory:'));
  const gateEdges = new Set([...g.net.gates.values()].map((x) => x.edge));
  const depot = [...g.net.stalls.values()].filter((s) => s.kind === 'depot');
  assert.equal(depot.length, 2, 'two golf-cart stalls at the TD post');
  const inc = g.createIncident({ template: 'MAINT_LEAKING_TAP', houseNumber: 474 });
  const tom = playerByName(g, 'Tom');
  assert.equal(g.claim(inc.id, tom, 'claim-td-1').status, 200);
  // completing straight after claiming is refused: the mechanic is not there yet
  assert.throws(() => g.complete(inc.id, tom, 'done-td-1'), (e: any) => e.status === 409 && e.code === 'technician_not_on_site');
  assert.equal(playerByName(g, 'Tom').score, 0, 'no points before the mechanic is on site');
  assert.equal(g.getTask(inc.id)!.state, 'claimed');
  const carts = () => g.park.traffic.vehicles.filter((v) => v.spec.model === 'golfcart');
  const usedEdges = new Set<string>();
  let reached = false;
  let refusedWhileDriving = false;
  steps(g, 300, () => {
    for (const v of carts()) { usedEdges.add(v.route[v.ri]); if (v.mission.type === 'service' && v.mission.taskId === inc.id && v.state === 'dwell') reached = true; }
    if (!refusedWhileDriving && g.park.techStatus(inc.id)?.phase === 'driving') {
      assert.throws(() => g.complete(inc.id, tom, 'done-td-1'), (e: any) => e.code === 'technician_not_on_site');
      refusedWhileDriving = true;
    }
  });
  assert.ok(refusedWhileDriving, 'completion refused while the cart was driving');
  assert.ok(reached, 'a golf cart parked near bungalow 474');
  const job = g.park.techJobs.get(inc.id)!;
  assert.equal(job.phase, 'working');
  assert.ok(job.techInside && g.park.techStatus(inc.id)!.onSite, 'mechanic walked into the bungalow');
  assert.equal((g.taskDto(g.getTask(inc.id)!) as any).technician.onSite, true);
  const cartId = job.cartId!;
  assert.equal(g.complete(inc.id, tom, 'done-td-1').status, 200);
  steps(g, 360, () => { for (const v of carts()) usedEdges.add(v.route[v.ri]); });
  const v = g.park.traffic.vehicles.find((x) => x.spec.id === cartId)!;
  assert.equal(v.state, 'parked');
  assert.equal(g.net.stalls.get(g.net.edges.get(v.route[v.route.length - 1])!.stallId!)!.kind, 'depot', 'back at the TD post');
  assert.ok([...usedEdges].some((e) => e.startsWith('td-pad')), 'used its own service path');
  assert.ok(![...usedEdges].some((e) => [...gateEdges].some((ge) => e === ge || e.startsWith(ge + '~'))), 'never drove through a barrier lane');
  assert.equal(g.park.traffic.stats.collisions, 0);
  assert.equal(g.park.traffic.stats.illegalGateCrossings, 0);
});

test('TD: released while the cart drives and re-claimed by another player - the mechanic still has to arrive first', () => {
  const g = new Game(cfg(':memory:'));
  const inc = g.createIncident({ template: 'MAINT_COLD_SHOWER', houseNumber: 420 });
  const eva = playerByName(g, 'Eva'), bram = playerByName(g, 'Bram');
  assert.equal(g.claim(inc.id, eva, 'c-eva').status, 200);
  steps(g, 60);
  assert.ok(['pending', 'driving'].includes(g.park.techStatus(inc.id)?.phase ?? ''), 'mechanic on the way');
  g.release(inc.id, eva);
  assert.equal(g.park.techStatus(inc.id), undefined, 'no active mechanic for an offered task');
  assert.equal(g.claim(inc.id, bram, 'c-bram').status, 200);
  assert.throws(() => g.complete(inc.id, bram, 'd-bram'), (e: any) => e.code === 'technician_not_on_site');
  let t = 0;
  while (!g.park.techStatus(inc.id)?.onSite && t < 400) { steps(g, 1); t++; }
  assert.ok(g.park.techStatus(inc.id)?.onSite, 'mechanic reached bungalow 420 for the new claimant');
  assert.equal(g.complete(inc.id, bram, 'd-bram').status, 200, 'same idempotency key works once on site');
  assert.equal(playerByName(g, 'Bram').score, inc.points);
  assert.equal(playerByName(g, 'Eva').score, 0);
});

test('demo bot never completes a TD task before the mechanic is on site', () => {
  const g = new Game(cfg(':memory:', { demoBot: true }));
  const inc = g.createIncident({ template: 'MAINT_LEAKING_TAP', houseNumber: 468 });
  let last: ReturnType<typeof g.park.techStatus> | undefined;
  let completedOnSite: boolean | null = null;
  steps(g, 900, () => {
    const state = g.getTask(inc.id)!.state;
    if (completedOnSite === null && state === 'completed') completedOnSite = !!last?.onSite; // status in the step before completion
    if (state === 'claimed') last = g.park.techStatus(inc.id);
  });
  assert.equal(completedOnSite, true, 'bot completed the task after all');
  assert.equal(g.park.traffic.stats.collisions, 0);
});

test('HTTP: a TD task returns 409 technician_not_on_site until the mechanic is in the bungalow; the task shows where he is', async () => {
  const g = new Game(cfg(':memory:'));
  const restore = silence();
  const srv = startHttp(g, { port: 0, host: '127.0.0.1', webRoot: '/nonexistent', publicRoot: '/nonexistent' });
  await new Promise((r) => srv.once('listening', r));
  restore();
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/v1`;
  const req = async (m: string, p: string, body?: unknown, h: Record<string, string> = {}) => {
    const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) as any };
  };
  const tok = (await req('POST', '/sessions/join', { gameCode: 'TEST', displayName: 'Monteurtest' })).body.token;
  const auth = { Authorization: `Bearer ${tok}` };
  const id = (await req('POST', '/admin/incidents', { template: 'MAINT_BLOCKED_TOILET', houseNumber: 472 }, { 'X-Admin-Key': 'adm' })).body.id;
  assert.equal((await req('POST', `/tasks/${id}/claim`, { idempotencyKey: 'c-mt' }, auth)).status, 200);
  const early = await req('POST', `/tasks/${id}/complete`, { idempotencyKey: 'd-mt' }, auth);
  assert.equal(early.status, 409); assert.equal(early.body.error, 'technician_not_on_site');
  assert.equal((await req('GET', `/tasks/${id}`, undefined, auth)).body.technician.onSite, false);
  for (let n = 0; n < 12000 && !g.park.techStatus(id)?.onSite; n++) g.simStep(0.05);
  assert.equal((await req('GET', `/tasks/${id}`, undefined, auth)).body.technician.onSite, true);
  const done = await req('POST', `/tasks/${id}/complete`, { idempotencyKey: 'd-mt' }, auth);
  assert.equal(done.status, 200, 'the refused key is not burnt'); assert.ok(done.body.pointsAwarded > 0);
  srv.close(); g.db.close();
});

test('service path is closed to visitors: no visitor route may use td-pad', async () => {
  const { findRoute } = await import('../src/sim/network.ts');
  const g = new Game(cfg(':memory:'));
  const tdEdges = [...g.net.edges.values()].filter((e) => e.roadId === 'td-pad');
  assert.ok(tdEdges.length > 0 && tdEdges.every((e) => !e.visitor && e.service));
  const spawn = g.net.portals.get('P_IN')!.spawnEdge!;
  for (const st of g.net.stalls.values()) {
    if (st.kind !== 'house') continue;
    const r = findRoute(g.net, spawn, st.inEdge, 'visitor');
    assert.ok(r, `visitor route to ${st.id}`);
    assert.ok(!r!.some((id) => id.startsWith('td-pad')), `visitor route to ${st.id} avoids the service path`);
    const inbound = [...g.net.gates.values()].filter((x) => x.direction === 'inbound').map((x) => x.edge);
    assert.ok(r!.some((id) => inbound.includes(id)), `visitor route to ${st.id} passes an inbound barrier`);
  }
});

test('a saved game from another map (after an update or editor change) is not restored: a fresh game starts instead', () => {
  const dir = mkdtempSync(join(tmpdir(), 'at-'));
  const db = join(dir, 'g.sqlite');
  let g = new Game(cfg(db));
  arriveWest(g);
  steps(g, 60);
  assert.ok(g.park.t > 59);
  g.save(); g.db.close();
  // same map: restored
  const restore = silence();
  g = new Game(cfg(db));
  assert.ok(g.park.t > 59, 'same map: the game continues');
  // the map changed since the save (simulated by a different stored fingerprint)
  g.db.prepare("UPDATE meta SET v = 'andere-kaart' WHERE k = 'mapChecksum'").run();
  g.save(); g.db.close();
  const warn = console.warn; const warned: string[] = []; console.warn = (m: string) => warned.push(m);
  g = new Game(cfg(db));
  console.warn = warn; restore();
  assert.ok(g.park.t < 1, 'other map: a fresh game');
  assert.match(warned.join(' '), /kaart is gewijzigd/);
  assert.equal((g.db.prepare("SELECT v FROM meta WHERE k = 'mapChecksum'").get() as any).v, g.mapChecksum());
  g.db.close(); rmSync(dir, { recursive: true, force: true });
});

test('setting automatic check-in/out: the system completes the gate task (no points), the barrier still opens only with that task\'s token', () => {
  const g = new Game(cfg(':memory:', { autoGate: true }));
  const b = arriveWest(g);
  let opened = false, passedBeforeToken = false;
  steps(g, 240, () => {
    const gs = g.park.traffic.gates.get('gate-in')!;
    const tok = g.db.prepare("SELECT COUNT(*) AS n FROM gate_passages WHERE vehicle_id = ? AND gate_id = 'gate-in'").get(b.vehicleId) as any;
    if (gs.phase !== 'CLOSED') { opened = true; if (!tok.n) passedBeforeToken = true; }
  });
  const t = g.getTask(`T-checkin-${b.vehicleId}`)!;
  assert.equal(t.state, 'completed'); assert.equal(t.points_awarded, 0); assert.equal(t.assigned_player_id, null);
  const p = g.db.prepare("SELECT * FROM gate_passages WHERE task_id = ?").get(t.id) as any;
  assert.equal(p.source, 'auto'); assert.equal(p.vehicle_id, b.vehicleId);
  assert.ok(opened && !passedBeforeToken, 'opened, and never before the token existed');
  assert.ok(['parked', 'checked_in', 'driving_in', 'in_house'].includes(g.park.bookings.get(b.id)!.status), g.park.bookings.get(b.id)!.status);
  assert.equal((g.db.prepare('SELECT COALESCE(SUM(score), 0) AS s FROM players').get() as any).s, 0, 'nobody got points');
  assert.equal(g.park.traffic.stats.illegalGateCrossings, 0);
  // switched off: the next arrival waits for a player again
  g.setFlag('autoGate', false);
  const b2 = arriveWest(g);
  steps(g, 240);
  assert.equal(g.getTask(`T-checkin-${b2.vehicleId}`)?.state, 'offered');
  g.db.close();
});
