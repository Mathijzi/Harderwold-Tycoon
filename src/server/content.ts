// Game-master content (/admin): extra guest names, cameo guests and own task templates. Stored in the database
// (survives a game reset and restarts) and merged into the built-in pools of guestlib / tasklib at runtime.
// Every own task is validated with the same rules as the built-in library before it is accepted.
import { DB } from './db.ts';
import { TEMPLATES, templateByCode, t as makeTemplate, Group, Difficulty, Urgency, LocationRule, validateLibrary } from '../shared/tasklib.ts';
import { setCustomNames, customNames, MEDIA_ROLES, Role, Cameo } from '../shared/guestlib.ts';

export interface NameLists { first: string[]; surnames: string[]; kids: string[]; cameos: { name: string; role: Role; tagline: string }[] }
export interface CustomTask {
  code: string; group: Exclude<Group, 'crisis'>; title: string; text: string; difficulty: Difficulty; urgency: Urgency;
  location: { kind: 'house' | 'facility' | 'grounds'; facilities?: string[] };
  /** relative scheduling weight (built-in templates use 0.3 - 1.4) */
  weight: number;
  when: 'altijd' | 'dag' | 'nacht';
}
export const GROUPS: Exclude<Group, 'crisis'>[] = ['onderhoud', 'schoonmaak', 'receptie', 'horeca', 'zwembad', 'fietsverhuur', 'terrein', 'natuur', 'animatie', 'chaos'];

export class ContentError extends Error { constructor(public problems: string[]) { super(problems.join('; ')); } }

const clean = (list: unknown, max = 60) => [...new Set((Array.isArray(list) ? list : []).map((x) => String(x ?? '').trim().replace(/\s+/g, ' ')).filter((x) => x.length >= 2 && x.length <= max))];
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export class ContentStore {
  tasks: CustomTask[] = [];
  constructor(private db: DB, private facilityKeys: () => Set<string>) {
    db.exec('CREATE TABLE IF NOT EXISTS custom_content (k TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)');
    try { const r = this.get('names'); if (r) this.applyNames(r as NameLists); } catch { /* corrupt row: start empty */ }
    try {
      for (const ct of (this.get('tasks') as CustomTask[] | undefined) ?? []) { try { this.register(ct); this.tasks.push(ct); } catch { /* skip invalid */ } }
    } catch { /* none */ }
  }
  private get(k: string) { const r = this.db.prepare('SELECT data FROM custom_content WHERE k = ?').get(k) as { data: string } | undefined; return r ? JSON.parse(r.data) : undefined; }
  private put(k: string, v: unknown) { this.db.prepare('INSERT INTO custom_content (k, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').run(k, JSON.stringify(v), Date.now()); }

  // ---------------------------------------------------------------- names
  names(): NameLists { return { first: customNames.first, surnames: customNames.surnames, kids: customNames.kids, cameos: customNames.cameos.map((c) => ({ name: c.name, role: c.role, tagline: c.tagline })) }; }
  setNames(n: Partial<NameLists>) {
    const problems: string[] = [];
    const cameos: Cameo[] = [];
    for (const [i, c] of (Array.isArray(n.cameos) ? n.cameos : []).entries()) {
      const name = String(c?.name ?? '').trim(), role = String(c?.role ?? '').trim() as Role, tagline = String(c?.tagline ?? '').trim();
      if (name.length < 2 || name.length > 60) { problems.push(`bekende gast ${i + 1}: naam ontbreekt`); continue; }
      if (!MEDIA_ROLES.includes(role)) { problems.push(`${name}: onbekende rol "${role}" (kies uit ${MEDIA_ROLES.join(', ')})`); continue; }
      cameos.push({ key: `eigen-${slug(name)}`, name, role, tagline: tagline || `${name} is een weekje op vakantie`, companions: ['partner'] });
    }
    if (problems.length) throw new ContentError(problems);
    const lists: NameLists = { first: clean(n.first, 30), surnames: clean(n.surnames, 40), kids: clean(n.kids, 30), cameos: cameos.map(({ name, role, tagline }) => ({ name, role, tagline })) };
    if (lists.first.length + lists.surnames.length + lists.kids.length + lists.cameos.length > 2000) throw new ContentError(['maximaal 2000 namen in totaal']);
    this.applyNames(lists);
    this.put('names', lists);
    return this.names();
  }
  private applyNames(l: NameLists) {
    setCustomNames({ first: l.first ?? [], surnames: l.surnames ?? [], kids: l.kids ?? [], cameos: (l.cameos ?? []).map((c) => ({ key: `eigen-${slug(c.name)}`, name: c.name, role: c.role, tagline: c.tagline, companions: ['partner'] as Role[] })) });
  }

  // ---------------------------------------------------------------- own tasks
  private toTemplate(ct: CustomTask) {
    const loc: LocationRule = ct.location.kind === 'facility' ? { kind: 'facility', facilities: ct.location.facilities ?? [] } : ct.location.kind === 'house' ? { kind: 'house', occupied: true } : { kind: 'grounds' };
    return makeTemplate(ct.group, ct.code, ct.title, ct.text, ct.difficulty, ct.urgency, ct.weight, { location: loc, when: ct.when === 'dag' ? { day: true } : ct.when === 'nacht' ? { night: true } : {} });
  }
  private register(ct: CustomTask) {
    const tpl = this.toTemplate(ct);
    const i = TEMPLATES.findIndex((x) => x.code === ct.code);
    const prev = i >= 0 ? TEMPLATES[i] : undefined;
    if (i >= 0) TEMPLATES[i] = tpl; else TEMPLATES.push(tpl);
    templateByCode.set(ct.code, tpl);
    const problems = validateLibrary(this.facilityKeys()).filter((p) => p.startsWith(`${ct.code}:`) || p.includes(ct.code));
    if (problems.length) {
      if (prev) { TEMPLATES[i] = prev; templateByCode.set(ct.code, prev); } else { TEMPLATES.splice(TEMPLATES.indexOf(tpl), 1); templateByCode.delete(ct.code); }
      throw new ContentError(problems);
    }
  }
  /** add or replace (same code) an own task; returns the stored definition */
  saveTask(input: Partial<CustomTask>) {
    const p: string[] = [];
    const title = String(input.title ?? '').trim(), text = String(input.text ?? '').trim();
    const group = input.group as CustomTask['group'];
    if (!GROUPS.includes(group)) p.push(`onbekende categorie (kies uit ${GROUPS.join(', ')})`);
    if (title.length < 3 || title.length > 60) p.push('titel moet 3-60 tekens zijn');
    if (text.length < 20 || text.length > 300) p.push('omschrijving moet 20-300 tekens zijn');
    if (!['easy', 'medium', 'hard'].includes(String(input.difficulty))) p.push('moeilijkheid moet easy, medium of hard zijn');
    if (!['normal', 'high', 'critical'].includes(String(input.urgency))) p.push('urgentie moet normal, high of critical zijn');
    const kind = input.location?.kind;
    if (!['house', 'facility', 'grounds'].includes(String(kind))) p.push('plek moet house, facility of grounds zijn');
    const facilities = kind === 'facility' ? [...new Set((Array.isArray(input.location?.facilities) ? input.location!.facilities : []).map((f) => String(f).trim().toUpperCase()).filter((f) => /^[A-Z]{1,2}$/.test(f)))] : undefined;
    if (kind === 'facility' && !facilities?.some((f) => this.facilityKeys().has(f))) p.push(`kies minstens één bestaande voorziening (${[...this.facilityKeys()].sort().join(', ')})`);
    const weight = Number(input.weight ?? 1);
    if (!(weight >= 0 && weight <= 3)) p.push('gewicht moet tussen 0 en 3 liggen (0 = alleen handmatig)');
    const when = (input.when ?? 'altijd') as CustomTask['when'];
    if (!['altijd', 'dag', 'nacht'].includes(when)) p.push('moment moet altijd, dag of nacht zijn');
    if (p.length) throw new ContentError(p);
    let code = String(input.code ?? '').trim();
    if (code && !this.tasks.some((x) => x.code === code)) throw new ContentError([`eigen opdracht ${code} bestaat niet`]);
    if (!code) { code = `CUST_${slug(title).replace(/-/g, '_').toUpperCase().slice(0, 30)}`; let n = 2; const base = code; while (templateByCode.has(code)) code = `${base}_${n++}`; }
    const ct: CustomTask = { code, group, title, text, difficulty: input.difficulty as Difficulty, urgency: input.urgency as Urgency, location: { kind: kind as CustomTask['location']['kind'], facilities }, weight, when };
    this.register(ct);
    const i = this.tasks.findIndex((x) => x.code === code);
    if (i >= 0) this.tasks[i] = ct; else this.tasks.push(ct);
    this.put('tasks', this.tasks);
    return ct;
  }
  deleteTask(code: string) {
    const i = this.tasks.findIndex((x) => x.code === code);
    if (i < 0) throw new ContentError([`eigen opdracht ${code} bestaat niet`]);
    this.tasks.splice(i, 1);
    const j = TEMPLATES.findIndex((x) => x.code === code);
    if (j >= 0) TEMPLATES.splice(j, 1);
    templateByCode.delete(code);
    this.put('tasks', this.tasks);
  }
}
