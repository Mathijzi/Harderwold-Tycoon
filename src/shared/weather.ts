// Weather: a small state machine over game time. Each kind lasts a while (30-150 game minutes) and then changes
// to a plausible next kind (sun -> clouds -> rain -> ...). Temperature follows the hour of the day and the kind.
// Pure logic (seeded or Math.random), used by the game server; the projector only shows what the server says.

export type WeatherKind = 'zon' | 'halfbewolkt' | 'bewolkt' | 'regen' | 'onweer' | 'mist';
export const WEATHER_KINDS: WeatherKind[] = ['zon', 'halfbewolkt', 'bewolkt', 'regen', 'onweer', 'mist'];
export const WEATHER_NAMES: Record<WeatherKind, string> = { zon: 'Zonnig', halfbewolkt: 'Half bewolkt', bewolkt: 'Bewolkt', regen: 'Regen', onweer: 'Onweer', mist: 'Mist' };

export interface WeatherState {
  kind: WeatherKind;
  /** 0..1: how strong (light drizzle .. downpour, thin .. dense fog) */
  intensity: number;
  /** wind in Beaufort (0-9) */
  wind: number;
  /** air temperature in °C (rounded) */
  tempC: number;
  /** game ms when this kind started and when the next change is due */
  since: number; until: number;
  /** set by the game master: no automatic changes until `until` */
  locked: boolean;
  /** what comes next (kind + game ms) */
  forecast: { kind: WeatherKind; at: number }[];
}

/** plausible transitions with weights */
const NEXT: Record<WeatherKind, [WeatherKind, number][]> = {
  zon: [['halfbewolkt', 6], ['zon', 2], ['mist', 0.5]],
  halfbewolkt: [['zon', 4], ['bewolkt', 4], ['regen', 1]],
  bewolkt: [['regen', 4], ['halfbewolkt', 4], ['onweer', 1], ['mist', 0.8]],
  regen: [['bewolkt', 5], ['regen', 2], ['onweer', 1.2], ['halfbewolkt', 1]],
  onweer: [['regen', 5], ['bewolkt', 3]],
  mist: [['halfbewolkt', 4], ['bewolkt', 3], ['zon', 1]],
};
const DURATION_MIN: Record<WeatherKind, [number, number]> = { zon: [60, 150], halfbewolkt: [45, 120], bewolkt: [45, 120], regen: [30, 90], onweer: [20, 45], mist: [30, 90] };

type Rnd = () => number;
const pick = (list: [WeatherKind, number][], r: Rnd) => { const tot = list.reduce((a, x) => a + x[1], 0); let x = r() * tot; for (const [k, w] of list) { x -= w; if (x <= 0) return k; } return list[0][0]; };
const durationMs = (k: WeatherKind, r: Rnd) => { const [a, b] = DURATION_MIN[k]; return (a + r() * (b - a)) * 60000; };

/** temperature in October in the Veluwe: about 7 °C at night, 15 °C in the afternoon; sun warmer, rain/fog cooler */
export function temperature(kind: WeatherKind, hour: number) {
  const day = 11 + 4 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
  const adj = { zon: 2, halfbewolkt: 1, bewolkt: 0, regen: -1.5, onweer: -1, mist: -2 }[kind];
  return Math.round(day + adj);
}

export function newWeather(nowMs: number, hour: number, r: Rnd = Math.random, kind?: WeatherKind): WeatherState {
  const k = kind ?? pick([['zon', 3], ['halfbewolkt', 4], ['bewolkt', 3], ['regen', 1.5], ['mist', 0.7]], r);
  const s: WeatherState = { kind: k, intensity: 0.4 + r() * 0.5, wind: windFor(k, r), tempC: temperature(k, hour), since: nowMs, until: nowMs + durationMs(k, r), locked: false, forecast: [] };
  s.forecast = forecastFrom(s, r);
  return s;
}
function windFor(k: WeatherKind, r: Rnd) { return Math.round(k === 'onweer' ? 5 + r() * 3 : k === 'regen' ? 3 + r() * 3 : k === 'mist' ? r() : 1 + r() * 3); }
function forecastFrom(s: WeatherState, r: Rnd) {
  const out: { kind: WeatherKind; at: number }[] = [];
  let k = s.kind, at = s.until;
  for (let i = 0; i < 3; i++) { k = pick(NEXT[k], r); out.push({ kind: k, at }); at += durationMs(k, r); }
  return out;
}

/** advance to `nowMs`; returns true when the kind changed */
export function stepWeather(s: WeatherState, nowMs: number, hour: number, r: Rnd = Math.random): boolean {
  s.tempC = temperature(s.kind, hour);
  if (nowMs < s.until) return false;
  const next = s.forecast.shift()?.kind ?? pick(NEXT[s.kind], r);
  const changed = next !== s.kind;
  s.kind = next; s.since = nowMs; s.until = nowMs + durationMs(next, r); s.locked = false;
  s.intensity = 0.4 + r() * 0.5; s.wind = windFor(next, r); s.tempC = temperature(next, hour);
  s.forecast = forecastFrom(s, r);
  return changed;
}

/** the game master (or a storm crisis) sets the weather for a number of game minutes */
export function forceWeather(s: WeatherState, kind: WeatherKind, nowMs: number, hour: number, minutes: number, r: Rnd = Math.random) {
  const changed = s.kind !== kind;
  s.kind = kind; s.since = changed ? nowMs : s.since; s.until = nowMs + minutes * 60000; s.locked = true;
  s.intensity = kind === 'onweer' ? 0.85 : 0.6; s.wind = windFor(kind, r); s.tempC = temperature(kind, hour);
  s.forecast = forecastFrom(s, r);
  return changed;
}

/** how the weather shifts which tasks happen: multiplier per task group (1 = unchanged) */
export function groupFactor(kind: WeatherKind, group: string): number {
  const t: Partial<Record<WeatherKind, Record<string, number>>> = {
    zon: { fietsverhuur: 1.6, horeca: 1.3, zwembad: 1.2, animatie: 1.1, natuur: 1.1 },
    halfbewolkt: { fietsverhuur: 1.2 },
    regen: { terrein: 1.6, onderhoud: 1.3, schoonmaak: 1.3, zwembad: 1.2, animatie: 1.3, fietsverhuur: 0.4, natuur: 0.7 },
    onweer: { terrein: 2.0, onderhoud: 1.6, chaos: 1.3, fietsverhuur: 0.2, zwembad: 0.6, natuur: 0.6 },
    mist: { terrein: 1.2, fietsverhuur: 0.7 },
  };
  return t[kind]?.[group] ?? 1;
}
