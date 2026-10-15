// Facility buildings built from editable "massing" data (park.json "massing"):
// one rotated rectangular block per wing (derived from the walls in AHT_Plat.pdf), each with its own
// pitched roof (standing-seam metal) or a green flat roof, and a facade style per function.
// Walls that touch a neighbouring wing are suppressed (or only drawn above the neighbour's eaves),
// so the complex reads as one coherent building without holes, stacked roofs or phantom terraces.
import { V3, V2, P, Pv, makeFace, drawFace, fillTex, mkCanvas, renderFaces, screenBounds, cam, shadowPt, facing, Face, cross3, norm3, hrand } from './proj.ts';
import { timber, brick, PPM } from './textures.ts';
import { glass, hull, Sprite } from './houses.ts';
import { emblem } from './vehicles.ts';
import { BRAND } from './brand.ts';

export interface WingDef {
  id: string; name: string; facilities: string[]; corners: number[][]; eaveM: number; pitchDeg?: number;
  ridge?: 'u' | 'v'; split?: number; roof?: 'green'; style: 'hall' | 'pool' | 'link' | 'shop' | 'brasserie' | 'workshop';
  sign?: { text: string; sub?: string }; terrace?: boolean; rotationDeg?: number;
}
export interface Massing { rotationDeg: number; wings: WingDef[]; tent?: { id: string; name: string; pts: number[][] }; serviceYard?: { pts: number[][]; bollards: number[][] } }

export interface Block {
  id: string; wing: WingDef; c: V2; U: V2; V: V2; hu: number; hv: number; eave: number; rise: number;
  ridge: 'u' | 'v' | 'flat'; part: number; parts: number;
}

const OV_EAVE = 0.45, OV_GABLE = 0.35;
const DARK = '#24282b';

/** Fit rotated blocks to the wing corner points (PDF -> world) and split twin-gable wings. */
export function massingBlocks(m: Massing, toWorld: (p: number[]) => V2): Block[] {
  const out: Block[] = [];
  for (const w of m.wings) {
    const th = ((w.rotationDeg ?? m.rotationDeg) * Math.PI) / 180;
    const U = { x: Math.cos(th), y: Math.sin(th) }, V = { x: -Math.sin(th), y: Math.cos(th) };
    const pts = w.corners.map(toWorld);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of pts) { const pu = p.x * U.x + p.y * U.y, pv = p.x * V.x + p.y * V.y; u0 = Math.min(u0, pu); u1 = Math.max(u1, pu); v0 = Math.min(v0, pv); v1 = Math.max(v1, pv); }
    const parts = Math.max(1, w.split ?? 1);
    const du = (u1 - u0) / parts;
    for (let k = 0; k < parts; k++) {
      const cu = u0 + du * (k + 0.5), cv = (v0 + v1) / 2;
      const hu = du / 2, hv = (v1 - v0) / 2;
      const ridge = w.roof === 'green' ? 'flat' : (w.ridge ?? (hu >= hv ? 'u' : 'v'));
      const span = ridge === 'u' ? hv : hu;
      const rise = ridge === 'flat' ? 0 : Math.tan(((w.pitchDeg ?? 30) * Math.PI) / 180) * span;
      out.push({ id: parts > 1 ? `${w.id}${k + 1}` : w.id, wing: w, c: { x: U.x * cu + V.x * cv, y: U.y * cu + V.y * cv }, U, V, hu, hv, eave: w.eaveM, rise, ridge, part: k, parts });
    }
  }
  return out;
}

export function blockCorners(b: Block, grow = 0): V2[] {
  const { c, U, V } = b, hu = b.hu + grow, hv = b.hv + grow;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, d]) => ({ x: c.x + U.x * hu * a + V.x * hv * d, y: c.y + U.y * hu * a + V.y * hv * d }));
}
function inside(b: Block, p: V2, m = 0.05) {
  const dx = p.x - b.c.x, dy = p.y - b.c.y;
  return Math.abs(dx * b.U.x + dy * b.U.y) <= b.hu + m && Math.abs(dx * b.V.x + dy * b.V.y) <= b.hv + m;
}

// ---------------------------------------------------------------- painters (face space: metres, v grows downwards)
function plinth(ctx: CanvasRenderingContext2D, w: number, zTop: number, zBase: number) {
  ctx.save(); ctx.beginPath(); ctx.rect(0, zTop - zBase - 0.55, w, 0.55); ctx.clip(); fillTex(ctx, brick(7), PPM, w, zTop + 1); ctx.restore();
}
function bays(ctx: CanvasRenderingContext2D, w: number, top: number, h: number, bay: number, fill: (x: number, bw: number) => void) {
  const n = Math.max(1, Math.round(w / bay)), bw = w / n;
  for (let k = 0; k < n; k++) fill(k * bw, bw);
  void top; void h;
}
function seamRoof(ctx: CanvasRenderingContext2D, w: number, h: number, base = '#3b4044') {
  ctx.fillStyle = base; ctx.fillRect(-1, -1, w + 2, h + 2);
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.10)');
  ctx.fillStyle = g; ctx.fillRect(-1, -1, w + 2, h + 2);
  // standing seams: a light edge and a dark shadow line per seam, slightly irregular so it does not look printed
  for (let u = 0.3; u < w; u += 0.55) { ctx.fillStyle = 'rgba(255,255,255,0.13)'; ctx.fillRect(u, 0, 0.06, h); ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(u + 0.06, 0, 0.05, h); }
  // weathering: lighter near the ridge, darker towards the gutter, a few soft patches of moss and dust
  const wg = ctx.createLinearGradient(0, 0, 0, h); wg.addColorStop(0, 'rgba(255,255,255,0.08)'); wg.addColorStop(0.6, 'rgba(0,0,0,0)'); wg.addColorStop(1, 'rgba(20,25,20,0.18)');
  ctx.fillStyle = wg; ctx.fillRect(-1, -1, w + 2, h + 2);
  const rr = hrand(Math.round(w * 13 + h * 7));
  for (let i = 0; i < w * h * 0.04; i++) { ctx.fillStyle = rr() < 0.5 ? 'rgba(90,110,70,0.05)' : 'rgba(255,255,255,0.03)'; ctx.fillRect(rr() * w, h * (0.5 + rr() * 0.5), 0.3 + rr() * 0.5, 1.5 + rr() * 3); }
  ctx.fillStyle = '#2a2e31'; ctx.fillRect(-1, 0, w + 2, 0.24);
  ctx.fillStyle = DARK; ctx.fillRect(-1, h - 0.2, w + 2, 0.2);
  ctx.fillRect(0, 0, 0.14, h); ctx.fillRect(w - 0.14, 0, 0.14, h);
}
function greenRoof(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  const r = hrand(seed);
  ctx.fillStyle = '#6f8f45'; ctx.fillRect(-1, -1, w + 2, h + 2);
  for (let i = 0; i < w * h * 6; i++) { ctx.fillStyle = r() < 0.5 ? 'rgba(150,170,80,0.55)' : r() < 0.5 ? 'rgba(80,110,50,0.55)' : 'rgba(170,120,150,0.45)'; ctx.fillRect(r() * w, r() * h, 0.18, 0.18); }
  ctx.strokeStyle = '#30353a'; ctx.lineWidth = 0.35; ctx.strokeRect(0.17, 0.17, w - 0.34, h - 0.34);
  ctx.fillStyle = '#b9b3a4'; ctx.fillRect(0.35, 0.35, w - 0.7, 0.25); // gravel strip
}

type WallKind = 'eave' | 'gable';
interface WallCtx { b: Block; kind: WallKind; w: number; zTop: number; zEave: number; zBase: number; side: 'S' | 'N' | 'E' | 'W'; seed: number; sign?: WingDef['sign'] }

function paintWall(ctx: CanvasRenderingContext2D, k: WallCtx) {
  const { b, w, zTop, zEave, zBase, kind } = k;
  const st = b.wing.style;
  const tri = zTop - zEave; // height of the gable triangle (0 for eave walls)
  const H = zEave - zBase;  // visible rectangular wall height
  const y0 = tri;           // face-space v of the eave line
  const dark = timber(20 + (k.seed % 4), 0), warm = timber(30 + (k.seed % 3), 1);
  // base cladding
  if (st === 'workshop') fillTex(ctx, warm, PPM, w, zTop + 1); else fillTex(ctx, dark, PPM, w, zTop + 1);
  if (kind === 'gable' && st !== 'workshop') {
    ctx.save(); ctx.beginPath(); ctx.rect(-1, -1, w + 2, y0 + 1); ctx.clip(); fillTex(ctx, warm, PPM, w, zTop + 1); ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, y0 - 0.07, w, 0.14);
  }
  if (H > 0.6 && zBase < 0.3) plinth(ctx, w, zTop, 0);
  const vb = y0 + H; // v of the ground (or of the neighbour's eave)
  if (H > 1.2) {
    if (st === 'pool') {
      // curtain wall: tall glazing between slim timber fins
      const gTop = Math.max(y0 + 0.5, vb - 4.4), gH = vb - 0.6 - gTop;
      if (gH > 0.8) bays(ctx, w, gTop, gH, 2.6, (x, bw) => glass(ctx, x + 0.18, gTop, bw - 0.36, gH, 2, 0.16));
    } else if (st === 'brasserie') {
      const gTop = Math.max(y0 + 0.45, vb - 3.3), gH = vb - 0.55 - gTop;
      if (gH > 0.8) bays(ctx, w, gTop, gH, 3.0, (x, bw) => glass(ctx, x + 0.22, gTop, bw - 0.44, gH, 2, 0.32));
    } else if (st === 'link') {
      const gTop = y0 + 0.4, gH = vb - 0.6 - gTop;
      if (gH > 0.8) bays(ctx, w, gTop, gH, 2.2, (x, bw) => glass(ctx, x + 0.08, gTop, bw - 0.16, gH, 1, 0.22));
    } else if (st === 'workshop') {
      if (kind === 'gable' && k.side === 'S') {
        // sectional garage door + service door
        const dw = Math.min(3.2, w * 0.55), dx = w * 0.12, dh = Math.min(2.9, H - 0.2);
        ctx.fillStyle = '#9aa0a3'; ctx.fillRect(dx, vb - dh, dw, dh);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = vb - dh + 0.48; y < vb; y += 0.48) ctx.fillRect(dx, y, dw, 0.05);
        ctx.strokeStyle = DARK; ctx.lineWidth = 0.12; ctx.strokeRect(dx, vb - dh, dw, dh);
        ctx.fillStyle = BRAND.teal; ctx.fillRect(dx + dw + 0.5, vb - 2.1, 0.95, 2.1);
      } else glass(ctx, w * 0.3, vb - 2.2, w * 0.4, 1.1, 2, 0.1);
    } else {
      // hall / shop: ground-floor glazing in bays + upper ribbon windows on tall walls
      const warmL = st === 'shop' ? 0.35 : 0.2;
      const gH = Math.min(2.5, H - 1.0), gTop = vb - 0.6 - gH;
      bays(ctx, w, gTop, gH, st === 'shop' ? 3.4 : 4.6, (x, bw) => { if (bw > 1.6) glass(ctx, x + 0.45, gTop, bw - 0.9, gH, 2, warmL); });
      if (H > 5.2) bays(ctx, w, 0, 0, 4.6, (x, bw) => { if (bw > 2) glass(ctx, x + 0.9, y0 + 0.8, bw - 1.8, 1.1, 2, 0.06); });
      if (st === 'shop') { ctx.fillStyle = BRAND.teal; ctx.fillRect(0, gTop - 0.55, w, 0.28); }
    }
  }
  // gable window (tall, centred) - like the bungalows
  if (kind === 'gable' && tri > 2.2 && st !== 'link') {
    const ww = Math.min(2.6, w * 0.18), wh = tri * 0.62;
    if (st === 'pool') { // big glazed gable, following the roof slope
      ctx.save(); ctx.beginPath(); ctx.moveTo(w / 2, tri * 0.18); ctx.lineTo(w * 0.86, y0 - 0.25); ctx.lineTo(w * 0.14, y0 - 0.25); ctx.closePath(); ctx.clip();
      glass(ctx, 0, 0, w, y0, 6, 0.12); ctx.restore();
      ctx.strokeStyle = '#b48a5a'; ctx.lineWidth = 0.18; for (let x = w * 0.14; x < w * 0.86; x += w * 0.12) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, y0); ctx.stroke(); }
    } else glass(ctx, w / 2 - ww / 2, tri - wh - 0.3, ww, wh, 1, 0.1);
  }
  // signage: dark fascia band with emblem + wordmark (or teal band for the TD)
  if (k.sign) {
    const s = k.sign;
    const bandH = st === 'workshop' ? 0.75 : 1.5, bandTop = y0 + 0.25;
    const bw = Math.min(w - 0.6, st === 'workshop' ? w - 0.6 : 13), bx = (w - bw) / 2;
    ctx.fillStyle = st === 'workshop' ? BRAND.teal : '#1d2124'; ctx.fillRect(bx, bandTop, bw, bandH);
    const sc = bandH / 1.5;
    ctx.save(); ctx.translate(bx + 0.35 * sc, bandTop); ctx.scale(sc, sc);
    emblem(ctx, 0.75, 0.75, 0.58, '#ffffff');
    ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = '600 0.95px Georgia, "Times New Roman", serif'; ctx.fillText(s.text, 1.6, 0.62);
    if (s.sub) { ctx.font = '600 0.36px system-ui, Arial'; ctx.fillText(s.sub, 1.62, 1.22); }
    ctx.restore();
  }
}

/** Build one block as a sprite. `others` are the other blocks of the massing (for shared-wall suppression). */
export function buildBlock(b: Block, others: Block[], seed: number): { sprite: Sprite; shadow: V2[]; footprint: V2[] } {
  const faces: Face[] = [];
  const roofFaces: Face[] = [];
  const top = b.eave + b.rise;
  const U3: V3 = { x: b.U.x, y: b.U.y, z: 0 }, V3v: V3 = { x: b.V.x, y: b.V.y, z: 0 };
  const at = (a: number, d: number, z: number): V3 => ({ x: b.c.x + b.U.x * a + b.V.x * d, y: b.c.y + b.U.y * a + b.V.y * d, z });
  const sides: { side: 'S' | 'N' | 'E' | 'W'; n: V2; half: number; off: number }[] = [
    { side: 'S', n: b.V, half: b.hu, off: b.hv }, { side: 'N', n: { x: -b.V.x, y: -b.V.y }, half: b.hu, off: b.hv },
    { side: 'E', n: b.U, half: b.hv, off: b.hu }, { side: 'W', n: { x: -b.U.x, y: -b.U.y }, half: b.hv, off: b.hu },
  ];
  const signSide = b.wing.sign && (b.part === 0) ? (b.ridge === 'v' ? 'S' : 'S') : null;
  for (const s of sides) {
    const n3: V3 = { x: s.n.x, y: s.n.y, z: 0 };
    if (!facing(n3)) continue;
    const kind: WallKind = b.ridge === 'flat' ? 'eave' : (b.ridge === 'u' ? (s.side === 'S' || s.side === 'N' ? 'eave' : 'gable') : (s.side === 'E' || s.side === 'W' ? 'eave' : 'gable'));
    // wall centre and tangent (U-right as seen from outside: (n.y, -n.x))
    const t: V2 = { x: s.n.y, y: -s.n.x };
    const mid: V2 = { x: b.c.x + s.n.x * s.off, y: b.c.y + s.n.y * s.off };
    // neighbour on this side?
    let nb: Block | undefined;
    for (const o of others) {
      if (o === b) continue;
      if ([-0.7, 0, 0.7].every((f) => inside(o, { x: mid.x + s.n.x * 0.6 + t.x * s.half * f, y: mid.y + s.n.y * 0.6 + t.y * s.half * f }, 0.3))) { nb = o; break; }
    }
    let zBase = 0;
    if (nb) {
      if (nb.eave >= b.eave - 0.05) { if (kind === 'eave') continue; zBase = b.eave; }
      else zBase = nb.eave;
    }
    const w = 2 * s.half;
    const left: V2 = { x: mid.x - t.x * s.half, y: mid.y - t.y * s.half };
    const O: V3 = { x: left.x, y: left.y, z: kind === 'gable' ? top : b.eave };
    const zTop = O.z;
    const outline: V2[] = kind === 'gable'
      ? [{ x: w / 2, y: 0 }, { x: w, y: b.rise }, { x: w, y: zTop - zBase }, { x: 0, y: zTop - zBase }, { x: 0, y: b.rise }]
      : [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: zTop - zBase }, { x: 0, y: zTop - zBase }];
    if (kind === 'gable' && zBase >= b.eave) outline.splice(2, 2); // only the triangle above a neighbour
    const wc: WallCtx = { b, kind, w, zTop, zEave: b.eave, zBase, side: s.side, seed: seed + s.side.charCodeAt(0), sign: signSide === s.side && !nb ? b.wing.sign : undefined };
    faces.push(makeFace(O, { x: t.x, y: t.y, z: 0 }, { x: 0, y: 0, z: -1 }, outline, (ctx) => paintWall(ctx, wc), { edge: 'rgba(0,0,0,0.42)', ambient: 0.66 }));
  }
  // roof
  if (b.ridge === 'flat') {
    const corners = blockCorners(b, 0.15);
    const o3: V3 = { ...corners[0], z: b.eave };
    const W2 = 2 * (b.hu + 0.15), H2 = 2 * (b.hv + 0.15);
    roofFaces.push(makeFace(o3, U3, V3v, [{ x: 0, y: 0 }, { x: W2, y: 0 }, { x: W2, y: H2 }, { x: 0, y: H2 }], (ctx) => greenRoof(ctx, W2, H2, seed), { ambient: 0.72 }));
    // parapet front edge
    roofFaces.push(makeFace({ ...corners[3], z: b.eave + 0.3 }, U3, { x: 0, y: 0, z: -1 }, [{ x: 0, y: 0 }, { x: W2, y: 0 }, { x: W2, y: 0.32 }, { x: 0, y: 0.32 }], (ctx) => { ctx.fillStyle = DARK; ctx.fillRect(0, 0, W2, 1); }, { noShade: true }));
  } else {
    const along = b.ridge === 'u' ? U3 : V3v, across = b.ridge === 'u' ? V3v : U3;
    const halfAlong = (b.ridge === 'u' ? b.hu : b.hv) + OV_GABLE, halfAcross = b.ridge === 'u' ? b.hv : b.hu;
    const slope = Math.hypot(halfAcross + OV_EAVE, (b.rise / halfAcross) * (halfAcross + OV_EAVE));
    for (const sg of [1, -1]) {
      const r0: V3 = { x: b.c.x - along.x * halfAlong, y: b.c.y - along.y * halfAlong, z: top };
      const eaveDir = norm3({ x: across.x * sg * (halfAcross + OV_EAVE), y: across.y * sg * (halfAcross + OV_EAVE), z: -(b.rise / halfAcross) * (halfAcross + OV_EAVE) });
      let U: V3 = along, O = r0;
      if (cross3(U, eaveDir).z < 0) { U = { x: -along.x, y: -along.y, z: 0 }; O = { x: b.c.x + along.x * halfAlong, y: b.c.y + along.y * halfAlong, z: top }; }
      const n = norm3(cross3(U, eaveDir));
      if (!facing(n)) continue;
      const L = 2 * halfAlong;
      roofFaces.push(makeFace(O, U, eaveDir, [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: slope }, { x: 0, y: slope }], (ctx) => seamRoof(ctx, L, slope), { edge: 'rgba(0,0,0,0.5)', ambient: 0.68 }));
    }
    roofFaces.sort((a, c) => a.key - c.key);
  }
  const all = [...faces, ...roofFaces];
  const fp = blockCorners(b);
  const verts: V3[] = [...blockCorners(b, 0.6).map((p) => ({ ...p, z: 0 })), ...blockCorners(b, 0.6).map((p) => ({ ...p, z: top + 0.4 }))];
  const bb = screenBounds(verts, 6);
  const c = renderFaces(all, bb);
  const ridgePts = b.ridge === 'flat' ? [] : b.ridge === 'u' ? [at(-b.hu, 0, top), at(b.hu, 0, top)] : [at(0, -b.hv, top), at(0, b.hv, top)];
  const shadow = hull([...fp, ...blockCorners(b).map((p) => shadowPt({ ...p, z: b.eave })), ...ridgePts.map(shadowPt)]);
  const front = Math.max(...fp.map((p) => p.y));
  const ctr = P(b.c.x, b.c.y, top + 1.5);
  return { sprite: { canvas: c, x: bb.x0, y: bb.y0, key: front * cam.CE, kind: 'building', id: b.id, anchor: ctr, topZ: top, footprint: fp }, shadow, footprint: fp };
}

/** White event tent: low canvas walls + pyramid roof. */
export function buildTent(pts: V2[]): { sprite: Sprite; shadow: V2[] } {
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const H = 2.4, apex: V3 = { x: cx, y: cy, z: 5.2 };
  let area2 = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b2 = pts[(i + 1) % pts.length]; area2 += a.x * b2.y - b2.x * a.y; }
  const faces: Face[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b2 = pts[(i + 1) % pts.length]; const l = Math.hypot(b2.x - a.x, b2.y - a.y);
    const n: V2 = area2 > 0 ? { x: (b2.y - a.y) / l, y: -(b2.x - a.x) / l } : { x: -(b2.y - a.y) / l, y: (b2.x - a.x) / l };
    if (!facing({ x: n.x, y: n.y, z: 0 })) continue;
    const t = { x: n.y, y: -n.x }; const start = (b2.x - a.x) * t.x + (b2.y - a.y) * t.y > 0 ? a : b2;
    faces.push(makeFace({ x: start.x, y: start.y, z: H }, { x: t.x, y: t.y, z: 0 }, { x: 0, y: 0, z: -1 }, [{ x: 0, y: 0 }, { x: l, y: 0 }, { x: l, y: H }, { x: 0, y: H }], (ctx) => { ctx.fillStyle = '#f4f1e8'; ctx.fillRect(-1, -1, l + 2, H + 2); ctx.fillStyle = 'rgba(0,0,0,0.07)'; for (let x = 0; x < l; x += 1.2) ctx.fillRect(x, 0, 0.08, H); }, { edge: 'rgba(0,0,0,0.25)' }));
  }
  const roof: Face[] = [];
  for (let i = 0; i < pts.length; i++) {
    const A: V3 = { ...pts[i], z: H }, B: V3 = { ...pts[(i + 1) % pts.length], z: H };
    const Uu = norm3({ x: B.x - A.x, y: B.y - A.y, z: 0 }); const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, z: H };
    let Vv = norm3({ x: mid.x - apex.x, y: mid.y - apex.y, z: mid.z - apex.z });
    let UU = Uu; if (cross3(UU, Vv).z < 0) UU = { x: -Uu.x, y: -Uu.y, z: 0 };
    const n = norm3(cross3(UU, Vv)); if (!facing(n)) continue;
    const proj = (p: V3) => ({ x: (p.x - apex.x) * UU.x + (p.y - apex.y) * UU.y, y: (p.x - apex.x) * Vv.x + (p.y - apex.y) * Vv.y + (p.z - apex.z) * Vv.z });
    Vv = Vv;
    roof.push(makeFace(apex, UU, Vv, [{ x: 0, y: 0 }, proj(A), proj(B)], (ctx) => { ctx.fillStyle = '#fbf9f2'; ctx.fillRect(-20, -1, 40, 20); ctx.strokeStyle = 'rgba(140,120,90,0.22)'; ctx.lineWidth = 0.06; for (let k = -20; k < 20; k += 1.0) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(k, 20); ctx.stroke(); } }, { ambient: 0.78 }));
  }
  roof.sort((a, c) => a.key - c.key);
  const verts: V3[] = [...pts.map((p) => ({ ...p, z: 0 })), apex];
  const bb = screenBounds(verts, 6);
  const c = renderFaces([...faces, ...roof], bb);
  const shadow = hull([...pts, ...pts.map((p) => shadowPt({ ...p, z: H })), shadowPt(apex)]);
  return { sprite: { canvas: c, x: bb.x0, y: bb.y0, key: Math.max(...pts.map((p) => p.y)) * cam.CE, kind: 'building', id: 'tent', anchor: Pv(apex), topZ: 5.2, footprint: pts }, shadow };
}

/** Garden parasol with table and chairs (brasserie terrace). */
export function drawParasol(ctx: CanvasRenderingContext2D, at: V2, seed: number) {
  const b = P(at.x, at.y, 0), s = cam.S;
  ctx.fillStyle = 'rgba(20,30,18,0.22)'; ctx.beginPath(); ctx.ellipse(b.x + 0.9 * s, b.y - 0.2 * s, 1.5 * s, 0.75 * s, 0, 0, Math.PI * 2); ctx.fill();
  for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 2 + seed; const c = P(at.x + Math.cos(a) * 0.95, at.y + Math.sin(a) * 0.95, 0.9); ctx.fillStyle = '#2b2e31'; ctx.fillRect(c.x - 0.22 * s, c.y - 0.1 * s, 0.44 * s, 0.5 * s); }
  const tb = P(at.x, at.y, 0.75);
  ctx.fillStyle = '#3a3d40'; ctx.beginPath(); ctx.ellipse(tb.x, tb.y, 0.55 * s, 0.55 * s * cam.SE, 0, 0, Math.PI * 2); ctx.fill();
  const t = P(at.x, at.y, 2.35);
  ctx.strokeStyle = '#d8d2c4'; ctx.lineWidth = Math.max(1.2, 0.06 * s); ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
  const tip = P(at.x, at.y, 2.6);
  for (let k = 0; k < 8; k++) {
    const a0 = (k / 8) * Math.PI * 2, a1 = ((k + 1) / 8) * Math.PI * 2;
    const p0 = P(at.x + Math.cos(a0) * 1.5, at.y + Math.sin(a0) * 1.5, 2.08), p1 = P(at.x + Math.cos(a1) * 1.5, at.y + Math.sin(a1) * 1.5, 2.08);
    ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.closePath();
    ctx.fillStyle = k % 2 ? '#f6efdd' : '#e6dcc4'; ctx.fill();
    ctx.strokeStyle = 'rgba(120,100,70,0.3)'; ctx.lineWidth = 0.8 * cam.RS; ctx.stroke();
  }
}

/** Terrace in front (south) of a block: pavement polygon + parasol positions, avoiding water and lanes. */
export function terraceFor(b: Block, blocked: (p: V2) => boolean): { pave: V2[]; parasols: V2[] } {
  const depth = 5.6, inset = 1.2;
  const a = (u: number, d: number): V2 => ({ x: b.c.x + b.U.x * u + b.V.x * d, y: b.c.y + b.U.y * u + b.V.y * d });
  // trim the terrace ends until all its sample points are free
  let u0 = -b.hu + inset, u1 = b.hu - inset;
  const ok = (u: number) => [0.6, depth * 0.5, depth - 0.3].every((d) => !blocked(a(u, b.hv + d)));
  while (u0 < u1 && !ok(u0)) u0 += 0.5;
  while (u1 > u0 && !ok(u1)) u1 -= 0.5;
  if (u1 - u0 < 4) return { pave: [], parasols: [] };
  const pave = [a(u0, b.hv), a(u1, b.hv), a(u1, b.hv + depth), a(u0, b.hv + depth)];
  const parasols: V2[] = [];
  const n = Math.max(1, Math.floor((u1 - u0) / 4.2));
  for (let k = 0; k < n; k++) { const u = u0 + ((k + 0.5) * (u1 - u0)) / n; if (ok(u)) parasols.push(a(u, b.hv + depth * 0.55)); }
  return { pave, parasols };
}

/** Short dark bollard (keeps visitor cars out of the TD service yard). */
export function drawBollard(ctx: CanvasRenderingContext2D, at: V2) {
  const s = cam.S, b = P(at.x, at.y, 0), t = P(at.x, at.y, 0.9);
  ctx.fillStyle = 'rgba(20,30,18,0.25)'; ctx.beginPath(); ctx.ellipse(b.x + 0.25 * s, b.y, 0.25 * s, 0.12 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2c3135'; ctx.fillRect(b.x - 0.1 * s, t.y, 0.2 * s, b.y - t.y);
  ctx.fillStyle = '#e9ecec'; ctx.fillRect(b.x - 0.1 * s, t.y + (b.y - t.y) * 0.18, 0.2 * s, (b.y - t.y) * 0.12);
  ctx.fillStyle = '#3d4246'; ctx.beginPath(); ctx.ellipse(b.x, t.y, 0.1 * s, 0.05 * s, 0, 0, Math.PI * 2); ctx.fill();
}
