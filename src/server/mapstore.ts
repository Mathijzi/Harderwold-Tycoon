// Map editor backend: versioned map bundles in SQLite, diagnostics in a worker thread, activation (writes the
// editable files in data/map and restarts the game on the new map). Admin only.
import { Worker } from 'node:worker_threads';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from './db.ts';
import { checkBundle, checksum, MapBundle, MAP_FORMAT, MAP_SCHEMA, Problem } from '../shared/mapdoc.ts';
import type { Diagnosis } from '../sim/diagnose.ts';

export const NET_FILE = 'park_road_network.json', PARK_FILE = 'park.json';

export interface VersionRow { id: number; created_at: number; author: string; comment: string; checksum: string; parent: number | null; errors: number; warnings: number; activated_at: number | null }

export class MapError extends Error {
  constructor(public status: number, public code: string, message: string, public problems: Problem[] = []) { super(message); }
}

export class MapStore {
  private worker?: Worker;
  private seq = 0;
  private pending = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>();
  private diagSeq = 0;

  constructor(private db: DB, public dir: string) {
    db.exec(`CREATE TABLE IF NOT EXISTS map_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, author TEXT NOT NULL, comment TEXT NOT NULL,
      checksum TEXT NOT NULL, parent INTEGER, bundle TEXT NOT NULL, errors INTEGER NOT NULL, warnings INTEGER NOT NULL, activated_at INTEGER)`);
  }

  /** The active map = the files in data/map, as a bundle (review state and version info live in park.json). */
  current(): MapBundle & { activeVersion: { id: number; checksum: string; activatedAt: string } | null } {
    const network = JSON.parse(readFileSync(join(this.dir, NET_FILE), 'utf8'));
    const park = JSON.parse(readFileSync(join(this.dir, PARK_FILE), 'utf8'));
    const review = (park.editorReview ?? {}) as Record<string, boolean>;
    const active = (park.editorVersion ?? null) as { id: number; checksum: string; activatedAt: string } | null;
    delete park.editorReview; delete park.editorVersion;
    return { format: MAP_FORMAT, schema: MAP_SCHEMA, parentVersion: active?.id ?? null, network, park, review, activeVersion: active };
  }

  list(): VersionRow[] {
    return this.db.prepare('SELECT id, created_at, author, comment, checksum, parent, errors, warnings, activated_at FROM map_versions ORDER BY id DESC').all() as unknown as VersionRow[];
  }
  get(id: number): MapBundle {
    const r = this.db.prepare('SELECT bundle FROM map_versions WHERE id = ?').get(id) as { bundle: string } | undefined;
    if (!r) throw new MapError(404, 'not_found', `Kaartversie ${id} bestaat niet`);
    return JSON.parse(r.bundle);
  }

  /** Save a new version (structural errors are refused; warnings are stored with the version). */
  save(input: unknown, comment: string, author = 'admin'): VersionRow {
    const b = normalise(input);
    const problems = checkBundle(b);
    const errors = problems.filter((p) => p.level === 'error');
    if (errors.length) throw new MapError(422, 'invalid_map', `Kaart heeft ${errors.length} fout(en)`, errors);
    b.comment = String(comment ?? '').slice(0, 500); b.savedAt = new Date().toISOString();
    const json = JSON.stringify(b);
    const info = this.db.prepare('INSERT INTO map_versions (created_at, author, comment, checksum, parent, bundle, errors, warnings) VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
      .run(Date.now(), author, b.comment, checksum(JSON.stringify({ n: b.network, p: b.park })), b.parentVersion ?? null, json, problems.filter((p) => p.level === 'warn').length);
    return this.list().find((v) => v.id === Number(info.lastInsertRowid))!;
  }

  // ---------------------------------------------------------------- worker
  private call<T>(msg: Record<string, unknown>): Promise<T> {
    if (!this.worker) {
      const isTs = import.meta.url.endsWith('.ts');
      this.worker = new Worker(new URL(isTs ? './mapworker-dev.mjs' : './mapworker.mjs', import.meta.url));
      this.worker.on('message', (m: { id: number; result?: unknown; error?: string }) => {
        const p = this.pending.get(m.id); if (!p) return;
        this.pending.delete(m.id);
        if (!this.pending.size) this.worker?.unref();
        if (m.error) p.fail(new MapError(m.error === 'diag_expired' ? 409 : 500, m.error, m.error === 'diag_expired' ? 'Valideer de kaart opnieuw' : m.error)); else p.ok(m.result);
      });
      this.worker.on('error', (e) => { for (const p of this.pending.values()) p.fail(e); this.pending.clear(); this.worker = undefined; });
    }
    const id = ++this.seq;
    this.worker.ref();
    return new Promise<T>((ok, fail) => { this.pending.set(id, { ok: ok as (v: unknown) => void, fail }); this.worker!.postMessage({ ...msg, id }); });
  }
  async diagnose(input: unknown): Promise<Diagnosis & { diagId: string }> {
    const b = normalise(input);
    const diagId = `d${++this.diagSeq}`;
    const diag = await this.call<Diagnosis>({ op: 'diagnose', diagId, bundle: b });
    return { ...diag, diagId };
  }
  route(diagId: string, house: number) { return this.call<unknown>({ op: 'route', diagId, house }); }
  close() { void this.worker?.terminate(); this.worker = undefined; }

  /** Validate a saved version with the full network build and write it to data/map (atomic per file). */
  async activate(id: number): Promise<{ bundle: MapBundle; diag: Diagnosis }> {
    const b = this.get(id);
    const diag = await this.diagnose(b);
    if (!diag.ok) throw new MapError(422, 'map_has_errors', 'Deze versie heeft fouten en kan niet actief worden', diag.problems.filter((p) => p.level === 'error'));
    const row = this.list().find((v) => v.id === id)!;
    const park = { ...b.park, editorReview: b.review, editorVersion: { id, checksum: row.checksum, activatedAt: new Date().toISOString() } };
    const write = (f: string, data: unknown) => { const p = join(this.dir, f); writeFileSync(p + '.tmp', JSON.stringify(data, null, 1)); renameSync(p + '.tmp', p); };
    write(NET_FILE, b.network);
    write(PARK_FILE, park);
    this.db.prepare('UPDATE map_versions SET activated_at = ? WHERE id = ?').run(Date.now(), id);
    return { bundle: b, diag };
  }
  exists() { return existsSync(join(this.dir, NET_FILE)) && existsSync(join(this.dir, PARK_FILE)); }
}

function normalise(input: unknown): MapBundle {
  const b = (typeof input === 'string' ? JSON.parse(input) : input) as MapBundle;
  if (!b || typeof b !== 'object') throw new MapError(422, 'invalid_map', 'Geen kaartdocument');
  const park = { ...(b.park ?? {}) } as MapBundle['park'] & Record<string, unknown>;
  delete park.editorReview; delete park.editorVersion;
  return { format: b.format, schema: b.schema, parentVersion: b.parentVersion ?? null, comment: b.comment, savedAt: b.savedAt, network: b.network, park, review: b.review ?? {} };
}
