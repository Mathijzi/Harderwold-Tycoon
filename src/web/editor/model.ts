// Editing model for the map editor: selection, geometry helpers and structural edits on a MapBundle (PDF points).
import type { MapBundle } from '../../shared/mapdoc.ts';
import { catmullRom } from '../../shared/geom.ts';

export type Pt = number[];
export type PolyLayer = 'water' | 'footpaths' | 'roadSurfaces' | 'structures';
export type Sel =
  | { kind: 'house'; num: number }
  | { kind: 'node'; id: string }
  | { kind: 'road'; id: string }
  | { kind: 'rpt'; road: string; i: number }
  | { kind: 'gate'; id: string }
  | { kind: 'parking'; id: string }
  | { kind: 'facility'; i: number }
  | { kind: 'poly'; layer: PolyLayer; i: number }
  | { kind: 'vertex'; layer: PolyLayer; i: number; v: number }
  | null;

export type Road = MapBundle['network']['roads'][number];
export type Gate = MapBundle['network']['gates'][number];
export type House = MapBundle['park']['houses'][number] & { footprintPts?: number };
export type Cluster = MapBundle['park']['parkingClusters'][number] & { pdfEvidence?: string };
export interface Facility { key: string; name?: string; pt: Pt }

export const facilities = (d: MapBundle) => ((d.park as unknown as { facilities?: Facility[] }).facilities ?? []);
export function polys(d: MapBundle, layer: PolyLayer): Pt[][] {
  if (layer === 'structures') return ((d.park as unknown as { structures?: { pts: Pt[] }[] }).structures ?? []).map((s) => s.pts);
  return (((d.park as unknown as { terrain?: Record<string, Pt[][]> }).terrain ?? {})[layer]) ?? [];
}
export const roadCtrl = (d: MapBundle, r: Road): Pt[] => [d.network.nodes[r.from].pt, ...r.pts, d.network.nodes[r.to].pt];
export function smooth(ctrl: Pt[]): Pt[] {
  if (ctrl.length < 3) return ctrl;
  return catmullRom(ctrl.map(([x, y]) => ({ x, y })), 0.8, 0.4).map((v) => [v.x, v.y]);
}
export function nearestOnPolyline(P: Pt[], p: Pt) {
  let best = { i: 0, d: Infinity, q: P[0], t: 0 };
  for (let i = 0; i < P.length - 1; i++) {
    const [ax, ay] = P[i], [bx, by] = P[i + 1], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L));
    const q = [ax + dx * t, ay + dy * t], dd = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (dd < best.d) best = { i, d: dd, q, t };
  }
  return best;
}
export const r1 = (v: number) => Math.round(v * 10) / 10;
export function uniqueId(prefix: string, taken: (id: string) => boolean) {
  for (let n = 1; ; n++) if (!taken(`${prefix}${n}`)) return `${prefix}${n}`;
}

/** Insert a control point on a road at the clicked position (between the nearest two control points). */
export function insertRoadPoint(d: MapBundle, roadId: string, p: Pt) {
  const r = d.network.roads.find((x) => x.id === roadId)!;
  const ctrl = roadCtrl(d, r);
  const near = nearestOnPolyline(ctrl, p);
  r.pts.splice(near.i, 0, [r1(near.q[0]), r1(near.q[1])]);
  return near.i;
}

/** Split a road at one of its control points: that point becomes a new junction node. Gates stay on the piece
 *  that contains their stop line. */
export function splitRoad(d: MapBundle, roadId: string, i: number) {
  const n = d.network;
  const r = n.roads.find((x) => x.id === roadId)!;
  const nid = uniqueId('N_E', (id) => !!n.nodes[id]);
  n.nodes[nid] = { pt: r.pts[i], kind: 'junction', radius: 5 };
  const rid = uniqueId(`${r.id}-`, (id) => n.roads.some((x) => x.id === id));
  const r2: Road = JSON.parse(JSON.stringify(r));
  r2.id = rid; r2.from = nid; r2.pts = r.pts.slice(i + 1); delete r2.gatePlaza;
  r.to = nid; r.pts = r.pts.slice(0, i);
  n.roads.push(r2);
  for (const g of n.gates) {
    if (g.road !== r.id) continue;
    const a = nearestOnPolyline(roadCtrl(d, r), g.stopPt).d, b = nearestOnPolyline(roadCtrl(d, r2), g.stopPt).d;
    if (b < a) g.road = r2.id;
  }
  return nid;
}

export function addRoad(d: MapBundle, from: string, to: string) {
  const id = uniqueId('weg-', (x) => d.network.roads.some((r) => r.id === x));
  d.network.roads.push({ id, name: 'Nieuwe weg', from, to, class: 'park', speedKmh: 15, priority: 1, laneOffsetM: 1.45, pts: [] });
  return id;
}

/** Remove the selection. Returns a message when it is refused. */
export function deleteSel(d: MapBundle, s: Sel): string | null {
  if (!s) return null;
  const n = d.network;
  if (s.kind === 'rpt') { const r = n.roads.find((x) => x.id === s.road)!; r.pts.splice(s.i, 1); return null; }
  if (s.kind === 'road') {
    if (n.gates.some((g) => g.road === s.id)) return `Op weg ${s.id} staat een slagboom; verplaats of verwijder die eerst`;
    n.roads = n.roads.filter((r) => r.id !== s.id); return null;
  }
  if (s.kind === 'node') {
    const used = n.roads.filter((r) => r.from === s.id || r.to === s.id).map((r) => r.id);
    if (used.length) return `Knoop ${s.id} wordt gebruikt door ${used.join(', ')}`;
    delete n.nodes[s.id]; return null;
  }
  if (s.kind === 'parking') { d.park.parkingClusters = d.park.parkingClusters.filter((c) => c.id !== s.id); return null; }
  if (s.kind === 'vertex') {
    const P = polys(d, s.layer)[s.i];
    const closed = P.length > 1 && P[0][0] === P[P.length - 1][0] && P[0][1] === P[P.length - 1][1];
    if (P.length - (closed ? 1 : 0) <= 3) return 'Een vlak heeft minstens drie hoekpunten';
    if (closed) P.pop();
    P.splice(s.v % P.length, 1);
    if (closed) P.push([...P[0]]);
    return null;
  }
  if (s.kind === 'house') return 'Huizen komen uit de PDF en worden niet verwijderd; zet ze desnoods op een andere plek';
  if (s.kind === 'gate') {
    const g = n.gates.find((x) => x.id === s.id)!;
    if (n.gates.filter((x) => x.direction === g.direction).length <= 1) return 'Er moet minstens één slagboom in deze richting overblijven';
    n.gates = n.gates.filter((x) => x.id !== s.id); return null;
  }
  return 'Dit object kan niet worden verwijderd';
}

/** A representative position of the selection (for centring and problem markers). */
export function posOf(d: MapBundle, s: Sel): Pt | null {
  if (!s) return null;
  const n = d.network;
  switch (s.kind) {
    case 'house': return d.park.houses.find((h) => h.number === s.num)?.pt ?? null;
    case 'node': return n.nodes[s.id]?.pt ?? null;
    case 'road': { const r = n.roads.find((x) => x.id === s.id); if (!r) return null; const c = roadCtrl(d, r); return c[Math.floor(c.length / 2)]; }
    case 'rpt': return n.roads.find((x) => x.id === s.road)?.pts[s.i] ?? null;
    case 'gate': return n.gates.find((g) => g.id === s.id)?.stopPt ?? null;
    case 'parking': return d.park.parkingClusters.find((c) => c.id === s.id)?.pt ?? null;
    case 'facility': return facilities(d)[s.i]?.pt ?? null;
    case 'poly': { const P = polys(d, s.layer)[s.i]; return P ? [P.reduce((a, p) => a + p[0], 0) / P.length, P.reduce((a, p) => a + p[1], 0) / P.length] : null; }
    case 'vertex': return polys(d, s.layer)[s.i]?.[s.v] ?? null;
  }
}

/** The point that a drag moves for this selection (mutable reference into the doc). */
export function dragPoint(d: MapBundle, s: Sel): Pt | null {
  if (!s) return null;
  switch (s.kind) {
    case 'house': return d.park.houses.find((h) => h.number === s.num)!.pt;
    case 'node': return d.network.nodes[s.id].pt;
    case 'rpt': return d.network.roads.find((x) => x.id === s.road)!.pts[s.i];
    case 'gate': return d.network.gates.find((g) => g.id === s.id)!.stopPt;
    case 'parking': return d.park.parkingClusters.find((c) => c.id === s.id)!.pt;
    case 'facility': return facilities(d)[s.i].pt;
    case 'vertex': return polys(d, s.layer)[s.i][s.v];
    default: return null;
  }
}

export function sameSel(a: Sel, b: Sel) { return JSON.stringify(a) === JSON.stringify(b); }
