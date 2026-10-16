// Guests and storylines for Harderwold. Three kinds of households (client, 15-10-2026):
//  - ordinary Dutch families (with kids, grandparents);
//  - artists on a songwriting camp: a writing team around a singer-songwriter or producer, working on a song or an
//    album for a (fictional) label;
//  - well-to-do guests: entrepreneurs, investors, a surgeon, a lawyer, with partner and kids.
// All built-in artists and wealthy guests are FICTIONAL. Real people only appear when the game master adds them as
// a cameo in /admin (with their permission); they then only get friendly, harmless storylines (no invented conflicts:
// storylines with noRealPeople never pick them). A storyline is a short multi-chapter arc around one household whose
// chapters are ordinary claimable tasks (story-only templates in tasklib). Pure data + generation: the game runs the
// arcs (src/server/stories.ts).
import { Effect } from './tasklib.ts';

export type Role =
  | 'zanger' | 'songwriter' | 'producer' | 'muzikant' | 'manager'
  | 'ondernemer' | 'investeerder' | 'directeur' | 'chirurg' | 'advocaat'
  | 'partner' | 'kind' | 'opa' | 'oma';
/** roles that can lead a household (and that a cameo guest added in /admin may have) */
export const GUEST_ROLES: Role[] = ['zanger', 'songwriter', 'producer', 'muzikant', 'manager', 'ondernemer', 'investeerder', 'directeur', 'chirurg', 'advocaat'];
export const ARTIST_ROLES: Role[] = ['zanger', 'songwriter', 'producer', 'muzikant'];
export const WEALTHY_ROLES: Role[] = ['ondernemer', 'investeerder', 'directeur', 'chirurg', 'advocaat'];
export const ROLE_NAMES: Record<Role, string> = {
  zanger: 'zanger', songwriter: 'songwriter', producer: 'producer', muzikant: 'muzikant', manager: 'manager',
  ondernemer: 'ondernemer', investeerder: 'investeerder', directeur: 'directeur', chirurg: 'chirurg', advocaat: 'advocaat',
  partner: 'partner', kind: 'kind', opa: 'opa', oma: 'oma',
};

export type HouseholdKind = 'familie' | 'artiest' | 'vermogend';
export const KIND_NAMES: Record<HouseholdKind, string> = { familie: 'familie', artiest: 'schrijverskamp', vermogend: 'vermogende gasten' };

/** 0 = nobody knows them, 1 = known in their world, 2 = well known (cameo added by the game master) */
export type Fame = 0 | 1 | 2;
export const FAME_NAMES = ['onbekend', 'bekend in de branche', 'bekende Nederlander'];

export interface Guest { name: string; role: Role; trait: string; color: string }
export interface Household {
  name: string; kind: HouseholdKind;
  /** artists: the (fictional) record label; wealthy guests: their (fictional) company; families: '' */
  label: string;
  /** artists: what they are writing; wealthy guests: what brings them here; families: '' */
  project: string;
  fame: Fame;
  /** short one-line profile for the test client and the projector */
  tagline: string;
  /** key of a cameo guest added by the game master in /admin (a real person) */
  celebrity?: string;
}

// ---------------------------------------------------------------- cameo guests (game master, /admin)
export interface Cameo { key: string; name: string; role: Role; tagline: string; companions: Role[] }
/** Built-in list of real public figures: empty. The game master can add cameo guests (with their permission). */
export const CELEBRITIES: Cameo[] = [];
/** share of arriving households that is a cameo guest, as long as there are cameos not yet in the park */
export const CELEBRITY_SHARE = 0.3;

/** Names and cameo guests added by the game master (/admin, stored in the database). */
export const customNames: { first: string[]; surnames: string[]; kids: string[]; cameos: Cameo[] } = { first: [], surnames: [], kids: [], cameos: [] };
export function setCustomNames(n: Partial<typeof customNames>) {
  customNames.first = [...(n.first ?? [])]; customNames.surnames = [...(n.surnames ?? [])]; customNames.kids = [...(n.kids ?? [])]; customNames.cameos = [...(n.cameos ?? [])];
}

// ---------------------------------------------------------------- fictional artists, labels, companies (story copy)
/** fictional singer-songwriters and producers (stage names) */
export const ARTISTS: { name: string; role: Role }[] = [
  { name: 'Mila Verbeek', role: 'zanger' }, { name: 'Jens Hoogland', role: 'songwriter' }, { name: 'Noa Brink', role: 'zanger' },
  { name: 'Sam Lindeboom', role: 'producer' }, { name: 'Isa Vermeer', role: 'songwriter' }, { name: 'Ruben Calis', role: 'zanger' },
  { name: 'Lotte Haverkamp', role: 'songwriter' }, { name: 'Daan Wolters', role: 'producer' }, { name: 'Femke Ridder', role: 'zanger' },
  { name: 'Joep Arends', role: 'muzikant' }, { name: 'Zoë Kramer', role: 'songwriter' }, { name: 'Thijs Valk', role: 'zanger' },
  { name: 'Anouk Brand', role: 'producer' }, { name: 'Milan de Smet', role: 'songwriter' }, { name: 'Elin Bosman', role: 'zanger' },
  { name: 'Bas Overdijk', role: 'muzikant' }, { name: 'Roos Lanting', role: 'songwriter' }, { name: 'Victor Holst', role: 'producer' },
];
export const LABELS = ['Noorderlicht Records', 'Veluwe Music', 'Grachtengeluid', 'Polderpop', 'Studio Harderhaven', 'Lichtmast Muziek', 'Zuiderzee Songs', 'Kwartnoot Records'];
export const SONG_PROJECTS = ['een nieuwe zomerhit', 'het tweede album', 'een filmsong', 'een duet', 'het songfestivalnummer', 'een kerstsingle', 'de titelsong van een serie', 'een akoestische ep'];
export const COMPANIES = ['Nordwind Capital', 'Harder Holding', 'Veluwe Vastgoed', 'De Grachtenbank', 'Lindeboom & Partners', 'Zuiderhaven Logistiek', 'Kroonduin Advocaten', 'MedTech Elburg'];
export const WEALTHY_PROJECTS = ['een golfweekend met zakenpartners', 'de verjaardag van de partner', 'een overname die bijna rond is', 'een weekje rust na een drukke maand', 'het jubileum van het bedrijf', 'een nieuw jacht dat ze willen uitproberen'];
/** ordinary Dutch surnames (families) and double-barrelled fictional surnames (wealthy guests) */
const SURNAMES = ['De Vries', 'Jansen', 'De Jong', 'Bakker', 'Visser', 'Meijer', 'De Boer', 'Mulder', 'De Groot', 'Bos', 'Vos', 'Peters', 'Hendriks', 'Van Dijk', 'Dekker', 'Brouwer', 'Kok', 'Jacobs', 'Van der Linden', 'Willems', 'Van den Berg', 'Verhoeven', 'Kuipers', 'Postma'];
const POSH = ['Van Eckelen-Morel', 'Ten Velde-Hoorn', 'Van Asperen-Blom', 'De Wit-Lagerweij', 'Van Harteveld', 'Bosch van Drakestein-Kok', 'Van der Meulen-Staal', 'Ter Hoeve-Lindeman', 'Van Oosterzee', 'De Klerck-Huysman'];
const FIRST = ['Sanne', 'Joost', 'Fleur', 'Bram', 'Noor', 'Daan', 'Lotte', 'Ruben', 'Eva', 'Thijs', 'Mila', 'Gijs', 'Saar', 'Teun', 'Jasmijn', 'Wouter', 'Merel', 'Koen', 'Floor', 'Sem'];
const KIDS = ['Pien', 'Finn', 'Lieke', 'Mees', 'Juul', 'Siem', 'Bo', 'Tijn'];
const OLD = { opa: ['Opa Henk', 'Opa Kees', 'Opa Wim'], oma: ['Oma Riek', 'Oma Truus', 'Oma Ans'] };
const ARTIST_TRAITS = ['nachtmens', 'perfectionist', 'altijd een melodie in het hoofd', 'chaotisch', 'gezellig', 'nieuwsgierig', 'vroege vogel', 'koffieliefhebber'];
const WEALTHY_TRAITS = ['veeleisend', 'gul met fooien', 'altijd aan de telefoon', 'golfliefhebber', 'zeer beleefd', 'houdt van stipt', 'gezellig', 'wijnkenner'];
const PLAIN_TRAITS = ['geduldig', 'veeleisend', 'vergeetachtig', 'luidruchtig', 'vroege vogel', 'gezellig', 'nieuwsgierig', 'mopperig'];
const CLOTHES = ['#d9534f', '#3a6ea5', '#f0ad4e', '#5cb85c', '#f7f7f2', '#7b5ea7', '#2b2b2b', '#e88aa8', '#46a5a0', '#c9a227'];
/** share of the three kinds among households that are not cameo guests */
export const KIND_SHARE: Record<HouseholdKind, number> = { familie: 0.5, artiest: 0.25, vermogend: 0.25 };

type R = { next(): number; int(lo: number, hi: number): number; pick<T>(a: T[]): T };

/** A new household (seeded). `taken` = cameo keys already in the park (each cameo guest stays in at most one villa at a
 *  time). Otherwise an ordinary family, a songwriting team or well-to-do guests (KIND_SHARE). */
export function makeHousehold(r: R, taken: Set<string> = new Set()): { household: Household; guests: Guest[] } {
  const FIRST_ = [...FIRST, ...customNames.first], KIDS_ = [...KIDS, ...customNames.kids], SURN_ = [...SURNAMES, ...customNames.surnames];
  const used = new Set<string>();
  const person = (role: Role, traits: string[]): Guest => {
    const pool = role === 'kind' ? KIDS_ : role === 'opa' ? OLD.opa : role === 'oma' ? OLD.oma : FIRST_;
    let name = r.pick(pool);
    for (let i = 0; i < 6 && used.has(name); i++) name = r.pick(pool);
    used.add(name);
    return { name, role, trait: r.pick(traits), color: r.pick(CLOTHES) };
  };
  const free = [...CELEBRITIES, ...customNames.cameos].filter((c) => !taken.has(c.key));
  if (free.length && r.next() < CELEBRITY_SHARE) {
    const c = r.pick(free);
    const artist = ARTIST_ROLES.includes(c.role);
    const guests: Guest[] = [{ name: c.name, role: c.role, trait: r.pick(artist ? ARTIST_TRAITS : WEALTHY_TRAITS), color: r.pick(CLOTHES) }, ...c.companions.map((role) => person(role, PLAIN_TRAITS))];
    return { household: { name: `Gezelschap ${c.name}`, kind: artist ? 'artiest' : 'vermogend', label: artist ? r.pick(LABELS) : r.pick(COMPANIES), project: artist ? r.pick(SONG_PROJECTS) : r.pick(WEALTHY_PROJECTS), fame: 2, tagline: c.tagline, celebrity: c.key }, guests };
  }
  const x = r.next();
  if (x < KIND_SHARE.artiest) {
    // songwriting team: a lead artist plus one to three co-writers, a producer or a musician
    const lead = r.pick(ARTISTS);
    const label = r.pick(LABELS), project = r.pick(SONG_PROJECTS);
    const co = r.pick([['songwriter'], ['producer'], ['songwriter', 'producer'], ['muzikant', 'songwriter'], ['songwriter', 'producer', 'muzikant']] as Role[][]);
    const guests: Guest[] = [{ name: lead.name, role: lead.role, trait: r.pick(ARTIST_TRAITS), color: r.pick(CLOTHES) }, ...co.map((role) => person(role, ARTIST_TRAITS))];
    used.add(lead.name);
    return { household: { name: `Schrijverskamp ${lead.name}`, kind: 'artiest', label, project, fame: 1, tagline: `${lead.name} (${ROLE_NAMES[lead.role]}) schrijft hier aan ${project} voor ${label}` }, guests };
  }
  if (x < KIND_SHARE.artiest + KIND_SHARE.vermogend) {
    const surname = r.pick(POSH), role = r.pick(WEALTHY_ROLES), company = r.pick(COMPANIES), project = r.pick(WEALTHY_PROJECTS);
    const rest = r.pick([['partner'], ['partner', 'kind'], ['partner', 'kind', 'kind']] as Role[][]);
    const guests: Guest[] = [person(role, WEALTHY_TRAITS), ...rest.map((ro) => person(ro, PLAIN_TRAITS))];
    return { household: { name: `Familie ${surname}`, kind: 'vermogend', label: company, project, fame: 1, tagline: `${guests[0].name} ${surname} (${ROLE_NAMES[role]}, ${company}) is hier voor ${project}` }, guests };
  }
  const roles: Role[] = r.pick([['partner', 'partner'], ['partner', 'partner', 'kind'], ['partner', 'partner', 'kind', 'kind'], ['partner', 'opa', 'oma'], ['partner', 'partner', 'kind', 'opa']] as Role[][]);
  const guests = roles.map((role) => person(role, PLAIN_TRAITS));
  const surname = r.pick(SURN_);
  return { household: { name: `Familie ${surname}`, kind: 'familie', label: '', project: '', fame: 0, tagline: `Familie ${surname} is een weekje op vakantie aan het water` }, guests };
}

// ---------------------------------------------------------------- storylines
/** Text variables in story copy and story task texts: {lead} (lead guest name), {role}, {household}, {label}, {project}, {n}, {loc}. */
export interface StoryChapter {
  /** narration shown on the projector when the chapter starts */
  text: string;
  /** story-only task template code; its location follows the template (house = the household's villa) */
  task: string;
  /** game minutes after the previous chapter was completed (first chapter: 0) */
  afterMin: number;
}
export interface StoryTemplate {
  code: string; title: string;
  /** the household needs a guest with one of these roles (the first match becomes {lead}) */
  roles: Role[];
  /** only for these kinds of households */
  kinds?: HouseholdKind[];
  minFame?: Fame;
  /** never for a real person (invented conflict or words put in someone's mouth) */
  noRealPeople?: boolean;
  /** only for these cameo guests (keys, '*' = any cameo guest without a storyline of their own) */
  celebrities?: string[];
  weight: number;
  intro: string;
  chapters: StoryChapter[];
  finale: string;
  /** told when a chapter task is not picked up in time or the household leaves */
  fail: string;
  /** applied to the household's villa (and its satisfaction) */
  onSuccess: Effect;
  onFail: Effect;
}
const ch = (text: string, task: string, afterMin: number): StoryChapter => ({ text, task, afterMin });
const ART: HouseholdKind[] = ['artiest'], RICH: HouseholdKind[] = ['vermogend'], FAM: HouseholdKind[] = ['familie'];

export const STORIES: StoryTemplate[] = [
  // ---------------------------------------------------------------- songwriting camp
  { code: 'STORY_WRITING_CAMP', title: 'Schrijverskamp in de villa', roles: ARTIST_ROLES, kinds: ART, weight: 1.4,
    intro: '{lead} schrijft deze week in villa {n} aan {project} voor {label}.',
    chapters: [ch('Er wordt geschreven in {loc}, maar de buren blazen blad. Stilte graag.', 'STY_CAMP_QUIET', 0), ch('De vleugel in {loc} is vals geworden. Er moet een pianostemmer komen.', 'STY_CAMP_PIANO', 25), ch('Het nummer is af. {lead} wil het laten horen in de brasserie.', 'STY_CAMP_DEMO_NIGHT', 30)],
    finale: 'De brasserie is stil, dan klinkt een applaus tot op de golfbaan. {label} wil het nummer meteen uitbrengen.', fail: 'Het schrijverskamp loopt vast. {lead} neemt de halve melodie mee naar huis.', onSuccess: { mood: 0.3 }, onFail: { mood: -0.15 } },
  { code: 'STORY_HOME_STUDIO', title: 'Thuisstudio aan de gracht', roles: ['producer', 'muzikant', 'zanger'], kinds: ART, weight: 1.2,
    intro: '{lead} bouwt in villa {n} een studio om {project} op te nemen.',
    chapters: [ch('De studioapparatuur laat de stroom uitvallen in {loc}.', 'STY_STUDIO_POWER', 0), ch('De glaspui galmt. {lead} wil dekens en matrassen voor de akoestiek.', 'STY_STUDIO_DAMPING', 20), ch('Alles is opgenomen. Nu nog uploaden naar {label}.', 'STY_STUDIO_UPLOAD', 25)],
    finale: 'De opnames staan bij {label}. In de liner notes staat: "opgenomen aan een gracht in Harderwold".', fail: 'De opnames komen te laat bij {label}. {lead} moet in de stad opnieuw beginnen.', onSuccess: { mood: 0.25, tech: 0.1 }, onFail: { mood: -0.15 } },
  { code: 'STORY_JETTY_SUNRISE', title: 'Inspiratie op de steiger', roles: ['songwriter', 'zanger'], kinds: ART, weight: 1.1,
    intro: '{lead} schrijft de mooiste regels bij zonsopgang, op het water.',
    chapters: [ch('{lead} wil om zes uur schrijven op de steiger van {loc}.', 'STY_JETTY_SUNRISE', 0), ch('Een plank op de steiger zit los. De gitaar viel er bijna door.', 'STY_JETTY_BOARD', 20), ch('Voor het refrein wil {lead} een rondje varen.', 'STY_JETTY_SLOEP', 25)],
    finale: 'Het refrein gaat over een sloep bij zonsopgang. Het wordt het mooiste nummer van {project}.', fail: 'De inspiratie is weg. {lead} schrijft een nummer over een losse plank.', onSuccess: { mood: 0.25 }, onFail: { mood: -0.1 } },
  { code: 'STORY_DEADLINE', title: 'Deadline voor de hit', roles: ARTIST_ROLES, kinds: ART, weight: 1.1,
    intro: '{label} wil morgen het refrein van {project}. {lead} heeft nog geen woord.',
    chapters: [ch('Er moet koffie komen in {loc}. Veel koffie.', 'STY_DEADLINE_COFFEE', 0), ch('{lead} wil de teksten op papier om te schrappen, maar de printer staakt.', 'STY_DEADLINE_PRINT', 20), ch('Om twee uur \'s nachts klinkt hetzelfde akkoord voor de veertigste keer. De buren zijn wakker.', 'STY_DEADLINE_NEIGHBOURS', 25)],
    finale: 'Om vier uur is het af. {label} stuurt een berichtje met drie vlammetjes.', fail: 'De deadline is gemist. {label} geeft {lead} nog een week, met een zucht.', onSuccess: { mood: 0.25 }, onFail: { mood: -0.15 } },
  { code: 'STORY_LISTENING_SESSION', title: 'Luistersessie bij de Residentie', roles: ['zanger', 'muzikant'], kinds: ART, weight: 1.2,
    intro: '{lead} wil de nieuwe nummers voor het eerst live spelen, voor de gasten van het park.',
    chapters: [ch('Er moet een klein podium komen in het gras bij de Residentie.', 'STY_LISTEN_STAGE', 0), ch('Het podium staat. Nu nog geluid dat niet piept.', 'STY_LISTEN_SOUND', 20), ch('Half het park komt eraan. Regel een nette rij en drinken.', 'STY_LISTEN_CROWD', 20)],
    finale: 'Het hele grasveld zingt mee met {lead}. Een avond om nooit te vergeten.', fail: 'De luistersessie gaat niet door. {lead} speelt alleen voor de eenden bij de steiger.', onSuccess: { mood: 0.3 }, onFail: { mood: -0.1 } },
  { code: 'STORY_LOST_LYRICS', title: 'Het verloren notitieboek', roles: ARTIST_ROLES, kinds: ART, weight: 1,
    intro: 'Het notitieboek van {lead} met alle teksten voor {project} is weg.',
    chapters: [ch('Misschien is het ingeleverd bij de gevonden voorwerpen.', 'STY_LYRICS_LOSTFOUND', 0), ch('Een golfer zag een zwart boekje bij de driving range.', 'STY_LYRICS_RANGE', 15)],
    finale: 'Het boekje is terug, met een golfbalafdruk op de kaft. {lead} noemt het een geluksteken.', fail: 'Het boekje blijft weg. {lead} moet alles uit het hoofd opnieuw schrijven.', onSuccess: { mood: 0.25 }, onFail: { mood: -0.15 } },
  // ---------------------------------------------------------------- well-to-do guests
  { code: 'STORY_PRIVATE_CHEF', title: 'Privekok in de villa', roles: WEALTHY_ROLES, kinds: RICH, weight: 1.2,
    intro: '{household} heeft een privekok laten komen voor een diner in villa {n}.',
    chapters: [ch('De kok mist truffel, kreeft en verse dragon.', 'STY_CHEF_GROCERIES', 0), ch('Net nu het begint, doet de stoomoven het niet.', 'STY_CHEF_OVEN', 20), ch('Er komen meer gasten dan gedacht. Extra glazen en borden!', 'STY_CHEF_GLASSES', 20)],
    finale: 'Een diner van vijf gangen op het terras aan de gracht. {lead} geeft de keukenploeg een dikke fooi.', fail: 'Het diner wordt een pizza-avond. Ook lekker, maar niet wat {lead} in gedachten had.', onSuccess: { mood: 0.3 }, onFail: { mood: -0.15 } },
  { code: 'STORY_OWN_BOAT', title: 'De eigen boot voor de deur', roles: WEALTHY_ROLES, kinds: RICH, weight: 1.1,
    intro: '{lead} komt met een eigen sloep van zeven meter, via het water.',
    chapters: [ch('De boot moet aanleggen aan de steiger van {loc}.', 'STY_YACHT_MOOR', 0), ch('De boot wil walstroom. Veilig graag.', 'STY_YACHT_POWER', 20), ch('{lead} wil met gasten een vaartocht maken met een picknickmand.', 'STY_YACHT_PICNIC', 25)],
    finale: 'De boot vaart door de grachten met een picknick aan boord. Alle buren zwaaien.', fail: 'De boot past niet bij de steiger. {lead} legt aan bij de buren, die zijn er niet blij mee.', onSuccess: { mood: 0.25 }, onFail: { mood: -0.15 } },
  { code: 'STORY_GOLF_DEAL', title: 'Zakendeal op de golfbaan', roles: ['ondernemer', 'investeerder', 'directeur'], kinds: RICH, weight: 1.2,
    intro: '{lead} van {label} wil de deal van het jaar rond maken op hole 9.',
    chapters: [ch('Er zijn twee schone golfkarren nodig voor de flight.', 'STY_DEAL_CART', 0), ch('De green van hole 9 moet er perfect bij liggen.', 'STY_DEAL_GREEN', 20), ch('Na de ronde: een rustige tafel op het terras.', 'STY_DEAL_LUNCH', 25)],
    finale: 'Een putt van vier meter, een handdruk en een glas bubbels. De deal is rond.', fail: 'De deal gaat niet door. "Volgende keer op een andere baan," zegt de zakenpartner.', onSuccess: { mood: 0.3 }, onFail: { mood: -0.15 } },
  { code: 'STORY_POOL_PARTY', title: 'Poolparty aan de gracht', roles: ['partner', 'ondernemer', 'investeerder'], kinds: RICH, weight: 1.1,
    intro: '{household} geeft vanavond een poolparty in villa {n}.',
    chapters: [ch('Het privezwembad moet minstens 28 graden zijn.', 'STY_POOLPARTY_HEAT', 0), ch('De buren vinden het gezellig, tot elf uur.', 'STY_POOLPARTY_NEIGHBOURS', 30), ch('Het feest is voorbij. Het zwembad ligt vol slingers.', 'STY_POOLPARTY_CLEANUP', 30)],
    finale: 'Een warm zwembad, lichtjes op de steiger en tevreden buren. Een geslaagd feest.', fail: 'Het water bleef koud en de buren klaagden. De party verhuist naar binnen.', onSuccess: { mood: 0.25, clean: 0.1 }, onFail: { mood: -0.15, clean: -0.1 } },
  { code: 'STORY_ART_DELIVERY', title: 'Kunst voor de villa', roles: WEALTHY_ROLES, kinds: RICH, weight: 0.9,
    intro: '{lead} heeft een beeldhouwwerk gekocht en wil het meteen op het terras van villa {n}.',
    chapters: [ch('Het beeld weegt 200 kilo en staat bij de slagboom.', 'STY_ART_DELIVERY', 0), ch('Het moet precies in het midden van het terras.', 'STY_ART_PLACE', 20)],
    finale: 'Het beeld staat. Bij zonsondergang valt de schaduw precies over de gracht. {lead} is sprakeloos.', fail: 'Het beeld blijft in de krat. {lead} laat het terugsturen naar de galerie.', onSuccess: { mood: 0.25 }, onFail: { mood: -0.1 } },
  // ---------------------------------------------------------------- families
  { code: 'STORY_GRANDMA_80', title: 'Oma wordt 80', roles: ['oma', 'opa'], kinds: FAM, weight: 1.2,
    intro: '{lead} van {household} wordt vandaag 80. De familie wil er een feest van maken.',
    chapters: [ch('Een taart met tachtig kaarsjes (of in elk geval veel).', 'STY_BDAY_CAKE', 0), ch('Versier het terras van {loc} met slingers en ballonnen.', 'STY_BDAY_DECOR', 20), ch('Als verrassing: een rondvaart door de grachten.', 'STY_BDAY_SLOEP', 25)],
    finale: '{lead} zegt dat dit de mooiste verjaardag ooit was. En dat is met tachtig jaar ervaring.', fail: 'Het feest blijft klein. {lead} vindt het eigenlijk wel best zo.', onSuccess: { mood: 0.3 }, onFail: { mood: -0.1 } },
  { code: 'STORY_GRANDPA_GOLF', title: 'Opa leert golfen', roles: ['opa'], kinds: FAM, weight: 1,
    intro: '{lead} van {household} heeft nog nooit een golfclub vastgehad, en wil het nu wel eens proberen.',
    chapters: [ch('Eerst naar de driving range: hoe sla je eigenlijk een bal?', 'STY_GRANDPA_RANGE', 0), ch('Op de baan belanden de ballen in de bunker, de vijver en het bos.', 'STY_GRANDPA_BALLS', 25)],
    finale: 'Op hole 3 slaat {lead} een bal die bijna in een keer op de green ligt. Het hele terras juicht.', fail: '{lead} vindt golf toch niks en gaat vissen bij de steiger.', onSuccess: { mood: 0.25 }, onFail: { mood: -0.05 } },
  { code: 'STORY_CANOE', title: 'Kano op avontuur', roles: ['kind'], kinds: FAM, weight: 1.1,
    intro: 'De kinderen van {household} gaan voor het eerst alleen met de kano de gracht op.',
    chapters: [ch('Ze zijn een gracht te ver gevaren en weten de weg niet meer terug.', 'STY_CANOE_LOST', 0), ch('Ze zijn terug, kletsnat maar blij.', 'STY_CANOE_DRY', 15)],
    finale: 'Bij de chocomelk vertellen de kinderen het verhaal al voor de derde keer. Het wordt steeds spannender.', fail: 'De kano gaat voorlopig aan de ketting. De kinderen spelen weer in de speeltuin.', onSuccess: { mood: 0.25 }, onFail: { mood: -0.1 } },
  { code: 'STORY_HEDGE_FEUD', title: 'Ruzie over de haag', roles: ['partner'], kinds: FAM, noRealPeople: true, weight: 0.9,
    intro: '{lead} van {household} vindt dat de haag van de buren een meter te hoog is. De buren vinden van niet.',
    chapters: [ch('Over de haag bij {loc} wordt luidkeels gediscussieerd. Andere gasten pakken popcorn.', 'STY_FEUD_MEDIATE', 0), ch('Nu gaat het over wiens sloep aan welke kant van de steiger ligt.', 'STY_FEUD_JETTY', 20), ch('Er is vrede. Een gezamenlijke barbecue moet het bezegelen.', 'STY_FEUD_DINNER', 25)],
    finale: 'Na het toetje spreken ze af om volgend jaar weer naast elkaar te boeken.', fail: 'De ruzie blijft. Beide families schrijven een lange review.', onSuccess: { mood: 0.25 }, onFail: { mood: -0.2 } },
  // ---------------------------------------------------------------- cameo guests (real people added by the game master)
  { code: 'STORY_CELEB_GUEST', title: 'Een bekende gast', roles: [...GUEST_ROLES], celebrities: ['*'], weight: 1,
    intro: '{lead} logeert in villa {n}. Het hele park heeft het er al over.',
    chapters: [ch('Gasten hopen op een handtekening van {lead}. Er staat een rij bij de receptie.', 'STY_CELEB_AUTOGRAPH', 0), ch('{lead} wil rustig eten, maar de brasserie zit vol nieuwsgierige gasten.', 'STY_CELEB_QUIET_TABLE', 30)],
    finale: '{lead} bedankt het personeel en zwaait bij vertrek naar de hele receptie.', fail: 'Het werd te druk en {lead} at uiteindelijk thuis in de villa.', onSuccess: { mood: 0.25 }, onFail: { mood: -0.1 } },
];
export const storyByCode = new Map(STORIES.map((s) => [s.code, s]));

/** Fill story variables. */
export function storyText(s: string, v: Record<string, string>) { return s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)); }

/** Validation (also run by the tests): every chapter task exists, is story-only and has a sensible delay. */
export function validateStories(templates: Map<string, { storyOnly?: boolean }>): string[] {
  const out: string[] = [], codes = new Set<string>();
  for (const s of STORIES) {
    if (codes.has(s.code)) out.push(`dubbele verhaallijn ${s.code}`);
    codes.add(s.code);
    if (!s.roles.length) out.push(`${s.code}: geen rollen`);
    if (!s.chapters.length || s.chapters[0].afterMin !== 0) out.push(`${s.code}: eerste hoofdstuk moet direct starten`);
    for (const c of s.chapters) {
      const t = templates.get(c.task);
      if (!t) out.push(`${s.code}: onbekende opdracht ${c.task}`); else if (!t.storyOnly) out.push(`${s.code}: ${c.task} is geen verhaal-sjabloon`);
      if (c.afterMin < 0 || c.afterMin > 120) out.push(`${s.code}: wachttijd ${c.afterMin} buiten 0-120`);
    }
    if (!s.finale || !s.fail || !s.intro) out.push(`${s.code}: tekst ontbreekt`);
  }
  return out;
}
