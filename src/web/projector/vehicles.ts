// Live-drawn vehicles (3D boxes, lit), pedestrians and barrier arms.
import { V3, V2, Pv, P, light, facing, shadeHex, cam, shadowPt, norm3, cross3, sub3 } from './proj.ts';
import { BRAND } from './brand.ts';

export interface VehDraw { id: string; kind: string; model: string; color: string; label?: string; job?: string; x: number; y: number; h: number; v: number; brake: boolean; signal: number; reverse: boolean; len: number; wid: number; state: string }

type Corner = V3;
function poly(ctx: CanvasRenderingContext2D, pts: V2[]) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); }

interface Q { pts: V3[]; n: V3; fill: string | ((ctx: CanvasRenderingContext2D, scr: V2[]) => void); key: number; noShade?: boolean; stroke?: string }
const qn = (pts: V3[]) => norm3(cross3(sub3(pts[1], pts[0]), sub3(pts[3], pts[0])));

export function drawVehicle(ctx: CanvasRenderingContext2D, d: VehDraw, t: number) {
  const fx = Math.cos(d.h), fy = Math.sin(d.h);
  const rx = -fy, ry = fx;
  const L = (a: number, b: number, z: number): V3 => ({ x: d.x + fx * a + rx * b, y: d.y + fy * a + ry * b, z });
  const quads: Q[] = [];
  const addBox = (a0: number, a1: number, w0: number, w1: number, z0: number, z1: number, col: string, topInset = { f: 0, b: 0, s: 0 }, glassSides = false, glassFB = false) => {
    // bottom corners
    const b = [L(a1, -w0, z0), L(a1, w0, z0), L(a0, w0, z0), L(a0, -w0, z0)];
    const tp = [L(a1 - topInset.f, -(w1 - topInset.s), z1), L(a1 - topInset.f, w1 - topInset.s, z1), L(a0 + topInset.b, w1 - topInset.s, z1), L(a0 + topInset.b, -(w1 - topInset.s), z1)];
    // faces (each defined counter-clockwise seen from outside)
    const faces: [V3[], boolean][] = [
      [[tp[0], tp[1], tp[2], tp[3]], false], // top
      [[b[0], b[1], tp[1], tp[0]], glassFB], // front
      [[b[2], b[3], tp[3], tp[2]], glassFB], // rear
      [[b[1], b[2], tp[2], tp[1]], glassSides], // right
      [[b[3], b[0], tp[0], tp[3]], glassSides], // left
    ];
    const cen = L((a0 + a1) / 2, 0, (z0 + z1) / 2);
    for (const [pts, gl] of faces) {
      let n = qn(pts);
      const c = { x: (pts[0].x + pts[2].x) / 2, y: (pts[0].y + pts[2].y) / 2, z: (pts[0].z + pts[2].z) / 2 };
      if ((c.x - cen.x) * n.x + (c.y - cen.y) * n.y + (c.z - cen.z) * n.z < 0) n = { x: -n.x, y: -n.y, z: -n.z };
      if (!facing(n)) continue;
      quads.push({ pts, n, fill: gl ? 'glass' : col, key: c.y * cam.CE + c.z * cam.SE });
    }
  };
  const isVan = d.model === 'van', isCart = d.model === 'cart', isGolf = d.model === 'golfcart';
  const Lh = d.len / 2, Wh = d.wid / 2;
  // shadow (soft)
  const sh = [L(Lh, -Wh, 0), L(Lh, Wh, 0), L(-Lh, Wh, 0), L(-Lh, -Wh, 0), L(Lh * 0.6, -Wh, isVan ? 2.3 : isGolf ? 1.95 : 1.4), L(-Lh * 0.6, Wh, isVan ? 2.3 : isGolf ? 1.95 : 1.4)].map((p) => { const s = shadowPt(p); return P(s.x, s.y, 0); });
  ctx.fillStyle = 'rgba(20,30,18,0.28)';
  poly(ctx, convex(sh)); ctx.fill();
  // wheels
  ctx.fillStyle = '#141516';
  for (const [a, b] of [[Lh - 0.85, -Wh + 0.05], [Lh - 0.85, Wh - 0.05], [-Lh + 0.8, -Wh + 0.05], [-Lh + 0.8, Wh - 0.05]]) {
    const c = Pv(L(a, b, 0.33));
    ctx.beginPath(); ctx.ellipse(c.x, c.y, 0.36 * cam.S, 0.3 * cam.S, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (isGolf) {
    // technical-service golf cart: white body, dark seats, orange tool box on the back (canopy drawn below)
    addBox(-Lh, Lh, Wh, Wh * 0.96, 0.28, 0.72, '#f4f6f5');
    addBox(Lh - 0.55, Lh - 0.05, Wh * 0.9, Wh * 0.85, 0.72, 0.98, '#e9eceb');
    addBox(-0.35, 0.25, Wh * 0.9, Wh * 0.9, 0.72, 1.0, '#2b2f33');
    addBox(-0.45, -0.3, Wh * 0.9, Wh * 0.9, 1.0, 1.42, '#2b2f33');
    addBox(-Lh + 0.08, -0.55, Wh * 0.82, Wh * 0.82, 0.72, 1.18, '#f08a24');
  } else if (isVan) {
    addBox(-Lh, Lh - 1.05, Wh, Wh, 0.35, 2.3, '#f4f6f5');
    addBox(Lh - 1.05, Lh, Wh, Wh * 0.97, 0.35, 1.15, '#f4f6f5');
    addBox(Lh - 1.25, Lh - 0.9, Wh * 0.98, Wh * 0.95, 1.15, 2.05, '#f4f6f5', { f: 0.35, b: 0, s: 0.04 }, true, true);
  } else if (isCart) {
    addBox(Lh - 1.45, Lh, Wh, Wh, 0.3, 0.95, BRAND.teal);
    addBox(Lh - 1.4, Lh - 0.05, Wh * 0.96, Wh * 0.92, 0.95, 1.95, BRAND.teal, { f: 0.2, b: 0, s: 0.03 }, true, true);
    addBox(-Lh, Lh - 1.45, Wh, Wh, 0.3, 0.55, '#d9dedd');
    // open bed walls + cleaning trolley
    addBox(-Lh + 0.25, Lh - 1.7, Wh * 0.8, Wh * 0.8, 0.55, 1.15, '#ffffff');
    addBox(-Lh + 0.3, -Lh + 0.9, Wh * 0.5, Wh * 0.5, 1.15, 1.45, '#f2c94c');
  } else {
    const suv = d.model === 'suv', wagon = d.model === 'wagon';
    const z1 = suv ? 1.02 : 0.92, z2 = suv ? 1.68 : wagon ? 1.5 : 1.46;
    const cabB = -Lh + (wagon || suv ? 0.28 : 0.5), cabF = Lh - (suv ? 1.25 : 1.35);
    addBox(-Lh, Lh, Wh, Wh * 0.97, 0.3, z1, d.color);
    addBox(cabB, cabF, Wh * 0.93, Wh * 0.93, z1, z2, d.color, { f: 0.62, b: wagon || suv ? 0.12 : 0.42, s: 0.13 }, true, true);
  }
  quads.sort((a, b) => a.key - b.key);
  for (const q of quads) {
    const scr = q.pts.map(Pv);
    poly(ctx, scr);
    if (q.fill === 'glass') {
      const g = ctx.createLinearGradient(scr[0].x, scr[0].y - 4, scr[2].x, scr[2].y + 4);
      g.addColorStop(0, '#4a5f70'); g.addColorStop(0.5, '#1c2731'); g.addColorStop(1, '#0f151b');
      ctx.fillStyle = g; ctx.fill();
      ctx.fillStyle = 'rgba(200,225,240,0.16)'; ctx.fill();
    } else {
      ctx.fillStyle = shadeHex(q.fill as string, light(q.n, 0.62, 0.55)); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 0.8 * cam.RS; ctx.stroke();
    }
  }
  // livery for service vehicles: teal band + emblem + label on the visible long side
  if (isGolf) {
    const posts: [number, number][] = [[Lh - 0.6, -Wh * 0.85], [Lh - 0.6, Wh * 0.85], [-0.5, -Wh * 0.85], [-0.5, Wh * 0.85]];
    ctx.strokeStyle = '#3a3f43'; ctx.lineWidth = Math.max(1.2, 0.07 * cam.S);
    for (const [a, b] of posts) { const p0 = Pv(L(a, b, 0.75)), p1 = Pv(L(a, b, 1.92)); ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke(); }
    const roof = [L(Lh - 0.35, -Wh * 1.02, 1.95), L(Lh - 0.35, Wh * 1.02, 1.95), L(-0.75, Wh * 1.02, 1.95), L(-0.75, -Wh * 1.02, 1.95)].map(Pv);
    poly(ctx, roof); ctx.fillStyle = shadeHex(BRAND.teal, 1.05); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 0.8 * cam.RS; ctx.stroke();
    const e = Pv(L(Lh * 0.15 - 0.3, 0, 1.97)); emblem(ctx, e.x, e.y, 0.32 * cam.S, '#ffffff');
  }
  if (isVan || isCart) {
    for (const side of [1, -1]) {
      const n: V3 = { x: rx * side, y: ry * side, z: 0 };
      if (!facing(n)) continue;
      const zb0 = isVan ? 0.95 : 0.38, zb1 = isVan ? 1.3 : 0.62;
      const a0 = -Lh + 0.05, a1 = isVan ? Lh - 0.05 : Lh - 1.47;
      const band = [L(a0, side * (Wh + 0.01), zb0), L(a1, side * (Wh + 0.01), zb0), L(a1, side * (Wh + 0.01), zb1), L(a0, side * (Wh + 0.01), zb1)].map(Pv);
      poly(ctx, band); ctx.fillStyle = shadeHex(BRAND.teal, light(n, 0.7, 0.4)); ctx.fill();
      if (isVan) {
        const e = Pv(L(-Lh + 1.3, side * (Wh + 0.02), 1.75));
        emblem(ctx, e.x, e.y, 0.38 * cam.S, BRAND.teal);
        sideText(ctx, L(-Lh + 2.1, side * (Wh + 0.02), 1.95), L(-Lh + 3.2, side * (Wh + 0.02), 1.95), L(-Lh + 2.1, side * (Wh + 0.02), 1.55), BRAND.wordmark, BRAND.teal, side * (fx * 1) );
        sideText(ctx, L(-Lh + 0.4, side * (Wh + 0.02), 1.27), L(-Lh + 1.6, side * (Wh + 0.02), 1.27), L(-Lh + 0.4, side * (Wh + 0.02), 0.98), (d.label ?? '').toUpperCase(), '#ffffff', side);
      }
    }
    // roof marking
    const roofC = Pv(L(isVan ? -0.4 : Lh - 0.7, 0, isVan ? 2.31 : 1.96));
    emblem(ctx, roofC.x, roofC.y, (isVan ? 0.45 : 0.3) * cam.S, isVan ? BRAND.teal : '#ffffff');
  }
  // lights
  const lightAt = (a: number, b: number, z: number, col: string, r = 0.13, glow = 0) => {
    const p = Pv(L(a, b, z));
    if (glow) { const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glow * cam.S); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, glow * cam.S, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.2 * cam.RS, r * cam.S), 0, Math.PI * 2); ctx.fill();
  };
  const zl = isVan ? 0.95 : isGolf ? 0.55 : 0.78;
  const rearVisible = facing({ x: -fx, y: -fy, z: 0 }), frontVisible = facing({ x: fx, y: fy, z: 0 });
  if (rearVisible || true) {
    const tail = d.brake ? '#ff2a1f' : '#a3120f';
    lightAt(-Lh - 0.02, -Wh + 0.25, zl, tail, 0.13, d.brake ? 0.75 : 0);
    lightAt(-Lh - 0.02, Wh - 0.25, zl, tail, 0.13, d.brake ? 0.75 : 0);
    if (d.reverse) { lightAt(-Lh - 0.02, -Wh + 0.5, zl - 0.05, '#ffffff', 0.1, 0.5); lightAt(-Lh - 0.02, Wh - 0.5, zl - 0.05, '#ffffff', 0.1, 0.5); }
  }
  if (frontVisible) { lightAt(Lh + 0.02, -Wh + 0.3, zl - 0.05, '#f6f1d8', 0.12); lightAt(Lh + 0.02, Wh - 0.3, zl - 0.05, '#f6f1d8', 0.12); }
  if (d.signal !== 0 && Math.floor(t * 2.6) % 2 === 0) {
    const side = d.signal > 0 ? 1 : -1;
    lightAt(Lh - 0.05, side * (Wh + 0.02), zl, '#ffb21e', 0.12, 0.55);
    lightAt(-Lh + 0.05, side * (Wh + 0.02), zl, '#ffb21e', 0.12, 0.55);
  }
}

function convex(pts: V2[]) {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cr = (o: V2, a: V2, b: V2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: V2[] = [], up: V2[] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop(); return lo.concat(up);
}

/** Text painted on a vertical vehicle side (affine-mapped). */
function sideText(ctx: CanvasRenderingContext2D, o: V3, ou: V3, ov: V3, text: string, col: string, _side: number) {
  if (!text) return;
  const O = Pv(o), U = Pv(ou), V = Pv(ov);
  let a = U.x - O.x, b = U.y - O.y; const c = V.x - O.x, d = V.y - O.y;
  ctx.save();
  // keep text readable (never mirrored)
  if (a < 0) { ctx.setTransform(-a, -b, c, d, U.x, U.y); } else ctx.setTransform(a, b, c, d, O.x, O.y);
  ctx.fillStyle = col; ctx.font = '700 0.36px system-ui, Segoe UI, Arial'; ctx.textBaseline = 'top';
  const w = ctx.measureText(text).width;
  const sc = Math.min(1, 1.1 / Math.max(0.01, w));
  ctx.scale(sc, 1);
  ctx.fillText(text, 0, 0.02);
  ctx.restore();
  a = 0; b = 0;
}

/** Neutral self-made emblem: a ring with two water waves (editable; not an official logo). */
export function emblem(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, bg?: string) {
  ctx.save();
  if (bg) { ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(x, y, r * 1.15, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = col; ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.6, r * 0.13);
  ctx.beginPath(); ctx.arc(x, y, r * 0.92, 0, Math.PI * 2); ctx.stroke();
  for (const dy of [-0.18, 0.22]) {
    ctx.beginPath();
    for (let i = 0; i <= 16; i++) {
      const u = i / 16, px = x + (u - 0.5) * r * 1.1, py = y + dy * r + Math.sin(u * Math.PI * 2) * r * 0.12;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export interface PedDraw { id: string; x: number; y: number; h: number; walking: boolean; color: string }
export function drawPedestrian(ctx: CanvasRenderingContext2D, p: PedDraw, t: number, seed: number) {
  const g = Pv({ x: p.x, y: p.y, z: 0 });
  const s = cam.S;
  const at = (z: number) => Pv({ x: p.x, y: p.y, z });
  const facing = Math.cos(p.h) >= 0 ? 1 : -1; // walking to the right or the left on screen
  const ph = p.walking ? Math.sin(t * 7 + seed) : 0;
  const shirt = p.color.startsWith('#') ? p.color : '#888888';
  const pants = ['#2b3a55', '#3a3a3a', '#5a4a3a', '#2f4a3a', '#6b6f78'][seed % 5];
  const hair = ['#3b2a20', '#c99a5b', '#1d1d1d', '#7b5a3c', '#a3a3a0'][seed % 5];
  const skin = ['#e7c3a0', '#d7a97f', '#b07a52', '#8a5a3a', '#f0d0b0'][(seed >> 3) % 5];
  // soft ground shadow
  ctx.fillStyle = 'rgba(20,30,18,0.28)';
  ctx.beginPath(); ctx.ellipse(g.x + 0.3 * s, g.y - 0.05 * s, 0.38 * s, 0.17 * s, 0, 0, Math.PI * 2); ctx.fill();
  const hip = at(0.9), sh = at(1.42), hd = at(1.64);
  const lw = Math.max(0.9, 0.17 * s);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // legs (back leg darker) and shoes
  const legs = [-ph, ph];
  legs.forEach((k, i) => {
    const foot = { x: g.x + k * 0.26 * s * facing, y: g.y - (k > 0 ? 0.03 * s : 0) };
    ctx.strokeStyle = i === 0 ? shadeHex(pants, 0.75) : pants; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(hip.x + (i ? 0.05 : -0.05) * s, hip.y); ctx.lineTo(foot.x, foot.y - 0.08 * s); ctx.stroke();
    ctx.fillStyle = '#1f1f22'; ctx.beginPath(); ctx.ellipse(foot.x + 0.06 * s * facing, foot.y - 0.03 * s, 0.11 * s, 0.05 * s, 0, 0, Math.PI * 2); ctx.fill();
  });
  // back arm (behind the body)
  const handBack = { x: sh.x - ph * 0.22 * s * facing, y: hip.y + 0.05 * s };
  ctx.strokeStyle = shadeHex(shirt, 0.7); ctx.lineWidth = Math.max(0.8, 0.11 * s);
  ctx.beginPath(); ctx.moveTo(sh.x - 0.03 * s, sh.y + 0.04 * s); ctx.lineTo(handBack.x, handBack.y); ctx.stroke();
  // torso: shirt with a lit side and a shadow side
  const tw = 0.21 * s;
  const tg = ctx.createLinearGradient(sh.x - tw, 0, sh.x + tw, 0);
  tg.addColorStop(0, shadeHex(shirt, 1.12)); tg.addColorStop(0.6, shirt); tg.addColorStop(1, shadeHex(shirt, 0.72));
  ctx.fillStyle = tg;
  ctx.beginPath(); ctx.moveTo(hip.x - tw * 0.85, hip.y + 0.04 * s); ctx.lineTo(sh.x - tw, sh.y + 0.03 * s); ctx.quadraticCurveTo(sh.x, sh.y - 0.06 * s, sh.x + tw, sh.y + 0.03 * s); ctx.lineTo(hip.x + tw * 0.85, hip.y + 0.04 * s); ctx.closePath(); ctx.fill();
  // front arm and hand
  const handFront = { x: sh.x + ph * 0.22 * s * facing, y: hip.y + 0.05 * s };
  ctx.strokeStyle = shirt; ctx.lineWidth = Math.max(0.8, 0.11 * s);
  ctx.beginPath(); ctx.moveTo(sh.x + 0.03 * s, sh.y + 0.04 * s); ctx.lineTo(handFront.x, handFront.y); ctx.stroke();
  ctx.fillStyle = skin;
  for (const hnd of [handBack, handFront]) { ctx.beginPath(); ctx.arc(hnd.x, hnd.y + 0.02 * s, Math.max(0.5, 0.055 * s), 0, Math.PI * 2); ctx.fill(); }
  // neck, head, hair
  const hr = Math.max(1.2, 0.14 * s);
  ctx.fillStyle = shadeHex(skin, 0.9); ctx.fillRect(hd.x - hr * 0.35, hd.y, hr * 0.7, sh.y - hd.y);
  ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(hd.x, hd.y, hr, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hair;
  ctx.beginPath(); ctx.arc(hd.x, hd.y - hr * 0.15, hr * 1.02, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
  if (seed % 3 === 0) { ctx.beginPath(); ctx.ellipse(hd.x - hr * 0.8 * facing, hd.y + hr * 0.3, hr * 0.35, hr * 0.7, 0, 0, Math.PI * 2); ctx.fill(); } // longer hair
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(hd.x + hr * 0.45 * facing, hd.y - hr * 0.05, Math.max(0.25, hr * 0.12), 0, Math.PI * 2); ctx.fill(); // eye
}

/** Barrier arm + pedestal. frac: 0 closed .. 1 open. */
export function drawBarrier(ctx: CanvasRenderingContext2D, pivot: V2, dir: V2, laneDir: V2, len: number, frac: number, phase: string) {
  const ang = frac * (Math.PI / 2) * 0.94;
  const pz = 1.0;
  // pedestal (box 0.5 x 0.5 x 1.1)
  const hx = laneDir.x * 0.27, hy = laneDir.y * 0.27, wx = dir.x * 0.27, wy = dir.y * 0.27;
  const base = [{ x: pivot.x - hx - wx, y: pivot.y - hy - wy }, { x: pivot.x + hx - wx, y: pivot.y + hy - wy }, { x: pivot.x + hx + wx, y: pivot.y + hy + wy }, { x: pivot.x - hx + wx, y: pivot.y - hy + wy }];
  const top = base.map((p) => Pv({ ...p, z: 1.15 })), bot = base.map((p) => Pv({ ...p, z: 0 }));
  for (let i = 0; i < 4; i++) {
    const a = base[i], b = base[(i + 1) % 4];
    const n: V3 = { x: (b.y - a.y), y: -(b.x - a.x), z: 0 };
    const mid = { x: (a.x + b.x) / 2 - pivot.x, y: (a.y + b.y) / 2 - pivot.y };
    const nn = mid.x * n.x + mid.y * n.y < 0 ? { x: -n.x, y: -n.y, z: 0 } : n;
    if (!facing(nn)) continue;
    poly(ctx, [bot[i], bot[(i + 1) % 4], top[(i + 1) % 4], top[i]]);
    ctx.fillStyle = shadeHex('#f2f4f3', light(norm3(nn), 0.6, 0.5)); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.8; ctx.stroke();
  }
  poly(ctx, top); ctx.fillStyle = BRAND.teal; ctx.fill();
  // status light on top
  const lt = Pv({ ...pivot, z: 1.2 });
  const lc = phase === 'OPEN' ? '#36e07a' : phase === 'CLOSED' ? '#ff3b30' : '#ffb21e';
  const g = ctx.createRadialGradient(lt.x, lt.y, 0, lt.x, lt.y, 0.6 * cam.S); g.addColorStop(0, lc); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(lt.x, lt.y, 0.6 * cam.S, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = lc; ctx.beginPath(); ctx.arc(lt.x, lt.y, Math.max(1.5, 0.12 * cam.S), 0, Math.PI * 2); ctx.fill();
  // arm: white with red stripes
  const segs = 6;
  const pt = (k: number): V3 => ({ x: pivot.x + dir.x * Math.cos(ang) * len * k, y: pivot.y + dir.y * Math.cos(ang) * len * k, z: pz + Math.sin(ang) * len * k });
  const th = 0.13;
  for (let i = 0; i < segs; i++) {
    const a = pt(i / segs), b = pt((i + 1) / segs);
    const A = Pv(a), B = Pv(b), A2 = Pv({ ...a, z: a.z - th }), B2 = Pv({ ...b, z: b.z - th });
    poly(ctx, [A, B, B2, A2]);
    ctx.fillStyle = i % 2 ? '#e0302a' : '#fbfbf9'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 0.7; ctx.stroke();
  }
}
