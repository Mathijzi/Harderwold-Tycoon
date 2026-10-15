// Map editor (admin): correct house, facility, road, gate and parking positions on top of the PDF, edit road
// properties, validate with the real network build, inspect routes, keep versions and activate one.
import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { checkBundle, MapBundle, Problem, REVIEW_ITEMS } from '../../shared/mapdoc.ts';
import type { Diagnosis } from '../../sim/diagnose.ts';
import { MapView, Layers, Tool, View, RouteView } from './mapview.tsx';
import { Sel, Pt, deleteSel, dragPoint, insertRoadPoint, splitRoad, addRoad, posOf, polys, facilities, sameSel } from './model.ts';
import { Inspector } from './inspector.tsx';

const API = '/api/v1';
const store = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
  lget: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  lset: (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* quota or blocked */ } },
};
const DRAFT = 'harderwold-editor-draft';

type Version = { id: number; created_at: number; author: string; comment: string; checksum: string; parent: number | null; errors: number; warnings: number; activated_at: number | null };
type Report = {
  houses: { pdf: number; map: number; missing: number[]; extra: number[]; moved: { number: number; movedM: number }[]; typeChanged: { number: number; pdf: string | null; map: string | null }[]; confidence: Record<string, number>; uncertain: { number: number; type: string | null; confidence: string }[] };
  facilities: { pdf: number; map: number; diff: { key: string; pdf: number; map: number }[] };
  art: { type: string; houses: number; art: string }[];
  manifestWarnings: string[]; review: { done: number; total: number };
};

class HttpError extends Error { constructor(public status: number, public body: { error?: string; message?: string; problems?: Problem[] }) { super(body.message ?? `HTTP ${status}`); } }

function App() {
  const [key, setKey] = useState(store.get('adminKey') ?? '');
  const [authed, setAuthed] = useState(false);
  const [loginErr, setLoginErr] = useState('');
  const [doc, setDoc] = useState<MapBundle | null>(null);
  const [active, setActive] = useState<{ id: number; checksum: string; activatedAt: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const undo = useRef<string[]>([]), redo = useRef<string[]>([]);
  const [, bump] = useState(0);
  const [sel, setSel] = useState<Sel>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [layers, setLayers] = useState<Layers>({ pdf: true, pdfOpacity: 0.55, terrain: true, roads: true, arrows: true, nodes: true, gates: true, parking: true, houses: true, labels: true, facilities: true, diag: true });
  const [view, setView] = useState<View>({ x: 186, y: 4, w: 474, h: 396 });
  const [diag, setDiag] = useState<(Diagnosis & { diagId: string }) | null>(null);
  const [diagStale, setDiagStale] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ t: 'ok' | 'err' | 'info'; s: string } | null>(null);
  const [tab, setTab] = useState<'props' | 'diag' | 'versions' | 'report'>('props');
  const [versions, setVersions] = useState<Version[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [route, setRoute] = useState<(RouteView & { house: number; in?: { gate: string; lengthM: number; pts: Pt[] }; out?: { gate: string; lengthM: number; pts: Pt[] } }) | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [measure, setMeasure] = useState<Pt[]>([]);
  const [roadFrom, setRoadFrom] = useState<string | null>(null);
  const [filter, setFilter] = useState<'error' | 'warn' | 'info'>('warn');
  const [search, setSearch] = useState('');
  const [draftOffer, setDraftOffer] = useState<string | null>(null);
  const working = useRef<MapBundle | null>(null);

  const api = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const r = await fetch(API + path, { ...init, headers: { 'X-Admin-Key': key, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new HttpError(r.status, body);
    return body as T;
  }, [key]);
  const fail = (e: unknown) => { const h = e as HttpError; setMsg({ t: 'err', s: h.body?.problems?.length ? `${h.message}: ${h.body.problems.slice(0, 3).map((p) => p.msg).join(' · ')}` : String(h.message ?? e) }); };

  const load = useCallback(async () => {
    const m = await api<MapBundle & { activeVersion: typeof active }>('/admin/map');
    const { activeVersion, ...b } = m as MapBundle & { activeVersion: typeof active; reviewItems?: unknown };
    delete (b as { reviewItems?: unknown }).reviewItems;
    setDoc(b); setActive(activeVersion); setDirty(false); undo.current = []; redo.current = []; setDiag(null); setRoute(null);
    const draft = store.lget(DRAFT);
    if (draft) setDraftOffer(draft);
  }, [api]);
  const login = async (e?: React.FormEvent) => {
    e?.preventDefault();
    try { await load(); store.set('adminKey', key); setAuthed(true); setLoginErr(''); refreshVersions(); }
    catch (er) { setLoginErr((er as HttpError).status === 403 ? 'Ongeldige admin-sleutel' : (er as Error).message); }
  };
  useEffect(() => { if (key) void login(); /* eslint-disable-next-line */ }, []);
  const refreshVersions = () => { api<Version[]>('/admin/map/versions').then(setVersions).catch(() => {}); };

  // ------------------------------------------------------------ editing with undo
  const snapshot = () => JSON.stringify(doc);
  const changed = (d: MapBundle) => { setDoc(d); setDirty(true); setDiagStale(true); setRoute(null); store.lset(DRAFT, JSON.stringify(d)); };
  const commit = (fn: (d: MapBundle) => string | void) => {
    if (!doc) return;
    const before = snapshot(), d = structuredClone(doc), err = fn(d);
    if (typeof err === 'string') { setMsg({ t: 'err', s: err }); return; }
    undo.current.push(before); if (undo.current.length > 80) undo.current.shift(); redo.current = [];
    changed(d);
  };
  const doUndo = () => { const s = undo.current.pop(); if (!s || !doc) return; redo.current.push(snapshot()); changed(JSON.parse(s)); bump((x) => x + 1); };
  const doRedo = () => { const s = redo.current.pop(); if (!s || !doc) return; undo.current.push(snapshot()); changed(JSON.parse(s)); bump((x) => x + 1); };

  const closedPoly = useRef(false);
  const onDragStart = (s: Sel) => {
    if (!doc) return;
    undo.current.push(snapshot()); redo.current = []; working.current = structuredClone(doc);
    const P = s?.kind === 'vertex' ? polys(doc, s.layer)[s.i] : null;
    closedPoly.current = !!P && P.length > 1 && P[0][0] === P[P.length - 1][0] && P[0][1] === P[P.length - 1][1];
  };
  const onDrag = (s: Sel, p: Pt) => {
    const w = working.current; if (!w) return;
    const q = dragPoint(w, s); if (!q) return;
    q[0] = p[0]; q[1] = p[1];
    if (s?.kind === 'vertex' && s.v === 0 && closedPoly.current) { const P = polys(w, s.layer)[s.i]; P[P.length - 1] = [p[0], p[1]]; }
    setDoc({ ...w });
  };
  const onDragEnd = () => { if (working.current) changed({ ...working.current }); working.current = null; };

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,select,textarea')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (sel) { commit((d) => deleteSel(d, sel) ?? undefined); setSel(null); } }
      else if (e.key === 'Escape') { setSel(null); setTool('select'); setRoadFrom(null); setMeasure([]); }
      else if (e.key.toLowerCase() === 'r' && sel?.kind === 'house') {
        commit((d) => { const h = d.park.houses.find((x) => x.number === sel.num)!; const cur = h.frontDeg ?? diag?.derived.houses.find((x) => x.number === sel.num)?.frontDeg ?? h.pdfRotationDeg ?? 0; h.frontDeg = Math.round(((cur + (e.shiftKey ? -90 : 90)) % 360) * 10) / 10; });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // ------------------------------------------------------------ server actions
  const validate = async () => {
    if (!doc) return;
    setBusy('Valideren: het wegennet wordt volledig opgebouwd ...');
    try { const d = await api<Diagnosis & { diagId: string }>('/admin/map/validate', { method: 'POST', body: JSON.stringify({ bundle: doc }) }); setDiag(d); setDiagStale(false); setTab('diag'); setMsg({ t: d.ok ? 'ok' : 'err', s: d.ok ? `Geen fouten (${d.problems.filter((p) => p.level === 'warn').length} waarschuwingen)` : `${d.problems.filter((p) => p.level === 'error').length} fouten gevonden` }); }
    catch (e) { fail(e); } finally { setBusy(''); }
  };
  const showRoute = async (house: number) => {
    if (!diag || diagStale) { setMsg({ t: 'info', s: 'Valideer eerst de kaart; daarna kun je routes bekijken' }); return; }
    try { setRoute(await api(`/admin/map/route/${diag.diagId}/${house}`)); } catch (e) { fail(e); }
  };
  const saveVersion = async () => {
    if (!doc) return;
    const comment = prompt('Omschrijving van deze versie (wat is er veranderd?)', '');
    if (comment === null) return;
    setBusy('Opslaan ...');
    try {
      const v = await api<Version>('/admin/map/versions', { method: 'POST', body: JSON.stringify({ bundle: doc, comment }) });
      setDoc({ ...doc, parentVersion: v.id }); setDirty(false); store.lset(DRAFT, null); refreshVersions();
      setMsg({ t: 'ok', s: `Versie ${v.id} opgeslagen${v.warnings ? ` (${v.warnings} waarschuwingen)` : ''}. Nog niet actief: activeer hem bij Versies.` });
    } catch (e) { fail(e); } finally { setBusy(''); }
  };
  const openVersion = async (id: number) => {
    if (dirty && !confirm('Niet-opgeslagen wijzigingen gaan verloren. Doorgaan?')) return;
    try { const b = await api<MapBundle>(`/admin/map/versions/${id}`); b.parentVersion = id; setDoc(b); setDirty(false); undo.current = []; redo.current = []; setDiag(null); setSel(null); setMsg({ t: 'info', s: `Versie ${id} geopend in de editor` }); } catch (e) { fail(e); }
  };
  const activate = async (id: number) => {
    if (!confirm(`Versie ${id} activeren?\n\nDe kaart wordt eerst volledig gevalideerd. Daarna wordt het spel op de nieuwe kaart herstart: alle punten, opdrachten en voertuigen beginnen opnieuw. De projectie laadt automatisch opnieuw.`)) return;
    setBusy(`Versie ${id} valideren en activeren ...`);
    try { await api(`/admin/map/versions/${id}/activate`, { method: 'POST', body: JSON.stringify({ confirm: true }) }); await load(); refreshVersions(); setMsg({ t: 'ok', s: `Versie ${id} is actief; het spel is herstart op de nieuwe kaart` }); }
    catch (e) { fail(e); } finally { setBusy(''); }
  };
  const exportDoc = () => {
    if (!doc) return;
    const b = { ...doc, savedAt: new Date().toISOString() };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(b, null, 1)], { type: 'application/json' }));
    a.download = `harderwold-kaart-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const importDoc = (f: File) => {
    f.text().then((t) => {
      let b: MapBundle;
      try { b = JSON.parse(t); } catch { setMsg({ t: 'err', s: 'Dit bestand is geen geldige JSON' }); return; }
      const errs = checkBundle(b).filter((p) => p.level === 'error');
      if (errs.length) { setMsg({ t: 'err', s: `Import geweigerd: ${errs.slice(0, 3).map((p) => p.msg).join(' · ')}` }); return; }
      if (dirty && !confirm('Niet-opgeslagen wijzigingen gaan verloren. Importeren?')) return;
      undo.current.push(snapshot()); b.review ??= {}; changed(b); setSel(null); setMsg({ t: 'ok', s: `Geïmporteerd: ${b.park.houses.length} huizen, ${b.network.roads.length} wegen. Sla op als versie om te bewaren.` });
    });
  };
  const loadReport = async () => {
    try { setReport(await api<Report>('/admin/map/report', { method: 'POST', body: JSON.stringify({ bundle: doc }) })); } catch (e) { fail(e); }
  };
  useEffect(() => { if (tab === 'versions') refreshVersions(); if (tab === 'report' && doc) void loadReport(); /* eslint-disable-next-line */ }, [tab]);

  const focus = (s: Sel) => {
    if (!doc) return;
    setSel(s);
    const at = posOf(doc, s); if (!at) return;
    const w = Math.min(view.w, 80);
    setView({ x: at[0] - w / 2, y: at[1] - (w * view.h / view.w) / 2, w, h: w * view.h / view.w });
  };
  const doSearch = (e: React.FormEvent) => {
    e.preventDefault(); if (!doc) return;
    const q = search.trim(); if (!q) return;
    setTab('props');
    if (/^\d+$/.test(q) && doc.park.houses.some((h) => h.number === Number(q))) return focus({ kind: 'house', num: Number(q) });
    if (doc.network.gates.some((g) => g.id === q)) return focus({ kind: 'gate', id: q });
    if (doc.network.roads.some((r) => r.id === q)) return focus({ kind: 'road', id: q });
    if (doc.network.nodes[q]) return focus({ kind: 'node', id: q });
    if (doc.park.parkingClusters.some((c) => c.id === q)) return focus({ kind: 'parking', id: q });
    const fi = facilities(doc).findIndex((f) => f.key.toLowerCase() === q.toLowerCase() || (f.name ?? '').toLowerCase().includes(q.toLowerCase()));
    if (fi >= 0) return focus({ kind: 'facility', i: fi });
    setMsg({ t: 'err', s: `Niets gevonden voor "${q}"` });
  };
  const problemSel = (p: Problem): Sel => !p.ref ? null : p.ref.kind === 'house' ? { kind: 'house', num: Number(p.ref.id) } : p.ref.kind === 'gate' ? { kind: 'gate', id: p.ref.id } : p.ref.kind === 'road' ? { kind: 'road', id: p.ref.id } : p.ref.kind === 'node' ? { kind: 'node', id: p.ref.id } : p.ref.kind === 'parking' ? { kind: 'parking', id: p.ref.id } : null;

  const localProblems = useMemo(() => (doc ? checkBundle(doc) : []), [doc]);
  const counts = useMemo(() => ({ error: diag?.problems.filter((p) => p.level === 'error').length ?? 0, warn: diag?.problems.filter((p) => p.level === 'warn').length ?? 0, info: diag?.problems.filter((p) => p.level === 'info').length ?? 0 }), [diag]);

  if (!authed) return (
    <form className="login" onSubmit={login}>
      <h1>Kaarteditor</h1>
      <p className="muted">Alleen voor de spelleider. Vul de admin-sleutel in.</p>
      <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Admin-sleutel" autoFocus />
      <button className="go">Openen</button>
      {loginErr && <p className="err">{loginErr}</p>}
    </form>
  );
  if (!doc) return <p className="pad">Kaart laden ...</p>;

  const toolBtn = (t: Tool, label: string, title: string) => <button className={tool === t ? 'sel' : ''} title={title} onClick={() => { setTool(t); setRoadFrom(null); setMeasure([]); }}>{label}</button>;
  const L = (k: keyof Layers, label: string) => <label key={k}><input type="checkbox" checked={!!layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} /> {label}</label>;

  return (
    <div className="app">
      <header>
        <strong>Kaarteditor</strong>
        <span className="muted">{active ? `actief: versie ${active.id}` : 'actief: bestanden in data/map'}{doc.parentVersion ? ` · bewerkt vanaf versie ${doc.parentVersion}` : ''}{dirty ? ' · niet opgeslagen' : ''}</span>
        <div className="grp">
          {toolBtn('select', 'Selecteren / slepen', 'Klik om te selecteren, sleep om te verplaatsen. Dubbelklik op een weg voegt een punt toe.')}
          {toolBtn('addRoad', 'Weg toevoegen', 'Klik op twee knopen om ze met een nieuwe weg te verbinden')}
          {toolBtn('editPoly', 'Vlakken', 'Water, paden, verharding en gebouwen selecteren en hoekpunten slepen')}
          {toolBtn('measure', 'Meten', 'Klik twee punten: afstand in meters (controle van de schaal)')}
        </div>
        <div className="grp">
          <button onClick={doUndo} disabled={!undo.current.length} title="Ctrl+Z">Ongedaan</button>
          <button onClick={doRedo} disabled={!redo.current.length} title="Ctrl+Shift+Z">Opnieuw</button>
        </div>
        <form className="grp" onSubmit={doSearch}><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Zoek huis, weg, slagboom ..." /></form>
        <div className="grp">
          <button className="go" onClick={validate} disabled={!!busy}>Valideren</button>
          <button onClick={saveVersion} disabled={!!busy || localProblems.some((p) => p.level === 'error')}>Opslaan als versie</button>
        </div>
      </header>
      {draftOffer && <div className="bar info">Er staat een niet-opgeslagen concept in deze browser. <button onClick={() => { try { const b = JSON.parse(draftOffer); undo.current.push(snapshot()); changed(b); } catch { /* ignore */ } setDraftOffer(null); }}>Concept herstellen</button> <button onClick={() => { store.lset(DRAFT, null); setDraftOffer(null); }}>Weggooien</button></div>}
      {(busy || msg) && <div className={`bar ${busy ? 'info' : msg!.t}`}>{busy || msg!.s} {!busy && <button className="x" onClick={() => setMsg(null)}>×</button>}</div>}
      <main>
        <aside className="layers">
          <h3>Lagen</h3>
          {L('pdf', 'PDF-plattegrond')}
          <input type="range" min={0} max={1} step={0.05} value={layers.pdfOpacity} onChange={(e) => setLayers({ ...layers, pdfOpacity: Number(e.target.value) })} />
          {L('terrain', 'Terrein en gebouwen')}{L('roads', 'Wegen')}{L('arrows', 'Rijrichtingen')}{L('nodes', 'Knopen')}{L('gates', 'Slagbomen')}{L('parking', 'Parkeren')}{L('houses', 'Huizen')}{L('labels', 'Huisnummers')}{L('facilities', 'Voorzieningen')}{L('diag', 'Diagnose')}
          <h3>Legenda</h3>
          <div className="leg"><i style={{ background: '#2f8f4e' }} /> type zeker</div>
          <div className="leg"><i style={{ background: '#d08a12' }} /> type middel</div>
          <div className="leg"><i style={{ background: '#cf3a2b' }} /> type onzeker</div>
          <div className="leg"><i style={{ background: '#2c6fcf' }} /> type gecontroleerd</div>
          <div className="leg"><i className="dash" /> huis vastgezet</div>
          <div className="leg"><i style={{ background: '#7a2fb5' }} /> eenrichting</div>
          <div className="leg"><i style={{ background: '#c07a1d' }} /> dienstweg</div>
          <div className="leg"><i style={{ background: '#e0457b' }} /> verschoven door simulatie</div>
          <p className="muted small">Wiel: zoomen · slepen op de achtergrond: schuiven · Delete: verwijderen · R: huis 90° draaien · Esc: annuleren</p>
        </aside>
        <div className="mapwrap">
          <MapView doc={doc} layers={layers} tool={tool} sel={sel} diag={diagStale ? null : diag} route={route} view={view} setView={setView}
            onSelect={(s) => { setSel(s); if (s) setTab('props'); }} onDragStart={onDragStart} onDrag={onDrag} onDragEnd={onDragEnd}
            onRoadDouble={(road, p) => { let i = 0; commit((d) => { i = insertRoadPoint(d, road, p); }); setSel({ kind: 'rpt', road, i }); }}
            roadFrom={roadFrom} onNodeForRoad={(n) => {
              if (!roadFrom) { setRoadFrom(n); setMsg({ t: 'info', s: `Van ${n}: klik nu de tweede knoop` }); return; }
              if (n === roadFrom) return;
              let id = ''; commit((d) => { id = addRoad(d, roadFrom, n); }); setRoadFrom(null); setTool('select'); setSel({ kind: 'road', id }); setMsg({ t: 'ok', s: `Weg ${id} toegevoegd; stel klasse en richting in` });
            }}
            onCursor={setCursor} measure={measure} setMeasure={setMeasure} />
          <div className="status">{cursor ? `${cursor[0].toFixed(1)}, ${cursor[1].toFixed(1)} pt  ·  ${((cursor[0] - doc.park.originPt[0]) * doc.park.metersPerPt).toFixed(1)}, ${((cursor[1] - doc.park.originPt[1]) * doc.park.metersPerPt).toFixed(1)} m` : ''}{diagStale && diag ? '  ·  diagnose verouderd: valideer opnieuw' : ''}</div>
        </div>
        <section className="panel">
          <nav>
            {(['props', 'diag', 'versions', 'report'] as const).map((t) => <button key={t} className={tab === t ? 'sel' : ''} onClick={() => setTab(t)}>{{ props: 'Eigenschappen', diag: `Diagnose${diag ? ` (${counts.error}/${counts.warn})` : ''}`, versions: 'Versies', report: 'Rapport' }[t]}</button>)}
          </nav>
          <div className="body">
            {tab === 'props' && <Inspector doc={doc} sel={sel} diag={diagStale ? null : diag} commit={commit} setSel={setSel} onRoute={showRoute} route={route}
              onSplit={(road, i) => { let nid = ''; commit((d) => { nid = splitRoad(d, road, i); }); setSel({ kind: 'node', id: nid }); }} localProblems={localProblems} />}
            {tab === 'diag' && <div>
              {!diag && <p className="muted">Klik op <b>Valideren</b>. De server bouwt dan het volledige wegennet uit deze kaart (zoals de simulatie dat doet) en meldt fouten: huizen zonder parkeervak of route, opstelplaatsen die niet passen, huizen die de simulatie moest verschuiven.</p>}
              {diag && <>
                {diagStale && <p className="warn">Je hebt daarna nog iets gewijzigd: valideer opnieuw.</p>}
                <table className="kv"><tbody>
                  <tr><td>Huizen</td><td>{diag.summary.houses} ({diag.summary.housesWithStall} met parkeervak)</td></tr>
                  <tr><td>Parkeervakken</td><td>{diag.summary.stalls}</td></tr>
                  <tr><td>Zonder route</td><td className={diag.summary.unreachable ? 'err' : ''}>{diag.summary.unreachable}</td></tr>
                  <tr><td>Verschoven door simulatie</td><td>{diag.summary.adjustedHouses}</td></tr>
                  <tr><td>Vak &gt; 35 m van huis</td><td>{diag.summary.farStalls}</td></tr>
                  <tr><td>Slagboomgebruik</td><td>{Object.entries(diag.summary.gateUse).map(([g, n]) => `${g}: ${n}`).join(' · ')}</td></tr>
                  <tr><td>Bouwtijd</td><td>{(diag.summary.buildMs / 1000).toFixed(1)} s</td></tr>
                </tbody></table>
                <div className="chips">
                  {(['error', 'warn', 'info'] as const).map((l) => <button key={l} className={filter === l ? 'sel' : ''} onClick={() => setFilter(l)}>{{ error: 'Fouten', warn: 'Waarschuwingen', info: 'Info' }[l]} ({counts[l]})</button>)}
                </div>
                <ul className="problems">
                  {diag.problems.filter((p) => p.level === filter).map((p, i) => <li key={i} className={p.level} onClick={() => { const s = problemSel(p); if (s) focus(s); }}>{p.msg}</li>)}
                </ul>
              </>}
            </div>}
            {tab === 'versions' && <div>
              <div className="row">
                <button onClick={exportDoc}>Exporteren (JSON)</button>
                <label className="btn">Importeren<input type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importDoc(f); e.target.value = ''; }} /></label>
                <button onClick={() => { if (!dirty || confirm('Niet-opgeslagen wijzigingen gaan verloren. De actieve kaart opnieuw laden?')) void load(); }}>Actieve kaart laden</button>
              </div>
              <p className="muted small">Opslaan bewaart een versie op de server (met omschrijving). <b>Activeren</b> valideert de versie volledig, schrijft hem naar <code>data/map</code> en herstart het spel op die kaart.</p>
              <table className="versions"><thead><tr><th>#</th><th>Datum</th><th>Omschrijving</th><th></th></tr></thead><tbody>
                {versions.map((v) => <tr key={v.id} className={active?.id === v.id ? 'act' : ''}>
                  <td>{v.id}</td><td>{new Date(v.created_at).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td>{v.comment || <span className="muted">(geen)</span>}{v.warnings ? <span className="muted"> · {v.warnings} waarsch.</span> : null}{active?.id === v.id ? <b> · actief</b> : null}</td>
                  <td className="nowrap"><button onClick={() => openVersion(v.id)}>Openen</button> <button onClick={() => activate(v.id)} disabled={!!busy}>Activeren</button></td>
                </tr>)}
                {!versions.length && <tr><td colSpan={4} className="muted">Nog geen versies opgeslagen.</td></tr>}
              </tbody></table>
            </div>}
            {tab === 'report' && <div>
              <h3>Controlelijst <span className="muted">({REVIEW_ITEMS.filter((r) => doc.review?.[r.id]).length}/{REVIEW_ITEMS.length})</span></h3>
              {REVIEW_ITEMS.map((r) => <label key={r.id} className="check"><input type="checkbox" checked={!!doc.review?.[r.id]} onChange={(e) => commit((d) => { d.review = { ...(d.review ?? {}), [r.id]: e.target.checked }; })} /> {r.label}</label>)}
              <p className="muted small">De controlelijst wordt met de kaartversie opgeslagen. Automatische extractie is nooit perfect: vink een punt pas af als je het zelf hebt nagekeken.</p>
              <h3>Volledigheid <button className="mini" onClick={loadReport}>vernieuwen</button></h3>
              {!report && <p className="muted">Laden ...</p>}
              {report && <>
                <table className="kv"><tbody>
                  <tr><td>Huizen PDF / kaart</td><td>{report.houses.pdf} / {report.houses.map}</td></tr>
                  <tr><td>Ontbrekend</td><td className={report.houses.missing.length ? 'err' : ''}>{report.houses.missing.join(', ') || 'geen'}</td></tr>
                  <tr><td>Niet in PDF</td><td className={report.houses.extra.length ? 'err' : ''}>{report.houses.extra.join(', ') || 'geen'}</td></tr>
                  <tr><td>Typezekerheid</td><td>{Object.entries(report.houses.confidence).filter(([, n]) => n).map(([c, n]) => `${{ high: 'zeker', medium: 'middel', low: 'onzeker', reviewed: 'gecontroleerd', other: 'overig' }[c] ?? c}: ${n}`).join(' · ')}</td></tr>
                  <tr><td>Voorzieningen PDF / kaart</td><td>{report.facilities.pdf} / {report.facilities.map}{report.facilities.diff.length ? ` (verschil: ${report.facilities.diff.map((f) => `${f.key} ${f.pdf}→${f.map}`).join(', ')})` : ''}</td></tr>
                </tbody></table>
                <h4>Huizen met onzeker type ({report.houses.uncertain.length})</h4>
                <div className="chips">{report.houses.uncertain.map((h) => <button key={h.number} className={`mini c-${h.confidence}`} onClick={() => focus({ kind: 'house', num: h.number })}>{h.number} {h.type}</button>)}</div>
                {report.houses.moved.length > 0 && <><h4>Met de hand verplaatst t.o.v. de PDF ({report.houses.moved.length})</h4>
                  <div className="chips">{report.houses.moved.map((h) => <button key={h.number} className="mini" onClick={() => focus({ kind: 'house', num: h.number })}>{h.number}: {h.movedM} m</button>)}</div></>}
                {report.houses.typeChanged.length > 0 && <><h4>Type gewijzigd ({report.houses.typeChanged.length})</h4>
                  <div className="chips">{report.houses.typeChanged.map((h) => <button key={h.number} className="mini" onClick={() => focus({ kind: 'house', num: h.number })}>{h.number}: {h.pdf ?? '?'} → {h.map ?? '?'}</button>)}</div></>}
                <h4>Art per huistype</h4>
                <table className="kv"><tbody>{report.art.map((a) => <tr key={a.type}><td>{a.type}</td><td>{a.houses} huizen · {a.art}</td></tr>)}</tbody></table>
                <p className="muted small">Eigen sprites (transparante PNG/WebP) per type in <code>public/assets/sprites/&lt;type&gt;.png</code> worden hier herkend; de projectie gebruikt ze nog niet (volgt).</p>
              </>}
            </div>}
          </div>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
void sameSel;
