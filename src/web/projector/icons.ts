// Vector icons (white glyphs) + in-world pins, speech-bubble labels and completion effects.
import { cam } from './proj.ts';

type Ctx = CanvasRenderingContext2D;
export const ICON_COLORS: Record<string, string> = {
  wrench: '#f08a24', alert: '#d9423a', broom: '#f0a43a', key: '#1aa3a8', bug: '#7a9b2e', drop: '#1f8fc9',
  checkin: '#1aa3a8', checkout: '#5b6fd6', clean: '#1aa3a8', car: '#2d3a45',
  food: '#c2552f', swim: '#1f8fc9', bike: '#3a8f5c', tree: '#4f7f2a', paw: '#8a6a3c', star: '#b04fc4', bolt: '#e0a21a', golf: '#4b9a3a', boat: '#2f78b8', music: '#cc7400',
};

/** Draw a glyph centred at (0,0) within a unit box of size s. */
export function glyph(ctx: Ctx, name: string, s: number, col = '#fff') {
  ctx.save();
  ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const u = s / 24; ctx.scale(u, u); ctx.lineWidth = 2.4;
  switch (name) {
    case 'wrench':
      ctx.beginPath(); ctx.moveTo(-6, 7); ctx.lineTo(3, -2); ctx.lineWidth = 3.6; ctx.stroke();
      ctx.beginPath(); ctx.arc(5, -4, 4.6, Math.PI * 0.95, Math.PI * 2.55); ctx.lineWidth = 3; ctx.stroke();
      break;
    case 'alert':
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(0, 3); ctx.lineWidth = 3.6; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 8, 2, 0, Math.PI * 2); ctx.fill(); break;
    case 'broom':
      ctx.beginPath(); ctx.moveTo(6, -9); ctx.lineTo(-1, 2); ctx.lineWidth = 2.6; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(3, 5); ctx.lineTo(-1, 10); ctx.lineTo(-9, 6); ctx.closePath(); ctx.fill(); break;
    case 'key': case 'checkin':
      ctx.beginPath(); ctx.arc(-4, -3, 4.5, 0, Math.PI * 2); ctx.lineWidth = 2.8; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-1, 0); ctx.lineTo(8, 9); ctx.moveTo(4, 5); ctx.lineTo(6.5, 2.5); ctx.moveTo(6.5, 7.5); ctx.lineTo(9, 5); ctx.stroke(); break;
    case 'checkout':
      ctx.beginPath(); ctx.rect(-8, -8, 9, 16); ctx.lineWidth = 2.4; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-1, 0); ctx.lineTo(9, 0); ctx.moveTo(5, -4); ctx.lineTo(9, 0); ctx.lineTo(5, 4); ctx.stroke(); break;
    case 'bug':
      ctx.beginPath(); ctx.ellipse(0, 2, 5, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-5, -1); ctx.lineTo(-9, -4); ctx.moveTo(5, -1); ctx.lineTo(9, -4); ctx.moveTo(-5, 4); ctx.lineTo(-9, 6); ctx.moveTo(5, 4); ctx.lineTo(9, 6); ctx.lineWidth = 2; ctx.stroke(); break;
    case 'drop':
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.bezierCurveTo(6, -2, 8, 2, 8, 4); ctx.arc(0, 4, 8, 0, Math.PI); ctx.bezierCurveTo(-8, 2, -6, -2, 0, -10); ctx.fill(); break;
    case 'car':
      ctx.beginPath(); ctx.roundRect(-9, -2, 18, 7, 2); ctx.fill(); ctx.beginPath(); ctx.moveTo(-6, -2); ctx.lineTo(-3, -7); ctx.lineTo(4, -7); ctx.lineTo(7, -2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.arc(-5, 6, 2.4, 0, Math.PI * 2); ctx.arc(5, 6, 2.4, 0, Math.PI * 2); ctx.fill(); break;
    case 'check':
      ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(-2, 6); ctx.lineTo(8, -6); ctx.lineWidth = 3.6; ctx.stroke(); break;
    case 'clock':
      ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, Math.PI * 2); ctx.lineWidth = 2.4; ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(0, 0); ctx.lineTo(4, 3); ctx.stroke(); break;
    case 'food': // fork + knife
      ctx.beginPath(); ctx.moveTo(-4, -9); ctx.lineTo(-4, 9); ctx.moveTo(-7, -9); ctx.lineTo(-7, -3); ctx.quadraticCurveTo(-4, 0, -1, -3); ctx.lineTo(-1, -9); ctx.lineWidth = 2.2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(5, 9); ctx.lineTo(5, -9); ctx.quadraticCurveTo(10, -4, 6, 1); ctx.lineWidth = 2.6; ctx.stroke(); break;
    case 'swim': // waves
      for (const y of [-3, 4]) { ctx.beginPath(); for (let x = -9; x <= 9; x += 1) { const yy = y + Math.sin(x * 0.7) * 2; x === -9 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy); } ctx.lineWidth = 2.6; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(3, -9, 2.3, 0, Math.PI * 2); ctx.fill(); break;
    case 'bike':
      ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(-5.5, 4, 4.2, 0, Math.PI * 2); ctx.moveTo(9.7, 4); ctx.arc(5.5, 4, 4.2, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-5.5, 4); ctx.lineTo(-1, -4); ctx.lineTo(5.5, 4); ctx.moveTo(-1, -4); ctx.lineTo(4, -4); ctx.moveTo(-3, -6); ctx.lineTo(0, -6); ctx.stroke(); break;
    case 'tree':
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(8, 3); ctx.lineTo(-8, 3); ctx.closePath(); ctx.fill(); ctx.fillRect(-1.5, 3, 3, 7); break;
    case 'paw':
      ctx.beginPath(); ctx.ellipse(0, 4, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
      for (const [x, y] of [[-6, -2], [-2.5, -6.5], [2.5, -6.5], [6, -2]]) { ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill(); } break;
    case 'star':
      ctx.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 4 : 9.5, a = -Math.PI / 2 + (i * Math.PI) / 5; i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.fill(); break;
    case 'bolt':
      ctx.beginPath(); ctx.moveTo(2, -10); ctx.lineTo(-6, 2); ctx.lineTo(0, 2); ctx.lineTo(-2, 10); ctx.lineTo(6, -2); ctx.lineTo(0, -2); ctx.closePath(); ctx.fill(); break;
    case 'golf': // flag on a green with a ball
      ctx.beginPath(); ctx.moveTo(-2, 8); ctx.lineTo(-2, -10); ctx.lineWidth = 2.2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-2, -10); ctx.lineTo(8, -6.5); ctx.lineTo(-2, -3); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, 8.5, 9, 2.4, 0, 0, Math.PI * 2); ctx.lineWidth = 1.8; ctx.stroke();
      ctx.beginPath(); ctx.arc(5.5, 5, 1.9, 0, Math.PI * 2); ctx.fill(); break;
    case 'boat': // sloep on waves
      ctx.beginPath(); ctx.moveTo(-9, -1); ctx.lineTo(9, -1); ctx.lineTo(6, 4); ctx.lineTo(-6, 4); ctx.closePath(); ctx.fill();
      ctx.fillRect(-3, -6, 6, 5);
      ctx.beginPath(); for (let x = -10; x <= 10; x += 1) { const yy = 8 + Math.sin(x * 0.8) * 1.4; x === -10 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy); } ctx.lineWidth = 2; ctx.stroke(); break;
    case 'music': // double note
      ctx.beginPath(); ctx.moveTo(-4, 6); ctx.lineTo(-4, -8); ctx.lineTo(7, -10); ctx.lineTo(7, 4); ctx.lineWidth = 2.4; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(-6.5, 6.5, 3.2, 2.4, -0.4, 0, Math.PI * 2); ctx.ellipse(4.5, 4.5, 3.2, 2.4, -0.4, 0, Math.PI * 2); ctx.fill(); break;
    default:
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** Teardrop map pin with icon, as in the approved concept (white rim, coloured disc, small tail). */
export function pin(ctx: Ctx, x: number, y: number, icon: string, t: number, opts: { claimed?: boolean; count?: number; scale?: number } = {}) {
  const R = 33 * cam.RS * (opts.scale ?? 1);
  const bob = Math.sin(t * 2.4 + x * 0.01) * 4 * cam.RS;
  const cy = y - R * 1.35 + bob;
  const col = ICON_COLORS[icon] ?? '#1aa3a8';
  // pulse ring for unclaimed incidents
  if (!opts.claimed) {
    const ph = (t * 0.8 + x * 0.001) % 1;
    ctx.strokeStyle = `rgba(255,255,255,${0.55 * (1 - ph)})`; ctx.lineWidth = 3 * cam.RS;
    ctx.beginPath(); ctx.ellipse(x, y + 2 * cam.RS, R * (0.4 + ph * 1.1), R * (0.4 + ph * 1.1) * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 10 * cam.RS; ctx.shadowOffsetY = 4 * cam.RS;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(x, cy, R, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - R * 0.38, cy + R * 0.85); ctx.lineTo(x, cy + R * 1.42); ctx.lineTo(x + R * 0.38, cy + R * 0.85); ctx.fill();
  ctx.restore();
  ctx.fillStyle = opts.claimed ? shade(col) : col;
  ctx.beginPath(); ctx.arc(x, cy, R * 0.84, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.translate(x, cy); glyph(ctx, icon, R * 1.0); ctx.restore();
  if (opts.claimed) {
    // small clock badge = being handled
    const bx = x + R * 0.78, by = cy - R * 0.72, br = R * 0.42;
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(bx, by); glyph(ctx, 'clock', br * 1.5, '#2b3a45'); ctx.restore();
  }
  if (opts.count && opts.count > 1) {
    const bx = x - R * 0.78, by = cy - R * 0.72, br = R * 0.42;
    ctx.fillStyle = '#d9423a'; ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(br * 1.25)}px system-ui, Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(opts.count), bx, by + 1);
  }
}
const shade = (hex: string) => { const n = parseInt(hex.slice(1), 16); const f = (s: number) => Math.round(((n >> s) & 255) * 0.72); return `rgb(${f(16)},${f(8)},${f(0)})`; };

/** Compact pill label (e.g. above a queued car or next to a barrier). */
export function pill(ctx: Ctx, x: number, y: number, icon: string | null, text: string, bg: string, fg = '#ffffff', size = 1) {
  const h = 34 * cam.RS * size;
  ctx.font = `600 ${Math.round(h * 0.56)}px system-ui, "Segoe UI", Arial`;
  const tw = text ? ctx.measureText(text).width : 0;
  const w = (icon ? h : 0) + tw + (text ? h * 0.55 : 0) + (icon && !text ? 0 : h * 0.25);
  const x0 = x - w / 2, y0 = y - h;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 8 * cam.RS; ctx.shadowOffsetY = 3 * cam.RS;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x0, y0, w, h, h / 2); ctx.fill();
  ctx.restore();
  // little tail
  ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(x - h * 0.18, y0 + h - 1); ctx.lineTo(x, y0 + h + h * 0.28); ctx.lineTo(x + h * 0.18, y0 + h - 1); ctx.fill();
  let cx = x0 + h * 0.25;
  if (icon) { ctx.save(); ctx.translate(cx + h * 0.4, y0 + h / 2); glyph(ctx, icon, h * 0.62, fg); ctx.restore(); cx += h * 0.85; }
  if (text) { ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(text, cx, y0 + h / 2 + 1); }
}

export interface Fx { x: number; y: number; t0: number; kind: 'points' | 'burst' | 'ring'; text?: string; color: string }
export function drawFx(ctx: Ctx, fx: Fx[], now: number) {
  for (const f of fx) {
    const age = now - f.t0;
    if (f.kind === 'points') {
      const k = Math.min(1, age / 2.2);
      ctx.globalAlpha = 1 - k * k;
      ctx.font = `800 ${Math.round(40 * cam.RS)}px system-ui, Arial`; ctx.textAlign = 'center';
      ctx.lineWidth = 6 * cam.RS; ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.strokeText(f.text ?? '', f.x, f.y - k * 90 * cam.RS);
      ctx.fillStyle = f.color; ctx.fillText(f.text ?? '', f.x, f.y - k * 90 * cam.RS);
      ctx.globalAlpha = 1;
    } else if (f.kind === 'burst') {
      const k = Math.min(1, age / 1.2);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const d = (20 + 70 * k) * cam.RS;
        ctx.fillStyle = i % 2 ? f.color : '#ffffff'; ctx.globalAlpha = 1 - k;
        ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d * 0.7, (5 - 3 * k) * cam.RS, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (f.kind === 'ring') {
      const k = Math.min(1, age / 1.4);
      ctx.strokeStyle = f.color; ctx.globalAlpha = 1 - k; ctx.lineWidth = 4 * cam.RS;
      ctx.beginPath(); ctx.ellipse(f.x, f.y, (10 + 60 * k) * cam.RS, (10 + 60 * k) * cam.RS * 0.5, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
}
