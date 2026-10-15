// Projector (display only). Fixed 3840x2160 composition, server-authoritative state via SSE.
import { buildNetwork, Network, NetworkJson, SectorJson, HouseInfo } from '../../sim/network.ts';
import { cam, setupCamera, P, Pv, STAGE, V2, hrand, mkCanvas, reduceCanvas } from './proj.ts';
import { buildHouse, Sprite, variantFor } from './houses.ts';
import { buildKiosk, drawSign, drawFlag, drawLamp, drawIntercom, drawCharger, drawStaffSign, Structure } from './buildings.ts';
import { Massing, massingBlocks, buildBlock, buildTent, blockCorners, terraceFor, drawParasol, drawBollard, Block } from './complex.ts';
import { pointInPolygon } from '../../shared/geom.ts';
import { Mask, placeTrees, Placed, makeTree } from './nature.ts';
import { renderGround, GroundLot, lastWaterMask, setWaterMask } from './ground.ts';
import { drawVehicle, drawPedestrian, drawBarrier, VehDraw } from './vehicles.ts';
import { pin, pill, drawFx, Fx } from './icons.ts';
import { loadBranding } from './brand.ts';
import { Ambient, setLifeScale } from './ambient.ts';
import { NightLayer, darkness, Light } from './daynight.ts';
import { setThunderHandler, WeatherView } from './weatherfx.ts';
import { PixiStage, Drawable } from './pixi.ts';
import { Popup, addPopup, drawPopups, setPopupSeconds, setPopupReserved } from './popups.ts';
import { initSound, playNotification, ambienceTick, playThunder } from './sound.ts';

const qs = new URLSearchParams(location.search);
/** internal render resolution: ?res=1080|1440|4k; by default it follows the screen, so a laptop window does not
 *  render (and composite) 4x the pixels it can show, and the browser keeps room for other tabs */
// CSS pixels, not device pixels: a Retina laptop (dpr 2) must not render 4K; a 4K beamer at dpr 1 still gets 4K
const autoRes = () => { const px = Math.max(window.innerWidth, window.screen?.width ?? 0); return px <= 2100 ? 0.5 : px <= 2800 ? 2 / 3 : 1; };
const RS = qs.get('res') === '1080' ? 0.5 : qs.get('res') === '1440' ? 2 / 3 : qs.get('res') === '4k' || qs.get('res') === '2160' ? 1 : autoRes();
/** frame cap (?fps=); the loop also never uses more than about half of the main thread */
const MAX_FPS = Math.max(5, Math.min(144, Number(qs.get('fps') ?? 60)));
/** give the browser a moment between long build steps (other tabs of the same site may share this process) */
const pause = () => new Promise((r) => setTimeout(r, 0));
const DEBUG_KEY = qs.get('debug');
const HUD_SCALE = Number(qs.get('hud') ?? 1);
/** PixiJS (WebGL) compositor by default; ?renderer=canvas keeps the original Canvas 2D path as a fallback */
const USE_PIXI = qs.get('renderer') !== 'canvas';
let pixi: PixiStage | null = null;

interface Frame { t: number; at: number; vehicles: VehDraw[]; gates: { id: string; phase: string; since: number; authorizedVehicle?: string; queue: string[]; openSec: number; closeSec: number }[]; pedestrians: { id: string; x: number; y: number; h: number; walking: boolean; color: string }[] }
interface StateMsg {
  park: { gameMs: number; satisfaction: number; openTasks: number; timeScale: number; paused: boolean; gates: { id: string; phase: string; queue: number }[] };
  leaderboard: { rank: number; displayName: string; score: number }[];
  houses: { id: string; number: number; state: string; cond?: number; incidents: { taskId: string; icon: string; state: string; title: string }[] }[];
  facilities?: { id: string; pos: { x: number; y: number }; incidents: { taskId: string; icon: string; state: string; title: string }[] }[];
  gateTasks: { taskId: string; vehicleId: string; gateId: string; state: string; kind: string }[];
  tokens: { vehicleId: string; gateId: string; status: string }[];
}

let net: Network;
/** loose decor from park.json (map-specific positions in PDF points) */
interface Decor { sign?: number[]; flags?: number[][]; flowerBeds?: number[][]; lampRoad?: string; staffRoad?: string; focus?: Record<string, string>; trees?: number[][] }
interface Golf { fairways: number[][][]; greens: number[][][]; bunkers: number[][][] }
let sector: SectorJson & { terrain: { water: number[][][]; footpaths: number[][][]; roadSurfaces: number[][][]; golf?: Golf; forest?: number[][][] }; structures: Structure[]; facilities: { key: string; name: string; pt: number[] }[]; massing?: Massing; decor?: Decor };
const frames: Frame[] = [];
let state: StateMsg | null = null;
let rate = 1;
const fx: Fx[] = [];
let ground: HTMLCanvasElement;
/** designed car park (park.json parkingLot, PDF points; see tools/plaza_layout.py) */
interface LotSpec { origin: number[]; angleDeg: number; lengthPt: number; depthPt: number; outline: number[][]; rows: { v0: number; v1: number; nose: number }[]; stallU0: number; stallWidthPt: number; stalls: number; aisles: number[]; ev: { row: number; count: number } }
interface Obj extends Drawable { rect?: [number, number, number, number]; fade?: number; mask?: Mask4; ox?: number; oy?: number }
/** Alpha mask at 1/4 resolution: an object only fades when its opaque pixels really cover a moving vehicle. */
interface Mask4 { w: number; h: number; d: Uint8Array }
function maskOf(c: HTMLCanvasElement): Mask4 {
  const img = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  const w = Math.ceil(c.width / 4), h = Math.ceil(c.height / 4), d = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((y * 4) * c.width + x * 4) * 4 + 3; if (img[i] > 150) d[y * w + x] = 1; }
  return { w, h, d };
}
let lastFrameT = 0;
const statics: Obj[] = [];
/** decorative park life (ducks, strollers, playing children); off with ?life=0 */
let ambient: Ambient | null = null;
/** ground supersampling (?groundss=1 turns it off on a slow PC) */
/** close-up camera (?zoom=2..6, ?focus=receptie|<huisnummer>|<letter>|x,y): everything is drawn at that scale */
const ZOOM = Math.max(1, Math.min(6, Number(qs.get('zoom') ?? 1) || 1));
const GROUND_SS = Math.max(1, Math.min(3, Number(qs.get('groundss') ?? (ZOOM > 1 ? 1 : 2))));
/** is a world point (with a margin in metres) inside the view? (close-up: only build what can be seen) */
const inView = (x: number, y: number, m = 30) => { if (ZOOM <= 1) return true; const s = P(x, y); const k = m * cam.S; return s.x > -k && s.x < cam.W + k && s.y > -k * 1.4 && s.y < cam.H + k; };
/** world positions of light sources for the night view (lamps, bungalows by id, main buildings) */
const lightSrc = { lamps: [] as V2[], houses: new Map<string, V2>(), buildings: [] as V2[] };
const night = new NightLayer();
const HOUR_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hourCycle: 'h23' });
const houseAnchor = new Map<string, V2>();
/** facility locations (id -> world position, name) for popups */
const facilityAt = new Map<string, { pos: V2; name: string }>();
const popups: Popup[] = [];
(window as unknown as { __popups: Popup[] }).__popups = popups; // inspected by the browser tests
const staticCars: VehDraw[] = [];
let kioskAnchor: V2 = { x: 0, y: 0 };
const kioskByGate = new Map<string, V2>();
let debugData: any = null;

async function boot() {
  await loadBranding();
  const map = await (await fetch('/api/v1/map')).json() as { network: NetworkJson; sector: typeof sector };
  sector = map.sector;
  net = buildNetwork(map.network, map.sector);
  setupCamera(net.bounds.w, net.bounds.h, RS);
  if (ZOOM > 1) {
    const f = focusPoint(qs.get('focus') ?? 'receptie');
    cam.S *= ZOOM; cam.cx = f.x; cam.cy = f.y;
    setLifeScale(ZOOM);
  }
  const canvas = document.getElementById('world') as HTMLCanvasElement;
  canvas.width = cam.W; canvas.height = cam.H;
  const ui = document.getElementById('ui') as HTMLCanvasElement; ui.width = cam.W; ui.height = cam.H;
  layout();
  window.addEventListener('resize', layout);
  setStatus('Kaart opbouwen...');
  await new Promise((r) => setTimeout(r, 30));
  await buildScene();
  if (USE_PIXI) {
    try {
      pixi = new PixiStage();
      await pixi.init(document.getElementById('stage')!, canvas, ground);
      if (qs.get('waves') !== '0') pixi.setWater(lastWaterMask);
    } catch (e) { console.warn('PixiJS niet beschikbaar, terugval op Canvas 2D', e); pixi = null; }
  }
  (window as any).__renderer = pixi ? 'pixi' : 'canvas';
  setStatus('');
  connect();
  initSound();
  try {
    const locs = await (await fetch('/api/v1/locations')).json() as { id: string; kind: string; name?: string; pos: V2 }[];
    for (const l of locs) if (l.kind === 'facility') facilityAt.set(l.id, { pos: l.pos, name: l.name ?? l.id });
  } catch { /* popups then fall back to the reception */ }
  requestAnimationFrame(loop);
  if (DEBUG_KEY) setInterval(fetchDebug, 250);
}

function focusPoint(q: string): V2 {
  const W = (p: number[]) => net.toWorld(p);
  const m = q.match(/^(-?[\d.]+),(-?[\d.]+)$/);
  if (m) return { x: Number(m[1]), y: Number(m[2]) };
  const hn = Number(q.replace(/^H/i, ''));
  if (Number.isFinite(hn) && hn > 0) { const h = net.houses.find((x) => x.number === hn); if (h) return h.pos; }
  const named = sector.decor?.focus?.[q.toLowerCase()];
  if (named === 'gate') { const g = net.gates.get('gate-in') ?? [...net.gates.values()][0]; if (g) return g.stopPoint; }
  const key = q.length <= 2 ? q.toUpperCase() : named;
  if (key) {
    const vp = sector.viewPts, cx = (vp[0] + vp[2]) / 2, cy = (vp[1] + vp[3]) / 2;
    const f = sector.facilities.filter((x) => x.key === key).sort((a, b) => Math.hypot(a.pt[0] - cx, a.pt[1] - cy) - Math.hypot(b.pt[0] - cx, b.pt[1] - cy))[0];
    if (f) return W(f.pt);
  }
  return { x: net.bounds.w / 2, y: net.bounds.h / 2 };
}
function layout() {
  const stage = document.getElementById('stage')!;
  const s = Math.min(innerWidth / STAGE.w, innerHeight / STAGE.h);
  stage.style.transform = `translate(${(innerWidth - STAGE.w * s) / 2}px, ${(innerHeight - STAGE.h * s) / 2}px) scale(${s})`;
  document.documentElement.style.setProperty('--hud', String(HUD_SCALE));
}
function setStatus(t: string) { const el = document.getElementById('boot'); if (el) { el.textContent = t; el.style.display = t ? 'block' : 'none'; } }

// ------------------------------------------------------------------ scene construction
async function buildScene() {
  const W = (p: number[]) => net.toWorld(p);
  const shadows: V2[][] = [];
  const dynamicSprites: Sprite[] = [];
  // houses (all PDF houses in the sector)
  const houseFoot = new Map<string, { pos: V2; rad: number }>();
  let built = 0;
  for (const h of net.houses) {
    if (++built % 40 === 0) await pause();
    const v0 = variantFor(h.legendType, h.number);
    houseFoot.set(h.id, { pos: h.pos, rad: (Math.max(v0.W + (v0.annex ? 3 : 0), v0.D) / 2 + 4.2) * (h.scale ?? 1) });
    if (!inView(h.pos.x, h.pos.y, 40)) { houseAnchor.set(h.id, P(h.pos.x, h.pos.y, 9)); continue; } // close-up: off-screen
    const b = buildHouse({ number: h.number, legendType: h.legendType, x: h.pos.x, y: h.pos.y, rot: h.rotation, focus: h.focus, scale: h.scale });
    dynamicSprites.push(b.sprite);
    shadows.push(b.shadow);
    houseAnchor.set(h.id, b.sprite.anchor);
  }
  await pause();
  // central complex + TD workshop + tent from the editable massing data
  const blocks: Block[] = sector.massing ? massingBlocks(sector.massing, W) : [];
  blocks.forEach((b, i) => { const r = buildBlock(b, blocks, 40 + i); dynamicSprites.push(r.sprite); shadows.push(r.shadow); });
  if (sector.massing?.tent) { const t = buildTent(sector.massing.tent.pts.map(W)); dynamicSprites.push(t.sprite); shadows.push(t.shadow); }
  const waterW = sector.terrain.water.map((w) => w.map(W));
  const lanes = [...net.edges.values()].filter((e) => e.kind !== 'driveway' && e.kind !== 'reverse');
  const nearLane = (p: V2, d: number) => lanes.some((e) => { const pr = e.line.project(p); return pr.d < d; });
  // brasserie terrace on the ground in front of the south facade (never on a roof)
  const paved: { pts: V2[]; kind: 'tiles' | 'pavers' }[] = [];
  const yard = sector.massing?.serviceYard;
  if (yard) {
    paved.push({ pts: yard.pts.map(W), kind: 'pavers' });
    const [a, b] = yard.bollards.map(W);
    for (let k = 0; k <= 4; k++) { const p = { x: a.x + ((b.x - a.x) * k) / 4, y: a.y + ((b.y - a.y) * k) / 4 }; statics.push({ key: p.y * cam.CE, at: p, box: [0.8, 1.4], draw: (ctx) => drawBollard(ctx, p) }); }
  }
  const terraceSpots: V2[] = [];
  for (const b of blocks) {
    if (!b.wing.terrace) continue;
    const t = terraceFor(b, (p) => waterW.some((w) => pointInPolygon(p, w)) || nearLane(p, 3.2) || blocks.some((o) => o !== b && blockCorners(o, 0.4) && pointInPolygon(p, blockCorners(o, 0.4))));
    if (t.pave.length) paved.push({ pts: t.pave, kind: 'tiles' });
    t.parasols.forEach((p, i) => { terraceSpots.push(p); statics.push({ key: p.y * cam.CE, at: p, box: [2.6, 3.2], draw: (ctx) => drawParasol(ctx, p, i * 0.7) }); });
  }
  // a gate kiosk per access: West on the central island between its two barriers, Oost at the road edge
  const inbound = [...net.gates.values()].filter((g) => g.direction === 'inbound');
  for (const gi of inbound) {
    const isl = net.islands.find((poly) => poly.some((q) => Math.hypot(q.x - gi.stopPoint.x, q.y - gi.stopPoint.y) < 14));
    let anchor: V2;
    if (isl) {
      const c = isl.reduce((a, q) => ({ x: a.x + q.x / isl.length, y: a.y + q.y / isl.length }), { x: 0, y: 0 });
      const k = buildKiosk({ x: c.x + gi.laneDir.x * 4.5, y: c.y + gi.laneDir.y * 4.5 }, gi.laneDir);
      dynamicSprites.push(k.sprite); shadows.push(k.shadow);
      anchor = k.sprite.anchor;
    } else {
      // no island (Oost: barrier on the hoofdweg, ditch on the north side): intercom columns only, effects at the stop line
      const s = P(gi.stopPoint.x, gi.stopPoint.y, 2.5); anchor = { x: s.x, y: s.y };
    }
    if (gi.id === 'gate-in') kioskAnchor = anchor;
    // the outbound barrier next to it shares the kiosk
    for (const g of net.gates.values()) if (Math.hypot(g.stopPoint.x - gi.stopPoint.x, g.stopPoint.y - gi.stopPoint.y) < 12) kioskByGate.set(g.id, anchor);
  }

  // central car park (designed layout in park.json "parkingLot", see tools/plaza_layout.py); static cars as scenery
  const parking: { pts: V2[] }[] = [];
  const rr = hrand(4);
  const carColors = ['#e9ecef', '#1f2326', '#9aa3ab', '#2f4f7f', '#8e1d24', '#5a6470'];
  const lotSpec = (sector as unknown as { parkingLot?: LotSpec }).parkingLot;
  let lot: GroundLot | undefined;
  if (lotSpec) {
    const a = (lotSpec.angleDeg * Math.PI) / 180, o = lotSpec.origin;
    const L = (u: number, v: number) => W([o[0] + Math.cos(a) * u - Math.sin(a) * v, o[1] + Math.sin(a) * u + Math.cos(a) * v]);
    const vdir = { x: -Math.sin(a), y: Math.cos(a) };
    lot = { outline: lotSpec.outline.map(W), islands: [], ev: [] };
    const w = lotSpec.stallWidthPt, u0 = lotSpec.stallU0, uEnd = u0 + lotSpec.stalls * w;
    lotSpec.rows.forEach((row, ri) => {
      for (let i = 0; i <= lotSpec.stalls; i++) parking.push({ pts: [L(u0 + i * w, row.v0), L(u0 + i * w, row.v1)] });
      for (let i = 0; i < lotSpec.stalls; i++) {
        const c = L(u0 + (i + 0.5) * w, (row.v0 + row.v1) / 2);
        const ev = ri === lotSpec.ev.row && i >= lotSpec.stalls - lotSpec.ev.count;
        if (ev) {
          lot!.ev.push([L(u0 + i * w, row.v0), L(u0 + (i + 1) * w, row.v0), L(u0 + (i + 1) * w, row.v1), L(u0 + i * w, row.v1)]);
          const post = L(u0 + (i + 0.5) * w, row.nose < 0 ? row.v0 + 0.15 : row.v1 - 0.15);
          statics.push({ key: post.y * cam.CE, at: post, box: [0.9, 2.0], draw: (ctx) => drawCharger(ctx, post) });
        }
        if (rr() < (ev ? 0.5 : 0.62)) {
          const h = Math.atan2(vdir.y * row.nose, vdir.x * row.nose);
          staticCars.push({ id: `pk${ri}-${i}`, kind: 'visitor', model: rr() < 0.4 ? 'suv' : 'hatch', color: carColors[Math.floor(rr() * 6)], x: c.x, y: c.y, h, v: 0, brake: false, signal: 0, reverse: false, len: 4.4, wid: 1.82, state: 'parked' });
        }
      }
    });
    // planted islands at the west ends of the rows (one for the double row), lamps on them
    const groups: [number, number][] = [];
    for (const row of lotSpec.rows) { const g = groups.find((q) => Math.abs(q[1] - row.v0) < 0.05); if (g) g[1] = row.v1; else groups.push([row.v0, row.v1]); }
    for (const [v0, v1] of groups) {
      lot.islands.push([L(0.35, v0 + 0.15), L(u0 - 0.2, v0 + 0.15), L(u0 - 0.2, v1 - 0.15), L(0.35, v1 - 0.15)]);
      lot.islands.push([L(uEnd + 0.2, v0 + 0.15), L(uEnd + 1.3, v0 + 0.15), L(uEnd + 1.3, v1 - 0.15), L(uEnd + 0.2, v1 - 0.15)]);
      if (v1 - v0 > 5) for (const p of [L((0.35 + u0 - 0.2) / 2, (v0 + v1) / 2), L(uEnd + 0.75, (v0 + v1) / 2)]) { statics.push({ key: p.y * cam.CE, at: p, box: [1.2, 5.5], draw: (ctx) => drawLamp(ctx, p) }); lightSrc.lamps.push(p); }
    }
    // staff road sign just outside the car park, north of the exit
    const sAt = L(lotSpec.lengthPt + 1.6, lotSpec.aisles[0] - 2.6);
    statics.push({ key: sAt.y * cam.CE, at: sAt, box: [1.4, 3.6], draw: (ctx) => drawStaffSign(ctx, sAt) });
  }
  // sign + flags + lamps + intercoms (positions from park.json "decor")
  const decor = sector.decor ?? {};
  const signAt = decor.sign ? W(decor.sign) : null;
  if (signAt) statics.push({ key: signAt.y * cam.CE, at: signAt, box: [4.5, 4.5], draw: (ctx) => drawSign(ctx, signAt) });
  const flagPts = (decor.flags ?? []).map(W);
  flagPts.forEach((p, i) => statics.push({ key: p.y * cam.CE, at: p, box: [2.2, 8.5], anim: true, draw: (ctx, t) => drawFlag(ctx, p, t, i * 1.7) }));
  const lampPts: V2[] = [];
  const tw = net.roads.find((r) => r.id === decor.lampRoad);
  for (let i = 12; tw && i < tw.center.length - 6; i += 22) {
    const a = tw.center[i], b = tw.center[Math.min(tw.center.length - 1, i + 1)];
    const t = { x: b.x - a.x, y: b.y - a.y }; const l = Math.hypot(t.x, t.y) || 1;
    lampPts.push({ x: a.x + (-t.y / l) * -(tw.halfWidth[i] + 1.2), y: a.y + (t.x / l) * -(tw.halfWidth[i] + 1.2) });
  }
  for (const p of lampPts) { statics.push({ key: p.y * cam.CE, at: p, box: [1.2, 5.5], draw: (ctx) => drawLamp(ctx, p) }); lightSrc.lamps.push(p); }
  for (const g of net.gates.values()) {
    const p = { x: g.stopPoint.x - g.armDir.x * 2.15 - g.laneDir.x * 1.1, y: g.stopPoint.y - g.armDir.y * 2.15 - g.laneDir.y * 1.1 };
    statics.push({ key: p.y * cam.CE, at: p, box: [0.9, 2.2], draw: (ctx) => drawIntercom(ctx, p) });
    statics.push({ key: (g.armPivot.y + 0.3) * cam.CE, at: g.armPivot, box: [g.armLen + 1.2, g.armLen + 1.5], anim: true, draw: (ctx, t) => drawGateArm(ctx, g.id, t) });
  }

  // ---- sand paths: from the door to the nearest point of the bungalow's own pad (or to the road edge when the pad is far)
  const closestOn = (q: V2, poly: V2[]) => {
    let best = { d: Infinity, p: poly[0] };
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / L2)), p = { x: a.x + dx * t, y: a.y + dy * t };
      const d = Math.hypot(p.x - q.x, p.y - q.y); if (d < best.d) best = { d, p };
    }
    return best;
  };
  const laneList = [...net.edges.values()].filter((e) => e.kind === 'lane');
  const sandPaths: V2[][] = [];
  for (const h of net.houses) {
    const st = h.stallId ? net.stalls.get(h.stallId) : undefined;
    let target: V2 | null = null;
    if (st) { const c = closestOn(h.door, st.pad); if (c.d < 25) { if (c.d < 1.6) continue; target = c.p; } }
    if (!target) {
      let best: { d: number; p: V2 } | null = null;
      for (const e of laneList) { if (e.line.bboxDist(h.door) > 30) continue; const pr = e.line.project(h.door); if (!best || pr.d < best.d) { const q = e.line.sample(pr.s); best = { d: pr.d, p: { x: q.x, y: q.y } }; } }
      if (!best || best.d < 3.2) continue;
      const k = (best.d - 1.6) / best.d; target = { x: h.door.x + (best.p.x - h.door.x) * k, y: h.door.y + (best.p.y - h.door.y) * k };
    }
    // a gentle curve, not a ruler-straight line
    const mx = (h.door.x + target.x) / 2, my = (h.door.y + target.y) / 2, len = Math.hypot(target.x - h.door.x, target.y - h.door.y);
    const sg = h.number % 2 ? 1 : -1, nx = -(target.y - h.door.y) / (len || 1), ny = (target.x - h.door.x) / (len || 1);
    const ctrl = { x: mx + nx * len * 0.12 * sg, y: my + ny * len * 0.12 * sg };
    const pts: V2[] = [];
    for (let t = 0; t <= 1.0001; t += 0.1) pts.push({ x: (1 - t) ** 2 * h.door.x + 2 * (1 - t) * t * ctrl.x + t * t * target.x, y: (1 - t) ** 2 * h.door.y + 2 * (1 - t) * t * ctrl.y + t * t * target.y });
    sandPaths.push(pts);
  }

  // ---- tree mask
  const mask = new Mask(net.bounds.w, net.bounds.h);
  for (const r of net.roads) {
    if (r.center.length === 1) { mask.circle(r.center[0], r.halfWidth[0] + 2.5); continue; }
    mask.line(r.center, (Math.max(...r.halfWidth) + 2.4) * 2);
  }
  for (const e of net.edges.values()) if (e.kind !== 'lane') mask.line(e.line.pts, e.kind === 'driveway' ? 6 : 7);
  // keep crowns from hiding the queue / gate / parking: no trees just south (camera side) of those lanes
  for (const e of net.edges.values()) {
    const crit = e.cls === 'arrival' || e.kind === 'driveway' || e.kind === 'loop' || e.roadId === 'westlaan' || e.roadId === 'keerlus-laan';
    const off = crit ? 7.5 : 3.5, w = crit ? 13 : 6;
    mask.line(e.line.pts.map((p) => ({ x: p.x, y: p.y + off })), w);
  }
  for (const s of net.stalls.values()) mask.poly(s.pad, 1.8);
  for (const isl2 of net.islands) mask.poly(isl2, 2);
  for (const [, f] of houseFoot) mask.circle(f.pos, f.rad);
  for (const h of net.houses) if (h.stallId) { const st = net.stalls.get(h.stallId)!; mask.line([h.door, { x: st.parkedPose.x, y: st.parkedPose.y }], 3.2); }
  for (const sp of sandPaths) mask.line(sp, 3.0);
  for (const s of sector.structures) if (s.kind === 'field') mask.poly(s.pts.map(W), 2.5);
  for (const b of blocks) {
    mask.poly(blockCorners(b, 2.5));
    // keep the camera-facing facades free of tree crowns
    mask.poly(blockCorners(b, 0).map((p) => ({ x: p.x, y: p.y + 9 })), 3);
  }
  if (sector.massing?.tent) mask.poly(sector.massing.tent.pts.map(W), 2.5);
  for (const t of paved) mask.poly(t.pts, 2);
  for (const w of sector.terrain.water) mask.poly(w.map(W), 0.6);
  for (const f of sector.terrain.footpaths) mask.poly(f.map(W), 1.0);
  for (const f of sector.terrain.roadSurfaces) mask.poly(f.map(W), 1.5);
  if (lot) {
    // tree crowns lean north in the camera view: keep the car park, its south side and the staff road clear
    mask.poly(lot.outline, 1.8);
    for (const dy of [4, 8, 12]) mask.poly(lot.outline.map((p) => ({ x: p.x, y: p.y + dy })), 1.5);
    const staff = net.roads.find((r) => r.id === decor.staffRoad);
    if (staff) for (const dy of [0, 4, 8, 12]) mask.line(staff.center.map((p) => ({ x: p.x, y: p.y + dy })), 11);
  }
  if (signAt) mask.circle(signAt, 6);
  for (const p of flagPts) mask.circle(p, 3);
  // golf course: no trees on fairways, greens and bunkers
  const golf = sector.terrain.golf;
  if (golf) for (const g of [...golf.fairways, ...golf.greens, ...golf.bunkers]) mask.poly(g.map(W), 1.5);
  for (const p of parking) mask.line(p.pts, 6);
  mask.freeze();
  // 'hard' mask for shrubs: everything except the house gardens
  const hard = new Mask(net.bounds.w, net.bounds.h);
  for (const r of net.roads) { if (r.center.length === 1) hard.circle(r.center[0], r.halfWidth[0] + 1.2); else hard.line(r.center, (Math.max(...r.halfWidth) + 1.2) * 2); }
  for (const e of net.edges.values()) if (e.kind !== 'lane') hard.line(e.line.pts, 5);
  for (const st of net.stalls.values()) hard.poly(st.pad, 1.4);
  for (const h of net.houses) if (h.stallId) { const st = net.stalls.get(h.stallId)!; hard.line([h.door, { x: st.parkedPose.x, y: st.parkedPose.y }], 2.6); }
  for (const sp of sandPaths) hard.line(sp, 2.0);
  for (const s2 of sector.structures) if (s2.kind === 'field') hard.poly(s2.pts.map(W), 1.5);
  for (const b of blocks) hard.poly(blockCorners(b, 1.5));
  for (const t of paved) hard.poly(t.pts, 1);
  for (const w of sector.terrain.water) hard.poly(w.map(W), 0.5);
  for (const f of sector.terrain.footpaths) hard.poly(f.map(W), 0.6);
  for (const f of sector.terrain.roadSurfaces) hard.poly(f.map(W), 0.8);
  if (lot) hard.poly(lot.outline, 1.0);
  hard.freeze();
  const attract: V2[] = [];
  for (const h of net.houses) attract.push(h.pos);
  for (const r of net.roads) for (let i = 0; i < r.center.length; i += 4) attract.push(r.center[i]);
  const near = (x: number, y: number) => { let d = 1e9; for (const p of attract) { const q = (p.x - x) ** 2 + (p.y - y) ** 2; if (q < d) d = q; } return Math.sqrt(d); };
  await pause();
  // forest areas from the map (park.json terrain.forest): dense there, only a few loose trees elsewhere
  let density: ((x: number, y: number) => number) | undefined;
  const forestPolys = sector.terrain.forest;
  if (forestPolys?.length) {
    const fm = new Mask(net.bounds.w, net.bounds.h);
    for (const f of forestPolys) fm.poly(f.map(W));
    fm.freeze();
    density = (x, y) => (fm.blocked(x, y) ? 0.92 : 0.004);
  }
  const trees = placeTrees(mask, near, net.bounds, 5, density).filter((t) => inView(t.x, t.y, 20));
  // single trees and small clumps exactly where the plan draws them (park.json decor.trees: [x, y, crown radius m])
  if (decor.trees?.length) {
    const pool = [0, 1, 2, 3, 4, 5].map((i) => makeTree('oak', 600 + i, 9 + (i % 3) * 1.6)).concat([0, 1, 2].map((i) => makeTree('birch', 650 + i, 9 + i * 1.5)));
    const tr = hrand(31);
    for (const [px, py] of decor.trees) {
      const p = W([px, py]);
      if (mask.blocked(p.x, p.y) || !inView(p.x, p.y, 20)) continue;
      trees.push({ x: p.x, y: p.y, sp: pool[Math.floor(tr() * pool.length)], key: p.y * cam.CE });
    }
  }
  await pause();
  // shrubs near the focus houses
  const shrubR = hrand(8);
  const shrubSprites = [0, 1, 2, 3, 4, 5].map((i) => makeTree('shrub', 500 + i, 1.4 + (i % 3) * 0.35));
  for (const h of net.houses) {
    for (let i = 0; i < 4; i++) {
      const a = shrubR() * Math.PI * 2, d = houseFoot.get(h.id)!.rad - 0.6 + shrubR() * 1.5;
      const x = h.pos.x + Math.cos(a) * d, y = h.pos.y + Math.sin(a) * d;
      if (hard.blocked(x, y)) continue;
      if (nearLane({ x, y }, 3.4)) continue;
      if ([...houseFoot.values()].some((f) => Math.hypot(x - f.pos.x, y - f.pos.y) < f.rad - 1.4)) continue;
      trees.push({ x, y, sp: shrubSprites[Math.floor(shrubR() * shrubSprites.length)], key: y * cam.CE });
    }
  }
  // which trees can be baked into the ground (no moving object or building can ever pass behind/in front of them)
  const occ = new OccGrid(cam.W, cam.H, 24);
  for (const s of dynamicSprites) occ.markRect(s.x, s.y, s.x + s.canvas.width, s.y + s.canvas.height);
  for (const e of net.edges.values()) for (let i = 0; i < e.line.pts.length; i += 2) { const p = e.line.pts[i]; const a = P(p.x - 3.4, p.y - 3.4, 0), b = P(p.x + 3.4, p.y + 3.4, 3.2); occ.markRect(a.x, b.y, b.x, a.y + 4); }
  for (const h of net.houses) { const a = P(h.door.x - 3, h.door.y - 3, 2), b = P(h.door.x + 3, h.door.y + 3); occ.markRect(a.x, a.y, b.x, b.y); }
  for (const o of statics) void o;
  const baked: Placed[] = [], live: Placed[] = [];
  for (const t of trees) {
    const s = P(t.x, t.y);
    const x0 = s.x - t.sp.ax, y0 = s.y - t.sp.ay;
    if (occ.any(x0, y0, x0 + t.sp.canvas.width, y0 + t.sp.canvas.height)) live.push(t); else baked.push(t);
  }
  await pause();
  // the ground (roads, markings, paths, water, grass) is drawn GROUND_SS times larger and reduced: crisp lines
  const k = GROUND_SS, savedCam = { ...cam };
  cam.S *= k; cam.W *= k; cam.H *= k; cam.RS *= k;
  let bigGround: HTMLCanvasElement;
  try {
  bigGround = renderGround({ spriteScale: k,
    net, water: sector.terrain.water.map((w) => w.map(W)), footpaths: sector.terrain.footpaths.map((f) => f.map(W)),
    roadSurfaces: sector.terrain.roadSurfaces.map((f) => f.map(W)),
    fields: sector.structures.filter((s) => s.kind === 'field').map((s) => ({ pts: s.pts.map(W), kind: s.name ?? '' })),
    shadows, trees, bakedTrees: baked, parking, paved, lot,
    flowerBeds: (decor.flowerBeds ?? []).map(W),
    golf: golf ? { fairways: golf.fairways.map((g) => g.map(W)), greens: golf.greens.map((g) => g.map(W)), bunkers: golf.bunkers.map((g) => g.map(W)) } : undefined,
    sandPaths,
  });
  } finally { Object.assign(cam, savedCam); }
  ground = k === 1 ? bigGround : reduceCanvas(bigGround, cam.W, cam.H);
  if (k !== 1 && lastWaterMask) setWaterMask({ canvas: reduceCanvas(lastWaterMask.canvas, Math.max(1, Math.round(lastWaterMask.canvas.width / k)), Math.max(1, Math.round(lastWaterMask.canvas.height / k))), x: Math.round(lastWaterMask.x / k), y: Math.round(lastWaterMask.y / k) });
  for (const s of dynamicSprites) statics.push({ key: s.key, rect: [s.x, s.y, s.x + s.canvas.width, s.y + s.canvas.height], mask: maskOf(s.canvas), ox: s.x, oy: s.y, fade: s.kind === 'house' ? 0.5 : 0.55, img: { canvas: s.canvas, x: s.x, y: s.y }, draw: (ctx) => ctx.drawImage(s.canvas, s.x, s.y) });
  const treeMasks = new Map<HTMLCanvasElement, Mask4>();
  for (const t of live) {
    const sp = P(t.x, t.y); const x0 = Math.round(sp.x - t.sp.ax), y0 = Math.round(sp.y - t.sp.ay);
    const m = treeMasks.get(t.sp.canvas) ?? treeMasks.set(t.sp.canvas, maskOf(t.sp.canvas)).get(t.sp.canvas)!;
    statics.push({ key: t.key, rect: [x0, y0, x0 + t.sp.canvas.width, y0 + t.sp.canvas.height], mask: m, ox: x0, oy: y0, fade: 0.38, img: { canvas: t.sp.canvas, x: x0, y: y0 }, draw: (ctx) => ctx.drawImage(t.sp.canvas, x0, y0) });
  }
  for (const c of staticCars) statics.push({ key: c.y * cam.CE, at: { x: c.x, y: c.y }, box: [3.2, 2.4], draw: (ctx, tt) => drawVehicle(ctx, c, tt) });
  for (const [id, h] of houseFoot) lightSrc.houses.set(id, h.pos);
  for (const b of blocks) { const c = blockCorners(b, 0); lightSrc.buildings.push({ x: c.reduce((a, p) => a + p.x, 0) / c.length, y: c.reduce((a, p) => a + p.y, 0) / c.length }); }
  if (qs.get('life') !== '0') {
    const foot = [...houseFoot.values()];
    const bc = blocks.map((b) => blockCorners(b, 1.0)).filter((c): c is V2[] => !!c);
    ambient = new Ambient({
      water: sector.terrain.water.map((w) => w.map(W)), roads: net.roads,
      facilities: sector.facilities.map((f) => ({ key: f.key, pos: W(f.pt) })),
      avoid: (p) => foot.some((h) => Math.hypot(p.x - h.pos.x, p.y - h.pos.y) < h.rad - 3.4) || bc.some((c) => pointInPolygon(p, c)),
    }, 11);
  }
  (window as any).__scene = { ambient: ambient?.counts, blocks: blocks.map((b) => b.id), terrace: terraceSpots.length, trees: trees.length, baked: baked.length, live: live.length, houses: net.houses.length, statics: statics.length };
}

class OccGrid {
  cols: number; rows: number; g: Uint8Array;
  constructor(public w: number, public h: number, public c: number) { this.cols = Math.ceil(w / c); this.rows = Math.ceil(h / c); this.g = new Uint8Array(this.cols * this.rows); }
  markRect(x0: number, y0: number, x1: number, y1: number) {
    for (let j = Math.max(0, Math.floor(y0 / this.c)); j <= Math.min(this.rows - 1, Math.floor(y1 / this.c)); j++)
      for (let i = Math.max(0, Math.floor(x0 / this.c)); i <= Math.min(this.cols - 1, Math.floor(x1 / this.c)); i++) this.g[j * this.cols + i] = 1;
  }
  any(x0: number, y0: number, x1: number, y1: number) {
    for (let j = Math.max(0, Math.floor(y0 / this.c)); j <= Math.min(this.rows - 1, Math.floor(y1 / this.c)); j++)
      for (let i = Math.max(0, Math.floor(x0 / this.c)); i <= Math.min(this.cols - 1, Math.floor(x1 / this.c)); i++) if (this.g[j * this.cols + i]) return true;
    return false;
  }
}

// ------------------------------------------------------------------ realtime
let es: EventSource | null = null;
/** sequence number of the last game event received; on reconnect the server replays everything after it */
let lastSeq = -1;
/** events before the first 'state' message of a (re)connection are replays of what was missed */
let replaying = false;
function connect() {
  es?.close();
  replaying = lastSeq >= 0;
  es = new EventSource(`/api/v1/stream?frames=1${lastSeq >= 0 ? `&after=${lastSeq}` : ''}`);
  const seen = (e: Event) => { const n = Number((e as MessageEvent).lastEventId); if (n > lastSeq) lastSeq = n; };
  for (const t of ['map.updated', 'state', 'task.created', 'incident.started', 'incident.escalated', 'task.completed', 'gate.opening', 'game.reset', 'story.started', 'story.chapter', 'story.ended', 'game.ended']) es.addEventListener(t, seen);
  es.addEventListener('frame', (e) => {
    const f = JSON.parse((e as MessageEvent).data) as Frame;
    f.at = performance.now();
    const last = frames[frames.length - 1];
    if (last && f.t > last.t) { const r = (f.t - last.t) / Math.max(0.02, (f.at - last.at) / 1000); rate = rate * 0.85 + Math.min(20, r) * 0.15; }
    frames.push(f);
    while (frames.length > 40) frames.shift();
    setConn(true);
  });
  // the map editor activated a new map version: the whole scene is rebuilt from the new map
  es.addEventListener('map.updated', () => location.reload());
  es.addEventListener('state', (e) => { state = JSON.parse((e as MessageEvent).data); const ps = (state?.park as unknown as { display?: { popupSeconds?: number } })?.display?.popupSeconds; if (ps) setPopupSeconds(ps); renderHud(); replaying = false; });
  // after a reset the event numbers start again at 1
  es.addEventListener('game.reset', () => { lastSeq = 0; });
  // end of a planned session: a closing card with the winner
  es.addEventListener('game.ended', (e) => {
    const d = JSON.parse((e as MessageEvent).data) as { gameName: string; leaderboard: { displayName: string; score: number }[] };
    const top = d.leaderboard?.[0];
    addPopup(popups, { id: `end:${d.gameName}`, crisis: false, story: true, label: 'EINDE SESSIE', title: 'Bedankt voor het spelen!', where: d.gameName, text: top && top.score > 0 ? `Winnaar: ${top.displayName} met ${top.score} punten.` : 'De sessie is afgelopen.', icon: 'star', ax: kioskAnchor.x, ay: kioskAnchor.y }, performance.now() / 1000);
    playNotification('crisis');
  });
  // new incident: popup at its location for 15 s + chime (crisis subtasks are covered by the crisis popup)
  es.addEventListener('task.created', (e) => {
    const t = JSON.parse((e as MessageEvent).data).task as { id: string; kind: string; title: string; description: string; icon: string; points: number; locationId: string | null; parentId?: string | null };
    if (!t || t.kind !== 'incident' || t.parentId) return;
    const a = anchorOf(t.locationId);
    addPopup(popups, { id: t.id, crisis: false, title: t.title.replace(/\s*\([^)]*\)$/, ''), where: whereOf(t.locationId), text: t.description, icon: t.icon, points: t.points, ax: a.x, ay: a.y }, performance.now() / 1000);
    playNotification('incident');
  });
  es.addEventListener('incident.started', (e) => {
    const d = JSON.parse((e as MessageEvent).data) as { incidentId: string; title: string; description: string; locationId: string; stage: string; code: string };
    const a = anchorOf(d.locationId);
    requestZoom(a, 'crisis');
    addPopup(popups, { id: d.incidentId, crisis: true, title: d.title, where: whereOf(d.locationId), text: `${d.description} Eerst: ${d.stage.toLowerCase()}.`, icon: crisisIcon(d.code), ax: a.x, ay: a.y }, performance.now() / 1000);
    playNotification('crisis');
  });
  es.addEventListener('incident.escalated', (e) => {
    const d = JSON.parse((e as MessageEvent).data) as { incidentId: string; code: string; stage: number; text: string };
    const cur = state?.park as unknown as { crises?: { id: string; title: string; locationId: string }[] } | undefined;
    const c = cur?.crises?.find((x) => x.id === d.incidentId);
    const a = anchorOf(c?.locationId ?? null);
    addPopup(popups, { id: `${d.incidentId}:${d.stage}`, crisis: true, title: `${c?.title ?? 'Crisis'}: fase ${d.stage + 1}`, where: whereOf(c?.locationId ?? null), text: `Nieuwe melding: ${d.text.toLowerCase()}.`, icon: crisisIcon(d.code), ax: a.x, ay: a.y }, performance.now() / 1000);
    playNotification('crisis');
  });
  // guest storylines (Hilversum media households): a purple card per chapter and one for the ending
  const storyIntro = new Map<string, string>();
  es.addEventListener('story.started', (e) => { const d = JSON.parse((e as MessageEvent).data); storyIntro.set(d.storyId, d.text); });
  es.addEventListener('story.chapter', (e) => {
    const d = JSON.parse((e as MessageEvent).data) as { storyId: string; title: string; chapter: number; chapters: number; text: string; taskId: string; locationId: string; taskTitle?: string; points?: number };
    const a = anchorOf(d.locationId);
    const intro = d.chapter === 1 ? storyIntro.get(d.storyId) : undefined;
    if (d.chapter === 1) requestZoom(a, 'story');
    addPopup(popups, { id: d.taskId, crisis: false, story: true, label: d.chapter === 1 ? `NIEUW VERHAAL · DEEL 1/${d.chapters}` : `VERHAAL · DEEL ${d.chapter}/${d.chapters}`, title: d.chapter === 1 ? d.title : d.taskTitle ?? d.title, where: whereOf(d.locationId), text: intro ? `${intro} ${d.text}` : d.text, icon: 'star', points: d.points, ax: a.x, ay: a.y }, performance.now() / 1000);
    playNotification('incident');
  });
  es.addEventListener('story.ended', (e) => {
    const d = JSON.parse((e as MessageEvent).data) as { storyId: string; title: string; success: boolean; text: string; locationId: string; quiet?: boolean };
    storyIntro.delete(d.storyId);
    if (d.quiet || !d.text) return;
    const a = anchorOf(d.locationId);
    addPopup(popups, { id: `${d.storyId}:end`, crisis: false, story: true, label: d.success ? 'VERHAAL AFGEROND' : 'VERHAAL MISLUKT', title: d.title, where: whereOf(d.locationId), text: d.text, icon: 'star', ax: a.x, ay: a.y }, performance.now() / 1000);
  });
  es.addEventListener('task.completed', (e) => {
    if (replaying) return; // effects of what happened while hidden are not replayed
    const d = JSON.parse((e as MessageEvent).data);
    const at = d.gateId && kioskByGate.get(d.gateId) ? kioskByGate.get(d.gateId)! : d.locationId && houseAnchor.get(d.locationId) ? houseAnchor.get(d.locationId)! : kioskAnchor;
    const now = performance.now() / 1000;
    fx.push({ x: at.x, y: at.y - 40 * cam.RS, t0: now, kind: 'burst', color: '#36d07a' });
    if (d.points > 0) fx.push({ x: at.x, y: at.y - 50 * cam.RS, t0: now, kind: 'points', text: `+${d.points}`, color: '#ffffff' });
  });
  es.addEventListener('gate.opening', (e) => {
    if (replaying) return;
    const d = JSON.parse((e as MessageEvent).data); const g = net.gates.get(d.gateId); if (!g) return;
    const s = P(g.stopPoint.x, g.stopPoint.y); fx.push({ x: s.x, y: s.y, t0: performance.now() / 1000, kind: 'ring', color: '#36e07a' });
  });
  es.onerror = () => { setConn(false); };
}
// a projector that is not visible (other tab in front, covered or minimised window) closes its live connection and
// draws nothing, so it never ties up the browser's connections to this server (other tabs kept loading forever on a
// Mac). When shown again it reconnects with the last event number: the server replays what was missed, so new
// incidents still get their popup and sound (popups start their 15 s once visible).
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { es?.close(); es = null; setConn(false); }
  else if (!es && net) connect();
});
function anchorOf(locationId: string | null): V2 {
  if (locationId?.startsWith('H')) { const a = houseAnchor.get(locationId); if (a) return a; }
  const f = locationId ? facilityAt.get(locationId) : undefined;
  if (f) return P(f.pos.x, f.pos.y, 9);
  return kioskAnchor;
}
function whereOf(locationId: string | null) {
  if (!locationId) return '';
  if (locationId.startsWith('H')) return `Bungalow ${locationId.slice(1)}`;
  return facilityAt.get(locationId)?.name ?? locationId;
}
const crisisIcon = (code: string) => ({ CRISIS_WATER_MAIN: 'drop', CRISIS_BLACKOUT: 'bolt', CRISIS_CHECKIN: 'key', CRISIS_POOL_CLOSED: 'swim', CRISIS_MASCOT: 'star', CRISIS_STORM: 'bolt', CRISIS_FIRE_ALARM: 'alert', CRISIS_PRESS: 'alert', CRISIS_WIFI: 'bolt', CRISIS_PARKING: 'car' } as Record<string, string>)[code] ?? 'alert';
function setConn(ok: boolean) { const el = document.getElementById('conn'); if (el) el.className = ok ? 'ok' : 'bad'; }

async function fetchDebug() {
  try { const r = await fetch('/api/v1/admin/debug', { headers: { 'X-Admin-Key': DEBUG_KEY! } }); if (r.ok) debugData = await r.json(); } catch { /* ignore */ }
}

// ------------------------------------------------------------------ interpolation
/** seconds the playback runs behind the newest server frame (server sends 20 frames/s) */
const PLAY_DELAY = 0.15;
let playT: number | null = null, playWall = 0;
/** timestamp of the display frame being drawn (requestAnimationFrame), so motion follows the screen's own rhythm */
let frameStamp = 0;
function interp(): { t: number; vehicles: VehDraw[]; peds: Frame['pedestrians']; gates: Frame['gates'] } | null {
  if (!frames.length) return null;
  const now = frameStamp || performance.now();
  const last = frames[frames.length - 1];
  // smooth playback clock: it advances with the game speed every frame and is only nudged gently towards the
  // newest server frame (minus a small buffer). Jitter in the arrival of server frames no longer shows as stutter.
  const speed = state?.park.paused ? 0 : (state?.park.timeScale ?? rate);
  const target = last.t + ((now - last.at) / 1000) * speed - PLAY_DELAY * Math.max(1, speed);
  const dtw = playWall ? Math.min(0.1, (now - playWall) / 1000) : 0;
  playWall = now;
  if (playT === null || Math.abs(target - playT) > 2 * Math.max(1, speed)) playT = target; // (re)start or big jump
  else {
    // follow the target gently, and never change the pace by more than 8 % in one frame (no visible jerk)
    const corr = Math.max(-0.08, Math.min(0.08, (target - playT) * 0.6)) * dtw * Math.max(1, speed);
    playT += dtw * speed + corr;
  }
  const tR = playT;
  (window as unknown as { __playT: number }).__playT = playT; // inspected by the smoothness check
  let a = frames[0], b = last;
  for (let i = frames.length - 1; i > 0; i--) if (frames[i - 1].t <= tR) { a = frames[i - 1]; b = frames[i]; break; }
  const span = b.t - a.t;
  const k = span > 1e-6 ? Math.min(1, Math.max(0, (tR - a.t) / span)) : 1;
  const bm = new Map(b.vehicles.map((v) => [v.id, v]));
  const vehicles: VehDraw[] = [];
  for (const va of a.vehicles) {
    const vb = bm.get(va.id);
    if (!vb) { if (k < 0.5) vehicles.push(va); continue; }
    let dh = vb.h - va.h; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    vehicles.push({ ...vb, x: va.x + (vb.x - va.x) * k, y: va.y + (vb.y - va.y) * k, h: va.h + dh * k });
  }
  for (const vb of b.vehicles) if (!a.vehicles.some((v) => v.id === vb.id) && k >= 0.5) vehicles.push(vb);
  const pm = new Map(b.pedestrians.map((p) => [p.id, p]));
  const peds = a.pedestrians.map((pa) => { const pb = pm.get(pa.id); return pb ? { ...pb, x: pa.x + (pb.x - pa.x) * k, y: pa.y + (pb.y - pa.y) * k } : pa; });
  return { t: a.t + span * k, vehicles, peds, gates: b.gates };
}

// ------------------------------------------------------------------ draw
let curGates: Frame['gates'] = [];
let curT = 0;
function drawGateArm(ctx: CanvasRenderingContext2D, id: string, _t: number) {
  const g = net.gates.get(id)!;
  const gs = curGates.find((x) => x.id === id);
  let frac = 0;
  if (gs) {
    const el = curT - gs.since;
    const ease = (x: number) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
    frac = gs.phase === 'OPEN' ? 1 : gs.phase === 'OPENING' ? ease(el / gs.openSec) : gs.phase === 'CLOSING' ? 1 - ease(el / gs.closeSec) : 0;
  }
  drawBarrier(ctx, g.armPivot, g.armDir, g.laneDir, g.armLen, frac, gs?.phase ?? 'CLOSED');
}

let lastFrameAt = 0, lastFrameCost = 0;
/** ?stats=1: frames per second, frame time and new cached images, bottom left */
const stats = (() => {
  const on = qs.get('stats') === '1';
  let el: HTMLDivElement | null = null, acc = 0, n = 0, worst = 0, cost = 0, lastShow = 0;
  return {
    tick(dt: number, c: number) {
      if (!on) return;
      acc += dt; n++; worst = Math.max(worst, dt); cost += c;
      const t = performance.now();
      if (t - lastShow < 500) return;
      if (!el) { el = document.createElement('div'); el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:30;font:600 15px ui-monospace,Menlo,monospace;color:#fff;background:rgba(0,0,0,.6);padding:6px 10px;border-radius:8px;pointer-events:none'; document.body.appendChild(el); }
      el.textContent = `${(1000 / (acc / n)).toFixed(0)} fps · traagste frame ${worst.toFixed(0)} ms · JS ${(cost / n).toFixed(1)} ms · nieuwe plaatjes ${pixi?.newImages ?? 0}`;
      if (pixi) pixi.newImages = 0;
      acc = 0; n = 0; worst = 0; cost = 0; lastShow = t;
    },
  };
})();
function loop(ts?: number) {
  // one frame per display refresh (requestAnimationFrame), optionally capped with ?fps=
  const tNow = ts ?? performance.now();
  if (document.hidden || tNow - lastFrameAt < 1000 / MAX_FPS - 3) { requestAnimationFrame(loop); return; }
  const dtMs = lastFrameAt ? tNow - lastFrameAt : 16.7;
  lastFrameAt = tNow;
  frameStamp = tNow;
  const t0 = performance.now();
  try { frame(); } finally { lastFrameCost = performance.now() - t0; stats.tick(dtMs, lastFrameCost); }
  requestAnimationFrame(loop);
}
function frame() {
  const ctx = (document.getElementById('world') as HTMLCanvasElement).getContext('2d')!;
  const now = (frameStamp || performance.now()) / 1000; // the display frame time: everything moves in the same rhythm
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (pixi) ctx.clearRect(0, 0, cam.W, cam.H); else ctx.drawImage(ground, 0, 0);
  const it = interp();
  if (it) { curGates = it.gates; curT = it.t; }
  const objs: Obj[] = statics.slice();
  if (it) {
    for (const v of it.vehicles) if (inView(v.x, v.y, 12)) objs.push(vehicleDrawable(v, now));
    for (const p of it.peds) if (inView(p.x, p.y, 6)) objs.push(pedDrawable(p, hashStr(p.id), now));
  }
  if (ambient) {
    ambient.step(now);
    const hour = state ? Number(HOUR_FMT.format(new Date((state.park as unknown as { gameMs: number }).gameMs))) : 12;
    const wk = currentWeather()?.kind;
    for (const o of ambient.objects(now, hour >= 23 || hour < 7 || wk === 'regen' || wk === 'onweer')) if (!o.at || inView(o.at.x, o.at.y, 6)) objs.push(o);
  }
  objs.sort((a, b) => a.key - b.key);
  // occlusion fading: a tree/building only fades when its opaque pixels really cover a moving vehicle or
  // pedestrian that is BEHIND it; the fade eases in and out so nothing flickers when cars pass in front
  const movers: { pts: V2[]; key: number }[] = [];
  if (it) {
    for (const v of it.vehicles) {
      if (v.state !== 'driving') continue;
      const fx2 = Math.cos(v.h), fy2 = Math.sin(v.h);
      movers.push({ key: v.y * cam.CE, pts: [-0.38, 0, 0.38].map((k) => Pv({ x: v.x + fx2 * v.len * k, y: v.y + fy2 * v.len * k, z: 0.9 })) });
    }
    for (const p of it.peds) if (p.walking) movers.push({ key: p.y * cam.CE, pts: [Pv({ x: p.x, y: p.y, z: 1.1 })] });
    // a barrier in action (queue or arm moving) must stay visible behind buildings and trees
    for (const g of it.gates) {
      if (g.phase === 'CLOSED' && !g.queue.length) continue;
      const gd = net.gates.get(g.id)!;
      movers.push({ key: gd.stopPoint.y * cam.CE, pts: [0, 0.5, 1].map((k) => Pv({ x: gd.armPivot.x + gd.armDir.x * gd.armLen * k, y: gd.armPivot.y + gd.armDir.y * gd.armLen * k, z: 1.0 })) });
    }
  }
  const dtf = Math.min(0.1, Math.max(0, now - lastFrameT)); lastFrameT = now;
  for (const o of objs) {
    if (o.rect && o.mask) {
      let target = 1;
      search: for (const m of movers) {
        if (m.key >= o.key) continue;
        for (const q of m.pts) {
          if (q.x < o.rect[0] || q.x >= o.rect[2] || q.y < o.rect[1] || q.y >= o.rect[3]) continue;
          const lx = Math.floor((q.x - o.ox!) / 4), ly = Math.floor((q.y - o.oy!) / 4);
          if (o.mask.d[ly * o.mask.w + lx]) { target = o.fade ?? 0.5; break search; }
        }
      }
      o.cur = (o.cur ?? 1) + (target - (o.cur ?? 1)) * Math.min(1, dtf * 6);
    }
    if (pixi) continue;
    const al = o.cur ?? 1;
    if (al < 0.995) { ctx.globalAlpha = al; o.draw(ctx, now); ctx.globalAlpha = 1; } else o.draw(ctx, now);
  }
  if (pixi) { pixi.weather = currentWeather(); pixi.render(objs, now); }
  drawNight(ctx);
  if (DEBUG_KEY) drawDebug(ctx, it);
  drawOverlays(ctx, it, now);
  drawFx(ctx, fx, now);
  // popups on their own layer: normal size even when the map is zoomed in on an event
  const uctx = (document.getElementById('ui') as HTMLCanvasElement).getContext('2d')!;
  uctx.setTransform(1, 0, 0, 1, 0, 0); uctx.clearRect(0, 0, cam.W, cam.H);
  const zt = autoZoomStep(now);
  drawPopups(uctx, popups, now, (x, y) => ({ x: zt.tx + x * zt.z, y: zt.ty + y * zt.z }));
  while (fx.length && now - fx[0].t0 > 3) fx.shift();
}
/** day/night veil from the game clock (setting in /admin; ?night=0 off, ?hour=22 forces an hour for testing) */
function drawNight(ctx: CanvasRenderingContext2D) {
  if (!state || qs.get('night') === '0') return;
  const disp = (state.park as unknown as { display?: { dayNight?: boolean } }).display;
  if (disp?.dayNight === false) return;
  const ms = (state.park as unknown as { gameMs: number }).gameMs;
  const p = Object.fromEntries(HM_FMT.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const hour = qs.get('hour') !== null ? Number(qs.get('hour')) : Number(p.hour) + Number(p.minute) / 60;
  const dark = darkness(hour);
  if (dark < 0.02) return;
  const lit = state.houses.filter((h) => h.state === 'occupied');
  const lights: Light[] = [];
  for (const l of lightSrc.lamps) { const q = P(l.x, l.y, 4.2); lights.push({ x: q.x, y: q.y + 30 * cam.RS * ZOOM, r: 110 * ZOOM, kind: 'lamp' }); }
  for (const b of lightSrc.buildings) { const q = P(b.x, b.y, 3); lights.push({ x: q.x, y: q.y, r: 200 * ZOOM, kind: 'building' }); }
  for (const h of lit) { const w = lightSrc.houses.get(h.id); if (!w) continue; const q = P(w.x, w.y, 1.5); lights.push({ x: q.x, y: q.y, r: 70 * ZOOM, kind: 'house' }); }
  night.draw(ctx, dark, lights, `${lit.length}:${lit[0]?.id ?? ''}:${lit[lit.length - 1]?.id ?? ''}`);
}
// ambience follows the same clock as the night view
setInterval(() => {
  if (!state || document.hidden) return;
  const disp = (state.park as unknown as { display?: { ambientSound?: boolean } }).display;
  const p = Object.fromEntries(HM_FMT.formatToParts(new Date((state.park as unknown as { gameMs: number }).gameMs)).map((x) => [x.type, x.value]));
  ambienceTick(disp?.ambientSound !== false && !state.park.paused, darkness(Number(p.hour) + Number(p.minute) / 60), currentWeather()?.kind ?? 'zon');
}, 500);
const HM_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
// ------------------------------------------------------------------ automatic zoom on events
// A new crisis (and, if set, a new storyline) zooms the map in on its location for a few seconds and back out.
// The map layers are scaled on the GPU (CSS transform); HUD, crisis panel and popups stay at normal size.
// /admin -> Projectie sets it (display.autoZoom: 'uit' | 'crises' | 'alles'); ?autozoom=0 turns it off here.
const AZ = { level: Math.max(1.2, Math.min(3, Number(qs.get('autozoomlevel') ?? 1.8))), inS: 1.4, holdS: 7, outS: 1.4 };
let zoomQueue: V2[] = [], zoomCur: { at: V2; t0: number } | null = null, zoomLast = '';
function requestZoom(at: V2, kind: 'crisis' | 'story') {
  if (qs.get('autozoom') === '0' || ZOOM > 1 || replaying) return;
  const mode = (state?.park as unknown as { display?: { autoZoom?: string } } | undefined)?.display?.autoZoom ?? 'crises';
  if (mode === 'uit' || (mode === 'crises' && kind !== 'crisis')) return;
  if (zoomQueue.length < 3) zoomQueue.push(at);
}
function autoZoomStep(now: number): { z: number; tx: number; ty: number } {
  if (!zoomCur && zoomQueue.length) zoomCur = { at: zoomQueue.shift()!, t0: now };
  let z = 1, tx = 0, ty = 0;
  if (zoomCur) {
    const t = now - zoomCur.t0, total = AZ.inS + AZ.holdS + AZ.outS;
    if (t >= total) zoomCur = null;
    else {
      const ease = (x: number) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
      const k = t < AZ.inS ? ease(t / AZ.inS) : t < AZ.inS + AZ.holdS ? 1 : 1 - ease((t - AZ.inS - AZ.holdS) / AZ.outS);
      z = 1 + (AZ.level - 1) * k;
      // keep the event slightly above the middle; never show empty space at the edges
      tx = Math.min(0, Math.max(cam.W - cam.W * z, cam.W * 0.5 - zoomCur.at.x * z));
      ty = Math.min(0, Math.max(cam.H - cam.H * z, cam.H * 0.52 - zoomCur.at.y * z));
    }
  }
  const css = z === 1 ? '' : `translate(${(tx / cam.RS).toFixed(1)}px, ${(ty / cam.RS).toFixed(1)}px) scale(${z.toFixed(4)})`;
  const key = css;
  if (key !== zoomLast) {
    zoomLast = key;
    for (const id of ['world', 'pixi']) { const el = document.getElementById(id); if (el) el.style.transform = css; }
  }
  return { z, tx, ty };
}
/** a vehicle as a cached image: heading in 128 steps, brake / reverse / blinker state in the key */
const HEADINGS = 128;
function vehicleDrawable(v: VehDraw, now: number): Obj {
  const hb = ((Math.round((v.h / (2 * Math.PI)) * HEADINGS) % HEADINGS) + HEADINGS) % HEADINGS;
  const blink = v.signal !== 0 && Math.floor(now * 2.6) % 2 === 0 ? Math.sign(v.signal) : 0;
  const q: VehDraw = { ...v, h: (hb / HEADINGS) * 2 * Math.PI, signal: blink };
  return {
    key: v.y * cam.CE, id: `v:${v.id}`, at: { x: v.x, y: v.y }, box: [v.len / 2 + 1.0, 3.2],
    cacheKey: `v|${v.kind}|${v.model}|${v.color}|${v.len}|${v.wid}|${v.label ?? ''}|${hb}|${v.brake ? 1 : 0}|${v.reverse ? 1 : 0}|${blink}`,
    draw: (c) => drawVehicle(c, { ...q, x: v.x, y: v.y }, 0),
  };
}
/** a pedestrian as a cached image: facing left/right and the walk cycle in 8 steps */
function pedDrawable(p: Frame['pedestrians'][number], seed: number, now: number, scale = 1, idPrefix = 'p:'): Obj {
  const facing = Math.cos(p.h) >= 0 ? 1 : -1;
  const ph = p.walking ? Math.floor(((((now * 7 + seed) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) : -1;
  const tq = ph < 0 ? 0 : ((ph + 0.5) * (Math.PI / 4) - seed) / 7;
  return {
    key: p.y * cam.CE, id: `${idPrefix}${p.id}`, at: { x: p.x, y: p.y }, box: [0.9 * scale, 2.2 * scale],
    cacheKey: `p|${p.color}|${seed % 15}|${(seed >> 3) % 5}|${facing}|${ph}|${scale}`,
    draw: (c) => drawPedestrian(c, { ...p, h: facing > 0 ? 0 : Math.PI, walking: ph >= 0 }, tq, seed),
  };
}
/** weather from the server (?weather=regen etc. forces a kind for testing) */
function currentWeather(): WeatherView | null {
  const f = qs.get('weather');
  if (f) return { kind: f as WeatherView['kind'], intensity: 0.7, wind: 4 };
  return (state?.park as unknown as { weather?: WeatherView } | undefined)?.weather ?? null;
}
const WX_ICONS: Record<string, string> = {
  zon: '<circle cx="12" cy="12" r="4.2" fill="#ffd34d" stroke="none"/><path stroke="#ffd34d" d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
  maan: '<path fill="#e8eefc" stroke="none" d="M15.5 3.5a8.5 8.5 0 1 0 5 13.6A7 7 0 0 1 15.5 3.5z"/>',
  halfbewolkt: '<circle cx="9" cy="9" r="3.4" fill="#ffd34d" stroke="none"/><path fill="#fff" stroke="none" d="M7 19h10.5a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.4A2.8 2.8 0 0 0 7 19z"/>',
  bewolkt: '<path fill="#dfe6ee" stroke="none" d="M6 19h12a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.6A3.2 3.2 0 0 0 6 19z"/>',
  regen: '<path fill="#dfe6ee" stroke="none" d="M6 15h12a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.6A3.2 3.2 0 0 0 6 15z"/><path stroke="#7fc4ff" stroke-width="1.8" d="M8 17.5l-1 3M12 17.5l-1 3M16 17.5l-1 3"/>',
  onweer: '<path fill="#c9d2dc" stroke="none" d="M6 14h12a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.6A3.2 3.2 0 0 0 6 14z"/><path fill="#ffd34d" stroke="none" d="M12.5 13l-3 5h2.5l-1 4 4-6h-2.6l1.2-3z"/>',
  mist: '<path stroke="#dfe6ee" stroke-width="1.8" d="M4 9h16M3 13h18M5 17h14"/>',
};
let wxLast = '';
function renderWeatherHud(night: boolean) {
  const w = currentWeather() as (WeatherView & { tempC?: number; name?: string }) | null;
  const kind = w?.kind ?? 'zon';
  const icon = kind === 'zon' && night ? 'maan' : kind;
  const key = `${icon}|${w?.tempC ?? ''}`;
  if (key === wxLast) return;
  wxLast = key;
  const el = document.getElementById('wx');
  if (el) el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" style="width:58px;height:58px">${WX_ICONS[icon] ?? WX_ICONS.zon}</svg>`;
  const tEl = document.getElementById('temp');
  if (tEl) tEl.textContent = w?.tempC !== undefined ? ` · ${w.tempC}°C ${(w.name ?? '').toLowerCase()}` : '';
}
setThunderHandler(() => playThunder());
const hashStr = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };

function drawOverlays(ctx: CanvasRenderingContext2D, it: ReturnType<typeof interp>, now: number) {
  if (!state) return;
  // bungalows in poor condition (technique, cleanliness, mood): a small badge, orange below 65%, red below 45%
  const k = cam.RS;
  for (const h of state.houses) {
    if (h.cond === undefined || h.cond >= 0.65) continue;
    const a = houseAnchor.get(h.id); if (!a) continue;
    const x = a.x + (h.incidents.length ? 46 * k : 0), y = a.y - 18 * k;
    const col = h.cond < 0.45 ? '#d9423a' : '#f08a24';
    const txt = `${Math.round(h.cond * 100)}%`;
    ctx.font = `800 ${Math.round(17 * k)}px system-ui, "Segoe UI", Arial`;
    const w = ctx.measureText(txt).width + 34 * k, hh = 26 * k;
    ctx.fillStyle = 'rgba(16,26,32,0.82)'; ctx.beginPath(); ctx.roundRect(x - w / 2, y - hh / 2, w, hh, hh / 2); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2.5 * k; ctx.stroke();
    // little heart
    const hx = x - w / 2 + 13 * k, hy = y; ctx.fillStyle = col; ctx.beginPath();
    ctx.moveTo(hx, hy + 5 * k); ctx.bezierCurveTo(hx - 9 * k, hy - 2 * k, hx - 4 * k, hy - 9 * k, hx, hy - 4 * k); ctx.bezierCurveTo(hx + 4 * k, hy - 9 * k, hx + 9 * k, hy - 2 * k, hx, hy + 5 * k); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, hx + 9 * k, y + 1 * k); ctx.textBaseline = 'alphabetic';
  }
  // incident pins above the corresponding bungalow
  for (const h of state.houses) {
    if (!h.incidents.length) continue;
    const a = houseAnchor.get(h.id); if (!a) continue;
    const first = h.incidents[0];
    pin(ctx, a.x, a.y, first.icon, now, { claimed: first.state === 'claimed', count: h.incidents.length });
  }
  // incident pins above facilities (reception, pool, brasserie, bike rental, ...)
  for (const f of state.facilities ?? []) {
    if (!f.incidents.length) continue;
    const a = P(f.pos.x, f.pos.y, 9);
    const first = f.incidents[0];
    pin(ctx, a.x, a.y, first.icon, now, { claimed: first.state === 'claimed', count: f.incidents.length });
  }
  // house cleaning status (service cart working)
  for (const h of state.houses) if (h.state === 'cleaning') { const a = houseAnchor.get(h.id); if (a) pill(ctx, a.x, a.y - 4 * cam.RS, 'broom', 'Schoonmaak', '#1aa3a8', '#fff', 0.8); }
  if (!it) return;
  // technical-service golf cart on its way to (or working at) a report
  for (const v of it.vehicles) {
    if (v.model !== 'golfcart' || v.job !== 'repair') continue;
    const s2 = Pv({ x: v.x, y: v.y, z: 2.4 });
    pill(ctx, s2.x, s2.y, 'wrench', v.state === 'driving' ? 'TD onderweg' : 'TD', '#f08a24', '#fff', 0.72);
  }
  // check-in / check-out bubbles above queued cars + queue indicator at each barrier
  for (const g of it.gates) {
    const gd = net.gates.get(g.id)!;
    g.queue.forEach((vid, i) => {
      const v = it.vehicles.find((x) => x.id === vid); if (!v) return;
      const task = state!.gateTasks.find((t) => t.vehicleId === vid && t.gateId === g.id);
      const token = state!.tokens.find((t) => t.vehicleId === vid && t.gateId === g.id);
      const s = Pv({ x: v.x, y: v.y, z: 2.2 });
      const icon = gd.direction === 'inbound' ? 'checkin' : 'checkout';
      // staff barrier: service vehicles with a staff pass, never a check-in/check-out
      if (gd.staff) { if (g.authorizedVehicle === vid) pill(ctx, s.x, s.y, 'check', 'Personeelspas', '#5b6fd6', '#fff', 0.8); return; }
      if (token || (g.authorizedVehicle === vid)) pill(ctx, s.x, s.y, 'check', i === 0 ? 'Akkoord' : '', '#2fae62', '#fff', i === 0 ? 0.85 : 0.7);
      else if (task?.state === 'claimed') pill(ctx, s.x, s.y, icon, 'Bezig', '#1aa3a8', '#fff', 0.85);
      // only the car that stands at the barrier has asked to check in/out; cars further back show nothing yet
      else if (task) pill(ctx, s.x, s.y + Math.sin(now * 3 + i) * 2 * cam.RS, icon, gd.direction === 'inbound' ? 'Check-in' : 'Check-out', '#f08a24', '#fff', 0.85);
    });
    if (g.queue.length >= 1) {
      // in screen space just below the stop line (camera side), so it never collides with the label above the car
      const s = Pv({ x: gd.stopPoint.x, y: gd.stopPoint.y, z: 0 });
      pill(ctx, s.x, s.y + 46 * cam.RS, 'car', `${g.queue.length}`, 'rgba(22,34,32,0.82)', '#ffffff', 0.72);
    }
  }
}

function drawDebug(ctx: CanvasRenderingContext2D, it: ReturnType<typeof interp>) {
  ctx.save();
  ctx.lineWidth = 1.5 * cam.RS;
  for (const e of net.edges.values()) {
    ctx.strokeStyle = e.kind === 'lane' ? 'rgba(0,200,255,0.8)' : e.kind === 'connector' ? 'rgba(255,220,0,0.8)' : e.kind === 'reverse' ? 'rgba(255,80,200,0.8)' : 'rgba(120,255,120,0.9)';
    ctx.beginPath(); e.line.pts.forEach((p, i) => { const s = P(p.x, p.y); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); ctx.stroke();
    for (let s0 = 4; s0 < e.line.length; s0 += 12) {
      const q = e.line.sample(s0), t = e.line.tangent(s0), a = P(q.x, q.y), b = P(q.x + t.x * 1.2, q.y + t.y * 1.2);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - Math.cos(ang - 0.5) * 9 * cam.RS, b.y - Math.sin(ang - 0.5) * 9 * cam.RS); ctx.lineTo(b.x - Math.cos(ang + 0.5) * 9 * cam.RS, b.y - Math.sin(ang + 0.5) * 9 * cam.RS); ctx.fill();
    }
  }
  for (const g of net.gates.values()) {
    const e = net.edges.get(g.edge)!;
    g.slotS.forEach((s, i) => { const q = e.line.sample(s), p = P(q.x, q.y); ctx.strokeStyle = '#ff00ff'; ctx.strokeRect(p.x - 6, p.y - 6, 12, 12); ctx.fillStyle = '#ff00ff'; ctx.font = `${Math.round(18 * cam.RS)}px monospace`; ctx.fillText(`slot ${i + 1}`, p.x + 8, p.y); });
    const sp = P(g.stopPoint.x, g.stopPoint.y); const gs = curGates.find((x) => x.id === g.id);
    ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(22 * cam.RS)}px monospace`; ctx.fillText(`${g.id}: ${gs?.phase ?? '?'} ${gs?.authorizedVehicle ?? ''}`, sp.x + 30, sp.y - 30);
  }
  if (debugData) {
    for (const v of debugData.vehicles) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); v.box.forEach((p: number[], i: number) => { const s = P(p[0], p[1]); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); ctx.closePath(); ctx.stroke();
      if (v.route.length) { ctx.strokeStyle = 'rgba(255,90,60,0.7)'; ctx.setLineDash([6, 6]); ctx.beginPath(); v.route.forEach((p: number[], i: number) => { const s = P(p[0], p[1]); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); ctx.stroke(); ctx.setLineDash([]); }
      const c = P(v.box[0][0], v.box[0][1]);
      ctx.fillStyle = '#fff'; ctx.font = `${Math.round(16 * cam.RS)}px monospace`;
      ctx.fillText(`${v.id} ${v.v}m/s ${v.why ?? ''}`, c.x + 6, c.y - 6);
    }
    const st = debugData.stats;
    ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(20 * cam.RS, cam.H - 200 * cam.RS, 900 * cam.RS, 180 * cam.RS);
    ctx.fillStyle = '#9ff'; ctx.font = `${Math.round(22 * cam.RS)}px monospace`;
    const lines = [`DEBUG verkeer  botsingen=${st.collisions}  illegale passages=${st.illegalGateCrossings}  spookrijders=${st.wrongWay}`, `failsafe=${st.failsafeInterventions}  harde stops=${st.hardGateStops}  cycli=${JSON.stringify(st.gateCycles)}`, `buffer=${debugData.buffer.length}  voertuigen=${debugData.vehicles.length}`, ...(st.log ?? []).slice(-3)];
    lines.forEach((l, i) => ctx.fillText(l.slice(0, 90), 34 * cam.RS, cam.H - 165 * cam.RS + i * 30 * cam.RS));
  }
  ctx.restore();
  void it;
}

// ------------------------------------------------------------------ HUD (DOM)
const days = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];
const badge = ['#f0a028', '#2bb3c0', '#e24a4a', '#3fa0d8', '#43b49d', '#2f8fbf', '#5ab0e8', '#ffffff', '#ffffff', '#ffffff'];
/** status cards of running crises (bottom right); they stay until the crisis is completely resolved */
function renderCrises() {
  const el = document.getElementById('crises'); if (!el || !state) return;
  const list = ((state.park as unknown as { crises?: CrisisStatus[] }).crises ?? []).slice(0, 2);
  const gm = (state.park as unknown as { gameMs: number }).gameMs;
  el.innerHTML = list.map((c) => {
    const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
    const mins = Math.max(0, Math.round((gm - c.startedAt) / 60000));
    const next = c.nextAt ? Math.max(1, Math.round((c.nextAt - gm) / 60000)) : null;
    return `<div class="cr"><div class="lbl"><span class="dot"></span>CRISIS · FASE ${c.stage + 1}/${c.stages}</div>
      <div class="ttl">${esc(c.title)}</div><div class="loc">${esc(c.locationName)} · loopt ${mins} min</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="row"><b>${c.done} van ${c.total}</b> meldingen afgehandeld${c.open ? ` · ${c.open} open${c.claimed ? ` (${c.claimed} in behandeling)` : ''}` : ''}</div>
      <div class="row">Nu: ${esc(c.current)}</div>
      <div class="mut">${next ? `Volgende melding verwacht over ~${next} min` : c.open ? 'Laatste fase: rond de open meldingen af' : 'Bijna opgelost'}</div></div>`;
  }).join('');
  // keep popups clear of the panel
  const k = (document.getElementById('world') as HTMLCanvasElement).width / 3840;
  setPopupReserved(list.length ? { x: el.offsetLeft * k, y: el.offsetTop * k, w: el.offsetWidth * k, h: el.offsetHeight * k } : null);
}
interface CrisisStatus { id: string; code: string; title: string; locationName: string; stage: number; stages: number; current: string; startedAt: number; done: number; open: number; claimed: number; total: number; nextAt: number | null }
function renderHud() {
  if (!state) return;
  renderCrises();
  const lb = document.getElementById('lb-rows')!;
  lb.innerHTML = state.leaderboard.slice(0, 12).map((p, i) => `<div class="row"><span class="rk" style="background:${badge[i] ?? '#fff'};color:${i >= 7 ? '#1d2b2a' : '#fff'}">${p.rank}</span><span class="nm">${esc(p.displayName)}</span><span class="pt">${p.score}</span></div>`).join('');
  updateClock();
  document.getElementById('sat')!.textContent = `${Math.round(state.park.satisfaction * 100)}%`;
  document.getElementById('open')!.textContent = String(state.park.openTasks);
  const hl = (state.park as unknown as { health?: { overall: number } }).health; const he = document.getElementById('health'); if (he && hl) he.textContent = `${Math.round(hl.overall * 100)}%`;
  const ss = (state.park as unknown as { session?: { endMs: number; ended: boolean } | null }).session;
  const endTxt = ss ? (ss.ended ? 'sessie afgelopen' : `tot ${new Date(ss.endMs).toLocaleTimeString('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' })}`) : '';
  document.getElementById('speed')!.textContent = [ss?.ended ? '' : state.park.paused ? 'gepauzeerd' : state.park.timeScale !== 1 ? `${state.park.timeScale}x` : '', endTxt].filter(Boolean).join(' · ');
}
let lastGame = 0, lastGameAt = 0;
function updateClock() {
  if (!state) return;
  if (state.park.gameMs !== lastGame) { lastGame = state.park.gameMs; lastGameAt = performance.now(); }
  const ms = lastGame + (state.park.paused ? 0 : (performance.now() - lastGameAt) * state.park.timeScale);
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', weekday: 'long', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  document.getElementById('clock')!.textContent = `${cap(get('weekday'))} ${get('hour')}:${get('minute')}`;
  document.getElementById('date')!.textContent = `${get('day')} ${get('month')} ${get('year')}`;
  const hr = Number(get('hour')) + Number(get('minute')) / 60;
  renderWeatherHud(darkness(hr) > 0.5);
  void days;
}
setInterval(updateClock, 1000);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

boot().catch((e) => { console.error(e); setStatus('Fout bij laden: ' + e.message); });
void mkCanvas; void ({} as HouseInfo);
