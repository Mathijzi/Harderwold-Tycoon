// End-to-end browser check: test client completes a check-in -> projector shows the gate opening for that car only.
// Usage: node scripts/e2e.mjs <baseUrl> <outDir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:8090', out = 'screenshots'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const H = { 'X-Admin-Key': 'gm-harderwold', 'content-type': 'application/json' };
const api = async (m, p, b) => (await fetch(`${base}/api/v1${p}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
const ui = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
ui.on('pageerror', (e) => errors.push('test: ' + e.message));
await ui.goto(`${base}/test`);
await ui.getByRole('button', { name: /^Sophie/ }).click();
await api('POST', '/admin/speed', { timeScale: 4 });
// wait until a check-in task is offered (a car is queued)
let task;
for (let i = 0; i < 60 && !task; i++) { await sleep(1000); const st = await api('GET', '/admin/state'); task = st.tasks.find((t) => t.kind === 'checkin' && t.state === 'offered' && t.queuePosition === 1); }
await api('POST', '/admin/speed', { timeScale: 1 });
if (!task) { console.log('GEEN check-in opdracht verschenen'); process.exit(1); }
console.log('check-in opdracht:', task.id, task.vehicleId, 'slagboom', task.gateId, 'positie', task.queuePosition);
await ui.reload(); await sleep(1500);
await ui.screenshot({ path: `${out}/testinterface_voor.png`, fullPage: true });
const before = await api('GET', '/park');
console.log('slagboom voor:', JSON.stringify(before.gates));
const proj = await browser.newPage({ viewport: { width: 3840, height: 2160 } });
proj.on('pageerror', (e) => errors.push('projector: ' + e.message));
await proj.goto(`${base}/`); await sleep(7000);
await proj.screenshot({ path: `${out}/projectie_wachtrij_4k.png` });
// click "Claim + afronden" on the card of exactly this vehicle
const card = ui.locator('.card', { hasText: task.vehicleId });
await card.getByRole('button', { name: 'Claim + afronden' }).click();
let opened = null; const seen = [];
for (let i = 0; i < 360; i++) {
  await sleep(250);
  const p = await api('GET', '/park');
  const g = p.gates.find((x) => x.id === task.gateId);
  seen.push(g.phase);
  if (g.phase === 'OPEN' || g.phase === 'OPENING') { opened = g; break; }
}
console.log('slagboom na afronden:', JSON.stringify(opened), 'fasen', [...new Set(seen)].join('>'));
await sleep(2500);
await proj.screenshot({ path: `${out}/projectie_slagboom_open_4k.png` });
await ui.screenshot({ path: `${out}/testinterface_na.png`, fullPage: true });
// wait for it to close again and verify only one passage happened
let closed = false;
for (let i = 0; i < 60; i++) { await sleep(500); const p = await api('GET', '/park'); if (p.gates.find((x) => x.id === task.gateId).phase === 'CLOSED') { closed = true; break; } }
const dbg = await api('GET', '/admin/debug');
console.log('weer gesloten:', closed, 'cycli:', JSON.stringify(dbg.stats.gateCycles), 'illegale passages:', dbg.stats.illegalGateCrossings, 'botsingen:', dbg.stats.collisions);
const lb = await (await fetch(`${base}/api/v1/leaderboard`)).json();
console.log('Sophie punten:', lb.find((p) => p.displayName === 'Sophie').score);
console.log('fouten in pagina:', errors.length ? errors : 'geen');
// 1080p fallback screenshot
const p2 = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await p2.goto(`${base}/?res=1080`); await sleep(6000); await p2.screenshot({ path: `${out}/projectie_1080p.png` });
await browser.close();
