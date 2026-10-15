// Incident popups on the projector: a compact, semi-transparent card anchored at the incident's location (pin),
// visible for 15 s by default (adjustable in /admin) with a short fade, stacked so cards never overlap each other. No modal, no full-screen panel.
import { cam } from './proj.ts';
import { glyph, ICON_COLORS } from './icons.ts';

type Ctx = CanvasRenderingContext2D;
/** story: a guest storyline card (purple) with its own label line, up to 4 text lines */
export interface Popup { id: string; crisis: boolean; story?: boolean; label?: string; title: string; where: string; text: string; icon: string; points?: number; ax: number; ay: number; t0: number; dur: number }

export let POPUP_SECONDS = 15;
/** set by the game master (/admin, park.display.popupSeconds); applies to new popups */
export function setPopupSeconds(s: number) { if (s >= 5 && s <= 120) POPUP_SECONDS = s; }
export const STORY_COLOR = '#b04fc4';
const MAX = 6;

/** a popup added while the projector is hidden starts its 15 s when it is drawn for the first time */
export function addPopup(list: Popup[], p: Omit<Popup, 't0' | 'dur'>, now: number) {
  if (list.some((x) => x.id === p.id)) return;
  list.push({ ...p, t0: typeof document !== 'undefined' && document.hidden ? NaN : now, dur: POPUP_SECONDS });
  while (list.length > MAX) list.shift();
}

function wrap(ctx: Ctx, text: string, w: number, maxLines: number) {
  const words = text.split(/\s+/), lines: string[] = [];
  let cur = '';
  for (const wd of words) {
    const t = cur ? `${cur} ${wd}` : wd;
    if (ctx.measureText(t).width <= w || !cur) cur = t; else { lines.push(cur); cur = wd; }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    let last = lines[maxLines - 1];
    while (last.length > 3 && ctx.measureText(`${last}…`).width > w) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

/** a screen area popups must keep clear of (the crisis status panel), in canvas pixels */
let reserved: { x: number; y: number; w: number; h: number } | null = null;
export function setPopupReserved(r: typeof reserved) { reserved = r; }
/** map: anchor position on screen (the map may be zoomed in while popups stay at normal size) */
export function drawPopups(ctx: Ctx, list: Popup[], now: number, map?: (x: number, y: number) => { x: number; y: number }) {
  for (const p of list) if (Number.isNaN(p.t0)) p.t0 = now;
  for (let i = list.length - 1; i >= 0; i--) if (now - list[i].t0 > list[i].dur) list.splice(i, 1);
  if (!list.length) return;
  const k = cam.RS, W = 600 * k, pad = 20 * k, iconR = 30 * k;
  const placed: { x: number; y: number; w: number; h: number }[] = reserved ? [reserved] : [];
  const overlaps = (r: { x: number; y: number; w: number; h: number }) => placed.some((o) => r.x < o.x + o.w + 10 * k && o.x < r.x + r.w + 10 * k && r.y < o.y + o.h + 10 * k && o.y < r.y + r.h + 10 * k);
  // the safe area keeps clear of the leaderboard (top left) and the status bar (top right)
  const top = 150 * k, bottom = cam.H - 20 * k, left = 20 * k, right = cam.W - 20 * k;
  for (const p of [...list].sort((a, b) => a.t0 - b.t0)) {
    const A = map ? map(p.ax, p.ay) : { x: p.ax, y: p.ay };
    const age = now - p.t0, left_ = p.dur - age;
    const a = Math.min(1, age / 0.35, left_ / 0.6);
    if (a <= 0) continue;
    ctx.font = `700 ${Math.round(31 * k)}px system-ui, "Segoe UI", Arial`;
    const textW = W - pad * 2 - iconR * 2 - 16 * k;
    ctx.font = `400 ${Math.round(25 * k)}px system-ui, "Segoe UI", Arial`;
    const lines = wrap(ctx, p.text, W - pad * 2, p.story ? 4 : 3);
    const h = pad * 2 + 40 * k + 32 * k + lines.length * 32 * k + 14 * k;
    // above the pin; when that is taken: higher, then below the pin, then sideways
    const cands = [0, 1, 2, 3].flatMap((n) => [
      { x: A.x - W / 2, y: A.y - 120 * k - h - n * (h + 14 * k) },
      { x: A.x - W / 2, y: A.y + 40 * k + n * (h + 14 * k) },
      { x: A.x + 60 * k + n * (W + 14 * k), y: A.y - h / 2 },
      { x: A.x - 60 * k - W - n * (W + 14 * k), y: A.y - h / 2 },
    ]);
    let r = { x: 0, y: 0, w: W, h };
    for (const c of cands) {
      r = { x: Math.max(left, Math.min(right - W, c.x)), y: Math.max(top, Math.min(bottom - h, c.y)), w: W, h };
      if (!overlaps(r)) break;
    }
    placed.push(r);
    const col = p.crisis ? '#d9423a' : p.story ? STORY_COLOR : ICON_COLORS[p.icon] ?? '#1aa3a8';
    const s = 0.94 + 0.06 * Math.min(1, age / 0.35);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(r.x + W / 2, r.y + h / 2); ctx.scale(s, s); ctx.translate(-(r.x + W / 2), -(r.y + h / 2));
    // thin leader line to the location
    const ex = Math.max(r.x + 30 * k, Math.min(r.x + W - 30 * k, A.x)), ey = r.y + h < A.y ? r.y + h : r.y > A.y ? r.y : r.y + h / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 3 * k; ctx.setLineDash([8 * k, 6 * k]);
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(A.x, A.y - 70 * k); ctx.stroke(); ctx.setLineDash([]);
    // card
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 18 * k; ctx.shadowOffsetY = 6 * k;
    ctx.fillStyle = p.crisis ? 'rgba(70,16,14,0.88)' : p.story ? 'rgba(44,18,54,0.88)' : 'rgba(16,26,32,0.84)';
    ctx.beginPath(); ctx.roundRect(r.x, r.y, W, h, 18 * k); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = col; ctx.lineWidth = 3 * k; ctx.stroke();
    // icon disc
    const cx = r.x + pad + iconR, cy = r.y + pad + iconR - 4 * k;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx, cy, iconR, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(cx, cy); glyph(ctx, p.icon, iconR * 1.15); ctx.restore();
    // title + label
    const tx = cx + iconR + 16 * k;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(16 * k)}px system-ui, "Segoe UI", Arial`;
    ctx.fillStyle = p.crisis ? '#ffb3ad' : p.story ? '#e7b8f2' : 'rgba(255,255,255,0.7)';
    ctx.fillText(p.label ?? (p.crisis ? 'CRISIS' : 'NIEUWE OPDRACHT'), tx, r.y + pad + 14 * k);
    ctx.font = `700 ${Math.round(31 * k)}px system-ui, "Segoe UI", Arial`; ctx.fillStyle = '#ffffff';
    let title = p.title;
    while (title.length > 4 && ctx.measureText(title).width > textW - (p.points ? 90 * k : 0)) title = title.slice(0, -1);
    if (title !== p.title) title = `${title.slice(0, -1)}…`;
    ctx.fillText(title, tx, r.y + pad + 50 * k);
    if (p.points) {
      const t = `+${p.points}`; ctx.font = `800 ${Math.round(24 * k)}px system-ui, Arial`;
      const tw = ctx.measureText(t).width + 22 * k;
      ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.roundRect(r.x + W - pad - tw, r.y + pad + 22 * k, tw, 36 * k, 18 * k); ctx.fill();
      ctx.fillStyle = '#1b2329'; ctx.textAlign = 'center'; ctx.fillText(t, r.x + W - pad - tw / 2, r.y + pad + 48 * k); ctx.textAlign = 'left';
    }
    ctx.font = `600 ${Math.round(24 * k)}px system-ui, "Segoe UI", Arial`; ctx.fillStyle = col === '#1aa3a8' ? '#7fe0e6' : '#ffffff';
    ctx.fillText(p.where, r.x + pad, r.y + pad + 40 * k + 32 * k + 6 * k);
    ctx.font = `400 ${Math.round(25 * k)}px system-ui, "Segoe UI", Arial`; ctx.fillStyle = 'rgba(255,255,255,0.92)';
    lines.forEach((ln, i) => ctx.fillText(ln, r.x + pad, r.y + pad + 40 * k + 32 * k + 38 * k + i * 32 * k));
    // remaining time
    const frac = Math.max(0, left_ / p.dur);
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(r.x + 18 * k, r.y + h - 10 * k, W - 36 * k, 4 * k);
    ctx.fillStyle = col; ctx.fillRect(r.x + 18 * k, r.y + h - 10 * k, (W - 36 * k) * frac, 4 * k);
    ctx.restore();
  }
}
