// HTTP API (REST /api/v1 + SSE stream), static files. No external dependencies (node:http).
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { Game, ApiError, PlayerRow } from './game.ts';
import { openApiSpec } from './openapi.ts';
import { MapError } from './mapstore.ts';
import { REVIEW_ITEMS } from '../shared/mapdoc.ts';
import { TEMPLATES, CRISES } from '../shared/tasklib.ts';
import { STORIES, MEDIA_ROLES } from '../shared/guestlib.ts';
import { GROUPS } from './content.ts';
import { mapReport } from './mapreport.ts';

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.map': 'application/json', '.md': 'text/markdown; charset=utf-8' };

interface Ctx { req: IncomingMessage; res: ServerResponse; url: URL; body: Record<string, unknown>; params: Record<string, string>; player?: PlayerRow; admin: boolean }
type Handler = (c: Ctx) => unknown;
interface Route { method: string; re: RegExp; keys: string[]; auth: 'none' | 'player' | 'admin'; h: Handler }

export function startHttp(game: Game, opts: { port: number; host: string; webRoot: string; publicRoot: string }) {
  const routes: Route[] = [];
  const add = (method: string, path: string, auth: Route['auth'], h: Handler) => {
    const keys: string[] = [];
    const re = new RegExp('^' + path.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, auth, h });
  };
  const V = '/api/v1';

  // ---------------- player / public API
  add('POST', `${V}/sessions/join`, 'none', (c) => game.join(String(c.body.gameCode ?? ''), String(c.body.displayName ?? '')));
  add('GET', `${V}/me`, 'player', (c) => {
    const p = c.player!;
    const active = game.listTasks('claimed').filter((t) => t.assignedPlayerId === p.id);
    return { playerId: p.id, displayName: p.display_name, score: p.score, activeTasks: active, maxActiveTasks: 3 };
  });
  add('GET', `${V}/park`, 'none', () => game.parkSummary());
  add('GET', `${V}/locations`, 'none', () => game.locations());
  add('GET', `${V}/locations/:id`, 'none', (c) => {
    const l = game.locations().find((x) => x.id === c.params.id);
    if (!l) throw new ApiError(404, 'not_found', 'Locatie niet gevonden');
    return l;
  });
  add('GET', `${V}/leaderboard`, 'none', () => game.leaderboard());
  add('GET', `${V}/tasks`, 'player', (c) => {
    const st = c.url.searchParams.get('state') ?? undefined;
    if (st && !['offered', 'claimed', 'completed', 'expired', 'cancelled'].includes(st)) throw new ApiError(422, 'invalid_state', 'Ongeldige state');
    return game.listTasks(st);
  });
  add('GET', `${V}/tasks/:id`, 'player', (c) => { const t = game.getTask(c.params.id); if (!t) throw new ApiError(404, 'not_found', 'Opdracht bestaat niet'); return game.taskDto(t); });
  add('POST', `${V}/tasks/:id/claim`, 'player', (c) => { const r = game.claim(c.params.id, c.player!, String(c.body.idempotencyKey ?? '')); return { __status: r.status, ...(r.body as object) }; });
  add('POST', `${V}/tasks/:id/complete`, 'player', (c) => { const r = game.complete(c.params.id, c.player!, String(c.body.idempotencyKey ?? '')); return { __status: r.status, ...(r.body as object) }; });
  add('POST', `${V}/tasks/:id/release`, 'player', (c) => game.release(c.params.id, c.player!));
  add('GET', `${V}/events`, 'none', (c) => {
    // after=latest: only the current cursor (start polling from now); a cursor beyond the newest event means the game
    // was reset (events start again at 1): the client gets reset=true and the current cursor
    const latest = game.latestEventSeq();
    const raw = c.url.searchParams.get('after');
    if (raw === 'latest') return { events: [], cursor: latest };
    const after = Number(raw ?? 0);
    if (Number.isFinite(after) && after > latest) return { events: [], cursor: latest, reset: true };
    const ev = game.eventsAfter(Number.isFinite(after) ? after : 0, Number(c.url.searchParams.get('limit') ?? 200));
    return { events: ev, cursor: ev.length ? ev[ev.length - 1].seq : after };
  });
  add('GET', `${V}/traffic`, 'none', () => game.park.traffic.snapshot());
  add('GET', `${V}/bookings`, 'none', () => game.bookingsDto());
  add('GET', `${V}/stories`, 'none', (c) => (c.url.searchParams.get('all') === '1' ? game.stories.list(true) : game.stories.list()));
  add('GET', `${V}/map`, 'none', () => ({ network: game.netJson, sector: game.sectorJson }));
  add('GET', `${V}/openapi.json`, 'none', () => openApiSpec());
  add('GET', `${V}/health`, 'none', () => ({ ok: true, uptimeSec: Math.round((Date.now() - game.startedAt) / 1000), clients: game.clientCount(), simTime: game.park.t }));

  // ---------------- admin API (separate key, never a player token)
  add('GET', `${V}/admin/state`, 'admin', () => ({ park: game.parkSummary(), bookings: game.bookingsDto(), players: game.players(), tasks: game.listTasks(), validation: game.net.validation, worst: game.worstLocations() }));
  add('GET', `${V}/admin/debug`, 'admin', () => game.park.traffic.debugInfo());
  add('GET', `${V}/admin/players`, 'admin', () => game.players());
  add('POST', `${V}/admin/players/:id/token`, 'admin', (c) => game.issueTestToken(c.params.id));
  add('POST', `${V}/admin/arrivals`, 'admin', (c) => {
    const n = Math.max(1, Math.min(10, Number(c.body.count ?? 1)));
    const made = [];
    for (let i = 0; i < n; i++) { const b = game.park.scheduleArrival({ houseNumber: c.body.houseNumber ? Number(c.body.houseNumber) : undefined }); if (b) made.push({ bookingId: b.id, houseNumber: b.houseNumber, vehicleId: b.vehicleId, household: b.household }); }
    game.audit('admin', 'arrivals', { requested: n, created: made.length });
    if (!made.length) throw new ApiError(409, 'no_vacant_bungalow', 'Geen vrije (schone) bungalow beschikbaar in deze sector');
    return { created: made, note: made.length < n ? `Slechts ${made.length} vrije bungalows` : undefined };
  });
  add('POST', `${V}/admin/departures`, 'admin', (c) => {
    const n = Math.max(1, Math.min(10, Number(c.body.count ?? 1)));
    const made = [];
    for (let i = 0; i < n; i++) { const b = game.park.depart({ houseNumber: c.body.houseNumber ? Number(c.body.houseNumber) : undefined }); if (b) made.push({ bookingId: b.id, houseNumber: b.houseNumber, vehicleId: b.vehicleId, household: b.household }); }
    game.audit('admin', 'departures', { requested: n, created: made.length });
    if (!made.length) throw new ApiError(409, 'no_household', 'Geen huishouden in een bungalow om te laten vertrekken');
    return { departing: made };
  });
  add('POST', `${V}/admin/speed`, 'admin', (c) => { game.setTimeScale(Number(c.body.timeScale)); return game.parkSummary(); });
  add('POST', `${V}/admin/pause`, 'admin', () => { game.paused = true; game.audit('admin', 'pause', {}); game.event('game.paused', {}); return game.parkSummary(); });
  add('POST', `${V}/admin/resume`, 'admin', () => { game.paused = false; game.audit('admin', 'resume', {}); game.event('game.resumed', {}); return game.parkSummary(); });
  add('GET', `${V}/admin/backups`, 'admin', () => ({ dir: game.backups?.dir ?? null, backups: game.backups?.list() ?? [] }));
  add('POST', `${V}/admin/backups`, 'admin', () => {
    if (!game.backups) throw new ApiError(503, 'no_backups', 'Back-ups zijn niet ingesteld');
    const b = game.backups.make('handmatig'); game.audit('admin', 'backup', { file: b.file }); return b;
  });
  add('GET', `${V}/admin/backups/:name`, 'admin', (c) => {
    const p = game.backups?.path(c.params.name);
    if (!p) throw new ApiError(404, 'not_found', 'Back-up niet gevonden');
    return { __file: { path: p, name: c.params.name, type: 'application/vnd.sqlite3' } };
  });
  add('GET', `${V}/admin/games`, 'admin', () => ({ current: game.gameInfo(), saves: game.listSaves() }));
  add('POST', `${V}/admin/games/new`, 'admin', (c) => game.newGame(c.body as never));
  add('POST', `${V}/admin/games/save`, 'admin', (c) => game.saveGame(String(c.body.name ?? '')));
  add('POST', `${V}/admin/games/import`, 'admin', (c) => game.importSave(c.body.file as never, c.body.name as string | undefined));
  add('GET', `${V}/admin/games/:id/file`, 'admin', (c) => game.saveFile(c.params.id));
  add('POST', `${V}/admin/games/:id/load`, 'admin', (c) => game.loadGame(c.params.id));
  add('POST', `${V}/admin/games/:id/delete`, 'admin', (c) => game.deleteSave(c.params.id));
  add('POST', `${V}/admin/reset`, 'admin', (c) => { game.resetGame(c.body.seed !== undefined ? Number(c.body.seed) : Math.floor(Math.random() * 1e6)); return game.parkSummary(); }); // without a seed: a new random game
  add('POST', `${V}/admin/flags`, 'admin', (c) => {
    if (typeof c.body.demoBot === 'boolean') game.setFlag('demoBot', c.body.demoBot);
    if (typeof c.body.autoArrivals === 'boolean') game.setFlag('autoArrivals', c.body.autoArrivals);
    if (typeof c.body.autoGate === 'boolean') game.setFlag('autoGate', c.body.autoGate);
    return game.parkSummary();
  });
  add('POST', `${V}/admin/incidents`, 'admin', (c) => {
    const code = c.body.template as string | undefined;
    if (c.body.crisis === true || code?.startsWith('CRISIS_')) {
      const r = game.createCrisis({ code: code?.startsWith('CRISIS_') ? code : undefined, locationId: c.body.locationId as string | undefined });
      game.audit('admin', 'inject_crisis', { incidentId: r.id, code: r.code });
      return r;
    }
    const r = game.createIncident({ template: code, houseNumber: c.body.houseNumber ? Number(c.body.houseNumber) : undefined, locationId: c.body.locationId as string | undefined });
    game.audit('admin', 'inject_incident', { taskId: r.id, template: r.template });
    return r;
  });
  add('GET', `${V}/admin/incidents`, 'admin', (c) => game.listIncidents(c.url.searchParams.get('all') === '1'));
  add('GET', `${V}/admin/templates`, 'admin', () => ({ templates: TEMPLATES, crises: CRISES }));
  add('GET', `${V}/admin/scheduler`, 'admin', () => game.schedulerInfo());
  add('GET', `${V}/admin/stories`, 'admin', () => ({ ...game.storiesInfo(), templates: STORIES }));
  add('POST', `${V}/admin/stories`, 'admin', (c) => {
    const r = game.startStory({ code: c.body.code as string | undefined, bookingId: c.body.bookingId as string | undefined });
    game.audit('admin', 'start_story', { storyId: r.id, code: r.code });
    return r;
  });
  add('POST', `${V}/admin/weather`, 'admin', (c) => game.setWeather(String(c.body.kind ?? ''), c.body.minutes !== undefined ? Number(c.body.minutes) : 60));
  add('POST', `${V}/admin/display`, 'admin', (c) => game.setDisplay(c.body as never));
  add('POST', `${V}/admin/stories/config`, 'admin', (c) => game.setStoryConfig(c.body as never));
  add('POST', `${V}/admin/scheduler`, 'admin', (c) => game.setSchedulerConfig(c.body as never));
  add('POST', `${V}/admin/tasks/:id/cancel`, 'admin', (c) => { game.cancelTask(c.params.id, String(c.body.reason ?? '')); return { ok: true }; });
  add('POST', `${V}/admin/gates/:id/override`, 'admin', (c) => game.overrideGate(c.params.id, String(c.body.reason ?? '')));
  add('GET', `${V}/admin/audit`, 'admin', (c) => game.auditLog(Number(c.url.searchParams.get('limit') ?? 100)));
  add('GET', `${V}/admin/ledger`, 'admin', (c) => game.ledger(Number(c.url.searchParams.get('limit') ?? 200)));
  add('POST', `${V}/admin/players/:id/score`, 'admin', (c) => game.adjustScore(c.params.id, Number(c.body.delta), String(c.body.reason ?? '')));
  add('GET', `${V}/admin/export`, 'admin', () => game.exportAll());
  add('GET', `${V}/admin/content`, 'admin', () => ({ names: game.content.names(), tasks: game.content.tasks, facilities: game.facilities(), roles: MEDIA_ROLES, groups: GROUPS }));
  add('POST', `${V}/admin/content/names`, 'admin', (c) => game.setNames(c.body as never));
  add('POST', `${V}/admin/content/tasks`, 'admin', (c) => game.saveCustomTask(c.body as never));
  add('POST', `${V}/admin/content/tasks/:code/delete`, 'admin', (c) => game.deleteCustomTask(c.params.code));

  // ---------------- map editor (admin)
  add('GET', `${V}/admin/map`, 'admin', () => ({ ...game.maps.current(), reviewItems: REVIEW_ITEMS }));
  add('GET', `${V}/admin/map/versions`, 'admin', () => game.maps.list());
  add('GET', `${V}/admin/map/versions/:id`, 'admin', (c) => game.maps.get(Number(c.params.id)));
  add('POST', `${V}/admin/map/versions`, 'admin', (c) => {
    const v = game.maps.save(c.body.bundle, String(c.body.comment ?? ''));
    game.audit('admin', 'map_save', { version: v.id, checksum: v.checksum, comment: v.comment });
    return { __status: 201, ...v };
  });
  add('POST', `${V}/admin/map/validate`, 'admin', (c) => game.maps.diagnose(c.body.bundle));
  add('POST', `${V}/admin/map/report`, 'admin', (c) => mapReport((c.body.bundle ?? game.maps.current()) as never, game.maps.dir, opts.publicRoot));
  add('GET', `${V}/admin/map/route/:diag/:house`, 'admin', async (c) => {
    const r = await game.maps.route(c.params.diag, Number(c.params.house));
    if (!r) throw new ApiError(404, 'no_route', 'Geen route of parkeervak voor dit huis');
    return r;
  });
  add('POST', `${V}/admin/map/versions/:id/activate`, 'admin', (c) => {
    if (c.body.confirm !== true) throw new ApiError(422, 'confirm_required', 'Activeren herstart het spel op de nieuwe kaart: stuur {"confirm": true}');
    return game.activateMap(Number(c.params.id));
  });

  // ---------------- rate limiting (token bucket per client key)
  const buckets = new Map<string, { tokens: number; at: number }>();
  const allow = (key: string) => {
    const now = Date.now();
    const b = buckets.get(key) ?? { tokens: 40, at: now };
    b.tokens = Math.min(40, b.tokens + ((now - b.at) / 1000) * 20);
    b.at = now;
    if (b.tokens < 1) { buckets.set(key, b); return false; }
    b.tokens -= 1; buckets.set(key, b); return true;
  };

  const send = (res: ServerResponse, status: number, body: unknown) => {
    const s = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(s);
  };

  const pages: Record<string, string> = { '/admin': 'admin.html', '/': 'projector.html', '/projector': 'projector.html', '/test': 'test.html', '/docs': 'docs.html', '/api': 'docs.html', '/editor': 'editor.html' };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Admin-Key', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
        return res.end();
      }
      // realtime stream (SSE). ?frames=1 adds 10 Hz traffic frames for the projector.
      if (url.pathname === `${V}/stream` && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*', 'X-Accel-Buffering': 'no' });
        const last = req.headers['last-event-id'] ?? url.searchParams.get('after') ?? undefined;
        const client = game.addClient((chunk) => res.write(chunk), () => res.end(), url.searchParams.get('frames') === '1', last !== undefined ? Number(last) : undefined);
        const ping = setInterval(() => res.write(': ping\n\n'), 15000);
        req.on('close', () => { clearInterval(ping); game.removeClient(client); });
        return;
      }
      if (url.pathname.startsWith(V)) {
        const ip = req.socket.remoteAddress ?? 'x';
        const auth = req.headers.authorization?.replace(/^Bearer\s+/i, '');
        if (!allow(`${ip}|${auth ?? ''}`)) return send(res, 429, { error: 'rate_limited', message: 'Te veel verzoeken, probeer het zo opnieuw' });
        const route = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
        if (!route) {
          const exists = routes.some((r) => r.re.test(url.pathname));
          return send(res, exists ? 405 : 404, { error: exists ? 'method_not_allowed' : 'not_found', message: 'Onbekend endpoint' });
        }
        const m = url.pathname.match(route.re)!;
        const params: Record<string, string> = {};
        route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        let body: Record<string, unknown> = {};
        if (req.method === 'POST') {
          const raw = await readBody(req, url.pathname.startsWith(`${V}/admin/map`) ? 8_000_000 : url.pathname === `${V}/admin/games/import` ? 60_000_000 : 256_000);
          if (raw) { try { body = JSON.parse(raw); } catch { throw new ApiError(422, 'invalid_json', 'Body is geen geldige JSON'); } }
        }
        const ctx: Ctx = { req, res, url, body, params, admin: false };
        if (route.auth === 'player') {
          ctx.player = game.playerByToken(auth);
          if (!ctx.player) throw new ApiError(401, 'unauthorized', 'Geldige spelerssessie vereist (Authorization: Bearer <token>)');
        }
        if (route.auth === 'admin') {
          const key = req.headers['x-admin-key'];
          if (!key) throw new ApiError(401, 'unauthorized', 'Admin-sleutel vereist (X-Admin-Key)');
          if (key !== game.cfg.adminKey) throw new ApiError(403, 'forbidden', 'Ongeldige admin-sleutel');
          ctx.admin = true;
        }
        const out = (await route.h(ctx)) as Record<string, unknown> | unknown[];
        if (out && !Array.isArray(out) && typeof out === 'object' && '__file' in out) {
          const f = (out as { __file: { path: string; name: string; type: string } }).__file;
          res.writeHead(200, { 'Content-Type': f.type, 'Content-Disposition': `attachment; filename="${f.name}"`, 'Cache-Control': 'no-store', 'Content-Length': statSync(f.path).size });
          return void createReadStream(f.path).pipe(res);
        }
        if (out && !Array.isArray(out) && typeof out === 'object' && '__status' in out) {
          const { __status, ...rest } = out as { __status: number };
          return send(res, __status, rest);
        }
        return send(res, 200, out ?? { ok: true });
      }
      // static
      if (pages[url.pathname]) return serveFile(res, join(opts.publicRoot, pages[url.pathname]));
      if (url.pathname.startsWith('/web/')) return serveFile(res, join(opts.webRoot, normalize(url.pathname.slice(5)).replace(/^(\.\.[/\\])+/, '')));
      if (url.pathname.startsWith('/assets/')) return serveFile(res, join(opts.publicRoot, normalize(url.pathname).replace(/^(\.\.[/\\])+/, '')));
      send(res, 404, { error: 'not_found' });
    } catch (e) {
      if (e instanceof ApiError) return send(res, e.status, { error: e.code, message: e.message, ...e.extra });
      if (e instanceof MapError) return send(res, e.status, { error: e.code, message: e.message, problems: e.problems });
      console.error(e);
      send(res, 500, { error: 'internal', message: String((e as Error).message ?? e) });
    }
  });
  server.listen(opts.port, opts.host, () => {
    const addrs = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a!.address);
    console.log(`\nHarderwold Tycoon prototype draait.`);
    console.log(`  Projectie (4K):   http://localhost:${opts.port}/`);
    console.log(`  Testinterface:    http://localhost:${opts.port}/test`);
    console.log(`  API-documentatie: http://localhost:${opts.port}/docs`);
    console.log(`  Kaarteditor:      http://localhost:${opts.port}/editor`);
    for (const a of addrs) console.log(`  In het LAN:       http://${a}:${opts.port}/`);
    console.log(`  Spelcode: ${game.cfg.gameCode}   Admin-sleutel: ${game.cfg.adminKey}\n`);
  });
  return server;
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => { size += c.length; if (size > limit) { reject(new ApiError(413, 'too_large', 'Body te groot')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveFile(res: ServerResponse, path: string) {
  if (!existsSync(path) || !statSync(path).isFile()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(readFileSync(path));
}
