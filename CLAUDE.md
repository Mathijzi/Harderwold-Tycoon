# Harderwold Tycoon - instructies voor Claude Code

Lees eerst **HANDOFF.md** (overdracht, wat er al is, wat er anders wordt, open vragen) en daarna `START_HIER.md`.

- Communiceer in het Nederlands met de opdrachtgever.
- Dit is een **volledig los project**: het startpunt is een momentopname van de motor van Aelderholt Tycoon (Landal-Tycoon), maar er is geen gedeelde code, geen gedeelde git-geschiedenis, geen gedeelde database en geen gedeelde poort. Wijzig nooit iets in `~/Landal-Tycoon` en push nooit naar die repository.
- Repository: `https://github.com/Mathijzi/Harderwold-Tycoon`. Commit en push alleen hier, met duidelijke Nederlandse berichten, zonder model-ID's.
- Fan-/spelprototype: claim nergens een officiële affiliatie met Harderwold Villa Resort of Landal. Foto's in `references/fotos` zijn alleen referentie voor de stijl, niet om in het spel te tonen.
- Na elke wijziging: `npm run build`, `npm test`, `npm run multiseed` en een 4K-screenshot (`node scripts/shot.mjs http://localhost:8090/ out.png 3840 2160 7000`) die je zelf bekijkt.
- Slagbomen openen uitsluitend via passagetokens uit afgeronde check-in/check-out-opdrachten. Breek dit nooit.
- Kaart-, wegennet- en gebouwdata in `data/map/` zijn bewerkbare aannames; documenteer wijzigingen in `docs/REFERENTIES_EN_AANNAMES.md`.
- `dist/` wordt meegecommit: bouw altijd voor je commit.
- Browserlimiet (~6 verbindingen per host): de projectie is de enige SSE-client en sluit die als het tabblad verborgen is; dashboard, testclient en editor pollen. Geen nieuwe permanente SSE-verbindingen.
- De projectie moet vloeiend blijven (60 fps op 4K): bewegende figuren via de plaatjes-cache (`cacheKey`), geen tekenwerk of texture-uploads per frame. Controleer met `?stats=1`.
