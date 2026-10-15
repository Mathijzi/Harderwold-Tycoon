// Guests and storylines for a media event. Households are well-known Dutch presenters and artists (real public
// figures, used with the organiser's permission) with their travel companions; when all of them are in the park the
// rest are ordinary families. Real people only get friendly, harmless storylines: no invented scandals, feuds or
// private matters (storylines that would put words or conflicts on a real person carry noRealPeople). Programmes and
// broadcasters in the copy are fictional. A storyline is a short multi-chapter arc around one household whose
// chapters are ordinary claimable tasks (story-only templates in tasklib). Pure data + generation: the game runs
// the arcs (src/server/stories.ts).
import { Effect } from './tasklib.ts';

export type Role =
  | 'presentator' | 'nieuwslezer' | 'weerpresentator' | 'radio-dj' | 'quizmaster' | 'realityster' | 'vlogger'
  | 'producent' | 'regisseur' | 'cameraman' | 'geluidstechnicus' | 'visagist' | 'omroepdirecteur' | 'talkshowgast'
  | 'soapacteur' | 'stagiair' | 'jingleproducent' | 'columnist' | 'artiest' | 'cabaretier'
  | 'partner' | 'kind' | 'opa' | 'oma';
export const MEDIA_ROLES: Role[] = ['presentator', 'nieuwslezer', 'weerpresentator', 'radio-dj', 'quizmaster', 'realityster', 'vlogger', 'producent', 'regisseur', 'cameraman', 'geluidstechnicus', 'visagist', 'omroepdirecteur', 'talkshowgast', 'soapacteur', 'stagiair', 'jingleproducent', 'columnist', 'artiest', 'cabaretier'];
export const ROLE_NAMES: Record<Role, string> = {
  presentator: 'presentator', nieuwslezer: 'nieuwslezer', weerpresentator: 'weerpresentator', 'radio-dj': 'radio-dj', quizmaster: 'quizmaster',
  realityster: 'realityster', vlogger: 'vlogger', producent: 'producent', regisseur: 'regisseur', cameraman: 'cameraman',
  geluidstechnicus: 'geluidstechnicus', visagist: 'visagist', omroepdirecteur: 'omroepdirecteur', talkshowgast: 'vaste talkshowgast',
  soapacteur: 'soapacteur', stagiair: 'stagiair', jingleproducent: 'jingleproducent', columnist: 'columnist', artiest: 'artiest', cabaretier: 'cabaretier',
  partner: 'partner', kind: 'kind', opa: 'opa', oma: 'oma',
};

/** 0 = nobody knows them, 1 = local celebrity, 2 = household name (BN'er) */
export type Fame = 0 | 1 | 2;
export const FAME_NAMES = ['onbekend', 'bekend in het Gooi', 'bekende Nederlander'];

export interface Guest { name: string; role: Role; trait: string; color: string }
export interface Household {
  name: string; omroep: string; show: string; fame: Fame;
  /** short one-line profile for the test client and the projector */
  tagline: string;
  /** key of a real public figure (BN list or a cameo added in /admin) */
  celebrity?: string;
}

// ---------------------------------------------------------------- well-known Dutch presenters and artists
export interface Cameo { key: string; name: string; role: Role; tagline: string; companions: Role[] }
const slugOf = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const TAG: Partial<Record<Role, string>> = {
  presentator: 'presentator', quizmaster: 'quizmaster', 'radio-dj': 'radio-dj', nieuwslezer: 'nieuwslezer', weerpresentator: 'weerpresentator',
  vlogger: 'vlogger', artiest: 'artiest', cabaretier: 'cabaretier', producent: 'tv-producent',
};
const COMPANIONS: Role[][] = [['partner'], ['partner', 'kind'], ['partner', 'kind', 'kind'], ['partner'], ['partner', 'oma']];
const bn = (role: Role, names: string[]): Cameo[] => names.map((name, i) => ({ key: slugOf(name), name, role, tagline: `${name}, ${TAG[role] ?? ROLE_NAMES[role]}, is een paar dagen op vakantie`, companions: COMPANIONS[i % COMPANIONS.length] }));
/** BN'ers (organiser has permission to use their names). Keep everything written about them kind and harmless. */
export const CELEBRITIES: Cameo[] = [
  { key: 'john-de-mol', name: 'John de Mol', role: 'producent', tagline: 'John de Mol, tv-producent, is een weekje op vakantie', companions: ['partner'] },
  { key: 'andre-van-duin', name: 'André van Duin', role: 'presentator', tagline: 'André van Duin, entertainer, geniet van een paar dagen rust', companions: ['partner'] },
  ...bn('presentator', ['Linda de Mol', 'Chantal Janzen', 'Humberto Tan', 'Wendy van Dijk', 'Martijn Krabbé', 'Caroline Tensen', 'Beau van Erven Dorens', 'Tijl Beckand', 'Art Rooijakkers', 'Ivo Niehe', 'Henny Huisman', 'Paul de Leeuw', 'Kees Tol', 'Rick Brandsteder', 'Nicolette Kluijver', 'Dionne Stax', 'Sophie Hilbrand', 'Tooske Ragas', 'Bridget Maasland', 'Eva Jinek', 'Jeroen Pauw']),
  ...bn('quizmaster', ['Herman van der Zandt', 'Philip Freriks', 'Frits Sissing']),
  ...bn('radio-dj', ['Edwin Evers', 'Giel Beelen', 'Gerard Ekdom', 'Coen Swijnenberg', 'Sander Lantinga', 'Frank Dane', 'Domien Verschuuren', 'Rob Stenders']),
  ...bn('nieuwslezer', ['Rob Trip', 'Annechien Steenhuizen']),
  ...bn('weerpresentator', ['Peter Timofeeff', 'Helga van Leur', 'Marco Verhoef']),
  ...bn('vlogger', ['Enzo Knol', 'Dylan Haegens', 'Monica Geuze']),
  ...bn('artiest', ['Jan Smit', 'Frans Bauer', 'Guus Meeuwis', 'Ilse DeLange', 'Waylon', 'Davina Michelle', 'Rob Kemps', 'Anouk', 'Trijntje Oosterhuis', 'Duncan Laurence', 'S10', 'Rolf Sanchez', 'Diggy Dex', 'Douwe Bob', 'Danny Vera', 'Nick Schilder', 'Simon Keizer', 'René Froger', 'Gerard Joling', 'Jeroen van der Boom', 'Dinand Woesthoff', 'Hans Klok', 'Jamai Loman', 'Kenny B', 'Maan', 'Snelle', 'Tino Martin']),
  ...bn('cabaretier', ['Najib Amhali', "Youp van 't Hek", 'Claudia de Breij', 'Theo Maassen', 'Brigitte Kaandorp', 'Freek de Jonge', 'Guido Weijers', 'Jochem Myjer', 'Hans Teeuwen', 'Arjen Lubach']),
];
/** share of arriving households that is a BN'er (as long as there are BN'ers not yet in the park) */
export const CELEBRITY_SHARE = 0.85;

/** Names and cameo guests added by the game master (/admin, stored in the database). Cameos join the BN pool. */
export const customNames: { first: string[]; surnames: string[]; kids: string[]; cameos: Cameo[] } = { first: [], surnames: [], kids: [], cameos: [] };
export function setCustomNames(n: Partial<typeof customNames>) {
  customNames.first = [...(n.first ?? [])]; customNames.surnames = [...(n.surnames ?? [])]; customNames.kids = [...(n.kids ?? [])]; customNames.cameos = [...(n.cameos ?? [])];
}

// ---------------------------------------------------------------- fictional programmes and broadcasters (story copy)
export const OMROEPEN = [
  'Omroep Heidebloem', 'Gooise Golf FM', 'Zendmast 3', 'Studio Lage Vuursche', 'Omroep De Kijkbuis', 'Radio Mediapark Noord',
  'Kanaal Kortenhoef', 'Omroep Antenne & Co', 'Streamdienst Kijkgraag', 'Regio-tv Gooi Live',
];
export const SHOWS = [
  'Goedemorgen Gooi', 'Het Vragenvuur', 'Bungalow Boys', 'De Jinglefabriek', 'Weer of Geen Weer', 'Talk van de Dag',
  'Zendtijd!', 'Wie Wordt Weerman', 'Prime-Tijd Live', 'Achter de Autocue', 'Het Mediaparkjournaal', 'Kookstudio Kortenhoef',
  'Zaterdagavondshow XL', 'De Soap aan de Vaart', 'Antennejagers',
];
/** ordinary Dutch surnames for the families that are not BN'ers */
const SURNAMES = ['De Vries', 'Jansen', 'De Jong', 'Bakker', 'Visser', 'Meijer', 'De Boer', 'Mulder', 'De Groot', 'Bos', 'Vos', 'Peters', 'Hendriks', 'Van Dijk', 'Dekker', 'Brouwer', 'Kok', 'Jacobs', 'Van der Linden', 'Willems', 'Van den Berg', 'Verhoeven', 'Kuipers', 'Postma'];
const FIRST = ['Sanne', 'Joost', 'Fleur', 'Bram', 'Noor', 'Daan', 'Lotte', 'Ruben', 'Eva', 'Thijs', 'Mila', 'Gijs', 'Saar', 'Teun', 'Jasmijn', 'Wouter', 'Merel', 'Koen', 'Floor', 'Sem'];
const KIDS = ['Pien', 'Finn', 'Lieke', 'Mees', 'Juul', 'Siem', 'Bo', 'Tijn'];
const OLD = { opa: ['Opa Henk', 'Opa Kees', 'Opa Wim'], oma: ['Oma Riek', 'Oma Truus', 'Oma Ans'] };
const BN_TRAITS = ['spontaan', 'gezellig', 'altijd in voor een grap', 'perfectionist', 'praatgraag', 'nieuwsgierig', 'vroege vogel', 'stressbestendig'];
const PLAIN_TRAITS = ['geduldig', 'veeleisend', 'vergeetachtig', 'luidruchtig', 'vroege vogel', 'gezellig', 'nieuwsgierig', 'mopperig'];
const CLOTHES = ['#d9534f', '#3a6ea5', '#f0ad4e', '#5cb85c', '#f7f7f2', '#7b5ea7', '#2b2b2b', '#e88aa8', '#46a5a0', '#c9a227'];

type R = { next(): number; int(lo: number, hi: number): number; pick<T>(a: T[]): T };

/** A new household (seeded). Mostly a BN'er with companions; `taken` = BN keys already in the park (each BN'er
 *  stays in at most one bungalow at a time). Otherwise an ordinary family with a normal Dutch surname. */
export function makeHousehold(r: R, taken: Set<string> = new Set()): { household: Household; guests: Guest[] } {
  const FIRST_ = [...FIRST, ...customNames.first], KIDS_ = [...KIDS, ...customNames.kids], SURN_ = [...SURNAMES, ...customNames.surnames];
  const omroep = r.pick(OMROEPEN), show = r.pick(SHOWS);
  const free = [...CELEBRITIES, ...customNames.cameos].filter((c) => !taken.has(c.key));
  const companion = (role: Role, used: Set<string>): Guest => {
    const pool = role === 'kind' ? KIDS_ : role === 'opa' ? OLD.opa : role === 'oma' ? OLD.oma : FIRST_;
    let name = r.pick(pool);
    for (let i = 0; i < 6 && used.has(name); i++) name = r.pick(pool);
    used.add(name);
    return { name, role, trait: r.pick(PLAIN_TRAITS), color: r.pick(CLOTHES) };
  };
  if (free.length && r.next() < CELEBRITY_SHARE) {
    const c = r.pick(free);
    const used = new Set<string>();
    const guests: Guest[] = [{ name: c.name, role: c.role, trait: r.pick(BN_TRAITS), color: r.pick(CLOTHES) }, ...c.companions.map((role) => companion(role, used))];
    return { household: { name: `Gezelschap ${c.name}`, omroep, show, fame: 2, tagline: c.tagline, celebrity: c.key }, guests };
  }
  const used = new Set<string>();
  const roles: Role[] = r.pick([['partner', 'partner'], ['partner', 'partner', 'kind'], ['partner', 'partner', 'kind', 'kind'], ['partner', 'opa', 'oma']] as Role[][]);
  const guests = roles.map((role) => companion(role, used));
  const surname = r.pick(SURN_);
  return { household: { name: `Familie ${surname}`, omroep, show, fame: 0, tagline: `Familie ${surname} is op vakantie (fan van tv en muziek)` }, guests };
}

// ---------------------------------------------------------------- storylines
/** Text variables in story copy and story task texts: {lead} (lead guest name), {role}, {household}, {omroep}, {show}, {loc}. */
export interface StoryChapter {
  /** narration shown on the projector when the chapter starts */
  text: string;
  /** story-only task template code; its location follows the template (house = the household's bungalow) */
  task: string;
  /** game minutes after the previous chapter was completed (first chapter: 0) */
  afterMin: number;
}
export interface StoryTemplate {
  code: string; title: string;
  /** the household needs a guest with one of these roles (the first match becomes {lead}) */
  roles: Role[];
  minFame?: Fame;
  /** never for a real person (invented conflict or words put in someone's mouth) */
  noRealPeople?: boolean;
  /** only for ordinary families (not for BN'ers) */
  familiesOnly?: boolean;
  /** only for these BN'ers (CELEBRITIES keys, '*' = any BN'er without a storyline of their own) */
  celebrities?: string[];
  weight: number;
  intro: string;
  chapters: StoryChapter[];
  finale: string;
  /** told when a chapter task is not picked up in time or the household leaves */
  fail: string;
  /** applied to the household's bungalow (and its satisfaction) */
  onSuccess: Effect;
  onFail: Effect;
}

export const STORIES: StoryTemplate[] = [
  { code: 'STORY_PAPARAZZI', title: 'Paparazzi in de rododendrons', roles: ['presentator', 'quizmaster', 'soapacteur', 'realityster', 'nieuwslezer', 'weerpresentator', 'talkshowgast', 'artiest', 'cabaretier', 'vlogger'], minFame: 2, weight: 1.2,
    intro: '{lead} ({role}, {show}) wilde rustig op vakantie. Een roddelfotograaf denkt daar anders over.',
    chapters: [
      { text: 'Er zit iemand met een telelens in de struiken bij {loc}.', task: 'STY_PAPARAZZI_BUSH', afterMin: 0 },
      { text: 'De fotograaf is weg, maar de gordijnen van {lead} blijven dicht. Tijd voor wat privacy.', task: 'STY_PAPARAZZI_SCREEN', afterMin: 20 },
      { text: '{lead} durft weer naar buiten, maar liever niet naar het restaurant.', task: 'STY_PAPARAZZI_BREAKFAST', afterMin: 30 },
    ],
    finale: '{lead} ontbijt ongestoord op het terras. Geen enkele foto in de bladen.', fail: 'Er duiken wazige vakantiefoto\'s van {lead} op internet op. Jammer van de rust.',
    onSuccess: { mood: 0.25 }, onFail: { mood: -0.2 } },
  { code: 'STORY_LIVE_RADIO', title: 'Live vanuit de bungalow', roles: ['radio-dj'], weight: 1.2,
    intro: '{lead} presenteert deze week de ochtendshow van {omroep} live vanuit bungalow {n}.',
    chapters: [
      { text: 'De zendapparatuur van {lead} laat steeds de stroom uitvallen in {loc}.', task: 'STY_RADIO_POWER', afterMin: 0 },
      { text: 'De show is live. De buren vinden de jingles om zes uur \'s ochtends iets minder leuk.', task: 'STY_RADIO_NEIGHBOURS', afterMin: 25 },
      { text: '{lead} heeft op de radio gezegd dat luisteraars langs mogen komen. Er staat een rij bij de receptie.', task: 'STY_RADIO_FANS', afterMin: 30 },
    ],
    finale: 'De laatste uitzending eindigt met een groet aan het hele park. Het park is landelijk op de radio geweest.', fail: '{lead} zegt live op de radio dat het park "nog wat moet oefenen".',
    onSuccess: { mood: 0.2, tech: 0.1 }, onFail: { mood: -0.2 } },
  { code: 'STORY_REALITY', title: 'Opnames van een realityshow', roles: ['realityster', 'producent', 'regisseur', 'cameraman'], weight: 1.1,
    intro: 'De makers van {show} willen een aflevering opnemen in en rond bungalow {n}.',
    chapters: [
      { text: 'De crew van {show} staat met camera\'s bij de receptie, maar heeft nog geen draaitoestemming.', task: 'STY_REALITY_PERMIT', afterMin: 0 },
      { text: 'Er is gefilmd. {loc} ligt vol confetti, nepbloemen en een kapotte tuinstoel.', task: 'STY_REALITY_CLEANUP', afterMin: 25 },
      { text: 'Voor de slotscène wil de regie een "spontaan" kampvuurfeest. Met vergunning, en veilig graag.', task: 'STY_REALITY_FINALE', afterMin: 30 },
    ],
    finale: 'De aflevering is in de pocket. Het park staat straks in de aftiteling.', fail: 'De crew vertrekt boos. In de aflevering heet het park nu "Camping Chaos".',
    onSuccess: { mood: 0.2, clean: 0.1 }, onFail: { mood: -0.15, clean: -0.1 } },
  { code: 'STORY_QUIZ_VOICE', title: 'De quizmaster is de stem kwijt', roles: ['quizmaster'], weight: 1,
    intro: '{lead} presenteert morgen een live-aflevering van {show}, maar klinkt als een krakende deur.',
    chapters: [
      { text: '{lead} fluistert dat er honingthee nodig is. Veel honingthee.', task: 'STY_QUIZ_TEA', afterMin: 0 },
      { text: 'De stem komt terug. Nu wil {lead} oefenen met een echt publiek.', task: 'STY_QUIZ_REHEARSAL', afterMin: 25 },
      { text: 'De oefenquiz was een succes. {lead} wil de vragenkaartjes laten printen, maar de printer bij de receptie weigert.', task: 'STY_QUIZ_PRINT', afterMin: 20 },
    ],
    finale: '{lead} klinkt weer als vanouds. Het park krijgt een bedankje in de uitzending.', fail: '{lead} moet de uitzending afzeggen en geeft "de boslucht" de schuld.',
    onSuccess: { mood: 0.2 }, onFail: { mood: -0.15 } },
  { code: 'STORY_WEATHER', title: 'Het weerbericht zat ernaast', roles: ['weerpresentator'], weight: 1,
    intro: '{lead} voorspelde op tv een stralende week. Het park weet inmiddels wie dat was.',
    chapters: [
      { text: 'Het regent pijpenstelen. Gasten wijzen naar bungalow {n} en mopperen bij de receptie.', task: 'STY_WEATHER_COMPLAINTS', afterMin: 0 },
      { text: 'Het water loopt niet weg op het pad bij {loc}.', task: 'STY_WEATHER_PUDDLE', afterMin: 20 },
      { text: '{lead} wil het goedmaken met een binnenactiviteit voor alle natte kinderen.', task: 'STY_WEATHER_INDOOR', afterMin: 25 },
    ],
    finale: 'De zon breekt door, precies zoals {lead} "eigenlijk al bedoelde". Applaus bij de bowling.', fail: '{lead} vertrekt verbitterd en voorspelt het park voorlopig alleen nog onweer.',
    onSuccess: { mood: 0.2 }, onFail: { mood: -0.15 } },
  { code: 'STORY_SCOOP', title: 'Een scoop in het bos', roles: ['nieuwslezer', 'columnist'], weight: 0.9,
    intro: '{lead} van {omroep} is ervan overtuigd dat er in het park "iets groots" speelt.',
    chapters: [
      { text: '{lead} wil een rustige werkplek voor een live-verbinding. Het wifi in {loc} haalt 2 kbit/s.', task: 'STY_SCOOP_WIFI', afterMin: 0 },
      { text: 'De scoop blijkt een reiger die elke dag dezelfde vis steelt. {lead} wil hem toch filmen.', task: 'STY_SCOOP_HERON', afterMin: 25 },
      { text: 'Het item is af. {lead} wil een kleine kijkavond houden in de horeca.', task: 'STY_SCOOP_VIEWING', afterMin: 25 },
    ],
    finale: '"De reiger van het park" wordt het best bekeken item van de week.', fail: 'Er komt geen item. {lead} schrijft een column over "het slechtste wifi van Nederland".',
    onSuccess: { mood: 0.2, tech: 0.1 }, onFail: { mood: -0.15 } },
  { code: 'STORY_TALKSHOW_FEUD', title: 'Ruzie tussen talkshowgasten', roles: ['talkshowgast', 'columnist', 'omroepdirecteur'], noRealPeople: true, weight: 0.9,
    intro: '{lead} ontdekt dat de buren een tafelgenoot uit {show} zijn, met wie het al jaren niet botert.',
    chapters: [
      { text: 'Over de heg bij {loc} wordt luidkeels gedebatteerd. Gasten pakken popcorn.', task: 'STY_FEUD_MEDIATE', afterMin: 0 },
      { text: 'Er is een wapenstilstand. Een verzoeningsdiner moet het bezegelen.', task: 'STY_FEUD_DINNER', afterMin: 30 },
    ],
    finale: 'Na het dessert besluiten ze samen een podcast te beginnen. Over vakantieparken.', fail: 'De ruzie gaat verder in de talkshow. Het park wordt drie keer genoemd, en niet positief.',
    onSuccess: { mood: 0.25 }, onFail: { mood: -0.2 } },
  { code: 'STORY_INFLUENCER', title: 'De perfecte content', roles: ['vlogger', 'realityster'], weight: 1.1,
    intro: '{lead} heeft een deal met {omroep}: elke dag een video uit het park.',
    chapters: [
      { text: '{lead} wil om acht uur filmen in een leeg zwembad. "Voor de esthetiek."', task: 'STY_INFLU_POOL', afterMin: 0 },
      { text: 'Volgende video: een bakfiets met ringlamp en een drone erachteraan.', task: 'STY_INFLU_BAKFIETS', afterMin: 25 },
      { text: 'De unboxing-video is opgenomen. {loc} ligt vol verpakkingsmateriaal en glitter.', task: 'STY_INFLU_GLITTER', afterMin: 25 },
    ],
    finale: 'De video gaat viraal. "Beste bungalow ooit," zegt {lead} tegen 300.000 volgers.', fail: '{lead} plaatst een video met de titel "Ik ben zo teleurgesteld".',
    onSuccess: { mood: 0.25 }, onFail: { mood: -0.2 } },
  { code: 'STORY_SOAP_SCRIPT', title: 'Het gelekte script', roles: ['soapacteur', 'regisseur', 'producent'], weight: 0.9,
    intro: '{lead} neemt het geheime script van het seizoensslot van {show} mee op vakantie. Wat kan er misgaan?',
    chapters: [
      { text: 'Het script is weg. {lead} denkt dat het bij de receptie is blijven liggen.', task: 'STY_SOAP_SEARCH', afterMin: 0 },
      { text: 'Gevonden, maar een paar bladzijden zijn nat geworden in {loc}. Ze moeten snel drogen.', task: 'STY_SOAP_DRY', afterMin: 20 },
      { text: 'Bij het restaurant fluisteren gasten het einde al na. Tijd voor een afleidingsmanoeuvre.', task: 'STY_SOAP_DECOY', afterMin: 20 },
    ],
    finale: 'Het geheim is veilig. Niemand weet dat de tweelingbroer terugkomt.', fail: 'Het einde van {show} staat op internet. De regisseur belt {lead} elk kwartier.',
    onSuccess: { mood: 0.2 }, onFail: { mood: -0.15 } },
  { code: 'STORY_JINGLE', title: 'Het geluid van het bos', roles: ['jingleproducent', 'geluidstechnicus', 'radio-dj', 'artiest'], weight: 0.8,
    intro: '{lead} wil een nieuwe jingle voor {omroep} maken met alleen geluiden uit het park.',
    chapters: [
      { text: '{lead} neemt vogelgeluid op bij {loc}, maar een bladblazer verpest elke opname.', task: 'STY_JINGLE_SILENCE', afterMin: 0 },
      { text: 'Voor het refrein is een koor nodig. "Twintig gasten, allemaal vals, dat is de charme."', task: 'STY_JINGLE_CHOIR', afterMin: 25 },
    ],
    finale: 'De jingle is klaar en klinkt vanaf morgen elk uur op de radio. Je hoort er een eend in.', fail: 'De jingle wordt "De Bladblazer". {lead} is er niet blij mee.',
    onSuccess: { mood: 0.2 }, onFail: { mood: -0.12 } },
  { code: 'STORY_DIRECTOR_TEAMDAY', title: 'Teamdag van de omroep', roles: ['omroepdirecteur', 'producent'], weight: 0.8,
    intro: '{lead} heeft de hele redactie van {omroep} uitgenodigd voor een teamdag in het park.',
    chapters: [
      { text: 'Er komen 24 redacteuren aan. {lead} wil tandems voor iedereen.', task: 'STY_TEAMDAY_BIKES', afterMin: 0 },
      { text: 'Na de fietstocht wil het team een lunch, liefst glutenvrij, vegan en "met een twist".', task: 'STY_TEAMDAY_LUNCH', afterMin: 30 },
      { text: 'Afsluiter: een teambuildingspel. {lead} wil iets "met vertrouwen en zonder valpartijen".', task: 'STY_TEAMDAY_GAME', afterMin: 30 },
    ],
    finale: 'De redactie gaat moe en tevreden naar huis. {omroep} boekt volgend jaar opnieuw.', fail: 'De redactie maakt een satirisch item over de teamdag. Raad eens waar die was.',
    onSuccess: { mood: 0.25 }, onFail: { mood: -0.15 } },
  { code: 'STORY_INTERN_CAMERA', title: 'De stagiair en de dure camera', roles: ['stagiair', 'cameraman'], weight: 0.9,
    intro: 'De stagiair van {show} heeft de camera van 40.000 euro "even ergens neergelegd".',
    chapters: [
      { text: 'De camera is niet in {loc}. Misschien bij de gevonden voorwerpen?', task: 'STY_INTERN_LOSTFOUND', afterMin: 0 },
      { text: 'Iemand zag een camera in een fietsmandje van de verhuur.', task: 'STY_INTERN_BIKE', afterMin: 15 },
    ],
    finale: 'De camera is terug, zonder kras. De stagiair krijgt een vaste aanstelling (bij de koffie).', fail: 'De camera blijft weg. De stagiair overweegt een carrière buiten de media.',
    onSuccess: { mood: 0.2 }, onFail: { mood: -0.1 } },
];
STORIES.push(
  { code: 'STORY_GIG', title: 'Spontaan optreden', roles: ['artiest'], weight: 1.4,
    intro: '{lead} is op vakantie in bungalow {n}, maar het park hoopt stiekem op een liedje.',
    chapters: [
      { text: '{lead} wil best een paar nummers spelen op het terras. Er is een klein podium nodig.', task: 'STY_GIG_STAGE', afterMin: 0 },
      { text: 'Het podium staat. Nu nog geluid dat niet piept of kraakt.', task: 'STY_GIG_SOUND', afterMin: 20 },
      { text: 'Het halve park komt eraan. Regel een nette rij en drinken voor iedereen.', task: 'STY_GIG_CROWD', afterMin: 20 },
    ],
    finale: 'Het hele terras zingt mee met {lead}. Een avond om nooit te vergeten.', fail: 'Het optreden gaat niet door. {lead} speelt alleen een liedje voor de eenden.',
    onSuccess: { mood: 0.3 }, onFail: { mood: -0.1 } },
  { code: 'STORY_TRYOUT', title: 'Try-out in De Tent', roles: ['cabaretier'], weight: 1.4,
    intro: '{lead} wil in het park in alle rust nieuw materiaal uitproberen.',
    chapters: [
      { text: 'Voor de try-out van {lead} zijn stoelen en een spotje nodig in De Tent.', task: 'STY_TRYOUT_SETUP', afterMin: 0 },
      { text: 'Iedereen wil erbij zijn. Deel bij de receptie gratis kaartjes uit.', task: 'STY_TRYOUT_TICKETS', afterMin: 20 },
      { text: 'Na de voorstelling wil {lead} graag napraten met het publiek bij een hapje.', task: 'STY_TRYOUT_AFTER', afterMin: 30 },
    ],
    finale: 'De zaal lag dubbel. {lead} bedankt het park voor het beste try-outpubliek ooit.', fail: 'De try-out wordt afgeblazen. {lead} oefent de grappen dan maar op de buren.',
    onSuccess: { mood: 0.3 }, onFail: { mood: -0.1 } },
  { code: 'STORY_CELEB_JOHN', title: 'Talentenjacht in het park', roles: ['producent'], celebrities: ['john-de-mol'], weight: 3,
    intro: '{lead} is op vakantie in bungalow {n}. Het hele park heeft het er al over.',
    chapters: [
      { text: 'Gasten hopen op een handtekening van {lead}. Er staat een rij bij de receptie.', task: 'STY_CELEB_AUTOGRAPH', afterMin: 0 },
      { text: 'Bij de karaoke-avond durven ineens heel veel gasten het podium op. Je weet maar nooit wie er kijkt.', task: 'STY_CELEB_TALENT', afterMin: 30 },
    ],
    finale: 'Een gezellige avond met veel applaus. {lead} geniet zichtbaar van de rust en de bitterballen.', fail: 'De rij werd te lang en {lead} hield de gordijnen maar dicht. Jammer voor de fans.',
    onSuccess: { mood: 0.25 }, onFail: { mood: -0.1 } },
  { code: 'STORY_CELEB_ANDRE', title: 'Een bekende gast in het restaurant', roles: ['presentator'], celebrities: ['andre-van-duin'], weight: 3,
    intro: '{lead} logeert in bungalow {n}. Kinderen herkennen de stem al van ver.',
    chapters: [
      { text: 'Gasten hopen op een handtekening van {lead}. Er staat een rij bij de receptie.', task: 'STY_CELEB_AUTOGRAPH', afterMin: 0 },
      { text: '{lead} wil rustig eten, maar het restaurant zit vol nieuwsgierige gasten. Regel een rustig plekje.', task: 'STY_CELEB_QUIET_TABLE', afterMin: 30 },
    ],
    finale: '{lead} bedankt het personeel en zwaait bij vertrek naar de hele receptie.', fail: 'Het werd te druk en {lead} at uiteindelijk een boterham in de bungalow.',
    onSuccess: { mood: 0.25 }, onFail: { mood: -0.1 } },
  { code: 'STORY_CELEB_GUEST', title: 'Een bekende gast', roles: [...MEDIA_ROLES], celebrities: ['*'], weight: 1,
    intro: '{lead} logeert in bungalow {n} en wordt overal herkend.',
    chapters: [
      { text: 'Gasten hopen op een handtekening van {lead}. Er staat een rij bij de receptie.', task: 'STY_CELEB_AUTOGRAPH', afterMin: 0 },
      { text: '{lead} wil rustig eten, maar het restaurant zit vol nieuwsgierige gasten. Regel een rustig plekje.', task: 'STY_CELEB_QUIET_TABLE', afterMin: 30 },
    ],
    finale: '{lead} bedankt het personeel voor een heerlijk rustige vakantie.', fail: 'Het werd te druk en {lead} bleef de rest van de week binnen.',
    onSuccess: { mood: 0.25 }, onFail: { mood: -0.1 } },
);

const ch = (text: string, task: string, afterMin: number): StoryChapter => ({ text, task, afterMin });
STORIES.push(
  { code: 'STORY_RECORDING', title: 'Opnames voor een nieuw programma', roles: ['presentator', 'quizmaster'], weight: 1.2,
    intro: '{lead} wil in het park een proefaflevering van een nieuw programma opnemen.',
    chapters: [ch('Eerst afspraken maken bij de receptie: waar mag er gefilmd worden?', 'STY_REC_PERMIT', 0), ch('De Tent wordt studio. Er is extra licht en stroom nodig.', 'STY_REC_LIGHT', 20), ch('Nu nog publiek: wie wil er in de zaal zitten?', 'STY_REC_AUDIENCE', 25)],
    finale: 'De proefaflevering is opgenomen. {lead} bedankt het publiek met een buiging.', fail: 'De opnames worden verplaatst naar de studio. Jammer, het park had zo mooi in beeld gestaan.', onSuccess: { mood: 0.25 }, onFail: { mood: -0.1 } },
  { code: 'STORY_BIRTHDAY_RADIO', title: 'Verjaardag op de radio', roles: ['radio-dj'], weight: 1.1,
    intro: '{lead} wil live op de radio een jarige gast in het park verrassen.',
    chapters: [ch('Er moet een taart komen, met kaarsjes en een naam erop.', 'STY_BDAY_CAKE', 0), ch('De bungalow van de jarige moet versierd worden zonder dat die het merkt.', 'STY_BDAY_DECOR', 20), ch('Lok de jarige naar de receptie terwijl {lead} live gaat.', 'STY_BDAY_SECRET', 20)],
    finale: 'Live op de radio: een verraste jarige, een taart en het hele park zingt mee.', fail: 'De verrassing is uitgelekt. {lead} houdt het bij een felicitatie via de telefoon.', onSuccess: { mood: 0.3 }, onFail: { mood: -0.1 } },
  { code: 'STORY_WEATHER_JETTY', title: 'Het weerbericht vanaf de steiger', roles: ['weerpresentator'], weight: 1.1,
    intro: '{lead} wil het weerbericht deze week presenteren vanuit het park.',
    chapters: [ch('Er moet een mooie plek bij {loc} worden gevonden, met uitzicht op het water.', 'STY_WLIVE_SPOT', 0), ch('Voor de camera is stroom nodig, buiten, en veilig.', 'STY_WLIVE_POWER', 20), ch('Het gaat (natuurlijk) regenen tijdens de uitzending. Paraplu\'s!', 'STY_WLIVE_UMBRELLA', 20)],
    finale: 'Het weerbericht vanuit het park is een succes. Zon op de achtergrond, een eend in beeld.', fail: 'Het weerbericht komt toch weer uit de studio. Het park blijft net buiten beeld.', onSuccess: { mood: 0.25 }, onFail: { mood: -0.1 } },
  { code: 'STORY_NEWS_DESK', title: 'Noodstudio in de bungalow', roles: ['nieuwslezer'], weight: 1,
    intro: '{lead} moet onverwacht een nieuwsuitzending inspreken vanuit bungalow {n}.',
    chapters: [ch('De woonkamer van {loc} moet een nette studio worden: opruimen en een rustige achtergrond.', 'STY_DESK_TABLE', 0), ch('Stilte graag! De buren moeten even weten dat er opgenomen wordt.', 'STY_DESK_QUIET', 15), ch('Na de uitzending: sterke koffie voor {lead}.', 'STY_DESK_COFFEE', 20)],
    finale: 'De uitzending is vlekkeloos. Niemand zag dat er een badeend naast de laptop stond.', fail: 'Tijdens de uitzending blaft een hond. Een klein moment van landelijke bekendheid.', onSuccess: { mood: 0.2 }, onFail: { mood: -0.1 } },
  { code: 'STORY_VLOG_CHALLENGE', title: 'De parkchallenge', roles: ['vlogger'], weight: 1.2,
    intro: '{lead} bedenkt een challenge: binnen een uur alle voorzieningen van het park bezoeken.',
    chapters: [ch('Er zijn snelle fietsen nodig voor de challenge.', 'STY_VLOG_ROUTE', 0), ch('Fans hebben het gezien en komen massaal naar de receptie.', 'STY_VLOG_FANS', 20), ch('Eindpunt: de snackbar, met een frietje voor iedereen die meedeed.', 'STY_VLOG_SNACK', 20)],
    finale: 'De video van de parkchallenge wordt een hit. Het park staat nu bij duizenden op het verlanglijstje.', fail: 'De challenge strandt halverwege. {lead} maakt er toch nog een grappige video van.', onSuccess: { mood: 0.3 }, onFail: { mood: -0.1 } },
  { code: 'STORY_VIDEOCLIP', title: 'Videoclip in het bos', roles: ['artiest'], weight: 1.2,
    intro: '{lead} wil een deel van een nieuwe videoclip opnemen in het park.',
    chapters: [ch('Er is een mooie plek in het bos nodig bij {loc}, zonder auto\'s in beeld.', 'STY_CLIP_LOCATION', 0), ch('De regisseur zoekt figuranten die willen dansen.', 'STY_CLIP_EXTRAS', 20), ch('Na een lange opnamedag heeft de crew honger.', 'STY_CLIP_CATERING', 25)],
    finale: 'De clip is klaar. Wie goed kijkt, ziet het park voorbij komen in de tweede minuut.', fail: 'De opnames worden afgebroken. De clip wordt toch in de studio gemaakt.', onSuccess: { mood: 0.3 }, onFail: { mood: -0.1 } },
  { code: 'STORY_SINGALONG', title: 'Meezingen bij het kampvuur', roles: ['artiest'], weight: 1.2,
    intro: '{lead} pakt \'s avonds de gitaar en wil met gasten meezingen bij het kampvuur.',
    chapters: [ch('Er is een vuurkorf nodig op een veilige plek, met een emmer zand ernaast.', 'STY_SING_FIRE', 0), ch('Het wordt fris. Dekens voor iedereen!', 'STY_SING_BLANKETS', 20), ch('Geen kampvuur zonder marshmallows.', 'STY_SING_MARSHMALLOW', 15)],
    finale: 'Tot laat in de avond klinken de liedjes van {lead} over het park.', fail: 'Het kampvuur gaat niet door. {lead} zingt dan maar op het terras van de bungalow.', onSuccess: { mood: 0.3 }, onFail: { mood: -0.1 } },
  { code: 'STORY_KIDS_SHOW', title: 'Kindervoorstelling', roles: ['artiest', 'presentator', 'cabaretier'], weight: 1,
    intro: '{lead} wil voor de kinderen in het park een speciale voorstelling geven.',
    chapters: [ch('Het podium in het speelparadijs moet klaar.', 'STY_KIDS_STAGE', 0), ch('De kinderen willen geschminkt worden voor de voorstelling.', 'STY_KIDS_FACEPAINT', 15), ch('Na afloop: limonade en koekjes voor alle kinderen.', 'STY_KIDS_LEMONADE', 25)],
    finale: 'Een zaal vol kinderen die meezingen en meedansen. {lead} krijgt tekeningen als dank.', fail: 'De voorstelling wordt kort gehouden. De kinderen hadden graag meer gezien.', onSuccess: { mood: 0.3 }, onFail: { mood: -0.1 } },
  { code: 'STORY_CABARET_WALK', title: 'Inspiratiewandeling', roles: ['cabaretier'], weight: 1,
    intro: '{lead} zoekt in het park inspiratie voor nieuwe grappen.',
    chapters: [ch('{lead} wil een wandelkaart met de rustigste paden.', 'STY_WALK_MAP', 0), ch('Op het pad bij {loc} ligt een omgevallen boomstam. Opruimen!', 'STY_WALK_PATH', 20)],
    finale: '{lead} heeft drie nieuwe grappen. Eén ervan gaat over een eend.', fail: 'De wandeling valt in het water. Ook dat levert misschien een grap op.', onSuccess: { mood: 0.2 }, onFail: { mood: -0.05 } },
  { code: 'STORY_PUBQUIZ', title: 'Pubquiz in de Brasserie', roles: ['quizmaster', 'presentator', 'radio-dj'], weight: 1.2,
    intro: '{lead} biedt aan om vanavond een pubquiz te presenteren.',
    chapters: [ch('De Brasserie moet worden ingericht met teamtafels.', 'STY_QUIZ_TABLES', 0), ch('Er is een microfoon en een scherm nodig.', 'STY_QUIZ_SOUND', 20), ch('Wat is een quiz zonder prijzen? Haal ze bij de ParkShop.', 'STY_QUIZ_PRIZES', 20)],
    finale: 'Team "De Bungalowbazen" wint. {lead} reikt de prijzen uit onder luid applaus.', fail: 'De quiz loopt uit op een gezellige maar chaotische avond zonder winnaar.', onSuccess: { mood: 0.3 }, onFail: { mood: -0.1 } },
  { code: 'STORY_FORMAT_SCOUT', title: 'Op zoek naar een nieuw format', roles: ['producent'], weight: 1,
    intro: '{lead} kijkt rond of het park een mooi decor is voor een nieuw tv-format.',
    chapters: [ch('{lead} wil een rondleiding langs alle voorzieningen.', 'STY_SCOUT_TOUR', 0), ch('Na de rondleiding: een ruimte om het idee te bespreken, met koffie.', 'STY_SCOUT_PITCH', 25)],
    finale: '{lead} is enthousiast: "Hier zit een programma in." Het park houdt de adem in.', fail: '{lead} vertrekt vriendelijk maar zonder plannen. Misschien een volgende keer.', onSuccess: { mood: 0.25 }, onFail: { mood: -0.05 } },
  { code: 'STORY_FANCLUB', title: 'De fanclub komt op bezoek', roles: ['artiest'], weight: 1.1,
    intro: 'De fanclub van {lead} heeft gehoord dat hun idool in het park is.',
    chapters: [ch('Een bus vol fans meldt zich. Wijs ze een plek op de parkeerplaats.', 'STY_FAN_BUS', 0), ch('{lead} wil best op de foto. Regel een fotomoment bij de receptie.', 'STY_FAN_PHOTOS', 15), ch('Geef de fans iets te drinken voor de terugreis.', 'STY_FAN_DRINKS', 20)],
    finale: 'Blije fans, een volle telefoon met foto\'s en een tevreden {lead}.', fail: 'Het wordt te druk. De fanclub vertrekt zonder foto, maar met een mooi verhaal.', onSuccess: { mood: 0.3 }, onFail: { mood: -0.1 } },
  { code: 'STORY_RADIO_PRIZE', title: 'Prijsvraag op de radio', roles: ['radio-dj'], weight: 1.1,
    intro: '{lead} verstopt een gouden microfoon in het park. Luisteraars mogen hem zoeken.',
    chapters: [ch('De gouden microfoon moet ergens bij {loc} verstopt worden, zonder dat iemand het ziet.', 'STY_PRIZE_HIDE', 0), ch('Gasten komen om hints vragen bij de receptie.', 'STY_PRIZE_HINTS', 20), ch('Er is een winnaar! Een prijsuitreiking met muziek.', 'STY_PRIZE_WINNER', 25)],
    finale: 'De winnaar mag een plaat aanvragen bij {lead}. Het hele park luistert mee.', fail: 'Niemand vindt de microfoon. {lead} haalt hem zelf weer op, met een knipoog.', onSuccess: { mood: 0.3 }, onFail: { mood: -0.1 } },
  { code: 'STORY_COOKING', title: 'Kookwedstrijd met de chef', roles: ['presentator', 'artiest'], weight: 1,
    intro: '{lead} daagt de chef van De Brasserie uit voor een kookwedstrijd.',
    chapters: [ch('De keuken moet voor twee koks worden ingericht.', 'STY_COOK_KITCHEN', 0), ch('Een jury van gasten proeft en beoordeelt.', 'STY_COOK_JURY', 25)],
    finale: 'Het wordt gelijkspel. Iedereen mag van beide gerechten proeven.', fail: 'De wedstrijd wordt uitgesteld. De chef houdt de pannen alvast warm.', onSuccess: { mood: 0.25 }, onFail: { mood: -0.05 } },
  { code: 'STORY_PROPOSAL', title: 'Huwelijksaanzoek bij de vijver', roles: ['partner'], familiesOnly: true, weight: 1,
    intro: '{lead} uit {household} wil vanavond een aanzoek doen bij de vijver.',
    chapters: [ch('Er zijn bloemen nodig, discreet geregeld via de ParkShop.', 'STY_PROP_FLOWERS', 0), ch('De mooiste plek bij het water moet stiekem worden versierd.', 'STY_PROP_SPOT', 20), ch('Ze heeft ja gezegd! Champagne naar de vijver.', 'STY_PROP_BUBBLES', 20)],
    finale: 'Ja! Het hele terras klapt als het stel terugkomt.', fail: 'Het aanzoek wordt uitgesteld tot morgen. De ring blijft nog even in de jaszak.', onSuccess: { mood: 0.35 }, onFail: { mood: -0.1 } },
  { code: 'STORY_GRANDMA_80', title: 'Oma wordt 80', roles: ['oma', 'opa'], familiesOnly: true, weight: 1,
    intro: '{lead} van {household} wordt vandaag 80. De familie wil er een feest van maken.',
    chapters: [ch('Een taart met tachtig kaarsjes (of in elk geval veel).', 'STY_OMA_CAKE', 0), ch('Versier {loc} met ballonnen en slingers.', 'STY_OMA_DECOR', 20), ch('Het animatieteam zingt een lied voor de jarige.', 'STY_OMA_SONG', 20)],
    finale: '{lead} zegt dat dit de mooiste verjaardag ooit was. En dat is met tachtig jaar ervaring.', fail: 'Het feest blijft klein. {lead} vindt het eigenlijk wel best zo.', onSuccess: { mood: 0.3 }, onFail: { mood: -0.1 } },
  { code: 'STORY_LOST_TEDDY', title: 'Knuffel kwijt', roles: ['kind'], familiesOnly: true, weight: 1,
    intro: '{lead} van {household} kan niet slapen: de knuffel is kwijt.',
    chapters: [ch('Kijk bij de gevonden voorwerpen of de knuffel is ingeleverd.', 'STY_TEDDY_SEARCH', 0), ch('Misschien ligt hij nog bij de speeltuin.', 'STY_TEDDY_PLAYGROUND', 15)],
    finale: 'De knuffel is terug. {lead} slaapt, de ouders ook.', fail: 'De knuffel blijft zoek. Een nieuwe uit de ParkShop helpt een beetje.', onSuccess: { mood: 0.3 }, onFail: { mood: -0.15 } },
  { code: 'STORY_SUPERFANS', title: 'Superfans', roles: ['partner'], familiesOnly: true, weight: 1,
    intro: '{household} is superfan van de BN\'ers in het park en wil er graag eentje ontmoeten.',
    chapters: [ch('{lead} vraagt bij de receptie of een ontmoeting kan.', 'STY_SUPERFAN_ASK', 0), ch('Er is een BN\'er die wil! Regel een gezellig moment in de Brasserie.', 'STY_SUPERFAN_MEET', 25)],
    finale: 'Een selfie, een handtekening en een verhaal voor de rest van hun leven.', fail: 'De ontmoeting lukt niet. Toch zwaaien ze vrolijk naar elke auto die voorbij rijdt.', onSuccess: { mood: 0.3 }, onFail: { mood: -0.1 } },
);
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
