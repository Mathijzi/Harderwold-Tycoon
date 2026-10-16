// Bungalow dimensions shared by the simulation (clearance from roads, parking and other houses) and the projector art.
import { Vec, OBB } from './geom.ts';

/** Display label of a house number: the A-variants of the plan (217ᴬ, 312ᴬ ...) are stored as 1000 + number. */
export function houseLabel(n: number): string { return n >= 1000 ? `${n - 1000}A` : String(n); }

export interface HouseSize {
  W: number; D: number; annex: boolean; cap: number; scale: number;
  /** ground in front of / behind the body that belongs to the house (patio, terrace), metres before scaling */
  patioFront: number; patioBack: number;
  /** distance from the centre to the front door (metres before scaling) */
  doorM: number;
}

/** Harderwold villa (legend type ...V) and terraced unit (...G): deterministic per house number, shared by the
 *  simulation (clearance, door) and the projector art (villas.ts). */
export interface VillaVariant { W: number; D: number; floors: 1 | 2; pool: boolean; solar: boolean; upperSide: -1 | 1; terraceD: number; boat: boolean; hedge: boolean }
export function villaVariant(num: number): VillaVariant {
  const r = hrand(num * 97 + 11);
  const W = [10.5, 11.5, 12.5, 13.5][Math.floor(r() * 4)], D = r() < 0.5 ? 9.0 : 10.0;
  const floors = r() < 0.72 ? 2 : 1;
  return { W, D, floors, pool: r() < 0.42, solar: r() < 0.65, upperSide: r() < 0.5 ? -1 : 1, terraceD: 5.5, boat: r() < 0.35, hedge: r() < 0.8 };
}
export const isVilla = (type: string | null) => !!type && /V$/.test(type);
export const isTerraced = (type: string | null) => !!type && /G$/.test(type);

/** Legend type -> body width W (across the front) and depth D (front to back), in metres (before scaling).
 *  `pdfSideM` = side of the house square in the PDF: the whole house incl. annex and patio is scaled to fit within
 *  1.1x that square, so the houses keep the real spacing of the park plan. */
export function houseSize(type: string | null, pdfSideM?: number, num = 0): HouseSize {
  if (isVilla(type)) {
    const v = villaVariant(num);
    return { W: v.W, D: v.D, annex: false, cap: 8, scale: 1, patioFront: 0.6, patioBack: v.terraceD, doorM: v.D / 2 + 0.8 };
  }
  if (isTerraced(type)) {
    // units side by side in a block share their walls: for the clearance check the body is narrower than its share of
    // the block (the free-space pass adds 0.4 m per side and keeps 0.3 m between houses); the art uses the full share
    const W = Math.max(3.5, Math.min(5.4, (pdfSideM ?? 6) - 1.2));
    return { W, D: 8.5, annex: false, cap: 4, scale: 1, patioFront: 0.4, patioBack: 2.6, doorM: 8.5 / 2 + 0.7 };
  }
  const t = type ?? '6C';
  const cap = parseInt(t, 10) || 6;
  const size = cap <= 4 ? [6.4, 8.6] : cap <= 6 ? [7.0, 9.8] : cap <= 8 ? [7.6, 11] : cap <= 12 ? [8.4, 12.6] : [9.2, 15];
  const annex = cap >= 6 || /E|K/.test(t.slice(1));
  let scale = 1;
  if (pdfSideM && pdfSideM > 4) {
    const box = pdfSideM * 1.1;
    scale = Math.max(0.65, Math.min(1, box / (size[0] + 0.8 + (annex ? 3.0 : 0)), box / (size[1] + 0.8 + 3.6)));
  }
  return { W: size[0], D: size[1], annex, cap, scale, patioFront: PATIO_D, patioBack: 0.4, doorM: size[1] / 2 + 2.4 };
}
/** Patio in front of the house (m) and annex width at the side (m), as drawn by the projector. */
export const PATIO_D = 3.6, ANNEX_W = 3.0;

/** same generator as the projector (proj.ts hrand), so the annex side matches the drawing */
function hrand(seed: number) {
  let s = (seed * 2654435761) >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s >>> 0) / 4294967296; };
}
/** +1: annex on the right of the front direction, -1: on the left (houses.ts: mirror = first draw < 0.5) */
export function annexSide(num: number) { return hrand(num * 31 + 3)() < 0.5 ? -1 : 1; }

/** Ground footprint: body + roof overhang + the annex on its real side, optionally with the front patio. */
export function houseFootprint(pos: Vec, front: Vec, s: HouseSize, num: number, opts: { patio?: boolean; margin?: number } = {}): OBB {
  const m = opts.margin ?? 0, k = s.scale;
  const back = (s.D / 2 + (opts.patio === false ? 0.4 : s.patioBack)) * k, ahead = (s.D / 2 + (opts.patio === false ? 0.4 : s.patioFront)) * k;
  const side = annexSide(num), a = s.annex ? ANNEX_W : 0;
  const left = (s.W / 2 + 0.4 + (side < 0 ? a : 0)) * k, right = (s.W / 2 + 0.4 + (side > 0 ? a : 0)) * k;
  const cl = (ahead - back) / 2, cw = (right - left) / 2;      // centre offset along front / along right
  const rx = -front.y, ry = front.x;
  return {
    cx: pos.x + front.x * cl + rx * cw, cy: pos.y + front.y * cl + ry * cw, ux: front.x, uy: front.y,
    hl: (ahead + back) / 2 + m, hw: (left + right) / 2 + m,
  };
}
/** Sample points over a footprint (grid incl. corners), for distance checks against roads. */
export function footprintSamples(f: OBB, nl = 5, nw = 3): Vec[] {
  const out: Vec[] = [];
  const vx = -f.uy, vy = f.ux;
  for (let i = 0; i < nl; i++) for (let j = 0; j < nw; j++) {
    const a = (i / (nl - 1) * 2 - 1) * f.hl, b = (j / (nw - 1) * 2 - 1) * f.hw;
    out.push({ x: f.cx + f.ux * a + vx * b, y: f.cy + f.uy * a + vy * b });
  }
  return out;
}
