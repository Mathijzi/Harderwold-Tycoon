// Task library for Harderwold (V3: at least 100 distinct templates in 10 groups, plus multi-step crises).
// Every template has preconditions, player-facing copy (variants), a time limit, points (difficulty x urgency),
// location selection, projector icon + effect, completion effects, timeout/escalation effects and a cooldown.
// Copy is Dutch, light-hearted and never asks for unsafe physical actions. The park: villas on canals (private pool,
// jacuzzi, sauna, jetty, sloep), the hart with reception and Brasserie Harderwold, the golf course, Residentie
// Harderwold, the camper pitches, De werf (technical service) and De loods. Guests: ordinary Dutch families, artists
// on a songwriting camp and well-to-do guests (guestlib); storyline chapters are story-only templates at the end.

export type Difficulty = 'easy' | 'medium' | 'hard' | 'crisis';
export type Urgency = 'normal' | 'high' | 'critical';
export type Fx = 'sparkle' | 'splash' | 'spark' | 'leaf' | 'note' | 'bubble' | 'ring' | 'confetti';
export type Group = 'onderhoud' | 'schoonmaak' | 'receptie' | 'horeca' | 'golf' | 'water' | 'terrein' | 'natuur' | 'recreatie' | 'chaos' | 'crisis';

/** Where the task happens. house: a villa (occupied = guests present, vacant = between guests);
 *  facility: one of the legend keys of the park plan (park.json facilities); grounds: somewhere outdoors (near a random villa). */
export interface LocationRule { kind: 'house' | 'facility' | 'grounds'; facilities?: string[]; occupied?: boolean; vacant?: boolean;
  /** house only: the villa must have this (villa = detached villa with jetty, jacuzzi and sauna; pool = private pool) */
  feature?: HouseFeature }
export type HouseFeature = 'villa' | 'pool';
/** Changes to the location state (0..1 scales): technical condition, cleanliness, guest mood. */
export interface Effect { tech?: number; clean?: number; mood?: number }

export interface TaskTemplate {
  code: string; group: Group; category: string; title: string;
  /** player-facing text variants; {loc} = location name, {n} = villa number */
  texts: string[];
  icon: string; fx: Fx;
  difficulty: Difficulty; urgency: Urgency;
  /** claim-to-completion time limit in game minutes (2-30) */
  claimMin: number;
  /** an offered task nobody claims expires after this many game minutes (timeout effects + escalation apply) */
  offeredMaxMin: number;
  location: LocationRule;
  /** preconditions */
  when: { day?: boolean; night?: boolean; minOccupancy?: number };
  /** relative scheduling weight within the library */
  weight: number;
  /** minimum game minutes before the same template may appear again at the same location (and 1/3 of it park-wide) */
  cooldownMin: number;
  /** the technical service drives there in a golf cart; completion only once the mechanic is on site */
  td?: boolean;
  onComplete: Effect;
  onTimeout: Effect & { escalate?: string };
  /** only created as part of a crisis, never by the normal scheduler */
  crisisOnly?: boolean;
  /** only created as a chapter of a guest storyline (guestlib), never by the normal scheduler */
  storyOnly?: boolean;
}

export interface CrisisTemplate {
  code: string; title: string; texts: string[]; icon: string; fx: Fx;
  location: LocationRule;
  weight: number;
  /** stages: the first starts immediately; a later stage is added if the crisis is still unresolved after `afterMin` */
  stages: { afterMin: number; text: string; tasks: string[] }[];
}

/** Legend keys of the Harderwold plan (data/map/park.json facilities):
 *  A receptie, G Brasserie Harderwold, H terras, J toiletten & douches, V winkeltje, W fietsen, P/EV parkeren en laden,
 *  K stort chemisch toilet, R driving range, U adventure golf, O 9-holes golfbaan, L bosgolf, Q tennis, S speeltuin,
 *  Z jeu de boules, CP camperplaatsen, N Residentie Harderwold, I De werf (TD), M De loods, D milieustraat,
 *  F trailerstalling, X afvalpunten, E AED. */
const G: Record<Exclude<Group, 'crisis'>, { category: string; icon: string; fx: Fx; location: LocationRule; td?: boolean; claimMin: number; cooldownMin: number; onComplete: Effect; onTimeout: Effect }> = {
  onderhoud: { category: 'Onderhoud', icon: 'wrench', fx: 'spark', location: { kind: 'house', occupied: true }, td: true, claimMin: 12, cooldownMin: 240, onComplete: { tech: 0.3, mood: 0.1 }, onTimeout: { tech: -0.1, mood: -0.1 } },
  schoonmaak: { category: 'Schoonmaak', icon: 'broom', fx: 'sparkle', location: { kind: 'house', occupied: true }, claimMin: 10, cooldownMin: 180, onComplete: { clean: 0.35, mood: 0.05 }, onTimeout: { clean: -0.1, mood: -0.08 } },
  receptie: { category: 'Receptie', icon: 'key', fx: 'ring', location: { kind: 'facility', facilities: ['A'] }, claimMin: 8, cooldownMin: 120, onComplete: { mood: 0.15 }, onTimeout: { mood: -0.12 } },
  horeca: { category: 'Horeca', icon: 'food', fx: 'bubble', location: { kind: 'facility', facilities: ['G', 'H'] }, claimMin: 8, cooldownMin: 90, onComplete: { mood: 0.1, tech: 0.1 }, onTimeout: { mood: -0.1 } },
  golf: { category: 'Golf', icon: 'golf', fx: 'leaf', location: { kind: 'facility', facilities: ['O', 'L', 'U', 'R'] }, claimMin: 12, cooldownMin: 120, onComplete: { tech: 0.15, mood: 0.1 }, onTimeout: { mood: -0.1, tech: -0.05 } },
  water: { category: 'Water & steigers', icon: 'boat', fx: 'splash', location: { kind: 'house', occupied: true, feature: 'villa' }, claimMin: 12, cooldownMin: 150, onComplete: { mood: 0.12, tech: 0.1 }, onTimeout: { mood: -0.1 } },
  terrein: { category: 'Terrein', icon: 'tree', fx: 'leaf', location: { kind: 'grounds' }, claimMin: 15, cooldownMin: 180, onComplete: { tech: 0.15 }, onTimeout: { tech: -0.08, mood: -0.04 } },
  natuur: { category: 'Natuur', icon: 'paw', fx: 'leaf', location: { kind: 'grounds' }, td: true, claimMin: 15, cooldownMin: 240, onComplete: { mood: 0.1 }, onTimeout: { mood: -0.08 } },
  recreatie: { category: 'Recreatie', icon: 'star', fx: 'note', location: { kind: 'facility', facilities: ['Q', 'S', 'Z', 'CP', 'N'] }, claimMin: 12, cooldownMin: 150, onComplete: { mood: 0.15 }, onTimeout: { mood: -0.1 } },
  chaos: { category: 'Chaos', icon: 'bolt', fx: 'confetti', location: { kind: 'grounds' }, claimMin: 15, cooldownMin: 600, onComplete: { mood: 0.15 }, onTimeout: { mood: -0.12 } },
};

type Opt = Partial<Omit<TaskTemplate, 'code' | 'group' | 'title' | 'texts'>> & { texts2?: string[] };
export function t(group: Exclude<Group, 'crisis'>, code: string, title: string, text: string, difficulty: Difficulty, urgency: Urgency, weight: number, o: Opt = {}): TaskTemplate {
  const g = G[group];
  const { texts2, ...rest } = o;
  return {
    code, group, category: g.category, title, texts: [text, ...(texts2 ?? [])], icon: g.icon, fx: g.fx, difficulty, urgency,
    claimMin: g.claimMin, offeredMaxMin: 45, location: g.location, when: {}, weight, cooldownMin: g.cooldownMin, td: g.td,
    onComplete: g.onComplete, onTimeout: g.onTimeout, ...rest,
  };
}
const house = (o: Partial<LocationRule> = {}): LocationRule => ({ kind: 'house', occupied: true, ...o });
const fac = (...f: string[]): LocationRule => ({ kind: 'facility', facilities: f });
const GROUNDS: LocationRule = { kind: 'grounds' };
const DAY = { day: true }, NIGHT = { night: true };
type Row = [Exclude<Group, 'crisis'>, string, string, string, Difficulty, Urgency, LocationRule];

export const TEMPLATES: TaskTemplate[] = [
  // ---------------------------------------------------------------- 1. Onderhoud (technische dienst vanaf De loods, golfkar)
  t('onderhoud', 'MAINT_BLOCKED_TOILET', 'Verstopt toilet', 'In {loc} heeft iemand geprobeerd een badeend door te spoelen. Ontstoppen graag.', 'medium', 'high', 1.1, { claimMin: 8, onTimeout: { tech: -0.15, mood: -0.15, clean: -0.1, escalate: 'HK_URGENT_TURNOVER' }, texts2: ['Het toilet in {loc} maakt een geluid alsof er een walvis in woont. Even kijken?'] }),
  t('onderhoud', 'MAINT_LEAKING_TAP', 'Lekkende kraan', 'De designkraan in de keuken van {loc} druppelt in het ritme van een technobeat. Vervang het binnenwerk.', 'medium', 'normal', 1.1, { claimMin: 10, onTimeout: { tech: -0.15, mood: -0.05, escalate: 'MAINT_WATER_DAMAGE' } }),
  t('onderhoud', 'MAINT_COLD_SHOWER', 'Koude regendouche', 'In {loc} komt alleen ijswater uit de regendouche. Controleer de warmtepomp.', 'medium', 'high', 1.0, { claimMin: 10, texts2: ['De gasten van {loc} douchen nu in drie seconden recordtijd. Warmtepomp checken!'] }),
  t('onderhoud', 'MAINT_FLOOR_HEATING', 'Vloerverwarming koud', 'De vloerverwarming in {loc} staat op 21 graden, de tegels vinden 14 ook prima. Verdeler ontluchten en controleren.', 'medium', 'high', 0.9),
  t('onderhoud', 'MAINT_POWER_OUTAGE', 'Stroom uitgevallen', 'In {loc} viel de stroom uit toen de oven, de sauna en de jacuzzi tegelijk aangingen. Aardlekschakelaar controleren.', 'hard', 'high', 0.7, { claimMin: 12, onTimeout: { tech: -0.2, mood: -0.2 } }),
  t('onderhoud', 'MAINT_POOL_PUMP', 'Pomp privezwembad', 'De pomp van het privezwembad bij {loc} bromt als een grasmaaier en het water wordt troebel. Filter en pomp nakijken.', 'medium', 'high', 1.0, { location: house({ feature: 'pool' }), onTimeout: { tech: -0.15, mood: -0.12 } }),
  t('onderhoud', 'MAINT_JACUZZI_COLD', 'Jacuzzi blijft koud', 'De jacuzzi op het terras van {loc} borrelt wel, maar wordt niet warm. Verwarmingselement controleren.', 'medium', 'normal', 0.9, { location: house({ feature: 'villa' }) }),
  t('onderhoud', 'MAINT_SAUNA_HEATER', 'Sauna-kachel stuk', 'De sauna in {loc} komt niet boven de 40 graden. De gasten noemen het inmiddels een "lauwe hut". Kachel nakijken.', 'medium', 'normal', 0.8, { location: house({ feature: 'villa' }) }),
  t('onderhoud', 'MAINT_SLIDING_DOOR', 'Schuifpui klemt', 'De grote schuifpui naar het terras van {loc} gaat alleen nog open met twee man en een aanloop. Rails en wielen afstellen.', 'easy', 'normal', 1.0),
  t('onderhoud', 'MAINT_SMART_HOME', 'Domotica in de war', 'In {loc} gaan de lampen aan als iemand de tv uitzet, en de screens zakken bij elke deurbel. Domotica resetten.', 'medium', 'normal', 0.8),
  t('onderhoud', 'MAINT_SMOKE_DETECTOR', 'Rookmelder piept', 'De rookmelder in {loc} piept elke 40 seconden. De batterij wil met pensioen.', 'easy', 'high', 0.9, { claimMin: 8, when: NIGHT }),
  t('onderhoud', 'MAINT_TERRACE_LIGHT', 'Tuinverlichting stuk', 'De tuinverlichting bij {loc} knippert als een discobal. Spotje en trafo vervangen.', 'easy', 'normal', 0.8, { when: NIGHT }),
  t('onderhoud', 'MAINT_SOLAR_FAULT', 'Zonnepanelen storing', 'De omvormer van de zonnepanelen op {loc} geeft een rode foutcode. Uitlezen en herstarten.', 'easy', 'normal', 0.7),
  // ---------------------------------------------------------------- 2. Schoonmaak
  t('schoonmaak', 'HK_UNCLEAN_VILLA', 'Villa niet schoon', 'De nieuwe gasten van {loc} vonden een zandspoor van de steiger tot in de slaapkamer. Snel een nette ronde.', 'medium', 'high', 1.0),
  t('schoonmaak', 'HK_DIRTY_SHEETS', 'Vies beddengoed', 'Het beddengoed in {loc} heeft verdacht veel weg van een picknickkleed. Verschonen graag.', 'easy', 'normal', 1.0),
  t('schoonmaak', 'HK_MISSING_TOWELS', 'Handdoeken ontbreken', 'In {loc} zijn vier badlakens, twee saunadoeken en een badjas spoorloos. Breng een nieuwe set.', 'easy', 'normal', 1.1),
  t('schoonmaak', 'HK_OVERFLOWING_BIN', 'Afvalbak puilt uit', 'De container bij {loc} is zo vol dat de deksel een hoedje is geworden. Legen en naar het afvalpunt brengen.', 'easy', 'normal', 1.0, { location: GROUNDS }),
  t('schoonmaak', 'HK_WINDOWS_STREAKS', 'Strepen op de glaspui', 'Op de enorme glaspui van {loc} staan kinderhandjes op precies elke hoogte. Zemen tot het glas onzichtbaar is.', 'easy', 'normal', 1.0),
  t('schoonmaak', 'HK_LOST_PROPERTY', 'Gevonden voorwerp', 'In {loc} is een knuffelgiraf achtergebleven die dringend naar huis wil. Breng hem naar de receptie.', 'easy', 'normal', 0.8, { location: house({ occupied: false, vacant: true }) }),
  t('schoonmaak', 'HK_MUDDY_FLOOR', 'Modderige vloer', 'Na een rondje golf ligt de halve fairway in {loc}. Dweilen, en de tegels weer laten glanzen.', 'easy', 'normal', 1.1),
  t('schoonmaak', 'HK_BBQ_GREASE', 'Vette barbecue', 'De buitenkeuken op het terras van {loc} heeft drie barbecues achter de rug. Rooster en blad schoonmaken.', 'easy', 'normal', 0.9),
  t('schoonmaak', 'HK_NO_TOILET_PAPER', 'Wc-papier op', 'In {loc} is het laatste rolletje wc-papier zojuist gebruikt. Dit is een noodgeval.', 'easy', 'high', 1.1, { claimMin: 6 }),
  t('schoonmaak', 'HK_POOL_LEAVES', 'Blad in het privezwembad', 'Het privezwembad bij {loc} ligt vol blad na de wind. Schepnet erbij en de skimmer leegmaken.', 'easy', 'normal', 1.0, { location: house({ feature: 'pool' }) }),
  t('schoonmaak', 'HK_SANITAIR', 'Sanitair bij het hart', 'Bij de toiletten en douches in het hart is de zeep op en ligt er een plas bij de wastafels. Bijvullen en droogmaken.', 'easy', 'high', 0.9, { location: fac('J'), claimMin: 8 }),
  t('schoonmaak', 'HK_URGENT_TURNOVER', 'Spoedwissel', 'De gasten van {loc} zijn vertrokken en de volgende staan al bijna voor de slagboom. Snelle wisselschoonmaak!', 'hard', 'high', 0.9, { location: house({ occupied: false, vacant: true }), claimMin: 20, onComplete: { clean: 0.6, tech: 0.05 } }),
  // ---------------------------------------------------------------- 3. Receptie
  t('receptie', 'REC_MISSING_KEY', 'Sleutelkaart kwijt', 'De gasten van {loc} staan buitengesloten; de sleutelkaart ligt vermoedelijk in de sloep.', 'easy', 'high', 1.2, { location: house(), icon: 'key' }),
  t('receptie', 'REC_DOUBLE_BOOKING', 'Dubbele boeking', 'Twee gezelschappen hebben allebei {loc} geboekt en kijken elkaar wantrouwig aan. Los het op.', 'hard', 'high', 0.6, { location: house() }),
  t('receptie', 'REC_WRONG_VILLA', 'Verkeerde villa', 'Een familie heeft zich gezellig geinstalleerd in {loc}, maar die was niet van hen. Breng ze naar de juiste.', 'medium', 'high', 0.7, { location: house() }),
  t('receptie', 'REC_LATE_CHECKIN', 'Late incheck', 'Een gezelschap belt dat het om 23:30 uur aankomt "na een kleine omweg via Zwolle". Regel de late incheck.', 'easy', 'normal', 0.8, { when: NIGHT }),
  t('receptie', 'REC_EARLY_ARRIVAL', 'Te vroeg', 'Er staat een gezin om 10:00 uur met de golftassen al om, terwijl de villa pas om 15:00 klaar is. Bied iets leuks aan.', 'easy', 'normal', 0.8, { when: DAY }),
  t('receptie', 'REC_ANGRY_COMPLAINT', 'Boze klacht', 'Een gast is boos omdat de eenden op de steiger te hard kwaken. Luister, bied excuses aan en noteer het.', 'medium', 'high', 0.9),
  t('receptie', 'REC_GUEST_COUNT', 'Aantal gasten klopt niet', 'Bij {loc} staan zes personen geboekt, er stappen er elf uit twee auto\'s. Pas de reservering aan.', 'medium', 'normal', 0.6, { location: house() }),
  t('receptie', 'REC_UPGRADE_REQUEST', 'Upgrade-verzoek', 'De gasten van {loc} vragen of hun villa "ook een met zwembad" kan worden. Kijk wat er vrij is.', 'easy', 'normal', 0.7, { location: house() }),
  t('receptie', 'REC_PARCEL', 'Pakketje voor een villa', 'Bij de receptie ligt een pakket voor {loc}: "Breekbaar, studiomicrofoon". Breng het voorzichtig rond.', 'easy', 'normal', 0.8),
  t('receptie', 'REC_GOLF_BOOKING', 'Starttijd golfbaan', 'Een gast wil morgen om 07:12 precies afslaan op hole 1, met vier personen en twee golfkarren. Regel de starttijd.', 'easy', 'normal', 0.8, { when: DAY }),
  t('receptie', 'REC_CHECKOUT_DISPUTE', 'Discussie bij uitchecken', 'De gasten van {loc} vinden dat de gebroken designvaas "er al zo stond". Handel het vriendelijk af.', 'medium', 'normal', 0.6, { location: house() }),
  t('receptie', 'REC_CHARGER_FULL', 'Laadpalen bezet', 'Alle laadpalen bij het hart zijn bezet en een gast moet straks naar Schiphol. Regel een oplossing.', 'easy', 'high', 0.7, { when: DAY }),
  // ---------------------------------------------------------------- 4. Horeca (Brasserie Harderwold G, terras H)
  t('horeca', 'FB_COFFEE_MACHINE', 'Koffiemachine staakt', 'De koffiemachine in {loc} sist, pruttelt en levert alleen heet water. Ontkalken!', 'easy', 'high', 1.0, { when: DAY }),
  t('horeca', 'FB_MISSING_SUPPLIES', 'Voorraad op', 'In {loc} zijn de bitterballen op terwijl het terras vol zit met golfers. Bevoorraden.', 'easy', 'normal', 0.9),
  t('horeca', 'FB_WRONG_ORDER', 'Verkeerde bestelling', 'Tafel 7 in {loc} kreeg 12 pannenkoeken in plaats van 2. Rechtzetten met een glimlach.', 'easy', 'normal', 0.9, { when: DAY }),
  t('horeca', 'FB_COLD_MEAL', 'Koud eten', 'Een gast in {loc} meldt dat zijn soep "verfrissend" is. Opnieuw opwarmen en een toetje erbij.', 'easy', 'normal', 0.8, { when: DAY }),
  t('horeca', 'FB_QUEUE_OVERFLOW', 'Rij tot buiten', 'De rij bij {loc} gaat inmiddels tot aan het parkeerterrein. Help mee uitserveren.', 'medium', 'high', 0.7, { when: DAY }),
  t('horeca', 'FB_FRIDGE_ALARM', 'Koelcel-alarm', 'Het alarm van de koelcel in {loc} piept. Deur dicht, temperatuur controleren.', 'medium', 'high', 0.6, { td: true }),
  t('horeca', 'FB_RESERVATION_MIXUP', 'Tafelreservering kwijt', 'Twee families hebben dezelfde tafel aan het raam met uitzicht op de golfbaan. Vind een oplossing met uitzicht.', 'easy', 'normal', 0.7, { when: DAY }),
  t('horeca', 'FB_SPILLED_DRINKS', 'Drankje omgestoten', 'Er is een dienblad met limonade gesneuveld in {loc}. Opdweilen voor iemand uitglijdt.', 'easy', 'high', 0.9, { onComplete: { clean: 0.3 } }),
  t('horeca', 'FB_WINE_ORDER', 'Wijn voor een villa', 'De gasten van {loc} bestellen een kist wijn en een kaasplank voor vanavond. Breng het netjes rond.', 'easy', 'normal', 0.9, { location: house(), when: DAY }),
  t('horeca', 'FB_BREAKFAST_DELIVERY', 'Ontbijtservice', 'Het ontbijt voor {loc} had om 8:30 op het terras moeten staan. De croissants zijn nog in de oven.', 'easy', 'high', 0.9, { location: house(), when: DAY }),
  t('horeca', 'FB_TERRACE_WIND', 'Parasols op het terras', 'De wind trekt aan en de parasols op het terras klapperen als zeilen. Inklappen en vastzetten.', 'easy', 'high', 0.7, { location: fac('H') }),
  t('horeca', 'FB_SURPRISE_GROUP', 'Onverwachte groep', 'Een golfclub van 22 personen wil "even snel" lunchen in {loc}. Tafels schuiven!', 'hard', 'high', 0.4, { when: DAY }),
  // ---------------------------------------------------------------- 5. Golf (9-holes O, bosgolf L, adventure golf U, driving range R)
  t('golf', 'GOLF_DIVOTS', 'Plaggen op de fairway', 'Op de fairway van {loc} liggen meer plaggen dan gras. Terugleggen en aanstampen.', 'easy', 'normal', 1.0),
  t('golf', 'GOLF_GREEN_MOW', 'Green maaien', 'De green bij {loc} is zo hoog dat de bal er een tentje kan opzetten. Maaien met de greenmaaier.', 'medium', 'normal', 0.9, { td: true, when: DAY }),
  t('golf', 'GOLF_BUNKER_RAKE', 'Bunker harken', 'In de bunker bij {loc} staan voetstappen, een zandkasteel en een emmertje. Harken en het emmertje terugbrengen.', 'easy', 'normal', 1.0),
  t('golf', 'GOLF_FLAG_MISSING', 'Vlag weg', 'De vlag op hole 6 van {loc} is spoorloos. Golfers mikken nu op "ongeveer daar". Nieuwe vlag plaatsen.', 'easy', 'high', 0.8),
  t('golf', 'GOLF_BALL_MACHINE', 'Ballenautomaat leeg', 'De ballenautomaat van de driving range geeft geen ballen meer. Bijvullen en de muntjes legen.', 'easy', 'high', 1.0, { location: fac('R'), when: DAY }),
  t('golf', 'GOLF_RANGE_PICKER', 'Ballen rapen', 'Op de driving range liggen duizenden ballen. Met de ballenraper erop, in de kooi.', 'medium', 'normal', 0.9, { location: fac('R'), td: true }),
  t('golf', 'GOLF_RANGE_SCREEN', 'Doelen range stuk', 'Het interactieve scherm van de driving range telt elke bal als hole-in-one. Leuk, maar niet de bedoeling. Kalibreren.', 'medium', 'normal', 0.8, { location: fac('R') }),
  t('golf', 'GOLF_CART_FLAT', 'Golfkar met lekke band', 'Een golfkar staat met een lekke band op het pad bij {loc}. Ophalen en de band verwisselen.', 'medium', 'high', 0.8, { td: true }),
  t('golf', 'GOLF_LOST_BALL_POND', 'Bal in de vijver', 'Een gast wil per se zijn "geluksbal" terug uit de vijver bij {loc}. Met de ballenhengel, niet zwemmen.', 'easy', 'normal', 0.8),
  t('golf', 'GOLF_ADVENTURE_HOLE', 'Adventure golf: draaimolen hapert', 'Op baan 12 van de adventure golf draait de molen niet meer, de bal komt er nooit doorheen. Mechaniek nakijken.', 'medium', 'normal', 0.9, { location: fac('U') }),
  t('golf', 'GOLF_SCORECARDS', 'Scorekaarten op', 'Bij {loc} zijn de scorekaartjes en de potloodjes op. Een nieuwe stapel brengen.', 'easy', 'normal', 0.8),
  t('golf', 'GOLF_SLOW_GROUP', 'Langzame flight', 'Een flight van vier op {loc} zoekt al twintig minuten een bal. Er staat een rij achter. Vriendelijk laten doorspelen.', 'easy', 'high', 0.8, { location: fac('O', 'L'), when: DAY }),
  t('golf', 'GOLF_SPRINKLER', 'Sproeier blijft aan', 'Een sproeier op {loc} zet een tee onder water, en een golfer erbij. Kraan dicht en sproeier afstellen.', 'medium', 'high', 0.7, { td: true }),
  // ---------------------------------------------------------------- 6. Water & steigers (grachten, sloepen, kano's)
  t('water', 'WATER_JETTY_BOARD', 'Losse plank op de steiger', 'Op de steiger van {loc} wipt een plank omhoog als je erop stapt. Vastschroeven voordat iemand struikelt.', 'easy', 'high', 1.1, { td: true }),
  t('water', 'WATER_SLOEP_BATTERY', 'Sloep vaart niet', 'De elektrische sloep van {loc} doet het niet: de accu is leeg. Laadkabel aansluiten en de lader controleren.', 'medium', 'normal', 1.0, { td: true, when: DAY }),
  t('water', 'WATER_SLOEP_DRIFT', 'Sloep los', 'De sloep van {loc} drijft langzaam de gracht af; de knoop was meer een strik. Ophalen met de kano en goed aanleggen.', 'medium', 'high', 0.8, { location: GROUNDS }),
  t('water', 'WATER_KAYAK_PADDLE', 'Peddel kwijt', 'Bij {loc} ligt een kano zonder peddel en dobbert de peddel richting de buren. Opvissen.', 'easy', 'normal', 1.0),
  t('water', 'WATER_SUP_PUMP', 'SUP-board slap', 'Het SUP-board van {loc} lijkt meer op een luchtbed met heimwee. Pomp en ventiel controleren.', 'easy', 'normal', 0.9, { when: DAY }),
  t('water', 'WATER_LIFEBUOY', 'Reddingsboei ontbreekt', 'Bij de steiger van {loc} hangt alleen nog het haakje van de reddingsboei. Nieuwe boei ophangen.', 'easy', 'high', 0.8),
  t('water', 'WATER_CANAL_LITTER', 'Zwerfvuil in de gracht', 'In de gracht bij {loc} drijven twee ballonnen, een flamingo-zwemband en een frisdrankflesje. Opvissen met het schepnet.', 'easy', 'normal', 1.0, { location: GROUNDS }),
  t('water', 'WATER_DUCKWEED', 'Kroos voor de steiger', 'Voor de steiger van {loc} ligt zoveel kroos dat de kano niet meer vooruit komt. Kroos verwijderen.', 'medium', 'normal', 0.8, { when: DAY }),
  t('water', 'WATER_SLOEP_RENTAL', 'Sloep reserveren', 'De gasten van {loc} willen morgen een rondvaart met de sloep, met lunchpakket. Regel de sloep en de vaarkaart.', 'easy', 'normal', 0.9, { when: DAY }),
  t('water', 'WATER_FENDER', 'Stootwil kapot', 'De sloep van {loc} bonkt tegen de steiger omdat de stootwil lek is. Nieuwe stootwillen ophangen.', 'easy', 'normal', 0.8),
  t('water', 'WATER_JETTY_LIGHT', 'Steigerlampje uit', 'Het lampje op de steiger van {loc} is uit en de gasten zoeken in het donker de sloep. Lampje vervangen.', 'easy', 'normal', 0.8, { when: NIGHT, td: true }),
  t('water', 'WATER_FISHING', 'Hengel in de boom', 'Een jonge visser bij {loc} heeft zijn haak in de wilg gegooid in plaats van de gracht. Help hem los, zonder in het water te vallen.', 'easy', 'normal', 0.8, { location: GROUNDS, when: DAY }),
  // ---------------------------------------------------------------- 7. Terrein
  t('terrein', 'GRD_FALLEN_BRANCH', 'Tak op de weg', 'Bij {loc} ligt een flinke tak over de weg. Opruimen voordat er een golfkar overheen hobbelt.', 'easy', 'high', 1.0),
  t('terrein', 'GRD_HEDGE_TRIM', 'Haag knippen', 'De haag bij {loc} groeit zo hard dat de villa er straks achter verdwijnt. Netjes in model knippen.', 'medium', 'normal', 1.0, { when: DAY }),
  t('terrein', 'GRD_FLOODED_PATH', 'Plas op het pad', 'Het pad bij {loc} staat onder water. Gasten springen er als kikkers overheen. Put en afvoer vrijmaken.', 'medium', 'normal', 0.9),
  t('terrein', 'GRD_LAWN_MOW', 'Gazon maaien', 'Het gazon bij {loc} is zo hoog dat de robotmaaier vastzit. Robotmaaier bevrijden en de rest maaien.', 'medium', 'normal', 0.9, { when: DAY }),
  t('terrein', 'GRD_STREETLIGHT', 'Lantaarn kapot', 'De lantaarnpaal bij {loc} knippert als een vuurtoren. Lamp vervangen.', 'easy', 'normal', 0.9, { when: NIGHT, td: true }),
  t('terrein', 'GRD_PARKING_LINES', 'Parkeervakken vervaagd', 'Op het parkeerterrein bij het hart staan auto\'s kriskras door elkaar. De lijnen moeten opnieuw.', 'medium', 'normal', 0.6, { location: fac('A') }),
  t('terrein', 'GRD_BIN_FULL', 'Afvalpunt vol', 'Bij het afvalpunt ligt het glas naast de container. Opruimen en een melding maken voor ophalen.', 'easy', 'normal', 1.0, { location: fac('X') }),
  t('terrein', 'GRD_MILIEUSTRAAT', 'Milieustraat ordenen', 'In de milieustraat staat een tuinstoel tussen het papier en een bank bij het glas. Sorteren en opruimen.', 'medium', 'normal', 0.7, { location: fac('D') }),
  t('terrein', 'GRD_SIGNPOST', 'Wegwijzer gedraaid', 'Iemand heeft de wegwijzer bij {loc} omgedraaid. Drie families zijn nu op weg naar de milieustraat in plaats van naar de brasserie.', 'easy', 'normal', 0.8),
  t('terrein', 'GRD_CHARGER', 'Laadpaal storing', 'Een laadpaal bij het hart geeft een foutmelding en de auto laadt niet. Paal resetten en de kabel controleren.', 'medium', 'high', 0.7, { location: fac('EV', 'A'), td: true }),
  t('terrein', 'GRD_CHEM_TOILET', 'Stortplaats chemisch toilet', 'Bij het stortpunt voor chemische toiletten loopt de afvoer niet goed. Doorspoelen en schoonmaken.', 'medium', 'normal', 0.6, { location: fac('K') }),
  t('terrein', 'GRD_POTHOLE', 'Kuil in de weg', 'In de weg bij {loc} zit een kuil waar je een golfbal in kwijt kunt. Tijdelijk dichten en markeren.', 'medium', 'normal', 0.7, { td: true }),
  // ---------------------------------------------------------------- 8. Natuur
  t('natuur', 'NAT_WASP_NEST', 'Wespennest', 'Onder de dakrand van {loc} hangt een wespennest. Laat het veilig weghalen en houd de gasten op afstand.', 'medium', 'high', 0.8, { when: DAY }),
  t('natuur', 'NAT_HERON_FISH', 'Reiger steelt vis', 'De reiger bij {loc} heeft geleerd dat gasten op de steiger vissen. Hij steelt de vangst. Gasten tips geven.', 'easy', 'normal', 0.9),
  t('natuur', 'NAT_DUCKS_TERRACE', 'Eenden op het terras', 'Een eendenfamilie bij {loc} heeft het terras uitgeroepen tot crèche. Rustig terugleiden naar de gracht.', 'easy', 'normal', 1.0),
  t('natuur', 'NAT_SWAN_JETTY', 'Zwaan bewaakt de steiger', 'Een zwaan bij {loc} vindt de steiger van hem. De gasten durven niet naar de sloep. Met geduld en afstand oplossen.', 'medium', 'normal', 0.8),
  t('natuur', 'NAT_RABBITS_GOLF', 'Konijnen op de green', 'Konijnen graven gaten in de green bij {loc}. Gaten dichten en kijken waar ze vandaan komen.', 'easy', 'normal', 0.9, { location: fac('O', 'L') }),
  t('natuur', 'NAT_TOADS', 'Paddentrek', 'Op de weg bij {loc} steken tientallen padden over. Borden plaatsen en emmertjes klaarzetten.', 'easy', 'high', 0.7, { when: NIGHT }),
  t('natuur', 'NAT_HEDGEHOG', 'Egel in de put', 'In de put bij {loc} zit een egel die er zelf niet uit komt. Voorzichtig eruit tillen (handschoenen aan).', 'easy', 'high', 0.8),
  t('natuur', 'NAT_FOX_BINS', 'Vos bij de containers', 'Een vos heeft de afvalzakken bij {loc} opengetrokken. Opruimen en de deksels goed dichtmaken.', 'easy', 'normal', 0.8),
  t('natuur', 'NAT_ALGAE_SPOT', 'Groene vlek in de gracht', 'In de gracht bij {loc} drijft een groene laag. Monster nemen en de waterbeheerder bellen.', 'medium', 'normal', 0.6),
  t('natuur', 'NAT_MOLE_LAWN', 'Mollenhopen', 'Het gazon bij {loc} ziet eruit als een maanlandschap. Hopen egaliseren.', 'easy', 'normal', 0.8),
  t('natuur', 'NAT_OWL_NOISE', 'Uil houdt gasten wakker', 'Een bosuil bij {loc} roept de hele nacht. De gasten willen slapen, de uil niet. Oordoppen en een verhaal over de uil.', 'easy', 'normal', 0.6, { when: NIGHT }),
  t('natuur', 'NAT_BIRD_BOX', 'Nestkastjes nakijken', 'Bij {loc} hangen nestkastjes scheef na de wind. Rechtzetten en er een nieuwe bij hangen.', 'easy', 'normal', 0.7, { when: DAY }),
  // ---------------------------------------------------------------- 9. Recreatie (tennis Q, speeltuin S, jeu de boules Z, camperplaatsen CP, Residentie N)
  t('recreatie', 'FUN_TENNIS_NET', 'Tennisnet slap', 'Het net van de tennisbaan hangt zo laag dat je eroverheen kunt stappen. Spannen en de lijnen vegen.', 'easy', 'normal', 1.0, { location: fac('Q') }),
  t('recreatie', 'FUN_TENNIS_BALLS', 'Tennisballen kwijt', 'Alle ballen van de tennisbaan zijn in de haag verdwenen. Zoeken en een nieuwe koker brengen.', 'easy', 'normal', 0.9, { location: fac('Q'), when: DAY }),
  t('recreatie', 'FUN_PLAYGROUND_SWING', 'Schommel kapot', 'Een schommel in {loc} hangt aan een ketting. Afzetten en laten repareren.', 'medium', 'high', 0.9, { location: fac('S'), td: true }),
  t('recreatie', 'FUN_PLAYGROUND_SAND', 'Zandbak opknappen', 'De zandbak in {loc} is vooral blad en een verloren schepje. Harken en aanvullen.', 'easy', 'normal', 0.8, { location: fac('S'), when: DAY }),
  t('recreatie', 'FUN_BOULES_TOURNAMENT', 'Jeu-de-boulestoernooi', 'Vanmiddag is het jeu-de-boulestoernooi. Baan harken, ballen tellen en een scorebord klaarzetten.', 'medium', 'normal', 0.9, { location: fac('Z'), when: DAY }),
  t('recreatie', 'FUN_CAMPER_POWER', 'Stroom camperplaats', 'Op een camperplaats valt de stroom steeds uit als de koffiezetter aangaat. Stroomkast nakijken.', 'medium', 'high', 0.9, { location: fac('CP'), td: true }),
  t('recreatie', 'FUN_CAMPER_ARRIVAL', 'Camper zoekt plek', 'Een camper van 9 meter wil op plek 4, waar een camper van 6 meter staat. Puzzel het samen op.', 'easy', 'normal', 0.9, { location: fac('CP') }),
  t('recreatie', 'FUN_CAMPER_WATER', 'Watertappunt camperplaats', 'Het watertappunt bij de camperplaatsen sputtert. Kraan en slang controleren.', 'easy', 'normal', 0.7, { location: fac('CP') }),
  t('recreatie', 'FUN_RESIDENTIE_LIFT', 'Lift Residentie', 'De lift in Residentie Harderwold blijft op de eerste verdieping hangen. Melding maken en gasten met bagage helpen.', 'medium', 'high', 0.8, { location: fac('N'), td: true }),
  t('recreatie', 'FUN_RESIDENTIE_TERRACE', 'Dakterras Residentie', 'Op een dakterras van de Residentie staat de loungeset in de vijver van de regenput. Afdekken en drogen.', 'easy', 'normal', 0.8, { location: fac('N') }),
  t('recreatie', 'FUN_KIDS_CLUB', 'Kinderclub op stap', 'De kinderclub gaat een speurtocht doen langs de grachten. Begeleid de groep en tel ze bij terugkomst.', 'medium', 'normal', 0.9, { location: fac('S'), when: DAY }),
  t('recreatie', 'FUN_YOGA_JETTY', 'Yoga bij het water', 'Morgenochtend is er yoga in het gras bij de Residentie. Matjes klaarleggen en de muziekbox opladen.', 'easy', 'normal', 0.8, { location: fac('N', 'Z'), when: DAY }),
  // ---------------------------------------------------------------- 10. Komische chaos
  t('chaos', 'CHAOS_FLAMINGO', 'Flamingo op drift', 'Een reuzenflamingo-zwemband vaart al een uur stuurloos door de grachten. Gasten maken er foto\'s van. Opvissen bij {loc}.', 'easy', 'normal', 0.9, { location: GROUNDS }),
  t('chaos', 'CHAOS_DRONE', 'Drone in de boom', 'Een drone van een gast hangt in de boom bij {loc}. Met de hoogwerker van De werf ophalen.', 'medium', 'normal', 0.8, { td: true }),
  t('chaos', 'CHAOS_GOLFCART_POOL', 'Golfkar in de sloot', 'Een gast heeft een golfkar "even geparkeerd" met de voorwielen in de sloot bij {loc}. Lostrekken en controleren.', 'medium', 'high', 0.6, { td: true }),
  t('chaos', 'CHAOS_KARAOKE', 'Karaoke op de steiger', 'Bij {loc} wordt om middernacht karaoke gezongen op de steiger. Het hele kanaal zingt mee, of juist niet.', 'easy', 'high', 0.7, { location: house({ feature: 'villa' }), when: NIGHT }),
  t('chaos', 'CHAOS_CAKE', 'Taart voor de verkeerde villa', 'De verjaardagstaart voor villa 412 is bij {loc} afgeleverd en daar half opgegeten. Een nieuwe regelen.', 'medium', 'normal', 0.7, { location: house() }),
  t('chaos', 'CHAOS_ROBOMOWER', 'Robotmaaier op avontuur', 'Een robotmaaier is ontsnapt en maait nu een pad over de golfbaan bij {loc}. Terugbrengen.', 'easy', 'normal', 0.8),
  t('chaos', 'CHAOS_PARTY_BOAT', 'Feestsloep', 'Een sloep met een speaker van een meter hoog vaart rondjes door de grachten bij {loc}. Vriendelijk vragen om het zachter te zetten.', 'easy', 'high', 0.8, { location: GROUNDS }),
  t('chaos', 'CHAOS_WEDDING_PHOTO', 'Trouwfoto op de steiger', 'Een bruidspaar wil een fotoshoot op de steiger van {loc}, maar die villa is niet van hen. Regel een betere plek.', 'easy', 'normal', 0.6, { location: house({ feature: 'villa' }), when: DAY }),
  t('chaos', 'CHAOS_GOLF_BALL_WINDOW', 'Golfbal door de ruit', 'Een golfbal is via het dak van een golfkar in de brievenbus van {loc} beland. Excuses en een ballenquiz-voucher.', 'easy', 'normal', 0.7, { location: house() }),
  t('chaos', 'CHAOS_INFLATABLE_SWAN', 'Opblaaszwaan in de jacuzzi', 'In de jacuzzi van {loc} zit een opblaaszwaan die niet meer leegloopt. De echte zwaan bij de steiger kijkt jaloers.', 'easy', 'normal', 0.6, { location: house({ feature: 'villa' }) }),
  t('chaos', 'CHAOS_MAGPIE', 'Schoenendief', 'Een ekster bij {loc} pikt glimmende dingen van de terrassen: een zonnebril, een ring, een theelepeltje. Terugvinden.', 'medium', 'normal', 0.6),
  t('chaos', 'CHAOS_DOUBLE_SLOEP', 'Twee sloepen, een steiger', 'Twee gasten hebben dezelfde sloep geboekt en staan allebei aan boord. Regel snel een tweede sloep.', 'medium', 'high', 0.5, { location: house({ feature: 'villa' }) }),
  // ---------------------------------------------------------------- follow-ups (escalation targets, not scheduled on their own)
  t('onderhoud', 'MAINT_WATER_DAMAGE', 'Waterschade', 'De lekkende kraan in {loc} is genegeerd en er staat nu water op de vloer. Droogleggen en de oorzaak verhelpen.', 'hard', 'high', 0, { claimMin: 20, onComplete: { tech: 0.4, mood: 0.1, clean: 0.2 }, onTimeout: { tech: -0.2, mood: -0.2 } }),
  // ---------------------------------------------------------------- crisis subtasks (one process over time per crisis)
  ...([
    ['onderhoud', 'CR_WATER_MAIN_VALVE', 'Hoofdkraan dichtdraaien', 'Bij de gesprongen waterleiding moet de hoofdkraan dicht. Neem de sleutel mee uit De werf.', 'hard', 'critical', fac('I')],
    ['terrein', 'CR_WATER_SIGNS', 'Gebied afzetten', 'Zet het natte gebied rond de gesprongen leiding af met linten en borden, zodat niemand door de modder loopt.', 'easy', 'high', GROUNDS],
    ['receptie', 'CR_WATER_BOTTLES', 'Water uitdelen', 'Zolang de leiding dicht is: deel flessen water uit aan de villa\'s in de getroffen straten.', 'medium', 'high', fac('V', 'A')],
    ['receptie', 'CR_WATER_INFORM', 'Straten informeren', 'Ga langs de villa\'s in de getroffen straten: hoe lang het water nog uit blijft en waar flessen water te halen zijn.', 'medium', 'high', fac('A')],
    ['onderhoud', 'CR_WATER_MAIN_REPAIR', 'Waterleiding repareren', 'Vervang het gesprongen stuk leiding samen met de loodgieter.', 'crisis', 'critical', GROUNDS],
    ['onderhoud', 'CR_WATER_FLUSH', 'Leidingen doorspoelen', 'Het water is terug maar komt bruin uit de kraan. Spoel de leidingen in de straat door tot het helder is.', 'medium', 'high', fac('I')],
    ['schoonmaak', 'CR_WATER_CLEANUP', 'Modder opruimen', 'Rond de reparatieplek ligt een modderspoor tot op de terrassen. Opruimen en paden schoonspuiten.', 'medium', 'normal', GROUNDS],
    ['onderhoud', 'CR_BLACKOUT_FUSEBOX', 'Hoofdverdeler controleren', 'Een groot deel van het park zit zonder stroom. Controleer de hoofdverdeler bij De werf.', 'hard', 'critical', fac('I')],
    ['receptie', 'CR_BLACKOUT_TORCHES', 'Zaklampen uitdelen', 'Deel zaklampen en waxinelichtjes (in glazen houders) uit bij de receptie.', 'easy', 'high', fac('A')],
    ['onderhoud', 'CR_BLACKOUT_GENERATOR', 'Noodaggregaat starten', 'Start het noodaggregaat voor de receptie en de koelcellen. Controleer eerst of de ruimte goed geventileerd is.', 'hard', 'critical', fac('I')],
    ['horeca', 'CR_BLACKOUT_FRIDGES', 'Koelcellen controleren', 'Meet de temperatuur van de koelcellen en zet wat te warm wordt apart. Noteer alles voor de voedselveiligheid.', 'medium', 'high', fac('G')],
    ['receptie', 'CR_BLACKOUT_ROUNDS', 'Ronde langs de villa\'s', 'Loop een ronde langs villa\'s met oudere gasten en gezinnen met baby\'s: is alles in orde, hebben ze een zaklamp?', 'medium', 'high', fac('A')],
    ['onderhoud', 'CR_BLACKOUT_RESTART', 'Installaties herstarten', 'De stroom is terug: herstart de pompen van de privezwembaden en de koelcellen van de brasserie.', 'medium', 'high', fac('G', 'I')],
    ['receptie', 'CR_CHECKIN_SYSTEM', 'Reserveringssysteem herstarten', 'Het reserveringssysteem is gecrasht en er staat een rij tot aan de slagboom. Herstart het systeem.', 'hard', 'critical', fac('A')],
    ['receptie', 'CR_CHECKIN_PAPER', 'Handmatig inchecken', 'Zolang het systeem plat ligt: check gasten handmatig in op papier.', 'medium', 'high', fac('A')],
    ['horeca', 'CR_CHECKIN_COFFEE', 'Koffie in de rij', 'De rij voor de receptie wordt langer. Deel koffie, thee en limonade uit aan wachtende gasten.', 'easy', 'high', fac('A', 'G')],
    ['terrein', 'CR_CHECKIN_TRAFFIC', 'Wachtende auto\'s begeleiden', 'Bij de slagboom staat een rij. Wijs wachtende auto\'s een veilige plek op het parkeerterrein, zodat de ingangsweg vrij blijft.', 'medium', 'high', fac('A')],
    ['receptie', 'CR_CHECKIN_KEYS', 'Sleutelkaarten handmatig uitgeven', 'Het systeem draait weer half. Geef de sleutelkaarten uit met de papieren lijst en vink ze af.', 'medium', 'high', fac('A')],
    ['receptie', 'CR_CHECKIN_SORRY', 'Excuses aanbieden', 'Alle gasten zijn binnen. Breng de gedupeerden een kaartje met excuses en een bon voor de brasserie.', 'easy', 'normal', fac('A')],
    ['receptie', 'CR_STORM_INFORM', 'Onweer: gasten waarschuwen', 'Er komt zwaar onweer aan. Waarschuw gasten op de golfbaan, op het water en op de steigers om naar binnen te gaan.', 'easy', 'critical', fac('A')],
    ['horeca', 'CR_STORM_TERRACE', 'Terras stormvrij maken', 'Klap de parasols in en zet het terrasmeubilair binnen of vast voordat de wind aantrekt.', 'medium', 'high', fac('H', 'G')],
    ['golf', 'CR_STORM_GOLF_OUT', 'Golfbaan ontruimen', 'Haal alle flights van de golfbaan en de driving range: bij onweer is golfen niet veilig.', 'medium', 'critical', fac('O', 'R', 'L')],
    ['water', 'CR_STORM_SLOEPEN', 'Sloepen vastleggen', 'Controleer langs de grachten of alle sloepen dubbel vastliggen en haal kano\'s en SUP\'s uit het water.', 'medium', 'high', GROUNDS],
    ['terrein', 'CR_STORM_TREE', 'Omgewaaide boom', 'Bij {loc} ligt een boom over de weg. Zet het af en laat De werf hem met de juiste uitrusting weghalen.', 'hard', 'high', GROUNDS],
    ['onderhoud', 'CR_STORM_LEAK', 'Lekkage na de bui', 'In een villa bij {loc} lekt het langs de dakrand. Zet emmers neer en dicht het lek tijdelijk af.', 'medium', 'high', GROUNDS],
    ['terrein', 'CR_STORM_CLEANUP', 'Takken opruimen', 'De bui is over. Ruim de takken en bladeren op de wegen, paden en steigers op.', 'medium', 'normal', GROUNDS],
    ['horeca', 'CR_FIRE_EVACUATE', 'Brasserie ontruimen', 'Het brandalarm in de keuken gaat af. Begeleid alle gasten rustig naar het verzamelpunt op het parkeerterrein.', 'medium', 'critical', fac('G')],
    ['receptie', 'CR_FIRE_HEADCOUNT', 'Iedereen geteld?', 'Tel bij het verzamelpunt personeel en gasten met de aanwezigheidslijst. Niemand gaat terug naar binnen.', 'medium', 'critical', fac('A')],
    ['receptie', 'CR_FIRE_BRIGADE', 'Brandweer opvangen', 'De brandweer komt eraan. Vang ze op bij de slagboom en wijs de snelste route naar het hart.', 'medium', 'critical', fac('A')],
    ['onderhoud', 'CR_FIRE_KITCHEN', 'Afzuiging nakijken', 'Het was rook van een pan, geen brand. Laat de afzuiging en de melder in de keuken controleren en resetten.', 'hard', 'high', fac('G')],
    ['schoonmaak', 'CR_FIRE_AIR', 'Luchten en schoonmaken', 'Zet ramen en deuren open en maak de keuken en de eetzaal roetvrij voordat er weer gasten in mogen.', 'medium', 'high', fac('G')],
    ['horeca', 'CR_FIRE_REOPEN', 'Weer open met een traktatie', 'De brasserie mag weer open. Ontvang de gasten met een gratis toetje voor het wachten.', 'easy', 'normal', fac('G')],
    ['receptie', 'CR_PRESS_DESK', 'Perspunt inrichten', 'Er staan fotografen bij de receptie omdat er een bekende artiest op schrijverskamp is. Richt een vast perspunt in.', 'medium', 'high', fac('A')],
    ['terrein', 'CR_PRESS_PARKING', 'Persbusjes parkeren', 'De busjes van de pers blokkeren de ingangsweg. Wijs ze een plek aan op het parkeerterrein.', 'medium', 'high', fac('A')],
    ['terrein', 'CR_PRESS_PRIVACY', 'Villa\'s afschermen', 'Een paar fotografen lopen het park in en een sloep met een telelens vaart door de gracht. Begeleid ze terug.', 'hard', 'high', GROUNDS],
    ['horeca', 'CR_PRESS_COFFEE', 'Koffie voor de pers', 'Wachtende pers is rustiger met koffie. Zet bij het perspunt een koffietafel neer.', 'easy', 'normal', fac('A', 'G')],
    ['receptie', 'CR_PRESS_STATEMENT', 'Korte verklaring', 'Lees bij het perspunt een korte, vriendelijke verklaring voor: het park geeft geen informatie over gasten.', 'medium', 'normal', fac('A')],
    ['recreatie', 'CR_PRESS_TOUR', 'Rondleiding voor de pers', 'Geef de pers een rondleiding langs de golfbaan en de grachten, zodat ze iets moois kunnen filmen zonder gasten te storen.', 'medium', 'normal', fac('N', 'Z')],
    ['onderhoud', 'CR_WIFI_ROUTER', 'Netwerk herstarten', 'De hoofdrouter bij De werf hangt. Herstart hem volgens de checklist en kijk welke lampjes branden.', 'hard', 'critical', fac('I')],
    ['receptie', 'CR_WIFI_HOTSPOT', 'Noodhotspot voor de studio', 'Een artiest op schrijverskamp moet nu een demo uploaden. Zet bij de receptie de mobiele noodhotspot aan.', 'medium', 'critical', fac('A')],
    ['receptie', 'CR_WIFI_INFORM', 'Gasten informeren over wifi', 'Gasten bellen massaal over het wifi. Zet een bericht in de app en leg uit wanneer het weer werkt.', 'easy', 'high', fac('A')],
    ['onderhoud', 'CR_WIFI_CABLE', 'Kabelbreuk zoeken', 'Bij graafwerk bij {loc} is mogelijk een netwerkkabel geraakt. Zoek de breuk en zet hem tijdelijk door.', 'hard', 'high', GROUNDS],
    ['onderhoud', 'CR_WIFI_TEST', 'Wifi testen in de straten', 'Test met de laptop in elke straat of het wifi weer snel genoeg is voor videobellen en streamen.', 'medium', 'normal', fac('I')],
    ['horeca', 'CR_WIFI_GOODWILL', 'Drankje als goedmakertje', 'Het wifi werkt weer. Trakteer gasten in de brasserie op een drankje als goedmakertje.', 'easy', 'normal', fac('G')],
    ['terrein', 'CR_PARK_DIRECT', 'Verkeer op het parkeerterrein', 'Het parkeerterrein bij het hart staat vol en auto\'s draaien rondjes. Wijs de laatste vrije plekken aan.', 'medium', 'high', fac('A')],
    ['terrein', 'CR_PARK_SIGNS', 'Borden plaatsen', 'Zet borden langs de ingangsweg: "Parkeerterrein vol, volg de borden naar de overloop".', 'easy', 'high', fac('A')],
    ['terrein', 'CR_PARK_OVERFLOW', 'Overloopterrein openen', 'Open het grasveld naast de driving range als tijdelijk parkeerterrein: linten voor de rijbaan, iemand bij de ingang.', 'hard', 'high', fac('R')],
    ['terrein', 'CR_PARK_SHUTTLE', 'Pendel met golfkarren', 'Bezoekers op het overloopterrein moeten ver lopen. Zet golfkarren en bolderkarren klaar voor de bagage.', 'medium', 'normal', fac('R', 'A')],
    ['receptie', 'CR_PARK_INFORM', 'Aankomende gasten bellen', 'Bel gasten die vandaag nog komen: parkeren op de overloop en de bagage gaat met de golfkar.', 'easy', 'normal', fac('A')],
    ['terrein', 'CR_PARK_CLEAR', 'Overloop weer vrijmaken', 'Het is rustiger. Begeleid de auto\'s van het grasveld terug en maak het veld weer netjes.', 'medium', 'normal', fac('R')],
    // blue-green algae in the canals
    ['water', 'CR_ALGAE_SAMPLE', 'Watermonster nemen', 'In de grachten drijft blauwalg. Neem monsters bij drie steigers en stuur ze naar het lab.', 'medium', 'critical', GROUNDS],
    ['receptie', 'CR_ALGAE_INFORM', 'Gasten informeren', 'Laat alle villa\'s aan het water weten: niet zwemmen in de gracht en honden uit het water houden.', 'easy', 'high', fac('A')],
    ['water', 'CR_ALGAE_BOATS', 'Kano\'s en SUP\'s binnenhalen', 'Haal de kano\'s en SUP\'s bij de steigers uit het water tot het water weer schoon is.', 'medium', 'high', GROUNDS],
    ['recreatie', 'CR_ALGAE_ALTERNATIVE', 'Alternatief programma', 'Niemand mag het water op. Organiseer bij de speeltuin en de jeu-de-boulesbaan een alternatief programma.', 'medium', 'normal', fac('S', 'Z')],
    ['onderhoud', 'CR_ALGAE_PUMP', 'Doorstroming aanzetten', 'Zet bij De werf de pomp aan die vers water door de grachten laat stromen.', 'hard', 'high', fac('I')],
    ['water', 'CR_ALGAE_CLEAR', 'Water weer vrijgeven', 'De uitslag is goed. Haal de waarschuwingsborden weg en zet de kano\'s terug.', 'easy', 'normal', GROUNDS],
    // sloepen adrift after a broken mooring post
    ['water', 'CR_DRIFT_SPOT', 'Sloepen zoeken', 'Drie sloepen zijn losgeslagen en drijven door de grachten. Kijk vanaf de bruggen waar ze zijn.', 'medium', 'critical', GROUNDS],
    ['water', 'CR_DRIFT_TOW', 'Sloepen terugslepen', 'Sleep de sloepen met de werkboot terug naar hun steiger. Niemand springt in het water.', 'hard', 'high', GROUNDS],
    ['water', 'CR_DRIFT_POST', 'Meerpaal herstellen', 'De meerpaal waar de sloepen aan lagen is afgebroken. Tijdelijk een nieuwe zetten.', 'hard', 'high', GROUNDS],
    ['receptie', 'CR_DRIFT_OWNERS', 'Gasten informeren', 'Laat de gasten van de drie villa\'s weten dat hun sloep terug is en of er schade is.', 'easy', 'normal', fac('A')],
    ['water', 'CR_DRIFT_CHECK', 'Alle steigers controleren', 'Loop alle steigers langs: liggen de andere sloepen dubbel vast?', 'medium', 'normal', GROUNDS],
  ] as Row[]).map(([g, code, title, text, d, u, loc]) => t(g, code, title, text, d, u, 0, { crisisOnly: true, location: loc, claimMin: d === 'hard' || d === 'crisis' ? 20 : 15 })),
  // ---------------------------------------------------------------- storyline chapters (guestlib, only within a storyline)
  // {lead} = lead guest, {household}, {label}, {project}; house tasks happen at the household's own villa
  ...([
    // songwriting camp (artists)
    ['receptie', 'STY_CAMP_QUIET', 'Stilte voor de schrijvers', 'Bij {loc} wordt een nieuw nummer geschreven, maar de buren blazen blad. Vraag vriendelijk om het later te doen.', 'easy', 'normal', house()],
    ['onderhoud', 'STY_CAMP_PIANO', 'Piano stemmen', 'De vleugel in {loc} is vals na de verhuizing van de studio. Laat de pianostemmer langskomen en help sjouwen.', 'medium', 'normal', house()],
    ['horeca', 'STY_CAMP_DEMO_NIGHT', 'Demo-avond in de brasserie', '{lead} wil de nieuwe nummers voor {label} laten horen in de brasserie. Zet een hoek met lounge en geluid klaar.', 'medium', 'normal', fac('G', 'H')],
    ['onderhoud', 'STY_STUDIO_POWER', 'Stroom voor de thuisstudio', 'De studioapparatuur van {lead} laat de groep uitvallen in {loc}. Leg een veilige extra groep aan.', 'medium', 'high', house()],
    ['schoonmaak', 'STY_STUDIO_DAMPING', 'Geluid dempen', 'Voor de opnames in {loc} wil {lead} dekens en matrassen tegen de glaspui. Breng ze en help ophangen.', 'easy', 'normal', house()],
    ['receptie', 'STY_STUDIO_UPLOAD', 'Upload naar het label', 'De opnames voor {project} moeten vanavond naar {label}. Het wifi in {loc} haalt het niet. Regel een snelle verbinding.', 'medium', 'high', house()],
    ['water', 'STY_JETTY_SUNRISE', 'Schrijven bij zonsopgang', '{lead} wil om zes uur schrijven op de steiger van {loc}. Zet een stoel, een deken en thee klaar.', 'easy', 'normal', house()],
    ['onderhoud', 'STY_JETTY_BOARD', 'Losse plank', 'De gitaar van {lead} viel bijna in de gracht door een losse plank op de steiger van {loc}. Vastzetten.', 'easy', 'high', house()],
    ['water', 'STY_JETTY_SLOEP', 'Rondje inspiratie', '{lead} wil een rondje varen voor inspiratie. Zorg voor een opgeladen sloep met een vaarkaart.', 'easy', 'normal', house()],
    ['horeca', 'STY_DEADLINE_COFFEE', 'Koffie voor de deadline', 'Het refrein van {project} moet morgen bij {label} liggen. Breng een thermoskan koffie en iets lekkers naar {loc}.', 'easy', 'high', house()],
    ['receptie', 'STY_DEADLINE_PRINT', 'Teksten printen', '{lead} wil de songteksten op papier om te schrappen. De printer bij de receptie weigert. Oplossen.', 'easy', 'normal', fac('A')],
    ['receptie', 'STY_DEADLINE_NEIGHBOURS', 'Nachtelijk gitaarspel', 'De buren van {loc} horen om twee uur \'s nachts hetzelfde akkoord voor de veertigste keer. Bemiddel met oordopjes en begrip.', 'easy', 'normal', house()],
    ['recreatie', 'STY_LISTEN_STAGE', 'Podium bij de Residentie', 'Bouw met het team een klein podium in het gras bij de Residentie voor de luistersessie van {lead}.', 'medium', 'normal', fac('N', 'Z')],
    ['onderhoud', 'STY_LISTEN_SOUND', 'Geluid voor de luistersessie', 'Sluit de geluidsinstallatie aan voor {lead} en doe een soundcheck. Geen piep, geen kraak.', 'medium', 'high', fac('N', 'Z')],
    ['horeca', 'STY_LISTEN_CROWD', 'Publiek bij de luistersessie', 'Half het park komt luisteren naar {lead}. Zorg voor een nette rij en drinken voor iedereen.', 'hard', 'high', fac('G', 'H')],
    ['receptie', 'STY_LYRICS_LOSTFOUND', 'Notitieboek zoeken', 'Het notitieboek van {lead} met alle teksten voor {project} is kwijt. Kijk bij de gevonden voorwerpen.', 'easy', 'high', fac('A')],
    ['golf', 'STY_LYRICS_RANGE', 'Notitieboek op de range', 'Een golfer zag een zwart boekje bij de ballenautomaat van de driving range. Ophalen voordat het gaat regenen.', 'easy', 'high', fac('R')],
    // well-to-do guests
    ['horeca', 'STY_CHEF_GROCERIES', 'Boodschappen voor de privekok', 'De privekok van {household} in {loc} mist truffel, kreeft en verse dragon. Regel het via de brasserie.', 'medium', 'normal', house()],
    ['onderhoud', 'STY_CHEF_OVEN', 'Oven werkt niet', 'Net nu de privekok begint, werkt de stoomoven in {loc} niet. Snel nakijken.', 'medium', 'high', house()],
    ['horeca', 'STY_CHEF_GLASSES', 'Glazen en servies', 'Voor het diner van {household} zijn twaalf wijnglazen en een tweede set borden nodig in {loc}.', 'easy', 'normal', house()],
    ['water', 'STY_YACHT_MOOR', 'Eigen boot aanleggen', '{lead} komt met een eigen sloep van 7 meter via het water. Wijs een plek aan de steiger van {loc} en help aanleggen.', 'medium', 'high', house()],
    ['onderhoud', 'STY_YACHT_POWER', 'Walstroom voor de boot', 'De boot van {lead} wil walstroom bij {loc}. Regel een veilige kabel met een aardlekschakelaar.', 'medium', 'normal', house()],
    ['horeca', 'STY_YACHT_PICNIC', 'Picknick aan boord', '{lead} wil met gasten een vaartocht maken met een picknickmand. Laat de brasserie hem klaarmaken.', 'easy', 'normal', fac('G')],
    ['golf', 'STY_DEAL_CART', 'Golfkar voor de zakenpartners', '{lead} speelt morgen negen holes met zakenpartners. Zorg voor twee schone golfkarren met water aan boord.', 'easy', 'normal', fac('O', 'R')],
    ['golf', 'STY_DEAL_GREEN', 'Perfecte green', 'Voor de flight van {lead} moet de green van hole 9 er perfect bij liggen. Maaien en de vlag rechtzetten.', 'medium', 'normal', fac('O')],
    ['horeca', 'STY_DEAL_LUNCH', 'Lunch na de ronde', 'Na de ronde wil {lead} een rustige tafel op het terras met uitzicht op hole 9. Reserveer en dek.', 'easy', 'normal', fac('H', 'G')],
    ['onderhoud', 'STY_POOLPARTY_HEAT', 'Zwembad verwarmen', '{household} geeft vanavond een poolparty. Het privezwembad bij {loc} moet minstens 28 graden zijn.', 'medium', 'high', house()],
    ['receptie', 'STY_POOLPARTY_NEIGHBOURS', 'Buren van de poolparty', 'De buren van {loc} vinden de poolparty gezellig, tot 23:00 uur. Spreek een eindtijd af.', 'easy', 'normal', house()],
    ['schoonmaak', 'STY_POOLPARTY_CLEANUP', 'Opruimen na de party', 'Na de poolparty bij {loc} drijven er bekertjes, slingers en een opblaasflamingo in het zwembad. Opruimen.', 'medium', 'normal', house()],
    ['receptie', 'STY_ART_DELIVERY', 'Kunstwerk bezorgd', 'Er komt een beeldhouwwerk van 200 kilo voor {loc}. Regel een palletwagen en wijs de bezorger de weg.', 'medium', 'normal', house()],
    ['terrein', 'STY_ART_PLACE', 'Kunstwerk plaatsen', 'Het beeld moet op het terras van {loc}, precies in het midden. Help met plaatsen, zonder de tegels te breken.', 'hard', 'normal', house()],
    // families
    ['horeca', 'STY_BDAY_CAKE', 'Verjaardagstaart', 'Oma van {household} wordt 80. Regel een taart met 80 kaarsjes (of twee met een 8 en een 0) voor {loc}.', 'easy', 'normal', house()],
    ['schoonmaak', 'STY_BDAY_DECOR', 'Versieren', 'Versier het terras van {loc} met slingers en ballonnen voor de verjaardag van oma.', 'easy', 'normal', house()],
    ['water', 'STY_BDAY_SLOEP', 'Rondvaart voor oma', 'Als verrassing wil {household} oma een rondvaart geven. Regel een sloep met een kussen en een deken.', 'easy', 'normal', house()],
    ['golf', 'STY_GRANDPA_RANGE', 'Opa leert golfen', 'Opa van {household} wil het ook eens proberen. Leg op de driving range uit hoe je een bal slaat, en waar je niet gaat staan.', 'easy', 'normal', fac('R')],
    ['golf', 'STY_GRANDPA_BALLS', 'Verdwaalde ballen', 'Opa heeft zijn bal in de bunker, de vijver en het bos geslagen. Zoek er een paar terug.', 'easy', 'normal', fac('O', 'L')],
    ['water', 'STY_CANOE_LOST', 'Kinderen in de kano', 'De kinderen van {household} zijn met de kano een gracht te ver gevaren en weten de weg niet terug. Vind ze (vanaf de kant).', 'medium', 'high', GROUNDS],
    ['schoonmaak', 'STY_CANOE_DRY', 'Droge kleren', 'De kinderen zijn terug, kletsnat maar blij. Breng handdoeken en warme chocomelk naar {loc}.', 'easy', 'normal', house()],
    ['terrein', 'STY_FEUD_MEDIATE', 'Ruzie over de haag', 'De buren van {loc} hebben ruzie over hoe hoog de haag mag. Bemiddel met een meetlint en geduld.', 'medium', 'high', house()],
    ['water', 'STY_FEUD_JETTY', 'Ruzie over de steiger', 'Nu gaat het over wiens sloep aan welke kant van de steiger ligt. Leg het uit met de plattegrond.', 'easy', 'normal', house()],
    ['horeca', 'STY_FEUD_DINNER', 'Verzoeningsdiner', 'Er is vrede. Een gezamenlijke barbecue op het terras van {loc} moet het bezegelen.', 'medium', 'normal', house()],
    // cameo guests added by the game master
    ['receptie', 'STY_CELEB_AUTOGRAPH', 'Handtekeningenrij', 'Bij de receptie staan gasten in de rij voor een handtekening van {lead}. Zorg voor een nette rij en een pen die het doet.', 'easy', 'normal', fac('A')],
    ['horeca', 'STY_CELEB_QUIET_TABLE', 'Rustig tafeltje', 'Regel voor {lead} een rustig tafeltje achter in de brasserie, uit het zicht van nieuwsgierige gasten.', 'easy', 'normal', fac('G', 'H')],
  ] as Row[]).map(([g, code, title, text, d, u, loc]) =>
    t(g, code, title, text, d, u, 0, { storyOnly: true, location: loc, when: {}, offeredMaxMin: 40, cooldownMin: 30, onTimeout: { mood: -0.05 } })),
];

export const CRISES: CrisisTemplate[] = [
  // Each crisis is a process: a first report, then follow-up reports over time (afterMin from the start), 4-8 tasks in total.
  { code: 'CRISIS_WATER_MAIN', title: 'Waterleiding gesprongen', icon: 'drop', fx: 'splash', location: GROUNDS, weight: 1,
    texts: ['Bij {loc} spuit een fontein uit de grond die er gisteren nog niet was. Een hoofdwaterleiding is gesprongen.'],
    stages: [
      { afterMin: 0, text: 'Hoofdkraan dicht en gebied afzetten', tasks: ['CR_WATER_MAIN_VALVE', 'CR_WATER_SIGNS'] },
      { afterMin: 10, text: 'Gasten zonder water: flessen uitdelen', tasks: ['CR_WATER_BOTTLES'] },
      { afterMin: 20, text: 'De straten informeren', tasks: ['CR_WATER_INFORM'] },
      { afterMin: 35, text: 'De loodgieter is er: repareren', tasks: ['CR_WATER_MAIN_REPAIR'] },
      { afterMin: 60, text: 'Water terug, maar bruin: doorspoelen', tasks: ['CR_WATER_FLUSH'] },
      { afterMin: 75, text: 'Opruimen', tasks: ['CR_WATER_CLEANUP'] },
    ] },
  { code: 'CRISIS_BLACKOUT', title: 'Grote stroomstoring', icon: 'bolt', fx: 'spark', location: fac('I'), weight: 1,
    texts: ['Een groot deel van het park zit zonder stroom. De privezwembaden staan stil en de koelkasten zuchten.'],
    stages: [
      { afterMin: 0, text: 'Oorzaak zoeken in de hoofdverdeler', tasks: ['CR_BLACKOUT_FUSEBOX'] },
      { afterMin: 8, text: 'Het wordt donker: zaklampen uitdelen', tasks: ['CR_BLACKOUT_TORCHES'] },
      { afterMin: 15, text: 'Noodstroom voor receptie en koeling', tasks: ['CR_BLACKOUT_GENERATOR'] },
      { afterMin: 25, text: 'Koelcellen controleren', tasks: ['CR_BLACKOUT_FRIDGES'] },
      { afterMin: 40, text: 'Ronde langs kwetsbare gasten', tasks: ['CR_BLACKOUT_ROUNDS'] },
      { afterMin: 55, text: 'Stroom terug: alles weer opstarten', tasks: ['CR_BLACKOUT_RESTART'] },
    ] },
  { code: 'CRISIS_CHECKIN', title: 'Incheckchaos', icon: 'key', fx: 'ring', location: fac('A'), weight: 1,
    texts: ['Het reserveringssysteem ligt plat terwijl de halve wereld tegelijk wil inchecken.'],
    stages: [
      { afterMin: 0, text: 'Systeem herstarten', tasks: ['CR_CHECKIN_SYSTEM'] },
      { afterMin: 10, text: 'Overstappen op papier', tasks: ['CR_CHECKIN_PAPER'] },
      { afterMin: 20, text: 'De rij wordt lang: koffie uitdelen', tasks: ['CR_CHECKIN_COFFEE'] },
      { afterMin: 30, text: 'Auto\'s bij de slagboom begeleiden', tasks: ['CR_CHECKIN_TRAFFIC'] },
      { afterMin: 45, text: 'Sleutelkaarten met de hand uitgeven', tasks: ['CR_CHECKIN_KEYS'] },
      { afterMin: 60, text: 'Excuses aan de gedupeerden', tasks: ['CR_CHECKIN_SORRY'] },
    ] },
  { code: 'CRISIS_ALGAE', title: 'Blauwalg in de grachten', icon: 'drop', fx: 'splash', location: GROUNDS, weight: 1,
    texts: ['Na de warme dagen drijft er blauwalg in de grachten. Zwemmen en varen moet direct stoppen.'],
    stages: [
      { afterMin: 0, text: 'Monsters nemen', tasks: ['CR_ALGAE_SAMPLE'] },
      { afterMin: 8, text: 'Gasten aan het water informeren', tasks: ['CR_ALGAE_INFORM'] },
      { afterMin: 15, text: 'Kano\'s en SUP\'s uit het water', tasks: ['CR_ALGAE_BOATS'] },
      { afterMin: 25, text: 'Alternatief voor de kinderen', tasks: ['CR_ALGAE_ALTERNATIVE'] },
      { afterMin: 40, text: 'Doorstroming aanzetten', tasks: ['CR_ALGAE_PUMP'] },
      { afterMin: 60, text: 'Water weer vrijgeven', tasks: ['CR_ALGAE_CLEAR'] },
    ] },
  { code: 'CRISIS_SLOEPEN_DRIFT', title: 'Sloepen op drift', icon: 'boat', fx: 'splash', location: GROUNDS, weight: 1,
    texts: ['Een meerpaal is afgebroken en drie sloepen drijven stuurloos door de grachten.'],
    stages: [
      { afterMin: 0, text: 'Waar zijn de sloepen?', tasks: ['CR_DRIFT_SPOT'] },
      { afterMin: 10, text: 'Terugslepen met de werkboot', tasks: ['CR_DRIFT_TOW'] },
      { afterMin: 25, text: 'Meerpaal herstellen', tasks: ['CR_DRIFT_POST'] },
      { afterMin: 40, text: 'Gasten informeren', tasks: ['CR_DRIFT_OWNERS'] },
      { afterMin: 50, text: 'Alle steigers controleren', tasks: ['CR_DRIFT_CHECK'] },
    ] },
  { code: 'CRISIS_STORM', title: 'Zware onweersbui', icon: 'bolt', fx: 'splash', location: GROUNDS, weight: 1,
    texts: ['Het KNMI waarschuwt voor zwaar onweer met windstoten. Over een kwartier is de bui boven het park.'],
    stages: [
      { afterMin: 0, text: 'Gasten waarschuwen', tasks: ['CR_STORM_INFORM'] },
      { afterMin: 5, text: 'Golfbaan ontruimen', tasks: ['CR_STORM_GOLF_OUT'] },
      { afterMin: 10, text: 'Terras stormvrij maken', tasks: ['CR_STORM_TERRACE'] },
      { afterMin: 15, text: 'Sloepen vastleggen', tasks: ['CR_STORM_SLOEPEN'] },
      { afterMin: 30, text: 'Er is een boom omgewaaid', tasks: ['CR_STORM_TREE'] },
      { afterMin: 40, text: 'Een villa lekt', tasks: ['CR_STORM_LEAK'] },
      { afterMin: 70, text: 'Opruimen na de bui', tasks: ['CR_STORM_CLEANUP'] },
    ] },
  { code: 'CRISIS_FIRE_ALARM', title: 'Brandalarm in de brasserie', icon: 'alert', fx: 'spark', location: fac('G'), weight: 0.8,
    texts: ['Het brandalarm in Brasserie Harderwold gaat af en er komt rook uit de keuken.'],
    stages: [
      { afterMin: 0, text: 'Brasserie rustig ontruimen', tasks: ['CR_FIRE_EVACUATE'] },
      { afterMin: 5, text: 'Iedereen tellen bij het verzamelpunt', tasks: ['CR_FIRE_HEADCOUNT'] },
      { afterMin: 10, text: 'De brandweer opvangen', tasks: ['CR_FIRE_BRIGADE'] },
      { afterMin: 25, text: 'Loos alarm: afzuiging nakijken', tasks: ['CR_FIRE_KITCHEN'] },
      { afterMin: 40, text: 'Luchten en schoonmaken', tasks: ['CR_FIRE_AIR'] },
      { afterMin: 55, text: 'Weer open', tasks: ['CR_FIRE_REOPEN'] },
    ] },
  { code: 'CRISIS_PRESS', title: 'Pers bij de slagboom', icon: 'alert', fx: 'ring', location: fac('A'), weight: 1,
    texts: ['Het nieuws is uitgelekt dat er een bekende artiest op schrijverskamp is. Fotografen en verslaggevers staan bij de receptie.'],
    stages: [
      { afterMin: 0, text: 'Een perspunt inrichten', tasks: ['CR_PRESS_DESK'] },
      { afterMin: 10, text: 'Persbusjes blokkeren de weg', tasks: ['CR_PRESS_PARKING'] },
      { afterMin: 20, text: 'Fotografen lopen het park in', tasks: ['CR_PRESS_PRIVACY'] },
      { afterMin: 30, text: 'Koffie voor de wachtende pers', tasks: ['CR_PRESS_COFFEE'] },
      { afterMin: 40, text: 'Een korte verklaring', tasks: ['CR_PRESS_STATEMENT'] },
      { afterMin: 55, text: 'Rondleiding als afleiding', tasks: ['CR_PRESS_TOUR'] },
    ] },
  { code: 'CRISIS_WIFI', title: 'Wifi-storing op het schrijverskamp', icon: 'bolt', fx: 'spark', location: fac('I'), weight: 1,
    texts: ['Het hele park zit zonder wifi, net nu de artiesten op schrijverskamp hun demo\'s moeten insturen.'],
    stages: [
      { afterMin: 0, text: 'Netwerk herstarten', tasks: ['CR_WIFI_ROUTER'] },
      { afterMin: 5, text: 'Noodhotspot voor de studio', tasks: ['CR_WIFI_HOTSPOT'] },
      { afterMin: 15, text: 'Gasten informeren', tasks: ['CR_WIFI_INFORM'] },
      { afterMin: 25, text: 'Kabelbreuk zoeken', tasks: ['CR_WIFI_CABLE'] },
      { afterMin: 45, text: 'Testen in de straten', tasks: ['CR_WIFI_TEST'] },
      { afterMin: 60, text: 'Goedmakertje', tasks: ['CR_WIFI_GOODWILL'] },
    ] },
  { code: 'CRISIS_PARKING', title: 'Parkeerterrein vol', icon: 'car', fx: 'ring', location: fac('A'), weight: 1,
    texts: ['Het parkeerterrein bij het hart zit vol door een golfwedstrijd, en er komen nog steeds auto\'s aan.'],
    stages: [
      { afterMin: 0, text: 'Laatste plekken aanwijzen', tasks: ['CR_PARK_DIRECT'] },
      { afterMin: 8, text: 'Borden langs de ingangsweg', tasks: ['CR_PARK_SIGNS'] },
      { afterMin: 15, text: 'Overloopterrein openen', tasks: ['CR_PARK_OVERFLOW'] },
      { afterMin: 25, text: 'Bagage met de golfkar', tasks: ['CR_PARK_SHUTTLE'] },
      { afterMin: 35, text: 'Aankomende gasten bellen', tasks: ['CR_PARK_INFORM'] },
      { afterMin: 70, text: 'Overloop weer vrijmaken', tasks: ['CR_PARK_CLEAR'] },
    ] },
];

export const templateByCode = new Map(TEMPLATES.map((x) => [x.code, x]));
export const crisisByCode = new Map(CRISES.map((x) => [x.code, x]));
export const GROUP_NAMES: Record<Group, string> = {
  onderhoud: 'Onderhoud', schoonmaak: 'Schoonmaak', receptie: 'Receptie', horeca: 'Horeca', golf: 'Golf', water: 'Water & steigers',
  terrein: 'Terrein', natuur: 'Natuur', recreatie: 'Recreatie', chaos: 'Chaos', crisis: 'Crisis',
};

/** Validation of the whole library (also run by the tests). Returns a list of problems (empty = valid). */
export function validateLibrary(facilityKeys: Set<string>): string[] {
  const out: string[] = [];
  const codes = new Set<string>();
  for (const x of TEMPLATES) {
    if (codes.has(x.code)) out.push(`dubbele code ${x.code}`);
    codes.add(x.code);
    if (!x.title || !x.texts.length || x.texts.some((s) => s.length < 20)) out.push(`${x.code}: tekst ontbreekt of is te kort`);
    if (!(x.claimMin >= 2 && x.claimMin <= 30)) out.push(`${x.code}: tijdslimiet ${x.claimMin} min buiten 2-30`);
    if (!(x.cooldownMin > 0)) out.push(`${x.code}: geen cooldown`);
    if (!(x.offeredMaxMin >= 10)) out.push(`${x.code}: aanbodtijd te kort`);
    if (!x.icon || !x.fx) out.push(`${x.code}: icoon of animatie ontbreekt`);
    if (!Object.keys(x.onComplete).length) out.push(`${x.code}: geen effect bij afronden`);
    if (!Object.keys(x.onTimeout).length) out.push(`${x.code}: geen effect bij verlopen`);
    if (x.location.kind === 'facility' && !(x.location.facilities ?? []).some((f) => facilityKeys.has(f))) out.push(`${x.code}: geen geldige voorziening (${x.location.facilities})`);
    if (x.when.day && x.when.night) out.push(`${x.code}: tegelijk alleen dag en alleen nacht`);
  }
  for (const x of TEMPLATES) {
    const e = x.onTimeout.escalate;
    if (e && !templateByCode.has(e)) out.push(`${x.code}: escalatie naar onbekende ${e}`);
    if (e === x.code) out.push(`${x.code}: escaleert naar zichzelf`);
    if (e && templateByCode.get(e)?.onTimeout.escalate) out.push(`${x.code}: escalatieketen langer dan 1 stap`);
  }
  for (const c of CRISES) {
    if (!c.stages.length || c.stages[0].afterMin !== 0) out.push(`${c.code}: eerste fase moet direct starten`);
    for (const s of c.stages) for (const k of s.tasks) { const tt = templateByCode.get(k); if (!tt) out.push(`${c.code}: onbekende deelopdracht ${k}`); else if (!tt.crisisOnly) out.push(`${c.code}: deelopdracht ${k} is geen crisis-sjabloon`); }
  }
  return out;
}
