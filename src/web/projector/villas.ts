// Harderwold villas (references/fotos): white cubic volumes with flat roofs and broad white overhangs, black frames,
// large sliding glass fronts, a balcony with a black balustrade, a grey tiled terrace on the water side, optionally a
// private pool, a timber jetty out into the canal (with a canoe or SUP) and solar panels on the roof.
// Terraced units (blocks 600-655): narrow two-storey white houses with a flat roof, side by side.
// The front faces the street (+b), the back faces the water (-b). Everything is one baked sprite per house.
import { V3, V2, Pv, Face, makeFace, renderFaces, screenBounds, hrand, shadowPt, sub3, mul3, cross3, dot3, facing, cam, fillTex } from './proj.ts';
import { concreteTiles, solar, timber, PPM } from './textures.ts';
import { glass, hull, Sprite, HouseSpec } from './houses.ts';
import { villaVariant, houseSize } from '../../shared/house.ts';

const WHITE = '#f3f3ef', WHITE_SHADE = '#e4e4df', FRAME = '#1c1e21', DECK = '#b48d63';
const up: V3 = { x: 0, y: 0, z: 1 };

export interface VillaSpec extends HouseSpec { /** metres from the house centre (backwards) to the canal, if any */ waterBack?: number; unitW?: number }

/** quad from three corners (origin, along-U, along-V) with the normal pointing to `out` */
function quad(p00: V3, p10: V3, p01: V3, out: V3, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, opts: Partial<Face> = {}) {
  let O = p00, Uv = sub3(p10, p00); const Vv = sub3(p01, p00);
  const w = Math.hypot(Uv.x, Uv.y, Uv.z), h = Math.hypot(Vv.x, Vv.y, Vv.z);
  let U = mul3(Uv, 1 / w); const V = mul3(Vv, 1 / h);
  if (dot3(cross3(U, V), out) < 0) { O = p10; U = mul3(U, -1); Uv = mul3(Uv, -1); }
  return makeFace(O, U, V, [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], (ctx) => paint(ctx, w, h), opts);
}

/** shared local frame: a = to the right (seen from the street), b = towards the street, z up */
export function frame(h: VillaSpec) {
  const f: V2 = { x: Math.cos(h.rot), y: Math.sin(h.rot) };
  const r: V2 = { x: -f.y, y: f.x };
  const k = h.scale ?? 1;
  const L = (a: number, b: number, z = 0): V3 => ({ x: h.x + (r.x * a + f.x * b) * k, y: h.y + (r.y * a + f.y * b) * k, z: z * k });
  const nr: V3 = { x: r.x, y: r.y, z: 0 }, nf: V3 = { x: f.x, y: f.y, z: 0 };
  const neg = (n: V3): V3 => ({ x: -n.x, y: -n.y, z: -n.z });
  const faces: Face[] = [];
  /** box with a painter per side ('front' = +b, 'back' = -b, 'right' = +a, 'left' = -a) */
  const box = (a0: number, b0: number, a1: number, b1: number, z0: number, z1: number,
    paint: (side: 'top' | 'front' | 'back' | 'left' | 'right', ctx: CanvasRenderingContext2D, w: number, hh: number) => void, opts: Partial<Face> = {}) => {
    faces.push(quad(L(a0, b1, z1), L(a1, b1, z1), L(a0, b0, z1), up, (ctx, w, hh) => paint('top', ctx, w, hh), opts));
    const sides: [number[], number[], V3, 'front' | 'back' | 'left' | 'right'][] = [
      [[a1, b0], [a0, b0], neg(nf), 'back'], [[a1, b1], [a1, b0], nr, 'right'], [[a0, b1], [a1, b1], nf, 'front'], [[a0, b0], [a0, b1], neg(nr), 'left']];
    for (const [p0, p1, n, side] of sides) {
      if (!facing(n)) continue;
      faces.push(quad(L(p0[0], p0[1], z1), L(p1[0], p1[1], z1), L(p0[0], p0[1], z0), n, (ctx, w, hh) => paint(side, ctx, w, hh), opts));
    }
  };
  const flat = (col: string) => (_s: string, ctx: CanvasRenderingContext2D, w: number, hh: number) => { ctx.fillStyle = col; ctx.fillRect(0, 0, w, hh); };
  const ground = (a0: number, b0: number, a1: number, b1: number, z: number, paint: (ctx: CanvasRenderingContext2D, w: number, hh: number) => void, key: number) =>
    faces.push(quad(L(a0, b1, z), L(a1, b1, z), L(a0, b0, z), up, paint, { key, ambient: 0.8 }));
  return { L, faces, box, flat, ground, nf, nr, neg, k };
}

/** white plaster wall: faint vertical gradient and a dark plinth line */
export function plaster(ctx: CanvasRenderingContext2D, w: number, hh: number) {
  const g = ctx.createLinearGradient(0, 0, 0, hh); g.addColorStop(0, WHITE); g.addColorStop(1, WHITE_SHADE);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, hh);
  ctx.fillStyle = 'rgba(40,40,40,0.35)'; ctx.fillRect(0, hh - 0.08, w, 0.08);
}
/** black-framed glass, a door leaf or a fixed panel */
export function pane(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, mullions: number, warm = 0.12) {
  glass(ctx, x, y, w, h, mullions, warm);
  ctx.strokeStyle = FRAME; ctx.lineWidth = 0.1; ctx.strokeRect(x, y, w, h);
}
/** a slab edge: thick white fascia with a thin shadow line underneath */
export function fascia(ctx: CanvasRenderingContext2D, w: number, hh: number) {
  ctx.fillStyle = '#fbfbf8'; ctx.fillRect(0, 0, w, hh);
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, hh - 0.05, w, 0.05);
}
function solarRoof(ctx: CanvasRenderingContext2D, w: number, hh: number, rows: number) {
  ctx.fillStyle = '#d9dad6'; ctx.fillRect(0, 0, w, hh);
  ctx.strokeStyle = '#bdbeb9'; ctx.lineWidth = 0.12; ctx.strokeRect(0.25, 0.25, w - 0.5, hh - 0.5); // roof upstand
  const pat = ctx.createPattern(solar(), 'repeat')!;
  const pw = 1.05, ph = 1.75, cols = Math.max(1, Math.floor((w - 1.4) / pw)), n = Math.min(rows, Math.max(1, Math.floor((hh - 1.2) / (ph + 0.5))));
  const ox = (w - cols * pw) / 2;
  for (let j = 0; j < n; j++) for (let i = 0; i < cols; i++) {
    const x = ox + i * pw, y = 0.7 + j * (ph + 0.5);
    pat.setTransform(new DOMMatrix([1 / (2 * PPM), 0, 0, ph / (2 * PPM), x, y]));
    ctx.fillStyle = pat; ctx.fillRect(x, y, pw - 0.05, ph);
  }
}
export function gravelRoof(ctx: CanvasRenderingContext2D, w: number, hh: number) {
  ctx.fillStyle = '#d6d6d1'; ctx.fillRect(0, 0, w, hh);
  ctx.strokeStyle = '#c2c2bc'; ctx.lineWidth = 0.12; ctx.strokeRect(0.25, 0.25, w - 0.5, hh - 0.5);
}

export function buildVilla(h: VillaSpec) {
  const v = villaVariant(h.number);
  const rnd = hrand(h.number * 41 + 5);
  const { L, faces, box, flat, ground, k } = frame(h);
  const W = v.W, D = v.D, H1 = 3.1, SL = 0.38; // ground floor height, slab thickness
  const tD = v.terraceD;
  // ---- grounds on the water side: terrace tiles, pool, lawn strip, jetty
  const back0 = -D / 2, tEnd = back0 - tD;
  const waterAt = h.waterBack !== undefined ? -h.waterBack : undefined;      // b of the canal edge (negative)
  const terraceEnd = waterAt !== undefined ? Math.max(tEnd, waterAt + 0.6) : tEnd;
  ground(-W / 2 - 1.2, terraceEnd, W / 2 + 1.2, back0, 0.02, (ctx, w, hh) => fillTex(ctx, concreteTiles(), PPM * 0.8, w, hh), -1e6);
  if (v.pool && back0 - terraceEnd > 4.2) {
    const pa0 = v.upperSide > 0 ? -W / 2 + 0.6 : W / 2 - 0.6 - Math.min(7, W * 0.55), pa1 = pa0 + Math.min(7, W * 0.55);
    const pb1 = back0 - 1.4, pb0 = Math.max(terraceEnd + 0.5, pb1 - 3.2);
    ground(pa0 - 0.3, pb0 - 0.3, pa1 + 0.3, pb1 + 0.3, 0.03, (ctx, w, hh) => { ctx.fillStyle = '#e9e7e0'; ctx.fillRect(0, 0, w, hh); }, -1e6 + 1);
    ground(pa0, pb0, pa1, pb1, 0.04, (ctx, w, hh) => {
      const g = ctx.createLinearGradient(0, 0, w, hh); g.addColorStop(0, '#8fe3ee'); g.addColorStop(1, '#2aa6c4');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, hh);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 0.06;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(w * (0.15 + i * 0.3), hh * 0.2); ctx.lineTo(w * (0.3 + i * 0.3), hh * 0.8); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; for (let i = 0; i < 4; i++) ctx.fillRect(0.1, 0.25 + i * 0.3, 0.9, 0.12); // steps
    }, -1e6 + 2);
    // two loungers along the pool
    for (const da of [0.6, 1.6]) box(pa1 + 0.6 + da - 0.6, pb0 + 0.6, pa1 + 0.6 + da, pb0 + 2.4, 0, 0.42, flat('#5e6164'));
  } else {
    // dining table on the terrace
    const ta = v.upperSide * W * 0.2, tb = back0 - 2.2;
    box(ta - 1.1, tb - 0.5, ta + 1.1, tb + 0.5, 0.7, 0.78, flat('#8a6a4a'));
    for (const [ca, cb] of [[-0.7, -0.9], [0, -0.9], [0.7, -0.9], [-0.7, 0.9], [0, 0.9], [0.7, 0.9]]) box(ta + ca - 0.22, tb + cb - 0.22, ta + ca + 0.22, tb + cb + 0.22, 0, 0.9, flat('#2b2d30'));
  }
  // hedges along both sides of the garden (as in the photos)
  if (v.hedge) for (const s of [-1, 1]) box(s * (W / 2 + 1.6) - 0.45, terraceEnd + 0.2, s * (W / 2 + 1.6) + 0.45, back0 + 2.5, 0, 1.3, (side, ctx, w, hh) => {
    ctx.fillStyle = side === 'top' ? '#4f7a33' : '#3d6428'; ctx.fillRect(0, 0, w, hh);
    ctx.fillStyle = 'rgba(120,170,70,0.35)'; for (let i = 0; i < 18; i++) ctx.fillRect(rnd() * w, rnd() * hh, 0.25, 0.18);
  });
  // timber jetty / deck from the end of the terrace out into the canal, with a canoe or SUP alongside
  if (waterAt !== undefined && waterAt < back0 - 1) {
    const jb1 = terraceEnd, jb0 = waterAt - 4.2, ja0 = -1.9 + v.upperSide * 1.5, ja1 = ja0 + 3.8;
    box(ja0, jb0, ja1, jb1, -0.25, 0.28, (side, ctx, w, hh) => {
      if (side === 'top') {
        ctx.fillStyle = DECK; ctx.fillRect(0, 0, w, hh);
        ctx.strokeStyle = 'rgba(70,45,25,0.45)'; ctx.lineWidth = 0.035;
        for (let x = 0.14; x < w; x += 0.14) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, hh); ctx.stroke(); }
        ctx.strokeStyle = '#7a5a3e'; ctx.lineWidth = 0.12; ctx.strokeRect(0.06, 0.06, w - 0.12, hh - 0.12);
      } else { ctx.fillStyle = '#6e5440'; ctx.fillRect(0, 0, w, hh); }
    }, { key: -1e6 + 3 });
    if (v.boat) {
      const ba = ja1 + 0.55, bc = jb0 + 1.6, len = 3.6;
      box(ba - 0.35, bc - 0.2, ba + 0.35, bc + len, 0, 0.32, (side, ctx, w, hh) => { ctx.fillStyle = side === 'top' ? '#f2f2ee' : '#d9534a'; ctx.fillRect(0, 0, w, hh); });
    }
  }
  // ---- ground floor (white box) with glass across the water side
  box(-W / 2, -D / 2, W / 2, D / 2, 0, H1, (side, ctx, w, hh) => {
    plaster(ctx, w, hh);
    if (side === 'back') {
      const n = Math.max(3, Math.round(w / 2.2)), gw = w * 0.78;
      pane(ctx, (w - gw) / 2, 0.35, gw, hh - 0.45, n, 0.2);
    } else if (side === 'front') {
      // front door (black), narrow vertical window next to it, kitchen window
      const dx = w * (v.upperSide > 0 ? 0.28 : 0.62);
      ctx.fillStyle = FRAME; ctx.fillRect(dx, hh - 2.35, 1.1, 2.35);
      pane(ctx, dx + 1.3, hh - 2.35, 0.45, 2.2, 1, 0.08);
      pane(ctx, w * (v.upperSide > 0 ? 0.62 : 0.12), 0.7, w * 0.26, 1.3, 2, 0.08);
    } else {
      pane(ctx, w * 0.25, 0.5, 2.2, hh - 0.6, 2, 0.15);
    }
  });
  // ground floor roof slab: broad white overhang, deepest over the terrace
  const s0 = H1, s1 = H1 + SL, oS = 0.55, oB = 1.6, oF = 0.45;
  box(-W / 2 - oS, -D / 2 - oB, W / 2 + oS, D / 2 + oF, s0, s1, (side, ctx, w, hh) => {
    if (side === 'top') { if (v.floors === 1 && v.solar) solarRoof(ctx, w, hh, 3); else gravelRoof(ctx, w, hh); }
    else fascia(ctx, w, hh);
  });
  let topZ = s1;
  if (v.floors === 2) {
    // upper floor: narrower, set back from the water side (balcony on the slab) and to one side
    const uW = W * 0.68, uD = D * 0.72, ua = v.upperSide * (W - uW) / 2 * 0.8, ub = D / 2 - uD / 2 - 0.2;
    const H2 = 2.9;
    box(ua - uW / 2, ub - uD / 2, ua + uW / 2, ub + uD / 2, s1, s1 + H2, (side, ctx, w, hh) => {
      plaster(ctx, w, hh);
      if (side === 'back') { const gw = w * 0.7; pane(ctx, (w - gw) / 2, 0.3, gw, hh - 0.4, 3, 0.15); }
      else if (side === 'front') { pane(ctx, w * 0.15, 0.8, w * 0.22, 1.2, 1); pane(ctx, w * 0.6, 0.8, w * 0.25, 1.2, 2); }
      else pane(ctx, w * 0.4, 0.8, 1.2, 1.3, 1);
    });
    // balcony balustrade along the back edge of the lower slab (black glass with posts)
    const bb = -D / 2 - oB + 0.15;
    box(-W / 2 - oS + 0.15, bb, W / 2 + oS - 0.15, bb + 0.06, s1, s1 + 1.05, (side, ctx, w, hh) => {
      ctx.fillStyle = side === 'top' ? '#111' : 'rgba(20,22,26,0.82)'; ctx.fillRect(0, 0, w, hh);
      ctx.fillStyle = '#000'; for (let x = 0; x < w; x += 1.4) ctx.fillRect(x, 0, 0.06, hh);
    });
    // top roof slab with overhang
    const t0 = s1 + H2, t1 = t0 + SL, o2 = 0.6;
    box(ua - uW / 2 - o2, ub - uD / 2 - o2 - 0.3, ua + uW / 2 + o2, ub + uD / 2 + o2, t0, t1, (side, ctx, w, hh) => {
      if (side === 'top') { if (v.solar) solarRoof(ctx, w, hh, 2); else gravelRoof(ctx, w, hh); } else fascia(ctx, w, hh);
    });
    topZ = t1;
  }
  return finish(h, L, faces, W, D, topZ, k, [L(-W / 2 - 2, terraceEnd - 6, 0), L(W / 2 + 2, -D / 2 - 12, 0)]);
}

/** terraced unit of the blocks 600-655: white, two storeys, flat roof; small terrace with a screen at the back */
export function buildTerraced(h: VillaSpec) {
  const { L, faces, box, ground, k } = frame(h);
  const sz = houseSize(h.legendType, h.unitW, h.number);
  const W = Math.min(6.6, (h.unitW ?? sz.W + 1.2) / (h.scale ?? 1) + 0.04), D = sz.D, H = 5.6, SL = 0.35; // full share: neighbours touch
  const rnd = hrand(h.number * 13 + 1);
  ground(-W / 2, -D / 2 - sz.patioBack, W / 2, -D / 2, 0.02, (ctx, w, hh) => fillTex(ctx, concreteTiles(), PPM * 0.8, w, hh), -1e6);
  box(-W / 2, -D / 2, W / 2, D / 2, 0, H, (side, ctx, w, hh) => {
    plaster(ctx, w, hh);
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, hh * 0.48, w, 0.06); // floor line
    if (side === 'back') { pane(ctx, w * 0.12, hh - 2.5, w * 0.76, 2.4, 3, 0.18); pane(ctx, w * 0.2, 0.6, w * 0.6, 1.4, 2); }
    else if (side === 'front') { ctx.fillStyle = FRAME; ctx.fillRect(w * 0.15, hh - 2.3, 1.0, 2.3); pane(ctx, w * 0.5, hh - 2.0, w * 0.38, 1.3, 2); pane(ctx, w * 0.25, 0.6, w * 0.5, 1.3, 2); }
  });
  box(-W / 2 - 0.15, -D / 2 - 0.7, W / 2 + 0.15, D / 2 + 0.35, H, H + SL, (side, ctx, w, hh) => { if (side === 'top') { if (rnd() < 0.5) solarRoof(ctx, w, hh, 2); else gravelRoof(ctx, w, hh); } else fascia(ctx, w, hh); });
  // dark garden screen between neighbouring terraces (as in the photo)
  box(W / 2 - 0.06, -D / 2 - sz.patioBack, W / 2, -D / 2, 0, 1.8, (_s, ctx, w, hh) => { ctx.fillStyle = '#2b2e31'; ctx.fillRect(0, 0, w, hh); });
  return finish(h, L, faces, W, D, H + SL, k, [L(-W / 2, -D / 2 - sz.patioBack - 1, 0)]);
}

function finish(h: VillaSpec, L: (a: number, b: number, z?: number) => V3, faces: Face[], W: number, D: number, topZ: number, _k: number, extra: V3[]) {
  for (const fc of faces) if (fc.key === undefined || Number.isNaN(fc.key)) fc.key = 0;
  faces.sort((a, b) => a.key - b.key);
  const ov = 2.2;
  const verts: V3[] = [L(-W / 2 - ov, -D / 2 - ov, 0), L(W / 2 + ov, -D / 2 - ov, 0), L(-W / 2 - ov, D / 2 + ov, 0), L(W / 2 + ov, D / 2 + ov, 0),
    L(-W / 2 - ov, -D / 2 - ov, topZ + 0.5), L(W / 2 + ov, D / 2 + ov, topZ + 0.5), L(-W / 2 - ov, D / 2 + ov, topZ + 0.5), L(W / 2 + ov, -D / 2 - ov, topZ + 0.5), ...extra];
  const bb = screenBounds(verts, 6);
  const c = renderFaces(faces, bb);
  const corners = [L(-W / 2, -D / 2), L(W / 2, -D / 2), L(W / 2, D / 2), L(-W / 2, D / 2)];
  const shadow = hull([...corners.map((p) => ({ x: p.x, y: p.y })), ...corners.map((p) => shadowPt({ ...p, z: topZ }))]);
  const footprint = corners.map((p) => ({ x: p.x, y: p.y }));
  const frontY = Math.max(...footprint.map((p) => p.y));
  const sprite: Sprite = { canvas: c, x: bb.x0, y: bb.y0, key: (h.y + (frontY - h.y) * 0.6) * cam.CE, kind: 'house', id: `H${h.number}`, anchor: Pv(L(0, 0, topZ + 1.2)), topZ, footprint };
  return { sprite, shadow };
}
