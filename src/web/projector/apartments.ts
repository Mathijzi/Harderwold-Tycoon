// Residentie Harderwold (2, the X-shaped apartment building), after street-level photos supplied by the client:
// white and stepped. A full ground floor with French doors and a hedged garden per apartment; a first floor set back
// on one side (roof terrace with a glass balustrade under a white overhang carried by slim white columns); a third
// floor only around the crossing. Upper floors in white horizontal siding, dark window frames, white roof slabs with
// a thin overhang, and a dark brick entrance block with the name at the end of one wing.
// Built as a centre square plus four arms (no overlapping volumes, so the painter's order holds).
import { V2, V3, Face, renderFaces, screenBounds, shadowPt, cam, P, fillTex } from './proj.ts';
import { brick, concreteTiles, PPM } from './textures.ts';
import { hull, Sprite } from './houses.ts';
import { frame, plaster, pane, fascia, gravelRoof } from './villas.ts';

export interface ApartmentsSpec { id: string; name: string; center: V2; armM: number; widthM: number; anglesDeg: number[]; entranceArm?: number; sign?: string }

const SIDING = (ctx: CanvasRenderingContext2D, w: number, hh: number) => {
  plaster(ctx, w, hh);
  ctx.fillStyle = 'rgba(0,0,0,0.07)';
  for (let y = 0.18; y < hh; y += 0.2) ctx.fillRect(0, y, w, 0.03); // horizontal boards
};
const HEDGE = (side: string, ctx: CanvasRenderingContext2D, w: number, hh: number) => {
  ctx.fillStyle = side === 'top' ? '#557f34' : '#41692a'; ctx.fillRect(0, 0, w, hh);
  ctx.fillStyle = 'rgba(130,180,80,0.35)'; for (let x = 0.1; x < w; x += 0.37) for (let y = 0.1; y < hh; y += 0.29) ctx.fillRect(x + ((y * 7) % 0.2), y, 0.16, 0.12);
};

export function buildApartments(sp: ApartmentsSpec) {
  const parts: { faces: Face[]; verts: V3[]; fp: V2[] }[] = [];
  const H1 = 3.1, H2 = 3.0, H3 = 3.0, SL = 0.32;
  const half = sp.widthM / 2, c0 = half;          // the centre square spans +-half in both arm directions
  const z1 = H1, z1s = z1 + SL, z2 = z1s + H2, z2s = z2 + SL, z3 = z2s + H3, z3s = z3 + SL;
  const mk = (rotDeg: number) => frame({ number: 0, legendType: null, x: sp.center.x, y: sp.center.y, rot: (rotDeg * Math.PI) / 180, focus: false, scale: 1 });

  // ---- centre square: three storeys, the stair/lift core
  {
    const F = mk(sp.anglesDeg[0]);
    F.box(-half, -half, half, half, 0, z1, (_s, ctx, w, hh) => plaster(ctx, w, hh));
    F.box(-half, -half, half, half, z1, z1s, (s, ctx, w, hh) => (s === 'top' ? gravelRoof(ctx, w, hh) : fascia(ctx, w, hh)));
    F.box(-half, -half, half, half, z1s, z2, (_s, ctx, w, hh) => { SIDING(ctx, w, hh); pane(ctx, w * 0.3, 0.6, w * 0.4, 1.5, 3); });
    F.box(-half - 0.2, -half - 0.2, half + 0.2, half + 0.2, z2, z2s, (s, ctx, w, hh) => (s === 'top' ? gravelRoof(ctx, w, hh) : fascia(ctx, w, hh)));
    F.box(-half + 1, -half + 1, half - 1, half - 1, z2s, z3, (_s, ctx, w, hh) => { SIDING(ctx, w, hh); pane(ctx, w * 0.1, 0.5, w * 0.8, 1.7, 5, 0.1); });
    F.box(-half + 0.6, -half + 0.6, half - 0.6, half - 0.6, z3, z3s, (s, ctx, w, hh) => (s === 'top' ? gravelRoof(ctx, w, hh) : fascia(ctx, w, hh)));
    const fp = [F.L(-half, -half), F.L(half, -half), F.L(half, half), F.L(-half, half)];
    parts.push({ faces: F.faces, verts: [...fp, ...fp.map((p) => ({ ...p, z: z3s + 0.5 }))], fp: fp.map((p) => ({ x: p.x, y: p.y })) });
  }

  // ---- four arms
  sp.anglesDeg.forEach((ang, ai) => {
    const F = mk(ang);
    const s0 = c0, s1 = sp.armM, len = s1 - s0;
    const terr = ai % 2 === 0 ? 1 : -1;            // side of the first-floor roof terrace (+a or -a)
    const a2 = terr > 0 ? [-half, half - 3.4] : [-half + 3.4, half];   // first-floor walls (set back on the terrace side)
    const s3 = s0 + Math.min(16, len * 0.4);      // third floor only near the crossing
    // gardens: a low hedge line 3 m in front of both long facades, with dividers per apartment, and a paved path
    for (const sd of [-1, 1]) {
      const af = sd * (half + 3.2);
      F.ground(sd > 0 ? half : af, s0, sd > 0 ? af : -half, s1, 0.02, (ctx, w, hh) => fillTex(ctx, concreteTiles(), PPM * 0.6, w, hh), -1e6);
      F.box(af - 0.35, s0 + 2, af + 0.35, s1 - 0.5, 0, 1.0, HEDGE);
      for (let s = s0 + 4.5; s < s1 - 1; s += 9) F.box(sd > 0 ? half : af, s - 0.3, sd > 0 ? af : -half, s + 0.3, 0, 1.0, HEDGE);
    }
    // ground floor: French doors per apartment on the long sides, windows at the end
    F.box(-half, s0, half, s1, 0, z1, (side, ctx, w, hh) => {
      plaster(ctx, w, hh);
      if (side === 'left' || side === 'right') for (let x = 1.6; x < w - 1.6; x += 4.5) { pane(ctx, x, hh - 2.45, 1.7, 2.35, 2, 0.16); pane(ctx, x + 2.4, 0.7, 1.0, 1.2, 1, 0.08); }
      else for (let x = 2; x < w - 2; x += 4) pane(ctx, x, 0.8, 1.6, 1.3, 2);
    });
    // first-floor slab = floor of the roof terrace (tiles on the open side)
    F.box(-half - 0.25, s0, half + 0.25, s1 + 0.25, z1, z1s, (side, ctx, w, hh) => {
      if (side !== 'top') return fascia(ctx, w, hh);
      gravelRoof(ctx, w, hh);
      const tx = terr > 0 ? w - 3.65 : 0; ctx.save(); ctx.beginPath(); ctx.rect(tx, 0, 3.65, hh); ctx.clip(); fillTex(ctx, concreteTiles(), PPM * 0.6, w, hh); ctx.restore();
    });
    // first floor (siding), big sliding doors to the terrace, windows on the closed side
    F.box(a2[0], s0, a2[1], s1, z1s, z2, (side, ctx, w, hh) => {
      SIDING(ctx, w, hh);
      const toTerr = (side === 'right' && terr > 0) || (side === 'left' && terr < 0);
      if (side === 'left' || side === 'right') for (let x = 1.4; x < w - 1.6; x += 4.5) toTerr ? pane(ctx, x, hh - 2.35, 2.6, 2.25, 2, 0.15) : pane(ctx, x + 0.6, 0.7, 1.2, 1.3, 1, 0.08);
      else pane(ctx, w * 0.3, 0.7, w * 0.4, 1.3, 2);
    });
    // glass balustrade along the terrace edge, and slim white columns carrying the overhanging roof slab
    const ae = terr * (half - 0.15);
    F.box(Math.min(ae, ae + terr * 0.06), s0 + 0.3, Math.max(ae, ae + terr * 0.06), s1, z1s, z1s + 1.0, (side, ctx, w, hh) => {
      ctx.fillStyle = side === 'top' ? '#f2f2ee' : 'rgba(200,220,228,0.55)'; ctx.fillRect(0, 0, w, hh);
      ctx.fillStyle = '#f2f2ee'; ctx.fillRect(0, 0, w, 0.08);
    });
    for (let s = s0 + 4.5; s < s1 - 0.5; s += 4.5) F.box(ae - 0.15 * terr - 0.15, s - 0.15, ae - 0.15 * terr + 0.15, s + 0.15, z1s, z2, (_s, ctx, w, hh) => { ctx.fillStyle = '#f7f7f3'; ctx.fillRect(0, 0, w, hh); });
    // first-floor roof slab over the full width (overhang over the terrace)
    F.box(-half - 0.2, s0, half + 0.2, s1 + 0.3, z2, z2s, (side, ctx, w, hh) => (side === 'top' ? gravelRoof(ctx, w, hh) : fascia(ctx, w, hh)));
    // third floor near the crossing
    F.box(-half + 1.2, s0, half - 4.6, s3, z2s, z3, (side, ctx, w, hh) => { SIDING(ctx, w, hh); if (side !== 'top') for (let x = 1; x < w - 1.5; x += 3.2) pane(ctx, x, 0.6, 2.2, 1.7, 2, 0.1); });
    F.box(-half + 0.9, s0, half - 4.3, s3 + 0.3, z3, z3s, (side, ctx, w, hh) => (side === 'top' ? gravelRoof(ctx, w, hh) : fascia(ctx, w, hh)));
    // entrance: dark brick block with the name, at the end of one arm
    if (ai === (sp.entranceArm ?? -1)) {
      F.box(-half * 0.55, s1, half * 0.55, s1 + 3.2, 0, z1s + 0.4, (side, ctx, w, hh) => {
        if (side === 'top') { ctx.fillStyle = '#3a3c3f'; ctx.fillRect(0, 0, w, hh); return; }
        fillTex(ctx, brick(9), PPM, w, hh); ctx.fillStyle = 'rgba(25,25,28,0.55)'; ctx.fillRect(0, 0, w, hh);
        if (side === 'front') {
          ctx.fillStyle = '#4a5458'; ctx.fillRect(w * 0.62, hh - 2.4, 1.3, 2.4);
          ctx.fillStyle = '#f2f2ee'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
          ctx.font = '500 0.62px system-ui, Arial'; ctx.fillText('Residentie', 0.5, hh * 0.32);
          ctx.font = '600 0.7px system-ui, Arial'; ctx.fillText(sp.sign ?? 'Harderwold', 0.5, hh * 0.32 + 0.75);
        }
      });
    }
    const verts: V3[] = [];
    for (const [a, b] of [[-half - 3.8, s0], [half + 3.8, s0], [-half - 3.8, s1 + 3.5], [half + 3.8, s1 + 3.5]]) { verts.push(F.L(a, b, 0)); verts.push(F.L(a, b, z3s + 0.5)); }
    parts.push({ faces: F.faces, verts, fp: [F.L(-half, s0), F.L(half, s0), F.L(half, s1), F.L(-half, s1)].map((p) => ({ x: p.x, y: p.y })) });
  });

  const sprites: Sprite[] = [];
  const shadows: V2[][] = [];
  parts.forEach((pt, i) => {
    for (const fc of pt.faces) if (fc.key === undefined || Number.isNaN(fc.key)) fc.key = 0;
    pt.faces.sort((a, b) => a.key - b.key);
    const bb = screenBounds(pt.verts, 8);
    const c = renderFaces(pt.faces, bb);
    const front = Math.max(...pt.fp.map((p) => p.y));
    const ctr = pt.fp.reduce((q, p) => ({ x: q.x + p.x / pt.fp.length, y: q.y + p.y / pt.fp.length }), { x: 0, y: 0 });
    sprites.push({ canvas: c, x: bb.x0, y: bb.y0, key: front * cam.CE, kind: 'building', id: `${sp.id}${i}`, anchor: P(ctr.x, ctr.y, z3s + 1.5), topZ: z3s, footprint: pt.fp });
    shadows.push(hull([...pt.fp, ...pt.fp.map((p) => shadowPt({ ...p, z: i === 0 ? z3s : z2s }))]));
  });
  return { sprites, shadows, footprints: parts.map((p) => p.fp) };
}
