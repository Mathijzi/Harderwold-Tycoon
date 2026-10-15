// Game server core: task state machine, score ledger, gate passage tokens, sim loop, persistence, realtime fan-out.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DB, openDb, tx, getMeta, setMeta, wipe } from './db.ts';
import { loadMapJson, loadNetwork, clearNetworkCache, mapDir } from '../sim/load.ts';
import { MapStore } from './mapstore.ts';
import { checksum } from '../shared/mapdoc.ts';
import { buildNetwork, Network, NetworkJson, SectorJson } from '../sim/network.ts';
import { ParkSim, Booking } from '../sim/park.ts';
import { rng } from '../shared/geom.ts';
import { TEMPLATES, CRISES, templateByCode, crisisByCode, TaskTemplate, Effect } from '../shared/tasklib.ts';
import { Scheduler, SchedulerConfig, SchedulerEnv, DEFAULT_SCHEDULER, validateSchedulerConfig } from '../sim/scheduler.ts';
import type { Backups } from './backup.ts';
import { WeatherState, WeatherKind, WEATHER_KINDS, WEATHER_NAMES, newWeather, stepWeather, forceWeather, groupFactor } from '../shared/weather.ts';
import { ContentStore, ContentError, NameLists, CustomTask } from './content.ts';
import { StoryDirector, StoryConfig, validateStoryConfig } from './stories.ts';

export interface GameConfig {
  dbPath: string; gameCode: string; adminKey: string; seed: number; timeScale: number;
  initialOccupied: number; demoBot: boolean; autoArrivals: boolean;
  /** check-in / check-out tasks are completed by the system after a short delay (no points); optional */
  autoGate?: boolean;
}

export type TaskState = 'offered' | 'claimed' | 'completed' | 'expired' | 'cancelled';
export interface TaskRow {
  id: string; template: string; kind: string; category: string; title: string; description: string;
  location_id: string | null; booking_id: string | null; vehicle_id: string | null; gate_id: string | null; icon: string;
  state: TaskState; assigned_player_id: string | null; offered_at: number; claimed_at: number | null; deadline_at: number | null;
  completed_at: number | null; claim_seconds: number; difficulty: string; urgency: string; points: number; points_awarded: number;
  version: number; attempt: number;
  parent_id?: string | null; depth?: number; escalated?: number; fx?: string | null;
}
export interface PlayerRow { id: string; game_id: string; display_name: string; token_hash: string; score: number; joined_at: number; is_test: number }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

const DIFF: Record<string, number> = { easy: 25, medium: 50, hard: 100, crisis: 150 };
const URG: Record<string, number> = { normal: 1, high: 1.25, critical: 1.5 };
export const pointsFor = (difficulty: string, urgency: string) => Math.round((DIFF[difficulty] * URG[urgency]) / 5) * 5;
const MAX_CLAIMS = 3;

// Incident templates live in src/shared/tasklib.ts (100+ templates in 10 groups, plus multi-step crises).

export interface SseClient { id: number; write: (chunk: string) => boolean; frames: boolean; debugKey?: boolean; close: () => void }

export class Game {
  db: DB;
  cfg: GameConfig;
  netJson!: NetworkJson;
  sectorJson!: SectorJson;
  net!: Network;
  park!: ParkSim;
  maps: MapStore;
  gameId = 'harderwold';
  paused = false;
  clockOriginMs = Date.now();
  private clients = new Set<SseClient>();
  private clientSeq = 0;
  private loop?: NodeJS.Timeout;
  private lastReal = 0;
  private acc = 0;
  private lastSave = 0;
  private lastFrame = 0;
  private lastState = 0;
  private lastExpire = 0;
  private botRand = rng(99);
  scheduler = new Scheduler(DEFAULT_SCHEDULER, 1);
  stories!: StoryDirector;
  /** projector display settings (game master) */
  display: { popupSeconds: number; dayNight: boolean; ambientSound: boolean; autoZoom: 'uit' | 'crises' | 'alles' } = { popupSeconds: 15, dayNight: true, ambientSound: true, autoZoom: 'crises' };
  /** name of the running game (game master) */
  gameName = 'Demo';
  /** current weather (persisted in meta 'weather', part of a saved game) */
  weather!: WeatherState;
  /** session plan of the running game: end time and arrivals/departures spread over it (game ms), or null */
  session: { startMs: number; endMs: number; arrivals: number[]; departures: number[]; arrivalsTotal: number; departuresTotal: number; ended: boolean } | null = null;
  content!: ContentStore;
  /** database backups (set by main.ts; absent in tests) */
  backups?: Backups;
  private schedCfg: SchedulerConfig = { ...DEFAULT_SCHEDULER };
  /** game minute a template was last created (key: code, and code|location) - cooldowns */
  private lastSeen = new Map<string, number>();
  private locState = new Map<string, Required<Effect>>();
  private facIndex: { id: string; key: string; name: string; pt: number[] }[] = [];
  private escalationLog: number[] = [];
  private nextAutoArrival = 0;
  readonly startedAt = Date.now();

  constructor(cfg: GameConfig) {
    this.cfg = cfg;
    this.db = openDb(cfg.dbPath);
    this.maps = new MapStore(this.db, mapDir());
    this.stories = this.makeStories();
    try { this.display = { ...this.display, ...JSON.parse(getMeta(this.db, 'display') ?? '{}') }; } catch { /* defaults */ }
    const { net, sector } = loadMapJson();
    this.netJson = net; this.sectorJson = sector;
    this.net = loadNetwork(); // built once per process (the map is static)
    this.indexFacilities();
    this.content = new ContentStore(this.db, () => new Set(this.facIndex.map((f) => f.key)));
    if (!this.restoreFromDb()) this.resetGame(cfg.seed, false);
  }

  /** Continue the game stored in the database (after a restart or loading a saved game). False = nothing usable. */
  private restoreFromDb(): boolean {
    const cfg = this.cfg;
    const savedSched = getMeta(this.db, 'scheduler');
    if (savedSched) try { this.schedCfg = { ...DEFAULT_SCHEDULER, ...JSON.parse(savedSched).cfg }; } catch { /* defaults */ }
    try { this.display = { popupSeconds: 15, dayNight: true, ambientSound: true, autoZoom: 'crises', ...JSON.parse(getMeta(this.db, 'display') ?? '{}') }; } catch { /* defaults */ }
    if (getMeta(this.db, 'seed')) cfg.seed = Number(getMeta(this.db, 'seed'));
    if (getMeta(this.db, 'gameCode')) cfg.gameCode = getMeta(this.db, 'gameCode')!;
    this.gameName = getMeta(this.db, 'gameName') ?? 'Demo';
    try { this.weather = JSON.parse(getMeta(this.db, 'weather') ?? 'null') ?? undefined; } catch { /* new below */ }
    try { this.session = JSON.parse(getMeta(this.db, 'session') ?? 'null'); } catch { this.session = null; }
    this.stories.reloadConfig();
    const saved = this.db.prepare('SELECT park FROM sim_state WHERE id = 1').get() as { park: string } | undefined;
    this.park = this.makePark(cfg.seed);
    // a saved game belongs to the map it was played on: after a map change (update, editor) its vehicles, stalls,
    // queues and tasks no longer match the roads, so it is not restored
    const sameMap = getMeta(this.db, 'mapChecksum') === this.mapChecksum();
    if (saved && getMeta(this.db, 'gameId') && !sameMap) console.warn('De kaart is gewijzigd sinds het spel werd opgeslagen: er wordt een nieuw spel gestart (het oude past niet bij de nieuwe wegen).');
    if (saved && getMeta(this.db, 'gameId') && sameMap) {
      this.park.restore(saved.park);
      this.clockOriginMs = Number(getMeta(this.db, 'clockOriginMs') ?? Date.now());
      this.cfg.timeScale = Number(getMeta(this.db, 'timeScale') ?? cfg.timeScale);
      this.cfg.demoBot = getMeta(this.db, 'demoBot') === '1';
      this.cfg.autoArrivals = getMeta(this.db, 'autoArrivals') !== '0';
      this.cfg.autoGate = getMeta(this.db, 'autoGate') === '1';
      this.reconcilePassages();
      // task scheduler, cooldown memory and location condition continue where they were
      try { this.scheduler = new Scheduler(this.schedCfg, cfg.seed, JSON.parse(savedSched ?? '{}').state); } catch { this.scheduler = new Scheduler(this.schedCfg, cfg.seed); }
      for (const r of this.db.prepare("SELECT template, location_id, MAX(offered_at) AS at FROM tasks WHERE kind = 'incident' GROUP BY template, location_id").all() as { template: string; location_id: string; at: number }[]) {
        const m = r.at / 60000;
        this.lastSeen.set(`${r.template}|${r.location_id}`, m);
        if ((this.lastSeen.get(r.template) ?? -Infinity) < m) this.lastSeen.set(r.template, m);
      }
      for (const r of this.db.prepare('SELECT code, location_id, started_at FROM incidents').all() as { code: string; location_id: string; started_at: number }[]) { this.lastSeen.set(r.code, r.started_at / 60000); this.lastSeen.set(`${r.code}|${r.location_id}`, r.started_at / 60000); }
      for (const r of this.db.prepare('SELECT * FROM location_state').all() as { id: string; tech: number; clean: number; mood: number }[]) this.locState.set(r.id, { tech: r.tech, clean: r.clean, mood: r.mood });
      this.event('server.restored', { simTime: this.park.t, vehicles: this.park.traffic.vehicles.length });
      return true;
    }
    return false;
  }

  private makePark(seed: number) {
    return new ParkSim(this.net, {
      consumeToken: (vid, gid) => this.consumeToken(vid, gid),
      onPassageDone: (pid, status) => this.finishPassage(pid, status),
      servicePass: (vid, gid) => this.servicePass(vid, gid),
      onEvent: (type, payload) => this.event(type, payload),
      // a check-in/check-out is only requested by the car that stands at the barrier, not by cars further back
      onQueued: () => {},
      onAtGate: (b, gateId, dir) => this.createGateTask(b, gateId, dir),
    }, seed);
  }

  // ------------------------------------------------------------------ clock & events
  nowMs() { return Math.round(this.clockOriginMs + this.park.t * 1000); }

  event(type: string, payload: Record<string, unknown>) {
    const created = Date.now();
    const gm = this.nowMs();
    const r = this.db.prepare('INSERT INTO events (type, payload, game_ms, created_at) VALUES (?, ?, ?, ?)').run(type, JSON.stringify(payload), gm, created);
    const seq = Number(r.lastInsertRowid);
    const msg = `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify({ seq, type, gameMs: gm, ...payload })}\n\n`;
    for (const c of this.clients) c.write(msg);
    return seq;
  }
  latestEventSeq() { return (this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM events').get() as { m: number }).m; }
  eventsAfter(after: number, limit = 200) {
    return (this.db.prepare('SELECT seq, type, payload, game_ms FROM events WHERE seq > ? ORDER BY seq LIMIT ?').all(after, Math.min(limit, 1000)) as { seq: number; type: string; payload: string; game_ms: number }[])
      .map((e) => ({ seq: e.seq, type: e.type, gameMs: e.game_ms, ...JSON.parse(e.payload) }));
  }
  addClient(write: SseClient['write'], close: () => void, frames: boolean, after?: number, debug = false): SseClient {
    const c: SseClient = { id: ++this.clientSeq, write, frames, close, debugKey: debug };
    this.clients.add(c);
    write(`retry: 2000\n\n`);
    if (after !== undefined) for (const e of this.eventsAfter(after, 500)) write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    write(`id: ${this.latestEventSeq()}\nevent: state\ndata: ${JSON.stringify(this.projectorState())}\n\n`);
    return c;
  }
  removeClient(c: SseClient) { this.clients.delete(c); }
  clientCount() { return this.clients.size; }

  // ------------------------------------------------------------------ players
  private hash(token: string) { return createHash('sha256').update(token).digest('hex'); }
  join(gameCode: string, displayName: string, isTest = false) {
    if (gameCode !== this.cfg.gameCode) throw new ApiError(403, 'bad_game_code', 'Onbekende spelcode');
    const name = (displayName ?? '').trim();
    if (name.length < 2 || name.length > 24) throw new ApiError(422, 'invalid_name', 'Naam moet 2 tot 24 tekens zijn');
    const token = randomBytes(24).toString('base64url');
    const id = `pl-${randomUUID().slice(0, 8)}`;
    try {
      this.db.prepare('INSERT INTO players (id, game_id, display_name, token_hash, score, joined_at, is_test) VALUES (?, ?, ?, ?, 0, ?, ?)').run(id, this.gameId, name, this.hash(token), Date.now(), isTest ? 1 : 0);
    } catch (e) {
      if (String(e).includes('UNIQUE')) throw new ApiError(409, 'name_taken', 'Deze naam is al in gebruik in dit spel');
      throw e;
    }
    this.event('player.joined', { playerId: id, displayName: name });
    this.broadcastState();
    return { playerId: id, displayName: name, token };
  }
  playerByToken(token: string | undefined): PlayerRow | undefined {
    if (!token) return undefined;
    return this.db.prepare('SELECT * FROM players WHERE token_hash = ?').get(this.hash(token)) as PlayerRow | undefined;
  }
  /** Dev/test convenience (admin only): rotate and return a session token for a test player. */
  issueTestToken(playerId: string) {
    const p = this.db.prepare('SELECT * FROM players WHERE id = ?').get(playerId) as PlayerRow | undefined;
    if (!p) throw new ApiError(404, 'not_found', 'Speler niet gevonden');
    const token = randomBytes(24).toString('base64url');
    this.db.prepare('UPDATE players SET token_hash = ? WHERE id = ?').run(this.hash(token), playerId);
    this.audit('admin', 'issue_test_token', { playerId });
    return { playerId, displayName: p.display_name, token };
  }
  leaderboard() {
    return (this.db.prepare('SELECT p.id, p.display_name AS displayName, p.score, (SELECT COUNT(*) FROM tasks t WHERE t.assigned_player_id = p.id AND t.state = \'claimed\') AS activeTasks FROM players p ORDER BY p.score DESC, p.joined_at ASC').all() as { id: string; displayName: string; score: number; activeTasks: number }[])
      .map((r, i) => ({ rank: i + 1, ...r }));
  }
  players() { return this.db.prepare('SELECT id, display_name AS displayName, score, is_test AS isTest, joined_at AS joinedAt FROM players ORDER BY joined_at').all(); }

  // ------------------------------------------------------------------ tasks
  getTask(id: string) { return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined; }
  listTasks(state?: string, limit = 200) {
    const rows = state
      ? this.db.prepare('SELECT * FROM tasks WHERE state = ? ORDER BY offered_at DESC LIMIT ?').all(state, limit)
      : this.db.prepare("SELECT * FROM tasks WHERE state IN ('offered','claimed') OR completed_at > ? ORDER BY offered_at DESC LIMIT ?").all(this.nowMs() - 3600_000, limit);
    return (rows as unknown as TaskRow[]).map((t) => this.taskDto(t));
  }
  taskDto(t: TaskRow) {
    const pl = t.assigned_player_id ? (this.db.prepare('SELECT display_name FROM players WHERE id = ?').get(t.assigned_player_id) as { display_name: string } | undefined) : undefined;
    let queuePosition: number | undefined;
    if (t.vehicle_id && t.gate_id) {
      const q = this.park.traffic.gates.get(t.gate_id)?.queue ?? [];
      const i = q.indexOf(t.vehicle_id);
      if (i >= 0) queuePosition = i + 1;
    }
    return {
      id: t.id, template: t.template, kind: t.kind, category: t.category, title: t.title, description: t.description,
      locationId: t.location_id, bookingId: t.booking_id, vehicleId: t.vehicle_id, gateId: t.gate_id, icon: t.icon,
      state: t.state, assignedPlayerId: t.assigned_player_id, assignedPlayerName: pl?.display_name ?? null,
      offeredAt: t.offered_at, claimedAt: t.claimed_at, deadlineAt: t.deadline_at, completedAt: t.completed_at,
      claimSeconds: t.claim_seconds, difficulty: t.difficulty, urgency: t.urgency, points: t.points, pointsAwarded: t.points_awarded,
      version: t.version, attempt: t.attempt, queuePosition, parentId: t.parent_id ?? null,
      technician: t.state === 'claimed' ? this.park.techStatus(t.id) ?? null : null,
    };
  }

  private insertTask(t: Omit<TaskRow, 'state' | 'assigned_player_id' | 'claimed_at' | 'deadline_at' | 'completed_at' | 'points_awarded' | 'version' | 'attempt'>) {
    const r = this.db.prepare(`INSERT OR IGNORE INTO tasks (id, template, kind, category, title, description, location_id, booking_id, vehicle_id, gate_id, icon, state, offered_at, claim_seconds, difficulty, urgency, points, parent_id, depth, fx)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'offered', ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      t.id, t.template, t.kind, t.category, t.title, t.description, t.location_id, t.booking_id, t.vehicle_id, t.gate_id, t.icon, t.offered_at, t.claim_seconds, t.difficulty, t.urgency, t.points,
      t.parent_id ?? null, t.depth ?? 0, t.fx ?? null);
    if (r.changes) { this.event('task.created', { task: this.taskDto(this.getTask(t.id)!) }); this.broadcastState(); }
    return r.changes > 0;
  }

  /** Check-in / check-out task linked to exactly one vehicle and gate (idempotent: unique per kind+vehicle+gate). */
  createGateTask(b: Booking, gateId: string, direction: 'inbound' | 'outbound') {
    const kind = direction === 'inbound' ? 'checkin' : 'checkout';
    const veh = this.park.traffic.vehicles.find((v) => v.spec.id === b.vehicleId);
    const plate = veh?.spec.plate ?? '';
    const lead = b.guests.map((g) => g.name).slice(0, 2).join(' & ');
    this.insertTask({
      id: `T-${kind}-${b.vehicleId}`, template: kind === 'checkin' ? 'REC_CHECKIN' : 'REC_CHECKOUT', kind, category: 'Receptie',
      title: kind === 'checkin' ? `Check-in ${b.household}` : `Check-out ${b.household}`,
      description: kind === 'checkin'
        ? `${b.household} (${lead}${b.guests.length > 2 ? ' e.a.' : ''}) wacht met kenteken ${plate} voor de inrijslagboom. Controleer de reservering voor bungalow ${b.houseNumber} en geef de sleutel mee.`
        : `${b.household} staat met kenteken ${plate} voor de uitrijslagboom. Neem de sleutel van bungalow ${b.houseNumber} in en rond de eindafrekening af.`,
      location_id: kind === 'checkin' ? 'F-A' : `H${b.houseNumber}`, booking_id: b.id, vehicle_id: b.vehicleId, gate_id: gateId,
      icon: kind === 'checkin' ? 'checkin' : 'checkout', offered_at: this.nowMs(), claim_seconds: 300, difficulty: 'easy', urgency: 'normal', points: pointsFor('easy', 'normal'),
    });
  }

  // ------------------------------------------------------------------ incidents (task library + scheduler)
  gameMin() { return this.nowMs() / 60000; }
  private clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  /** local (Europe/Amsterdam) hour of day and day index of the game clock */
  localClock(ms = this.nowMs()) {
    const p = Object.fromEntries(this.clockFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return { hour: Number(p.hour) + Number(p.minute) / 60, dayIndex: Math.floor(Date.UTC(+p.year, +p.month - 1, +p.day) / 86400000) };
  }
  /** Facilities that occur more than once on the PDF for real (playgrounds, outdoor spots). For the buildings of the
   *  central complex (reception, brasserie, shop, ...) only the most central instance is a task location: the other
   *  letters are elsewhere on the drawing (legend) and would put pins in the forest. Assumption, see REFERENTIES. */
  static MULTI_FACILITIES = new Set(['S', 'X', 'Z', 'E', 'Q', 'R', 'U', 'O', 'L', 'W']);
  static taskFacility(id: string, key: string) { return id === `F-${key}` || Game.MULTI_FACILITIES.has(key); }
  /** facilities with unique location ids (F-<letter>, F-<letter>2, ...) */
  private indexFacilities() {
    const seen = new Map<string, number>();
    // with a letter that occurs more than once (3x reception, 9 playgrounds) the most central one is the main location
    const vp = this.sectorJson.viewPts, cx = (vp[0] + vp[2]) / 2, cy = (vp[1] + vp[3]) / 2;
    const facs = [...(this.sectorJson.facilities as { key: string; name: string; pt: number[] }[])].sort((a, b) => Math.hypot(a.pt[0] - cx, a.pt[1] - cy) - Math.hypot(b.pt[0] - cx, b.pt[1] - cy));
    this.facIndex = facs.map((f) => {
      const n = (seen.get(f.key) ?? 0) + 1; seen.set(f.key, n);
      return { id: n === 1 ? `F-${f.key}` : `F-${f.key}${n}`, key: f.key, name: f.name, pt: f.pt };
    });
  }
  locationName(id: string, grounds = false) {
    if (id.startsWith('H')) return grounds ? `het pad bij bungalow ${id.slice(1)}` : `bungalow ${id.slice(1)}`;
    return this.facIndex.find((f) => f.id === id)?.name ?? id;
  }
  private schedEnv(): SchedulerEnv {
    const occupied: string[] = [], vacant: string[] = [], houses: string[] = [];
    for (const h of this.net.houses) {
      const st = this.park.houses.get(h.number)?.state;
      houses.push(h.id);
      if (st === 'occupied') occupied.push(h.id); else if (st === 'vacant' || st === 'needs_cleaning') vacant.push(h.id);
    }
    const facilities = new Map<string, string[]>();
    for (const f of this.facIndex) if (Game.taskFacility(f.id, f.key)) (facilities.get(f.key) ?? facilities.set(f.key, []).get(f.key)!).push(f.id);
    const open = this.db.prepare("SELECT location_id, parent_id FROM tasks WHERE kind = 'incident' AND state IN ('offered','claimed')").all() as { location_id: string; parent_id: string | null }[];
    const clock = this.localClock();
    return {
      nowMin: this.gameMin(), hour: clock.hour, dayIndex: clock.dayIndex, occupied, vacant, houses, facilities,
      occupancy: this.net.houses.length ? occupied.length / this.net.houses.length : 0,
      openNormal: open.filter((o) => !o.parent_id).length, busy: new Set(open.map((o) => o.location_id)),
      lastAt: (code, loc) => this.lastSeen.get(loc ? `${code}|${loc}` : code),
      groupFactor: (g) => (this.weather ? groupFactor(this.weather.kind, g) : 1),
    };
  }
  private noteCreated(code: string, loc: string) { const m = this.gameMin(); this.lastSeen.set(code, m); this.lastSeen.set(`${code}|${loc}`, m); }
  /** allowBusy: a crisis/story report or a task placed by the game master may share a facility that already has an
   *  open task (a crisis at the pool must not vanish because a normal pool task is open) */
  private pickLocation(tpl: TaskTemplate, env: SchedulerEnv, allowBusy = false): string | undefined {
    const r = tpl.location;
    const list = r.kind === 'house' ? (r.vacant ? env.vacant : r.occupied ? env.occupied : env.houses) : r.kind === 'grounds' ? env.houses : (r.facilities ?? []).flatMap((f) => env.facilities.get(f) ?? []);
    const free = list.filter((l) => !env.busy.has(l));
    const pool = free.length ? free : r.kind === 'house' && r.occupied ? env.houses.filter((l) => !env.busy.has(l)) : allowBusy ? list : [];
    return pool.length ? this.botRand.pick(pool) : undefined;
  }

  /** Create an incident task from the library (random suitable template when none is given). */
  createIncident(opts: { template?: string; houseNumber?: number; locationId?: string; parentId?: string | null; depth?: number; vars?: Record<string, string> } = {}) {
    const env = this.schedEnv();
    let tpl: TaskTemplate | undefined;
    if (opts.template) {
      tpl = templateByCode.get(opts.template);
      if (!tpl) throw new ApiError(422, 'unknown_template', 'Onbekend sjabloon');
    } else {
      const s = this.scheduler.suggest(env);
      tpl = s ? templateByCode.get(s.code) : undefined;
      if (s && !opts.locationId && !opts.houseNumber) opts = { ...opts, locationId: s.location };
      if (!tpl) throw new ApiError(409, 'no_location', 'Geen geschikte opdracht of vrije locatie');
    }
    let loc = opts.locationId ?? (opts.houseNumber ? `H${opts.houseNumber}` : undefined);
    if (loc && loc.startsWith('H') && !this.net.houses.some((h) => h.id === loc)) throw new ApiError(404, 'no_location', `Bungalow ${loc.slice(1)} bestaat niet`);
    if (loc && tpl.location.kind === 'facility' && !loc.startsWith('F-')) loc = undefined; // a facility task belongs at its facility
    loc ??= this.pickLocation(tpl, env, !!opts.parentId || !!opts.template);
    if (!loc) throw new ApiError(409, 'no_location', 'Geen vrije locatie');
    const id = `T-inc-${randomUUID().slice(0, 8)}`;
    const nm = this.locationName(loc, tpl.location.kind === 'grounds');
    let text = this.botRand.pick(tpl.texts).replaceAll('{loc}', nm).replaceAll('{n}', loc.startsWith('H') ? loc.slice(1) : nm);
    for (const [k, v] of Object.entries(opts.vars ?? {})) text = text.replaceAll(`{${k}}`, v);
    const short = loc.startsWith('H') ? loc.slice(1) : nm;
    this.insertTask({
      id, template: tpl.code, kind: 'incident', category: tpl.category, title: `${tpl.title} (${short})`, description: text,
      location_id: loc, booking_id: null, vehicle_id: null, gate_id: null, icon: tpl.icon, offered_at: this.nowMs(), claim_seconds: Math.round(tpl.claimMin * 60),
      difficulty: tpl.difficulty, urgency: tpl.urgency, points: pointsFor(tpl.difficulty, tpl.urgency), parent_id: opts.parentId ?? null, depth: opts.depth ?? 0, fx: tpl.fx,
    });
    this.noteCreated(tpl.code, loc);
    return this.taskDto(this.getTask(id)!);
  }

  /** Major incident (crisis): an incident record with stages of independently claimable tasks. */
  createCrisis(opts: { code?: string; locationId?: string } = {}) {
    const env = this.schedEnv();
    const c = opts.code ? crisisByCode.get(opts.code) : this.botRand.pick(CRISES);
    if (!c) throw new ApiError(422, 'unknown_crisis', 'Onbekende crisis');
    const active = this.db.prepare("SELECT COUNT(*) AS n FROM incidents WHERE state = 'active' AND code = ?").get(c.code) as { n: number };
    if (active.n) throw new ApiError(409, 'crisis_active', `${c.title} loopt al`);
    const list = c.location.kind === 'facility' ? (c.location.facilities ?? []).flatMap((f) => env.facilities.get(f) ?? []) : env.houses;
    const loc = opts.locationId ?? (list.length ? this.botRand.pick(list) : undefined);
    if (!loc) throw new ApiError(409, 'no_location', 'Geen locatie voor deze crisis');
    const id = `C-${randomUUID().slice(0, 8)}`;
    const text = this.botRand.pick(c.texts).replaceAll('{loc}', this.locationName(loc, c.location.kind === 'grounds'));
    this.db.prepare("INSERT INTO incidents (id, code, title, description, location_id, stage, state, started_at) VALUES (?, ?, ?, ?, ?, 0, 'active', ?)").run(id, c.code, c.title, text, loc, this.nowMs());
    // the storm crisis brings the thunderstorm with it (for about as long as the crisis lasts)
    if (c.code === 'CRISIS_STORM' && this.weather && this.weather.kind !== 'onweer') { forceWeather(this.weather, 'onweer', this.nowMs(), this.localClock().hour, 45); this.weather.locked = false; this.event('weather.changed', { kind: 'onweer', name: WEATHER_NAMES.onweer }); }
    this.noteCreated(c.code, loc);
    this.event('incident.started', { incidentId: id, code: c.code, title: c.title, description: text, locationId: loc, stage: c.stages[0].text });
    this.spawnStage(id, c.stages[0].tasks, loc);
    this.audit('system', 'crisis_started', { incidentId: id, code: c.code });
    return this.incidentDto(id);
  }
  private spawnStage(incidentId: string, codes: string[], crisisLoc: string) {
    for (const code of codes) {
      const tpl = templateByCode.get(code)!;
      // a subtask at a facility goes to that facility; otherwise to the crisis location
      const loc = tpl.location.kind === 'facility' ? undefined : crisisLoc;
      try { this.createIncident({ template: code, locationId: loc, parentId: incidentId }); } catch { /* no location: skipped */ }
    }
  }
  private crisisTick() {
    const act = this.db.prepare("SELECT * FROM incidents WHERE state = 'active'").all() as { id: string; code: string; location_id: string; stage: number; started_at: number }[];
    for (const inc of act) {
      const c = crisisByCode.get(inc.code); if (!c) continue;
      const next = c.stages[inc.stage + 1];
      const elapsedMin = (this.nowMs() - inc.started_at) / 60000;
      if (next && elapsedMin >= next.afterMin) {
        this.db.prepare('UPDATE incidents SET stage = stage + 1 WHERE id = ?').run(inc.id);
        this.event('incident.escalated', { incidentId: inc.id, code: inc.code, stage: inc.stage + 1, text: next.text });
        this.spawnStage(inc.id, next.tasks, inc.location_id);
        continue;
      }
      if (next) continue;
      const open = (this.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE parent_id = ? AND state IN ('offered','claimed')").get(inc.id) as { n: number }).n;
      if (!open) {
        this.db.prepare("UPDATE incidents SET state = 'resolved', resolved_at = ? WHERE id = ?").run(this.nowMs(), inc.id);
        this.applyEffect(inc.location_id, { mood: 0.2, tech: 0.2 });
        this.event('incident.resolved', { incidentId: inc.id, code: inc.code, locationId: inc.location_id });
        this.event('visual.effect', { locationId: inc.location_id, fx: 'confetti' });
        this.broadcastState();
      }
    }
  }
  /** status of the running crises for the projector panel and the dashboard */
  crisisStatus() {
    const rows = this.db.prepare("SELECT id, code, title, location_id, stage, started_at FROM incidents WHERE state = 'active' ORDER BY started_at").all() as { id: string; code: string; title: string; location_id: string; stage: number; started_at: number }[];
    return rows.map((r) => {
      const c = crisisByCode.get(r.code);
      const tasks = this.db.prepare('SELECT state FROM tasks WHERE parent_id = ?').all(r.id) as { state: string }[];
      const total = c ? c.stages.reduce((a, st) => a + st.tasks.length, 0) : tasks.length;
      const next = c?.stages[r.stage + 1];
      return {
        id: r.id, code: r.code, title: r.title, locationId: r.location_id, locationName: this.locationName(r.location_id, c?.location.kind === 'grounds'),
        stage: r.stage, stages: c?.stages.length ?? 1, current: c?.stages[r.stage]?.text ?? '', startedAt: r.started_at,
        done: tasks.filter((t) => t.state === 'completed').length, open: tasks.filter((t) => t.state === 'offered' || t.state === 'claimed').length, claimed: tasks.filter((t) => t.state === 'claimed').length, total,
        nextAt: next ? r.started_at + next.afterMin * 60000 : null,
      };
    });
  }
  incidentDto(id: string) {
    const r = this.db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as { id: string; code: string; title: string; description: string; location_id: string; stage: number; state: string; started_at: number; resolved_at: number | null } | undefined;
    if (!r) throw new ApiError(404, 'not_found', 'Crisis niet gevonden');
    const tasks = (this.db.prepare('SELECT * FROM tasks WHERE parent_id = ? ORDER BY offered_at').all(id) as unknown as TaskRow[]).map((t) => this.taskDto(t));
    return { id: r.id, code: r.code, title: r.title, description: r.description, locationId: r.location_id, stage: r.stage, stages: crisisByCode.get(r.code)?.stages.length ?? 1, state: r.state, startedAt: r.started_at, resolvedAt: r.resolved_at, tasks };
  }
  listIncidents(all = false) {
    const rows = this.db.prepare(all ? 'SELECT id FROM incidents ORDER BY started_at DESC LIMIT 50' : "SELECT id FROM incidents WHERE state = 'active' ORDER BY started_at").all() as { id: string }[];
    return rows.map((r) => this.incidentDto(r.id));
  }

  // location condition (tech / clean / mood per bungalow or facility)
  private stateOf(id: string): Required<Effect> { return this.locState.get(id) ?? { tech: 0.85, clean: 0.85, mood: 0.85 }; }
  applyEffect(id: string | null, e: Effect) {
    if (!id) return;
    const c = this.stateOf(id), cl = (v: number) => Math.max(0, Math.min(1, +v.toFixed(3)));
    const n = { tech: cl(c.tech + (e.tech ?? 0)), clean: cl(c.clean + (e.clean ?? 0)), mood: cl(c.mood + (e.mood ?? 0)) };
    this.locState.set(id, n);
    this.db.prepare('INSERT INTO location_state (id, tech, clean, mood, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET tech = excluded.tech, clean = excluded.clean, mood = excluded.mood, updated_at = excluded.updated_at').run(id, n.tech, n.clean, n.mood, this.nowMs());
  }
  /** locations in the worst condition (game master overview) */
  worstLocations(n = 10) {
    return [...this.locState.keys()].map((id) => ({ id, name: this.locationName(id), cond: this.condOf(id), ...this.stateOf(id) })).filter((x) => x.cond < 0.8).sort((a, b) => a.cond - b.cond).slice(0, n);
  }
  /** overall condition of one location (0..1, mean of technical state, cleanliness and mood) */
  condOf(id: string) { const c = this.stateOf(id); return +((c.tech + c.clean + c.mood) / 3).toFixed(2); }
  /** park health: average condition over all bungalows and facilities (untouched locations count as 0.85) */
  parkHealth() {
    const ids = [...this.net.houses.map((h) => h.id), ...this.facIndex.map((f) => f.id)];
    const sum = { tech: 0, clean: 0, mood: 0 };
    for (const id of ids) { const c = this.stateOf(id); sum.tech += c.tech; sum.clean += c.clean; sum.mood += c.mood; }
    const n = ids.length || 1, r = (v: number) => +(v / n).toFixed(3);
    return { tech: r(sum.tech), clean: r(sum.clean), mood: r(sum.mood), overall: r((sum.tech + sum.clean + sum.mood) / 3) };
  }
  /** escalation of an incident task that timed out: one follow-up (bounded depth, global budget) */
  private escalate(t: TaskRow, why: string) {
    const tpl = templateByCode.get(t.template);
    const nextCode = tpl?.onTimeout.escalate;
    if (!nextCode || t.escalated || (t.depth ?? 0) >= 2) return;
    const now = this.gameMin();
    this.escalationLog = this.escalationLog.filter((m) => now - m < 60);
    if (this.escalationLog.length >= 4) return; // global budget: at most 4 escalations per game hour
    const last = this.lastSeen.get(`${nextCode}|${t.location_id}`);
    if (last !== undefined && now - last < (templateByCode.get(nextCode)?.cooldownMin ?? 60)) return;
    this.db.prepare('UPDATE tasks SET escalated = 1 WHERE id = ?').run(t.id);
    try {
      const f = this.createIncident({ template: nextCode, locationId: t.location_id ?? undefined, parentId: t.parent_id ?? null, depth: (t.depth ?? 0) + 1 });
      this.escalationLog.push(now);
      this.event('task.escalated', { taskId: t.id, followUpTaskId: f.id, template: nextCode, reason: why });
    } catch { /* no location */ }
  }

  private idem(key: string | undefined, playerId: string, action: string, taskId: string, run: () => { status: number; body: unknown }) {
    if (!key || typeof key !== 'string' || key.length < 4 || key.length > 100) throw new ApiError(422, 'idempotency_key_required', 'idempotencyKey (4-100 tekens) is verplicht');
    return tx(this.db, () => {
      const prev = this.db.prepare('SELECT status, response, task_id FROM idempotency WHERE key = ? AND player_id = ? AND action = ?').get(key, playerId, action) as { status: number; response: string; task_id: string } | undefined;
      if (prev) {
        if (prev.task_id !== taskId) throw new ApiError(422, 'idempotency_key_reused', 'Deze idempotencyKey hoort bij een andere opdracht');
        return { status: prev.status, body: { ...JSON.parse(prev.response), replayed: true } };
      }
      let res: { status: number; body: unknown };
      try { res = run(); } catch (e) {
        if (e instanceof ApiError) res = { status: e.status, body: { error: e.code, message: e.message, ...e.extra } }; else throw e;
      }
      this.db.prepare('INSERT INTO idempotency (key, player_id, action, task_id, status, response, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(key, playerId, action, taskId, res.status, JSON.stringify(res.body), Date.now());
      return res;
    });
  }

  claim(taskId: string, player: PlayerRow, key: string) {
    const res = this.idem(key, player.id, 'claim', taskId, () => {
      const t = this.getTask(taskId);
      if (!t) throw new ApiError(404, 'not_found', 'Opdracht bestaat niet');
      if (t.state === 'claimed' && t.assigned_player_id === player.id) return { status: 200, body: { task: this.taskDto(t), alreadyClaimed: true } };
      if (t.state !== 'offered') throw new ApiError(409, t.state === 'claimed' ? 'already_claimed' : 'not_offered', t.state === 'claimed' ? 'Een andere speler was je voor' : `Opdracht is ${t.state}`, { state: t.state });
      const active = (this.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE assigned_player_id = ? AND state = 'claimed'").get(player.id) as { n: number }).n;
      if (active >= MAX_CLAIMS) throw new ApiError(409, 'claim_limit', `Je hebt al ${MAX_CLAIMS} actieve opdrachten`);
      const now = this.nowMs();
      const r = this.db.prepare("UPDATE tasks SET state = 'claimed', assigned_player_id = ?, claimed_at = ?, deadline_at = ?, version = version + 1 WHERE id = ? AND state = 'offered' AND version = ?")
        .run(player.id, now, now + t.claim_seconds * 1000, taskId, t.version);
      if (r.changes !== 1) throw new ApiError(409, 'already_claimed', 'Een andere speler was je voor');
      return { status: 200, body: { task: this.taskDto(this.getTask(taskId)!) } };
    });
    if (res.status === 200 && !(res.body as { replayed?: boolean; alreadyClaimed?: boolean }).replayed && !(res.body as { alreadyClaimed?: boolean }).alreadyClaimed) {
      this.event('task.claimed', { taskId, playerId: player.id, displayName: player.display_name });
      this.techStart(this.getTask(taskId)!);
      this.broadcastState();
    }
    return res;
  }

  complete(taskId: string, player: PlayerRow, key: string) {
    let issued: { passageId: string; gateId: string; vehicleId: string } | null = null;
    let awarded = 0;
    // TD incidents: the mechanic has to be on site first. Checked outside idem() so this transient refusal is not
    // stored under the idempotency key and the same key works once the mechanic has arrived.
    const pre = this.getTask(taskId);
    if (pre && key && typeof key === 'string' && key.length >= 4 && key.length <= 100 && pre.state === 'claimed' && pre.assigned_player_id === player.id) this.assertTechOnSite(pre);
    const res = this.idem(key, player.id, 'complete', taskId, () => {
      const t = this.getTask(taskId);
      if (!t) throw new ApiError(404, 'not_found', 'Opdracht bestaat niet');
      if (t.state === 'completed') {
        if (t.assigned_player_id === player.id) return { status: 200, body: { task: this.taskDto(t), alreadyCompleted: true, pointsAwarded: 0 } };
        throw new ApiError(409, 'already_completed', 'Opdracht is al afgerond');
      }
      if (t.state !== 'claimed') throw new ApiError(409, 'not_claimed', 'Claim de opdracht eerst');
      if (t.assigned_player_id !== player.id) throw new ApiError(403, 'not_assignee', 'Deze opdracht is door een andere speler geclaimd');
      const now = this.nowMs();
      if (t.deadline_at !== null && now > t.deadline_at) throw new ApiError(409, 'deadline_passed', 'De deadline is verstreken; de opdracht wordt opnieuw aangeboden');
      const r = this.db.prepare("UPDATE tasks SET state = 'completed', completed_at = ?, points_awarded = points, version = version + 1 WHERE id = ? AND state = 'claimed' AND assigned_player_id = ? AND version = ?").run(now, taskId, player.id, t.version);
      if (r.changes !== 1) throw new ApiError(409, 'conflict', 'Opdracht is gewijzigd, probeer opnieuw');
      this.db.prepare('INSERT INTO score_ledger (player_id, task_id, points, reason, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(player.id, taskId, t.points, `task:${t.template}`, player.id, Date.now());
      this.db.prepare('UPDATE players SET score = score + ? WHERE id = ?').run(t.points, player.id);
      awarded = t.points;
      if ((t.kind === 'checkin' || t.kind === 'checkout') && t.vehicle_id && t.gate_id) {
        const pid = `GP-${randomUUID().slice(0, 12)}`;
        this.db.prepare("INSERT INTO gate_passages (id, session_id, vehicle_id, gate_id, direction, task_id, source, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'task', 'authorized', ?)")
          .run(pid, this.gameId, t.vehicle_id, t.gate_id, t.kind === 'checkin' ? 'inbound' : 'outbound', taskId, now);
        issued = { passageId: pid, gateId: t.gate_id, vehicleId: t.vehicle_id };
      }
      return { status: 200, body: { task: this.taskDto(this.getTask(taskId)!), pointsAwarded: t.points, passage: issued } };
    });
    if (res.status === 200 && awarded > 0) {
      const t = this.getTask(taskId)!;
      const tpl = t.kind === 'incident' ? templateByCode.get(t.template) : undefined;
      this.event('task.completed', { taskId, playerId: player.id, displayName: player.display_name, points: awarded, kind: t.kind, locationId: t.location_id, gateId: t.gate_id, fx: t.fx ?? null });
      if (tpl) { this.applyEffect(t.location_id, tpl.onComplete); this.event('visual.effect', { locationId: t.location_id, fx: tpl.fx }); }
      this.techStop(taskId);
      if (t.parent_id?.startsWith('S-')) this.stories.onTaskOutcome(taskId, t.parent_id, 'completed');
      if (issued) this.event('gate.token_issued', issued);
      if (t.kind === 'checkin' || t.kind === 'checkout') {
        const b = t.booking_id ? this.park.bookings.get(t.booking_id) : undefined;
        if (b && t.kind === 'checkin' && b.status === 'queued_in') { b.status = 'checked_in'; b.history.push({ t: this.park.t, status: 'checked_in' }); }
      }
      this.event('leaderboard.updated', { leaderboard: this.leaderboard() });
      this.broadcastState();
    }
    return res;
  }

  release(taskId: string, player: PlayerRow) {
    const ok = tx(this.db, () => {
      const t = this.getTask(taskId);
      if (!t) throw new ApiError(404, 'not_found', 'Opdracht bestaat niet');
      if (t.state !== 'claimed' || t.assigned_player_id !== player.id) throw new ApiError(409, 'not_claimed_by_you', 'Je kunt alleen je eigen geclaimde opdracht vrijgeven');
      this.db.prepare("UPDATE tasks SET state = 'offered', assigned_player_id = NULL, claimed_at = NULL, deadline_at = NULL, attempt = attempt + 1, version = version + 1 WHERE id = ?").run(taskId);
      return true;
    });
    if (ok) { this.event('task.reoffered', { taskId, reason: 'released' }); this.techStop(taskId); this.broadcastState(); }
    return { task: this.taskDto(this.getTask(taskId)!) };
  }

  private expireDue() {
    const now = this.nowMs();
    const due = this.db.prepare("SELECT * FROM tasks WHERE state = 'claimed' AND deadline_at < ?").all(now) as unknown as TaskRow[];
    for (const t of due) {
      const r = this.db.prepare("UPDATE tasks SET state = 'offered', assigned_player_id = NULL, claimed_at = NULL, deadline_at = NULL, attempt = attempt + 1, version = version + 1 WHERE id = ? AND state = 'claimed' AND version = ?").run(t.id, t.version);
      if (r.changes) {
        this.event('task.expired', { taskId: t.id, playerId: t.assigned_player_id });
        this.techStop(t.id);
        this.event('task.reoffered', { taskId: t.id, attempt: t.attempt + 1 });
        if (t.booking_id) { const b = this.park.bookings.get(t.booking_id); if (b) b.satisfaction = Math.max(0.2, b.satisfaction - 0.05); }
        // library incident: timeout effects; escalation after the second missed deadline
        const tpl = t.kind === 'incident' ? templateByCode.get(t.template) : undefined;
        if (tpl) { this.applyEffect(t.location_id, tpl.onTimeout); if (t.attempt + 1 >= 3) this.escalate({ ...t, attempt: t.attempt + 1 }, 'claim_timeout'); }
      }
    }
    // offered incident tasks nobody claims (crisis subtasks excepted) expire: timeout effects and escalation
    const stale = this.db.prepare("SELECT * FROM tasks WHERE state = 'offered' AND kind = 'incident' AND (parent_id IS NULL OR parent_id LIKE 'S-%')").all() as unknown as TaskRow[];
    let expired = 0;
    for (const t of stale) {
      const tpl = templateByCode.get(t.template);
      if (!tpl || now - t.offered_at < tpl.offeredMaxMin * 60000) continue;
      const r = this.db.prepare("UPDATE tasks SET state = 'expired', version = version + 1 WHERE id = ? AND state = 'offered' AND version = ?").run(t.id, t.version);
      if (!r.changes) continue;
      expired++;
      this.event('task.expired', { taskId: t.id, reason: 'not_claimed' });
      this.applyEffect(t.location_id, tpl.onTimeout);
      this.escalate(t, 'not_claimed');
      if (t.parent_id?.startsWith('S-')) this.stories.onTaskOutcome(t.id, t.parent_id, 'expired');
    }
    if (due.length || expired) this.broadcastState();
  }

  cancelTask(taskId: string, reason: string) {
    const t = this.getTask(taskId);
    if (!t) throw new ApiError(404, 'not_found', 'Opdracht bestaat niet');
    if (t.kind !== 'incident') throw new ApiError(422, 'not_cancellable', 'Check-in/check-out opdrachten horen bij een voertuig en kunnen niet geannuleerd worden; gebruik de noodbediening');
    this.db.prepare("UPDATE tasks SET state = 'cancelled', version = version + 1 WHERE id = ? AND state IN ('offered','claimed')").run(taskId);
    this.audit('admin', 'cancel_task', { taskId, reason });
    this.event('task.cancelled', { taskId, reason });
    this.techStop(taskId);
    if (t.parent_id?.startsWith('S-')) this.stories.onTaskOutcome(taskId, t.parent_id, 'cancelled');
    this.broadcastState();
  }
  /** a storyline ended while its chapter task was still open (no audit entry: the story event explains it) */
  private cancelChapterTask(taskId: string, reason: string) {
    const r = this.db.prepare("UPDATE tasks SET state = 'cancelled', version = version + 1 WHERE id = ? AND state IN ('offered','claimed')").run(taskId);
    if (!r.changes) return;
    this.event('task.cancelled', { taskId, reason });
    this.techStop(taskId);
  }

  // ------------------------------------------------------------------ guest storylines (guestlib + stories.ts)
  private makeStories() {
    return new StoryDirector({
      db: this.db, nowMs: () => this.nowMs(), isDay: () => this.scheduler.isDay(this.localClock().hour),
      bookings: () => this.park.bookings.values(), rand: () => this.botRand.next(),
      createChapterTask: (code, houseNumber, storyId, vars) => {
        const tpl = templateByCode.get(code);
        if (!tpl) return null;
        try {
          const t = this.createIncident({ template: code, locationId: tpl.location.kind === 'facility' ? undefined : `H${houseNumber}`, parentId: storyId, vars });
          return { id: t.id, locationId: t.locationId, title: t.title.replace(/\s*\([^)]*\)$/, ''), points: t.points };
        } catch { return null; }
      },
      cancelChapterTask: (id, reason) => this.cancelChapterTask(id, reason),
      applyEffect: (loc, e) => {
        this.applyEffect(loc, e);
        const b = this.park.bookings.get(this.park.houses.get(Number(loc.slice(1)))?.bookingId ?? '');
        if (b && e.mood) b.satisfaction = Math.max(0.2, Math.min(1, b.satisfaction + e.mood * 0.5));
      },
      event: (type, payload) => { this.event(type, payload); this.broadcastState(); },
    });
  }
  // ------------------------------------------------------------------ weather
  private weatherTick() {
    if (!this.weather) this.weather = newWeather(this.nowMs(), this.localClock().hour);
    const before = this.weather.kind;
    const changed = stepWeather(this.weather, this.nowMs(), this.localClock().hour);
    if (changed) {
      this.event('weather.changed', { from: before, kind: this.weather.kind, name: WEATHER_NAMES[this.weather.kind] });
      // a real thunderstorm in the daytime can become the storm crisis
      if (this.weather.kind === 'onweer' && this.scheduler.isDay(this.localClock().hour) && this.botRand.next() < 0.5) {
        try { this.createCrisis({ code: 'CRISIS_STORM' }); } catch { /* already running */ }
      }
      this.broadcastState();
    }
    setMeta(this.db, 'weather', JSON.stringify(this.weather));
  }
  /** game master: set the weather for a number of game minutes ('auto' = let it change by itself again) */
  setWeather(kind: string, minutes = 60) {
    if (!this.weather) this.weather = newWeather(this.nowMs(), this.localClock().hour);
    if (kind === 'auto') { this.weather.locked = false; this.weather.until = this.nowMs(); this.weatherTick(); }
    else {
      if (!WEATHER_KINDS.includes(kind as WeatherKind)) throw new ApiError(422, 'invalid_weather', `Weer moet een van ${WEATHER_KINDS.join(', ')} of auto zijn`);
      const m = Number(minutes);
      if (!(m >= 5 && m <= 600)) throw new ApiError(422, 'invalid_weather', 'Duur 5-600 speelminuten');
      const before = this.weather.kind;
      forceWeather(this.weather, kind as WeatherKind, this.nowMs(), this.localClock().hour, m);
      setMeta(this.db, 'weather', JSON.stringify(this.weather));
      this.event('weather.changed', { from: before, kind, name: WEATHER_NAMES[kind as WeatherKind], forced: true });
    }
    this.audit('admin', 'weather', { kind, minutes });
    this.broadcastState();
    return this.weather;
  }

  setDisplay(d: { popupSeconds?: number; dayNight?: boolean; ambientSound?: boolean; autoZoom?: string }) {
    const next = { ...this.display };
    if (d.popupSeconds !== undefined) {
      const v = Number(d.popupSeconds);
      if (!(Number.isFinite(v) && v >= 5 && v <= 120)) throw new ApiError(422, 'invalid_config', 'Pop-upduur moet tussen 5 en 120 seconden liggen');
      next.popupSeconds = Math.round(v);
    }
    for (const k of ['dayNight', 'ambientSound'] as const) if (d[k] !== undefined) { if (typeof d[k] !== 'boolean') throw new ApiError(422, 'invalid_config', `${k} moet true of false zijn`); next[k] = d[k]!; }
    if (d.autoZoom !== undefined) {
      if (!['uit', 'crises', 'alles'].includes(d.autoZoom)) throw new ApiError(422, 'invalid_config', 'autoZoom moet uit, crises of alles zijn');
      next.autoZoom = d.autoZoom as 'uit' | 'crises' | 'alles';
    }
    this.display = next;
    setMeta(this.db, 'display', JSON.stringify(this.display));
    this.audit('admin', 'display', { ...this.display });
    this.broadcastState();
    return this.display;
  }
  storiesInfo() { return { config: this.stories.cfg, active: this.stories.list(), recent: this.stories.list(true) }; }
  startStory(opts: { code?: string; bookingId?: string }) {
    try { return this.stories.start(opts); } catch (e) {
      const m = (e as Error).message;
      if (m === 'unknown_story') throw new ApiError(422, 'unknown_story', 'Onbekende verhaallijn');
      if (m === 'no_household') throw new ApiError(409, 'no_household', 'Geen huishouden in een bungalow past bij deze verhaallijn (of het heeft al een verhaal)');
      throw e;
    }
  }
  setStoryConfig(c: Partial<StoryConfig>) {
    const err = validateStoryConfig(c);
    if (err.length) throw new ApiError(422, 'invalid_config', err.join('; '));
    this.stories.setConfig({ ...(c.enabled !== undefined ? { enabled: c.enabled } : {}), ...(c.perHourDay !== undefined ? { perHourDay: c.perHourDay } : {}), ...(c.maxActive !== undefined ? { maxActive: c.maxActive } : {}) });
    this.audit('admin', 'stories_config', { ...c });
    return this.storiesInfo();
  }

  /** Incidents handled by the technical service get a golf cart (claim -> drive to location; done -> back to the TD post). */
  private techStart(t: TaskRow) {
    if (t.kind !== 'incident' || !templateByCode.get(t.template)?.td || !t.location_id?.startsWith('H')) return;
    this.park.dispatchTechnician(t.id, Number(t.location_id.slice(1)));
  }
  private techStop(taskId: string) { this.park.releaseTechnician(taskId); }
  /** A dispatched mechanic must have reached the bungalow before the task may be completed. */
  techBlocksCompletion(t: TaskRow) {
    const st = this.park.techStatus(t.id);
    return !!st && !st.onSite;
  }
  private assertTechOnSite(t: TaskRow) {
    const st = this.park.techStatus(t.id);
    if (!st || st.onSite) return;
    const where = st.phase === 'pending' ? 'wacht nog op een vrije golfkar' : st.phase === 'driving' ? `rijdt met ${st.vehicleId} naar bungalow ${st.houseNumber}` : `loopt naar bungalow ${st.houseNumber}`;
    throw new ApiError(409, 'technician_not_on_site', `De monteur is nog niet ter plaatse (${where}). Afronden kan zodra hij in de bungalow is.`, { technician: st });
  }

  // ------------------------------------------------------------------ gate passage tokens
  private consumeToken(vehicleId: string, gateId: string): string | null {
    const row = this.db.prepare("UPDATE gate_passages SET status = 'consumed', consumed_at = ? WHERE id = (SELECT id FROM gate_passages WHERE vehicle_id = ? AND gate_id = ? AND status = 'authorized' ORDER BY created_at LIMIT 1) RETURNING id").get(this.nowMs(), vehicleId, gateId) as { id: string } | undefined;
    return row?.id ?? null;
  }
  /** Staff pass for a service vehicle (maintenance van, cleaning cart, TD golf cart): logged as its own passage source.
   *  At a staff barrier (personeelsweg) it is the personeelspas ('staff_pass'); at a visitor barrier it is the
   *  fallback 'service' pass (only when no route without a visitor barrier exists). */
  private servicePass(vehicleId: string, gateId: string): string {
    const g = this.net.gates.get(gateId)!;
    const pid = `${g.staff ? 'PP' : 'GS'}-${randomUUID().slice(0, 12)}`;
    const source = g.staff ? 'staff_pass' : 'service';
    this.db.prepare("INSERT INTO gate_passages (id, session_id, vehicle_id, gate_id, direction, task_id, source, status, created_at, consumed_at) VALUES (?, ?, ?, ?, ?, NULL, ?, 'consumed', ?, ?)")
      .run(pid, this.gameId, vehicleId, gateId, g.direction, source, this.nowMs(), this.nowMs());
    this.event(g.staff ? 'gate.staff_pass' : 'gate.service_pass', { gateId, vehicleId, passageId: pid });
    return pid;
  }
  private finishPassage(id: string, status: 'completed' | 'aborted') {
    this.db.prepare("UPDATE gate_passages SET status = ?, finished_at = ? WHERE id = ? AND status = 'consumed'").run(status, this.nowMs(), id);
  }
  /** After a restart: a token consumed for a gate that is not (any longer) open for that vehicle is re-armed - never duplicated. */
  private reconcilePassages() {
    const consumed = this.db.prepare("SELECT * FROM gate_passages WHERE status = 'consumed'").all() as { id: string; vehicle_id: string; gate_id: string }[];
    for (const p of consumed) {
      const gs = this.park.traffic.gates.get(p.gate_id);
      const veh = this.park.traffic.vehicles.find((v) => v.spec.id === p.vehicle_id);
      const live = gs && gs.passageId === p.id;
      if (live) continue;
      if (veh && !veh.passedGates.includes(p.gate_id)) {
        this.db.prepare("UPDATE gate_passages SET status = 'authorized', consumed_at = NULL WHERE id = ?").run(p.id);
        this.audit('system', 'rearm_passage_after_restart', { passageId: p.id });
      } else {
        this.db.prepare("UPDATE gate_passages SET status = 'completed', finished_at = ? WHERE id = ?").run(this.nowMs(), p.id);
      }
    }
  }
  /** Operator emergency override (admin only, audited). Authorises the vehicle at the head of the gate's queue. */
  overrideGate(gateId: string, reason: string) {
    const gs = this.park.traffic.gates.get(gateId);
    if (!gs) throw new ApiError(404, 'not_found', 'Slagboom bestaat niet');
    if (!reason || reason.trim().length < 5) throw new ApiError(422, 'reason_required', 'Geef een reden (min. 5 tekens) voor de noodbediening');
    const head = gs.queue[0];
    if (!head) throw new ApiError(409, 'queue_empty', 'Er staat geen voertuig voor deze slagboom');
    const exists = this.db.prepare("SELECT id FROM gate_passages WHERE vehicle_id = ? AND gate_id = ? AND status IN ('authorized','consumed')").get(head, gateId);
    if (exists) throw new ApiError(409, 'already_authorized', 'Dit voertuig heeft al een geldige passage');
    const pid = `GP-OVR-${randomUUID().slice(0, 8)}`;
    this.db.prepare("INSERT INTO gate_passages (id, session_id, vehicle_id, gate_id, direction, task_id, source, status, created_at) VALUES (?, ?, ?, ?, ?, NULL, 'admin_override', 'authorized', ?)")
      .run(pid, this.gameId, head, gateId, this.net.gates.get(gateId)!.direction, this.nowMs());
    this.audit('admin', 'gate_override', { gateId, vehicleId: head, reason, passageId: pid });
    this.event('gate.override', { gateId, vehicleId: head, reason });
    return { passageId: pid, vehicleId: head };
  }

  audit(actor: string, action: string, detail: Record<string, unknown>) {
    this.db.prepare('INSERT INTO audit_log (actor, action, detail, created_at) VALUES (?, ?, ?, ?)').run(actor, action, JSON.stringify(detail), Date.now());
  }
  auditLog(limit = 100) {
    return (this.db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(Math.max(1, Math.min(5000, limit))) as { id: number; actor: string; action: string; detail: string; created_at: number }[])
      .map((r) => ({ ...r, detail: (() => { try { return JSON.parse(r.detail); } catch { return r.detail; } })() }));
  }
  /** score ledger with player names (newest first) */
  ledger(limit = 200) {
    return this.db.prepare('SELECT l.id, l.player_id AS playerId, p.display_name AS displayName, l.task_id AS taskId, l.points, l.reason, l.actor, l.created_at AS createdAt FROM score_ledger l LEFT JOIN players p ON p.id = l.player_id ORDER BY l.id DESC LIMIT ?').all(Math.max(1, Math.min(5000, limit)));
  }

  // ------------------------------------------------------------------ game master: scores, content, export
  /** Manual score correction: always a ledger row + audit entry with a reason (score = sum of the ledger). */
  adjustScore(playerId: string, delta: number, reason: string) {
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 10000) throw new ApiError(422, 'invalid_delta', 'Aanpassing moet een geheel getal zijn tussen -10000 en 10000 (niet 0)');
    const why = String(reason ?? '').trim();
    if (why.length < 3 || why.length > 200) throw new ApiError(422, 'reason_required', 'Geef een reden (3-200 tekens); die komt in het logboek');
    const res = tx(this.db, () => {
      const p = this.db.prepare('SELECT * FROM players WHERE id = ?').get(playerId) as PlayerRow | undefined;
      if (!p) throw new ApiError(404, 'not_found', 'Speler bestaat niet');
      this.db.prepare('INSERT INTO score_ledger (player_id, task_id, points, reason, actor, created_at) VALUES (?, NULL, ?, ?, ?, ?)').run(playerId, delta, `admin:${why}`, 'admin', Date.now());
      this.db.prepare('UPDATE players SET score = score + ? WHERE id = ?').run(delta, playerId);
      return { playerId, displayName: p.display_name, before: p.score, after: p.score + delta };
    });
    this.audit('admin', 'score_adjust', { ...res, delta, reason: why });
    this.event('score.adjusted', { ...res, delta, reason: why });
    this.event('leaderboard.updated', { leaderboard: this.leaderboard() });
    this.broadcastState();
    return res;
  }
  private contentCall<T>(action: string, detail: Record<string, unknown>, fn: () => T): T {
    try { const r = fn(); this.audit('admin', action, detail); return r; } catch (e) {
      if (e instanceof ContentError) throw new ApiError(422, 'invalid_content', e.message, { problems: e.problems });
      throw e;
    }
  }
  setNames(n: Partial<NameLists>) {
    return this.contentCall('names_update', { first: n.first?.length ?? 0, surnames: n.surnames?.length ?? 0, kids: n.kids?.length ?? 0, cameos: n.cameos?.length ?? 0 }, () => this.content.setNames(n));
  }
  saveCustomTask(t: Partial<CustomTask>) { return this.contentCall('custom_task_save', { code: t.code ?? null, title: t.title }, () => this.content.saveTask(t)); }
  deleteCustomTask(code: string) { return this.contentCall('custom_task_delete', { code }, () => { this.content.deleteTask(code); return { ok: true }; }); }
  facilities() { const seen = new Map<string, string>(); for (const f of this.facIndex) if (!seen.has(f.key)) seen.set(f.key, f.name); return [...seen].map(([key, name]) => ({ key, name })).sort((a, b) => a.key.localeCompare(b.key)); }
  /** Everything needed to archive or analyse a game (JSON; the dashboard also makes CSV files from it). */
  exportAll() {
    this.audit('admin', 'export', {});
    const all = (sql: string) => this.db.prepare(sql).all();
    return {
      exportedAt: new Date().toISOString(), gameId: this.gameId, seed: this.cfg.seed, park: this.parkSummary(), leaderboard: this.leaderboard(),
      players: this.players(), ledger: this.ledger(5000), tasks: all('SELECT * FROM tasks ORDER BY offered_at'), incidents: all('SELECT * FROM incidents ORDER BY started_at'),
      stories: this.stories.list(true), bookings: this.bookingsDto(), locationState: all('SELECT * FROM location_state'), audit: this.auditLog(5000),
      config: { timeScale: this.cfg.timeScale, demoBot: this.cfg.demoBot, autoArrivals: this.cfg.autoArrivals, autoGate: !!this.cfg.autoGate, scheduler: this.schedCfg, stories: this.stories.cfg },
      content: { names: this.content.names(), tasks: this.content.tasks },
    };
  }

  // ------------------------------------------------------------------ admin
  resetGame(seed = this.cfg.seed, announce = true, opts: { name?: string; code?: string; demoPlayers?: boolean; initialOccupied?: number } = {}) {
    wipe(this.db);
    if (opts.name !== undefined) this.gameName = opts.name;
    if (opts.code !== undefined) this.cfg.gameCode = opts.code;
    if (opts.initialOccupied !== undefined) this.cfg.initialOccupied = opts.initialOccupied;
    this.botPlan.clear();
    this.session = null;
    this.stories.wipe();
    this.stories.setConfig({}); // meta was wiped: keep the storyline settings
    setMeta(this.db, 'display', JSON.stringify(this.display));
    this.cfg.seed = seed;
    this.clockOriginMs = Date.now();
    this.park = this.makePark(seed);
    this.botRand = rng(seed + 99);
    setMeta(this.db, 'gameId', this.gameId);
    setMeta(this.db, 'seed', String(seed));
    setMeta(this.db, 'gameName', this.gameName);
    setMeta(this.db, 'gameCode', this.cfg.gameCode);
    setMeta(this.db, 'mapChecksum', this.mapChecksum());
    setMeta(this.db, 'clockOriginMs', String(this.clockOriginMs));
    this.weather = newWeather(this.nowMs(), this.localClock().hour);
    setMeta(this.db, 'weather', JSON.stringify(this.weather));
    setMeta(this.db, 'timeScale', String(this.cfg.timeScale));
    setMeta(this.db, 'demoBot', this.cfg.demoBot ? '1' : '0');
    setMeta(this.db, 'autoArrivals', this.cfg.autoArrivals ? '1' : '0');
    setMeta(this.db, 'autoGate', this.cfg.autoGate ? '1' : '0');
    if (opts.demoPlayers !== false) for (const n of ['Sophie', 'Mike', 'Laura', 'Tom', 'Sanne', 'Bram', 'Eva', 'Daan', 'Lotte', 'Ruben']) this.join(this.cfg.gameCode, n, true);
    this.park.seedOccupied(this.cfg.initialOccupied);
    this.park.seedService();
    this.scheduler = new Scheduler(this.schedCfg, seed);
    this.lastSeen.clear(); this.locState.clear(); this.escalationLog = [];
    for (let i = 0; i < 3; i++) try { this.createIncident(); } catch { /* nothing suitable */ }
    this.nextAutoArrival = 4;
    this.save();
    if (announce) this.event('game.reset', { seed });
    this.audit('admin', 'reset', { seed });
    this.broadcastState();
  }
  // ------------------------------------------------------------------ games: new, save, load (game master)
  /** game tables in a saved game (events, idempotency keys, map versions, own content and other saves are not part of it) */
  static SAVE_TABLES = ['meta', 'players', 'tasks', 'score_ledger', 'gate_passages', 'audit_log', 'sim_state', 'incidents', 'location_state', 'stories'];
  private snapshotData() {
    this.save();
    const tables: Record<string, unknown[]> = {};
    for (const t of Game.SAVE_TABLES) tables[t] = this.db.prepare(`SELECT * FROM ${t}`).all();
    return { format: 'harderwold-save', version: 1, mapChecksum: this.mapChecksum(), gameName: this.gameName, gameMs: this.nowMs(), tables };
  }
  /** Store the running game under a name. Automatic saves (before load/new game) are pruned to the last 10. */
  saveGame(name: string, auto = false) {
    const nm = String(name ?? '').trim();
    if (nm.length < 2 || nm.length > 80) throw new ApiError(422, 'invalid_name', 'Geef de opslag een naam (2-80 tekens)');
    const data = JSON.stringify(this.snapshotData());
    const top = this.leaderboard()[0];
    const id = `G-${randomUUID().slice(0, 8)}`;
    this.db.prepare('INSERT INTO saves (id, name, game_name, created_at, auto, game_ms, players, top, map_checksum, size, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, nm, this.gameName, Date.now(), auto ? 1 : 0, this.nowMs(), this.leaderboard().length, top && top.score > 0 ? `${top.displayName} (${top.score})` : null, this.mapChecksum(), data.length, data);
    if (auto) this.db.prepare('DELETE FROM saves WHERE auto = 1 AND id NOT IN (SELECT id FROM saves WHERE auto = 1 ORDER BY created_at DESC LIMIT 10)').run();
    this.audit('admin', auto ? 'autosave' : 'save_game', { saveId: id, name: nm });
    return this.saveDto(id);
  }
  private saveDto(id: string) {
    const r = this.db.prepare('SELECT id, name, game_name, created_at, auto, game_ms, players, top, map_checksum, size FROM saves WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!r) throw new ApiError(404, 'not_found', 'Opgeslagen spel niet gevonden');
    return { id: String(r.id), name: String(r.name), gameName: String(r.game_name), createdAt: Number(r.created_at), auto: !!r.auto, gameMs: Number(r.game_ms), players: Number(r.players), top: (r.top as string | null) ?? null, sameMap: r.map_checksum === this.mapChecksum(), size: Number(r.size) };
  }
  listSaves() { return (this.db.prepare('SELECT id FROM saves ORDER BY created_at DESC').all() as { id: string }[]).map((r) => this.saveDto(r.id)); }
  deleteSave(id: string) { this.saveDto(id); this.db.prepare('DELETE FROM saves WHERE id = ?').run(id); this.audit('admin', 'delete_save', { saveId: id }); return { ok: true }; }
  /** the saved game as a file (download / move to another computer) */
  saveFile(id: string) {
    const r = this.db.prepare('SELECT name, data FROM saves WHERE id = ?').get(id) as { name: string; data: string } | undefined;
    if (!r) throw new ApiError(404, 'not_found', 'Opgeslagen spel niet gevonden');
    return { name: r.name, ...JSON.parse(r.data) };
  }
  /** add a saved game from a file (as made by saveFile) */
  importSave(file: Record<string, unknown>, name?: string) {
    if (file?.format !== 'harderwold-save' || file.version !== 1 || typeof file.tables !== 'object' || !file.tables) throw new ApiError(422, 'invalid_save', 'Dit is geen opgeslagen Harderwold-spel');
    const tables = file.tables as Record<string, unknown>;
    for (const t of Game.SAVE_TABLES) if (!Array.isArray(tables[t])) throw new ApiError(422, 'invalid_save', `Opgeslagen spel mist de tabel ${t}`);
    const nm = String(name ?? file.name ?? 'Geïmporteerd spel').trim().slice(0, 80) || 'Geïmporteerd spel';
    const players = (tables.players as unknown[]).length;
    const data = JSON.stringify({ format: file.format, version: file.version, mapChecksum: file.mapChecksum, gameName: file.gameName, gameMs: file.gameMs, tables });
    const id = `G-${randomUUID().slice(0, 8)}`;
    this.db.prepare('INSERT INTO saves (id, name, game_name, created_at, auto, game_ms, players, top, map_checksum, size, data) VALUES (?, ?, ?, ?, 0, ?, ?, NULL, ?, ?, ?)')
      .run(id, nm, String(file.gameName ?? 'Onbekend'), Date.now(), Number(file.gameMs ?? 0), players, String(file.mapChecksum ?? ''), data.length, data);
    this.audit('admin', 'import_save', { saveId: id, name: nm });
    return this.saveDto(id);
  }
  /** Replace the running game by a saved one (the running game is saved automatically first). */
  loadGame(id: string) {
    const r = this.db.prepare('SELECT name, data, map_checksum FROM saves WHERE id = ?').get(id) as { name: string; data: string; map_checksum: string } | undefined;
    if (!r) throw new ApiError(404, 'not_found', 'Opgeslagen spel niet gevonden');
    if (r.map_checksum !== this.mapChecksum()) throw new ApiError(409, 'other_map', 'Dit spel is op een andere kaartversie gespeeld en past niet bij de huidige wegen');
    const snap = JSON.parse(r.data) as { tables: Record<string, Record<string, unknown>[]> };
    this.saveGame(`Automatisch bewaard vóór laden van "${r.name}"`, true);
    tx(this.db, () => {
      for (const t of Game.SAVE_TABLES) this.db.exec(`DELETE FROM ${t}`);
      this.db.exec("DELETE FROM events; DELETE FROM idempotency; DELETE FROM sqlite_sequence WHERE name IN ('events','score_ledger','audit_log')");
      for (const t of Game.SAVE_TABLES) {
        const cols = new Set((this.db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name));
        for (const row of snap.tables[t] ?? []) {
          const keys = Object.keys(row).filter((k) => cols.has(k));
          if (!keys.length) continue;
          this.db.prepare(`INSERT INTO ${t} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => row[k] as never));
        }
      }
    });
    this.resumeAfterLoad();
    this.audit('admin', 'load_game', { saveId: id, name: r.name });
    return this.parkSummary();
  }
  /** Start a new game (the running one is saved automatically first). */
  newGame(o: { name?: string; code?: string; demoPlayers?: boolean; initialOccupied?: number; seed?: number; endsAt?: string | number; arrivals?: number; departures?: number }) {
    const name = String(o.name ?? '').trim();
    if (name.length < 2 || name.length > 60) throw new ApiError(422, 'invalid_name', 'Geef het spel een naam (2-60 tekens)');
    const code = String(o.code ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(code)) throw new ApiError(422, 'invalid_code', 'Spelcode: 4-12 letters of cijfers');
    const occ = Number(o.initialOccupied ?? this.cfg.initialOccupied);
    if (!(Number.isInteger(occ) && occ >= 0 && occ <= 300)) throw new ApiError(422, 'invalid_occupancy', 'Beginbezetting: 0-300 bewoonde bungalows');
    // session plan (optional): end date/time and how many check-ins / check-outs spread over the session
    let plan: { endMs: number; arrivals: number; departures: number } | null = null;
    if (o.endsAt !== undefined && o.endsAt !== null && o.endsAt !== '') {
      const endMs = typeof o.endsAt === 'number' ? o.endsAt : Date.parse(String(o.endsAt));
      const now = Date.now();
      if (!Number.isFinite(endMs) || endMs < now + 10 * 60000) throw new ApiError(422, 'invalid_end', 'Einde van de sessie moet minstens 10 minuten in de toekomst liggen');
      if (endMs > now + 14 * 86400000) throw new ApiError(422, 'invalid_end', 'Een sessie duurt maximaal 14 dagen');
      const a = Number(o.arrivals ?? 0), d = Number(o.departures ?? 0);
      if (!(Number.isInteger(a) && a >= 0 && a <= 2000)) throw new ApiError(422, 'invalid_arrivals', 'Aantal inchecks: 0-2000');
      if (!(Number.isInteger(d) && d >= 0 && d <= occ + a)) throw new ApiError(422, 'invalid_departures', `Aantal uitchecks: 0 tot ${occ + a} (er kunnen niet meer gasten vertrekken dan er zijn)`);
      if (occ + a - d > 330) throw new ApiError(422, 'too_many_guests', 'Zoveel gasten tegelijk passen niet in het park (341 bungalows)');
      plan = { endMs, arrivals: a, departures: d };
    }
    if (this.leaderboard().length) this.saveGame(`Automatisch bewaard vóór nieuw spel "${name}"`, true);
    this.resetGame(Number.isFinite(Number(o.seed)) && o.seed !== undefined ? Number(o.seed) : Math.floor(Math.random() * 1e6), true, { name, code, demoPlayers: o.demoPlayers !== false, initialOccupied: occ });
    if (plan) {
      const start = this.nowMs(), span = plan.endMs - start;
      // random moments spread over the session (not in the first minute, not in the last 5 % so they can finish)
      const times = (n: number) => Array.from({ length: n }, () => start + 60000 + Math.random() * Math.max(0, span * 0.95 - 60000)).sort((x, y) => x - y);
      this.session = { startMs: start, endMs: plan.endMs, arrivals: times(plan.arrivals), departures: times(plan.departures), arrivalsTotal: plan.arrivals, departuresTotal: plan.departures, ended: false };
      setMeta(this.db, 'session', JSON.stringify(this.session));
    }
    this.audit('admin', 'new_game', { name, code, demoPlayers: o.demoPlayers !== false, initialOccupied: occ, endsAt: plan ? new Date(plan.endMs).toISOString() : null, arrivals: plan?.arrivals ?? null, departures: plan?.departures ?? null });
    return this.parkSummary();
  }
  private resumeAfterLoad() {
    this.botPlan.clear(); this.escalationLog = []; this.lastSeen.clear(); this.locState.clear();
    this.park = this.makePark(this.cfg.seed);
    if (!this.restoreFromDb()) throw new ApiError(500, 'load_failed', 'Het opgeslagen spel kon niet worden hersteld');
    this.botRand = rng(this.cfg.seed + 99 + Math.floor(this.park.t));
    this.nextAutoArrival = this.park.t + 4;
    this.event('game.reset', { loaded: true, gameName: this.gameName });
    this.broadcastState();
  }
  gameInfo() { return { name: this.gameName, code: this.cfg.gameCode, seed: this.cfg.seed, initialOccupied: this.cfg.initialOccupied }; }

  /** fingerprint of the map the game runs on (stored with the saved game) */
  mapChecksum() { return checksum(JSON.stringify({ n: this.netJson, s: this.sectorJson })); }
  /** Map editor: make a saved version the active map (validated in full first), then restart the game on it. */
  async activateMap(id: number) {
    if (process.env.MAP_SET === 'sector') throw new ApiError(409, 'sector_map', 'De proefsector (MAP_SET=sector) is niet met de editor te bewerken');
    const { diag } = await this.maps.activate(id);
    clearNetworkCache();
    const { net, sector } = loadMapJson();
    this.netJson = net; this.sectorJson = sector;
    this.net = loadNetwork();
    this.indexFacilities();
    this.audit('admin', 'map_activate', { version: id, warnings: diag.problems.filter((p) => p.level === 'warn').length });
    this.resetGame(this.cfg.seed);
    this.event('map.updated', { version: id });
    return { version: id, summary: diag.summary };
  }
  schedulerInfo() {
    const env = this.schedEnv();
    return { config: this.schedCfg, state: this.scheduler.snapshot(), now: { hour: +env.hour.toFixed(2), day: this.scheduler.isDay(env.hour), ratePerHour: +(this.scheduler.normalRate(env) * 60).toFixed(2), openNormal: env.openNormal, occupancy: +env.occupancy.toFixed(3) } };
  }
  setSchedulerConfig(c: Partial<SchedulerConfig>) {
    const errs = validateSchedulerConfig(c);
    if (errs.length) throw new ApiError(422, 'invalid_config', errs.join('; '));
    const keys = Object.keys(DEFAULT_SCHEDULER) as (keyof SchedulerConfig)[];
    const pick = Object.fromEntries(keys.filter((k) => c[k] !== undefined).map((k) => [k, c[k]])) as Partial<SchedulerConfig>;
    this.schedCfg = { ...this.schedCfg, ...pick };
    this.scheduler.cfg = { ...this.schedCfg };
    this.audit('admin', 'scheduler_config', pick);
    this.save();
    return this.schedulerInfo();
  }
  setTimeScale(s: number) {
    if (!(s > 0 && s <= 16)) throw new ApiError(422, 'invalid_scale', 'Tijdschaal moet tussen 0 en 16 liggen');
    this.cfg.timeScale = s; setMeta(this.db, 'timeScale', String(s)); this.audit('admin', 'time_scale', { s });
  }
  setFlag(name: 'demoBot' | 'autoArrivals' | 'autoGate', on: boolean) { this.cfg[name] = on; setMeta(this.db, name, on ? '1' : '0'); this.audit('admin', name, { on }); }

  // ------------------------------------------------------------------ loop
  start() {
    this.lastReal = performance.now();
    this.loop = setInterval(() => this.tick(), 25);
  }
  stop() { if (this.loop) clearInterval(this.loop); this.save(); this.maps.close(); }

  private tick() {
    const now = performance.now();
    let real = (now - this.lastReal) / 1000;
    this.lastReal = now;
    if (real > 0.5) real = 0.5; // bounded catch-up after stalls
    if (!this.paused) {
      this.acc += real * this.cfg.timeScale;
      let n = 0;
      while (this.acc >= 0.05 && n < 120) { this.simStep(0.05); this.acc -= 0.05; n++; }
      if (n >= 120) this.acc = 0;
    }
    if (now - this.lastFrame >= 50) { this.lastFrame = now; this.broadcastFrame(); } // 20 traffic frames per second
    if (now - this.lastState >= 1000) { this.lastState = now; this.broadcastState(); }
    if (now - this.lastSave >= 2000) { this.lastSave = now; this.save(); }
  }

  simStep(dt: number) {
    this.park.step(dt);
    const t = this.park.t;
    if (Math.floor(t) !== Math.floor(t - dt)) {
      this.expireDue();
      if (this.cfg.demoBot) this.demoBotTick();
      if (this.session) this.sessionTick(); else if (this.cfg.autoArrivals) this.autoTraffic();
      if (this.cfg.autoGate) this.autoGateTick();
      // task scheduler + crisis stages every 10 game seconds
      if (Math.floor(t / 10) !== Math.floor((t - dt) / 10)) {
        const out = this.scheduler.tick(this.schedEnv(), 10 / 60);
        for (const n of out.normal) try { this.createIncident({ template: n.code, locationId: n.location }); } catch { /* location gone */ }
        if (out.major) try { this.createCrisis({ code: out.major.code, locationId: out.major.location }); } catch { /* already active */ }
        this.crisisTick();
        this.stories.tick(10 / 60);
        this.weatherTick();
      }
    }
  }

  /** Setting 'automatic check-in/out': an OFFERED check-in/check-out task is completed by the system after
   *  AUTO_GATE_SEC game seconds - through the same transaction as a player completion (the gate still opens only with
   *  the passage token of that completed task, for that vehicle and that gate). No points; claimed tasks stay with
   *  their player. */
  static AUTO_GATE_SEC = 8;
  private autoGateTick() {
    const due = this.db.prepare("SELECT * FROM tasks WHERE kind IN ('checkin','checkout') AND state = 'offered' AND offered_at <= ?").all(this.nowMs() - Game.AUTO_GATE_SEC * 1000) as unknown as TaskRow[];
    for (const t of due) {
      if (!t.vehicle_id || !t.gate_id) continue;
      const issued = tx(this.db, () => {
        const r = this.db.prepare("UPDATE tasks SET state = 'completed', completed_at = ?, points_awarded = 0, version = version + 1 WHERE id = ? AND state = 'offered' AND version = ?").run(this.nowMs(), t.id, t.version);
        if (r.changes !== 1) return null;
        const pid = `GP-${randomUUID().slice(0, 12)}`;
        this.db.prepare("INSERT INTO gate_passages (id, session_id, vehicle_id, gate_id, direction, task_id, source, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'auto', 'authorized', ?)")
          .run(pid, this.gameId, t.vehicle_id, t.gate_id, t.kind === 'checkin' ? 'inbound' : 'outbound', t.id, this.nowMs());
        return { passageId: pid, gateId: t.gate_id!, vehicleId: t.vehicle_id! };
      });
      if (!issued) continue;
      this.event('task.completed', { taskId: t.id, playerId: null, displayName: 'automatisch', points: 0, kind: t.kind, locationId: t.location_id, gateId: t.gate_id, auto: true });
      this.event('gate.token_issued', issued);
      if (t.kind === 'checkin') {
        const b = t.booking_id ? this.park.bookings.get(t.booking_id) : undefined;
        if (b && b.status === 'queued_in') { b.status = 'checked_in'; b.history.push({ t: this.park.t, status: 'checked_in' }); }
      }
      this.broadcastState();
    }
  }

  /** Session plan: planned check-ins / check-outs become arrivals and departures; at the end the game pauses. */
  private sessionTick() {
    const s = this.session!; const now = this.nowMs();
    let changed = false;
    while (s.arrivals.length && s.arrivals[0] <= now) {
      if (!this.park.vacantHouses().length || this.park.traffic.buffer.length >= 6) break; // waits outside the park
      this.park.scheduleArrival(); s.arrivals.shift(); changed = true;
    }
    while (s.departures.length && s.departures[0] <= now) {
      if (!this.park.depart()) break; // nobody to leave yet: try again in a moment
      s.departures.shift(); changed = true;
    }
    if (!s.ended && now >= s.endMs) {
      s.ended = true; changed = true;
      this.paused = true;
      this.event('game.ended', { gameName: this.gameName, leaderboard: this.leaderboard() });
      this.audit('system', 'session_ended', { gameName: this.gameName });
    }
    if (changed) setMeta(this.db, 'session', JSON.stringify(s));
  }
  sessionDto() {
    const s = this.session; if (!s) return null;
    return { startMs: s.startMs, endMs: s.endMs, ended: s.ended, arrivalsTotal: s.arrivalsTotal, departuresTotal: s.departuresTotal, arrivalsLeft: s.arrivals.length, departuresLeft: s.departures.length };
  }
  /** Optional background flow for the demo: arrivals and departures at a modest pace. */
  private autoTraffic() {
    const t = this.park.t;
    if (t >= this.nextAutoArrival) {
      if (this.park.vacantHouses().length > 1 && this.park.traffic.buffer.length < 3) this.park.scheduleArrival();
      this.nextAutoArrival = t + this.botRand.range(75, 160);
      if (this.botRand.next() < 0.45) this.park.depart();
    }
  }

  /** Demo bot (off by default): seeded test players claim and complete offered tasks through the regular task API. */
  private botPlan = new Map<string, number>();
  private demoBotTick() {
    const now = this.nowMs();
    const offered = this.db.prepare("SELECT * FROM tasks WHERE state = 'offered' ORDER BY offered_at").all() as unknown as TaskRow[];
    const tests = this.db.prepare('SELECT * FROM players WHERE is_test = 1').all() as unknown as PlayerRow[];
    for (const t of offered) {
      if (!this.botPlan.has(t.id)) this.botPlan.set(t.id, now + this.botRand.range(t.kind === 'incident' ? 40 : 6, t.kind === 'incident' ? 240 : 25) * 1000);
      if (this.botPlan.get(t.id)! > now) continue;
      const free = tests.filter((p) => (this.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE assigned_player_id = ? AND state = 'claimed'").get(p.id) as { n: number }).n < MAX_CLAIMS);
      if (!free.length) break;
      const p = this.botRand.pick(free);
      this.claim(t.id, p, `bot-c-${t.id}-${t.attempt}`);
      this.botPlan.set(t.id, now + this.botRand.range(8, 30) * 1000);
    }
    const claimed = this.db.prepare("SELECT t.*, p.is_test FROM tasks t JOIN players p ON p.id = t.assigned_player_id WHERE t.state = 'claimed' AND p.is_test = 1").all() as unknown as TaskRow[];
    for (const t of claimed) {
      const due = this.botPlan.get(t.id) ?? 0;
      if (due > now) continue;
      if (this.techBlocksCompletion(t)) { this.botPlan.set(t.id, now + this.botRand.range(15, 45) * 1000); continue; } // mechanic still on the way: some work time after arrival
      const p = this.db.prepare('SELECT * FROM players WHERE id = ?').get(t.assigned_player_id) as unknown as PlayerRow;
      this.complete(t.id, p, `bot-d-${t.id}`);
      this.botPlan.delete(t.id);
    }
  }

  save() {
    this.db.prepare('INSERT INTO sim_state (id, park, saved_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET park = excluded.park, saved_at = excluded.saved_at').run(this.park.serialize(), Date.now());
    setMeta(this.db, 'scheduler', JSON.stringify({ cfg: this.schedCfg, state: this.scheduler.snapshot() }));
    if (this.weather) setMeta(this.db, 'weather', JSON.stringify(this.weather));
  }

  // ------------------------------------------------------------------ projections
  private broadcastFrame() {
    if (![...this.clients].some((c) => c.frames)) return;
    const snap = this.park.traffic.snapshot();
    const msg = `event: frame\ndata: ${JSON.stringify(snap)}\n\n`;
    for (const c of this.clients) if (c.frames) c.write(msg);
  }
  broadcastState() {
    if (!this.clients.size) return;
    const msg = `event: state\ndata: ${JSON.stringify(this.projectorState())}\n\n`;
    for (const c of this.clients) c.write(msg);
  }

  houseStates() {
    const stories = this.stories.activeByHouse();
    const tasks = this.db.prepare("SELECT id, location_id, icon, state, kind, title FROM tasks WHERE state IN ('offered','claimed') AND kind = 'incident'").all() as { id: string; location_id: string; icon: string; state: string; title: string }[];
    return this.net.houses.map((h) => {
      const hs = this.park.houses.get(h.number);
      const b = hs?.bookingId ? this.park.bookings.get(hs.bookingId) : undefined;
      return {
        id: h.id, number: h.number, legendType: h.legendType, focus: h.focus, state: hs?.state ?? 'scenery', household: b?.household, story: stories.get(h.number)?.title, cond: this.locState.has(h.id) ? this.condOf(h.id) : undefined,
        incidents: tasks.filter((t) => t.location_id === h.id).map((t) => ({ taskId: t.id, icon: t.icon, state: t.state, title: t.title })),
      };
    });
  }

  /** facilities with open incident tasks (pins on the projector) */
  facilityStates() {
    const tasks = this.db.prepare("SELECT id, location_id, icon, state, title FROM tasks WHERE state IN ('offered','claimed') AND kind = 'incident' AND location_id LIKE 'F-%'").all() as { id: string; location_id: string; icon: string; state: string; title: string }[];
    const by = new Map<string, typeof tasks>();
    for (const t of tasks) (by.get(t.location_id) ?? by.set(t.location_id, []).get(t.location_id)!).push(t);
    return [...by].map(([id, list]) => {
      const f = this.facIndex.find((x) => x.id === id);
      const pos = f ? this.net.toWorld(f.pt) : { x: 0, y: 0 };
      return { id, name: f?.name ?? id, pos: { x: +pos.x.toFixed(2), y: +pos.y.toFixed(2) }, incidents: list.map((t) => ({ taskId: t.id, icon: t.icon, state: t.state, title: t.title })) };
    });
  }

  parkSummary() {
    const open = (this.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE state IN ('offered','claimed')").get() as { n: number }).n;
    const gm = this.nowMs();
    return {
      gameId: this.gameId, gameName: this.gameName, gameMs: gm, gameTimeIso: new Date(gm).toISOString(), timezone: 'Europe/Amsterdam', simTime: +this.park.t.toFixed(2),
      timeScale: this.cfg.timeScale, paused: this.paused, satisfaction: +this.park.averageSatisfaction().toFixed(3), openTasks: open,
      gates: [...this.park.traffic.gates.values()].map((g) => ({ id: g.id, phase: g.phase, queue: g.queue.length, authorizedVehicle: g.authorizedVehicle ?? null })),
      bufferedArrivals: this.park.traffic.buffer.filter((b) => b.spec.kind === 'visitor').length,
      vehicles: this.park.traffic.vehicles.length, demoBot: this.cfg.demoBot, autoArrivals: this.cfg.autoArrivals, autoGate: !!this.cfg.autoGate,
      health: this.parkHealth(), display: this.display, weather: this.weather ? { ...this.weather, name: WEATHER_NAMES[this.weather.kind] } : null, session: this.sessionDto(),
      crises: this.crisisStatus(),
    };
  }

  projectorState() {
    const gateTasks = this.db.prepare("SELECT id, vehicle_id, gate_id, state, kind, assigned_player_id FROM tasks WHERE kind IN ('checkin','checkout') AND state IN ('offered','claimed')").all() as { id: string; vehicle_id: string; gate_id: string; state: string; kind: string }[];
    const tokens = this.db.prepare("SELECT vehicle_id, gate_id, status FROM gate_passages WHERE status IN ('authorized','consumed')").all() as { vehicle_id: string; gate_id: string; status: string }[];
    return {
      park: this.parkSummary(),
      leaderboard: this.leaderboard(),
      houses: this.houseStates(),
      facilities: this.facilityStates(),
      gateTasks: gateTasks.map((t) => ({ taskId: t.id, vehicleId: t.vehicle_id, gateId: t.gate_id, state: t.state, kind: t.kind })),
      tokens: tokens.map((t) => ({ vehicleId: t.vehicle_id, gateId: t.gate_id, status: t.status })),
    };
  }

  bookingsDto() {
    const stories = this.stories.activeByHouse();
    return [...this.park.bookings.values()].map((b) => ({ id: b.id, household: b.household, profile: b.profile ?? null, story: ['parked', 'in_house'].includes(b.status) ? stories.get(b.houseNumber) ?? null : null, guests: b.guests, houseNumber: b.houseNumber, vehicleId: b.vehicleId, status: b.status, satisfaction: +b.satisfaction.toFixed(2) }));
  }

  locations() {
    const facs = this.facIndex.map((f) => ({ id: f.id, kind: 'facility', key: f.key, name: f.name, pos: this.net.toWorld(f.pt), condition: this.stateOf(f.id) }));
    const houses = this.houseStates().map((h) => {
      const hi = this.net.houses.find((x) => x.number === h.number)!;
      return { ...h, kind: 'bungalow', pos: { x: +hi.pos.x.toFixed(2), y: +hi.pos.y.toFixed(2) }, typeConfidence: hi.typeConfidence, petsAllowed: hi.petsAllowed, stallId: hi.stallId ?? null };
    });
    return [...houses, ...facs];
  }
}
