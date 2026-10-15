// Procedural material textures (generated once). Colours sampled by eye from the real bungalow photo
// (dark brown/purple brick, honey timber cladding, dark brown-grey roof tiles, anthracite frames).
import { mkCanvas, hrand } from './proj.ts';

export const PPM = 40; // texture pixels per metre
type Tex = HTMLCanvasElement;
const cache = new Map<string, Tex>();
const memo = (k: string, f: () => Tex) => { let t = cache.get(k); if (!t) { t = f(); cache.set(k, t); } return t; };

export function brick(seed = 1): Tex {
  return memo(`brick${seed}`, () => {
    const W = 8 * PPM, H = 4 * PPM; const { c, ctx } = mkCanvas(W, H); const r = hrand(seed);
    ctx.fillStyle = '#6f675f'; ctx.fillRect(0, 0, W, H); // mortar
    const pal = ['#3d322e', '#4a3c35', '#56453c', '#43383a', '#5c4a3f', '#382e2b', '#4f4038', '#605046', '#3f3634', '#6a5546'];
    const bh = 0.068 * PPM, bw = 0.215 * PPM, j = 0.012 * PPM;
    for (let row = 0, y = 0; y < H; row++, y += bh) {
      const off = row % 2 ? bw / 2 : 0;
      for (let x = -off; x < W; x += bw) {
        const col = pal[Math.floor(r() * pal.length)];
        ctx.fillStyle = col;
        ctx.fillRect(x + j, y + j, bw - 2 * j, bh - 2 * j);
        if (r() < 0.35) { ctx.fillStyle = `rgba(255,240,220,${0.04 + r() * 0.05})`; ctx.fillRect(x + j, y + j, bw - 2 * j, (bh - 2 * j) * 0.4); }
        if (r() < 0.2) { ctx.fillStyle = `rgba(0,0,0,${0.08 + r() * 0.1})`; ctx.fillRect(x + j, y + bh * 0.55, bw - 2 * j, bh * 0.4 - j); }
      }
    }
    // weathering
    for (let i = 0; i < 1400; i++) { ctx.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.05})`; ctx.fillRect(r() * W, r() * H, 1 + r() * 3, 1); }
    return c;
  });
}

export function timber(seed = 2, warm = 1): Tex {
  return memo(`timber${seed}-${warm}`, () => {
    const W = 4 * PPM, H = 4 * PPM; const { c, ctx } = mkCanvas(W, H); const r = hrand(seed);
    const pal = warm > 0.5 ? ['#c48d55', '#b47b45', '#d39d63', '#a8703d', '#cc955a', '#bd8650', '#dba96e'] : ['#2e3337', '#353b40', '#292e32', '#3a4045', '#30363b'];
    const bw = 0.13 * PPM;
    for (let x = 0; x < W; x += bw) {
      const col = pal[Math.floor(r() * pal.length)];
      ctx.fillStyle = col; ctx.fillRect(x, 0, bw, H);
      // grain
      for (let k = 0; k < 14; k++) {
        ctx.fillStyle = `rgba(${warm > 0.5 ? '90,50,20' : '0,0,0'},${0.05 + r() * 0.08})`;
        ctx.fillRect(x + r() * bw, r() * H, 0.6 + r() * 0.8, 6 + r() * 30);
      }
      ctx.fillStyle = `rgba(255,235,200,${warm > 0.5 ? 0.10 : 0.04})`; ctx.fillRect(x + 0.6, 0, 1, H);
      ctx.fillStyle = 'rgba(30,18,10,0.55)'; ctx.fillRect(x + bw - 1.2, 0, 1.2, H); // shadow gap
    }
    return c;
  });
}

export function roofTiles(seed = 3, base = '#3d3631'): Tex {
  return memo(`roof${seed}${base}`, () => {
    const W = 4 * PPM, H = 4 * PPM; const { c, ctx } = mkCanvas(W, H); const r = hrand(seed);
    ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
    const rowH = 0.31 * PPM, tw = 0.30 * PPM;
    for (let row = 0, y = 0; y < H; row++, y += rowH) {
      const off = row % 2 ? tw / 2 : 0;
      for (let x = -off; x < W; x += tw) {
        const l = 0.82 + r() * 0.3;
        ctx.fillStyle = `rgba(${l > 1 ? '255,245,230' : '0,0,0'},${Math.abs(l - 1) * 0.45})`;
        ctx.fillRect(x + 0.5, y, tw - 1, rowH);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + tw - 1, y, 1, rowH);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fillRect(0, y + rowH - 2.2, W, 2.2);
      ctx.fillStyle = 'rgba(255,240,220,0.10)'; ctx.fillRect(0, y + 1, W, 1.4);
    }
    return c;
  });
}

export function solar(): Tex {
  return memo('solar', () => {
    const W = 2 * PPM, H = 2 * PPM; const { c, ctx } = mkCanvas(W, H);
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#2a3446'); g.addColorStop(1, '#151b26');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(160,180,210,0.22)'; ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += PPM * 0.165) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += PPM * 0.165) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(200,210,225,0.55)'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, W - 2, H - 2);
    return c;
  });
}

export function flatRoof(seed = 4): Tex {
  return memo(`flat${seed}`, () => {
    const W = 6 * PPM, H = 6 * PPM; const { c, ctx } = mkCanvas(W, H); const r = hrand(seed);
    ctx.fillStyle = '#4f5355'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 9000; i++) { const l = 62 + r() * 60; ctx.fillStyle = `rgba(${l},${l},${l + 4},0.5)`; ctx.fillRect(r() * W, r() * H, 1.5, 1.5); }
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; for (let y = 0; y < H; y += PPM * 1.0) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    return c;
  });
}

/** Ground materials are sampled in world metres too; ground.ts maps them with the camera transform. */
export function klinkers(seed = 5, base = '#d5bf93'): Tex {
  return memo(`klink${seed}${base}`, () => {
    const W = 4 * PPM, H = 4 * PPM; const { c, ctx } = mkCanvas(W, H); const r = hrand(seed);
    ctx.fillStyle = '#b8a47c'; ctx.fillRect(0, 0, W, H);
    const bw = 0.21 * PPM, bh = 0.105 * PPM;
    for (let row = 0, y = 0; y < H; row++, y += bh) {
      const off = row % 2 ? bw / 2 : 0;
      for (let x = -off; x < W; x += bw) {
        const l = 0.9 + r() * 0.2;
        ctx.fillStyle = base; ctx.fillRect(x + 1, y + 1, bw - 2, bh - 2);
        ctx.fillStyle = `rgba(${l > 1 ? '255,255,255' : '60,40,10'},${Math.abs(l - 1) * 0.9})`; ctx.fillRect(x + 1, y + 1, bw - 2, bh - 2);
      }
    }
    return c;
  });
}

export function grassPavers(): Tex {
  return memo('gpav', () => {
    const W = 2 * PPM, H = 2 * PPM; const { c, ctx } = mkCanvas(W, H); const r = hrand(9);
    ctx.fillStyle = '#c9c2ad'; ctx.fillRect(0, 0, W, H);
    const cell = 0.2 * PPM;
    for (let y = 0; y < H; y += cell) for (let x = 0; x < W; x += cell) {
      ctx.fillStyle = r() < 0.75 ? `rgb(${95 + r() * 25},${130 + r() * 25},${60 + r() * 15})` : '#a7a18c';
      ctx.fillRect(x + cell * 0.28, y + cell * 0.28, cell * 0.44, cell * 0.44);
    }
    return c;
  });
}

export function asphalt(seed = 6, base = '#5d6061'): Tex {
  return memo(`asph${seed}${base}`, () => {
    const W = 6 * PPM, H = 6 * PPM; const { c, ctx } = mkCanvas(W, H); const r = hrand(seed);
    ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 14000; i++) { const l = r(); ctx.fillStyle = l < 0.5 ? `rgba(0,0,0,${0.05 + r() * 0.08})` : `rgba(255,255,255,${0.03 + r() * 0.06})`; ctx.fillRect(r() * W, r() * H, 1.2, 1.2); }
    for (let i = 0; i < 10; i++) { ctx.fillStyle = `rgba(0,0,0,${0.012 + r() * 0.018})`; ctx.beginPath(); ctx.ellipse(r() * W, r() * H, 20 + r() * 60, 10 + r() * 40, r() * 3, 0, Math.PI * 2); ctx.fill(); }
    return c;
  });
}

export function concreteTiles(): Tex {
  return memo('ctile', () => {
    const W = 3 * PPM, H = 3 * PPM; const { c, ctx } = mkCanvas(W, H); const r = hrand(12);
    ctx.fillStyle = '#9a958a'; ctx.fillRect(0, 0, W, H);
    const t = 0.6 * PPM;
    for (let y = 0; y < H; y += t) for (let x = 0; x < W; x += t) {
      const l = 180 + r() * 22; ctx.fillStyle = `rgb(${l},${l - 4},${l - 12})`; ctx.fillRect(x + 1, y + 1, t - 2, t - 2);
    }
    return c;
  });
}
