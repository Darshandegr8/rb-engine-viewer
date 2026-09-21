#!/usr/bin/env bash
# Shrinks engine_cfm56-7b.glb for a 500Kbps link (62 KB/s: every MB ~ 16s).
# The app's STEPS refer to meshes by INDEX (0..51), so anything that merges or
# reorders meshes (join / flatten / instance / palette / prune) is switched OFF.
# Flag names are gltf-transform 4.x; check `npx @gltf-transform/cli optimize --help` if a version differs.
set -euo pipefail
IN="${1:-engine_cfm56-7b.glb}"
OUT="${2:-engine_cfm56-7b.opt.glb}"

npx --yes @gltf-transform/cli optimize "$IN" "$OUT" \
  --compress meshopt \
  --texture-compress webp --texture-size 512 \
  --simplify true --simplify-ratio 0.5 --simplify-error 0.005 \
  --join false --flatten false --instance false --palette false --prune false

ls -l "$IN" "$OUT"
echo "Target: <= 1.5 MB (~24 s at 500Kbps). If still larger, lower --simplify-ratio or --texture-size."
echo "Then open the app and check the console for '[model] expected 52 meshes' warnings."
