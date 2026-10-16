import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);

// src/server/main.ts
import { join as join6, dirname as dirname3 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { existsSync as existsSync6 } from "node:fs";

// src/shared/house.ts
function houseLabel(n) {
  return n >= 1e3 ? `${n - 1e3}A` : String(n);
}
function villaVariant(num) {
  const r = hrand(num * 97 + 11);
  const W = [10.5, 11.5, 12.5, 13.5][Math.floor(r() * 4)], D = r() < 0.5 ? 9 : 10;
  const floors = r() < 0.72 ? 2 : 1;
  return { W, D, floors, pool: r() < 0.42, solar: r() < 0.65, upperSide: r() < 0.5 ? -1 : 1, terraceD: 5.5, boat: r() < 0.35, hedge: r() < 0.8 };
}
var isVilla = (type) => !!type && /V$/.test(type);
var isTerraced = (type) => !!type && /G$/.test(type);
function houseSize(type, pdfSideM, num = 0) {
  if (isVilla(type)) {
    const v = villaVariant(num);
    return { W: v.W, D: v.D, annex: false, cap: 8, scale: 1, patioFront: 0.6, patioBack: v.terraceD, doorM: v.D / 2 + 0.8 };
  }
  if (isTerraced(type)) {
    const W = Math.max(3.5, Math.min(5.4, (pdfSideM ?? 6) - 1.2));
    return { W, D: 8.5, annex: false, cap: 4, scale: 1, patioFront: 0.4, patioBack: 2.6, doorM: 8.5 / 2 + 0.7 };
  }
  const t2 = type ?? "6C";
  const cap = parseInt(t2, 10) || 6;
  const size = cap <= 4 ? [6.4, 8.6] : cap <= 6 ? [7, 9.8] : cap <= 8 ? [7.6, 11] : cap <= 12 ? [8.4, 12.6] : [9.2, 15];
  const annex = cap >= 6 || /E|K/.test(t2.slice(1));
  let scale = 1;
  if (pdfSideM && pdfSideM > 4) {
    const box = pdfSideM * 1.1;
    scale = Math.max(0.65, Math.min(1, box / (size[0] + 0.8 + (annex ? 3 : 0)), box / (size[1] + 0.8 + 3.6)));
  }
  return { W: size[0], D: size[1], annex, cap, scale, patioFront: PATIO_D, patioBack: 0.4, doorM: size[1] / 2 + 2.4 };
}
var PATIO_D = 3.6;
var ANNEX_W = 3;
function hrand(seed) {
  let s = seed * 2654435761 >>> 0;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return (s >>> 0) / 4294967296;
  };
}
function annexSide(num) {
  return hrand(num * 31 + 3)() < 0.5 ? -1 : 1;
}
function houseFootprint(pos, front, s, num, opts = {}) {
  const m = opts.margin ?? 0, k = s.scale;
  const back = (s.D / 2 + (opts.patio === false ? 0.4 : s.patioBack)) * k, ahead = (s.D / 2 + (opts.patio === false ? 0.4 : s.patioFront)) * k;
  const side = annexSide(num), a = s.annex ? ANNEX_W : 0;
  const left = (s.W / 2 + 0.4 + (side < 0 ? a : 0)) * k, right = (s.W / 2 + 0.4 + (side > 0 ? a : 0)) * k;
  const cl = (ahead - back) / 2, cw = (right - left) / 2;
  const rx = -front.y, ry = front.x;
  return {
    cx: pos.x + front.x * cl + rx * cw,
    cy: pos.y + front.y * cl + ry * cw,
    ux: front.x,
    uy: front.y,
    hl: (ahead + back) / 2 + m,
    hw: (left + right) / 2 + m
  };
}
function footprintSamples(f, nl = 5, nw = 3) {
  const out = [];
  const vx = -f.uy, vy = f.ux;
  for (let i = 0; i < nl; i++) for (let j = 0; j < nw; j++) {
    const a = (i / (nl - 1) * 2 - 1) * f.hl, b = (j / (nw - 1) * 2 - 1) * f.hw;
    out.push({ x: f.cx + f.ux * a + vx * b, y: f.cy + f.uy * a + vy * b });
  }
  return out;
}

// src/server/game.ts
import { createHash, randomBytes, randomUUID } from "node:crypto";

// src/server/db.ts
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
function openDb(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY, game_id TEXT NOT NULL, display_name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
      score INTEGER NOT NULL DEFAULT 0, joined_at INTEGER NOT NULL, is_test INTEGER NOT NULL DEFAULT 0,
      UNIQUE (game_id, display_name COLLATE NOCASE)
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, template TEXT NOT NULL, kind TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
      location_id TEXT, booking_id TEXT, vehicle_id TEXT, gate_id TEXT, icon TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('offered','claimed','completed','expired','cancelled')),
      assigned_player_id TEXT, offered_at INTEGER NOT NULL, claimed_at INTEGER, deadline_at INTEGER, completed_at INTEGER,
      claim_seconds INTEGER NOT NULL, difficulty TEXT NOT NULL, urgency TEXT NOT NULL, points INTEGER NOT NULL,
      points_awarded INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, attempt INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX IF NOT EXISTS tasks_gate_unique ON tasks(kind, vehicle_id, gate_id) WHERE vehicle_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS tasks_state ON tasks(state);
    CREATE TABLE IF NOT EXISTS score_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL, task_id TEXT UNIQUE, points INTEGER NOT NULL,
      reason TEXT NOT NULL, actor TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gate_passages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, vehicle_id TEXT NOT NULL, gate_id TEXT NOT NULL, direction TEXT NOT NULL,
      task_id TEXT UNIQUE, source TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('authorized','consumed','completed','aborted')),
      created_at INTEGER NOT NULL, consumed_at INTEGER, finished_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS idempotency (
      key TEXT NOT NULL, player_id TEXT NOT NULL, action TEXT NOT NULL, task_id TEXT NOT NULL,
      status INTEGER NOT NULL, response TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (key, player_id, action)
    );
    CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, payload TEXT NOT NULL, game_ms INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sim_state (id INTEGER PRIMARY KEY CHECK (id = 1), park TEXT NOT NULL, saved_at INTEGER NOT NULL);
    -- major incidents (crises) with stages; their tasks link back via tasks.parent_id
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY, code TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, location_id TEXT NOT NULL,
      stage INTEGER NOT NULL, state TEXT NOT NULL CHECK (state IN ('active','resolved','cancelled')), started_at INTEGER NOT NULL, resolved_at INTEGER
    );
    -- condition per location (bungalow / facility): technical state, cleanliness, guest mood (0..1)
    -- saved games (snapshots of all game tables; kept across resets, see Game.saveGame / loadGame)
    CREATE TABLE IF NOT EXISTS saves (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, game_name TEXT NOT NULL, created_at INTEGER NOT NULL, auto INTEGER NOT NULL DEFAULT 0,
      game_ms INTEGER NOT NULL, players INTEGER NOT NULL, top TEXT, map_checksum TEXT NOT NULL, size INTEGER NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS location_state (id TEXT PRIMARY KEY, tech REAL NOT NULL, clean REAL NOT NULL, mood REAL NOT NULL, updated_at INTEGER NOT NULL);
  `);
  const cols = (t2) => db.prepare(`PRAGMA table_info(${t2})`).all().map((c) => c.name);
  const addCol = (t2, c, def) => {
    if (!cols(t2).includes(c)) db.exec(`ALTER TABLE ${t2} ADD COLUMN ${c} ${def}`);
  };
  addCol("tasks", "parent_id", "TEXT");
  addCol("tasks", "depth", "INTEGER NOT NULL DEFAULT 0");
  addCol("tasks", "escalated", "INTEGER NOT NULL DEFAULT 0");
  addCol("tasks", "fx", "TEXT");
  return db;
}
function tx(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
    }
    throw e;
  }
}
function getMeta(db, k) {
  const r = db.prepare("SELECT v FROM meta WHERE k = ?").get(k);
  return r?.v;
}
function setMeta(db, k, v) {
  db.prepare("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, v);
}
function wipe(db) {
  db.exec(`DELETE FROM players; DELETE FROM tasks; DELETE FROM score_ledger; DELETE FROM gate_passages; DELETE FROM idempotency;
           DELETE FROM events; DELETE FROM sim_state; DELETE FROM meta; DELETE FROM incidents; DELETE FROM location_state; DELETE FROM sqlite_sequence WHERE name IN ('events','score_ledger');`);
}

// src/sim/load.ts
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname as dirname2, join } from "node:path";

// src/shared/geom.ts
var add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
var sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
var mul = (a, k) => ({ x: a.x * k, y: a.y * k });
var dot = (a, b) => a.x * b.x + a.y * b.y;
var cross = (a, b) => a.x * b.y - a.y * b.x;
var dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
var norm = (a) => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};
var rightOf = (t2) => ({ x: -t2.y, y: t2.x });
var lerpV = (a, b, t2) => ({ x: a.x + (b.x - a.x) * t2, y: a.y + (b.y - a.y) * t2 });
var clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
var angleWrap = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};
function catmullRom(points, step = 0.5, alpha = 0.5) {
  if (points.length < 2) return points.slice();
  const p = [points[0], ...points, points[points.length - 1]];
  p[0] = sub(mul(points[0], 2), points[1]);
  p[p.length - 1] = sub(mul(points[points.length - 1], 2), points[points.length - 2]);
  const out = [];
  for (let i = 1; i < p.length - 2; i++) {
    const p0 = p[i - 1], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2];
    const t02 = 0;
    const t1 = t02 + Math.pow(dist(p0, p1) || 1e-6, alpha);
    const t2 = t1 + Math.pow(dist(p1, p2) || 1e-6, alpha);
    const t3 = t2 + Math.pow(dist(p2, p3) || 1e-6, alpha);
    const n = Math.max(2, Math.ceil(dist(p1, p2) / step));
    for (let j = 0; j < n; j++) {
      const t4 = t1 + (t2 - t1) * (j / n);
      const A1 = add(mul(p0, (t1 - t4) / (t1 - t02)), mul(p1, (t4 - t02) / (t1 - t02)));
      const A2 = add(mul(p1, (t2 - t4) / (t2 - t1)), mul(p2, (t4 - t1) / (t2 - t1)));
      const A3 = add(mul(p2, (t3 - t4) / (t3 - t2)), mul(p3, (t4 - t2) / (t3 - t2)));
      const B1 = add(mul(A1, (t2 - t4) / (t2 - t02)), mul(A2, (t4 - t02) / (t2 - t02)));
      const B2 = add(mul(A2, (t3 - t4) / (t3 - t1)), mul(A3, (t4 - t1) / (t3 - t1)));
      out.push(add(mul(B1, (t2 - t4) / (t2 - t1)), mul(B2, (t4 - t1) / (t2 - t1))));
    }
  }
  out.push(points[points.length - 1]);
  return out;
}
function cubicBezier(p0, p1, p2, p3, step = 0.4) {
  const approx = dist(p0, p1) + dist(p1, p2) + dist(p2, p3);
  const n = Math.max(6, Math.ceil(approx / step));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t2 = i / n, u = 1 - t2;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t2 * p1.x + 3 * u * t2 * t2 * p2.x + t2 * t2 * t2 * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t2 * p1.y + 3 * u * t2 * t2 * p2.y + t2 * t2 * t2 * p3.y
    });
  }
  return out;
}
function resample(pts, step = 0.5) {
  if (pts.length < 2) return pts.slice();
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  const n = Math.max(1, Math.round(total / step));
  const out = [];
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const s = total * i / n;
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    out.push(lerpV(pts[j], pts[j + 1], (s - cum[j]) / seg));
  }
  return out;
}
var Polyline = class _Polyline {
  pts;
  cum;
  length;
  constructor(pts) {
    const clean2 = [];
    for (const p of pts) if (!clean2.length || dist(clean2[clean2.length - 1], p) > 1e-4) clean2.push(p);
    if (clean2.length === 1) clean2.push({ x: clean2[0].x + 1e-3, y: clean2[0].y });
    this.pts = clean2;
    this.cum = [0];
    for (let i = 1; i < clean2.length; i++) this.cum.push(this.cum[i - 1] + dist(clean2[i - 1], clean2[i]));
    this.length = this.cum[this.cum.length - 1];
  }
  seg(s) {
    let lo = 0, hi = this.cum.length - 2;
    if (s <= 0) return 0;
    if (s >= this.length) return hi;
    while (lo < hi) {
      const mid = lo + hi + 1 >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
  sample(s) {
    const i = this.seg(s);
    const a = this.pts[i], b = this.pts[i + 1];
    const L = this.cum[i + 1] - this.cum[i] || 1e-9;
    const t2 = clamp((s - this.cum[i]) / L, 0, 1);
    const extra = s < 0 ? s : s > this.length ? s - this.length : 0;
    const tx2 = (b.x - a.x) / L, ty = (b.y - a.y) / L;
    const base = extra < 0 ? a : extra > 0 ? b : lerpV(a, b, t2);
    return { x: base.x + tx2 * extra, y: base.y + ty * extra, tx: tx2, ty };
  }
  /** Smoothed tangent (averaged over +-w metres) to avoid heading jitter on dense polylines. */
  tangent(s, w = 0.8) {
    const a = this.sample(Math.max(0, s - w)), b = this.sample(Math.min(this.length, s + w));
    const d = norm({ x: b.x - a.x, y: b.y - a.y });
    return d.x === 0 && d.y === 0 ? { x: a.tx, y: a.ty } : d;
  }
  /** Curvature magnitude (1/m) at s, via heading change over a window. */
  curvature(s, w = 1.5) {
    const s0 = clamp(s - w, 0, this.length), s1 = clamp(s + w, 0, this.length);
    if (s1 - s0 < 0.2) return 0;
    const a = this.sample(s0), b = this.sample(s1);
    const h0 = Math.atan2(a.ty, a.tx), h1 = Math.atan2(b.ty, b.tx);
    return Math.abs(angleWrap(h1 - h0)) / (s1 - s0);
  }
  slice(s0, s1) {
    s0 = clamp(s0, 0, this.length);
    s1 = clamp(s1, 0, this.length);
    const out = [];
    const a = this.sample(s0);
    out.push({ x: a.x, y: a.y });
    for (let i = 0; i < this.pts.length; i++) if (this.cum[i] > s0 + 1e-6 && this.cum[i] < s1 - 1e-6) out.push(this.pts[i]);
    const b = this.sample(s1);
    out.push({ x: b.x, y: b.y });
    return new _Polyline(out);
  }
  reversed() {
    return new _Polyline(this.pts.slice().reverse());
  }
  _bb;
  /** axis-aligned bounding box (cached) */
  get bbox() {
    if (!this._bb) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of this.pts) {
        if (p.x < x0) x0 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.x > x1) x1 = p.x;
        if (p.y > y1) y1 = p.y;
      }
      this._bb = { x0, y0, x1, y1 };
    }
    return this._bb;
  }
  /** distance from p to the bounding box (0 inside): a cheap lower bound for project().d */
  bboxDist(p) {
    const b = this.bbox;
    return Math.hypot(Math.max(b.x0 - p.x, 0, p.x - b.x1), Math.max(b.y0 - p.y, 0, p.y - b.y1));
  }
  // chunked bounding boxes (16 segments each): lets project() skip far-away parts of long polylines
  _chunks;
  static CH = 16;
  chunks() {
    if (this._chunks) return this._chunks;
    const n = this.pts.length - 1, C = _Polyline.CH, m = Math.ceil(n / C), out = new Float64Array(m * 4);
    for (let c = 0; c < m; c++) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = c * C; i <= Math.min(n, c * C + C); i++) {
        const q = this.pts[i];
        if (q.x < x0) x0 = q.x;
        if (q.y < y0) y0 = q.y;
        if (q.x > x1) x1 = q.x;
        if (q.y > y1) y1 = q.y;
      }
      out[c * 4] = x0;
      out[c * 4 + 1] = y0;
      out[c * 4 + 2] = x1;
      out[c * 4 + 3] = y1;
    }
    return this._chunks = out;
  }
  /** Closest point projection: returns arc length s, distance and signed lateral offset (+ = right of travel).
   *  Same result as a scan over all segments (first segment wins on ties); chunks whose box is further away than
   *  the best distance so far are skipped. */
  project(p) {
    const n = this.pts.length - 1, C = _Polyline.CH, ch2 = this.chunks(), px = p.x, py = p.y;
    let bestD2 = Infinity, bi = 0, bt = 0;
    for (let c = 0, m = ch2.length / 4; c < m; c++) {
      const dx = Math.max(ch2[c * 4] - px, 0, px - ch2[c * 4 + 2]), dy = Math.max(ch2[c * 4 + 1] - py, 0, py - ch2[c * 4 + 3]);
      if (dx * dx + dy * dy > bestD2) continue;
      for (let i = c * C, e = Math.min(n, c * C + C); i < e; i++) {
        const a2 = this.pts[i], b2 = this.pts[i + 1];
        const abx = b2.x - a2.x, aby = b2.y - a2.y, L2 = abx * abx + aby * aby || 1e-12;
        const t2 = clamp(((px - a2.x) * abx + (py - a2.y) * aby) / L2, 0, 1);
        const qx = a2.x + abx * t2 - px, qy = a2.y + aby * t2 - py, d2 = qx * qx + qy * qy;
        if (d2 < bestD2) {
          bestD2 = d2;
          bi = i;
          bt = t2;
        }
      }
    }
    if (bestD2 === Infinity) return { s: 0, d: Infinity, lateral: 0 };
    const a = this.pts[bi], b = this.pts[bi + 1], ab = sub(b, a), L = Math.sqrt(dot(ab, ab) || 1e-12);
    const q = add(a, mul(ab, bt));
    return { s: this.cum[bi] + bt * L, d: dist(p, q), lateral: dot(sub(p, q), rightOf(norm(ab))) };
  }
};
function offsetPolyline(pl, offset, step = 0.5) {
  const n = Math.max(2, Math.ceil(pl.length / step));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const s = pl.length * i / n;
    const p = pl.sample(s);
    const t2 = pl.tangent(s, 1);
    const r = rightOf(t2);
    const o = offset(s);
    out.push({ x: p.x + r.x * o, y: p.y + r.y * o });
  }
  return out;
}
function segSegDistance(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b));
}
function pointSegDist(p, a, b) {
  const ab = sub(b, a);
  const L2 = dot(ab, ab) || 1e-12;
  const t2 = clamp(dot(sub(p, a), ab) / L2, 0, 1);
  return dist(p, add(a, mul(ab, t2)));
}
function segmentsIntersect(a, b, c, d) {
  const d1 = cross(sub(b, a), sub(c, a)), d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c)), d4 = cross(sub(d, c), sub(b, c));
  return (d1 > 0 && d2 < 0 || d1 < 0 && d2 > 0) && (d3 > 0 && d4 < 0 || d3 < 0 && d4 > 0);
}
function polylineDistance(A, B, skipEndsA = 0, skipEndsB = 0) {
  let best = Infinity;
  const ea = A.length - skipEndsA, eb = B.length - skipEndsB;
  for (let i = 0; i < A.pts.length - 1; i++) {
    if (A.cum[i + 1] < skipEndsA || A.cum[i] > ea) continue;
    for (let j = 0; j < B.pts.length - 1; j++) {
      if (B.cum[j + 1] < skipEndsB || B.cum[j] > eb) continue;
      const dd = segSegDistance(A.pts[i], A.pts[i + 1], B.pts[j], B.pts[j + 1]);
      if (dd < best) best = dd;
    }
  }
  return best;
}
function obbOverlap(a, b, margin = 0) {
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  if (dx * dx + dy * dy > (a.hl + a.hw + b.hl + b.hw + 2 * margin) ** 2) return false;
  const axes = [[a.ux, a.uy], [-a.uy, a.ux], [b.ux, b.uy], [-b.uy, b.ux]];
  for (const [ax, ay] of axes) {
    const ra = (a.hl + margin) * Math.abs(a.ux * ax + a.uy * ay) + (a.hw + margin) * Math.abs(-a.uy * ax + a.ux * ay);
    const rb = (b.hl + margin) * Math.abs(b.ux * ax + b.uy * ay) + (b.hw + margin) * Math.abs(-b.uy * ax + b.ux * ay);
    if (Math.abs(dx * ax + dy * ay) > ra + rb) return false;
  }
  return true;
}
function pointInPolygon(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y + 1e-12) + a.x) c = !c;
  }
  return c;
}
function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = a + 1831565813 >>> 0;
    let t2 = a;
    t2 = Math.imul(t2 ^ t2 >>> 15, t2 | 1);
    t2 ^= t2 + Math.imul(t2 ^ t2 >>> 7, t2 | 61);
    return ((t2 ^ t2 >>> 14) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    state: () => a,
    setState: (s) => {
      a = s >>> 0;
    }
  };
}

// src/sim/network.ts
var VEH = { carLen: 4.7, carWid: 1.9 };
var TURN_CLEARANCE = 3.3;
var RT = 5;
var STRAIGHT = 3.6;
var SP = 3.1;
var CAR_STALL = { rt: RT, straight: STRAIGHT, width: SP, vehLen: VEH.carLen, vehWid: VEH.carWid };
function stallGeometry(lane, sAttach, E, rc, sz = CAR_STALL) {
  const A0 = lane.sample(sAttach);
  const A = { x: A0.x, y: A0.y };
  const d = lane.tangent(sAttach, 1);
  const h = Math.max(2.2, dist(A, E) * 0.55);
  const curve = cubicBezier(A, add(A, mul(d, h)), sub(E, mul(rc, h)), E, 0.3);
  const end = add(E, mul(rc, sz.straight));
  const line = new Polyline(resample([...curve, end], 0.35));
  const padC = add(E, mul(rc, sz.straight - sz.vehLen / 2 - 0.4));
  const parked = { cx: padC.x, cy: padC.y, ux: rc.x, uy: rc.y, hl: sz.vehLen / 2, hw: sz.vehWid / 2 };
  return { A, d, r: rc, end, line, padC, parked, E };
}
var A_LAT = 1.7;
function buildNetwork(net, sector) {
  const k = sector.metersPerPt;
  const o = sector.originPt;
  const toWorld = (pt) => ({ x: (pt[0] - o[0]) * k, y: (pt[1] - o[1]) * k });
  const validation = [];
  const nodes = /* @__PURE__ */ new Map();
  for (const [id, n] of Object.entries(net.nodes)) nodes.set(id, { id, pos: toWorld(n.pt), kind: n.kind });
  const edges = /* @__PURE__ */ new Map();
  const roads = [];
  const islands = [];
  const clsFlags = (c) => ({
    visitor: c === "public" || c === "arrival" || c === "park",
    service: c === "park" || c === "service" || c === "arrival"
  });
  const mkEdge = (e) => {
    const full = { ...e, vmax: e.vmax ?? new Float32Array(0), next: [], prev: [] };
    edges.set(full.id, full);
    return full;
  };
  const laneOf = {};
  for (const r of net.roads) {
    const nf = net.nodes[r.from], nt = net.nodes[r.to];
    const ctrl = [nf.pt, ...r.pts, nt.pt].map(toWorld);
    const centre = new Polyline(resample(catmullRom(ctrl, 0.4), 0.5));
    const trim = (n) => n.kind === "junction" ? n.radius ?? 6 : n.kind === "deadend" ? n.turnRadiusM ?? 6 : 0;
    const t02 = trim(nf), t1 = trim(nt);
    const core = centre.slice(t02, centre.length - t1);
    const base = r.laneOffsetM;
    let offF = (_s) => base, offB = (_s) => base;
    if (r.gatePlaza) {
      const g = r.gatePlaza;
      const sa = core.project(toWorld(g.fromPt)).s, sb = core.project(toWorld(g.toPt)).s;
      const ramp = g.rampM;
      const w = (s) => {
        if (s < sa - ramp || s > sb + ramp) return 0;
        if (s >= sa && s <= sb) return 1;
        const t2 = s < sa ? (s - (sa - ramp)) / ramp : (sb + ramp - s) / ramp;
        return t2 * t2 * (3 - 2 * t2);
      };
      offF = (s) => base + (g.forwardOffsetM - base) * w(s);
      offB = (s) => base + (g.backwardOffsetM - base) * w(s);
      const left = [], right = [];
      for (let s = sa - ramp * 0.3; s <= sb + ramp * 0.3; s += 0.5) {
        const p = core.sample(s), t2 = core.tangent(s), rn = rightOf(t2);
        const ww = w(s);
        if (ww < 0.35) continue;
        const a = offF(s) - 1.55, b = -(offB(s) - 1.55);
        right.push(add(p, mul(rn, Math.max(b + 0.05, a))));
        left.push(add(p, mul(rn, b)));
      }
      if (left.length > 2) islands.push([...right, ...left.reverse()]);
    }
    if (nt.kind === "deadend" || nf.kind === "deadend") {
      const atEnd = nt.kind === "deadend";
      const wEnd = (s) => {
        const x = atEnd ? (s - (core.length - 14)) / 14 : (14 - s) / 14;
        const t2 = clamp(x, 0, 1);
        return t2 * t2 * (3 - 2 * t2);
      };
      const f0 = offF, b0 = offB;
      const wide = Math.min(2.5, (atEnd ? nt : nf).turnRadiusM ? (atEnd ? nt : nf).turnRadiusM * 0.4 : 2.5);
      offF = (s) => Math.max(f0(s), base + Math.max(0, wide - base) * wEnd(s));
      offB = (s) => Math.max(b0(s), base + Math.max(0, wide - base) * wEnd(s));
    }
    const flags = clsFlags(r.class);
    const speed = r.speedKmh / 3.6;
    if (!r.oneway && !r.gatePlaza && base > 0) {
      const bendAt = (s) => {
        const a = core.tangent(clamp(s - 3, 0, core.length), 1), b = core.tangent(clamp(s + 3, 0, core.length), 1);
        const ang = Math.abs(Math.atan2(cross(a, b), a.x * b.x + a.y * b.y));
        return ang / 6;
      };
      const step = 1, n = Math.max(1, Math.ceil(core.length / step));
      const kap = Array.from({ length: n + 1 }, (_, i) => bendAt(i * step));
      const wid = kap.map((_, i) => {
        let m = 0, c = 0;
        for (let j = Math.max(0, i - 10); j <= Math.min(n, i + 10); j++) {
          m += kap[j];
          c++;
        }
        return Math.min(0.6, 4 * m / c);
      });
      const extra = (s) => {
        const i = clamp(s / step, 0, n);
        const i0 = Math.floor(i), i1 = Math.min(n, i0 + 1);
        return wid[i0] + (wid[i1] - wid[i0]) * (i - i0);
      };
      const f0 = offF, b0 = offB;
      offF = (s) => f0(s) + extra(s);
      offB = (s) => b0(s) + extra(s);
    }
    const fLine = new Polyline(offsetPolyline(core, offF, 0.5));
    const bLine = new Polyline(offsetPolyline(core, (s) => -offB(s), 0.5)).reversed();
    const ef = r.oneway === "b" ? void 0 : mkEdge({ id: `${r.id}:f`, kind: "lane", line: fLine, from: r.from, to: r.to, roadId: r.id, dir: "f", cls: r.class, priority: r.priority, baseSpeed: speed, reverseMotion: false, ...flags, laneHalfWidth: 1.45, oneway: !!r.oneway });
    const eb = r.oneway === "f" ? void 0 : mkEdge({ id: `${r.id}:b`, kind: "lane", line: bLine, from: r.to, to: r.from, roadId: r.id, dir: "b", cls: r.class, priority: r.priority, baseSpeed: speed, reverseMotion: false, ...flags, laneHalfWidth: 1.45, oneway: !!r.oneway });
    laneOf[r.id] = { f: ef?.id, b: eb?.id };
    const hw = [];
    const cpts = [];
    for (let s = 0; s <= centre.length; s += 1) {
      const cs = clamp(s - t02, 0, core.length);
      const p = centre.sample(s);
      cpts.push({ x: p.x, y: p.y });
      hw.push(Math.max(offF(cs), offB(cs)) + (r.surface === "pavers" ? 0.9 : 1.5));
    }
    roads.push({ id: r.id, name: r.name, cls: r.class, center: cpts, halfWidth: hw, markings: r.markings, surface: r.surface, from: r.from, to: r.to, hidden: r.hidden });
  }
  const demands = [];
  for (const c of sector.parkingClusters) {
    const sz = c.stall ? { ...CAR_STALL, ...c.stall } : CAR_STALL;
    for (let i = 0; i < c.stalls; i++) {
      const house2 = c.serves[i] ?? -1;
      demands.push({ cluster: c.id, key: `${c.id}:${c.serves[i] ?? `v${i + 1}`}`, house: house2, kind: c.kind === "depot" ? "depot" : house2 > 0 ? "house" : "spare", sz, p: toWorld(c.pt), order: i, avoid: /* @__PURE__ */ new Set() });
    }
  }
  const clusterKind = new Map(sector.parkingClusters.map((c) => [c.id, c.kind]));
  const bestLane = (d) => {
    let best = null;
    const depot = clusterKind.get(d.cluster) === "depot";
    for (const e of edges.values()) {
      if (e.kind !== "lane" || d.avoid.has(e.id)) continue;
      if (depot ? e.cls !== "service" : e.cls !== "park") continue;
      if (!depot && (net.nodes[e.from]?.kind === "portal" || net.nodes[e.to]?.kind === "portal")) continue;
      if (best && e.line.bboxDist(d.p) > best.d) continue;
      const pr = e.line.project(d.p);
      if (pr.lateral <= -0.9 && !e.oneway) continue;
      if (!best || pr.d < best.d) best = { lane: e.id, s: pr.s, d: pr.d, side: e.oneway && pr.lateral < 0 ? -1 : 1 };
    }
    return best;
  };
  const waterW = (sector.terrain?.water ?? []).map((w) => w.map(toWorld));
  const inWater = (q) => waterW.some((w) => pointInPolygon(q, w));
  const circles = Object.entries(net.nodes).filter(([, nd]) => nd.kind === "deadend").map(([, nd]) => ({ c: toWorld(nd.pt), r: (nd.turnRadiusM ?? 6) + 1.7 + 0.4 }));
  const inCircle = (q) => circles.some((cc) => dist(cc.c, q) < cc.r);
  const plans = [];
  const placedOBB = [];
  let pending = demands;
  for (let round = 0; round < 30 && pending.length; round++) {
    const rows = /* @__PURE__ */ new Map();
    const next = [];
    for (const d of pending) {
      const bl = bestLane(d);
      if (!bl) {
        validation.push({ level: "warn", msg: `Parkeervak ${d.key}: geen geschikte rijstrook gevonden` });
        continue;
      }
      const key = `${bl.lane}|${bl.side}|${d.sz.width}`;
      const row = rows.get(key) ?? rows.set(key, { lane: bl.lane, side: bl.side, sz: d.sz, items: [] }).get(key);
      row.items.push({ d, pref: bl.s + d.sz.rt * 0.6, dist: bl.d });
    }
    for (const [rowKey, row] of rows) {
      const sz = row.sz, RT2 = sz.rt, STRAIGHT2 = sz.straight;
      const laneLine = edges.get(row.lane).line, L = laneLine.length;
      const byCluster2 = /* @__PURE__ */ new Map();
      for (const it of row.items) (byCluster2.get(it.d.cluster) ?? byCluster2.set(it.d.cluster, []).get(it.d.cluster)).push(it);
      const items = [];
      for (const list of byCluster2.values()) {
        list.sort((x, y) => x.d.order - y.d.order);
        list.forEach((it, i) => items.push({ d: it.d, pref: it.pref + (i - (list.length - 1) / 2) * sz.width }));
      }
      items.sort((x, y) => x.pref - y.pref);
      const lo = 5 + RT2, hi = L - 7;
      const bl = sz === CAR_STALL ? 2.4 : sz.vehLen / 2 + 0.05, bw = sz === CAR_STALL ? 0.975 : sz.vehWid / 2 + 0.05;
      const layout = (use2, sp) => {
        const centres2 = use2.map((x) => x.pref);
        for (let i = 0; i < centres2.length; i++) centres2[i] = Math.max(centres2[i], i ? centres2[i - 1] + sp : lo);
        if (centres2.length && centres2[centres2.length - 1] > hi) {
          centres2[centres2.length - 1] = hi;
          for (let i = centres2.length - 2; i >= 0; i--) centres2[i] = Math.min(centres2[i], centres2[i + 1] - sp);
        }
        const entries2 = [], rcs2 = [], ss2 = [];
        for (const sc of centres2) {
          const B0 = laneLine.sample(sc), dc = laneLine.tangent(sc, 2);
          const rc = mul(rightOf(dc), row.side);
          const E = add({ x: B0.x, y: B0.y }, mul(rc, RT2));
          entries2.push(E);
          rcs2.push(rc);
          ss2.push(clamp(laneLine.project(sub(sub(E, mul(rc, RT2)), mul(dc, RT2 * 0.95))).s, 3, L - 3));
        }
        const geo2 = ss2.map((sA, i) => stallGeometry(laneLine, sA, entries2[i], rcs2[i], sz));
        const bad = /* @__PURE__ */ new Set();
        for (let i = 1; i < ss2.length; i++) if (ss2[i] - ss2[i - 1] <= 1) bad.add(i);
        const mine = geo2.map((g) => ({ ...g.parked, hl: bl, hw: bw }));
        const near = placedOBB.filter((o2) => geo2.some((g) => dist({ x: o2.obb.cx, y: o2.obb.cy }, { x: g.parked.cx, y: g.parked.cy }) < 30)).map((o2) => o2.obb);
        for (let j = 0; j < geo2.length; j++) {
          for (let x = 0.9; x <= geo2[j].line.length - sz.vehLen / 2 - 0.4; x += 0.4) {
            const q = geo2[j].line.sample(x), t2 = geo2[j].line.tangent(x, 0.5);
            const box = { cx: q.x, cy: q.y, ux: t2.x, uy: t2.y, hl: bl, hw: bw };
            let hit = false;
            for (let k2 = 0; k2 < mine.length && !hit; k2++) if (k2 !== j && obbOverlap(box, mine[k2], 0.26)) {
              hit = true;
              bad.add(Math.abs(k2 - j) === 1 ? Math.max(j, k2) : j);
            }
            for (const o2 of near) if (!hit && obbOverlap(box, o2, 0.26)) {
              hit = true;
              bad.add(j);
            }
            if (hit) break;
          }
          {
            const pk = geo2[j].parked;
            const ux = pk.ux * pk.hl, uy = pk.uy * pk.hl, vx = -pk.uy * pk.hw, vy = pk.ux * pk.hw;
            if ([[1, 1], [1, -1], [-1, 1], [-1, -1], [0, 0]].some(([a, b]) => {
              const q = { x: pk.cx + a * ux + b * vx, y: pk.cy + a * uy + b * vy };
              return inWater(q) || inCircle(q);
            })) bad.add(j);
          }
          const nearLane = laneLine.project(add(entries2[j], mul(rcs2[j], STRAIGHT2 - sz.vehLen - 0.4)));
          if (nearLane.d < (sz === CAR_STALL ? 2.6 : 1.9)) bad.add(j);
          const pc = geo2[j].parked;
          for (const e of edges.values()) {
            if (e.kind !== "lane" || e.id === row.lane || e.line.bboxDist({ x: pc.cx, y: pc.cy }) > 4) continue;
            if (e.line.project({ x: pc.cx, y: pc.cy }).d < bw + 1.5) {
              bad.add(j);
              break;
            }
          }
        }
        return { centres: centres2, entries: entries2, rcs: rcs2, ss: ss2, geo: geo2, bad };
      };
      let use = items.slice(0, Math.max(0, Math.min(items.length, Math.floor((hi - lo) / sz.width) + 1)));
      const overflow = items.slice(use.length);
      let res = layout(use, sz.width);
      for (let sp = sz.width + 0.3; res.bad.size && sp <= sz.width + 1.2 && (use.length - 1) * sp <= hi - lo; sp += 0.3) {
        const r2 = layout(use, sp);
        if (r2.bad.size < res.bad.size) res = r2;
      }
      for (let guard = 0; res.bad.size && guard < 40; guard++) {
        const drop = [...res.bad].sort((x, y) => y - x)[0];
        overflow.push(use[drop]);
        use = use.filter((_, i) => i !== drop);
        res = layout(use, sz.width);
      }
      const { centres, entries, rcs, ss, geo } = res;
      const fit = use.length;
      items.splice(0, items.length, ...use, ...overflow);
      for (const it of items.slice(fit)) {
        it.d.avoid.add(row.lane);
        next.push(it.d);
      }
      items.slice(0, fit).forEach((it, i) => {
        const plan = { key: it.d.key, cluster: it.d.cluster, house: it.d.house, lane: row.lane, s: ss[i], E: entries[i], rc: rcs[i], sz, kind: it.d.kind };
        plans.push(plan);
        placedOBB.push({ plan, obb: { ...geo[i].parked, hl: bl, hw: bw }, row: rowKey });
        const shift = centres[i] - it.pref;
        if (Math.abs(shift) > 8) validation.push({ level: "info", msg: `Vak ${it.d.key}: ${shift.toFixed(1)} m verschoven langs ${row.lane} (ruimte/kruising)` });
      });
    }
    pending = next;
  }
  for (const d of pending) validation.push({ level: "warn", msg: `Parkeervak ${d.key} (huis ${d.house}) kon nergens worden geplaatst` });
  const perCluster = /* @__PURE__ */ new Map();
  for (const p of plans) (perCluster.get(p.cluster) ?? perCluster.set(p.cluster, []).get(p.cluster)).push(p);
  for (const list of perCluster.values()) {
    list.sort((a, b) => a.lane === b.lane ? a.s - b.s : a.lane < b.lane ? -1 : 1);
    list.forEach((p, i) => {
      p.sid = `${p.cluster}-${i + 1}`;
    });
  }
  const splitsByLane = /* @__PURE__ */ new Map();
  for (const p of plans) {
    const L = edges.get(p.lane);
    if (p.s < 4 || p.s > L.line.length - 4) validation.push({ level: "warn", msg: `Vak voor huis ${p.house} ligt te dicht bij een kruising (s=${p.s.toFixed(1)})` });
    p.s = clamp(p.s, 4, L.line.length - 4);
    (splitsByLane.get(p.lane) ?? splitsByLane.set(p.lane, []).get(p.lane)).push(p);
  }
  for (const p of plans) {
    const L = edges.get(p.lane);
    if (L.oneway || !L.roadId || p.kind === "spare") continue;
    const F = edges.get(`${L.roadId}:${L.dir === "f" ? "b" : "f"}`);
    if (!F || F.kind !== "lane") continue;
    const G2 = stallGeometry(L.line, p.s, p.E, p.rc, p.sz);
    const pe = F.line.project(G2.A);
    if (pe.d > 6) continue;
    const sIn = pe.s - 3.5;
    const X = L.line.sample(Math.min(L.line.length - 1, p.s + 3 + p.sz.vehLen / 2));
    const sOut = F.line.project(X).s + 4.5;
    if (sIn < 5 || sOut > F.line.length - 5 || sOut < 5 || sIn > F.line.length - 5) continue;
    const cIn = { key: `${p.key}>in`, s: sIn, extra: true }, cOut = { key: `${p.key}>out`, s: sOut, extra: true };
    p.far = { lane: F.id, cIn, cOut, X: { x: X.x, y: X.y }, line: F.line };
    (splitsByLane.get(F.id) ?? splitsByLane.set(F.id, []).get(F.id)).push(cIn, cOut);
  }
  const crossLinks = [];
  const stalls = /* @__PURE__ */ new Map();
  const stallsByHouse = /* @__PURE__ */ new Map();
  const pieceMap = /* @__PURE__ */ new Map();
  for (const [laneId, ps] of splitsByLane) {
    ps.sort((a, b) => a.s - b.s);
    for (let i = 1; i < ps.length; i++) if (ps[i].s < ps[i - 1].s + 1) ps[i].s = ps[i - 1].s + 1;
    const L = edges.get(laneId);
    for (let i = ps.length - 1; i >= 0; i--) {
      const c = ps[i];
      if ("extra" in c && c.s > L.line.length - 1.5) {
        c.dead = true;
        ps.splice(i, 1);
      }
    }
    edges.delete(laneId);
    const cuts = [0, ...ps.map((p) => p.s), L.line.length];
    const pieces = [];
    let prevNode = L.from;
    for (let i = 0; i < cuts.length - 1; i++) {
      const id = `${laneId}~${i}`;
      const toNode = i < ps.length ? `AT:${ps[i].key}` : L.to;
      if (i < ps.length) nodes.set(toNode, { id: toNode, pos: L.line.sample(cuts[i + 1]), kind: "attach" });
      mkEdge({ ...L, id, line: L.line.slice(cuts[i], cuts[i + 1]), from: prevNode, to: toNode });
      pieces.push({ id, s0: cuts[i], s1: cuts[i + 1] });
      prevNode = toNode;
    }
    pieceMap.set(laneId, pieces);
    ps.filter((c) => !("extra" in c)).forEach((p) => {
      const at = `AT:${p.key}`;
      const G2 = stallGeometry(L.line, p.s, p.E, p.rc, p.sz);
      p.G = G2;
      p.near = L.line;
      const STRAIGHT2 = p.sz.straight, depot = p.kind === "depot";
      const A = G2.A, d = G2.d, r = G2.r, end = G2.end, inLine = G2.line;
      const stallNode = `ST:${p.key}`;
      const padC = G2.padC;
      nodes.set(stallNode, { id: stallNode, pos: end, kind: "stall" });
      p.stallNode = stallNode;
      const sid = p.sid;
      const inE = mkEdge({ id: `DW:${sid}`, kind: "driveway", line: inLine, from: at, to: stallNode, cls: "park", priority: 0, baseSpeed: 2.2, reverseMotion: false, visitor: !depot, service: true, stallId: sid, laneHalfWidth: 1.3 });
      const outE = mkEdge({ id: `RV:${sid}`, kind: "reverse", line: inLine.reversed(), from: stallNode, to: at, cls: "park", priority: 0, baseSpeed: 1.3, reverseMotion: true, visitor: !depot, service: true, stallId: sid, laneHalfWidth: 1.3 });
      const half = p.sz.width / 2 - 0.1;
      const dd = rightOf({ x: -r.x, y: -r.y });
      const E0 = G2.E;
      const pad = [
        add(add(E0, mul(dd, -half)), mul(r, -0.4)),
        add(add(E0, mul(dd, half)), mul(r, -0.4)),
        add(add(E0, mul(dd, half)), mul(r, STRAIGHT2 + 0.5)),
        add(add(E0, mul(dd, -half)), mul(r, STRAIGHT2 + 0.5))
      ];
      const st = {
        id: sid,
        clusterId: p.cluster,
        kind: p.kind,
        houseNumber: p.house,
        attachNode: at,
        inEdge: inE.id,
        outEdge: outE.id,
        inEdges: [inE.id],
        outEdges: [outE.id],
        parkS: inLine.length - p.sz.vehLen / 2 - 0.4,
        parkBack: p.sz.vehLen / 2 + 0.4,
        pad,
        parkedPose: { x: padC.x, y: padC.y, heading: Math.atan2(r.y, r.x) }
      };
      stalls.set(sid, st);
      if (p.house > 0) stallsByHouse.set(p.house, st);
    });
  }
  for (const p of plans) {
    const f = p.far, G2 = p.G, st = p.sid ? stalls.get(p.sid) : void 0;
    if (!f || !G2 || !st || !p.stallNode || f.cIn.dead || f.cOut.dead) continue;
    const inNode = `AT:${f.cIn.key}`, outNode = `AT:${f.cOut.key}`;
    if (!nodes.has(inNode) || !nodes.has(outNode)) continue;
    const depot = p.kind === "depot", sid = p.sid;
    const P0 = nodes.get(inNode).pos, t02 = f.line.tangent(f.cIn.s, 1.2);
    const hIn = Math.max(2.5, dist(P0, G2.E) * 0.55);
    const inPts = [...cubicBezier(P0, add(P0, mul(t02, hIn)), sub(G2.E, mul(G2.r, hIn)), G2.E, 0.3), G2.end];
    const dx = mkEdge({ id: `DX:${sid}`, kind: "driveway", line: new Polyline(resample(inPts, 0.35)), from: inNode, to: p.stallNode, cls: "park", priority: 0, baseSpeed: 2, reverseMotion: false, visitor: !depot, service: true, stallId: sid, laneHalfWidth: 1.3 });
    const X = f.X, tX = p.near.tangent(p.near.project(X).s, 1.2);
    const hR = Math.max(2.2, dist(G2.E, X) * 0.55);
    const rvPts = [G2.end, ...cubicBezier(G2.E, sub(G2.E, mul(G2.r, hR)), sub(X, mul(tX, hR)), X, 0.3)];
    const xNode = `RX:${p.key}`;
    nodes.set(xNode, { id: xNode, pos: X, kind: "attach" });
    const rx = mkEdge({ id: `RX:${sid}`, kind: "reverse", line: new Polyline(resample(rvPts, 0.35)), from: p.stallNode, to: xNode, cls: "park", priority: 0, baseSpeed: 1.3, reverseMotion: true, visitor: !depot, service: true, stallId: sid, laneHalfWidth: 1.3 });
    const P3 = nodes.get(outNode).pos, t3 = f.line.tangent(f.cOut.s, 1.2), back = { x: -tX.x, y: -tX.y };
    const hO = Math.max(2, dist(X, P3) * 0.45);
    const xo = mkEdge({ id: `XO:${sid}`, kind: "connector", line: new Polyline(resample(cubicBezier(X, add(X, mul(back, hO)), sub(P3, mul(t3, hO)), P3, 0.3), 0.3)), from: xNode, to: outNode, cls: "park", priority: 0, baseSpeed: 2.2, reverseMotion: false, visitor: !depot, service: true, laneHalfWidth: 1.3 });
    st.inEdges.push(dx.id);
    st.outEdges.push(rx.id);
    crossLinks.push([rx.id, xo.id], [xo.id, outNode]);
  }
  const incoming = (node) => [...edges.values()].filter((e) => e.kind === "lane" && e.to === node);
  const outgoing = (node) => [...edges.values()].filter((e) => e.kind === "lane" && e.from === node);
  for (const [nid, n] of Object.entries(net.nodes)) {
    if (n.kind === "junction") {
      for (const ein of incoming(nid)) for (const eout of outgoing(nid)) {
        if (ein.roadId === eout.roadId) {
          const p02 = ein.line.sample(ein.line.length), p32 = eout.line.sample(0);
          const t03 = ein.line.tangent(ein.line.length, 1.2), t32 = eout.line.tangent(0, 1.2);
          const hh = Math.max(4.5, (net.nodes[nid].radius ?? 6) * 0.8);
          const pts2 = cubicBezier(p02, add(p02, mul(t03, hh)), sub(p32, mul(t32, hh)), p32, 0.25);
          const id2 = `UT:${nid}:${ein.roadId}${ein.dir}`;
          mkEdge({ id: id2, kind: "connector", line: new Polyline(resample(pts2, 0.3)), from: nid, to: nid, cls: ein.cls, priority: 1, baseSpeed: 2.2, reverseMotion: false, visitor: false, service: ein.service && eout.service, laneHalfWidth: 1.2, uturn: true });
          link(ein.id, id2);
          link(id2, eout.id);
          continue;
        }
        const p0 = ein.line.sample(ein.line.length), p3 = eout.line.sample(0);
        const t02 = ein.line.tangent(ein.line.length, 1.2), t3 = eout.line.tangent(0, 1.2);
        const dd = dist(p0, p3);
        const turn = Math.abs(Math.atan2(t02.x * t3.y - t02.y * t3.x, dot(t02, t3)));
        const h = dd * (turn > 1.2 ? 0.5 : 0.42);
        const pts = cubicBezier(p0, add(p0, mul(t02, h)), sub(p3, mul(t3, h)), p3, 0.3);
        const id = `CN:${nid}:${ein.roadId}${ein.dir}>${eout.roadId}${eout.dir}`;
        const visitor = ein.visitor && eout.visitor, service = ein.service && eout.service;
        mkEdge({ id, kind: "connector", line: new Polyline(resample(pts, 0.3)), from: nid, to: nid, cls: ein.cls, priority: ein.priority, baseSpeed: Math.min(ein.baseSpeed, eout.baseSpeed), reverseMotion: false, visitor, service, laneHalfWidth: 1.45 });
        link(ein.id, id);
        link(id, eout.id);
      }
    } else if (n.kind === "deadend") {
      const ins = incoming(nid), outs = outgoing(nid);
      if (ins.length !== 1 || outs.length !== 1) {
        validation.push({ level: "warn", msg: `Doodlopend punt ${nid} heeft geen enkele in/uit-rijstrook` });
        continue;
      }
      const ein = ins[0], eout = outs[0];
      const C = nodes.get(nid).pos;
      const P0 = ein.line.sample(ein.line.length), P3 = eout.line.sample(0);
      const f = ein.line.tangent(ein.line.length, 1.5), r = rightOf(f);
      const R = n.turnRadiusM ?? 6;
      const pts = [P0, add(P0, mul(f, 1.2))];
      for (let a = -55; a <= 235; a += 10) {
        const th = a * Math.PI / 180;
        pts.push(add(C, add(mul(r, R * Math.cos(th)), mul(f, R * Math.sin(th)))));
      }
      pts.push(sub(P3, mul(eout.line.tangent(0, 1.5), 1.2)), P3);
      const id = `LP:${nid}`;
      mkEdge({ id, kind: "loop", line: new Polyline(resample(catmullRom(pts, 0.3), 0.3)), from: nid, to: nid, cls: ein.cls, priority: 1, baseSpeed: 3.2, reverseMotion: false, visitor: ein.visitor, service: ein.service, laneHalfWidth: 1.45 });
      link(ein.id, id);
      link(id, eout.id);
      const srf = net.roads.find((r2) => r2.id === ein.roadId)?.surface;
      roads.push({ id: `circle:${nid}`, name: "Keerlus", cls: ein.cls, center: [C], halfWidth: [R + (srf === "pavers" ? 1.1 : 1.7)], surface: srf });
    }
  }
  function link(a, b) {
    const A = edges.get(a), B = edges.get(b);
    if (!A.next.includes(b)) A.next.push(b);
    if (!B.prev.includes(a)) B.prev.push(a);
  }
  for (const e of edges.values()) {
    if (e.kind === "lane") {
      for (const e2 of edges.values()) if (e2.kind === "lane" && e2.from === e.to && e.to.startsWith("AT:")) link(e.id, e2.id);
    }
    if (e.kind === "driveway") {
      for (const p of edges.values()) if (p.kind === "lane" && p.to === e.from) link(p.id, e.id);
    }
    if (e.kind === "reverse") {
      for (const n2 of edges.values()) if (n2.kind === "lane" && n2.from === e.to) link(e.id, n2.id);
    }
  }
  for (const [a, b] of crossLinks) {
    if (edges.has(b)) link(a, b);
    else for (const n2 of edges.values()) if (n2.kind === "lane" && n2.from === b) link(a, n2.id);
  }
  for (const e of edges.values()) {
    const n = Math.max(2, Math.ceil(e.line.length) + 1);
    const vm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const kappa = Math.max(e.line.curvature(Math.min(i, e.line.length), 2), 1e-4);
      vm[i] = Math.min(e.baseSpeed, Math.sqrt(A_LAT / kappa));
    }
    e.vmax = vm;
  }
  const gates = /* @__PURE__ */ new Map();
  for (const g of net.gates) {
    const laneId = (g.lane === "forward" ? laneOf[g.road]?.f : laneOf[g.road]?.b) ?? `${g.road}:${g.lane === "forward" ? "f" : "b"}`;
    const e = edges.get(laneId);
    if (!e) {
      validation.push({ level: "warn", msg: `Slagboom ${g.id}: rijstrook ${laneId} niet gevonden` });
      continue;
    }
    const sp = toWorld(g.stopPt);
    const stopS = e.line.project(sp).s;
    const slotS = [];
    let limitation;
    for (let i = 0; i < g.queueSlots; i++) {
      const s = stopS - VEH.carLen / 2 - 0.4 - i * g.slotSpacingM;
      if (s < VEH.carLen / 2 + 1) {
        limitation = `Slagboom ${g.id}: slechts ${i} van ${g.queueSlots} opstelplaatsen passen op de rijstrook (${stopS.toFixed(1)} m beschikbaar).`;
        break;
      }
      slotS.push(s);
    }
    if (limitation) validation.push({ level: "warn", msg: limitation });
    else validation.push({ level: "info", msg: `Slagboom ${g.id}: ${slotS.length} opstelplaatsen x ${g.slotSpacingM} m, stopstreep op s=${stopS.toFixed(1)} m van ${laneId}` });
    const P2 = e.line.sample(stopS), t2 = e.line.tangent(stopS, 1), r = rightOf(t2);
    for (let i = Math.max(0, Math.floor(stopS - 14)); i < Math.min(e.vmax.length, Math.ceil(stopS + 10)); i++) e.vmax[i] = Math.min(e.vmax[i], 2.8);
    const side = g.armSide === "right" ? 1 : -1;
    const armPivot = add(P2, mul(r, 1.75 * side));
    const crossLen = 3;
    const crossingPoly = [add(P2, mul(r, -1.5)), add(P2, mul(r, 1.5)), add(add(P2, mul(r, 1.5)), mul(t2, crossLen)), add(add(P2, mul(r, -1.5)), mul(t2, crossLen))];
    gates.set(g.id, {
      id: g.id,
      direction: g.direction,
      staff: !!g.staff,
      edge: laneId,
      stopS,
      crossLen,
      slotS,
      slotSpacing: g.slotSpacingM,
      queueSlots: slotS.length,
      armPivot,
      armDir: mul(r, -side),
      armLen: 3.4,
      laneDir: t2,
      openSec: g.openSec,
      closeSec: g.closeSec,
      stopPoint: { x: P2.x, y: P2.y },
      kiosk: add(add(P2, mul(r, 2.1 * side)), mul(t2, -1.2)),
      crossingPoly,
      limitation,
      label: g.label ?? g.id
    });
  }
  const portals = /* @__PURE__ */ new Map();
  for (const [nid, n] of Object.entries(net.nodes)) {
    if (n.kind !== "portal") continue;
    const spawn = [...edges.values()].find((e) => e.kind === "lane" && e.from === nid);
    const despawn = [...edges.values()].find((e) => e.kind === "lane" && e.to === nid);
    portals.set(nid, { id: nid, node: nid, kind: n.portal ?? "public", spawnEdge: spawn?.id, despawnEdge: despawn?.id, label: n.label ?? nid });
  }
  const zones = [];
  const memberSamples = (e, s0, s1) => {
    const out = [];
    for (let s = s0; s <= s1 + 1e-6; s += 0.6) {
      const p = e.line.sample(s);
      out.push({ x: p.x, y: p.y });
    }
    return out;
  };
  const conns = [...edges.values()].filter((e) => e.kind === "connector");
  for (let i = 0; i < conns.length; i++) for (let j = i + 1; j < conns.length; j++) {
    const a = conns[i], b = conns[j];
    if (a.from !== b.from) continue;
    if (a.prev[0] === b.prev[0]) continue;
    const merge = a.next[0] === b.next[0];
    const ba = a.line.bbox, bb = b.line.bbox;
    const gap = Math.hypot(Math.max(ba.x0 - bb.x1, bb.x0 - ba.x1, 0), Math.max(ba.y0 - bb.y1, bb.y0 - ba.y1, 0));
    if (!merge && gap > TURN_CLEARANCE) continue;
    const dmin = polylineDistance(a.line, b.line);
    const turns = (e) => {
      const t02 = e.line.tangent(0, 1), t1 = e.line.tangent(e.line.length, 1);
      return Math.abs(Math.atan2(cross(t02, t1), t02.x * t1.x + t02.y * t1.y)) > 0.5;
    };
    if (!merge && dmin > VEH.carWid + 0.6 && !(dmin < TURN_CLEARANCE && (turns(a) || turns(b)))) continue;
    const z = {
      id: `Z:${a.from}:${zones.length}`,
      kind: "junction",
      node: a.from,
      members: [
        { edge: a.id, s0: 0, s1: a.line.length, stream: a.id, prio: a.priority, samples: memberSamples(a, 0, a.line.length) },
        { edge: b.id, s0: 0, s1: b.line.length, stream: b.id, prio: b.priority, samples: memberSamples(b, 0, b.line.length) }
      ],
      exclusive: /* @__PURE__ */ new Set([a.id, b.id]),
      approachDir: { [a.id]: a.line.tangent(0, 1), [b.id]: b.line.tangent(0, 1) },
      approachPos: { [a.id]: a.line.sample(0), [b.id]: b.line.sample(0) }
    };
    zones.push(z);
  }
  const byCluster = /* @__PURE__ */ new Map();
  for (const s of stalls.values()) (byCluster.get(s.clusterId) ?? byCluster.set(s.clusterId, []).get(s.clusterId)).push(s);
  for (const [cid, sts] of byCluster) {
    const z = { id: `ZP:${cid}`, kind: "parking", node: cid, members: [], exclusive: /* @__PURE__ */ new Set(), approachDir: {}, approachPos: {} };
    const attachPts = sts.flatMap((s) => [s.attachNode, ...s.inEdges.slice(1).map((id) => edges.get(id).from)]).map((n) => nodes.get(n).pos);
    const near = (p) => attachPts.some((a) => dist(a, p) < 11);
    for (const e of edges.values()) {
      if (e.kind !== "lane") continue;
      if (!attachPts.some((a) => e.line.bboxDist(a) < 11)) continue;
      let s0 = -1, s1 = -1;
      for (let s = 0; s <= e.line.length; s += 0.5) {
        if (near(e.line.sample(s))) {
          if (s0 < 0) s0 = s;
          s1 = s;
        }
      }
      if (s0 < 0) continue;
      const stream = `lane:${e.roadId}:${e.dir}`;
      z.members.push({ edge: e.id, s0, s1, stream, prio: 2, samples: memberSamples(e, s0, s1) });
      z.approachDir[stream] = e.line.tangent(s0, 1);
      z.approachPos[stream] = e.line.sample(s0);
    }
    for (const s of sts) {
      const ie = edges.get(s.inEdge), oe = edges.get(s.outEdge);
      z.members.push({ edge: ie.id, s0: 0, s1: Math.min(4, ie.line.length), stream: `in:${s.id}`, prio: 1, samples: memberSamples(ie, 0, Math.min(4, ie.line.length)) });
      z.members.push({ edge: oe.id, s0: 0, s1: oe.line.length, stream: `out:${s.id}`, prio: 0, samples: memberSamples(oe, 0, oe.line.length) });
      z.exclusive.add(`out:${s.id}`);
      for (const id of s.inEdges.slice(1)) {
        const e = edges.get(id);
        z.members.push({ edge: id, s0: 0, s1: e.line.length, stream: `xin:${s.id}`, prio: 0, samples: memberSamples(e, 0, e.line.length) });
        z.exclusive.add(`xin:${s.id}`);
      }
      for (const id of s.outEdges.slice(1)) {
        const e = edges.get(id);
        z.members.push({ edge: id, s0: 0, s1: e.line.length, stream: `xrv:${s.id}`, prio: 0, samples: memberSamples(e, 0, e.line.length) });
        z.exclusive.add(`xrv:${s.id}`);
        const xo = edges.get(e.next[0] ?? "");
        if (xo) {
          z.members.push({ edge: xo.id, s0: 0, s1: xo.line.length, stream: `xout:${s.id}`, prio: 0, samples: memberSamples(xo, 0, xo.line.length) });
          z.exclusive.add(`xout:${s.id}`);
        }
      }
    }
    zones.push(z);
  }
  for (const e of edges.values()) {
    if (e.kind !== "loop") continue;
    zones.push({
      id: `ZL:${e.from}`,
      kind: "junction",
      node: e.from,
      members: [{ edge: e.id, s0: 0, s1: e.line.length, stream: "loop", prio: 1, samples: memberSamples(e, 0, e.line.length) }],
      exclusive: /* @__PURE__ */ new Set(["loop"]),
      approachDir: {},
      approachPos: {},
      single: true
    });
  }
  const zonesByEdge = /* @__PURE__ */ new Map();
  for (const z of zones) for (const m of z.members) (zonesByEdge.get(m.edge) ?? zonesByEdge.set(m.edge, []).get(m.edge)).push({ zone: z, member: m });
  const laneEdges = [...edges.values()].filter((e) => e.kind === "lane" || e.kind === "loop");
  const houses = sector.houses.map((h) => {
    const pos = toWorld(h.pt);
    let best = { d: Infinity, p: pos };
    for (const e of laneEdges) {
      if (e.line.bboxDist(pos) >= best.d) continue;
      const pr = e.line.project(pos);
      if (pr.d < best.d) {
        const q = e.line.sample(pr.s);
        best = { d: pr.d, p: { x: q.x, y: q.y } };
      }
    }
    let front = norm(sub(best.p, pos));
    if (best.d > 40) front = { x: 0, y: 1 };
    const rot = (h.pdfRotationDeg ?? 0) * Math.PI / 180;
    let snap = front, bestDot = h.frontDeg !== void 0 ? 2 : -2;
    if (h.frontDeg !== void 0) snap = { x: Math.cos(h.frontDeg * Math.PI / 180), y: Math.sin(h.frontDeg * Math.PI / 180) };
    for (let q = 0; q < 4 && h.frontDeg === void 0; q++) {
      const a = rot + q * Math.PI / 2;
      const c = { x: Math.cos(a), y: Math.sin(a) };
      const dd = dot(c, front);
      if (dd > bestDot) {
        bestDot = dd;
        snap = c;
      }
    }
    const st = stallsByHouse.get(h.number);
    return {
      id: h.id,
      number: h.number,
      legendType: h.legendType,
      typeConfidence: h.typeConfidence,
      pos,
      rotation: Math.atan2(snap.y, snap.x),
      front: snap,
      petsAllowed: !!h.petsAllowed,
      focus: !!st,
      door: add(pos, mul(snap, 4.2)),
      stallId: st?.id
    };
  });
  const roadLike = [...edges.values()].filter((e) => e.kind === "lane" || e.kind === "loop" || e.kind === "connector" && !e.uturn);
  const need = (e) => e.kind === "loop" ? 2.7 : 2.4;
  const padPolys = [...stalls.values()].map((st) => ({ pts: st.pad, c: mul(st.pad.reduce((q, w) => add(q, w), { x: 0, y: 0 }), 1 / st.pad.length) }));
  const sizes = houses.map((hs, i) => houseSize(hs.legendType, sector.houses[i].footprintPts ? sector.houses[i].footprintPts * k : void 0, hs.number));
  houses.forEach((hs, i) => {
    const fixed = sector.houses[i].scale;
    if (fixed) sizes[i].scale = Math.max(0.5, Math.min(1.2, fixed));
    hs.scale = sizes[i].scale;
  });
  const locked = new Set(houses.map((_, i) => i).filter((i) => sector.houses[i].locked));
  const start = houses.map((hs) => ({ ...hs.pos }));
  const fp = (i) => houseFootprint(houses[i].pos, houses[i].front, sizes[i], houses[i].number);
  const body = (i) => houseFootprint(houses[i].pos, houses[i].front, sizes[i], houses[i].number, { patio: false });
  const nearEdges = houses.map((hs) => roadLike.filter((e) => e.line.bboxDist(hs.pos) < 30));
  const nearPads = houses.map((hs) => padPolys.filter((pd) => dist(pd.c, hs.pos) < 30));
  const nearHouses = houses.map((hs, i) => houses.map((_, j) => j).filter((j) => j !== i && dist(houses[j].pos, hs.pos) < 30));
  const open = new Set(houses.map((_, i) => i).filter((i) => !locked.has(i)));
  for (let iter = 0; iter < 120 && open.size; iter++) {
    for (const i of [...open]) {
      const f = fp(i);
      const pts = footprintSamples(f, 6, 4);
      let px = 0, py = 0, hit = false;
      const c = { x: f.cx, y: f.cy };
      for (const e of nearEdges[i]) {
        if (e.line.bboxDist(c) > f.hl + f.hw + 3) continue;
        const nd = need(e);
        let pen = 0;
        for (const q of pts) {
          const d = e.line.project(q).d;
          if (d < nd) pen = Math.max(pen, nd - d);
        }
        if (!pen) continue;
        let dx, dy;
        if (e.kind === "loop") {
          const nc = nodes.get(e.from).pos;
          dx = c.x - nc.x;
          dy = c.y - nc.y;
        } else {
          const on = e.line.sample(e.line.project(c).s);
          dx = c.x - on.x;
          dy = c.y - on.y;
        }
        let l2 = Math.hypot(dx, dy);
        if (l2 < 0.2) {
          dx = -houses[i].front.x;
          dy = -houses[i].front.y;
          l2 = 1;
        }
        px += dx / l2 * pen;
        py += dy / l2 * pen;
        hit = true;
      }
      for (const pd of nearPads[i]) {
        for (const q of pts) if (pointInPolygon(q, pd.pts)) {
          const dx = f.cx - pd.c.x, dy = f.cy - pd.c.y, l2 = Math.hypot(dx, dy) || 1;
          px += dx / l2 * 0.5;
          py += dy / l2 * 0.5;
          hit = true;
        }
      }
      const bi = body(i);
      for (const j of nearHouses[i]) {
        if (obbOverlap(bi, body(j), 0.3)) {
          const dx = houses[i].pos.x - houses[j].pos.x, dy = houses[i].pos.y - houses[j].pos.y, l2 = Math.hypot(dx, dy) || 1;
          px += dx / l2 * (locked.has(j) ? 1.2 : 0.6);
          py += dy / l2 * (locked.has(j) ? 1.2 : 0.6);
          hit = true;
          if (!locked.has(j)) open.add(j);
        }
      }
      if (!hit) {
        open.delete(i);
        continue;
      }
      if ((dist(houses[i].pos, start[i]) > 9 || iter > 40) && !sector.houses[i].scale && sizes[i].scale > 0.66 && iter % 6 === 5) {
        sizes[i].scale = Math.max(0.65, sizes[i].scale - 0.05);
        houses[i].scale = sizes[i].scale;
      }
      if (iter > 60) {
        const sgn = houses[i].number % 2 ? 1 : -1, m = Math.max(0.5, Math.hypot(px, py));
        px += -houses[i].front.y * sgn * m;
        py += houses[i].front.x * sgn * m;
      }
      const l = Math.hypot(px, py) || 1, step = Math.max(0.15, Math.min(0.5, l));
      houses[i].pos = add(houses[i].pos, { x: px / l * step, y: py / l * step });
    }
  }
  const clear = (i) => {
    const f = fp(i), pts = footprintSamples(f, 6, 4), bi = body(i);
    if (nearEdges[i].some((e) => e.line.bboxDist({ x: f.cx, y: f.cy }) <= f.hl + f.hw + 3 && pts.some((q) => e.line.project(q).d < need(e)))) return false;
    if (nearPads[i].some((pd) => pts.some((q) => pointInPolygon(q, pd.pts)))) return false;
    return !nearHouses[i].some((j) => obbOverlap(bi, body(j), 0.3));
  };
  for (const i of [...open]) {
    found: for (let r = 1; r <= 18; r++) for (let a = 0; a < 24; a++) {
      const th = a / 24 * Math.PI * 2;
      houses[i].pos = { x: start[i].x + Math.cos(th) * r, y: start[i].y + Math.sin(th) * r };
      if (clear(i)) {
        open.delete(i);
        break found;
      }
    }
    if (open.has(i)) houses[i].pos = start[i];
  }
  houses.forEach((hs, i) => {
    const moved = dist(hs.pos, start[i]);
    if (moved > 0.3) hs.adjusted = `${moved.toFixed(1)} m verschoven zodat het huis vrij van weg, kruising, parkeervak en buren staat`;
    hs.door = add(hs.pos, mul(hs.front, sizes[i].doorM * sizes[i].scale));
  });
  for (const i of open) {
    const f = fp(i), pts = footprintSamples(f, 6, 4);
    const roadsHit = nearEdges[i].filter((e) => pts.some((q) => e.line.project(q).d < need(e))).map((e) => e.id);
    const padsHit = nearPads[i].filter((pd) => pts.some((q) => pointInPolygon(q, pd.pts))).length;
    const housesHit = nearHouses[i].filter((j) => obbOverlap(body(i), body(j), 0.3)).map((j) => houses[j].number);
    validation.push({ level: "warn", msg: `Huis ${houses[i].number}: geen vrije plek gevonden (weg: ${roadsHit.slice(0, 3).join(",") || "-"}; vakken: ${padsHit}; buren: ${housesHit.join(",") || "-"})` });
  }
  for (const i of locked) if (!clear(i)) validation.push({ level: "warn", msg: `Huis ${houses[i].number}: met de hand vastgezet, maar raakt een weg, parkeervak of buurhuis` });
  for (const hs of houses) if (hs.adjusted) validation.push({ level: "info", msg: `Huis ${hs.number}: ${hs.adjusted}` });
  for (const e of edges.values()) {
    if (e.next.length === 0 && !e.to.startsWith("P_") && e.kind !== "driveway" && e.cls !== "scenery")
      validation.push({ level: "warn", msg: `Rijstrook ${e.id} heeft geen vervolg (doodlopend zonder keerlus)` });
  }
  const viewW = (sector.viewPts[2] - sector.viewPts[0]) * k, viewH = (sector.viewPts[3] - sector.viewPts[1]) * k;
  return { edges, nodes, zones, zonesByEdge, stalls, stallsByHouse, gates, portals, roads, islands, houses, toWorld, bounds: { w: viewW, h: viewH }, validation };
}
function visitorPortal(net) {
  return [...net.portals.values()].filter((p) => p.kind === "public").map((p) => p.id).sort()[0] ?? "";
}
function findRoute(net, fromEdge, toEdge, kind, opts = {}) {
  const gateEdges = new Set([...net.gates.values()].filter((g) => !g.staff).map((g) => g.edge));
  const allowed = (e) => kind === "visitor" ? e.visitor : e.service;
  const distM = /* @__PURE__ */ new Map([[fromEdge, 0]]);
  const prev = /* @__PURE__ */ new Map();
  const open = new MinHeap();
  open.push(0, fromEdge);
  const done = /* @__PURE__ */ new Set();
  while (open.size) {
    const [d, id] = open.pop();
    if (done.has(id)) continue;
    done.add(id);
    if (id === toEdge) break;
    const e = net.edges.get(id);
    for (const nid of e.next) {
      const n = net.edges.get(nid);
      if (!allowed(n) && nid !== toEdge) continue;
      if (n.kind === "driveway" && nid !== toEdge) continue;
      if (n.kind === "reverse") continue;
      if (n.uturn && !opts.uturn) continue;
      const nd = d + e.line.length + (kind === "service" && gateEdges.has(nid) ? 2e4 : 0);
      if (nd < (distM.get(nid) ?? Infinity)) {
        distM.set(nid, nd);
        prev.set(nid, id);
        open.push(nd, nid);
      }
    }
  }
  if (!done.has(toEdge)) return null;
  const path = [toEdge];
  while (path[0] !== fromEdge) {
    const p = prev.get(path[0]);
    if (!p) return null;
    path.unshift(p);
  }
  return path;
}
var MinHeap = class {
  k = [];
  v = [];
  get size() {
    return this.k.length;
  }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = i - 1 >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    if (!k.length) return void 0;
    const top = [k[0], v[0]];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (; ; ) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mk = lk;
        if (l < n && k[l] < mk) {
          m = l;
          mk = k[l];
        }
        if (r < n && k[r] < mk) {
          m = r;
          mk = k[r];
        }
        if (m === i) break;
        k[i] = k[m];
        v[i] = v[m];
        i = m;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
};

// src/sim/load.ts
var here = dirname2(fileURLToPath(import.meta.url));
var DATA_DIR = [join(here, "..", "..", "data", "map"), join(here, "..", "data", "map")].find((p) => existsSync(p)) ?? join(here, "..", "..", "data", "map");
function loadMapJson(dir = process.env.MAP_DIR ?? DATA_DIR) {
  const set = ["park_road_network.json", "park.json"];
  const net = JSON.parse(readFileSync(join(dir, set[0]), "utf8"));
  const sector = JSON.parse(readFileSync(join(dir, set[1]), "utf8"));
  return { net, sector };
}
var cache = /* @__PURE__ */ new Map();
function loadNetwork(dir) {
  const key = `${dir ?? process.env.MAP_DIR ?? DATA_DIR}`;
  let n = cache.get(key);
  if (!n) {
    const { net, sector } = loadMapJson(dir);
    n = buildNetwork(net, sector);
    cache.set(key, n);
  }
  return n;
}
function clearNetworkCache() {
  cache.clear();
}
var mapDir = () => process.env.MAP_DIR ?? DATA_DIR;

// src/server/mapstore.ts
import { Worker } from "node:worker_threads";
import { readFileSync as readFileSync2, writeFileSync, renameSync, existsSync as existsSync2 } from "node:fs";
import { join as join2 } from "node:path";

// src/shared/mapdoc.ts
var MAP_FORMAT = "harderwold-map";
var MAP_SCHEMA = 1;
var REVIEW_ITEMS = [
  { id: "houses-numbers", label: "Alle huisnummers uit de PDF staan op de kaart, op de juiste plek en zonder dubbele nummers" },
  { id: "houses-types", label: "Huistypen met lage of middelmatige zekerheid zijn gecontroleerd" },
  { id: "houses-front", label: "Voordeuren wijzen naar de goede weg; huizen staan niet op een weg of tegen elkaar" },
  { id: "facilities", label: "Voorzieningen (receptie, brasserie, zwembad, winkel, ...) staan op de juiste plek" },
  { id: "roads-topology", label: "Wegverloop en kruisingen kloppen met de PDF; geen wegen buiten het park" },
  { id: "roads-oneway", label: "Eenrichtingswegen en rijrichtingen zijn gecontroleerd" },
  { id: "gates", label: "Slagbomen, stopstrepen en opstelplaatsen liggen goed; de wachtrij blokkeert geen openbare weg" },
  { id: "service", label: "Dienstwegen en dienstingangen zijn alleen voor servicevoertuigen en kloppen met de praktijk" },
  { id: "parking", label: "Elk huis heeft een eigen parkeervak dicht bij het huis" },
  { id: "scale", label: "Schaal (meter per PDF-punt) is gecontroleerd met een bekende maat" },
  { id: "terrain", label: "Water, paden en verharde vlakken zijn gecontroleerd" }
];
var isPt = (p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === "number" && Number.isFinite(v));
function checkBundle(b) {
  const out = [];
  const err = (msg, ref) => out.push({ level: "error", msg, ref });
  const x = b;
  if (!x || typeof x !== "object") return [{ level: "error", msg: "Geen kaartdocument" }];
  if (x.format !== MAP_FORMAT) err(`Onbekend formaat (verwacht "${MAP_FORMAT}")`);
  if (x.schema !== MAP_SCHEMA) err(`Onbekende schemaversie ${x.schema} (verwacht ${MAP_SCHEMA})`);
  const n = x.network, p = x.park;
  if (!n || typeof n !== "object" || !n.nodes || !Array.isArray(n.roads) || !Array.isArray(n.gates)) {
    err("Wegennet ontbreekt of is onvolledig");
    return out;
  }
  if (!p || typeof p !== "object" || !Array.isArray(p.houses) || !Array.isArray(p.parkingClusters)) {
    err("Parkgegevens ontbreken of zijn onvolledig");
    return out;
  }
  if (!(p.metersPerPt > 0.2 && p.metersPerPt < 10)) err(`Schaal ${p.metersPerPt} m/pt is onwaarschijnlijk (0,2 - 10)`);
  if (!isPt(p.originPt) || !Array.isArray(p.viewPts) || p.viewPts.length !== 4) err("originPt of viewPts ongeldig");
  for (const [id, nd] of Object.entries(n.nodes)) if (!isPt(nd.pt)) err(`Knoop ${id}: ongeldige positie`, { kind: "node", id });
  const roadIds = /* @__PURE__ */ new Set();
  for (const r of n.roads) {
    if (roadIds.has(r.id)) err(`Weg-id ${r.id} komt dubbel voor`, { kind: "road", id: r.id });
    roadIds.add(r.id);
    if (!n.nodes[r.from] || !n.nodes[r.to]) err(`Weg ${r.id}: knoop ${!n.nodes[r.from] ? r.from : r.to} bestaat niet`, { kind: "road", id: r.id });
    if (r.from === r.to) err(`Weg ${r.id} begint en eindigt in dezelfde knoop`, { kind: "road", id: r.id });
    if (!Array.isArray(r.pts) || !r.pts.every(isPt)) err(`Weg ${r.id}: ongeldige tussenpunten`, { kind: "road", id: r.id });
    if (!["public", "arrival", "park", "service", "scenery"].includes(r.class)) err(`Weg ${r.id}: onbekende klasse ${r.class}`, { kind: "road", id: r.id });
    if (r.oneway !== void 0 && r.oneway !== "f" && r.oneway !== "b") err(`Weg ${r.id}: eenrichting moet 'f' of 'b' zijn`, { kind: "road", id: r.id });
    if (!(r.speedKmh > 0 && r.speedKmh <= 80)) err(`Weg ${r.id}: snelheid ${r.speedKmh} km/u buiten 1-80`, { kind: "road", id: r.id });
  }
  const gateIds = /* @__PURE__ */ new Set();
  for (const g of n.gates) {
    if (gateIds.has(g.id)) err(`Slagboom-id ${g.id} komt dubbel voor`, { kind: "gate", id: g.id });
    gateIds.add(g.id);
    const r = n.roads.find((q) => q.id === g.road);
    if (!r) err(`Slagboom ${g.id}: weg ${g.road} bestaat niet`, { kind: "gate", id: g.id });
    else if (r.oneway && r.oneway === "f" !== (g.lane === "forward")) err(`Slagboom ${g.id} staat op de rijstrook die op eenrichtingsweg ${r.id} niet bestaat`, { kind: "gate", id: g.id });
    if (!isPt(g.stopPt)) err(`Slagboom ${g.id}: ongeldige stopstreep`, { kind: "gate", id: g.id });
    if (!(Number.isInteger(g.queueSlots) && g.queueSlots >= 1 && g.queueSlots <= 12)) err(`Slagboom ${g.id}: opstelplaatsen moet 1-12 zijn`, { kind: "gate", id: g.id });
    if (!(g.slotSpacingM >= 5.5 && g.slotSpacingM <= 12)) err(`Slagboom ${g.id}: afstand opstelplaatsen moet 5,5-12 m zijn (auto 4,7 m + ruimte)`, { kind: "gate", id: g.id });
  }
  if (!n.gates.some((g) => g.direction === "inbound" && !g.staff) || !n.gates.some((g) => g.direction === "outbound" && !g.staff)) err("Er is minstens \xE9\xE9n inrij- en \xE9\xE9n uitrijslagboom voor bezoekers nodig");
  for (const g of n.gates) if (g.staff && n.roads.find((r) => r.id === g.road)?.class !== "service") err(`Personeelsslagboom ${g.id} moet op een dienstweg staan`, { kind: "gate", id: g.id });
  const nums = /* @__PURE__ */ new Map();
  for (const h of p.houses) {
    if (!isPt(h.pt)) err(`Huis ${h.number}: ongeldige positie`, { kind: "house", id: String(h.number) });
    nums.set(h.number, (nums.get(h.number) ?? 0) + 1);
    if (h.frontDeg !== void 0 && !Number.isFinite(h.frontDeg)) err(`Huis ${h.number}: ongeldige voorkant`, { kind: "house", id: String(h.number) });
    if (h.scale !== void 0 && !(h.scale >= 0.5 && h.scale <= 1.2)) err(`Huis ${h.number}: schaal moet 0,5-1,2 zijn`, { kind: "house", id: String(h.number) });
  }
  for (const [num, c] of nums) if (c > 1) err(`Huisnummer ${num} komt ${c} keer voor`, { kind: "house", id: String(num) });
  const clusterIds = /* @__PURE__ */ new Set();
  for (const c of p.parkingClusters) {
    if (clusterIds.has(c.id)) err(`Parkeercluster ${c.id} komt dubbel voor`, { kind: "parking", id: c.id });
    clusterIds.add(c.id);
    if (!isPt(c.pt)) err(`Parkeercluster ${c.id}: ongeldige positie`, { kind: "parking", id: c.id });
    if (!(Number.isInteger(c.stalls) && c.stalls >= 1 && c.stalls <= 40)) err(`Parkeercluster ${c.id}: aantal vakken 1-40`, { kind: "parking", id: c.id });
    for (const s of c.serves ?? []) if (!nums.has(s)) out.push({ level: "warn", msg: `Parkeercluster ${c.id} bedient huis ${s}, dat niet op de kaart staat`, ref: { kind: "parking", id: c.id } });
  }
  return out;
}
function checksum(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// src/server/mapstore.ts
var NET_FILE = "park_road_network.json";
var PARK_FILE = "park.json";
var MapError = class extends Error {
  constructor(status, code, message, problems = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.problems = problems;
  }
};
var MapStore = class {
  constructor(db, dir) {
    this.db = db;
    this.dir = dir;
    db.exec(`CREATE TABLE IF NOT EXISTS map_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, author TEXT NOT NULL, comment TEXT NOT NULL,
      checksum TEXT NOT NULL, parent INTEGER, bundle TEXT NOT NULL, errors INTEGER NOT NULL, warnings INTEGER NOT NULL, activated_at INTEGER)`);
  }
  worker;
  seq = 0;
  pending = /* @__PURE__ */ new Map();
  diagSeq = 0;
  /** The active map = the files in data/map, as a bundle (review state and version info live in park.json). */
  current() {
    const network = JSON.parse(readFileSync2(join2(this.dir, NET_FILE), "utf8"));
    const park = JSON.parse(readFileSync2(join2(this.dir, PARK_FILE), "utf8"));
    const review = park.editorReview ?? {};
    const active = park.editorVersion ?? null;
    delete park.editorReview;
    delete park.editorVersion;
    return { format: MAP_FORMAT, schema: MAP_SCHEMA, parentVersion: active?.id ?? null, network, park, review, activeVersion: active };
  }
  list() {
    return this.db.prepare("SELECT id, created_at, author, comment, checksum, parent, errors, warnings, activated_at FROM map_versions ORDER BY id DESC").all();
  }
  get(id) {
    const r = this.db.prepare("SELECT bundle FROM map_versions WHERE id = ?").get(id);
    if (!r) throw new MapError(404, "not_found", `Kaartversie ${id} bestaat niet`);
    return JSON.parse(r.bundle);
  }
  /** Save a new version (structural errors are refused; warnings are stored with the version). */
  save(input, comment, author = "admin") {
    const b = normalise(input);
    const problems = checkBundle(b);
    const errors = problems.filter((p) => p.level === "error");
    if (errors.length) throw new MapError(422, "invalid_map", `Kaart heeft ${errors.length} fout(en)`, errors);
    b.comment = String(comment ?? "").slice(0, 500);
    b.savedAt = (/* @__PURE__ */ new Date()).toISOString();
    const json = JSON.stringify(b);
    const info = this.db.prepare("INSERT INTO map_versions (created_at, author, comment, checksum, parent, bundle, errors, warnings) VALUES (?, ?, ?, ?, ?, ?, 0, ?)").run(Date.now(), author, b.comment, checksum(JSON.stringify({ n: b.network, p: b.park })), b.parentVersion ?? null, json, problems.filter((p) => p.level === "warn").length);
    return this.list().find((v) => v.id === Number(info.lastInsertRowid));
  }
  // ---------------------------------------------------------------- worker
  call(msg) {
    if (!this.worker) {
      const isTs = import.meta.url.endsWith(".ts");
      this.worker = new Worker(new URL(isTs ? "./mapworker-dev.mjs" : "./mapworker.mjs", import.meta.url));
      this.worker.on("message", (m) => {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (!this.pending.size) this.worker?.unref();
        if (m.error) p.fail(new MapError(m.error === "diag_expired" ? 409 : 500, m.error, m.error === "diag_expired" ? "Valideer de kaart opnieuw" : m.error));
        else p.ok(m.result);
      });
      this.worker.on("error", (e) => {
        for (const p of this.pending.values()) p.fail(e);
        this.pending.clear();
        this.worker = void 0;
      });
    }
    const id = ++this.seq;
    this.worker.ref();
    return new Promise((ok, fail) => {
      this.pending.set(id, { ok, fail });
      this.worker.postMessage({ ...msg, id });
    });
  }
  async diagnose(input) {
    const b = normalise(input);
    const diagId = `d${++this.diagSeq}`;
    const diag = await this.call({ op: "diagnose", diagId, bundle: b });
    return { ...diag, diagId };
  }
  route(diagId, house2) {
    return this.call({ op: "route", diagId, house: house2 });
  }
  close() {
    void this.worker?.terminate();
    this.worker = void 0;
  }
  /** Validate a saved version with the full network build and write it to data/map (atomic per file). */
  async activate(id) {
    const b = this.get(id);
    const diag = await this.diagnose(b);
    if (!diag.ok) throw new MapError(422, "map_has_errors", "Deze versie heeft fouten en kan niet actief worden", diag.problems.filter((p) => p.level === "error"));
    const row = this.list().find((v) => v.id === id);
    const park = { ...b.park, editorReview: b.review, editorVersion: { id, checksum: row.checksum, activatedAt: (/* @__PURE__ */ new Date()).toISOString() } };
    const write = (f, data) => {
      const p = join2(this.dir, f);
      writeFileSync(p + ".tmp", JSON.stringify(data, null, 1));
      renameSync(p + ".tmp", p);
    };
    write(NET_FILE, b.network);
    write(PARK_FILE, park);
    this.db.prepare("UPDATE map_versions SET activated_at = ? WHERE id = ?").run(Date.now(), id);
    return { bundle: b, diag };
  }
  exists() {
    return existsSync2(join2(this.dir, NET_FILE)) && existsSync2(join2(this.dir, PARK_FILE));
  }
};
function normalise(input) {
  const b = typeof input === "string" ? JSON.parse(input) : input;
  if (!b || typeof b !== "object") throw new MapError(422, "invalid_map", "Geen kaartdocument");
  const park = { ...b.park ?? {} };
  delete park.editorReview;
  delete park.editorVersion;
  return { format: b.format, schema: b.schema, parentVersion: b.parentVersion ?? null, comment: b.comment, savedAt: b.savedAt, network: b.network, park, review: b.review ?? {} };
}

// src/sim/traffic.ts
var P = {
  aMax: 1.4,
  bComf: 2,
  bMax: 7,
  T: 1.3,
  s0: 2.2,
  s0Stop: 0.35,
  s0Ped: 2.6,
  gapTime: 5,
  gapTimeEq: 3.5,
  grantTimeout: 15,
  reqMin: 8,
  look: 34,
  dt: 0.05
};
var TrafficSim = class {
  net;
  t = 0;
  vehicles = [];
  gates = /* @__PURE__ */ new Map();
  peds = [];
  buffer = [];
  stats;
  hooks;
  rand;
  pedSeq = 0;
  intents = /* @__PURE__ */ new Map();
  constructor(net, hooks, seed = 1) {
    this.net = net;
    this.hooks = hooks;
    this.rand = rng(seed);
    for (const g of net.gates.values()) this.gates.set(g.id, { id: g.id, phase: "CLOSED", since: 0, queue: [], passedFront: false });
    this.stats = { ticks: 0, collisions: 0, illegalGateCrossings: 0, wrongWay: 0, failsafeInterventions: 0, hardGateStops: 0, maxQueue: {}, gateCycles: {}, minHeadway: Infinity, publicRoadStopSeconds: 0, log: [] };
  }
  // ------------------------------------------------------------------ helpers
  edge(id) {
    const e = this.net.edges.get(id);
    if (!e) throw new Error(`unknown edge ${id}`);
    return e;
  }
  setRoute(v, route, s) {
    v.route = route;
    v.ri = 0;
    v.s = s;
    v.cum = [];
    let c = 0;
    for (const id of route) {
      v.cum.push(c);
      c += this.edge(id).line.length;
    }
  }
  pathPos(v) {
    return v.cum[v.ri] + v.s;
  }
  /** sample a point at absolute path distance d along v.route */
  pathSample(v, d) {
    let j = v.ri;
    while (j < v.route.length - 1 && d > v.cum[j] + this.edge(v.route[j]).line.length) j++;
    while (j > 0 && d < v.cum[j]) j--;
    const e = this.edge(v.route[j]);
    const s = d - v.cum[j];
    const p = e.line.sample(s);
    const t2 = e.line.tangent(clamp(s, 0, e.line.length), 0.6);
    return { x: p.x, y: p.y, tx: t2.x, ty: t2.y, edge: e, j, s };
  }
  pathEnd(v) {
    return v.cum[v.route.length - 1] + this.edge(v.route[v.route.length - 1]).line.length;
  }
  obbOf(v, x = v.x, y = v.y, h = v.heading) {
    return { cx: x, cy: y, ux: Math.cos(h), uy: Math.sin(h), hl: v.spec.len / 2, hw: v.spec.wid / 2 };
  }
  pose(v) {
    const e = this.edge(v.route[v.ri]);
    const p = e.line.sample(v.s);
    const t2 = e.line.tangent(clamp(v.s, 0, e.line.length), 0.7);
    let h = Math.atan2(t2.y, t2.x);
    if (e.reverseMotion) h += Math.PI;
    return { x: p.x, y: p.y, h };
  }
  log(msg) {
    this.stats.log.push(`[t=${this.t.toFixed(1)}] ${msg}`);
    if (this.stats.log.length > 400) this.stats.log.shift();
  }
  emit(type, payload) {
    this.hooks.onEvent?.(type, { ...payload, simTime: +this.t.toFixed(2) });
  }
  /** Number of vehicles that will still need the given gate (spawned, not yet passed) plus buffered ones dispatched to it. */
  gateReservations(gateId) {
    let n = 0;
    for (const v of this.vehicles) if (v.state !== "despawned" && "gateId" in v.mission && v.mission.gateId === gateId && !v.passedGates.includes(gateId) && v.state !== "parked") n++;
    return n;
  }
  // ------------------------------------------------------------------ spawning
  /** Queue an arrival in the abstract off-screen approach buffer. It is released only when the inbound queue has room. */
  enqueueArrival(spec, mission, portal, readyAt = this.t) {
    this.buffer.push({ spec, mission, portal, readyAt });
    this.emit("vehicle.buffered", { vehicleId: spec.id, bookingId: "bookingId" in mission ? mission.bookingId : void 0 });
  }
  trySpawnFromBuffer() {
    for (let i = 0; i < this.buffer.length; i++) {
      const b = this.buffer[i];
      if (b.readyAt > this.t) continue;
      const portal = this.net.portals.get(b.portal);
      if (!portal?.spawnEdge) continue;
      if ("gateId" in b.mission) {
        const g = this.net.gates.get(b.mission.gateId);
        if (this.gateReservations(g.id) >= g.queueSlots) continue;
      }
      const route = this.planBest([portal.spawnEdge], this.destinations(b.mission), b.mission, b.spec);
      if (!route) {
        this.log(`geen legale route voor ${b.spec.id} vanaf ${b.portal}; wacht buiten beeld`);
        continue;
      }
      const veh = this.makeVehicle(b.spec, b.mission, route, b.spec.len / 2 + 0.5);
      const box = this.obbOf(veh);
      if (this.vehicles.some((o) => o.state !== "despawned" && dist(o, veh) < 14 && obbOverlap(box, this.obbOf(o), 2))) continue;
      this.buffer.splice(i, 1);
      i--;
      this.vehicles.push(veh);
      this.emit("vehicle.arrived", { vehicleId: veh.spec.id, kind: veh.spec.kind, portal: b.portal, bookingId: "bookingId" in b.mission ? b.mission.bookingId : void 0 });
      break;
    }
  }
  makeVehicle(spec, mission, route, s) {
    const v = {
      spec,
      state: "driving",
      mission,
      route: [],
      cum: [],
      ri: 0,
      s: 0,
      v: 0,
      a: 0,
      x: 0,
      y: 0,
      heading: 0,
      grants: {},
      passedGates: [],
      signal: 0,
      brake: false,
      spawnedAt: this.t
    };
    this.setRoute(v, route, s);
    const p = this.pose(v);
    v.x = p.x;
    v.y = p.y;
    v.heading = p.h;
    v.v = 3;
    return v;
  }
  /** Shortest legal route; a visitor mission with a gate is routed THROUGH that gate (the park has two accesses). */
  planRoute(from, to, m, spec) {
    const opts = { uturn: spec.model === "golfcart" };
    const gate = "gateId" in m ? this.net.gates.get(m.gateId) : void 0;
    if (!gate) return findRoute(this.net, from, to, spec.kind, opts);
    const a = findRoute(this.net, from, gate.edge, spec.kind, opts);
    const b = a ? findRoute(this.net, gate.edge, to, spec.kind, opts) : null;
    return a && b ? [...a, ...b.slice(1)] : null;
  }
  routeLength(route) {
    return route.reduce((n, id) => n + this.edge(id).line.length, 0);
  }
  /** possible final edges: every way into the stall (from this side or turning in from the opposite lane), or the exit */
  destinations(m) {
    const stall = (id) => this.net.stalls.get(id)?.inEdges ?? [];
    const exit = (id) => {
      const e = this.net.portals.get(id)?.despawnEdge;
      return e ? [e] : [];
    };
    if (m.type === "arrive") return stall(m.stallId);
    if (m.type === "depart") return exit(m.portal);
    if (m.type === "service") return m.stallId ? stall(m.stallId) : exit(m.exitPortal);
    return [];
  }
  /** shortest legal route over all start / end alternatives (e.g. leaving a stall to the left or to the right) */
  planBest(froms, tos, m, spec) {
    let best = null, bestLen = Infinity;
    for (const f of froms) for (const t2 of tos) {
      const r = this.planRoute(f, t2, m, spec);
      if (!r) continue;
      const len = this.routeLength(r);
      if (len < bestLen) {
        best = r;
        bestLen = len;
      }
    }
    return best;
  }
  /** Place a vehicle already parked in a stall (initial occupancy / restore). */
  placeParked(spec, mission, stallId) {
    const st = this.net.stalls.get(stallId);
    const v = this.makeVehicle(spec, mission, [st.inEdge], st.parkS);
    v.v = 0;
    v.state = "parked";
    this.vehicles.push(v);
    return v;
  }
  stallOccupant(stallId) {
    const st = this.net.stalls.get(stallId);
    const ins = st.inEdges, outs = st.outEdges;
    return this.vehicles.find((v) => v.state !== "despawned" && (v.route.some((e) => ins.includes(e)) || outs.includes(v.route[v.ri])) && (v.state === "parked" || v.state === "dwell" || ins.includes(v.route[v.ri]) || outs.includes(v.route[v.ri]) || ins.includes(v.route[v.route.length - 1])));
  }
  /** Start a departure for a parked vehicle. Waits (parked) until the outbound queue has capacity. */
  requestDeparture(vehicleId, mission) {
    const v = this.vehicles.find((x) => x.spec.id === vehicleId);
    if (!v || v.state !== "parked") return false;
    v.mission = mission;
    v.departPending = true;
    return true;
  }
  /** does a parked / dwelling vehicle stand in the swept path of this out-manoeuvre (first 14 m)? */
  outBlocked(v, edgeId) {
    const e = this.edge(edgeId);
    const others = this.vehicles.filter((o) => o !== v && (o.state === "parked" || o.state === "dwell") && Math.abs(o.x - v.x) < 25 && Math.abs(o.y - v.y) < 25);
    if (!others.length) return false;
    const st = e.stallId ? this.net.stalls.get(e.stallId) : void 0;
    for (let s0 = st && e.kind === "reverse" ? st.parkBack : 0; s0 <= Math.min(e.line.length, 14); s0 += 0.5) {
      const p = e.line.sample(s0), t2 = e.line.tangent(clamp(s0, 0, e.line.length), 0.7);
      const h = Math.atan2(t2.y, t2.x) + (e.reverseMotion ? Math.PI : 0);
      const box = this.obbOf(v, p.x, p.y, h);
      if (others.some((o) => obbOverlap(box, this.obbOf(o), 0.1))) return true;
    }
    return false;
  }
  startPendingDepartures() {
    for (const v of this.vehicles) {
      if (!v.departPending || v.state !== "parked" || (v.boarding ?? 0) > 0) continue;
      const m = v.mission;
      if ("gateId" in m) {
        const g = this.net.gates.get(m.gateId);
        if (this.gateReservations(g.id) >= g.queueSlots) {
          v.lastWaitReason = "uitgaande wachtrij vol";
          continue;
        }
      }
      const curEdge = this.edge(v.route[v.ri]);
      const st = curEdge.stallId ? this.net.stalls.get(curEdge.stallId) : null;
      if (!st) continue;
      const outs = st.outEdges.filter((id) => !((v.avoidOut?.[id] ?? 0) > this.t) && !this.outBlocked(v, id));
      if (!outs.length) {
        v.lastWaitReason = "uitrijbaan geblokkeerd";
        continue;
      }
      const route = this.planBest(outs, this.destinations(m), m, v.spec);
      if (!route) {
        v.lastWaitReason = "geen legale route";
        continue;
      }
      const sOnRev = st.parkBack;
      v.departPending = false;
      this.setRoute(v, route, sOnRev);
      v.state = "driving";
      v.v = 0;
      v.switchUntil = this.t + 1;
      this.emit("vehicle.departing", { vehicleId: v.spec.id, bookingId: "bookingId" in m ? m.bookingId : void 0, stallId: st.id });
    }
  }
  // ------------------------------------------------------------------ main step
  step(dt = P.dt) {
    this.t += dt;
    this.stats.ticks++;
    this.trySpawnFromBuffer();
    this.startPendingDepartures();
    this.collectIntents();
    const active = this.vehicles.filter((v) => v.state === "driving" || v.state === "dwell");
    for (const v of active) this.stepVehicle(v, dt);
    this.stepGates();
    this.stepPedestrians(dt);
    this.monitor(dt);
    this.vehicles = this.vehicles.filter((v) => v.state !== "despawned");
  }
  // upcoming zone members along the path within the horizon
  upcomingMembers(v, horizon) {
    const pos = this.pathPos(v);
    const out = [];
    for (let j = v.ri; j < v.route.length; j++) {
      if (v.cum[j] - pos > horizon) break;
      const list = this.net.zonesByEdge.get(v.route[j]);
      if (!list) continue;
      for (const { zone, member } of list) {
        const entry = v.cum[j] + member.s0, exit = v.cum[j] + member.s1;
        if (exit + v.spec.len / 2 < pos) continue;
        out.push({ zone, member, entry, exit, j });
      }
    }
    out.sort((a, b) => a.entry - b.entry);
    return out;
  }
  collectIntents() {
    this.intents.clear();
    for (const v of this.vehicles) {
      if (v.state !== "driving") continue;
      const pos = this.pathPos(v), lead = pos + v.spec.len / 2;
      for (const u of this.upcomingMembers(v, 45)) {
        const key = `${u.zone.id}|${u.member.stream}`;
        const entryDist = u.entry - lead;
        const list = this.intents.get(u.zone.id) ?? this.intents.set(u.zone.id, []).get(u.zone.id);
        if (list.some((x) => x.veh === v && x.stream === u.member.stream)) continue;
        list.push({ veh: v, stream: u.member.stream, prio: u.member.prio, entry: entryDist, eta: entryDist / Math.max(v.v, 0.5), granted: !!v.grants[key] });
      }
    }
  }
  conflicts(z, a, b) {
    return a !== b && (z.exclusive.has(a) || z.exclusive.has(b));
  }
  occupies(v, m, margin = 0.9) {
    const b = this.obbOf(v);
    const hl = b.hl + margin, hw = b.hw + margin;
    for (const p of m.samples) {
      const dx = p.x - b.cx, dy = p.y - b.cy;
      if (Math.abs(dx * b.ux + dy * b.uy) <= hl && Math.abs(-dx * b.uy + dy * b.ux) <= hw) return true;
    }
    return false;
  }
  canGrant(v, z, stream, prio, myEntry) {
    for (const o of this.vehicles) {
      if (o === v || o.state === "despawned") continue;
      if (o.v < 0.05 && o.waitStart !== void 0 && this.t - o.waitStart > 4 && this.waitsOn(o, v)) continue;
      for (const key of Object.keys(o.grants)) {
        const [zid, st] = splitKey(key);
        if (zid === z.id && (z.single || this.conflicts(z, st, stream))) return { ok: false, why: `wacht op ${o.spec.id}` };
      }
    }
    const waited = v.waitStart !== void 0 ? this.t - v.waitStart : 0;
    const mine = z.approachDir[stream], myPos = z.approachPos[stream];
    for (const it of this.intents.get(z.id) ?? []) {
      if (it.veh === v || it.granted || !this.conflicts(z, it.stream, stream)) continue;
      const o = it.veh;
      const stopDist = o.v * o.v / (2 * 4) + 1;
      if (o.v > 1.2 && it.entry < stopDist && it.entry > -o.spec.len) return { ok: false, why: `${o.spec.id} kan niet meer stoppen` };
      if (it.prio > prio && it.eta < P.gapTime && waited < 30) return { ok: false, why: `voorrang voor ${o.spec.id}` };
      if (it.prio === prio && it.eta < P.gapTimeEq && waited < 12) {
        const od = z.approachDir[it.stream], op = z.approachPos[it.stream];
        if (mine && od && myPos && op) {
          const rel = { x: op.x - myPos.x, y: op.y - myPos.y };
          const fromRight = cross(mine, rel) > 0.5;
          if (fromRight) return { ok: false, why: `rechts heeft voorrang (${o.spec.id})` };
          if (Math.abs(cross(mine, rel)) <= 0.5 && o.spec.id < v.spec.id && it.entry < myEntry) return { ok: false, why: `eerst ${o.spec.id}` };
        }
      }
    }
    return { ok: true };
  }
  stepVehicle(v, dt) {
    const e0 = this.edge(v.route[v.ri]);
    const pos = this.pathPos(v);
    const L = v.spec.len;
    const lead = pos + L / 2;
    const end = this.pathEnd(v);
    let aMin = Infinity;
    let why = "";
    const idm = (gap, vObj, s0, label) => {
      const vv = v.v;
      const sStar = s0 + Math.max(0, vv * P.T + vv * (vv - vObj) / (2 * Math.sqrt(P.aMax * P.bComf)));
      const a2 = gap <= 0.02 ? -P.bMax : -P.aMax * (sStar / gap) ** 2;
      if (a2 < aMin) {
        aMin = a2;
        why = label;
      }
    };
    if (v.state === "dwell") {
      if (v.dwellUntil !== void 0 && this.t >= v.dwellUntil) this.finishDwell(v);
      return;
    }
    if (v.switchUntil !== void 0 && this.t < v.switchUntil) {
      v.v = 0;
      v.a = 0;
      v.brake = true;
      return;
    }
    if (v.retreat || e0.kind === "reverse" && e0.stallId && v.ri === 0 && v.v < 0.05 && v.waitStart !== void 0 && this.t - v.waitStart > 6 && this.blockedByParked(v)) {
      const st = this.net.stalls.get(e0.stallId);
      if (!v.retreat) {
        v.retreat = true;
        v.switchUntil = this.t + 0.9;
        this.log(`${v.spec.id} rijdt terug het vak in (uitrijden geblokkeerd)`);
        return;
      }
      const sNew = Math.max(st.parkBack, v.s - 0.8 * dt);
      const old = v.s;
      v.s = sNew;
      const p2 = this.pose(v);
      const box2 = this.obbOf(v, p2.x, p2.y, p2.h);
      if (this.vehicles.some((o) => o !== v && o.state !== "despawned" && o.state !== "buffer" && Math.abs(o.x - p2.x) < 12 && Math.abs(o.y - p2.y) < 12 && obbOverlap(box2, this.obbOf(o), 0.05))) {
        v.s = old;
        v.v = 0;
        return;
      }
      v.x = p2.x;
      v.y = p2.y;
      v.heading = p2.h;
      v.v = 0.8;
      v.brake = false;
      v.lastWaitReason = "terug het vak in";
      if (v.s <= st.parkBack + 1e-6) {
        v.retreat = false;
        v.v = 0;
        v.state = "parked";
        v.waitStart = void 0;
        v.avoidOut = { ...v.avoidOut ?? {}, [e0.id]: this.t + 120 };
        for (const k of Object.keys(v.grants)) delete v.grants[k];
        v.departPending = true;
      }
      return;
    }
    if (v.ri < v.route.length - 1 && v.s >= e0.line.length - 0.02 && this.edge(v.route[v.ri + 1]).reverseMotion !== e0.reverseMotion) {
      v.ri++;
      v.s = 0;
      v.v = 0;
      v.switchUntil = this.t + 0.9;
      return;
    }
    let v0 = Infinity;
    for (let x = 0; x <= Math.min(P.look, end - pos + 1); x += 1) {
      const sm = this.pathSample(v, pos + x);
      const vm = sm.edge.vmax[Math.max(0, Math.min(sm.edge.vmax.length - 1, Math.round(sm.s)))];
      const allowed = Math.sqrt(vm * vm + 2 * P.bComf * Math.max(0, x - 2));
      if (allowed < v0) v0 = allowed;
    }
    v0 = Math.max(0.6, v0);
    const aFree = P.aMax * (1 - (v.v / v0) ** 4);
    if (v.ri < v.route.length - 1) {
      const nxt = this.edge(v.route[v.ri + 1]);
      if (nxt.reverseMotion !== e0.reverseMotion) {
        const endCentre = v.cum[v.ri] + e0.line.length;
        idm(endCentre - pos + 0.05, 0, 0.05, "richtingswissel");
      }
    }
    const finalEdge = this.edge(v.route[v.route.length - 1]);
    let destCentre = null;
    if (finalEdge.kind === "driveway") {
      const st = this.net.stalls.get(finalEdge.stallId);
      destCentre = v.cum[v.route.length - 1] + finalEdge.line.length - st.parkBack;
      idm(destCentre - pos + P.s0Stop, 0, P.s0Stop, "bestemming");
    }
    for (const g of this.net.gates.values()) {
      const j = v.route.indexOf(g.edge, v.ri);
      if (j < 0 || v.passedGates.includes(g.id)) continue;
      const gs = this.gates.get(g.id);
      const stopAbs = v.cum[j] + g.stopS;
      const authorized = gs.phase === "OPEN" && gs.authorizedVehicle === v.spec.id;
      if (!authorized) {
        if (lead <= stopAbs + 0.3) idm(stopAbs - lead, 0, P.s0Stop, `slagboom ${g.id} dicht`);
        if (v.queue && v.queue.gateId === g.id) {
          const slotCentre = v.cum[j] + g.slotS[Math.min(v.queue.slot, g.slotS.length - 1)];
          idm(slotCentre - pos + P.s0Stop, 0, P.s0Stop, `wachtrij plek ${v.queue.slot + 1}`);
        }
      }
    }
    const sweep = this.sweep(v, pos, Math.min(P.look, end - pos + L));
    const members = this.upcomingMembers(v, 45);
    const reqDist = Math.max(P.reqMin, v.v * v.v / (2 * P.bComf) + 6);
    const pending = /* @__PURE__ */ new Map();
    for (const u of members) {
      const key = `${u.zone.id}|${u.member.stream}`;
      if (v.grants[key]) continue;
      const entryLead = u.entry - lead;
      if (entryLead > reqDist) continue;
      if (sweep && !sweep.ped && sweep.gap < entryLead - 0.3) continue;
      const gkey = `${u.j}`;
      (pending.get(gkey) ?? pending.set(gkey, []).get(gkey)).push(u);
    }
    const groups = [...pending.values()].sort((a2, b) => a2[0].entry - b[0].entry);
    for (const grp of groups) {
      let ok = true, reason = "";
      for (const u of grp) {
        const r = this.canGrant(v, u.zone, u.member.stream, u.member.prio, u.entry - lead);
        if (!r.ok) {
          ok = false;
          reason = r.why ?? "";
          break;
        }
      }
      if (ok) {
        const ej = this.edge(v.route[grp[0].j]);
        if (ej.kind === "connector") {
          const exitCentre = v.cum[grp[0].j] + ej.line.length + L / 2 + 1.5;
          if (exitCentre < end && this.blockedAt(v, exitCentre)) {
            ok = false;
            reason = "uitgang kruising bezet";
          }
        }
      }
      if (ok) {
        for (const u of grp) v.grants[`${u.zone.id}|${u.member.stream}`] = { since: this.t, entered: false };
      } else {
        const entryLead = Math.min(...grp.map((u) => u.entry)) - lead;
        idm(entryLead - 0.6, 0, P.s0Stop, reason || "voorrang");
        break;
      }
    }
    if (sweep) idm(sweep.gap, sweep.vObj, sweep.ped ? P.s0Ped : P.s0, sweep.label);
    let a = Math.min(aFree, aMin === Infinity ? aFree : aFree + aMin);
    if (aMin !== Infinity && aFree + aMin < a) a = aFree + aMin;
    a = clamp(a, -P.bMax, P.aMax);
    let vNew = Math.max(0, v.v + a * dt);
    let ds = (v.v + vNew) / 2 * dt;
    for (const g of this.net.gates.values()) {
      const j = v.route.indexOf(g.edge, v.ri);
      if (j < 0 || v.passedGates.includes(g.id)) continue;
      const gs = this.gates.get(g.id);
      if (gs.phase === "OPEN" && gs.authorizedVehicle === v.spec.id) continue;
      const stopAbs = v.cum[j] + g.stopS;
      if (lead <= stopAbs && lead + ds > stopAbs - 0.02) {
        ds = Math.max(0, stopAbs - 0.02 - lead);
        vNew = 0;
        if (v.v > 0.5) {
          this.stats.hardGateStops++;
          this.log(`harde stop voor ${g.id}: ${v.spec.id} v=${v.v.toFixed(2)}`);
        }
      }
    }
    if (destCentre !== null && pos + ds > destCentre) {
      ds = Math.max(0, destCentre - pos);
      vNew = 0;
    }
    if (v.ri < v.route.length - 1 && this.edge(v.route[v.ri + 1]).reverseMotion !== e0.reverseMotion) {
      const endCentre = v.cum[v.ri] + e0.line.length;
      if (pos + ds > endCentre) {
        ds = Math.max(0, endCentre - pos);
        vNew = 0;
      }
    }
    const oldRi = v.ri, oldS = v.s;
    this.advance(v, ds);
    const p = this.pose(v);
    const box = this.obbOf(v, p.x, p.y, p.h);
    let blocked = null;
    for (const o of this.vehicles) {
      if (o === v || o.state === "despawned" || o.state === "buffer") continue;
      if (Math.abs(o.x - p.x) > 12 || Math.abs(o.y - p.y) > 12) continue;
      if (obbOverlap(box, this.obbOf(o), 0.05)) {
        blocked = o;
        break;
      }
    }
    if (blocked && ds > 0) {
      v.ri = oldRi;
      v.s = oldS;
      vNew = 0;
      ds = 0;
      this.stats.failsafeInterventions++;
      if (this.stats.failsafeInterventions < 60) this.log(`failsafe: ${v.spec.id} stopt voor ${blocked.spec.id} (${why})`);
    } else {
      v.x = p.x;
      v.y = p.y;
      v.heading = p.h;
    }
    v.a = ds > 0 || vNew > 0 ? a : Math.min(a, 0);
    v.v = vNew;
    v.brake = a < -0.5 || v.v < 0.2 && aMin !== Infinity;
    v.lastWaitReason = v.v < 0.2 ? why : void 0;
    if (v.v < 0.2) {
      if (v.waitStart === void 0) v.waitStart = this.t;
    } else v.waitStart = void 0;
    v.signal = 0;
    const curE = this.edge(v.route[v.ri]);
    if (!curE.reverseMotion) {
      const p0 = this.pathPos(v) + v.spec.len / 2;
      for (let j = v.ri; j < v.route.length; j++) {
        if (v.cum[j] - p0 > 30) break;
        const e = this.edge(v.route[j]);
        if (j === v.ri && e.kind !== "connector" && e.kind !== "driveway") continue;
        if (e.kind === "driveway") {
          const a2 = e.line.tangent(0, 1), b = e.line.tangent(e.line.length, 1);
          v.signal = Math.sign(Math.atan2(cross(a2, b), a2.x * b.x + a2.y * b.y)) || 1;
          break;
        }
        if (e.kind === "connector") {
          if (v.cum[j] + e.line.length < p0 - v.spec.len) continue;
          const a2 = e.line.tangent(0, 1), b = e.line.tangent(e.line.length, 1);
          const ang = Math.atan2(cross(a2, b), a2.x * b.x + a2.y * b.y);
          if (Math.abs(ang) > 0.5) v.signal = Math.sign(ang);
          break;
        }
      }
    }
    this.afterMove(v);
  }
  /** Is there a (slow) vehicle occupying the path position `d` (vehicle centre) of v? */
  blockedAt(v, d) {
    const sm = this.pathSample(v, d);
    const h = Math.atan2(sm.ty, sm.tx);
    const box = this.obbOf(v, sm.x, sm.y, h);
    return this.vehicles.some((o) => o !== v && o.state !== "despawned" && obbOverlap(box, this.obbOf(o), 0.4) && o.v < 1.5);
  }
  /** Safety margin of the forward sweep against o. Two stopped vehicles that each see the other in their swept path
   *  (e.g. a car turning into a stall whose nose comes within the margin of a passing van) would wait forever; after
   *  3 s one of them (fixed order), and after 6 s the other, may creep on with a small margin. Real overlap stays
   *  forbidden: the probe still has to be clear of o's body. */
  /** does o (directly or through a short chain of stopped vehicles) wait for v? (wait-for cycle = deadlock) */
  waitsOn(o, v, depth = 5) {
    let cur = o;
    const seen = /* @__PURE__ */ new Set();
    for (let i = 0; i < depth && cur && !seen.has(cur); i++) {
      seen.add(cur);
      const r = cur.lastWaitReason;
      if (!r || cur.v > 0.05) return false;
      if (r.includes(v.spec.id)) return true;
      const me = cur;
      cur = this.vehicles.find((x) => x !== me && x.state !== "despawned" && (r.endsWith(x.spec.id) || r.includes(`${x.spec.id})`)));
    }
    return false;
  }
  /** stopped behind a vehicle that is parked or dwelling (it will not move away) */
  blockedByParked(v) {
    const r = v.lastWaitReason;
    if (!r?.startsWith("achter ")) return false;
    const o = this.vehicles.find((x) => x.spec.id === r.slice(7));
    return !!o && (o.state === "parked" || o.state === "dwell");
  }
  mutualMargin(v, o) {
    if (v.v > 0.2 || o.v > 0.2 || v.waitStart === void 0 || v.lastWaitReason !== `achter ${o.spec.id}`) return 0.22;
    const waited = this.t - v.waitStart;
    if (o.lastWaitReason === `achter ${v.spec.id}`) return waited > (v.spec.id < o.spec.id ? 3 : 6) ? 0.07 : 0.22;
    if (o.lastWaitReason?.includes(v.spec.id)) return waited > 3 ? 0.07 : 0.22;
    return 0.22;
  }
  sweep(v, pos, look) {
    const cand = this.vehicles.filter((o) => o !== v && o.state !== "despawned" && Math.abs(o.x - v.x) < look + 8 && Math.abs(o.y - v.y) < look + 8);
    const peds = this.peds.filter((p) => p.state !== "done" && Math.abs(p.x - v.x) < look + 4 && Math.abs(p.y - v.y) < look + 4);
    if (!cand.length && !peds.length) return null;
    const end = this.pathEnd(v);
    for (let x = 0.4; x <= look; x += 0.5) {
      if (pos + x > end + 0.01) break;
      const sm = this.pathSample(v, pos + x);
      const h = Math.atan2(sm.ty, sm.tx);
      const probe = { cx: sm.x, cy: sm.y, ux: Math.cos(h), uy: Math.sin(h), hl: v.spec.len / 2, hw: v.spec.wid / 2 };
      for (const o of cand) {
        const ob = this.obbOf(o);
        if (obbOverlap(probe, ob, this.mutualMargin(v, o))) {
          const along = o.v * (Math.cos(o.heading) * sm.tx + Math.sin(o.heading) * sm.ty) * (this.edge(o.route[o.ri]).reverseMotion ? -1 : 1);
          return { gap: Math.max(0, x - 0.4), vObj: Math.max(0, along), label: `achter ${o.spec.id}`, ped: false };
        }
      }
      for (const p of peds) {
        const pb = { cx: p.x, cy: p.y, ux: 1, uy: 0, hl: 0.35, hw: 0.35 };
        if (obbOverlap(probe, pb, 0.5)) return { gap: Math.max(0, x - 0.4), vObj: 0, label: `voetganger ${p.name}`, ped: true };
      }
    }
    return null;
  }
  advance(v, ds) {
    v.s += ds;
    while (v.ri < v.route.length - 1 && v.s > this.edge(v.route[v.ri]).line.length) {
      const prev = this.edge(v.route[v.ri]);
      v.s -= prev.line.length;
      v.ri++;
      const ne = this.edge(v.route[v.ri]);
      if (ne.reverseMotion !== prev.reverseMotion) v.switchUntil = this.t + 0.9;
    }
  }
  afterMove(v) {
    const pos = this.pathPos(v), lead = pos + v.spec.len / 2;
    for (const key of Object.keys(v.grants)) {
      const [zid, st] = splitKey(key);
      const g = v.grants[key];
      const z = this.net.zones.find((zz) => zz.id === zid);
      const mem = z.members.filter((m) => m.stream === st);
      const occ = mem.some((m) => this.occupies(v, m));
      if (occ) g.entered = true;
      else if (g.entered) delete v.grants[key];
      else if (this.t - g.since > P.grantTimeout) {
        delete v.grants[key];
        this.log(`grant timeout ${v.spec.id} ${key}`);
      }
    }
    for (const g of this.net.gates.values()) {
      if (v.passedGates.includes(g.id)) continue;
      const j = v.route.indexOf(g.edge);
      if (j < 0 || v.ri < j) continue;
      const gs = this.gates.get(g.id);
      if (!v.queue && v.ri === j) {
        const slot = gs.queue.length;
        gs.queue.push(v.spec.id);
        v.queue = { gateId: g.id, slot };
        this.stats.maxQueue[g.id] = Math.max(this.stats.maxQueue[g.id] ?? 0, gs.queue.length);
        this.emit("vehicle.queued", { vehicleId: v.spec.id, gateId: g.id, slot: slot + 1, bookingId: "bookingId" in v.mission ? v.mission.bookingId : void 0 });
        this.emit("queue.updated", { gateId: g.id, queue: [...gs.queue] });
        this.hooks.onQueued?.(v, g, slot);
      }
      const stopAbs = v.cum[j] + g.stopS;
      if (v.queue && !v.queue.atGate && gs.queue[0] === v.spec.id && stopAbs - lead < 3 && v.v < 0.4) {
        v.queue.atGate = true;
        this.emit("vehicle.at_gate", { vehicleId: v.spec.id, gateId: g.id });
        this.hooks.onAtGate?.(v, g);
      }
      if (lead > stopAbs) {
        const legal = gs.phase === "OPEN" && gs.authorizedVehicle === v.spec.id;
        if (!legal) {
          this.stats.illegalGateCrossings++;
          this.log(`ILLEGALE PASSAGE ${v.spec.id} bij ${g.id} (fase ${gs.phase})`);
        }
        v.passedGates.push(g.id);
        if (gs.queue[0] === v.spec.id) gs.queue.shift();
        else gs.queue = gs.queue.filter((id) => id !== v.spec.id);
        v.queue = void 0;
        gs.passedFront = true;
        for (const id of gs.queue) {
          const o = this.vehicles.find((x) => x.spec.id === id);
          if (o?.queue) o.queue.slot = gs.queue.indexOf(id);
        }
        this.emit("queue.updated", { gateId: g.id, queue: [...gs.queue] });
        this.emit("vehicle.passed_gate", { vehicleId: v.spec.id, gateId: g.id });
      }
    }
    const finalEdge = this.edge(v.route[v.route.length - 1]);
    if (v.ri === v.route.length - 1) {
      if (finalEdge.kind === "driveway") {
        const st = this.net.stalls.get(finalEdge.stallId);
        if (v.v < 0.05 && Math.abs(v.s - (finalEdge.line.length - st.parkBack)) < 0.25) {
          if (v.mission.type === "service" && v.mission.job === "return") {
            v.state = "parked";
            this.emit("vehicle.parked", { vehicleId: v.spec.id, stallId: st.id, depot: true });
          } else if (v.mission.type === "service") {
            v.state = "dwell";
            v.dwellUntil = v.mission.dwellSec === void 0 ? this.t + 30 : v.mission.dwellSec < 0 ? Infinity : this.t + v.mission.dwellSec;
            this.emit("vehicle.service_stop", { vehicleId: v.spec.id, stallId: st.id, houseNumber: v.mission.houseNumber });
          } else {
            v.state = "parked";
            this.emit("vehicle.parked", { vehicleId: v.spec.id, stallId: st.id, houseNumber: st.houseNumber, bookingId: "bookingId" in v.mission ? v.mission.bookingId : void 0 });
            this.hooks.onParked?.(v);
          }
          for (const k2 of Object.keys(v.grants)) delete v.grants[k2];
        }
      } else if (v.s >= finalEdge.line.length - 0.1 && finalEdge.to.startsWith("P_")) {
        v.state = "despawned";
        this.emit("vehicle.exited", { vehicleId: v.spec.id, portal: finalEdge.to, bookingId: "bookingId" in v.mission ? v.mission.bookingId : void 0 });
        this.hooks.onExited?.(v);
      }
    }
  }
  /** End an (open-ended) service stop: the vehicle leaves its stall on a new mission. */
  releaseDwell(vehicleId, mission) {
    const v = this.vehicles.find((x) => x.spec.id === vehicleId);
    if (!v || v.state !== "dwell" && v.state !== "parked") return false;
    v.dwellUntil = void 0;
    v.state = "parked";
    v.mission = mission;
    v.departPending = true;
    return true;
  }
  finishDwell(v) {
    if (v.mission.type !== "service") return;
    if (v.mission.job === "repair") return;
    const m = v.mission;
    const e = this.edge(v.route[v.ri]);
    v.dwellUntil = void 0;
    v.state = "parked";
    v.mission = { type: "service", job: "patrol", exitPortal: m.exitPortal };
    if (e.stallId) v.departPending = true;
  }
  // ------------------------------------------------------------------ gates
  stepGates() {
    for (const g of this.net.gates.values()) {
      const gs = this.gates.get(g.id);
      const el = this.t - gs.since;
      const crossBox = {
        cx: g.stopPoint.x + g.laneDir.x * g.crossLen / 2,
        cy: g.stopPoint.y + g.laneDir.y * g.crossLen / 2,
        ux: g.laneDir.x,
        uy: g.laneDir.y,
        hl: g.crossLen / 2 + 0.3,
        hw: 1.5
      };
      const crossingOccupied = () => this.vehicles.some((o) => o.state !== "despawned" && obbOverlap(crossBox, this.obbOf(o), 0));
      const set = (phase, ev) => {
        gs.phase = phase;
        gs.since = this.t;
        gs.lastEvent = ev;
        this.emit(ev, { gateId: g.id, vehicleId: gs.authorizedVehicle, passageId: gs.passageId });
      };
      if (gs.phase === "CLOSED") {
        const headId = gs.queue[0];
        const head = headId ? this.vehicles.find((x) => x.spec.id === headId) : void 0;
        if (head && head.state === "driving") {
          const j = head.route.indexOf(g.edge);
          const lead = this.pathPos(head) + head.spec.len / 2;
          const atLine = j >= 0 && head.ri === j && g.stopS - lead < 1.4 && head.v < 0.3;
          if (atLine) {
            const passage = g.staff ? head.spec.kind === "service" ? this.hooks.servicePass?.(head.spec.id, g.id) ?? null : null : this.hooks.consumeToken(head.spec.id, g.id) ?? (head.spec.kind === "service" ? this.hooks.servicePass?.(head.spec.id, g.id) ?? null : null);
            if (passage) {
              gs.authorizedVehicle = head.spec.id;
              gs.passageId = passage;
              gs.passedFront = false;
              this.emit("gate.pass_authorized", { gateId: g.id, vehicleId: head.spec.id, passageId: passage });
              set("OPENING", "gate.opening");
            }
          }
        }
      } else if (gs.phase === "OPENING") {
        if (el >= g.openSec) set("OPEN", "gate.opened");
      } else if (gs.phase === "OPEN") {
        const av = this.vehicles.find((x) => x.spec.id === gs.authorizedVehicle);
        const cleared = !av || av.passedGates.includes(g.id) && (() => {
          const j = av.route.indexOf(g.edge);
          const centre = j >= 0 && av.ri === j ? av.s : Infinity;
          return av.ri > j || centre - av.spec.len / 2 > g.stopS + g.crossLen + 0.4;
        })();
        if (cleared && !crossingOccupied()) {
          this.hooks.onPassageDone?.(gs.passageId, "completed");
          this.stats.gateCycles[g.id] = (this.stats.gateCycles[g.id] ?? 0) + 1;
          set("CLOSING", "gate.closing");
        } else if (el > 60 && av && !av.passedGates.includes(g.id) && !crossingOccupied()) {
          this.log(`slagboom ${g.id}: veiligheidstimeout, ${av.spec.id} is niet doorgereden; sluit veilig`);
          this.hooks.onPassageDone?.(gs.passageId, "aborted");
          set("CLOSING", "gate.closing");
        }
      } else if (gs.phase === "CLOSING") {
        if (crossingOccupied()) {
          this.log(`slagboom ${g.id}: voertuig in doorrijzone tijdens sluiten -> heropenen`);
          gs.phase = "OPENING";
          gs.since = this.t - g.openSec * (1 - Math.min(1, el / g.closeSec));
        } else if (el >= g.closeSec) {
          gs.authorizedVehicle = void 0;
          gs.passageId = void 0;
          set("CLOSED", "gate.closed");
        }
      }
    }
  }
  /** Arm opening fraction 0 (closed) .. 1 (open) */
  armFraction(gateId, t2 = this.t) {
    const g = this.net.gates.get(gateId), gs = this.gates.get(gateId);
    const el = t2 - gs.since;
    const ease = (x) => {
      x = clamp(x, 0, 1);
      return x * x * (3 - 2 * x);
    };
    switch (gs.phase) {
      case "CLOSED":
        return 0;
      case "OPENING":
        return ease(el / g.openSec);
      case "OPEN":
        return 1;
      case "CLOSING":
        return 1 - ease(el / g.closeSec);
    }
  }
  // ------------------------------------------------------------------ pedestrians
  spawnPedestrian(p) {
    const ped = { ...p, id: `ped-${++this.pedSeq}`, i: 0, x: p.path[0].x, y: p.path[0].y, heading: 0, state: "walking", speed: p.speed ?? 1.25 };
    this.peds.push(ped);
    return ped;
  }
  stepPedestrians(dt) {
    for (const p of this.peds) {
      if (p.state === "done") continue;
      const tgt = p.path[p.i + 1];
      if (!tgt) {
        p.state = "done";
        this.hooks.onPedestrianDone?.(p);
        continue;
      }
      const danger = this.vehicles.some((o) => o.state === "driving" && o.v > 0.3 && dist(o, p) < 9 && (p.x - o.x) * Math.cos(o.heading) + (p.y - o.y) * Math.sin(o.heading) > 0);
      const nearCar = this.vehicles.some((o) => o.state === "driving" && dist(o, p) < 3.2);
      if (danger && !nearCar && p.state === "walking" && this.onLane(p)) {
      } else if (danger && !this.onLane(p) && this.segmentCrossesLane(p)) {
        p.state = "waiting";
        continue;
      }
      p.state = "walking";
      const dx = tgt.x - p.x, dy = tgt.y - p.y, d = Math.hypot(dx, dy);
      const step = p.speed * dt;
      p.heading = Math.atan2(dy, dx);
      if (d <= step) {
        p.x = tgt.x;
        p.y = tgt.y;
        p.i++;
      } else {
        p.x += dx / d * step;
        p.y += dy / d * step;
      }
    }
    this.peds = this.peds.filter((p) => p.state !== "done");
  }
  onLane(p) {
    for (const e of this.net.edges.values()) {
      if (e.kind !== "lane") continue;
      if (Math.abs(e.line.pts[0].x - p.x) > 200) continue;
      const pr = e.line.project(p);
      if (pr.d < 1.6) return true;
    }
    return false;
  }
  segmentCrossesLane(p) {
    const tgt = p.path[p.i + 1];
    for (let f = 0.2; f <= 1; f += 0.2) if (this.onLane({ x: p.x + (tgt.x - p.x) * f, y: p.y + (tgt.y - p.y) * f })) return true;
    return false;
  }
  // ------------------------------------------------------------------ monitoring
  monitor(dt) {
    const live = this.vehicles.filter((v) => v.state !== "despawned");
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (Math.abs(a.x - b.x) > 8 || Math.abs(a.y - b.y) > 8) continue;
      if (obbOverlap(this.obbOf(a), this.obbOf(b), -0.02)) {
        this.stats.collisions++;
        if (this.stats.collisions < 30) this.log(`BOTSING ${a.spec.id} x ${b.spec.id}`);
      }
    }
    for (const v of live) {
      if (v.state !== "driving") continue;
      const e = this.edge(v.route[v.ri]);
      if (e.cls === "public" && v.v < 0.3) this.stats.publicRoadStopSeconds += dt;
      const t2 = e.line.tangent(clamp(v.s, 0, e.line.length), 0.7);
      const facing = Math.cos(v.heading) * t2.x + Math.sin(v.heading) * t2.y;
      if ((e.reverseMotion ? -facing : facing) < 0.3) {
        this.stats.wrongWay++;
        if (this.stats.wrongWay < 20) this.log(`SPOOKRIJDER? ${v.spec.id} op ${e.id}`);
      }
    }
  }
  // ------------------------------------------------------------------ snapshots / persistence
  snapshot() {
    return {
      t: +this.t.toFixed(3),
      vehicles: this.vehicles.filter((v) => v.state !== "despawned").map((v) => ({
        id: v.spec.id,
        kind: v.spec.kind,
        model: v.spec.model,
        color: v.spec.color,
        label: v.spec.label,
        job: v.mission.type === "service" ? v.mission.job : void 0,
        x: +v.x.toFixed(3),
        y: +v.y.toFixed(3),
        h: +v.heading.toFixed(4),
        v: +v.v.toFixed(2),
        brake: v.state === "driving" && v.brake,
        signal: v.state === "driving" ? v.signal : 0,
        reverse: this.edge(v.route[v.ri]).reverseMotion && v.state === "driving",
        state: v.state,
        len: v.spec.len,
        wid: v.spec.wid
      })),
      gates: [...this.gates.values()].map((g) => ({ id: g.id, phase: g.phase, since: +g.since.toFixed(3), authorizedVehicle: g.authorizedVehicle, queue: [...g.queue], openSec: this.net.gates.get(g.id).openSec, closeSec: this.net.gates.get(g.id).closeSec })),
      pedestrians: this.peds.map((p) => ({ id: p.id, x: +p.x.toFixed(2), y: +p.y.toFixed(2), h: +p.heading.toFixed(3), walking: p.state === "walking", color: p.color }))
    };
  }
  debugInfo() {
    return {
      vehicles: this.vehicles.map((v) => {
        const pos = this.pathPos(v);
        const pts = [];
        if (v.state === "driving") for (let x = 0; x <= Math.min(60, this.pathEnd(v) - pos); x += 2) {
          const s = this.pathSample(v, pos + x);
          pts.push([+s.x.toFixed(2), +s.y.toFixed(2)]);
        }
        return { id: v.spec.id, state: v.state, edge: v.route[v.ri], s: +v.s.toFixed(2), v: +v.v.toFixed(2), why: v.lastWaitReason, grants: Object.keys(v.grants), queue: v.queue, route: pts, box: obbCornersArr(this.obbOf(v)) };
      }),
      gates: [...this.gates.values()],
      buffer: this.buffer.map((b) => ({ id: b.spec.id, portal: b.portal, readyAt: b.readyAt })),
      stats: { ...this.stats, log: this.stats.log.slice(-40) }
    };
  }
  serialize() {
    return JSON.stringify({
      t: this.t,
      rng: this.rand.state(),
      pedSeq: this.pedSeq,
      vehicles: this.vehicles,
      gates: [...this.gates.values()],
      peds: this.peds,
      buffer: this.buffer,
      stats: { ...this.stats, minHeadway: Number.isFinite(this.stats.minHeadway) ? this.stats.minHeadway : null }
    });
  }
  restore(json) {
    const d = JSON.parse(json);
    this.t = d.t;
    this.rand.setState(d.rng);
    this.pedSeq = d.pedSeq ?? 0;
    this.vehicles = d.vehicles.filter((v) => v.route.every((id) => this.net.edges.has(id)));
    for (const g of d.gates) if (this.gates.has(g.id)) this.gates.set(g.id, g);
    this.peds = d.peds ?? [];
    this.buffer = d.buffer ?? [];
    if (d.stats) this.stats = { ...this.stats, ...d.stats, minHeadway: d.stats.minHeadway ?? Infinity };
  }
};
function splitKey(k) {
  const i = k.indexOf("|");
  return [k.slice(0, i), k.slice(i + 1)];
}
function obbCornersArr(b) {
  const rx = -b.uy, ry = b.ux;
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, c]) => [+(b.cx + b.ux * b.hl * a + rx * b.hw * c).toFixed(2), +(b.cy + b.uy * b.hl * a + ry * b.hw * c).toFixed(2)]);
}

// src/shared/guestlib.ts
var GUEST_ROLES = ["zanger", "songwriter", "producer", "muzikant", "manager", "ondernemer", "investeerder", "directeur", "chirurg", "advocaat"];
var ARTIST_ROLES = ["zanger", "songwriter", "producer", "muzikant"];
var WEALTHY_ROLES = ["ondernemer", "investeerder", "directeur", "chirurg", "advocaat"];
var ROLE_NAMES = {
  zanger: "zanger",
  songwriter: "songwriter",
  producer: "producer",
  muzikant: "muzikant",
  manager: "manager",
  ondernemer: "ondernemer",
  investeerder: "investeerder",
  directeur: "directeur",
  chirurg: "chirurg",
  advocaat: "advocaat",
  partner: "partner",
  kind: "kind",
  opa: "opa",
  oma: "oma"
};
var FAME_NAMES = ["onbekend", "bekend in de branche", "bekende Nederlander"];
var CELEBRITIES = [];
var CELEBRITY_SHARE = 0.3;
var customNames = { first: [], surnames: [], kids: [], cameos: [] };
function setCustomNames(n) {
  customNames.first = [...n.first ?? []];
  customNames.surnames = [...n.surnames ?? []];
  customNames.kids = [...n.kids ?? []];
  customNames.cameos = [...n.cameos ?? []];
}
var ARTISTS = [
  { name: "Mila Verbeek", role: "zanger" },
  { name: "Jens Hoogland", role: "songwriter" },
  { name: "Noa Brink", role: "zanger" },
  { name: "Sam Lindeboom", role: "producer" },
  { name: "Isa Vermeer", role: "songwriter" },
  { name: "Ruben Calis", role: "zanger" },
  { name: "Lotte Haverkamp", role: "songwriter" },
  { name: "Daan Wolters", role: "producer" },
  { name: "Femke Ridder", role: "zanger" },
  { name: "Joep Arends", role: "muzikant" },
  { name: "Zo\xEB Kramer", role: "songwriter" },
  { name: "Thijs Valk", role: "zanger" },
  { name: "Anouk Brand", role: "producer" },
  { name: "Milan de Smet", role: "songwriter" },
  { name: "Elin Bosman", role: "zanger" },
  { name: "Bas Overdijk", role: "muzikant" },
  { name: "Roos Lanting", role: "songwriter" },
  { name: "Victor Holst", role: "producer" }
];
var LABELS = ["Noorderlicht Records", "Veluwe Music", "Grachtengeluid", "Polderpop", "Studio Harderhaven", "Lichtmast Muziek", "Zuiderzee Songs", "Kwartnoot Records"];
var SONG_PROJECTS = ["een nieuwe zomerhit", "het tweede album", "een filmsong", "een duet", "het songfestivalnummer", "een kerstsingle", "de titelsong van een serie", "een akoestische ep"];
var COMPANIES = ["Nordwind Capital", "Harder Holding", "Veluwe Vastgoed", "De Grachtenbank", "Lindeboom & Partners", "Zuiderhaven Logistiek", "Kroonduin Advocaten", "MedTech Elburg"];
var WEALTHY_PROJECTS = ["een golfweekend met zakenpartners", "de verjaardag van de partner", "een overname die bijna rond is", "een weekje rust na een drukke maand", "het jubileum van het bedrijf", "een nieuw jacht dat ze willen uitproberen"];
var SURNAMES = ["De Vries", "Jansen", "De Jong", "Bakker", "Visser", "Meijer", "De Boer", "Mulder", "De Groot", "Bos", "Vos", "Peters", "Hendriks", "Van Dijk", "Dekker", "Brouwer", "Kok", "Jacobs", "Van der Linden", "Willems", "Van den Berg", "Verhoeven", "Kuipers", "Postma"];
var POSH = ["Van Eckelen-Morel", "Ten Velde-Hoorn", "Van Asperen-Blom", "De Wit-Lagerweij", "Van Harteveld", "Bosch van Drakestein-Kok", "Van der Meulen-Staal", "Ter Hoeve-Lindeman", "Van Oosterzee", "De Klerck-Huysman"];
var FIRST = ["Sanne", "Joost", "Fleur", "Bram", "Noor", "Daan", "Lotte", "Ruben", "Eva", "Thijs", "Mila", "Gijs", "Saar", "Teun", "Jasmijn", "Wouter", "Merel", "Koen", "Floor", "Sem"];
var KIDS = ["Pien", "Finn", "Lieke", "Mees", "Juul", "Siem", "Bo", "Tijn"];
var OLD = { opa: ["Opa Henk", "Opa Kees", "Opa Wim"], oma: ["Oma Riek", "Oma Truus", "Oma Ans"] };
var ARTIST_TRAITS = ["nachtmens", "perfectionist", "altijd een melodie in het hoofd", "chaotisch", "gezellig", "nieuwsgierig", "vroege vogel", "koffieliefhebber"];
var WEALTHY_TRAITS = ["veeleisend", "gul met fooien", "altijd aan de telefoon", "golfliefhebber", "zeer beleefd", "houdt van stipt", "gezellig", "wijnkenner"];
var PLAIN_TRAITS = ["geduldig", "veeleisend", "vergeetachtig", "luidruchtig", "vroege vogel", "gezellig", "nieuwsgierig", "mopperig"];
var CLOTHES = ["#d9534f", "#3a6ea5", "#f0ad4e", "#5cb85c", "#f7f7f2", "#7b5ea7", "#2b2b2b", "#e88aa8", "#46a5a0", "#c9a227"];
var KIND_SHARE = { familie: 0.5, artiest: 0.25, vermogend: 0.25 };
function makeHousehold(r, taken = /* @__PURE__ */ new Set()) {
  const FIRST_ = [...FIRST, ...customNames.first], KIDS_ = [...KIDS, ...customNames.kids], SURN_ = [...SURNAMES, ...customNames.surnames];
  const used = /* @__PURE__ */ new Set();
  const person = (role, traits) => {
    const pool = role === "kind" ? KIDS_ : role === "opa" ? OLD.opa : role === "oma" ? OLD.oma : FIRST_;
    let name = r.pick(pool);
    for (let i = 0; i < 6 && used.has(name); i++) name = r.pick(pool);
    used.add(name);
    return { name, role, trait: r.pick(traits), color: r.pick(CLOTHES) };
  };
  const free = [...CELEBRITIES, ...customNames.cameos].filter((c) => !taken.has(c.key));
  if (free.length && r.next() < CELEBRITY_SHARE) {
    const c = r.pick(free);
    const artist = ARTIST_ROLES.includes(c.role);
    const guests2 = [{ name: c.name, role: c.role, trait: r.pick(artist ? ARTIST_TRAITS : WEALTHY_TRAITS), color: r.pick(CLOTHES) }, ...c.companions.map((role) => person(role, PLAIN_TRAITS))];
    return { household: { name: `Gezelschap ${c.name}`, kind: artist ? "artiest" : "vermogend", label: artist ? r.pick(LABELS) : r.pick(COMPANIES), project: artist ? r.pick(SONG_PROJECTS) : r.pick(WEALTHY_PROJECTS), fame: 2, tagline: c.tagline, celebrity: c.key }, guests: guests2 };
  }
  const x = r.next();
  if (x < KIND_SHARE.artiest) {
    const lead = r.pick(ARTISTS);
    const label = r.pick(LABELS), project = r.pick(SONG_PROJECTS);
    const co = r.pick([["songwriter"], ["producer"], ["songwriter", "producer"], ["muzikant", "songwriter"], ["songwriter", "producer", "muzikant"]]);
    const guests2 = [{ name: lead.name, role: lead.role, trait: r.pick(ARTIST_TRAITS), color: r.pick(CLOTHES) }, ...co.map((role) => person(role, ARTIST_TRAITS))];
    used.add(lead.name);
    return { household: { name: `Schrijverskamp ${lead.name}`, kind: "artiest", label, project, fame: 1, tagline: `${lead.name} (${ROLE_NAMES[lead.role]}) schrijft hier aan ${project} voor ${label}` }, guests: guests2 };
  }
  if (x < KIND_SHARE.artiest + KIND_SHARE.vermogend) {
    const surname2 = r.pick(POSH), role = r.pick(WEALTHY_ROLES), company = r.pick(COMPANIES), project = r.pick(WEALTHY_PROJECTS);
    const rest = r.pick([["partner"], ["partner", "kind"], ["partner", "kind", "kind"]]);
    const guests2 = [person(role, WEALTHY_TRAITS), ...rest.map((ro) => person(ro, PLAIN_TRAITS))];
    return { household: { name: `Familie ${surname2}`, kind: "vermogend", label: company, project, fame: 1, tagline: `${guests2[0].name} ${surname2} (${ROLE_NAMES[role]}, ${company}) is hier voor ${project}` }, guests: guests2 };
  }
  const roles = r.pick([["partner", "partner"], ["partner", "partner", "kind"], ["partner", "partner", "kind", "kind"], ["partner", "opa", "oma"], ["partner", "partner", "kind", "opa"]]);
  const guests = roles.map((role) => person(role, PLAIN_TRAITS));
  const surname = r.pick(SURN_);
  return { household: { name: `Familie ${surname}`, kind: "familie", label: "", project: "", fame: 0, tagline: `Familie ${surname} is een weekje op vakantie aan het water` }, guests };
}
var ch = (text, task, afterMin) => ({ text, task, afterMin });
var ART = ["artiest"];
var RICH = ["vermogend"];
var FAM = ["familie"];
var STORIES = [
  // ---------------------------------------------------------------- songwriting camp
  {
    code: "STORY_WRITING_CAMP",
    title: "Schrijverskamp in de villa",
    roles: ARTIST_ROLES,
    kinds: ART,
    weight: 1.4,
    intro: "{lead} schrijft deze week in villa {n} aan {project} voor {label}.",
    chapters: [ch("Er wordt geschreven in {loc}, maar de buren blazen blad. Stilte graag.", "STY_CAMP_QUIET", 0), ch("De vleugel in {loc} is vals geworden. Er moet een pianostemmer komen.", "STY_CAMP_PIANO", 25), ch("Het nummer is af. {lead} wil het laten horen in de brasserie.", "STY_CAMP_DEMO_NIGHT", 30)],
    finale: "De brasserie is stil, dan klinkt een applaus tot op de golfbaan. {label} wil het nummer meteen uitbrengen.",
    fail: "Het schrijverskamp loopt vast. {lead} neemt de halve melodie mee naar huis.",
    onSuccess: { mood: 0.3 },
    onFail: { mood: -0.15 }
  },
  {
    code: "STORY_HOME_STUDIO",
    title: "Thuisstudio aan de gracht",
    roles: ["producer", "muzikant", "zanger"],
    kinds: ART,
    weight: 1.2,
    intro: "{lead} bouwt in villa {n} een studio om {project} op te nemen.",
    chapters: [ch("De studioapparatuur laat de stroom uitvallen in {loc}.", "STY_STUDIO_POWER", 0), ch("De glaspui galmt. {lead} wil dekens en matrassen voor de akoestiek.", "STY_STUDIO_DAMPING", 20), ch("Alles is opgenomen. Nu nog uploaden naar {label}.", "STY_STUDIO_UPLOAD", 25)],
    finale: 'De opnames staan bij {label}. In de liner notes staat: "opgenomen aan een gracht in Harderwold".',
    fail: "De opnames komen te laat bij {label}. {lead} moet in de stad opnieuw beginnen.",
    onSuccess: { mood: 0.25, tech: 0.1 },
    onFail: { mood: -0.15 }
  },
  {
    code: "STORY_JETTY_SUNRISE",
    title: "Inspiratie op de steiger",
    roles: ["songwriter", "zanger"],
    kinds: ART,
    weight: 1.1,
    intro: "{lead} schrijft de mooiste regels bij zonsopgang, op het water.",
    chapters: [ch("{lead} wil om zes uur schrijven op de steiger van {loc}.", "STY_JETTY_SUNRISE", 0), ch("Een plank op de steiger zit los. De gitaar viel er bijna door.", "STY_JETTY_BOARD", 20), ch("Voor het refrein wil {lead} een rondje varen.", "STY_JETTY_SLOEP", 25)],
    finale: "Het refrein gaat over een sloep bij zonsopgang. Het wordt het mooiste nummer van {project}.",
    fail: "De inspiratie is weg. {lead} schrijft een nummer over een losse plank.",
    onSuccess: { mood: 0.25 },
    onFail: { mood: -0.1 }
  },
  {
    code: "STORY_DEADLINE",
    title: "Deadline voor de hit",
    roles: ARTIST_ROLES,
    kinds: ART,
    weight: 1.1,
    intro: "{label} wil morgen het refrein van {project}. {lead} heeft nog geen woord.",
    chapters: [ch("Er moet koffie komen in {loc}. Veel koffie.", "STY_DEADLINE_COFFEE", 0), ch("{lead} wil de teksten op papier om te schrappen, maar de printer staakt.", "STY_DEADLINE_PRINT", 20), ch("Om twee uur 's nachts klinkt hetzelfde akkoord voor de veertigste keer. De buren zijn wakker.", "STY_DEADLINE_NEIGHBOURS", 25)],
    finale: "Om vier uur is het af. {label} stuurt een berichtje met drie vlammetjes.",
    fail: "De deadline is gemist. {label} geeft {lead} nog een week, met een zucht.",
    onSuccess: { mood: 0.25 },
    onFail: { mood: -0.15 }
  },
  {
    code: "STORY_LISTENING_SESSION",
    title: "Luistersessie bij de Residentie",
    roles: ["zanger", "muzikant"],
    kinds: ART,
    weight: 1.2,
    intro: "{lead} wil de nieuwe nummers voor het eerst live spelen, voor de gasten van het park.",
    chapters: [ch("Er moet een klein podium komen in het gras bij de Residentie.", "STY_LISTEN_STAGE", 0), ch("Het podium staat. Nu nog geluid dat niet piept.", "STY_LISTEN_SOUND", 20), ch("Half het park komt eraan. Regel een nette rij en drinken.", "STY_LISTEN_CROWD", 20)],
    finale: "Het hele grasveld zingt mee met {lead}. Een avond om nooit te vergeten.",
    fail: "De luistersessie gaat niet door. {lead} speelt alleen voor de eenden bij de steiger.",
    onSuccess: { mood: 0.3 },
    onFail: { mood: -0.1 }
  },
  {
    code: "STORY_LOST_LYRICS",
    title: "Het verloren notitieboek",
    roles: ARTIST_ROLES,
    kinds: ART,
    weight: 1,
    intro: "Het notitieboek van {lead} met alle teksten voor {project} is weg.",
    chapters: [ch("Misschien is het ingeleverd bij de gevonden voorwerpen.", "STY_LYRICS_LOSTFOUND", 0), ch("Een golfer zag een zwart boekje bij de driving range.", "STY_LYRICS_RANGE", 15)],
    finale: "Het boekje is terug, met een golfbalafdruk op de kaft. {lead} noemt het een geluksteken.",
    fail: "Het boekje blijft weg. {lead} moet alles uit het hoofd opnieuw schrijven.",
    onSuccess: { mood: 0.25 },
    onFail: { mood: -0.15 }
  },
  // ---------------------------------------------------------------- well-to-do guests
  {
    code: "STORY_PRIVATE_CHEF",
    title: "Privekok in de villa",
    roles: WEALTHY_ROLES,
    kinds: RICH,
    weight: 1.2,
    intro: "{household} heeft een privekok laten komen voor een diner in villa {n}.",
    chapters: [ch("De kok mist truffel, kreeft en verse dragon.", "STY_CHEF_GROCERIES", 0), ch("Net nu het begint, doet de stoomoven het niet.", "STY_CHEF_OVEN", 20), ch("Er komen meer gasten dan gedacht. Extra glazen en borden!", "STY_CHEF_GLASSES", 20)],
    finale: "Een diner van vijf gangen op het terras aan de gracht. {lead} geeft de keukenploeg een dikke fooi.",
    fail: "Het diner wordt een pizza-avond. Ook lekker, maar niet wat {lead} in gedachten had.",
    onSuccess: { mood: 0.3 },
    onFail: { mood: -0.15 }
  },
  {
    code: "STORY_OWN_BOAT",
    title: "De eigen boot voor de deur",
    roles: WEALTHY_ROLES,
    kinds: RICH,
    weight: 1.1,
    intro: "{lead} komt met een eigen sloep van zeven meter, via het water.",
    chapters: [ch("De boot moet aanleggen aan de steiger van {loc}.", "STY_YACHT_MOOR", 0), ch("De boot wil walstroom. Veilig graag.", "STY_YACHT_POWER", 20), ch("{lead} wil met gasten een vaartocht maken met een picknickmand.", "STY_YACHT_PICNIC", 25)],
    finale: "De boot vaart door de grachten met een picknick aan boord. Alle buren zwaaien.",
    fail: "De boot past niet bij de steiger. {lead} legt aan bij de buren, die zijn er niet blij mee.",
    onSuccess: { mood: 0.25 },
    onFail: { mood: -0.15 }
  },
  {
    code: "STORY_GOLF_DEAL",
    title: "Zakendeal op de golfbaan",
    roles: ["ondernemer", "investeerder", "directeur"],
    kinds: RICH,
    weight: 1.2,
    intro: "{lead} van {label} wil de deal van het jaar rond maken op hole 9.",
    chapters: [ch("Er zijn twee schone golfkarren nodig voor de flight.", "STY_DEAL_CART", 0), ch("De green van hole 9 moet er perfect bij liggen.", "STY_DEAL_GREEN", 20), ch("Na de ronde: een rustige tafel op het terras.", "STY_DEAL_LUNCH", 25)],
    finale: "Een putt van vier meter, een handdruk en een glas bubbels. De deal is rond.",
    fail: 'De deal gaat niet door. "Volgende keer op een andere baan," zegt de zakenpartner.',
    onSuccess: { mood: 0.3 },
    onFail: { mood: -0.15 }
  },
  {
    code: "STORY_POOL_PARTY",
    title: "Poolparty aan de gracht",
    roles: ["partner", "ondernemer", "investeerder"],
    kinds: RICH,
    weight: 1.1,
    intro: "{household} geeft vanavond een poolparty in villa {n}.",
    chapters: [ch("Het privezwembad moet minstens 28 graden zijn.", "STY_POOLPARTY_HEAT", 0), ch("De buren vinden het gezellig, tot elf uur.", "STY_POOLPARTY_NEIGHBOURS", 30), ch("Het feest is voorbij. Het zwembad ligt vol slingers.", "STY_POOLPARTY_CLEANUP", 30)],
    finale: "Een warm zwembad, lichtjes op de steiger en tevreden buren. Een geslaagd feest.",
    fail: "Het water bleef koud en de buren klaagden. De party verhuist naar binnen.",
    onSuccess: { mood: 0.25, clean: 0.1 },
    onFail: { mood: -0.15, clean: -0.1 }
  },
  {
    code: "STORY_ART_DELIVERY",
    title: "Kunst voor de villa",
    roles: WEALTHY_ROLES,
    kinds: RICH,
    weight: 0.9,
    intro: "{lead} heeft een beeldhouwwerk gekocht en wil het meteen op het terras van villa {n}.",
    chapters: [ch("Het beeld weegt 200 kilo en staat bij de slagboom.", "STY_ART_DELIVERY", 0), ch("Het moet precies in het midden van het terras.", "STY_ART_PLACE", 20)],
    finale: "Het beeld staat. Bij zonsondergang valt de schaduw precies over de gracht. {lead} is sprakeloos.",
    fail: "Het beeld blijft in de krat. {lead} laat het terugsturen naar de galerie.",
    onSuccess: { mood: 0.25 },
    onFail: { mood: -0.1 }
  },
  // ---------------------------------------------------------------- families
  {
    code: "STORY_GRANDMA_80",
    title: "Oma wordt 80",
    roles: ["oma", "opa"],
    kinds: FAM,
    weight: 1.2,
    intro: "{lead} van {household} wordt vandaag 80. De familie wil er een feest van maken.",
    chapters: [ch("Een taart met tachtig kaarsjes (of in elk geval veel).", "STY_BDAY_CAKE", 0), ch("Versier het terras van {loc} met slingers en ballonnen.", "STY_BDAY_DECOR", 20), ch("Als verrassing: een rondvaart door de grachten.", "STY_BDAY_SLOEP", 25)],
    finale: "{lead} zegt dat dit de mooiste verjaardag ooit was. En dat is met tachtig jaar ervaring.",
    fail: "Het feest blijft klein. {lead} vindt het eigenlijk wel best zo.",
    onSuccess: { mood: 0.3 },
    onFail: { mood: -0.1 }
  },
  {
    code: "STORY_GRANDPA_GOLF",
    title: "Opa leert golfen",
    roles: ["opa"],
    kinds: FAM,
    weight: 1,
    intro: "{lead} van {household} heeft nog nooit een golfclub vastgehad, en wil het nu wel eens proberen.",
    chapters: [ch("Eerst naar de driving range: hoe sla je eigenlijk een bal?", "STY_GRANDPA_RANGE", 0), ch("Op de baan belanden de ballen in de bunker, de vijver en het bos.", "STY_GRANDPA_BALLS", 25)],
    finale: "Op hole 3 slaat {lead} een bal die bijna in een keer op de green ligt. Het hele terras juicht.",
    fail: "{lead} vindt golf toch niks en gaat vissen bij de steiger.",
    onSuccess: { mood: 0.25 },
    onFail: { mood: -0.05 }
  },
  {
    code: "STORY_CANOE",
    title: "Kano op avontuur",
    roles: ["kind"],
    kinds: FAM,
    weight: 1.1,
    intro: "De kinderen van {household} gaan voor het eerst alleen met de kano de gracht op.",
    chapters: [ch("Ze zijn een gracht te ver gevaren en weten de weg niet meer terug.", "STY_CANOE_LOST", 0), ch("Ze zijn terug, kletsnat maar blij.", "STY_CANOE_DRY", 15)],
    finale: "Bij de chocomelk vertellen de kinderen het verhaal al voor de derde keer. Het wordt steeds spannender.",
    fail: "De kano gaat voorlopig aan de ketting. De kinderen spelen weer in de speeltuin.",
    onSuccess: { mood: 0.25 },
    onFail: { mood: -0.1 }
  },
  {
    code: "STORY_HEDGE_FEUD",
    title: "Ruzie over de haag",
    roles: ["partner"],
    kinds: FAM,
    noRealPeople: true,
    weight: 0.9,
    intro: "{lead} van {household} vindt dat de haag van de buren een meter te hoog is. De buren vinden van niet.",
    chapters: [ch("Over de haag bij {loc} wordt luidkeels gediscussieerd. Andere gasten pakken popcorn.", "STY_FEUD_MEDIATE", 0), ch("Nu gaat het over wiens sloep aan welke kant van de steiger ligt.", "STY_FEUD_JETTY", 20), ch("Er is vrede. Een gezamenlijke barbecue moet het bezegelen.", "STY_FEUD_DINNER", 25)],
    finale: "Na het toetje spreken ze af om volgend jaar weer naast elkaar te boeken.",
    fail: "De ruzie blijft. Beide families schrijven een lange review.",
    onSuccess: { mood: 0.25 },
    onFail: { mood: -0.2 }
  },
  // ---------------------------------------------------------------- cameo guests (real people added by the game master)
  {
    code: "STORY_CELEB_GUEST",
    title: "Een bekende gast",
    roles: [...GUEST_ROLES],
    celebrities: ["*"],
    weight: 1,
    intro: "{lead} logeert in villa {n}. Het hele park heeft het er al over.",
    chapters: [ch("Gasten hopen op een handtekening van {lead}. Er staat een rij bij de receptie.", "STY_CELEB_AUTOGRAPH", 0), ch("{lead} wil rustig eten, maar de brasserie zit vol nieuwsgierige gasten.", "STY_CELEB_QUIET_TABLE", 30)],
    finale: "{lead} bedankt het personeel en zwaait bij vertrek naar de hele receptie.",
    fail: "Het werd te druk en {lead} at uiteindelijk thuis in de villa.",
    onSuccess: { mood: 0.25 },
    onFail: { mood: -0.1 }
  }
];
var storyByCode = new Map(STORIES.map((s) => [s.code, s]));
function storyText(s, v) {
  return s.replace(/\{(\w+)\}/g, (m, k) => k in v ? v[k] : m);
}

// src/sim/park.ts
var CAR_COLORS = ["#e9ecef", "#1f2326", "#9aa3ab", "#2f4f7f", "#8e1d24", "#cfd4d8", "#3c4b3a", "#5a6470", "#f2f2ee", "#273441", "#6b2f2a", "#b7b9b2"];
var ParkSim = class {
  traffic;
  net;
  bookings = /* @__PURE__ */ new Map();
  houses = /* @__PURE__ */ new Map();
  rand;
  seq = 0;
  serviceNext = 30;
  techJobs = /* @__PURE__ */ new Map();
  hooks;
  gateCache = /* @__PURE__ */ new Map();
  /** service entrances (emergency exits used by service vehicles) */
  servicePortals;
  /** visitors enter and leave the park at the public entrance */
  visitorPortal;
  /** turning circles a patrolling maintenance van can visit */
  patrolLoops;
  seed;
  constructor(net, hooks, seed = 7) {
    this.seed = seed;
    this.net = net;
    this.hooks = hooks;
    this.rand = rng(seed * 7919 + 13);
    this.visitorPortal = visitorPortal(net);
    this.servicePortals = [...net.portals.values()].filter((p) => p.kind === "service" && p.spawnEdge && p.despawnEdge).map((p) => p.id);
    this.patrolLoops = [...net.edges.values()].filter((e) => e.kind === "loop" && e.service && e.cls === "park").map((e) => e.id).sort();
    for (const st of net.stalls.values()) if (st.houseNumber > 0) this.houses.set(st.houseNumber, { state: "vacant" });
    this.traffic = new TrafficSim(net, {
      consumeToken: (vid, gid) => hooks.consumeToken(vid, gid),
      // without a backend (tests, stress runs) the simulation issues the staff pass itself
      servicePass: (vid, gid) => hooks.servicePass ? hooks.servicePass(vid, gid) : `svc-pass-${vid}-${gid}-${this.traffic.t.toFixed(1)}`,
      onPassageDone: (pid, status) => hooks.onPassageDone?.(pid, status),
      onEvent: (t2, p) => this.onTrafficEvent(t2, p),
      onQueued: (veh, gate, slot) => {
        const b = this.bookingOfVehicle(veh.spec.id);
        if (!b) return;
        this.setStatus(b, gate.direction === "inbound" ? "queued_in" : "queued_out");
        b.queuedAt = this.traffic.t;
        hooks.onQueued(b, gate.id, gate.direction, slot);
      },
      onAtGate: (veh, gate) => {
        const b = this.bookingOfVehicle(veh.spec.id);
        if (b) hooks.onAtGate?.(b, gate.id, gate.direction);
      },
      onParked: (veh) => this.onParked(veh),
      onExited: (veh) => this.onExited(veh),
      onPedestrianDone: (p) => this.onPedDone(p)
    }, seed);
  }
  get t() {
    return this.traffic.t;
  }
  id(prefix) {
    return `${prefix}-${(++this.seq).toString().padStart(3, "0")}`;
  }
  bookingOfVehicle(vid) {
    for (const b of this.bookings.values()) if (b.vehicleId === vid) return b;
    return void 0;
  }
  setStatus(b, s, note) {
    b.status = s;
    b.history.push({ t: +this.t.toFixed(1), status: s, note });
    this.hooks.onEvent("booking.updated", { bookingId: b.id, status: s, houseNumber: b.houseNumber, household: b.household });
  }
  onTrafficEvent(type, payload) {
    this.hooks.onEvent(type, payload);
    const vid = payload.vehicleId;
    const b = vid ? this.bookingOfVehicle(vid) : void 0;
    if (!b) return;
    if (type === "vehicle.passed_gate") this.setStatus(b, b.status === "queued_in" || b.status === "checked_in" ? "driving_in" : "checked_out");
  }
  /** Household (guestlib: family, songwriting camp or well-to-do guests) from its own seeded stream, so guest profiles never change the traffic randomness. */
  makeGuests(bookingId) {
    let h = Math.imul(this.seed, 2654435761) >>> 0;
    for (const ch2 of bookingId) h = Math.imul(h ^ ch2.charCodeAt(0), 16777619) >>> 0;
    const taken = /* @__PURE__ */ new Set();
    for (const b of this.bookings.values()) if (b.status !== "exited" && b.profile?.celebrity) taken.add(b.profile.celebrity);
    const { household, guests } = makeHousehold(rng(h), taken);
    return { household: household.name, guests, profile: household };
  }
  makeCar(id) {
    const model = this.rand.pick(["hatch", "suv", "wagon", "suv", "hatch"]);
    const len = model === "suv" ? 4.6 : model === "wagon" ? 4.75 : 4.2;
    const L = "BDFGHJKLNPRSTVXZ";
    const plate = `${L[this.rand.int(0, 15)]}${L[this.rand.int(0, 15)]}-${this.rand.int(100, 999)}-${L[this.rand.int(0, 15)]}`;
    return { id, kind: "visitor", model, len, wid: model === "suv" ? 1.88 : 1.8, color: this.rand.pick(CAR_COLORS), plate };
  }
  /** bookable: vacant and its stall not temporarily used by a TD golf cart */
  vacantHouses() {
    return [...this.houses.entries()].filter(([n, h]) => h.state === "vacant" && !this.stallBusy(this.net.stallsByHouse.get(n).id)).map(([n]) => n);
  }
  /** Create a booking that arrives now via the public approach (west portal). Returns null if no bungalow is free. */
  scheduleArrival(opts = {}) {
    const free = this.vacantHouses();
    const house2 = opts.houseNumber && free.includes(opts.houseNumber) ? opts.houseNumber : free.length ? this.rand.pick(free) : null;
    if (house2 === null) return null;
    const st = this.net.stallsByHouse.get(house2);
    const id = this.id("B");
    const vid = this.id("car");
    const b = {
      id,
      ...this.makeGuests(id),
      houseNumber: house2,
      stallId: st.id,
      vehicleId: vid,
      status: "arriving",
      satisfaction: this.rand.range(0.78, 0.92),
      createdAt: this.t,
      history: []
    };
    this.bookings.set(id, b);
    this.houses.set(house2, { state: "reserved", bookingId: id });
    this.setStatus(b, "arriving");
    this.traffic.enqueueArrival(this.makeCar(vid), { type: "arrive", bookingId: id, stallId: st.id, gateId: this.gatesFor(house2).in }, this.visitorPortal, this.t + (opts.delaySec ?? 0));
    return b;
  }
  /** Put households into some bungalows at start (parked car, guests inside). */
  seedOccupied(count) {
    const free = this.vacantHouses();
    for (let i = 0; i < count && free.length; i++) {
      const house2 = free.splice(this.rand.int(0, free.length - 1), 1)[0];
      const st = this.net.stallsByHouse.get(house2);
      const id = this.id("B"), vid = this.id("car");
      const b = { id, ...this.makeGuests(id), houseNumber: house2, stallId: st.id, vehicleId: vid, status: "in_house", satisfaction: this.rand.range(0.75, 0.95), createdAt: this.t, history: [] };
      this.bookings.set(id, b);
      this.houses.set(house2, { state: "occupied", bookingId: id });
      this.traffic.placeParked(this.makeCar(vid), { type: "arrive", bookingId: id, stallId: st.id, gateId: this.gatesFor(house2).in }, st.id);
      this.setStatus(b, "in_house", "startbezetting");
    }
  }
  /** Household leaves: guests walk to the car, then the car waits for outbound queue capacity. */
  depart(opts = {}) {
    const cands = [...this.bookings.values()].filter((b2) => b2.status === "in_house");
    const b = opts.bookingId ? cands.find((x) => x.id === opts.bookingId) : opts.houseNumber ? cands.find((x) => x.houseNumber === opts.houseNumber) : cands.length ? this.rand.pick(cands) : void 0;
    if (!b) return null;
    const veh = this.traffic.vehicles.find((v) => v.spec.id === b.vehicleId);
    if (!veh) return null;
    this.setStatus(b, "departing");
    const house2 = this.net.houses.find((h) => h.number === b.houseNumber);
    veh.boarding = b.guests.length;
    this.traffic.requestDeparture(veh.spec.id, { type: "depart", bookingId: b.id, stallId: b.stallId, gateId: this.gatesFor(b.houseNumber).out, portal: this.visitorPortal });
    b.guests.forEach((g, i) => {
      const path = this.walkPath(house2.door, veh, i);
      this.traffic.spawnPedestrian({ name: g.name, color: g.color, path, purpose: "to_car", bookingId: b.id, vehicleId: veh.spec.id, speed: 1.15 + i * 0.07 });
    });
    return b;
  }
  walkPath(door, veh, i) {
    const side = { x: Math.cos(veh.heading + Math.PI / 2), y: Math.sin(veh.heading + Math.PI / 2) };
    const fwd = { x: Math.cos(veh.heading), y: Math.sin(veh.heading) };
    const carSide = add(add({ x: veh.x, y: veh.y }, mul(side, (i % 2 ? -1 : 1) * 1.35)), mul(fwd, i < 2 ? 0.6 : -0.9));
    const mid = add(mul(add(door, carSide), 0.5), mul(norm(sub(door, carSide)), 0));
    return [door, mid, carSide];
  }
  onParked(veh) {
    const b = this.bookingOfVehicle(veh.spec.id);
    if (!b) return;
    b.arrivedAt = this.t;
    this.setStatus(b, "parked");
    const house2 = this.net.houses.find((h) => h.number === b.houseNumber);
    b.guests.forEach((g, i) => {
      const path = this.walkPath(house2.door, veh, i).reverse();
      this.traffic.spawnPedestrian({ name: g.name, color: g.color, path, purpose: "to_house", bookingId: b.id, speed: 1.1 + i * 0.08 });
    });
    this.houses.set(b.houseNumber, { state: "occupied", bookingId: b.id });
  }
  onPedDone(p) {
    if (p.purpose === "to_house" && p.bookingId) {
      const b = this.bookings.get(p.bookingId);
      if (b && b.status === "parked" && !this.traffic.peds.some((q) => q !== p && q.bookingId === p.bookingId && q.state !== "done")) this.setStatus(b, "in_house");
    }
    if (p.purpose === "to_car" && p.vehicleId) {
      const veh = this.traffic.vehicles.find((v) => v.spec.id === p.vehicleId);
      if (veh && veh.boarding) veh.boarding--;
    }
    if (p.purpose === "tech_in" && p.bookingId) {
      const j = this.techJobs.get(p.bookingId);
      if (j) {
        j.techInside = true;
        this.hooks.onEvent("service.working", { kind: "technische_dienst", taskId: j.taskId, houseNumber: j.houseNumber });
        if (j.released) this.techWalkBack(j);
      }
    }
    if (p.purpose === "tech_out" && p.bookingId) {
      const j = this.techJobs.get(p.bookingId);
      if (j && j.released) this.returnCart(j);
      else if (j) {
        j.phase = "working";
        this.techWalkIn(j);
      }
    }
    if (p.purpose === "clean_in") {
      const back = p.path.slice().reverse();
      this.traffic.spawnPedestrian({ name: p.name, color: p.color, path: [back[0], back[0], ...back], purpose: "clean_out", vehicleId: p.vehicleId, speed: 1.2 });
    }
    if (p.purpose === "clean_out" && p.vehicleId) {
      const veh = this.traffic.vehicles.find((v) => v.spec.id === p.vehicleId);
      if (veh && veh.mission.type === "service" && veh.mission.job === "clean" && veh.mission.houseNumber && this.houses.get(veh.mission.houseNumber)?.state === "cleaning") {
        this.houses.set(veh.mission.houseNumber, { state: "vacant" });
        this.hooks.onEvent("house.cleaned", { houseNumber: veh.mission.houseNumber });
        if (veh.state === "dwell") veh.dwellUntil = this.t;
      }
    }
  }
  onExited(veh) {
    const b = this.bookingOfVehicle(veh.spec.id);
    if (b) {
      b.departedAt = this.t;
      this.setStatus(b, "exited");
      this.houses.set(b.houseNumber, { state: "needs_cleaning" });
      this.hooks.onEvent("house.needs_cleaning", { houseNumber: b.houseNumber });
    }
  }
  // ---------------------------------------------------------------- service vehicles
  serviceSpec(kind) {
    return kind === "onderhoud" ? { id: this.id("svc-onderhoud"), kind: "service", model: "van", len: 5.3, wid: 2, color: "#ffffff", plate: "Onderhoud", label: "Onderhoud" } : { id: this.id("svc-schoonmaak"), kind: "service", model: "cart", len: 3.7, wid: 1.5, color: "#ffffff", plate: "Schoonmaak", label: "Schoonmaak" };
  }
  serviceActive(prefix) {
    return this.traffic.vehicles.some((v) => v.spec.id.startsWith(prefix)) || this.traffic.buffer.some((b) => b.spec.id.startsWith(prefix));
  }
  dispatchService() {
    if (!this.serviceActive("svc-schoonmaak")) {
      const dirty = [...this.houses.entries()].find(([, h]) => h.state === "needs_cleaning");
      if (dirty && !this.stallBusy(this.net.stallsByHouse.get(dirty[0]).id)) {
        const [num] = dirty;
        const st = this.net.stallsByHouse.get(num);
        const [portal, exitPortal] = this.servicePair(st.inEdge, st.outEdge);
        this.houses.set(num, { state: "cleaning" });
        this.traffic.buffer.push({ spec: this.serviceSpec("schoonmaak"), mission: { type: "service", job: "clean", stallId: st.id, dwellSec: 240, exitPortal, houseNumber: num }, portal, readyAt: this.t });
        this.hooks.onEvent("service.dispatched", { kind: "schoonmaak", houseNumber: num });
      }
    }
    if (!this.serviceActive("svc-onderhoud") && this.t >= this.serviceNext) {
      const [portal, exitPortal] = this.servicePair();
      this.traffic.buffer.push({ spec: this.serviceSpec("onderhoud"), mission: { type: "service", job: "patrol", exitPortal }, portal, readyAt: this.t });
      this.serviceNext = this.t + this.rand.range(70, 160);
    }
  }
  /** Entry and exit service entrance for a job at (toEdge -> fromEdge): preferably both reachable WITHOUT a barrier
   *  (the East and West parts of the park are only connected through the barriers); otherwise a staff pass is needed. */
  servicePair(toEdge, fromEdge) {
    const ps = this.servicePortals;
    if (!ps.length) return ["", ""];
    const reach = (p) => this.serviceRegion(p);
    const entries = toEdge ? ps.filter((p) => reach(p).fwd.has(toEdge)) : ps;
    const entry = entries.length ? entries[this.rand.int(0, entries.length - 1)] : ps[this.rand.int(0, ps.length - 1)];
    const exits = fromEdge ? ps.filter((p) => reach(p).back.has(fromEdge)) : ps.filter((p) => p !== entry && reach(entry).fwd.has(this.net.portals.get(p).despawnEdge));
    const exit = exits.length ? exits[this.rand.int(0, exits.length - 1)] : entry;
    return [entry, exit];
  }
  regions = /* @__PURE__ */ new Map();
  /** edges a service vehicle reaches from (fwd) / can leave through (back) a service entrance without a barrier */
  serviceRegion(portalId) {
    const hit = this.regions.get(portalId);
    if (hit) return hit;
    const p = this.net.portals.get(portalId);
    const gates = new Set([...this.net.gates.values()].filter((g) => !g.staff).map((g) => g.edge));
    const ok = (id) => {
      const e = this.net.edges.get(id);
      return e.service && !gates.has(id) && e.kind !== "reverse";
    };
    const walk = (start, dir) => {
      const seen = /* @__PURE__ */ new Set([start]);
      const st = [start];
      while (st.length) {
        const u = st.pop();
        for (const n of this.net.edges.get(u)[dir]) if (!seen.has(n) && (ok(n) || this.net.edges.get(n).kind === "reverse")) {
          seen.add(n);
          st.push(n);
        }
      }
      return seen;
    };
    const res = { fwd: walk(p.spawnEdge, "next"), back: walk(p.despawnEdge, "prev") };
    this.regions.set(portalId, res);
    return res;
  }
  /** Called by the traffic sim when a cleaning cart has parked (dwell) */
  startCleaner(veh) {
    if (veh.mission.type !== "service" || veh.mission.job !== "clean" || !veh.mission.houseNumber) return;
    const house2 = this.net.houses.find((h) => h.number === veh.mission.houseNumber);
    const path = this.walkPath(house2.door, veh, 0).reverse();
    this.traffic.spawnPedestrian({ name: "Schoonmaker", color: "#1fa7a8", path, purpose: "clean_in", vehicleId: veh.spec.id, speed: 1.3 });
  }
  // ---------------------------------------------------------------- technical service (golf carts)
  /** Park the TD golf carts in their depot stalls at the TD post next to reception. */
  seedService() {
    const depot = [...this.net.stalls.values()].filter((s) => s.kind === "depot");
    depot.forEach((st, i) => {
      if (this.traffic.vehicles.some((v) => v.spec.id === `tdkar-${i + 1}`)) return;
      this.traffic.placeParked(
        { id: `tdkar-${i + 1}`, kind: "service", model: "golfcart", len: 2.8, wid: 1.35, color: "#ffffff", plate: `TD-${i + 1}`, label: "Technische dienst" },
        { type: "service", job: "return", stallId: st.id, exitPortal: "" },
        st.id
      );
    });
  }
  stallBusy(stallId, except) {
    const st = this.net.stalls.get(stallId);
    if (this.traffic.vehicles.some((v) => v.spec.id !== except && v.state !== "despawned" && (st.inEdges.includes(v.route[v.route.length - 1]) || st.outEdges.includes(v.route[v.ri])))) return true;
    if (this.traffic.buffer.some((b) => "stallId" in b.mission && b.mission.stallId === stallId)) return true;
    for (const j of this.techJobs.values()) if (j.stallId === stallId && j.cartId !== except) return true;
    return false;
  }
  cartStall(cartId) {
    const v = this.traffic.vehicles.find((x) => x.spec.id === cartId);
    if (!v) return void 0;
    const e = this.net.edges.get(v.route[v.route.length - 1]);
    return e?.stallId ? this.net.stalls.get(e.stallId) : void 0;
  }
  dispatchTechnician(taskId, houseNumber) {
    const prev = this.techJobs.get(taskId);
    if (prev) {
      prev.released = false;
      return true;
    }
    if (!this.net.houses.some((h) => h.number === houseNumber)) return false;
    this.techJobs.set(taskId, { taskId, houseNumber, phase: "pending", released: false, techInside: false, createdAt: this.t });
    this.hooks.onEvent("service.requested", { kind: "technische_dienst", taskId, houseNumber });
    return true;
  }
  releaseTechnician(taskId) {
    const j = this.techJobs.get(taskId);
    if (!j) return;
    j.released = true;
    if (j.phase === "pending") {
      this.techJobs.delete(taskId);
      return;
    }
    if (j.phase === "working" && j.techInside) this.techWalkBack(j);
  }
  /** Where the mechanic for this task is; onSite only once they have actually walked into the bungalow. */
  techStatus(taskId) {
    const j = this.techJobs.get(taskId);
    if (!j || j.released) return void 0;
    return { phase: j.phase, onSite: j.phase === "working" && j.techInside, vehicleId: j.cartId ?? null, houseNumber: j.houseNumber };
  }
  tryAssignTech() {
    for (const j of this.techJobs.values()) {
      if (j.phase !== "pending") continue;
      const house2 = this.net.houses.find((h) => h.number === j.houseNumber);
      const busyCarts = new Set([...this.techJobs.values()].map((x) => x.cartId).filter(Boolean));
      const carts = this.traffic.vehicles.filter((v) => v.spec.model === "golfcart" && v.state === "parked" && !busyCarts.has(v.spec.id) && !v.departPending);
      if (!carts.length) return;
      const cands = [...this.net.stalls.values()].filter((s) => s.kind !== "house" || this.houses.get(s.houseNumber)?.state === "vacant").map((s) => ({ s, d: dist({ x: s.parkedPose.x, y: s.parkedPose.y }, house2.door) })).filter((c) => c.d < 48).sort((a, b) => a.d - b.d);
      let pick2 = null;
      for (const c of cands) {
        const own = carts.find((v) => this.cartStall(v.spec.id)?.id === c.s.id);
        if (own) {
          pick2 = { cart: own, stall: c.s.id };
          break;
        }
        if (!this.stallBusy(c.s.id)) {
          pick2 = { cart: carts[0], stall: c.s.id };
          break;
        }
      }
      if (!pick2) continue;
      j.cartId = pick2.cart.spec.id;
      j.stallId = pick2.stall;
      this.hooks.onEvent("service.dispatched", { kind: "technische_dienst", taskId: j.taskId, houseNumber: j.houseNumber, vehicleId: j.cartId });
      if (this.cartStall(j.cartId)?.id === pick2.stall) {
        j.phase = "working";
        this.techWalkIn(j);
      } else {
        j.phase = "driving";
        this.traffic.requestDeparture(j.cartId, { type: "service", job: "repair", stallId: pick2.stall, dwellSec: -1, exitPortal: "", houseNumber: j.houseNumber, taskId: j.taskId });
      }
    }
  }
  techWalkIn(j) {
    const cart = this.traffic.vehicles.find((v) => v.spec.id === j.cartId);
    const house2 = this.net.houses.find((h) => h.number === j.houseNumber);
    if (j.released) {
      this.returnCart(j);
      return;
    }
    this.traffic.spawnPedestrian({ name: "Monteur", color: "#f08a24", path: this.walkPath(house2.door, cart, 0).reverse(), purpose: "tech_in", vehicleId: cart.spec.id, bookingId: j.taskId, speed: 1.35 });
  }
  techWalkBack(j) {
    const cart = this.traffic.vehicles.find((v) => v.spec.id === j.cartId);
    const house2 = this.net.houses.find((h) => h.number === j.houseNumber);
    if (!cart) {
      this.techJobs.delete(j.taskId);
      return;
    }
    j.phase = "walking_back";
    j.techInside = false;
    this.traffic.spawnPedestrian({ name: "Monteur", color: "#f08a24", path: this.walkPath(house2.door, cart, 0), purpose: "tech_out", vehicleId: cart.spec.id, bookingId: j.taskId, speed: 1.35 });
  }
  returnCart(j) {
    const cart = this.traffic.vehicles.find((v) => v.spec.id === j.cartId);
    const here3 = j.cartId ? this.cartStall(j.cartId) : void 0;
    this.techJobs.delete(j.taskId);
    if (!cart || here3?.kind === "depot") return;
    const home = [...this.net.stalls.values()].filter((s) => s.kind === "depot" && !this.stallBusy(s.id, cart.spec.id))[0];
    if (!home) {
      this.traffic.releaseDwell(cart.spec.id, { type: "service", job: "repair", stallId: here3?.id, dwellSec: -1, exitPortal: "" });
      return;
    }
    this.traffic.releaseDwell(cart.spec.id, { type: "service", job: "return", stallId: home.id, exitPortal: "" });
    this.hooks.onEvent("service.returning", { kind: "technische_dienst", taskId: j.taskId, vehicleId: cart.spec.id });
  }
  stepTech() {
    this.tryAssignTech();
    for (const j of this.techJobs.values()) {
      if (j.phase !== "driving") continue;
      const cart = this.traffic.vehicles.find((v) => v.spec.id === j.cartId);
      if (cart && cart.state === "dwell") {
        j.phase = "working";
        this.techWalkIn(j);
      }
    }
  }
  // ---------------------------------------------------------------- tick
  step(dt) {
    const before = new Set(this.traffic.vehicles.filter((v) => v.state === "dwell").map((v) => v.spec.id));
    this.routePatrols();
    this.traffic.step(dt);
    for (const v of this.traffic.vehicles) if (v.state === "dwell" && !before.has(v.spec.id)) this.startCleaner(v);
    if (Math.floor(this.t / 2) !== Math.floor((this.t - dt) / 2)) this.dispatchService();
    if (Math.floor(this.t) !== Math.floor(this.t - dt)) this.stepTech();
    for (const b of this.bookings.values()) {
      if ((b.status === "queued_in" || b.status === "queued_out") && b.queuedAt !== void 0 && this.t - b.queuedAt > 120) b.satisfaction = Math.max(0.2, b.satisfaction - 4e-4 * dt);
    }
    for (const [id, b] of this.bookings) if (b.status === "exited" && b.departedAt !== void 0 && this.t - b.departedAt > 600) this.bookings.delete(id);
  }
  portalOf(spawnEdge) {
    return [...this.net.portals.values()].find((p) => p.spawnEdge === spawnEdge)?.id ?? this.servicePortals[0];
  }
  /** Which inbound / outbound gate a household of this bungalow uses: the one on the shortest legal route. */
  gatesFor(house2) {
    const hit = this.gateCache.get(house2);
    if (hit) return hit;
    const st = this.net.stallsByHouse.get(house2);
    if (!st) return { in: "", out: "" };
    const portal = this.net.portals.get(this.visitorPortal);
    const pick2 = (dir, from, to) => {
      let best = { id: "", len: Infinity };
      for (const g of this.net.gates.values()) {
        if (g.direction !== dir || g.staff) continue;
        const a = findRoute(this.net, from, g.edge, "visitor"), b = a ? findRoute(this.net, g.edge, to, "visitor") : null;
        if (!a || !b) continue;
        const len = this.traffic.routeLength([...a, ...b.slice(1)]);
        if (len < best.len) best = { id: g.id, len };
      }
      return best.id;
    };
    const res = { in: pick2("inbound", portal.spawnEdge, st.inEdge), out: pick2("outbound", st.outEdge, portal.despawnEdge) };
    this.gateCache.set(house2, res);
    return res;
  }
  /** Patrol vans: replace the plain portal->portal route by portal -> turning circle -> portal once spawned. */
  routePatrols() {
    for (const v of this.traffic.vehicles) {
      if (v.mission.type !== "service" || v.mission.job !== "patrol" || v.patrolRouted) continue;
      if (v.ri !== 0) continue;
      const exit = this.net.portals.get(v.mission.exitPortal).despawnEdge;
      const region = this.serviceRegion(this.portalOf(v.route[0]));
      const loops = this.patrolLoops.filter((l) => region.fwd.has(l) && this.serviceRegion(v.mission.type === "service" ? v.mission.exitPortal : "").back.has(l));
      const pool = loops.length ? loops : this.patrolLoops;
      const loop = pool.length ? pool[Math.abs(hashStr(v.spec.id)) % pool.length] : "";
      const a = loop ? findRoute(this.net, v.route[0], loop, "service") : null;
      const b = a ? findRoute(this.net, loop, exit, "service") : null;
      if (a && b) {
        const s = v.s;
        const route = [...a, ...b.slice(1)];
        v.route = route;
        v.cum = [];
        let c = 0;
        for (const id of route) {
          v.cum.push(c);
          c += this.net.edges.get(id).line.length;
        }
        v.s = s;
        v.ri = 0;
      }
      v.patrolRouted = true;
    }
  }
  averageSatisfaction() {
    const act = [...this.bookings.values()].filter((b) => b.status !== "exited");
    if (!act.length) return 0.82;
    return act.reduce((a, b) => a + b.satisfaction, 0) / act.length;
  }
  serialize() {
    return JSON.stringify({ seq: this.seq, rng: this.rand.state(), serviceNext: this.serviceNext, bookings: [...this.bookings.values()], houses: [...this.houses.entries()], techJobs: [...this.techJobs.values()], traffic: this.traffic.serialize() });
  }
  restore(json) {
    const d = JSON.parse(json);
    this.seq = d.seq;
    this.rand.setState(d.rng);
    this.serviceNext = d.serviceNext;
    this.bookings = new Map(d.bookings.map((b) => [b.id, b]));
    this.houses = new Map(d.houses);
    this.techJobs = new Map((d.techJobs ?? []).map((j) => [j.taskId, j]));
    this.traffic.restore(d.traffic);
  }
};
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = h * 31 + s.charCodeAt(i) | 0;
  return h;
}

// src/shared/tasklib.ts
var G = {
  onderhoud: { category: "Onderhoud", icon: "wrench", fx: "spark", location: { kind: "house", occupied: true }, td: true, claimMin: 12, cooldownMin: 240, onComplete: { tech: 0.3, mood: 0.1 }, onTimeout: { tech: -0.1, mood: -0.1 } },
  schoonmaak: { category: "Schoonmaak", icon: "broom", fx: "sparkle", location: { kind: "house", occupied: true }, claimMin: 10, cooldownMin: 180, onComplete: { clean: 0.35, mood: 0.05 }, onTimeout: { clean: -0.1, mood: -0.08 } },
  receptie: { category: "Receptie", icon: "key", fx: "ring", location: { kind: "facility", facilities: ["A"] }, claimMin: 8, cooldownMin: 120, onComplete: { mood: 0.15 }, onTimeout: { mood: -0.12 } },
  horeca: { category: "Horeca", icon: "food", fx: "bubble", location: { kind: "facility", facilities: ["G", "H"] }, claimMin: 8, cooldownMin: 90, onComplete: { mood: 0.1, tech: 0.1 }, onTimeout: { mood: -0.1 } },
  golf: { category: "Golf", icon: "golf", fx: "leaf", location: { kind: "facility", facilities: ["O", "L", "U", "R"] }, claimMin: 12, cooldownMin: 120, onComplete: { tech: 0.15, mood: 0.1 }, onTimeout: { mood: -0.1, tech: -0.05 } },
  water: { category: "Water & steigers", icon: "boat", fx: "splash", location: { kind: "house", occupied: true, feature: "villa" }, claimMin: 12, cooldownMin: 150, onComplete: { mood: 0.12, tech: 0.1 }, onTimeout: { mood: -0.1 } },
  terrein: { category: "Terrein", icon: "tree", fx: "leaf", location: { kind: "grounds" }, claimMin: 15, cooldownMin: 180, onComplete: { tech: 0.15 }, onTimeout: { tech: -0.08, mood: -0.04 } },
  natuur: { category: "Natuur", icon: "paw", fx: "leaf", location: { kind: "grounds" }, td: true, claimMin: 15, cooldownMin: 240, onComplete: { mood: 0.1 }, onTimeout: { mood: -0.08 } },
  recreatie: { category: "Recreatie", icon: "star", fx: "note", location: { kind: "facility", facilities: ["Q", "S", "Z", "CP", "N"] }, claimMin: 12, cooldownMin: 150, onComplete: { mood: 0.15 }, onTimeout: { mood: -0.1 } },
  chaos: { category: "Chaos", icon: "bolt", fx: "confetti", location: { kind: "grounds" }, claimMin: 15, cooldownMin: 600, onComplete: { mood: 0.15 }, onTimeout: { mood: -0.12 } }
};
function t(group, code, title, text, difficulty, urgency, weight, o = {}) {
  const g = G[group];
  const { texts2, ...rest } = o;
  return {
    code,
    group,
    category: g.category,
    title,
    texts: [text, ...texts2 ?? []],
    icon: g.icon,
    fx: g.fx,
    difficulty,
    urgency,
    claimMin: g.claimMin,
    offeredMaxMin: 45,
    location: g.location,
    when: {},
    weight,
    cooldownMin: g.cooldownMin,
    td: g.td,
    onComplete: g.onComplete,
    onTimeout: g.onTimeout,
    ...rest
  };
}
var house = (o = {}) => ({ kind: "house", occupied: true, ...o });
var fac = (...f) => ({ kind: "facility", facilities: f });
var GROUNDS = { kind: "grounds" };
var DAY = { day: true };
var NIGHT = { night: true };
var TEMPLATES = [
  // ---------------------------------------------------------------- 1. Onderhoud (technische dienst vanaf De loods, golfkar)
  t("onderhoud", "MAINT_BLOCKED_TOILET", "Verstopt toilet", "In {loc} heeft iemand geprobeerd een badeend door te spoelen. Ontstoppen graag.", "medium", "high", 1.1, { claimMin: 8, onTimeout: { tech: -0.15, mood: -0.15, clean: -0.1, escalate: "HK_URGENT_TURNOVER" }, texts2: ["Het toilet in {loc} maakt een geluid alsof er een walvis in woont. Even kijken?"] }),
  t("onderhoud", "MAINT_LEAKING_TAP", "Lekkende kraan", "De designkraan in de keuken van {loc} druppelt in het ritme van een technobeat. Vervang het binnenwerk.", "medium", "normal", 1.1, { claimMin: 10, onTimeout: { tech: -0.15, mood: -0.05, escalate: "MAINT_WATER_DAMAGE" } }),
  t("onderhoud", "MAINT_COLD_SHOWER", "Koude regendouche", "In {loc} komt alleen ijswater uit de regendouche. Controleer de warmtepomp.", "medium", "high", 1, { claimMin: 10, texts2: ["De gasten van {loc} douchen nu in drie seconden recordtijd. Warmtepomp checken!"] }),
  t("onderhoud", "MAINT_FLOOR_HEATING", "Vloerverwarming koud", "De vloerverwarming in {loc} staat op 21 graden, de tegels vinden 14 ook prima. Verdeler ontluchten en controleren.", "medium", "high", 0.9),
  t("onderhoud", "MAINT_POWER_OUTAGE", "Stroom uitgevallen", "In {loc} viel de stroom uit toen de oven, de sauna en de jacuzzi tegelijk aangingen. Aardlekschakelaar controleren.", "hard", "high", 0.7, { claimMin: 12, onTimeout: { tech: -0.2, mood: -0.2 } }),
  t("onderhoud", "MAINT_POOL_PUMP", "Pomp privezwembad", "De pomp van het privezwembad bij {loc} bromt als een grasmaaier en het water wordt troebel. Filter en pomp nakijken.", "medium", "high", 1, { location: house({ feature: "pool" }), onTimeout: { tech: -0.15, mood: -0.12 } }),
  t("onderhoud", "MAINT_JACUZZI_COLD", "Jacuzzi blijft koud", "De jacuzzi op het terras van {loc} borrelt wel, maar wordt niet warm. Verwarmingselement controleren.", "medium", "normal", 0.9, { location: house({ feature: "villa" }) }),
  t("onderhoud", "MAINT_SAUNA_HEATER", "Sauna-kachel stuk", 'De sauna in {loc} komt niet boven de 40 graden. De gasten noemen het inmiddels een "lauwe hut". Kachel nakijken.', "medium", "normal", 0.8, { location: house({ feature: "villa" }) }),
  t("onderhoud", "MAINT_SLIDING_DOOR", "Schuifpui klemt", "De grote schuifpui naar het terras van {loc} gaat alleen nog open met twee man en een aanloop. Rails en wielen afstellen.", "easy", "normal", 1),
  t("onderhoud", "MAINT_SMART_HOME", "Domotica in de war", "In {loc} gaan de lampen aan als iemand de tv uitzet, en de screens zakken bij elke deurbel. Domotica resetten.", "medium", "normal", 0.8),
  t("onderhoud", "MAINT_SMOKE_DETECTOR", "Rookmelder piept", "De rookmelder in {loc} piept elke 40 seconden. De batterij wil met pensioen.", "easy", "high", 0.9, { claimMin: 8, when: NIGHT }),
  t("onderhoud", "MAINT_TERRACE_LIGHT", "Tuinverlichting stuk", "De tuinverlichting bij {loc} knippert als een discobal. Spotje en trafo vervangen.", "easy", "normal", 0.8, { when: NIGHT }),
  t("onderhoud", "MAINT_SOLAR_FAULT", "Zonnepanelen storing", "De omvormer van de zonnepanelen op {loc} geeft een rode foutcode. Uitlezen en herstarten.", "easy", "normal", 0.7),
  // ---------------------------------------------------------------- 2. Schoonmaak
  t("schoonmaak", "HK_UNCLEAN_VILLA", "Villa niet schoon", "De nieuwe gasten van {loc} vonden een zandspoor van de steiger tot in de slaapkamer. Snel een nette ronde.", "medium", "high", 1),
  t("schoonmaak", "HK_DIRTY_SHEETS", "Vies beddengoed", "Het beddengoed in {loc} heeft verdacht veel weg van een picknickkleed. Verschonen graag.", "easy", "normal", 1),
  t("schoonmaak", "HK_MISSING_TOWELS", "Handdoeken ontbreken", "In {loc} zijn vier badlakens, twee saunadoeken en een badjas spoorloos. Breng een nieuwe set.", "easy", "normal", 1.1),
  t("schoonmaak", "HK_OVERFLOWING_BIN", "Afvalbak puilt uit", "De container bij {loc} is zo vol dat de deksel een hoedje is geworden. Legen en naar het afvalpunt brengen.", "easy", "normal", 1, { location: GROUNDS }),
  t("schoonmaak", "HK_WINDOWS_STREAKS", "Strepen op de glaspui", "Op de enorme glaspui van {loc} staan kinderhandjes op precies elke hoogte. Zemen tot het glas onzichtbaar is.", "easy", "normal", 1),
  t("schoonmaak", "HK_LOST_PROPERTY", "Gevonden voorwerp", "In {loc} is een knuffelgiraf achtergebleven die dringend naar huis wil. Breng hem naar de receptie.", "easy", "normal", 0.8, { location: house({ occupied: false, vacant: true }) }),
  t("schoonmaak", "HK_MUDDY_FLOOR", "Modderige vloer", "Na een rondje golf ligt de halve fairway in {loc}. Dweilen, en de tegels weer laten glanzen.", "easy", "normal", 1.1),
  t("schoonmaak", "HK_BBQ_GREASE", "Vette barbecue", "De buitenkeuken op het terras van {loc} heeft drie barbecues achter de rug. Rooster en blad schoonmaken.", "easy", "normal", 0.9),
  t("schoonmaak", "HK_NO_TOILET_PAPER", "Wc-papier op", "In {loc} is het laatste rolletje wc-papier zojuist gebruikt. Dit is een noodgeval.", "easy", "high", 1.1, { claimMin: 6 }),
  t("schoonmaak", "HK_POOL_LEAVES", "Blad in het privezwembad", "Het privezwembad bij {loc} ligt vol blad na de wind. Schepnet erbij en de skimmer leegmaken.", "easy", "normal", 1, { location: house({ feature: "pool" }) }),
  t("schoonmaak", "HK_SANITAIR", "Sanitair bij het hart", "Bij de toiletten en douches in het hart is de zeep op en ligt er een plas bij de wastafels. Bijvullen en droogmaken.", "easy", "high", 0.9, { location: fac("J"), claimMin: 8 }),
  t("schoonmaak", "HK_URGENT_TURNOVER", "Spoedwissel", "De gasten van {loc} zijn vertrokken en de volgende staan al bijna voor de slagboom. Snelle wisselschoonmaak!", "hard", "high", 0.9, { location: house({ occupied: false, vacant: true }), claimMin: 20, onComplete: { clean: 0.6, tech: 0.05 } }),
  // ---------------------------------------------------------------- 3. Receptie
  t("receptie", "REC_MISSING_KEY", "Sleutelkaart kwijt", "De gasten van {loc} staan buitengesloten; de sleutelkaart ligt vermoedelijk in de sloep.", "easy", "high", 1.2, { location: house(), icon: "key" }),
  t("receptie", "REC_DOUBLE_BOOKING", "Dubbele boeking", "Twee gezelschappen hebben allebei {loc} geboekt en kijken elkaar wantrouwig aan. Los het op.", "hard", "high", 0.6, { location: house() }),
  t("receptie", "REC_WRONG_VILLA", "Verkeerde villa", "Een familie heeft zich gezellig geinstalleerd in {loc}, maar die was niet van hen. Breng ze naar de juiste.", "medium", "high", 0.7, { location: house() }),
  t("receptie", "REC_LATE_CHECKIN", "Late incheck", 'Een gezelschap belt dat het om 23:30 uur aankomt "na een kleine omweg via Zwolle". Regel de late incheck.', "easy", "normal", 0.8, { when: NIGHT }),
  t("receptie", "REC_EARLY_ARRIVAL", "Te vroeg", "Er staat een gezin om 10:00 uur met de golftassen al om, terwijl de villa pas om 15:00 klaar is. Bied iets leuks aan.", "easy", "normal", 0.8, { when: DAY }),
  t("receptie", "REC_ANGRY_COMPLAINT", "Boze klacht", "Een gast is boos omdat de eenden op de steiger te hard kwaken. Luister, bied excuses aan en noteer het.", "medium", "high", 0.9),
  t("receptie", "REC_GUEST_COUNT", "Aantal gasten klopt niet", "Bij {loc} staan zes personen geboekt, er stappen er elf uit twee auto's. Pas de reservering aan.", "medium", "normal", 0.6, { location: house() }),
  t("receptie", "REC_UPGRADE_REQUEST", "Upgrade-verzoek", 'De gasten van {loc} vragen of hun villa "ook een met zwembad" kan worden. Kijk wat er vrij is.', "easy", "normal", 0.7, { location: house() }),
  t("receptie", "REC_PARCEL", "Pakketje voor een villa", 'Bij de receptie ligt een pakket voor {loc}: "Breekbaar, studiomicrofoon". Breng het voorzichtig rond.', "easy", "normal", 0.8),
  t("receptie", "REC_GOLF_BOOKING", "Starttijd golfbaan", "Een gast wil morgen om 07:12 precies afslaan op hole 1, met vier personen en twee golfkarren. Regel de starttijd.", "easy", "normal", 0.8, { when: DAY }),
  t("receptie", "REC_CHECKOUT_DISPUTE", "Discussie bij uitchecken", 'De gasten van {loc} vinden dat de gebroken designvaas "er al zo stond". Handel het vriendelijk af.', "medium", "normal", 0.6, { location: house() }),
  t("receptie", "REC_CHARGER_FULL", "Laadpalen bezet", "Alle laadpalen bij het hart zijn bezet en een gast moet straks naar Schiphol. Regel een oplossing.", "easy", "high", 0.7, { when: DAY }),
  // ---------------------------------------------------------------- 4. Horeca (Brasserie Harderwold G, terras H)
  t("horeca", "FB_COFFEE_MACHINE", "Koffiemachine staakt", "De koffiemachine in {loc} sist, pruttelt en levert alleen heet water. Ontkalken!", "easy", "high", 1, { when: DAY }),
  t("horeca", "FB_MISSING_SUPPLIES", "Voorraad op", "In {loc} zijn de bitterballen op terwijl het terras vol zit met golfers. Bevoorraden.", "easy", "normal", 0.9),
  t("horeca", "FB_WRONG_ORDER", "Verkeerde bestelling", "Tafel 7 in {loc} kreeg 12 pannenkoeken in plaats van 2. Rechtzetten met een glimlach.", "easy", "normal", 0.9, { when: DAY }),
  t("horeca", "FB_COLD_MEAL", "Koud eten", 'Een gast in {loc} meldt dat zijn soep "verfrissend" is. Opnieuw opwarmen en een toetje erbij.', "easy", "normal", 0.8, { when: DAY }),
  t("horeca", "FB_QUEUE_OVERFLOW", "Rij tot buiten", "De rij bij {loc} gaat inmiddels tot aan het parkeerterrein. Help mee uitserveren.", "medium", "high", 0.7, { when: DAY }),
  t("horeca", "FB_FRIDGE_ALARM", "Koelcel-alarm", "Het alarm van de koelcel in {loc} piept. Deur dicht, temperatuur controleren.", "medium", "high", 0.6, { td: true }),
  t("horeca", "FB_RESERVATION_MIXUP", "Tafelreservering kwijt", "Twee families hebben dezelfde tafel aan het raam met uitzicht op de golfbaan. Vind een oplossing met uitzicht.", "easy", "normal", 0.7, { when: DAY }),
  t("horeca", "FB_SPILLED_DRINKS", "Drankje omgestoten", "Er is een dienblad met limonade gesneuveld in {loc}. Opdweilen voor iemand uitglijdt.", "easy", "high", 0.9, { onComplete: { clean: 0.3 } }),
  t("horeca", "FB_WINE_ORDER", "Wijn voor een villa", "De gasten van {loc} bestellen een kist wijn en een kaasplank voor vanavond. Breng het netjes rond.", "easy", "normal", 0.9, { location: house(), when: DAY }),
  t("horeca", "FB_BREAKFAST_DELIVERY", "Ontbijtservice", "Het ontbijt voor {loc} had om 8:30 op het terras moeten staan. De croissants zijn nog in de oven.", "easy", "high", 0.9, { location: house(), when: DAY }),
  t("horeca", "FB_TERRACE_WIND", "Parasols op het terras", "De wind trekt aan en de parasols op het terras klapperen als zeilen. Inklappen en vastzetten.", "easy", "high", 0.7, { location: fac("H") }),
  t("horeca", "FB_SURPRISE_GROUP", "Onverwachte groep", 'Een golfclub van 22 personen wil "even snel" lunchen in {loc}. Tafels schuiven!', "hard", "high", 0.4, { when: DAY }),
  // ---------------------------------------------------------------- 5. Golf (9-holes O, bosgolf L, adventure golf U, driving range R)
  t("golf", "GOLF_DIVOTS", "Plaggen op de fairway", "Op de fairway van {loc} liggen meer plaggen dan gras. Terugleggen en aanstampen.", "easy", "normal", 1),
  t("golf", "GOLF_GREEN_MOW", "Green maaien", "De green bij {loc} is zo hoog dat de bal er een tentje kan opzetten. Maaien met de greenmaaier.", "medium", "normal", 0.9, { td: true, when: DAY }),
  t("golf", "GOLF_BUNKER_RAKE", "Bunker harken", "In de bunker bij {loc} staan voetstappen, een zandkasteel en een emmertje. Harken en het emmertje terugbrengen.", "easy", "normal", 1),
  t("golf", "GOLF_FLAG_MISSING", "Vlag weg", 'De vlag op hole 6 van {loc} is spoorloos. Golfers mikken nu op "ongeveer daar". Nieuwe vlag plaatsen.', "easy", "high", 0.8),
  t("golf", "GOLF_BALL_MACHINE", "Ballenautomaat leeg", "De ballenautomaat van de driving range geeft geen ballen meer. Bijvullen en de muntjes legen.", "easy", "high", 1, { location: fac("R"), when: DAY }),
  t("golf", "GOLF_RANGE_PICKER", "Ballen rapen", "Op de driving range liggen duizenden ballen. Met de ballenraper erop, in de kooi.", "medium", "normal", 0.9, { location: fac("R"), td: true }),
  t("golf", "GOLF_RANGE_SCREEN", "Doelen range stuk", "Het interactieve scherm van de driving range telt elke bal als hole-in-one. Leuk, maar niet de bedoeling. Kalibreren.", "medium", "normal", 0.8, { location: fac("R") }),
  t("golf", "GOLF_CART_FLAT", "Golfkar met lekke band", "Een golfkar staat met een lekke band op het pad bij {loc}. Ophalen en de band verwisselen.", "medium", "high", 0.8, { td: true }),
  t("golf", "GOLF_LOST_BALL_POND", "Bal in de vijver", 'Een gast wil per se zijn "geluksbal" terug uit de vijver bij {loc}. Met de ballenhengel, niet zwemmen.', "easy", "normal", 0.8),
  t("golf", "GOLF_ADVENTURE_HOLE", "Adventure golf: draaimolen hapert", "Op baan 12 van de adventure golf draait de molen niet meer, de bal komt er nooit doorheen. Mechaniek nakijken.", "medium", "normal", 0.9, { location: fac("U") }),
  t("golf", "GOLF_SCORECARDS", "Scorekaarten op", "Bij {loc} zijn de scorekaartjes en de potloodjes op. Een nieuwe stapel brengen.", "easy", "normal", 0.8),
  t("golf", "GOLF_SLOW_GROUP", "Langzame flight", "Een flight van vier op {loc} zoekt al twintig minuten een bal. Er staat een rij achter. Vriendelijk laten doorspelen.", "easy", "high", 0.8, { location: fac("O", "L"), when: DAY }),
  t("golf", "GOLF_SPRINKLER", "Sproeier blijft aan", "Een sproeier op {loc} zet een tee onder water, en een golfer erbij. Kraan dicht en sproeier afstellen.", "medium", "high", 0.7, { td: true }),
  // ---------------------------------------------------------------- 6. Water & steigers (grachten, sloepen, kano's)
  t("water", "WATER_JETTY_BOARD", "Losse plank op de steiger", "Op de steiger van {loc} wipt een plank omhoog als je erop stapt. Vastschroeven voordat iemand struikelt.", "easy", "high", 1.1, { td: true }),
  t("water", "WATER_SLOEP_BATTERY", "Sloep vaart niet", "De elektrische sloep van {loc} doet het niet: de accu is leeg. Laadkabel aansluiten en de lader controleren.", "medium", "normal", 1, { td: true, when: DAY }),
  t("water", "WATER_SLOEP_DRIFT", "Sloep los", "De sloep van {loc} drijft langzaam de gracht af; de knoop was meer een strik. Ophalen met de kano en goed aanleggen.", "medium", "high", 0.8, { location: GROUNDS }),
  t("water", "WATER_KAYAK_PADDLE", "Peddel kwijt", "Bij {loc} ligt een kano zonder peddel en dobbert de peddel richting de buren. Opvissen.", "easy", "normal", 1),
  t("water", "WATER_SUP_PUMP", "SUP-board slap", "Het SUP-board van {loc} lijkt meer op een luchtbed met heimwee. Pomp en ventiel controleren.", "easy", "normal", 0.9, { when: DAY }),
  t("water", "WATER_LIFEBUOY", "Reddingsboei ontbreekt", "Bij de steiger van {loc} hangt alleen nog het haakje van de reddingsboei. Nieuwe boei ophangen.", "easy", "high", 0.8),
  t("water", "WATER_CANAL_LITTER", "Zwerfvuil in de gracht", "In de gracht bij {loc} drijven twee ballonnen, een flamingo-zwemband en een frisdrankflesje. Opvissen met het schepnet.", "easy", "normal", 1, { location: GROUNDS }),
  t("water", "WATER_DUCKWEED", "Kroos voor de steiger", "Voor de steiger van {loc} ligt zoveel kroos dat de kano niet meer vooruit komt. Kroos verwijderen.", "medium", "normal", 0.8, { when: DAY }),
  t("water", "WATER_SLOEP_RENTAL", "Sloep reserveren", "De gasten van {loc} willen morgen een rondvaart met de sloep, met lunchpakket. Regel de sloep en de vaarkaart.", "easy", "normal", 0.9, { when: DAY }),
  t("water", "WATER_FENDER", "Stootwil kapot", "De sloep van {loc} bonkt tegen de steiger omdat de stootwil lek is. Nieuwe stootwillen ophangen.", "easy", "normal", 0.8),
  t("water", "WATER_JETTY_LIGHT", "Steigerlampje uit", "Het lampje op de steiger van {loc} is uit en de gasten zoeken in het donker de sloep. Lampje vervangen.", "easy", "normal", 0.8, { when: NIGHT, td: true }),
  t("water", "WATER_FISHING", "Hengel in de boom", "Een jonge visser bij {loc} heeft zijn haak in de wilg gegooid in plaats van de gracht. Help hem los, zonder in het water te vallen.", "easy", "normal", 0.8, { location: GROUNDS, when: DAY }),
  // ---------------------------------------------------------------- 7. Terrein
  t("terrein", "GRD_FALLEN_BRANCH", "Tak op de weg", "Bij {loc} ligt een flinke tak over de weg. Opruimen voordat er een golfkar overheen hobbelt.", "easy", "high", 1),
  t("terrein", "GRD_HEDGE_TRIM", "Haag knippen", "De haag bij {loc} groeit zo hard dat de villa er straks achter verdwijnt. Netjes in model knippen.", "medium", "normal", 1, { when: DAY }),
  t("terrein", "GRD_FLOODED_PATH", "Plas op het pad", "Het pad bij {loc} staat onder water. Gasten springen er als kikkers overheen. Put en afvoer vrijmaken.", "medium", "normal", 0.9),
  t("terrein", "GRD_LAWN_MOW", "Gazon maaien", "Het gazon bij {loc} is zo hoog dat de robotmaaier vastzit. Robotmaaier bevrijden en de rest maaien.", "medium", "normal", 0.9, { when: DAY }),
  t("terrein", "GRD_STREETLIGHT", "Lantaarn kapot", "De lantaarnpaal bij {loc} knippert als een vuurtoren. Lamp vervangen.", "easy", "normal", 0.9, { when: NIGHT, td: true }),
  t("terrein", "GRD_PARKING_LINES", "Parkeervakken vervaagd", "Op het parkeerterrein bij het hart staan auto's kriskras door elkaar. De lijnen moeten opnieuw.", "medium", "normal", 0.6, { location: fac("A") }),
  t("terrein", "GRD_BIN_FULL", "Afvalpunt vol", "Bij het afvalpunt ligt het glas naast de container. Opruimen en een melding maken voor ophalen.", "easy", "normal", 1, { location: fac("X") }),
  t("terrein", "GRD_MILIEUSTRAAT", "Milieustraat ordenen", "In de milieustraat staat een tuinstoel tussen het papier en een bank bij het glas. Sorteren en opruimen.", "medium", "normal", 0.7, { location: fac("D") }),
  t("terrein", "GRD_SIGNPOST", "Wegwijzer gedraaid", "Iemand heeft de wegwijzer bij {loc} omgedraaid. Drie families zijn nu op weg naar de milieustraat in plaats van naar de brasserie.", "easy", "normal", 0.8),
  t("terrein", "GRD_CHARGER", "Laadpaal storing", "Een laadpaal bij het hart geeft een foutmelding en de auto laadt niet. Paal resetten en de kabel controleren.", "medium", "high", 0.7, { location: fac("EV", "A"), td: true }),
  t("terrein", "GRD_CHEM_TOILET", "Stortplaats chemisch toilet", "Bij het stortpunt voor chemische toiletten loopt de afvoer niet goed. Doorspoelen en schoonmaken.", "medium", "normal", 0.6, { location: fac("K") }),
  t("terrein", "GRD_POTHOLE", "Kuil in de weg", "In de weg bij {loc} zit een kuil waar je een golfbal in kwijt kunt. Tijdelijk dichten en markeren.", "medium", "normal", 0.7, { td: true }),
  // ---------------------------------------------------------------- 8. Natuur
  t("natuur", "NAT_WASP_NEST", "Wespennest", "Onder de dakrand van {loc} hangt een wespennest. Laat het veilig weghalen en houd de gasten op afstand.", "medium", "high", 0.8, { when: DAY }),
  t("natuur", "NAT_HERON_FISH", "Reiger steelt vis", "De reiger bij {loc} heeft geleerd dat gasten op de steiger vissen. Hij steelt de vangst. Gasten tips geven.", "easy", "normal", 0.9),
  t("natuur", "NAT_DUCKS_TERRACE", "Eenden op het terras", "Een eendenfamilie bij {loc} heeft het terras uitgeroepen tot cr\xE8che. Rustig terugleiden naar de gracht.", "easy", "normal", 1),
  t("natuur", "NAT_SWAN_JETTY", "Zwaan bewaakt de steiger", "Een zwaan bij {loc} vindt de steiger van hem. De gasten durven niet naar de sloep. Met geduld en afstand oplossen.", "medium", "normal", 0.8),
  t("natuur", "NAT_RABBITS_GOLF", "Konijnen op de green", "Konijnen graven gaten in de green bij {loc}. Gaten dichten en kijken waar ze vandaan komen.", "easy", "normal", 0.9, { location: fac("O", "L") }),
  t("natuur", "NAT_TOADS", "Paddentrek", "Op de weg bij {loc} steken tientallen padden over. Borden plaatsen en emmertjes klaarzetten.", "easy", "high", 0.7, { when: NIGHT }),
  t("natuur", "NAT_HEDGEHOG", "Egel in de put", "In de put bij {loc} zit een egel die er zelf niet uit komt. Voorzichtig eruit tillen (handschoenen aan).", "easy", "high", 0.8),
  t("natuur", "NAT_FOX_BINS", "Vos bij de containers", "Een vos heeft de afvalzakken bij {loc} opengetrokken. Opruimen en de deksels goed dichtmaken.", "easy", "normal", 0.8),
  t("natuur", "NAT_ALGAE_SPOT", "Groene vlek in de gracht", "In de gracht bij {loc} drijft een groene laag. Monster nemen en de waterbeheerder bellen.", "medium", "normal", 0.6),
  t("natuur", "NAT_MOLE_LAWN", "Mollenhopen", "Het gazon bij {loc} ziet eruit als een maanlandschap. Hopen egaliseren.", "easy", "normal", 0.8),
  t("natuur", "NAT_OWL_NOISE", "Uil houdt gasten wakker", "Een bosuil bij {loc} roept de hele nacht. De gasten willen slapen, de uil niet. Oordoppen en een verhaal over de uil.", "easy", "normal", 0.6, { when: NIGHT }),
  t("natuur", "NAT_BIRD_BOX", "Nestkastjes nakijken", "Bij {loc} hangen nestkastjes scheef na de wind. Rechtzetten en er een nieuwe bij hangen.", "easy", "normal", 0.7, { when: DAY }),
  // ---------------------------------------------------------------- 9. Recreatie (tennis Q, speeltuin S, jeu de boules Z, camperplaatsen CP, Residentie N)
  t("recreatie", "FUN_TENNIS_NET", "Tennisnet slap", "Het net van de tennisbaan hangt zo laag dat je eroverheen kunt stappen. Spannen en de lijnen vegen.", "easy", "normal", 1, { location: fac("Q") }),
  t("recreatie", "FUN_TENNIS_BALLS", "Tennisballen kwijt", "Alle ballen van de tennisbaan zijn in de haag verdwenen. Zoeken en een nieuwe koker brengen.", "easy", "normal", 0.9, { location: fac("Q"), when: DAY }),
  t("recreatie", "FUN_PLAYGROUND_SWING", "Schommel kapot", "Een schommel in {loc} hangt aan een ketting. Afzetten en laten repareren.", "medium", "high", 0.9, { location: fac("S"), td: true }),
  t("recreatie", "FUN_PLAYGROUND_SAND", "Zandbak opknappen", "De zandbak in {loc} is vooral blad en een verloren schepje. Harken en aanvullen.", "easy", "normal", 0.8, { location: fac("S"), when: DAY }),
  t("recreatie", "FUN_BOULES_TOURNAMENT", "Jeu-de-boulestoernooi", "Vanmiddag is het jeu-de-boulestoernooi. Baan harken, ballen tellen en een scorebord klaarzetten.", "medium", "normal", 0.9, { location: fac("Z"), when: DAY }),
  t("recreatie", "FUN_CAMPER_POWER", "Stroom camperplaats", "Op een camperplaats valt de stroom steeds uit als de koffiezetter aangaat. Stroomkast nakijken.", "medium", "high", 0.9, { location: fac("CP"), td: true }),
  t("recreatie", "FUN_CAMPER_ARRIVAL", "Camper zoekt plek", "Een camper van 9 meter wil op plek 4, waar een camper van 6 meter staat. Puzzel het samen op.", "easy", "normal", 0.9, { location: fac("CP") }),
  t("recreatie", "FUN_CAMPER_WATER", "Watertappunt camperplaats", "Het watertappunt bij de camperplaatsen sputtert. Kraan en slang controleren.", "easy", "normal", 0.7, { location: fac("CP") }),
  t("recreatie", "FUN_RESIDENTIE_LIFT", "Lift Residentie", "De lift in Residentie Harderwold blijft op de eerste verdieping hangen. Melding maken en gasten met bagage helpen.", "medium", "high", 0.8, { location: fac("N"), td: true }),
  t("recreatie", "FUN_RESIDENTIE_TERRACE", "Dakterras Residentie", "Op een dakterras van de Residentie staat de loungeset in de vijver van de regenput. Afdekken en drogen.", "easy", "normal", 0.8, { location: fac("N") }),
  t("recreatie", "FUN_KIDS_CLUB", "Kinderclub op stap", "De kinderclub gaat een speurtocht doen langs de grachten. Begeleid de groep en tel ze bij terugkomst.", "medium", "normal", 0.9, { location: fac("S"), when: DAY }),
  t("recreatie", "FUN_YOGA_JETTY", "Yoga bij het water", "Morgenochtend is er yoga in het gras bij de Residentie. Matjes klaarleggen en de muziekbox opladen.", "easy", "normal", 0.8, { location: fac("N", "Z"), when: DAY }),
  // ---------------------------------------------------------------- 10. Komische chaos
  t("chaos", "CHAOS_FLAMINGO", "Flamingo op drift", "Een reuzenflamingo-zwemband vaart al een uur stuurloos door de grachten. Gasten maken er foto's van. Opvissen bij {loc}.", "easy", "normal", 0.9, { location: GROUNDS }),
  t("chaos", "CHAOS_DRONE", "Drone in de boom", "Een drone van een gast hangt in de boom bij {loc}. Met de hoogwerker van De werf ophalen.", "medium", "normal", 0.8, { td: true }),
  t("chaos", "CHAOS_GOLFCART_POOL", "Golfkar in de sloot", 'Een gast heeft een golfkar "even geparkeerd" met de voorwielen in de sloot bij {loc}. Lostrekken en controleren.', "medium", "high", 0.6, { td: true }),
  t("chaos", "CHAOS_KARAOKE", "Karaoke op de steiger", "Bij {loc} wordt om middernacht karaoke gezongen op de steiger. Het hele kanaal zingt mee, of juist niet.", "easy", "high", 0.7, { location: house({ feature: "villa" }), when: NIGHT }),
  t("chaos", "CHAOS_CAKE", "Taart voor de verkeerde villa", "De verjaardagstaart voor villa 412 is bij {loc} afgeleverd en daar half opgegeten. Een nieuwe regelen.", "medium", "normal", 0.7, { location: house() }),
  t("chaos", "CHAOS_ROBOMOWER", "Robotmaaier op avontuur", "Een robotmaaier is ontsnapt en maait nu een pad over de golfbaan bij {loc}. Terugbrengen.", "easy", "normal", 0.8),
  t("chaos", "CHAOS_PARTY_BOAT", "Feestsloep", "Een sloep met een speaker van een meter hoog vaart rondjes door de grachten bij {loc}. Vriendelijk vragen om het zachter te zetten.", "easy", "high", 0.8, { location: GROUNDS }),
  t("chaos", "CHAOS_WEDDING_PHOTO", "Trouwfoto op de steiger", "Een bruidspaar wil een fotoshoot op de steiger van {loc}, maar die villa is niet van hen. Regel een betere plek.", "easy", "normal", 0.6, { location: house({ feature: "villa" }), when: DAY }),
  t("chaos", "CHAOS_GOLF_BALL_WINDOW", "Golfbal door de ruit", "Een golfbal is via het dak van een golfkar in de brievenbus van {loc} beland. Excuses en een ballenquiz-voucher.", "easy", "normal", 0.7, { location: house() }),
  t("chaos", "CHAOS_INFLATABLE_SWAN", "Opblaaszwaan in de jacuzzi", "In de jacuzzi van {loc} zit een opblaaszwaan die niet meer leegloopt. De echte zwaan bij de steiger kijkt jaloers.", "easy", "normal", 0.6, { location: house({ feature: "villa" }) }),
  t("chaos", "CHAOS_MAGPIE", "Schoenendief", "Een ekster bij {loc} pikt glimmende dingen van de terrassen: een zonnebril, een ring, een theelepeltje. Terugvinden.", "medium", "normal", 0.6),
  t("chaos", "CHAOS_DOUBLE_SLOEP", "Twee sloepen, een steiger", "Twee gasten hebben dezelfde sloep geboekt en staan allebei aan boord. Regel snel een tweede sloep.", "medium", "high", 0.5, { location: house({ feature: "villa" }) }),
  // ---------------------------------------------------------------- follow-ups (escalation targets, not scheduled on their own)
  t("onderhoud", "MAINT_WATER_DAMAGE", "Waterschade", "De lekkende kraan in {loc} is genegeerd en er staat nu water op de vloer. Droogleggen en de oorzaak verhelpen.", "hard", "high", 0, { claimMin: 20, onComplete: { tech: 0.4, mood: 0.1, clean: 0.2 }, onTimeout: { tech: -0.2, mood: -0.2 } }),
  // ---------------------------------------------------------------- crisis subtasks (one process over time per crisis)
  ...[
    ["onderhoud", "CR_WATER_MAIN_VALVE", "Hoofdkraan dichtdraaien", "Bij de gesprongen waterleiding moet de hoofdkraan dicht. Neem de sleutel mee uit De werf.", "hard", "critical", fac("I")],
    ["terrein", "CR_WATER_SIGNS", "Gebied afzetten", "Zet het natte gebied rond de gesprongen leiding af met linten en borden, zodat niemand door de modder loopt.", "easy", "high", GROUNDS],
    ["receptie", "CR_WATER_BOTTLES", "Water uitdelen", "Zolang de leiding dicht is: deel flessen water uit aan de villa's in de getroffen straten.", "medium", "high", fac("V", "A")],
    ["receptie", "CR_WATER_INFORM", "Straten informeren", "Ga langs de villa's in de getroffen straten: hoe lang het water nog uit blijft en waar flessen water te halen zijn.", "medium", "high", fac("A")],
    ["onderhoud", "CR_WATER_MAIN_REPAIR", "Waterleiding repareren", "Vervang het gesprongen stuk leiding samen met de loodgieter.", "crisis", "critical", GROUNDS],
    ["onderhoud", "CR_WATER_FLUSH", "Leidingen doorspoelen", "Het water is terug maar komt bruin uit de kraan. Spoel de leidingen in de straat door tot het helder is.", "medium", "high", fac("I")],
    ["schoonmaak", "CR_WATER_CLEANUP", "Modder opruimen", "Rond de reparatieplek ligt een modderspoor tot op de terrassen. Opruimen en paden schoonspuiten.", "medium", "normal", GROUNDS],
    ["onderhoud", "CR_BLACKOUT_FUSEBOX", "Hoofdverdeler controleren", "Een groot deel van het park zit zonder stroom. Controleer de hoofdverdeler bij De werf.", "hard", "critical", fac("I")],
    ["receptie", "CR_BLACKOUT_TORCHES", "Zaklampen uitdelen", "Deel zaklampen en waxinelichtjes (in glazen houders) uit bij de receptie.", "easy", "high", fac("A")],
    ["onderhoud", "CR_BLACKOUT_GENERATOR", "Noodaggregaat starten", "Start het noodaggregaat voor de receptie en de koelcellen. Controleer eerst of de ruimte goed geventileerd is.", "hard", "critical", fac("I")],
    ["horeca", "CR_BLACKOUT_FRIDGES", "Koelcellen controleren", "Meet de temperatuur van de koelcellen en zet wat te warm wordt apart. Noteer alles voor de voedselveiligheid.", "medium", "high", fac("G")],
    ["receptie", "CR_BLACKOUT_ROUNDS", "Ronde langs de villa's", "Loop een ronde langs villa's met oudere gasten en gezinnen met baby's: is alles in orde, hebben ze een zaklamp?", "medium", "high", fac("A")],
    ["onderhoud", "CR_BLACKOUT_RESTART", "Installaties herstarten", "De stroom is terug: herstart de pompen van de privezwembaden en de koelcellen van de brasserie.", "medium", "high", fac("G", "I")],
    ["receptie", "CR_CHECKIN_SYSTEM", "Reserveringssysteem herstarten", "Het reserveringssysteem is gecrasht en er staat een rij tot aan de slagboom. Herstart het systeem.", "hard", "critical", fac("A")],
    ["receptie", "CR_CHECKIN_PAPER", "Handmatig inchecken", "Zolang het systeem plat ligt: check gasten handmatig in op papier.", "medium", "high", fac("A")],
    ["horeca", "CR_CHECKIN_COFFEE", "Koffie in de rij", "De rij voor de receptie wordt langer. Deel koffie, thee en limonade uit aan wachtende gasten.", "easy", "high", fac("A", "G")],
    ["terrein", "CR_CHECKIN_TRAFFIC", "Wachtende auto's begeleiden", "Bij de slagboom staat een rij. Wijs wachtende auto's een veilige plek op het parkeerterrein, zodat de ingangsweg vrij blijft.", "medium", "high", fac("A")],
    ["receptie", "CR_CHECKIN_KEYS", "Sleutelkaarten handmatig uitgeven", "Het systeem draait weer half. Geef de sleutelkaarten uit met de papieren lijst en vink ze af.", "medium", "high", fac("A")],
    ["receptie", "CR_CHECKIN_SORRY", "Excuses aanbieden", "Alle gasten zijn binnen. Breng de gedupeerden een kaartje met excuses en een bon voor de brasserie.", "easy", "normal", fac("A")],
    ["receptie", "CR_STORM_INFORM", "Onweer: gasten waarschuwen", "Er komt zwaar onweer aan. Waarschuw gasten op de golfbaan, op het water en op de steigers om naar binnen te gaan.", "easy", "critical", fac("A")],
    ["horeca", "CR_STORM_TERRACE", "Terras stormvrij maken", "Klap de parasols in en zet het terrasmeubilair binnen of vast voordat de wind aantrekt.", "medium", "high", fac("H", "G")],
    ["golf", "CR_STORM_GOLF_OUT", "Golfbaan ontruimen", "Haal alle flights van de golfbaan en de driving range: bij onweer is golfen niet veilig.", "medium", "critical", fac("O", "R", "L")],
    ["water", "CR_STORM_SLOEPEN", "Sloepen vastleggen", "Controleer langs de grachten of alle sloepen dubbel vastliggen en haal kano's en SUP's uit het water.", "medium", "high", GROUNDS],
    ["terrein", "CR_STORM_TREE", "Omgewaaide boom", "Bij {loc} ligt een boom over de weg. Zet het af en laat De werf hem met de juiste uitrusting weghalen.", "hard", "high", GROUNDS],
    ["onderhoud", "CR_STORM_LEAK", "Lekkage na de bui", "In een villa bij {loc} lekt het langs de dakrand. Zet emmers neer en dicht het lek tijdelijk af.", "medium", "high", GROUNDS],
    ["terrein", "CR_STORM_CLEANUP", "Takken opruimen", "De bui is over. Ruim de takken en bladeren op de wegen, paden en steigers op.", "medium", "normal", GROUNDS],
    ["horeca", "CR_FIRE_EVACUATE", "Brasserie ontruimen", "Het brandalarm in de keuken gaat af. Begeleid alle gasten rustig naar het verzamelpunt op het parkeerterrein.", "medium", "critical", fac("G")],
    ["receptie", "CR_FIRE_HEADCOUNT", "Iedereen geteld?", "Tel bij het verzamelpunt personeel en gasten met de aanwezigheidslijst. Niemand gaat terug naar binnen.", "medium", "critical", fac("A")],
    ["receptie", "CR_FIRE_BRIGADE", "Brandweer opvangen", "De brandweer komt eraan. Vang ze op bij de slagboom en wijs de snelste route naar het hart.", "medium", "critical", fac("A")],
    ["onderhoud", "CR_FIRE_KITCHEN", "Afzuiging nakijken", "Het was rook van een pan, geen brand. Laat de afzuiging en de melder in de keuken controleren en resetten.", "hard", "high", fac("G")],
    ["schoonmaak", "CR_FIRE_AIR", "Luchten en schoonmaken", "Zet ramen en deuren open en maak de keuken en de eetzaal roetvrij voordat er weer gasten in mogen.", "medium", "high", fac("G")],
    ["horeca", "CR_FIRE_REOPEN", "Weer open met een traktatie", "De brasserie mag weer open. Ontvang de gasten met een gratis toetje voor het wachten.", "easy", "normal", fac("G")],
    ["receptie", "CR_PRESS_DESK", "Perspunt inrichten", "Er staan fotografen bij de receptie omdat er een bekende artiest op schrijverskamp is. Richt een vast perspunt in.", "medium", "high", fac("A")],
    ["terrein", "CR_PRESS_PARKING", "Persbusjes parkeren", "De busjes van de pers blokkeren de ingangsweg. Wijs ze een plek aan op het parkeerterrein.", "medium", "high", fac("A")],
    ["terrein", "CR_PRESS_PRIVACY", "Villa's afschermen", "Een paar fotografen lopen het park in en een sloep met een telelens vaart door de gracht. Begeleid ze terug.", "hard", "high", GROUNDS],
    ["horeca", "CR_PRESS_COFFEE", "Koffie voor de pers", "Wachtende pers is rustiger met koffie. Zet bij het perspunt een koffietafel neer.", "easy", "normal", fac("A", "G")],
    ["receptie", "CR_PRESS_STATEMENT", "Korte verklaring", "Lees bij het perspunt een korte, vriendelijke verklaring voor: het park geeft geen informatie over gasten.", "medium", "normal", fac("A")],
    ["recreatie", "CR_PRESS_TOUR", "Rondleiding voor de pers", "Geef de pers een rondleiding langs de golfbaan en de grachten, zodat ze iets moois kunnen filmen zonder gasten te storen.", "medium", "normal", fac("N", "Z")],
    ["onderhoud", "CR_WIFI_ROUTER", "Netwerk herstarten", "De hoofdrouter bij De werf hangt. Herstart hem volgens de checklist en kijk welke lampjes branden.", "hard", "critical", fac("I")],
    ["receptie", "CR_WIFI_HOTSPOT", "Noodhotspot voor de studio", "Een artiest op schrijverskamp moet nu een demo uploaden. Zet bij de receptie de mobiele noodhotspot aan.", "medium", "critical", fac("A")],
    ["receptie", "CR_WIFI_INFORM", "Gasten informeren over wifi", "Gasten bellen massaal over het wifi. Zet een bericht in de app en leg uit wanneer het weer werkt.", "easy", "high", fac("A")],
    ["onderhoud", "CR_WIFI_CABLE", "Kabelbreuk zoeken", "Bij graafwerk bij {loc} is mogelijk een netwerkkabel geraakt. Zoek de breuk en zet hem tijdelijk door.", "hard", "high", GROUNDS],
    ["onderhoud", "CR_WIFI_TEST", "Wifi testen in de straten", "Test met de laptop in elke straat of het wifi weer snel genoeg is voor videobellen en streamen.", "medium", "normal", fac("I")],
    ["horeca", "CR_WIFI_GOODWILL", "Drankje als goedmakertje", "Het wifi werkt weer. Trakteer gasten in de brasserie op een drankje als goedmakertje.", "easy", "normal", fac("G")],
    ["terrein", "CR_PARK_DIRECT", "Verkeer op het parkeerterrein", "Het parkeerterrein bij het hart staat vol en auto's draaien rondjes. Wijs de laatste vrije plekken aan.", "medium", "high", fac("A")],
    ["terrein", "CR_PARK_SIGNS", "Borden plaatsen", 'Zet borden langs de ingangsweg: "Parkeerterrein vol, volg de borden naar de overloop".', "easy", "high", fac("A")],
    ["terrein", "CR_PARK_OVERFLOW", "Overloopterrein openen", "Open het grasveld naast de driving range als tijdelijk parkeerterrein: linten voor de rijbaan, iemand bij de ingang.", "hard", "high", fac("R")],
    ["terrein", "CR_PARK_SHUTTLE", "Pendel met golfkarren", "Bezoekers op het overloopterrein moeten ver lopen. Zet golfkarren en bolderkarren klaar voor de bagage.", "medium", "normal", fac("R", "A")],
    ["receptie", "CR_PARK_INFORM", "Aankomende gasten bellen", "Bel gasten die vandaag nog komen: parkeren op de overloop en de bagage gaat met de golfkar.", "easy", "normal", fac("A")],
    ["terrein", "CR_PARK_CLEAR", "Overloop weer vrijmaken", "Het is rustiger. Begeleid de auto's van het grasveld terug en maak het veld weer netjes.", "medium", "normal", fac("R")],
    // blue-green algae in the canals
    ["water", "CR_ALGAE_SAMPLE", "Watermonster nemen", "In de grachten drijft blauwalg. Neem monsters bij drie steigers en stuur ze naar het lab.", "medium", "critical", GROUNDS],
    ["receptie", "CR_ALGAE_INFORM", "Gasten informeren", "Laat alle villa's aan het water weten: niet zwemmen in de gracht en honden uit het water houden.", "easy", "high", fac("A")],
    ["water", "CR_ALGAE_BOATS", "Kano's en SUP's binnenhalen", "Haal de kano's en SUP's bij de steigers uit het water tot het water weer schoon is.", "medium", "high", GROUNDS],
    ["recreatie", "CR_ALGAE_ALTERNATIVE", "Alternatief programma", "Niemand mag het water op. Organiseer bij de speeltuin en de jeu-de-boulesbaan een alternatief programma.", "medium", "normal", fac("S", "Z")],
    ["onderhoud", "CR_ALGAE_PUMP", "Doorstroming aanzetten", "Zet bij De werf de pomp aan die vers water door de grachten laat stromen.", "hard", "high", fac("I")],
    ["water", "CR_ALGAE_CLEAR", "Water weer vrijgeven", "De uitslag is goed. Haal de waarschuwingsborden weg en zet de kano's terug.", "easy", "normal", GROUNDS],
    // sloepen adrift after a broken mooring post
    ["water", "CR_DRIFT_SPOT", "Sloepen zoeken", "Drie sloepen zijn losgeslagen en drijven door de grachten. Kijk vanaf de bruggen waar ze zijn.", "medium", "critical", GROUNDS],
    ["water", "CR_DRIFT_TOW", "Sloepen terugslepen", "Sleep de sloepen met de werkboot terug naar hun steiger. Niemand springt in het water.", "hard", "high", GROUNDS],
    ["water", "CR_DRIFT_POST", "Meerpaal herstellen", "De meerpaal waar de sloepen aan lagen is afgebroken. Tijdelijk een nieuwe zetten.", "hard", "high", GROUNDS],
    ["receptie", "CR_DRIFT_OWNERS", "Gasten informeren", "Laat de gasten van de drie villa's weten dat hun sloep terug is en of er schade is.", "easy", "normal", fac("A")],
    ["water", "CR_DRIFT_CHECK", "Alle steigers controleren", "Loop alle steigers langs: liggen de andere sloepen dubbel vast?", "medium", "normal", GROUNDS]
  ].map(([g, code, title, text, d, u, loc]) => t(g, code, title, text, d, u, 0, { crisisOnly: true, location: loc, claimMin: d === "hard" || d === "crisis" ? 20 : 15 })),
  // ---------------------------------------------------------------- storyline chapters (guestlib, only within a storyline)
  // {lead} = lead guest, {household}, {label}, {project}; house tasks happen at the household's own villa
  ...[
    // songwriting camp (artists)
    ["receptie", "STY_CAMP_QUIET", "Stilte voor de schrijvers", "Bij {loc} wordt een nieuw nummer geschreven, maar de buren blazen blad. Vraag vriendelijk om het later te doen.", "easy", "normal", house()],
    ["onderhoud", "STY_CAMP_PIANO", "Piano stemmen", "De vleugel in {loc} is vals na de verhuizing van de studio. Laat de pianostemmer langskomen en help sjouwen.", "medium", "normal", house()],
    ["horeca", "STY_CAMP_DEMO_NIGHT", "Demo-avond in de brasserie", "{lead} wil de nieuwe nummers voor {label} laten horen in de brasserie. Zet een hoek met lounge en geluid klaar.", "medium", "normal", fac("G", "H")],
    ["onderhoud", "STY_STUDIO_POWER", "Stroom voor de thuisstudio", "De studioapparatuur van {lead} laat de groep uitvallen in {loc}. Leg een veilige extra groep aan.", "medium", "high", house()],
    ["schoonmaak", "STY_STUDIO_DAMPING", "Geluid dempen", "Voor de opnames in {loc} wil {lead} dekens en matrassen tegen de glaspui. Breng ze en help ophangen.", "easy", "normal", house()],
    ["receptie", "STY_STUDIO_UPLOAD", "Upload naar het label", "De opnames voor {project} moeten vanavond naar {label}. Het wifi in {loc} haalt het niet. Regel een snelle verbinding.", "medium", "high", house()],
    ["water", "STY_JETTY_SUNRISE", "Schrijven bij zonsopgang", "{lead} wil om zes uur schrijven op de steiger van {loc}. Zet een stoel, een deken en thee klaar.", "easy", "normal", house()],
    ["onderhoud", "STY_JETTY_BOARD", "Losse plank", "De gitaar van {lead} viel bijna in de gracht door een losse plank op de steiger van {loc}. Vastzetten.", "easy", "high", house()],
    ["water", "STY_JETTY_SLOEP", "Rondje inspiratie", "{lead} wil een rondje varen voor inspiratie. Zorg voor een opgeladen sloep met een vaarkaart.", "easy", "normal", house()],
    ["horeca", "STY_DEADLINE_COFFEE", "Koffie voor de deadline", "Het refrein van {project} moet morgen bij {label} liggen. Breng een thermoskan koffie en iets lekkers naar {loc}.", "easy", "high", house()],
    ["receptie", "STY_DEADLINE_PRINT", "Teksten printen", "{lead} wil de songteksten op papier om te schrappen. De printer bij de receptie weigert. Oplossen.", "easy", "normal", fac("A")],
    ["receptie", "STY_DEADLINE_NEIGHBOURS", "Nachtelijk gitaarspel", "De buren van {loc} horen om twee uur 's nachts hetzelfde akkoord voor de veertigste keer. Bemiddel met oordopjes en begrip.", "easy", "normal", house()],
    ["recreatie", "STY_LISTEN_STAGE", "Podium bij de Residentie", "Bouw met het team een klein podium in het gras bij de Residentie voor de luistersessie van {lead}.", "medium", "normal", fac("N", "Z")],
    ["onderhoud", "STY_LISTEN_SOUND", "Geluid voor de luistersessie", "Sluit de geluidsinstallatie aan voor {lead} en doe een soundcheck. Geen piep, geen kraak.", "medium", "high", fac("N", "Z")],
    ["horeca", "STY_LISTEN_CROWD", "Publiek bij de luistersessie", "Half het park komt luisteren naar {lead}. Zorg voor een nette rij en drinken voor iedereen.", "hard", "high", fac("G", "H")],
    ["receptie", "STY_LYRICS_LOSTFOUND", "Notitieboek zoeken", "Het notitieboek van {lead} met alle teksten voor {project} is kwijt. Kijk bij de gevonden voorwerpen.", "easy", "high", fac("A")],
    ["golf", "STY_LYRICS_RANGE", "Notitieboek op de range", "Een golfer zag een zwart boekje bij de ballenautomaat van de driving range. Ophalen voordat het gaat regenen.", "easy", "high", fac("R")],
    // well-to-do guests
    ["horeca", "STY_CHEF_GROCERIES", "Boodschappen voor de privekok", "De privekok van {household} in {loc} mist truffel, kreeft en verse dragon. Regel het via de brasserie.", "medium", "normal", house()],
    ["onderhoud", "STY_CHEF_OVEN", "Oven werkt niet", "Net nu de privekok begint, werkt de stoomoven in {loc} niet. Snel nakijken.", "medium", "high", house()],
    ["horeca", "STY_CHEF_GLASSES", "Glazen en servies", "Voor het diner van {household} zijn twaalf wijnglazen en een tweede set borden nodig in {loc}.", "easy", "normal", house()],
    ["water", "STY_YACHT_MOOR", "Eigen boot aanleggen", "{lead} komt met een eigen sloep van 7 meter via het water. Wijs een plek aan de steiger van {loc} en help aanleggen.", "medium", "high", house()],
    ["onderhoud", "STY_YACHT_POWER", "Walstroom voor de boot", "De boot van {lead} wil walstroom bij {loc}. Regel een veilige kabel met een aardlekschakelaar.", "medium", "normal", house()],
    ["horeca", "STY_YACHT_PICNIC", "Picknick aan boord", "{lead} wil met gasten een vaartocht maken met een picknickmand. Laat de brasserie hem klaarmaken.", "easy", "normal", fac("G")],
    ["golf", "STY_DEAL_CART", "Golfkar voor de zakenpartners", "{lead} speelt morgen negen holes met zakenpartners. Zorg voor twee schone golfkarren met water aan boord.", "easy", "normal", fac("O", "R")],
    ["golf", "STY_DEAL_GREEN", "Perfecte green", "Voor de flight van {lead} moet de green van hole 9 er perfect bij liggen. Maaien en de vlag rechtzetten.", "medium", "normal", fac("O")],
    ["horeca", "STY_DEAL_LUNCH", "Lunch na de ronde", "Na de ronde wil {lead} een rustige tafel op het terras met uitzicht op hole 9. Reserveer en dek.", "easy", "normal", fac("H", "G")],
    ["onderhoud", "STY_POOLPARTY_HEAT", "Zwembad verwarmen", "{household} geeft vanavond een poolparty. Het privezwembad bij {loc} moet minstens 28 graden zijn.", "medium", "high", house()],
    ["receptie", "STY_POOLPARTY_NEIGHBOURS", "Buren van de poolparty", "De buren van {loc} vinden de poolparty gezellig, tot 23:00 uur. Spreek een eindtijd af.", "easy", "normal", house()],
    ["schoonmaak", "STY_POOLPARTY_CLEANUP", "Opruimen na de party", "Na de poolparty bij {loc} drijven er bekertjes, slingers en een opblaasflamingo in het zwembad. Opruimen.", "medium", "normal", house()],
    ["receptie", "STY_ART_DELIVERY", "Kunstwerk bezorgd", "Er komt een beeldhouwwerk van 200 kilo voor {loc}. Regel een palletwagen en wijs de bezorger de weg.", "medium", "normal", house()],
    ["terrein", "STY_ART_PLACE", "Kunstwerk plaatsen", "Het beeld moet op het terras van {loc}, precies in het midden. Help met plaatsen, zonder de tegels te breken.", "hard", "normal", house()],
    // families
    ["horeca", "STY_BDAY_CAKE", "Verjaardagstaart", "Oma van {household} wordt 80. Regel een taart met 80 kaarsjes (of twee met een 8 en een 0) voor {loc}.", "easy", "normal", house()],
    ["schoonmaak", "STY_BDAY_DECOR", "Versieren", "Versier het terras van {loc} met slingers en ballonnen voor de verjaardag van oma.", "easy", "normal", house()],
    ["water", "STY_BDAY_SLOEP", "Rondvaart voor oma", "Als verrassing wil {household} oma een rondvaart geven. Regel een sloep met een kussen en een deken.", "easy", "normal", house()],
    ["golf", "STY_GRANDPA_RANGE", "Opa leert golfen", "Opa van {household} wil het ook eens proberen. Leg op de driving range uit hoe je een bal slaat, en waar je niet gaat staan.", "easy", "normal", fac("R")],
    ["golf", "STY_GRANDPA_BALLS", "Verdwaalde ballen", "Opa heeft zijn bal in de bunker, de vijver en het bos geslagen. Zoek er een paar terug.", "easy", "normal", fac("O", "L")],
    ["water", "STY_CANOE_LOST", "Kinderen in de kano", "De kinderen van {household} zijn met de kano een gracht te ver gevaren en weten de weg niet terug. Vind ze (vanaf de kant).", "medium", "high", GROUNDS],
    ["schoonmaak", "STY_CANOE_DRY", "Droge kleren", "De kinderen zijn terug, kletsnat maar blij. Breng handdoeken en warme chocomelk naar {loc}.", "easy", "normal", house()],
    ["terrein", "STY_FEUD_MEDIATE", "Ruzie over de haag", "De buren van {loc} hebben ruzie over hoe hoog de haag mag. Bemiddel met een meetlint en geduld.", "medium", "high", house()],
    ["water", "STY_FEUD_JETTY", "Ruzie over de steiger", "Nu gaat het over wiens sloep aan welke kant van de steiger ligt. Leg het uit met de plattegrond.", "easy", "normal", house()],
    ["horeca", "STY_FEUD_DINNER", "Verzoeningsdiner", "Er is vrede. Een gezamenlijke barbecue op het terras van {loc} moet het bezegelen.", "medium", "normal", house()],
    // cameo guests added by the game master
    ["receptie", "STY_CELEB_AUTOGRAPH", "Handtekeningenrij", "Bij de receptie staan gasten in de rij voor een handtekening van {lead}. Zorg voor een nette rij en een pen die het doet.", "easy", "normal", fac("A")],
    ["horeca", "STY_CELEB_QUIET_TABLE", "Rustig tafeltje", "Regel voor {lead} een rustig tafeltje achter in de brasserie, uit het zicht van nieuwsgierige gasten.", "easy", "normal", fac("G", "H")]
  ].map(([g, code, title, text, d, u, loc]) => t(g, code, title, text, d, u, 0, { storyOnly: true, location: loc, when: {}, offeredMaxMin: 40, cooldownMin: 30, onTimeout: { mood: -0.05 } }))
];
var CRISES = [
  // Each crisis is a process: a first report, then follow-up reports over time (afterMin from the start), 4-8 tasks in total.
  {
    code: "CRISIS_WATER_MAIN",
    title: "Waterleiding gesprongen",
    icon: "drop",
    fx: "splash",
    location: GROUNDS,
    weight: 1,
    texts: ["Bij {loc} spuit een fontein uit de grond die er gisteren nog niet was. Een hoofdwaterleiding is gesprongen."],
    stages: [
      { afterMin: 0, text: "Hoofdkraan dicht en gebied afzetten", tasks: ["CR_WATER_MAIN_VALVE", "CR_WATER_SIGNS"] },
      { afterMin: 10, text: "Gasten zonder water: flessen uitdelen", tasks: ["CR_WATER_BOTTLES"] },
      { afterMin: 20, text: "De straten informeren", tasks: ["CR_WATER_INFORM"] },
      { afterMin: 35, text: "De loodgieter is er: repareren", tasks: ["CR_WATER_MAIN_REPAIR"] },
      { afterMin: 60, text: "Water terug, maar bruin: doorspoelen", tasks: ["CR_WATER_FLUSH"] },
      { afterMin: 75, text: "Opruimen", tasks: ["CR_WATER_CLEANUP"] }
    ]
  },
  {
    code: "CRISIS_BLACKOUT",
    title: "Grote stroomstoring",
    icon: "bolt",
    fx: "spark",
    location: fac("I"),
    weight: 1,
    texts: ["Een groot deel van het park zit zonder stroom. De privezwembaden staan stil en de koelkasten zuchten."],
    stages: [
      { afterMin: 0, text: "Oorzaak zoeken in de hoofdverdeler", tasks: ["CR_BLACKOUT_FUSEBOX"] },
      { afterMin: 8, text: "Het wordt donker: zaklampen uitdelen", tasks: ["CR_BLACKOUT_TORCHES"] },
      { afterMin: 15, text: "Noodstroom voor receptie en koeling", tasks: ["CR_BLACKOUT_GENERATOR"] },
      { afterMin: 25, text: "Koelcellen controleren", tasks: ["CR_BLACKOUT_FRIDGES"] },
      { afterMin: 40, text: "Ronde langs kwetsbare gasten", tasks: ["CR_BLACKOUT_ROUNDS"] },
      { afterMin: 55, text: "Stroom terug: alles weer opstarten", tasks: ["CR_BLACKOUT_RESTART"] }
    ]
  },
  {
    code: "CRISIS_CHECKIN",
    title: "Incheckchaos",
    icon: "key",
    fx: "ring",
    location: fac("A"),
    weight: 1,
    texts: ["Het reserveringssysteem ligt plat terwijl de halve wereld tegelijk wil inchecken."],
    stages: [
      { afterMin: 0, text: "Systeem herstarten", tasks: ["CR_CHECKIN_SYSTEM"] },
      { afterMin: 10, text: "Overstappen op papier", tasks: ["CR_CHECKIN_PAPER"] },
      { afterMin: 20, text: "De rij wordt lang: koffie uitdelen", tasks: ["CR_CHECKIN_COFFEE"] },
      { afterMin: 30, text: "Auto's bij de slagboom begeleiden", tasks: ["CR_CHECKIN_TRAFFIC"] },
      { afterMin: 45, text: "Sleutelkaarten met de hand uitgeven", tasks: ["CR_CHECKIN_KEYS"] },
      { afterMin: 60, text: "Excuses aan de gedupeerden", tasks: ["CR_CHECKIN_SORRY"] }
    ]
  },
  {
    code: "CRISIS_ALGAE",
    title: "Blauwalg in de grachten",
    icon: "drop",
    fx: "splash",
    location: GROUNDS,
    weight: 1,
    texts: ["Na de warme dagen drijft er blauwalg in de grachten. Zwemmen en varen moet direct stoppen."],
    stages: [
      { afterMin: 0, text: "Monsters nemen", tasks: ["CR_ALGAE_SAMPLE"] },
      { afterMin: 8, text: "Gasten aan het water informeren", tasks: ["CR_ALGAE_INFORM"] },
      { afterMin: 15, text: "Kano's en SUP's uit het water", tasks: ["CR_ALGAE_BOATS"] },
      { afterMin: 25, text: "Alternatief voor de kinderen", tasks: ["CR_ALGAE_ALTERNATIVE"] },
      { afterMin: 40, text: "Doorstroming aanzetten", tasks: ["CR_ALGAE_PUMP"] },
      { afterMin: 60, text: "Water weer vrijgeven", tasks: ["CR_ALGAE_CLEAR"] }
    ]
  },
  {
    code: "CRISIS_SLOEPEN_DRIFT",
    title: "Sloepen op drift",
    icon: "boat",
    fx: "splash",
    location: GROUNDS,
    weight: 1,
    texts: ["Een meerpaal is afgebroken en drie sloepen drijven stuurloos door de grachten."],
    stages: [
      { afterMin: 0, text: "Waar zijn de sloepen?", tasks: ["CR_DRIFT_SPOT"] },
      { afterMin: 10, text: "Terugslepen met de werkboot", tasks: ["CR_DRIFT_TOW"] },
      { afterMin: 25, text: "Meerpaal herstellen", tasks: ["CR_DRIFT_POST"] },
      { afterMin: 40, text: "Gasten informeren", tasks: ["CR_DRIFT_OWNERS"] },
      { afterMin: 50, text: "Alle steigers controleren", tasks: ["CR_DRIFT_CHECK"] }
    ]
  },
  {
    code: "CRISIS_STORM",
    title: "Zware onweersbui",
    icon: "bolt",
    fx: "splash",
    location: GROUNDS,
    weight: 1,
    texts: ["Het KNMI waarschuwt voor zwaar onweer met windstoten. Over een kwartier is de bui boven het park."],
    stages: [
      { afterMin: 0, text: "Gasten waarschuwen", tasks: ["CR_STORM_INFORM"] },
      { afterMin: 5, text: "Golfbaan ontruimen", tasks: ["CR_STORM_GOLF_OUT"] },
      { afterMin: 10, text: "Terras stormvrij maken", tasks: ["CR_STORM_TERRACE"] },
      { afterMin: 15, text: "Sloepen vastleggen", tasks: ["CR_STORM_SLOEPEN"] },
      { afterMin: 30, text: "Er is een boom omgewaaid", tasks: ["CR_STORM_TREE"] },
      { afterMin: 40, text: "Een villa lekt", tasks: ["CR_STORM_LEAK"] },
      { afterMin: 70, text: "Opruimen na de bui", tasks: ["CR_STORM_CLEANUP"] }
    ]
  },
  {
    code: "CRISIS_FIRE_ALARM",
    title: "Brandalarm in de brasserie",
    icon: "alert",
    fx: "spark",
    location: fac("G"),
    weight: 0.8,
    texts: ["Het brandalarm in Brasserie Harderwold gaat af en er komt rook uit de keuken."],
    stages: [
      { afterMin: 0, text: "Brasserie rustig ontruimen", tasks: ["CR_FIRE_EVACUATE"] },
      { afterMin: 5, text: "Iedereen tellen bij het verzamelpunt", tasks: ["CR_FIRE_HEADCOUNT"] },
      { afterMin: 10, text: "De brandweer opvangen", tasks: ["CR_FIRE_BRIGADE"] },
      { afterMin: 25, text: "Loos alarm: afzuiging nakijken", tasks: ["CR_FIRE_KITCHEN"] },
      { afterMin: 40, text: "Luchten en schoonmaken", tasks: ["CR_FIRE_AIR"] },
      { afterMin: 55, text: "Weer open", tasks: ["CR_FIRE_REOPEN"] }
    ]
  },
  {
    code: "CRISIS_PRESS",
    title: "Pers bij de slagboom",
    icon: "alert",
    fx: "ring",
    location: fac("A"),
    weight: 1,
    texts: ["Het nieuws is uitgelekt dat er een bekende artiest op schrijverskamp is. Fotografen en verslaggevers staan bij de receptie."],
    stages: [
      { afterMin: 0, text: "Een perspunt inrichten", tasks: ["CR_PRESS_DESK"] },
      { afterMin: 10, text: "Persbusjes blokkeren de weg", tasks: ["CR_PRESS_PARKING"] },
      { afterMin: 20, text: "Fotografen lopen het park in", tasks: ["CR_PRESS_PRIVACY"] },
      { afterMin: 30, text: "Koffie voor de wachtende pers", tasks: ["CR_PRESS_COFFEE"] },
      { afterMin: 40, text: "Een korte verklaring", tasks: ["CR_PRESS_STATEMENT"] },
      { afterMin: 55, text: "Rondleiding als afleiding", tasks: ["CR_PRESS_TOUR"] }
    ]
  },
  {
    code: "CRISIS_WIFI",
    title: "Wifi-storing op het schrijverskamp",
    icon: "bolt",
    fx: "spark",
    location: fac("I"),
    weight: 1,
    texts: ["Het hele park zit zonder wifi, net nu de artiesten op schrijverskamp hun demo's moeten insturen."],
    stages: [
      { afterMin: 0, text: "Netwerk herstarten", tasks: ["CR_WIFI_ROUTER"] },
      { afterMin: 5, text: "Noodhotspot voor de studio", tasks: ["CR_WIFI_HOTSPOT"] },
      { afterMin: 15, text: "Gasten informeren", tasks: ["CR_WIFI_INFORM"] },
      { afterMin: 25, text: "Kabelbreuk zoeken", tasks: ["CR_WIFI_CABLE"] },
      { afterMin: 45, text: "Testen in de straten", tasks: ["CR_WIFI_TEST"] },
      { afterMin: 60, text: "Goedmakertje", tasks: ["CR_WIFI_GOODWILL"] }
    ]
  },
  {
    code: "CRISIS_PARKING",
    title: "Parkeerterrein vol",
    icon: "car",
    fx: "ring",
    location: fac("A"),
    weight: 1,
    texts: ["Het parkeerterrein bij het hart zit vol door een golfwedstrijd, en er komen nog steeds auto's aan."],
    stages: [
      { afterMin: 0, text: "Laatste plekken aanwijzen", tasks: ["CR_PARK_DIRECT"] },
      { afterMin: 8, text: "Borden langs de ingangsweg", tasks: ["CR_PARK_SIGNS"] },
      { afterMin: 15, text: "Overloopterrein openen", tasks: ["CR_PARK_OVERFLOW"] },
      { afterMin: 25, text: "Bagage met de golfkar", tasks: ["CR_PARK_SHUTTLE"] },
      { afterMin: 35, text: "Aankomende gasten bellen", tasks: ["CR_PARK_INFORM"] },
      { afterMin: 70, text: "Overloop weer vrijmaken", tasks: ["CR_PARK_CLEAR"] }
    ]
  }
];
var templateByCode = new Map(TEMPLATES.map((x) => [x.code, x]));
var crisisByCode = new Map(CRISES.map((x) => [x.code, x]));
function validateLibrary(facilityKeys) {
  const out = [];
  const codes = /* @__PURE__ */ new Set();
  for (const x of TEMPLATES) {
    if (codes.has(x.code)) out.push(`dubbele code ${x.code}`);
    codes.add(x.code);
    if (!x.title || !x.texts.length || x.texts.some((s) => s.length < 20)) out.push(`${x.code}: tekst ontbreekt of is te kort`);
    if (!(x.claimMin >= 2 && x.claimMin <= 30)) out.push(`${x.code}: tijdslimiet ${x.claimMin} min buiten 2-30`);
    if (!(x.cooldownMin > 0)) out.push(`${x.code}: geen cooldown`);
    if (!(x.offeredMaxMin >= 10)) out.push(`${x.code}: aanbodtijd te kort`);
    if (!x.icon || !x.fx) out.push(`${x.code}: icoon of animatie ontbreekt`);
    if (!Object.keys(x.onComplete).length) out.push(`${x.code}: geen effect bij afronden`);
    if (!Object.keys(x.onTimeout).length) out.push(`${x.code}: geen effect bij verlopen`);
    if (x.location.kind === "facility" && !(x.location.facilities ?? []).some((f) => facilityKeys.has(f))) out.push(`${x.code}: geen geldige voorziening (${x.location.facilities})`);
    if (x.when.day && x.when.night) out.push(`${x.code}: tegelijk alleen dag en alleen nacht`);
  }
  for (const x of TEMPLATES) {
    const e = x.onTimeout.escalate;
    if (e && !templateByCode.has(e)) out.push(`${x.code}: escalatie naar onbekende ${e}`);
    if (e === x.code) out.push(`${x.code}: escaleert naar zichzelf`);
    if (e && templateByCode.get(e)?.onTimeout.escalate) out.push(`${x.code}: escalatieketen langer dan 1 stap`);
  }
  for (const c of CRISES) {
    if (!c.stages.length || c.stages[0].afterMin !== 0) out.push(`${c.code}: eerste fase moet direct starten`);
    for (const s of c.stages) for (const k of s.tasks) {
      const tt = templateByCode.get(k);
      if (!tt) out.push(`${c.code}: onbekende deelopdracht ${k}`);
      else if (!tt.crisisOnly) out.push(`${c.code}: deelopdracht ${k} is geen crisis-sjabloon`);
    }
  }
  return out;
}

// src/sim/scheduler.ts
var DEFAULT_SCHEDULER = {
  enabled: true,
  normalPerHourDay: 3,
  nightFactor: 0.2,
  dayStartHour: 8,
  dayEndHour: 23,
  majorPerDay: 2,
  majorMaxPerDay: 3,
  majorMinGapMin: 180,
  maxOpen: 12
};
function validateSchedulerConfig(c) {
  const e = [];
  const r = (k, lo, hi) => {
    const v = c[k];
    if (v !== void 0 && !(typeof v === "number" && v >= lo && v <= hi)) e.push(`${k} moet tussen ${lo} en ${hi} liggen`);
  };
  r("normalPerHourDay", 0, 20);
  r("nightFactor", 0, 1);
  r("dayStartHour", 0, 23);
  r("dayEndHour", 1, 24);
  r("majorPerDay", 0, 10);
  r("majorMaxPerDay", 0, 10);
  r("majorMinGapMin", 0, 1440);
  r("maxOpen", 1, 100);
  if (c.enabled !== void 0 && typeof c.enabled !== "boolean") e.push("enabled moet true of false zijn");
  return e;
}
var Scheduler = class {
  cfg;
  state = { dayIndex: -1, majorsToday: 0, lastMajorMin: -1e9 };
  rand;
  constructor(cfg = {}, seed = 1, state) {
    this.cfg = { ...DEFAULT_SCHEDULER, ...cfg };
    this.rand = rng(seed * 104729 + 17);
    if (state) {
      this.state = { ...state };
      if (state.rng !== void 0) this.rand.setState(state.rng);
    }
  }
  /** serialisable state (persisted with the game) */
  snapshot() {
    return { ...this.state, rng: this.rand.state() };
  }
  isDay(hour) {
    const { dayStartHour: a, dayEndHour: b } = this.cfg;
    return a <= b ? hour >= a && hour < b : hour >= a || hour < b;
  }
  /** expected normal tasks per game minute right now */
  normalRate(env2) {
    const occ = 0.8 + 0.4 * Math.max(0, Math.min(1, env2.occupancy));
    return this.cfg.normalPerHourDay / 60 * (this.isDay(env2.hour) ? 1 : this.cfg.nightFactor) * occ;
  }
  /** advance by dtMin game minutes; returns what to create */
  tick(env2, dtMin) {
    const out = { normal: [], major: null };
    if (!this.cfg.enabled || dtMin <= 0) return out;
    if (env2.dayIndex !== this.state.dayIndex) {
      this.state.dayIndex = env2.dayIndex;
      this.state.majorsToday = 0;
    }
    let k = this.poisson(this.normalRate(env2) * dtMin);
    while (k-- > 0 && env2.openNormal + out.normal.length < this.cfg.maxOpen) {
      const s = this.pickNormal(env2, out.normal);
      if (s) out.normal.push(s);
    }
    const dayMin = (this.cfg.dayEndHour - this.cfg.dayStartHour + 24) % 24 * 60 || 1440;
    if (this.isDay(env2.hour) && this.state.majorsToday < this.cfg.majorMaxPerDay && env2.nowMin - this.state.lastMajorMin >= this.cfg.majorMinGapMin) {
      if (this.rand.next() < this.cfg.majorPerDay / dayMin * dtMin * 1.15) {
        const s = this.pickMajor(env2);
        if (s) {
          out.major = s;
          this.state.majorsToday++;
          this.state.lastMajorMin = env2.nowMin;
        }
      }
    }
    return out;
  }
  /** one suitable normal task for this moment (admin '+1 incident', start of a game) */
  suggest(env2) {
    return this.pickNormal(env2, []);
  }
  poisson(lambda) {
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do {
      k++;
      p *= this.rand.next();
    } while (p > L);
    return k - 1;
  }
  candidates(rule, env2) {
    if (rule.kind === "house") {
      const l = rule.vacant ? env2.vacant : rule.occupied ? env2.occupied : env2.houses;
      return rule.feature && env2.hasFeature ? l.filter((h) => env2.hasFeature(h, rule.feature)) : l;
    }
    if (rule.kind === "grounds") return env2.houses;
    return (rule.facilities ?? []).flatMap((f) => env2.facilities.get(f) ?? []);
  }
  eligible(tp, env2) {
    if (tp.crisisOnly || tp.weight <= 0) return false;
    const day = this.isDay(env2.hour);
    if (tp.when.day && !day) return false;
    if (tp.when.night && day) return false;
    if (tp.when.minOccupancy !== void 0 && env2.occupancy < tp.when.minOccupancy) return false;
    const last = env2.lastAt(tp.code);
    return last === void 0 || env2.nowMin - last >= tp.cooldownMin / 3;
  }
  pickNormal(env2, already) {
    const taken = /* @__PURE__ */ new Set([...env2.busy, ...already.map((s) => s.location)]);
    const opts = [];
    for (const tp of TEMPLATES) {
      if (!this.eligible(tp, env2) || already.some((s) => s.code === tp.code)) continue;
      const locs = this.candidates(tp.location, env2).filter((l) => !taken.has(l) && !this.onCooldown(tp.code, l, tp.cooldownMin, env2));
      if (locs.length) opts.push({ tp, locs });
    }
    const pick2 = this.weighted(opts, (o) => o.tp.weight * (env2.groupFactor?.(o.tp.group) ?? 1));
    return pick2 ? { code: pick2.tp.code, location: pick2.locs[Math.floor(this.rand.next() * pick2.locs.length)] } : null;
  }
  pickMajor(env2) {
    const opts = [];
    for (const c of CRISES) {
      const locs = this.candidates(c.location, env2).filter((l) => !this.onCooldown(c.code, l, 24 * 60, env2));
      if (locs.length && !(env2.lastAt(c.code) !== void 0 && env2.nowMin - env2.lastAt(c.code) < 12 * 60)) opts.push({ c, locs });
    }
    const pick2 = this.weighted(opts, (o) => o.c.weight);
    return pick2 ? { code: pick2.c.code, location: pick2.locs[Math.floor(this.rand.next() * pick2.locs.length)] } : null;
  }
  onCooldown(code, loc, min, env2) {
    const l = env2.lastAt(code, loc);
    return l !== void 0 && env2.nowMin - l < min;
  }
  weighted(list, w) {
    const tot = list.reduce((a, x) => a + w(x), 0);
    if (!(tot > 0)) return null;
    let r = this.rand.next() * tot;
    for (const x of list) {
      r -= w(x);
      if (r <= 0) return x;
    }
    return list[list.length - 1];
  }
};

// src/shared/weather.ts
var WEATHER_KINDS = ["zon", "halfbewolkt", "bewolkt", "regen", "onweer", "mist"];
var WEATHER_NAMES = { zon: "Zonnig", halfbewolkt: "Half bewolkt", bewolkt: "Bewolkt", regen: "Regen", onweer: "Onweer", mist: "Mist" };
var NEXT = {
  zon: [["halfbewolkt", 6], ["zon", 2], ["mist", 0.5]],
  halfbewolkt: [["zon", 4], ["bewolkt", 4], ["regen", 1]],
  bewolkt: [["regen", 4], ["halfbewolkt", 4], ["onweer", 1], ["mist", 0.8]],
  regen: [["bewolkt", 5], ["regen", 2], ["onweer", 1.2], ["halfbewolkt", 1]],
  onweer: [["regen", 5], ["bewolkt", 3]],
  mist: [["halfbewolkt", 4], ["bewolkt", 3], ["zon", 1]]
};
var DURATION_MIN = { zon: [60, 150], halfbewolkt: [45, 120], bewolkt: [45, 120], regen: [30, 90], onweer: [20, 45], mist: [30, 90] };
var pick = (list, r) => {
  const tot = list.reduce((a, x2) => a + x2[1], 0);
  let x = r() * tot;
  for (const [k, w] of list) {
    x -= w;
    if (x <= 0) return k;
  }
  return list[0][0];
};
var durationMs = (k, r) => {
  const [a, b] = DURATION_MIN[k];
  return (a + r() * (b - a)) * 6e4;
};
function temperature(kind, hour) {
  const day = 11 + 4 * Math.sin((hour - 9) / 24 * 2 * Math.PI);
  const adj = { zon: 2, halfbewolkt: 1, bewolkt: 0, regen: -1.5, onweer: -1, mist: -2 }[kind];
  return Math.round(day + adj);
}
function newWeather(nowMs, hour, r = Math.random, kind) {
  const k = kind ?? pick([["zon", 3], ["halfbewolkt", 4], ["bewolkt", 3], ["regen", 1.5], ["mist", 0.7]], r);
  const s = { kind: k, intensity: 0.4 + r() * 0.5, wind: windFor(k, r), tempC: temperature(k, hour), since: nowMs, until: nowMs + durationMs(k, r), locked: false, forecast: [] };
  s.forecast = forecastFrom(s, r);
  return s;
}
function windFor(k, r) {
  return Math.round(k === "onweer" ? 5 + r() * 3 : k === "regen" ? 3 + r() * 3 : k === "mist" ? r() : 1 + r() * 3);
}
function forecastFrom(s, r) {
  const out = [];
  let k = s.kind, at = s.until;
  for (let i = 0; i < 3; i++) {
    k = pick(NEXT[k], r);
    out.push({ kind: k, at });
    at += durationMs(k, r);
  }
  return out;
}
function stepWeather(s, nowMs, hour, r = Math.random) {
  s.tempC = temperature(s.kind, hour);
  if (nowMs < s.until) return false;
  const next = s.forecast.shift()?.kind ?? pick(NEXT[s.kind], r);
  const changed = next !== s.kind;
  s.kind = next;
  s.since = nowMs;
  s.until = nowMs + durationMs(next, r);
  s.locked = false;
  s.intensity = 0.4 + r() * 0.5;
  s.wind = windFor(next, r);
  s.tempC = temperature(next, hour);
  s.forecast = forecastFrom(s, r);
  return changed;
}
function forceWeather(s, kind, nowMs, hour, minutes, r = Math.random) {
  const changed = s.kind !== kind;
  s.kind = kind;
  s.since = changed ? nowMs : s.since;
  s.until = nowMs + minutes * 6e4;
  s.locked = true;
  s.intensity = kind === "onweer" ? 0.85 : 0.6;
  s.wind = windFor(kind, r);
  s.tempC = temperature(kind, hour);
  s.forecast = forecastFrom(s, r);
  return changed;
}
function groupFactor(kind, group) {
  const t2 = {
    zon: { water: 1.6, golf: 1.4, horeca: 1.3, recreatie: 1.1, natuur: 1.1 },
    halfbewolkt: { water: 1.2, golf: 1.1 },
    regen: { terrein: 1.6, onderhoud: 1.3, schoonmaak: 1.3, recreatie: 1.2, water: 0.4, golf: 0.5, natuur: 0.7 },
    onweer: { terrein: 2, onderhoud: 1.6, chaos: 1.3, water: 0.2, golf: 0.2, natuur: 0.6 },
    mist: { terrein: 1.2, water: 0.7, golf: 0.7 }
  };
  return t2[kind]?.[group] ?? 1;
}

// src/server/content.ts
var GROUPS = ["onderhoud", "schoonmaak", "receptie", "horeca", "golf", "water", "terrein", "natuur", "recreatie", "chaos"];
var ContentError = class extends Error {
  constructor(problems) {
    super(problems.join("; "));
    this.problems = problems;
  }
};
var clean = (list, max = 60) => [...new Set((Array.isArray(list) ? list : []).map((x) => String(x ?? "").trim().replace(/\s+/g, " ")).filter((x) => x.length >= 2 && x.length <= max))];
var slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
var ContentStore = class {
  constructor(db, facilityKeys) {
    this.db = db;
    this.facilityKeys = facilityKeys;
    db.exec("CREATE TABLE IF NOT EXISTS custom_content (k TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    try {
      const r = this.get("names");
      if (r) this.applyNames(r);
    } catch {
    }
    try {
      for (const ct of this.get("tasks") ?? []) {
        try {
          this.register(ct);
          this.tasks.push(ct);
        } catch {
        }
      }
    } catch {
    }
  }
  tasks = [];
  get(k) {
    const r = this.db.prepare("SELECT data FROM custom_content WHERE k = ?").get(k);
    return r ? JSON.parse(r.data) : void 0;
  }
  put(k, v) {
    this.db.prepare("INSERT INTO custom_content (k, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").run(k, JSON.stringify(v), Date.now());
  }
  // ---------------------------------------------------------------- names
  names() {
    return { first: customNames.first, surnames: customNames.surnames, kids: customNames.kids, cameos: customNames.cameos.map((c) => ({ name: c.name, role: c.role, tagline: c.tagline })) };
  }
  setNames(n) {
    const problems = [];
    const cameos = [];
    for (const [i, c] of (Array.isArray(n.cameos) ? n.cameos : []).entries()) {
      const name = String(c?.name ?? "").trim(), role = String(c?.role ?? "").trim(), tagline = String(c?.tagline ?? "").trim();
      if (name.length < 2 || name.length > 60) {
        problems.push(`bekende gast ${i + 1}: naam ontbreekt`);
        continue;
      }
      if (!GUEST_ROLES.includes(role)) {
        problems.push(`${name}: onbekende rol "${role}" (kies uit ${GUEST_ROLES.join(", ")})`);
        continue;
      }
      cameos.push({ key: `eigen-${slug(name)}`, name, role, tagline: tagline || `${name} is een weekje op vakantie`, companions: ["partner"] });
    }
    if (problems.length) throw new ContentError(problems);
    const lists = { first: clean(n.first, 30), surnames: clean(n.surnames, 40), kids: clean(n.kids, 30), cameos: cameos.map(({ name, role, tagline }) => ({ name, role, tagline })) };
    if (lists.first.length + lists.surnames.length + lists.kids.length + lists.cameos.length > 2e3) throw new ContentError(["maximaal 2000 namen in totaal"]);
    this.applyNames(lists);
    this.put("names", lists);
    return this.names();
  }
  applyNames(l) {
    setCustomNames({ first: l.first ?? [], surnames: l.surnames ?? [], kids: l.kids ?? [], cameos: (l.cameos ?? []).map((c) => ({ key: `eigen-${slug(c.name)}`, name: c.name, role: c.role, tagline: c.tagline, companions: ["partner"] })) });
  }
  // ---------------------------------------------------------------- own tasks
  toTemplate(ct) {
    const loc = ct.location.kind === "facility" ? { kind: "facility", facilities: ct.location.facilities ?? [] } : ct.location.kind === "house" ? { kind: "house", occupied: true } : { kind: "grounds" };
    return t(ct.group, ct.code, ct.title, ct.text, ct.difficulty, ct.urgency, ct.weight, { location: loc, when: ct.when === "dag" ? { day: true } : ct.when === "nacht" ? { night: true } : {} });
  }
  register(ct) {
    const tpl = this.toTemplate(ct);
    const i = TEMPLATES.findIndex((x) => x.code === ct.code);
    const prev = i >= 0 ? TEMPLATES[i] : void 0;
    if (i >= 0) TEMPLATES[i] = tpl;
    else TEMPLATES.push(tpl);
    templateByCode.set(ct.code, tpl);
    const problems = validateLibrary(this.facilityKeys()).filter((p) => p.startsWith(`${ct.code}:`) || p.includes(ct.code));
    if (problems.length) {
      if (prev) {
        TEMPLATES[i] = prev;
        templateByCode.set(ct.code, prev);
      } else {
        TEMPLATES.splice(TEMPLATES.indexOf(tpl), 1);
        templateByCode.delete(ct.code);
      }
      throw new ContentError(problems);
    }
  }
  /** add or replace (same code) an own task; returns the stored definition */
  saveTask(input) {
    const p = [];
    const title = String(input.title ?? "").trim(), text = String(input.text ?? "").trim();
    const group = input.group;
    if (!GROUPS.includes(group)) p.push(`onbekende categorie (kies uit ${GROUPS.join(", ")})`);
    if (title.length < 3 || title.length > 60) p.push("titel moet 3-60 tekens zijn");
    if (text.length < 20 || text.length > 300) p.push("omschrijving moet 20-300 tekens zijn");
    if (!["easy", "medium", "hard"].includes(String(input.difficulty))) p.push("moeilijkheid moet easy, medium of hard zijn");
    if (!["normal", "high", "critical"].includes(String(input.urgency))) p.push("urgentie moet normal, high of critical zijn");
    const kind = input.location?.kind;
    if (!["house", "facility", "grounds"].includes(String(kind))) p.push("plek moet house, facility of grounds zijn");
    const facilities = kind === "facility" ? [...new Set((Array.isArray(input.location?.facilities) ? input.location.facilities : []).map((f) => String(f).trim().toUpperCase()).filter((f) => /^[A-Z]{1,2}$/.test(f)))] : void 0;
    if (kind === "facility" && !facilities?.some((f) => this.facilityKeys().has(f))) p.push(`kies minstens \xE9\xE9n bestaande voorziening (${[...this.facilityKeys()].sort().join(", ")})`);
    const weight = Number(input.weight ?? 1);
    if (!(weight >= 0 && weight <= 3)) p.push("gewicht moet tussen 0 en 3 liggen (0 = alleen handmatig)");
    const when = input.when ?? "altijd";
    if (!["altijd", "dag", "nacht"].includes(when)) p.push("moment moet altijd, dag of nacht zijn");
    if (p.length) throw new ContentError(p);
    let code = String(input.code ?? "").trim();
    if (code && !this.tasks.some((x) => x.code === code)) throw new ContentError([`eigen opdracht ${code} bestaat niet`]);
    if (!code) {
      code = `CUST_${slug(title).replace(/-/g, "_").toUpperCase().slice(0, 30)}`;
      let n = 2;
      const base = code;
      while (templateByCode.has(code)) code = `${base}_${n++}`;
    }
    const ct = { code, group, title, text, difficulty: input.difficulty, urgency: input.urgency, location: { kind, facilities }, weight, when };
    this.register(ct);
    const i = this.tasks.findIndex((x) => x.code === code);
    if (i >= 0) this.tasks[i] = ct;
    else this.tasks.push(ct);
    this.put("tasks", this.tasks);
    return ct;
  }
  deleteTask(code) {
    const i = this.tasks.findIndex((x) => x.code === code);
    if (i < 0) throw new ContentError([`eigen opdracht ${code} bestaat niet`]);
    this.tasks.splice(i, 1);
    const j = TEMPLATES.findIndex((x) => x.code === code);
    if (j >= 0) TEMPLATES.splice(j, 1);
    templateByCode.delete(code);
    this.put("tasks", this.tasks);
  }
};

// src/server/stories.ts
var DEFAULT_STORIES = { enabled: true, perHourDay: 1.5, maxActive: 3 };
function validateStoryConfig(c) {
  const e = [];
  if (c.enabled !== void 0 && typeof c.enabled !== "boolean") e.push("enabled moet true of false zijn");
  if (c.perHourDay !== void 0 && !(typeof c.perHourDay === "number" && c.perHourDay >= 0 && c.perHourDay <= 20)) e.push("perHourDay moet tussen 0 en 20 liggen");
  if (c.maxActive !== void 0 && !(Number.isInteger(c.maxActive) && c.maxActive >= 0 && c.maxActive <= 20)) e.push("maxActive moet een geheel getal tussen 0 en 20 zijn");
  return e;
}
var ACTIVE_BOOKING = /* @__PURE__ */ new Set(["parked", "in_house"]);
var StoryDirector = class {
  constructor(host) {
    this.host = host;
    host.db.exec(`CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY, code TEXT NOT NULL, booking_id TEXT NOT NULL, house_number INTEGER NOT NULL, vars TEXT NOT NULL,
      chapter INTEGER NOT NULL, task_id TEXT, state TEXT NOT NULL CHECK (state IN ('active','completed','failed')),
      next_at INTEGER, started_at INTEGER NOT NULL, ended_at INTEGER, outcome TEXT)`);
    let saved = {};
    try {
      saved = JSON.parse(getMeta(host.db, "stories") ?? "{}");
    } catch {
    }
    this.cfg = { ...DEFAULT_STORIES, ...saved };
  }
  cfg;
  /** settings of the game now in the database (after loading a saved game) */
  reloadConfig() {
    let saved = {};
    try {
      saved = JSON.parse(getMeta(this.host.db, "stories") ?? "{}");
    } catch {
    }
    this.cfg = { ...DEFAULT_STORIES, ...saved };
  }
  setConfig(c) {
    this.cfg = { ...this.cfg, ...c };
    setMeta(this.host.db, "stories", JSON.stringify(this.cfg));
  }
  wipe() {
    this.host.db.exec("DELETE FROM stories");
  }
  rows(all = false) {
    const sql = all ? "SELECT * FROM stories ORDER BY started_at DESC LIMIT 50" : "SELECT * FROM stories WHERE state = 'active' ORDER BY started_at";
    return this.host.db.prepare(sql).all();
  }
  row(id) {
    return this.host.db.prepare("SELECT * FROM stories WHERE id = ?").get(id);
  }
  /** variables of a household for a storyline (null when nobody in it has a fitting role) */
  varsFor(tpl, b) {
    const lead = b.guests.find((g) => tpl.roles.includes(g.role));
    if (!lead || !b.profile) return null;
    if (tpl.minFame !== void 0 && b.profile.fame < tpl.minFame) return null;
    const cel = b.profile.celebrity;
    if (tpl.celebrities?.length) {
      if (!cel || !(tpl.celebrities.includes(cel) || tpl.celebrities.includes("*") && !STORIES.some((x) => x !== tpl && x.celebrities?.includes(cel)))) return null;
    } else if (cel && tpl.noRealPeople) return null;
    if (tpl.kinds && !tpl.kinds.includes(b.profile.kind)) return null;
    return { lead: lead.name, role: ROLE_NAMES[lead.role], household: b.household, label: b.profile.label, project: b.profile.project, n: houseLabel(b.houseNumber), loc: `villa ${houseLabel(b.houseNumber)}`, fame: FAME_NAMES[b.profile.fame] };
  }
  /** Start a storyline (random fitting one when no code/booking is given). Throws a message when impossible. */
  start(opts = {}) {
    const active = this.rows();
    const busy = new Set(active.map((r) => r.booking_id));
    const running = new Set(active.map((r) => r.code));
    const books = [...this.host.bookings()].filter((b) => ACTIVE_BOOKING.has(b.status) && !busy.has(b.id) && (!opts.bookingId || b.id === opts.bookingId));
    const tpls = opts.code ? [storyByCode.get(opts.code)].filter((x2) => !!x2) : STORIES.filter((s) => !running.has(s.code));
    if (opts.code && !tpls.length) throw new Error("unknown_story");
    const opts2 = [];
    for (const tpl2 of tpls) for (const b of books) {
      const v = this.varsFor(tpl2, b);
      if (v) opts2.push({ tpl: tpl2, b, vars: v });
    }
    if (!opts2.length) throw new Error("no_household");
    const byTpl = /* @__PURE__ */ new Map();
    for (const o of opts2) (byTpl.get(o.tpl) ?? byTpl.set(o.tpl, []).get(o.tpl)).push(o);
    const list = [...byTpl.keys()], tot = list.reduce((a, s) => a + s.weight, 0);
    let x = this.host.rand() * tot, tpl = list[list.length - 1];
    for (const s of list) {
      x -= s.weight;
      if (x <= 0) {
        tpl = s;
        break;
      }
    }
    const cand = byTpl.get(tpl), pick2 = cand[Math.floor(this.host.rand() * cand.length)];
    const id = `S-${Math.floor(this.host.rand() * 4294967295).toString(16).padStart(8, "0")}`;
    const now = this.host.nowMs();
    this.host.db.prepare("INSERT INTO stories (id, code, booking_id, house_number, vars, chapter, task_id, state, next_at, started_at) VALUES (?, ?, ?, ?, ?, -1, NULL, 'active', ?, ?)").run(id, tpl.code, pick2.b.id, pick2.b.houseNumber, JSON.stringify(pick2.vars), now, now);
    this.host.event("story.started", { storyId: id, code: tpl.code, title: tpl.title, text: storyText(tpl.intro, pick2.vars), houseNumber: pick2.b.houseNumber, household: pick2.b.household, locationId: `H${pick2.b.houseNumber}` });
    this.advance(this.row(id));
    return this.dto(this.row(id));
  }
  /** every 10 game seconds */
  tick(dtMin) {
    const now = this.host.nowMs();
    const books = new Map([...this.host.bookings()].map((b) => [b.id, b]));
    for (const r of this.rows()) {
      const b = books.get(r.booking_id);
      if (!b || !ACTIVE_BOOKING.has(b.status)) {
        this.end(r, false, "household_left");
        continue;
      }
      if (!r.task_id && r.next_at !== null && now >= r.next_at) this.advance(r);
    }
    if (!this.cfg.enabled || !this.host.isDay()) return;
    if (this.rows().length >= this.cfg.maxActive) return;
    if (this.host.rand() < this.cfg.perHourDay / 60 * dtMin) {
      try {
        this.start();
      } catch {
      }
    }
  }
  /** next chapter (or the finale when all chapters are done) */
  advance(r) {
    const tpl = storyByCode.get(r.code);
    if (!tpl) return this.end(r, false, "unknown_template");
    const next = r.chapter + 1;
    if (next >= tpl.chapters.length) return this.end(r, true, "completed");
    const vars = JSON.parse(r.vars);
    const ch2 = tpl.chapters[next];
    const task = this.host.createChapterTask(ch2.task, r.house_number, r.id, vars);
    if (!task) return this.end(r, false, "no_location");
    this.host.db.prepare("UPDATE stories SET chapter = ?, task_id = ?, next_at = NULL WHERE id = ?").run(next, task.id, r.id);
    this.host.event("story.chapter", { storyId: r.id, code: r.code, title: tpl.title, chapter: next + 1, chapters: tpl.chapters.length, text: storyText(ch2.text, vars), taskId: task.id, taskTitle: task.title, points: task.points, locationId: task.locationId ?? `H${r.house_number}` });
  }
  /** a chapter task ended (completed by a player, expired unclaimed or cancelled by the game master) */
  onTaskOutcome(taskId, storyId, outcome) {
    const r = this.row(storyId);
    if (!r || r.state !== "active" || r.task_id !== taskId) return;
    if (outcome !== "completed") return this.end(r, false, outcome);
    const tpl = storyByCode.get(r.code);
    const nextCh = tpl.chapters[r.chapter + 1];
    if (!nextCh) return this.end(r, true, "completed");
    this.host.db.prepare("UPDATE stories SET task_id = NULL, next_at = ? WHERE id = ?").run(this.host.nowMs() + nextCh.afterMin * 6e4, r.id);
  }
  end(r, success, why) {
    const tpl = storyByCode.get(r.code);
    const vars = JSON.parse(r.vars);
    if (r.task_id && !success) this.host.cancelChapterTask(r.task_id, `story_${why}`);
    this.host.db.prepare("UPDATE stories SET state = ?, task_id = NULL, next_at = NULL, ended_at = ?, outcome = ? WHERE id = ?").run(success ? "completed" : "failed", this.host.nowMs(), why, r.id);
    if (tpl && why !== "household_left") this.host.applyEffect(`H${r.house_number}`, success ? tpl.onSuccess : tpl.onFail);
    this.host.event("story.ended", { storyId: r.id, code: r.code, title: tpl?.title ?? r.code, success, reason: why, text: tpl ? storyText(success ? tpl.finale : tpl.fail, vars) : "", locationId: `H${r.house_number}`, houseNumber: r.house_number, quiet: why === "household_left" });
  }
  dto(r) {
    const tpl = storyByCode.get(r.code);
    const vars = JSON.parse(r.vars);
    const ch2 = tpl && r.chapter >= 0 ? tpl.chapters[r.chapter] : void 0;
    return {
      id: r.id,
      code: r.code,
      title: tpl?.title ?? r.code,
      bookingId: r.booking_id,
      houseNumber: r.house_number,
      household: vars.household,
      lead: vars.lead,
      label: vars.label,
      project: vars.project,
      intro: tpl ? storyText(tpl.intro, vars) : "",
      chapter: r.chapter + 1,
      chapters: tpl?.chapters.length ?? 0,
      chapterText: ch2 ? storyText(ch2.text, vars) : null,
      taskId: r.task_id,
      nextAt: r.next_at,
      state: r.state,
      outcome: r.outcome,
      endText: r.state === "active" || !tpl ? null : storyText(r.state === "completed" ? tpl.finale : tpl.fail, vars),
      startedAt: r.started_at,
      endedAt: r.ended_at
    };
  }
  list(all = false) {
    return this.rows(all).map((r) => this.dto(r));
  }
  activeByHouse() {
    const m = /* @__PURE__ */ new Map();
    for (const d of this.list()) m.set(d.houseNumber, { id: d.id, title: d.title, chapter: d.chapter, chapters: d.chapters });
    return m;
  }
};

// src/server/game.ts
var ApiError = class extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
};
var DIFF = { easy: 25, medium: 50, hard: 100, crisis: 150 };
var URG = { normal: 1, high: 1.25, critical: 1.5 };
var pointsFor = (difficulty, urgency) => Math.round(DIFF[difficulty] * URG[urgency] / 5) * 5;
var MAX_CLAIMS = 3;
var Game = class _Game {
  db;
  cfg;
  netJson;
  sectorJson;
  net;
  park;
  maps;
  gameId = "harderwold";
  paused = false;
  clockOriginMs = Date.now();
  clients = /* @__PURE__ */ new Set();
  clientSeq = 0;
  loop;
  lastReal = 0;
  acc = 0;
  lastSave = 0;
  lastFrame = 0;
  lastState = 0;
  lastExpire = 0;
  botRand = rng(99);
  scheduler = new Scheduler(DEFAULT_SCHEDULER, 1);
  stories;
  /** projector display settings (game master) */
  display = { popupSeconds: 15, dayNight: true, ambientSound: true, autoZoom: "crises" };
  /** name of the running game (game master) */
  gameName = "Demo";
  /** current weather (persisted in meta 'weather', part of a saved game) */
  weather;
  /** session plan of the running game: end time and arrivals/departures spread over it (game ms), or null */
  session = null;
  content;
  /** database backups (set by main.ts; absent in tests) */
  backups;
  schedCfg = { ...DEFAULT_SCHEDULER };
  /** game minute a template was last created (key: code, and code|location) - cooldowns */
  lastSeen = /* @__PURE__ */ new Map();
  locState = /* @__PURE__ */ new Map();
  facIndex = [];
  escalationLog = [];
  nextAutoArrival = 0;
  startedAt = Date.now();
  constructor(cfg) {
    this.cfg = cfg;
    this.db = openDb(cfg.dbPath);
    this.maps = new MapStore(this.db, mapDir());
    this.stories = this.makeStories();
    try {
      this.display = { ...this.display, ...JSON.parse(getMeta(this.db, "display") ?? "{}") };
    } catch {
    }
    const { net, sector } = loadMapJson();
    this.netJson = net;
    this.sectorJson = sector;
    this.net = loadNetwork();
    this.indexFacilities();
    this.content = new ContentStore(this.db, () => new Set(this.facIndex.map((f) => f.key)));
    if (!this.restoreFromDb()) this.resetGame(cfg.seed, false);
  }
  /** Continue the game stored in the database (after a restart or loading a saved game). False = nothing usable. */
  restoreFromDb() {
    const cfg = this.cfg;
    const savedSched = getMeta(this.db, "scheduler");
    if (savedSched) try {
      this.schedCfg = { ...DEFAULT_SCHEDULER, ...JSON.parse(savedSched).cfg };
    } catch {
    }
    try {
      this.display = { popupSeconds: 15, dayNight: true, ambientSound: true, autoZoom: "crises", ...JSON.parse(getMeta(this.db, "display") ?? "{}") };
    } catch {
    }
    if (getMeta(this.db, "seed")) cfg.seed = Number(getMeta(this.db, "seed"));
    if (getMeta(this.db, "gameCode")) cfg.gameCode = getMeta(this.db, "gameCode");
    this.gameName = getMeta(this.db, "gameName") ?? "Demo";
    try {
      this.weather = JSON.parse(getMeta(this.db, "weather") ?? "null") ?? void 0;
    } catch {
    }
    try {
      this.session = JSON.parse(getMeta(this.db, "session") ?? "null");
    } catch {
      this.session = null;
    }
    this.stories.reloadConfig();
    const saved = this.db.prepare("SELECT park FROM sim_state WHERE id = 1").get();
    this.park = this.makePark(cfg.seed);
    const sameMap = getMeta(this.db, "mapChecksum") === this.mapChecksum();
    if (saved && getMeta(this.db, "gameId") && !sameMap) console.warn("De kaart is gewijzigd sinds het spel werd opgeslagen: er wordt een nieuw spel gestart (het oude past niet bij de nieuwe wegen).");
    if (saved && getMeta(this.db, "gameId") && sameMap) {
      this.park.restore(saved.park);
      this.clockOriginMs = Number(getMeta(this.db, "clockOriginMs") ?? Date.now());
      this.cfg.timeScale = Number(getMeta(this.db, "timeScale") ?? cfg.timeScale);
      this.cfg.demoBot = getMeta(this.db, "demoBot") === "1";
      this.cfg.autoArrivals = getMeta(this.db, "autoArrivals") !== "0";
      this.cfg.autoGate = getMeta(this.db, "autoGate") === "1";
      this.reconcilePassages();
      try {
        this.scheduler = new Scheduler(this.schedCfg, cfg.seed, JSON.parse(savedSched ?? "{}").state);
      } catch {
        this.scheduler = new Scheduler(this.schedCfg, cfg.seed);
      }
      for (const r of this.db.prepare("SELECT template, location_id, MAX(offered_at) AS at FROM tasks WHERE kind = 'incident' GROUP BY template, location_id").all()) {
        const m = r.at / 6e4;
        this.lastSeen.set(`${r.template}|${r.location_id}`, m);
        if ((this.lastSeen.get(r.template) ?? -Infinity) < m) this.lastSeen.set(r.template, m);
      }
      for (const r of this.db.prepare("SELECT code, location_id, started_at FROM incidents").all()) {
        this.lastSeen.set(r.code, r.started_at / 6e4);
        this.lastSeen.set(`${r.code}|${r.location_id}`, r.started_at / 6e4);
      }
      for (const r of this.db.prepare("SELECT * FROM location_state").all()) this.locState.set(r.id, { tech: r.tech, clean: r.clean, mood: r.mood });
      this.event("server.restored", { simTime: this.park.t, vehicles: this.park.traffic.vehicles.length });
      return true;
    }
    return false;
  }
  makePark(seed) {
    return new ParkSim(this.net, {
      consumeToken: (vid, gid) => this.consumeToken(vid, gid),
      onPassageDone: (pid, status) => this.finishPassage(pid, status),
      servicePass: (vid, gid) => this.servicePass(vid, gid),
      onEvent: (type, payload) => this.event(type, payload),
      // a check-in/check-out is only requested by the car that stands at the barrier, not by cars further back
      onQueued: () => {
      },
      onAtGate: (b, gateId, dir) => this.createGateTask(b, gateId, dir)
    }, seed);
  }
  // ------------------------------------------------------------------ clock & events
  nowMs() {
    return Math.round(this.clockOriginMs + this.park.t * 1e3);
  }
  event(type, payload) {
    const created = Date.now();
    const gm = this.nowMs();
    const r = this.db.prepare("INSERT INTO events (type, payload, game_ms, created_at) VALUES (?, ?, ?, ?)").run(type, JSON.stringify(payload), gm, created);
    const seq = Number(r.lastInsertRowid);
    const msg = `id: ${seq}
event: ${type}
data: ${JSON.stringify({ seq, type, gameMs: gm, ...payload })}

`;
    for (const c of this.clients) c.write(msg);
    return seq;
  }
  latestEventSeq() {
    return this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM events").get().m;
  }
  eventsAfter(after, limit = 200) {
    return this.db.prepare("SELECT seq, type, payload, game_ms FROM events WHERE seq > ? ORDER BY seq LIMIT ?").all(after, Math.min(limit, 1e3)).map((e) => ({ seq: e.seq, type: e.type, gameMs: e.game_ms, ...JSON.parse(e.payload) }));
  }
  addClient(write, close, frames, after, debug = false) {
    const c = { id: ++this.clientSeq, write, frames, close, debugKey: debug };
    this.clients.add(c);
    write(`retry: 2000

`);
    if (after !== void 0) for (const e of this.eventsAfter(after, 500)) write(`id: ${e.seq}
event: ${e.type}
data: ${JSON.stringify(e)}

`);
    write(`id: ${this.latestEventSeq()}
event: state
data: ${JSON.stringify(this.projectorState())}

`);
    return c;
  }
  removeClient(c) {
    this.clients.delete(c);
  }
  clientCount() {
    return this.clients.size;
  }
  // ------------------------------------------------------------------ players
  hash(token) {
    return createHash("sha256").update(token).digest("hex");
  }
  join(gameCode, displayName, isTest = false) {
    if (gameCode !== this.cfg.gameCode) throw new ApiError(403, "bad_game_code", "Onbekende spelcode");
    const name = (displayName ?? "").trim();
    if (name.length < 2 || name.length > 24) throw new ApiError(422, "invalid_name", "Naam moet 2 tot 24 tekens zijn");
    const token = randomBytes(24).toString("base64url");
    const id = `pl-${randomUUID().slice(0, 8)}`;
    try {
      this.db.prepare("INSERT INTO players (id, game_id, display_name, token_hash, score, joined_at, is_test) VALUES (?, ?, ?, ?, 0, ?, ?)").run(id, this.gameId, name, this.hash(token), Date.now(), isTest ? 1 : 0);
    } catch (e) {
      if (String(e).includes("UNIQUE")) throw new ApiError(409, "name_taken", "Deze naam is al in gebruik in dit spel");
      throw e;
    }
    this.event("player.joined", { playerId: id, displayName: name });
    this.broadcastState();
    return { playerId: id, displayName: name, token };
  }
  playerByToken(token) {
    if (!token) return void 0;
    return this.db.prepare("SELECT * FROM players WHERE token_hash = ?").get(this.hash(token));
  }
  /** Dev/test convenience (admin only): rotate and return a session token for a test player. */
  issueTestToken(playerId) {
    const p = this.db.prepare("SELECT * FROM players WHERE id = ?").get(playerId);
    if (!p) throw new ApiError(404, "not_found", "Speler niet gevonden");
    const token = randomBytes(24).toString("base64url");
    this.db.prepare("UPDATE players SET token_hash = ? WHERE id = ?").run(this.hash(token), playerId);
    this.audit("admin", "issue_test_token", { playerId });
    return { playerId, displayName: p.display_name, token };
  }
  leaderboard() {
    return this.db.prepare("SELECT p.id, p.display_name AS displayName, p.score, (SELECT COUNT(*) FROM tasks t WHERE t.assigned_player_id = p.id AND t.state = 'claimed') AS activeTasks FROM players p ORDER BY p.score DESC, p.joined_at ASC").all().map((r, i) => ({ rank: i + 1, ...r }));
  }
  players() {
    return this.db.prepare("SELECT id, display_name AS displayName, score, is_test AS isTest, joined_at AS joinedAt FROM players ORDER BY joined_at").all();
  }
  // ------------------------------------------------------------------ tasks
  getTask(id) {
    return this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  }
  listTasks(state, limit = 200) {
    const rows = state ? this.db.prepare("SELECT * FROM tasks WHERE state = ? ORDER BY offered_at DESC LIMIT ?").all(state, limit) : this.db.prepare("SELECT * FROM tasks WHERE state IN ('offered','claimed') OR completed_at > ? ORDER BY offered_at DESC LIMIT ?").all(this.nowMs() - 36e5, limit);
    return rows.map((t2) => this.taskDto(t2));
  }
  taskDto(t2) {
    const pl = t2.assigned_player_id ? this.db.prepare("SELECT display_name FROM players WHERE id = ?").get(t2.assigned_player_id) : void 0;
    let queuePosition;
    if (t2.vehicle_id && t2.gate_id) {
      const q = this.park.traffic.gates.get(t2.gate_id)?.queue ?? [];
      const i = q.indexOf(t2.vehicle_id);
      if (i >= 0) queuePosition = i + 1;
    }
    return {
      id: t2.id,
      template: t2.template,
      kind: t2.kind,
      category: t2.category,
      title: t2.title,
      description: t2.description,
      locationId: t2.location_id,
      bookingId: t2.booking_id,
      vehicleId: t2.vehicle_id,
      gateId: t2.gate_id,
      icon: t2.icon,
      state: t2.state,
      assignedPlayerId: t2.assigned_player_id,
      assignedPlayerName: pl?.display_name ?? null,
      offeredAt: t2.offered_at,
      claimedAt: t2.claimed_at,
      deadlineAt: t2.deadline_at,
      completedAt: t2.completed_at,
      claimSeconds: t2.claim_seconds,
      difficulty: t2.difficulty,
      urgency: t2.urgency,
      points: t2.points,
      pointsAwarded: t2.points_awarded,
      version: t2.version,
      attempt: t2.attempt,
      queuePosition,
      parentId: t2.parent_id ?? null,
      technician: t2.state === "claimed" ? this.park.techStatus(t2.id) ?? null : null
    };
  }
  insertTask(t2) {
    const r = this.db.prepare(`INSERT OR IGNORE INTO tasks (id, template, kind, category, title, description, location_id, booking_id, vehicle_id, gate_id, icon, state, offered_at, claim_seconds, difficulty, urgency, points, parent_id, depth, fx)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'offered', ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      t2.id,
      t2.template,
      t2.kind,
      t2.category,
      t2.title,
      t2.description,
      t2.location_id,
      t2.booking_id,
      t2.vehicle_id,
      t2.gate_id,
      t2.icon,
      t2.offered_at,
      t2.claim_seconds,
      t2.difficulty,
      t2.urgency,
      t2.points,
      t2.parent_id ?? null,
      t2.depth ?? 0,
      t2.fx ?? null
    );
    if (r.changes) {
      this.event("task.created", { task: this.taskDto(this.getTask(t2.id)) });
      this.broadcastState();
    }
    return r.changes > 0;
  }
  /** Check-in / check-out task linked to exactly one vehicle and gate (idempotent: unique per kind+vehicle+gate). */
  createGateTask(b, gateId, direction) {
    const kind = direction === "inbound" ? "checkin" : "checkout";
    const veh = this.park.traffic.vehicles.find((v) => v.spec.id === b.vehicleId);
    const plate = veh?.spec.plate ?? "";
    const lead = b.guests.map((g) => g.name).slice(0, 2).join(" & ");
    this.insertTask({
      id: `T-${kind}-${b.vehicleId}`,
      template: kind === "checkin" ? "REC_CHECKIN" : "REC_CHECKOUT",
      kind,
      category: "Receptie",
      title: kind === "checkin" ? `Check-in ${b.household}` : `Check-out ${b.household}`,
      description: kind === "checkin" ? `${b.household} (${lead}${b.guests.length > 2 ? " e.a." : ""}) wacht met kenteken ${plate} voor de inrijslagboom. Controleer de reservering voor villa ${houseLabel(b.houseNumber)} en geef de sleutel mee.` : `${b.household} staat met kenteken ${plate} voor de uitrijslagboom. Neem de sleutelkaart van villa ${houseLabel(b.houseNumber)} in en rond de eindafrekening af.`,
      location_id: kind === "checkin" ? "F-A" : `H${b.houseNumber}`,
      booking_id: b.id,
      vehicle_id: b.vehicleId,
      gate_id: gateId,
      icon: kind === "checkin" ? "checkin" : "checkout",
      offered_at: this.nowMs(),
      claim_seconds: 300,
      difficulty: "easy",
      urgency: "normal",
      points: pointsFor("easy", "normal")
    });
  }
  // ------------------------------------------------------------------ incidents (task library + scheduler)
  gameMin() {
    return this.nowMs() / 6e4;
  }
  clockFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  /** local (Europe/Amsterdam) hour of day and day index of the game clock */
  localClock(ms = this.nowMs()) {
    const p = Object.fromEntries(this.clockFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return { hour: Number(p.hour) + Number(p.minute) / 60, dayIndex: Math.floor(Date.UTC(+p.year, +p.month - 1, +p.day) / 864e5) };
  }
  /** Facilities that occur more than once on the PDF for real (playgrounds, outdoor spots). For the buildings of the
   *  central complex (reception, brasserie, shop, ...) only the most central instance is a task location: the other
   *  letters are elsewhere on the drawing (legend) and would put pins in the forest. Assumption, see REFERENTIES. */
  static MULTI_FACILITIES = /* @__PURE__ */ new Set(["S", "X", "Z", "E", "Q", "R", "U", "O", "L", "W"]);
  static taskFacility(id, key) {
    return id === `F-${key}` || _Game.MULTI_FACILITIES.has(key);
  }
  /** facilities with unique location ids (F-<letter>, F-<letter>2, ...) */
  indexFacilities() {
    const seen = /* @__PURE__ */ new Map();
    const vp = this.sectorJson.viewPts, cx = (vp[0] + vp[2]) / 2, cy = (vp[1] + vp[3]) / 2;
    const facs = [...this.sectorJson.facilities].sort((a, b) => Math.hypot(a.pt[0] - cx, a.pt[1] - cy) - Math.hypot(b.pt[0] - cx, b.pt[1] - cy));
    this.facIndex = facs.map((f) => {
      const n = (seen.get(f.key) ?? 0) + 1;
      seen.set(f.key, n);
      return { id: n === 1 ? `F-${f.key}` : `F-${f.key}${n}`, key: f.key, name: f.name, pt: f.pt };
    });
  }
  /** villa features for task placement: detached villas (jetty, jacuzzi, sauna) and private pools (villas.ts variants) */
  hasFeature(loc, f) {
    const h = this.net.houses.find((x) => x.id === loc);
    if (!h || !isVilla(h.legendType)) return false;
    return f === "villa" || f === "pool" && villaVariant(h.number).pool;
  }
  locationName(id, grounds = false) {
    if (id.startsWith("H")) {
      const n = houseLabel(Number(id.slice(1)));
      return grounds ? `de straat bij villa ${n}` : `villa ${n}`;
    }
    return this.facIndex.find((f) => f.id === id)?.name ?? id;
  }
  schedEnv() {
    const occupied = [], vacant = [], houses = [];
    for (const h of this.net.houses) {
      const st = this.park.houses.get(h.number)?.state;
      houses.push(h.id);
      if (st === "occupied") occupied.push(h.id);
      else if (st === "vacant" || st === "needs_cleaning") vacant.push(h.id);
    }
    const facilities = /* @__PURE__ */ new Map();
    for (const f of this.facIndex) if (_Game.taskFacility(f.id, f.key)) (facilities.get(f.key) ?? facilities.set(f.key, []).get(f.key)).push(f.id);
    const open = this.db.prepare("SELECT location_id, parent_id FROM tasks WHERE kind = 'incident' AND state IN ('offered','claimed')").all();
    const clock = this.localClock();
    return {
      hasFeature: (l, f) => this.hasFeature(l, f),
      nowMin: this.gameMin(),
      hour: clock.hour,
      dayIndex: clock.dayIndex,
      occupied,
      vacant,
      houses,
      facilities,
      occupancy: this.net.houses.length ? occupied.length / this.net.houses.length : 0,
      openNormal: open.filter((o) => !o.parent_id).length,
      busy: new Set(open.map((o) => o.location_id)),
      lastAt: (code, loc) => this.lastSeen.get(loc ? `${code}|${loc}` : code),
      groupFactor: (g) => this.weather ? groupFactor(this.weather.kind, g) : 1
    };
  }
  noteCreated(code, loc) {
    const m = this.gameMin();
    this.lastSeen.set(code, m);
    this.lastSeen.set(`${code}|${loc}`, m);
  }
  /** allowBusy: a crisis/story report or a task placed by the game master may share a facility that already has an
   *  open task (a crisis at the pool must not vanish because a normal pool task is open) */
  pickLocation(tpl, env2, allowBusy = false) {
    const r = tpl.location;
    const feat = (l) => !r.feature || this.hasFeature(l, r.feature);
    const list = (r.kind === "house" ? r.vacant ? env2.vacant : r.occupied ? env2.occupied : env2.houses : r.kind === "grounds" ? env2.houses : (r.facilities ?? []).flatMap((f) => env2.facilities.get(f) ?? [])).filter(feat);
    const free = list.filter((l) => !env2.busy.has(l));
    const pool = free.length ? free : r.kind === "house" && r.occupied ? env2.houses.filter((l) => feat(l) && !env2.busy.has(l)) : allowBusy ? list : [];
    return pool.length ? this.botRand.pick(pool) : void 0;
  }
  /** Create an incident task from the library (random suitable template when none is given). */
  createIncident(opts = {}) {
    const env2 = this.schedEnv();
    let tpl;
    if (opts.template) {
      tpl = templateByCode.get(opts.template);
      if (!tpl) throw new ApiError(422, "unknown_template", "Onbekend sjabloon");
    } else {
      const s = this.scheduler.suggest(env2);
      tpl = s ? templateByCode.get(s.code) : void 0;
      if (s && !opts.locationId && !opts.houseNumber) opts = { ...opts, locationId: s.location };
      if (!tpl) throw new ApiError(409, "no_location", "Geen geschikte opdracht of vrije locatie");
    }
    let loc = opts.locationId ?? (opts.houseNumber ? `H${opts.houseNumber}` : void 0);
    if (loc && loc.startsWith("H") && !this.net.houses.some((h) => h.id === loc)) throw new ApiError(404, "no_location", `Villa ${houseLabel(Number(loc.slice(1)))} bestaat niet`);
    if (loc && tpl.location.kind === "facility" && !loc.startsWith("F-")) loc = void 0;
    loc ??= this.pickLocation(tpl, env2, !!opts.parentId || !!opts.template);
    if (!loc) throw new ApiError(409, "no_location", "Geen vrije locatie");
    const id = `T-inc-${randomUUID().slice(0, 8)}`;
    const nm = this.locationName(loc, tpl.location.kind === "grounds");
    let text = this.botRand.pick(tpl.texts).replaceAll("{loc}", nm).replaceAll("{n}", loc.startsWith("H") ? loc.slice(1) : nm);
    for (const [k, v] of Object.entries(opts.vars ?? {})) text = text.replaceAll(`{${k}}`, v);
    const short = loc.startsWith("H") ? loc.slice(1) : nm;
    this.insertTask({
      id,
      template: tpl.code,
      kind: "incident",
      category: tpl.category,
      title: `${tpl.title} (${short})`,
      description: text,
      location_id: loc,
      booking_id: null,
      vehicle_id: null,
      gate_id: null,
      icon: tpl.icon,
      offered_at: this.nowMs(),
      claim_seconds: Math.round(tpl.claimMin * 60),
      difficulty: tpl.difficulty,
      urgency: tpl.urgency,
      points: pointsFor(tpl.difficulty, tpl.urgency),
      parent_id: opts.parentId ?? null,
      depth: opts.depth ?? 0,
      fx: tpl.fx
    });
    this.noteCreated(tpl.code, loc);
    return this.taskDto(this.getTask(id));
  }
  /** Major incident (crisis): an incident record with stages of independently claimable tasks. */
  createCrisis(opts = {}) {
    const env2 = this.schedEnv();
    const c = opts.code ? crisisByCode.get(opts.code) : this.botRand.pick(CRISES);
    if (!c) throw new ApiError(422, "unknown_crisis", "Onbekende crisis");
    const active = this.db.prepare("SELECT COUNT(*) AS n FROM incidents WHERE state = 'active' AND code = ?").get(c.code);
    if (active.n) throw new ApiError(409, "crisis_active", `${c.title} loopt al`);
    const list = c.location.kind === "facility" ? (c.location.facilities ?? []).flatMap((f) => env2.facilities.get(f) ?? []) : env2.houses;
    const loc = opts.locationId ?? (list.length ? this.botRand.pick(list) : void 0);
    if (!loc) throw new ApiError(409, "no_location", "Geen locatie voor deze crisis");
    const id = `C-${randomUUID().slice(0, 8)}`;
    const text = this.botRand.pick(c.texts).replaceAll("{loc}", this.locationName(loc, c.location.kind === "grounds"));
    this.db.prepare("INSERT INTO incidents (id, code, title, description, location_id, stage, state, started_at) VALUES (?, ?, ?, ?, ?, 0, 'active', ?)").run(id, c.code, c.title, text, loc, this.nowMs());
    if (c.code === "CRISIS_STORM" && this.weather && this.weather.kind !== "onweer") {
      forceWeather(this.weather, "onweer", this.nowMs(), this.localClock().hour, 45);
      this.weather.locked = false;
      this.event("weather.changed", { kind: "onweer", name: WEATHER_NAMES.onweer });
    }
    this.noteCreated(c.code, loc);
    this.event("incident.started", { incidentId: id, code: c.code, title: c.title, description: text, locationId: loc, stage: c.stages[0].text });
    this.spawnStage(id, c.stages[0].tasks, loc);
    this.audit("system", "crisis_started", { incidentId: id, code: c.code });
    return this.incidentDto(id);
  }
  spawnStage(incidentId, codes, crisisLoc) {
    for (const code of codes) {
      const tpl = templateByCode.get(code);
      const loc = tpl.location.kind === "facility" ? void 0 : crisisLoc;
      try {
        this.createIncident({ template: code, locationId: loc, parentId: incidentId });
      } catch {
      }
    }
  }
  crisisTick() {
    const act = this.db.prepare("SELECT * FROM incidents WHERE state = 'active'").all();
    for (const inc of act) {
      const c = crisisByCode.get(inc.code);
      if (!c) continue;
      const next = c.stages[inc.stage + 1];
      const elapsedMin = (this.nowMs() - inc.started_at) / 6e4;
      if (next && elapsedMin >= next.afterMin) {
        this.db.prepare("UPDATE incidents SET stage = stage + 1 WHERE id = ?").run(inc.id);
        this.event("incident.escalated", { incidentId: inc.id, code: inc.code, stage: inc.stage + 1, text: next.text });
        this.spawnStage(inc.id, next.tasks, inc.location_id);
        continue;
      }
      if (next) continue;
      const open = this.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE parent_id = ? AND state IN ('offered','claimed')").get(inc.id).n;
      if (!open) {
        this.db.prepare("UPDATE incidents SET state = 'resolved', resolved_at = ? WHERE id = ?").run(this.nowMs(), inc.id);
        this.applyEffect(inc.location_id, { mood: 0.2, tech: 0.2 });
        this.event("incident.resolved", { incidentId: inc.id, code: inc.code, locationId: inc.location_id });
        this.event("visual.effect", { locationId: inc.location_id, fx: "confetti" });
        this.broadcastState();
      }
    }
  }
  /** status of the running crises for the projector panel and the dashboard */
  crisisStatus() {
    const rows = this.db.prepare("SELECT id, code, title, location_id, stage, started_at FROM incidents WHERE state = 'active' ORDER BY started_at").all();
    return rows.map((r) => {
      const c = crisisByCode.get(r.code);
      const tasks = this.db.prepare("SELECT state FROM tasks WHERE parent_id = ?").all(r.id);
      const total = c ? c.stages.reduce((a, st) => a + st.tasks.length, 0) : tasks.length;
      const next = c?.stages[r.stage + 1];
      return {
        id: r.id,
        code: r.code,
        title: r.title,
        locationId: r.location_id,
        locationName: this.locationName(r.location_id, c?.location.kind === "grounds"),
        stage: r.stage,
        stages: c?.stages.length ?? 1,
        current: c?.stages[r.stage]?.text ?? "",
        startedAt: r.started_at,
        done: tasks.filter((t2) => t2.state === "completed").length,
        open: tasks.filter((t2) => t2.state === "offered" || t2.state === "claimed").length,
        claimed: tasks.filter((t2) => t2.state === "claimed").length,
        total,
        nextAt: next ? r.started_at + next.afterMin * 6e4 : null
      };
    });
  }
  incidentDto(id) {
    const r = this.db.prepare("SELECT * FROM incidents WHERE id = ?").get(id);
    if (!r) throw new ApiError(404, "not_found", "Crisis niet gevonden");
    const tasks = this.db.prepare("SELECT * FROM tasks WHERE parent_id = ? ORDER BY offered_at").all(id).map((t2) => this.taskDto(t2));
    return { id: r.id, code: r.code, title: r.title, description: r.description, locationId: r.location_id, stage: r.stage, stages: crisisByCode.get(r.code)?.stages.length ?? 1, state: r.state, startedAt: r.started_at, resolvedAt: r.resolved_at, tasks };
  }
  listIncidents(all = false) {
    const rows = this.db.prepare(all ? "SELECT id FROM incidents ORDER BY started_at DESC LIMIT 50" : "SELECT id FROM incidents WHERE state = 'active' ORDER BY started_at").all();
    return rows.map((r) => this.incidentDto(r.id));
  }
  // location condition (tech / clean / mood per bungalow or facility)
  stateOf(id) {
    return this.locState.get(id) ?? { tech: 0.85, clean: 0.85, mood: 0.85 };
  }
  applyEffect(id, e) {
    if (!id) return;
    const c = this.stateOf(id), cl = (v) => Math.max(0, Math.min(1, +v.toFixed(3)));
    const n = { tech: cl(c.tech + (e.tech ?? 0)), clean: cl(c.clean + (e.clean ?? 0)), mood: cl(c.mood + (e.mood ?? 0)) };
    this.locState.set(id, n);
    this.db.prepare("INSERT INTO location_state (id, tech, clean, mood, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET tech = excluded.tech, clean = excluded.clean, mood = excluded.mood, updated_at = excluded.updated_at").run(id, n.tech, n.clean, n.mood, this.nowMs());
  }
  /** locations in the worst condition (game master overview) */
  worstLocations(n = 10) {
    return [...this.locState.keys()].map((id) => ({ id, name: this.locationName(id), cond: this.condOf(id), ...this.stateOf(id) })).filter((x) => x.cond < 0.8).sort((a, b) => a.cond - b.cond).slice(0, n);
  }
  /** overall condition of one location (0..1, mean of technical state, cleanliness and mood) */
  condOf(id) {
    const c = this.stateOf(id);
    return +((c.tech + c.clean + c.mood) / 3).toFixed(2);
  }
  /** park health: average condition over all bungalows and facilities (untouched locations count as 0.85) */
  parkHealth() {
    const ids = [...this.net.houses.map((h) => h.id), ...this.facIndex.map((f) => f.id)];
    const sum = { tech: 0, clean: 0, mood: 0 };
    for (const id of ids) {
      const c = this.stateOf(id);
      sum.tech += c.tech;
      sum.clean += c.clean;
      sum.mood += c.mood;
    }
    const n = ids.length || 1, r = (v) => +(v / n).toFixed(3);
    return { tech: r(sum.tech), clean: r(sum.clean), mood: r(sum.mood), overall: r((sum.tech + sum.clean + sum.mood) / 3) };
  }
  /** escalation of an incident task that timed out: one follow-up (bounded depth, global budget) */
  escalate(t2, why) {
    const tpl = templateByCode.get(t2.template);
    const nextCode = tpl?.onTimeout.escalate;
    if (!nextCode || t2.escalated || (t2.depth ?? 0) >= 2) return;
    const now = this.gameMin();
    this.escalationLog = this.escalationLog.filter((m) => now - m < 60);
    if (this.escalationLog.length >= 4) return;
    const last = this.lastSeen.get(`${nextCode}|${t2.location_id}`);
    if (last !== void 0 && now - last < (templateByCode.get(nextCode)?.cooldownMin ?? 60)) return;
    this.db.prepare("UPDATE tasks SET escalated = 1 WHERE id = ?").run(t2.id);
    try {
      const f = this.createIncident({ template: nextCode, locationId: t2.location_id ?? void 0, parentId: t2.parent_id ?? null, depth: (t2.depth ?? 0) + 1 });
      this.escalationLog.push(now);
      this.event("task.escalated", { taskId: t2.id, followUpTaskId: f.id, template: nextCode, reason: why });
    } catch {
    }
  }
  idem(key, playerId, action, taskId, run) {
    if (!key || typeof key !== "string" || key.length < 4 || key.length > 100) throw new ApiError(422, "idempotency_key_required", "idempotencyKey (4-100 tekens) is verplicht");
    return tx(this.db, () => {
      const prev = this.db.prepare("SELECT status, response, task_id FROM idempotency WHERE key = ? AND player_id = ? AND action = ?").get(key, playerId, action);
      if (prev) {
        if (prev.task_id !== taskId) throw new ApiError(422, "idempotency_key_reused", "Deze idempotencyKey hoort bij een andere opdracht");
        return { status: prev.status, body: { ...JSON.parse(prev.response), replayed: true } };
      }
      let res;
      try {
        res = run();
      } catch (e) {
        if (e instanceof ApiError) res = { status: e.status, body: { error: e.code, message: e.message, ...e.extra } };
        else throw e;
      }
      this.db.prepare("INSERT INTO idempotency (key, player_id, action, task_id, status, response, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(key, playerId, action, taskId, res.status, JSON.stringify(res.body), Date.now());
      return res;
    });
  }
  claim(taskId, player, key) {
    const res = this.idem(key, player.id, "claim", taskId, () => {
      const t2 = this.getTask(taskId);
      if (!t2) throw new ApiError(404, "not_found", "Opdracht bestaat niet");
      if (t2.state === "claimed" && t2.assigned_player_id === player.id) return { status: 200, body: { task: this.taskDto(t2), alreadyClaimed: true } };
      if (t2.state !== "offered") throw new ApiError(409, t2.state === "claimed" ? "already_claimed" : "not_offered", t2.state === "claimed" ? "Een andere speler was je voor" : `Opdracht is ${t2.state}`, { state: t2.state });
      const active = this.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE assigned_player_id = ? AND state = 'claimed'").get(player.id).n;
      if (active >= MAX_CLAIMS) throw new ApiError(409, "claim_limit", `Je hebt al ${MAX_CLAIMS} actieve opdrachten`);
      const now = this.nowMs();
      const r = this.db.prepare("UPDATE tasks SET state = 'claimed', assigned_player_id = ?, claimed_at = ?, deadline_at = ?, version = version + 1 WHERE id = ? AND state = 'offered' AND version = ?").run(player.id, now, now + t2.claim_seconds * 1e3, taskId, t2.version);
      if (r.changes !== 1) throw new ApiError(409, "already_claimed", "Een andere speler was je voor");
      return { status: 200, body: { task: this.taskDto(this.getTask(taskId)) } };
    });
    if (res.status === 200 && !res.body.replayed && !res.body.alreadyClaimed) {
      this.event("task.claimed", { taskId, playerId: player.id, displayName: player.display_name });
      this.techStart(this.getTask(taskId));
      this.broadcastState();
    }
    return res;
  }
  complete(taskId, player, key) {
    let issued = null;
    let awarded = 0;
    const pre = this.getTask(taskId);
    if (pre && key && typeof key === "string" && key.length >= 4 && key.length <= 100 && pre.state === "claimed" && pre.assigned_player_id === player.id) this.assertTechOnSite(pre);
    const res = this.idem(key, player.id, "complete", taskId, () => {
      const t2 = this.getTask(taskId);
      if (!t2) throw new ApiError(404, "not_found", "Opdracht bestaat niet");
      if (t2.state === "completed") {
        if (t2.assigned_player_id === player.id) return { status: 200, body: { task: this.taskDto(t2), alreadyCompleted: true, pointsAwarded: 0 } };
        throw new ApiError(409, "already_completed", "Opdracht is al afgerond");
      }
      if (t2.state !== "claimed") throw new ApiError(409, "not_claimed", "Claim de opdracht eerst");
      if (t2.assigned_player_id !== player.id) throw new ApiError(403, "not_assignee", "Deze opdracht is door een andere speler geclaimd");
      const now = this.nowMs();
      if (t2.deadline_at !== null && now > t2.deadline_at) throw new ApiError(409, "deadline_passed", "De deadline is verstreken; de opdracht wordt opnieuw aangeboden");
      const r = this.db.prepare("UPDATE tasks SET state = 'completed', completed_at = ?, points_awarded = points, version = version + 1 WHERE id = ? AND state = 'claimed' AND assigned_player_id = ? AND version = ?").run(now, taskId, player.id, t2.version);
      if (r.changes !== 1) throw new ApiError(409, "conflict", "Opdracht is gewijzigd, probeer opnieuw");
      this.db.prepare("INSERT INTO score_ledger (player_id, task_id, points, reason, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(player.id, taskId, t2.points, `task:${t2.template}`, player.id, Date.now());
      this.db.prepare("UPDATE players SET score = score + ? WHERE id = ?").run(t2.points, player.id);
      awarded = t2.points;
      if ((t2.kind === "checkin" || t2.kind === "checkout") && t2.vehicle_id && t2.gate_id) {
        const pid = `GP-${randomUUID().slice(0, 12)}`;
        this.db.prepare("INSERT INTO gate_passages (id, session_id, vehicle_id, gate_id, direction, task_id, source, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'task', 'authorized', ?)").run(pid, this.gameId, t2.vehicle_id, t2.gate_id, t2.kind === "checkin" ? "inbound" : "outbound", taskId, now);
        issued = { passageId: pid, gateId: t2.gate_id, vehicleId: t2.vehicle_id };
      }
      return { status: 200, body: { task: this.taskDto(this.getTask(taskId)), pointsAwarded: t2.points, passage: issued } };
    });
    if (res.status === 200 && awarded > 0) {
      const t2 = this.getTask(taskId);
      const tpl = t2.kind === "incident" ? templateByCode.get(t2.template) : void 0;
      this.event("task.completed", { taskId, playerId: player.id, displayName: player.display_name, points: awarded, kind: t2.kind, locationId: t2.location_id, gateId: t2.gate_id, fx: t2.fx ?? null });
      if (tpl) {
        this.applyEffect(t2.location_id, tpl.onComplete);
        this.event("visual.effect", { locationId: t2.location_id, fx: tpl.fx });
      }
      this.techStop(taskId);
      if (t2.parent_id?.startsWith("S-")) this.stories.onTaskOutcome(taskId, t2.parent_id, "completed");
      if (issued) this.event("gate.token_issued", issued);
      if (t2.kind === "checkin" || t2.kind === "checkout") {
        const b = t2.booking_id ? this.park.bookings.get(t2.booking_id) : void 0;
        if (b && t2.kind === "checkin" && b.status === "queued_in") {
          b.status = "checked_in";
          b.history.push({ t: this.park.t, status: "checked_in" });
        }
      }
      this.event("leaderboard.updated", { leaderboard: this.leaderboard() });
      this.broadcastState();
    }
    return res;
  }
  release(taskId, player) {
    const ok = tx(this.db, () => {
      const t2 = this.getTask(taskId);
      if (!t2) throw new ApiError(404, "not_found", "Opdracht bestaat niet");
      if (t2.state !== "claimed" || t2.assigned_player_id !== player.id) throw new ApiError(409, "not_claimed_by_you", "Je kunt alleen je eigen geclaimde opdracht vrijgeven");
      this.db.prepare("UPDATE tasks SET state = 'offered', assigned_player_id = NULL, claimed_at = NULL, deadline_at = NULL, attempt = attempt + 1, version = version + 1 WHERE id = ?").run(taskId);
      return true;
    });
    if (ok) {
      this.event("task.reoffered", { taskId, reason: "released" });
      this.techStop(taskId);
      this.broadcastState();
    }
    return { task: this.taskDto(this.getTask(taskId)) };
  }
  expireDue() {
    const now = this.nowMs();
    const due = this.db.prepare("SELECT * FROM tasks WHERE state = 'claimed' AND deadline_at < ?").all(now);
    for (const t2 of due) {
      const r = this.db.prepare("UPDATE tasks SET state = 'offered', assigned_player_id = NULL, claimed_at = NULL, deadline_at = NULL, attempt = attempt + 1, version = version + 1 WHERE id = ? AND state = 'claimed' AND version = ?").run(t2.id, t2.version);
      if (r.changes) {
        this.event("task.expired", { taskId: t2.id, playerId: t2.assigned_player_id });
        this.techStop(t2.id);
        this.event("task.reoffered", { taskId: t2.id, attempt: t2.attempt + 1 });
        if (t2.booking_id) {
          const b = this.park.bookings.get(t2.booking_id);
          if (b) b.satisfaction = Math.max(0.2, b.satisfaction - 0.05);
        }
        const tpl = t2.kind === "incident" ? templateByCode.get(t2.template) : void 0;
        if (tpl) {
          this.applyEffect(t2.location_id, tpl.onTimeout);
          if (t2.attempt + 1 >= 3) this.escalate({ ...t2, attempt: t2.attempt + 1 }, "claim_timeout");
        }
      }
    }
    const stale = this.db.prepare("SELECT * FROM tasks WHERE state = 'offered' AND kind = 'incident' AND (parent_id IS NULL OR parent_id LIKE 'S-%')").all();
    let expired = 0;
    for (const t2 of stale) {
      const tpl = templateByCode.get(t2.template);
      if (!tpl || now - t2.offered_at < tpl.offeredMaxMin * 6e4) continue;
      const r = this.db.prepare("UPDATE tasks SET state = 'expired', version = version + 1 WHERE id = ? AND state = 'offered' AND version = ?").run(t2.id, t2.version);
      if (!r.changes) continue;
      expired++;
      this.event("task.expired", { taskId: t2.id, reason: "not_claimed" });
      this.applyEffect(t2.location_id, tpl.onTimeout);
      this.escalate(t2, "not_claimed");
      if (t2.parent_id?.startsWith("S-")) this.stories.onTaskOutcome(t2.id, t2.parent_id, "expired");
    }
    if (due.length || expired) this.broadcastState();
  }
  cancelTask(taskId, reason) {
    const t2 = this.getTask(taskId);
    if (!t2) throw new ApiError(404, "not_found", "Opdracht bestaat niet");
    if (t2.kind !== "incident") throw new ApiError(422, "not_cancellable", "Check-in/check-out opdrachten horen bij een voertuig en kunnen niet geannuleerd worden; gebruik de noodbediening");
    this.db.prepare("UPDATE tasks SET state = 'cancelled', version = version + 1 WHERE id = ? AND state IN ('offered','claimed')").run(taskId);
    this.audit("admin", "cancel_task", { taskId, reason });
    this.event("task.cancelled", { taskId, reason });
    this.techStop(taskId);
    if (t2.parent_id?.startsWith("S-")) this.stories.onTaskOutcome(taskId, t2.parent_id, "cancelled");
    this.broadcastState();
  }
  /** a storyline ended while its chapter task was still open (no audit entry: the story event explains it) */
  cancelChapterTask(taskId, reason) {
    const r = this.db.prepare("UPDATE tasks SET state = 'cancelled', version = version + 1 WHERE id = ? AND state IN ('offered','claimed')").run(taskId);
    if (!r.changes) return;
    this.event("task.cancelled", { taskId, reason });
    this.techStop(taskId);
  }
  // ------------------------------------------------------------------ guest storylines (guestlib + stories.ts)
  makeStories() {
    return new StoryDirector({
      db: this.db,
      nowMs: () => this.nowMs(),
      isDay: () => this.scheduler.isDay(this.localClock().hour),
      bookings: () => this.park.bookings.values(),
      rand: () => this.botRand.next(),
      createChapterTask: (code, houseNumber, storyId, vars) => {
        const tpl = templateByCode.get(code);
        if (!tpl) return null;
        try {
          const t2 = this.createIncident({ template: code, locationId: tpl.location.kind === "facility" ? void 0 : `H${houseNumber}`, parentId: storyId, vars });
          return { id: t2.id, locationId: t2.locationId, title: t2.title.replace(/\s*\([^)]*\)$/, ""), points: t2.points };
        } catch {
          return null;
        }
      },
      cancelChapterTask: (id, reason) => this.cancelChapterTask(id, reason),
      applyEffect: (loc, e) => {
        this.applyEffect(loc, e);
        const b = this.park.bookings.get(this.park.houses.get(Number(loc.slice(1)))?.bookingId ?? "");
        if (b && e.mood) b.satisfaction = Math.max(0.2, Math.min(1, b.satisfaction + e.mood * 0.5));
      },
      event: (type, payload) => {
        this.event(type, payload);
        this.broadcastState();
      }
    });
  }
  // ------------------------------------------------------------------ weather
  weatherTick() {
    if (!this.weather) this.weather = newWeather(this.nowMs(), this.localClock().hour);
    const before = this.weather.kind;
    const changed = stepWeather(this.weather, this.nowMs(), this.localClock().hour);
    if (changed) {
      this.event("weather.changed", { from: before, kind: this.weather.kind, name: WEATHER_NAMES[this.weather.kind] });
      if (this.weather.kind === "onweer" && this.scheduler.isDay(this.localClock().hour) && this.botRand.next() < 0.5) {
        try {
          this.createCrisis({ code: "CRISIS_STORM" });
        } catch {
        }
      }
      this.broadcastState();
    }
    setMeta(this.db, "weather", JSON.stringify(this.weather));
  }
  /** game master: set the weather for a number of game minutes ('auto' = let it change by itself again) */
  setWeather(kind, minutes = 60) {
    if (!this.weather) this.weather = newWeather(this.nowMs(), this.localClock().hour);
    if (kind === "auto") {
      this.weather.locked = false;
      this.weather.until = this.nowMs();
      this.weatherTick();
    } else {
      if (!WEATHER_KINDS.includes(kind)) throw new ApiError(422, "invalid_weather", `Weer moet een van ${WEATHER_KINDS.join(", ")} of auto zijn`);
      const m = Number(minutes);
      if (!(m >= 5 && m <= 600)) throw new ApiError(422, "invalid_weather", "Duur 5-600 speelminuten");
      const before = this.weather.kind;
      forceWeather(this.weather, kind, this.nowMs(), this.localClock().hour, m);
      setMeta(this.db, "weather", JSON.stringify(this.weather));
      this.event("weather.changed", { from: before, kind, name: WEATHER_NAMES[kind], forced: true });
    }
    this.audit("admin", "weather", { kind, minutes });
    this.broadcastState();
    return this.weather;
  }
  setDisplay(d) {
    const next = { ...this.display };
    if (d.popupSeconds !== void 0) {
      const v = Number(d.popupSeconds);
      if (!(Number.isFinite(v) && v >= 5 && v <= 120)) throw new ApiError(422, "invalid_config", "Pop-upduur moet tussen 5 en 120 seconden liggen");
      next.popupSeconds = Math.round(v);
    }
    for (const k of ["dayNight", "ambientSound"]) if (d[k] !== void 0) {
      if (typeof d[k] !== "boolean") throw new ApiError(422, "invalid_config", `${k} moet true of false zijn`);
      next[k] = d[k];
    }
    if (d.autoZoom !== void 0) {
      if (!["uit", "crises", "alles"].includes(d.autoZoom)) throw new ApiError(422, "invalid_config", "autoZoom moet uit, crises of alles zijn");
      next.autoZoom = d.autoZoom;
    }
    this.display = next;
    setMeta(this.db, "display", JSON.stringify(this.display));
    this.audit("admin", "display", { ...this.display });
    this.broadcastState();
    return this.display;
  }
  storiesInfo() {
    return { config: this.stories.cfg, active: this.stories.list(), recent: this.stories.list(true) };
  }
  startStory(opts) {
    try {
      return this.stories.start(opts);
    } catch (e) {
      const m = e.message;
      if (m === "unknown_story") throw new ApiError(422, "unknown_story", "Onbekende verhaallijn");
      if (m === "no_household") throw new ApiError(409, "no_household", "Geen huishouden in een villa past bij deze verhaallijn (of het heeft al een verhaal)");
      throw e;
    }
  }
  setStoryConfig(c) {
    const err = validateStoryConfig(c);
    if (err.length) throw new ApiError(422, "invalid_config", err.join("; "));
    this.stories.setConfig({ ...c.enabled !== void 0 ? { enabled: c.enabled } : {}, ...c.perHourDay !== void 0 ? { perHourDay: c.perHourDay } : {}, ...c.maxActive !== void 0 ? { maxActive: c.maxActive } : {} });
    this.audit("admin", "stories_config", { ...c });
    return this.storiesInfo();
  }
  /** Incidents handled by the technical service get a golf cart (claim -> drive to location; done -> back to the TD post). */
  techStart(t2) {
    if (t2.kind !== "incident" || !templateByCode.get(t2.template)?.td || !t2.location_id?.startsWith("H")) return;
    this.park.dispatchTechnician(t2.id, Number(t2.location_id.slice(1)));
  }
  techStop(taskId) {
    this.park.releaseTechnician(taskId);
  }
  /** A dispatched mechanic must have reached the bungalow before the task may be completed. */
  techBlocksCompletion(t2) {
    const st = this.park.techStatus(t2.id);
    return !!st && !st.onSite;
  }
  assertTechOnSite(t2) {
    const st = this.park.techStatus(t2.id);
    if (!st || st.onSite) return;
    const where = st.phase === "pending" ? "wacht nog op een vrije golfkar" : st.phase === "driving" ? `rijdt met ${st.vehicleId} naar villa ${houseLabel(st.houseNumber)}` : `loopt naar bungalow ${houseLabel(st.houseNumber)}`;
    throw new ApiError(409, "technician_not_on_site", `De monteur is nog niet ter plaatse (${where}). Afronden kan zodra hij in de villa is.`, { technician: st });
  }
  // ------------------------------------------------------------------ gate passage tokens
  consumeToken(vehicleId, gateId) {
    const row = this.db.prepare("UPDATE gate_passages SET status = 'consumed', consumed_at = ? WHERE id = (SELECT id FROM gate_passages WHERE vehicle_id = ? AND gate_id = ? AND status = 'authorized' ORDER BY created_at LIMIT 1) RETURNING id").get(this.nowMs(), vehicleId, gateId);
    return row?.id ?? null;
  }
  /** Staff pass for a service vehicle (maintenance van, cleaning cart, TD golf cart): logged as its own passage source.
   *  At a staff barrier (personeelsweg) it is the personeelspas ('staff_pass'); at a visitor barrier it is the
   *  fallback 'service' pass (only when no route without a visitor barrier exists). */
  servicePass(vehicleId, gateId) {
    const g = this.net.gates.get(gateId);
    const pid = `${g.staff ? "PP" : "GS"}-${randomUUID().slice(0, 12)}`;
    const source = g.staff ? "staff_pass" : "service";
    this.db.prepare("INSERT INTO gate_passages (id, session_id, vehicle_id, gate_id, direction, task_id, source, status, created_at, consumed_at) VALUES (?, ?, ?, ?, ?, NULL, ?, 'consumed', ?, ?)").run(pid, this.gameId, vehicleId, gateId, g.direction, source, this.nowMs(), this.nowMs());
    this.event(g.staff ? "gate.staff_pass" : "gate.service_pass", { gateId, vehicleId, passageId: pid });
    return pid;
  }
  finishPassage(id, status) {
    this.db.prepare("UPDATE gate_passages SET status = ?, finished_at = ? WHERE id = ? AND status = 'consumed'").run(status, this.nowMs(), id);
  }
  /** After a restart: a token consumed for a gate that is not (any longer) open for that vehicle is re-armed - never duplicated. */
  reconcilePassages() {
    const consumed = this.db.prepare("SELECT * FROM gate_passages WHERE status = 'consumed'").all();
    for (const p of consumed) {
      const gs = this.park.traffic.gates.get(p.gate_id);
      const veh = this.park.traffic.vehicles.find((v) => v.spec.id === p.vehicle_id);
      const live = gs && gs.passageId === p.id;
      if (live) continue;
      if (veh && !veh.passedGates.includes(p.gate_id)) {
        this.db.prepare("UPDATE gate_passages SET status = 'authorized', consumed_at = NULL WHERE id = ?").run(p.id);
        this.audit("system", "rearm_passage_after_restart", { passageId: p.id });
      } else {
        this.db.prepare("UPDATE gate_passages SET status = 'completed', finished_at = ? WHERE id = ?").run(this.nowMs(), p.id);
      }
    }
  }
  /** Operator emergency override (admin only, audited). Authorises the vehicle at the head of the gate's queue. */
  overrideGate(gateId, reason) {
    const gs = this.park.traffic.gates.get(gateId);
    if (!gs) throw new ApiError(404, "not_found", "Slagboom bestaat niet");
    if (!reason || reason.trim().length < 5) throw new ApiError(422, "reason_required", "Geef een reden (min. 5 tekens) voor de noodbediening");
    const head = gs.queue[0];
    if (!head) throw new ApiError(409, "queue_empty", "Er staat geen voertuig voor deze slagboom");
    const exists = this.db.prepare("SELECT id FROM gate_passages WHERE vehicle_id = ? AND gate_id = ? AND status IN ('authorized','consumed')").get(head, gateId);
    if (exists) throw new ApiError(409, "already_authorized", "Dit voertuig heeft al een geldige passage");
    const pid = `GP-OVR-${randomUUID().slice(0, 8)}`;
    this.db.prepare("INSERT INTO gate_passages (id, session_id, vehicle_id, gate_id, direction, task_id, source, status, created_at) VALUES (?, ?, ?, ?, ?, NULL, 'admin_override', 'authorized', ?)").run(pid, this.gameId, head, gateId, this.net.gates.get(gateId).direction, this.nowMs());
    this.audit("admin", "gate_override", { gateId, vehicleId: head, reason, passageId: pid });
    this.event("gate.override", { gateId, vehicleId: head, reason });
    return { passageId: pid, vehicleId: head };
  }
  audit(actor, action, detail) {
    this.db.prepare("INSERT INTO audit_log (actor, action, detail, created_at) VALUES (?, ?, ?, ?)").run(actor, action, JSON.stringify(detail), Date.now());
  }
  auditLog(limit = 100) {
    return this.db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").all(Math.max(1, Math.min(5e3, limit))).map((r) => ({ ...r, detail: (() => {
      try {
        return JSON.parse(r.detail);
      } catch {
        return r.detail;
      }
    })() }));
  }
  /** score ledger with player names (newest first) */
  ledger(limit = 200) {
    return this.db.prepare("SELECT l.id, l.player_id AS playerId, p.display_name AS displayName, l.task_id AS taskId, l.points, l.reason, l.actor, l.created_at AS createdAt FROM score_ledger l LEFT JOIN players p ON p.id = l.player_id ORDER BY l.id DESC LIMIT ?").all(Math.max(1, Math.min(5e3, limit)));
  }
  // ------------------------------------------------------------------ game master: scores, content, export
  /** Manual score correction: always a ledger row + audit entry with a reason (score = sum of the ledger). */
  adjustScore(playerId, delta, reason) {
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1e4) throw new ApiError(422, "invalid_delta", "Aanpassing moet een geheel getal zijn tussen -10000 en 10000 (niet 0)");
    const why = String(reason ?? "").trim();
    if (why.length < 3 || why.length > 200) throw new ApiError(422, "reason_required", "Geef een reden (3-200 tekens); die komt in het logboek");
    const res = tx(this.db, () => {
      const p = this.db.prepare("SELECT * FROM players WHERE id = ?").get(playerId);
      if (!p) throw new ApiError(404, "not_found", "Speler bestaat niet");
      this.db.prepare("INSERT INTO score_ledger (player_id, task_id, points, reason, actor, created_at) VALUES (?, NULL, ?, ?, ?, ?)").run(playerId, delta, `admin:${why}`, "admin", Date.now());
      this.db.prepare("UPDATE players SET score = score + ? WHERE id = ?").run(delta, playerId);
      return { playerId, displayName: p.display_name, before: p.score, after: p.score + delta };
    });
    this.audit("admin", "score_adjust", { ...res, delta, reason: why });
    this.event("score.adjusted", { ...res, delta, reason: why });
    this.event("leaderboard.updated", { leaderboard: this.leaderboard() });
    this.broadcastState();
    return res;
  }
  contentCall(action, detail, fn) {
    try {
      const r = fn();
      this.audit("admin", action, detail);
      return r;
    } catch (e) {
      if (e instanceof ContentError) throw new ApiError(422, "invalid_content", e.message, { problems: e.problems });
      throw e;
    }
  }
  setNames(n) {
    return this.contentCall("names_update", { first: n.first?.length ?? 0, surnames: n.surnames?.length ?? 0, kids: n.kids?.length ?? 0, cameos: n.cameos?.length ?? 0 }, () => this.content.setNames(n));
  }
  saveCustomTask(t2) {
    return this.contentCall("custom_task_save", { code: t2.code ?? null, title: t2.title }, () => this.content.saveTask(t2));
  }
  deleteCustomTask(code) {
    return this.contentCall("custom_task_delete", { code }, () => {
      this.content.deleteTask(code);
      return { ok: true };
    });
  }
  facilities() {
    const seen = /* @__PURE__ */ new Map();
    for (const f of this.facIndex) if (!seen.has(f.key)) seen.set(f.key, f.name);
    return [...seen].map(([key, name]) => ({ key, name })).sort((a, b) => a.key.localeCompare(b.key));
  }
  /** Everything needed to archive or analyse a game (JSON; the dashboard also makes CSV files from it). */
  exportAll() {
    this.audit("admin", "export", {});
    const all = (sql) => this.db.prepare(sql).all();
    return {
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      gameId: this.gameId,
      seed: this.cfg.seed,
      park: this.parkSummary(),
      leaderboard: this.leaderboard(),
      players: this.players(),
      ledger: this.ledger(5e3),
      tasks: all("SELECT * FROM tasks ORDER BY offered_at"),
      incidents: all("SELECT * FROM incidents ORDER BY started_at"),
      stories: this.stories.list(true),
      bookings: this.bookingsDto(),
      locationState: all("SELECT * FROM location_state"),
      audit: this.auditLog(5e3),
      config: { timeScale: this.cfg.timeScale, demoBot: this.cfg.demoBot, autoArrivals: this.cfg.autoArrivals, autoGate: !!this.cfg.autoGate, scheduler: this.schedCfg, stories: this.stories.cfg },
      content: { names: this.content.names(), tasks: this.content.tasks }
    };
  }
  // ------------------------------------------------------------------ admin
  resetGame(seed = this.cfg.seed, announce = true, opts = {}) {
    wipe(this.db);
    if (opts.name !== void 0) this.gameName = opts.name;
    if (opts.code !== void 0) this.cfg.gameCode = opts.code;
    if (opts.initialOccupied !== void 0) this.cfg.initialOccupied = opts.initialOccupied;
    this.botPlan.clear();
    this.session = null;
    this.stories.wipe();
    this.stories.setConfig({});
    setMeta(this.db, "display", JSON.stringify(this.display));
    this.cfg.seed = seed;
    this.clockOriginMs = Date.now();
    this.park = this.makePark(seed);
    this.botRand = rng(seed + 99);
    setMeta(this.db, "gameId", this.gameId);
    setMeta(this.db, "seed", String(seed));
    setMeta(this.db, "gameName", this.gameName);
    setMeta(this.db, "gameCode", this.cfg.gameCode);
    setMeta(this.db, "mapChecksum", this.mapChecksum());
    setMeta(this.db, "clockOriginMs", String(this.clockOriginMs));
    this.weather = newWeather(this.nowMs(), this.localClock().hour);
    setMeta(this.db, "weather", JSON.stringify(this.weather));
    setMeta(this.db, "timeScale", String(this.cfg.timeScale));
    setMeta(this.db, "demoBot", this.cfg.demoBot ? "1" : "0");
    setMeta(this.db, "autoArrivals", this.cfg.autoArrivals ? "1" : "0");
    setMeta(this.db, "autoGate", this.cfg.autoGate ? "1" : "0");
    if (opts.demoPlayers !== false) for (const n of ["Sophie", "Mike", "Laura", "Tom", "Sanne", "Bram", "Eva", "Daan", "Lotte", "Ruben"]) this.join(this.cfg.gameCode, n, true);
    this.park.seedOccupied(this.cfg.initialOccupied);
    this.park.seedService();
    this.scheduler = new Scheduler(this.schedCfg, seed);
    this.lastSeen.clear();
    this.locState.clear();
    this.escalationLog = [];
    for (let i = 0; i < 3; i++) try {
      this.createIncident();
    } catch {
    }
    this.nextAutoArrival = 4;
    this.save();
    if (announce) this.event("game.reset", { seed });
    this.audit("admin", "reset", { seed });
    this.broadcastState();
  }
  // ------------------------------------------------------------------ games: new, save, load (game master)
  /** game tables in a saved game (events, idempotency keys, map versions, own content and other saves are not part of it) */
  static SAVE_TABLES = ["meta", "players", "tasks", "score_ledger", "gate_passages", "audit_log", "sim_state", "incidents", "location_state", "stories"];
  snapshotData() {
    this.save();
    const tables = {};
    for (const t2 of _Game.SAVE_TABLES) tables[t2] = this.db.prepare(`SELECT * FROM ${t2}`).all();
    return { format: "harderwold-save", version: 1, mapChecksum: this.mapChecksum(), gameName: this.gameName, gameMs: this.nowMs(), tables };
  }
  /** Store the running game under a name. Automatic saves (before load/new game) are pruned to the last 10. */
  saveGame(name, auto = false) {
    const nm = String(name ?? "").trim();
    if (nm.length < 2 || nm.length > 80) throw new ApiError(422, "invalid_name", "Geef de opslag een naam (2-80 tekens)");
    const data = JSON.stringify(this.snapshotData());
    const top = this.leaderboard()[0];
    const id = `G-${randomUUID().slice(0, 8)}`;
    this.db.prepare("INSERT INTO saves (id, name, game_name, created_at, auto, game_ms, players, top, map_checksum, size, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, nm, this.gameName, Date.now(), auto ? 1 : 0, this.nowMs(), this.leaderboard().length, top && top.score > 0 ? `${top.displayName} (${top.score})` : null, this.mapChecksum(), data.length, data);
    if (auto) this.db.prepare("DELETE FROM saves WHERE auto = 1 AND id NOT IN (SELECT id FROM saves WHERE auto = 1 ORDER BY created_at DESC LIMIT 10)").run();
    this.audit("admin", auto ? "autosave" : "save_game", { saveId: id, name: nm });
    return this.saveDto(id);
  }
  saveDto(id) {
    const r = this.db.prepare("SELECT id, name, game_name, created_at, auto, game_ms, players, top, map_checksum, size FROM saves WHERE id = ?").get(id);
    if (!r) throw new ApiError(404, "not_found", "Opgeslagen spel niet gevonden");
    return { id: String(r.id), name: String(r.name), gameName: String(r.game_name), createdAt: Number(r.created_at), auto: !!r.auto, gameMs: Number(r.game_ms), players: Number(r.players), top: r.top ?? null, sameMap: r.map_checksum === this.mapChecksum(), size: Number(r.size) };
  }
  listSaves() {
    return this.db.prepare("SELECT id FROM saves ORDER BY created_at DESC").all().map((r) => this.saveDto(r.id));
  }
  deleteSave(id) {
    this.saveDto(id);
    this.db.prepare("DELETE FROM saves WHERE id = ?").run(id);
    this.audit("admin", "delete_save", { saveId: id });
    return { ok: true };
  }
  /** the saved game as a file (download / move to another computer) */
  saveFile(id) {
    const r = this.db.prepare("SELECT name, data FROM saves WHERE id = ?").get(id);
    if (!r) throw new ApiError(404, "not_found", "Opgeslagen spel niet gevonden");
    return { name: r.name, ...JSON.parse(r.data) };
  }
  /** add a saved game from a file (as made by saveFile) */
  importSave(file, name) {
    if (file?.format !== "harderwold-save" || file.version !== 1 || typeof file.tables !== "object" || !file.tables) throw new ApiError(422, "invalid_save", "Dit is geen opgeslagen Harderwold-spel");
    const tables = file.tables;
    for (const t2 of _Game.SAVE_TABLES) if (!Array.isArray(tables[t2])) throw new ApiError(422, "invalid_save", `Opgeslagen spel mist de tabel ${t2}`);
    const nm = String(name ?? file.name ?? "Ge\xEFmporteerd spel").trim().slice(0, 80) || "Ge\xEFmporteerd spel";
    const players = tables.players.length;
    const data = JSON.stringify({ format: file.format, version: file.version, mapChecksum: file.mapChecksum, gameName: file.gameName, gameMs: file.gameMs, tables });
    const id = `G-${randomUUID().slice(0, 8)}`;
    this.db.prepare("INSERT INTO saves (id, name, game_name, created_at, auto, game_ms, players, top, map_checksum, size, data) VALUES (?, ?, ?, ?, 0, ?, ?, NULL, ?, ?, ?)").run(id, nm, String(file.gameName ?? "Onbekend"), Date.now(), Number(file.gameMs ?? 0), players, String(file.mapChecksum ?? ""), data.length, data);
    this.audit("admin", "import_save", { saveId: id, name: nm });
    return this.saveDto(id);
  }
  /** Replace the running game by a saved one (the running game is saved automatically first). */
  loadGame(id) {
    const r = this.db.prepare("SELECT name, data, map_checksum FROM saves WHERE id = ?").get(id);
    if (!r) throw new ApiError(404, "not_found", "Opgeslagen spel niet gevonden");
    if (r.map_checksum !== this.mapChecksum()) throw new ApiError(409, "other_map", "Dit spel is op een andere kaartversie gespeeld en past niet bij de huidige wegen");
    const snap = JSON.parse(r.data);
    this.saveGame(`Automatisch bewaard v\xF3\xF3r laden van "${r.name}"`, true);
    tx(this.db, () => {
      for (const t2 of _Game.SAVE_TABLES) this.db.exec(`DELETE FROM ${t2}`);
      this.db.exec("DELETE FROM events; DELETE FROM idempotency; DELETE FROM sqlite_sequence WHERE name IN ('events','score_ledger','audit_log')");
      for (const t2 of _Game.SAVE_TABLES) {
        const cols = new Set(this.db.prepare(`PRAGMA table_info(${t2})`).all().map((c) => c.name));
        for (const row of snap.tables[t2] ?? []) {
          const keys = Object.keys(row).filter((k) => cols.has(k));
          if (!keys.length) continue;
          this.db.prepare(`INSERT INTO ${t2} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...keys.map((k) => row[k]));
        }
      }
    });
    this.resumeAfterLoad();
    this.audit("admin", "load_game", { saveId: id, name: r.name });
    return this.parkSummary();
  }
  /** Start a new game (the running one is saved automatically first). */
  newGame(o) {
    const name = String(o.name ?? "").trim();
    if (name.length < 2 || name.length > 60) throw new ApiError(422, "invalid_name", "Geef het spel een naam (2-60 tekens)");
    const code = String(o.code ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(code)) throw new ApiError(422, "invalid_code", "Spelcode: 4-12 letters of cijfers");
    const occ = Number(o.initialOccupied ?? this.cfg.initialOccupied);
    if (!(Number.isInteger(occ) && occ >= 0 && occ <= 300)) throw new ApiError(422, "invalid_occupancy", "Beginbezetting: 0-300 bewoonde villa's");
    let plan = null;
    if (o.endsAt !== void 0 && o.endsAt !== null && o.endsAt !== "") {
      const endMs = typeof o.endsAt === "number" ? o.endsAt : Date.parse(String(o.endsAt));
      const now = Date.now();
      if (!Number.isFinite(endMs) || endMs < now + 10 * 6e4) throw new ApiError(422, "invalid_end", "Einde van de sessie moet minstens 10 minuten in de toekomst liggen");
      if (endMs > now + 14 * 864e5) throw new ApiError(422, "invalid_end", "Een sessie duurt maximaal 14 dagen");
      const a = Number(o.arrivals ?? 0), d = Number(o.departures ?? 0);
      if (!(Number.isInteger(a) && a >= 0 && a <= 2e3)) throw new ApiError(422, "invalid_arrivals", "Aantal inchecks: 0-2000");
      if (!(Number.isInteger(d) && d >= 0 && d <= occ + a)) throw new ApiError(422, "invalid_departures", `Aantal uitchecks: 0 tot ${occ + a} (er kunnen niet meer gasten vertrekken dan er zijn)`);
      if (occ + a - d > 330) throw new ApiError(422, "too_many_guests", "Zoveel gasten tegelijk passen niet in het park (339 villa's)");
      plan = { endMs, arrivals: a, departures: d };
    }
    if (this.leaderboard().length) this.saveGame(`Automatisch bewaard v\xF3\xF3r nieuw spel "${name}"`, true);
    this.resetGame(Number.isFinite(Number(o.seed)) && o.seed !== void 0 ? Number(o.seed) : Math.floor(Math.random() * 1e6), true, { name, code, demoPlayers: o.demoPlayers !== false, initialOccupied: occ });
    if (plan) {
      const start = this.nowMs(), span = plan.endMs - start;
      const times = (n) => Array.from({ length: n }, () => start + 6e4 + Math.random() * Math.max(0, span * 0.95 - 6e4)).sort((x, y) => x - y);
      this.session = { startMs: start, endMs: plan.endMs, arrivals: times(plan.arrivals), departures: times(plan.departures), arrivalsTotal: plan.arrivals, departuresTotal: plan.departures, ended: false };
      setMeta(this.db, "session", JSON.stringify(this.session));
    }
    this.audit("admin", "new_game", { name, code, demoPlayers: o.demoPlayers !== false, initialOccupied: occ, endsAt: plan ? new Date(plan.endMs).toISOString() : null, arrivals: plan?.arrivals ?? null, departures: plan?.departures ?? null });
    return this.parkSummary();
  }
  resumeAfterLoad() {
    this.botPlan.clear();
    this.escalationLog = [];
    this.lastSeen.clear();
    this.locState.clear();
    this.park = this.makePark(this.cfg.seed);
    if (!this.restoreFromDb()) throw new ApiError(500, "load_failed", "Het opgeslagen spel kon niet worden hersteld");
    this.botRand = rng(this.cfg.seed + 99 + Math.floor(this.park.t));
    this.nextAutoArrival = this.park.t + 4;
    this.event("game.reset", { loaded: true, gameName: this.gameName });
    this.broadcastState();
  }
  gameInfo() {
    return { name: this.gameName, code: this.cfg.gameCode, seed: this.cfg.seed, initialOccupied: this.cfg.initialOccupied };
  }
  /** fingerprint of the map the game runs on (stored with the saved game) */
  mapChecksum() {
    return checksum(JSON.stringify({ n: this.netJson, s: this.sectorJson }));
  }
  /** Map editor: make a saved version the active map (validated in full first), then restart the game on it. */
  async activateMap(id) {
    const { diag } = await this.maps.activate(id);
    clearNetworkCache();
    const { net, sector } = loadMapJson();
    this.netJson = net;
    this.sectorJson = sector;
    this.net = loadNetwork();
    this.indexFacilities();
    this.audit("admin", "map_activate", { version: id, warnings: diag.problems.filter((p) => p.level === "warn").length });
    this.resetGame(this.cfg.seed);
    this.event("map.updated", { version: id });
    return { version: id, summary: diag.summary };
  }
  schedulerInfo() {
    const env2 = this.schedEnv();
    return { config: this.schedCfg, state: this.scheduler.snapshot(), now: { hour: +env2.hour.toFixed(2), day: this.scheduler.isDay(env2.hour), ratePerHour: +(this.scheduler.normalRate(env2) * 60).toFixed(2), openNormal: env2.openNormal, occupancy: +env2.occupancy.toFixed(3) } };
  }
  setSchedulerConfig(c) {
    const errs = validateSchedulerConfig(c);
    if (errs.length) throw new ApiError(422, "invalid_config", errs.join("; "));
    const keys = Object.keys(DEFAULT_SCHEDULER);
    const pick2 = Object.fromEntries(keys.filter((k) => c[k] !== void 0).map((k) => [k, c[k]]));
    this.schedCfg = { ...this.schedCfg, ...pick2 };
    this.scheduler.cfg = { ...this.schedCfg };
    this.audit("admin", "scheduler_config", pick2);
    this.save();
    return this.schedulerInfo();
  }
  setTimeScale(s) {
    if (!(s > 0 && s <= 16)) throw new ApiError(422, "invalid_scale", "Tijdschaal moet tussen 0 en 16 liggen");
    this.cfg.timeScale = s;
    setMeta(this.db, "timeScale", String(s));
    this.audit("admin", "time_scale", { s });
  }
  setFlag(name, on) {
    this.cfg[name] = on;
    setMeta(this.db, name, on ? "1" : "0");
    this.audit("admin", name, { on });
  }
  // ------------------------------------------------------------------ loop
  start() {
    this.lastReal = performance.now();
    this.loop = setInterval(() => this.tick(), 25);
  }
  stop() {
    if (this.loop) clearInterval(this.loop);
    this.save();
    this.maps.close();
  }
  tick() {
    const now = performance.now();
    let real = (now - this.lastReal) / 1e3;
    this.lastReal = now;
    if (real > 0.5) real = 0.5;
    if (!this.paused) {
      this.acc += real * this.cfg.timeScale;
      let n = 0;
      while (this.acc >= 0.05 && n < 120) {
        this.simStep(0.05);
        this.acc -= 0.05;
        n++;
      }
      if (n >= 120) this.acc = 0;
    }
    if (now - this.lastFrame >= 50) {
      this.lastFrame = now;
      this.broadcastFrame();
    }
    if (now - this.lastState >= 1e3) {
      this.lastState = now;
      this.broadcastState();
    }
    if (now - this.lastSave >= 2e3) {
      this.lastSave = now;
      this.save();
    }
  }
  simStep(dt) {
    this.park.step(dt);
    const t2 = this.park.t;
    if (Math.floor(t2) !== Math.floor(t2 - dt)) {
      this.expireDue();
      if (this.cfg.demoBot) this.demoBotTick();
      if (this.session) this.sessionTick();
      else if (this.cfg.autoArrivals) this.autoTraffic();
      if (this.cfg.autoGate) this.autoGateTick();
      if (Math.floor(t2 / 10) !== Math.floor((t2 - dt) / 10)) {
        const out = this.scheduler.tick(this.schedEnv(), 10 / 60);
        for (const n of out.normal) try {
          this.createIncident({ template: n.code, locationId: n.location });
        } catch {
        }
        if (out.major) try {
          this.createCrisis({ code: out.major.code, locationId: out.major.location });
        } catch {
        }
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
  autoGateTick() {
    const due = this.db.prepare("SELECT * FROM tasks WHERE kind IN ('checkin','checkout') AND state = 'offered' AND offered_at <= ?").all(this.nowMs() - _Game.AUTO_GATE_SEC * 1e3);
    for (const t2 of due) {
      if (!t2.vehicle_id || !t2.gate_id) continue;
      const issued = tx(this.db, () => {
        const r = this.db.prepare("UPDATE tasks SET state = 'completed', completed_at = ?, points_awarded = 0, version = version + 1 WHERE id = ? AND state = 'offered' AND version = ?").run(this.nowMs(), t2.id, t2.version);
        if (r.changes !== 1) return null;
        const pid = `GP-${randomUUID().slice(0, 12)}`;
        this.db.prepare("INSERT INTO gate_passages (id, session_id, vehicle_id, gate_id, direction, task_id, source, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'auto', 'authorized', ?)").run(pid, this.gameId, t2.vehicle_id, t2.gate_id, t2.kind === "checkin" ? "inbound" : "outbound", t2.id, this.nowMs());
        return { passageId: pid, gateId: t2.gate_id, vehicleId: t2.vehicle_id };
      });
      if (!issued) continue;
      this.event("task.completed", { taskId: t2.id, playerId: null, displayName: "automatisch", points: 0, kind: t2.kind, locationId: t2.location_id, gateId: t2.gate_id, auto: true });
      this.event("gate.token_issued", issued);
      if (t2.kind === "checkin") {
        const b = t2.booking_id ? this.park.bookings.get(t2.booking_id) : void 0;
        if (b && b.status === "queued_in") {
          b.status = "checked_in";
          b.history.push({ t: this.park.t, status: "checked_in" });
        }
      }
      this.broadcastState();
    }
  }
  /** Session plan: planned check-ins / check-outs become arrivals and departures; at the end the game pauses. */
  sessionTick() {
    const s = this.session;
    const now = this.nowMs();
    let changed = false;
    while (s.arrivals.length && s.arrivals[0] <= now) {
      if (!this.park.vacantHouses().length || this.park.traffic.buffer.length >= 6) break;
      this.park.scheduleArrival();
      s.arrivals.shift();
      changed = true;
    }
    while (s.departures.length && s.departures[0] <= now) {
      if (!this.park.depart()) break;
      s.departures.shift();
      changed = true;
    }
    if (!s.ended && now >= s.endMs) {
      s.ended = true;
      changed = true;
      this.paused = true;
      this.event("game.ended", { gameName: this.gameName, leaderboard: this.leaderboard() });
      this.audit("system", "session_ended", { gameName: this.gameName });
    }
    if (changed) setMeta(this.db, "session", JSON.stringify(s));
  }
  sessionDto() {
    const s = this.session;
    if (!s) return null;
    return { startMs: s.startMs, endMs: s.endMs, ended: s.ended, arrivalsTotal: s.arrivalsTotal, departuresTotal: s.departuresTotal, arrivalsLeft: s.arrivals.length, departuresLeft: s.departures.length };
  }
  /** Optional background flow for the demo: arrivals and departures at a modest pace. */
  autoTraffic() {
    const t2 = this.park.t;
    if (t2 >= this.nextAutoArrival) {
      if (this.park.vacantHouses().length > 1 && this.park.traffic.buffer.length < 3) this.park.scheduleArrival();
      this.nextAutoArrival = t2 + this.botRand.range(75, 160);
      if (this.botRand.next() < 0.45) this.park.depart();
    }
  }
  /** Demo bot (off by default): seeded test players claim and complete offered tasks through the regular task API. */
  botPlan = /* @__PURE__ */ new Map();
  demoBotTick() {
    const now = this.nowMs();
    const offered = this.db.prepare("SELECT * FROM tasks WHERE state = 'offered' ORDER BY offered_at").all();
    const tests = this.db.prepare("SELECT * FROM players WHERE is_test = 1").all();
    for (const t2 of offered) {
      if (!this.botPlan.has(t2.id)) this.botPlan.set(t2.id, now + this.botRand.range(t2.kind === "incident" ? 40 : 6, t2.kind === "incident" ? 240 : 25) * 1e3);
      if (this.botPlan.get(t2.id) > now) continue;
      const free = tests.filter((p2) => this.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE assigned_player_id = ? AND state = 'claimed'").get(p2.id).n < MAX_CLAIMS);
      if (!free.length) break;
      const p = this.botRand.pick(free);
      this.claim(t2.id, p, `bot-c-${t2.id}-${t2.attempt}`);
      this.botPlan.set(t2.id, now + this.botRand.range(8, 30) * 1e3);
    }
    const claimed = this.db.prepare("SELECT t.*, p.is_test FROM tasks t JOIN players p ON p.id = t.assigned_player_id WHERE t.state = 'claimed' AND p.is_test = 1").all();
    for (const t2 of claimed) {
      const due = this.botPlan.get(t2.id) ?? 0;
      if (due > now) continue;
      if (this.techBlocksCompletion(t2)) {
        this.botPlan.set(t2.id, now + this.botRand.range(15, 45) * 1e3);
        continue;
      }
      const p = this.db.prepare("SELECT * FROM players WHERE id = ?").get(t2.assigned_player_id);
      this.complete(t2.id, p, `bot-d-${t2.id}`);
      this.botPlan.delete(t2.id);
    }
  }
  save() {
    this.db.prepare("INSERT INTO sim_state (id, park, saved_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET park = excluded.park, saved_at = excluded.saved_at").run(this.park.serialize(), Date.now());
    setMeta(this.db, "scheduler", JSON.stringify({ cfg: this.schedCfg, state: this.scheduler.snapshot() }));
    if (this.weather) setMeta(this.db, "weather", JSON.stringify(this.weather));
  }
  // ------------------------------------------------------------------ projections
  broadcastFrame() {
    if (![...this.clients].some((c) => c.frames)) return;
    const snap = this.park.traffic.snapshot();
    const msg = `event: frame
data: ${JSON.stringify(snap)}

`;
    for (const c of this.clients) if (c.frames) c.write(msg);
  }
  broadcastState() {
    if (!this.clients.size) return;
    const msg = `event: state
data: ${JSON.stringify(this.projectorState())}

`;
    for (const c of this.clients) c.write(msg);
  }
  houseStates() {
    const stories = this.stories.activeByHouse();
    const tasks = this.db.prepare("SELECT id, location_id, icon, state, kind, title FROM tasks WHERE state IN ('offered','claimed') AND kind = 'incident'").all();
    return this.net.houses.map((h) => {
      const hs = this.park.houses.get(h.number);
      const b = hs?.bookingId ? this.park.bookings.get(hs.bookingId) : void 0;
      return {
        id: h.id,
        number: h.number,
        legendType: h.legendType,
        focus: h.focus,
        state: hs?.state ?? "scenery",
        household: b?.household,
        story: stories.get(h.number)?.title,
        cond: this.locState.has(h.id) ? this.condOf(h.id) : void 0,
        incidents: tasks.filter((t2) => t2.location_id === h.id).map((t2) => ({ taskId: t2.id, icon: t2.icon, state: t2.state, title: t2.title }))
      };
    });
  }
  /** facilities with open incident tasks (pins on the projector) */
  facilityStates() {
    const tasks = this.db.prepare("SELECT id, location_id, icon, state, title FROM tasks WHERE state IN ('offered','claimed') AND kind = 'incident' AND location_id LIKE 'F-%'").all();
    const by = /* @__PURE__ */ new Map();
    for (const t2 of tasks) (by.get(t2.location_id) ?? by.set(t2.location_id, []).get(t2.location_id)).push(t2);
    return [...by].map(([id, list]) => {
      const f = this.facIndex.find((x) => x.id === id);
      const pos = f ? this.net.toWorld(f.pt) : { x: 0, y: 0 };
      return { id, name: f?.name ?? id, pos: { x: +pos.x.toFixed(2), y: +pos.y.toFixed(2) }, incidents: list.map((t2) => ({ taskId: t2.id, icon: t2.icon, state: t2.state, title: t2.title })) };
    });
  }
  parkSummary() {
    const open = this.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE state IN ('offered','claimed')").get().n;
    const gm = this.nowMs();
    return {
      gameId: this.gameId,
      gameName: this.gameName,
      gameMs: gm,
      gameTimeIso: new Date(gm).toISOString(),
      timezone: "Europe/Amsterdam",
      simTime: +this.park.t.toFixed(2),
      timeScale: this.cfg.timeScale,
      paused: this.paused,
      satisfaction: +this.park.averageSatisfaction().toFixed(3),
      openTasks: open,
      gates: [...this.park.traffic.gates.values()].map((g) => ({ id: g.id, phase: g.phase, queue: g.queue.length, authorizedVehicle: g.authorizedVehicle ?? null })),
      bufferedArrivals: this.park.traffic.buffer.filter((b) => b.spec.kind === "visitor").length,
      vehicles: this.park.traffic.vehicles.length,
      demoBot: this.cfg.demoBot,
      autoArrivals: this.cfg.autoArrivals,
      autoGate: !!this.cfg.autoGate,
      health: this.parkHealth(),
      display: this.display,
      weather: this.weather ? { ...this.weather, name: WEATHER_NAMES[this.weather.kind] } : null,
      session: this.sessionDto(),
      crises: this.crisisStatus()
    };
  }
  projectorState() {
    const gateTasks = this.db.prepare("SELECT id, vehicle_id, gate_id, state, kind, assigned_player_id FROM tasks WHERE kind IN ('checkin','checkout') AND state IN ('offered','claimed')").all();
    const tokens = this.db.prepare("SELECT vehicle_id, gate_id, status FROM gate_passages WHERE status IN ('authorized','consumed')").all();
    return {
      park: this.parkSummary(),
      leaderboard: this.leaderboard(),
      houses: this.houseStates(),
      facilities: this.facilityStates(),
      gateTasks: gateTasks.map((t2) => ({ taskId: t2.id, vehicleId: t2.vehicle_id, gateId: t2.gate_id, state: t2.state, kind: t2.kind })),
      tokens: tokens.map((t2) => ({ vehicleId: t2.vehicle_id, gateId: t2.gate_id, status: t2.status }))
    };
  }
  bookingsDto() {
    const stories = this.stories.activeByHouse();
    return [...this.park.bookings.values()].map((b) => ({ id: b.id, household: b.household, profile: b.profile ?? null, story: ["parked", "in_house"].includes(b.status) ? stories.get(b.houseNumber) ?? null : null, guests: b.guests, houseNumber: b.houseNumber, vehicleId: b.vehicleId, status: b.status, satisfaction: +b.satisfaction.toFixed(2) }));
  }
  locations() {
    const facs = this.facIndex.map((f) => ({ id: f.id, kind: "facility", key: f.key, name: f.name, pos: this.net.toWorld(f.pt), condition: this.stateOf(f.id) }));
    const houses = this.houseStates().map((h) => {
      const hi = this.net.houses.find((x) => x.number === h.number);
      return { ...h, kind: "bungalow", pos: { x: +hi.pos.x.toFixed(2), y: +hi.pos.y.toFixed(2) }, typeConfidence: hi.typeConfidence, petsAllowed: hi.petsAllowed, stallId: hi.stallId ?? null };
    });
    return [...houses, ...facs];
  }
};

// src/server/http.ts
import { createServer } from "node:http";
import { readFileSync as readFileSync4, existsSync as existsSync4, statSync, createReadStream } from "node:fs";
import { join as join4, extname, normalize } from "node:path";
import { networkInterfaces } from "node:os";

// src/server/openapi.ts
function openApiSpec() {
  const err = { $ref: "#/components/schemas/Error" };
  const r = (desc, schema = { type: "object" }) => ({ description: desc, content: { "application/json": { schema } } });
  const errs = { 401: r("Geen of ongeldige sessie", err), 403: r("Niet toegestaan", err), 404: r("Niet gevonden", err), 409: r("Conflict (al geclaimd, limiet, status)", err), 422: r("Ongeldige invoer", err), 429: r("Rate limit", err) };
  const idem = { required: true, content: { "application/json": { schema: { type: "object", required: ["idempotencyKey"], properties: { idempotencyKey: { type: "string", minLength: 4, maxLength: 100 } } } } } };
  const bearer = [{ bearer: [] }], admin = [{ adminKey: [] }];
  return {
    openapi: "3.1.0",
    info: { title: "Harderwold Tycoon API (prototype fase 1-3)", version: "0.1.0", description: "Server-authoritative API voor de toekomstige spelersapp. Check-in/check-out zijn gewone opdrachten; alleen het afronden ervan levert een eenmalig passagetoken op voor precies dat voertuig en die slagboom." },
    servers: [{ url: "/api/v1" }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer" }, adminKey: { type: "apiKey", in: "header", name: "X-Admin-Key" } },
      schemas: {
        Error: { type: "object", properties: { error: { type: "string" }, message: { type: "string" } } },
        Task: { type: "object", properties: {
          id: { type: "string" },
          template: { type: "string" },
          kind: { enum: ["checkin", "checkout", "incident"] },
          category: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          locationId: { type: ["string", "null"] },
          bookingId: { type: ["string", "null"] },
          vehicleId: { type: ["string", "null"] },
          gateId: { type: ["string", "null"] },
          state: { enum: ["offered", "claimed", "completed", "expired", "cancelled"] },
          assignedPlayerId: { type: ["string", "null"] },
          offeredAt: { type: "integer" },
          claimedAt: { type: ["integer", "null"] },
          deadlineAt: { type: ["integer", "null"] },
          completedAt: { type: ["integer", "null"] },
          claimSeconds: { type: "integer" },
          difficulty: { type: "string" },
          urgency: { type: "string" },
          points: { type: "integer" },
          pointsAwarded: { type: "integer" },
          version: { type: "integer" },
          attempt: { type: "integer" },
          queuePosition: { type: "integer" },
          technician: { type: ["object", "null"], description: "Alleen bij geclaimde TD-meldingen (Onderhoud/Natuur): waar de monteur is. Afronden kan pas als onSite true is.", properties: { phase: { enum: ["pending", "driving", "working", "walking_back", "returning"] }, onSite: { type: "boolean" }, vehicleId: { type: ["string", "null"] }, houseNumber: { type: "integer" } } }
        } }
      }
    },
    paths: {
      "/sessions/join": { post: { summary: "Aanmelden met spelcode en naam", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["gameCode", "displayName"], properties: { gameCode: { type: "string" }, displayName: { type: "string" } } } } } }, responses: { 200: r("playerId + token"), ...errs } } },
      "/me": { get: { security: bearer, summary: "Eigen speler, score en actieve opdrachten", responses: { 200: r("OK"), ...errs } } },
      "/park": { get: { summary: "Parkoverzicht (tijd, tevredenheid, open taken, slagbomen)", responses: { 200: r("OK") } } },
      "/locations": { get: { summary: "Villa's en voorzieningen van het park", responses: { 200: r("OK") } } },
      "/locations/{id}": { get: { summary: "E\xE9n locatie", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: r("OK"), 404: errs[404] } } },
      "/leaderboard": { get: { summary: "Klassement", responses: { 200: r("OK") } } },
      "/tasks": { get: { security: bearer, summary: "Opdrachten", parameters: [{ name: "state", in: "query", schema: { enum: ["offered", "claimed", "completed", "expired", "cancelled"] } }], responses: { 200: r("OK", { type: "array", items: { $ref: "#/components/schemas/Task" } }), ...errs } } },
      "/tasks/{id}": { get: { security: bearer, summary: "E\xE9n opdracht", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: r("OK"), ...errs } } },
      "/tasks/{id}/claim": { post: { security: bearer, summary: "Claimen (atomisch; eerste geldige wint, max. 3 actief)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: idem, responses: { 200: r("Geclaimd"), ...errs } } },
      "/tasks/{id}/complete": { post: { security: bearer, summary: "Afronden (idempotent; punten exact \xE9\xE9n keer; check-in/out geeft passagetoken; TD-melding pas als de monteur ter plaatse is, anders 409 technician_not_on_site)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: idem, responses: { 200: r("Afgerond"), ...errs } } },
      "/tasks/{id}/release": { post: { security: bearer, summary: "Eigen claim vrijgeven (opdracht wordt opnieuw aangeboden, geen strafpunten)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: r("OK"), ...errs } } },
      "/events": { get: { summary: "Gebeurtenissen na cursor (polling). after=latest geeft alleen de huidige cursor; reset=true als het spel intussen is gereset", parameters: [{ name: "after", in: "query", schema: { type: "string" } }, { name: "limit", in: "query", schema: { type: "integer" } }], responses: { 200: r("OK") } } },
      "/stream": { get: { summary: "Server-Sent Events: task.*, vehicle.*, gate.*, queue.updated, leaderboard.updated, state; ?frames=1 voegt 10 Hz verkeersframes toe; Last-Event-ID / ?after= voor replay", responses: { 200: { description: "text/event-stream" } } } },
      "/traffic": { get: { summary: "Momentopname verkeer (posities, slagboomfases, wachtrijen)", responses: { 200: r("OK") } } },
      "/bookings": { get: { summary: "Boekingen/huishoudens in de sector", responses: { 200: r("OK") } } },
      "/map": { get: { summary: "Bewerkbare kaartdata (wegennet + sector)", responses: { 200: r("OK") } } },
      "/admin/state": { get: { security: admin, summary: "Volledige beheerstatus", responses: { 200: r("OK"), ...errs } } },
      "/admin/debug": { get: { security: admin, summary: "Verkeersdebug: routes, bounding boxes, zones, wachtredenen, statistiek", responses: { 200: r("OK"), ...errs } } },
      "/admin/players/{id}/token": { post: { security: admin, summary: "Testtoken voor testspeler (alleen ontwikkeling)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: r("OK"), ...errs } } },
      "/admin/arrivals": { post: { security: admin, summary: "Aankomst(en) inplannen {count, houseNumber?}", responses: { 200: r("OK"), ...errs } } },
      "/admin/departures": { post: { security: admin, summary: "Vertrek(ken) starten {count, houseNumber?}", responses: { 200: r("OK"), ...errs } } },
      "/admin/speed": { post: { security: admin, summary: "Tijdschaal {timeScale: 0.25..16}", responses: { 200: r("OK"), ...errs } } },
      "/admin/pause": { post: { security: admin, summary: "Pauzeren", responses: { 200: r("OK") } } },
      "/admin/resume": { post: { security: admin, summary: "Hervatten (opent nooit een slagboom)", responses: { 200: r("OK") } } },
      "/admin/reset": { post: { security: admin, summary: "Demo resetten {seed?}", responses: { 200: r("OK") } } },
      "/admin/flags": { post: { security: admin, summary: "{demoBot?: boolean, autoArrivals?: boolean, autoGate?: boolean} - autoGate: check-in/check-out automatisch afronden (geen punten; slagboom blijft token-gestuurd)", responses: { 200: r("OK") } } },
      "/admin/incidents": { post: { security: admin, summary: "Opdracht of crisis injecteren {template?, houseNumber?, locationId?} of {crisis: true, template?: CRISIS_...}", responses: { 200: r("OK"), ...errs } }, get: { security: admin, summary: "Actieve crises (?all=1: ook afgerond) met fasen en deelopdrachten", responses: { 200: r("OK") } } },
      "/admin/templates": { get: { security: admin, summary: "Opdrachtenbibliotheek (100+ sjablonen) en crises", responses: { 200: r("OK") } } },
      "/stories": { get: { summary: "Lopende verhaallijnen van gasten (?all=1: ook afgelopen, max 50)", responses: { 200: r("OK") } } },
      "/admin/stories": { get: { security: admin, summary: "Verhaallijnen: instellingen, lopend, recent en alle sjablonen", responses: { 200: r("OK") } }, post: { security: admin, summary: "Verhaallijn starten {code?, bookingId?}; zonder code een passende willekeurige", responses: { 200: r("OK"), ...errs } } },
      "/admin/stories/config": { post: { security: admin, summary: "Verhaallijnen instellen {enabled, perHourDay, maxActive}", responses: { 200: r("OK"), ...errs } } },
      "/admin/players/{id}/score": { post: { security: admin, summary: "Score aanpassen {delta (geheel getal, niet 0), reason}: regel in het puntenregister + audit", responses: { 200: r("OK"), ...errs } } },
      "/admin/ledger": { get: { security: admin, summary: "Puntenregister (nieuwste eerst, ?limit=)", responses: { 200: r("OK") } } },
      "/admin/export": { get: { security: admin, summary: "Volledige export van het spel (JSON)", responses: { 200: r("OK") } } },
      "/admin/content": { get: { security: admin, summary: "Eigen namen, bekende gasten en eigen opdrachten", responses: { 200: r("OK") } } },
      "/admin/content/names": { post: { security: admin, summary: "Namenlijsten vervangen {first[], surnames[], kids[], cameos[{name, role, tagline}]}", responses: { 200: r("OK"), ...errs } } },
      "/admin/content/tasks": { post: { security: admin, summary: "Eigen opdracht toevoegen of wijzigen (met code) {group, title, text, difficulty, urgency, location{kind, facilities?}, weight, when}", responses: { 200: r("OK"), ...errs } } },
      "/admin/content/tasks/{code}/delete": { post: { security: admin, summary: "Eigen opdracht verwijderen", responses: { 200: r("OK"), ...errs } } },
      "/admin/display": { post: { security: admin, summary: "Projectie instellen {popupSeconds (5-120), dayNight, ambientSound, autoZoom (uit|crises|alles)}", responses: { 200: r("OK"), ...errs } } },
      "/admin/games": { get: { security: admin, summary: "Huidig spel en opgeslagen spellen", responses: { 200: r("OK") } } },
      "/admin/games/new": { post: { security: admin, summary: "Nieuw spel {name, code, demoPlayers, initialOccupied, seed?, endsAt?, arrivals?, departures?}: met endsAt (ISO-datum/tijd) worden arrivals inchecks en departures uitchecks willekeurig over de sessie verspreid en pauzeert het spel aan het eind; het lopende spel wordt eerst automatisch bewaard", responses: { 200: r("OK"), ...errs } } },
      "/admin/games/save": { post: { security: admin, summary: "Lopend spel opslaan {name}", responses: { 200: r("OK"), ...errs } } },
      "/admin/games/import": { post: { security: admin, summary: "Opgeslagen spel uit een bestand toevoegen {file, name?}", responses: { 200: r("OK"), ...errs } } },
      "/admin/games/{id}/file": { get: { security: admin, summary: "Opgeslagen spel als bestand (JSON)", responses: { 200: r("OK"), ...errs } } },
      "/admin/games/{id}/load": { post: { security: admin, summary: "Opgeslagen spel laden (lopend spel wordt eerst automatisch bewaard)", responses: { 200: r("OK"), ...errs } } },
      "/admin/games/{id}/delete": { post: { security: admin, summary: "Opgeslagen spel verwijderen", responses: { 200: r("OK"), ...errs } } },
      "/admin/backups": { get: { security: admin, summary: "Database-back-ups (automatisch elk uur, BACKUP_EVERY_MIN)", responses: { 200: r("OK") } }, post: { security: admin, summary: "Nu een back-up van de hele database maken", responses: { 200: r("OK"), ...errs } } },
      "/admin/backups/{name}": { get: { security: admin, summary: "Back-up downloaden (SQLite-bestand)", responses: { 200: r("OK"), ...errs } } },
      "/admin/weather": { post: { security: admin, summary: "Weer instellen {kind: zon|halfbewolkt|bewolkt|regen|onweer|mist|auto, minutes (5-600)}; het weer staat ook in /park (weather)", responses: { 200: r("OK"), ...errs } } },
      "/admin/scheduler": { get: { security: admin, summary: "Planner: instellingen, toestand en huidige snelheid", responses: { 200: r("OK") } }, post: { security: admin, summary: "Planner instellen {enabled, normalPerHourDay, nightFactor, dayStartHour, dayEndHour, majorPerDay, majorMaxPerDay, majorMinGapMin, maxOpen}", responses: { 200: r("OK"), ...errs } } },
      "/admin/tasks/{id}/cancel": { post: { security: admin, summary: "Incident annuleren {reason}", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: r("OK"), ...errs } } },
      "/admin/gates/{id}/override": { post: { security: admin, summary: "NOODBEDIENING: eenmalige passage voor voorste voertuig {reason}; wordt geaudit", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: r("OK"), ...errs } } },
      "/admin/audit": { get: { security: admin, summary: "Auditlog", responses: { 200: r("OK") } } },
      "/admin/map": { get: { security: admin, summary: "Kaarteditor: actieve kaart als kaartdocument (wegennet + parkgegevens + controlelijst)", responses: { 200: r("OK"), ...errs } } },
      "/admin/map/versions": { get: { security: admin, summary: "Opgeslagen kaartversies", responses: { 200: r("OK") } }, post: { security: admin, summary: "Versie opslaan {bundle, comment}; 422 met problems bij structuurfouten", responses: { 201: r("Opgeslagen"), ...errs } } },
      "/admin/map/versions/{id}": { get: { security: admin, summary: "Kaartdocument van een versie", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { 200: r("OK"), ...errs } } },
      "/admin/map/versions/{id}/activate": { post: { security: admin, summary: "Versie activeren {confirm: true}: volledige validatie, schrijft data/map en herstart het spel; 422 bij fouten", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { 200: r("OK"), ...errs } } },
      "/admin/map/validate": { post: { security: admin, summary: "Kaartdocument volledig valideren {bundle}: problemen, verschoven huizen, parkeervakken, opstelplaatsen, slagboom per huis", responses: { 200: r("OK"), ...errs } } },
      "/admin/map/route/{diag}/{house}": { get: { security: admin, summary: "Route naar binnen en buiten voor een huis (na validate)", parameters: [{ name: "diag", in: "path", required: true, schema: { type: "string" } }, { name: "house", in: "path", required: true, schema: { type: "integer" } }], responses: { 200: r("OK"), ...errs } } },
      "/admin/map/report": { post: { security: admin, summary: "Volledigheidsrapport t.o.v. het PDF-manifest {bundle?}", responses: { 200: r("OK"), ...errs } } }
    }
  };
}

// src/server/mapreport.ts
import { readFileSync as readFileSync3, existsSync as existsSync3, readdirSync } from "node:fs";
import { join as join3 } from "node:path";
function mapReport(bundle, dir, publicRoot = join3(dir, "..", "..", "public")) {
  const man = JSON.parse(readFileSync3(join3(dir, "harderwold_manifest.json"), "utf8"));
  const houses = bundle.park.houses;
  const byNum = new Map(houses.map((h) => [h.number, h]));
  const manNums = new Set(man.houses.map((h) => h.number));
  const missing = man.houses.filter((h) => !byNum.has(h.number)).map((h) => h.number);
  const extra = houses.filter((h) => !manNums.has(h.number)).map((h) => h.number);
  const moved = man.houses.flatMap((m) => {
    const h = byNum.get(m.number);
    if (!h) return [];
    const d = Math.hypot(h.pt[0] - m.pdf.x, h.pt[1] - m.pdf.y) * bundle.park.metersPerPt;
    return d > 3 ? [{ number: m.number, movedM: +d.toFixed(1) }] : [];
  });
  const typeChanged = man.houses.filter((m) => byNum.has(m.number) && byNum.get(m.number).legendType !== m.legendType).map((m) => ({ number: m.number, pdf: m.legendType, map: byNum.get(m.number).legendType }));
  const conf = { high: 0, medium: 0, low: 0, other: 0 };
  for (const h of houses) conf[h.typeConfidence in conf ? h.typeConfidence : "other"]++;
  const uncertain = houses.filter((h) => h.typeConfidence !== "high" && h.typeConfidence !== "reviewed").map((h) => ({ number: h.number, type: h.legendType, confidence: h.typeConfidence }));
  const facs = bundle.park.facilities ?? [];
  const count = (l) => l.reduce((m, f) => m.set(f.key, (m.get(f.key) ?? 0) + 1), /* @__PURE__ */ new Map());
  const fm = count(man.facilities), fp = count(facs);
  const facilityDiff = [.../* @__PURE__ */ new Set([...fm.keys(), ...fp.keys()])].sort().filter((k) => (fm.get(k) ?? 0) !== (fp.get(k) ?? 0)).map((k) => ({ key: k, pdf: fm.get(k) ?? 0, map: fp.get(k) ?? 0 }));
  const spriteDir = join3(publicRoot, "assets", "sprites");
  const supplied = existsSync3(spriteDir) ? readdirSync(spriteDir).map((f) => f.replace(/\.(png|webp)$/i, "")) : [];
  const types = [...new Set(houses.map((h) => h.legendType ?? "?"))].sort();
  const art = types.map((t2) => ({ type: t2, houses: houses.filter((h) => (h.legendType ?? "?") === t2).length, art: supplied.includes(t2) ? "aangeleverde sprite" : "procedureel (placeholder)" }));
  const reviewed = REVIEW_ITEMS.filter((r) => bundle.review?.[r.id]).length;
  return {
    houses: { pdf: man.houses.length, map: houses.length, missing, extra, moved: moved.sort((a, b) => b.movedM - a.movedM), typeChanged, confidence: conf, uncertain },
    facilities: { pdf: man.facilities.length, map: facs.length, diff: facilityDiff },
    art,
    manifestWarnings: man.warnings,
    review: { done: reviewed, total: REVIEW_ITEMS.length }
  };
}

// src/server/http.ts
var MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".map": "application/json", ".md": "text/markdown; charset=utf-8" };
function startHttp(game2, opts) {
  const routes = [];
  const add2 = (method, path, auth, h) => {
    const keys = [];
    const re = new RegExp("^" + path.replace(/:([a-zA-Z]+)/g, (_, k) => {
      keys.push(k);
      return "([^/]+)";
    }) + "$");
    routes.push({ method, re, keys, auth, h });
  };
  const V = "/api/v1";
  add2("POST", `${V}/sessions/join`, "none", (c) => game2.join(String(c.body.gameCode ?? ""), String(c.body.displayName ?? "")));
  add2("GET", `${V}/me`, "player", (c) => {
    const p = c.player;
    const active = game2.listTasks("claimed").filter((t2) => t2.assignedPlayerId === p.id);
    return { playerId: p.id, displayName: p.display_name, score: p.score, activeTasks: active, maxActiveTasks: 3 };
  });
  add2("GET", `${V}/park`, "none", () => game2.parkSummary());
  add2("GET", `${V}/locations`, "none", () => game2.locations());
  add2("GET", `${V}/locations/:id`, "none", (c) => {
    const l = game2.locations().find((x) => x.id === c.params.id);
    if (!l) throw new ApiError(404, "not_found", "Locatie niet gevonden");
    return l;
  });
  add2("GET", `${V}/leaderboard`, "none", () => game2.leaderboard());
  add2("GET", `${V}/tasks`, "player", (c) => {
    const st = c.url.searchParams.get("state") ?? void 0;
    if (st && !["offered", "claimed", "completed", "expired", "cancelled"].includes(st)) throw new ApiError(422, "invalid_state", "Ongeldige state");
    return game2.listTasks(st);
  });
  add2("GET", `${V}/tasks/:id`, "player", (c) => {
    const t2 = game2.getTask(c.params.id);
    if (!t2) throw new ApiError(404, "not_found", "Opdracht bestaat niet");
    return game2.taskDto(t2);
  });
  add2("POST", `${V}/tasks/:id/claim`, "player", (c) => {
    const r = game2.claim(c.params.id, c.player, String(c.body.idempotencyKey ?? ""));
    return { __status: r.status, ...r.body };
  });
  add2("POST", `${V}/tasks/:id/complete`, "player", (c) => {
    const r = game2.complete(c.params.id, c.player, String(c.body.idempotencyKey ?? ""));
    return { __status: r.status, ...r.body };
  });
  add2("POST", `${V}/tasks/:id/release`, "player", (c) => game2.release(c.params.id, c.player));
  add2("GET", `${V}/events`, "none", (c) => {
    const latest = game2.latestEventSeq();
    const raw = c.url.searchParams.get("after");
    if (raw === "latest") return { events: [], cursor: latest };
    const after = Number(raw ?? 0);
    if (Number.isFinite(after) && after > latest) return { events: [], cursor: latest, reset: true };
    const ev = game2.eventsAfter(Number.isFinite(after) ? after : 0, Number(c.url.searchParams.get("limit") ?? 200));
    return { events: ev, cursor: ev.length ? ev[ev.length - 1].seq : after };
  });
  add2("GET", `${V}/traffic`, "none", () => game2.park.traffic.snapshot());
  add2("GET", `${V}/bookings`, "none", () => game2.bookingsDto());
  add2("GET", `${V}/stories`, "none", (c) => c.url.searchParams.get("all") === "1" ? game2.stories.list(true) : game2.stories.list());
  add2("GET", `${V}/map`, "none", () => ({ network: game2.netJson, sector: game2.sectorJson }));
  add2("GET", `${V}/openapi.json`, "none", () => openApiSpec());
  add2("GET", `${V}/health`, "none", () => ({ ok: true, uptimeSec: Math.round((Date.now() - game2.startedAt) / 1e3), clients: game2.clientCount(), simTime: game2.park.t }));
  add2("GET", `${V}/admin/state`, "admin", () => ({ park: game2.parkSummary(), bookings: game2.bookingsDto(), players: game2.players(), tasks: game2.listTasks(), validation: game2.net.validation, worst: game2.worstLocations() }));
  add2("GET", `${V}/admin/debug`, "admin", () => game2.park.traffic.debugInfo());
  add2("GET", `${V}/admin/players`, "admin", () => game2.players());
  add2("POST", `${V}/admin/players/:id/token`, "admin", (c) => game2.issueTestToken(c.params.id));
  add2("POST", `${V}/admin/arrivals`, "admin", (c) => {
    const n = Math.max(1, Math.min(10, Number(c.body.count ?? 1)));
    const made = [];
    for (let i = 0; i < n; i++) {
      const b = game2.park.scheduleArrival({ houseNumber: c.body.houseNumber ? Number(c.body.houseNumber) : void 0 });
      if (b) made.push({ bookingId: b.id, houseNumber: b.houseNumber, vehicleId: b.vehicleId, household: b.household });
    }
    game2.audit("admin", "arrivals", { requested: n, created: made.length });
    if (!made.length) throw new ApiError(409, "no_vacant_bungalow", "Geen vrije (schone) villa beschikbaar in deze sector");
    return { created: made, note: made.length < n ? `Slechts ${made.length} vrije villa's` : void 0 };
  });
  add2("POST", `${V}/admin/departures`, "admin", (c) => {
    const n = Math.max(1, Math.min(10, Number(c.body.count ?? 1)));
    const made = [];
    for (let i = 0; i < n; i++) {
      const b = game2.park.depart({ houseNumber: c.body.houseNumber ? Number(c.body.houseNumber) : void 0 });
      if (b) made.push({ bookingId: b.id, houseNumber: b.houseNumber, vehicleId: b.vehicleId, household: b.household });
    }
    game2.audit("admin", "departures", { requested: n, created: made.length });
    if (!made.length) throw new ApiError(409, "no_household", "Geen huishouden in een villa om te laten vertrekken");
    return { departing: made };
  });
  add2("POST", `${V}/admin/speed`, "admin", (c) => {
    game2.setTimeScale(Number(c.body.timeScale));
    return game2.parkSummary();
  });
  add2("POST", `${V}/admin/pause`, "admin", () => {
    game2.paused = true;
    game2.audit("admin", "pause", {});
    game2.event("game.paused", {});
    return game2.parkSummary();
  });
  add2("POST", `${V}/admin/resume`, "admin", () => {
    game2.paused = false;
    game2.audit("admin", "resume", {});
    game2.event("game.resumed", {});
    return game2.parkSummary();
  });
  add2("GET", `${V}/admin/backups`, "admin", () => ({ dir: game2.backups?.dir ?? null, backups: game2.backups?.list() ?? [] }));
  add2("POST", `${V}/admin/backups`, "admin", () => {
    if (!game2.backups) throw new ApiError(503, "no_backups", "Back-ups zijn niet ingesteld");
    const b = game2.backups.make("handmatig");
    game2.audit("admin", "backup", { file: b.file });
    return b;
  });
  add2("GET", `${V}/admin/backups/:name`, "admin", (c) => {
    const p = game2.backups?.path(c.params.name);
    if (!p) throw new ApiError(404, "not_found", "Back-up niet gevonden");
    return { __file: { path: p, name: c.params.name, type: "application/vnd.sqlite3" } };
  });
  add2("GET", `${V}/admin/games`, "admin", () => ({ current: game2.gameInfo(), saves: game2.listSaves() }));
  add2("POST", `${V}/admin/games/new`, "admin", (c) => game2.newGame(c.body));
  add2("POST", `${V}/admin/games/save`, "admin", (c) => game2.saveGame(String(c.body.name ?? "")));
  add2("POST", `${V}/admin/games/import`, "admin", (c) => game2.importSave(c.body.file, c.body.name));
  add2("GET", `${V}/admin/games/:id/file`, "admin", (c) => game2.saveFile(c.params.id));
  add2("POST", `${V}/admin/games/:id/load`, "admin", (c) => game2.loadGame(c.params.id));
  add2("POST", `${V}/admin/games/:id/delete`, "admin", (c) => game2.deleteSave(c.params.id));
  add2("POST", `${V}/admin/reset`, "admin", (c) => {
    game2.resetGame(c.body.seed !== void 0 ? Number(c.body.seed) : Math.floor(Math.random() * 1e6));
    return game2.parkSummary();
  });
  add2("POST", `${V}/admin/flags`, "admin", (c) => {
    if (typeof c.body.demoBot === "boolean") game2.setFlag("demoBot", c.body.demoBot);
    if (typeof c.body.autoArrivals === "boolean") game2.setFlag("autoArrivals", c.body.autoArrivals);
    if (typeof c.body.autoGate === "boolean") game2.setFlag("autoGate", c.body.autoGate);
    return game2.parkSummary();
  });
  add2("POST", `${V}/admin/incidents`, "admin", (c) => {
    const code = c.body.template;
    if (c.body.crisis === true || code?.startsWith("CRISIS_")) {
      const r2 = game2.createCrisis({ code: code?.startsWith("CRISIS_") ? code : void 0, locationId: c.body.locationId });
      game2.audit("admin", "inject_crisis", { incidentId: r2.id, code: r2.code });
      return r2;
    }
    const r = game2.createIncident({ template: code, houseNumber: c.body.houseNumber ? Number(c.body.houseNumber) : void 0, locationId: c.body.locationId });
    game2.audit("admin", "inject_incident", { taskId: r.id, template: r.template });
    return r;
  });
  add2("GET", `${V}/admin/incidents`, "admin", (c) => game2.listIncidents(c.url.searchParams.get("all") === "1"));
  add2("GET", `${V}/admin/templates`, "admin", () => ({ templates: TEMPLATES, crises: CRISES }));
  add2("GET", `${V}/admin/scheduler`, "admin", () => game2.schedulerInfo());
  add2("GET", `${V}/admin/stories`, "admin", () => ({ ...game2.storiesInfo(), templates: STORIES }));
  add2("POST", `${V}/admin/stories`, "admin", (c) => {
    const r = game2.startStory({ code: c.body.code, bookingId: c.body.bookingId });
    game2.audit("admin", "start_story", { storyId: r.id, code: r.code });
    return r;
  });
  add2("POST", `${V}/admin/weather`, "admin", (c) => game2.setWeather(String(c.body.kind ?? ""), c.body.minutes !== void 0 ? Number(c.body.minutes) : 60));
  add2("POST", `${V}/admin/display`, "admin", (c) => game2.setDisplay(c.body));
  add2("POST", `${V}/admin/stories/config`, "admin", (c) => game2.setStoryConfig(c.body));
  add2("POST", `${V}/admin/scheduler`, "admin", (c) => game2.setSchedulerConfig(c.body));
  add2("POST", `${V}/admin/tasks/:id/cancel`, "admin", (c) => {
    game2.cancelTask(c.params.id, String(c.body.reason ?? ""));
    return { ok: true };
  });
  add2("POST", `${V}/admin/gates/:id/override`, "admin", (c) => game2.overrideGate(c.params.id, String(c.body.reason ?? "")));
  add2("GET", `${V}/admin/audit`, "admin", (c) => game2.auditLog(Number(c.url.searchParams.get("limit") ?? 100)));
  add2("GET", `${V}/admin/ledger`, "admin", (c) => game2.ledger(Number(c.url.searchParams.get("limit") ?? 200)));
  add2("POST", `${V}/admin/players/:id/score`, "admin", (c) => game2.adjustScore(c.params.id, Number(c.body.delta), String(c.body.reason ?? "")));
  add2("GET", `${V}/admin/export`, "admin", () => game2.exportAll());
  add2("GET", `${V}/admin/content`, "admin", () => ({ names: game2.content.names(), tasks: game2.content.tasks, facilities: game2.facilities(), roles: GUEST_ROLES, groups: GROUPS }));
  add2("POST", `${V}/admin/content/names`, "admin", (c) => game2.setNames(c.body));
  add2("POST", `${V}/admin/content/tasks`, "admin", (c) => game2.saveCustomTask(c.body));
  add2("POST", `${V}/admin/content/tasks/:code/delete`, "admin", (c) => game2.deleteCustomTask(c.params.code));
  add2("GET", `${V}/admin/map`, "admin", () => ({ ...game2.maps.current(), reviewItems: REVIEW_ITEMS }));
  add2("GET", `${V}/admin/map/versions`, "admin", () => game2.maps.list());
  add2("GET", `${V}/admin/map/versions/:id`, "admin", (c) => game2.maps.get(Number(c.params.id)));
  add2("POST", `${V}/admin/map/versions`, "admin", (c) => {
    const v = game2.maps.save(c.body.bundle, String(c.body.comment ?? ""));
    game2.audit("admin", "map_save", { version: v.id, checksum: v.checksum, comment: v.comment });
    return { __status: 201, ...v };
  });
  add2("POST", `${V}/admin/map/validate`, "admin", (c) => game2.maps.diagnose(c.body.bundle));
  add2("POST", `${V}/admin/map/report`, "admin", (c) => mapReport(c.body.bundle ?? game2.maps.current(), game2.maps.dir, opts.publicRoot));
  add2("GET", `${V}/admin/map/route/:diag/:house`, "admin", async (c) => {
    const r = await game2.maps.route(c.params.diag, Number(c.params.house));
    if (!r) throw new ApiError(404, "no_route", "Geen route of parkeervak voor dit huis");
    return r;
  });
  add2("POST", `${V}/admin/map/versions/:id/activate`, "admin", (c) => {
    if (c.body.confirm !== true) throw new ApiError(422, "confirm_required", 'Activeren herstart het spel op de nieuwe kaart: stuur {"confirm": true}');
    return game2.activateMap(Number(c.params.id));
  });
  const buckets = /* @__PURE__ */ new Map();
  const allow = (key) => {
    const now = Date.now();
    const b = buckets.get(key) ?? { tokens: 40, at: now };
    b.tokens = Math.min(40, b.tokens + (now - b.at) / 1e3 * 20);
    b.at = now;
    if (b.tokens < 1) {
      buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    buckets.set(key, b);
    return true;
  };
  const send = (res, status, body) => {
    const s = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    res.end(s);
  };
  const pages = { "/admin": "admin.html", "/": "projector.html", "/projector": "projector.html", "/test": "test.html", "/docs": "docs.html", "/api": "docs.html", "/editor": "editor.html" };
  const server2 = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Admin-Key", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" });
        return res.end();
      }
      if (url.pathname === `${V}/stream` && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "Access-Control-Allow-Origin": "*", "X-Accel-Buffering": "no" });
        const last = req.headers["last-event-id"] ?? url.searchParams.get("after") ?? void 0;
        const client = game2.addClient((chunk) => res.write(chunk), () => res.end(), url.searchParams.get("frames") === "1", last !== void 0 ? Number(last) : void 0);
        const ping = setInterval(() => res.write(": ping\n\n"), 15e3);
        req.on("close", () => {
          clearInterval(ping);
          game2.removeClient(client);
        });
        return;
      }
      if (url.pathname.startsWith(V)) {
        const ip = req.socket.remoteAddress ?? "x";
        const auth = req.headers.authorization?.replace(/^Bearer\s+/i, "");
        if (!allow(`${ip}|${auth ?? ""}`)) return send(res, 429, { error: "rate_limited", message: "Te veel verzoeken, probeer het zo opnieuw" });
        const route = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
        if (!route) {
          const exists = routes.some((r) => r.re.test(url.pathname));
          return send(res, exists ? 405 : 404, { error: exists ? "method_not_allowed" : "not_found", message: "Onbekend endpoint" });
        }
        const m = url.pathname.match(route.re);
        const params = {};
        route.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1]));
        let body = {};
        if (req.method === "POST") {
          const raw = await readBody(req, url.pathname.startsWith(`${V}/admin/map`) ? 8e6 : url.pathname === `${V}/admin/games/import` ? 6e7 : 256e3);
          if (raw) {
            try {
              body = JSON.parse(raw);
            } catch {
              throw new ApiError(422, "invalid_json", "Body is geen geldige JSON");
            }
          }
        }
        const ctx = { req, res, url, body, params, admin: false };
        if (route.auth === "player") {
          ctx.player = game2.playerByToken(auth);
          if (!ctx.player) throw new ApiError(401, "unauthorized", "Geldige spelerssessie vereist (Authorization: Bearer <token>)");
        }
        if (route.auth === "admin") {
          const key = req.headers["x-admin-key"];
          if (!key) throw new ApiError(401, "unauthorized", "Admin-sleutel vereist (X-Admin-Key)");
          if (key !== game2.cfg.adminKey) throw new ApiError(403, "forbidden", "Ongeldige admin-sleutel");
          ctx.admin = true;
        }
        const out = await route.h(ctx);
        if (out && !Array.isArray(out) && typeof out === "object" && "__file" in out) {
          const f = out.__file;
          res.writeHead(200, { "Content-Type": f.type, "Content-Disposition": `attachment; filename="${f.name}"`, "Cache-Control": "no-store", "Content-Length": statSync(f.path).size });
          return void createReadStream(f.path).pipe(res);
        }
        if (out && !Array.isArray(out) && typeof out === "object" && "__status" in out) {
          const { __status, ...rest } = out;
          return send(res, __status, rest);
        }
        return send(res, 200, out ?? { ok: true });
      }
      if (pages[url.pathname]) return serveFile(res, join4(opts.publicRoot, pages[url.pathname]));
      if (url.pathname.startsWith("/web/")) return serveFile(res, join4(opts.webRoot, normalize(url.pathname.slice(5)).replace(/^(\.\.[/\\])+/, "")));
      if (url.pathname.startsWith("/assets/")) return serveFile(res, join4(opts.publicRoot, normalize(url.pathname).replace(/^(\.\.[/\\])+/, "")));
      send(res, 404, { error: "not_found" });
    } catch (e) {
      if (e instanceof ApiError) return send(res, e.status, { error: e.code, message: e.message, ...e.extra });
      if (e instanceof MapError) return send(res, e.status, { error: e.code, message: e.message, problems: e.problems });
      console.error(e);
      send(res, 500, { error: "internal", message: String(e.message ?? e) });
    }
  });
  server2.listen(opts.port, opts.host, () => {
    const addrs = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => a.address);
    console.log(`
Harderwold Tycoon prototype draait.`);
    console.log(`  Projectie (4K):   http://localhost:${opts.port}/`);
    console.log(`  Testinterface:    http://localhost:${opts.port}/test`);
    console.log(`  API-documentatie: http://localhost:${opts.port}/docs`);
    console.log(`  Kaarteditor:      http://localhost:${opts.port}/editor`);
    for (const a of addrs) console.log(`  In het LAN:       http://${a}:${opts.port}/`);
    console.log(`  Spelcode: ${game2.cfg.gameCode}   Admin-sleutel: ${game2.cfg.adminKey}
`);
  });
  return server2;
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new ApiError(413, "too_large", "Body te groot"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function serveFile(res, path) {
  if (!existsSync4(path) || !statSync(path).isFile()) {
    res.writeHead(404);
    return res.end("not found");
  }
  res.writeHead(200, { "Content-Type": MIME[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
  res.end(readFileSync4(path));
}

// src/server/backup.ts
import { mkdirSync as mkdirSync2, readdirSync as readdirSync2, statSync as statSync2, rmSync, existsSync as existsSync5 } from "node:fs";
import { join as join5, basename } from "node:path";
var Backups = class {
  constructor(db, dir, keep = 48, beforeCopy = () => {
  }) {
    this.db = db;
    this.dir = dir;
    this.keep = keep;
    this.beforeCopy = beforeCopy;
    mkdirSync2(dir, { recursive: true });
  }
  /** make a backup now; returns its info */
  make(label = "auto") {
    this.beforeCopy();
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const file = join5(this.dir, `harderwold-${stamp}-${label.replace(/[^a-z0-9-]/gi, "")}.sqlite`);
    if (existsSync5(file)) rmSync(file);
    this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    this.prune();
    return this.info(file);
  }
  info(file) {
    const st = statSync2(file);
    return { file: basename(file), bytes: st.size, createdAt: st.mtimeMs };
  }
  list() {
    return readdirSync2(this.dir).filter((f) => /^harderwold-.*\.sqlite$/.test(f)).map((f) => this.info(join5(this.dir, f))).sort((a, b) => b.createdAt - a.createdAt);
  }
  /** full path of a listed backup (only names from list(), no path tricks) */
  path(name) {
    if (!this.list().some((b) => b.file === name)) return null;
    return join5(this.dir, name);
  }
  prune() {
    for (const b of this.list().slice(this.keep)) rmSync(join5(this.dir, b.file), { force: true });
  }
};

// src/server/main.ts
var emit = process.emitWarning;
process.emitWarning = ((w, ...a) => {
  if (String(w).includes("SQLite")) return;
  return emit(w, ...a);
});
var here2 = dirname3(fileURLToPath2(import.meta.url));
var root = existsSync6(join6(here2, "..", "data")) ? join6(here2, "..") : join6(here2, "..", "..");
var env = (k, d) => process.env[k] ?? d;
console.log("Park laden (kaart, wegennet, villa's) ...");
var t0 = Date.now();
var game = new Game({
  dbPath: env("DB_PATH", join6(root, "runtime", "harderwold.sqlite")),
  gameCode: env("GAME_CODE", "HARDER"),
  adminKey: env("ADMIN_KEY", "gm-harderwold"),
  seed: Number(env("SEED", "42")),
  timeScale: Number(env("TIME_SCALE", "1")),
  initialOccupied: Number(env("INITIAL_OCCUPIED", "4")),
  demoBot: env("DEMO_BOT", "0") === "1",
  autoArrivals: env("AUTO_ARRIVALS", "1") === "1",
  autoGate: env("AUTO_GATE", "0") === "1"
});
if (!process.env.ADMIN_KEY) console.warn("Let op: standaard admin-sleutel in gebruik. Zet ADMIN_KEY voor gebruik buiten je eigen netwerk.");
console.log(`Park geladen in ${((Date.now() - t0) / 1e3).toFixed(1)} s`);
game.start();
var dbPath = env("DB_PATH", join6(root, "runtime", "harderwold.sqlite"));
var backups = new Backups(game.db, env("BACKUP_DIR", join6(dirname3(dbPath), "backups")), Number(env("BACKUP_KEEP", "48")), () => game.save());
game.backups = backups;
var everyMin = Number(env("BACKUP_EVERY_MIN", "60"));
if (everyMin > 0) setInterval(() => {
  try {
    backups.make("auto");
  } catch (e) {
    console.error("Automatische back-up mislukt:", e.message);
  }
}, everyMin * 6e4).unref();
var server = startHttp(game, {
  port: Number(env("PORT", "8090")),
  host: env("HOST", "0.0.0.0"),
  webRoot: join6(root, "dist", "web"),
  publicRoot: join6(root, "public")
});
var shutdown = () => {
  console.log("\nOpslaan en afsluiten...");
  game.stop();
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
//# sourceMappingURL=server.mjs.map
