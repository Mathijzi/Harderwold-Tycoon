// Day/night on the projector: a dark blue veil that follows the game clock (dusk 18:30-21:30, dawn 5:30-7:30),
// with warm light around lamps, lit bungalows and the main buildings. The veil is rendered into an offscreen
// canvas only when the light changes (every few game minutes or when occupancy changes), so a frame costs one
// drawImage. Pins, popups and the HUD are drawn on top and stay fully readable.
import { cam } from './proj.ts';

export interface Light { x: number; y: number; r: number; kind: 'lamp' | 'house' | 'building' }

/** 0 = full daylight .. 1 = deepest night, smooth transitions at dusk and dawn */
export function darkness(hour: number) {
  const s = (a: number, b: number, h: number) => { const x = Math.max(0, Math.min(1, (h - a) / (b - a))); return x * x * (3 - 2 * x); };
  if (hour >= 12) return s(18.5, 21.5, hour);
  return 1 - s(5.5, 7.5, hour);
}

export class NightLayer {
  private c: HTMLCanvasElement | null = null;
  private key = '';
  /** draw the veil for this darkness (0..1) with these lights; cheap when nothing changed */
  draw(ctx: CanvasRenderingContext2D, dark: number, lights: Light[], lightsKey: string) {
    if (dark < 0.02) return;
    const d = Math.round(dark * 40) / 40;
    const key = `${d}|${lightsKey}|${cam.W}x${cam.H}`;
    if (key !== this.key || !this.c) { this.key = key; this.c = this.render(d, lights); }
    ctx.drawImage(this.c!, 0, 0);
  }
  private render(dark: number, lights: Light[]) {
    const W = cam.W, H = cam.H;
    let c = this.c;
    if (!c || c.width !== W || c.height !== H) { c = document.createElement('canvas'); c.width = W; c.height = H; }
    const g = c.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    g.fillStyle = `rgba(8,16,44,${(0.62 * dark).toFixed(3)})`;
    g.fillRect(0, 0, W, H);
    // lights punch holes in the veil (only once it is dark enough for lights to be on)
    const on = Math.max(0, Math.min(1, (dark - 0.25) / 0.4));
    if (on > 0) {
      g.globalCompositeOperation = 'destination-out';
      for (const l of lights) {
        const r = l.r * cam.RS;
        const gr = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, r);
        gr.addColorStop(0, `rgba(0,0,0,${0.85 * on})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(l.x, l.y, r, 0, Math.PI * 2); g.fill();
      }
      // warm glow
      g.globalCompositeOperation = 'source-over';
      for (const l of lights) {
        const r = l.r * cam.RS * 0.7;
        const gr = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, r);
        const a = (l.kind === 'lamp' ? 0.32 : l.kind === 'house' ? 0.22 : 0.1) * on;
        gr.addColorStop(0, `rgba(255,196,110,${a})`); gr.addColorStop(1, 'rgba(255,196,110,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(l.x, l.y, r, 0, Math.PI * 2); g.fill();
      }
    }
    return c;
  }
}
