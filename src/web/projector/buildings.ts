// Central facility buildings (extruded PDF footprints), gate kiosk, signage, flags, lamp posts.
import { V3, V2, P, Pv, makeFace, drawFace, fillTex, mkCanvas, renderFaces, screenBounds, cam, shadowPt, facing, light, shadeHex, Face, norm3 } from './proj.ts';
import { timber, flatRoof, PPM, brick } from './textures.ts';
import { glass, hull, Sprite } from './houses.ts';
import { BRAND } from './brand.ts';
import { emblem } from './vehicles.ts';

export interface Structure { kind: string; facilities: string[]; pts: number[][]; heightM: number; roof: string; name?: string }

export function buildStructure(s: Structure, toWorld: (p: number[]) => V2, idx: number): { sprite: Sprite; shadow: V2[] } | null {
  if (s.kind !== 'building') return null;
  let pts = s.pts.map(toWorld);
  // drop closing duplicate
  if (pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 0.05) pts = pts.slice(0, -1);
  const H = s.heightM;
  let area2 = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area2 += a.x * b.y - b.x * a.y; }
  const faces: Face[] = [];
  const dark = timber(20 + idx, 0);
  const isTent = s.roof === 'tent';
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ex = b.x - a.x, ey = b.y - a.y, el = Math.hypot(ex, ey);
    if (el < 0.3) continue;
    const out: V3 = area2 > 0 ? { x: ey / el, y: -ex / el, z: 0 } : { x: -ey / el, y: ex / el, z: 0 };
    if (!facing(out)) continue;
    // U must point right as seen from outside
    const U0: V3 = { x: ex / el, y: ey / el, z: 0 };
    const rightOutside: V3 = { x: out.y, y: -out.x, z: 0 };
    const flip = U0.x * rightOutside.x + U0.y * rightOutside.y < 0;
    const O: V3 = flip ? { x: b.x, y: b.y, z: H } : { x: a.x, y: a.y, z: H };
    const U: V3 = flip ? { x: -U0.x, y: -U0.y, z: 0 } : U0;
    const w = el;
    faces.push(makeFace(O, U, { x: 0, y: 0, z: -1 }, [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: H }, { x: 0, y: H }], (ctx) => {
      if (isTent) { ctx.fillStyle = '#f1ece0'; ctx.fillRect(0, 0, w, H); ctx.fillStyle = 'rgba(0,0,0,0.08)'; for (let x = 0; x < w; x += 1.2) ctx.fillRect(x, 0, 0.1, H); return; }
      fillTex(ctx, dark, PPM, w, H);
      // brick plinth + glazing band with mullions
      ctx.save(); ctx.beginPath(); ctx.rect(0, H - 0.55, w, 0.55); ctx.clip(); fillTex(ctx, brick(7), PPM, w, H); ctx.restore();
      if (w > 4) {
        const n = Math.max(1, Math.floor(w / 4.2));
        for (let k = 0; k < n; k++) glass(ctx, 0.6 + k * (w - 1.2) / n, H - 3.0, (w - 1.2) / n - 0.5, 2.3, 3, 0.2);
        if (H > 6.5) for (let k = 0; k < n; k++) glass(ctx, 0.9 + k * (w - 1.2) / n, 1.0, (w - 1.2) / n - 1.1, 1.3, 2, 0.06);
      }
      ctx.fillStyle = '#25292c'; ctx.fillRect(0, 0, w, 0.35); // parapet cap
    }, { edge: 'rgba(0,0,0,0.4)', ambient: 0.62 }));
  }
  // roof
  const tex = flatRoof(4 + idx);
  const minx = Math.min(...pts.map((p) => p.x)), miny = Math.min(...pts.map((p) => p.y));
  const maxx = Math.max(...pts.map((p) => p.x)), maxy = Math.max(...pts.map((p) => p.y));
  const roofOutline = pts.map((p) => ({ x: p.x - minx, y: p.y - miny }));
  const roofZ = isTent ? H : H;
  faces.push(makeFace({ x: minx, y: miny, z: roofZ }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, roofOutline, (ctx) => {
    if (isTent) {
      const g = ctx.createRadialGradient((maxx - minx) / 2, (maxy - miny) / 2, 0, (maxx - minx) / 2, (maxy - miny) / 2, Math.max(maxx - minx, maxy - miny) / 1.4);
      g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#d9d2c2'); ctx.fillStyle = g; ctx.fillRect(0, 0, maxx - minx, maxy - miny);
      ctx.strokeStyle = 'rgba(120,100,80,0.35)'; ctx.lineWidth = 0.08;
      for (let k = 0; k < 8; k++) { ctx.beginPath(); ctx.moveTo((maxx - minx) / 2, (maxy - miny) / 2); ctx.lineTo((maxx - minx) * (k % 2), (maxy - miny) * (k < 4 ? 0 : 1)); ctx.stroke(); }
      return;
    }
    fillTex(ctx, tex, PPM, maxx - minx, maxy - miny);
    // parapet rim
    ctx.strokeStyle = '#2b2f32'; ctx.lineWidth = 0.6;
    ctx.beginPath(); roofOutline.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
    // skylights (pool hall) / HVAC units
    const sw = maxx - minx, shh = maxy - miny;
    if (s.facilities.includes('J')) {
      for (let k = 0; k < 4; k++) { ctx.fillStyle = '#7fa7bd'; ctx.fillRect(sw * 0.18 + k * sw * 0.16, shh * 0.55, sw * 0.1, shh * 0.25); ctx.strokeStyle = '#d9e4ea'; ctx.lineWidth = 0.15; ctx.strokeRect(sw * 0.18 + k * sw * 0.16, shh * 0.55, sw * 0.1, shh * 0.25); }
    }
    // rows of solar panels on the flat roofs (modern park building) + HVAC units
    const rnd = (k: number) => ((Math.sin(k * 91.7 + idx * 13.1) + 1) / 2);
    for (let row = 0; row < 3; row++) for (let k = 0; k < 9; k++) {
      const px = sw * 0.12 + k * 1.9, py = shh * (0.12 + row * 0.11);
      if (px > sw - 2.5 || rnd(row * 10 + k) < 0.15) continue;
      ctx.fillStyle = '#1e2633'; ctx.fillRect(px, py, 1.7, 1.0);
      ctx.strokeStyle = 'rgba(170,190,215,0.35)'; ctx.lineWidth = 0.05; ctx.strokeRect(px, py, 1.7, 1.0);
    }
    ctx.fillStyle = '#9da2a5';
    for (let k = 0; k < 3; k++) { ctx.fillRect(sw * (0.25 + k * 0.22), shh * 0.72, 1.8, 1.2); ctx.fillStyle = '#7f8487'; ctx.fillRect(sw * (0.25 + k * 0.22), shh * 0.72 + 1.0, 1.8, 0.2); ctx.fillStyle = '#9da2a5'; }
  }, { ambient: 0.66 }));
  faces.sort((a, b) => a.key - b.key);
  const verts: V3[] = [];
  for (const p of pts) { verts.push({ x: p.x, y: p.y, z: 0 }, { x: p.x, y: p.y, z: H + 0.5 }); }
  const bb = screenBounds(verts, 6);
  const c = renderFaces(faces, bb);
  const shadow = hull([...pts, ...pts.map((p) => shadowPt({ x: p.x, y: p.y, z: H }))]);
  // sort key: the building's centroid y (large footprints: centroid is a better occlusion proxy than the front edge)
  const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  return { sprite: { canvas: c, x: bb.x0, y: bb.y0, key: (cy + (maxy - cy) * 0.35) * cam.CE, kind: 'building', id: `S${idx}`, anchor: P((minx + maxx) / 2, cy, H + 2), topZ: H, footprint: pts }, shadow };
}

/** Small gatehouse on the island between the inbound and outbound barriers. */
export function buildKiosk(pos: V2, dir: V2): { sprite: Sprite; shadow: V2[] } {
  const f = dir, r = { x: -f.y, y: f.x };
  const Wk = 1.7, Dk = 2.4, Hk = 2.7;
  const L = (a: number, b: number, z: number): V3 => ({ x: pos.x + r.x * a + f.x * b, y: pos.y + r.y * a + f.y * b, z });
  const faces: Face[] = [];
  const corners = [[-Wk / 2, -Dk / 2], [Wk / 2, -Dk / 2], [Wk / 2, Dk / 2], [-Wk / 2, Dk / 2]];
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4];
    const A = L(a[0], a[1], 0), B = L(b[0], b[1], 0);
    const ex = B.x - A.x, ey = B.y - A.y, el = Math.hypot(ex, ey);
    const mid = { x: (A.x + B.x) / 2 - pos.x, y: (A.y + B.y) / 2 - pos.y };
    let out: V3 = { x: -ey / el, y: ex / el, z: 0 };
    if (out.x * mid.x + out.y * mid.y < 0) out = { x: -out.x, y: -out.y, z: 0 };
    if (!facing(out)) continue;
    const U0 = { x: ex / el, y: ey / el, z: 0 };
    const flip = U0.x * out.y + U0.y * -out.x < 0;
    const O = flip ? { ...B, z: Hk } : { ...A, z: Hk };
    const U = flip ? { x: -U0.x, y: -U0.y, z: 0 } : U0;
    faces.push(makeFace(O, U, { x: 0, y: 0, z: -1 }, [{ x: 0, y: 0 }, { x: el, y: 0 }, { x: el, y: Hk }, { x: 0, y: Hk }], (ctx) => {
      ctx.fillStyle = '#f4f6f5'; ctx.fillRect(0, 0, el, Hk);
      ctx.fillStyle = BRAND.teal; ctx.fillRect(0, 0, el, 0.45);
      glass(ctx, 0.2, 0.7, el - 0.4, 1.0, 2, 0.25);
    }, { edge: 'rgba(0,0,0,0.35)' }));
  }
  const top = corners.map(([a, b]) => L(a * 1.15, b * 1.12, Hk));
  faces.push(makeFace(top[0], norm3({ x: top[1].x - top[0].x, y: top[1].y - top[0].y, z: 0 }), norm3({ x: top[3].x - top[0].x, y: top[3].y - top[0].y, z: 0 }),
    [{ x: 0, y: 0 }, { x: Wk * 1.15, y: 0 }, { x: Wk * 1.15, y: Dk * 1.12 }, { x: 0, y: Dk * 1.12 }], (ctx) => { ctx.fillStyle = '#3b3f42'; ctx.fillRect(0, 0, 9, 9); }, { ambient: 0.75 }));
  faces.sort((a, b) => a.key - b.key);
  const verts = [...corners.map(([a, b]) => L(a * 1.2, b * 1.2, 0)), ...corners.map(([a, b]) => L(a * 1.2, b * 1.2, Hk + 0.3))];
  const bb = screenBounds(verts, 4);
  const c = renderFaces(faces, bb);
  const fp = corners.map(([a, b]) => { const p = L(a, b, 0); return { x: p.x, y: p.y }; });
  const shadow = hull([...fp, ...corners.map(([a, b]) => shadowPt(L(a, b, Hk)))]);
  return { sprite: { canvas: c, x: bb.x0, y: bb.y0, key: Math.max(...fp.map((p) => p.y)) * cam.CE, kind: 'kiosk', id: 'kiosk', anchor: Pv(L(0, 0, Hk + 1)), topZ: Hk, footprint: fp }, shadow };
}

/** Park entrance sign (monolith) with emblem and wordmark, facing the camera. */
export function drawSign(ctx: CanvasRenderingContext2D, at: V2) {
  const w = 6.2, h = 2.6;
  const a = P(at.x - w / 2, at.y, 0), b = P(at.x + w / 2, at.y, 0), tl = P(at.x - w / 2, at.y, h), tr = P(at.x + w / 2, at.y, h);
  // plinth
  ctx.fillStyle = '#5a4a40';
  ctx.beginPath(); ctx.moveTo(a.x - 4, a.y); ctx.lineTo(b.x + 4, b.y); ctx.lineTo(b.x + 4, b.y - 0.5 * cam.S * cam.CE); ctx.lineTo(a.x - 4, a.y - 0.5 * cam.S * cam.CE); ctx.fill();
  const g = ctx.createLinearGradient(tl.x, tl.y, a.x, a.y); g.addColorStop(0, '#6d5646'); g.addColorStop(1, '#4b3b31');
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(a.x, a.y - 0.45 * cam.S * cam.CE); ctx.lineTo(b.x, b.y - 0.45 * cam.S * cam.CE); ctx.lineTo(tr.x, tr.y); ctx.lineTo(tl.x, tl.y); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#3a2e27'; ctx.lineWidth = 2 * cam.RS; ctx.stroke();
  // top cap
  ctx.fillStyle = '#7a6252'; ctx.fillRect(tl.x - 3, tl.y - 4 * cam.RS, tr.x - tl.x + 6, 5 * cam.RS);
  const cy = (tl.y + a.y) / 2 - 0.2 * cam.S * cam.CE;
  emblem(ctx, tl.x + (tr.x - tl.x) * 0.18, cy, 0.78 * cam.S * cam.CE, '#f5efe6');
  ctx.fillStyle = '#f5efe6'; ctx.font = `600 ${Math.round(0.95 * cam.S * cam.CE)}px Georgia, 'Times New Roman', serif`; ctx.textBaseline = 'middle';
  ctx.fillText(BRAND.wordmark, tl.x + (tr.x - tl.x) * 0.33, cy - 0.15 * cam.S * cam.CE);
  ctx.font = `500 ${Math.round(0.42 * cam.S * cam.CE)}px system-ui, Segoe UI, Arial`;
  ctx.fillText(BRAND.parkName, tl.x + (tr.x - tl.x) * 0.335, cy + 0.65 * cam.S * cam.CE);
}

export function drawFlag(ctx: CanvasRenderingContext2D, at: V2, t: number, seed: number) {
  const base = P(at.x, at.y, 0), top = P(at.x, at.y, 8.5);
  ctx.strokeStyle = '#d9dcdc'; ctx.lineWidth = Math.max(1.5, 0.12 * cam.S); ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(top.x, top.y); ctx.stroke();
  const fw = 1.25 * cam.S, fh = 3.6 * cam.S * cam.CE;
  ctx.save(); ctx.translate(top.x + 1, top.y + 4 * cam.RS);
  ctx.beginPath(); ctx.moveTo(0, 0);
  const wav = (y: number) => Math.sin(t * 2.2 + seed + y * 0.03) * 0.12 * cam.S;
  for (let y = 0; y <= fh; y += fh / 8) ctx.lineTo(fw + wav(y), y);
  for (let y = fh; y >= 0; y -= fh / 8) ctx.lineTo(wav(y) * 0.3, y);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, fw, 0); g.addColorStop(0, BRAND.tealDark); g.addColorStop(0.5, BRAND.teal); g.addColorStop(1, BRAND.tealDark);
  ctx.fillStyle = g; ctx.fill();
  emblem(ctx, fw / 2, fh * 0.32, fw * 0.32, '#ffffff');
  ctx.restore();
}

export function drawLamp(ctx: CanvasRenderingContext2D, at: V2) {
  const b = P(at.x, at.y, 0), t = P(at.x, at.y, 4.6);
  ctx.strokeStyle = '#2e3236'; ctx.lineWidth = Math.max(1.4, 0.1 * cam.S); ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
  ctx.fillStyle = '#2e3236'; ctx.fillRect(t.x - 0.25 * cam.S, t.y - 0.25 * cam.S, 0.5 * cam.S, 0.35 * cam.S);
  ctx.fillStyle = 'rgba(255,236,190,0.9)'; ctx.fillRect(t.x - 0.18 * cam.S, t.y + 0.05 * cam.S, 0.36 * cam.S, 0.07 * cam.S);
}

export function drawIntercom(ctx: CanvasRenderingContext2D, at: V2) {
  const b = P(at.x, at.y, 0), t = P(at.x, at.y, 1.3);
  ctx.fillStyle = '#d7dbdb'; ctx.fillRect(b.x - 0.16 * cam.S, t.y, 0.32 * cam.S, b.y - t.y);
  ctx.fillStyle = BRAND.teal; ctx.fillRect(b.x - 0.16 * cam.S, t.y, 0.32 * cam.S, 0.25 * cam.S);
  ctx.fillStyle = '#20262b'; ctx.fillRect(b.x - 0.1 * cam.S, t.y + 0.35 * cam.S, 0.2 * cam.S, 0.16 * cam.S);
}
export { shadeHex, light };

/** EV charging post (PDF: charging symbol at the car park). */
export function drawCharger(ctx: CanvasRenderingContext2D, at: V2) {
  const b = P(at.x, at.y, 0), t = P(at.x, at.y, 1.5);
  const w = 0.42 * cam.S;
  ctx.fillStyle = '#e9eeee'; ctx.fillRect(b.x - w / 2, t.y, w, b.y - t.y);
  ctx.fillStyle = '#2f9e5b'; ctx.fillRect(b.x - w / 2, t.y, w, 0.3 * cam.S);
  ctx.fillStyle = '#1e2a30'; ctx.fillRect(b.x - w * 0.3, t.y + 0.42 * cam.S, w * 0.6, 0.22 * cam.S);
  ctx.strokeStyle = '#1e2a30'; ctx.lineWidth = Math.max(1, 0.05 * cam.S);
  ctx.beginPath(); ctx.moveTo(b.x + w / 2, t.y + 0.8 * cam.S); ctx.quadraticCurveTo(b.x + w * 1.4, t.y + 1.0 * cam.S, b.x + w * 0.6, b.y - 0.05 * cam.S); ctx.stroke();
}

/** Blue traffic sign on a post: "Alleen personeel / dienstverkeer". */
export function drawStaffSign(ctx: CanvasRenderingContext2D, at: V2) {
  const b = P(at.x, at.y, 0), t = P(at.x, at.y, 2.3);
  ctx.strokeStyle = '#8d9396'; ctx.lineWidth = Math.max(1.4, 0.09 * cam.S); ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
  const w = 1.25 * cam.S, h = 0.82 * cam.S;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(t.x - w / 2 - 2, t.y - h - 2, w + 4, h + 4);
  ctx.fillStyle = '#1f5fa8'; ctx.fillRect(t.x - w / 2, t.y - h, w, h);
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(0.24 * cam.S)}px system-ui, Segoe UI, Arial`; ctx.fillText('ALLEEN', t.x, t.y - h * 0.68);
  ctx.font = `700 ${Math.round(0.22 * cam.S)}px system-ui, Segoe UI, Arial`; ctx.fillText('PERSONEEL', t.x, t.y - h * 0.32);
  ctx.textAlign = 'start';
}
