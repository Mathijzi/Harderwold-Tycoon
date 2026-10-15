// Asset completeness report for the map editor: compares the (edited) map with the automatic PDF manifest
// (data/map/harderwold_manifest.json, tools/harderwold/build_map.py) and lists what still needs a human check. Nothing is "fixed" here.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { MapBundle } from '../shared/mapdoc.ts';
import { REVIEW_ITEMS } from '../shared/mapdoc.ts';

interface Manifest {
  houses: { number: number; pdf: { x: number; y: number }; legendType: string | null; typeConfidence: string }[];
  facilities: { key: string; x: number; y: number }[];
  legend: Record<string, unknown>;
  warnings: string[];
}

export function mapReport(bundle: MapBundle, dir: string, publicRoot = join(dir, '..', '..', 'public')) {
  const man = JSON.parse(readFileSync(join(dir, 'harderwold_manifest.json'), 'utf8')) as Manifest;
  const houses = bundle.park.houses;
  const byNum = new Map(houses.map((h) => [h.number, h]));
  const manNums = new Set(man.houses.map((h) => h.number));
  const missing = man.houses.filter((h) => !byNum.has(h.number)).map((h) => h.number);
  const extra = houses.filter((h) => !manNums.has(h.number)).map((h) => h.number);
  const moved = man.houses.flatMap((m) => {
    const h = byNum.get(m.number);
    if (!h) return [];
    const d = Math.hypot(h.pt[0] - m.pdf.x, h.pt[1] - m.pdf.y) * bundle.park.metersPerPt;
    return d > 3 ? [{ number: m.number, movedM: +d.toFixed(1) }] : [];
  });
  const typeChanged = man.houses.filter((m) => byNum.has(m.number) && byNum.get(m.number)!.legendType !== m.legendType).map((m) => ({ number: m.number, pdf: m.legendType, map: byNum.get(m.number)!.legendType }));
  const conf = { high: 0, medium: 0, low: 0, other: 0 } as Record<string, number>;
  for (const h of houses) conf[h.typeConfidence in conf ? h.typeConfidence : 'other']++;
  const uncertain = houses.filter((h) => h.typeConfidence !== 'high' && h.typeConfidence !== 'reviewed').map((h) => ({ number: h.number, type: h.legendType, confidence: h.typeConfidence }));
  // facilities: count per letter, manifest vs map
  const facs = (bundle.park as unknown as { facilities?: { key: string }[] }).facilities ?? [];
  const count = (l: { key: string }[]) => l.reduce((m, f) => m.set(f.key, (m.get(f.key) ?? 0) + 1), new Map<string, number>());
  const fm = count(man.facilities), fp = count(facs);
  const facilityDiff = [...new Set([...fm.keys(), ...fp.keys()])].sort().filter((k) => (fm.get(k) ?? 0) !== (fp.get(k) ?? 0)).map((k) => ({ key: k, pdf: fm.get(k) ?? 0, map: fp.get(k) ?? 0 }));
  // art: every house type is drawn procedurally; supplied sprites (public/assets/sprites/<type>.png|webp) replace it
  const spriteDir = join(publicRoot, 'assets', 'sprites');
  const supplied = existsSync(spriteDir) ? readdirSync(spriteDir).map((f) => f.replace(/\.(png|webp)$/i, '')) : [];
  const types = [...new Set(houses.map((h) => h.legendType ?? '?'))].sort();
  const art = types.map((t) => ({ type: t, houses: houses.filter((h) => (h.legendType ?? '?') === t).length, art: supplied.includes(t) ? 'aangeleverde sprite' : 'procedureel (placeholder)' }));
  const reviewed = REVIEW_ITEMS.filter((r) => bundle.review?.[r.id]).length;
  return {
    houses: { pdf: man.houses.length, map: houses.length, missing, extra, moved: moved.sort((a, b) => b.movedM - a.movedM), typeChanged, confidence: conf, uncertain },
    facilities: { pdf: man.facilities.length, map: facs.length, diff: facilityDiff },
    art, manifestWarnings: man.warnings,
    review: { done: reviewed, total: REVIEW_ITEMS.length },
  };
}
