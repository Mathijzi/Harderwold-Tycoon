import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildNetwork, NetworkJson, SectorJson } from './network.ts';
const here = dirname(fileURLToPath(import.meta.url));
// works from src/sim (tsx) and from dist/ (bundled server)
export const DATA_DIR = [join(here, '..', '..', 'data', 'map'), join(here, '..', 'data', 'map')].find((p) => existsSync(p)) ?? join(here, '..', '..', 'data', 'map');
export function loadMapJson(dir = process.env.MAP_DIR ?? DATA_DIR) {
  const set = ['park_road_network.json', 'park.json'];
  const net = JSON.parse(readFileSync(join(dir, set[0]), 'utf8')) as NetworkJson;
  const sector = JSON.parse(readFileSync(join(dir, set[1]), 'utf8')) as SectorJson;
  return { net, sector };
}
// the network is immutable once built: build once per process and map set (tests create many games)
const cache = new Map<string, ReturnType<typeof buildNetwork>>();
export function loadNetwork(dir?: string) {
  const key = `${dir ?? process.env.MAP_DIR ?? DATA_DIR}`;
  let n = cache.get(key);
  if (!n) { const { net, sector } = loadMapJson(dir); n = buildNetwork(net, sector); cache.set(key, n); }
  return n;
}
/** after the map editor activated a new version */
export function clearNetworkCache() { cache.clear(); }
export const mapDir = () => process.env.MAP_DIR ?? DATA_DIR;
