// Weather on the projector, all on the GPU (PixiJS): drifting cloud shadows, a wet/dark tint, rain streaks, fog
// banks and lightning flashes. Textures are drawn once; per frame only offsets and alphas change, and every
// alpha eases towards its target so weather changes fade in and out over a few seconds.
import { Container, Sprite, Texture, TilingSprite } from 'pixi.js';
import { cam, mkCanvas, hrand } from './proj.ts';

export type Kind = 'zon' | 'halfbewolkt' | 'bewolkt' | 'regen' | 'onweer' | 'mist';
export interface WeatherView { kind: Kind; intensity: number; wind: number }

function cloudTile(size: number, seed: number, light = false) {
  const { c, ctx } = mkCanvas(size, size);
  const r = hrand(seed);
  for (let i = 0; i < 14; i++) {
    const x = r() * size, y = r() * size, rad = size * (0.08 + r() * 0.16);
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
      const col = light ? '255,255,255' : '10,18,28';
      g.addColorStop(0, `rgba(${col},0.9)`); g.addColorStop(0.6, `rgba(${col},0.45)`); g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x + dx, y + dy, rad * 1.5, rad, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  return c;
}
function rainTile(size: number, seed: number, n: number, len: number) {
  const { c, ctx } = mkCanvas(size, size);
  const r = hrand(seed);
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = r() * size, y = r() * size, l = len * (0.6 + r() * 0.8);
    ctx.strokeStyle = `rgba(210,225,240,${(0.25 + r() * 0.45).toFixed(2)})`; ctx.lineWidth = Math.max(1, 1.3 * cam.RS);
    for (const dy of [-size, 0, size]) { ctx.beginPath(); ctx.moveTo(x, y + dy); ctx.lineTo(x - l * 0.18, y + dy + l); ctx.stroke(); }
  }
  return c;
}

export class WeatherFx {
  layer = new Container();
  private clouds: TilingSprite; private fog: TilingSprite; private rainA: TilingSprite; private rainB: TilingSprite;
  private tint: Sprite; private flash: Sprite;
  private cur = { clouds: 0, tint: 0, fog: 0, rain: 0 };
  private nextFlash = 0; private flashT = -1;
  constructor() {
    const W = cam.W, H = cam.H, k = cam.RS;
    this.clouds = new TilingSprite({ texture: Texture.from(cloudTile(Math.round(1400 * k), 5)), width: W, height: H });
    this.tint = new Sprite(Texture.WHITE); this.tint.width = W; this.tint.height = H; this.tint.tint = 0x1c2a3a;
    this.fog = new TilingSprite({ texture: Texture.from(cloudTile(Math.round(1100 * k), 9, true)), width: W, height: H });
    this.rainA = new TilingSprite({ texture: Texture.from(rainTile(Math.round(512 * k), 3, 160, 26 * k)), width: W, height: H });
    this.rainB = new TilingSprite({ texture: Texture.from(rainTile(Math.round(384 * k), 7, 90, 40 * k)), width: W, height: H });
    this.flash = new Sprite(Texture.WHITE); this.flash.width = W; this.flash.height = H; this.flash.tint = 0xe8f0ff;
    for (const s of [this.clouds, this.tint, this.fog, this.rainA, this.rainB, this.flash]) { s.alpha = 0; this.layer.addChild(s); }
  }
  /** per frame: t in seconds */
  update(w: WeatherView | null, t: number, dt: number) {
    const kind = w?.kind ?? 'zon', i = w?.intensity ?? 0.5, wind = w?.wind ?? 2;
    const target = {
      clouds: { zon: 0, halfbewolkt: 0.14, bewolkt: 0.26, regen: 0.3, onweer: 0.38, mist: 0.05 }[kind],
      tint: { zon: 0, halfbewolkt: 0.03, bewolkt: 0.1, regen: 0.16 + 0.08 * i, onweer: 0.26, mist: 0.06 }[kind],
      fog: kind === 'mist' ? 0.32 + 0.3 * i : kind === 'regen' ? 0.05 : 0,
      rain: kind === 'regen' ? 0.35 + 0.45 * i : kind === 'onweer' ? 0.9 : 0,
    };
    const ease = Math.min(1, dt * 0.6); // a few seconds to fade in/out
    for (const k of Object.keys(this.cur) as (keyof typeof this.cur)[]) this.cur[k] += (target[k] - this.cur[k]) * ease;
    const k = cam.RS, wx = (4 + wind * 4) * k;
    this.clouds.alpha = this.cur.clouds; this.clouds.tilePosition.set(t * wx, t * wx * 0.35);
    this.tint.alpha = this.cur.tint;
    this.fog.alpha = this.cur.fog; this.fog.tilePosition.set(t * 9 * k, Math.sin(t * 0.05) * 40 * k);
    const fall = (kind === 'onweer' ? 1300 : 900) * k;
    this.rainA.alpha = this.cur.rain; this.rainA.tilePosition.set(t * fall * 0.18 + t * wind * 10 * k, t * fall);
    this.rainB.alpha = this.cur.rain * 0.7; this.rainB.tilePosition.set(t * fall * 0.15, t * fall * 1.3);
    // lightning: a double flash every 5-15 seconds during a thunderstorm
    if (kind === 'onweer') {
      if (t > this.nextFlash) { this.flashT = t; this.nextFlash = t + 5 + Math.random() * 10; onThunder?.(); }
      const a = this.flashT < 0 ? 0 : t - this.flashT;
      this.flash.alpha = a < 0.08 ? 0.55 : a < 0.16 ? 0 : a < 0.24 ? 0.35 : a < 0.6 ? 0.35 * (1 - (a - 0.24) / 0.36) : 0;
    } else this.flash.alpha = 0;
    this.layer.visible = this.cur.clouds + this.cur.tint + this.cur.fog + this.cur.rain + this.flash.alpha > 0.005;
  }
}
/** called at each lightning flash (thunder sound) */
export let onThunder: (() => void) | null = null;
export function setThunderHandler(f: () => void) { onThunder = f; }
