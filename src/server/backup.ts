// Database backups: a consistent copy of the whole SQLite database (all games, saves, own content, map versions)
// via VACUUM INTO, which is safe while the server runs. Automatic every BACKUP_EVERY_MIN minutes (default 60) into
// BACKUP_DIR (default runtime/backups), keeping the newest BACKUP_KEEP (default 48). Restoring a full backup is an
// offline step (stop the server, put the file back): see docs/RUNBOOK.md. Single games are restored online via
// /admin -> Spellen.
import { mkdirSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { DB } from './db.ts';

export interface BackupInfo { file: string; bytes: number; createdAt: number }

export class Backups {
  constructor(private db: DB, readonly dir: string, private keep = 48, private beforeCopy: () => void = () => {}) { mkdirSync(dir, { recursive: true }); }
  /** make a backup now; returns its info */
  make(label = 'auto'): BackupInfo {
    this.beforeCopy();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = join(this.dir, `harderwold-${stamp}-${label.replace(/[^a-z0-9-]/gi, '')}.sqlite`);
    if (existsSync(file)) rmSync(file);
    this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    this.prune();
    return this.info(file);
  }
  private info(file: string): BackupInfo { const st = statSync(file); return { file: basename(file), bytes: st.size, createdAt: st.mtimeMs }; }
  list(): BackupInfo[] {
    return readdirSync(this.dir).filter((f) => /^harderwold-.*\.sqlite$/.test(f)).map((f) => this.info(join(this.dir, f))).sort((a, b) => b.createdAt - a.createdAt);
  }
  /** full path of a listed backup (only names from list(), no path tricks) */
  path(name: string) { if (!this.list().some((b) => b.file === name)) return null; return join(this.dir, name); }
  private prune() { for (const b of this.list().slice(this.keep)) rmSync(join(this.dir, b.file), { force: true }); }
}
