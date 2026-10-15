# Referenties en aannames: Harderwold Tycoon

Fan-/spelprototype zonder officiële band met Harderwold Villa Resort of Landal. Alles in `data/map/` is een bewerkbare aanname.

## Bronnen
- `references/harderwold_plattegrond.pdf`: plattegrond van het park (A3, alleen raster, 4961 × 3508 px). Voorbeeld: `references/harderwold_plattegrond_preview.png`.
- `references/fotos/*.webp`: alleen stijlreferentie voor de villa's, niet in het spel getoond.
- `references/basis_spec_V3_uit_aelderholt.md`: spelspecificatie van de basis (verkeer, slagbomen, API, opdrachten).

## Stand na fase 0 (basis)
- `data/map/` is nog de kaart van Aelderholt als **tijdelijke placeholder** (momentopname 98a274d), zodat server en tests draaien. Wordt in fase 1 vervangen.
- Aangepast in de placeholder: het bordtekst "Landal" op het centrale gebouw (`park.json`, `massing_central.json`, `sector_receptie_west.json`) is "Harderwold" geworden, en de parknaam in `park.json` zegt dat het een placeholder is.
- Huisstijl: eigen neutrale kleuren (`#1f6f78` / `#154f56`) en woordmerk "Harderwold" in `public/assets/branding.json`; zelfgemaakt embleem (ring met twee golven) in `src/web/projector/vehicles.ts`. Geen officieel logo.

## Huisstijl (15 oktober 2026)
- Kleuren volgens de website van Harderwold Villa Resort (aangeleverd door de opdrachtgever): donkerblauw `#1f2a38` (hoofdkleur, `BRAND.teal`), oranje accent `#cc7400`. In de beheerpagina's is het accent `#a85e00` (licht, leesbaar met witte tekst) of `#f0a040` (donker thema).
- Het logo staat alleen lokaal in `references/huisstijl/` (niet in git). Het embleem in beeld is nog het neutrale eigen embleem.
