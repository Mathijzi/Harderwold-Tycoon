// Records a full check-in cycle on the projector (for review): arrival -> queue -> check-in via API -> gate -> drive in.
import { chromium } from 'playwright';
const [base = 'http://localhost:8090', out = '/tmp/vid'] = process.argv.slice(2);
const H = { 'X-Admin-Key': 'gm-harderwold', 'content-type': 'application/json' };
const api = async (m, p, b, h = H) => (await fetch(`${base}/api/v1${p}`, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await api('POST', '/admin/reset', { seed: 42 });
await api('POST', '/admin/flags', { demoBot: false, autoArrivals: false });
const tok = await api('POST', '/admin/players/' + (await api('GET', '/admin/players')).find((p) => p.displayName === 'Sanne').id + '/token', {});
const P = { Authorization: `Bearer ${tok.token}`, 'content-type': 'application/json' };
await api('POST', '/admin/arrivals', { count: 2 });
await api('POST', '/admin/speed', { timeScale: 3 });
// wait until the first car is at the head of the queue
for (let i = 0; i < 80; i++) { await sleep(500); const s = await api('GET', '/admin/debug'); const head = s.gates.find((g) => g.id === 'gate-in').queue[0]; const v = head && s.vehicles.find((x) => x.id === head); if (v && v.v < 0.2 && v.why && v.why.includes('slagboom')) break; }
await api('POST', '/admin/speed', { timeScale: 1 });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 3840, height: 2160 }, recordVideo: { dir: out, size: { width: 3840, height: 2160 } } });
const page = await ctx.newPage();
await page.goto(base + '/');
await sleep(9000);
const tasks = await api('GET', '/tasks?state=offered', undefined, P);
const t = tasks.find((x) => x.kind === 'checkin' && x.queuePosition === 1);
console.log('afronden', t?.id);
await api('POST', `/tasks/${t.id}/claim`, { idempotencyKey: 'rec-claim-1' }, P);
await sleep(1500);
await api('POST', `/tasks/${t.id}/complete`, { idempotencyKey: 'rec-done-1' }, P);
await sleep(22000);
await ctx.close(); await browser.close();
console.log('klaar');
