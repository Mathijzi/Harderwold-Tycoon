# Startprompt voor de nieuwe Claude Code-sessie

Open een nieuwe Claude Code-sessie in de map `~/Harderwold-Tycoon` en plak dit als eerste bericht:

---

Je werkt aan **Harderwold Tycoon**, een 4K-vakantieparksimulator: een volledig losstaande spin-off van Aelderholt Tycoon (`~/Landal-Tycoon`). Communiceer in het Nederlands met mij (de opdrachtgever). Dit is een fan-/spelprototype: claim nergens een officiële band met Harderwold Villa Resort of Landal.

## Eerst lezen
1. `HANDOFF.md`: wat losstaand betekent, het nieuwe park, de stijl van de villa's, de aanpak van de kaart, opstarten, wat er al werkt, fases en open vragen
2. `CLAUDE.md`: vaste regels
3. `references/harderwold_plattegrond.pdf` (alleen raster; voorbeeld in `references/harderwold_plattegrond_preview.png`) en de foto's in `references/fotos`
4. Na de kopie: `references/basis_spec_V3_uit_aelderholt.md` (de spelspecificatie: verkeer, slagbomen, API, opdrachten)

## Harde regels
- **Volledig los van Landal Tycoon:** wijzig niets in `~/Landal-Tycoon`, push nooit naar die repository, deel geen code, database, poort of Docker-volume. Deze repo is `https://github.com/Mathijzi/Harderwold-Tycoon`; push naar `main`.
- Na elke wijziging: `npm run build`, `npm test`, `npm run multiseed` (moet eindigen met "alle runs schoon") en een 4K-screenshot met de server draaiend (`node scripts/shot.mjs http://localhost:8090/ out.png 3840 2160 7000`) die je zelf bekijkt.
- Slagbomen openen uitsluitend via passagetokens uit afgeronde check-in/check-out-opdrachten. Breek dit nooit.
- Kaart-, wegennet- en gebouwdata in `data/map/` zijn bewerkbare aannames; documenteer ze in `docs/REFERENTIES_EN_AANNAMES.md`.
- `dist/` wordt meegecommit: bouw altijd voor je commit. Commitberichten in het Nederlands, zonder model-ID's.
- De projectie moet vloeiend blijven (60 fps op 4K, controleer met `?stats=1`).

## Werkwijze
1. Doe **fase 0** uit `HANDOFF.md` §5:
   - repository koppelen;
   - `sh kopieer_basis.sh`;
   - `npm install`;
   - eigen poort 8090, eigen database en namen;
   - alles groen;
   - eerste commit en push naar `main`.
2. Bevestig daarna kort dat alles draait en dat de tests groen zijn.
3. Stel me de open vragen uit `HANDOFF.md` §9.
4. Begin pas aan fase 1 (de kaart) na mijn antwoorden. Start geen grote nieuwe fase zonder mijn akkoord.
