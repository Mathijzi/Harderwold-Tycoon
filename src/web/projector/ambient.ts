// Ambient park life on the projector (decoration only, never part of the simulation): duck families on the ponds,
// strollers, couples and dog walkers on the verges of the park roads, children playing at the playgrounds and
// sports fields. Seeded and client-side, so it costs the server nothing and never interacts with traffic or gates.
// Walkers keep to the verge (beyond the road surface), so they never stand in a lane.
import { cam, P, Pv, V2 } from './proj.ts';
import { pointInPolygon, rng } from '../../shared/geom.ts';
import { drawPedestrian } from './vehicles.ts';
import type { Drawable } from './pixi.ts';

type R = ReturnType<typeof rng>;
interface Duck { x: number; y: number; h: number; male: boolean; chick: boolean }
interface Family { pond: number; ducks: Duck[]; tx: number; ty: number; pause: number; speed: number }
interface Path { pts: V2[]; cum: number[]; len: number }
interface Walker { kind: 'single' | 'couple' | 'dog' | 'family'; path: number; s: number; dir: 1 | -1; speed: number; colors: string[]; seed: number; pause: number; x: number; y: number; h: number }
interface Kid { cx: number; cy: number; r: number; x: number; y: number; tx: number; ty: number; speed: number; color: string; seed: number; pause: number; h: number }

/** people and dogs are drawn larger than life (x1.6) so park life reads on a projection seen from across the room */
let LIFE = 1.6;
/** close-up view (?zoom): figures at (almost) real size, they are big enough already */
export function setLifeScale(zoom: number) { LIFE = zoom >= 2 ? 1 : 1.6; DUCK = zoom >= 2 ? 1.25 : 2.8; }
let DUCK = 2.8;
const CLOTHES = ['#d9534f', '#3a6ea5', '#f0ad4e', '#5cb85c', '#f7f7f2', '#7b5ea7', '#e88aa8', '#46a5a0', '#c9a227', '#2f6f8f', '#e07b39', '#8fb339'];
const PLAY = new Set(['S', 'Z', 'E', 'R', 'U', 'Q']);

export interface AmbientInput {
  water: V2[][];
  roads: { cls: string; center: V2[]; halfWidth: number[]; hidden?: boolean }[];
  facilities: { key: string; pos: V2 }[];
  /** points that must stay clear (house anchors etc.): a walker path that passes within 2 m of one is cut there */
  avoid?: (p: V2) => boolean;
}

export class Ambient {
  private families: Family[] = [];
  private walkers: Walker[] = [];
  private kids: Kid[] = [];
  private paths: Path[] = [];
  private ponds: V2[][] = [];
  private rand: R;
  private last = 0;
  constructor(inp: AmbientInput, seed = 11) {
    this.rand = rng(seed);
    const r = this.rand;
    // ---------------- ducks: families on the larger ponds
    const area = (w: V2[]) => Math.abs(w.reduce((a, p, i) => { const q = w[(i + 1) % w.length]; return a + p.x * q.y - q.x * p.y; }, 0) / 2);
    const ponds = inp.water.filter((w) => w.length >= 6 && area(w) > 250).sort((a, b) => area(b) - area(a));
    this.ponds = ponds;
    ponds.forEach((w, pi) => {
      const n = Math.max(1, Math.min(6, Math.round(area(w) / 900)));
      for (let k = 0; k < n && this.families.length < 26; k++) {
        const p = this.inside(pi); if (!p) continue;
        const chicks = r.next() < 0.55 ? r.int(2, 5) : 0;
        const ducks: Duck[] = [{ x: p.x, y: p.y, h: r.range(0, 6.28), male: chicks ? false : r.next() < 0.5, chick: false }];
        if (!chicks && r.next() < 0.6) ducks.push({ x: p.x - 0.8, y: p.y, h: 0, male: !ducks[0].male, chick: false }); // a pair
        for (let c = 0; c < chicks; c++) ducks.push({ x: p.x - 0.6 * (c + 1), y: p.y, h: 0, male: false, chick: true });
        this.families.push({ pond: pi, ducks, tx: p.x, ty: p.y, pause: r.range(0, 4), speed: r.range(0.25, 0.45) });
      }
    });
    // ---------------- walkers on the verges of the park roads (both sides)
    for (const rd of inp.roads) {
      if (rd.hidden || rd.cls !== 'park' || rd.center.length < 3) continue;
      for (const side of [1, -1]) {
        const pts: V2[] = [];
        for (let i = 0; i < rd.center.length; i++) {
          const a = rd.center[Math.max(0, i - 1)], b = rd.center[Math.min(rd.center.length - 1, i + 1)];
          const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
          const off = (rd.halfWidth[i] ?? rd.halfWidth[0] ?? 2.8) + 1.5;
          const p = { x: rd.center[i].x - (dy / l) * off * side, y: rd.center[i].y + (dx / l) * off * side };
          if (inp.water.some((w) => pointInPolygon(p, w)) || inp.avoid?.(p)) { this.addPath(pts.splice(0)); continue; }
          pts.push(p);
        }
        this.addPath(pts);
      }
    }
    const total = Math.min(70, Math.round(this.paths.reduce((a, p) => a + p.len, 0) / 160));
    for (let i = 0; i < total && this.paths.length; i++) {
      const path = this.weightedPath();
      const roll = r.next();
      const kind: Walker['kind'] = roll < 0.42 ? 'single' : roll < 0.7 ? 'couple' : roll < 0.86 ? 'dog' : 'family';
      const n = kind === 'couple' ? 2 : kind === 'family' ? 3 : 1;
      this.walkers.push({ kind, path, s: r.range(0, this.paths[path].len), dir: r.next() < 0.5 ? 1 : -1, speed: kind === 'family' ? r.range(0.75, 0.95) : r.range(1.0, 1.35), colors: Array.from({ length: n }, () => r.pick(CLOTHES)), seed: r.int(0, 1e6), pause: 0, x: 0, y: 0, h: 0 });
    }
    // ---------------- children at playgrounds and sports fields
    for (const f of inp.facilities) {
      if (!PLAY.has(f.key)) continue;
      const n = f.key === 'S' ? r.int(2, 4) : r.int(1, 3);
      for (let k = 0; k < n; k++) {
        const a = r.range(0, 6.28), d = r.range(0, 4);
        const x = f.pos.x + Math.cos(a) * d, y = f.pos.y + Math.sin(a) * d;
        if (inp.water.some((w) => pointInPolygon({ x, y }, w))) continue;
        this.kids.push({ cx: f.pos.x, cy: f.pos.y, r: f.key === 'S' ? 6 : 9, x, y, tx: x, ty: y, speed: r.range(1.2, 2.2), color: r.pick(CLOTHES), seed: r.int(0, 1e6), pause: r.range(0, 3), h: 0 });
      }
    }
  }
  get counts() { return { ducks: this.families.reduce((a, f) => a + f.ducks.length, 0), walkers: this.walkers.length, kids: this.kids.length }; }

  private addPath(pts: V2[]) {
    if (pts.length < 2) return;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    if (cum[cum.length - 1] < 25) return;
    this.paths.push({ pts, cum, len: cum[cum.length - 1] });
  }
  private weightedPath() {
    const tot = this.paths.reduce((a, p) => a + p.len, 0);
    let x = this.rand.next() * tot;
    for (let i = 0; i < this.paths.length; i++) { x -= this.paths[i].len; if (x <= 0) return i; }
    return this.paths.length - 1;
  }
  private at(p: Path, s: number) {
    s = Math.max(0, Math.min(p.len, s));
    let i = 1; while (i < p.cum.length - 1 && p.cum[i] < s) i++;
    const a = p.pts[i - 1], b = p.pts[i], k = (s - p.cum[i - 1]) / Math.max(1e-6, p.cum[i] - p.cum[i - 1]);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, h: Math.atan2(b.y - a.y, b.x - a.x) };
  }
  /** random point well inside pond pi (at least ~1.5 m from the bank) */
  private inside(pi: number): V2 | null {
    const w = this.ponds[pi];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of w) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    for (let i = 0; i < 40; i++) {
      const p = { x: this.rand.range(x0, x1), y: this.rand.range(y0, y1) };
      if ([[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]].every(([dx, dy]) => pointInPolygon({ x: p.x + dx, y: p.y + dy }, w))) return p;
    }
    return null;
  }

  /** advance; night = fewer people about */
  step(now: number) {
    const dt = Math.min(0.1, Math.max(0, now - this.last)); this.last = now;
    if (!dt) return;
    const r = this.rand;
    for (const f of this.families) {
      const lead = f.ducks[0];
      if (f.pause > 0) f.pause -= dt;
      else {
        const dx = f.tx - lead.x, dy = f.ty - lead.y, d = Math.hypot(dx, dy);
        if (d < 0.4) { f.pause = r.range(2, 9); const p = this.inside(f.pond); if (p) { f.tx = p.x; f.ty = p.y; } }
        else {
          const want = Math.atan2(dy, dx);
          let dh = want - lead.h; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
          lead.h += Math.max(-1.2 * dt, Math.min(1.2 * dt, dh));
          const nx = lead.x + Math.cos(lead.h) * f.speed * dt, ny = lead.y + Math.sin(lead.h) * f.speed * dt;
          if (pointInPolygon({ x: nx, y: ny }, this.ponds[f.pond])) { lead.x = nx; lead.y = ny; } else { const p = this.inside(f.pond); if (p) { f.tx = p.x; f.ty = p.y; } }
        }
      }
      // the others follow in a line
      for (let i = 1; i < f.ducks.length; i++) {
        const a = f.ducks[i - 1], b = f.ducks[i], gap = b.chick || a.chick ? 1.6 : 2.2;
        const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
        if (d > gap) { const k = (d - gap) / d; b.x += dx * k * Math.min(1, dt * 3); b.y += dy * k * Math.min(1, dt * 3); b.h = Math.atan2(dy, dx); }
      }
    }
    for (const w of this.walkers) {
      const p = this.paths[w.path];
      if (w.pause > 0) w.pause -= dt;
      else {
        w.s += w.dir * w.speed * dt;
        if (w.s <= 0 || w.s >= p.len) { w.dir = w.dir === 1 ? -1 : 1; w.s = Math.max(0, Math.min(p.len, w.s)); w.pause = r.range(1, 4); }
        else if (r.next() < dt * 0.01) w.pause = r.range(2, 6); // stop for a chat or a look around
      }
      const q = this.at(p, w.s); w.x = q.x; w.y = q.y; w.h = w.dir === 1 ? q.h : q.h + Math.PI;
    }
    for (const k of this.kids) {
      if (k.pause > 0) { k.pause -= dt; continue; }
      const dx = k.tx - k.x, dy = k.ty - k.y, d = Math.hypot(dx, dy);
      if (d < 0.3) { k.pause = r.range(0.5, 3); const a = r.range(0, 6.28), rr = r.range(0, k.r); k.tx = k.cx + Math.cos(a) * rr; k.ty = k.cy + Math.sin(a) * rr; continue; }
      k.h = Math.atan2(dy, dx); k.x += (dx / d) * k.speed * dt; k.y += (dy / d) * k.speed * dt;
    }
  }

  /** drawables for this frame (depth-sorted with everything else) */
  objects(now: number, night: boolean): Drawable[] {
    // every figure is a cached image (see pixi.ts cacheKey): heading, walk phase and ripples in a few fixed steps
    const out: Drawable[] = [];
    this.families.forEach((f, fi) => f.ducks.forEach((d, di) => {
      const seed = fi * 7 + di;
      const hb = step(d.h, 32), rip = Math.floor(frac(now * 0.6 + seed * 0.37) * 6), bob = Math.floor(frac((now * 2.2 + seed) / (2 * Math.PI)) * 4);
      const dq: Duck = { ...d, h: (hb / 32) * 2 * Math.PI };
      out.push({ key: d.y * cam.CE - 0.5, id: `amb:d${fi}:${di}`, at: { x: d.x, y: d.y }, box: [2.4, 2.2], cacheKey: `duck|${DUCK}|${d.male ? 1 : 0}|${d.chick ? 1 : 0}|${hb}|${rip}|${bob}`, draw: (c) => drawDuck(c, dq, 0, seed, { rip: (rip + 0.5) / 6, bob: Math.sin(((bob + 0.5) / 4) * 2 * Math.PI) }) });
    }));
    const people = night ? this.walkers.filter((_, i) => i % 5 === 0) : this.walkers;
    people.forEach((w) => {
      const side = { x: -Math.sin(w.h), y: Math.cos(w.h) }, fwd = { x: Math.cos(w.h), y: Math.sin(w.h) };
      const walking = w.pause <= 0;
      const members: { x: number; y: number; color: string; scale: number }[] = w.colors.map((col, i) => {
        const o = (w.kind === 'couple' ? (i ? 0.33 : -0.33) : w.kind === 'family' ? [-0.4, 0.4, 0][i] : 0) * LIFE;
        const back = (w.kind === 'family' && i === 2 ? -0.55 : 0) * LIFE;
        return { x: w.x + side.x * o + fwd.x * back, y: w.y + side.y * o + fwd.y * back, color: col, scale: w.kind === 'family' && i === 2 ? 0.62 : 1 };
      });
      members.forEach((m, i) => out.push(person(`amb:w${w.seed}:${i}`, m.x, m.y, w.h, walking, m.color, now, w.seed + i, m.scale * LIFE)));
      if (w.kind === 'dog') {
        const hb = step(w.h, 32), hq = (hb / 32) * 2 * Math.PI;
        const fq = { x: Math.cos(hq), y: Math.sin(hq) }, sq = { x: -Math.sin(hq), y: Math.cos(hq) };
        const off = { x: (fq.x * 1.1 + sq.x * 0.4) * LIFE, y: (fq.y * 1.1 + sq.y * 0.4) * LIFE };
        const dx = w.x + off.x, dy = w.y + off.y;
        const ph = walking ? Math.floor(frac((now * 10 + w.seed) / (2 * Math.PI)) * 6) : -1;
        const tq = ph < 0 ? 0 : (((ph + 0.5) / 6) * 2 * Math.PI - w.seed) / 10;
        out.push({ key: dy * cam.CE, id: `amb:dog${w.seed}`, at: { x: dx, y: dy }, box: [1.6, 2.0], cacheKey: `dog|${LIFE}|${w.seed % 4}|${hb}|${ph}`, draw: (c) => drawDog(c, dx, dy, hq, walking, tq, w.seed, { x: dx - off.x, y: dy - off.y }) });
      }
    });
    (night ? [] : this.kids).forEach((k, i) => out.push(person(`amb:k${i}`, k.x, k.y, k.h, k.pause <= 0, k.color, now * 1.3, k.seed, 0.62 * LIFE)));
    return out;
  }
}

const frac = (x: number) => x - Math.floor(x);
/** angle in n steps (0..n-1) */
const step = (h: number, n: number) => ((Math.round((h / (2 * Math.PI)) * n) % n) + n) % n;
/** a person as a cached image: facing left/right, walk cycle in 8 steps */
function person(id: string, x: number, y: number, h: number, walking: boolean, color: string, t: number, seed: number, scale: number): Drawable {
  const facing = Math.cos(h) >= 0 ? 1 : -1;
  const ph = walking ? Math.floor(frac((t * 7 + seed) / (2 * Math.PI)) * 8) : -1;
  const tq = ph < 0 ? 0 : (((ph + 0.5) / 8) * 2 * Math.PI - seed) / 7;
  return {
    key: y * cam.CE, id, at: { x, y }, box: [0.9 * scale, 2.25 * scale],
    cacheKey: `ap|${color}|${seed % 15}|${(seed >> 3) % 5}|${facing}|${ph}|${scale.toFixed(2)}`,
    draw: (c) => drawPerson(c, x, y, facing > 0 ? 0 : Math.PI, ph >= 0, color, tq, seed, scale),
  };
}

function drawPerson(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, walking: boolean, color: string, t: number, seed: number, scale: number) {
  const g = P(x, y);
  ctx.save();
  if (scale !== 1) { ctx.translate(g.x, g.y); ctx.scale(scale, scale); ctx.translate(-g.x, -g.y); }
  drawPedestrian(ctx, { id: '', x, y, h, walking, color }, t, seed);
  ctx.restore();
}

function drawDuck(ctx: CanvasRenderingContext2D, d: Duck, t: number, seed: number, q?: { rip: number; bob: number }) {
  const s = cam.S * (d.chick ? DUCK / 2 : DUCK); // ducks drawn larger than life so they read on the projection (seen from far away)
  const g = Pv({ x: d.x, y: d.y, z: 0 });
  const bob = (q ? q.bob : Math.sin(t * 2.2 + seed)) * 0.03 * s;
  const fx = Math.cos(d.h), fy = Math.sin(d.h) * cam.SE;
  const ang = Math.atan2(fy, fx);
  const flip = Math.cos(ang) < 0 ? -1 : 1; // keep the duck upright when it swims to the left
  // ripple rings behind the duck
  ctx.lineWidth = Math.max(0.6, 0.04 * s);
  for (const off of [0, 0.5]) {
    const rp = q ? frac(q.rip + off) : ((t * 0.6 + seed * 0.37 + off) % 1);
    ctx.strokeStyle = `rgba(230,245,245,${(0.35 * (1 - rp)).toFixed(3)})`;
    ctx.beginPath(); ctx.ellipse(g.x - fx * 0.25 * s, g.y - fy * 0.25 * s, (0.3 + rp * 0.55) * s, (0.3 + rp * 0.55) * s * cam.SE, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.save();
  ctx.translate(g.x, g.y - 0.1 * s + bob);
  ctx.rotate(ang); ctx.scale(1, flip);
  const u = s; // 1 unit = body length / 0.8
  // body shadow on the water
  ctx.fillStyle = 'rgba(10,40,50,0.35)'; ctx.beginPath(); ctx.ellipse(0, 0.1 * u, 0.4 * u, 0.15 * u, 0, 0, Math.PI * 2); ctx.fill();
  if (d.chick) {
    ctx.fillStyle = '#d9b24a'; ctx.beginPath(); ctx.ellipse(0, 0, 0.3 * u, 0.17 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#9a7a2e'; ctx.beginPath(); ctx.ellipse(-0.06 * u, 0.02 * u, 0.16 * u, 0.09 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8cc68'; ctx.beginPath(); ctx.arc(0.24 * u, -0.1 * u, 0.12 * u, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4a3a1a'; ctx.beginPath(); ctx.arc(0.28 * u, -0.13 * u, 0.025 * u, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e09a2a'; ctx.beginPath(); ctx.moveTo(0.34 * u, -0.1 * u); ctx.lineTo(0.43 * u, -0.08 * u); ctx.lineTo(0.34 * u, -0.06 * u); ctx.fill();
    ctx.restore(); return;
  }
  const body = d.male ? '#9a9c94' : '#8f6e47', wing = d.male ? '#6f6a60' : '#6e5232', dark = d.male ? '#3a2e26' : '#5a4228';
  // tail (pointy, up)
  ctx.fillStyle = d.male ? '#2a2a28' : dark;
  ctx.beginPath(); ctx.moveTo(-0.32 * u, -0.02 * u); ctx.lineTo(-0.5 * u, -0.12 * u); ctx.lineTo(-0.36 * u, 0.06 * u); ctx.fill();
  if (d.male) { ctx.strokeStyle = '#1c1c1a'; ctx.lineWidth = 0.025 * u; ctx.beginPath(); ctx.arc(-0.44 * u, -0.17 * u, 0.04 * u, 0, Math.PI * 1.5); ctx.stroke(); } // curled tail feather
  // body: teardrop, lighter on top
  const bg = ctx.createLinearGradient(0, -0.2 * u, 0, 0.16 * u); bg.addColorStop(0, d.male ? '#c4c6bd' : '#a98559'); bg.addColorStop(1, body);
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.moveTo(-0.38 * u, 0); ctx.quadraticCurveTo(-0.3 * u, -0.2 * u, 0.05 * u, -0.19 * u); ctx.quadraticCurveTo(0.32 * u, -0.17 * u, 0.33 * u, 0.02 * u); ctx.quadraticCurveTo(0.2 * u, 0.15 * u, -0.05 * u, 0.14 * u); ctx.quadraticCurveTo(-0.3 * u, 0.12 * u, -0.38 * u, 0); ctx.fill();
  if (d.male) { ctx.fillStyle = '#6b4a35'; ctx.beginPath(); ctx.ellipse(0.22 * u, -0.04 * u, 0.12 * u, 0.12 * u, 0, 0, Math.PI * 2); ctx.fill(); } // chestnut breast
  else { ctx.strokeStyle = 'rgba(60,40,20,0.5)'; ctx.lineWidth = 0.02 * u; for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.arc(k * 0.09 * u, 0, 0.06 * u, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); } } // speckled feathers
  // folded wing with the blue speculum and a white edge
  ctx.fillStyle = wing;
  ctx.beginPath(); ctx.moveTo(-0.3 * u, -0.06 * u); ctx.quadraticCurveTo(-0.05 * u, -0.17 * u, 0.15 * u, -0.08 * u); ctx.quadraticCurveTo(-0.02 * u, 0.04 * u, -0.3 * u, -0.06 * u); ctx.fill();
  ctx.fillStyle = '#2f54b8'; ctx.fillRect(-0.18 * u, -0.1 * u, 0.12 * u, 0.04 * u);
  ctx.fillStyle = '#f2f2ee'; ctx.fillRect(-0.18 * u, -0.06 * u, 0.12 * u, 0.012 * u);
  // neck and head
  ctx.fillStyle = d.male ? '#1f6b3a' : '#7d5f3c';
  ctx.beginPath(); ctx.moveTo(0.18 * u, -0.12 * u); ctx.quadraticCurveTo(0.24 * u, -0.3 * u, 0.3 * u, -0.34 * u); ctx.lineTo(0.36 * u, -0.26 * u); ctx.quadraticCurveTo(0.3 * u, -0.16 * u, 0.3 * u, -0.06 * u); ctx.fill();
  const hg = ctx.createRadialGradient(0.3 * u, -0.42 * u, 0.01 * u, 0.32 * u, -0.38 * u, 0.13 * u);
  hg.addColorStop(0, d.male ? '#3fa864' : '#9a7a52'); hg.addColorStop(1, d.male ? '#155a2f' : '#6a4d2e');
  ctx.fillStyle = hg; ctx.beginPath(); ctx.ellipse(0.33 * u, -0.38 * u, 0.12 * u, 0.1 * u, 0.2, 0, Math.PI * 2); ctx.fill();
  if (d.male) { ctx.strokeStyle = '#f5f5f0'; ctx.lineWidth = 0.03 * u; ctx.beginPath(); ctx.moveTo(0.22 * u, -0.22 * u); ctx.lineTo(0.33 * u, -0.25 * u); ctx.stroke(); } // white collar
  else { ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 0.018 * u; ctx.beginPath(); ctx.moveTo(0.26 * u, -0.39 * u); ctx.lineTo(0.42 * u, -0.38 * u); ctx.stroke(); } // eye stripe
  // eye with a tiny highlight
  ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(0.37 * u, -0.41 * u, 0.022 * u, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0.374 * u, -0.416 * u, 0.007 * u, 0, Math.PI * 2); ctx.fill();
  // bill: yellow (drake) or orange with a dark saddle (duck)
  ctx.fillStyle = d.male ? '#e8c12a' : '#d98a2a';
  ctx.beginPath(); ctx.moveTo(0.42 * u, -0.4 * u); ctx.quadraticCurveTo(0.56 * u, -0.38 * u, 0.58 * u, -0.33 * u); ctx.quadraticCurveTo(0.5 * u, -0.32 * u, 0.42 * u, -0.34 * u); ctx.fill();
  if (!d.male) { ctx.fillStyle = 'rgba(60,40,20,0.6)'; ctx.fillRect(0.46 * u, -0.385 * u, 0.06 * u, 0.02 * u); }
  ctx.restore();
}

function drawDog(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, walking: boolean, t: number, seed: number, owner: V2) {
  const s = cam.S * LIFE;
  const g = P(x, y);
  const fx = Math.cos(h), fy = Math.sin(h) * cam.SE;
  const col = ['#7a5230', '#2b2b2b', '#c8a26b', '#e9e4d8'][seed % 4];
  // lead to the owner's hand
  const hand = Pv({ x: owner.x, y: owner.y, z: 0.95 * LIFE });
  ctx.strokeStyle = 'rgba(40,30,20,0.7)'; ctx.lineWidth = Math.max(1, 0.04 * s);
  ctx.beginPath(); ctx.moveTo(hand.x, hand.y); ctx.lineTo(g.x + fx * 0.25 * s, g.y - 0.45 * s); ctx.stroke();
  ctx.fillStyle = 'rgba(20,30,18,0.25)'; ctx.beginPath(); ctx.ellipse(g.x, g.y, 0.4 * s, 0.15 * s, 0, 0, Math.PI * 2); ctx.fill();
  const ph = walking ? Math.sin(t * 10 + seed) * 0.08 * s : 0;
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.2, 0.08 * s); ctx.lineCap = 'round';
  for (const k of [-0.22, 0.22]) { ctx.beginPath(); ctx.moveTo(g.x + fx * k * s, g.y + fy * k * s - 0.3 * s); ctx.lineTo(g.x + fx * k * s + (k > 0 ? ph : -ph), g.y + fy * k * s); ctx.stroke(); }
  ctx.save(); ctx.translate(g.x, g.y - 0.38 * s); ctx.rotate(Math.atan2(fy, fx));
  ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, 0, 0.32 * s, 0.13 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(0.34 * s, -0.08 * s, 0.11 * s, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(-0.3 * s, 0); ctx.lineTo(-0.45 * s, -0.12 * s + Math.sin(t * 12 + seed) * 0.04 * s); ctx.stroke();
  ctx.restore();
}
