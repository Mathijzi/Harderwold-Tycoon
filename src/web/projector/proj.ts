// Fixed orthographic aerial camera + lighting + textured planar faces (Canvas 2D).
// World: metres, x = east, y = south, z = up. Screen: 4K stage pixels (scaled by RS for lower internal resolutions).
export interface V3 { x: number; y: number; z: number }
export interface V2 { x: number; y: number }

export const STAGE = { w: 3840, h: 2160 };
export const cam = { cx: 0, cy: 0, S: 1, SE: 0.76, CE: 0.65, RS: 1, W: 3840, H: 2160 };

export function setupCamera(viewW: number, viewH: number, renderScale: number) {
  cam.RS = renderScale;
  cam.W = Math.round(STAGE.w * renderScale);
  cam.H = Math.round(STAGE.h * renderScale);
  cam.S = (STAGE.w / viewW) * renderScale;
  cam.SE = Math.min(0.98, STAGE.h / (viewH * (STAGE.w / viewW)));
  cam.CE = Math.sqrt(1 - cam.SE * cam.SE);
  cam.cx = viewW / 2;
  cam.cy = viewH / 2;
}
export const P = (x: number, y: number, z = 0): V2 => ({
  x: (x - cam.cx) * cam.S + cam.W / 2,
  y: (y - cam.cy) * cam.S * cam.SE - z * cam.S * cam.CE + cam.H / 2,
});
export const Pv = (p: V3) => P(p.x, p.y, p.z);
/** Inverse for ground points (z = 0) */
export const unP = (sx: number, sy: number): V2 => ({ x: (sx - cam.W / 2) / cam.S + cam.cx, y: (sy - cam.H / 2) / (cam.S * cam.SE) + cam.cy });
/** painter's depth key: larger = closer to camera */
export const depthKey = (y: number, z = 0) => y * cam.CE + z * cam.SE;

// Sun from the south-west, fairly high (warm afternoon light like the approved concept)
const Lr = { x: -0.62, y: 0.38, z: 0.69 };
const Ll = Math.hypot(Lr.x, Lr.y, Lr.z);
export const SUN: V3 = { x: Lr.x / Ll, y: Lr.y / Ll, z: Lr.z / Ll };
export const dot3 = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const sub3 = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const add3 = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const mul3 = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const cross3 = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const norm3 = (a: V3): V3 => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };

/** Is a face with outward normal n visible from the camera? */
export const facing = (n: V3) => n.y * cam.CE + n.z * cam.SE > 0.001;
/** brightness factor for a surface normal (1 = neutral) */
export const light = (n: V3, ambient = 0.58, diffuse = 0.62) => ambient + diffuse * Math.max(0, dot3(norm3(n), SUN));
/** shadow of a 3D point on the ground */
export const shadowPt = (p: V3): V2 => ({ x: p.x - (SUN.x * p.z) / SUN.z, y: p.y - (SUN.y * p.z) / SUN.z });

export function shadeOverlay(ctx: CanvasRenderingContext2D, b: number) {
  if (b < 1) { ctx.fillStyle = `rgba(18,22,30,${Math.min(0.75, (1 - b) * 0.95)})`; ctx.fill(); }
  else if (b > 1) { ctx.fillStyle = `rgba(255,214,160,${Math.min(0.35, (b - 1) * 0.55)})`; ctx.fill(); }
}

/** Planar face with a local 2D frame: point(u, v) = O + U*u + V*v (v grows downwards along the face). */
export interface Face {
  O: V3; U: V3; V: V3; n: V3;
  outline: V2[]; // polygon in (u, v) metres
  paint: (ctx: CanvasRenderingContext2D) => void; // draws in (u, v) metre space, already clipped
  key: number; // depth key (centroid)
  edge?: string;
  ambient?: number;
  noShade?: boolean;
}

export function makeFace(O: V3, U: V3, V: V3, outline: V2[], paint: Face['paint'], opts: Partial<Face> = {}): Face {
  // viewed from outside, U points right and V points down -> outward normal = U x V
  const n = norm3(cross3(U, V));
  let cxu = 0, cxv = 0; for (const p of outline) { cxu += p.x; cxv += p.y; }
  cxu /= outline.length; cxv /= outline.length;
  const c = add3(add3(O, mul3(U, cxu)), mul3(V, cxv));
  return { O, U, V, n, outline, paint, key: c.y * cam.CE + c.z * cam.SE, ...opts };
}

/** Draw a face: set affine transform from face space to screen, clip, paint, shade, outline. */
export function drawFace(ctx: CanvasRenderingContext2D, f: Face, offset: V2 = { x: 0, y: 0 }, k = 1) {
  const o = Pv(f.O);
  const ou = Pv(add3(f.O, f.U)), ov = Pv(add3(f.O, f.V));
  const a = ou.x - o.x, b = ou.y - o.y, c = ov.x - o.x, d = ov.y - o.y;
  ctx.save();
  ctx.setTransform(a * k, b * k, c * k, d * k, (o.x - offset.x) * k, (o.y - offset.y) * k);
  ctx.beginPath();
  f.outline.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.save();
  ctx.clip();
  f.paint(ctx);
  ctx.restore();
  ctx.beginPath();
  f.outline.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  if (!f.noShade) shadeOverlay(ctx, light(f.n, f.ambient));
  if (f.edge) { ctx.strokeStyle = f.edge; ctx.lineWidth = 0.05; ctx.stroke(); }
  ctx.restore();
}

/** Fill the whole face area with a texture tile (texPx per metre). */
export function fillTex(ctx: CanvasRenderingContext2D, tex: CanvasImageSource & { width: number; height: number }, ppm: number, w: number, h: number, ox = 0, oy = 0) {
  const pat = ctx.createPattern(tex, 'repeat')!;
  pat.setTransform(new DOMMatrix([1 / ppm, 0, 0, 1 / ppm, ox, oy]));
  ctx.fillStyle = pat;
  ctx.fillRect(-1, -1, w + 2, h + 2);
}

/** Reduce a canvas to w x h in halving steps (high-quality downsampling: sharp edges, no shimmer). */
export function reduceCanvas(src: HTMLCanvasElement, w: number, h: number) {
  let cur = src;
  while (cur.width / 2 >= w * 1.01) {
    const { c, ctx } = mkCanvas(Math.max(w, Math.ceil(cur.width / 2)), Math.max(h, Math.ceil(cur.height / 2)));
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, c.width, c.height); cur = c;
  }
  const { c, ctx } = mkCanvas(w, h);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, w, h);
  return c;
}
/** Draw building faces SS times larger and reduce: crisp edges on roofs, gables and windows. */
export const FACE_SS = 4;
export function renderFaces(faces: Face[], bb: { x0: number; y0: number; x1: number; y1: number }, k = FACE_SS) {
  const w = bb.x1 - bb.x0, h = bb.y1 - bb.y0;
  const { c, ctx } = mkCanvas(w * k, h * k);
  for (const f of faces) drawFace(ctx, f, { x: bb.x0, y: bb.y0 }, k);
  return k === 1 ? c : reduceCanvas(c, w, h);
}
export function mkCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  const ctx = c.getContext('2d')!;
  return { c, ctx };
}

/** Projected 2D bounding box of a set of 3D points */
export function screenBounds(pts: V3[], pad = 4) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { const s = Pv(p); x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x); y1 = Math.max(y1, s.y); }
  return { x0: Math.floor(x0 - pad), y0: Math.floor(y0 - pad), x1: Math.ceil(x1 + pad), y1: Math.ceil(y1 + pad) };
}

/** Deterministic hash-based random */
export function hrand(seed: number) {
  let s = (seed * 2654435761) >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s >>> 0) / 4294967296; };
}
export function shadeHex(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * k)));
  const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * k)));
  const b = Math.min(255, Math.max(0, Math.round((n & 255) * k)));
  return `rgb(${r},${g},${b})`;
}
export function mixHex(a: string, b: string, t: number) {
  const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((A >> s) & 255) * (1 - t) + ((B >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
