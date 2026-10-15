# Runbook Harderwold Tycoon

Voor wie het spel neerzet en draaiende houdt (operator / spelleider). Dit is een fan-/spelprototype zonder officiële band met Harderwold Villa Resort of Landal.

## 1. Wat draait er

Eén Node.js-proces (`node start.mjs`) met een webserver op poort 8090 en één SQLite-database. Er zijn geen andere diensten nodig.

| Adres | Wat | Wie |
|---|---|---|
| `/` | Projectie (4K, beamer) | groot scherm |
| `/admin` | Game Master-dashboard | spelleider (admin-sleutel) |
| `/test` | Testinterface (doet zich voor als speler-app) | ontwikkelaar / demo |
| `/editor` | Kaarteditor | beheerder (admin-sleutel) |
| `/docs` | API-documentatie | ontwikkelaars |
| `/api/v1/health` | Gezondheidscontrole (`{"ok":true}`) | monitoring |

Alles wat bewaard moet blijven, staat in één map (`runtime/`, in Docker het volume `/app/runtime`):

- `harderwold.sqlite`: lopend spel, opgeslagen spellen, eigen namen en opdrachten, kaartversies, logboek
- `backups/`: automatische back-ups (elk uur, de laatste 48)
- `map/` (alleen in Docker): de bewerkbare kaart

## 2. Lokaal starten (Mac of Windows)

1. Installeer Node.js 22.13 of nieuwer (`node -v`).
2. Ga in een terminal naar de projectmap. De eerste keer: `npm install`.
3. Start de server met `node start.mjs`.
4. Open `http://localhost:8090/` voor de projectie en `http://localhost:8090/admin` voor het dashboard.

Stoppen doe je met Ctrl+C. Het spel wordt dan bewaard en gaat bij de volgende start verder.

Draait er al iets op poort 8090, stop dat dan eerst. Zoek het proces met `lsof -ti :8090` en stop het met `kill <pid>`. Je kunt ook een andere poort kiezen: `PORT=8091 node start.mjs`.

## 3. Instellingen (omgevingsvariabelen)

| Variabele | Standaard | Betekenis |
|---|---|---|
| `ADMIN_KEY` | `gm-harderwold` | Sleutel voor dashboard en editor. **Altijd zelf instellen buiten je eigen netwerk.** |
| `GAME_CODE` | `HARDER` | Spelcode van het eerste spel (later per spel in `/admin` → Spellen) |
| `PORT` / `HOST` | `8090` / `0.0.0.0` | Waar de server luistert |
| `DB_PATH` | `runtime/harderwold.sqlite` | Database |
| `BACKUP_DIR` | map van de database + `/backups` | Waar back-ups komen |
| `BACKUP_EVERY_MIN` / `BACKUP_KEEP` | `60` / `48` | Hoe vaak, en hoeveel bewaren (0 = geen automatische back-ups) |
| `MAP_DIR` | `data/map` | Bewerkbare kaart |
| `TIME_SCALE`, `AUTO_ARRIVALS`, `DEMO_BOT`, `AUTO_GATE`, `INITIAL_OCCUPIED`, `SEED` | | Startinstellingen. Daarna in `/admin` aan te passen. |

## 4. Docker (lokaal of op een server)

1. Zet naast `docker-compose.yml` een bestand `.env` met daarin `ADMIN_KEY=een-lange-geheime-sleutel`.
2. Bouw de bestanden met `npm run build`. De map `dist/` staat ook in git.
3. Start met `docker compose up -d --build`.
4. Kijk of het werkt met `docker compose ps` (status `healthy`) en `docker compose logs -f`.

Het volume `harderwold-data` bevat de database, de back-ups en de kaart. Bij de eerste start wordt de kaart uit de image naar het volume gekopieerd. Wijzigingen uit de kaarteditor blijven daarna bewaard, ook bij een nieuwe image.

**Bijwerken naar een nieuwe versie:** `git pull`, `npm run build` en daarna `docker compose up -d --build`. Het volume blijft staan. Maak voor de zekerheid eerst een back-up (zie §6).

## 5. In de cloud (een eigen VPS)

Elke kleine Linux-server met Docker volstaat (1 vCPU en 1 GB geheugen is genoeg voor de server). Het zware tekenwerk doet de beamer-pc.

1. Installeer Docker en zet het project op de server, met `git clone` of door de map te kopiëren.
2. Volg §4.
3. Zet er een HTTPS-proxy voor, bijvoorbeeld met Caddy. Maak een `Caddyfile` met deze regel:
   ```
   tycoon.jouwdomein.nl {
       reverse_proxy localhost:8090
   }
   ```
   Caddy regelt het certificaat zelf. Laat de proxy SSE niet bufferen: Caddy doet dat goed zonder extra instellingen.
4. Open in de firewall alleen poort 80 en 443, en zet poort 8090 dicht.

Let op: de admin-sleutel gaat mee in elke beheeraanvraag. Gebruik daarom online altijd HTTPS.

## 6. Back-ups en terugzetten

**Automatisch:** de server maakt elk uur een volledige kopie van de database in `runtime/backups/` (de laatste 48). Dat kan veilig terwijl het spel draait.

**Handmatig:** ga in `/admin` naar Export en klik op "Nu een back-up maken". Daar kun je elke back-up ook downloaden. Bewaar af en toe een kopie buiten de server.

**Eén spel terugzetten** kan online, zonder iets te stoppen. Ga in `/admin` naar Spellen en klik bij het gewenste spel op "Laden". Het lopende spel wordt eerst automatisch bewaard.

**De hele database terugzetten** doe je zo:

1. Stop de server (Ctrl+C, of `docker compose stop`).
2. Hernoem de huidige database als reservekopie: `mv runtime/harderwold.sqlite runtime/harderwold.sqlite.oud`, en verwijder ook `harderwold.sqlite-wal` en `harderwold.sqlite-shm` als die er staan.
3. Zet de back-up terug: `cp runtime/backups/<bestand>.sqlite runtime/harderwold.sqlite`.
4. Start de server weer.

Docker volgt dezelfde stappen in het volume. Bijvoorbeeld:
```
docker compose stop
docker run --rm -v harderwold-tycoon_harderwold-data:/data alpine sh -c "cd /data && mv harderwold.sqlite harderwold.sqlite.oud && rm -f harderwold.sqlite-wal harderwold.sqlite-shm && cp backups/<bestand>.sqlite harderwold.sqlite"
docker compose start
```
De naam van het volume vind je met `docker volume ls`.

## 7. De beamer-pc (projectie)

- Gebruik Chrome of Edge op volledig scherm (F11), bij voorkeur op 3840×2160. Met `?res=4k` forceer je de 4K-weergave.
- Wil je geluid zonder eerst te klikken (kioskmodus), start dan Chrome met `--autoplay-policy=no-user-gesture-required --kiosk http://<server>:8090/`. Anders klik je één keer op de projectie.
- Alle URL-parameters van de projectie staan hieronder (ook op `/docs`). Combineer ze met `&`, bijvoorbeeld `/?res=4k&hud=1.2` of `/?zoom=3&focus=receptie` voor een close-up op een tweede scherm.

| Parameter | Waarden | Standaard | Wat het doet |
|---|---|---|---|
| `res` | 1080 · 1440 · 4k | automatisch | Interne tekenresolutie. Standaard volgt hij het scherm (een laptop tekent geen 4K). Op de beamer: `res=4k`. |
| `fps` | 5–144 | 60 | Maximaal aantal beelden per seconde (standaard het ritme van het scherm, 60). |
| `stats` | 1 | uit | Toont linksonder de gemeten fps, de traagste frame en de rekentijd. Handig om de beamer-pc te testen. |
| `hud` | bijv. 0.8 · 1.5 | 1 | Grootte van scorebord, klok en crisispaneel. |
| `zoom` | 2–6 | 1 | Vaste close-up: alles wordt op die schaal getekend, met echt detail. Alleen wat in beeld is wordt opgebouwd. Handig voor een tweede scherm. |
| `focus` | receptie · brasserie · slagboom · appartementen · golf · werf · loods · <huisnummer> · <letter> · x,y | receptie | Middelpunt van de close-up (alleen met `zoom`). Een huisnummer, een voorzieningsletter uit de PDF-legenda, of wereldcoördinaten in meters. |
| `autozoom` | 0 | aan | Zet het automatisch inzoomen bij crises of verhalen op dit scherm uit. Aan/uit voor iedereen: `/admin` → Instellingen → Projectie. |
| `autozoomlevel` | 1.2–3 | 1.8 | Hoe ver het automatisch inzoomen gaat. |
| `sound` | 0 | aan | Alle geluid uit (meldingen en sfeer). |
| `volume` | 0–1 | 0.6 | Volume van meldingen en sfeergeluid. |
| `ambience` | 0 | aan | Alleen het sfeergeluid (vogels, eenden, krekels, wind) uit. |
| `night` | 0 | aan | Geen dag/nacht-weergave (altijd licht). |
| `weather` | zon · halfbewolkt · bewolkt · regen · onweer · mist | weer van het spel | Toon dit weer op dit scherm (om te testen); het spel zelf verandert niet. Het echte weer zet je in `/admin` → Instellingen → Weer. |
| `hour` | 0–23.99 | speltijd | Doe alsof het dit uur is voor licht en sfeer (om te testen, bijv. `hour=22`). |
| `life` | 0 | aan | Geen eenden, wandelaars, honden en spelende kinderen. |
| `waves` | 0 | aan | Geen bewegende golfjes op het water. |
| `groundss` | 1–3 | 2 (1 bij zoom) | Supersampling van de grond (wegen, markeringen, water). 1 = sneller opstarten en minder geheugen op een tragere pc. |
| `renderer` | canvas | pixi | Terugvaloptie zonder WebGL (Canvas 2D). Golfjes en GPU-zoom werken dan beperkt. |
| `debug` | <admin-sleutel> | uit | Toont wegennet, wachtredenen en conflictzones (voor ontwikkelaars). |

- Een browser opent maar ongeveer zes verbindingen per server. De projectie is de enige pagina met een live verbinding en sluit die als het tabblad verborgen is. Meerdere tabbladen tegelijk (projectie, dashboard, editor) zijn dus geen probleem.

## 8. Tijdens een spel

1. Ga in `/admin` naar Spellen en start een nieuw spel met een naam en spelcode. Laat demospelers uit bij echte spelers.
2. Geef de spelers de spelcode. Ze melden zich aan via de app of testinterface.
3. Stuur bij via Instellingen: tempo van opdrachten, crises, verhaallijnen, pop-upduur, dag/nacht en geluid.
4. Pas scores alleen aan met een reden. Alles komt in het logboek.
5. Na afloop: download de eindstand via Export en sla het spel op via Spellen → "Opslaan als…".

## 9. Problemen oplossen

| Probleem | Oplossing |
|---|---|
| Pagina laadt niet | Draait de server? Controleer `/api/v1/health`. Check ook de poort en de firewall. |
| "Admin-sleutel klopt niet" | Gebruik dezelfde sleutel als `ADMIN_KEY` van de server. Het dashboard onthoudt hem per browser. |
| Projectie blijft hangen bij "laden" | Ververs de pagina (F5) en controleer de console (F12). Bij een trage pc: `?res=1080`. |
| Geen geluid | Klik één keer op de projectie, of gebruik de kioskvlag uit §7. Controleer ook `?sound=0` en het volume van de pc. |
| Na een kaartwijziging begint het spel opnieuw | Zo is het bedoeld: een oud spel past niet bij nieuwe wegen. Bewaar het spel daarom eerst. Een opgeslagen spel van een andere kaartversie kun je niet laden. |
| Database kapot of per ongeluk gewist | Zet een back-up terug (§6). |
| Slagboom gaat niet open | Hij opent alleen na een afgeronde check-in of check-out. Dat is de kernregel. In nood: `/test` → Noodbediening (komt in het logboek). |
