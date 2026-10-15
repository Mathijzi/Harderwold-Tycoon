// Property panel of the map editor: one form per selected object kind, plus the map-wide settings.
import type { MapBundle, Problem } from '../../shared/mapdoc.ts';
import type { Diagnosis } from '../../sim/diagnose.ts';
import { Sel, Pt, facilities, polys, Road } from './model.ts';

interface Props {
  doc: MapBundle; sel: Sel; diag: Diagnosis | null;
  commit: (fn: (d: MapBundle) => string | void) => void;
  setSel: (s: Sel) => void;
  onRoute: (house: number) => void;
  route: { house: number; in?: { gate: string; lengthM: number }; out?: { gate: string; lengthM: number } } | null;
  onSplit: (road: string, i: number) => void;
  localProblems: Problem[];
}

const num = (v: string, d?: number) => { const n = Number(v.replace(',', '.')); return Number.isFinite(n) ? n : d; };

function NumField({ label, value, onChange, step = 0.1, min, max, hint }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; step?: number; min?: number; max?: number; hint?: string }) {
  return <label className="f"><span>{label}</span><input type="number" step={step} min={min} max={max} value={value ?? ''} placeholder={hint ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : num(e.target.value))} /></label>;
}
function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label className="f"><span>{label}</span><input value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}
function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <label className="f"><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value as T)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
}
function PtField({ label, pt, onChange }: { label: string; pt: Pt; onChange: (p: Pt) => void }) {
  return <label className="f"><span>{label}</span><span className="pair">
    <input type="number" step={0.1} value={pt[0]} onChange={(e) => onChange([num(e.target.value, pt[0])!, pt[1]])} />
    <input type="number" step={0.1} value={pt[1]} onChange={(e) => onChange([pt[0], num(e.target.value, pt[1])!])} />
  </span></label>;
}

export function Inspector({ doc, sel, diag, commit, setSel, onRoute, route, onSplit, localProblems }: Props) {
  const n = doc.network;
  const errs = localProblems.filter((p) => p.level === 'error');
  const head = errs.length ? <div className="box err">{errs.length} fout(en) in de kaart: {errs.slice(0, 4).map((p) => p.msg).join(' · ')}</div> : null;

  if (!sel) {
    const p = doc.park;
    return <div>
      {head}
      <h3>Kaart</h3>
      <p className="muted small">Klik op een object op de kaart om het te bewerken, of sleep het naar de goede plek.</p>
      <NumField label="Schaal (m per PDF-punt)" value={p.metersPerPt} step={0.01} onChange={(v) => v && commit((d) => { d.park.metersPerPt = v; })} />
      <p className="muted small">Controleer de schaal met het meetgereedschap op een bekende maat (bijv. de breedte van een weg of het sportveld). Een andere schaal verandert alle afstanden in de simulatie.</p>
      <PtField label="Oorsprong (pt)" pt={p.originPt} onChange={(v) => commit((d) => { d.park.originPt = v; })} />
      <table className="kv"><tbody>
        <tr><td>Huizen</td><td>{p.houses.length}</td></tr>
        <tr><td>Wegen / knopen</td><td>{n.roads.length} / {Object.keys(n.nodes).length}</td></tr>
        <tr><td>Slagbomen</td><td>{n.gates.map((g) => g.id).join(', ')}</td></tr>
        <tr><td>Parkeerclusters</td><td>{p.parkingClusters.length} ({p.parkingClusters.reduce((a, c) => a + c.stalls, 0)} vakken)</td></tr>
        <tr><td>Voorzieningen</td><td>{facilities(doc).length}</td></tr>
      </tbody></table>
    </div>;
  }

  if (sel.kind === 'house') {
    const h = doc.park.houses.find((x) => x.number === sel.num);
    if (!h) return <p>Huis niet gevonden</p>;
    const dh = diag?.derived.houses.find((x) => x.number === sel.num);
    const set = (fn: (x: NonNullable<typeof h>) => void) => commit((d) => { fn(d.park.houses.find((x) => x.number === sel.num)!); });
    const cur = h.frontDeg ?? dh?.frontDeg ?? h.pdfRotationDeg ?? 0;
    return <div>
      {head}
      <h3>Huis {h.number}</h3>
      <PtField label="Positie (pt)" pt={h.pt} onChange={(v) => set((x) => { x.pt = v; })} />
      <TextField label="Type (legenda)" value={h.legendType ?? ''} onChange={(v) => set((x) => { x.legendType = v || null; })} />
      <Select label="Zekerheid type" value={h.typeConfidence as 'high'} options={[['high', 'zeker (PDF-kleur)'], ['medium', 'middel'], ['low', 'onzeker'], ['reviewed', 'gecontroleerd door mens']]} onChange={(v) => set((x) => { x.typeConfidence = v; })} />
      <label className="f"><span>Huisdieren</span><input type="checkbox" checked={!!h.petsAllowed} onChange={(e) => set((x) => { x.petsAllowed = e.target.checked; })} /></label>
      <label className="f"><span>Voorkant (°)</span><span className="pair">
        <input type="number" step={5} value={h.frontDeg ?? ''} placeholder={`auto (${Math.round(cur)})`} onChange={(e) => set((x) => { x.frontDeg = e.target.value === '' ? undefined : num(e.target.value); })} />
        <button onClick={() => set((x) => { x.frontDeg = Math.round(((cur + 90) % 360) * 10) / 10; })} title="R">↻ 90°</button>
        <button onClick={() => set((x) => { delete x.frontDeg; })} disabled={h.frontDeg === undefined}>auto</button>
      </span></label>
      <NumField label="Schaal" value={h.scale} step={0.05} min={0.5} max={1.2} hint={dh ? `auto (${dh.scale})` : 'auto'} onChange={(v) => set((x) => { if (v === undefined) delete x.scale; else x.scale = v; })} />
      <label className="f"><span>Vastzetten</span><input type="checkbox" checked={!!h.locked} onChange={(e) => set((x) => { if (e.target.checked) x.locked = true; else delete x.locked; })} /></label>
      <p className="muted small">Vastgezet: de simulatie schuift dit huis niet meer weg van wegen en buren; botsingen worden dan als waarschuwing gemeld.</p>
      {dh && <table className="kv"><tbody>
        <tr><td>Door simulatie verschoven</td><td>{dh.adjustedM > 0.3 ? `${dh.adjustedM} m` : 'nee'}</td></tr>
        <tr><td>Parkeervak</td><td>{dh.stallId ?? <b className="err">geen</b>}{dh.stallDistM !== undefined ? ` (${dh.stallDistM} m)` : ''}</td></tr>
        <tr><td>Slagboom in / uit</td><td>{dh.gateIn ?? '-'} / {dh.gateOut ?? '-'}</td></tr>
      </tbody></table>}
      <div className="row"><button onClick={() => onRoute(h.number)} disabled={!diag}>Route tonen</button>{!diag && <span className="muted small">na valideren</span>}</div>
      {route?.house === h.number && <p className="small"><span className="g">━</span> naar binnen via {route.in?.gate ?? '-'} ({route.in?.lengthM ?? '?'} m) · <span className="r">┅</span> naar buiten via {route.out?.gate ?? '-'} ({route.out?.lengthM ?? '?'} m)</p>}
    </div>;
  }

  if (sel.kind === 'road' || sel.kind === 'rpt') {
    const id = sel.kind === 'road' ? sel.id : sel.road;
    const r = n.roads.find((x) => x.id === id);
    if (!r) return <p>Weg niet gevonden</p>;
    const set = (fn: (x: Road) => void) => commit((d) => { fn(d.network.roads.find((x) => x.id === id)!); });
    return <div>
      {head}
      <h3>Weg {r.id}</h3>
      <p className="muted small">Van <a onClick={() => setSel({ kind: 'node', id: r.from })}>{r.from}</a> naar <a onClick={() => setSel({ kind: 'node', id: r.to })}>{r.to}</a> · {r.pts.length} tussenpunten. Dubbelklik op de weg om een punt toe te voegen; sleep punten; Delete verwijdert het geselecteerde punt.</p>
      <TextField label="Naam" value={r.name} onChange={(v) => set((x) => { x.name = v; })} />
      <Select label="Klasse" value={r.class} options={[['public', 'openbaar'], ['arrival', 'aankomst (slagboomweg)'], ['park', 'parkweg'], ['service', 'dienstweg (alleen service)'], ['scenery', 'decor (geen verkeer)']]} onChange={(v) => set((x) => { x.class = v; })} />
      <Select label="Rijrichting" value={(r.oneway ?? 'two') as 'two'} options={[['two', 'tweerichting'], ['f' as 'two', `eenrichting ${r.from} → ${r.to}`], ['b' as 'two', `eenrichting ${r.to} → ${r.from}`]]} onChange={(v) => set((x) => { if (v === 'two') delete x.oneway; else x.oneway = v as 'f' | 'b'; })} />
      <NumField label="Snelheid (km/u)" value={r.speedKmh} step={5} min={5} max={80} onChange={(v) => v && set((x) => { x.speedKmh = v; })} />
      <NumField label="Voorrang (hoger = voorrang)" value={r.priority} step={1} min={0} max={5} onChange={(v) => v !== undefined && set((x) => { x.priority = v; })} />
      <NumField label="Rijstrook uit midden (m)" value={r.laneOffsetM} step={0.05} min={0} max={3} onChange={(v) => v !== undefined && set((x) => { x.laneOffsetM = v; })} />
      <Select label="Verharding" value={(r.surface ?? 'asphalt') as 'asphalt'} options={[['asphalt', 'asfalt'], ['pavers' as 'asphalt', 'klinkers']]} onChange={(v) => set((x) => { x.surface = v; })} />
      {sel.kind === 'rpt' && <div className="row"><button onClick={() => onSplit(r.id, sel.i)}>Splits hier (nieuwe kruising)</button></div>}
      {n.gates.filter((g) => g.road === r.id).length > 0 && <p className="small">Slagbomen op deze weg: {n.gates.filter((g) => g.road === r.id).map((g) => <a key={g.id} onClick={() => setSel({ kind: 'gate', id: g.id })}>{g.id} </a>)}</p>}
    </div>;
  }

  if (sel.kind === 'node') {
    const nd = n.nodes[sel.id];
    if (!nd) return <p>Knoop niet gevonden</p>;
    const set = (fn: (x: NonNullable<typeof nd>) => void) => commit((d) => { fn(d.network.nodes[sel.id]); });
    const roads = n.roads.filter((r) => r.from === sel.id || r.to === sel.id);
    return <div>
      {head}
      <h3>Knoop {sel.id}</h3>
      <PtField label="Positie (pt)" pt={nd.pt} onChange={(v) => set((x) => { x.pt = v; })} />
      <Select label="Soort" value={nd.kind as 'junction'} options={[['junction', 'kruising'], ['deadend' as 'junction', 'doodlopend (keerlus)'], ['portal' as 'junction', 'in-/uitgang park']]} onChange={(v) => set((x) => { x.kind = v; })} />
      {nd.kind === 'junction' && <NumField label="Kruisingsstraal (pt)" value={nd.radius} step={0.5} onChange={(v) => set((x) => { x.radius = v; })} />}
      {nd.kind === 'deadend' && <NumField label="Keerlus straal (m)" value={nd.turnRadiusM} step={0.5} onChange={(v) => set((x) => { x.turnRadiusM = v; })} />}
      {nd.kind === 'portal' && <Select label="Ingang voor" value={(nd.portal ?? 'public') as 'public'} options={[['public', 'bezoekers'], ['service' as 'public', 'alleen service']]} onChange={(v) => set((x) => { x.portal = v; })} />}
      <p className="small">Wegen: {roads.map((r) => <a key={r.id} onClick={() => setSel({ kind: 'road', id: r.id })}>{r.id} </a>)}{!roads.length && <span className="muted">geen (kan verwijderd worden)</span>}</p>
    </div>;
  }

  if (sel.kind === 'gate') {
    const g = n.gates.find((x) => x.id === sel.id);
    if (!g) return <p>Slagboom niet gevonden</p>;
    const set = (fn: (x: NonNullable<typeof g>) => void) => commit((d) => { fn(d.network.gates.find((x) => x.id === sel.id)!); });
    const dg = diag?.derived.gates.find((x) => x.id === g.id);
    return <div>
      {head}
      <h3>Slagboom {g.id}</h3>
      <p className="muted small">Sleep de stip om de stopstreep te verplaatsen. Opstelplaatsen worden na valideren getoond; passen ze niet, dan meldt de diagnose dat.</p>
      <TextField label="Label" value={g.label ?? ''} onChange={(v) => set((x) => { x.label = v; })} />
      <label className="f"><span>Personeelsslagboom</span><input type="checkbox" checked={!!g.staff} onChange={(e) => set((x) => { if (e.target.checked) x.staff = true; else delete x.staff; })} /></label>
      <p className="muted small">{g.staff ? 'Opent alleen met een personeelspas voor dienstvoertuigen; nooit voor gasten.' : 'Opent alleen met het passagetoken van een afgeronde check-in/check-out.'}</p>
      <Select label="Richting" value={g.direction} options={[['inbound', g.staff ? 'richting park' : 'inrijden (check-in)'], ['outbound', g.staff ? 'richting uitgang' : 'uitrijden (check-out)']]} onChange={(v) => set((x) => { x.direction = v; })} />
      <Select label="Weg" value={g.road} options={n.roads.map((r) => [r.id, r.id] as [string, string])} onChange={(v) => set((x) => { x.road = v; })} />
      <Select label="Rijstrook" value={g.lane} options={[['forward', 'heen (van → naar)'], ['backward', 'terug (naar → van)']]} onChange={(v) => set((x) => { x.lane = v; })} />
      <PtField label="Stopstreep (pt)" pt={g.stopPt} onChange={(v) => set((x) => { x.stopPt = v; })} />
      <NumField label="Opstelplaatsen" value={g.queueSlots} step={1} min={1} max={12} onChange={(v) => v && set((x) => { x.queueSlots = Math.round(v); })} />
      <NumField label="Afstand opstelplaatsen (m)" value={g.slotSpacingM} step={0.1} min={5.5} max={12} onChange={(v) => v && set((x) => { x.slotSpacingM = v; })} />
      <NumField label="Openen (s)" value={g.openSec} step={0.1} onChange={(v) => v && set((x) => { x.openSec = v; })} />
      <NumField label="Sluiten (s)" value={g.closeSec} step={0.1} onChange={(v) => v && set((x) => { x.closeSec = v; })} />
      <Select label="Scharnier arm" value={(g.armSide ?? 'left') as 'left'} options={[['left', 'middeneiland'], ['right' as 'left', 'wegrand']]} onChange={(v) => set((x) => { x.armSide = v; })} />
      {dg && <p className={dg.queueSlots < g.queueSlots ? 'err small' : 'small'}>Na validatie: {dg.queueSlots} van {g.queueSlots} opstelplaatsen passen.</p>}
    </div>;
  }

  if (sel.kind === 'parking') {
    const c = doc.park.parkingClusters.find((x) => x.id === sel.id);
    if (!c) return <p>Cluster niet gevonden</p>;
    const set = (fn: (x: NonNullable<typeof c>) => void) => commit((d) => { fn(d.park.parkingClusters.find((x) => x.id === sel.id)!); });
    return <div>
      {head}
      <h3>Parkeercluster {c.id}</h3>
      <p className="muted small">De simulatie plaatst de vakken langs de dichtstbijzijnde rijstrook bij dit punt. Valideer om de vakken te zien.</p>
      <PtField label="Positie (pt)" pt={c.pt} onChange={(v) => set((x) => { x.pt = v; })} />
      <NumField label="Aantal vakken" value={c.stalls} step={1} min={1} max={40} onChange={(v) => v && set((x) => { x.stalls = Math.round(v); })} />
      <TextField label="Voor huizen" value={(c.serves ?? []).join(', ')} onChange={(v) => set((x) => { x.serves = v.split(/[ ,;]+/).map(Number).filter((q) => Number.isInteger(q) && q > 0); })} />
      <p className="muted small">Vakken boven het aantal huizen worden dienstvakken (TD, schoonmaak).</p>
    </div>;
  }

  if (sel.kind === 'facility') {
    const f = facilities(doc)[sel.i];
    if (!f) return <p>Voorziening niet gevonden</p>;
    const set = (fn: (x: NonNullable<typeof f>) => void) => commit((d) => { fn(facilities(d)[sel.i]); });
    return <div>
      {head}
      <h3>Voorziening {f.key}</h3>
      <TextField label="Letter (legenda)" value={f.key} onChange={(v) => set((x) => { x.key = v.toUpperCase().slice(0, 2); })} />
      <TextField label="Naam" value={f.name ?? ''} onChange={(v) => set((x) => { x.name = v; })} />
      <PtField label="Positie (pt)" pt={f.pt} onChange={(v) => set((x) => { x.pt = v; })} />
    </div>;
  }

  if (sel.kind === 'poly' || sel.kind === 'vertex') {
    const P = polys(doc, sel.layer)[sel.i];
    const name = { water: 'Water', footpaths: 'Voetpad', roadSurfaces: 'Verharding', structures: 'Gebouw / veld' }[sel.layer];
    return <div>
      {head}
      <h3>{name} {sel.i + 1}</h3>
      <p className="muted small">{P?.length ?? 0} hoekpunten. Sleep een hoekpunt; Delete verwijdert het geselecteerde hoekpunt. Gebouwen in de projectie volgen de bouwmassa (data/map/massing_central.json), niet dit vlak.</p>
      {sel.kind === 'vertex' && P && <PtField label="Hoekpunt (pt)" pt={P[sel.v]} onChange={(v) => commit((d) => { const Q = polys(d, sel.layer)[sel.i]; Q[sel.v][0] = v[0]; Q[sel.v][1] = v[1]; })} />}
    </div>;
  }
  return null;
}
