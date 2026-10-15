// Durable storage on Node's built-in SQLite (node:sqlite, Node >= 22.13). Single file, WAL mode, transactional.
// The repository layer is small and SQL-standard so it can move to PostgreSQL in phase 1 without changing callers.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = DatabaseSync;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
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
  // additive migrations for databases created by older versions
  const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  const addCol = (t: string, c: string, def: string) => { if (!cols(t).includes(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); };
  addCol('tasks', 'parent_id', 'TEXT');
  addCol('tasks', 'depth', 'INTEGER NOT NULL DEFAULT 0');
  addCol('tasks', 'escalated', 'INTEGER NOT NULL DEFAULT 0');
  addCol('tasks', 'fx', 'TEXT');
  return db;
}

/** Run fn inside BEGIN IMMEDIATE ... COMMIT (serialises writers; rolls back on any throw). */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
}

export function getMeta(db: DB, k: string): string | undefined {
  const r = db.prepare('SELECT v FROM meta WHERE k = ?').get(k) as { v: string } | undefined;
  return r?.v;
}
export function setMeta(db: DB, k: string, v: string) {
  db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v);
}

export function wipe(db: DB) {
  db.exec(`DELETE FROM players; DELETE FROM tasks; DELETE FROM score_ledger; DELETE FROM gate_passages; DELETE FROM idempotency;
           DELETE FROM events; DELETE FROM sim_state; DELETE FROM meta; DELETE FROM incidents; DELETE FROM location_state; DELETE FROM sqlite_sequence WHERE name IN ('events','score_ledger');`);
}
