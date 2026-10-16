// Task scheduler (V3): ~2-4 normal tasks per daytime hour on average, fewer at night, 1-3 major incidents per day.
// Seeded randomness (Poisson process per game minute), weighted templates, occupancy, time of day, location state,
// cooldowns and a cap on simultaneous open tasks. Pure logic: the game provides the environment.
import { TEMPLATES, CRISES, TaskTemplate, CrisisTemplate, LocationRule } from '../shared/tasklib.ts';
import { rng } from '../shared/geom.ts';

export interface SchedulerConfig {
  enabled: boolean;
  /** average new normal tasks per daytime hour at average occupancy */
  normalPerHourDay: number;
  /** night rate = day rate x nightFactor */
  nightFactor: number;
  dayStartHour: number; dayEndHour: number;
  /** average major incidents (crises) per day, only in daytime */
  majorPerDay: number; majorMaxPerDay: number; majorMinGapMin: number;
  /** no new normal task while this many incident tasks are open (flood protection) */
  maxOpen: number;
}
export const DEFAULT_SCHEDULER: SchedulerConfig = {
  enabled: true, normalPerHourDay: 3, nightFactor: 0.2, dayStartHour: 8, dayEndHour: 23,
  majorPerDay: 2, majorMaxPerDay: 3, majorMinGapMin: 180, maxOpen: 12,
};
export function validateSchedulerConfig(c: Partial<SchedulerConfig>): string[] {
  const e: string[] = [];
  const r = (k: keyof SchedulerConfig, lo: number, hi: number) => { const v = c[k]; if (v !== undefined && !(typeof v === 'number' && v >= lo && v <= hi)) e.push(`${k} moet tussen ${lo} en ${hi} liggen`); };
  r('normalPerHourDay', 0, 20); r('nightFactor', 0, 1); r('dayStartHour', 0, 23); r('dayEndHour', 1, 24);
  r('majorPerDay', 0, 10); r('majorMaxPerDay', 0, 10); r('majorMinGapMin', 0, 1440); r('maxOpen', 1, 100);
  if (c.enabled !== undefined && typeof c.enabled !== 'boolean') e.push('enabled moet true of false zijn');
  return e;
}

export interface SchedulerEnv {
  /** game time in minutes (monotonic) and local hour of day (0-23.99), day index for daily limits */
  nowMin: number; hour: number; dayIndex: number;
  /** location ids (H<n> for bungalows, F-<key>#i for facilities) */
  occupied: string[]; vacant: string[]; houses: string[]; facilities: Map<string, string[]>;
  /** optional: does this house location have a feature (detached villa, private pool)? Without it every house qualifies. */
  hasFeature?: (loc: string, f: string) => boolean;
  occupancy: number;
  openNormal: number;
  /** locations that already have an open incident task */
  busy: Set<string>;
  /** last time (game minutes) this template was created at this location / anywhere */
  lastAt: (code: string, loc?: string) => number | undefined;
  /** optional: weather (or other) multiplier on a template's weight, by task group */
  groupFactor?: (group: string) => number;
}
export interface SchedulerState { dayIndex: number; majorsToday: number; lastMajorMin: number; rng?: number }
export interface Spawn { code: string; location: string }

export class Scheduler {
  cfg: SchedulerConfig;
  state: SchedulerState = { dayIndex: -1, majorsToday: 0, lastMajorMin: -1e9 };
  private rand: ReturnType<typeof rng>;
  constructor(cfg: Partial<SchedulerConfig> = {}, seed = 1, state?: SchedulerState) {
    this.cfg = { ...DEFAULT_SCHEDULER, ...cfg };
    this.rand = rng(seed * 104729 + 17);
    if (state) { this.state = { ...state }; if (state.rng !== undefined) this.rand.setState(state.rng); }
  }
  /** serialisable state (persisted with the game) */
  snapshot(): SchedulerState { return { ...this.state, rng: this.rand.state() }; }
  isDay(hour: number) { const { dayStartHour: a, dayEndHour: b } = this.cfg; return a <= b ? hour >= a && hour < b : hour >= a || hour < b; }
  /** expected normal tasks per game minute right now */
  normalRate(env: Pick<SchedulerEnv, 'hour' | 'occupancy'>) {
    const occ = 0.8 + 0.4 * Math.max(0, Math.min(1, env.occupancy)); // 0.8 (empty park) .. 1.2 (full)
    return (this.cfg.normalPerHourDay / 60) * (this.isDay(env.hour) ? 1 : this.cfg.nightFactor) * occ;
  }

  /** advance by dtMin game minutes; returns what to create */
  tick(env: SchedulerEnv, dtMin: number): { normal: Spawn[]; major: Spawn | null } {
    const out: { normal: Spawn[]; major: Spawn | null } = { normal: [], major: null };
    if (!this.cfg.enabled || dtMin <= 0) return out;
    if (env.dayIndex !== this.state.dayIndex) { this.state.dayIndex = env.dayIndex; this.state.majorsToday = 0; }
    // normal tasks: Poisson arrivals in this interval (dt is small, so at most a couple)
    let k = this.poisson(this.normalRate(env) * dtMin);
    while (k-- > 0 && env.openNormal + out.normal.length < this.cfg.maxOpen) {
      const s = this.pickNormal(env, out.normal);
      if (s) out.normal.push(s);
    }
    // major incidents: only in daytime, spread over the day, with a minimum gap and a daily maximum
    const dayMin = (this.cfg.dayEndHour - this.cfg.dayStartHour + 24) % 24 * 60 || 1440;
    if (this.isDay(env.hour) && this.state.majorsToday < this.cfg.majorMaxPerDay && env.nowMin - this.state.lastMajorMin >= this.cfg.majorMinGapMin) {
      if (this.rand.next() < (this.cfg.majorPerDay / dayMin) * dtMin * 1.15) {
        const s = this.pickMajor(env);
        if (s) { out.major = s; this.state.majorsToday++; this.state.lastMajorMin = env.nowMin; }
      }
    }
    return out;
  }

  /** one suitable normal task for this moment (admin '+1 incident', start of a game) */
  suggest(env: SchedulerEnv): Spawn | null { return this.pickNormal(env, []); }

  private poisson(lambda: number) {
    const L = Math.exp(-lambda); let k = 0, p = 1;
    do { k++; p *= this.rand.next(); } while (p > L);
    return k - 1;
  }
  private candidates(rule: LocationRule, env: SchedulerEnv): string[] {
    if (rule.kind === 'house') { const l = rule.vacant ? env.vacant : rule.occupied ? env.occupied : env.houses; return rule.feature && env.hasFeature ? l.filter((h) => env.hasFeature!(h, rule.feature!)) : l; }
    if (rule.kind === 'grounds') return env.houses;
    return (rule.facilities ?? []).flatMap((f) => env.facilities.get(f) ?? []);
  }
  private eligible(tp: TaskTemplate, env: SchedulerEnv) {
    if (tp.crisisOnly || tp.weight <= 0) return false;
    const day = this.isDay(env.hour);
    if (tp.when.day && !day) return false;
    if (tp.when.night && day) return false;
    if (tp.when.minOccupancy !== undefined && env.occupancy < tp.when.minOccupancy) return false;
    const last = env.lastAt(tp.code);
    return last === undefined || env.nowMin - last >= tp.cooldownMin / 3;
  }
  private pickNormal(env: SchedulerEnv, already: Spawn[]): Spawn | null {
    const taken = new Set([...env.busy, ...already.map((s) => s.location)]);
    const opts: { tp: TaskTemplate; locs: string[] }[] = [];
    for (const tp of TEMPLATES) {
      if (!this.eligible(tp, env) || already.some((s) => s.code === tp.code)) continue;
      const locs = this.candidates(tp.location, env).filter((l) => !taken.has(l) && !this.onCooldown(tp.code, l, tp.cooldownMin, env));
      if (locs.length) opts.push({ tp, locs });
    }
    const pick = this.weighted(opts, (o) => o.tp.weight * (env.groupFactor?.(o.tp.group) ?? 1));
    return pick ? { code: pick.tp.code, location: pick.locs[Math.floor(this.rand.next() * pick.locs.length)] } : null;
  }
  private pickMajor(env: SchedulerEnv): Spawn | null {
    const opts: { c: CrisisTemplate; locs: string[] }[] = [];
    for (const c of CRISES) {
      const locs = this.candidates(c.location, env).filter((l) => !this.onCooldown(c.code, l, 24 * 60, env));
      if (locs.length && !(env.lastAt(c.code) !== undefined && env.nowMin - env.lastAt(c.code)! < 12 * 60)) opts.push({ c, locs });
    }
    const pick = this.weighted(opts, (o) => o.c.weight);
    return pick ? { code: pick.c.code, location: pick.locs[Math.floor(this.rand.next() * pick.locs.length)] } : null;
  }
  private onCooldown(code: string, loc: string, min: number, env: SchedulerEnv) { const l = env.lastAt(code, loc); return l !== undefined && env.nowMin - l < min; }
  private weighted<T>(list: T[], w: (x: T) => number): T | null {
    const tot = list.reduce((a, x) => a + w(x), 0);
    if (!(tot > 0)) return null;
    let r = this.rand.next() * tot;
    for (const x of list) { r -= w(x); if (r <= 0) return x; }
    return list[list.length - 1];
  }
}
