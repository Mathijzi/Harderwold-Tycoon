// Task library (V3: at least 100 distinct templates in 10 groups, plus multi-step crises).
// Every template has preconditions, player-facing copy (variants), a time limit, points (difficulty x urgency),
// location selection, projector icon + effect, completion effects, timeout/escalation effects and a cooldown.
// Copy is Dutch, light-hearted and never asks for unsafe physical actions. Real people only appear as friendly cameos
// in storyline chapters (guestlib CELEBRITIES), never in an unflattering or invented private situation.

export type Difficulty = 'easy' | 'medium' | 'hard' | 'crisis';
export type Urgency = 'normal' | 'high' | 'critical';
export type Fx = 'sparkle' | 'splash' | 'spark' | 'leaf' | 'note' | 'bubble' | 'ring' | 'confetti';
export type Group = 'onderhoud' | 'schoonmaak' | 'receptie' | 'horeca' | 'zwembad' | 'fietsverhuur' | 'terrein' | 'natuur' | 'animatie' | 'chaos' | 'crisis';

/** Where the task happens. house: a bungalow (occupied = guests present, vacant = between guests);
 *  facility: one of the legend letters of AHT_Plat.pdf; grounds: somewhere outdoors (near a random bungalow). */
export interface LocationRule { kind: 'house' | 'facility' | 'grounds'; facilities?: string[]; occupied?: boolean; vacant?: boolean }
/** Changes to the location state (0..1 scales): technical condition, cleanliness, guest mood. */
export interface Effect { tech?: number; clean?: number; mood?: number }

export interface TaskTemplate {
  code: string; group: Group; category: string; title: string;
  /** player-facing text variants; {loc} = location name, {n} = bungalow number */
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

const G: Record<Exclude<Group, 'crisis'>, { category: string; icon: string; fx: Fx; location: LocationRule; td?: boolean; claimMin: number; cooldownMin: number; onComplete: Effect; onTimeout: Effect }> = {
  onderhoud: { category: 'Onderhoud', icon: 'wrench', fx: 'spark', location: { kind: 'house', occupied: true }, td: true, claimMin: 12, cooldownMin: 240, onComplete: { tech: 0.3, mood: 0.1 }, onTimeout: { tech: -0.1, mood: -0.1 } },
  schoonmaak: { category: 'Schoonmaak', icon: 'broom', fx: 'sparkle', location: { kind: 'house', occupied: true }, claimMin: 10, cooldownMin: 180, onComplete: { clean: 0.35, mood: 0.05 }, onTimeout: { clean: -0.1, mood: -0.08 } },
  receptie: { category: 'Receptie', icon: 'key', fx: 'ring', location: { kind: 'facility', facilities: ['A'] }, claimMin: 8, cooldownMin: 120, onComplete: { mood: 0.15 }, onTimeout: { mood: -0.12 } },
  horeca: { category: 'Horeca', icon: 'food', fx: 'bubble', location: { kind: 'facility', facilities: ['G', 'H'] }, claimMin: 8, cooldownMin: 90, onComplete: { mood: 0.1, tech: 0.1 }, onTimeout: { mood: -0.1 } },
  zwembad: { category: 'Zwembad', icon: 'swim', fx: 'splash', location: { kind: 'facility', facilities: ['J'] }, claimMin: 10, cooldownMin: 120, onComplete: { tech: 0.15, mood: 0.1 }, onTimeout: { mood: -0.1, tech: -0.05 } },
  fietsverhuur: { category: 'Fietsverhuur', icon: 'bike', fx: 'ring', location: { kind: 'facility', facilities: ['W'] }, claimMin: 10, cooldownMin: 90, onComplete: { mood: 0.1 }, onTimeout: { mood: -0.08 } },
  terrein: { category: 'Terrein', icon: 'tree', fx: 'leaf', location: { kind: 'grounds' }, claimMin: 15, cooldownMin: 180, onComplete: { tech: 0.15 }, onTimeout: { tech: -0.08, mood: -0.04 } },
  natuur: { category: 'Natuur', icon: 'paw', fx: 'leaf', location: { kind: 'grounds' }, td: true, claimMin: 15, cooldownMin: 240, onComplete: { mood: 0.1 }, onTimeout: { mood: -0.08 } },
  animatie: { category: 'Animatie', icon: 'star', fx: 'note', location: { kind: 'facility', facilities: ['T', 'C', 'Y', 'O', 'U', 'Q', 'R', 'L'] }, claimMin: 12, cooldownMin: 150, onComplete: { mood: 0.15 }, onTimeout: { mood: -0.1 } },
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
const DAY = { day: true }, NIGHT = { night: true };

export const TEMPLATES: TaskTemplate[] = [
  // ---------------------------------------------------------------- 1. Onderhoud (technische dienst, golfkar)
  t('onderhoud', 'MAINT_BLOCKED_TOILET', 'Verstopt toilet', 'In {loc} heeft iemand geprobeerd een badeend door te spoelen. Ontstoppen graag.', 'medium', 'high', 1.2, { claimMin: 8, onTimeout: { tech: -0.15, mood: -0.15, clean: -0.1, escalate: 'HK_URGENT_TURNOVER' }, texts2: ['Het toilet in {loc} geeft een geluid alsof er een walvis in woont. Even kijken?'] }),
  t('onderhoud', 'MAINT_LEAKING_TAP', 'Lekkende kraan', 'De keukenkraan in {loc} druppelt in het ritme van een technobeat. Vervang het kraanleertje.', 'medium', 'normal', 1.2, { claimMin: 10, onTimeout: { tech: -0.15, mood: -0.05, escalate: 'MAINT_WATER_DAMAGE' } }),
  t('onderhoud', 'MAINT_COLD_SHOWER', 'Koude douche', 'In {loc} komt alleen ijswater uit de douche. Controleer de boiler.', 'medium', 'high', 1.0, { claimMin: 10, texts2: ['De gasten van {loc} douchen nu in drie seconden recordtijd. Boiler checken!'] }),
  t('onderhoud', 'MAINT_HEATING_FAILURE', 'Verwarming doet niets', 'De thermostaat in {loc} staat op 21 graden, de kamer vindt 14 ook prima. Ontluchten en controleren.', 'medium', 'high', 0.9, { when: { night: false } }),
  t('onderhoud', 'MAINT_POWER_OUTAGE', 'Stroom uitgevallen', 'In {loc} is de stroom uitgevallen precies toen de pizza in de oven ging. Aardlekschakelaar controleren.', 'hard', 'high', 0.7, { claimMin: 12, onTimeout: { tech: -0.2, mood: -0.2 } }),
  t('onderhoud', 'MAINT_BROKEN_TV', 'Televisie kapot', 'De tv in {loc} toont alleen nog een weerbericht uit 2019. Kijk even naar de ontvanger.', 'easy', 'normal', 0.9),
  t('onderhoud', 'MAINT_JAMMED_DOOR', 'Deur klemt', 'De terrasdeur van {loc} gaat alleen nog open met een schouderduw en een aanloop. Scharnieren afstellen.', 'easy', 'normal', 0.9),
  t('onderhoud', 'MAINT_SMOKE_DETECTOR', 'Rookmelder piept', 'De rookmelder in {loc} piept elke 40 seconden. De batterij wil met pensioen.', 'easy', 'high', 0.9, { claimMin: 8, when: { night: true } }),
  t('onderhoud', 'MAINT_FRIDGE_FAILURE', 'Koelkast warm', 'De koelkast in {loc} is spontaan een broedmachine geworden. Thermostaat en compressor nakijken.', 'medium', 'high', 0.8),
  t('onderhoud', 'MAINT_PATIO_LIGHT', 'Terraslamp stuk', 'De terraslamp bij {loc} knippert als een discobal. Lampje en fitting vervangen.', 'easy', 'normal', 0.8, { when: { night: true } }),
  // ---------------------------------------------------------------- 2. Schoonmaak
  t('schoonmaak', 'HK_UNCLEAN_BUNGALOW', 'Bungalow niet schoon', 'De nieuwe gasten van {loc} vonden een kruimelspoor tot in de slaapkamer. Snel een nette ronde.', 'medium', 'high', 1.0),
  t('schoonmaak', 'HK_DIRTY_SHEETS', 'Vies beddengoed', 'Het beddengoed in {loc} heeft verdacht veel weg van een picknickkleed. Verschonen graag.', 'easy', 'normal', 1.0),
  t('schoonmaak', 'HK_MISSING_TOWELS', 'Handdoeken ontbreken', 'In {loc} zijn vier handdoeken en één badjas spoorloos. Breng een nieuwe set.', 'easy', 'normal', 1.1),
  t('schoonmaak', 'HK_OVERFLOWING_BIN', 'Afvalbak puilt uit', 'De container bij {loc} is zo vol dat de deksel een hoedje is geworden. Legen en schoonmaken.', 'easy', 'normal', 1.0, { location: { kind: 'grounds' } }),
  t('schoonmaak', 'HK_STAINED_SOFA', 'Vlek op de bank', 'Op de bank in {loc} prijkt een limonadevlek in de vorm van Drenthe. Vlekkenmiddel en geduld.', 'medium', 'normal', 0.8),
  t('schoonmaak', 'HK_LOST_PROPERTY', 'Gevonden voorwerp', 'In {loc} is een knuffelgiraf achtergebleven die dringend naar huis wil. Breng hem naar de receptie.', 'easy', 'normal', 0.8, { location: house({ occupied: false, vacant: true }) }),
  t('schoonmaak', 'HK_MUDDY_FLOOR', 'Modderige vloer', 'Na een boswandeling ligt de halve Drentse bodem in {loc}. Dweilen!', 'easy', 'normal', 1.1),
  t('schoonmaak', 'HK_BROKEN_VACUUM', 'Stofzuiger kapot', 'De stofzuiger van de schoonmaakploeg in de wasserette blaast in plaats van zuigt. Verwissel hem.', 'easy', 'normal', 0.6, { location: fac('M') }),
  t('schoonmaak', 'HK_NO_TOILET_PAPER', 'Wc-papier op', 'In {loc} is het laatste rolletje wc-papier zojuist gebruikt. Dit is een noodgeval.', 'easy', 'high', 1.1, { claimMin: 6 }),
  t('schoonmaak', 'HK_URGENT_TURNOVER', 'Spoedwissel', 'De gasten van {loc} zijn vertrokken en de volgende staan al bijna voor de slagboom. Snelle wisselschoonmaak!', 'hard', 'high', 0.9, { location: house({ occupied: false, vacant: true }), claimMin: 20, onComplete: { clean: 0.6, tech: 0.05 } }),
  // ---------------------------------------------------------------- 3. Receptie
  t('receptie', 'REC_MISSING_KEY', 'Sleutel kwijt', 'De gasten van {loc} staan buitengesloten; de sleutel ligt vermoedelijk in de jaszak van opa.', 'easy', 'high', 1.2, { location: house(), icon: 'key' }),
  t('receptie', 'REC_DOUBLE_BOOKING', 'Dubbele boeking', 'Twee gezinnen hebben allebei {loc} geboekt en kijken elkaar wantrouwig aan. Los het op.', 'hard', 'high', 0.6, { location: house() }),
  t('receptie', 'REC_WRONG_BUNGALOW', 'Verkeerde bungalow', 'Een familie heeft zich gezellig geïnstalleerd in {loc}, maar die was niet van hen. Breng ze naar de juiste.', 'medium', 'high', 0.7, { location: house() }),
  t('receptie', 'REC_LATE_CHECKIN', 'Late incheck', 'Een gezin belt dat het om 23:30 uur aankomt "na een kleine omweg via Duitsland". Regel de late incheck.', 'easy', 'normal', 0.8, { when: NIGHT }),
  t('receptie', 'REC_EARLY_ARRIVAL', 'Te vroeg', 'Er staat een gezin om 10:00 uur met zwembandjes al om, terwijl de bungalow pas om 15:00 klaar is. Bied iets leuks aan.', 'easy', 'normal', 0.8, { when: DAY }),
  t('receptie', 'REC_ANGRY_COMPLAINT', 'Boze klacht', 'Een gast is boos omdat de eenden te hard kwaken. Luister, bied excuses aan en noteer het.', 'medium', 'high', 0.9),
  t('receptie', 'REC_WRONG_GUEST_COUNT', 'Aantal gasten klopt niet', 'Bij {loc} staan vier personen geboekt, er stappen er negen uit één auto. Pas de reservering aan.', 'medium', 'normal', 0.6, { location: house() }),
  t('receptie', 'REC_UPGRADE_REQUEST', 'Upgrade-verzoek', 'De gasten van {loc} vragen of hun bungalow "een beetje groter" kan. Kijk wat er vrij is.', 'easy', 'normal', 0.7, { location: house() }),
  t('receptie', 'REC_FORGOTTEN_RESERVATION', 'Vergeten reservering', 'Een gast weet zeker dat hij geboekt heeft, het systeem weet het zeker van niet. Zoek het uit.', 'medium', 'high', 0.6),
  t('receptie', 'REC_CHECKOUT_DISPUTE', 'Discussie bij uitchecken', 'De gasten van {loc} vinden dat de gebroken vaas "er al zo stond". Handel het vriendelijk af.', 'medium', 'normal', 0.6, { location: house() }),
  // ---------------------------------------------------------------- 4. Horeca (brasserie G, snackbar H)
  t('horeca', 'FB_BROKEN_FRYER', 'Frituur stuk', 'De frituur van {loc} weigert dienst, precies op frietjesavond. Reset en controleer de thermostaat.', 'medium', 'high', 0.8, { location: fac('H') }),
  t('horeca', 'FB_COFFEE_MACHINE', 'Koffiemachine staakt', 'De koffiemachine in {loc} sist, pruttelt en levert alleen heet water. Ontkalken!', 'easy', 'high', 1.0, { when: DAY }),
  t('horeca', 'FB_MISSING_SUPPLIES', 'Voorraad op', 'In {loc} is de mayonaise op. Een halve camping staat met lege frietzakjes. Bevoorraden.', 'easy', 'normal', 0.9),
  t('horeca', 'FB_WRONG_ORDER', 'Verkeerde bestelling', 'Tafel 7 in {loc} kreeg 12 pannenkoeken in plaats van 2. Rechtzetten met een glimlach.', 'easy', 'normal', 0.9, { when: DAY }),
  t('horeca', 'FB_COLD_MEAL', 'Koud eten', 'Een gast in {loc} meldt dat zijn soep "verfrissend" is. Opnieuw opwarmen en een toetje erbij.', 'easy', 'normal', 0.8, { when: DAY }),
  t('horeca', 'FB_QUEUE_OVERFLOW', 'Rij tot buiten', 'De rij bij {loc} gaat inmiddels tot aan de parkeerplaats. Help mee uitserveren.', 'medium', 'high', 0.7, { when: DAY }),
  t('horeca', 'FB_FRIDGE_ALARM', 'Koelcel-alarm', 'Het alarm van de koelcel in {loc} piept. Deur dicht, temperatuur controleren.', 'medium', 'high', 0.6, { td: true }),
  t('horeca', 'FB_RESERVATION_MIXUP', 'Tafelreservering kwijt', 'Twee families hebben dezelfde tafel bij het raam in {loc}. Vind een oplossing met uitzicht.', 'easy', 'normal', 0.7, { when: DAY }),
  t('horeca', 'FB_SPILLED_DRINKS', 'Drankje omgestoten', 'Er is een dienblad met limonade gesneuveld in {loc}. Opdweilen voor iemand uitglijdt.', 'easy', 'high', 0.9, { onComplete: { clean: 0.3 } }),
  t('horeca', 'FB_SURPRISE_GROUP', 'Onverwachte groep', 'Een voetbalteam van 22 personen wil "even snel" eten in {loc}. Tafels schuiven!', 'hard', 'high', 0.4, { when: DAY }),
  // ---------------------------------------------------------------- 5. Zwembad (J)
  t('zwembad', 'POOL_TOO_COLD', 'Water te koud', 'Het zwemwater is zo koud dat de pinguïns van de ijsbaan op bezoek willen. Verwarming controleren.', 'medium', 'normal', 0.8, { td: true }),
  t('zwembad', 'POOL_PUMP_FAULT', 'Pomp storing', 'De circulatiepomp van het zwembad maakt een geluid als een grasmaaier. Storing uitlezen.', 'hard', 'high', 0.5, { td: true, onTimeout: { tech: -0.2, mood: -0.1, escalate: 'POOL_TEMP_CLOSED' } }),
  t('zwembad', 'POOL_MISSING_FLOATS', 'Drijfmiddelen weg', 'Alle zwembandjes zijn verdwenen. Een vermoeden gaat richting de kinderclub. Zoek en tel ze.', 'easy', 'normal', 0.8, { when: DAY }),
  t('zwembad', 'POOL_SLIPPERY_FLOOR', 'Gladde vloer', 'Bij de douches is het spiegelglad. Zet borden neer en maak de vloer droog.', 'easy', 'high', 1.0, { when: DAY, claimMin: 6 }),
  t('zwembad', 'POOL_LOCKER_FAILURE', 'Kluisje zit vast', 'Kluisje 42 zit op slot met de autosleutels van een gast erin. Loper meenemen.', 'easy', 'normal', 0.9, { when: DAY }),
  t('zwembad', 'POOL_LOST_GOGGLES', 'Duikbril kwijt', 'Een kind is zijn haaienduikbril kwijt. Een grondige zoektocht in het gevonden-voorwerpenbakje.', 'easy', 'normal', 0.8, { when: DAY }),
  t('zwembad', 'POOL_CHLORINE_SENSOR', 'Chloorsensor waarschuwt', 'De chloorsensor geeft een waarschuwing. Meting controleren en loggen.', 'medium', 'high', 0.6, { td: true }),
  t('zwembad', 'POOL_CHANGING_ROOM', 'Kleedhokjes vol', 'De kleedhokjes puilen uit van achtergelaten handdoeken. Opruimen en het gevonden-voorwerpenbakje vullen.', 'easy', 'normal', 0.8, { when: DAY, onComplete: { clean: 0.3 } }),
  t('zwembad', 'POOL_BROKEN_SHOWER', 'Douche lekt', 'Een zwembaddouche gaat niet meer uit. Kraan vervangen voor het waterbedrijf belt.', 'medium', 'normal', 0.7, { td: true }),
  t('zwembad', 'POOL_TEMP_CLOSED', 'Zwembad tijdelijk dicht', 'Het zwembad moet even dicht door een technische storing. Informeer gasten en zet het bord neer.', 'medium', 'high', 0.3, { onComplete: { mood: 0.05 } }),
  // ---------------------------------------------------------------- 6. Fietsverhuur (W)
  t('fietsverhuur', 'BIKE_PUNCTURE', 'Lekke band', 'Een gast komt aanlopen met een fiets met een band zo plat als een pannenkoek. Plakken!', 'easy', 'normal', 1.1, { when: DAY }),
  t('fietsverhuur', 'BIKE_MISSING', 'Fiets vermist', 'Huurfiets 17 is niet teruggebracht. Laatst gezien bij de ijssalon. Ga zoeken.', 'medium', 'normal', 0.6, { when: DAY, location: { kind: 'grounds' } }),
  t('fietsverhuur', 'BIKE_EMPTY_BATTERY', 'E-bike accu leeg', 'Een gast staat met een lege e-bike halverwege de bossen. Breng een volle accu.', 'medium', 'high', 0.8, { when: DAY, location: { kind: 'grounds' } }),
  t('fietsverhuur', 'BIKE_BROKEN_LOCK', 'Slot kapot', 'Het slot van fiets 9 heeft zichzelf voorgoed vastgezet. Vrijmaken en vervangen.', 'easy', 'normal', 0.8, { when: DAY }),
  t('fietsverhuur', 'BIKE_WRONG_RENTAL', 'Verkeerde fiets mee', 'Een gezin fietst rond op een kinderfiets maat 12. Ruil hem om voor de juiste.', 'easy', 'normal', 0.7, { when: DAY }),
  t('fietsverhuur', 'BIKE_CHAIN_OFF', 'Ketting eraf', 'Een fietser staat met zwarte handen naast een fiets zonder ketting. Help even.', 'easy', 'normal', 0.9, { when: DAY, location: { kind: 'grounds' } }),
  t('fietsverhuur', 'BIKE_LATE_RETURN', 'Te laat terug', 'Drie huurfietsen zijn twee uur over tijd. Bel de gasten en regel de inleverafspraak.', 'easy', 'normal', 0.7, { when: DAY }),
  t('fietsverhuur', 'BIKE_CHILD_SEAT', 'Kinderzitje stuk', 'Het kinderzitje van fiets 4 wiebelt verdacht. Vastzetten of vervangen.', 'easy', 'high', 0.6, { when: DAY }),
  t('fietsverhuur', 'BIKE_KEY_LOST', 'Fietssleutel kwijt', 'De sleutel van huurfiets 23 ligt ergens in het bos. Reservesleutel brengen.', 'easy', 'normal', 0.7, { when: DAY, location: { kind: 'grounds' } }),
  t('fietsverhuur', 'BIKE_TANDEM_MIXUP', 'Tandem-verwarring', 'Twee onbekenden zijn per ongeluk samen op een tandem vertrokken. Ze willen nu toch liever elk een eigen fiets.', 'medium', 'normal', 0.4, { when: DAY, location: { kind: 'grounds' } }),
  // ---------------------------------------------------------------- 7. Terrein
  t('terrein', 'GRD_FALLEN_BRANCH', 'Tak op het pad', 'Bij {loc} ligt een tak op het fietspad. Wegslepen en het pad vrijmaken.', 'medium', 'high', 1.0, { td: true }),
  t('terrein', 'GRD_BLOCKED_PATH', 'Pad geblokkeerd', 'Het wandelpad bij {loc} is geblokkeerd door een vergeten springkussen. Opruimen.', 'easy', 'normal', 0.8),
  t('terrein', 'GRD_STREETLIGHT', 'Lantaarn stuk', 'De lantaarnpaal bij {loc} geeft geen licht meer. Lampje vervangen.', 'medium', 'normal', 0.8, { when: NIGHT, td: true }),
  t('terrein', 'GRD_STUCK_BARRIER', 'Parkeerpaaltje vast', 'Het uitklapbare paaltje bij {loc} staat half omhoog en blokkeert de doorgang. Laat het zakken.', 'easy', 'high', 0.6),
  t('terrein', 'GRD_FULL_WASTE_STATION', 'Afvalstation vol', 'Het afvalstation bij {loc} stroomt over; de kraaien houden een feestje. Legen.', 'easy', 'normal', 1.0, { onComplete: { clean: 0.3 } }),
  t('terrein', 'GRD_SIGN_FALLEN', 'Bord omgevallen', 'Het richtingbord bij {loc} wijst nu recht naar de hemel. Rechtzetten.', 'easy', 'normal', 0.8),
  t('terrein', 'GRD_FLOODED_PATH', 'Pad onder water', 'Na de bui staat het pad bij {loc} blank. Wegvegen en een bord neerzetten.', 'medium', 'normal', 0.6),
  t('terrein', 'GRD_BROKEN_BENCH', 'Bankje kapot', 'Het bankje bij {loc} heeft een plank minder dan gisteren. Repareren.', 'easy', 'normal', 0.7, { td: true }),
  t('terrein', 'GRD_PARKING_CONFUSION', 'Verkeerd geparkeerd', 'Bij {loc} staat een auto in het vak van de buren, die nu op het gras willen parkeren. Help ze uit de brand.', 'easy', 'high', 0.7),
  t('terrein', 'GRD_DAMAGED_FENCE', 'Hek beschadigd', 'Het hekje bij {loc} hangt aan één scharnier. Repareren.', 'medium', 'normal', 0.6, { td: true }),
  // ---------------------------------------------------------------- 8. Natuur
  t('natuur', 'NAT_LOOSE_DOG', 'Loslopende hond', 'Een vrolijke labrador rent zonder baasje rond bij {loc}. Vind de eigenaar.', 'easy', 'high', 0.9, { td: false }),
  t('natuur', 'NAT_DUCKS_AT_POOL', 'Eenden bij het zwembad', 'Een eendenfamilie heeft het buitenbad ontdekt en weigert te vertrekken. Begeleid ze vriendelijk naar de vijver.', 'easy', 'normal', 0.7, { location: fac('J'), when: DAY, td: false }),
  t('natuur', 'NAT_MISSING_CAT', 'Kat vermist', 'De kat van de gasten van {loc} is "even weg". Kijk onder de bungalows en in de schuurtjes.', 'medium', 'normal', 0.6, { location: house(), td: false }),
  t('natuur', 'NAT_WASP_NEST', 'Wespennest', 'Bij {loc} zit een wespennest onder de dakrand. Afzetten en de specialist bellen.', 'medium', 'high', 0.7, { location: house(), when: DAY }),
  t('natuur', 'NAT_RABBITS_FLOWERS', 'Konijnen eten bloemen', 'De konijnen bij {loc} hebben de bloemperken als salade-bar ontdekt. Zet het gaas terug.', 'easy', 'normal', 0.8),
  t('natuur', 'NAT_BIRD_IN_SHOP', 'Vogel in de winkel', 'Een mus is de ParkShop binnengevlogen en zit nu op de chipsschappen. Deuren open en geduld.', 'easy', 'normal', 0.6, { location: fac('V'), when: DAY, td: false }),
  t('natuur', 'NAT_POND_LITTER', 'Zwerfvuil in de vijver', 'In de visvijver drijven drie ballonnen en een slipper. Opvissen met het schepnet.', 'easy', 'normal', 0.7, { onComplete: { clean: 0.3 } }),
  t('natuur', 'NAT_NIGHT_NOISE', 'Geluid in de nacht', 'De gasten van {loc} horen gestommel onder het terras. Waarschijnlijk een egel met een feestje. Ga kijken.', 'easy', 'normal', 0.6, { location: house(), when: NIGHT }),
  t('natuur', 'NAT_ESCAPED_RABBIT', 'Konijn ontsnapt', 'Het tamme konijn van de gasten van {loc} heeft de vrijheid gekozen. Help het terug te vinden.', 'medium', 'normal', 0.5, { location: house(), td: false }),
  t('natuur', 'NAT_GOOSE_PATH', 'Gans bewaakt het pad', 'Een gans bij {loc} heeft zichzelf tot portier benoemd en laat niemand meer door. Leid hem om.', 'easy', 'high', 0.6, { td: false }),
  // ---------------------------------------------------------------- 9. Animatie
  t('animatie', 'ENT_MASCOT_MISSING', 'Bollo zoek', 'Mascotte Bollo is niet op de kinderdisco verschenen. Zoek hem (en het kostuum).', 'medium', 'high', 0.5, { location: fac('T'), when: DAY }),
  t('animatie', 'ENT_BOWLING_BREAKDOWN', 'Bowlingbaan stuk', 'Baan 3 van de bowling geeft geen ballen meer terug. Machine resetten.', 'medium', 'normal', 0.7, { location: fac('C'), td: true }),
  t('animatie', 'ENT_CANCELLED_ACTIVITY', 'Activiteit afgelast', 'De boswandeling met de boswachter gaat niet door. Informeer de 30 aangemelde gezinnen.', 'easy', 'normal', 0.6, { when: DAY }),
  t('animatie', 'ENT_SOUND_FAILURE', 'Geluid valt weg', 'Bij de show in {loc} valt het geluid steeds weg. Kabels nalopen.', 'medium', 'high', 0.6, { location: fac('Y', 'T'), td: true }),
  t('animatie', 'ENT_TENNIS_DISPUTE', 'Tennisbaan dubbel geboekt', 'Twee families staan met rackets bij dezelfde tennisbaan. Maak een planning.', 'easy', 'normal', 0.6, { location: fac('Q'), when: DAY }),
  t('animatie', 'ENT_AIR_TRAMPOLINE', 'Airtrampoline dicht', 'De airtrampoline verliest lucht. Afzetten en de blower controleren.', 'medium', 'high', 0.5, { location: fac('Z', 'S'), when: DAY, td: true }),
  t('animatie', 'ENT_MINIGOLF_BALLS', 'Golfballetjes op', 'Bij de adventure golf zijn alle balletjes in de vijverhole verdwenen. Nieuwe brengen.', 'easy', 'normal', 0.7, { location: fac('U'), when: DAY }),
  t('animatie', 'ENT_FIELD_LIGHTS', 'Veldverlichting uit', 'De verlichting van het sportveld valt uit tijdens de avondvoetbal. Groepen controleren.', 'medium', 'high', 0.5, { location: fac('R', 'O'), when: NIGHT, td: true }),
  t('animatie', 'ENT_WRONG_SIGNAGE', 'Verkeerd programmabord', 'Op het programmabord staat "bingo voor honden". Dat moet "bingo met honden" zijn. Aanpassen.', 'easy', 'normal', 0.6),
  t('animatie', 'ENT_MICROPHONE', 'Microfoon stuk', 'De microfoon op het podium in de tent doet het niet. Batterijen en zender checken.', 'easy', 'high', 0.6, { location: fac('Y') }),
  // ---------------------------------------------------------------- 10. Komische chaos
  t('chaos', 'CHAOS_MASCOT_CHECKIN', 'Bollo checkt in', 'Iemand in een Bollo-pak staat bij de slagboom om in te checken voor een bungalow. Uitzoeken wie dat is.', 'medium', 'normal', 0.4, { location: fac('A'), when: DAY }),
  t('chaos', 'CHAOS_SYNC_TOILETS', 'Gesynchroniseerde toiletten', 'In drie bungalows rond {loc} spoelen de toiletten tegelijk door. Een loodgietersmysterie!', 'hard', 'high', 0.3, { td: true, location: house() }),
  t('chaos', 'CHAOS_EBIKE_PARADE', 'E-bike-optocht', 'Een vrijgezellenfeest op e-bikes rijdt in formatie over de hoofdweg. Leid ze naar het fietspad.', 'medium', 'high', 0.3, { when: DAY }),
  t('chaos', 'CHAOS_KEY_MIXUP', 'Sleutelchaos', 'Bij de receptie zijn twintig sleutels per ongeluk in één bak gegooid. Sorteren en uitdelen.', 'hard', 'normal', 0.3, { location: fac('A') }),
  t('chaos', 'CHAOS_KARAOKE', 'Middernachtkaraoke', 'Bij {loc} wordt om middernacht vol overgave karaoke gezongen. Vriendelijk vragen om het volume.', 'easy', 'high', 0.5, { location: house(), when: NIGHT }),
  t('chaos', 'CHAOS_ROGUE_CART', 'Schoonmaakkar op avontuur', 'Een schoonmaakkar is van de handrem afgerold en staat nu in een bloemperk bij {loc}. Terugduwen.', 'easy', 'normal', 0.4),
  t('chaos', 'CHAOS_RAIN_FLOOD', 'Wolkbreuk', 'Een plotselinge wolkbreuk zet paden bij {loc} blank. Zandzakjes en borden.', 'hard', 'high', 0.3, { onTimeout: { mood: -0.15, tech: -0.1, escalate: 'GRD_FLOODED_PATH' } }),
  t('chaos', 'CHAOS_WRONG_DELIVERIES', 'Bestellingen verkeerd bezorgd', 'Tien pizza\'s zijn naar de verkeerde bungalows gebracht. {loc} heeft er vier. Herverdelen!', 'medium', 'high', 0.4, { location: house() }),
  t('chaos', 'CHAOS_LOST_FOUND_PILE', 'Gevonden-voorwerpenberg', 'De bak met gevonden voorwerpen bevat inmiddels een surfplank, een fondueset en een opgezette eekhoorn. Inventariseren.', 'medium', 'normal', 0.3, { location: fac('A') }),
  t('chaos', 'CHAOS_FAKE_VIP', 'Neppe VIP', 'Een gast met zonnebril en een rode loper uit de ParkShop beweert een bekende ster te zijn. Kalm en gastvrij afhandelen.', 'easy', 'normal', 0.3, { location: fac('A', 'G'), when: DAY }),
  // ---------------------------------------------------------------- extra set (media event): 6 per group
  t('onderhoud', 'MAINT_RINGLIGHT_FUSE', 'Ringlamp slaat de stroom eruit', 'In {loc} slaan drie ringlampen en een föhn tegelijk de groep eruit. Zet de stroom terug en verdeel de apparaten.', 'medium', 'high', 0.9),
  t('onderhoud', 'MAINT_TV_NO_SIGNAL', 'Tv zonder beeld', 'De gasten van {loc} willen hun eigen uitzending terugkijken, maar de tv geeft "geen signaal". Kabel en ontvanger checken.', 'easy', 'normal', 1.0),
  t('onderhoud', 'MAINT_SAUNA_COLD', 'Sauna blijft koud', 'De sauna in {loc} wordt niet warmer dan een lauwe zomerdag. Controleer de thermostaat en de zekering.', 'medium', 'normal', 0.7),
  t('onderhoud', 'MAINT_DOORBELL_JINGLE', 'Deurbel speelt een jingle', 'De deurbel van {loc} speelt opeens een radiojingle en stopt niet meer. Ontkoppelen en een nieuwe plaatsen.', 'easy', 'normal', 0.6),
  t('onderhoud', 'MAINT_WINDOW_STUCK', 'Raam zit klem', 'In {loc} zit het slaapkamerraam klem, half open. Het wordt fris. Scharnieren nakijken en afstellen.', 'medium', 'normal', 0.9),
  t('onderhoud', 'MAINT_SMOKE_DETECTOR_BEEP', 'Piepende rookmelder', 'Een rookmelder in {loc} piept elke minuut: batterij bijna leeg. Vervang de batterij en test de melder.', 'easy', 'high', 1.0),
  t('schoonmaak', 'HK_CONFETTI_PARTY', 'Confetti na het feestje', 'Na een verjaardagsfeestje ligt er in {loc} confetti tot in de kussenslopen. Stofzuigen en de bank uitkloppen.', 'medium', 'normal', 0.9),
  t('schoonmaak', 'HK_MAKEUP_TOWELS', 'Make-up op de handdoeken', 'In {loc} is voor een opname make-up gedaan. Alle handdoeken zijn oranje. Vervang ze en reinig de wastafel.', 'easy', 'normal', 0.8),
  t('schoonmaak', 'HK_DOG_MUD', 'Modderpootjes', 'De hond van {loc} heeft een modderwandeling gemaakt, dwars door de woonkamer. Vloer en kleed reinigen.', 'medium', 'normal', 0.9),
  t('schoonmaak', 'HK_BBQ_GRILL', 'Barbecue schoonmaken', 'Het barbecuerooster bij {loc} is na drie avonden zwart. Schoonmaken voor de volgende gasten.', 'easy', 'normal', 0.8),
  t('schoonmaak', 'HK_FRIDGE_SMELL', 'Rare geur uit de koelkast', 'Uit de koelkast van {loc} komt een geur die niemand kan thuisbrengen. Leegmaken, reinigen en luchten.', 'medium', 'normal', 0.7),
  t('schoonmaak', 'HK_WINDOWS_STREAKS', 'Strepen op de ramen', 'De gasten van {loc} willen een mooie foto door het raam maken, maar de ramen zitten vol strepen. Lappen!', 'easy', 'normal', 0.8),
  t('receptie', 'REC_AUTOGRAPH_LINE', 'Handtekeningen bij de balie', 'Gasten vragen bij de balie of een BN\'er in het park even wil tekenen. Leg uit hoe het werkt en bewaak de privacy.', 'easy', 'normal', 1.0),
  t('receptie', 'REC_LOST_PHONE', 'Telefoon gevonden', 'Er is een telefoon ingeleverd die blijft trillen van de berichten. Zoek de eigenaar via de gastenlijst.', 'easy', 'normal', 1.0),
  t('receptie', 'REC_LATE_ARRIVAL', 'Late aankomst gemeld', 'Een gezin belt: ze komen pas na sluitingstijd. Regel een sleutelkluisje met de code per bericht.', 'medium', 'normal', 0.8),
  t('receptie', 'REC_TABLE_BOOKING', 'Tafel voor twaalf', 'Een groep wil vanavond met twaalf personen eten in De Brasserie. Regel een tafel en geef het door aan de keuken.', 'easy', 'normal', 0.9),
  t('receptie', 'REC_INTERVIEW_ROOM', 'Ruimte voor een interview', 'Een verslaggever vraagt een rustige ruimte voor een kort interview met een gast. Regel de vergaderruimte.', 'medium', 'normal', 0.8),
  t('receptie', 'REC_EXTRA_BED', 'Extra bedje', 'De gasten van een bungalow hebben onverwacht een logeetje. Regel een extra bed en laat het brengen.', 'easy', 'normal', 0.9),
  t('horeca', 'FB_GLUTEN_FREE', 'Glutenvrij menu', 'Een tafel vraagt een volledig glutenvrij menu. Overleg met de keuken en controleer elk ingrediënt.', 'medium', 'normal', 0.9),
  t('horeca', 'FB_BIRTHDAY_CAKE', 'Taart op het laatste moment', 'Over een uur is er een verjaardag en de taart is vergeten. Regel er een met kaarsjes.', 'medium', 'high', 0.8),
  t('horeca', 'FB_ESPRESSO_STRIKE', 'Koffiemachine in staking', 'De koffiemachine geeft alleen nog heet water. Ontkalken, herstarten en ondertussen filterkoffie zetten.', 'medium', 'high', 1.0),
  t('horeca', 'FB_TERRACE_RUSH', 'Rush op het terras', 'De zon breekt door en het terras loopt in één keer vol. Extra handen bij de bediening graag.', 'hard', 'high', 0.8),
  t('horeca', 'FB_KIDS_MENU', 'Kindermenu op', 'De frietjes voor het kindermenu zijn op. Regel een alternatief dat kinderen wél willen eten.', 'easy', 'normal', 0.8),
  t('horeca', 'FB_BAR_TAP', 'Tap schuimt alleen', 'De tap in de Brasserie schuimt alleen nog. Fust wisselen en de koeling controleren.', 'medium', 'normal', 0.8),
  t('zwembad', 'POOL_INFLATABLE_ARMY', 'Leger opblaasdieren', 'Er drijven negen opblaasflamingo\'s in het bad en zwemmers kunnen geen baantjes meer trekken. Maak afspraken.', 'easy', 'normal', 0.8),
  t('zwembad', 'POOL_SLIDE_QUEUE', 'Rij bij de glijbaan', 'Bij de glijbaan staat een rij tot de kleedhokjes en er wordt voorgedrongen. Houd toezicht bij de trap.', 'medium', 'high', 0.9),
  t('zwembad', 'POOL_TILE_LOOSE', 'Losse tegel', 'Bij de rand van het pierenbad zit een tegel los. Afzetten en de TD laten repareren.', 'medium', 'high', 0.8),
  t('zwembad', 'POOL_SWIM_LESSON', 'Zwemles invallen', 'De zwemleraar is ziek en er staan acht kinderen klaar. Regel een invaller met diploma.', 'medium', 'normal', 0.7),
  t('zwembad', 'POOL_GOGGLES_DEEP', 'Duikbril op de bodem', 'Een kind heeft zijn duikbril laten zinken in het diepe. Haal hem op met het schepnet.', 'easy', 'normal', 0.9),
  t('zwembad', 'POOL_TOWEL_SHORTAGE', 'Handdoeken op', 'Bij het zwembad zijn de verhuurhanddoeken op. Haal een nieuwe stapel bij de wasserette.', 'easy', 'normal', 0.8),
  t('fietsverhuur', 'BIKE_TANDEM_TROUBLE', 'Tandem met ruzie', 'Twee gasten komen terug met een tandem en een meningsverschil over wie er stuurde. Fiets nakijken.', 'easy', 'normal', 0.7),
  t('fietsverhuur', 'BIKE_CARGO_BIKE', 'Bakfiets gezocht', 'Een gezin wil een bakfiets en een fietskar. Zoek ze bij elkaar en stel ze af.', 'easy', 'normal', 0.9),
  t('fietsverhuur', 'BIKE_GROUP_TOUR', 'Groepstocht', 'Een groep van vijftien wil over een kwartier een fietstocht maken. Fietsen afstellen en routekaarten uitdelen.', 'hard', 'normal', 0.6),
  t('fietsverhuur', 'BIKE_HELMETS_KIDS', 'Kinderhelmen', 'Een gezin met vier kinderen wil fietsen, maar de kleine helmen liggen door elkaar. Passen en afstellen.', 'easy', 'normal', 0.9),
  t('fietsverhuur', 'BIKE_LOCK_LOST', 'Fietssleutel kwijt', 'Een huurfiets staat op slot bij het zwembad en de sleutel is weg. Neem de reservesleutel mee.', 'easy', 'normal', 0.9),
  t('fietsverhuur', 'BIKE_EBIKE_DEMO', 'Uitleg e-bike', 'Een oudere gast wil voor het eerst op een e-bike. Geef rustig uitleg en een proefrondje op het plein.', 'easy', 'normal', 0.8),
  t('terrein', 'GRD_SIGN_TURNED', 'Bord verdraaid', 'Het routebord bij {loc} is omgedraaid. Gasten lopen nu richting de vuilcontainers. Terugdraaien.', 'easy', 'normal', 0.9),
  t('terrein', 'GRD_LAMP_OUT', 'Lantaarn kapot', 'Bij {loc} brandt de lantaarn niet meer. Lamp vervangen voordat het donker wordt.', 'medium', 'normal', 0.9),
  t('terrein', 'GRD_HEDGE_OVERGROWN', 'Haag over het pad', 'Bij {loc} groeit de haag over het pad. Snoeien zodat fietsers er weer langs kunnen.', 'medium', 'normal', 0.8),
  t('terrein', 'GRD_DRONE_IN_TREE', 'Drone in de boom', 'Een vlogger heeft een drone in een boom bij {loc} laten hangen. Haal hem veilig naar beneden met de hoogwerker.', 'medium', 'normal', 0.7),
  t('terrein', 'GRD_PARKING_LINES', 'Parkeervak onduidelijk', 'Bij {loc} staan auto\'s scheef omdat de vakken vervaagd zijn. Markering bijwerken en pionnen plaatsen.', 'medium', 'normal', 0.6),
  t('terrein', 'GRD_BENCH_BROKEN', 'Bankje kapot', 'Het bankje bij {loc} heeft een losse plank. Repareren voordat iemand gaat zitten.', 'easy', 'normal', 0.8),
  t('natuur', 'NAT_SWAN_ON_ROAD', 'Zwaan op de weg', 'Een zwaan staat midden op de weg bij {loc} en is niet van plan opzij te gaan. Rustig begeleiden naar het water.', 'medium', 'high', 0.8),
  t('natuur', 'NAT_BEES_TERRACE', 'Bijen bij het terras', 'Bij {loc} hangt een bijenzwerm in een struik. Afzetten en een imker bellen.', 'medium', 'high', 0.6),
  t('natuur', 'NAT_FOX_BINS', 'Vos bij de afvalbakken', 'Een vos heeft bij {loc} de afvalbak omgegooid. Opruimen en de klep beter afsluiten.', 'easy', 'normal', 0.8),
  t('natuur', 'NAT_FROGS_CONCERT', 'Kikkerconcert', 'De gasten van {loc} kunnen niet slapen door een kikkerkoor in de sloot. Oordopjes brengen en uitleg geven.', 'easy', 'normal', 0.7),
  t('natuur', 'NAT_WOODPECKER', 'Specht op het dak', 'Een specht timmert op de dakgoot van {loc}. Afschrikken met een glimmend lint en de goot nakijken.', 'easy', 'normal', 0.7),
  t('natuur', 'NAT_DUCKLINGS_DRAIN', 'Kuikens in de put', 'Bij {loc} zijn drie eendenkuikens in een putje gevallen. Haal ze er voorzichtig uit en breng ze naar moeder.', 'medium', 'high', 0.7),
  t('animatie', 'ANIM_KARAOKE_SETUP', 'Karaoke-avond', 'Vanavond is er karaoke en de microfoons zijn zoek. Regel ze en zet de liedlijst klaar.', 'medium', 'normal', 0.9),
  t('animatie', 'ANIM_TALENT_SHOW', 'Talentenjacht', 'De kinderen willen een talentenjacht. Zet een podium klaar, maak een jury en deel diploma\'s uit.', 'medium', 'normal', 0.8),
  t('animatie', 'ANIM_BINGO', 'Bingo-avond', 'De bingomolen draait niet meer. Maak hem los en zorg dat de bingo om acht uur begint.', 'easy', 'normal', 0.9),
  t('animatie', 'ANIM_TREASURE_HUNT', 'Speurtocht', 'Er staat een speurtocht gepland, maar de aanwijzingen zijn nog niet verstopt. Verstoppen langs de route.', 'medium', 'normal', 0.8),
  t('animatie', 'ANIM_QUIZ_NIGHT', 'Muziekquiz', 'Voor de muziekquiz ontbreekt de geluidsinstallatie. Aansluiten en de quiz starten.', 'medium', 'normal', 0.8),
  t('animatie', 'ANIM_MINI_DISCO_DJ', 'Minidisco zonder dj', 'De minidisco begint zo, maar de dj zit vast in de file. Neem het over met de vaste afspeellijst.', 'easy', 'high', 0.8),
  t('chaos', 'CHAOS_FAN_BUS', 'Bus vol fans', 'Bij de slagboom staat een bus vol fans die "even" een BN\'er willen zien. Vriendelijk de weg wijzen.', 'hard', 'high', 0.4),
  t('chaos', 'CHAOS_FLASHMOB', 'Flashmob op het plein', 'Op het plein begint spontaan een flashmob en de bezorger kan er niet door. Ruimte maken zonder de pret te bederven.', 'medium', 'normal', 0.3, { location: fac('A') }),
  t('chaos', 'CHAOS_WRONG_KEYCARD', 'Verkeerde sleutelkaarten', 'Twee gezinnen hebben elkaars sleutelkaart en staan bij {loc} in de verkeerde bungalow. Uitzoeken en ruilen.', 'medium', 'high', 0.4, { location: house() }),
  t('chaos', 'CHAOS_BALLOON_ARCH', 'Ballonboog op drift', 'De ballonboog van een feestje is losgeraakt en drijft over het park. Vangen voordat hij in de bomen hangt.', 'easy', 'normal', 0.3),
  t('chaos', 'CHAOS_DOUBLE_BOOKING', 'Dubbel geboekt', 'Bij {loc} staan twee gezinnen met dezelfde boeking voor de deur. Regel snel een andere bungalow.', 'hard', 'high', 0.3, { location: house() }),
  t('chaos', 'CHAOS_FOOD_TRUCK', 'Foodtruck op de verkeerde plek', 'Een foodtruck voor het event staat geparkeerd bij {loc}, midden op de weg. Wijs hem de juiste plek.', 'medium', 'high', 0.3),
  // ---------------------------------------------------------------- follow-ups (escalation targets, not scheduled on their own)
  t('onderhoud', 'MAINT_WATER_DAMAGE', 'Waterschade', 'De lekkende kraan in {loc} is genegeerd en er staat nu water op de vloer. Droogleggen en de oorzaak verhelpen.', 'hard', 'high', 0, { claimMin: 20, onComplete: { tech: 0.4, mood: 0.1, clean: 0.2 }, onTimeout: { tech: -0.2, mood: -0.2 } }),
  // ---------------------------------------------------------------- crisis subtasks (only within a crisis)
  t('onderhoud', 'CR_WATER_MAIN_VALVE', 'Hoofdkraan dichtdraaien', 'Bij de gesprongen waterleiding moet de hoofdkraan dicht. Neem de sleutel mee uit de serviceruimte.', 'hard', 'critical', 0, { crisisOnly: true, location: fac('I'), claimMin: 10 }),
  t('onderhoud', 'CR_WATER_MAIN_REPAIR', 'Waterleiding repareren', 'Vervang het gesprongen stuk leiding samen met de loodgieter.', 'crisis', 'critical', 0, { crisisOnly: true, location: { kind: 'grounds' }, claimMin: 30 }),
  t('receptie', 'CR_WATER_BOTTLES', 'Water uitdelen', 'Zolang de leiding dicht is: deel flessen water uit aan de bungalows in de getroffen wijk.', 'medium', 'high', 0, { crisisOnly: true, location: fac('V'), claimMin: 20 }),
  t('onderhoud', 'CR_BLACKOUT_FUSEBOX', 'Hoofdverdeler controleren', 'Groot deel van het park zonder stroom. Controleer de hoofdverdeler in de serviceruimte.', 'hard', 'critical', 0, { crisisOnly: true, location: fac('I'), claimMin: 12 }),
  t('receptie', 'CR_BLACKOUT_TORCHES', 'Zaklampen uitdelen', 'Deel zaklampen en waxinelichtjes (in glazen houders) uit bij de receptie.', 'easy', 'high', 0, { crisisOnly: true, location: fac('A'), claimMin: 15 }),
  t('onderhoud', 'CR_BLACKOUT_RESTART', 'Installaties herstarten', 'De stroom is terug: herstart de pompen van het zwembad en de koelcellen in de horeca.', 'medium', 'high', 0, { crisisOnly: true, location: fac('J', 'G'), claimMin: 15 }),
  t('receptie', 'CR_CHECKIN_SYSTEM', 'Reserveringssysteem herstarten', 'Het reserveringssysteem is gecrasht en er staat een rij tot aan de slagboom. Herstart het systeem.', 'hard', 'critical', 0, { crisisOnly: true, location: fac('A'), claimMin: 10 }),
  t('receptie', 'CR_CHECKIN_PAPER', 'Handmatig inchecken', 'Zolang het systeem plat ligt: check gasten handmatig in op papier en geef koffie in de rij.', 'medium', 'high', 0, { crisisOnly: true, location: fac('A'), claimMin: 20 }),
  t('zwembad', 'CR_POOL_EVACUATE', 'Zwembad ontruimen', 'Het zwembad moet dicht. Vraag iedereen rustig het water uit te gaan en zet de afzetlinten.', 'medium', 'critical', 0, { crisisOnly: true, claimMin: 10 }),
  t('zwembad', 'CR_POOL_INFORM', 'Gasten informeren', 'Hang bij de ingang en de receptie uit wanneer het zwembad weer opengaat, en bied de bowling als alternatief.', 'easy', 'high', 0, { crisisOnly: true, location: fac('A', 'J'), claimMin: 15 }),
  t('zwembad', 'CR_POOL_REOPEN', 'Zwembad weer open', 'De storing is verholpen. Controleer de waterkwaliteit en zet het zwembad weer open.', 'hard', 'high', 0, { crisisOnly: true, td: true, claimMin: 20 }),
  t('animatie', 'CR_MASCOT_SEARCH', 'Zoektocht naar Bollo', 'Bollo is spoorloos en de kinderdisco begint zo. Doorzoek de tent en het speelparadijs.', 'medium', 'critical', 0, { crisisOnly: true, location: fac('T', 'Y'), claimMin: 15 }),
  t('animatie', 'CR_MASCOT_STANDIN', 'Invaller regelen', 'Regel een invaller met het reservekostuum zodat de kinderdisco toch door kan gaan.', 'medium', 'high', 0, { crisisOnly: true, location: fac('T'), claimMin: 15 }),
  t('animatie', 'CR_MASCOT_FOUND', 'Bollo terugbrengen', 'Bollo is gevonden op de midgetgolfbaan, met een ijsje. Begeleid hem terug naar de disco.', 'easy', 'high', 0, { crisisOnly: true, location: fac('U'), claimMin: 15 }),
  // ---------------------------------------------------------------- crisis subtasks (extended crises, one process over time)
  ...([
    ['terrein', 'CR_WATER_SIGNS', 'Gebied afzetten', 'Zet het natte gebied rond de gesprongen leiding af met linten en borden, zodat niemand door de modder loopt.', 'easy', 'high', { kind: 'grounds' }],
    ['receptie', 'CR_WATER_INFORM', 'Wijk informeren', 'Ga langs de bungalows in de getroffen wijk: hoe lang het water nog uit blijft en waar flessen water te halen zijn.', 'medium', 'high', fac('A')],
    ['onderhoud', 'CR_WATER_FLUSH', 'Leidingen doorspoelen', 'Het water is terug maar komt bruin uit de kraan. Spoel de leidingen in de wijk door tot het helder is.', 'medium', 'high', fac('I')],
    ['schoonmaak', 'CR_WATER_CLEANUP', 'Modder opruimen', 'Rond de reparatieplek ligt een modderspoor tot op de terrassen. Opruimen en paden schoonspuiten.', 'medium', 'normal', { kind: 'grounds' }],
    ['onderhoud', 'CR_BLACKOUT_GENERATOR', 'Noodaggregaat starten', 'Start het noodaggregaat voor de receptie en de koelcellen. Controleer eerst of de ruimte goed geventileerd is.', 'hard', 'critical', fac('I')],
    ['horeca', 'CR_BLACKOUT_FRIDGES', 'Koelcellen controleren', 'Meet de temperatuur van de koelcellen en zet wat te warm wordt apart. Noteer alles voor de voedselveiligheid.', 'medium', 'high', fac('G', 'H')],
    ['receptie', 'CR_BLACKOUT_ROUNDS', 'Ronde langs de bungalows', 'Loop een ronde langs bungalows met oudere gasten en gezinnen met baby\'s: is alles in orde, hebben ze een zaklamp?', 'medium', 'high', fac('A')],
    ['horeca', 'CR_CHECKIN_COFFEE', 'Koffie in de rij', 'De rij voor de receptie wordt langer. Deel koffie, thee en limonade uit aan wachtende gasten.', 'easy', 'high', fac('A')],
    ['terrein', 'CR_CHECKIN_TRAFFIC', 'Wachtende auto\'s begeleiden', 'Bij de slagboom staat een rij. Wijs wachtende auto\'s een veilige plek in de berm, zodat de doorgaande weg vrij blijft.', 'medium', 'high', fac('A')],
    ['receptie', 'CR_CHECKIN_KEYS', 'Sleutels handmatig uitgeven', 'Het systeem draait weer half. Geef de sleutels uit met de papieren lijst en vink ze af.', 'medium', 'high', fac('A')],
    ['receptie', 'CR_CHECKIN_SORRY', 'Excuses aanbieden', 'Alle gasten zijn binnen. Breng de gedupeerden een kaartje met excuses en een drankbon.', 'easy', 'normal', fac('A')],
    ['zwembad', 'CR_POOL_TEST', 'Watermonster nemen', 'Neem watermonsters en meet chloor en pH. Pas als de waarden goed zijn mag het bad weer open.', 'medium', 'high', fac('J')],
    ['animatie', 'CR_POOL_ALTERNATIVE', 'Alternatief programma', 'Het zwembad blijft dicht. Zet in het speelparadijs een alternatief programma op voor de kinderen.', 'medium', 'high', fac('T', 'Y')],
    ['receptie', 'CR_MASCOT_POSTER', 'Omroepen en posters', 'Laat via de receptie omroepen dat Bollo zoek is en hang posters op: "Wie heeft Bollo gezien?"', 'easy', 'high', fac('A')],
    ['animatie', 'CR_MASCOT_KIDS', 'Kinderen bezighouden', 'De kinderdisco is uitgesteld. Houd de kinderen bezig met een speurtocht naar Bollo\'s pootafdrukken.', 'medium', 'high', fac('T', 'Y')],
    ['receptie', 'CR_STORM_INFORM', 'Onweer: gasten waarschuwen', 'Er komt zwaar onweer aan. Waarschuw gasten op het terrein, op de sportvelden en bij het water om naar binnen te gaan.', 'easy', 'critical', fac('A')],
    ['horeca', 'CR_STORM_TERRACE', 'Terras stormvrij maken', 'Klap de parasols in en zet het terrasmeubilair binnen of vast voordat de wind aantrekt.', 'medium', 'high', fac('G', 'H')],
    ['zwembad', 'CR_STORM_POOL_OUT', 'Buitenbad ontruimen', 'Haal iedereen uit het buitenbad en van de ligweide; bij onweer is zwemmen buiten niet veilig.', 'medium', 'critical', fac('J')],
    ['terrein', 'CR_STORM_TREE', 'Omgewaaide boom', 'Bij {loc} ligt een boom over het pad. Zet het af en vraag de TD om hem met de juiste uitrusting weg te halen.', 'hard', 'high', { kind: 'grounds' }],
    ['onderhoud', 'CR_STORM_LEAK', 'Lekkage na de bui', 'In een bungalow bij {loc} lekt het door het dak. Zet emmers neer en dicht het lek tijdelijk af.', 'medium', 'high', { kind: 'grounds' }],
    ['onderhoud', 'CR_STORM_POWER', 'Stroomgroepen controleren', 'Na de blikseminslag zijn er groepen uitgevallen. Controleer de verdeelkasten in de wijk.', 'hard', 'high', fac('I')],
    ['terrein', 'CR_STORM_CLEANUP', 'Takken opruimen', 'De bui is over. Ruim de takken en bladeren op de wegen en paden op, zodat alles weer veilig begaanbaar is.', 'medium', 'normal', { kind: 'grounds' }],
    ['horeca', 'CR_FIRE_EVACUATE', 'Restaurant ontruimen', 'Het brandalarm in de keuken gaat af. Begeleid alle gasten rustig naar het verzamelpunt op het plein.', 'medium', 'critical', fac('G')],
    ['receptie', 'CR_FIRE_HEADCOUNT', 'Iedereen geteld?', 'Tel bij het verzamelpunt personeel en gasten met de aanwezigheidslijst. Niemand gaat terug naar binnen.', 'medium', 'critical', fac('A')],
    ['receptie', 'CR_FIRE_BRIGADE', 'Brandweer opvangen', 'De brandweer komt eraan. Vang ze op bij de ingang en wijs de snelste route naar het restaurant.', 'medium', 'critical', fac('A')],
    ['onderhoud', 'CR_FIRE_KITCHEN', 'Afzuiging nakijken', 'Het was rook van een pan, geen brand. Laat de afzuiging en de melder in de keuken controleren en resetten.', 'hard', 'high', fac('G')],
    ['schoonmaak', 'CR_FIRE_AIR', 'Luchten en schoonmaken', 'Zet ramen en deuren open en maak de keuken en de eetzaal roetvrij voordat er weer gasten in mogen.', 'medium', 'high', fac('G')],
    ['horeca', 'CR_FIRE_REOPEN', 'Weer open met een traktatie', 'Het restaurant mag weer open. Ontvang de gasten met een gratis toetje voor het wachten.', 'easy', 'normal', fac('G')],
    ['receptie', 'CR_PRESS_DESK', 'Perspunt inrichten', 'Er staan fotografen en verslaggevers bij de receptie. Richt een vast perspunt in, zodat de gasten rustig kunnen inchecken.', 'medium', 'high', fac('A')],
    ['terrein', 'CR_PRESS_PARKING', 'Persbusjes parkeren', 'De busjes van de pers blokkeren de toegangsweg. Wijs ze een plek aan op het parkeerterrein.', 'medium', 'high', fac('A')],
    ['terrein', 'CR_PRESS_PRIVACY', 'Bungalows afschermen', 'Een paar fotografen lopen het park in. Begeleid ze terug en zet privacyschermen bij de bungalows van de BN\'ers.', 'hard', 'high', { kind: 'grounds' }],
    ['receptie', 'CR_PRESS_STATEMENT', 'Korte verklaring', 'Lees bij het perspunt een korte, vriendelijke verklaring voor: het park geeft geen informatie over gasten.', 'medium', 'normal', fac('A')],
    ['horeca', 'CR_PRESS_COFFEE', 'Koffie voor de pers', 'Wachtende pers is rustiger met koffie. Zet bij het perspunt een koffietafel neer.', 'easy', 'normal', fac('A')],
    ['animatie', 'CR_PRESS_TOUR', 'Rondleiding voor de pers', 'Geef de pers een rondleiding langs het zwembad en het plein, zodat ze iets moois kunnen filmen zonder gasten te storen.', 'medium', 'normal', fac('T', 'C')],
    ['onderhoud', 'CR_WIFI_ROUTER', 'Netwerk herstarten', 'De hoofdrouter in de serviceruimte hangt. Herstart hem volgens de checklist en kijk welke lampjes branden.', 'hard', 'critical', fac('I')],
    ['receptie', 'CR_WIFI_HOTSPOT', 'Noodhotspot voor de livestream', 'Een livestream vanuit het park valt weg. Zet bij de receptie de mobiele noodhotspot aan voor de makers.', 'medium', 'critical', fac('A')],
    ['receptie', 'CR_WIFI_INFORM', 'Gasten informeren over wifi', 'Gasten bellen massaal over het wifi. Zet een bericht op de schermen en leg uit wanneer het weer werkt.', 'easy', 'high', fac('A')],
    ['onderhoud', 'CR_WIFI_CABLE', 'Kabelbreuk zoeken', 'Bij graafwerk bij {loc} is mogelijk een netwerkkabel geraakt. Zoek de breuk en zet hem tijdelijk door.', 'hard', 'high', { kind: 'grounds' }],
    ['onderhoud', 'CR_WIFI_TEST', 'Wifi testen in de wijken', 'Test met de laptop in elke wijk of het wifi weer snel genoeg is voor videobellen en streamen.', 'medium', 'normal', fac('I')],
    ['horeca', 'CR_WIFI_GOODWILL', 'Drankje als goedmakertje', 'Het wifi werkt weer. Trakteer gasten in de Brasserie op een drankje als goedmakertje.', 'easy', 'normal', fac('G')],
    ['terrein', 'CR_PARK_DIRECT', 'Verkeer op de parkeerplaats', 'De parkeerplaats staat vol en auto\'s draaien rondjes. Wijs de laatste vrije plekken aan.', 'medium', 'high', fac('A')],
    ['terrein', 'CR_PARK_OVERFLOW', 'Overloopterrein openen', 'Open het sportveld als tijdelijk parkeerterrein: hekken open, linten voor de rijbaan, iemand bij de ingang.', 'hard', 'high', fac('R')],
    ['fietsverhuur', 'CR_PARK_SHUTTLE', 'Pendel met bolderkarren', 'Bezoekers op het overloopterrein moeten ver lopen. Zet fietsen en bolderkarren klaar om bagage te brengen.', 'medium', 'normal', fac('W')],
    ['terrein', 'CR_PARK_SIGNS', 'Borden plaatsen', 'Zet borden langs de toegangsweg: "Parkeerplaats vol, volg P2".', 'easy', 'high', fac('A')],
    ['receptie', 'CR_PARK_INFORM', 'Aankomende gasten bellen', 'Bel gasten die vandaag nog komen: parkeren op het overloopterrein en de bagage gaat met de bolderkar.', 'easy', 'normal', fac('A')],
    ['terrein', 'CR_PARK_CLEAR', 'Sportveld weer vrijmaken', 'Het is rustiger. Begeleid de auto\'s van het sportveld terug en maak het veld weer speelklaar.', 'medium', 'normal', fac('R')],
  ] as [Exclude<Group, 'crisis'>, string, string, string, Difficulty, Urgency, LocationRule][]).map(([g, code, title, text, d, u, loc]) =>
    t(g, code, title, text, d, u, 0, { crisisOnly: true, location: loc, claimMin: d === 'hard' ? 20 : 15 })),
  // ---------------------------------------------------------------- storyline chapters (guestlib, only within a storyline)
  // {lead} = lead guest, {household}, {omroep}, {show}; house tasks happen at the household's own bungalow
  ...([
    ['terrein', 'STY_PAPARAZZI_BUSH', 'Fotograaf in de struiken', 'Bij {loc} ligt een roddelfotograaf plat in de rododendrons. Vraag hem vriendelijk maar beslist het park te verlaten.', 'medium', 'high', house()],
    ['terrein', 'STY_PAPARAZZI_SCREEN', 'Privacyscherm plaatsen', 'Zet bij {loc} een rieten privacyscherm neer zodat {lead} weer de tuin in durft.', 'easy', 'normal', house()],
    ['horeca', 'STY_PAPARAZZI_BREAKFAST', 'Ontbijt aan huis', 'Breng een ontbijt met verse croissants naar {lead} in {loc}. Discreet, zonder pet van het park.', 'easy', 'normal', house()],
    ['onderhoud', 'STY_RADIO_POWER', 'Stroom voor de studio', 'De zendapparatuur van {lead} ({omroep}) laat de groep uitvallen in {loc}. Leg een veilige extra groep aan.', 'medium', 'high', house()],
    ['receptie', 'STY_RADIO_NEIGHBOURS', 'Buren en de ochtendshow', 'De buren van {lead} klagen over jingles om zes uur \'s ochtends. Bemiddel en regel oordopjes.', 'easy', 'normal', fac('A')],
    ['receptie', 'STY_RADIO_FANS', 'Luisteraars bij de receptie', 'Luisteraars van {omroep} staan in de rij voor een handtekening van {lead}. Regel een nette meet-and-greet.', 'medium', 'high', fac('A')],
    ['receptie', 'STY_REALITY_PERMIT', 'Draaitoestemming', 'De crew van {show} wil filmen in het park. Controleer de afspraken en geef de crew een badge.', 'medium', 'normal', fac('A')],
    ['schoonmaak', 'STY_REALITY_CLEANUP', 'Opruimen na de opnames', 'Na de opnames van {show} ligt {loc} vol confetti, nepbloemen en een kapotte tuinstoel. Opruimen.', 'medium', 'normal', house()],
    ['animatie', 'STY_REALITY_FINALE', 'Kampvuur voor de slotscène', 'De regie van {show} wil een kampvuurfeest. Regel de vuurkorf, een emmer zand en een animator.', 'hard', 'normal', fac('T', 'C', 'Q')],
    ['horeca', 'STY_QUIZ_TEA', 'Honingthee voor de quizmaster', '{lead} is de stem kwijt. Breng een pot honingthee met citroen naar {loc}.', 'easy', 'high', house()],
    ['animatie', 'STY_QUIZ_REHEARSAL', 'Oefenquiz met publiek', '{lead} wil oefenen voor {show}. Verzamel gasten voor een oefenquiz in het theater.', 'medium', 'normal', fac('T', 'C')],
    ['receptie', 'STY_QUIZ_PRINT', 'Vragenkaartjes printen', 'De printer bij de receptie weigert de vragenkaartjes van {lead}. Papier, toner, en een beetje geduld.', 'easy', 'normal', fac('A')],
    ['receptie', 'STY_WEATHER_COMPLAINTS', 'Klachten over het weer', 'Natte gasten klagen bij de receptie over het weerbericht van {lead}. Deel paraplu\'s uit en blijf vriendelijk.', 'easy', 'normal', fac('A')],
    ['terrein', 'STY_WEATHER_PUDDLE', 'Plas op het pad', 'Bij {loc} staat een plas zo groot als een vijver. Zet borden neer en maak de goot vrij.', 'medium', 'normal', house()],
    ['animatie', 'STY_WEATHER_INDOOR', 'Binnenactiviteit', '{lead} sponsort een binnenactiviteit voor natte kinderen. Regel knutselspullen en een animator.', 'medium', 'normal', fac('T', 'C', 'Y', 'O')],
    ['onderhoud', 'STY_SCOOP_WIFI', 'Wifi voor de live-verbinding', '{lead} van {omroep} moet live in de uitzending vanuit {loc}, maar het wifi haalt 2 kbit/s. Plaats een extra access point.', 'medium', 'high', house()],
    ['natuur', 'STY_SCOOP_HERON', 'De reiger filmen', '{lead} wil de visstelende reiger filmen. Wijs een rustige plek aan bij {loc} op ruime afstand van de vogel.', 'easy', 'normal', house()],
    ['horeca', 'STY_SCOOP_VIEWING', 'Kijkavond', '{lead} wil het item over de reiger laten zien. Zet in de horeca een scherm en bitterballen klaar.', 'easy', 'normal', fac('G', 'H')],
    ['receptie', 'STY_FEUD_MEDIATE', 'Ruzie over de heg', 'Bij {loc} debatteren {lead} en een tafelgenoot uit {show} luidkeels over de heg. Bemiddel.', 'medium', 'high', house()],
    ['horeca', 'STY_FEUD_DINNER', 'Verzoeningsdiner', 'Regel een tafel voor twee met kaarslicht voor {lead} en de voormalige aartsrivaal uit {show}.', 'medium', 'normal', fac('G', 'H')],
    ['zwembad', 'STY_INFLU_POOL', 'Zwembadshoot', '{lead} wil om acht uur filmen in het zwembad. Regel een kwartier voor de opening, met badmeester.', 'medium', 'normal', fac('J')],
    ['fietsverhuur', 'STY_INFLU_BAKFIETS', 'Bakfiets met ringlamp', '{lead} wil een bakfiets met ringlamp. Monteer de lamp veilig en leg de drone-regels van het park uit.', 'easy', 'normal', fac('W')],
    ['schoonmaak', 'STY_INFLU_GLITTER', 'Glitter overal', 'Na de unboxing-video ligt {loc} vol glitter en verpakkingsmateriaal. Stofzuigen, en nog een keer stofzuigen.', 'medium', 'normal', house()],
    ['receptie', 'STY_SOAP_SEARCH', 'Script zoeken', 'Het geheime script van {show} is kwijt. Doorzoek de gevonden voorwerpen bij de receptie zonder erin te lezen.', 'easy', 'high', fac('A')],
    ['schoonmaak', 'STY_SOAP_DRY', 'Script drogen', 'Een paar bladzijden van het script zijn nat geworden in {loc}. Droog ze voorzichtig met een föhn.', 'easy', 'normal', house()],
    ['horeca', 'STY_SOAP_DECOY', 'Afleidingsmanoeuvre', 'Gasten fluisteren het einde van {show} na. Start een "verrassingsproeverij" om iedereen af te leiden.', 'medium', 'normal', fac('G', 'H')],
    ['terrein', 'STY_JINGLE_SILENCE', 'Stilte voor de opname', '{lead} neemt vogelgeluid op bij {loc}. Zet de bladblazer een uurtje stil en hang een bordje "opname".', 'easy', 'normal', house()],
    ['animatie', 'STY_JINGLE_CHOIR', 'Koor voor de jingle', '{lead} zoekt twintig gasten voor een koor. Zingen kunnen is niet nodig. Verzamelen in het theater.', 'medium', 'normal', fac('T', 'C')],
    ['fietsverhuur', 'STY_TEAMDAY_BIKES', 'Tandems voor de redactie', 'De redactie van {omroep} wil twaalf tandems. Controleer banden en remmen en deel helmen uit.', 'hard', 'normal', fac('W')],
    ['horeca', 'STY_TEAMDAY_LUNCH', 'Lunch voor de redactie', 'Lunch voor 24 redacteuren van {omroep}: glutenvrij, vegan en "met een twist".', 'hard', 'normal', fac('G', 'H')],
    ['animatie', 'STY_TEAMDAY_GAME', 'Teambuildingspel', 'Organiseer voor de redactie van {omroep} een teambuildingspel zonder valpartijen.', 'medium', 'normal', fac('T', 'C', 'Q', 'U')],
    ['receptie', 'STY_INTERN_LOSTFOUND', 'Camera zoeken', 'De stagiair van {show} is een camera van 40.000 euro kwijt. Kijk bij de gevonden voorwerpen.', 'easy', 'high', fac('A')],
    ['fietsverhuur', 'STY_INTERN_BIKE', 'Camera in het fietsmandje', 'Bij de fietsverhuur ligt mogelijk de camera van {show} in een mandje. Controleer de teruggebrachte fietsen.', 'easy', 'high', fac('W')],
    ['receptie', 'STY_REC_PERMIT', 'Afspraken over opnames', 'Spreek met {lead} af waar in het park gefilmd mag worden, zodat andere gasten er geen last van hebben.', 'easy', 'normal', fac('A')],
    ['onderhoud', 'STY_REC_LIGHT', 'Licht en stroom in De Tent', 'Leg in De Tent extra stroom en licht aan voor de opnames van {lead}. Veilig weggewerkte kabels!', 'medium', 'normal', fac('Y', 'T')],
    ['animatie', 'STY_REC_AUDIENCE', 'Publiek voor de opname', 'Zoek dertig gasten die als publiek bij de opname van {lead} willen zitten.', 'medium', 'normal', fac('Y', 'T')],
    ['horeca', 'STY_BDAY_CAKE', 'Verjaardagstaart', 'Regel een taart met kaarsjes voor de jarige die {lead} live op de radio wil verrassen.', 'easy', 'high', fac('G', 'H')],
    ['animatie', 'STY_BDAY_DECOR', 'Bungalow versieren', 'Versier {loc} met slingers en ballonnen, zonder dat de jarige het merkt.', 'medium', 'normal', house()],
    ['receptie', 'STY_BDAY_SECRET', 'Jarige weglokken', 'Bel de jarige met een smoesje naar de receptie, terwijl {lead} live gaat.', 'easy', 'high', fac('A')],
    ['terrein', 'STY_WLIVE_SPOT', 'Plek voor het weerbericht', 'Zoek bij {loc} een plek met uitzicht over het water voor het weerbericht van {lead}.', 'easy', 'normal', house()],
    ['onderhoud', 'STY_WLIVE_POWER', 'Buitenstroom voor de camera', 'Leg bij {loc} een veilige buitenaansluiting aan voor de camera van {lead}.', 'medium', 'high', house()],
    ['receptie', 'STY_WLIVE_UMBRELLA', 'Paraplu\'s voor de uitzending', 'Het gaat regenen tijdens de uitzending van {lead}. Breng paraplu\'s voor de crew.', 'easy', 'high', fac('A')],
    ['schoonmaak', 'STY_DESK_TABLE', 'Woonkamer als studio', 'Maak de woonkamer van {loc} netjes en rustig, zodat {lead} kan uitzenden.', 'medium', 'high', house()],
    ['receptie', 'STY_DESK_QUIET', 'Stilte bij de buren', 'Vraag de buren van {loc} om een halfuurtje stilte tijdens de uitzending van {lead}.', 'easy', 'normal', house()],
    ['horeca', 'STY_DESK_COFFEE', 'Sterke koffie', 'Breng sterke koffie en iets lekkers naar {lead} in {loc}.', 'easy', 'normal', house()],
    ['fietsverhuur', 'STY_VLOG_ROUTE', 'Fietsen voor de challenge', 'Zet voor {lead} en de crew de snelste fietsen klaar, met een kaart van alle voorzieningen.', 'easy', 'normal', fac('W')],
    ['receptie', 'STY_VLOG_FANS', 'Fans bij de receptie', 'Fans van {lead} komen massaal naar de receptie. Vriendelijk ontvangen en de gasten laten doorlopen.', 'medium', 'high', fac('A')],
    ['horeca', 'STY_VLOG_SNACK', 'Frietje na de challenge', 'Iedereen die met {lead} meedeed krijgt een frietje bij de snackbar.', 'easy', 'normal', fac('H')],
    ['terrein', 'STY_CLIP_LOCATION', 'Clipplek in het bos', 'Zoek bij {loc} een mooie plek voor de clip van {lead} en zet de weg even af.', 'medium', 'normal', house()],
    ['animatie', 'STY_CLIP_EXTRAS', 'Figuranten voor de clip', 'Zoek gasten die willen meedansen in de clip van {lead}.', 'medium', 'normal', fac('T', 'Y')],
    ['horeca', 'STY_CLIP_CATERING', 'Eten voor de clipcrew', 'Breng broodjes en drinken naar de crew van {lead}.', 'easy', 'normal', fac('G', 'H')],
    ['animatie', 'STY_SING_FIRE', 'Vuurkorf voor het meezingen', 'Zet de vuurkorf op een veilige plek bij het outdoorterrein, met een emmer zand en een blusdeken.', 'medium', 'normal', fac('Z')],
    ['receptie', 'STY_SING_BLANKETS', 'Dekens voor het kampvuur', 'Breng een stapel dekens naar het kampvuur van {lead}.', 'easy', 'normal', fac('A')],
    ['horeca', 'STY_SING_MARSHMALLOW', 'Marshmallows', 'Breng marshmallows en stokjes naar het kampvuur van {lead}.', 'easy', 'normal', fac('H', 'G')],
    ['animatie', 'STY_KIDS_STAGE', 'Podium voor de kindervoorstelling', 'Zet het podium in het speelparadijs klaar voor de voorstelling van {lead}.', 'medium', 'normal', fac('T')],
    ['animatie', 'STY_KIDS_FACEPAINT', 'Schminken', 'Schmink de kinderen voor de voorstelling van {lead}: tijgers, prinsessen en een enkele piraat.', 'easy', 'normal', fac('Y', 'T')],
    ['horeca', 'STY_KIDS_LEMONADE', 'Limonade voor de kinderen', 'Limonade en koekjes voor alle kinderen na de voorstelling van {lead}.', 'easy', 'normal', fac('G', 'H')],
    ['receptie', 'STY_WALK_MAP', 'Wandelkaart', 'Geef {lead} een wandelkaart en wijs de rustigste paden aan.', 'easy', 'normal', fac('A')],
    ['terrein', 'STY_WALK_PATH', 'Pad vrijmaken', 'Op het pad bij {loc} ligt een boomstam. Opruimen zodat {lead} verder kan wandelen.', 'medium', 'normal', house()],
    ['horeca', 'STY_QUIZ_TABLES', 'Teamtafels voor de quiz', 'Richt De Brasserie in met teamtafels voor de pubquiz van {lead}.', 'medium', 'normal', fac('G')],
    ['animatie', 'STY_QUIZ_SOUND', 'Microfoon en scherm', 'Sluit een microfoon en een scherm aan voor de quiz van {lead}.', 'medium', 'normal', fac('G')],
    ['receptie', 'STY_QUIZ_PRIZES', 'Prijzen voor de quiz', 'Haal prijzen bij de ParkShop voor de winnaars van de quiz van {lead}.', 'easy', 'normal', fac('V')],
    ['animatie', 'STY_SCOUT_TOUR', 'Rondleiding voor de producent', 'Geef {lead} een rondleiding langs de tent, het zwembad en de sportvelden.', 'medium', 'normal', fac('T', 'Y')],
    ['horeca', 'STY_SCOUT_PITCH', 'Vergaderplek met koffie', 'Regel een rustige tafel met koffie voor {lead} om het nieuwe idee te bespreken.', 'easy', 'normal', fac('G')],
    ['terrein', 'STY_FAN_BUS', 'Fanbus parkeren', 'Een bus met fans van {lead} staat bij de ingang. Wijs een plek op de parkeerplaats.', 'medium', 'high', fac('A')],
    ['receptie', 'STY_FAN_PHOTOS', 'Fotomoment', 'Regel bij de receptie een fotomoment voor de fans van {lead}, netjes in een rij.', 'medium', 'high', fac('A')],
    ['horeca', 'STY_FAN_DRINKS', 'Drinken voor de fans', 'Geef de fans van {lead} iets te drinken voor de terugreis.', 'easy', 'normal', fac('G', 'H')],
    ['terrein', 'STY_PRIZE_HIDE', 'Gouden microfoon verstoppen', 'Verstop de gouden microfoon van {lead} ergens bij {loc}, zonder dat iemand het ziet.', 'easy', 'normal', house()],
    ['receptie', 'STY_PRIZE_HINTS', 'Hints geven', 'Gasten komen om hints voor de prijsvraag van {lead}. Geef ze één voor één, met een knipoog.', 'easy', 'normal', fac('A')],
    ['animatie', 'STY_PRIZE_WINNER', 'Prijsuitreiking', 'Organiseer de prijsuitreiking voor de vinder van de gouden microfoon, met muziek.', 'medium', 'normal', fac('T', 'G')],
    ['horeca', 'STY_COOK_KITCHEN', 'Keuken voor twee koks', 'Richt de keuken in voor de kookwedstrijd tussen {lead} en de chef.', 'medium', 'normal', fac('G')],
    ['animatie', 'STY_COOK_JURY', 'Jury van gasten', 'Zoek vijf gasten voor de jury van de kookwedstrijd van {lead}.', 'easy', 'normal', fac('G')],
    ['receptie', 'STY_PROP_FLOWERS', 'Bloemen voor het aanzoek', 'Regel discreet een bos bloemen via de ParkShop voor {lead}.', 'easy', 'normal', fac('V')],
    ['terrein', 'STY_PROP_SPOT', 'Plekje bij de vijver', 'Versier stiekem een plekje bij het water met lichtjes voor het aanzoek van {lead}.', 'medium', 'normal', fac('G')],
    ['horeca', 'STY_PROP_BUBBLES', 'Champagne!', 'Breng champagne naar het verloofde stel bij de vijver.', 'easy', 'high', fac('G')],
    ['horeca', 'STY_OMA_CAKE', 'Taart voor oma', 'Regel een grote taart voor de tachtigste verjaardag van {lead}.', 'easy', 'normal', fac('G', 'H')],
    ['animatie', 'STY_OMA_DECOR', 'Ballonnen en slingers', 'Versier {loc} voor de tachtigste verjaardag van {lead}.', 'easy', 'normal', house()],
    ['animatie', 'STY_OMA_SONG', 'Lied voor de jarige', 'Zing met het animatieteam een lied voor {lead} bij {loc}.', 'easy', 'normal', house()],
    ['receptie', 'STY_TEDDY_SEARCH', 'Knuffel zoeken', 'Kijk bij de gevonden voorwerpen of de knuffel van {lead} is ingeleverd.', 'easy', 'high', fac('A')],
    ['animatie', 'STY_TEDDY_PLAYGROUND', 'Speeltuin doorzoeken', 'Zoek in de speeltuin naar de knuffel van {lead}.', 'easy', 'high', fac('S')],
    ['receptie', 'STY_SUPERFAN_ASK', 'Vraag van een superfan', '{lead} vraagt of een ontmoeting met een BN\'er mogelijk is. Vraag het netjes na.', 'easy', 'normal', fac('A')],
    ['horeca', 'STY_SUPERFAN_MEET', 'Ontmoeting in de Brasserie', 'Regel een gezellige tafel voor de ontmoeting tussen {household} en een BN\'er.', 'easy', 'normal', fac('G')],
    // cameo storylines of real public figures (guestlib CELEBRITIES): friendly and harmless only
    ['animatie', 'STY_GIG_STAGE', 'Podium op het terras', 'Bouw met het team een klein podium op het terras voor het optreden van {lead}. Stevig en veilig.', 'medium', 'normal', fac('G', 'H')],
    ['animatie', 'STY_GIG_SOUND', 'Geluid voor het optreden', 'Sluit de geluidsinstallatie aan voor {lead} en doe een soundcheck. Geen piep, geen kraak.', 'medium', 'high', fac('G', 'H')],
    ['horeca', 'STY_GIG_CROWD', 'Publiek bij het optreden', 'Half het park komt naar het optreden van {lead}. Zorg voor een nette rij en drinken voor iedereen.', 'hard', 'high', fac('G', 'H')],
    ['animatie', 'STY_TRYOUT_SETUP', 'Zaal klaarzetten', 'Zet in De Tent stoelen en een spotje klaar voor de try-out van {lead}.', 'medium', 'normal', fac('Y', 'T', 'C')],
    ['receptie', 'STY_TRYOUT_TICKETS', 'Kaartjes uitdelen', 'Deel bij de receptie gratis kaartjes uit voor de try-out van {lead}. Op is op.', 'easy', 'normal', fac('A')],
    ['horeca', 'STY_TRYOUT_AFTER', 'Napraten met een hapje', 'Na de try-out van {lead}: bitterballen en drankjes klaar voor het napraten met het publiek.', 'easy', 'normal', fac('G', 'H')],
    ['receptie', 'STY_CELEB_AUTOGRAPH', 'Handtekeningenrij', 'Bij de receptie staan gasten in de rij voor een handtekening van {lead}. Zorg voor een nette rij en een pen die het doet.', 'easy', 'normal', fac('A')],
    ['animatie', 'STY_CELEB_TALENT', 'Karaoke-avond', 'Iedereen wil ineens zingen nu {lead} in het park is. Regel de karaoke-avond in het theater.', 'medium', 'normal', fac('T', 'C')],
    ['horeca', 'STY_CELEB_QUIET_TABLE', 'Rustig tafeltje', 'Regel voor {lead} een rustig tafeltje achter in het restaurant, uit het zicht van nieuwsgierige gasten.', 'easy', 'normal', fac('G', 'H')],
  ] as [Exclude<Group, 'crisis'>, string, string, string, Difficulty, Urgency, LocationRule][]).map(([g, code, title, text, d, u, loc]) =>
    t(g, code, title, text, d, u, 0, { storyOnly: true, location: loc, when: {}, offeredMaxMin: 40, cooldownMin: 30, onTimeout: { mood: -0.05 } })),
];

export const CRISES: CrisisTemplate[] = [
  // Each crisis is a process: a first report, then follow-up reports over time (afterMin from the start), 5-7 tasks in total.
  { code: 'CRISIS_WATER_MAIN', title: 'Waterleiding gesprongen', icon: 'drop', fx: 'splash', location: { kind: 'grounds' }, weight: 1,
    texts: ['Bij {loc} spuit een fontein uit de grond die er gisteren nog niet was. Een hoofdwaterleiding is gesprongen.'],
    stages: [
      { afterMin: 0, text: 'Hoofdkraan dicht en gebied afzetten', tasks: ['CR_WATER_MAIN_VALVE', 'CR_WATER_SIGNS'] },
      { afterMin: 10, text: 'Gasten zonder water: flessen uitdelen', tasks: ['CR_WATER_BOTTLES'] },
      { afterMin: 20, text: 'De wijk informeren', tasks: ['CR_WATER_INFORM'] },
      { afterMin: 35, text: 'De loodgieter is er: repareren', tasks: ['CR_WATER_MAIN_REPAIR'] },
      { afterMin: 60, text: 'Water terug, maar bruin: doorspoelen', tasks: ['CR_WATER_FLUSH'] },
      { afterMin: 75, text: 'Opruimen', tasks: ['CR_WATER_CLEANUP'] },
    ] },
  { code: 'CRISIS_BLACKOUT', title: 'Grote stroomstoring', icon: 'bolt', fx: 'spark', location: fac('I'), weight: 1,
    texts: ['Een groot deel van het park zit zonder stroom. De koelkasten beginnen al te zuchten.'],
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
      { afterMin: 45, text: 'Sleutels met de hand uitgeven', tasks: ['CR_CHECKIN_KEYS'] },
      { afterMin: 60, text: 'Excuses aan de gedupeerden', tasks: ['CR_CHECKIN_SORRY'] },
    ] },
  { code: 'CRISIS_POOL_CLOSED', title: 'Zwembad gesloten', icon: 'swim', fx: 'splash', location: fac('J'), weight: 1,
    texts: ['Een storing in de waterzuivering: het zwembad moet direct dicht.'],
    stages: [
      { afterMin: 0, text: 'Zwembad ontruimen', tasks: ['CR_POOL_EVACUATE'] },
      { afterMin: 10, text: 'Gasten informeren', tasks: ['CR_POOL_INFORM'] },
      { afterMin: 20, text: 'Watermonsters nemen', tasks: ['CR_POOL_TEST'] },
      { afterMin: 35, text: 'Alternatief voor de kinderen', tasks: ['CR_POOL_ALTERNATIVE'] },
      { afterMin: 55, text: 'Zwembad weer openen', tasks: ['CR_POOL_REOPEN'] },
    ] },
  { code: 'CRISIS_MASCOT', title: 'Bollo vermist', icon: 'star', fx: 'confetti', location: fac('T'), weight: 1,
    texts: ['Mascotte Bollo is vlak voor de kinderdisco spoorloos verdwenen. Paniek bij de jongste gasten.'],
    stages: [
      { afterMin: 0, text: 'Zoeken in de tent en het speelparadijs', tasks: ['CR_MASCOT_SEARCH'] },
      { afterMin: 8, text: 'Omroepen en posters', tasks: ['CR_MASCOT_POSTER'] },
      { afterMin: 15, text: 'Invaller regelen', tasks: ['CR_MASCOT_STANDIN'] },
      { afterMin: 25, text: 'De kinderen bezighouden', tasks: ['CR_MASCOT_KIDS'] },
      { afterMin: 40, text: 'Bollo is gevonden: terugbrengen', tasks: ['CR_MASCOT_FOUND'] },
    ] },
  { code: 'CRISIS_STORM', title: 'Zware onweersbui', icon: 'bolt', fx: 'splash', location: { kind: 'grounds' }, weight: 1,
    texts: ['Het KNMI waarschuwt voor zwaar onweer met windstoten. Over een kwartier is de bui boven het park.'],
    stages: [
      { afterMin: 0, text: 'Gasten waarschuwen', tasks: ['CR_STORM_INFORM'] },
      { afterMin: 5, text: 'Terras stormvrij maken', tasks: ['CR_STORM_TERRACE'] },
      { afterMin: 10, text: 'Buitenbad ontruimen', tasks: ['CR_STORM_POOL_OUT'] },
      { afterMin: 25, text: 'Er is een boom omgewaaid', tasks: ['CR_STORM_TREE'] },
      { afterMin: 35, text: 'Een bungalow lekt', tasks: ['CR_STORM_LEAK'] },
      { afterMin: 50, text: 'Stroomgroepen uitgevallen', tasks: ['CR_STORM_POWER'] },
      { afterMin: 75, text: 'Opruimen na de bui', tasks: ['CR_STORM_CLEANUP'] },
    ] },
  { code: 'CRISIS_FIRE_ALARM', title: 'Brandalarm in het restaurant', icon: 'alert', fx: 'spark', location: fac('G'), weight: 0.8,
    texts: ['Het brandalarm in De Brasserie gaat af en er komt rook uit de keuken.'],
    stages: [
      { afterMin: 0, text: 'Restaurant rustig ontruimen', tasks: ['CR_FIRE_EVACUATE'] },
      { afterMin: 5, text: 'Iedereen tellen bij het verzamelpunt', tasks: ['CR_FIRE_HEADCOUNT'] },
      { afterMin: 10, text: 'De brandweer opvangen', tasks: ['CR_FIRE_BRIGADE'] },
      { afterMin: 25, text: 'Loos alarm: afzuiging nakijken', tasks: ['CR_FIRE_KITCHEN'] },
      { afterMin: 40, text: 'Luchten en schoonmaken', tasks: ['CR_FIRE_AIR'] },
      { afterMin: 55, text: 'Weer open', tasks: ['CR_FIRE_REOPEN'] },
    ] },
  { code: 'CRISIS_PRESS', title: 'Persdrukte bij de receptie', icon: 'alert', fx: 'ring', location: fac('A'), weight: 1.1,
    texts: ['Het nieuws is uitgelekt dat er veel BN\'ers in het park zijn. Fotografen en verslaggevers staan voor de receptie.'],
    stages: [
      { afterMin: 0, text: 'Een perspunt inrichten', tasks: ['CR_PRESS_DESK'] },
      { afterMin: 10, text: 'Persbusjes blokkeren de weg', tasks: ['CR_PRESS_PARKING'] },
      { afterMin: 20, text: 'Fotografen lopen het park in', tasks: ['CR_PRESS_PRIVACY'] },
      { afterMin: 30, text: 'Koffie voor de wachtende pers', tasks: ['CR_PRESS_COFFEE'] },
      { afterMin: 40, text: 'Een korte verklaring', tasks: ['CR_PRESS_STATEMENT'] },
      { afterMin: 55, text: 'Rondleiding als afleiding', tasks: ['CR_PRESS_TOUR'] },
    ] },
  { code: 'CRISIS_WIFI', title: 'Wifi-storing tijdens de livestream', icon: 'bolt', fx: 'spark', location: fac('I'), weight: 1,
    texts: ['Het hele park zit zonder wifi, net nu er live wordt uitgezonden vanuit een bungalow.'],
    stages: [
      { afterMin: 0, text: 'Netwerk herstarten', tasks: ['CR_WIFI_ROUTER'] },
      { afterMin: 5, text: 'Noodhotspot voor de livestream', tasks: ['CR_WIFI_HOTSPOT'] },
      { afterMin: 15, text: 'Gasten informeren', tasks: ['CR_WIFI_INFORM'] },
      { afterMin: 25, text: 'Kabelbreuk zoeken', tasks: ['CR_WIFI_CABLE'] },
      { afterMin: 45, text: 'Testen in de wijken', tasks: ['CR_WIFI_TEST'] },
      { afterMin: 60, text: 'Goedmakertje', tasks: ['CR_WIFI_GOODWILL'] },
    ] },
  { code: 'CRISIS_PARKING', title: 'Parkeerplaats vol', icon: 'car', fx: 'ring', location: fac('A'), weight: 1,
    texts: ['De parkeerplaats bij het plein zit vol en er komen nog steeds auto\'s aan.'],
    stages: [
      { afterMin: 0, text: 'Laatste plekken aanwijzen', tasks: ['CR_PARK_DIRECT'] },
      { afterMin: 8, text: 'Borden langs de toegangsweg', tasks: ['CR_PARK_SIGNS'] },
      { afterMin: 15, text: 'Overloopterrein openen', tasks: ['CR_PARK_OVERFLOW'] },
      { afterMin: 25, text: 'Bagage met de bolderkar', tasks: ['CR_PARK_SHUTTLE'] },
      { afterMin: 35, text: 'Aankomende gasten bellen', tasks: ['CR_PARK_INFORM'] },
      { afterMin: 70, text: 'Sportveld weer vrijmaken', tasks: ['CR_PARK_CLEAR'] },
    ] },
];

export const templateByCode = new Map(TEMPLATES.map((x) => [x.code, x]));
export const crisisByCode = new Map(CRISES.map((x) => [x.code, x]));
export const GROUP_NAMES: Record<Group, string> = {
  onderhoud: 'Onderhoud', schoonmaak: 'Schoonmaak', receptie: 'Receptie', horeca: 'Horeca', zwembad: 'Zwembad', fietsverhuur: 'Fietsverhuur',
  terrein: 'Terrein', natuur: 'Natuur', animatie: 'Animatie', chaos: 'Chaos', crisis: 'Crisis',
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
