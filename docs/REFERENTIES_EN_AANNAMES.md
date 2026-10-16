# Referenties en aannames: Harderwold Tycoon

Dit is een fan-/spelprototype. Het spel wordt gemaakt voor de eigenaar van Harderwold Villa Resort; er is geen band met Landal. Alles in `data/map/` is een bewerkbare aanname en kan in de kaarteditor (`/editor`) worden bijgesteld.

## Bronnen
- `references/harderwold_plattegrond.pdf`: plattegrond van het park. Het is één A3-pagina met alleen een rasterafbeelding van 4961 × 3508 px, zonder vectoren of tekst. Een voorbeeld staat in `references/harderwold_plattegrond_preview.png`.
- `references/fotos/*.webp`: alleen stijlreferentie voor de villa's (fase 2). Deze foto's worden niet in het spel getoond.
- `references/huisstijl/`: website-uitsnede en logo, aangeleverd door de opdrachtgever. Ze staan alleen lokaal en niet in git.
- `references/basis_spec_V3_uit_aelderholt.md`: spelspecificatie van de basis (verkeer, slagbomen, API, opdrachten).

## Hoe de kaart wordt gemaakt (fase 1)
Coördinaten zijn **pixels van het volle raster** (“pt” in de code). De pijplijn staat in `tools/harderwold/`:

| Stap | Script | Wat |
|---|---|---|
| 1 | `extract_plan.py` | Haalt het raster uit de PDF en schrijft `work/plan_full.png`. |
| 2 | `segment.py` | Maakt kleurmaskers: water, wegen, nummervakjes, verharding, bos en de witte achtergrond. |
| 3 | `skeleton.py` | Bepaalt de hartlijnen van de wegvlakken (verdunning). |
| 4 | `labels.py` | Leest de nummervakjes: positie, richting en huisnummer. De cijfers worden herkend met sjablonen uit de rechtopstaande labels 204–216. |
| 5 | `build_map.py` | Schrijft `park.json`, `park_road_network.json` en `harderwold_manifest.json`. |
| – | `overlay.py` | Maakt een controlebeeld: de kaart over de plattegrond (`work/overlay.png`). |

De map `work/` staat niet in git; alle stappen zijn opnieuw te draaien. Daarna controleren met `node --import tsx scripts/mapcheck.ts`, dat de kaart opbouwt en de validatie toont.

## Aannames

### Schaal en beeld
- **Schaal:** 1 pt = **0,24 m**.
  - Een weg is ongeveer 25 pt breed, dus 6 m (twee rijstroken).
  - Een kavelfront is ongeveer 85 pt, dus 20 m.
  - De tennisbaan is in de PDF kleiner dan op schaal getekend.
  - Het park beslaat zo ongeveer 1,1 × 0,84 km.
- **Beeld en camerahoek** (opdrachtgever, 15-10-2026: "meer 3D zoals Aelderholt, geen grote bosrand, ingezoomd op het park"):
  - Het beeld is bijgesneden tot het park zelf: x 1000–4800, y 130–3320. Dat loopt van de westrand van de golfbaan tot de oostrand van de villawijk, en van de noordrand tot de dienstweg.
  - De camera staat op ongeveer 42°, dezelfde kijkhoek als Aelderholt (`TILT = 0,67` in `build_map.py`; de projectie leidt de hoek af uit de beeldverhouding).
  - Het meer met de woonboten, lasergame, boogschieten en de outdoor baan (uiterst noordwesten) valt buiten beeld. Die voorzieningen staan nog wel in de kaartdata.
  - Gebied dat op de plattegrond wit is (buiten het park, ook achter de legenda) wordt in het spel ook bos.

### Water, bos en golfbaan (uit de kleuren)
- **Grachten en vijvers:** blauwe vlakken. Eilanden zijn met een naad van nul breed in de omtrek opgenomen, zodat elk watervlak één polygoon is. Blauwe pictogrammen (1–5, i, P) zijn geen water.
- **Golfbaan:**
  - fairways: iets donkerder groen;
  - greens: lichtgroen, met een vlaggetje in het spel;
  - bunkers: zandkleur.
- **Bos:** grote donkergroene vlakken. Losse bomen en kleine groepjes komen op de plek uit de plattegrond (`decor.trees`). Daarbuiten staan bijna geen extra bomen, zodat kavels en golfbaan open blijven.
- **Verharding** is ingedeeld naar breedte:
  - smalle stroken (golfpaden, voetpaden) worden voetpad;
  - brede vlakken (werf, milieustraat, overloopparkeren) worden asfalt.

### Wegennet
- **Topologie met de hand, vorm automatisch:** knooppunten en wegindeling zijn met de hand vastgelegd in `build_map.py`. De vorm van een weg volgt de hartlijn van het wegvlak. Waar de hartlijn ontbreekt (lichtere wegdelen) lopen de wegen recht tussen opgegeven punten.
- **Villastraten:** alle straten zijn tweerichtingsverkeer met een keerlus aan het eind. De lus ligt iets van het water af (straal 5,5 m).
- **Eén toegang** (opdrachtgever, 15-10-2026):
  - De in- en uitrijslagboom staan op de ingangsweg, net ten zuiden van de kruising bij het hart. Op de plattegrond staan daar de rode stippellijnen.
  - Achter de slagboom liggen het hart, de camperplaatsen en de villawijk.
  - De wachtrij (6 plaatsen) staat op de ingangsweg en reikt niet tot de openbare weg.
- **Ingang:** het park begint aan de zuidrand, waar de ingangsweg de kaart verlaat. Daar ligt de openbare weg.
- **Dienstverkeer:**
  - Dienstvoertuigen (onderhoud, schoonmaak) starten bij **De werf (4)**.
  - Ze rijden over de dienstweg langs de zuidrand door het bos naar **De loods (5)**. Daar staat een **personeelsslagboom**, die alleen met een personeelspas opengaat.
  - Gasten kunnen niet op de dienstwegen komen.
- **Golfkarren van de technische dienst** staan bij de trailerstalling bij De loods, binnen de slagboom. Ze rijden dus nooit over een slagboomstrook.
- **Keerlus Oostlaan:** de Oostlaan eindigt in een keerlus bij De loods, zodat de villa's 442–478 ook weer weg kunnen.
- **Golfpaden** zijn in fase 1 voetpaden en geen rijbaan. Golfkarren op de baan volgen in een latere fase.
- **Hart:** het parkeerterrein is een ontwerp naar de plattegrond: zes rijen tussen hagen, met laadpalen aan de noordrij. De auto's daar zijn decor.

### Villa's en kavels
- **Positie en richting:** komen uit de grijze nummervakjes. Het huis staat midden in de kavel, met de voorkant naar de dichtstbijzijnde straat en de achterkant naar het water. Huizen die een weg, parkeervak of buurhuis raken, schuift de simulatie een paar meter op; dat wordt gemeld in de editor.
- **Varianten met ᴬ** (217ᴬ, 312ᴬ, 358ᴬ, 359ᴬ, 364ᴬ, 577ᴬ) worden intern opgeslagen als 1000 + nummer (bijv. 1217) en getoond als “217A” (`houseLabel` in `src/shared/house.ts`).
- **Geschakelde blokken 600–655** (opdrachtgever: bestaand, deels geschakeld):
  - Elk grijs blok met “600/604” bevat de woningen 600 t/m 604, naast elkaar.
  - Blok 625/630 telt zes woningen; in totaal zijn dat 56 woningen in 11 blokken.
  - Elk blok heeft een eigen parkeerstrook.
- **Parkeren:** elke villa heeft een eigen parkeervak aan de straatkant van de kavel.
- **Huistype:** “8V” (villa) en “4G” (geschakeld). De bouwers staan in `src/web/projector/villas.ts`; de maten komen uit `src/shared/house.ts` (`villaVariant`, `houseSize`), zodat simulatie en tekening altijd kloppen.
- **Voorkant:** naar de dichtstbijzijnde straat, uitgelijnd op het kavelvak (`frontDeg` in `park.json`).
- **Aantal:** 283 villa's + 56 geschakelde woningen = **339**.

### Voorzieningen en gebouwen
- **Pictogrammen:** zijn met de hand op de plek van het pictogram op de plattegrond gezet.
- **Letters:** zijn tijdelijk gekoppeld aan de opdrachten van de basis, tot fase 3:

  | Letter | Voorziening |
  |---|---|
  | A | Receptie |
  | G | Brasserie Harderwold |
  | H | Terras |
  | J | Toiletten & douches |
  | S | Speeltuinen |
  | V | Winkeltje bij de receptie |
  | W | Fietsen bij de receptie |
  | R | Driving range |
  | Z | Jeu-de-boules |
  | U | Adventure golf |
  | O | 9-holes golfbaan |
  | L | Bosgolf |
  | T | Lasergame |
  | C | Boogschieten |
  | Y | Outdoor baan |
  | Q | Tennisbaan |
  | I | De werf |
  | M | De loods |
  | N | Appartementen |
  | E | AED |
  | X | Afval |

  Nieuw zonder opdrachten: CP (camperplaatsen), WB (woonboten), D (milieustraat), F (trailerstalling), K (stort chemisch toilet), B5 (brievenbus), P (parkeren), EV (laden).
- **Gebouwen** (`massing`): voorlopige blokken met de vormen van de basis. Fase 2 vervangt ze door Harderwold-architectuur.
  - brasserie en receptie, met terras;
  - driving range;
  - De werf en De loods;
  - het X-vormige appartementencomplex (twee vleugels van 45°).
- **Decor** (`decor`): het entreebord, de vlaggen en de bloemperken staan bij de slagboom. Er staan lantaarns langs de ingangsweg.

### Huisstijl (15 oktober 2026)
- **Kleuren:** volgens de website van Harderwold Villa Resort, aangeleverd door de opdrachtgever.
  - Donkerblauw `#1f2a38` is de hoofdkleur (`BRAND.teal`).
  - Het accent is oranje `#cc7400`.
  - In de beheerpagina's is het accent `#a85e00` in het lichte thema (leesbaar met witte tekst) en `#f0a040` in het donkere thema.
- **Logo:** de opdrachtgever wil het echte logo in beeld (het spel wordt voor de eigenaar gemaakt). Het staat nog niet in het spel, omdat de automatische permissiecontrole het inbouwen tegenhield. Tot dat geregeld is, staat er een eigen neutraal embleem. Witte en donkere versies staan klaar in `references/huisstijl/gegenereerd/` (lokaal).

### Villa's en gebouwen (fase 2, 16 oktober 2026)
Stijl volgens `references/fotos`. Varianten worden vast per huisnummer gekozen.

**Villa's**
- **Maten:** 10,5–13,5 × 9–10 m.
- **Verdiepingen:** 72% heeft er twee; de bovenverdieping is kleiner en zit naar één kant geschoven, met een balkon met zwarte balustrade op de dakrand.
- **Dak:** plat, met een brede witte overstek (1,6 m boven het terras). Op 65% liggen zonnepanelen.
- **Gevel:** zwarte kozijnen; grote glaspuien aan de waterkant, de voordeur aan de straat.
- **Tuin:**
  - een terras van grote grijze tegels van 5,5 m aan de waterkant;
  - in 42% van de gevallen een zwembad met ligbedden, anders een tuintafel;
  - hagen langs de zijkanten.
- **Steiger:** een houten steiger van het terras tot ruim 4 m in de gracht. De lengte volgt uit het water achter het huis. In 35% van de gevallen ligt er een kano of SUP naast.

**Geschakelde woningen (600–655)**
- Wit, twee lagen, plat dak.
- Elke woning is precies zijn deel van het blok breed, zodat de woningen tegen elkaar aan staan.
- Een klein terras met een donker tuinscherm.
- Voor de vrije-ruimtecontrole is de woning smaller dan getekend, zodat de simulatie de woningen niet uit elkaar duwt.

**Overige gebouwen**
- **Hart, driving range en appartementen:** moderne stijl. Witte gevels met verdiepingshoge zwarte puien en strookramen boven, een licht plat dak met witte rand, en zonnepanelen op grote daken.
- **De werf en De loods:** houden een werkplaatsdak.
