// quick screenshot helper: node scripts/shot.mjs <url> <out.png> [w h] [waitMs]
import { chromium } from 'playwright';
const [url, out, w = '3840', h = '2160', wait = '6000'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
const scene = await page.evaluate(() => window.__scene);
console.log(JSON.stringify(scene));
console.log(logs.slice(0, 20).join('\n'));
await browser.close();
