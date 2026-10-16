// src/server/mapworker.ts
import { parentPort } from "node:worker_threads";

// src/shared/geom.ts
var add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
var sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
var mul = (a, k) => ({ x: a.x * k, y: a.y * k });
var dot = (a, b) => a.x * b.x + a.y * b.y;
var cross = (a, b) => a.x * b.y - a.y * b.x;
var dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
var norm = (a) => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};
var rightOf = (t) => ({ x: -t.y, y: t.x });
var lerpV = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
var clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
var angleWrap = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};
function catmullRom(points, step = 0.5, alpha = 0.5) {
  if (points.length < 2) return points.slice();
  const p = [points[0], ...points, points[points.length - 1]];
  p[0] = sub(mul(points[0], 2), points[1]);
  p[p.length - 1] = sub(mul(points[points.length - 1], 2), points[points.length - 2]);
  const out = [];
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
function cubicBezier(p0, p1, p2, p3, step = 0.4) {
  const approx = dist(p0, p1) + dist(p1, p2) + dist(p2, p3);
  const n = Math.max(6, Math.ceil(approx / step));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
    });
  }
  return out;
}
function resample(pts, step = 0.5) {
  if (pts.length < 2) return pts.slice();
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  const n = Math.max(1, Math.round(total / step));
  const out = [];
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const s = total * i / n;
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    out.push(lerpV(pts[j], pts[j + 1], (s - cum[j]) / seg));
  }
  return out;
}
var Polyline = class _Polyline {
  pts;
  cum;
  length;
  constructor(pts) {
    const clean = [];
    for (const p of pts) if (!clean.length || dist(clean[clean.length - 1], p) > 1e-4) clean.push(p);
    if (clean.length === 1) clean.push({ x: clean[0].x + 1e-3, y: clean[0].y });
    this.pts = clean;
    this.cum = [0];
    for (let i = 1; i < clean.length; i++) this.cum.push(this.cum[i - 1] + dist(clean[i - 1], clean[i]));
    this.length = this.cum[this.cum.length - 1];
  }
  seg(s) {
    let lo = 0, hi = this.cum.length - 2;
    if (s <= 0) return 0;
    if (s >= this.length) return hi;
    while (lo < hi) {
      const mid = lo + hi + 1 >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
  sample(s) {
    const i = this.seg(s);
    const a = this.pts[i], b = this.pts[i + 1];
    const L = this.cum[i + 1] - this.cum[i] || 1e-9;
    const t = clamp((s - this.cum[i]) / L, 0, 1);
    const extra = s < 0 ? s : s > this.length ? s - this.length : 0;
    const tx = (b.x - a.x) / L, ty = (b.y - a.y) / L;
    const base = extra < 0 ? a : extra > 0 ? b : lerpV(a, b, t);
    return { x: base.x + tx * extra, y: base.y + ty * extra, tx, ty };
  }
  /** Smoothed tangent (averaged over +-w metres) to avoid heading jitter on dense polylines. */
  tangent(s, w = 0.8) {
    const a = this.sample(Math.max(0, s - w)), b = this.sample(Math.min(this.length, s + w));
    const d = norm({ x: b.x - a.x, y: b.y - a.y });
    return d.x === 0 && d.y === 0 ? { x: a.tx, y: a.ty } : d;
  }
  /** Curvature magnitude (1/m) at s, via heading change over a window. */
  curvature(s, w = 1.5) {
    const s0 = clamp(s - w, 0, this.length), s1 = clamp(s + w, 0, this.length);
    if (s1 - s0 < 0.2) return 0;
    const a = this.sample(s0), b = this.sample(s1);
    const h0 = Math.atan2(a.ty, a.tx), h1 = Math.atan2(b.ty, b.tx);
    return Math.abs(angleWrap(h1 - h0)) / (s1 - s0);
  }
  slice(s0, s1) {
    s0 = clamp(s0, 0, this.length);
    s1 = clamp(s1, 0, this.length);
    const out = [];
    const a = this.sample(s0);
    out.push({ x: a.x, y: a.y });
    for (let i = 0; i < this.pts.length; i++) if (this.cum[i] > s0 + 1e-6 && this.cum[i] < s1 - 1e-6) out.push(this.pts[i]);
    const b = this.sample(s1);
    out.push({ x: b.x, y: b.y });
    return new _Polyline(out);
  }
  reversed() {
    return new _Polyline(this.pts.slice().reverse());
  }
  _bb;
  /** axis-aligned bounding box (cached) */
  get bbox() {
    if (!this._bb) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of this.pts) {
        if (p.x < x0) x0 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.x > x1) x1 = p.x;
        if (p.y > y1) y1 = p.y;
      }
      this._bb = { x0, y0, x1, y1 };
    }
    return this._bb;
  }
  /** distance from p to the bounding box (0 inside): a cheap lower bound for project().d */
  bboxDist(p) {
    const b = this.bbox;
    return Math.hypot(Math.max(b.x0 - p.x, 0, p.x - b.x1), Math.max(b.y0 - p.y, 0, p.y - b.y1));
  }
  // chunked bounding boxes (16 segments each): lets project() skip far-away parts of long polylines
  _chunks;
  static CH = 16;
  chunks() {
    if (this._chunks) return this._chunks;
    const n = this.pts.length - 1, C = _Polyline.CH, m = Math.ceil(n / C), out = new Float64Array(m * 4);
    for (let c = 0; c < m; c++) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = c * C; i <= Math.min(n, c * C + C); i++) {
        const q = this.pts[i];
        if (q.x < x0) x0 = q.x;
        if (q.y < y0) y0 = q.y;
        if (q.x > x1) x1 = q.x;
        if (q.y > y1) y1 = q.y;
      }
      out[c * 4] = x0;
      out[c * 4 + 1] = y0;
      out[c * 4 + 2] = x1;
      out[c * 4 + 3] = y1;
    }
    return this._chunks = out;
  }
  /** Closest point projection: returns arc length s, distance and signed lateral offset (+ = right of travel).
   *  Same result as a scan over all segments (first segment wins on ties); chunks whose box is further away than
   *  the best distance so far are skipped. */
  project(p) {
    const n = this.pts.length - 1, C = _Polyline.CH, ch = this.chunks(), px = p.x, py = p.y;
    let bestD2 = Infinity, bi = 0, bt = 0;
    for (let c = 0, m = ch.length / 4; c < m; c++) {
      const dx = Math.max(ch[c * 4] - px, 0, px - ch[c * 4 + 2]), dy = Math.max(ch[c * 4 + 1] - py, 0, py - ch[c * 4 + 3]);
      if (dx * dx + dy * dy > bestD2) continue;
      for (let i = c * C, e = Math.min(n, c * C + C); i < e; i++) {
        const a2 = this.pts[i], b2 = this.pts[i + 1];
        const abx = b2.x - a2.x, aby = b2.y - a2.y, L2 = abx * abx + aby * aby || 1e-12;
        const t = clamp(((px - a2.x) * abx + (py - a2.y) * aby) / L2, 0, 1);
        const qx = a2.x + abx * t - px, qy = a2.y + aby * t - py, d2 = qx * qx + qy * qy;
        if (d2 < bestD2) {
          bestD2 = d2;
          bi = i;
          bt = t;
        }
      }
    }
    if (bestD2 === Infinity) return { s: 0, d: Infinity, lateral: 0 };
    const a = this.pts[bi], b = this.pts[bi + 1], ab = sub(b, a), L = Math.sqrt(dot(ab, ab) || 1e-12);
    const q = add(a, mul(ab, bt));
    return { s: this.cum[bi] + bt * L, d: dist(p, q), lateral: dot(sub(p, q), rightOf(norm(ab))) };
  }
};
function offsetPolyline(pl, offset, step = 0.5) {
  const n = Math.max(2, Math.ceil(pl.length / step));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const s = pl.length * i / n;
    const p = pl.sample(s);
    const t = pl.tangent(s, 1);
    const r = rightOf(t);
    const o = offset(s);
    out.push({ x: p.x + r.x * o, y: p.y + r.y * o });
  }
  return out;
}
function segSegDistance(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b));
}
function pointSegDist(p, a, b) {
  const ab = sub(b, a);
  const L2 = dot(ab, ab) || 1e-12;
  const t = clamp(dot(sub(p, a), ab) / L2, 0, 1);
  return dist(p, add(a, mul(ab, t)));
}
function segmentsIntersect(a, b, c, d) {
  const d1 = cross(sub(b, a), sub(c, a)), d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c)), d4 = cross(sub(d, c), sub(b, c));
  return (d1 > 0 && d2 < 0 || d1 < 0 && d2 > 0) && (d3 > 0 && d4 < 0 || d3 < 0 && d4 > 0);
}
function polylineDistance(A, B, skipEndsA = 0, skipEndsB = 0) {
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
function obbOverlap(a, b, margin = 0) {
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
function pointInPolygon(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y + 1e-12) + a.x) c = !c;
  }
  return c;
}

// src/shared/house.ts
function villaVariant(num) {
  const r = hrand(num * 97 + 11);
  const W = [10.5, 11.5, 12.5, 13.5][Math.floor(r() * 4)], D = r() < 0.5 ? 9 : 10;
  const floors = r() < 0.72 ? 2 : 1;
  return { W, D, floors, pool: r() < 0.42, solar: r() < 0.65, upperSide: r() < 0.5 ? -1 : 1, terraceD: 5.5, boat: r() < 0.35, hedge: r() < 0.8 };
}
var isVilla = (type) => !!type && /V$/.test(type);
var isTerraced = (type) => !!type && /G$/.test(type);
function houseSize(type, pdfSideM, num = 0) {
  if (isVilla(type)) {
    const v = villaVariant(num);
    return { W: v.W, D: v.D, annex: false, cap: 8, scale: 1, patioFront: 0.6, patioBack: v.terraceD, doorM: v.D / 2 + 0.8 };
  }
  if (isTerraced(type)) {
    const W = Math.max(3.5, Math.min(5.4, (pdfSideM ?? 6) - 1.2));
    return { W, D: 8.5, annex: false, cap: 4, scale: 1, patioFront: 0.4, patioBack: 2.6, doorM: 8.5 / 2 + 0.7 };
  }
  const t = type ?? "6C";
  const cap = parseInt(t, 10) || 6;
  const size = cap <= 4 ? [6.4, 8.6] : cap <= 6 ? [7, 9.8] : cap <= 8 ? [7.6, 11] : cap <= 12 ? [8.4, 12.6] : [9.2, 15];
  const annex = cap >= 6 || /E|K/.test(t.slice(1));
  let scale = 1;
  if (pdfSideM && pdfSideM > 4) {
    const box = pdfSideM * 1.1;
    scale = Math.max(0.65, Math.min(1, box / (size[0] + 0.8 + (annex ? 3 : 0)), box / (size[1] + 0.8 + 3.6)));
  }
  return { W: size[0], D: size[1], annex, cap, scale, patioFront: PATIO_D, patioBack: 0.4, doorM: size[1] / 2 + 2.4 };
}
var PATIO_D = 3.6;
var ANNEX_W = 3;
function hrand(seed) {
  let s = seed * 2654435761 >>> 0;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return (s >>> 0) / 4294967296;
  };
}
function annexSide(num) {
  return hrand(num * 31 + 3)() < 0.5 ? -1 : 1;
}
function houseFootprint(pos, front, s, num, opts = {}) {
  const m = opts.margin ?? 0, k = s.scale;
  const back = (s.D / 2 + (opts.patio === false ? 0.4 : s.patioBack)) * k, ahead = (s.D / 2 + (opts.patio === false ? 0.4 : s.patioFront)) * k;
  const side = annexSide(num), a = s.annex ? ANNEX_W : 0;
  const left = (s.W / 2 + 0.4 + (side < 0 ? a : 0)) * k, right = (s.W / 2 + 0.4 + (side > 0 ? a : 0)) * k;
  const cl = (ahead - back) / 2, cw = (right - left) / 2;
  const rx = -front.y, ry = front.x;
  return {
    cx: pos.x + front.x * cl + rx * cw,
    cy: pos.y + front.y * cl + ry * cw,
    ux: front.x,
    uy: front.y,
    hl: (ahead + back) / 2 + m,
    hw: (left + right) / 2 + m
  };
}
function footprintSamples(f, nl = 5, nw = 3) {
  const out = [];
  const vx = -f.uy, vy = f.ux;
  for (let i = 0; i < nl; i++) for (let j = 0; j < nw; j++) {
    const a = (i / (nl - 1) * 2 - 1) * f.hl, b = (j / (nw - 1) * 2 - 1) * f.hw;
    out.push({ x: f.cx + f.ux * a + vx * b, y: f.cy + f.uy * a + vy * b });
  }
  return out;
}

// src/sim/network.ts
var VEH = { carLen: 4.7, carWid: 1.9 };
var TURN_CLEARANCE = 3.3;
var RT = 5;
var STRAIGHT = 3.6;
var SP = 3.1;
var CAR_STALL = { rt: RT, straight: STRAIGHT, width: SP, vehLen: VEH.carLen, vehWid: VEH.carWid };
function stallGeometry(lane, sAttach, E, rc, sz = CAR_STALL) {
  const A0 = lane.sample(sAttach);
  const A = { x: A0.x, y: A0.y };
  const d = lane.tangent(sAttach, 1);
  const h = Math.max(2.2, dist(A, E) * 0.55);
  const curve = cubicBezier(A, add(A, mul(d, h)), sub(E, mul(rc, h)), E, 0.3);
  const end = add(E, mul(rc, sz.straight));
  const line = new Polyline(resample([...curve, end], 0.35));
  const padC = add(E, mul(rc, sz.straight - sz.vehLen / 2 - 0.4));
  const parked = { cx: padC.x, cy: padC.y, ux: rc.x, uy: rc.y, hl: sz.vehLen / 2, hw: sz.vehWid / 2 };
  return { A, d, r: rc, end, line, padC, parked, E };
}
var A_LAT = 1.7;
function buildNetwork(net, sector) {
  const k = sector.metersPerPt;
  const o = sector.originPt;
  const toWorld = (pt) => ({ x: (pt[0] - o[0]) * k, y: (pt[1] - o[1]) * k });
  const validation = [];
  const nodes = /* @__PURE__ */ new Map();
  for (const [id, n] of Object.entries(net.nodes)) nodes.set(id, { id, pos: toWorld(n.pt), kind: n.kind });
  const edges = /* @__PURE__ */ new Map();
  const roads = [];
  const islands = [];
  const clsFlags = (c) => ({
    visitor: c === "public" || c === "arrival" || c === "park",
    service: c === "park" || c === "service" || c === "arrival"
  });
  const mkEdge = (e) => {
    const full = { ...e, vmax: e.vmax ?? new Float32Array(0), next: [], prev: [] };
    edges.set(full.id, full);
    return full;
  };
  const laneOf = {};
  for (const r of net.roads) {
    const nf = net.nodes[r.from], nt = net.nodes[r.to];
    const ctrl = [nf.pt, ...r.pts, nt.pt].map(toWorld);
    const centre = new Polyline(resample(catmullRom(ctrl, 0.4), 0.5));
    const trim = (n) => n.kind === "junction" ? n.radius ?? 6 : n.kind === "deadend" ? n.turnRadiusM ?? 6 : 0;
    const t0 = trim(nf), t1 = trim(nt);
    const core = centre.slice(t0, centre.length - t1);
    const base = r.laneOffsetM;
    let offF = (_s) => base, offB = (_s) => base;
    if (r.gatePlaza) {
      const g = r.gatePlaza;
      const sa = core.project(toWorld(g.fromPt)).s, sb = core.project(toWorld(g.toPt)).s;
      const ramp = g.rampM;
      const w = (s) => {
        if (s < sa - ramp || s > sb + ramp) return 0;
        if (s >= sa && s <= sb) return 1;
        const t = s < sa ? (s - (sa - ramp)) / ramp : (sb + ramp - s) / ramp;
        return t * t * (3 - 2 * t);
      };
      offF = (s) => base + (g.forwardOffsetM - base) * w(s);
      offB = (s) => base + (g.backwardOffsetM - base) * w(s);
      const left = [], right = [];
      for (let s = sa - ramp * 0.3; s <= sb + ramp * 0.3; s += 0.5) {
        const p = core.sample(s), t = core.tangent(s), rn = rightOf(t);
        const ww = w(s);
        if (ww < 0.35) continue;
        const a = offF(s) - 1.55, b = -(offB(s) - 1.55);
        right.push(add(p, mul(rn, Math.max(b + 0.05, a))));
        left.push(add(p, mul(rn, b)));
      }
      if (left.length > 2) islands.push([...right, ...left.reverse()]);
    }
    if (nt.kind === "deadend" || nf.kind === "deadend") {
      const atEnd = nt.kind === "deadend";
      const wEnd = (s) => {
        const x = atEnd ? (s - (core.length - 14)) / 14 : (14 - s) / 14;
        const t = clamp(x, 0, 1);
        return t * t * (3 - 2 * t);
      };
      const f0 = offF, b0 = offB;
      const wide = Math.min(2.5, (atEnd ? nt : nf).turnRadiusM ? (atEnd ? nt : nf).turnRadiusM * 0.4 : 2.5);
      offF = (s) => Math.max(f0(s), base + Math.max(0, wide - base) * wEnd(s));
      offB = (s) => Math.max(b0(s), base + Math.max(0, wide - base) * wEnd(s));
    }
    const flags = clsFlags(r.class);
    const speed = r.speedKmh / 3.6;
    if (!r.oneway && !r.gatePlaza && base > 0) {
      const bendAt = (s) => {
        const a = core.tangent(clamp(s - 3, 0, core.length), 1), b = core.tangent(clamp(s + 3, 0, core.length), 1);
        const ang = Math.abs(Math.atan2(cross(a, b), a.x * b.x + a.y * b.y));
        return ang / 6;
      };
      const step = 1, n = Math.max(1, Math.ceil(core.length / step));
      const kap = Array.from({ length: n + 1 }, (_, i) => bendAt(i * step));
      const wid = kap.map((_, i) => {
        let m = 0, c = 0;
        for (let j = Math.max(0, i - 10); j <= Math.min(n, i + 10); j++) {
          m += kap[j];
          c++;
        }
        return Math.min(0.6, 4 * m / c);
      });
      const extra = (s) => {
        const i = clamp(s / step, 0, n);
        const i0 = Math.floor(i), i1 = Math.min(n, i0 + 1);
        return wid[i0] + (wid[i1] - wid[i0]) * (i - i0);
      };
      const f0 = offF, b0 = offB;
      offF = (s) => f0(s) + extra(s);
      offB = (s) => b0(s) + extra(s);
    }
    const fLine = new Polyline(offsetPolyline(core, offF, 0.5));
    const bLine = new Polyline(offsetPolyline(core, (s) => -offB(s), 0.5)).reversed();
    const ef = r.oneway === "b" ? void 0 : mkEdge({ id: `${r.id}:f`, kind: "lane", line: fLine, from: r.from, to: r.to, roadId: r.id, dir: "f", cls: r.class, priority: r.priority, baseSpeed: speed, reverseMotion: false, ...flags, laneHalfWidth: 1.45, oneway: !!r.oneway });
    const eb = r.oneway === "f" ? void 0 : mkEdge({ id: `${r.id}:b`, kind: "lane", line: bLine, from: r.to, to: r.from, roadId: r.id, dir: "b", cls: r.class, priority: r.priority, baseSpeed: speed, reverseMotion: false, ...flags, laneHalfWidth: 1.45, oneway: !!r.oneway });
    laneOf[r.id] = { f: ef?.id, b: eb?.id };
    const hw = [];
    const cpts = [];
    for (let s = 0; s <= centre.length; s += 1) {
      const cs = clamp(s - t0, 0, core.length);
      const p = centre.sample(s);
      cpts.push({ x: p.x, y: p.y });
      hw.push(Math.max(offF(cs), offB(cs)) + (r.surface === "pavers" ? 0.9 : 1.5));
    }
    roads.push({ id: r.id, name: r.name, cls: r.class, center: cpts, halfWidth: hw, markings: r.markings, surface: r.surface, from: r.from, to: r.to, hidden: r.hidden });
  }
  const demands = [];
  for (const c of sector.parkingClusters) {
    const sz = c.stall ? { ...CAR_STALL, ...c.stall } : CAR_STALL;
    for (let i = 0; i < c.stalls; i++) {
      const house = c.serves[i] ?? -1;
      demands.push({ cluster: c.id, key: `${c.id}:${c.serves[i] ?? `v${i + 1}`}`, house, kind: c.kind === "depot" ? "depot" : house > 0 ? "house" : "spare", sz, p: toWorld(c.pt), order: i, avoid: /* @__PURE__ */ new Set() });
    }
  }
  const clusterKind = new Map(sector.parkingClusters.map((c) => [c.id, c.kind]));
  const bestLane = (d) => {
    let best = null;
    const depot = clusterKind.get(d.cluster) === "depot";
    for (const e of edges.values()) {
      if (e.kind !== "lane" || d.avoid.has(e.id)) continue;
      if (depot ? e.cls !== "service" : e.cls !== "park") continue;
      if (!depot && (net.nodes[e.from]?.kind === "portal" || net.nodes[e.to]?.kind === "portal")) continue;
      if (best && e.line.bboxDist(d.p) > best.d) continue;
      const pr = e.line.project(d.p);
      if (pr.lateral <= -0.9 && !e.oneway) continue;
      if (!best || pr.d < best.d) best = { lane: e.id, s: pr.s, d: pr.d, side: e.oneway && pr.lateral < 0 ? -1 : 1 };
    }
    return best;
  };
  const waterW = (sector.terrain?.water ?? []).map((w) => w.map(toWorld));
  const inWater = (q) => waterW.some((w) => pointInPolygon(q, w));
  const circles = Object.entries(net.nodes).filter(([, nd]) => nd.kind === "deadend").map(([, nd]) => ({ c: toWorld(nd.pt), r: (nd.turnRadiusM ?? 6) + 1.7 + 0.4 }));
  const inCircle = (q) => circles.some((cc) => dist(cc.c, q) < cc.r);
  const plans = [];
  const placedOBB = [];
  let pending = demands;
  for (let round = 0; round < 30 && pending.length; round++) {
    const rows = /* @__PURE__ */ new Map();
    const next = [];
    for (const d of pending) {
      const bl = bestLane(d);
      if (!bl) {
        validation.push({ level: "warn", msg: `Parkeervak ${d.key}: geen geschikte rijstrook gevonden` });
        continue;
      }
      const key = `${bl.lane}|${bl.side}|${d.sz.width}`;
      const row = rows.get(key) ?? rows.set(key, { lane: bl.lane, side: bl.side, sz: d.sz, items: [] }).get(key);
      row.items.push({ d, pref: bl.s + d.sz.rt * 0.6, dist: bl.d });
    }
    for (const [rowKey, row] of rows) {
      const sz = row.sz, RT2 = sz.rt, STRAIGHT2 = sz.straight;
      const laneLine = edges.get(row.lane).line, L = laneLine.length;
      const byCluster2 = /* @__PURE__ */ new Map();
      for (const it of row.items) (byCluster2.get(it.d.cluster) ?? byCluster2.set(it.d.cluster, []).get(it.d.cluster)).push(it);
      const items = [];
      for (const list of byCluster2.values()) {
        list.sort((x, y) => x.d.order - y.d.order);
        list.forEach((it, i) => items.push({ d: it.d, pref: it.pref + (i - (list.length - 1) / 2) * sz.width }));
      }
      items.sort((x, y) => x.pref - y.pref);
      const lo = 5 + RT2, hi = L - 7;
      const bl = sz === CAR_STALL ? 2.4 : sz.vehLen / 2 + 0.05, bw = sz === CAR_STALL ? 0.975 : sz.vehWid / 2 + 0.05;
      const layout = (use2, sp) => {
        const centres2 = use2.map((x) => x.pref);
        for (let i = 0; i < centres2.length; i++) centres2[i] = Math.max(centres2[i], i ? centres2[i - 1] + sp : lo);
        if (centres2.length && centres2[centres2.length - 1] > hi) {
          centres2[centres2.length - 1] = hi;
          for (let i = centres2.length - 2; i >= 0; i--) centres2[i] = Math.min(centres2[i], centres2[i + 1] - sp);
        }
        const entries2 = [], rcs2 = [], ss2 = [];
        for (const sc of centres2) {
          const B0 = laneLine.sample(sc), dc = laneLine.tangent(sc, 2);
          const rc = mul(rightOf(dc), row.side);
          const E = add({ x: B0.x, y: B0.y }, mul(rc, RT2));
          entries2.push(E);
          rcs2.push(rc);
          ss2.push(clamp(laneLine.project(sub(sub(E, mul(rc, RT2)), mul(dc, RT2 * 0.95))).s, 3, L - 3));
        }
        const geo2 = ss2.map((sA, i) => stallGeometry(laneLine, sA, entries2[i], rcs2[i], sz));
        const bad = /* @__PURE__ */ new Set();
        for (let i = 1; i < ss2.length; i++) if (ss2[i] - ss2[i - 1] <= 1) bad.add(i);
        const mine = geo2.map((g) => ({ ...g.parked, hl: bl, hw: bw }));
        const near = placedOBB.filter((o2) => geo2.some((g) => dist({ x: o2.obb.cx, y: o2.obb.cy }, { x: g.parked.cx, y: g.parked.cy }) < 30)).map((o2) => o2.obb);
        for (let j = 0; j < geo2.length; j++) {
          for (let x = 0.9; x <= geo2[j].line.length - sz.vehLen / 2 - 0.4; x += 0.4) {
            const q = geo2[j].line.sample(x), t = geo2[j].line.tangent(x, 0.5);
            const box = { cx: q.x, cy: q.y, ux: t.x, uy: t.y, hl: bl, hw: bw };
            let hit = false;
            for (let k2 = 0; k2 < mine.length && !hit; k2++) if (k2 !== j && obbOverlap(box, mine[k2], 0.26)) {
              hit = true;
              bad.add(Math.abs(k2 - j) === 1 ? Math.max(j, k2) : j);
            }
            for (const o2 of near) if (!hit && obbOverlap(box, o2, 0.26)) {
              hit = true;
              bad.add(j);
            }
            if (hit) break;
          }
          {
            const pk = geo2[j].parked;
            const ux = pk.ux * pk.hl, uy = pk.uy * pk.hl, vx = -pk.uy * pk.hw, vy = pk.ux * pk.hw;
            if ([[1, 1], [1, -1], [-1, 1], [-1, -1], [0, 0]].some(([a, b]) => {
              const q = { x: pk.cx + a * ux + b * vx, y: pk.cy + a * uy + b * vy };
              return inWater(q) || inCircle(q);
            })) bad.add(j);
          }
          const nearLane = laneLine.project(add(entries2[j], mul(rcs2[j], STRAIGHT2 - sz.vehLen - 0.4)));
          if (nearLane.d < (sz === CAR_STALL ? 2.6 : 1.9)) bad.add(j);
          const pc = geo2[j].parked;
          for (const e of edges.values()) {
            if (e.kind !== "lane" || e.id === row.lane || e.line.bboxDist({ x: pc.cx, y: pc.cy }) > 4) continue;
            if (e.line.project({ x: pc.cx, y: pc.cy }).d < bw + 1.5) {
              bad.add(j);
              break;
            }
          }
        }
        return { centres: centres2, entries: entries2, rcs: rcs2, ss: ss2, geo: geo2, bad };
      };
      let use = items.slice(0, Math.max(0, Math.min(items.length, Math.floor((hi - lo) / sz.width) + 1)));
      const overflow = items.slice(use.length);
      let res = layout(use, sz.width);
      for (let sp = sz.width + 0.3; res.bad.size && sp <= sz.width + 1.2 && (use.length - 1) * sp <= hi - lo; sp += 0.3) {
        const r2 = layout(use, sp);
        if (r2.bad.size < res.bad.size) res = r2;
      }
      for (let guard = 0; res.bad.size && guard < 40; guard++) {
        const drop = [...res.bad].sort((x, y) => y - x)[0];
        overflow.push(use[drop]);
        use = use.filter((_, i) => i !== drop);
        res = layout(use, sz.width);
      }
      const { centres, entries, rcs, ss, geo } = res;
      const fit = use.length;
      items.splice(0, items.length, ...use, ...overflow);
      for (const it of items.slice(fit)) {
        it.d.avoid.add(row.lane);
        next.push(it.d);
      }
      items.slice(0, fit).forEach((it, i) => {
        const plan = { key: it.d.key, cluster: it.d.cluster, house: it.d.house, lane: row.lane, s: ss[i], E: entries[i], rc: rcs[i], sz, kind: it.d.kind };
        plans.push(plan);
        placedOBB.push({ plan, obb: { ...geo[i].parked, hl: bl, hw: bw }, row: rowKey });
        const shift = centres[i] - it.pref;
        if (Math.abs(shift) > 8) validation.push({ level: "info", msg: `Vak ${it.d.key}: ${shift.toFixed(1)} m verschoven langs ${row.lane} (ruimte/kruising)` });
      });
    }
    pending = next;
  }
  for (const d of pending) validation.push({ level: "warn", msg: `Parkeervak ${d.key} (huis ${d.house}) kon nergens worden geplaatst` });
  const perCluster = /* @__PURE__ */ new Map();
  for (const p of plans) (perCluster.get(p.cluster) ?? perCluster.set(p.cluster, []).get(p.cluster)).push(p);
  for (const list of perCluster.values()) {
    list.sort((a, b) => a.lane === b.lane ? a.s - b.s : a.lane < b.lane ? -1 : 1);
    list.forEach((p, i) => {
      p.sid = `${p.cluster}-${i + 1}`;
    });
  }
  const splitsByLane = /* @__PURE__ */ new Map();
  for (const p of plans) {
    const L = edges.get(p.lane);
    if (p.s < 4 || p.s > L.line.length - 4) validation.push({ level: "warn", msg: `Vak voor huis ${p.house} ligt te dicht bij een kruising (s=${p.s.toFixed(1)})` });
    p.s = clamp(p.s, 4, L.line.length - 4);
    (splitsByLane.get(p.lane) ?? splitsByLane.set(p.lane, []).get(p.lane)).push(p);
  }
  for (const p of plans) {
    const L = edges.get(p.lane);
    if (L.oneway || !L.roadId || p.kind === "spare") continue;
    const F = edges.get(`${L.roadId}:${L.dir === "f" ? "b" : "f"}`);
    if (!F || F.kind !== "lane") continue;
    const G = stallGeometry(L.line, p.s, p.E, p.rc, p.sz);
    const pe = F.line.project(G.A);
    if (pe.d > 6) continue;
    const sIn = pe.s - 3.5;
    const X = L.line.sample(Math.min(L.line.length - 1, p.s + 3 + p.sz.vehLen / 2));
    const sOut = F.line.project(X).s + 4.5;
    if (sIn < 5 || sOut > F.line.length - 5 || sOut < 5 || sIn > F.line.length - 5) continue;
    const cIn = { key: `${p.key}>in`, s: sIn, extra: true }, cOut = { key: `${p.key}>out`, s: sOut, extra: true };
    p.far = { lane: F.id, cIn, cOut, X: { x: X.x, y: X.y }, line: F.line };
    (splitsByLane.get(F.id) ?? splitsByLane.set(F.id, []).get(F.id)).push(cIn, cOut);
  }
  const crossLinks = [];
  const stalls = /* @__PURE__ */ new Map();
  const stallsByHouse = /* @__PURE__ */ new Map();
  const pieceMap = /* @__PURE__ */ new Map();
  for (const [laneId, ps] of splitsByLane) {
    ps.sort((a, b) => a.s - b.s);
    for (let i = 1; i < ps.length; i++) if (ps[i].s < ps[i - 1].s + 1) ps[i].s = ps[i - 1].s + 1;
    const L = edges.get(laneId);
    for (let i = ps.length - 1; i >= 0; i--) {
      const c = ps[i];
      if ("extra" in c && c.s > L.line.length - 1.5) {
        c.dead = true;
        ps.splice(i, 1);
      }
    }
    edges.delete(laneId);
    const cuts = [0, ...ps.map((p) => p.s), L.line.length];
    const pieces = [];
    let prevNode = L.from;
    for (let i = 0; i < cuts.length - 1; i++) {
      const id = `${laneId}~${i}`;
      const toNode = i < ps.length ? `AT:${ps[i].key}` : L.to;
      if (i < ps.length) nodes.set(toNode, { id: toNode, pos: L.line.sample(cuts[i + 1]), kind: "attach" });
      mkEdge({ ...L, id, line: L.line.slice(cuts[i], cuts[i + 1]), from: prevNode, to: toNode });
      pieces.push({ id, s0: cuts[i], s1: cuts[i + 1] });
      prevNode = toNode;
    }
    pieceMap.set(laneId, pieces);
    ps.filter((c) => !("extra" in c)).forEach((p) => {
      const at = `AT:${p.key}`;
      const G = stallGeometry(L.line, p.s, p.E, p.rc, p.sz);
      p.G = G;
      p.near = L.line;
      const STRAIGHT2 = p.sz.straight, depot = p.kind === "depot";
      const A = G.A, d = G.d, r = G.r, end = G.end, inLine = G.line;
      const stallNode = `ST:${p.key}`;
      const padC = G.padC;
      nodes.set(stallNode, { id: stallNode, pos: end, kind: "stall" });
      p.stallNode = stallNode;
      const sid = p.sid;
      const inE = mkEdge({ id: `DW:${sid}`, kind: "driveway", line: inLine, from: at, to: stallNode, cls: "park", priority: 0, baseSpeed: 2.2, reverseMotion: false, visitor: !depot, service: true, stallId: sid, laneHalfWidth: 1.3 });
      const outE = mkEdge({ id: `RV:${sid}`, kind: "reverse", line: inLine.reversed(), from: stallNode, to: at, cls: "park", priority: 0, baseSpeed: 1.3, reverseMotion: true, visitor: !depot, service: true, stallId: sid, laneHalfWidth: 1.3 });
      const half = p.sz.width / 2 - 0.1;
      const dd = rightOf({ x: -r.x, y: -r.y });
      const E0 = G.E;
      const pad = [
        add(add(E0, mul(dd, -half)), mul(r, -0.4)),
        add(add(E0, mul(dd, half)), mul(r, -0.4)),
        add(add(E0, mul(dd, half)), mul(r, STRAIGHT2 + 0.5)),
        add(add(E0, mul(dd, -half)), mul(r, STRAIGHT2 + 0.5))
      ];
      const st = {
        id: sid,
        clusterId: p.cluster,
        kind: p.kind,
        houseNumber: p.house,
        attachNode: at,
        inEdge: inE.id,
        outEdge: outE.id,
        inEdges: [inE.id],
        outEdges: [outE.id],
        parkS: inLine.length - p.sz.vehLen / 2 - 0.4,
        parkBack: p.sz.vehLen / 2 + 0.4,
        pad,
        parkedPose: { x: padC.x, y: padC.y, heading: Math.atan2(r.y, r.x) }
      };
      stalls.set(sid, st);
      if (p.house > 0) stallsByHouse.set(p.house, st);
    });
  }
  for (const p of plans) {
    const f = p.far, G = p.G, st = p.sid ? stalls.get(p.sid) : void 0;
    if (!f || !G || !st || !p.stallNode || f.cIn.dead || f.cOut.dead) continue;
    const inNode = `AT:${f.cIn.key}`, outNode = `AT:${f.cOut.key}`;
    if (!nodes.has(inNode) || !nodes.has(outNode)) continue;
    const depot = p.kind === "depot", sid = p.sid;
    const P0 = nodes.get(inNode).pos, t0 = f.line.tangent(f.cIn.s, 1.2);
    const hIn = Math.max(2.5, dist(P0, G.E) * 0.55);
    const inPts = [...cubicBezier(P0, add(P0, mul(t0, hIn)), sub(G.E, mul(G.r, hIn)), G.E, 0.3), G.end];
    const dx = mkEdge({ id: `DX:${sid}`, kind: "driveway", line: new Polyline(resample(inPts, 0.35)), from: inNode, to: p.stallNode, cls: "park", priority: 0, baseSpeed: 2, reverseMotion: false, visitor: !depot, service: true, stallId: sid, laneHalfWidth: 1.3 });
    const X = f.X, tX = p.near.tangent(p.near.project(X).s, 1.2);
    const hR = Math.max(2.2, dist(G.E, X) * 0.55);
    const rvPts = [G.end, ...cubicBezier(G.E, sub(G.E, mul(G.r, hR)), sub(X, mul(tX, hR)), X, 0.3)];
    const xNode = `RX:${p.key}`;
    nodes.set(xNode, { id: xNode, pos: X, kind: "attach" });
    const rx = mkEdge({ id: `RX:${sid}`, kind: "reverse", line: new Polyline(resample(rvPts, 0.35)), from: p.stallNode, to: xNode, cls: "park", priority: 0, baseSpeed: 1.3, reverseMotion: true, visitor: !depot, service: true, stallId: sid, laneHalfWidth: 1.3 });
    const P3 = nodes.get(outNode).pos, t3 = f.line.tangent(f.cOut.s, 1.2), back = { x: -tX.x, y: -tX.y };
    const hO = Math.max(2, dist(X, P3) * 0.45);
    const xo = mkEdge({ id: `XO:${sid}`, kind: "connector", line: new Polyline(resample(cubicBezier(X, add(X, mul(back, hO)), sub(P3, mul(t3, hO)), P3, 0.3), 0.3)), from: xNode, to: outNode, cls: "park", priority: 0, baseSpeed: 2.2, reverseMotion: false, visitor: !depot, service: true, laneHalfWidth: 1.3 });
    st.inEdges.push(dx.id);
    st.outEdges.push(rx.id);
    crossLinks.push([rx.id, xo.id], [xo.id, outNode]);
  }
  const incoming = (node) => [...edges.values()].filter((e) => e.kind === "lane" && e.to === node);
  const outgoing = (node) => [...edges.values()].filter((e) => e.kind === "lane" && e.from === node);
  for (const [nid, n] of Object.entries(net.nodes)) {
    if (n.kind === "junction") {
      for (const ein of incoming(nid)) for (const eout of outgoing(nid)) {
        if (ein.roadId === eout.roadId) {
          const p02 = ein.line.sample(ein.line.length), p32 = eout.line.sample(0);
          const t02 = ein.line.tangent(ein.line.length, 1.2), t32 = eout.line.tangent(0, 1.2);
          const hh = Math.max(4.5, (net.nodes[nid].radius ?? 6) * 0.8);
          const pts2 = cubicBezier(p02, add(p02, mul(t02, hh)), sub(p32, mul(t32, hh)), p32, 0.25);
          const id2 = `UT:${nid}:${ein.roadId}${ein.dir}`;
          mkEdge({ id: id2, kind: "connector", line: new Polyline(resample(pts2, 0.3)), from: nid, to: nid, cls: ein.cls, priority: 1, baseSpeed: 2.2, reverseMotion: false, visitor: false, service: ein.service && eout.service, laneHalfWidth: 1.2, uturn: true });
          link(ein.id, id2);
          link(id2, eout.id);
          continue;
        }
        const p0 = ein.line.sample(ein.line.length), p3 = eout.line.sample(0);
        const t0 = ein.line.tangent(ein.line.length, 1.2), t3 = eout.line.tangent(0, 1.2);
        const dd = dist(p0, p3);
        const turn = Math.abs(Math.atan2(t0.x * t3.y - t0.y * t3.x, dot(t0, t3)));
        const h = dd * (turn > 1.2 ? 0.5 : 0.42);
        const pts = cubicBezier(p0, add(p0, mul(t0, h)), sub(p3, mul(t3, h)), p3, 0.3);
        const id = `CN:${nid}:${ein.roadId}${ein.dir}>${eout.roadId}${eout.dir}`;
        const visitor = ein.visitor && eout.visitor, service = ein.service && eout.service;
        mkEdge({ id, kind: "connector", line: new Polyline(resample(pts, 0.3)), from: nid, to: nid, cls: ein.cls, priority: ein.priority, baseSpeed: Math.min(ein.baseSpeed, eout.baseSpeed), reverseMotion: false, visitor, service, laneHalfWidth: 1.45 });
        link(ein.id, id);
        link(id, eout.id);
      }
    } else if (n.kind === "deadend") {
      const ins = incoming(nid), outs = outgoing(nid);
      if (ins.length !== 1 || outs.length !== 1) {
        validation.push({ level: "warn", msg: `Doodlopend punt ${nid} heeft geen enkele in/uit-rijstrook` });
        continue;
      }
      const ein = ins[0], eout = outs[0];
      const C = nodes.get(nid).pos;
      const P0 = ein.line.sample(ein.line.length), P3 = eout.line.sample(0);
      const f = ein.line.tangent(ein.line.length, 1.5), r = rightOf(f);
      const R = n.turnRadiusM ?? 6;
      const pts = [P0, add(P0, mul(f, 1.2))];
      for (let a = -55; a <= 235; a += 10) {
        const th = a * Math.PI / 180;
        pts.push(add(C, add(mul(r, R * Math.cos(th)), mul(f, R * Math.sin(th)))));
      }
      pts.push(sub(P3, mul(eout.line.tangent(0, 1.5), 1.2)), P3);
      const id = `LP:${nid}`;
      mkEdge({ id, kind: "loop", line: new Polyline(resample(catmullRom(pts, 0.3), 0.3)), from: nid, to: nid, cls: ein.cls, priority: 1, baseSpeed: 3.2, reverseMotion: false, visitor: ein.visitor, service: ein.service, laneHalfWidth: 1.45 });
      link(ein.id, id);
      link(id, eout.id);
      const srf = net.roads.find((r2) => r2.id === ein.roadId)?.surface;
      roads.push({ id: `circle:${nid}`, name: "Keerlus", cls: ein.cls, center: [C], halfWidth: [R + (srf === "pavers" ? 1.1 : 1.7)], surface: srf });
    }
  }
  function link(a, b) {
    const A = edges.get(a), B = edges.get(b);
    if (!A.next.includes(b)) A.next.push(b);
    if (!B.prev.includes(a)) B.prev.push(a);
  }
  for (const e of edges.values()) {
    if (e.kind === "lane") {
      for (const e2 of edges.values()) if (e2.kind === "lane" && e2.from === e.to && e.to.startsWith("AT:")) link(e.id, e2.id);
    }
    if (e.kind === "driveway") {
      for (const p of edges.values()) if (p.kind === "lane" && p.to === e.from) link(p.id, e.id);
    }
    if (e.kind === "reverse") {
      for (const n2 of edges.values()) if (n2.kind === "lane" && n2.from === e.to) link(e.id, n2.id);
    }
  }
  for (const [a, b] of crossLinks) {
    if (edges.has(b)) link(a, b);
    else for (const n2 of edges.values()) if (n2.kind === "lane" && n2.from === b) link(a, n2.id);
  }
  for (const e of edges.values()) {
    const n = Math.max(2, Math.ceil(e.line.length) + 1);
    const vm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const kappa = Math.max(e.line.curvature(Math.min(i, e.line.length), 2), 1e-4);
      vm[i] = Math.min(e.baseSpeed, Math.sqrt(A_LAT / kappa));
    }
    e.vmax = vm;
  }
  const gates = /* @__PURE__ */ new Map();
  for (const g of net.gates) {
    const laneId = (g.lane === "forward" ? laneOf[g.road]?.f : laneOf[g.road]?.b) ?? `${g.road}:${g.lane === "forward" ? "f" : "b"}`;
    const e = edges.get(laneId);
    if (!e) {
      validation.push({ level: "warn", msg: `Slagboom ${g.id}: rijstrook ${laneId} niet gevonden` });
      continue;
    }
    const sp = toWorld(g.stopPt);
    const stopS = e.line.project(sp).s;
    const slotS = [];
    let limitation;
    for (let i = 0; i < g.queueSlots; i++) {
      const s = stopS - VEH.carLen / 2 - 0.4 - i * g.slotSpacingM;
      if (s < VEH.carLen / 2 + 1) {
        limitation = `Slagboom ${g.id}: slechts ${i} van ${g.queueSlots} opstelplaatsen passen op de rijstrook (${stopS.toFixed(1)} m beschikbaar).`;
        break;
      }
      slotS.push(s);
    }
    if (limitation) validation.push({ level: "warn", msg: limitation });
    else validation.push({ level: "info", msg: `Slagboom ${g.id}: ${slotS.length} opstelplaatsen x ${g.slotSpacingM} m, stopstreep op s=${stopS.toFixed(1)} m van ${laneId}` });
    const P = e.line.sample(stopS), t = e.line.tangent(stopS, 1), r = rightOf(t);
    for (let i = Math.max(0, Math.floor(stopS - 14)); i < Math.min(e.vmax.length, Math.ceil(stopS + 10)); i++) e.vmax[i] = Math.min(e.vmax[i], 2.8);
    const side = g.armSide === "right" ? 1 : -1;
    const armPivot = add(P, mul(r, 1.75 * side));
    const crossLen = 3;
    const crossingPoly = [add(P, mul(r, -1.5)), add(P, mul(r, 1.5)), add(add(P, mul(r, 1.5)), mul(t, crossLen)), add(add(P, mul(r, -1.5)), mul(t, crossLen))];
    gates.set(g.id, {
      id: g.id,
      direction: g.direction,
      staff: !!g.staff,
      edge: laneId,
      stopS,
      crossLen,
      slotS,
      slotSpacing: g.slotSpacingM,
      queueSlots: slotS.length,
      armPivot,
      armDir: mul(r, -side),
      armLen: 3.4,
      laneDir: t,
      openSec: g.openSec,
      closeSec: g.closeSec,
      stopPoint: { x: P.x, y: P.y },
      kiosk: add(add(P, mul(r, 2.1 * side)), mul(t, -1.2)),
      crossingPoly,
      limitation,
      label: g.label ?? g.id
    });
  }
  const portals = /* @__PURE__ */ new Map();
  for (const [nid, n] of Object.entries(net.nodes)) {
    if (n.kind !== "portal") continue;
    const spawn = [...edges.values()].find((e) => e.kind === "lane" && e.from === nid);
    const despawn = [...edges.values()].find((e) => e.kind === "lane" && e.to === nid);
    portals.set(nid, { id: nid, node: nid, kind: n.portal ?? "public", spawnEdge: spawn?.id, despawnEdge: despawn?.id, label: n.label ?? nid });
  }
  const zones = [];
  const memberSamples = (e, s0, s1) => {
    const out = [];
    for (let s = s0; s <= s1 + 1e-6; s += 0.6) {
      const p = e.line.sample(s);
      out.push({ x: p.x, y: p.y });
    }
    return out;
  };
  const conns = [...edges.values()].filter((e) => e.kind === "connector");
  for (let i = 0; i < conns.length; i++) for (let j = i + 1; j < conns.length; j++) {
    const a = conns[i], b = conns[j];
    if (a.from !== b.from) continue;
    if (a.prev[0] === b.prev[0]) continue;
    const merge = a.next[0] === b.next[0];
    const ba = a.line.bbox, bb = b.line.bbox;
    const gap = Math.hypot(Math.max(ba.x0 - bb.x1, bb.x0 - ba.x1, 0), Math.max(ba.y0 - bb.y1, bb.y0 - ba.y1, 0));
    if (!merge && gap > TURN_CLEARANCE) continue;
    const dmin = polylineDistance(a.line, b.line);
    const turns = (e) => {
      const t0 = e.line.tangent(0, 1), t1 = e.line.tangent(e.line.length, 1);
      return Math.abs(Math.atan2(cross(t0, t1), t0.x * t1.x + t0.y * t1.y)) > 0.5;
    };
    if (!merge && dmin > VEH.carWid + 0.6 && !(dmin < TURN_CLEARANCE && (turns(a) || turns(b)))) continue;
    const z = {
      id: `Z:${a.from}:${zones.length}`,
      kind: "junction",
      node: a.from,
      members: [
        { edge: a.id, s0: 0, s1: a.line.length, stream: a.id, prio: a.priority, samples: memberSamples(a, 0, a.line.length) },
        { edge: b.id, s0: 0, s1: b.line.length, stream: b.id, prio: b.priority, samples: memberSamples(b, 0, b.line.length) }
      ],
      exclusive: /* @__PURE__ */ new Set([a.id, b.id]),
      approachDir: { [a.id]: a.line.tangent(0, 1), [b.id]: b.line.tangent(0, 1) },
      approachPos: { [a.id]: a.line.sample(0), [b.id]: b.line.sample(0) }
    };
    zones.push(z);
  }
  const byCluster = /* @__PURE__ */ new Map();
  for (const s of stalls.values()) (byCluster.get(s.clusterId) ?? byCluster.set(s.clusterId, []).get(s.clusterId)).push(s);
  for (const [cid, sts] of byCluster) {
    const z = { id: `ZP:${cid}`, kind: "parking", node: cid, members: [], exclusive: /* @__PURE__ */ new Set(), approachDir: {}, approachPos: {} };
    const attachPts = sts.flatMap((s) => [s.attachNode, ...s.inEdges.slice(1).map((id) => edges.get(id).from)]).map((n) => nodes.get(n).pos);
    const near = (p) => attachPts.some((a) => dist(a, p) < 11);
    for (const e of edges.values()) {
      if (e.kind !== "lane") continue;
      if (!attachPts.some((a) => e.line.bboxDist(a) < 11)) continue;
      let s0 = -1, s1 = -1;
      for (let s = 0; s <= e.line.length; s += 0.5) {
        if (near(e.line.sample(s))) {
          if (s0 < 0) s0 = s;
          s1 = s;
        }
      }
      if (s0 < 0) continue;
      const stream = `lane:${e.roadId}:${e.dir}`;
      z.members.push({ edge: e.id, s0, s1, stream, prio: 2, samples: memberSamples(e, s0, s1) });
      z.approachDir[stream] = e.line.tangent(s0, 1);
      z.approachPos[stream] = e.line.sample(s0);
    }
    for (const s of sts) {
      const ie = edges.get(s.inEdge), oe = edges.get(s.outEdge);
      z.members.push({ edge: ie.id, s0: 0, s1: Math.min(4, ie.line.length), stream: `in:${s.id}`, prio: 1, samples: memberSamples(ie, 0, Math.min(4, ie.line.length)) });
      z.members.push({ edge: oe.id, s0: 0, s1: oe.line.length, stream: `out:${s.id}`, prio: 0, samples: memberSamples(oe, 0, oe.line.length) });
      z.exclusive.add(`out:${s.id}`);
      for (const id of s.inEdges.slice(1)) {
        const e = edges.get(id);
        z.members.push({ edge: id, s0: 0, s1: e.line.length, stream: `xin:${s.id}`, prio: 0, samples: memberSamples(e, 0, e.line.length) });
        z.exclusive.add(`xin:${s.id}`);
      }
      for (const id of s.outEdges.slice(1)) {
        const e = edges.get(id);
        z.members.push({ edge: id, s0: 0, s1: e.line.length, stream: `xrv:${s.id}`, prio: 0, samples: memberSamples(e, 0, e.line.length) });
        z.exclusive.add(`xrv:${s.id}`);
        const xo = edges.get(e.next[0] ?? "");
        if (xo) {
          z.members.push({ edge: xo.id, s0: 0, s1: xo.line.length, stream: `xout:${s.id}`, prio: 0, samples: memberSamples(xo, 0, xo.line.length) });
          z.exclusive.add(`xout:${s.id}`);
        }
      }
    }
    zones.push(z);
  }
  for (const e of edges.values()) {
    if (e.kind !== "loop") continue;
    zones.push({
      id: `ZL:${e.from}`,
      kind: "junction",
      node: e.from,
      members: [{ edge: e.id, s0: 0, s1: e.line.length, stream: "loop", prio: 1, samples: memberSamples(e, 0, e.line.length) }],
      exclusive: /* @__PURE__ */ new Set(["loop"]),
      approachDir: {},
      approachPos: {},
      single: true
    });
  }
  const zonesByEdge = /* @__PURE__ */ new Map();
  for (const z of zones) for (const m of z.members) (zonesByEdge.get(m.edge) ?? zonesByEdge.set(m.edge, []).get(m.edge)).push({ zone: z, member: m });
  const laneEdges = [...edges.values()].filter((e) => e.kind === "lane" || e.kind === "loop");
  const houses = sector.houses.map((h) => {
    const pos = toWorld(h.pt);
    let best = { d: Infinity, p: pos };
    for (const e of laneEdges) {
      if (e.line.bboxDist(pos) >= best.d) continue;
      const pr = e.line.project(pos);
      if (pr.d < best.d) {
        const q = e.line.sample(pr.s);
        best = { d: pr.d, p: { x: q.x, y: q.y } };
      }
    }
    let front = norm(sub(best.p, pos));
    if (best.d > 40) front = { x: 0, y: 1 };
    const rot = (h.pdfRotationDeg ?? 0) * Math.PI / 180;
    let snap = front, bestDot = h.frontDeg !== void 0 ? 2 : -2;
    if (h.frontDeg !== void 0) snap = { x: Math.cos(h.frontDeg * Math.PI / 180), y: Math.sin(h.frontDeg * Math.PI / 180) };
    for (let q = 0; q < 4 && h.frontDeg === void 0; q++) {
      const a = rot + q * Math.PI / 2;
      const c = { x: Math.cos(a), y: Math.sin(a) };
      const dd = dot(c, front);
      if (dd > bestDot) {
        bestDot = dd;
        snap = c;
      }
    }
    const st = stallsByHouse.get(h.number);
    return {
      id: h.id,
      number: h.number,
      legendType: h.legendType,
      typeConfidence: h.typeConfidence,
      pos,
      rotation: Math.atan2(snap.y, snap.x),
      front: snap,
      petsAllowed: !!h.petsAllowed,
      focus: !!st,
      door: add(pos, mul(snap, 4.2)),
      stallId: st?.id
    };
  });
  const roadLike = [...edges.values()].filter((e) => e.kind === "lane" || e.kind === "loop" || e.kind === "connector" && !e.uturn);
  const need = (e) => e.kind === "loop" ? 2.7 : 2.4;
  const padPolys = [...stalls.values()].map((st) => ({ pts: st.pad, c: mul(st.pad.reduce((q, w) => add(q, w), { x: 0, y: 0 }), 1 / st.pad.length) }));
  const sizes = houses.map((hs, i) => houseSize(hs.legendType, sector.houses[i].footprintPts ? sector.houses[i].footprintPts * k : void 0, hs.number));
  houses.forEach((hs, i) => {
    const fixed = sector.houses[i].scale;
    if (fixed) sizes[i].scale = Math.max(0.5, Math.min(1.2, fixed));
    hs.scale = sizes[i].scale;
  });
  const locked = new Set(houses.map((_, i) => i).filter((i) => sector.houses[i].locked));
  const start = houses.map((hs) => ({ ...hs.pos }));
  const fp = (i) => houseFootprint(houses[i].pos, houses[i].front, sizes[i], houses[i].number);
  const body = (i) => houseFootprint(houses[i].pos, houses[i].front, sizes[i], houses[i].number, { patio: false });
  const nearEdges = houses.map((hs) => roadLike.filter((e) => e.line.bboxDist(hs.pos) < 30));
  const nearPads = houses.map((hs) => padPolys.filter((pd) => dist(pd.c, hs.pos) < 30));
  const nearHouses = houses.map((hs, i) => houses.map((_, j) => j).filter((j) => j !== i && dist(houses[j].pos, hs.pos) < 30));
  const open = new Set(houses.map((_, i) => i).filter((i) => !locked.has(i)));
  for (let iter = 0; iter < 120 && open.size; iter++) {
    for (const i of [...open]) {
      const f = fp(i);
      const pts = footprintSamples(f, 6, 4);
      let px = 0, py = 0, hit = false;
      const c = { x: f.cx, y: f.cy };
      for (const e of nearEdges[i]) {
        if (e.line.bboxDist(c) > f.hl + f.hw + 3) continue;
        const nd = need(e);
        let pen = 0;
        for (const q of pts) {
          const d = e.line.project(q).d;
          if (d < nd) pen = Math.max(pen, nd - d);
        }
        if (!pen) continue;
        let dx, dy;
        if (e.kind === "loop") {
          const nc = nodes.get(e.from).pos;
          dx = c.x - nc.x;
          dy = c.y - nc.y;
        } else {
          const on = e.line.sample(e.line.project(c).s);
          dx = c.x - on.x;
          dy = c.y - on.y;
        }
        let l2 = Math.hypot(dx, dy);
        if (l2 < 0.2) {
          dx = -houses[i].front.x;
          dy = -houses[i].front.y;
          l2 = 1;
        }
        px += dx / l2 * pen;
        py += dy / l2 * pen;
        hit = true;
      }
      for (const pd of nearPads[i]) {
        for (const q of pts) if (pointInPolygon(q, pd.pts)) {
          const dx = f.cx - pd.c.x, dy = f.cy - pd.c.y, l2 = Math.hypot(dx, dy) || 1;
          px += dx / l2 * 0.5;
          py += dy / l2 * 0.5;
          hit = true;
        }
      }
      const bi = body(i);
      for (const j of nearHouses[i]) {
        if (obbOverlap(bi, body(j), 0.3)) {
          const dx = houses[i].pos.x - houses[j].pos.x, dy = houses[i].pos.y - houses[j].pos.y, l2 = Math.hypot(dx, dy) || 1;
          px += dx / l2 * (locked.has(j) ? 1.2 : 0.6);
          py += dy / l2 * (locked.has(j) ? 1.2 : 0.6);
          hit = true;
          if (!locked.has(j)) open.add(j);
        }
      }
      if (!hit) {
        open.delete(i);
        continue;
      }
      if ((dist(houses[i].pos, start[i]) > 9 || iter > 40) && !sector.houses[i].scale && sizes[i].scale > 0.66 && iter % 6 === 5) {
        sizes[i].scale = Math.max(0.65, sizes[i].scale - 0.05);
        houses[i].scale = sizes[i].scale;
      }
      if (iter > 60) {
        const sgn = houses[i].number % 2 ? 1 : -1, m = Math.max(0.5, Math.hypot(px, py));
        px += -houses[i].front.y * sgn * m;
        py += houses[i].front.x * sgn * m;
      }
      const l = Math.hypot(px, py) || 1, step = Math.max(0.15, Math.min(0.5, l));
      houses[i].pos = add(houses[i].pos, { x: px / l * step, y: py / l * step });
    }
  }
  const clear = (i) => {
    const f = fp(i), pts = footprintSamples(f, 6, 4), bi = body(i);
    if (nearEdges[i].some((e) => e.line.bboxDist({ x: f.cx, y: f.cy }) <= f.hl + f.hw + 3 && pts.some((q) => e.line.project(q).d < need(e)))) return false;
    if (nearPads[i].some((pd) => pts.some((q) => pointInPolygon(q, pd.pts)))) return false;
    return !nearHouses[i].some((j) => obbOverlap(bi, body(j), 0.3));
  };
  for (const i of [...open]) {
    found: for (let r = 1; r <= 18; r++) for (let a = 0; a < 24; a++) {
      const th = a / 24 * Math.PI * 2;
      houses[i].pos = { x: start[i].x + Math.cos(th) * r, y: start[i].y + Math.sin(th) * r };
      if (clear(i)) {
        open.delete(i);
        break found;
      }
    }
    if (open.has(i)) houses[i].pos = start[i];
  }
  houses.forEach((hs, i) => {
    const moved = dist(hs.pos, start[i]);
    if (moved > 0.3) hs.adjusted = `${moved.toFixed(1)} m verschoven zodat het huis vrij van weg, kruising, parkeervak en buren staat`;
    hs.door = add(hs.pos, mul(hs.front, sizes[i].doorM * sizes[i].scale));
  });
  for (const i of open) {
    const f = fp(i), pts = footprintSamples(f, 6, 4);
    const roadsHit = nearEdges[i].filter((e) => pts.some((q) => e.line.project(q).d < need(e))).map((e) => e.id);
    const padsHit = nearPads[i].filter((pd) => pts.some((q) => pointInPolygon(q, pd.pts))).length;
    const housesHit = nearHouses[i].filter((j) => obbOverlap(body(i), body(j), 0.3)).map((j) => houses[j].number);
    validation.push({ level: "warn", msg: `Huis ${houses[i].number}: geen vrije plek gevonden (weg: ${roadsHit.slice(0, 3).join(",") || "-"}; vakken: ${padsHit}; buren: ${housesHit.join(",") || "-"})` });
  }
  for (const i of locked) if (!clear(i)) validation.push({ level: "warn", msg: `Huis ${houses[i].number}: met de hand vastgezet, maar raakt een weg, parkeervak of buurhuis` });
  for (const hs of houses) if (hs.adjusted) validation.push({ level: "info", msg: `Huis ${hs.number}: ${hs.adjusted}` });
  for (const e of edges.values()) {
    if (e.next.length === 0 && !e.to.startsWith("P_") && e.kind !== "driveway" && e.cls !== "scenery")
      validation.push({ level: "warn", msg: `Rijstrook ${e.id} heeft geen vervolg (doodlopend zonder keerlus)` });
  }
  const viewW = (sector.viewPts[2] - sector.viewPts[0]) * k, viewH = (sector.viewPts[3] - sector.viewPts[1]) * k;
  return { edges, nodes, zones, zonesByEdge, stalls, stallsByHouse, gates, portals, roads, islands, houses, toWorld, bounds: { w: viewW, h: viewH }, validation };
}
function visitorPortal(net) {
  return [...net.portals.values()].filter((p) => p.kind === "public").map((p) => p.id).sort()[0] ?? "";
}
function findRoute(net, fromEdge, toEdge, kind, opts = {}) {
  const gateEdges = new Set([...net.gates.values()].filter((g) => !g.staff).map((g) => g.edge));
  const allowed = (e) => kind === "visitor" ? e.visitor : e.service;
  const distM = /* @__PURE__ */ new Map([[fromEdge, 0]]);
  const prev = /* @__PURE__ */ new Map();
  const open = new MinHeap();
  open.push(0, fromEdge);
  const done = /* @__PURE__ */ new Set();
  while (open.size) {
    const [d, id] = open.pop();
    if (done.has(id)) continue;
    done.add(id);
    if (id === toEdge) break;
    const e = net.edges.get(id);
    for (const nid of e.next) {
      const n = net.edges.get(nid);
      if (!allowed(n) && nid !== toEdge) continue;
      if (n.kind === "driveway" && nid !== toEdge) continue;
      if (n.kind === "reverse") continue;
      if (n.uturn && !opts.uturn) continue;
      const nd = d + e.line.length + (kind === "service" && gateEdges.has(nid) ? 2e4 : 0);
      if (nd < (distM.get(nid) ?? Infinity)) {
        distM.set(nid, nd);
        prev.set(nid, id);
        open.push(nd, nid);
      }
    }
  }
  if (!done.has(toEdge)) return null;
  const path = [toEdge];
  while (path[0] !== fromEdge) {
    const p = prev.get(path[0]);
    if (!p) return null;
    path.unshift(p);
  }
  return path;
}
var MinHeap = class {
  k = [];
  v = [];
  get size() {
    return this.k.length;
  }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = i - 1 >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    if (!k.length) return void 0;
    const top = [k[0], v[0]];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (; ; ) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mk = lk;
        if (l < n && k[l] < mk) {
          m = l;
          mk = k[l];
        }
        if (r < n && k[r] < mk) {
          m = r;
          mk = k[r];
        }
        if (m === i) break;
        k[i] = k[m];
        v[i] = v[m];
        i = m;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
};

// src/shared/mapdoc.ts
var MAP_FORMAT = "harderwold-map";
var MAP_SCHEMA = 1;
var isPt = (p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === "number" && Number.isFinite(v));
function checkBundle(b) {
  const out = [];
  const err = (msg, ref) => out.push({ level: "error", msg, ref });
  const x = b;
  if (!x || typeof x !== "object") return [{ level: "error", msg: "Geen kaartdocument" }];
  if (x.format !== MAP_FORMAT) err(`Onbekend formaat (verwacht "${MAP_FORMAT}")`);
  if (x.schema !== MAP_SCHEMA) err(`Onbekende schemaversie ${x.schema} (verwacht ${MAP_SCHEMA})`);
  const n = x.network, p = x.park;
  if (!n || typeof n !== "object" || !n.nodes || !Array.isArray(n.roads) || !Array.isArray(n.gates)) {
    err("Wegennet ontbreekt of is onvolledig");
    return out;
  }
  if (!p || typeof p !== "object" || !Array.isArray(p.houses) || !Array.isArray(p.parkingClusters)) {
    err("Parkgegevens ontbreken of zijn onvolledig");
    return out;
  }
  if (!(p.metersPerPt > 0.2 && p.metersPerPt < 10)) err(`Schaal ${p.metersPerPt} m/pt is onwaarschijnlijk (0,2 - 10)`);
  if (!isPt(p.originPt) || !Array.isArray(p.viewPts) || p.viewPts.length !== 4) err("originPt of viewPts ongeldig");
  for (const [id, nd] of Object.entries(n.nodes)) if (!isPt(nd.pt)) err(`Knoop ${id}: ongeldige positie`, { kind: "node", id });
  const roadIds = /* @__PURE__ */ new Set();
  for (const r of n.roads) {
    if (roadIds.has(r.id)) err(`Weg-id ${r.id} komt dubbel voor`, { kind: "road", id: r.id });
    roadIds.add(r.id);
    if (!n.nodes[r.from] || !n.nodes[r.to]) err(`Weg ${r.id}: knoop ${!n.nodes[r.from] ? r.from : r.to} bestaat niet`, { kind: "road", id: r.id });
    if (r.from === r.to) err(`Weg ${r.id} begint en eindigt in dezelfde knoop`, { kind: "road", id: r.id });
    if (!Array.isArray(r.pts) || !r.pts.every(isPt)) err(`Weg ${r.id}: ongeldige tussenpunten`, { kind: "road", id: r.id });
    if (!["public", "arrival", "park", "service", "scenery"].includes(r.class)) err(`Weg ${r.id}: onbekende klasse ${r.class}`, { kind: "road", id: r.id });
    if (r.oneway !== void 0 && r.oneway !== "f" && r.oneway !== "b") err(`Weg ${r.id}: eenrichting moet 'f' of 'b' zijn`, { kind: "road", id: r.id });
    if (!(r.speedKmh > 0 && r.speedKmh <= 80)) err(`Weg ${r.id}: snelheid ${r.speedKmh} km/u buiten 1-80`, { kind: "road", id: r.id });
  }
  const gateIds = /* @__PURE__ */ new Set();
  for (const g of n.gates) {
    if (gateIds.has(g.id)) err(`Slagboom-id ${g.id} komt dubbel voor`, { kind: "gate", id: g.id });
    gateIds.add(g.id);
    const r = n.roads.find((q) => q.id === g.road);
    if (!r) err(`Slagboom ${g.id}: weg ${g.road} bestaat niet`, { kind: "gate", id: g.id });
    else if (r.oneway && r.oneway === "f" !== (g.lane === "forward")) err(`Slagboom ${g.id} staat op de rijstrook die op eenrichtingsweg ${r.id} niet bestaat`, { kind: "gate", id: g.id });
    if (!isPt(g.stopPt)) err(`Slagboom ${g.id}: ongeldige stopstreep`, { kind: "gate", id: g.id });
    if (!(Number.isInteger(g.queueSlots) && g.queueSlots >= 1 && g.queueSlots <= 12)) err(`Slagboom ${g.id}: opstelplaatsen moet 1-12 zijn`, { kind: "gate", id: g.id });
    if (!(g.slotSpacingM >= 5.5 && g.slotSpacingM <= 12)) err(`Slagboom ${g.id}: afstand opstelplaatsen moet 5,5-12 m zijn (auto 4,7 m + ruimte)`, { kind: "gate", id: g.id });
  }
  if (!n.gates.some((g) => g.direction === "inbound" && !g.staff) || !n.gates.some((g) => g.direction === "outbound" && !g.staff)) err("Er is minstens \xE9\xE9n inrij- en \xE9\xE9n uitrijslagboom voor bezoekers nodig");
  for (const g of n.gates) if (g.staff && n.roads.find((r) => r.id === g.road)?.class !== "service") err(`Personeelsslagboom ${g.id} moet op een dienstweg staan`, { kind: "gate", id: g.id });
  const nums = /* @__PURE__ */ new Map();
  for (const h of p.houses) {
    if (!isPt(h.pt)) err(`Huis ${h.number}: ongeldige positie`, { kind: "house", id: String(h.number) });
    nums.set(h.number, (nums.get(h.number) ?? 0) + 1);
    if (h.frontDeg !== void 0 && !Number.isFinite(h.frontDeg)) err(`Huis ${h.number}: ongeldige voorkant`, { kind: "house", id: String(h.number) });
    if (h.scale !== void 0 && !(h.scale >= 0.5 && h.scale <= 1.2)) err(`Huis ${h.number}: schaal moet 0,5-1,2 zijn`, { kind: "house", id: String(h.number) });
  }
  for (const [num, c] of nums) if (c > 1) err(`Huisnummer ${num} komt ${c} keer voor`, { kind: "house", id: String(num) });
  const clusterIds = /* @__PURE__ */ new Set();
  for (const c of p.parkingClusters) {
    if (clusterIds.has(c.id)) err(`Parkeercluster ${c.id} komt dubbel voor`, { kind: "parking", id: c.id });
    clusterIds.add(c.id);
    if (!isPt(c.pt)) err(`Parkeercluster ${c.id}: ongeldige positie`, { kind: "parking", id: c.id });
    if (!(Number.isInteger(c.stalls) && c.stalls >= 1 && c.stalls <= 40)) err(`Parkeercluster ${c.id}: aantal vakken 1-40`, { kind: "parking", id: c.id });
    for (const s of c.serves ?? []) if (!nums.has(s)) out.push({ level: "warn", msg: `Parkeercluster ${c.id} bedient huis ${s}, dat niet op de kaart staat`, ref: { kind: "parking", id: c.id } });
  }
  return out;
}

// src/sim/diagnose.ts
function toPtFn(b) {
  const k = b.park.metersPerPt, o = b.park.originPt;
  return (v) => [+(v.x / k + o[0]).toFixed(2), +(v.y / k + o[1]).toFixed(2)];
}
function buildFromBundle(b) {
  return buildNetwork(b.network, b.park);
}
var routeLen = (net, r) => r.reduce((n, id) => n + net.edges.get(id).line.length, 0);
function houseRoutes(net, house) {
  const st = net.stallsByHouse.get(house);
  const portal = net.portals.get(visitorPortal(net));
  if (!st || !portal?.spawnEdge || !portal.despawnEdge) return null;
  const pick = (dir, from, to) => {
    let best = null;
    for (const g of net.gates.values()) {
      if (g.direction !== dir || g.staff) continue;
      const a = findRoute(net, from, g.edge, "visitor"), c = a ? findRoute(net, g.edge, to, "visitor") : null;
      if (!a || !c) continue;
      const route = [...a, ...c.slice(1)], len = routeLen(net, route);
      if (!best || len < best.len) best = { id: g.id, route, len };
    }
    return best;
  };
  return { in: pick("inbound", portal.spawnEdge, st.inEdge), out: pick("outbound", st.outEdge, portal.despawnEdge) };
}
function routePts(net, b, route) {
  const toPt = toPtFn(b), out = [];
  for (const id of route) {
    const pts = net.edges.get(id).line.pts;
    const step = Math.max(1, Math.floor(pts.length / 40));
    for (let i = 0; i < pts.length; i += step) out.push(toPt(pts[i]));
  }
  return out;
}
function diagnose(b) {
  const t0 = Date.now();
  const problems = checkBundle(b);
  const empty = { ok: false, problems, summary: { houses: 0, stalls: 0, housesWithStall: 0, unreachable: 0, adjustedHouses: 0, farStalls: 0, gateUse: {}, buildMs: 0 }, derived: { houses: [], stalls: [], gates: [] } };
  if (problems.some((p) => p.level === "error")) return { diag: empty, net: null };
  let net;
  try {
    net = buildFromBundle(b);
  } catch (e) {
    problems.push({ level: "error", msg: `Wegennet kan niet worden opgebouwd: ${e.message}` });
    return { diag: { ...empty, problems }, net: null };
  }
  for (const v of net.validation) {
    const h = v.msg.match(/^Huis (\d+)/), g = v.msg.match(/^Slagboom ([\w-]+)/), r = v.msg.match(/^Rijstrook ([^:~\s]+)/);
    const ref = h ? { kind: "house", id: h[1] } : g ? { kind: "gate", id: g[1] } : r ? { kind: "road", id: r[1] } : void 0;
    problems.push({ level: v.level, msg: v.msg, ref });
  }
  const toPt = toPtFn(b);
  const gateUse = {};
  let unreachable = 0, farStalls = 0;
  const houses = net.houses.map((h, i) => {
    const st = net.stallsByHouse.get(h.number);
    const src = b.park.houses[i];
    const d = {
      number: h.number,
      pt: toPt(h.pos),
      frontDeg: +(Math.atan2(h.front.y, h.front.x) * 180 / Math.PI).toFixed(1),
      scale: +(h.scale ?? 1).toFixed(2),
      adjustedM: +Math.hypot(h.pos.x - (src.pt[0] - b.park.originPt[0]) * b.park.metersPerPt, h.pos.y - (src.pt[1] - b.park.originPt[1]) * b.park.metersPerPt).toFixed(1)
    };
    if (!st) {
      problems.push({ level: "error", msg: `Huis ${h.number} heeft geen parkeervak`, ref: { kind: "house", id: String(h.number) } });
      return d;
    }
    d.stallId = st.id;
    const pc = st.pad.reduce((q, w) => ({ x: q.x + w.x / st.pad.length, y: q.y + w.y / st.pad.length }), { x: 0, y: 0 });
    d.stallDistM = +Math.hypot(pc.x - h.pos.x, pc.y - h.pos.y).toFixed(1);
    if (d.stallDistM > 35) {
      farStalls++;
      problems.push({ level: "warn", msg: `Huis ${h.number}: parkeervak ligt ${d.stallDistM} m van het huis`, ref: { kind: "house", id: String(h.number) } });
    }
    const r = houseRoutes(net, h.number);
    if (!r?.in || !r.out) {
      unreachable++;
      problems.push({ level: "error", msg: `Huis ${h.number}: geen legale route ${!r?.in ? "naar binnen" : "naar buiten"} via een slagboom`, ref: { kind: "house", id: String(h.number) } });
      return d;
    }
    d.gateIn = r.in.id;
    d.gateOut = r.out.id;
    d.routeM = Math.round(r.in.len + r.out.len);
    gateUse[r.in.id] = (gateUse[r.in.id] ?? 0) + 1;
    gateUse[r.out.id] = (gateUse[r.out.id] ?? 0) + 1;
    return d;
  });
  const stalls = [...net.stalls.values()].map((s) => ({ id: s.id, house: s.houseNumber, kind: s.kind, pad: s.pad.map(toPt) }));
  const gates = [...net.gates.values()].map((g) => {
    const e = net.edges.get(g.edge);
    const src = b.network.gates.find((q) => q.id === g.id);
    return { id: g.id, label: src?.label, direction: g.direction, staff: !!g.staff, stop: toPt(e.line.sample(g.stopS)), slots: g.slotS.map((s) => toPt(e.line.sample(s))), queueSlots: g.queueSlots };
  });
  const summary = {
    houses: houses.length,
    stalls: stalls.length,
    housesWithStall: houses.filter((h) => h.stallId).length,
    unreachable,
    adjustedHouses: houses.filter((h) => h.adjustedM > 0.3).length,
    farStalls,
    gateUse,
    buildMs: Date.now() - t0
  };
  return { diag: { ok: !problems.some((p) => p.level === "error"), problems, summary, derived: { houses, stalls, gates } }, net };
}

// src/server/mapworker.ts
var built = /* @__PURE__ */ new Map();
parentPort.on("message", (m) => {
  try {
    if (m.op === "diagnose") {
      const { diag, net } = diagnose(m.bundle);
      if (net) {
        built.set(m.diagId, { net, bundle: m.bundle });
        while (built.size > 3) built.delete(built.keys().next().value);
      }
      parentPort.postMessage({ id: m.id, result: diag });
    } else {
      const b = built.get(m.diagId);
      if (!b) {
        parentPort.postMessage({ id: m.id, error: "diag_expired" });
        return;
      }
      const r = houseRoutes(b.net, m.house);
      parentPort.postMessage({ id: m.id, result: r && {
        house: m.house,
        in: r.in && { gate: r.in.id, lengthM: Math.round(r.in.len), pts: routePts(b.net, b.bundle, r.in.route) },
        out: r.out && { gate: r.out.id, lengthM: Math.round(r.out.len), pts: routePts(b.net, b.bundle, r.out.route) }
      } });
    }
  } catch (e) {
    parentPort.postMessage({ id: m.id, error: e.message });
  }
});
//# sourceMappingURL=mapworker.mjs.map
