// Map bundle: the editable map (road network + park data) as one versioned document, shared by the map editor
// (browser) and the server (versions, validation, activation). Coordinates are PDF points of AHT_Plat.pdf.
import type { NetworkJson, SectorJson } from '../sim/network.ts';

export const MAP_FORMAT = 'harderwold-map';
export const MAP_SCHEMA = 1;

export interface MapBundle {
  format: typeof MAP_FORMAT;
  schema: number;
  /** version this bundle was derived from (null = the files in data/map) */
  parentVersion: number | null;
  savedAt?: string;
  comment?: string;
  network: NetworkJson & Record<string, unknown>;
  park: SectorJson;
  /** review checklist: item id -> checked */
  review: Record<string, boolean>;
}

export interface Problem { level: 'error' | 'warn' | 'info'; msg: string; ref?: { kind: string; id: string } }

/** The review checklist from the masterprompt (map pipeline): a human confirms each point in the editor. */
export const REVIEW_ITEMS: { id: string; label: string }[] = [
  { id: 'houses-numbers', label: 'Alle huisnummers uit de PDF staan op de kaart, op de juiste plek en zonder dubbele nummers' },
  { id: 'houses-types', label: 'Huistypen met lage of middelmatige zekerheid zijn gecontroleerd' },
  { id: 'houses-front', label: 'Voordeuren wijzen naar de goede weg; huizen staan niet op een weg of tegen elkaar' },
  { id: 'facilities', label: 'Voorzieningen (receptie, brasserie, zwembad, winkel, ...) staan op de juiste plek' },
  { id: 'roads-topology', label: 'Wegverloop en kruisingen kloppen met de PDF; geen wegen buiten het park' },
  { id: 'roads-oneway', label: 'Eenrichtingswegen en rijrichtingen zijn gecontroleerd' },
  { id: 'gates', label: 'Slagbomen, stopstrepen en opstelplaatsen liggen goed; de wachtrij blokkeert geen openbare weg' },
  { id: 'service', label: 'Dienstwegen en dienstingangen zijn alleen voor servicevoertuigen en kloppen met de praktijk' },
  { id: 'parking', label: 'Elk huis heeft een eigen parkeervak dicht bij het huis' },
  { id: 'scale', label: 'Schaal (meter per PDF-punt) is gecontroleerd met een bekende maat' },
  { id: 'terrain', label: 'Water, paden en verharde vlakken zijn gecontroleerd' },
];

const isPt = (p: unknown): p is number[] => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v));

/** Structural check (cheap, no network build): references, ids, numbers, value ranges. */
export function checkBundle(b: unknown): Problem[] {
  const out: Problem[] = [];
  const err = (msg: string, ref?: Problem['ref']) => out.push({ level: 'error', msg, ref });
  const x = b as Partial<MapBundle>;
  if (!x || typeof x !== 'object') return [{ level: 'error', msg: 'Geen kaartdocument' }];
  if (x.format !== MAP_FORMAT) err(`Onbekend formaat (verwacht "${MAP_FORMAT}")`);
  if (x.schema !== MAP_SCHEMA) err(`Onbekende schemaversie ${x.schema} (verwacht ${MAP_SCHEMA})`);
  const n = x.network, p = x.park;
  if (!n || typeof n !== 'object' || !n.nodes || !Array.isArray(n.roads) || !Array.isArray(n.gates)) { err('Wegennet ontbreekt of is onvolledig'); return out; }
  if (!p || typeof p !== 'object' || !Array.isArray(p.houses) || !Array.isArray(p.parkingClusters)) { err('Parkgegevens ontbreken of zijn onvolledig'); return out; }
  if (!(p.metersPerPt > 0.2 && p.metersPerPt < 10)) err(`Schaal ${p.metersPerPt} m/pt is onwaarschijnlijk (0,2 - 10)`);
  if (!isPt(p.originPt) || !Array.isArray(p.viewPts) || p.viewPts.length !== 4) err('originPt of viewPts ongeldig');
  for (const [id, nd] of Object.entries(n.nodes)) if (!isPt(nd.pt)) err(`Knoop ${id}: ongeldige positie`, { kind: 'node', id });
  const roadIds = new Set<string>();
  for (const r of n.roads) {
    if (roadIds.has(r.id)) err(`Weg-id ${r.id} komt dubbel voor`, { kind: 'road', id: r.id });
    roadIds.add(r.id);
    if (!n.nodes[r.from] || !n.nodes[r.to]) err(`Weg ${r.id}: knoop ${!n.nodes[r.from] ? r.from : r.to} bestaat niet`, { kind: 'road', id: r.id });
    if (r.from === r.to) err(`Weg ${r.id} begint en eindigt in dezelfde knoop`, { kind: 'road', id: r.id });
    if (!Array.isArray(r.pts) || !r.pts.every(isPt)) err(`Weg ${r.id}: ongeldige tussenpunten`, { kind: 'road', id: r.id });
    if (!['public', 'arrival', 'park', 'service', 'scenery'].includes(r.class)) err(`Weg ${r.id}: onbekende klasse ${r.class}`, { kind: 'road', id: r.id });
    if (r.oneway !== undefined && r.oneway !== 'f' && r.oneway !== 'b') err(`Weg ${r.id}: eenrichting moet 'f' of 'b' zijn`, { kind: 'road', id: r.id });
    if (!(r.speedKmh > 0 && r.speedKmh <= 80)) err(`Weg ${r.id}: snelheid ${r.speedKmh} km/u buiten 1-80`, { kind: 'road', id: r.id });
  }
  const gateIds = new Set<string>();
  for (const g of n.gates) {
    if (gateIds.has(g.id)) err(`Slagboom-id ${g.id} komt dubbel voor`, { kind: 'gate', id: g.id });
    gateIds.add(g.id);
    const r = n.roads.find((q) => q.id === g.road);
    if (!r) err(`Slagboom ${g.id}: weg ${g.road} bestaat niet`, { kind: 'gate', id: g.id });
    else if (r.oneway && (r.oneway === 'f') !== (g.lane === 'forward')) err(`Slagboom ${g.id} staat op de rijstrook die op eenrichtingsweg ${r.id} niet bestaat`, { kind: 'gate', id: g.id });
    if (!isPt(g.stopPt)) err(`Slagboom ${g.id}: ongeldige stopstreep`, { kind: 'gate', id: g.id });
    if (!(Number.isInteger(g.queueSlots) && g.queueSlots >= 1 && g.queueSlots <= 12)) err(`Slagboom ${g.id}: opstelplaatsen moet 1-12 zijn`, { kind: 'gate', id: g.id });
    if (!(g.slotSpacingM >= 5.5 && g.slotSpacingM <= 12)) err(`Slagboom ${g.id}: afstand opstelplaatsen moet 5,5-12 m zijn (auto 4,7 m + ruimte)`, { kind: 'gate', id: g.id });
  }
  if (!n.gates.some((g) => g.direction === 'inbound' && !g.staff) || !n.gates.some((g) => g.direction === 'outbound' && !g.staff)) err('Er is minstens één inrij- en één uitrijslagboom voor bezoekers nodig');
  for (const g of n.gates) if (g.staff && n.roads.find((r) => r.id === g.road)?.class !== 'service') err(`Personeelsslagboom ${g.id} moet op een dienstweg staan`, { kind: 'gate', id: g.id });
  const nums = new Map<number, number>();
  for (const h of p.houses) {
    if (!isPt(h.pt)) err(`Huis ${h.number}: ongeldige positie`, { kind: 'house', id: String(h.number) });
    nums.set(h.number, (nums.get(h.number) ?? 0) + 1);
    if (h.frontDeg !== undefined && !Number.isFinite(h.frontDeg)) err(`Huis ${h.number}: ongeldige voorkant`, { kind: 'house', id: String(h.number) });
    if (h.scale !== undefined && !(h.scale >= 0.5 && h.scale <= 1.2)) err(`Huis ${h.number}: schaal moet 0,5-1,2 zijn`, { kind: 'house', id: String(h.number) });
  }
  for (const [num, c] of nums) if (c > 1) err(`Huisnummer ${num} komt ${c} keer voor`, { kind: 'house', id: String(num) });
  const clusterIds = new Set<string>();
  for (const c of p.parkingClusters) {
    if (clusterIds.has(c.id)) err(`Parkeercluster ${c.id} komt dubbel voor`, { kind: 'parking', id: c.id });
    clusterIds.add(c.id);
    if (!isPt(c.pt)) err(`Parkeercluster ${c.id}: ongeldige positie`, { kind: 'parking', id: c.id });
    if (!(Number.isInteger(c.stalls) && c.stalls >= 1 && c.stalls <= 40)) err(`Parkeercluster ${c.id}: aantal vakken 1-40`, { kind: 'parking', id: c.id });
    for (const s of c.serves ?? []) if (!nums.has(s)) out.push({ level: 'warn', msg: `Parkeercluster ${c.id} bedient huis ${s}, dat niet op de kaart staat`, ref: { kind: 'parking', id: c.id } });
  }
  return out;
}

/** Stable short checksum (FNV-1a over the JSON) to recognise identical versions. */
export function checksum(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
