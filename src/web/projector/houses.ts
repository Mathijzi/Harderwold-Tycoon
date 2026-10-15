// Parametric bungalow sprites (overgenomen uit de basis: zadeldak-bungalows). Worden in fase 2 vervangen door
// Harderwold-villa's (wit, plat dak, glaspuien, terras, zwembad, steiger).
import { V3, V2, P, Pv, Face, makeFace, drawFace, fillTex, mkCanvas, renderFaces, screenBounds, hrand, shadowPt, add3, mul3, sub3, cross3, norm3, dot3, facing, cam } from './proj.ts';
import { brick, timber, roofTiles, solar, concreteTiles, PPM } from './textures.ts';

export interface HouseSpec { number: number; legendType: string | null; x: number; y: number; rot: number; focus: boolean; scale?: number }
export interface Sprite { canvas: HTMLCanvasElement; x: number; y: number; key: number; kind: string; id: string; anchor: V2; topZ: number; footprint: V2[] }

interface Variant { W: number; D: number; hw: number; pitch: number; annex: boolean; solar: boolean; hottub: boolean; kids: boolean; eco: boolean; doubleGable: boolean; timberShade: number }

export function variantFor(type: string | null, num: number): Variant {
  const t = type ?? '6C';
  const cap = parseInt(t, 10) || 6;
  const r = hrand(num * 13 + 7);
  const size = cap <= 4 ? [6.4, 8.6] : cap <= 6 ? [7.0, 9.8] : cap <= 8 ? [7.6, 11] : cap <= 12 ? [8.4, 12.6] : [9.2, 15];
  return {
    W: size[0], D: size[1], hw: cap >= 10 ? 3.0 : 2.75, pitch: /B$/.test(t) ? 0.80 : 0.90,
    annex: cap >= 6 || /E|K/.test(t.slice(1)), solar: /E/.test(t.slice(1)) || r() < 0.35, hottub: /W/.test(t), kids: /K/.test(t),
    eco: /ECO/.test(t), doubleGable: cap >= 16, timberShade: r(),
  };
}

const ANTH = '#2a2d31';
const up: V3 = { x: 0, y: 0, z: 1 };

/** Build a quad face from three corners (origin, along-U, along-V) ensuring the normal points to `out`. */
function quad(p00: V3, p10: V3, p01: V3, out: V3, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, opts: Partial<Face> = {}) {
  let O = p00, Uv = sub3(p10, p00), Vv = sub3(p01, p00);
  let w = Math.hypot(Uv.x, Uv.y, Uv.z), h = Math.hypot(Vv.x, Vv.y, Vv.z);
  let U = mul3(Uv, 1 / w), V = mul3(Vv, 1 / h);
  if (dot3(cross3(U, V), out) < 0) { O = p10; U = mul3(U, -1); }
  const ww = w, hh = h;
  return makeFace(O, U, V, [{ x: 0, y: 0 }, { x: ww, y: 0 }, { x: ww, y: hh }, { x: 0, y: hh }], (ctx) => paint(ctx, ww, hh), opts);
}

export function glass(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, mullions = 1, warm = 0.15) {
  const g = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
  g.addColorStop(0, '#a9c0cf'); g.addColorStop(0.35, '#5d7586'); g.addColorStop(1, '#25313b');
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = `rgba(255,214,150,${warm})`; ctx.fillRect(x + w * 0.1, y + h * 0.45, w * 0.8, h * 0.5);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath(); ctx.moveTo(x + w * 0.15, y); ctx.lineTo(x + w * 0.45, y); ctx.lineTo(x + w * 0.1, y + h); ctx.lineTo(x - w * 0.2, y + h); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = ANTH; ctx.lineWidth = 0.08; ctx.strokeRect(x, y, w, h);
  ctx.lineWidth = 0.06;
  for (let i = 1; i < mullions; i++) { ctx.beginPath(); ctx.moveTo(x + (w * i) / mullions, y); ctx.lineTo(x + (w * i) / mullions, y + h); ctx.stroke(); }
}

export function buildHouse(h: HouseSpec, opts: { incidentGlow?: boolean } = {}) {
  const v = variantFor(h.legendType, h.number);
  const rnd = hrand(h.number * 31 + 3);
  const f: V2 = { x: Math.cos(h.rot), y: Math.sin(h.rot) };
  const r: V2 = { x: -f.y, y: f.x };
  const W = v.W, D = v.D, hw = v.hw, tp = Math.tan(v.pitch);
  const hr = hw + (W / 2) * tp;
  const oe = 0.38, og = 0.32;
  // the whole bungalow (incl. annex, patio, furniture) is scaled about its centre to fit its square in the park plan
  const k = h.scale ?? 1;
  const L = (a: number, b: number, z = 0): V3 => ({ x: h.x + (r.x * a + f.x * b) * k, y: h.y + (r.y * a + f.y * b) * k, z: z * k });
  const nr: V3 = { x: r.x, y: r.y, z: 0 }, nf: V3 = { x: f.x, y: f.y, z: 0 };
  const neg = (n: V3): V3 => ({ x: -n.x, y: -n.y, z: -n.z });
  const faces: Face[] = [];
  const mirror = rnd() < 0.5;
  const tShade = v.timberShade;
  const tTex = timber(2 + Math.floor(tShade * 3), 1);
  const bTex = brick(1 + (h.number % 3));
  const rTex = roofTiles(3 + (h.number % 2), rnd() < 0.5 ? '#4a3f37' : '#443b35');

  // ---- patio (ground) with furniture
  const patioD = 3.6, patioW = W * 0.82;
  faces.push(quad(L(-patioW / 2, D / 2 + patioD, 0.02), L(patioW / 2, D / 2 + patioD, 0.02), L(-patioW / 2, D / 2, 0.02), up,
    (ctx, w, hh) => { fillTex(ctx, concreteTiles(), PPM, w, hh); }, { key: -1e6, ambient: 0.75 }));
  const box = (a0: number, b0: number, a1: number, b1: number, z0: number, z1: number, col: string, edge = 'rgba(0,0,0,0.25)') => {
    const pts = [[a0, b0], [a1, b0], [a1, b1], [a0, b1]];
    const top = quad(L(a0, b1, z1), L(a1, b1, z1), L(a0, b0, z1), up, (ctx, w, hh) => { ctx.fillStyle = col; ctx.fillRect(0, 0, w, hh); }, { edge });
    faces.push(top);
    const sides: [number[], number[], V3][] = [[pts[0], pts[1], neg(nf)], [pts[1], pts[2], nr], [pts[2], pts[3], nf], [pts[3], pts[0], neg(nr)]];
    for (const [p0, p1, n] of sides) {
      if (!facing(n)) continue;
      faces.push(quad(L(p0[0], p0[1], z1), L(p1[0], p1[1], z1), L(p0[0], p0[1], z0), n, (ctx, w, hh) => { ctx.fillStyle = col; ctx.fillRect(0, 0, w, hh); }, { edge }));
    }
  };
  // garden table + chairs (dark aluminium), as in the photo
  const tb = D / 2 + 1.9, ta = (mirror ? 1 : -1) * W * 0.18;
  box(ta - 0.9, tb - 0.45, ta + 0.9, tb + 0.45, 0.68, 0.76, '#3a3d40');
  for (const [ca, cb] of [[-0.55, -0.85], [0.55, -0.85], [-0.55, 0.85], [0.55, 0.85]]) box(ta + ca - 0.24, tb + cb - 0.24, ta + ca + 0.24, tb + cb + 0.24, 0, 0.95, '#2b2e31');
  if (v.hottub) {
    const ha = -ta * 1.4, hb = D / 2 + 1.7;
    box(ha - 0.95, hb - 0.95, ha + 0.95, hb + 0.95, 0, 0.9, '#7a5634');
    faces.push(quad(L(ha - 0.8, hb + 0.8, 0.91), L(ha + 0.8, hb + 0.8, 0.91), L(ha - 0.8, hb - 0.8, 0.91), up, (ctx, w, hh) => { const g = ctx.createLinearGradient(0, 0, w, hh); g.addColorStop(0, '#7fd3df'); g.addColorStop(1, '#2f8fa3'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, hh); }, { noShade: true }));
  }
  if (v.kids) {
    // small sandbox with a red spade
    const sa = -ta * 1.3, sb = D / 2 + 2.4;
    box(sa - 0.8, sb - 0.8, sa + 0.8, sb + 0.8, 0, 0.25, '#9b7448');
    faces.push(quad(L(sa - 0.65, sb + 0.65, 0.26), L(sa + 0.65, sb + 0.65, 0.26), L(sa - 0.65, sb - 0.65, 0.26), up, (ctx, w, hh) => { ctx.fillStyle = '#e6cf98'; ctx.fillRect(0, 0, w, hh); ctx.fillStyle = '#d23b2a'; ctx.fillRect(w * 0.6, hh * 0.3, 0.12, 0.5); }, { noShade: true }));
  }

  // ---- annex (flat roof, timber), at the side
  const annexSide = mirror ? -1 : 1;
  const aW = 3.0, aD = Math.min(5.0, D * 0.5), aH = 2.75;
  const ab0 = -D / 2 + 0.9, ab1 = ab0 + aD;
  if (v.annex) {
    const a0 = annexSide > 0 ? W / 2 : -W / 2 - aW, a1 = annexSide > 0 ? W / 2 + aW : -W / 2;
    const outA = annexSide > 0 ? a1 : a0;
    // outer side wall
    const nS = annexSide > 0 ? nr : neg(nr);
    if (facing(nS)) faces.push(quad(L(outA, ab0, aH), L(outA, ab1, aH), L(outA, ab0, 0), nS, (ctx, w, hh) => { fillTex(ctx, tTex, PPM, w, hh); }, { edge: 'rgba(0,0,0,0.3)' }));
    // front and back of annex
    for (const [bb, n] of [[ab1, nf], [ab0, neg(nf)]] as [number, V3][]) {
      if (!facing(n)) continue;
      faces.push(quad(L(a0, bb, aH), L(a1, bb, aH), L(a0, bb, 0), n, (ctx, w, hh) => {
        fillTex(ctx, tTex, PPM, w, hh);
        if (n === nf) { glass(ctx, w * 0.22, 0.75, w * 0.5, 1.25, 2, 0.12); }
      }, { edge: 'rgba(0,0,0,0.3)' }));
    }
    faces.push(quad(L(a0, ab1, aH), L(a1, ab1, aH), L(a0, ab0, aH), up, (ctx, w, hh) => {
      ctx.fillStyle = v.eco ? '#6b8f4a' : '#45484b'; ctx.fillRect(0, 0, w, hh);
      ctx.strokeStyle = ANTH; ctx.lineWidth = 0.22; ctx.strokeRect(0.11, 0.11, w - 0.22, hh - 0.22);
    }, { ambient: 0.7 }));
  }

  // ---- main walls
  const doorSide = annexSide * -1;
  const sideWall = (sgn: number) => {
    const a = (sgn * W) / 2, n = sgn > 0 ? nr : neg(nr);
    if (!facing(n)) return;
    faces.push(quad(L(a, -D / 2, hw), L(a, D / 2, hw), L(a, -D / 2, 0), n, (ctx, w, hh) => {
      fillTex(ctx, bTex, PPM, w, hh);
      // windows; door on one side
      const flip = dot3(cross3(sub3(L(a, D / 2, 0), L(a, -D / 2, 0)), { x: 0, y: 0, z: -1 }), n) < 0;
      const at = (u: number) => (flip ? w - u : u);
      if (sgn === doorSide) {
        ctx.fillStyle = v.kids ? '#c9672c' : '#33373b'; ctx.fillRect(at(w * 0.3) - 0.5, hh - 2.15, 1.0, 2.15);
        ctx.strokeStyle = ANTH; ctx.lineWidth = 0.07; ctx.strokeRect(at(w * 0.3) - 0.5, hh - 2.15, 1.0, 2.15);
        glass(ctx, at(w * 0.62) - 0.6, 0.65, 1.2, 1.3, 2);
      } else if (!v.annex) {
        glass(ctx, at(w * 0.35) - 0.55, 0.7, 1.1, 1.3, 2); glass(ctx, at(w * 0.72) - 0.55, 0.7, 1.1, 1.3, 2);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, hh - 0.18, w, 0.18); // plinth
    }, { edge: 'rgba(0,0,0,0.35)' }));
  };
  sideWall(1); sideWall(-1);
  const gable = (front: boolean) => {
    const b = front ? D / 2 : -D / 2, n = front ? nf : neg(nf);
    if (!facing(n)) return;
    // O at top-left (seen from outside); outline = pentagon
    const left = front ? W / 2 : -W / 2; // seen from outside in front, the left-hand corner is +r
    const p0 = L(left, b, hr), p1 = L(-left, b, hr);
    const U = norm3(sub3(p1, p0)), V: V3 = { x: 0, y: 0, z: -1 };
    let O = { ...p0, z: hr }, Uu = U;
    if (dot3(cross3(U, V), n) < 0) { O = p1; Uu = mul3(U, -1); }
    const outline: V2[] = [{ x: W / 2, y: 0 }, { x: W, y: hr - hw }, { x: W, y: hr }, { x: 0, y: hr }, { x: 0, y: hr - hw }];
    faces.push(makeFace({ ...O, z: hr }, Uu, V, outline, (ctx) => {
      // lower: brick; upper triangle: vertical timber
      fillTex(ctx, bTex, PPM, W, hr);
      ctx.save(); ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W, hr - hw); ctx.lineTo(0, hr - hw); ctx.closePath(); ctx.clip();
      fillTex(ctx, tTex, PPM, W, hr); ctx.restore();
      ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(0, hr - hw - 0.06, W, 0.12);
      const m = mirror ? -1 : 1, cx = (x: number) => (m > 0 ? x : W - x);
      if (front) {
        // tall gable window, big sliding doors, timber panel with narrow window (like the photo)
        glass(ctx, cx(W * 0.5 + 0.25) - 0.45, (hr - hw) * 0.35, 0.9, (hr - hw) * 0.62, 1, 0.1);
        glass(ctx, cx(W * 0.08) - (m > 0 ? 0 : W * 0.44), hr - 2.35, W * 0.44, 2.35, 3, 0.2);
        const px = m > 0 ? W * 0.66 : W * 0.08;
        ctx.save(); ctx.beginPath(); ctx.rect(px, hr - hw + 0.06, W * 0.26, hw - 0.06); ctx.clip(); fillTex(ctx, tTex, PPM, W, hr); ctx.restore();
        glass(ctx, px + W * 0.07, hr - 2.25, W * 0.12, 1.9, 1, 0.12);
      } else {
        glass(ctx, W * 0.5 - 0.35, (hr - hw) * 0.45, 0.7, 0.8, 1, 0.05);
        glass(ctx, W * 0.25, hr - 1.9, 1.1, 1.2, 2); glass(ctx, W * 0.62, hr - 1.9, 1.1, 1.2, 2);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, hr - 0.18, W, 0.18);
    }, { edge: 'rgba(0,0,0,0.35)' }));
  };
  gable(true); gable(false);

  // ---- roof planes (tiles, optional solar), with dark fascia
  const ze = hw - oe * tp;
  const roofPlane = (sgn: number) => {
    const ridgeB = L(0, -D / 2 - og, hr), ridgeF = L(0, D / 2 + og, hr);
    const eaveB = L(sgn * (W / 2 + oe), -D / 2 - og, ze), eaveF = L(sgn * (W / 2 + oe), D / 2 + og, ze);
    const n = norm3(cross3(sub3(ridgeF, ridgeB), sub3(eaveB, ridgeB)));
    const out: V3 = { x: r.x * sgn * Math.sin(v.pitch), y: r.y * sgn * Math.sin(v.pitch), z: Math.cos(v.pitch) };
    const nn = dot3(n, out) < 0 ? mul3(n, -1) : n;
    if (!facing(nn)) return;
    const sunSide = dot3(nn, { x: -0.6, y: 0.35, z: 0.7 }) > 0.45;
    faces.push(quad(ridgeB, ridgeF, eaveB, nn, (ctx, w, hh) => {
      fillTex(ctx, rTex, PPM, w, hh);
      if ((v.solar && sunSide) || v.eco) {
        const cols = Math.max(2, Math.floor((w - 1.2) / 1.05)), rows = Math.max(1, Math.floor((hh - 1.0) / 1.75));
        const ox = (w - cols * 1.05) / 2, oy = 0.45;
        for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) fillPanel(ctx, ox + i * 1.05, oy + j * 1.75, 1.0, 1.7);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, w, 0.12); // ridge cap
      ctx.fillStyle = ANTH; ctx.fillRect(0, hh - 0.14, w, 0.14); // gutter
      ctx.fillRect(0, 0, 0.16, hh); ctx.fillRect(w - 0.16, 0, 0.16, hh); // verge boards
    }, { edge: 'rgba(0,0,0,0.5)', ambient: 0.62 }));
  };
  roofPlane(1); roofPlane(-1);
  // front fascia boards (thick dark rake as in the photo)
  for (const sgn of [1, -1]) {
    const a = L(0, D / 2 + og, hr + 0.05), b = L(sgn * (W / 2 + oe), D / 2 + og, ze);
    if (!facing(nf)) break;
    faces.push(quad(a, b, { ...a, z: a.z - 0.32 }, nf, (ctx, w, hh) => { ctx.fillStyle = ANTH; ctx.fillRect(0, 0, w, hh); }, { ambient: 0.75, key: undefined as unknown as number }));
  }
  // brick chimney column at the annex junction (photo)
  if (v.annex) {
    const ca = annexSide * (W / 2 - 0.55), cb = ab1 - 0.6;
    const zTop = hr - (Math.abs(ca) - 0.0) * tp + 1.1;
    box(ca - 0.45, cb - 0.45, ca + 0.45, cb + 0.45, hw - 0.4, zTop, '#4a3c35');
  }

  // painter's order inside the house
  for (const fc of faces) if (fc.key === undefined || Number.isNaN(fc.key)) fc.key = 0;
  faces.sort((a, b) => a.key - b.key);
  // move patio/furniture first, roof last is already guaranteed by z

  const verts: V3[] = [L(-W / 2 - oe - (v.annex ? aW : 0), -D / 2 - og, 0), L(W / 2 + oe + (v.annex ? aW : 0), -D / 2 - og, 0), L(-W / 2 - aW, D / 2 + patioD, 0), L(W / 2 + aW, D / 2 + patioD, 0), L(0, -D / 2 - og, hr + 1.4), L(0, D / 2 + og, hr + 1.4), L(-W / 2 - aW, -D / 2, hr), L(W / 2 + aW, D / 2, hr)];
  const bb = screenBounds(verts, 6);
  const c = renderFaces(faces, bb);
  if (opts.incidentGlow) { /* reserved for status overlays */ }
  // ground shadow polygon (world)
  const shadowSrc: V3[] = [L(-W / 2 - oe, -D / 2 - og, ze), L(W / 2 + oe, -D / 2 - og, ze), L(-W / 2 - oe, D / 2 + og, ze), L(W / 2 + oe, D / 2 + og, ze), L(0, -D / 2 - og, hr), L(0, D / 2 + og, hr), L(-W / 2, -D / 2, 0), L(W / 2, -D / 2, 0), L(-W / 2, D / 2, 0), L(W / 2, D / 2, 0)];
  if (v.annex) { const a1 = annexSide > 0 ? W / 2 + aW : -W / 2 - aW; shadowSrc.push(L(a1, ab0, aH), L(a1, ab1, aH), L(a1, ab0, 0), L(a1, ab1, 0)); }
  const shadow = hull(shadowSrc.map(shadowPt));
  const footprint = [L(-W / 2, -D / 2), L(W / 2, -D / 2), L(W / 2, D / 2), L(-W / 2, D / 2)].map((p) => ({ x: p.x, y: p.y }));
  const frontY = Math.max(...footprint.map((p) => p.y));
  const sprite: Sprite = { canvas: c, x: bb.x0, y: bb.y0, key: (h.y + (frontY - h.y) * 0.6) * cam.CE, kind: 'house', id: `H${h.number}`, anchor: Pv(L(0, 0, hr + 1.2)), topZ: hr, footprint };
  return { sprite, shadow, door: L(doorSide * (W / 2 + 0.6), -D / 2 + D * 0.3, 0), variant: v, patioFront: L(0, D / 2 + patioD, 0), roofTop: L(0, 0, hr) };
}

function fillPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const pat = ctx.createPattern(solar(), 'repeat')!;
  pat.setTransform(new DOMMatrix([w / (2 * PPM), 0, 0, h / (2 * PPM), x, y]));
  ctx.fillStyle = pat; ctx.fillRect(x, y, w, h);
}

export function hull(pts: V2[]): V2[] {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cr = (o: V2, a: V2, b: V2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: V2[] = [];
  for (const q of p) { while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper: V2[] = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}
export { P };
