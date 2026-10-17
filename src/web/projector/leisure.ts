// Boats on the canals and golf carts on the golf course (phase 4). Decoration on the projector, like the ducks and
// walkers in ambient.ts: seeded, client-side, no server traffic, never near the barriers. Both move over a graph that
// build_map.py derives from the plan (park.json terrain.canals / terrain.golfPaths: centre lines of the canals and of
// the golf paths).
//
// Rules on the water (simple, readable from across the room):
//  - keep right: a boat sails right of the canal centre line (narrower canals: closer to the centre), so oncoming
//    boats pass port to port;
//  - keep distance: a boat slows down behind a slower boat in the same direction and stops 7 m behind it;
//  - junctions one at a time: before a junction a boat waits until the junction is free (first come, first served);
//  - dead ends: the boat moors for a while (at a jetty), then turns around;
//  - speed: sloep 6 km/h, kano 3.5 km/h, SUP 2.5 km/h.
// Golf carts drive the golf paths at 13 km/h with the same distance and junction rules; at a dead end (a tee or a
// green) the two golfers get out, play, and drive on.
// Every figure is a cached image (pixi.ts cacheKey): heading in 64 steps, wake / paddle phase in 4 steps.
import { cam, P, Pv, V2, V3 } from './proj.ts';
import { rng } from '../../shared/geom.ts';
import { drawPedestrian, drawVehicle } from './vehicles.ts';
import type { Drawable } from './pixi.ts';

export interface GraphJson { nodes: number[][]; edges: { a: number; b: number; pts: number[][]; w: number[] }[] }
interface Edge { a: number; b: number; pts: V2[]; cum: number[]; len: number; half: number[] }
interface Graph { nodes: V2[]; edges: Edge[]; adj: number[][]; /** total length of the connected part each edge belongs to */ reach: number[] }
type Kind = 'sloep' | 'kano' | 'sup' | 'kar';
interface Mover {
  kind: Kind; id: number; e: number; dir: 1 | -1; s: number; v: number; vmax: number; len: number; beam: number;
  pause: number; holds: number; color: string; crew: string[]; x: number; y: number; h: number; parked: boolean;
}

const BOAT_COLORS = ['#f4f4f0', '#1f2a38', '#f4f4f0', '#2f5f7a', '#f4f4f0', '#5a4a3a'];
const KANO_COLORS = ['#d9442e', '#f2b41b', '#2e8b57', '#2f78b8'];
const CLOTHES = ['#d9534f', '#3a6ea5', '#f0ad4e', '#5cb85c', '#f7f7f2', '#7b5ea7', '#e88aa8', '#46a5a0', '#c9a227', '#2f6f8f'];
const HEAD = 64;
/** boats are drawn larger than life in the overview (readable on the projection), real size in a close-up */
let BOAT = 1.5;
export function setLeisureScale(zoom: number) { BOAT = zoom >= 2 ? 1 : 1.5; }
const frac = (x: number) => x - Math.floor(x);
const step = (h: number, n: number) => ((Math.round((h / (2 * Math.PI)) * n) % n) + n) % n;

function buildGraph(g: GraphJson | undefined, toWorld: (p: number[]) => V2, k: number): Graph | null {
  if (!g || !g.edges.length) return null;
  const nodes = g.nodes.map(toWorld);
  const edges: Edge[] = [];
  for (const e of g.edges) {
    const pts = e.pts.map(toWorld);
    if (pts.length < 2) continue;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    if (cum[cum.length - 1] < 4) continue;
    edges.push({ a: e.a, b: e.b, pts, cum, len: cum[cum.length - 1], half: e.w.map((w) => w * k) });
  }
  const adj: number[][] = nodes.map(() => []);
  edges.forEach((e, i) => { adj[e.a].push(i); if (e.b !== e.a) adj[e.b].push(i); });
  // connected parts: movers only start on parts long enough to wander about
  const comp = new Array(edges.length).fill(-1), tot: number[] = [];
  edges.forEach((_, i0) => {
    if (comp[i0] >= 0) return;
    const c = tot.length; tot.push(0); const st = [i0]; comp[i0] = c;
    while (st.length) { const i = st.pop()!; tot[c] += edges[i].len; for (const n of [edges[i].a, edges[i].b]) for (const j of adj[n]) if (comp[j] < 0) { comp[j] = c; st.push(j); } }
  });
  return { nodes, edges, adj, reach: comp.map((c) => tot[c]) };
}
function sample(e: Edge, s: number) {
  s = Math.max(0, Math.min(e.len, s));
  let i = 1; while (i < e.cum.length - 1 && e.cum[i] < s) i++;
  const a = e.pts[i - 1], b = e.pts[i], t = (s - e.cum[i - 1]) / Math.max(1e-6, e.cum[i] - e.cum[i - 1]);
  const half = e.half[i - 1] + (e.half[Math.min(e.half.length - 1, i)] - e.half[i - 1]) * t;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, h: Math.atan2(b.y - a.y, b.x - a.x), half };
}

export class Leisure {
  private water: Graph | null;
  private golf: Graph | null;
  private boats: Mover[] = [];
  private carts: Mover[] = [];
  /** junction mutex: node -> mover id */
  private busy = new Map<string, number>();
  private rand: ReturnType<typeof rng>;
  private last = 0;

  constructor(inp: { canals?: GraphJson; golfPaths?: GraphJson; toWorld: (p: number[]) => V2; metersPerPt: number }, seed = 23) {
    this.rand = rng(seed);
    const r = this.rand;
    this.water = buildGraph(inp.canals, inp.toWorld, inp.metersPerPt);
    this.golf = buildGraph(inp.golfPaths, inp.toWorld, inp.metersPerPt);
    let id = 0;
    const place = (g: Graph, kind: Kind, n: number, list: Mover[]) => {
      const long = g.edges.map((e, i) => ({ e, i })).filter((x) => x.e.len > 14 && g.reach[x.i] > (kind === 'kar' ? 250 : 150));
      for (let k = 0; k < n && long.length; k++) {
        const { e, i } = long[r.int(0, long.length - 1)];
        const spec = kind === 'sloep' ? { vmax: 1.65, len: 5.6, beam: 2.1 } : kind === 'kano' ? { vmax: 1.0, len: 4.4, beam: 0.8 } : kind === 'sup' ? { vmax: 0.7, len: 3.2, beam: 0.8 } : { vmax: 3.6, len: 2.6, beam: 1.3 };
        const s = r.range(5, e.len - 5);
        if (list.some((m) => m.e === i && Math.abs(m.s - s) < 12)) continue;
        const crewN = kind === 'sloep' ? r.int(2, 5) : kind === 'kano' ? r.int(1, 2) : kind === 'sup' ? 1 : 2;
        list.push({ kind, id: id++, e: i, dir: r.next() < 0.5 ? 1 : -1, s, v: 0, ...spec, pause: r.range(0, 8), holds: -1,
          color: kind === 'sloep' ? r.pick(BOAT_COLORS) : kind === 'kar' ? r.pick(['#f2f4f3', '#e9ecea', '#1f2a38']) : r.pick(KANO_COLORS),
          crew: Array.from({ length: crewN }, () => r.pick(CLOTHES)), x: 0, y: 0, h: 0, parked: false });
      }
    };
    if (this.water) { place(this.water, 'sloep', 11, this.boats); place(this.water, 'kano', 6, this.boats); place(this.water, 'sup', 3, this.boats); }
    if (this.golf) place(this.golf, 'kar', 9, this.carts);
    for (const m of [...this.boats, ...this.carts]) this.pose(m);
  }
  get counts() { return { boats: this.boats.length, carts: this.carts.length }; }

  private graphOf(m: Mover) { return (m.kind === 'kar' ? this.golf : this.water)!; }
  /** world pose: on the centre line, shifted to the right of the direction of travel ("keep right") */
  private pose(m: Mover) {
    const g = this.graphOf(m), e = g.edges[m.e];
    const q = sample(e, m.s);
    const h = m.dir === 1 ? q.h : q.h + Math.PI;
    const room = Math.max(0, q.half - m.beam / 2 - 0.6);
    // keep right, but stay clear of the jetties along the banks (they reach ~2 m into the water)
    const off = m.kind === 'kar' ? 0 : Math.min(room, Math.max(0, q.half - 2.6 - m.beam / 2), m.kind === 'sloep' ? Math.max(1.2, q.half * 0.3) : q.half * 0.4);
    m.x = q.x - Math.sin(h) * off; m.y = q.y + Math.cos(h) * off; m.h = h;
  }
  private endNode(m: Mover) { const e = this.graphOf(m).edges[m.e]; return m.dir === 1 ? e.b : e.a; }
  private toEnd(m: Mover) { const e = this.graphOf(m).edges[m.e]; return m.dir === 1 ? e.len - m.s : m.s; }

  step(now: number) {
    const dt = Math.min(0.1, Math.max(0, now - this.last)); this.last = now;
    if (!dt) return;
    for (const list of [this.boats, this.carts]) for (const m of list) this.move(m, list, dt);
  }

  private move(m: Mover, list: Mover[], dt: number) {
    const g = this.graphOf(m), r = this.rand;
    const tag = (n: number) => `${m.kind === 'kar' ? 'g' : 'w'}${n}`;
    if (m.pause > 0) { m.pause -= dt; m.v = 0; m.parked = m.pause > 2; if (m.pause <= 0) m.parked = false; return; }
    let want = m.vmax;
    // keep distance to the mover ahead on the same edge in the same direction (or on the next edge near the junction)
    for (const o of list) {
      if (o === m) continue;
      if (o.e === m.e && o.dir === m.dir) {
        const gap = (o.s - m.s) * m.dir - (o.len + m.len) / 2;
        if (gap > -0.5 && gap < 14) want = Math.min(want, gap < 7 ? 0 : o.v * 0.9 + (gap - 7) * 0.15);
      }
    }
    // junction one at a time
    const end = this.endNode(m), dEnd = this.toEnd(m);
    const holder = this.busy.get(tag(end));
    if (dEnd < 12 && g.adj[end].length >= 3) {
      if (holder === undefined) { this.busy.set(tag(end), m.id); m.holds = end; }
      else if (holder !== m.id) want = Math.min(want, dEnd < 8 ? 0 : 0.3);
    }
    // narrow canal or a bend at the end: slow down
    if (dEnd < 6) want = Math.min(want, m.vmax * 0.6);
    const acc = m.kind === 'kar' ? 1.6 : 0.35;
    m.v = want > m.v ? Math.min(want, m.v + acc * dt) : Math.max(want, m.v - acc * 2 * dt);
    m.s += m.dir * m.v * dt;
    const e = g.edges[m.e];
    if ((m.dir === 1 && m.s >= e.len) || (m.dir === -1 && m.s <= 0)) {
      // at a node: pick a next edge (no U-turn unless it is a dead end)
      const opts = g.adj[end].filter((i) => i !== m.e);
      if (!opts.length) {
        // dead end: moor at a jetty / play the hole, then turn around
        m.dir = m.dir === 1 ? -1 : 1; m.s = Math.max(0, Math.min(e.len, m.s));
        m.pause = m.kind === 'kar' ? r.range(25, 55) : r.range(18, 60);
      } else {
        const ni = opts[r.int(0, opts.length - 1)], ne = g.edges[ni];
        m.e = ni; m.dir = ne.a === end ? 1 : -1; m.s = m.dir === 1 ? 0 : ne.len;
      }
    }
    // release the junction once clear of it
    if (m.holds >= 0 && m.holds !== this.endNode(m)) {
      const ee = g.edges[m.e], from = m.dir === 1 ? ee.a : ee.b;
      if (from !== m.holds || (m.dir === 1 ? m.s : ee.len - m.s) > 8) { if (this.busy.get(tag(m.holds)) === m.id) this.busy.delete(tag(m.holds)); m.holds = -1; }
    }
    // now and then a boat moors at a jetty along the canal, a cart stops at a green
    if (r.next() < dt * (m.kind === 'kar' ? 0.006 : 0.004)) m.pause = m.kind === 'kar' ? r.range(20, 40) : r.range(15, 45);
    this.pose(m);
  }

  objects(now: number, night: boolean): Drawable[] {
    const out: Drawable[] = [];
    const boats = night ? this.boats.filter((b) => b.kind === 'sloep' && b.id % 4 === 0) : this.boats;
    for (const b of boats) {
      const hb = step(b.h, HEAD), wake = b.v > 0.15 ? Math.floor(frac(now * 0.8 + b.id * 0.31) * 4) : -1;
      const pad = b.kind === 'kano' && b.v > 0.15 ? Math.floor(frac(now * 0.9 + b.id * 0.17) * 4) : 0;
      const q = { ...b, h: (hb / HEAD) * 2 * Math.PI };
      out.push({ key: b.y * cam.CE - 0.3, id: `lz:b${b.id}`, at: { x: b.x, y: b.y }, box: [(b.len / 2 + 2.5) * BOAT, 2.4 * BOAT],
        cacheKey: `boat|${BOAT}|${b.kind}|${b.color}|${b.crew.join(',')}|${hb}|${wake}|${pad}`, draw: (c) => drawBoat(c, q, wake, pad) });
    }
    if (!night) for (const k of this.carts) {
      const hb = step(k.h, 128);
      const hq = (hb / 128) * 2 * Math.PI;
      out.push({ key: k.y * cam.CE, id: `lz:c${k.id}`, at: { x: k.x, y: k.y }, box: [(k.len / 2 + 1) * BOAT, 3 * BOAT],
        cacheKey: `gcart|${BOAT}|${k.color}|${hb}`,
        draw: (c) => scaled(c, k.x, k.y, () => drawVehicle(c, { id: `gc${k.id}`, kind: 'visitor', model: 'golfcart', color: k.color, x: k.x, y: k.y, h: hq, v: 0, brake: false, signal: 0, reverse: false, len: k.len, wid: k.beam, state: 'driving' }, 0)) });
      if (k.parked) {
        // the golfers stand next to the cart (one with a club raised)
        const sx = -Math.sin(k.h), sy = Math.cos(k.h);
        k.crew.forEach((col, i) => {
          const px = k.x + sx * (2.0 + i * 1.1) + Math.cos(k.h) * (i ? 0.8 : -0.4), py = k.y + sy * (2.0 + i * 1.1) + Math.sin(k.h) * (i ? 0.8 : -0.4);
          const facing = i ? Math.PI : 0, seed = k.id * 13 + i;
          out.push({ key: py * cam.CE, id: `lz:g${k.id}:${i}`, at: { x: px, y: py }, box: [1.4, 3.2], cacheKey: `golfer|${BOAT}|${col}|${seed % 15}|${i}`,
            draw: (c) => scaled(c, px, py, () => drawGolfer(c, px, py, facing, col, seed, i === 0)) });
        });
      }
    }
    return out;
  }
}

/** sloep (open electric boat with a teak deck and benches), kano or SUP board, with its wake */
function drawBoat(ctx: CanvasRenderingContext2D, b: Mover, wake: number, pad: number) {
  const g0 = P(b.x, b.y);
  ctx.save(); ctx.translate(g0.x, g0.y); ctx.scale(BOAT, BOAT); ctx.translate(-g0.x, -g0.y);
  try { drawBoatBody(ctx, b, wake, pad); } finally { ctx.restore(); }
}
function drawBoatBody(ctx: CanvasRenderingContext2D, b: Mover, wake: number, pad: number) {
  const s = cam.S;
  const fx = Math.cos(b.h), fy = Math.sin(b.h), rx = -fy, ry = fx;
  const L = (a: number, w: number, z: number): V3 => ({ x: b.x + fx * a + rx * w, y: b.y + fy * a + ry * w, z });
  const poly = (pts: V3[]) => { ctx.beginPath(); pts.forEach((p, i) => { const q = Pv(p); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.closePath(); };
  const Lh = b.len / 2, Wh = b.beam / 2;
  // wake: a soft V behind the boat and ripples along the hull
  if (wake >= 0) {
    const ph = (wake + 0.5) / 4;
    ctx.lineWidth = Math.max(0.8, 0.12 * s); ctx.lineCap = 'round';
    for (const k of [0, 0.5]) {
      const t = frac(ph + k), back = Lh + t * 6, spread = Wh + t * 2.2;
      ctx.strokeStyle = `rgba(235,248,250,${(0.55 * (1 - t)).toFixed(3)})`;
      for (const side of [1, -1]) {
        const a = Pv(L(-Lh + 0.3, side * Wh * 0.8, 0)), c = Pv(L(-back, side * spread, 0));
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
      }
    }
  }
  // hull outline: pointed bow, rounded stern
  const hull = (z: number, k = 1): V3[] => {
    const pts: V3[] = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; const a = Lh - t * b.len; const w = (t < 0.35 ? Math.sin((t / 0.35) * Math.PI / 2) : t > 0.9 ? 0.85 + 0.15 * Math.cos(((t - 0.9) / 0.1) * Math.PI / 2) : 1) * Wh * k; pts.push(L(a, w, z)); }
    for (let i = 10; i >= 0; i--) { const p = pts[i]; const a = (p.x - b.x) * fx + (p.y - b.y) * fy; const w = (p.x - b.x) * rx + (p.y - b.y) * ry; pts.push(L(a, -w, z)); }
    return pts;
  };
  // shadow under water line
  ctx.fillStyle = 'rgba(10,40,50,0.32)'; poly(hull(-0.05, 1.08)); ctx.fill();
  if (b.kind === 'sup') {
    ctx.fillStyle = b.color; poly(hull(0.1, 0.9)); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = Math.max(0.6, 0.04 * s); ctx.stroke();
    const g = P(b.x, b.y);
    ctx.save(); ctx.translate(0, -0.1 * s); drawPedestrian(ctx, { id: '', x: b.x, y: b.y, h: b.h, walking: false, color: b.crew[0] }, 0, b.id); ctx.restore();
    // paddle
    const p0 = Pv(L(0.3, Wh + 0.3, 1.5)), p1 = Pv(L(0.6, Wh + 0.45, -0.1));
    ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = Math.max(0.8, 0.05 * s); ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke(); void g;
    return;
  }
  const zTop = b.kind === 'sloep' ? 0.62 : 0.32;
  // hull side (darker) and top (sheer line)
  ctx.fillStyle = b.kind === 'sloep' ? (b.color === '#f4f4f0' ? '#d8d8d2' : b.color) : b.color;
  poly(hull(0)); ctx.fill();
  const top = hull(zTop);
  ctx.fillStyle = b.kind === 'sloep' ? (b.color === '#1f2a38' ? '#24324a' : '#f6f6f2') : b.color;
  poly(top); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = Math.max(0.6, 0.04 * s); ctx.stroke();
  if (b.kind === 'sloep') {
    // teak deck with benches and the crew
    ctx.fillStyle = '#b48d63'; poly(hull(zTop + 0.01, 0.78)); ctx.fill();
    ctx.strokeStyle = 'rgba(90,60,35,0.45)'; ctx.lineWidth = Math.max(0.5, 0.025 * s);
    for (let a = -Lh + 0.6; a < Lh - 1.2; a += 0.35) { const p = Pv(L(a, -Wh * 0.7, zTop + 0.02)), q = Pv(L(a, Wh * 0.7, zTop + 0.02)); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
    ctx.fillStyle = '#e9e4da'; poly([L(-Lh + 0.5, -Wh * 0.72, zTop + 0.4), L(-Lh + 1.5, -Wh * 0.72, zTop + 0.4), L(-Lh + 1.5, Wh * 0.72, zTop + 0.4), L(-Lh + 0.5, Wh * 0.72, zTop + 0.4)]); ctx.fill(); // aft bench
    b.crew.forEach((col, i) => {
      const a = -Lh + 1.0 + (i % 2) * 0.1 + Math.floor(i / 2) * 1.4, w = (i % 2 ? 1 : -1) * Wh * 0.42;
      const body = Pv(L(a, w, zTop + 0.75)), head = Pv(L(a, w, zTop + 1.15));
      ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(body.x, body.y, 0.24 * s, 0.3 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ['#e7c3a0', '#d7a97f', '#b07a52', '#8a5a3a', '#f0d0b0'][(b.id + i) % 5]; ctx.beginPath(); ctx.arc(head.x, head.y, 0.14 * s, 0, Math.PI * 2); ctx.fill();
    });
    // little electric outboard
    const ob = Pv(L(-Lh - 0.15, 0, zTop + 0.2)); ctx.fillStyle = '#2b2f33'; ctx.fillRect(ob.x - 0.12 * s, ob.y - 0.25 * s, 0.24 * s, 0.35 * s);
  } else {
    // kano: open cockpit(s) and paddlers with a double paddle
    ctx.fillStyle = 'rgba(30,30,30,0.55)';
    const seats = b.crew.length === 2 ? [0.9, -0.9] : [0];
    seats.forEach((a, i) => {
      poly([L(a + 0.45, -Wh * 0.5, zTop + 0.01), L(a + 0.45, Wh * 0.5, zTop + 0.01), L(a - 0.45, Wh * 0.5, zTop + 0.01), L(a - 0.45, -Wh * 0.5, zTop + 0.01)]); ctx.fill();
      const body = Pv(L(a, 0, zTop + 0.45)), head = Pv(L(a, 0, zTop + 0.85));
      ctx.fillStyle = b.crew[i]; ctx.beginPath(); ctx.ellipse(body.x, body.y, 0.2 * s, 0.26 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e7c3a0'; ctx.beginPath(); ctx.arc(head.x, head.y, 0.13 * s, 0, Math.PI * 2); ctx.fill();
      const tilt = Math.sin(((pad + 0.5) / 4) * 2 * Math.PI) * 0.5;
      const p0 = Pv(L(a + 0.2, -1.1, zTop + 0.55 + tilt)), p1 = Pv(L(a + 0.2, 1.1, zTop + 0.55 - tilt));
      ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = Math.max(0.8, 0.05 * s); ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      ctx.fillStyle = '#f2b41b'; for (const p of [p0, p1]) { ctx.beginPath(); ctx.ellipse(p.x, p.y, 0.14 * s, 0.07 * s, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = '#f2b41b';
    });
  }
}

/** draw at BOAT scale around a world point */
function scaled(ctx: CanvasRenderingContext2D, x: number, y: number, f: () => void) {
  const g = P(x, y);
  ctx.save(); ctx.translate(g.x, g.y); ctx.scale(BOAT, BOAT); ctx.translate(-g.x, -g.y);
  try { f(); } finally { ctx.restore(); }
}

/** a golfer standing next to the cart; the first one holds a club */
function drawGolfer(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, color: string, seed: number, club: boolean) {
  const s = cam.S;
  drawPedestrian(ctx, { id: '', x, y, h, walking: false, color }, 0, seed);
  if (club) {
    const hand = Pv({ x, y, z: 1.0 }), tip = Pv({ x: x + (Math.cos(h) >= 0 ? 0.9 : -0.9), y, z: 0.05 });
    ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = Math.max(0.8, 0.04 * s); ctx.beginPath(); ctx.moveTo(hand.x, hand.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(tip.x + 0.2 * s, tip.y, 0.06 * s, 0, Math.PI * 2); ctx.fill();
  }
}
