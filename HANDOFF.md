# Overdracht Harderwold Tycoon (spin-off van Aelderholt Tycoon)

**Datum:** 15 oktober 2026 · **Taal met de opdrachtgever:** Nederlands · **Repository:** `https://github.com/Mathijzi/Harderwold-Tycoon`

Harderwold Tycoon is een **volledig losstaande** spin-off van Aelderholt Tycoon, de 4K-vakantieparksimulator in `~/Landal-Tycoon` (repo `Mathijzi/Landal-Tycoon`). Het spel blijft hetzelfde: spelers handelen via een app opdrachten af in een vakantiepark dat live op een beamer te zien is. Het park wordt **Harderwold Villa Resort** (`https://www.harderwoldvillaresort.nl/`): moderne witte villa's aan grachten, een golfbaan en een centraal hart met receptie en brasserie.

Dit is een fan-/spelprototype. Claim nergens een officiële band met Harderwold Villa Resort of Landal. De foto's in `references/fotos` dienen alleen als stijlreferentie en worden niet in het spel getoond.

---

## 1. Losstaand: wat dat betekent

De opdrachtgever wil uitdrukkelijk dat Landal Tycoon hier **geen invloed** op heeft, en omgekeerd.

- **Code:** een eenmalige **kopie** (momentopname van commit `98a274d`, zie §5). Geen fork, geen submodule, geen gedeelde map, geen symlinks en geen gedeelde npm-package. Verbeteringen die in beide spellen nodig zijn, worden in elk project apart gedaan.
- **Git:** een eigen geschiedenis in `Mathijzi/Harderwold-Tycoon`. Push nooit naar `Landal-Tycoon` en wijzig niets in `~/Landal-Tycoon`.
- **Draaien naast elkaar:**
  - een eigen poort, **8090** (Landal gebruikt 8080);
  - een eigen database, `runtime/harderwold.sqlite`;
  - eigen back-ups;
  - een eigen Docker-image en -volume (`harderwold-tycoon`, `harderwold-data`).
- **Browser:** door de andere poort heeft het spel een eigen origin, dus eigen `localStorage` (thema, admin-sleutel) en eigen verbindingen. Hernoem de sleutels (`at.*` → `hw.*`) wel, zodat het duidelijk blijft.
- **Namen:** alles met `aelderholt`/`Aelderholt`/`Landal` wordt `harderwold`/`Harderwold` (§5.3). Opgeslagen spellen krijgen een eigen formaat-id (`harderwold-save`), zodat een Aelderholt-bestand hier niet geladen kan worden.

## 2. Het nieuwe park (uit `references/harderwold_plattegrond.pdf`)

**Belangrijk verschil met Aelderholt:** de PDF is één A3-pagina met **alleen een rasterafbeelding** (4961 × 3508 px). Er zijn geen vectorlijnen en geen tekst. De pijplijn van Aelderholt (`tools/*.py`, die wegen en huizen uit PDF-vectorpaden haalt) werkt hier dus **niet**. Zie §4 voor de aanpak. Een voorbeeld staat in `references/harderwold_plattegrond_preview.png`.

**Oriëntatie:** de windroos is gedraaid. Het noorden wijst ongeveer naar rechtsboven (ongeveer 45°), west naar linksboven, oost naar rechtsonder. Houd de projectie zoals de plattegrond (zelfde beeld als op de kaart van het park), net als bij Aelderholt.

**Indeling**
- **Oosten: villawijk met grachten.** Rechte straten (lichtgrijs) met daartussen grachten (blauw), plus één diagonale hoofdgracht van noordoost naar zuidwest. De villa's liggen in rijen met de voorkant aan de straat en de achterkant aan het water.
  - **Nummers** (ongeveer 300 kavels): 200–259, 300–349, 350–378, 380–416, 420–478, 500–596, 600–655 (noordelijk cluster, deels paren met een schuine streep: geschakeld of in aanbouw?) en 700–713 (rij langs de gracht).
  - **Varianten** met "ᴬ": 217ᴬ, 312ᴬ, 358ᴬ, 364ᴬ, 577ᴬ.
- **Midden: het hart.**
  - 1 Brasserie Harderwold, Receptie (i) en Terras;
  - toiletten en douches;
  - een groot parkeerterrein (P) met elektrisch laden;
  - stort chemisch toilet;
  - Brievenbus 5.
  - **De slagboom** (rood gestippeld in de legenda) staat op de oost-westweg ten oosten van het hart, bij de overgang naar de villawijk. Er zijn twee gestippelde lijnen te zien, vermoedelijk in en uit.
- **In de villawijk:**
  - 2 Appartementen (X-vormig gebouw) met parkeerplaats, tennisbaan, speeltuin en jeu-de-boulesbaan;
  - AED-punten;
  - afvalpunten (PD/papier/glas/restafval en restafval).
- **Westen: golf en recreatie.**
  - 9-holes golfbaan met bunkers en vijvers;
  - Interactieve driving range (het groene veld met gekleurde doelen);
  - Adventure golf 18 holes en Bosgolf 18 holes;
  - een meer in het noordwesten met Woonboten, Lasergame, Boogschieten en een Outdoor baan;
  - 23 Camperplaatsen.
- **Zuidwesten:** 3 Milieustraat en 4 De werf (de werkplaats: vergelijkbaar met de TD-post van Aelderholt).
- **Zuidoosten:** 5 De loods en de Trailerstalling.
- **Rondom:** bos en een waterloop. De toegangsweg loopt langs de westkant van de villawijk (noord-zuid, met een sloot ernaast).

**Schaal:** onbekend. Bepaal die met een bekende maat, bijvoorbeeld een tennisbaan (23,77 × 10,97 m) of een parkeervak (2,5 × 5 m), en leg hem vast als aanname.

## 3. Stijl van de villa's (uit `references/fotos`)

| Foto | Wat je ziet |
|---|---|
| `villa_tuin_terras.webp` | Witte villa met twee lagen, plat dak met brede witte overstek, zwarte kozijnen, grote glazen schuifpuien, balkon met zwarte balustrade, terras van grote grijze tegels, gazon, haag, jonge boompjes, barbecue en loungestoelen |
| `villa_zwembad.webp` | Zelfde type, met een **privézwembad** in het terras, siergrassen, houten trap of vlonder, buitenlampen en een donker tuinscherm |
| `watervilla_steiger_luchtfoto.webp` | **Watervilla** met een grote houten steiger en vlonder aan de gracht (kano of SUP aan de steiger), zonnepanelen op platte daken, hagen en plantenbakken. Op de achtergrond rijen witte villa's langs het water |

De villa's lijken in niets op de bungalows met zadeldak van Aelderholt. De huizenrenderer (`src/web/projector/houses.ts`) moet daarom opnieuw:
- witte blokken met een plat dak, overstek en dakrand;
- zwarte glaspuien en een balkon;
- een terras met tegels;
- eventueel een zwembad;
- een houten steiger aan de waterkant;
- zonnepanelen op het dak.

Maak een paar varianten: één of twee lagen, met of zonder zwembad, met of zonder steiger, en verschillende breedtes.

## 4. Aanpak van de kaart (raster in plaats van vector)

Aanbevolen: **half automatisch, daarna corrigeren in de kaarteditor** (die bestaat al: `/editor`).

1. **Kleursegmentatie** met Python (Pillow/numpy/scikit-image) op de PNG:
   - water (blauw) → grachtpolygonen;
   - straten (lichtgrijs) → skelet → hartlijnen van de wegen;
   - bos (donkergroen) → bosmasker.
2. **Kavels:** de witte nummerlabels herkennen (OCR, bijvoorbeeld Tesseract, of met de hand in de editor), plus de oriëntatie per rij: voorkant naar de straat, achterkant naar het water.
3. **Voorzieningen:** de legendasymbolen met de hand plaatsen. Het zijn er ongeveer 30, en hier is handwerk sneller en betrouwbaarder.
4. **Wegennet** in hetzelfde formaat als `data/map/park_road_network.json`:
   - knopen en wegen met rijrichting;
   - de slagboom bij de overgang van het hart naar de villawijk;
   - een dienstweg voor De werf, De loods en de Milieustraat.

   Daarna activeren in de editor. Die valideert het hele wegennet al.
5. Gebruik de bestaande editor-ondergrond (`public/assets/editor_pdf.jpg`) voor de Harderwold-plattegrond, zodat je in `/editor` over de kaart heen kunt tekenen en corrigeren.

Documenteer elke aanname in `docs/REFERENTIES_EN_AANNAMES.md` (nieuw aanmaken).

## 5. Opstarten van het nieuwe project

### 5.1 Repository en kopie
```
cd ~/Harderwold-Tycoon
git init -b main
git remote add origin https://github.com/Mathijzi/Harderwold-Tycoon.git
git fetch origin && git pull origin main   # alleen als de repo al inhoud heeft
sh kopieer_basis.sh                        # momentopname 98a274d van Landal-Tycoon, zonder geschiedenis
npm install && npx playwright install chromium
```
Het script neemt de Aelderholt-kaart (`data/map`) mee als **tijdelijke placeholder**, zodat server en tests meteen draaien. In fase 1 wordt die vervangen.

### 5.2 Eigen poort, database en Docker
- `src/server/main.ts`: standaardpoort `8090`, `DB_PATH` `runtime/harderwold.sqlite`, standaard `GAME_CODE` bijvoorbeeld `HARDER`.
- `docker-compose.yml` / `Dockerfile`: image `harderwold-tycoon`, volume `harderwold-data`, poort `8090:8090`.
- Alle documentatie en scripts: `localhost:8080` → `localhost:8090` (o.a. `scripts/shot.mjs`-voorbeelden, `docs/RUNBOOK.md`, `public/docs.html`).

### 5.3 Namen vervangen
Deze bestanden noemen nu Aelderholt of Landal:
- `src/web/projector/brand.ts`, `vehicles.ts` (Landal-logo op busjes), `houses.ts`
- `src/web/testclient/main.tsx`, `src/web/admin/main.tsx` (download-namen `aelderholt-…`), `src/web/editor/main.tsx`
- `src/server/{main,http,game,backup,openapi,mapreport}.ts`, `src/shared/mapdoc.ts`
- `public/*.html` (titels), `package.json`, `Dockerfile`, `docker-compose.yml`, `start.mjs`
- `scripts/e2e.mjs`, `scripts/record_cycle.mjs`, `tools/*.py` (Aelderholt-specifiek: niet meer gebruiken voor Harderwold, wel als voorbeeld)
- `docs/RUNBOOK.md`

Haal ook het **Landal-logo op het hoofdgebouw en de busjes** weg (huisstijl uit `brand.ts`). Hernoem het formaat van opgeslagen spellen (`aelderholt-save` → `harderwold-save`) en de `localStorage`-sleutels (`at.*` → `hw.*`).

Draai daarna de controles en maak een eerste commit "Basis overgenomen van Aelderholt Tycoon (momentopname 98a274d)". Push naar `main`.

## 6. Wat er al werkt (motor uit Aelderholt Tycoon, overgenomen)

Alles hieronder komt mee en werkt na de kopie, maar is nog op Aelderholt ingericht.

**Spel en server**
- **Server:** Node 22.13+ zonder runtime-dependencies (`node:http`, `node:sqlite`, WAL), SSE voor de projectie (20 verkeersframes/s), REST plus polling voor de rest, en een OpenAPI-pagina op `/docs`.
- **Verkeerssimulatie** (`src/sim/traffic.ts`, `network.ts`, `park.ts`):
  - rechts rijden, voorrang, conflictzones en vakken in- en uitrijden naar beide kanten;
  - golfkarren van de TD, servicevoertuigen en een personeelsslagboom;
  - herkenning van wachtcirkels, en uitparkeren met terugrijden als de weg geblokkeerd is;
  - stresstests (`npm run multiseed`, 16 seeds, moet "alle runs schoon" geven).
- **Slagbomen:**
  - openen alleen met een passagetoken uit een afgeronde check-in of check-out;
  - check-in pas als de auto vooraan bij de slagboom staat;
  - instelling "automatisch in-/uitchecken";
  - dienstvoertuigen gebruiken een personeelspas.
- **Opdrachten** (`src/shared/tasklib.ts`, `src/sim/scheduler.ts`):
  - 160 gewone opdrachten in 10 groepen;
  - 10 crises als proces van 5–7 meldingen;
  - escalaties en een planner (dag/nacht, maximaal aantal open opdrachten);
  - eigen opdrachten via `/admin`.
- **Gasten en verhalen** (`src/shared/guestlib.ts`, `src/server/stories.ts`):
  - BN'ers als gasten (organisator had toestemming voor een media-event), aangevuld met gewone families;
  - 35 verhaallijnen van 2–3 delen, alleen vriendelijke verhalen voor echte personen.
  - **Vraag de opdrachtgever** of dat thema hier ook geldt.
- **Weer** (`src/shared/weather.ts`):
  - zon, wolken, regen, onweer en mist;
  - beïnvloedt de opdrachten; onweer kan de stormcrisis starten.
- **Spellen:**
  - nieuw spel met spelcode, demospelers, bezetting en sessieplan (einddatum plus aantal in- en uitchecks);
  - opslaan, laden en downloaden;
  - back-ups (elk uur een `VACUUM INTO`), export naar JSON/CSV.
- **Game Master-dashboard `/admin`** (met dark mode):
  - scores met audit, instellingen en logboek;
  - eigen namen en opdrachten;
  - weer, spellen en back-ups.

**Projectie** (`src/web/projector`, PixiJS, 4K)
- **60 fps op 4K** (gemeten op M1 Max):
  - bewegende figuren uit een plaatjes-cache (`Drawable.cacheKey` in `pixi.ts`);
  - een gelijkmatige afspeelklok;
  - `?stats=1` toont de fps.
- **Graphics:**
  - supersampling;
  - gedetailleerde bomen;
  - water met golfjes en spiegelingen (`water.ts`);
  - dag/nacht met verlichting;
  - weereffecten op de GPU (`weatherfx.ts`).
- **Parkleven:** eenden, wandelaars, honden en kinderen (`ambient.ts`).
- **Meldingen en camera:**
  - pop-ups met geluid en een crisispaneel;
  - automatisch inzoomen bij crises;
  - een vaste close-up (`?zoom=3&focus=…`).
- **Overige pagina's:**
  - kaarteditor `/editor` met versies en validatie;
  - testinterface `/test`.
- Alle URL-parameters staan in `public/docs.html` en `docs/RUNBOOK.md`.

**Harde regels die blijven gelden** (bewaakt door tests):
- slagbomen alleen met tokens;
- geen botsingen, illegale passages of spookrijders;
- punten precies één keer, maximaal 3 actieve claims per speler;
- golfkarren nooit over een slagboomstrook;
- de projectie is de enige SSE-client;
- na elke wijziging: build, tests, multiseed en een 4K-screenshot bekijken.

## 7. Wat er anders wordt voor Harderwold

| Onderdeel | Aelderholt | Harderwold (voorstel) |
|---|---|---|
| Kaart | Vector-PDF, 341 bungalows | Raster-PDF, ongeveer 300 villa's aan grachten (§4) |
| Huizen | Bungalows met zadeldak | Witte villa's met plat dak, glas, balkon, terras, zwembad, steiger (§3) |
| Water | Vijvers en sloten | Grachten tussen alle rijen, steigers, sloepen/kano's (mogelijk varende boten als nieuwe NPC) |
| Centrum | Receptie West, Brasserie, zwembad | Receptie + Brasserie Harderwold + terras, groot parkeerterrein |
| Toegang | Twee slagbomen (West en Oost) | Eén slagboompunt (in/uit) bij de overgang naar de villawijk: bevestigen |
| TD-post | TD bij de receptie | **De werf (4)**, ook De loods (5) en de Milieustraat (3) als dienstlocaties |
| Recreatie | Zwembad, bowling, speeltuinen | 9-holes golf, driving range, adventure golf, bosgolf, lasergame, boogschieten, outdoor baan, tennis, jeu de boules |
| Bijzonder | – | Woonboten, 23 camperplaatsen, appartementencomplex (2), trailerstalling |
| Opdrachten | Bungalow-, zwembad- en Bollo-taken | Nieuw: privézwembad, jacuzzi en sauna in villa's, steiger en sloep, golfbaan (greens, golfkarren, ballen), driving range, camperplaatsen, woonboten. De voorzieningsletters in `tasklib.ts` vervangen door de Harderwold-legenda |
| Huisstijl | Landal-teal, Landal-woordmerk | Eigen, neutrale huisstijl (`public/assets/branding.json`), geen officieel logo |

## 8. Voorgestelde fases (één voor één, telkens met akkoord van de opdrachtgever)

0. **Basis:**
   - kopie, eigen poort, database en namen;
   - alles groen;
   - eerste commit en push naar `main`.
1. **Kaart:**
   - grachten, wegen, kavels en voorzieningen uit de raster-PDF;
   - slagboom en dienstwegen;
   - editor-ondergrond;
   - de Aelderholt-placeholder en daaraan gebonden tests vervangen. Let op: `tests/fixtures/deadlock-jtd.park.json` en tests met Aelderholt-namen zoals `gate-in-oost` en `dienstpad-west` moeten mee veranderen;
   - **voorleggen aan de opdrachtgever** voordat je verder gaat.
2. **Villa's:** de nieuwe huizenrenderer met varianten, terrassen, zwembaden en steigers, plus het centrale gebouw en het appartementencomplex. Op 4K bekijken.
3. **Opdrachten en gasten voor Harderwold:** nieuwe voorzieningen, golf, water, camper en woonboten. Thema van de gasten afstemmen.
4. **Water en extra's:** varende sloepen/kano's, golfkarren op de golfbaan, parkleven bij de grachten.

## 9. Open vragen voor de opdrachtgever (stel ze aan het begin)

1. Klopt het dat er één toegang met één slagboom (in en uit) is, op de plek van de rode stippellijn bij het hart?
2. Moeten de gasten weer BN'ers zijn (media-event) of iets anders?
3. Varende boten in de grachten: gewenst? (Het is een nieuw soort verkeer, met eigen regels.)
4. Telt de golfbaan mee als speelgebied (opdrachten, golfkarren), of is het decor?
5. Moet het noordelijke cluster 600–655 (grijs, deels geschakeld) als bestaand worden gezien of als in aanbouw?
6. Huisstijl: welke kleuren en welk woordmerk mogen in beeld (geen officieel logo zonder toestemming)?

## 10. Antwoorden van de opdrachtgever (15 oktober 2026)

1. **Toegang:** klopt. Eén toegang met één slagboompunt (in en uit) op de rode stippellijn ten oosten van het hart.
2. **Gasten:** geen BN'ers. Gewone Nederlanders, aangevuld met artiesten die op schrijverskamp zijn en rijke gasten (het zijn villa's).
3. **Varende boten** in de grachten: ja, gewenst (fase 4).
4. **Golfbaan:** telt mee als speelgebied (opdrachten, golfkarren op de baan). Golfkarpaden horen in het wegennet van fase 1.
5. **Cluster 600–655:** bestaand, deels geschakelde villa's (paren met een schuine streep).
6. **Huisstijl:** kleuren doorgevoerd; volgens de website en het logo (alleen lokaal in `references/huisstijl/`, niet in git): donkerblauw `#1f2a38`, oranje accent `#cc7400`, woordmerk "Harderwold". Of het echte logo in beeld mag, is nog open.

## 11. Stand na fase 1 (kaart, 15 oktober 2026)

- De Aelderholt-placeholder is vervangen door de Harderwold-kaart uit de rasterplattegrond: pijplijn in `tools/harderwold/` (zie `docs/REFERENTIES_EN_AANNAMES.md`).
- 339 woningen (283 villa's, 56 geschakeld in 11 blokken 600-655), ᴬ-varianten als 1000+nummer (`houseLabel`).
- Een toegang: `gate-in`/`gate-out` op de ingangsweg bij het hart; dienstverkeer vanaf De werf via de dienstweg langs de zuidrand en de personeelsslagboom bij De loods; TD-golfkarren bij de trailerstalling.
- Golfbaan (fairways, greens, bunkers), bos, losse bomen, grachten, paden en het parkeerterrein van het hart komen uit de plattegrond.
- Projectie: bord, vlaggen, bloemperken, lantaarnweg en focusnamen staan nu in `park.json` (`decor`) in plaats van in de code.
- Nog niet: Harderwold-villa's en gebouwen (fase 2), Harderwold-opdrachten en gasten (fase 3), golfkarren op de golfbaan en varende boten (fase 4), het echte logo (wacht op permissie).

## 12. Stand na fase 2 (villa's, 16 oktober 2026)

- Nieuwe renderer `src/web/projector/villas.ts`:
  - villa's: wit, plat dak, overstek, glaspuien, balkon, terras, zwembad, steiger met kano, zonnepanelen;
  - geschakelde rijwoningen.
- Maten gedeeld met de simulatie via `src/shared/house.ts`.
- Moderne gevelstijl (`style: 'modern'`, `roof: 'white'`) in `complex.ts` voor het hart, de driving range en de appartementen.
- Beeld volgens de opdrachtgever: ingezoomd op het park, kijkhoek zoals Aelderholt (zie docs).
