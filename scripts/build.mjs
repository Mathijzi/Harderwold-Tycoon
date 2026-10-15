// Build: bundles the browser apps and the dependency-free Node server into dist/.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('dist/web', { recursive: true });
const common = { bundle: true, sourcemap: true, logLevel: 'info', target: 'es2022' };
await Promise.all([
  build({ ...common, entryPoints: ['src/web/projector/main.ts'], outfile: 'dist/web/projector.js', format: 'esm', platform: 'browser' }),
  build({ ...common, entryPoints: ['src/web/testclient/main.tsx'], outfile: 'dist/web/testclient.js', format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, minify: true }),
  build({ ...common, entryPoints: ['src/web/admin/main.tsx'], outfile: 'dist/web/admin.js', format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, minify: true }),
  build({ ...common, entryPoints: ['src/web/editor/main.tsx'], outfile: 'dist/web/editor.js', format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, minify: true }),
  build({ ...common, entryPoints: ['src/server/mapworker.ts'], outfile: 'dist/mapworker.mjs', format: 'esm', platform: 'node', target: 'node22', packages: 'bundle' }),
  build({ ...common, entryPoints: ['src/server/main.ts'], outfile: 'dist/server.mjs', format: 'esm', platform: 'node', target: 'node22', packages: 'bundle',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } }),
]);
console.log('build klaar -> dist/');
