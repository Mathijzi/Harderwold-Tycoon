// Animated water: two layers of small wavelets that drift slowly over each other plus glints, drawn on the GPU
// (PixiJS tiling sprites with a mask of the open water). The wave pattern is drawn once; per frame only the tile
// offsets move, so it costs almost nothing. The mask comes from the ground render (open water only, so trees,
// bridges and reeds over the water stay untouched).
import { cam, mkCanvas, hrand } from './proj.ts';

/** a seamless tile of wavelets (light crest with a darker trough below), squashed for the oblique view */
export function waveTile(seed: number, size: number, density: number, light: string) {
  const { c, ctx } = mkCanvas(size, size);
  const r = hrand(seed);
  const k = cam.RS;
  const n = Math.round(density * (size / 256) ** 2);
  for (let i = 0; i < n; i++) {
    const x = r() * size, y = r() * size;
    const len = (6 + r() * 14) * k, curve = (1.2 + r() * 1.6) * k, wdt = (1 + r() * 1.2) * k;
    const a = 0.35 + r() * 0.5;
    // draw at the tile position and wrapped copies, so the tile repeats without seams
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
      const px = x + dx, py = y + dy;
      if (px < -len || px > size + len || py < -10 * k || py > size + 10 * k) continue;
      ctx.lineCap = 'round';
      ctx.strokeStyle = `rgba(10,45,55,${(a * 0.45).toFixed(3)})`; ctx.lineWidth = wdt;
      ctx.beginPath(); ctx.moveTo(px - len / 2, py + wdt); ctx.quadraticCurveTo(px, py + wdt + curve, px + len / 2, py + wdt); ctx.stroke();
      ctx.strokeStyle = `rgba(${light},${(a * 0.9).toFixed(3)})`; ctx.lineWidth = wdt * 0.8;
      ctx.beginPath(); ctx.moveTo(px - len / 2, py); ctx.quadraticCurveTo(px, py - curve, px + len / 2, py); ctx.stroke();
    }
  }
  return c;
}

/** sparse bright glints (sun on the water) */
export function glintTile(seed: number, size: number) {
  const { c, ctx } = mkCanvas(size, size);
  const r = hrand(seed);
  for (let i = 0; i < 26; i++) {
    const x = r() * size, y = r() * size, w = (3 + r() * 7) * cam.RS;
    ctx.fillStyle = `rgba(255,255,240,${(0.5 + r() * 0.5).toFixed(2)})`;
    ctx.beginPath(); ctx.ellipse(x, y, w, w * 0.25, 0, 0, Math.PI * 2); ctx.fill();
  }
  return c;
}
