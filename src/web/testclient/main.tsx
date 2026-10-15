// Developer test client: acts like the future mobile app (player API) + a few Game Master controls.
// Every gate opening you see on the projector is the result of a task completion made here via the API.
import { houseLabel } from '../../shared/house.ts';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

type Task = {
  id: string; kind: string; category: string; title: string; description: string; state: string; points: number; pointsAwarded: number;
  assignedPlayerId: string | null; assignedPlayerName: string | null; deadlineAt: number | null; claimSeconds: number; vehicleId: string | null; gateId: string | null;
  queuePosition?: number; attempt: number; icon: string; locationId: string | null;
  technician?: { phase: string; onSite: boolean; vehicleId: string | null; houseNumber: number } | null;
};
const TECH_PHASE: Record<string, string> = { pending: 'wacht op een vrije golfkar', driving: 'rijdt naar de bungalow', working: 'loopt naar binnen', walking_back: 'loopt terug', returning: 'rijdt terug' };
const techBlocked = (t: Task) => !!t.technician && !t.technician.onSite;
const isTd = (t: Task) => t.kind === 'incident' && (t.category === 'Onderhoud' || t.category === 'Natuur') && !!t.locationId?.startsWith('H');
type Player = { id: string; displayName: string; score: number; isTest: number };
type Log = { at: string; text: string; ok: boolean };

const API = '/api/v1';
const uid = () => (crypto as any).randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now();

function useLocal<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : init; } catch { return init; } });
  return [v, (nv: T) => { setV(nv); try { localStorage.setItem(key, JSON.stringify(nv)); } catch { /* ignore */ } }];
}

function App() {
  const [adminKey, setAdminKey] = useLocal('hw.adminKey', 'gm-harderwold');
  const [gameCode, setGameCode] = useLocal('hw.gameCode', 'HARDER');
  const [session, setSession] = useLocal<{ token: string; playerId: string; displayName: string } | null>('hw.session', null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [park, setPark] = useState<any>(null);
  const [bookings, setBookings] = useState<any[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [now, setNow] = useState(Date.now());
  const [newName, setNewName] = useState('');
  const [tab, setTab] = useState<'gate' | 'all' | 'guests'>('gate');
  const [stories, setStories] = useState<any[]>([]);
  const clockOffset = useRef(0);

  const log = (text: string, ok = true) => setLogs((l) => [{ at: new Date().toLocaleTimeString('nl-NL'), text, ok }, ...l].slice(0, 60));

  async function call(method: string, path: string, body?: unknown, opts: { admin?: boolean; auth?: boolean } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.admin) headers['X-Admin-Key'] = adminKey;
    if (opts.auth !== false && session) headers['Authorization'] = `Bearer ${session.token}`;
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 10000);
    let r: Response;
    try { r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal }); }
    catch { clearTimeout(to); log(`${method} ${path}: server reageert niet binnen 10 s (draait de server? te veel open tabbladen?)`, false); return { status: 0, data: null }; }
    clearTimeout(to);
    let data: any = null; try { data = await r.json(); } catch { /* empty */ }
    return { status: r.status, data };
  }

  async function refresh() {
    const p = await call('GET', '/park', undefined, { auth: false });
    if (p.status === 200) { setPark(p.data); clockOffset.current = p.data.gameMs - Date.now(); }
    const b = await call('GET', '/bookings', undefined, { auth: false }); if (b.status === 200) setBookings(b.data);
    const st = await call('GET', '/stories?all=1', undefined, { auth: false }); if (st.status === 200) setStories(st.data);
    if (session) {
      const t = await call('GET', '/tasks');
      if (t.status === 200) setTasks(t.data);
      else if (t.status === 401) { log('Sessie ongeldig (na reset?) - kies opnieuw een speler', false); setSession(null); }
    }
    const pl = await call('GET', '/admin/players', undefined, { admin: true, auth: false });
    if (pl.status === 200) setPlayers(pl.data);
  }

  useEffect(() => { refresh(); const i = setInterval(refresh, 4000); return () => clearInterval(i); }, [session?.token, adminKey]);
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(i); }, []);
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => { const f = () => setVisible(!document.hidden); document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f); }, []);
  // events by short polling (GET /events?after=cursor) instead of a held-open SSE connection: browsers allow only
  // ~6 connections per server, and every projector or test tab holding one made other requests wait forever
  useEffect(() => {
    if (!visible) return;
    let cursor: number | 'latest' = 'latest', stop = false, timer: ReturnType<typeof setTimeout> | undefined;
    const types = new Set(['task.created', 'task.claimed', 'task.completed', 'task.expired', 'task.reoffered', 'gate.opening', 'gate.opened', 'gate.closing', 'gate.closed', 'gate.pass_authorized', 'gate.token_issued', 'gate.staff_pass', 'vehicle.queued', 'vehicle.parked', 'vehicle.exited', 'vehicle.departing', 'game.reset', 'gate.override', 'service.dispatched', 'service.working', 'service.returning', 'map.updated']);
    const poll = async () => {
      try {
        const r = await call('GET', `/events?after=${cursor}&limit=200`, undefined, { auth: false });
        if (r.status === 200) {
          const fresh = (r.data.events as { type: string; vehicleId?: string; taskId?: string; gateId?: string; displayName?: string }[]).filter((d) => types.has(d.type));
          if (fresh.length) setEvents((ev) => [...fresh.reverse().map((d) => `${new Date().toLocaleTimeString('nl-NL')}  ${`${d.type} ${d.vehicleId ?? d.taskId ?? ''} ${d.gateId ?? ''} ${d.displayName ?? ''}`.trim()}`), ...ev].slice(0, 80));
          if (r.data.reset || fresh.some((d) => /^(task|gate|service)\./.test(d.type) || d.type === 'vehicle.queued' || d.type === 'game.reset')) refresh();
          cursor = r.data.cursor;
        }
      } finally { if (!stop) timer = setTimeout(poll, 1000); }
    };
    void poll();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [visible, session?.token]);

  async function useTestPlayer(id: string) {
    const r = await call('POST', `/admin/players/${id}/token`, {}, { admin: true, auth: false });
    if (r.status === 200) { setSession(r.data); log(`Ingelogd als ${r.data.displayName} (testtoken via admin)`); } else log(`Token mislukt: ${r.status} ${r.data?.message ?? ''}`, false);
  }
  async function join() {
    const r = await call('POST', '/sessions/join', { gameCode, displayName: newName }, { auth: false });
    if (r.status === 200) { setSession(r.data); log(`Aangemeld als ${r.data.displayName}`); setNewName(''); } else log(`Aanmelden: ${r.status} ${r.data?.error} - ${r.data?.message}`, false);
  }
  async function act(t: Task, action: 'claim' | 'complete' | 'release') {
    const key = `${action}-${t.id}-${uid()}`;
    const r = await call('POST', `/tasks/${t.id}/${action}`, action === 'release' ? {} : { idempotencyKey: key });
    const msg = r.status === 200 ? (action === 'complete' ? `+${r.data.pointsAwarded ?? 0} punten${r.data.passage ? ` - passagetoken ${r.data.passage.passageId} voor ${r.data.passage.vehicleId}` : ''}` : 'ok') : `${r.data?.error}: ${r.data?.message}`;
    log(`${action.toUpperCase()} ${t.title} -> HTTP ${r.status} ${msg}`, r.status === 200);
    refresh();
    return r.status === 200;
  }
  async function claimAndComplete(t: Task) { if (t.state === 'offered') { if (!(await act(t, 'claim'))) return; } await act({ ...t, state: 'claimed' }, 'complete'); }
  async function admin(path: string, body: unknown = {}, label = path) {
    const r = await call('POST', `/admin/${path}`, body, { admin: true, auth: false });
    log(`${label} -> HTTP ${r.status} ${r.status === 200 ? '' : (r.data?.message ?? '')}`, r.status === 200);
    if (path === 'reset') setSession(null);
    refresh();
  }
  async function duplicateCompleteTest(t: Task) {
    const key = `dup-${t.id}-${uid()}`;
    const a = await call('POST', `/tasks/${t.id}/complete`, { idempotencyKey: key });
    const b = await call('POST', `/tasks/${t.id}/complete`, { idempotencyKey: key });
    const c = await call('POST', `/tasks/${t.id}/complete`, { idempotencyKey: `${key}-other` });
    log(`Dubbel-afronden test: 1e ${a.status} (+${a.data?.pointsAwarded ?? 0}), herhaling ${b.status} (replayed=${!!b.data?.replayed}), nieuwe sleutel ${c.status} (+${c.data?.pointsAwarded ?? 0})`, a.status === 200);
    refresh();
  }

  const gameNow = now + clockOffset.current;
  const gateTasks = tasks.filter((t) => t.kind === 'checkin' || t.kind === 'checkout').filter((t) => t.state === 'offered' || t.state === 'claimed');
  const otherTasks = tasks.filter((t) => t.kind === 'incident' && (t.state === 'offered' || t.state === 'claimed'));
  const done = tasks.filter((t) => t.state === 'completed').slice(0, 8);
  const me = players.find((p) => p.id === session?.playerId);

  const TaskCard = ({ t }: { t: Task }) => {
    const mine = t.assignedPlayerId === session?.playerId;
    const left = t.deadlineAt ? Math.max(0, Math.round((t.deadlineAt - gameNow) / 1000)) : null;
    return (
      <div className={`card ${t.state}`}>
        <div className="row">
          <span className={`tag ${t.kind}`}>{t.kind === 'checkin' ? 'CHECK-IN' : t.kind === 'checkout' ? 'CHECK-OUT' : t.category.toUpperCase()}</span>
          <b>{t.title}</b>
          <span className="pts">{t.points} pt</span>
        </div>
        <div className="desc">{t.description}</div>
        <div className="meta">
          {t.gateId && <span>slagboom <code>{t.gateId}</code> · voertuig <code>{t.vehicleId}</code>{t.queuePosition ? ` · positie ${t.queuePosition} in rij` : ''}</span>}
          <span>status <b>{t.state}</b>{t.assignedPlayerName ? ` door ${t.assignedPlayerName}` : ''}{left !== null ? ` · deadline ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : ''}{t.attempt > 1 ? ` · poging ${t.attempt}` : ''}</span>
          {t.technician && <span className={t.technician.onSite ? 'tdok' : 'warn'}>{t.technician.onSite ? `Monteur is ter plaatse in bungalow ${houseLabel(t.technician.houseNumber)}: je kunt afronden` : `Monteur ${TECH_PHASE[t.technician.phase] ?? t.technician.phase}${t.technician.vehicleId ? ` (${t.technician.vehicleId})` : ''}: afronden kan pas als hij er is`}</span>}
        </div>
        <div className="btns">
          {t.state === 'offered' && <button onClick={() => act(t, 'claim')} disabled={!session}>Claimen</button>}
          {t.state === 'claimed' && mine && <button className="go" onClick={() => act(t, 'complete')} disabled={techBlocked(t)} title={techBlocked(t) ? 'Eerst moet de monteur ter plaatse zijn' : undefined}>Afronden</button>}
          {t.state === 'claimed' && mine && <button onClick={() => act(t, 'release')}>Vrijgeven</button>}
          {(t.state === 'offered' || (t.state === 'claimed' && mine)) && !isTd(t) && <button className="go" onClick={() => claimAndComplete(t)} disabled={!session}>Claim + afronden</button>}
          {t.state === 'claimed' && mine && <button onClick={() => duplicateCompleteTest(t)} title="Stuurt 3 completes: zelfde sleutel 2x en een nieuwe sleutel">Test dubbel afronden</button>}
          {t.state === 'claimed' && !mine && <span className="muted">Geclaimd door een andere speler</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="wrap">
      <header>
        <h1>Harderwold Tycoon · testinterface</h1>
        <span className="muted">Spelers-API zoals de toekomstige app · server bepaalt alle verkeers- en slagboomstatus</span>
        <a href="/" target="_blank">Projectie openen</a>
        <a href={`/?debug=${encodeURIComponent(adminKey)}`} target="_blank">Projectie + verkeersdebug</a>
        <a href="/docs" target="_blank">API-docs</a>
        <a href="/editor" target="_blank">Kaarteditor</a>
      </header>
      <section className="grid">
        <div className="panel">
          <h2>1. Speler</h2>
          {session ? <p>Ingelogd als <b>{session.displayName}</b> {me ? `· ${me.score} punten` : ''} <button onClick={() => setSession(null)}>Afmelden</button></p> : <p className="warn">Kies een testspeler of meld je aan om opdrachten te claimen.</p>}
          <div className="chips">{players.map((p) => <button key={p.id} className={p.id === session?.playerId ? 'sel' : ''} onClick={() => useTestPlayer(p.id)}>{p.displayName} <small>{p.score}</small></button>)}</div>
          <div className="inline">
            <input value={gameCode} onChange={(e) => setGameCode(e.target.value)} placeholder="spelcode" style={{ width: 90 }} />
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="nieuwe spelersnaam" />
            <button onClick={join}>Aanmelden</button>
          </div>
        </div>
        <div className="panel">
          <h2>2. Slagbomen &amp; wachtrijen</h2>
          {park?.gates?.map((g: any) => (
            <div key={g.id} className="gate"><code>{g.id}</code> <span className={`ph ${g.phase}`}>{g.phase}</span> · {g.queue} wachtend{g.authorizedVehicle ? ` · doorgang voor ${g.authorizedVehicle}` : ''}</div>
          ))}
          <p className="muted">Buiten beeld (buffer): {park?.bufferedArrivals ?? 0} · voertuigen in sector: {park?.vehicles ?? 0} · tijdschaal {park?.timeScale}x{park?.paused ? ' (gepauzeerd)' : ''}</p>
          <table><tbody>{bookings.filter((b) => b.status !== 'exited').map((b) => <tr key={b.id}><td title={b.profile?.tagline ?? ''}>{b.household}{b.story ? ' ★' : ''}</td><td>bungalow {b.houseNumber}</td><td><code>{b.vehicleId}</code></td><td>{b.status}</td></tr>)}</tbody></table>
        </div>
        <div className="panel">
          <h2>3. Spelleider (admin)</h2>
          <div className="inline"><label>Admin-sleutel</label><input value={adminKey} onChange={(e) => setAdminKey(e.target.value)} /></div>
          <div className="btngrid">
            <button onClick={() => admin('arrivals', { count: 1 }, '+1 aankomst')}>+1 aankomst</button>
            <button onClick={() => admin('arrivals', { count: 5 }, '+5 aankomsten (gelijktijdig)')}>+5 tegelijk</button>
            <button onClick={() => admin('departures', { count: 1 }, '+1 vertrek')}>+1 vertrek</button>
            <button onClick={() => admin('departures', { count: 3 }, '+3 vertrekken')}>+3 vertrek</button>
            {[1, 2, 4, 8].map((s) => <button key={s} className={park?.timeScale === s ? 'sel' : ''} onClick={() => admin('speed', { timeScale: s }, `snelheid ${s}x`)}>{s}x</button>)}
            <button onClick={() => admin(park?.paused ? 'resume' : 'pause', {}, park?.paused ? 'hervat' : 'pauze')}>{park?.paused ? 'Hervatten' : 'Pauzeren'}</button>
            <button className={park?.demoBot ? 'sel' : ''} onClick={() => admin('flags', { demoBot: !park?.demoBot }, `demo-bot ${!park?.demoBot ? 'aan' : 'uit'}`)}>Demo-bot {park?.demoBot ? 'aan' : 'uit'}</button>
            <button className={park?.autoArrivals ? 'sel' : ''} onClick={() => admin('flags', { autoArrivals: !park?.autoArrivals }, `automatisch verkeer ${!park?.autoArrivals ? 'aan' : 'uit'}`)}>Auto-verkeer {park?.autoArrivals ? 'aan' : 'uit'}</button>
            <button className={park?.autoGate ? 'sel' : ''} title="Check-in en check-out worden na enkele seconden automatisch afgerond (zonder punten); de slagboom opent nog steeds alleen met het token van die afgeronde opdracht" onClick={() => admin('flags', { autoGate: !park?.autoGate }, `automatisch in/uitchecken ${!park?.autoGate ? 'aan' : 'uit'}`)}>Auto in/uitchecken {park?.autoGate ? 'aan' : 'uit'}</button>
            <button onClick={() => admin('incidents', {}, '+1 incident')}>+1 incident</button>
            <button onClick={() => admin('incidents', { crisis: true }, '+1 crisis')}>+1 crisis</button>
            <button onClick={() => admin('stories', {}, '+1 verhaallijn')}>+1 verhaal</button>
            <button onClick={() => { if (confirm('Demo resetten? Alle scores en voertuigen worden gewist.')) admin('reset', {}, 'reset'); }}>Reset demo</button>
            <button className="warnbtn" onClick={() => { const g = prompt('Noodbediening: welke slagboom? (gate-in / gate-out)', 'gate-in'); if (!g) return; const reason = prompt('Reden (wordt gelogd in de audit):', ''); if (reason) admin(`gates/${g}/override`, { reason }, `NOODBEDIENING ${g}`); }}>Noodbediening</button>
          </div>
          <p className="muted">Demo-bot laat de testspelers zelf claimen en afronden via dezelfde API. Standaard uit, zodat jij de slagbomen bedient.</p>
        </div>
      </section>
      <section className="tabs">
        <button className={tab === 'gate' ? 'sel' : ''} onClick={() => setTab('gate')}>Check-in / check-out ({gateTasks.length})</button>
        <button className={tab === 'all' ? 'sel' : ''} onClick={() => setTab('all')}>Incidenten ({otherTasks.length})</button>
        <button className={tab === 'guests' ? 'sel' : ''} onClick={() => setTab('guests')}>Gasten &amp; verhalen ({stories.filter((x) => x.state === 'active').length})</button>
      </section>
      {tab === 'guests' && <section className="tasks"><GuestsPanel stories={stories} bookings={bookings} /></section>}
      {tab !== 'guests' && <section className="tasks">
        {!session && <p className="warn">Meld je eerst aan (stap 1).</p>}
        {(tab === 'gate' ? gateTasks : otherTasks).map((t) => <TaskCard key={t.id} t={t} />)}
        {(tab === 'gate' ? gateTasks : otherTasks).length === 0 && session && <p className="muted">Geen open opdrachten. Plan een aankomst of vertrek in via de spelleider-knoppen.</p>}
      </section>}
      {done.length > 0 && <section className="panel" style={{ marginTop: 12, maxHeight: 220 }}><h2>Recent afgerond</h2>{done.map((t) => <div key={t.id} className="done">{t.title} · +{t.pointsAwarded} pt · {t.assignedPlayerName}</div>)}</section>}
      <section className="grid2">
        <div className="panel"><h2>API-resultaten</h2>{logs.map((l, i) => <div key={i} className={l.ok ? 'ok' : 'err'}>{l.at} {l.text}</div>)}</div>
        <div className="panel"><h2>Realtime gebeurtenissen</h2>{events.map((e, i) => <div key={i} className="ev">{e}</div>)}</div>
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
void useMemo;

const STORY_STATE: Record<string, string> = { active: 'loopt', completed: 'afgerond', failed: 'mislukt' };
/** Guests (media households) in the park and their storylines; story chapters are claimed under Incidenten. */
function GuestsPanel({ stories, bookings }: { stories: any[]; bookings: any[] }) {
  const present = bookings.filter((b) => b.status === 'in_house' || b.status === 'parked');
  return (
    <div>
      <h2>Verhaallijnen</h2>
      {stories.length === 0 && <p className="muted">Nog geen verhaallijnen. Ze starten overdag vanzelf, of via "+1 verhaal".</p>}
      {stories.map((s) => (
        <div key={s.id} className="task">
          <b>{s.title}</b> · bungalow {s.houseNumber} · {s.household} · <span className={s.state === 'failed' ? 'err' : s.state === 'completed' ? 'ok' : ''}>{STORY_STATE[s.state] ?? s.state}</span>
          <div className="muted">{s.intro}</div>
          {s.state === 'active' && <div>Deel {s.chapter}/{s.chapters}: {s.chapterText ?? 'start zo'}{s.taskId ? ' (opdracht staat bij Incidenten)' : ' (volgende deel volgt zo)'}</div>}
          {s.endText && <div><i>{s.endText}</i></div>}
        </div>
      ))}
      <h2>Gasten in het park ({present.length} huishoudens)</h2>
      <table><tbody>{present.map((b) => (
        <tr key={b.id}><td>{b.houseNumber}</td><td><b>{b.household}</b>{b.story ? ` ★ ${b.story.title}` : ''}<div className="muted">{b.profile?.tagline}</div></td>
          <td>{b.guests.map((g: any) => `${g.name} (${g.role}, ${g.trait})`).join(', ')}</td><td>{Math.round(b.satisfaction * 100)}%</td></tr>
      ))}</tbody></table>
    </div>
  );
}
