#!/bin/sh
# Eenmalig: zet de motor van Aelderholt Tycoon (Landal-Tycoon) als startpunt in dit losse project.
# - Vaste momentopname (commit 98a274d), zonder git-geschiedenis: latere wijzigingen in Landal-Tycoon hebben
#   hier geen invloed, en wijzigingen hier raken Landal-Tycoon niet.
# - De Aelderholt-kaart (data/map) komt mee als TIJDELIJKE placeholder, zodat server en tests meteen draaien;
#   in fase 1 wordt die vervangen door Harderwold (zie HANDOFF.md). Zonder Landal-referenties, screenshots,
#   rapporten en huisstijl.
# Gebruik (in deze map):  sh kopieer_basis.sh
set -e
SRC="${LANDAL_TYCOON_DIR:-$HOME/Landal-Tycoon}"
COMMIT=98a274d
HERE="$(cd "$(dirname "$0")" && pwd)"

[ -d "$SRC/.git" ] || { echo "Landal-Tycoon niet gevonden in $SRC (zet LANDAL_TYCOON_DIR)"; exit 1; }
[ -f "$HERE/package.json" ] && { echo "Er staat al een package.json: de basis is al gekopieerd. Gestopt."; exit 1; }

echo "Momentopname $COMMIT uit $SRC kopieren naar $HERE ..."
git -C "$SRC" archive "$COMMIT" -- . \
  ':(exclude)references' ':(exclude)screenshots' ':(exclude)reports' \
  ':(exclude)public/assets/editor_pdf.jpg' ':(exclude)public/assets/branding.json' \
  ':(exclude)HANDOFF.md' ':(exclude)CLAUDE.md' ':(exclude)README.md' \
  ':(exclude)docs/REFERENTIES_EN_AANNAMES.md' \
  | tar -x -C "$HERE"

# de generieke spelspecificatie (verkeer, slagbomen, API, opdrachten) als referentie, met een duidelijke naam
mkdir -p "$HERE/references"
git -C "$SRC" show "$COMMIT:references/Aelderholt_Tycoon_Masterprompt_V3.md" > "$HERE/references/basis_spec_V3_uit_aelderholt.md"

# lege plekken voor wat hier nieuw wordt
mkdir -p "$HERE/public/assets" "$HERE/runtime"
printf "TIJDELIJK: dit is de kaart van Aelderholt (placeholder uit de basis). Vervangen in fase 1.\n" > "$HERE/data/map/LEESMIJ_PLACEHOLDER.txt"
printf '{\n  "teal": "#1f6f78",\n  "tealDark": "#154f56",\n  "wordmark": "Harderwold",\n  "parkName": "Harderwold",\n  "note": "Bewerkbare huisstijl (spelprototype). Geen officiele assets van Harderwold Villa Resort."\n}\n' > "$HERE/public/assets/branding.json"

echo "Klaar. Volgende stap: zie HANDOFF.md, paragraaf 5 (hernoemen, poort 8090, eigen database, eerste commit)."
