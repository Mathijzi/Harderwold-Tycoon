// Entry point: node dist/server.mjs  (or: node --import tsx src/server/main.ts)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { Game } from './game.ts';
import { startHttp } from './http.ts';
import { Backups } from './backup.ts';

// silence the one-time "SQLite is experimental" warning
const emit = process.emitWarning;
process.emitWarning = ((w: string | Error, ...a: unknown[]) => { if (String(w).includes('SQLite')) return; return (emit as (...x: unknown[]) => void)(w, ...a); }) as typeof process.emitWarning;

const here = dirname(fileURLToPath(import.meta.url));
// works both from src/server (tsx) and from dist/ (bundled)
const root = existsSync(join(here, '..', 'data')) ? join(here, '..') : join(here, '..', '..');
const env = (k: string, d: string) => process.env[k] ?? d;

console.log('Park laden (kaart, wegennet, 341 bungalows) ...');
const t0 = Date.now();
const game = new Game({
  dbPath: env('DB_PATH', join(root, 'runtime', 'harderwold.sqlite')),
  gameCode: env('GAME_CODE', 'HARDER'),
  adminKey: env('ADMIN_KEY', 'gm-harderwold'),
  seed: Number(env('SEED', '42')),
  timeScale: Number(env('TIME_SCALE', '1')),
  initialOccupied: Number(env('INITIAL_OCCUPIED', '4')),
  demoBot: env('DEMO_BOT', '0') === '1',
  autoArrivals: env('AUTO_ARRIVALS', '1') === '1',
  autoGate: env('AUTO_GATE', '0') === '1',
});
if (!process.env.ADMIN_KEY) console.warn('Let op: standaard admin-sleutel in gebruik. Zet ADMIN_KEY voor gebruik buiten je eigen netwerk.');
console.log(`Park geladen in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
game.start();
const dbPath = env('DB_PATH', join(root, 'runtime', 'harderwold.sqlite'));
const backups = new Backups(game.db, env('BACKUP_DIR', join(dirname(dbPath), 'backups')), Number(env('BACKUP_KEEP', '48')), () => game.save());
game.backups = backups;
const everyMin = Number(env('BACKUP_EVERY_MIN', '60'));
if (everyMin > 0) setInterval(() => { try { backups.make('auto'); } catch (e) { console.error('Automatische back-up mislukt:', (e as Error).message); } }, everyMin * 60_000).unref();
const server = startHttp(game, {
  port: Number(env('PORT', '8090')), host: env('HOST', '0.0.0.0'),
  webRoot: join(root, 'dist', 'web'), publicRoot: join(root, 'public'),
});
const shutdown = () => { console.log('\nOpslaan en afsluiten...'); game.stop(); server.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
