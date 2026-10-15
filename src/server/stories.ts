// Storyline director: runs the guest storylines of guestlib on top of the regular task flow.
// A storyline belongs to one household in one bungalow. Each chapter is an ordinary claimable incident task
// (story-only template, tasks.parent_id = story id); completing it schedules the next chapter, an unclaimed
// chapter that expires or a household that leaves ends the story badly. Points go through the normal task path.
import { DB, getMeta, setMeta } from './db.ts';
import { STORIES, StoryTemplate, storyByCode, storyText, ROLE_NAMES, Role, FAME_NAMES } from '../shared/guestlib.ts';
import { Effect } from '../shared/tasklib.ts';
import type { Booking } from '../sim/park.ts';

export interface StoryConfig {
  enabled: boolean;
  /** average new storylines per daytime hour */
  perHourDay: number;
  /** at most this many storylines at the same time */
  maxActive: number;
}
export const DEFAULT_STORIES: StoryConfig = { enabled: true, perHourDay: 1.5, maxActive: 3 };
export function validateStoryConfig(c: Partial<StoryConfig>): string[] {
  const e: string[] = [];
  if (c.enabled !== undefined && typeof c.enabled !== 'boolean') e.push('enabled moet true of false zijn');
  if (c.perHourDay !== undefined && !(typeof c.perHourDay === 'number' && c.perHourDay >= 0 && c.perHourDay <= 20)) e.push('perHourDay moet tussen 0 en 20 liggen');
  if (c.maxActive !== undefined && !(Number.isInteger(c.maxActive) && c.maxActive >= 0 && c.maxActive <= 20)) e.push('maxActive moet een geheel getal tussen 0 en 20 zijn');
  return e;
}

export interface StoryHost {
  db: DB;
  nowMs(): number;
  isDay(): boolean;
  bookings(): Iterable<Booking>;
  rand(): number;
  createChapterTask(code: string, houseNumber: number, storyId: string, vars: Record<string, string>): { id: string; locationId: string | null; title: string; points: number } | null;
  cancelChapterTask(taskId: string, reason: string): void;
  applyEffect(locationId: string, e: Effect): void;
  event(type: string, payload: Record<string, unknown>): void;
}

interface StoryRow {
  id: string; code: string; booking_id: string; house_number: number; vars: string; chapter: number; task_id: string | null;
  state: 'active' | 'completed' | 'failed'; next_at: number | null; started_at: number; ended_at: number | null; outcome: string | null;
}

const ACTIVE_BOOKING = new Set(['parked', 'in_house']);

export class StoryDirector {
  cfg: StoryConfig;
  constructor(private host: StoryHost) {
    host.db.exec(`CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY, code TEXT NOT NULL, booking_id TEXT NOT NULL, house_number INTEGER NOT NULL, vars TEXT NOT NULL,
      chapter INTEGER NOT NULL, task_id TEXT, state TEXT NOT NULL CHECK (state IN ('active','completed','failed')),
      next_at INTEGER, started_at INTEGER NOT NULL, ended_at INTEGER, outcome TEXT)`);
    let saved: Partial<StoryConfig> = {};
    try { saved = JSON.parse(getMeta(host.db, 'stories') ?? '{}'); } catch { /* defaults */ }
    this.cfg = { ...DEFAULT_STORIES, ...saved };
  }
  /** settings of the game now in the database (after loading a saved game) */
  reloadConfig() { let saved: Partial<StoryConfig> = {}; try { saved = JSON.parse(getMeta(this.host.db, 'stories') ?? '{}'); } catch { /* defaults */ } this.cfg = { ...DEFAULT_STORIES, ...saved }; }
  setConfig(c: Partial<StoryConfig>) { this.cfg = { ...this.cfg, ...c }; setMeta(this.host.db, 'stories', JSON.stringify(this.cfg)); }
  wipe() { this.host.db.exec('DELETE FROM stories'); }

  private rows(all = false) {
    const sql = all ? 'SELECT * FROM stories ORDER BY started_at DESC LIMIT 50' : "SELECT * FROM stories WHERE state = 'active' ORDER BY started_at";
    return this.host.db.prepare(sql).all() as unknown as StoryRow[];
  }
  private row(id: string) { return this.host.db.prepare('SELECT * FROM stories WHERE id = ?').get(id) as unknown as StoryRow | undefined; }

  /** variables of a household for a storyline (null when nobody in it has a fitting role) */
  private varsFor(tpl: StoryTemplate, b: Booking): Record<string, string> | null {
    const lead = b.guests.find((g) => tpl.roles.includes(g.role as Role));
    if (!lead || !b.profile) return null;
    if (tpl.minFame !== undefined && b.profile.fame < tpl.minFame) return null;
    const cel = b.profile.celebrity;
    if (tpl.celebrities?.length) {
      if (!cel || !(tpl.celebrities.includes(cel) || (tpl.celebrities.includes('*') && !STORIES.some((x) => x !== tpl && x.celebrities?.includes(cel))))) return null;
    } else if (cel && tpl.noRealPeople) return null;
    if (tpl.familiesOnly && cel) return null;
    return { lead: lead.name, role: ROLE_NAMES[lead.role], household: b.household, omroep: b.profile.omroep, show: b.profile.show, n: String(b.houseNumber), loc: `bungalow ${b.houseNumber}`, fame: FAME_NAMES[b.profile.fame] };
  }

  /** Start a storyline (random fitting one when no code/booking is given). Throws a message when impossible. */
  start(opts: { code?: string; bookingId?: string } = {}) {
    const active = this.rows();
    const busy = new Set(active.map((r) => r.booking_id));
    const running = new Set(active.map((r) => r.code));
    const books = [...this.host.bookings()].filter((b) => ACTIVE_BOOKING.has(b.status) && !busy.has(b.id) && (!opts.bookingId || b.id === opts.bookingId));
    const tpls = opts.code ? [storyByCode.get(opts.code)].filter((x): x is StoryTemplate => !!x) : STORIES.filter((s) => !running.has(s.code));
    if (opts.code && !tpls.length) throw new Error('unknown_story');
    const opts2: { tpl: StoryTemplate; b: Booking; vars: Record<string, string> }[] = [];
    for (const tpl of tpls) for (const b of books) { const v = this.varsFor(tpl, b); if (v) opts2.push({ tpl, b, vars: v }); }
    if (!opts2.length) throw new Error('no_household');
    // weighted by template, then a random fitting household
    const byTpl = new Map<StoryTemplate, typeof opts2>();
    for (const o of opts2) (byTpl.get(o.tpl) ?? byTpl.set(o.tpl, []).get(o.tpl)!).push(o);
    const list = [...byTpl.keys()], tot = list.reduce((a, s) => a + s.weight, 0);
    let x = this.host.rand() * tot, tpl = list[list.length - 1];
    for (const s of list) { x -= s.weight; if (x <= 0) { tpl = s; break; } }
    const cand = byTpl.get(tpl)!, pick = cand[Math.floor(this.host.rand() * cand.length)];
    const id = `S-${Math.floor(this.host.rand() * 0xffffffff).toString(16).padStart(8, '0')}`;
    const now = this.host.nowMs();
    this.host.db.prepare("INSERT INTO stories (id, code, booking_id, house_number, vars, chapter, task_id, state, next_at, started_at) VALUES (?, ?, ?, ?, ?, -1, NULL, 'active', ?, ?)")
      .run(id, tpl.code, pick.b.id, pick.b.houseNumber, JSON.stringify(pick.vars), now, now);
    this.host.event('story.started', { storyId: id, code: tpl.code, title: tpl.title, text: storyText(tpl.intro, pick.vars), houseNumber: pick.b.houseNumber, household: pick.b.household, locationId: `H${pick.b.houseNumber}` });
    this.advance(this.row(id)!);
    return this.dto(this.row(id)!);
  }

  /** every 10 game seconds */
  tick(dtMin: number) {
    const now = this.host.nowMs();
    const books = new Map([...this.host.bookings()].map((b) => [b.id, b]));
    for (const r of this.rows()) {
      const b = books.get(r.booking_id);
      if (!b || !ACTIVE_BOOKING.has(b.status)) { this.end(r, false, 'household_left'); continue; }
      if (!r.task_id && r.next_at !== null && now >= r.next_at) this.advance(r);
    }
    if (!this.cfg.enabled || !this.host.isDay()) return;
    if (this.rows().length >= this.cfg.maxActive) return;
    if (this.host.rand() < (this.cfg.perHourDay / 60) * dtMin) { try { this.start(); } catch { /* nobody fits right now */ } }
  }

  /** next chapter (or the finale when all chapters are done) */
  private advance(r: StoryRow) {
    const tpl = storyByCode.get(r.code);
    if (!tpl) return this.end(r, false, 'unknown_template');
    const next = r.chapter + 1;
    if (next >= tpl.chapters.length) return this.end(r, true, 'completed');
    const vars = JSON.parse(r.vars) as Record<string, string>;
    const ch = tpl.chapters[next];
    const task = this.host.createChapterTask(ch.task, r.house_number, r.id, vars);
    if (!task) return this.end(r, false, 'no_location');
    this.host.db.prepare('UPDATE stories SET chapter = ?, task_id = ?, next_at = NULL WHERE id = ?').run(next, task.id, r.id);
    this.host.event('story.chapter', { storyId: r.id, code: r.code, title: tpl.title, chapter: next + 1, chapters: tpl.chapters.length, text: storyText(ch.text, vars), taskId: task.id, taskTitle: task.title, points: task.points, locationId: task.locationId ?? `H${r.house_number}` });
  }

  /** a chapter task ended (completed by a player, expired unclaimed or cancelled by the game master) */
  onTaskOutcome(taskId: string, storyId: string, outcome: 'completed' | 'expired' | 'cancelled') {
    const r = this.row(storyId);
    if (!r || r.state !== 'active' || r.task_id !== taskId) return;
    if (outcome !== 'completed') return this.end(r, false, outcome);
    const tpl = storyByCode.get(r.code)!;
    const nextCh = tpl.chapters[r.chapter + 1];
    if (!nextCh) return this.end(r, true, 'completed');
    this.host.db.prepare('UPDATE stories SET task_id = NULL, next_at = ? WHERE id = ?').run(this.host.nowMs() + nextCh.afterMin * 60000, r.id);
  }

  private end(r: StoryRow, success: boolean, why: string) {
    const tpl = storyByCode.get(r.code);
    const vars = JSON.parse(r.vars) as Record<string, string>;
    if (r.task_id && !success) this.host.cancelChapterTask(r.task_id, `story_${why}`);
    this.host.db.prepare('UPDATE stories SET state = ?, task_id = NULL, next_at = NULL, ended_at = ?, outcome = ? WHERE id = ?').run(success ? 'completed' : 'failed', this.host.nowMs(), why, r.id);
    if (tpl && why !== 'household_left') this.host.applyEffect(`H${r.house_number}`, success ? tpl.onSuccess : tpl.onFail);
    // a household that already left hears nothing more; the story just stops
    this.host.event('story.ended', { storyId: r.id, code: r.code, title: tpl?.title ?? r.code, success, reason: why, text: tpl ? storyText(success ? tpl.finale : tpl.fail, vars) : '', locationId: `H${r.house_number}`, houseNumber: r.house_number, quiet: why === 'household_left' });
  }

  dto(r: StoryRow) {
    const tpl = storyByCode.get(r.code);
    const vars = JSON.parse(r.vars) as Record<string, string>;
    const ch = tpl && r.chapter >= 0 ? tpl.chapters[r.chapter] : undefined;
    return {
      id: r.id, code: r.code, title: tpl?.title ?? r.code, bookingId: r.booking_id, houseNumber: r.house_number, household: vars.household, lead: vars.lead,
      omroep: vars.omroep, show: vars.show, intro: tpl ? storyText(tpl.intro, vars) : '', chapter: r.chapter + 1, chapters: tpl?.chapters.length ?? 0,
      chapterText: ch ? storyText(ch.text, vars) : null, taskId: r.task_id, nextAt: r.next_at, state: r.state, outcome: r.outcome,
      endText: r.state === 'active' || !tpl ? null : storyText(r.state === 'completed' ? tpl.finale : tpl.fail, vars), startedAt: r.started_at, endedAt: r.ended_at,
    };
  }
  list(all = false) { return this.rows(all).map((r) => this.dto(r)); }
  activeByHouse() { const m = new Map<number, { id: string; title: string; chapter: number; chapters: number }>(); for (const d of this.list()) m.set(d.houseNumber, { id: d.id, title: d.title, chapter: d.chapter, chapters: d.chapters }); return m; }
}
