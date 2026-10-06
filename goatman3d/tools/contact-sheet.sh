#!/usr/bin/env bash
# Contact sheet of every texture in goatman3d/assets (for PRs and quick checks).
#   goatman3d/tools/contact-sheet.sh [OUT.png]
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-$ROOT/docs/contact-sheet.png}
CELL=160
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$(dirname "$OUT")"

i=0
while IFS= read -r f; do
  name=$(basename "$f" .png)
  # Each texture shrunk to fit the cell (never enlarged past 2x, nearest neighbour) over a grey checker.
  ffmpeg -v error -y -nostdin -f lavfi -i "color=c=0x404040:s=${CELL}x${CELL}" -i "$f" -filter_complex \
    "[1:v]format=rgba,scale=w='min($CELL-8\,iw*2)':h='min($CELL-20\,ih*2)':force_original_aspect_ratio=decrease:flags=neighbor[t];[0:v][t]overlay=(W-w)/2:(H-h-12)/2,drawtext=text='$name':x=4:y=H-12:fontsize=10:fontcolor=0xffb43c" \
    -frames:v 1 "$TMP/c_$(printf %03d $i).png"
  i=$((i + 1))
done < <(find "$ROOT/assets" -name '*.png' | sort)

cols=10
rows=$(( (i + cols - 1) / cols ))
while (( i < cols * rows )); do
  ffmpeg -v error -y -nostdin -f lavfi -i "color=c=0x202020:s=${CELL}x${CELL}" -frames:v 1 "$TMP/c_$(printf %03d $i).png"
  i=$((i + 1))
done
ffmpeg -v error -y -nostdin -framerate 1 -i "$TMP/c_%03d.png" -vf "tile=${cols}x${rows}" -frames:v 1 "$OUT"
echo "$OUT"
