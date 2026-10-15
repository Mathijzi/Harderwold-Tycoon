// Planar geometry helpers. World units are metres; x = east, y = south (screen-like, y down).
// "Right of travel direction" for a unit tangent (tx, ty) is (-ty, tx).

export interface Vec { x: number; y: number }

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec): Vec => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; };
export const rightOf = (t: Vec): Vec => ({ x: -t.y, y: t.x });
export const lerpV = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export const angleWrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** Centripetal Catmull-Rom through the given points, returned as a dense point list (~step metres apart). */
export function catmullRom(points: Vec[], step = 0.5, alpha = 0.5): Vec[] {
  if (points.length < 2) return points.slice();
  const p = [points[0], ...points, points[points.length - 1]];
  // extrapolate end tangents so the curve does not curl
  p[0] = sub(mul(points[0], 2), points[1]);
  p[p.length - 1] = sub(mul(points[points.length - 1], 2), points[points.length - 2]);
  const out: Vec[] = [];
  for (let i = 1; i < p.length - 2; i++) {
    const p0 = p[i - 1], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2];
    const t0 = 0;
    const t1 = t0 + Math.pow(dist(p0, p1) || 1e-6, alpha);
    const t2 = t1 + Math.pow(dist(p1, p2) || 1e-6, alpha);
    const t3 = t2 + Math.pow(dist(p2, p3) || 1e-6, alpha);
    const n = Math.max(2, Math.ceil(dist(p1, p2) / step));
    for (let j = 0; j < n; j++) {
      const t = t1 + (t2 - t1) * (j / n);
      const A1 = add(mul(p0, (t1 - t) / (t1 - t0)), mul(p1, (t - t0) / (t1 - t0)));
      const A2 = add(mul(p1, (t2 - t) / (t2 - t1)), mul(p2, (t - t1) / (t2 - t1)));
      const A3 = add(mul(p2, (t3 - t) / (t3 - t2)), mul(p3, (t - t2) / (t3 - t2)));
      const B1 = add(mul(A1, (t2 - t) / (t2 - t0)), mul(A2, (t - t0) / (t2 - t0)));
      const B2 = add(mul(A2, (t3 - t) / (t3 - t1)), mul(A3, (t - t1) / (t3 - t1)));
      out.push(add(mul(B1, (t2 - t) / (t2 - t1)), mul(B2, (t - t1) / (t2 - t1))));
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

export function cubicBezier(p0: Vec, p1: Vec, p2: Vec, p3: Vec, step = 0.4): Vec[] {
  const approx = dist(p0, p1) + dist(p1, p2) + dist(p2, p3);
  const n = Math.max(6, Math.ceil(approx / step));
  const out: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
}

export function resample(pts: Vec[], step = 0.5): Vec[] {
  if (pts.length < 2) return pts.slice();
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  const n = Math.max(1, Math.round(total / step));
  const out: Vec[] = [];
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const s = (total * i) / n;
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    out.push(lerpV(pts[j], pts[j + 1], (s - cum[j]) / seg));
  }
  return out;
}

export interface Sample { x: number; y: number; tx: number; ty: number }

export class Polyline {
  readonly pts: Vec[];
  readonly cum: number[];
  readonly length: number;
  constructor(pts: Vec[]) {
    // drop duplicates
    const clean: Vec[] = [];
    for (const p of pts) if (!clean.length || dist(clean[clean.length - 1], p) > 1e-4) clean.push(p);
    if (clean.length === 1) clean.push({ x: clean[0].x + 1e-3, y: clean[0].y });
    this.pts = clean;
    this.cum = [0];
    for (let i = 1; i < clean.length; i++) this.cum.push(this.cum[i - 1] + dist(clean[i - 1], clean[i]));
    this.length = this.cum[this.cum.length - 1];
  }
  private seg(s: number): number {
    // binary search segment index i such that cum[i] <= s <= cum[i+1]
    let lo = 0, hi = this.cum.length - 2;
    if (s <= 0) return 0;
    if (s >= this.length) return hi;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid] <= s) lo = mid; else hi = mid - 1;
    }
    return lo;
  }
  sample(s: number): Sample {
    const i = this.seg(s);
    const a = this.pts[i], b = this.pts[i + 1];
    const L = this.cum[i + 1] - this.cum[i] || 1e-9;
    const t = clamp((s - this.cum[i]) / L, 0, 1);
    // extrapolate linearly beyond the ends
    const extra = s < 0 ? s : s > this.length ? s - this.length : 0;
    const tx = (b.x - a.x) / L, ty = (b.y - a.y) / L;
    const base = extra < 0 ? a : extra > 0 ? b : lerpV(a, b, t);
    return { x: base.x + tx * extra, y: base.y + ty * extra, tx, ty };
  }
  /** Smoothed tangent (averaged over +-w metres) to avoid heading jitter on dense polylines. */
  tangent(s: number, w = 0.8): Vec {
    const a = this.sample(Math.max(0, s - w)), b = this.sample(Math.min(this.length, s + w));
    const d = norm({ x: b.x - a.x, y: b.y - a.y });
    return d.x === 0 && d.y === 0 ? { x: a.tx, y: a.ty } : d;
  }
  /** Curvature magnitude (1/m) at s, via heading change over a window. */
  curvature(s: number, w = 1.5): number {
    const s0 = clamp(s - w, 0, this.length), s1 = clamp(s + w, 0, this.length);
    if (s1 - s0 < 0.2) return 0;
    const a = this.sample(s0), b = this.sample(s1);
    const h0 = Math.atan2(a.ty, a.tx), h1 = Math.atan2(b.ty, b.tx);
    return Math.abs(angleWrap(h1 - h0)) / (s1 - s0);
  }
  slice(s0: number, s1: number): Polyline {
    s0 = clamp(s0, 0, this.length); s1 = clamp(s1, 0, this.length);
    const out: Vec[] = [];
    const a = this.sample(s0); out.push({ x: a.x, y: a.y });
    for (let i = 0; i < this.pts.length; i++) if (this.cum[i] > s0 + 1e-6 && this.cum[i] < s1 - 1e-6) out.push(this.pts[i]);
    const b = this.sample(s1); out.push({ x: b.x, y: b.y });
    return new Polyline(out);
  }
  reversed(): Polyline { return new Polyline(this.pts.slice().reverse()); }
  private _bb?: { x0: number; y0: number; x1: number; y1: number };
  /** axis-aligned bounding box (cached) */
  get bbox() {
    if (!this._bb) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of this.pts) { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; }
      this._bb = { x0, y0, x1, y1 };
    }
    return this._bb;
  }
  /** distance from p to the bounding box (0 inside): a cheap lower bound for project().d */
  bboxDist(p: Vec) {
    const b = this.bbox;
    return Math.hypot(Math.max(b.x0 - p.x, 0, p.x - b.x1), Math.max(b.y0 - p.y, 0, p.y - b.y1));
  }
  // chunked bounding boxes (16 segments each): lets project() skip far-away parts of long polylines
  private _chunks?: Float64Array;
  private static readonly CH = 16;
  private chunks() {
    if (this._chunks) return this._chunks;
    const n = this.pts.length - 1, C = Polyline.CH, m = Math.ceil(n / C), out = new Float64Array(m * 4);
    for (let c = 0; c < m; c++) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = c * C; i <= Math.min(n, c * C + C); i++) { const q = this.pts[i]; if (q.x < x0) x0 = q.x; if (q.y < y0) y0 = q.y; if (q.x > x1) x1 = q.x; if (q.y > y1) y1 = q.y; }
      out[c * 4] = x0; out[c * 4 + 1] = y0; out[c * 4 + 2] = x1; out[c * 4 + 3] = y1;
    }
    return (this._chunks = out);
  }
  /** Closest point projection: returns arc length s, distance and signed lateral offset (+ = right of travel).
   *  Same result as a scan over all segments (first segment wins on ties); chunks whose box is further away than
   *  the best distance so far are skipped. */
  project(p: Vec): { s: number; d: number; lateral: number } {
    const n = this.pts.length - 1, C = Polyline.CH, ch = this.chunks(), px = p.x, py = p.y;
    let bestD2 = Infinity, bi = 0, bt = 0;
    for (let c = 0, m = ch.length / 4; c < m; c++) {
      const dx = Math.max(ch[c * 4] - px, 0, px - ch[c * 4 + 2]), dy = Math.max(ch[c * 4 + 1] - py, 0, py - ch[c * 4 + 3]);
      if (dx * dx + dy * dy > bestD2) continue;
      for (let i = c * C, e = Math.min(n, c * C + C); i < e; i++) {
        const a = this.pts[i], b = this.pts[i + 1];
        const abx = b.x - a.x, aby = b.y - a.y, L2 = abx * abx + aby * aby || 1e-12;
        const t = clamp(((px - a.x) * abx + (py - a.y) * aby) / L2, 0, 1);
        const qx = a.x + abx * t - px, qy = a.y + aby * t - py, d2 = qx * qx + qy * qy;
        if (d2 < bestD2) { bestD2 = d2; bi = i; bt = t; }
      }
    }
    if (bestD2 === Infinity) return { s: 0, d: Infinity, lateral: 0 };
    const a = this.pts[bi], b = this.pts[bi + 1], ab = sub(b, a), L = Math.sqrt(dot(ab, ab) || 1e-12);
    const q = add(a, mul(ab, bt));
    return { s: this.cum[bi] + bt * L, d: dist(p, q), lateral: dot(sub(p, q), rightOf(norm(ab))) };
  }
}

/** Offset a polyline laterally; offset(s) may vary along the length (positive = right). */
export function offsetPolyline(pl: Polyline, offset: (s: number) => number, step = 0.5): Vec[] {
  const n = Math.max(2, Math.ceil(pl.length / step));
  const out: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const s = (pl.length * i) / n;
    const p = pl.sample(s); const t = pl.tangent(s, 1.0); const r = rightOf(t);
    const o = offset(s);
    out.push({ x: p.x + r.x * o, y: p.y + r.y * o });
  }
  return out;
}

export function segSegDistance(a: Vec, b: Vec, c: Vec, d: Vec): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b));
}
export function pointSegDist(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a); const L2 = dot(ab, ab) || 1e-12;
  const t = clamp(dot(sub(p, a), ab) / L2, 0, 1);
  return dist(p, add(a, mul(ab, t)));
}
export function segmentsIntersect(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const d1 = cross(sub(b, a), sub(c, a)), d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c)), d4 = cross(sub(d, c), sub(b, c));
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
/** Minimum distance between two polylines (exact over segments). */
export function polylineDistance(A: Polyline, B: Polyline, skipEndsA = 0, skipEndsB = 0): number {
  let best = Infinity;
  const ea = A.length - skipEndsA, eb = B.length - skipEndsB;
  for (let i = 0; i < A.pts.length - 1; i++) {
    if (A.cum[i + 1] < skipEndsA || A.cum[i] > ea) continue;
    for (let j = 0; j < B.pts.length - 1; j++) {
      if (B.cum[j + 1] < skipEndsB || B.cum[j] > eb) continue;
      const dd = segSegDistance(A.pts[i], A.pts[i + 1], B.pts[j], B.pts[j + 1]);
      if (dd < best) best = dd;
    }
  }
  return best;
}

/** Oriented bounding box. */
export interface OBB { cx: number; cy: number; ux: number; uy: number; hl: number; hw: number }
export function obbCorners(b: OBB): Vec[] {
  const rx = -b.uy, ry = b.ux;
  return [
    { x: b.cx + b.ux * b.hl + rx * b.hw, y: b.cy + b.uy * b.hl + ry * b.hw },
    { x: b.cx + b.ux * b.hl - rx * b.hw, y: b.cy + b.uy * b.hl - ry * b.hw },
    { x: b.cx - b.ux * b.hl - rx * b.hw, y: b.cy - b.uy * b.hl - ry * b.hw },
    { x: b.cx - b.ux * b.hl + rx * b.hw, y: b.cy - b.uy * b.hl + ry * b.hw },
  ];
}
/** Separating-axis test. margin > 0 inflates both boxes. Returns true if they overlap. */
export function obbOverlap(a: OBB, b: OBB, margin = 0): boolean {
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  if (dx * dx + dy * dy > (a.hl + a.hw + b.hl + b.hw + 2 * margin) ** 2) return false;
  const axes = [[a.ux, a.uy], [-a.uy, a.ux], [b.ux, b.uy], [-b.uy, b.ux]];
  for (const [ax, ay] of axes) {
    const ra = (a.hl + margin) * Math.abs(a.ux * ax + a.uy * ay) + (a.hw + margin) * Math.abs(-a.uy * ax + a.ux * ay);
    const rb = (b.hl + margin) * Math.abs(b.ux * ax + b.uy * ay) + (b.hw + margin) * Math.abs(-b.uy * ax + b.ux * ay);
    if (Math.abs(dx * ax + dy * ay) > ra + rb) return false;
  }
  return true;
}

export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y + 1e-12) + a.x) c = !c;
  }
  return c;
}

/** Mulberry32 seeded PRNG. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo: number, hi: number) => lo + (hi - lo) * next(),
    int: (lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * next()),
    pick: <T>(arr: T[]): T => arr[Math.floor(next() * arr.length)],
    state: () => a,
    setState: (s: number) => { a = s >>> 0; },
  };
}
export type Rng = ReturnType<typeof rng>;
