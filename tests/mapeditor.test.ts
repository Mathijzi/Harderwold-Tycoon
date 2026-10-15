// Map editor: bundle checks, house overrides, admin-only versioned map API, diagnostics and activation.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import { DATA_DIR } from '../src/sim/load.ts';
import { buildNetwork } from '../src/sim/network.ts';
import { checkBundle, MapBundle, MAP_FORMAT, MAP_SCHEMA } from '../src/shared/mapdoc.ts';

// the editor writes data/map on activation: work on a private copy
const dir = mkdtempSync(join(tmpdir(), 'harder-map-'));
cpSync(DATA_DIR, dir, { recursive: true });
process.env.MAP_DIR = dir;
after(() => rmSync(dir, { recursive: true, force: true }));
const { Game } = await import('../src/server/game.ts');
const { startHttp } = await import('../src/server/http.ts');

const bundle = (): MapBundle => ({
  format: MAP_FORMAT, schema: MAP_SCHEMA, parentVersion: null, review: {},
  network: JSON.parse(readFileSync(join(dir, 'park_road_network.json'), 'utf8')),
  park: JSON.parse(readFileSync(join(dir, 'park.json'), 'utf8')),
});

test('map bundle check: dangling references, duplicate numbers, gate on a missing road or on the absent lane of a one-way road', () => {
  assert.deepEqual(checkBundle(bundle()).filter((p) => p.level === 'error'), [], 'the shipped map has no structural errors');
  const b = bundle();
  b.network.roads[0].to = 'NOPE';
  b.park.houses[1].number = b.park.houses[0].number;
  b.network.gates[0].road = 'missing-road';
  const ow = b.network.roads.find((r) => r.oneway === 'f') ?? Object.assign(b.network.roads[3], { oneway: 'f' as const }); // Harderwold has no one-way roads: make one
  b.network.gates[1].road = ow.id; b.network.gates[1].lane = 'backward';
  b.network.gates[2].queueSlots = 0;
  const msgs = checkBundle(b).filter((p) => p.level === 'error').map((p) => p.msg).join('\n');
  assert.match(msgs, /knoop NOPE bestaat niet/);
  assert.match(msgs, /Huisnummer \d+ komt 2 keer voor/);
  assert.match(msgs, /weg missing-road bestaat niet/);
  assert.match(msgs, /eenrichtingsweg/);
  assert.match(msgs, /opstelplaatsen moet 1-12/);
  assert.match(checkBundle({ format: 'x' }).map((p) => p.msg).join(), /Onbekend formaat/);
});

test('house overrides from the editor: a locked house stays exactly where it was put (conflicts reported), frontDeg sets the door side', () => {
  const b = bundle();
  const h = b.park.houses.find((x) => x.number === 501)!;
  const node = b.network.nodes[b.network.roads.find((r) => r.id === 'laan-500')?.from ?? Object.keys(b.network.nodes)[0]];
  h.pt = [...node.pt]; h.locked = true;              // right on a junction
  const h2 = b.park.houses.find((x) => x.number === 502)!;
  h2.frontDeg = 90;                                   // door to the south
  const net = buildNetwork(b.network, b.park);
  const hi = net.houses.find((x) => x.number === 501)!, want = net.toWorld(h.pt);
  assert.ok(Math.hypot(hi.pos.x - want.x, hi.pos.y - want.y) < 1e-6, 'locked house not nudged');
  assert.ok(net.validation.some((v) => v.level === 'warn' && /Huis 501: met de hand vastgezet/.test(v.msg)));
  const h7 = net.houses.find((x) => x.number === 502)!;
  assert.ok(Math.abs(h7.front.x) < 1e-6 && Math.abs(h7.front.y - 1) < 1e-6, 'front points south');
});

test('map editor API: admin only; versions, full validation with routes, refused activation with errors, activation rewrites the map and restarts the game', async () => {
  const g = new Game({ dbPath: ':memory:', gameCode: 'TEST', adminKey: 'adm', seed: 4, timeScale: 1, initialOccupied: 2, demoBot: false, autoArrivals: false });
  const log = console.log; console.log = () => {};
  const srv = startHttp(g, { port: 0, host: '127.0.0.1', webRoot: '/nonexistent', publicRoot: '/nonexistent' });
  await new Promise((r) => srv.once('listening', r));
  console.log = log;
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/v1`;
  const call = async (m: string, p: string, body?: unknown, h: Record<string, string> = { 'x-admin-key': 'adm' }) => {
    const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() as any };
  };
  try {
    // auth: no key, wrong key, player token
    assert.equal((await call('GET', '/admin/map', undefined, {})).status, 401);
    assert.equal((await call('GET', '/admin/map', undefined, { 'x-admin-key': 'nope' })).status, 403);
    const joined = await call('POST', '/sessions/join', { gameCode: 'TEST', displayName: 'Kaartspeler' }, {});
    assert.equal((await call('POST', '/admin/map/versions', { bundle: bundle(), comment: 'x' }, { authorization: `Bearer ${joined.body.token}` })).status, 401);

    const cur = await call('GET', '/admin/map');
    assert.equal(cur.status, 200);
    const nHouses = JSON.parse(readFileSync(join(dir, 'park.json'), 'utf8')).houses.length;
    assert.ok(nHouses >= 330); assert.equal(cur.body.park.houses.length, nHouses);
    assert.ok(cur.body.reviewItems.length >= 10);

    // structurally broken -> 422 with the problems
    const bad = bundle(); bad.network.roads[0].from = 'GONE';
    const r422 = await call('POST', '/admin/map/versions', { bundle: bad, comment: 'kapot' });
    assert.equal(r422.status, 422); assert.match(r422.body.problems[0].msg, /GONE/);

    // full validation (worker thread) + route of a bungalow
    const v = await call('POST', '/admin/map/validate', { bundle: cur.body });
    assert.equal(v.status, 200);
    assert.equal(v.body.ok, true, v.body.problems.filter((p: any) => p.level === 'error').map((p: any) => p.msg).join('; '));
    assert.equal(v.body.summary.houses, nHouses); assert.equal(v.body.summary.housesWithStall, nHouses); assert.equal(v.body.summary.unreachable, 0);
    assert.equal(v.body.derived.gates.length, 4);
    const rt = await call('GET', `/admin/map/route/${v.body.diagId}/501`);
    assert.equal(rt.status, 200); assert.ok(rt.body.in.gate.startsWith('gate-in')); assert.ok(rt.body.in.pts.length > 5);

    // a version whose visitors cannot reach any bungalow is saved (structurally fine) but cannot become active
    const noEntry = bundle(); noEntry.network.nodes.P_IN.kind = 'junction'; delete noEntry.network.nodes.P_IN.portal;
    const s1 = await call('POST', '/admin/map/versions', { bundle: noEntry, comment: 'zonder ingang' });
    assert.equal(s1.status, 201);
    assert.equal((await call('POST', `/admin/map/versions/${s1.body.id}/activate`, { confirm: true })).status, 422);
    assert.equal(readFileSync(join(dir, 'park_road_network.json'), 'utf8').includes('"zonder ingang"'), false);

    // a real edit: move a bungalow, tick a review item, save, activate
    const ed = bundle(); const h = ed.park.houses.find((x) => x.number === 501)!; h.pt = [h.pt[0] + 2, h.pt[1]]; ed.review = { scale: true };
    const s2 = await call('POST', '/admin/map/versions', { bundle: ed, comment: 'huis 501 verplaatst' });
    assert.equal(s2.status, 201); assert.equal(s2.body.comment, 'huis 501 verplaatst');
    assert.equal((await call('POST', `/admin/map/versions/${s2.body.id}/activate`, {})).status, 422, 'confirm required');
    const before = g.park.t; void before;
    const act = await call('POST', `/admin/map/versions/${s2.body.id}/activate`, { confirm: true });
    assert.equal(act.status, 200, JSON.stringify(act.body).slice(0, 300));
    const onDisk = JSON.parse(readFileSync(join(dir, 'park.json'), 'utf8'));
    assert.deepEqual(onDisk.houses.find((x: any) => x.number === 501).pt, h.pt);
    assert.equal(onDisk.editorVersion.id, s2.body.id); assert.deepEqual(onDisk.editorReview, { scale: true });
    assert.deepEqual(g.sectorJson.houses.find((x) => x.number === 501)!.pt, h.pt, 'the game runs on the new map');
    const after = await call('GET', '/admin/map');
    assert.equal(after.body.activeVersion.id, s2.body.id); assert.equal(after.body.review.scale, true);
    const list = await call('GET', '/admin/map/versions');
    assert.equal(list.body.length, 2); assert.ok(list.body.find((x: any) => x.id === s2.body.id).activated_at);
    const evs = await call('GET', '/events?after=0&limit=500', undefined, {});
    assert.ok(evs.body.events.some((e: any) => e.type === 'map.updated'));
    assert.ok((g.auditLog() as any[]).some((a) => a.action === 'map_activate'));
  } finally {
    srv.close(); g.stop(); g.db.close();
  }
});

test('editor road edits: split a road into a new junction, connect two nodes, refuse deleting a node or road still in use', async () => {
  const { splitRoad, addRoad, insertRoadPoint, deleteSel } = await import('../src/web/editor/model.ts');
  const b = bundle();
  const gateRoad = b.network.gates[0].road;
  const r = b.network.roads.find((x) => x.id === gateRoad)!;
  const nPts = r.pts.length;
  const i = insertRoadPoint(b, r.id, r.pts[Math.floor(nPts / 2)] ?? b.network.nodes[r.from].pt);
  assert.equal(r.pts.length, nPts + 1);
  const nid = splitRoad(b, r.id, i);
  assert.ok(b.network.nodes[nid]);
  const pieces = b.network.roads.filter((x) => x.from === nid || x.to === nid);
  assert.equal(pieces.length, 2);
  assert.ok(pieces.some((x) => x.id === b.network.gates[0].road), 'gate stays on one of the two pieces');
  assert.match(deleteSel(b, { kind: 'node', id: nid })!, /wordt gebruikt/);
  const gr = b.network.gates[0].road;
  assert.match(deleteSel(b, { kind: 'road', id: gr })!, /slagboom/);
  const other = Object.keys(b.network.nodes).find((k) => k !== nid && b.network.nodes[k].kind === 'deadend')!;
  const id = addRoad(b, nid, other);
  assert.ok(b.network.roads.some((x) => x.id === id));
  assert.equal(deleteSel(b, { kind: 'road', id }), null);
  assert.deepEqual(checkBundle(b).filter((p) => p.level === 'error'), []);
  const net = buildNetwork(b.network, b.park);
  assert.equal(net.gates.size, 4);
});
