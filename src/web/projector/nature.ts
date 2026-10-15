// Trees, shrubs and flowers: pre-rendered billboard sprites (lit from the south-west) + placement on a blocked-area mask.
import { cam, mkCanvas, hrand, shadowPt, V2, reduceCanvas } from './proj.ts';

export type Species = 'spruce' | 'pine' | 'oak' | 'birch' | 'shrub' | 'hedge';
export interface TreeSprite { canvas: HTMLCanvasElement; ax: number; ay: number; h: number; r: number; species: Species }

const greensSpruce = ['#173322', '#1d3d29', '#244a31', '#2d5839', '#386642', '#45754b', '#56865a'];
const greensPine = ['#22391f', '#2b4727', '#36572f', '#426638', '#507543', '#61864f'];
const greensOak = ['#2c4a20', '#365a26', '#43692c', '#517a34', '#5f8a3d', '#719b48', '#87ad57'];
const greensBirch = ['#4f7a2c', '#5f8c34', '#719e3e', '#84af4b', '#98c05b', '#aecf70'];

/** sprites are drawn SS times larger and then reduced: sharper edges and room for leaf and needle detail */
const SS = 4;

/** a colour palette nudged per tree (a bit lighter/darker, a bit more yellow or blue), so the forest does not repeat */
function tint(cols: string[], rnd: () => number) {
  const l = 0.9 + rnd() * 0.22, warm = (rnd() - 0.5) * 18;
  return cols.map((h) => {
    const n = parseInt(h.slice(1), 16);
    const r = Math.min(255, Math.max(0, ((n >> 16) & 255) * l + warm)), g = Math.min(255, Math.max(0, ((n >> 8) & 255) * l)), b = Math.min(255, Math.max(0, (n & 255) * l - warm * 0.6));
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  });
}
/** light from the upper left (sun in the south-west on the projection): 0 = shadow side .. 1 = lit side */
const lightAt = (dx: number, dy: number) => Math.max(0, Math.min(1, 0.5 - dx * 0.45 - dy * 0.55));

/** A clump of foliage built from many small leaf tufts, drawn back to front and shaded per tuft. */
function foliage(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, cols: string[], rnd: () => number, density = 1, tuft = 0.2) {
  const n = Math.round(60 * density * Math.max(0.6, (rx * ry) / (40 * SS * 40 * SS) * 6 + 0.6));
  const tufts: { x: number; y: number; r: number; l: number }[] = [];
  // dark core first so gaps between tufts read as depth
  ctx.fillStyle = cols[0];
  ctx.beginPath(); ctx.ellipse(x + rx * 0.06, y + ry * 0.08, rx * 0.86, ry * 0.84, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), 0.6);
    const tx = x + Math.cos(a) * d * rx, ty = y + Math.sin(a) * d * ry;
    tufts.push({ x: tx, y: ty, r: Math.min(rx, ry) * tuft * (0.7 + rnd() * 0.6), l: lightAt((tx - x) / rx, (ty - y) / ry) * (0.75 + d * 0.35) });
  }
  tufts.sort((p, q) => p.l - q.l); // shadowed tufts first, lit tufts on top
  for (const t of tufts) {
    const ci = Math.min(cols.length - 1, Math.max(1, Math.round(1 + t.l * (cols.length - 2) + (rnd() - 0.5))));
    ctx.fillStyle = cols[ci];
    ctx.beginPath();
    // a tuft = a few overlapping leaves (small ellipses at random angles): ragged outline instead of a circle
    for (let k = 0; k < 3; k++) {
      const ang = rnd() * Math.PI, ox = (rnd() - 0.5) * t.r * 0.9, oy = (rnd() - 0.5) * t.r * 0.7;
      ctx.ellipse(t.x + ox, t.y + oy, t.r * (0.55 + rnd() * 0.35), t.r * (0.32 + rnd() * 0.2), ang, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  // sparkle: single bright leaves on the lit side, dark specks in the shadow
  for (let i = 0; i < n * 0.6; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd());
    const px = x + Math.cos(a) * d * rx, py = y + Math.sin(a) * d * ry;
    const l = lightAt((px - x) / rx, (py - y) / ry);
    ctx.fillStyle = l > 0.55 ? cols[cols.length - 1] : cols[0];
    ctx.globalAlpha = 0.5 + rnd() * 0.4;
    ctx.beginPath(); ctx.ellipse(px, py, SS * 0.9, SS * 0.55, rnd() * Math.PI, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** A drooping conifer branch tier: a skirt of needle strokes, dark underneath, lit on top-left. */
function needleTier(ctx: CanvasRenderingContext2D, x: number, y: number, rad: number, cols: string[], rnd: () => number) {
  // dark mass of the tier
  ctx.fillStyle = cols[0];
  ctx.beginPath(); ctx.moveTo(x - rad, y + rad * 0.32); ctx.quadraticCurveTo(x, y - rad * 0.55, x + rad, y + rad * 0.32); ctx.quadraticCurveTo(x, y + rad * 0.55, x - rad, y + rad * 0.32); ctx.fill();
  const n = Math.round(rad / SS * 7 + 10);
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1; // -1 left .. 1 right
    const bx = x + u * rad * 0.9, by = y + Math.abs(u) * rad * 0.22 - rad * 0.12 + (rnd() - 0.5) * rad * 0.25;
    const len = rad * (0.18 + rnd() * 0.22), droop = 0.6 + rnd() * 0.5;
    const l = lightAt(u, (by - y) / rad - 0.2);
    ctx.strokeStyle = cols[Math.min(cols.length - 1, Math.max(1, Math.round(1 + l * (cols.length - 2))))];
    ctx.lineWidth = SS * (0.55 + rnd() * 0.45);
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + u * len * 0.35, by + len * droop); ctx.stroke();
  }
  // a few bright needle tips along the upper edge
  ctx.strokeStyle = cols[cols.length - 1]; ctx.lineWidth = SS * 0.5; ctx.globalAlpha = 0.8;
  for (let i = 0; i < n * 0.25; i++) { const u = -1 + rnd() * 1.2; const bx = x + u * rad * 0.85, by = y + Math.abs(u) * rad * 0.2 - rad * 0.2; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + u * SS * 1.5, by + SS * 2.2); ctx.stroke(); }
  ctx.globalAlpha = 1;
}

function bark(ctx: CanvasRenderingContext2D, x: number, top: number, bottom: number, w0: number, w1: number, col: string, dark: string) {
  const g = ctx.createLinearGradient(x - w0, 0, x + w0, 0);
  g.addColorStop(0, col); g.addColorStop(0.55, col); g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(x - w0 / 2, bottom); ctx.lineTo(x - w1 / 2, top); ctx.lineTo(x + w1 / 2, top); ctx.lineTo(x + w0 / 2, bottom); ctx.closePath(); ctx.fill();
}
function branch(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number, col: string) {
  ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2 + (y1 - y0) * 0.15, (y0 + y1) / 2, x1, y1); ctx.stroke();
}

export function makeTree(species: Species, seed: number, heightM: number): TreeSprite {
  const rnd = hrand(seed * 97 + 1);
  const S = cam.S, vz = cam.S * cam.CE;
  const H = heightM * vz;
  const R = (species === 'spruce' ? heightM * 0.21 : species === 'pine' ? heightM * 0.26 : species === 'oak' ? heightM * 0.38 : species === 'birch' ? heightM * 0.27 : species === 'shrub' ? heightM * 0.7 : heightM * 0.6) * S;
  const w = Math.ceil(R * 2.6 + 8), hpx = Math.ceil(H + R * 0.8 + 10);
  const ax = w / 2, ay = hpx - R * 0.35 - 4; // trunk base (final pixels)
  // draw everything SS times larger
  const { c: big, ctx } = mkCanvas(w * SS, hpx * SS);
  const X = ax * SS, Y = ay * SS, HH = H * SS, RR = R * SS;
  if (species === 'spruce') {
    const cols = tint(greensSpruce, rnd);
    bark(ctx, X, Y - HH * 0.3, Y, RR * 0.14, RR * 0.08, '#5b4030', '#2a1d14');
    const tiers = 12 + Math.floor(rnd() * 3);
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const yC = Y - HH * (0.1 + t * 0.86);
      const rad = RR * (1 - t * 0.88) * (1.0 + rnd() * 0.28); // irregular tiers: not a perfect cone
      needleTier(ctx, X + (rnd() - 0.5) * RR * 0.2, yC, rad, cols, rnd);
    }
    ctx.strokeStyle = cols[3]; ctx.lineWidth = SS * 1.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(X, Y - HH * 0.95); ctx.lineTo(X, Y - HH - SS * 3); ctx.stroke();
  } else if (species === 'pine') {
    const cols = tint(greensPine, rnd);
    const trunkTop = Y - HH * 0.74;
    const lean = (rnd() - 0.5) * RR * 0.25;
    // grove den: lower trunk grey-brown, upper part orange
    ctx.save(); ctx.translate(lean * 0.5, 0);
    bark(ctx, X, trunkTop, Y, RR * 0.16, RR * 0.09, '#7a5a44', '#3a2a1e');
    bark(ctx, X, trunkTop, Y - HH * 0.35, RR * 0.1, RR * 0.08, '#a8653c', '#6a3b22');
    ctx.restore();
    const n = 4 + Math.floor(rnd() * 3);
    const clumps: [number, number, number][] = [];
    for (let i = 0; i < n; i++) clumps.push([X + lean + (rnd() - 0.5) * RR * 1.6, Y - HH * (0.68 + rnd() * 0.27), RR * (0.5 + rnd() * 0.3)]);
    clumps.sort((p, q) => p[1] - q[1]);
    for (const [bx, by] of clumps) branch(ctx, X + lean * 0.5, trunkTop + RR * 0.2, bx, by + RR * 0.1, SS * 1.4, '#8a4f2c');
    for (const [bx, by, br] of clumps.reverse()) foliage(ctx, bx, by, br, br * 0.55, cols, rnd, 0.9, 0.22);
  } else if (species === 'oak') {
    const cols = tint(greensOak, rnd);
    const cy = Y - HH * 0.64;
    bark(ctx, X, Y - HH * 0.5, Y, RR * 0.22, RR * 0.13, '#5f4a39', '#2a1f17');
    for (let i = 0; i < 4; i++) branch(ctx, X, Y - HH * 0.42, X + (rnd() - 0.5) * RR * 1.3, cy + (rnd() - 0.6) * RR * 0.7, SS * (1.8 - i * 0.3), '#4d3b2d');
    const n = 5 + Math.floor(rnd() * 3);
    const subs: [number, number, number][] = [];
    for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * RR * 0.5; subs.push([X + Math.cos(a) * d, cy + Math.sin(a) * d * 0.7, RR * (0.42 + rnd() * 0.2)]); }
    subs.sort((p, q) => (p[1] - q[1]) || (q[0] - p[0]));
    for (const [bx, by, br] of subs) foliage(ctx, bx, by, br, br * 0.85, cols, rnd, 1, 0.2);
  } else if (species === 'birch') {
    const cols = tint(greensBirch, rnd);
    const top = Y - HH * 0.86;
    bark(ctx, X, top, Y, RR * 0.12, RR * 0.07, '#ece8de', '#a9a49a');
    ctx.fillStyle = '#2b2b28';
    for (let i = 0; i < 14; i++) { const yy = top + rnd() * (Y - top); ctx.fillRect(X - RR * 0.05, yy, RR * 0.1 * (0.3 + rnd() * 0.7), SS * (0.6 + rnd() * 0.8)); }
    for (let i = 0; i < 5; i++) branch(ctx, X, top + rnd() * (Y - top) * 0.35, X + (rnd() - 0.5) * RR * 1.4, top - rnd() * RR * 0.4, SS * 0.8, '#d8d3c7');
    const cy = Y - HH * 0.68;
    const n = 4 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) { const bx = X + (rnd() - 0.5) * RR * 1.1, by = cy + (rnd() - 0.65) * RR * 1.3; foliage(ctx, bx, by, RR * (0.34 + rnd() * 0.14), RR * (0.42 + rnd() * 0.16), cols, rnd, 0.55, 0.18); }
  } else if (species === 'shrub') {
    const cols = tint(greensOak, rnd);
    const n = 3;
    for (let i = 0; i < n; i++) foliage(ctx, X + (rnd() - 0.5) * RR * 0.9, Y - RR * 0.45 - rnd() * RR * 0.35, RR * (0.48 + rnd() * 0.15), RR * (0.4 + rnd() * 0.12), cols, rnd, 0.7, 0.24);
    if (rnd() < 0.45) { const fc = ['#e58fb6', '#c96bd1', '#f2c94c', '#ffffff'][Math.floor(rnd() * 4)]; ctx.fillStyle = fc; for (let i = 0; i < 22; i++) { ctx.beginPath(); ctx.arc(X + (rnd() - 0.5) * RR * 1.4, Y - RR * 0.35 - rnd() * RR * 0.9, SS * 1.1, 0, Math.PI * 2); ctx.fill(); } }
  }
  return { canvas: reduceCanvas(big, w, hpx), ax, ay, h: heightM, r: R / S, species };
}

export interface Placed { x: number; y: number; sp: TreeSprite; key: number }

/** Blocked-area mask in world metres (1 cell = 1 m), rasterised with a canvas. */
export class Mask {
  x0 = -30; y0 = -30; w = 0; h = 0; data!: Uint8ClampedArray;
  ctx: CanvasRenderingContext2D;
  constructor(wm: number, hm: number) {
    this.w = Math.ceil(wm + 60); this.h = Math.ceil(hm + 60);
    const { ctx } = mkCanvas(this.w, this.h);
    this.ctx = ctx;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, this.w, this.h);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  }
  poly(pts: V2[], grow = 0) {
    const c = this.ctx; c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x - this.x0, p.y - this.y0) : c.moveTo(p.x - this.x0, p.y - this.y0))); c.closePath(); c.fill();
    if (grow > 0) { c.lineWidth = grow * 2; c.stroke(); }
  }
  line(pts: V2[], width: number) { const c = this.ctx; c.lineWidth = width; c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x - this.x0, p.y - this.y0) : c.moveTo(p.x - this.x0, p.y - this.y0))); c.stroke(); }
  circle(p: V2, r: number) { const c = this.ctx; c.beginPath(); c.arc(p.x - this.x0, p.y - this.y0, r, 0, Math.PI * 2); c.fill(); }
  freeze() { this.data = this.ctx.getImageData(0, 0, this.w, this.h).data; }
  blocked(x: number, y: number) {
    const i = Math.floor(x - this.x0), j = Math.floor(y - this.y0);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return true;
    return this.data[(j * this.w + i) * 4] > 100;
  }
}

export function placeTrees(mask: Mask, near: (x: number, y: number) => number, bounds: { w: number; h: number }, seed = 5): Placed[] {
  const rnd = hrand(seed);
  const out: Placed[] = [];
  const variants: Record<string, TreeSprite[]> = { spruce: [], pine: [], oak: [], birch: [] };
  for (let i = 0; i < 14; i++) variants.spruce.push(makeTree('spruce', 100 + i, 12 + (i % 5) * 1.6));
  for (let i = 0; i < 10; i++) variants.pine.push(makeTree('pine', 200 + i, 15 + (i % 4) * 1.6));
  for (let i = 0; i < 10; i++) variants.oak.push(makeTree('oak', 300 + i, 10 + (i % 4) * 1.4));
  for (let i = 0; i < 8; i++) variants.birch.push(makeTree('birch', 400 + i, 10 + (i % 3) * 1.5));
  const cell = 2.2;
  const grid = new Map<string, Placed[]>();
  const keyOf = (x: number, y: number) => `${Math.floor(x / 6)}:${Math.floor(y / 6)}`;
  const tries = Math.round(((bounds.w + 40) * (bounds.h + 46)) / (cell * cell));
  for (let t = 0; t < tries; t++) {
    const x = -20 + rnd() * (bounds.w + 40), y = -16 + rnd() * (bounds.h + 46);
    if (mask.blocked(x, y)) continue;
    const dNear = near(x, y); // distance to the nearest house/road (m)
    const edge = Math.min(x + 20, bounds.w + 20 - x, y + 16, bounds.h + 30 - y);
    const forest = Math.min(1, Math.max(0, (dNear - 9) / 16)) * 0.75 + (edge < 14 ? 0.35 : 0);
    if (rnd() > 0.22 + forest) continue;
    const sp: Species = rnd() < 0.42 ? 'spruce' : rnd() < 0.55 ? 'pine' : rnd() < 0.7 ? 'oak' : 'birch';
    const minD = sp === 'oak' ? 5.4 : sp === 'pine' ? 4.6 : 3.9;
    const k = keyOf(x, y);
    const [gx, gy] = k.split(':').map(Number);
    let ok = true;
    for (let i = -1; i <= 1 && ok; i++) for (let j = -1; j <= 1 && ok; j++) for (const p of grid.get(`${gx + i}:${gy + j}`) ?? []) if (Math.hypot(p.x - x, p.y - y) < Math.max(minD, p.sp.r * 1.4)) { ok = false; break; }
    if (!ok) continue;
    const v = variants[sp][Math.floor(rnd() * variants[sp].length)];
    const pl = { x, y, sp: v, key: y * cam.CE };
    out.push(pl);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(pl);
  }
  return out;
}

export function treeShadow(ctx: CanvasRenderingContext2D, p: Placed, toScreen: (x: number, y: number) => V2) {
  const zc = p.sp.h * (p.sp.species === 'pine' ? 0.82 : p.sp.species === 'oak' ? 0.6 : 0.5);
  const s = shadowPt({ x: p.x, y: p.y, z: zc });
  const a = toScreen(p.x, p.y), b = toScreen(s.x, s.y);
  const rx = p.sp.r * cam.S * (p.sp.species === 'spruce' ? 0.85 : 1.0);
  ctx.beginPath();
  ctx.ellipse((a.x + b.x * 2) / 3, (a.y + b.y * 2) / 3, rx * 1.15 + Math.abs(b.x - a.x) * 0.35, rx * 0.65 + Math.abs(b.y - a.y) * 0.3, Math.atan2(b.y - a.y, b.x - a.x), 0, Math.PI * 2);
  ctx.fill();
}

/** small dark ellipse under the trunk / crown base (contact shadow) */
export function treeContact(ctx: CanvasRenderingContext2D, p: Placed, toScreen: (x: number, y: number) => V2) {
  const a = toScreen(p.x, p.y);
  const r = p.sp.r * cam.S * (p.sp.species === 'shrub' ? 0.7 : 0.38);
  ctx.beginPath(); ctx.ellipse(a.x + r * 0.15, a.y + r * 0.05, r, r * cam.SE * 0.75, 0, 0, Math.PI * 2); ctx.fill();
}
