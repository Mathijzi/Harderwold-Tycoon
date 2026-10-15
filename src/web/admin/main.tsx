// Game Master dashboard (/admin): park overview, scores with audit, configuration, own content (names, cameo
// guests, own tasks), logs and export. Uses the admin API only and polls (no extra SSE connection: the projector
// is the only live client, see HANDOFF).
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

const API = '/api/v1';
type Tab = 'overzicht' | 'spellen' | 'spelers' | 'instellingen' | 'namen' | 'opdrachten' | 'logboek' | 'export';
const TABS: [Tab, string][] = [['overzicht', 'Overzicht'], ['spellen', 'Spellen'], ['spelers', 'Spelers & scores'], ['instellingen', 'Instellingen'], ['namen', 'Gasten & namen'], ['opdrachten', 'Eigen opdrachten'], ['logboek', 'Logboek'], ['export', 'Export']];
const pct = (v: number | undefined) => `${Math.round((v ?? 0) * 100)}%`;
const time = (ms: number) => new Date(ms).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function useLocal<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : init; } catch { return init; } });
  return [v, (nv: T) => { setV(nv); try { localStorage.setItem(key, JSON.stringify(nv)); } catch { /* ignore */ } }];
}

let ADMIN_KEY = '';
async function api(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_KEY }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data: any = null; try { data = await r.json(); } catch { /* empty */ }
    return { ok: r.ok, status: r.status, data };
  } catch { return { ok: false, status: 0, data: { message: 'Server reageert niet' } }; }
}
const errText = (d: any) => [d?.message, ...(d?.problems ?? [])].filter(Boolean).join(' · ') || 'Onbekende fout';

function download(name: string, text: string, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function toCsv(rows: any[]) {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\n'); // ; and BOM: opens directly in Dutch Excel
}

function App() {
  const [key, setKey] = useLocal('hw.adminKey', 'gm-harderwold');
  ADMIN_KEY = key;
  const [tab, setTab] = useLocal<Tab>('hw.adminTab', 'overzicht');
  const [state, setState] = useState<any>(null);
  const [authErr, setAuthErr] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const flash = (ok: boolean, text: string) => { setMsg({ ok, text }); setTimeout(() => setMsg(null), 6000); };

  async function refresh() {
    const r = await api('GET', '/admin/state');
    if (r.ok) { setState(r.data); setAuthErr(''); } else setAuthErr(r.status === 401 || r.status === 403 ? 'Admin-sleutel klopt niet' : errText(r.data));
  }
  useEffect(() => { refresh(); const i = setInterval(() => { if (!document.hidden) refresh(); }, 4000); return () => clearInterval(i); }, [key]);

  const ctx = { state, refresh, flash };
  return (
    <div className="wrap">
      <header>
        <h1>Game Master{state?.park?.gameName ? ` · ${state.park.gameName}` : ''}</h1>
        <a href="/">Projectie</a> <a href="/test">Testinterface</a> <a href="/editor">Kaarteditor</a> <a href="/docs">API</a>
        <ThemeButton />
        <span className="inline" style={{ minWidth: 280 }}><label>Admin-sleutel</label><input type="password" value={key} onChange={(e) => setKey(e.target.value)} /></span>
      </header>
      {authErr && <p className="warn">{authErr}</p>}
      {msg && <p className={msg.ok ? 'tdok' : 'warn'}>{msg.text}</p>}
      <nav className="tabs">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'sel' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
      {state && tab === 'overzicht' && <Overview {...ctx} />}
      {state && tab === 'spellen' && <Games {...ctx} />}
      {state && tab === 'spelers' && <Players {...ctx} />}
      {state && tab === 'instellingen' && <Settings {...ctx} />}
      {state && tab === 'namen' && <Names {...ctx} />}
      {state && tab === 'opdrachten' && <OwnTasks {...ctx} />}
      {state && tab === 'logboek' && <Logs />}
      {state && tab === 'export' && <Export {...ctx} />}
    </div>
  );
}
type Ctx = { state: any; refresh: () => void; flash: (ok: boolean, t: string) => void };

/** light / dark / follow the system; remembered per browser */
function ThemeButton() {
  const order = ['system', 'light', 'dark'] as const;
  const names = { system: '◐ Systeem', light: '☀ Licht', dark: '☾ Donker' };
  const [mode, setMode] = useState<typeof order[number]>(() => { try { const t = localStorage.getItem('hw.theme'); return t === 'light' || t === 'dark' ? t : 'system'; } catch { return 'system'; } });
  useEffect(() => {
    const el = document.documentElement;
    if (mode === 'system') delete el.dataset.theme; else el.dataset.theme = mode;
    try { if (mode === 'system') localStorage.removeItem('hw.theme'); else localStorage.setItem('hw.theme', mode); } catch { /* private mode */ }
  }, [mode]);
  return <button className="theme" style={{ marginLeft: 'auto' }} title="Weergave: systeem, licht of donker" onClick={() => setMode(order[(order.indexOf(mode) + 1) % order.length])}>{names[mode]}</button>;
}

// ---------------------------------------------------------------- overview
function Overview({ state }: Ctx) {
  const p = state.park, h = p.health ?? {};
  const [stories, setStories] = useState<any[]>([]);
  useEffect(() => { api('GET', '/stories').then((r) => r.ok && setStories(r.data)); }, [state]);
  const present = state.bookings.filter((b: any) => b.status === 'in_house' || b.status === 'parked').length;
  const open = state.tasks.filter((t: any) => t.state === 'offered' || t.state === 'claimed');
  return (
    <div>
      <div className="kpis">
        <div className="kpi">Speltijd<b>{new Date(p.gameMs).toLocaleString('nl-NL', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</b><span className="muted">{p.timeScale}x{p.paused ? ' · gepauzeerd' : ''}</span></div>
        <div className="kpi">Tevredenheid<b>{pct(p.satisfaction)}</b></div>
        <div className="kpi">Gezondheid park<b>{pct(h.overall)}</b>
          {(['tech', 'clean', 'mood'] as const).map((k) => <div key={k} className="muted" style={{ fontSize: 12 }}>{({ tech: 'Techniek', clean: 'Schoon', mood: 'Stemming' })[k]} {pct(h[k])}<div className="bar"><i style={{ width: pct(h[k]) }} /></div></div>)}
        </div>
        <div className="kpi">Open opdrachten<b>{p.openTasks}</b></div>
        <div className="kpi">Gasten in het park<b>{present}</b><span className="muted">huishoudens</span></div>
        <div className="kpi">Voertuigen<b>{p.vehicles}</b><span className="muted">{p.bufferedArrivals} buiten beeld</span></div>
      </div>
      <div className="grid2">
        <div className="panel"><h2>Crises ({p.crises.length})</h2>{p.crises.length ? p.crises.map((c: any) => <div key={c.id} style={{ marginBottom: 6 }}><b>{c.title}</b> · fase {c.stage + 1}/{c.stages} · {c.done}/{c.total} meldingen klaar{c.open ? `, ${c.open} open` : ''}<div className="muted">Nu: {c.current}{c.nextAt ? ` · volgende melding over ~${Math.max(1, Math.round((c.nextAt - p.gameMs) / 60000))} min` : ''}</div></div>) : <p className="muted">Geen lopende crises.</p>}
          <h2 style={{ marginTop: 12 }}>Verhaallijnen ({stories.length})</h2>{stories.length ? stories.map((s) => <div key={s.id}><b>{s.title}</b> · bungalow {s.houseNumber} · deel {s.chapter}/{s.chapters}</div>) : <p className="muted">Geen lopende verhaallijnen.</p>}</div>
        <div className="panel"><h2>Open opdrachten</h2><table><tbody>{open.map((t: any) => (
          <tr key={t.id}><td>{t.title}</td><td>{t.category}</td><td>{t.state === 'claimed' ? t.assignedPlayerName : 'open'}</td><td className="num">{t.points}</td>
            <td>{t.kind === 'incident' && <button onClick={async () => { const reason = prompt('Reden van annuleren (komt in het logboek):'); if (reason) { await api('POST', `/admin/tasks/${t.id}/cancel`, { reason }); } }}>Annuleer</button>}</td></tr>))}</tbody></table></div>
      </div>
      <div className="panel" style={{ marginTop: 12 }}><h2>Slechtste plekken</h2>
        {!state.worst?.length ? <p className="muted">Alles in goede staat (80% of meer).</p> : <table><tbody>{state.worst.map((w: any) => (
          <tr key={w.id}><td><b>{w.name}</b></td><td className="num" style={{ color: w.cond < 0.45 ? 'var(--bad)' : w.cond < 0.65 ? 'var(--warn)' : undefined }}><b>{pct(w.cond)}</b></td><td className="muted">techniek {pct(w.tech)} · schoon {pct(w.clean)} · stemming {pct(w.mood)}</td></tr>))}</tbody></table>}
        <p className="muted">Gezondheid = gemiddelde van techniek, schoonmaak en stemming. Opdrachten afronden verbetert een plek, verlopen opdrachten maken hem slechter. Op de projectie krijgt een bungalow onder 65% een oranje en onder 45% een rood label.</p>
      </div>
      <div className="panel" style={{ marginTop: 12 }}><h2>Slagbomen</h2>{p.gates.map((g: any) => <span key={g.id} style={{ marginRight: 14 }}><code>{g.id}</code> <span className={`ph ${g.phase}`}>{g.phase}</span> {g.queue} wachtend</span>)}</div>
    </div>
  );
}

// ---------------------------------------------------------------- games: new / save / load
function Games({ state, refresh, flash }: Ctx) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [saveName, setSaveName] = useState('');
  const localIso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [nw, setNw] = useState({ name: '', code: '', demoPlayers: false, initialOccupied: 40, planned: true, endsAt: localIso(new Date(Date.now() + 3 * 3600000)), arrivals: 60, departures: 40 });
  const load = () => api('GET', '/admin/games').then((r) => r.ok && setData(r.data));
  useEffect(() => { load(); }, []);
  const run = async (fn: () => Promise<{ ok: boolean; data: any }>, okText: string) => {
    setBusy(true); const r = await fn(); setBusy(false);
    if (r.ok) { flash(true, okText); refresh(); load(); } else flash(false, errText(r.data));
    return r.ok;
  };
  const stamp = (ms: number) => new Date(ms).toLocaleString('nl-NL', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    let file: any; try { file = JSON.parse(await f.text()); } catch { flash(false, 'Dit bestand is geen opgeslagen spel'); return; }
    await run(() => api('POST', '/admin/games/import', { file, name: f.name.replace(/\.json$/i, '') }), 'Spel toegevoegd aan de lijst. Kies "Laden" om het te spelen.');
  }
  async function downloadSave(id: string, name: string) {
    const r = await api('GET', `/admin/games/${id}/file`);
    if (r.ok) download(`harderwold-spel-${name.replace(/[^\w-]+/g, '_')}.json`, JSON.stringify(r.data)); else flash(false, errText(r.data));
  }
  if (!data) return <p className="muted">Laden…</p>;
  return (
    <div>
      <div className="grid" style={{ marginTop: 0 }}>
        <div className="panel tall">
          <h2>Huidig spel</h2>
          {state.park.session && (() => { const ss = state.park.session; return (
            <div className="kpi" style={{ marginBottom: 10 }}>Sessie {ss.ended ? <b>afgelopen</b> : <b>tot {new Date(ss.endMs).toLocaleString('nl-NL', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</b>}
              <span className="muted">inchecks {ss.arrivalsTotal - ss.arrivalsLeft}/{ss.arrivalsTotal} · uitchecks {ss.departuresTotal - ss.departuresLeft}/{ss.departuresTotal}</span>
              <div className="bar"><i style={{ width: `${Math.min(100, Math.max(0, ((state.park.gameMs - ss.startMs) / (ss.endMs - ss.startMs)) * 100))}%` }} /></div></div>); })()}
          <div className="form"><label>Naam</label><b>{data.current.name}</b><label>Spelcode</label><b style={{ fontSize: 20, letterSpacing: 2 }}>{data.current.code}</b></div>
          <p className="muted">Spelers melden zich aan met deze spelcode en een eigen naam. Het spel wordt elke paar seconden automatisch bewaard, ook als de server herstart.</p>
          <h3>Opslaan als…</h3>
          <div className="inline"><input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="bijv. Teamuitje dinsdag, na ronde 1" /><button className="go" disabled={busy || saveName.trim().length < 2} onClick={async () => { if (await run(() => api('POST', '/admin/games/save', { name: saveName }), 'Spel opgeslagen')) setSaveName(''); }}>Opslaan</button></div>
        </div>
        <div className="panel tall">
          <h2>Nieuw spel starten</h2>
          <div className="form">
            <label>Naam</label><input value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} placeholder="bijv. Teamuitje Hilversum" />
            <label>Spelcode</label><input value={nw.code} onChange={(e) => setNw({ ...nw, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} placeholder="4-12 letters/cijfers, bijv. ZOMER25" />
            <label>Al op het park</label><span className="inline" style={{ margin: 0 }}><input type="number" min={0} max={300} style={{ maxWidth: 90 }} value={nw.initialOccupied} onChange={(e) => setNw({ ...nw, initialOccupied: Number(e.target.value) })} /><span className="muted">huishoudens zitten bij de start al in een bungalow</span></span>
            <label>Sessie plannen</label><span className="inline" style={{ margin: 0 }}><input type="checkbox" style={{ flex: '0 0 auto', width: 18, height: 18 }} checked={nw.planned} onChange={(e) => setNw({ ...nw, planned: e.target.checked })} /><span className="muted">vaste eindtijd en een vast aantal in- en uitchecks</span></span>
            {nw.planned && <>
              <label>Einde sessie</label><input type="datetime-local" value={nw.endsAt} onChange={(e) => setNw({ ...nw, endsAt: e.target.value })} />
              <label>Inchecks in totaal</label><span className="inline" style={{ margin: 0 }}><input type="number" min={0} max={2000} style={{ maxWidth: 90 }} value={nw.arrivals} onChange={(e) => setNw({ ...nw, arrivals: Number(e.target.value) })} /><span className="muted">aankomsten, willekeurig verspreid tot het einde</span></span>
              <label>Uitchecks in totaal</label><span className="inline" style={{ margin: 0 }}><input type="number" min={0} max={nw.initialOccupied + nw.arrivals} style={{ maxWidth: 90 }} value={nw.departures} onChange={(e) => setNw({ ...nw, departures: Number(e.target.value) })} /><span className="muted">vertrekken, willekeurig verspreid (max {nw.initialOccupied + nw.arrivals})</span></span>
            </>}
            <label>Demospelers</label><span className="inline" style={{ margin: 0 }}><input type="checkbox" style={{ flex: '0 0 auto', width: 18, height: 18 }} checked={nw.demoPlayers} onChange={(e) => setNw({ ...nw, demoPlayers: e.target.checked })} /> <span className="muted">Sophie, Mike… (voor een demo met de demo-bot)</span></span>
          </div>
          <p className="muted">Begint met een leeg scorebord. Het lopende spel wordt eerst automatisch bewaard. Eigen namen en opdrachten blijven beschikbaar.</p>
          <button className="go" disabled={busy || nw.name.trim().length < 2 || nw.code.length < 4} onClick={() => { if (confirm(`Nieuw spel "${nw.name}" starten met spelcode ${nw.code}?`)) run(() => api('POST', '/admin/games/new', { name: nw.name, code: nw.code, demoPlayers: nw.demoPlayers, initialOccupied: nw.initialOccupied, ...(nw.planned ? { endsAt: new Date(nw.endsAt).toISOString(), arrivals: nw.arrivals, departures: nw.departures } : {}) }), `Nieuw spel gestart. Spelcode: ${nw.code}`); }}>Nieuw spel starten</button>
        </div>
        <div className="panel tall">
          <h2>Spel uit een bestand</h2>
          <p className="muted">Een eerder gedownload spel (bijvoorbeeld van een andere computer) toevoegen aan de lijst.</p>
          <input type="file" accept=".json,application/json" onChange={upload} />
        </div>
      </div>
      <div className="panel tall" style={{ marginTop: 12 }}>
        <h2>Opgeslagen spellen ({data.saves.length})</h2>
        {!data.saves.length && <p className="muted">Nog niets opgeslagen.</p>}
        <table><tbody>{data.saves.map((g: any) => (
          <tr key={g.id}>
            <td><b>{g.name}</b>{g.auto ? <span className="pill" style={{ marginLeft: 6 }}>automatisch</span> : null}<div className="muted">{g.gameName} · opgeslagen {stamp(g.createdAt)} · speltijd {stamp(g.gameMs)}</div></td>
            <td>{g.players} spelers{g.top ? ` · leider ${g.top}` : ''}</td>
            <td className="muted">{Math.round(g.size / 1024)} kB</td>
            <td><span className="inline" style={{ margin: 0 }}>
              <button className="go" disabled={busy || !g.sameMap} title={g.sameMap ? '' : 'Gespeeld op een andere kaartversie'} onClick={() => { if (confirm(`"${g.name}" laden? Het lopende spel wordt eerst automatisch bewaard.`)) run(() => api('POST', `/admin/games/${g.id}/load`, {}), `"${g.name}" geladen`); }}>Laden</button>
              <button onClick={() => downloadSave(g.id, g.name)}>Download</button>
              <button className="warnbtn" onClick={() => { if (confirm(`"${g.name}" definitief verwijderen?`)) run(() => api('POST', `/admin/games/${g.id}/delete`, {}), 'Verwijderd'); }}>Verwijder</button>
            </span></td>
          </tr>))}</tbody></table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- players and scores
function Players({ state, refresh, flash }: Ctx) {
  const [ledger, setLedger] = useState<any[]>([]);
  const [sel, setSel] = useState('');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const loadLedger = () => api('GET', '/admin/ledger?limit=100').then((r) => r.ok && setLedger(r.data));
  useEffect(() => { loadLedger(); }, [state]);
  const players = [...state.players].sort((a: any, b: any) => b.score - a.score);
  async function apply() {
    const r = await api('POST', `/admin/players/${sel}/score`, { delta: Number(delta), reason });
    if (r.ok) { flash(true, `${r.data.displayName}: ${r.data.before} → ${r.data.after} punten`); setDelta(''); setReason(''); refresh(); loadLedger(); } else flash(false, errText(r.data));
  }
  return (
    <div className="grid2" style={{ marginTop: 0 }}>
      <div className="panel tall">
        <h2>Stand</h2>
        <table><tbody>{players.map((p: any, i: number) => <tr key={p.id}><td>{i + 1}</td><td>{p.displayName}{p.isTest ? <span className="pill" style={{ marginLeft: 6 }}>test</span> : null}</td><td className="num"><b>{p.score}</b></td><td><button onClick={() => setSel(p.id)}>Aanpassen</button></td></tr>)}</tbody></table>
        <h3>Score aanpassen</h3>
        <div className="form">
          <label>Speler</label><select value={sel} onChange={(e) => setSel(e.target.value)}><option value="">kies…</option>{players.map((p: any) => <option key={p.id} value={p.id}>{p.displayName} ({p.score})</option>)}</select>
          <label>Punten (+/-)</label><input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="bijv. 50 of -25" />
          <label>Reden</label><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="komt in het logboek" />
          <span /><button className="go" disabled={!sel || !delta || reason.trim().length < 3} onClick={apply}>Toepassen</button>
        </div>
        <p className="muted">Elke aanpassing wordt vastgelegd in het puntenregister en het auditlogboek. De score blijft altijd gelijk aan de som van het register.</p>
      </div>
      <div className="panel tall"><h2>Puntenregister (laatste 100)</h2>
        <table><tbody>{ledger.map((l) => <tr key={l.id}><td>{time(l.createdAt)}</td><td>{l.displayName}</td><td className="num" style={{ color: l.points < 0 ? 'var(--bad)' : undefined }}>{l.points > 0 ? '+' : ''}{l.points}</td><td>{l.reason.replace(/^admin:/, 'handmatig: ').replace(/^task:/, 'opdracht ')}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- settings
/** one setting: label, input and a plain-language explanation underneath */
function Field({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return <div style={{ margin: '0 0 12px' }}><div className="inline" style={{ margin: 0 }}><label style={{ minWidth: 190, fontWeight: 600 }}>{label}</label>{children}</div><div className="muted" style={{ fontSize: 12.5 }}>{help}</div></div>;
}
function Settings({ state, refresh, flash }: Ctx) {
  const p = state.park;
  const [sched, setSched] = useState<any>(null);
  const [story, setStory] = useState<any>(null);
  const [popup, setPopup] = useState<number>(p.display?.popupSeconds ?? 15);
  const load = () => { api('GET', '/admin/scheduler').then((r) => r.ok && setSched(r.data.config)); api('GET', '/admin/stories').then((r) => r.ok && setStory(r.data.config)); };
  useEffect(load, []);
  const post = async (path: string, body: unknown, label: string) => { const r = await api('POST', path, body); if (r.ok) { flash(true, `${label} opgeslagen`); refresh(); load(); } else flash(false, errText(r.data)); };
  const num = (o: any, set: (v: any) => void, k: string, step = 1) => <input type="number" step={step} style={{ maxWidth: 110 }} value={o[k]} onChange={(e) => set({ ...o, [k]: Number(e.target.value) })} />;
  return (
    <div className="grid" style={{ marginTop: 0 }}>
      <div className="panel tall">
        <h2>Spel</h2>
        <Field label="Snelheid" help="Hoe snel de speltijd loopt. 1x = echte tijd, 8x = een uur speltijd duurt 7,5 minuut."><span className="inline" style={{ margin: 0 }}>{[1, 2, 4, 8].map((x) => <button key={x} className={p.timeScale === x ? 'sel' : ''} onClick={() => post('/admin/speed', { timeScale: x }, `Snelheid ${x}x`)}>{x}x</button>)}</span></Field>
        <Field label="Pauze" help="Zet de klok, het verkeer en de planner stil."><button onClick={() => post(p.paused ? '/admin/resume' : '/admin/pause', {}, p.paused ? 'Hervat' : 'Pauze')}>{p.paused ? 'Hervatten' : 'Pauzeren'}</button></Field>
        <Field label="Demo-bot" help="Laat de testspelers zelf opdrachten claimen en afronden. Handig voor een demo zonder echte spelers."><button className={p.demoBot ? 'sel' : ''} onClick={() => post('/admin/flags', { demoBot: !p.demoBot }, 'Demo-bot')}>{p.demoBot ? 'Aan' : 'Uit'}</button></Field>
        <Field label="Automatisch verkeer" help="Er komen vanzelf gasten aan en er vertrekken er vanzelf."><button className={p.autoArrivals ? 'sel' : ''} onClick={() => post('/admin/flags', { autoArrivals: !p.autoArrivals }, 'Automatisch verkeer')}>{p.autoArrivals ? 'Aan' : 'Uit'}</button></Field>
        <Field label="Automatisch in-/uitchecken" help="Check-in en check-out worden na enkele seconden vanzelf afgerond (zonder punten). De slagboom opent nog steeds alleen na zo'n afgeronde opdracht."><button className={p.autoGate ? 'sel' : ''} onClick={() => post('/admin/flags', { autoGate: !p.autoGate }, 'Automatisch in-/uitchecken')}>{p.autoGate ? 'Aan' : 'Uit'}</button></Field>
        <Field label="Nu iets laten gebeuren" help="Plaatst direct één extra opdracht, crisis of verhaallijn."><span className="inline" style={{ margin: 0 }}><button onClick={() => post('/admin/incidents', {}, '+1 opdracht')}>+1 opdracht</button><button onClick={() => post('/admin/incidents', { crisis: true }, '+1 crisis')}>+1 crisis</button><button onClick={() => post('/admin/stories', {}, '+1 verhaal')}>+1 verhaal</button></span></Field>
        <Field label="Reset" help="Begint opnieuw: scores, opdrachten en voertuigen worden gewist. Eigen namen en opdrachten blijven bewaard."><button className="warnbtn" onClick={() => { if (confirm('Spel resetten? Alle scores, opdrachten en voertuigen worden gewist. Eigen namen en opdrachten blijven bewaard.')) post('/admin/reset', {}, 'Reset'); }}>Reset spel</button></Field>
        <h2 style={{ marginTop: 18 }}>Weer</h2>
        <WeatherBox p={p} post={post} />
        <h2 style={{ marginTop: 18 }}>Projectie</h2>
        <Field label="Dag en nacht" help="De projectie wordt 's avonds donker (vanaf 18:30 speltijd) en 's ochtends weer licht (tot 7:30), met lantaarns en verlichte bungalows."><button className={p.display?.dayNight !== false ? 'sel' : ''} onClick={() => post('/admin/display', { dayNight: p.display?.dayNight === false }, 'Dag en nacht')}>{p.display?.dayNight !== false ? 'Aan' : 'Uit'}</button></Field>
        <Field label="Sfeergeluid" help="Zachte achtergrondgeluiden op de projectie: vogels overdag, krekels 's nachts, wat wind. Meldingsgeluiden blijven altijd aan."><button className={p.display?.ambientSound !== false ? 'sel' : ''} onClick={() => post('/admin/display', { ambientSound: p.display?.ambientSound === false }, 'Sfeergeluid')}>{p.display?.ambientSound !== false ? 'Aan' : 'Uit'}</button></Field>
        <Field label="Automatisch inzoomen" help="Bij een nieuwe crisis (en desgewenst een nieuw verhaal) zoomt de kaart een paar seconden in op de plek en daarna weer uit. Scorebord en meldingen blijven gewoon in beeld."><select value={p.display?.autoZoom ?? 'crises'} onChange={(e) => post('/admin/display', { autoZoom: e.target.value }, 'Automatisch inzoomen')}><option value="uit">uit</option><option value="crises">bij crises</option><option value="alles">bij crises en nieuwe verhalen</option></select></Field>
        <Field label="Pop-up zichtbaar (seconden)" help="Hoe lang een melding van een nieuwe opdracht, crisis of verhaal op het grote scherm blijft staan (5-120 s). Geldt voor nieuwe pop-ups."><span className="inline" style={{ margin: 0 }}><input type="number" min={5} max={120} style={{ maxWidth: 90 }} value={popup} onChange={(e) => setPopup(Number(e.target.value))} /><button className="go" onClick={() => post('/admin/display', { popupSeconds: popup }, 'Pop-upduur')}>Opslaan</button></span></Field>
      </div>
      <div className="panel tall">
        <h2>Opdrachtenplanner</h2>
        <p className="muted">De planner bedenkt zelf nieuwe opdrachten. "Dag" is de periode tussen begin en einde van de dag hieronder (standaard 08:00 tot 23:00 speltijd); de rest is "nacht".</p>
        {sched && <>
          <Field label="Planner aan" help="Uit = er komen geen nieuwe opdrachten en crises meer vanzelf (handmatig plaatsen kan altijd)."><input type="checkbox" checked={sched.enabled} onChange={(e) => setSched({ ...sched, enabled: e.target.checked })} /></Field>
          <Field label="Opdrachten per uur overdag" help={`Gemiddeld aantal nieuwe opdrachten per uur speltijd tijdens de dag. Bij een vol park iets meer, bij een leeg park iets minder.`}>{num(sched, setSched, 'normalPerHourDay', 0.5)}</Field>
          <Field label="'s Nachts (deel van overdag)" help={`'s Nachts komt dit deel van het dagtempo. 0,2 = een vijfde, dus nu ${(sched.normalPerHourDay * sched.nightFactor).toFixed(1)} per uur. 0 = 's nachts niets, 1 = even veel als overdag.`}>{num(sched, setSched, 'nightFactor', 0.05)}</Field>
          <Field label="Dag begint om (uur)" help="Vanaf dit uur (0-23) geldt het dagtempo en kunnen crises ontstaan.">{num(sched, setSched, 'dayStartHour')}</Field>
          <Field label="Dag eindigt om (uur)" help="Vanaf dit uur (1-24) geldt het nachttempo.">{num(sched, setSched, 'dayEndHour')}</Field>
          <Field label="Crises per dag (gemiddeld)" help="Grote incidenten met meerdere deelopdrachten, alleen overdag.">{num(sched, setSched, 'majorPerDay')}</Field>
          <Field label="Crises per dag (maximaal)" help="Nooit meer crises op één speldag dan dit.">{num(sched, setSched, 'majorMaxPerDay')}</Field>
          <Field label="Minuten tussen crises" help="Minimale tijd (speltijd) tussen twee crises.">{num(sched, setSched, 'majorMinGapMin', 10)}</Field>
          <Field label="Max. open opdrachten" help="Staan er zoveel opdrachten open, dan wacht de planner met nieuwe (zodat spelers niet bedolven raken).">{num(sched, setSched, 'maxOpen')}</Field>
          <button className="go" onClick={() => post('/admin/scheduler', sched, 'Planner')}>Planner opslaan</button>
        </>}
      </div>
      <div className="panel tall">
        <h2>Verhaallijnen</h2>
        <p className="muted">Korte verhalen rond een gastenhuishouden, in 2 of 3 delen. Elk deel is een gewone opdracht.</p>
        {story && <>
          <Field label="Verhaallijnen aan" help="Uit = er starten geen nieuwe verhalen vanzelf (lopende verhalen gaan door)."><input type="checkbox" checked={story.enabled} onChange={(e) => setStory({ ...story, enabled: e.target.checked })} /></Field>
          <Field label="Nieuwe verhalen per uur overdag" help="Gemiddeld aantal nieuwe verhalen per uur speltijd tijdens de dag. 's Nachts starten er geen. Standaard 1,5.">{num(story, setStory, 'perHourDay', 0.5)}</Field>
          <Field label="Maximaal tegelijk" help="Zoveel verhalen kunnen tegelijk lopen.">{num(story, setStory, 'maxActive')}</Field>
          <button className="go" onClick={() => post('/admin/stories/config', story, 'Verhaallijnen')}>Verhaallijnen opslaan</button>
        </>}
      </div>
    </div>
  );
}

const WX: [string, string][] = [['zon', 'Zonnig'], ['halfbewolkt', 'Half bewolkt'], ['bewolkt', 'Bewolkt'], ['regen', 'Regen'], ['onweer', 'Onweer'], ['mist', 'Mist']];
function WeatherBox({ p, post }: { p: any; post: (path: string, body: unknown, label: string) => void }) {
  const [kind, setKind] = useState('regen');
  const [min, setMin] = useState(60);
  const w = p.weather;
  const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' });
  return <>
    {w && <p style={{ margin: '0 0 8px' }}><b>{w.name}</b>, {w.tempC}°C, wind {w.wind} Bft · {w.locked ? 'ingesteld' : 'vanzelf'} tot {hhmm(w.until)}<br /><span className="muted">Verwachting: {w.forecast.map((f: any) => `${hhmm(f.at)} ${WX.find((x) => x[0] === f.kind)?.[1].toLowerCase()}`).join(' · ')}</span></p>}
    <Field label="Weer instellen" help="Het weer wisselt normaal vanzelf (zon, wolken, regen, onweer, mist). Hier zet je het zelf, voor een aantal speelminuten. Regen en onweer geven meer lekkages en klussen buiten, zon meer drukte op het terras en bij de fietsverhuur. Onweer kan de onweer-crisis starten.">
      <span className="inline" style={{ margin: 0 }}>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>{WX.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        <input type="number" min={5} max={600} value={min} onChange={(e) => setMin(Number(e.target.value))} /><span className="muted" style={{ flex: '0 0 auto' }}>min</span>
        <button className="go" onClick={() => post('/admin/weather', { kind, minutes: min }, 'Weer')}>Instellen</button>
        <button onClick={() => post('/admin/weather', { kind: 'auto' }, 'Weer')}>Vanzelf</button>
      </span>
    </Field>
  </>;
}

// ---------------------------------------------------------------- guest names and cameo guests
const lines = (s: string) => s.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean);
function Names({ flash }: Ctx) {
  const [data, setData] = useState<any>(null);
  const [f, setF] = useState({ first: '', surnames: '', kids: '', cameos: '' });
  useEffect(() => {
    api('GET', '/admin/content').then((r) => {
      if (!r.ok) return;
      setData(r.data);
      const n = r.data.names;
      setF({ first: n.first.join('\n'), surnames: n.surnames.join('\n'), kids: n.kids.join('\n'), cameos: n.cameos.map((c: any) => `${c.name}; ${c.role}; ${c.tagline}`).join('\n') });
    });
  }, []);
  async function save() {
    const cameos = f.cameos.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const [name, role, ...rest] = l.split(';').map((x) => x.trim()); return { name, role: (role || 'presentator').toLowerCase(), tagline: rest.join('; ') }; });
    const r = await api('POST', '/admin/content/names', { first: lines(f.first), surnames: lines(f.surnames), kids: lines(f.kids), cameos });
    if (r.ok) flash(true, `Opgeslagen: ${r.data.first.length} voornamen, ${r.data.surnames.length} achternamen, ${r.data.kids.length} kindernamen, ${r.data.cameos.length} bekende gasten. Nieuwe gasten gebruiken ze direct.`); else flash(false, errText(r.data));
  }
  const upload = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    file.text().then((t) => setF((o) => ({ ...o, [k]: (o[k] ? o[k] + '\n' : '') + t.replace(/\r/g, '').trim() })));
    e.target.value = '';
  };
  const box = (k: keyof typeof f, title: string, hint: string) => (
    <div className="panel tall"><h2>{title}</h2><p className="muted">{hint}</p>
      <textarea value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      <div className="inline"><label className="muted">Bestand toevoegen (.txt / .csv)</label><input type="file" accept=".txt,.csv,text/plain,text/csv" onChange={upload(k)} /></div>
    </div>
  );
  if (!data) return <p className="muted">Laden…</p>;
  return (
    <div>
      <p className="muted">Deze namen komen bovenop de ingebouwde lijsten en blijven bewaard, ook na een reset. Nieuwe gasten (aankomsten) gebruiken ze meteen. Echte personen krijgen alleen vriendelijke verhaallijnen. Voeg alleen mensen toe die daarmee akkoord zijn.</p>
      <div className="grid2" style={{ marginTop: 0 }}>
        {box('first', 'Voornamen', 'Eén naam per regel (of met komma’s).')}
        {box('surnames', 'Achternamen', 'Bijvoorbeeld "Van der Zendmast". Huishoudens heten "Familie <achternaam>".')}
        {box('kids', 'Kindernamen', 'Voor kinderen in een huishouden.')}
        {box('cameos', 'Bekende gasten (cameo)', `Per regel: naam; rol; korte omschrijving. Rollen: ${data.roles.join(', ')}. Ze komen bij de ingebouwde lijst van ruim 80 BN'ers (presentatoren en artiesten); de meeste gasten zijn BN'ers, elk hooguit in één bungalow tegelijk.`)}
      </div>
      <p><button className="go" onClick={save}>Namen opslaan</button></p>
    </div>
  );
}

// ---------------------------------------------------------------- own tasks
const GROUP_NL: Record<string, string> = { onderhoud: 'Onderhoud (TD)', schoonmaak: 'Schoonmaak', receptie: 'Receptie', horeca: 'Horeca', zwembad: 'Zwembad', fietsverhuur: 'Fietsverhuur', terrein: 'Terrein', natuur: 'Natuur', animatie: 'Animatie', chaos: 'Chaos' };
const EMPTY = { code: '', group: 'receptie', title: '', text: '', difficulty: 'easy', urgency: 'normal', location: { kind: 'house', facilities: [] as string[] }, weight: 1, when: 'altijd' };
function OwnTasks({ flash, refresh }: Ctx) {
  const [data, setData] = useState<any>(null);
  const [f, setF] = useState<any>(EMPTY);
  const load = () => api('GET', '/admin/content').then((r) => r.ok && setData(r.data));
  useEffect(() => { load(); }, []);
  async function save() {
    const r = await api('POST', '/admin/content/tasks', { ...f, code: f.code || undefined });
    if (r.ok) { flash(true, `Opdracht ${r.data.code} opgeslagen. De planner kiest hem vanaf nu ook.`); setF(EMPTY); load(); } else flash(false, errText(r.data));
  }
  async function del(code: string) { if (!confirm(`Opdracht ${code} verwijderen?`)) return; const r = await api('POST', `/admin/content/tasks/${code}/delete`, {}); if (r.ok) { flash(true, 'Verwijderd'); load(); } else flash(false, errText(r.data)); }
  async function tryNow(code: string) { const r = await api('POST', '/admin/incidents', { template: code }); if (r.ok) { flash(true, `Geplaatst: ${r.data.title}`); refresh(); } else flash(false, errText(r.data)); }
  if (!data) return <p className="muted">Laden…</p>;
  const toggleFac = (k: string) => setF({ ...f, location: { ...f.location, facilities: f.location.facilities.includes(k) ? f.location.facilities.filter((x: string) => x !== k) : [...f.location.facilities, k] } });
  return (
    <div className="grid2" style={{ marginTop: 0 }}>
      <div className="panel tall">
        <h2>{f.code ? `Wijzigen: ${f.code}` : 'Nieuwe opdracht'}</h2>
        <div className="form">
          <label>Categorie</label><select value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })}>{data.groups.map((g: string) => <option key={g} value={g}>{GROUP_NL[g] ?? g}</option>)}</select>
          <label>Titel</label><input value={f.title} maxLength={60} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="bijv. Zwembroek kwijt" />
          <label>Omschrijving</label><textarea style={{ minHeight: 80, fontFamily: 'inherit' }} value={f.text} maxLength={300} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="Wat moet de speler doen? {loc} = de plek, bijv. 'In {loc} …'" />
          <label>Moeilijkheid</label><select value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: e.target.value })}><option value="easy">makkelijk</option><option value="medium">gemiddeld</option><option value="hard">moeilijk</option></select>
          <label>Urgentie</label><select value={f.urgency} onChange={(e) => setF({ ...f, urgency: e.target.value })}><option value="normal">normaal</option><option value="high">hoog</option><option value="critical">kritiek</option></select>
          <label>Plek</label><select value={f.location.kind} onChange={(e) => setF({ ...f, location: { ...f.location, kind: e.target.value } })}><option value="house">bewoonde bungalow</option><option value="facility">voorziening</option><option value="grounds">buiten (bij een bungalow)</option></select>
          {f.location.kind === 'facility' && <><label>Voorzieningen</label><div className="chips">{data.facilities.map((x: any) => <button key={x.key} className={f.location.facilities.includes(x.key) ? 'sel' : ''} onClick={() => toggleFac(x.key)}>{x.key} · {x.name}</button>)}</div></>}
          <label>Moment</label><select value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })}><option value="altijd">altijd</option><option value="dag">alleen overdag</option><option value="nacht">alleen 's nachts</option></select>
          <label>Hoe vaak</label><span className="inline"><input type="range" min={0} max={3} step={0.1} value={f.weight} onChange={(e) => setF({ ...f, weight: Number(e.target.value) })} /> <span>{f.weight === 0 ? 'alleen handmatig' : `gewicht ${f.weight}`}</span></span>
          <span /><span className="inline"><button className="go" onClick={save}>Opslaan</button>{f.code && <button onClick={() => setF(EMPTY)}>Annuleren</button>}</span>
        </div>
        <p className="muted">De punten volgen uit moeilijkheid × urgentie. Een opdracht in de bungalow uit de categorie Onderhoud of Natuur gaat met de golfkar van de TD.</p>
      </div>
      <div className="panel tall">
        <h2>Eigen opdrachten ({data.tasks.length})</h2>
        {!data.tasks.length && <p className="muted">Nog geen eigen opdrachten.</p>}
        <table><tbody>{data.tasks.map((t: any) => (
          <tr key={t.code}><td><b>{t.title}</b><div className="muted">{GROUP_NL[t.group]} · {t.text}</div></td>
            <td><span className="inline"><button onClick={() => tryNow(t.code)}>Nu plaatsen</button><button onClick={() => setF({ ...EMPTY, ...t, location: { kind: t.location.kind, facilities: t.location.facilities ?? [] } })}>Wijzig</button><button className="warnbtn" onClick={() => del(t.code)}>Verwijder</button></span></td></tr>))}</tbody></table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- logs
function Logs() {
  const [audit, setAudit] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [filter, setFilter] = useState('');
  const load = async () => {
    const a = await api('GET', '/admin/audit?limit=300'); if (a.ok) setAudit(a.data);
    const cur = await api('GET', '/events?after=latest');
    if (cur.ok) { const e = await api('GET', `/events?after=${Math.max(0, cur.data.cursor - 200)}&limit=200`); if (e.ok) setEvents(e.data.events.reverse()); }
  };
  useEffect(() => { load(); const i = setInterval(() => { if (!document.hidden) load(); }, 5000); return () => clearInterval(i); }, []);
  const m = (s: string) => !filter || s.toLowerCase().includes(filter.toLowerCase());
  return (
    <div>
      <div className="inline"><label>Filter</label><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="bijv. score, reset, story, gate" /></div>
      <div className="grid2">
        <div className="panel tall"><h2>Auditlogboek (beheeracties)</h2>
          <table><tbody>{audit.filter((r) => m(`${r.action} ${JSON.stringify(r.detail)}`)).map((r) => <tr key={r.id}><td>{time(r.created_at)}</td><td><b>{r.action}</b></td><td className="muted" style={{ wordBreak: 'break-word' }}>{JSON.stringify(r.detail)}</td></tr>)}</tbody></table></div>
        <div className="panel tall"><h2>Gebeurtenissen (laatste 200)</h2>
          {events.map(({ seq, type, gameMs, ...rest }) => ({ seq, type, txt: JSON.stringify(rest) })).filter((e) => m(`${e.type} ${e.txt}`)).map((e) => <div key={e.seq} className="ev">{e.seq} · {e.type} · {e.txt.slice(0, 160)}</div>)}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- export and backups
function Export({ flash }: Ctx) {
  const [busy, setBusy] = useState(false);
  const [bk, setBk] = useState<any>(null);
  const loadBk = () => api('GET', '/admin/backups').then((r) => r.ok && setBk(r.data));
  useEffect(() => { loadBk(); }, []);
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  async function get() { setBusy(true); const r = await api('GET', '/admin/export'); setBusy(false); if (!r.ok) { flash(false, errText(r.data)); return null; } return r.data; }
  const csv = (pick: (d: any) => any[], name: string) => async () => { const d = await get(); if (d) download(`harderwold-${name}-${stamp()}.csv`, toCsv(pick(d)), 'text/csv'); };
  async function backupNow() { setBusy(true); const r = await api('POST', '/admin/backups'); setBusy(false); if (r.ok) { flash(true, `Back-up gemaakt: ${r.data.file}`); loadBk(); } else flash(false, errText(r.data)); }
  async function fetchBackup(name: string) {
    const r = await fetch(`${API}/admin/backups/${encodeURIComponent(name)}`, { headers: { 'X-Admin-Key': ADMIN_KEY } });
    if (!r.ok) { flash(false, 'Download mislukt'); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  return (
    <div className="grid2" style={{ marginTop: 0 }}>
      <div className="panel tall">
        <h2>Export van dit spel</h2>
        <p className="muted">Download de stand van het lopende spel. CSV-bestanden openen direct in Excel.</p>
        <div className="btngrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <button className="go" disabled={busy} onClick={async () => { const d = await get(); if (d) download(`harderwold-export-${stamp()}.json`, JSON.stringify(d, null, 2)); }}>Alles (JSON)</button>
          <button disabled={busy} onClick={csv((d) => d.leaderboard, 'stand')}>Eindstand (CSV)</button>
          <button disabled={busy} onClick={csv((d) => d.ledger, 'puntenregister')}>Puntenregister (CSV)</button>
          <button disabled={busy} onClick={csv((d) => d.tasks, 'opdrachten')}>Opdrachten (CSV)</button>
          <button disabled={busy} onClick={csv((d) => d.stories, 'verhaallijnen')}>Verhaallijnen (CSV)</button>
          <button disabled={busy} onClick={csv((d) => d.audit, 'auditlog')}>Auditlogboek (CSV)</button>
        </div>
      </div>
      <div className="panel tall">
        <h2>Back-ups van de hele database</h2>
        <p className="muted">Een back-up bevat alles: alle opgeslagen spellen, eigen namen en opdrachten, en kaartversies. De server maakt er elk uur automatisch een (de laatste 48 blijven bewaard). Terugzetten gaat met de server uit; zie het runbook (docs/RUNBOOK.md). Eén spel terugzetten kan gewoon via Spellen.</p>
        <button className="go" disabled={busy} onClick={backupNow}>Nu een back-up maken</button>
        {bk && <p className="muted">Map: <code>{bk.dir ?? 'niet ingesteld'}</code></p>}
        <table><tbody>{(bk?.backups ?? []).map((b: any) => (
          <tr key={b.file}><td><code>{b.file}</code></td><td>{time(b.createdAt)}</td><td className="num">{(b.bytes / 1048576).toFixed(1)} MB</td><td><button onClick={() => fetchBackup(b.file)}>Download</button></td></tr>))}</tbody></table>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
