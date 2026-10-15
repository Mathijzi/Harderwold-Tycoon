#!/bin/sh
# First start: put the editable map on the volume (later starts keep the map-editor changes).
set -e
if [ -n "$MAP_DIR" ] && [ ! -f "$MAP_DIR/park.json" ]; then
  mkdir -p "$MAP_DIR"
  cp -r /app/data/map/. "$MAP_DIR/"
  echo "Kaart gekopieerd naar $MAP_DIR"
fi
exec "$@"
