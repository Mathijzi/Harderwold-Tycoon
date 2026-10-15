// Static ground layer, rendered once at full resolution.
import { cam, P, mkCanvas, hrand, V2 } from './proj.ts';
import { asphalt, klinkers, grassPavers, concreteTiles, PPM } from './textures.ts';
import { pointInPolygon } from '../../shared/geom.ts';
import type { Network } from '../../sim/network.ts';
import { Placed, treeShadow, treeContact } from './nature.ts';

type Ctx = CanvasRenderingContext2D;
const path = (ctx: Ctx, pts: V2[], close = true) => { ctx.beginPath(); pts.forEach((p, i) => { const s = P(p.x, p.y); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); if (close) ctx.closePath(); };
const groundPattern = (ctx: Ctx, tex: HTMLCanvasElement) => {
  const pat = ctx.createPattern(tex, 'repeat')!;
  const o = P(0, 0);
  pat.setTransform(new DOMMatrix([cam.S / PPM, 0, 0, (cam.S * cam.SE) / PPM, o.x, o.y]));
  return pat;
};

function noiseLayer(ctx: Ctx, w: number, h: number, cells: number, seed: number, col: (v: number) => string, alpha: number) {
  const r = hrand(seed);
  const cw = Math.ceil(w / cells), ch = Math.ceil(h / cells);
  const { c, ctx: n } = mkCanvas(cw, ch);
  const img = n.createImageData(cw, ch);
  for (let i = 0; i < cw * ch; i++) { const v = r(); const m = col(v).match(/\d+/g)!.map(Number); img.data[i * 4] = m[0]; img.data[i * 4 + 1] = m[1]; img.data[i * 4 + 2] = m[2]; img.data[i * 4 + 3] = Math.round(255 * alpha * (0.35 + 0.65 * v)); }
  n.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, 0, 0, w, h);
}

/** central car park: outline (asphalt with kerb), planted islands, EV stalls (green paint) */
export interface GroundLot { outline: V2[]; islands: V2[][]; ev: V2[][] }

export interface GroundInput {
  net: Network;
  water: V2[][]; footpaths: V2[][]; roadSurfaces: V2[][]; fields: { pts: V2[]; kind: string }[];
  shadows: V2[][]; trees: Placed[]; bakedTrees: Placed[];
  parking: { pts: V2[] }[];
  flowerBeds: V2[];
  /** small sand paths from a bungalow's door to its parking pad or the road */
  sandPaths?: V2[][];
  /** paved areas: terraces (tiles) and service yards (pavers) */
  paved?: { pts: V2[]; kind: 'tiles' | 'pavers' }[];
  lot?: GroundLot;
  /** the ground is drawn spriteScale times larger than the (tree) sprites: draw those enlarged */
  spriteScale?: number;
}

export function renderGround(inp: GroundInput): HTMLCanvasElement {
  const { c, ctx } = mkCanvas(cam.W, cam.H);
  const W = cam.W, H = cam.H;
  // 1. grass
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#6c963b'); g.addColorStop(0.5, '#76a142'); g.addColorStop(1, '#6a9238');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  noiseLayer(ctx, W, H, Math.round(90 * cam.RS), 11, (v) => (v > 0.5 ? 'rgb(140,176,80)' : 'rgb(78,112,40)'), 0.35);
  noiseLayer(ctx, W, H, Math.round(28 * cam.RS), 12, (v) => (v > 0.55 ? 'rgb(152,182,86)' : 'rgb(88,122,46)'), 0.25);
  noiseLayer(ctx, W, H, Math.round(9 * cam.RS), 13, (v) => (v > 0.5 ? 'rgb(150,184,90)' : 'rgb(70,104,38)'), 0.22);
  const r = hrand(21);
  for (let i = 0; i < 70000 * cam.RS * cam.RS; i++) {
    const x = r() * W, y = r() * H;
    ctx.fillStyle = r() < 0.5 ? 'rgba(170,200,100,0.35)' : 'rgba(48,80,28,0.35)';
    ctx.fillRect(x, y, 1.2 * cam.RS, 2.2 * cam.RS);
  }
  // 2. forest floor under trees (needles, shade)
  for (const t of inp.trees) {
    const s = P(t.x, t.y);
    const rad = t.sp.r * cam.S * 2.1;
    const gg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, rad);
    const conifer = t.sp.species === 'spruce' || t.sp.species === 'pine';
    gg.addColorStop(0, conifer ? 'rgba(78,70,40,0.32)' : 'rgba(50,72,30,0.28)'); gg.addColorStop(1, 'rgba(50,70,30,0)');
    ctx.fillStyle = gg; ctx.beginPath(); ctx.ellipse(s.x, s.y, rad, rad * cam.SE, 0, 0, Math.PI * 2); ctx.fill();
  }
  // 3. fields & courts
  for (const f of inp.fields) {
    path(ctx, f.pts);
    if (f.kind === 'Tennisbanen') {
      ctx.fillStyle = '#3f8f8c'; ctx.fill(); ctx.strokeStyle = '#f2f2ee'; ctx.lineWidth = 2 * cam.RS; ctx.stroke();
      ctx.save(); path(ctx, f.pts); ctx.clip();
      const cx = f.pts.reduce((a, p) => a + p.x, 0) / f.pts.length, cy = f.pts.reduce((a, p) => a + p.y, 0) / f.pts.length;
      for (const dx of [-5.5, 5.5]) { const a = P(cx + dx - 4.1, cy - 9), b = P(cx + dx + 4.1, cy + 9); ctx.fillStyle = '#2f7e8f'; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); const m = P(cx + dx, cy); ctx.beginPath(); ctx.moveTo(a.x, m.y); ctx.lineTo(b.x, m.y); ctx.stroke(); }
      ctx.restore();
    } else {
      ctx.save(); ctx.clip();
      for (let k = 0; k < 40; k++) { const a = P(0, k * 4), b = P(400, k * 4 + 2); ctx.fillStyle = k % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'; ctx.fillRect(0, a.y, W, Math.max(2, b.y - a.y)); }
      ctx.restore(); ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2 * cam.RS; path(ctx, f.pts); ctx.stroke();
    }
  }
  // 4. water bodies
  for (const w of inp.water) {
    path(ctx, w); ctx.strokeStyle = '#596b35'; ctx.lineWidth = 0.9 * cam.S; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.strokeStyle = '#8a8c58'; ctx.lineWidth = 0.45 * cam.S; ctx.stroke();
  }
  for (const w of inp.water) {
    path(ctx, w);
    const ys = w.map((p) => P(p.x, p.y).y);
    const wg = ctx.createLinearGradient(0, Math.min(...ys), 0, Math.max(...ys));
    wg.addColorStop(0, '#2f6f80'); wg.addColorStop(1, '#3f8a98');
    ctx.fillStyle = wg; ctx.fill();
    ctx.save(); path(ctx, w); ctx.clip();
    // shallow, lighter water along the bank and a darker deep middle (blurred bank band inside the clip)
    ctx.filter = `blur(${Math.round(0.9 * cam.S)}px)`;
    ctx.strokeStyle = 'rgba(120,190,190,0.55)'; ctx.lineWidth = 2.6 * cam.S; path(ctx, w); ctx.stroke();
    ctx.strokeStyle = 'rgba(150,200,180,0.45)'; ctx.lineWidth = 1.0 * cam.S; path(ctx, w); ctx.stroke();
    ctx.filter = 'none';
    // sky reflection: a soft light streak across the water
    const xs = w.map((p) => P(p.x, p.y).x);
    const sg = ctx.createLinearGradient(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.45, 'rgba(225,245,250,0.10)'); sg.addColorStop(0.55, 'rgba(225,245,250,0.13)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg; path(ctx, w); ctx.fill();
    const rr = hrand(w.length * 7);
    for (let i = 0; i < 60; i++) { const p = w[Math.floor(rr() * w.length)]; const s = P(p.x + (rr() - 0.5) * 30, p.y + (rr() - 0.5) * 30); ctx.fillStyle = `rgba(220,240,240,${0.04 + rr() * 0.06})`; ctx.fillRect(s.x, s.y, 14 * cam.RS + rr() * 40 * cam.RS, 1.5 * cam.RS); }
    // wet, dark line right at the bank
    ctx.strokeStyle = 'rgba(30,50,40,0.55)'; ctx.lineWidth = 0.35 * cam.S; path(ctx, w); ctx.stroke();
    ctx.strokeStyle = 'rgba(200,235,235,0.45)'; ctx.lineWidth = 0.18 * cam.S; ctx.setLineDash([3 * cam.RS, 5 * cam.RS]); path(ctx, w); ctx.stroke(); ctx.setLineDash([]);
    // water lilies on the smaller, calm ponds
    const area = Math.abs(w.reduce((a, p, k) => { const q = w[(k + 1) % w.length]; return a + p.x * q.y - q.x * p.y; }, 0) / 2);
    if (area > 60 && area < 2500) {
      const xs0 = w.map((p) => p.x), ys0 = w.map((p) => p.y);
      for (let k = 0; k < Math.min(40, area / 25); k++) {
        const q = { x: Math.min(...xs0) + rr() * (Math.max(...xs0) - Math.min(...xs0)), y: Math.min(...ys0) + rr() * (Math.max(...ys0) - Math.min(...ys0)) };
        if (!pointInPolygon(q, w)) continue;
        const s0 = P(q.x, q.y), rad = (0.35 + rr() * 0.3) * cam.S, a0 = rr() * 6.28;
        ctx.fillStyle = rr() < 0.5 ? '#4f8a3c' : '#5f9a44';
        ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.ellipse(s0.x, s0.y, rad, rad * cam.SE, 0, a0, a0 + Math.PI * 1.8); ctx.closePath(); ctx.fill();
        if (rr() < 0.25) { ctx.fillStyle = rr() < 0.5 ? '#f6f2ea' : '#f2b8cc'; ctx.beginPath(); ctx.arc(s0.x, s0.y - 0.1 * cam.S, 0.16 * cam.S, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    ctx.restore();
    // reeds along the bank
    for (let i = 0; i < w.length; i++) {
      const a = w[i], b = w[(i + 1) % w.length];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      for (let d = 0; d < L; d += 1.6) {
        if (rr() < 0.55) continue;
        const p = { x: a.x + (b.x - a.x) * (d / L), y: a.y + (b.y - a.y) * (d / L) };
        const s = P(p.x, p.y);
        ctx.strokeStyle = rr() < 0.5 ? '#6d8a3a' : '#8a9a4a'; ctx.lineWidth = 1.2 * cam.RS;
        for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(s.x + k * 2 * cam.RS, s.y); ctx.lineTo(s.x + k * 2 * cam.RS + (rr() - 0.5) * 3, s.y - (6 + rr() * 8) * cam.RS); ctx.stroke(); }
      }
    }
  }
  // 4b. sand paths between bungalow and its parking pad / road
  if (inp.sandPaths?.length) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#bfa77a'; ctx.lineWidth = 1.55 * cam.S;
    for (const sp of inp.sandPaths) { path(ctx, sp, false); ctx.stroke(); }
    ctx.strokeStyle = '#dcc79c'; ctx.lineWidth = 1.25 * cam.S;
    for (const sp of inp.sandPaths) { path(ctx, sp, false); ctx.stroke(); }
    const rr = hrand(77);
    ctx.fillStyle = 'rgba(150,120,80,0.35)';
    for (const sp of inp.sandPaths) for (let i = 1; i < sp.length; i++) for (let k = 0; k < 3; k++) {
      const t = rr(), q = { x: sp[i - 1].x + (sp[i].x - sp[i - 1].x) * t + (rr() - 0.5) * 0.8, y: sp[i - 1].y + (sp[i].y - sp[i - 1].y) * t + (rr() - 0.5) * 0.8 };
      const s0 = P(q.x, q.y); ctx.fillRect(s0.x, s0.y, 1.4 * cam.RS, 1.4 * cam.RS);
    }
  }
  // 5. footpaths (tan klinkers)
  ctx.fillStyle = groundPattern(ctx, klinkers(5));
  for (const f of inp.footpaths) { path(ctx, f); ctx.fill(); }
  ctx.strokeStyle = 'rgba(120,96,60,0.45)'; ctx.lineWidth = 1 * cam.RS;
  for (const f of inp.footpaths) { path(ctx, f); ctx.stroke(); }
  // 6. paved road surfaces from the PDF (plaza, parking, roads outside the modelled graph)
  const asph = groundPattern(ctx, asphalt(6, '#64676a'));
  ctx.fillStyle = '#a9a69d';
  for (const f of inp.roadSurfaces) { path(ctx, f); ctx.lineWidth = 0.5 * cam.S; ctx.strokeStyle = '#b4b0a5'; ctx.stroke(); }
  ctx.fillStyle = asph;
  for (const f of inp.roadSurfaces) { path(ctx, f); ctx.fill(); }
  // 6b. car park: kerb, asphalt (slightly lighter than the roads), green islands, EV stalls
  if (inp.lot) {
    path(ctx, inp.lot.outline); ctx.strokeStyle = '#b4b0a5'; ctx.lineWidth = 0.8 * cam.S; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.fillStyle = groundPattern(ctx, asphalt(9, '#6c6f72')); path(ctx, inp.lot.outline); ctx.fill();
    for (const isl of inp.lot.islands) {
      path(ctx, isl); ctx.strokeStyle = '#c9c5ba'; ctx.lineWidth = 0.35 * cam.S; ctx.stroke();
      ctx.fillStyle = '#6f9c40'; path(ctx, isl); ctx.fill();
    }
    ctx.fillStyle = 'rgba(47,158,91,0.55)';
    for (const e of inp.lot.ev) { path(ctx, e); ctx.fill(); }
  }
  // 7. roads: constant-width ribbons that stop where a junction begins, and one rounded polygon per junction
  //    (fillet arcs between neighbouring roads) - no stroked lane connectors, so no bulges or smears
  const ribbon = (center: V2[], hw: number[], grow: number) => {
    const L: V2[] = [], R: V2[] = [];
    for (let i = 0; i < center.length; i++) {
      const a = center[Math.max(0, i - 1)], b = center[Math.min(center.length - 1, i + 1)];
      const tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty) || 1;
      const nx = -ty / tl, ny = tx / tl;
      L.push({ x: center[i].x - nx * (hw[i] + grow), y: center[i].y - ny * (hw[i] + grow) }); R.push({ x: center[i].x + nx * (hw[i] + grow), y: center[i].y + ny * (hw[i] + grow) });
    }
    return [...L, ...R.reverse()];
  };
  const nodeKind = (id?: string) => (id ? inp.net.nodes.get(id)?.kind : undefined);
  const isJ = (id?: string) => nodeKind(id) === 'junction';
  // trim distance per road end at a junction: enough for a smooth fillet
  const trimOf = (hw: number) => hw + 3.2;
  interface Arm { d: V2; T: V2; hw: number; surface?: string }
  const arms = new Map<string, Arm[]>();
  const pieces: { center: V2[]; hw: number[]; surface?: string; hidden?: boolean }[] = [];
  const cum = (c: V2[]) => { const o = [0]; for (let i = 1; i < c.length; i++) o.push(o[i - 1] + Math.hypot(c[i].x - c[i - 1].x, c[i].y - c[i - 1].y)); return o; };
  for (const rd of inp.net.roads) {
    if (rd.center.length < 2) continue;
    const cs = cum(rd.center), Ltot = cs[cs.length - 1];
    const t0 = isJ(rd.from) ? Math.min(Ltot / 2, trimOf(rd.halfWidth[0])) : 0;
    const t1 = isJ(rd.to) ? Math.min(Ltot / 2, trimOf(rd.halfWidth[rd.halfWidth.length - 1])) : 0;
    const at = (sd: number) => { let i = 1; while (i < cs.length - 1 && cs[i] < sd) i++; const u = (sd - cs[i - 1]) / ((cs[i] - cs[i - 1]) || 1); return { x: rd.center[i - 1].x + (rd.center[i].x - rd.center[i - 1].x) * u, y: rd.center[i - 1].y + (rd.center[i].y - rd.center[i - 1].y) * u, i }; };
    const A = at(t0), B = at(Ltot - t1);
    const c: V2[] = [{ x: A.x, y: A.y }], h: number[] = [rd.halfWidth[Math.max(0, A.i - 1)]];
    for (let i = A.i; i < B.i; i++) { c.push(rd.center[i]); h.push(rd.halfWidth[i]); }
    c.push({ x: B.x, y: B.y }); h.push(rd.halfWidth[Math.min(rd.halfWidth.length - 1, B.i)]);
    pieces.push({ center: c, hw: h, surface: rd.surface, hidden: rd.hidden });
    const arm = (node: string, P0: V2, P1: V2, hw: number) => {
      const dx = P1.x - P0.x, dy = P1.y - P0.y, l = Math.hypot(dx, dy) || 1;
      (arms.get(node) ?? arms.set(node, []).get(node)!).push({ d: { x: dx / l, y: dy / l }, T: P0, hw, surface: rd.surface });
    };
    if (isJ(rd.from) && c.length > 1) arm(rd.from!, c[0], c[Math.min(c.length - 1, 1)], h[0]);
    if (isJ(rd.to) && c.length > 1) arm(rd.to!, c[c.length - 1], c[Math.max(0, c.length - 2)], h[h.length - 1]);
  }
  const junctionPoly = (node: string, grow: number): V2[] => {
    const C = inp.net.nodes.get(node)!.pos;
    const list = (arms.get(node) ?? []).slice().sort((p, q) => Math.atan2(p.d.y, p.d.x) - Math.atan2(q.d.y, q.d.x));
    const out: V2[] = [];
    const lineX = (p: V2, u: V2, q: V2, v: V2): V2 | null => { const den = u.x * v.y - u.y * v.x; if (Math.abs(den) < 1e-3) return null; const t = ((q.x - p.x) * v.y - (q.y - p.y) * v.x) / den; return { x: p.x + u.x * t, y: p.y + u.y * t }; };
    list.forEach((k, idx) => {
      const nk = { x: -k.d.y, y: k.d.x };
      const m = list[(idx + 1) % list.length], nm = { x: -m.d.y, y: m.d.x };
      const Bk = { x: k.T.x - nk.x * (k.hw + grow), y: k.T.y - nk.y * (k.hw + grow) };
      const Ak = { x: k.T.x + nk.x * (k.hw + grow), y: k.T.y + nk.y * (k.hw + grow) };
      const Bm = { x: m.T.x - nm.x * (m.hw + grow), y: m.T.y - nm.y * (m.hw + grow) };
      out.push(Bk, Ak);
      if (list.length === 1) return;
      // rounded corner from this road's edge to the next road's edge (quadratic through the edge-line crossing)
      let ctrl = lineX(Ak, { x: -k.d.x, y: -k.d.y }, Bm, { x: -m.d.x, y: -m.d.y });
      if (!ctrl || Math.hypot(ctrl.x - C.x, ctrl.y - C.y) > 3 * Math.max(k.hw, m.hw) + 8) ctrl = { x: (Ak.x + Bm.x) / 2 * 0.5 + C.x * 0.5, y: (Ak.y + Bm.y) / 2 * 0.5 + C.y * 0.5 };
      for (let t = 0.125; t < 1; t += 0.125) {
        const a1 = (1 - t) * (1 - t), b1 = 2 * (1 - t) * t, c1 = t * t;
        out.push({ x: a1 * Ak.x + b1 * ctrl.x + c1 * Bm.x, y: a1 * Ak.y + b1 * ctrl.y + c1 * Bm.y });
      }
    });
    return out;
  };
  const junctions = [...arms.keys()].filter((n) => (arms.get(n)?.length ?? 0) >= 2);
  // curb (light kerb stones) under everything
  ctx.fillStyle = '#b4b0a5';
  for (const pc of pieces) { if (pc.hidden) continue; path(ctx, ribbon(pc.center, pc.hw, 0.35)); ctx.fill(); }
  for (const n of junctions) { path(ctx, junctionPoly(n, 0.35)); ctx.fill(); }
  for (const rd of inp.net.roads) {
    if (rd.center.length !== 1) continue;
    const s0 = P(rd.center[0].x, rd.center[0].y); ctx.beginPath(); ctx.ellipse(s0.x, s0.y, (rd.halfWidth[0] + 0.35) * cam.S, (rd.halfWidth[0] + 0.35) * cam.S * cam.SE, 0, 0, Math.PI * 2); ctx.fill();
  }
  // service paths (TD golf carts) are laid in grey concrete pavers instead of asphalt
  const pav = groundPattern(ctx, klinkers(15, '#b9b6ad'));
  const paverRoads = new Set(inp.net.roads.filter((r) => r.surface === 'pavers').map((r) => r.id));
  const paverNodes = new Set(inp.net.roads.filter((r) => r.surface === 'pavers' && r.id.startsWith('circle:')).map((r) => r.id.slice(7)));
  const isPaverEdge = (e: { roadId?: string; kind: string; from: string; stallId?: string }) => (e.roadId !== undefined && paverRoads.has(e.roadId)) || (e.kind === 'loop' && paverNodes.has(e.from)) || (e.stallId?.startsWith('TD') ?? false);
  // a few centimetres of overlap between ribbon and junction polygon, so no kerb-coloured seam shows through
  for (const pc of pieces) { if (pc.hidden) continue; ctx.fillStyle = pc.surface === 'pavers' ? pav : asph; path(ctx, ribbon(pc.center, pc.hw, 0)); ctx.fill(); }
  for (const n of junctions) { const ps = arms.get(n)!.every((x) => x.surface === 'pavers'); ctx.fillStyle = ps ? pav : asph; path(ctx, junctionPoly(n, 0)); ctx.fill(); ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.12 * cam.S; ctx.stroke(); }
  // re-fill the ribbon ends over the junction edge (covers the seam where both meet)
  for (const pc of pieces) {
    if (pc.center.length < 2 || pc.hidden) continue;
    ctx.fillStyle = pc.surface === 'pavers' ? pav : asph;
    for (const [i0, i1] of [[0, 1], [pc.center.length - 1, pc.center.length - 2]] as const) {
      const a = pc.center[i0], b = pc.center[i1], l = Math.hypot(b.x - a.x, b.y - a.y) || 1, ext = { x: a.x - (b.x - a.x) / l * 0.25, y: a.y - (b.y - a.y) / l * 0.25 };
      path(ctx, ribbon([ext, a, { x: a.x + (b.x - a.x) / l * 0.6, y: a.y + (b.y - a.y) / l * 0.6 }], [pc.hw[i0], pc.hw[i0], pc.hw[i0]], 0)); ctx.fill();
    }
  }
  for (const rd of inp.net.roads) {
    if (rd.center.length !== 1) continue;
    ctx.fillStyle = rd.surface === 'pavers' ? pav : asph;
    const s0 = P(rd.center[0].x, rd.center[0].y); ctx.beginPath(); ctx.ellipse(s0.x, s0.y, rd.halfWidth[0] * cam.S, rd.halfWidth[0] * cam.S * cam.SE, 0, 0, Math.PI * 2); ctx.fill();
  }
  // the TD golf-cart depot driveways (pavers) are the only drawn driveways
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const e of inp.net.edges.values()) {
    if (e.kind !== 'driveway' || !isPaverEdge(e)) continue;
    ctx.strokeStyle = pav; path(ctx, e.line.pts, false); ctx.lineWidth = 2.7 * cam.S; ctx.stroke();
  }
  // small bridges where a service path crosses water: wooden deck edge + railings
  for (const rd of inp.net.roads) {
    if (rd.surface !== 'pavers' || rd.center.length < 2) continue;
    const wet = rd.center.map((p) => inp.water.some((w) => pointInPolygon(p, w)));
    for (let i = 0; i < rd.center.length; i++) {
      if (!wet[i]) continue;
      let j = i; while (j + 1 < rd.center.length && wet[j + 1]) j++;
      const a = Math.max(0, i - 2), b = Math.min(rd.center.length - 1, j + 2);
      for (const side of [1, -1]) {
        const rail: { x: number; y: number }[] = [];
        for (let k = a; k <= b; k++) {
          const p0 = rd.center[Math.max(0, k - 1)], p1 = rd.center[Math.min(rd.center.length - 1, k + 1)];
          const tl = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1, nx = -(p1.y - p0.y) / tl, ny = (p1.x - p0.x) / tl;
          rail.push({ x: rd.center[k].x + nx * side * (rd.halfWidth[k] + 0.15), y: rd.center[k].y + ny * side * (rd.halfWidth[k] + 0.15) });
        }
        ctx.strokeStyle = '#7a5a3a'; ctx.lineWidth = 0.35 * cam.S; ctx.beginPath(); rail.forEach((q, n) => { const sp = P(q.x, q.y); n ? ctx.lineTo(sp.x, sp.y) : ctx.moveTo(sp.x, sp.y); }); ctx.stroke();
        ctx.strokeStyle = '#4b3a2a'; ctx.lineWidth = Math.max(1.2, 0.09 * cam.S);
        for (const q of rail) { const g0 = P(q.x, q.y, 0), g1 = P(q.x, q.y, 1.0); ctx.beginPath(); ctx.moveTo(g0.x, g0.y); ctx.lineTo(g1.x, g1.y); ctx.stroke(); }
        ctx.strokeStyle = '#9b7650'; ctx.lineWidth = Math.max(1.4, 0.12 * cam.S); ctx.beginPath(); rail.forEach((q, n) => { const sp = P(q.x, q.y, 1.0); n ? ctx.lineTo(sp.x, sp.y) : ctx.moveTo(sp.x, sp.y); }); ctx.stroke();
      }
      i = j;
    }
  }
  // paved terraces
  if (inp.paved?.length) {
    const tiles = groundPattern(ctx, concreteTiles());
    for (const t of inp.paved) {
      path(ctx, t.pts); ctx.fillStyle = '#b4b0a5'; ctx.strokeStyle = '#b4b0a5'; ctx.lineWidth = 0.6 * cam.S; ctx.stroke();
      path(ctx, t.pts); ctx.fillStyle = t.kind === 'tiles' ? tiles : pav; ctx.fill();
    }
  }
  // turning-circle island (grass) for the loop
  for (const rd of inp.net.roads) if (rd.center.length === 1) {
    const s = P(rd.center[0].x, rd.center[0].y); const ri = Math.max(1.5, rd.halfWidth[0] - 4.9);
    ctx.fillStyle = '#b4b0a5'; ctx.beginPath(); ctx.ellipse(s.x, s.y, (ri + 0.3) * cam.S, (ri + 0.3) * cam.S * cam.SE, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6f9c40'; ctx.beginPath(); ctx.ellipse(s.x, s.y, ri * cam.S, ri * cam.S * cam.SE, 0, 0, Math.PI * 2); ctx.fill();
  }
  // gate island
  for (const isl of inp.net.islands) {
    path(ctx, isl); ctx.fillStyle = '#c9c5ba'; ctx.fill(); ctx.strokeStyle = '#e4e1d8'; ctx.lineWidth = 0.25 * cam.S; ctx.stroke();
    ctx.save(); path(ctx, isl); ctx.clip(); ctx.fillStyle = 'rgba(96,140,60,0.85)';
    const cx = isl.reduce((a, p) => a + p.x, 0) / isl.length, cy = isl.reduce((a, p) => a + p.y, 0) / isl.length;
    const s = P(cx, cy); ctx.beginPath(); ctx.ellipse(s.x, s.y + 1.2 * cam.S, 0.6 * cam.S, 3.5 * cam.S * cam.SE, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  // parking pads (grass pavers like in the photo), running straight up to the road edge
  const padOf = (st: { pad: V2[]; inEdge: string; kind: string }) => {
    if (st.kind === 'depot') return st.pad;
    const dw = inp.net.edges.get(st.inEdge);
    const lane = dw ? inp.net.edges.get(dw.prev[0] ?? '') : undefined;
    if (!lane) return st.pad;
    // pad corners 0,1 face the road: slide them back to 1.4 m from the lane centre (= just over the curb)
    const [a, b, c, d] = st.pad;
    const r = { x: d.x - a.x, y: d.y - a.y }; const rl = Math.hypot(r.x, r.y) || 1; const ru = { x: r.x / rl, y: r.y / rl };
    // walk back towards the road in small steps until just over the curb (at most 6 m)
    const toEdge = (q: V2) => {
      let p = q;
      for (let k = 0; k < 30 && lane.line.project(p).d > 1.4; k++) p = { x: p.x - ru.x * 0.2, y: p.y - ru.y * 0.2 };
      return lane.line.project(p).d <= 1.6 ? p : q;
    };
    return [toEdge(a), toEdge(b), c, d];
  };
  ctx.fillStyle = groundPattern(ctx, grassPavers());
  for (const st of inp.net.stalls.values()) { path(ctx, padOf(st)); ctx.fill(); }
  ctx.strokeStyle = '#d6d0bf'; ctx.lineWidth = 1.2 * cam.RS;
  for (const st of inp.net.stalls.values()) { path(ctx, padOf(st)); ctx.stroke(); }
  // parking lot stalls (plaza)
  ctx.strokeStyle = 'rgba(245,245,240,0.85)'; ctx.lineWidth = 1.6 * cam.RS;
  for (const p of inp.parking) { path(ctx, p.pts, false); ctx.stroke(); }

  // 8. markings
  ctx.lineCap = 'butt';
  for (const rd of inp.net.roads) {
    if (rd.markings !== 'centre-dashed') continue;
    ctx.strokeStyle = 'rgba(248,248,244,0.9)'; ctx.lineWidth = 0.14 * cam.S; ctx.setLineDash([3 * cam.S, 5 * cam.S]);
    path(ctx, rd.center, false); ctx.stroke(); ctx.setLineDash([]);
  }
  for (const gd of inp.net.gates.values()) {
    const e = inp.net.edges.get(gd.edge)!;
    const p = e.line.sample(gd.stopS), t = e.line.tangent(gd.stopS), rn = { x: -t.y, y: t.x };
    const a = P(p.x + rn.x * 1.45, p.y + rn.y * 1.45), b = P(p.x - rn.x * 1.45, p.y - rn.y * 1.45);
    ctx.strokeStyle = '#f7f7f2'; ctx.lineWidth = 0.4 * cam.S; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    // lane arrow before the stop line
    const arrowAt = (s: number) => {
      const q = e.line.sample(s), tt = e.line.tangent(s), rr = { x: -tt.y, y: tt.x };
      const pts = [[0, -0.18], [2.0, -0.18], [2.0, -0.55], [3.0, 0], [2.0, 0.55], [2.0, 0.18], [0, 0.18]].map(([u, w]) => ({ x: q.x + tt.x * u + rr.x * w, y: q.y + tt.y * u + rr.y * w }));
      path(ctx, pts); ctx.fillStyle = 'rgba(247,247,242,0.9)'; ctx.fill();
    };
    for (const s0 of [gd.stopS - 9, gd.stopS - 25]) if (s0 > 2) arrowAt(s0);
    // IN / UIT
    const q = e.line.sample(gd.stopS - 4.5), s2 = P(q.x, q.y);
    ctx.save(); ctx.translate(s2.x, s2.y); ctx.scale(1, cam.SE);
    ctx.fillStyle = 'rgba(247,247,242,0.85)'; ctx.font = `700 ${Math.round(1.2 * cam.S)}px system-ui, Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(gd.direction === 'inbound' ? 'IN' : 'UIT', 0, 0); ctx.restore();
  }
  // shark teeth where the park access meets the public road (yield)
  for (const e of inp.net.edges.values()) {
    if (e.kind !== 'lane' || e.cls !== 'arrival' || e.next.length === 0) continue;
    const nx = inp.net.edges.get(e.next[0]);
    if (!nx || nx.kind !== 'connector' || !e.to.startsWith('J_A')) continue;
    const s = e.line.length - 0.6, q = e.line.sample(s), t = e.line.tangent(s), rn = { x: -t.y, y: t.x };
    for (let k = -1.2; k <= 1.21; k += 0.6) {
      const pts = [{ x: q.x + rn.x * (k - 0.22), y: q.y + rn.y * (k - 0.22) }, { x: q.x + rn.x * (k + 0.22), y: q.y + rn.y * (k + 0.22) }, { x: q.x + t.x * 0.7 + rn.x * k, y: q.y + t.y * 0.7 + rn.y * k }];
      path(ctx, pts); ctx.fillStyle = 'rgba(247,247,242,0.9)'; ctx.fill();
    }
  }
  // flower beds
  const fr = hrand(77);
  for (const f of inp.flowerBeds) for (let i = 0; i < 50; i++) {
    const s = P(f.x + (fr() - 0.5) * 6, f.y + (fr() - 0.5) * 3);
    ctx.fillStyle = ['#e46a9a', '#c45bd0', '#f2c94c', '#ffffff', '#ff8c5a'][Math.floor(fr() * 5)];
    ctx.fillRect(s.x, s.y, 2.2 * cam.RS, 2.2 * cam.RS);
  }

  // 9. shadows (soft)
  const { c: sc, ctx: sx } = mkCanvas(W, H);
  sx.fillStyle = '#000';
  for (const sh of inp.shadows) { path(sx, sh); sx.fill(); }
  for (const t of inp.trees) treeShadow(sx, t, (x, y) => P(x, y));
  // cast shadows: soft and wide
  ctx.save(); ctx.globalAlpha = 0.32; ctx.filter = `blur(${Math.round(6 * cam.RS)}px)`; ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(sc, 0, 0); ctx.restore();
  // contact shadows: a small dark spot where trunks meet the ground, so trees stand on it
  const { c: cc, ctx: cx2 } = mkCanvas(W, H);
  cx2.fillStyle = '#000';
  for (const t of inp.trees) treeContact(cx2, t, (x, y) => P(x, y));
  ctx.save(); ctx.globalAlpha = 0.38; ctx.filter = `blur(${Math.max(1, Math.round(1.6 * cam.RS))}px)`; ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(cc, 0, 0); ctx.restore();

  // 9b. trees reflected in the water (mirrored, dark and soft)
  {
    const { c: rc, ctx: rx } = mkCanvas(W, H);
    for (const t of inp.trees) {
      if (t.sp.species === 'shrub') continue;
      if (!inp.water.some((w) => pointInPolygon({ x: t.x, y: t.y + 3 }, w) || pointInPolygon({ x: t.x, y: t.y + 6 }, w))) continue;
      const s0 = P(t.x, t.y);
      const k = inp.spriteScale ?? 1;
      rx.save(); rx.translate(Math.round(s0.x - t.sp.ax * k), Math.round(s0.y)); rx.scale(k, -0.75 * k);
      rx.drawImage(t.sp.canvas, 0, -t.sp.ay); rx.restore();
    }
    ctx.save();
    ctx.beginPath(); for (const w of inp.water) { const p0 = P(w[0].x, w[0].y); ctx.moveTo(p0.x, p0.y); for (const p of w) { const q = P(p.x, p.y); ctx.lineTo(q.x, q.y); } ctx.closePath(); }
    ctx.clip();
    ctx.globalAlpha = 0.28; ctx.filter = `blur(${Math.max(1, Math.round(1.2 * cam.RS))}px) brightness(0.55) saturate(0.8)`;
    ctx.drawImage(rc, 0, 0); ctx.restore();
  }

  // 10. baked trees (far from anything that moves), back to front
  const baked = inp.bakedTrees.slice().sort((a, b) => a.key - b.key);
  const ks = inp.spriteScale ?? 1;
  for (const t of baked) { const s = P(t.x, t.y); ctx.drawImage(t.sp.canvas, Math.round(s.x - t.sp.ax * ks), Math.round(s.y - t.sp.ay * ks), t.sp.canvas.width * ks, t.sp.canvas.height * ks); }
  lastWaterMask = waterMask(ctx, inp.water);
  return c;
}

/** mask of open water (for the animated waves): inside a pond AND the pixel is still water-coloured, so trees,
 *  bridges and reeds drawn over the water are left out */
export let lastWaterMask: { canvas: HTMLCanvasElement; x: number; y: number } | null = null;
export function setWaterMask(m: typeof lastWaterMask) { lastWaterMask = m; }
function waterMask(ctx: Ctx, water: V2[][]) {
  if (!water.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const w of water) for (const p of w) { const s = P(p.x, p.y); x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x); y1 = Math.max(y1, s.y); }
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(cam.W, Math.ceil(x1)); y1 = Math.min(cam.H, Math.ceil(y1));
  const w = x1 - x0, h = y1 - y0; if (w <= 0 || h <= 0) return null;
  const { c: m, ctx: mx } = mkCanvas(w, h);
  mx.translate(-x0, -y0); mx.fillStyle = '#fff';
  for (const pts of water) { path(mx, pts); mx.fill(); }
  const inside = mx.getImageData(0, 0, w, h), px = ctx.getImageData(x0, y0, w, h);
  const d = inside.data, g = px.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const r = g[i], gg = g[i + 1], b = g[i + 2];
    const wet = b > r + 25 && b >= gg - 12; // blue-ish = open water
    d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = wet ? 255 : 0;
  }
  mx.setTransform(1, 0, 0, 1, 0, 0); mx.putImageData(inside, 0, 0);
  return { canvas: m, x: x0, y: y0 };
}

