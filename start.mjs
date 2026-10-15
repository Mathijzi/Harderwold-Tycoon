// Start the prototype: node start.mjs   (checks the Node version first)
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 13)) {
  console.error(`Harderwold Tycoon vereist Node.js 22.13 of nieuwer (ingebouwde SQLite). Je hebt ${process.versions.node}. Download: https://nodejs.org/`);
  process.exit(1);
}
process.removeAllListeners('warning');
process.on('warning', (w) => { if (!String(w.message).includes('SQLite')) console.warn(w); });
await import('./dist/server.mjs');
