#!/usr/bin/env bash
# Regenerates every file in goatman3d/assets/ from Charlie's originals.
#
#   goatman3d/tools/prep-assets.sh [SRC_DIR]
#
# SRC_DIR holds the layered paintings ("Goatman Himself/", "WALKYBOY/",
# "the savannahg/"); default /mnt/project-files. The repo's assets/images/ is
# the other source (videos, forest art). Only bash + ffmpeg/ffprobe are used.
# Safe to re-run: everything is overwritten. The originals are never touched.
set -euo pipefail

SRC=${1:-/mnt/project-files}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
IMG="$ROOT/assets/images"
OUT="$ROOT/goatman3d/assets"
GM="$SRC/Goatman Himself"
WB="$SRC/WALKYBOY"
SV="$SRC/the savannahg"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

for d in "$GM" "$WB" "$SV" "$IMG"; do
  [ -d "$d" ] || { echo "missing source folder: $d" >&2; exit 1; }
done
mkdir -p "$OUT"/{goatman,forest,field,savanna,audio,video}
FF=(ffmpeg -v error -y -nostdin)
MANIFEST="$TMP/manifest.tsv"
: > "$MANIFEST"

# Record a generated file for MANIFEST.md: note <file> <source> <purpose>
note() { printf '%s\t%s\t%s\n' "${1#"$OUT"/}" "$2" "$3" >> "$MANIFEST"; }

# --- Helpers -----------------------------------------------------------------------

# Bounding box of the opaque part of an image, as w:h:x:y.
bbox() {
  "${FF[@]/error/info}" -i "$1" -vf "alphaextract,cropdetect=limit=0.02:round=2:reset=0:skip=0" -f null - 2>&1 \
    | grep -o 'crop=[0-9]*:[0-9]*:[0-9]*:[0-9]*' | tail -1 | cut -d= -f2
}

# Crop filter for a region given as fractions of the image: x0 y0 x1 y1.
frac() { echo "crop=iw*($3-$1):ih*($4-$2):iw*$1:ih*$2"; }

# Palette-reduce a PNG to N colours with no dithering. Alpha becomes a hard
# on/off mask (alpha-tested, like 2001) and hidden pixels are black, so nothing
# bleeds round the edges.
pal() {
  local in=$1 out=$2 n=${3:-32}
  "${FF[@]}" -i "$in" -f lavfi -i color=c=black:d=0.04 -filter_complex \
    "[0:v]format=rgba,split[a][m];[1:v][a]scale2ref[k][a2];[k][a2]overlay=format=auto:shortest=1,format=rgb24,split[f1][f2];[f1]palettegen=max_colors=$n:reserve_transparent=0:stats_mode=full[p];[f2][p]paletteuse=dither=none,format=rgb24[rgb];[m]alphaextract,lut=y='if(gte(val,128),255,0)'[mask];[rgb][mask]alphamerge[o]" \
    -map "[o]" -frames:v 1 "$out"
}

# Crop (optional filter), shrink to fit a BOX x BOX square, palette-reduce.
#   card <in> <out> <box> [crop-filter|auto] [colours]
card() {
  local in=$1 out=$2 box=$3 crop=${4:-} n=${5:-32} vf
  [ "$crop" = auto ] && crop="crop=$(bbox "$in")"
  vf="${crop:+$crop,}scale=$box:$box:force_original_aspect_ratio=decrease:flags=area"
  "${FF[@]}" -i "$in" -vf "$vf" "$TMP/card.png"
  pal "$TMP/card.png" "$out" "$n"
}

# A seamless tile: crop a region, shrink to SIZE/2, mirror it into a SIZE square.
#   tile <in> <out> <size> <crop-filter> [colours]
tile() {
  local in=$1 out=$2 size=$3 crop=$4 n=${5:-24} h=$(($3 / 2))
  "${FF[@]}" -i "$in" -filter_complex \
    "[0:v]$crop,scale=$h:$h:flags=area,format=rgb24,split[a][b];[b]hflip[c];[a][c]hstack,split[d][e];[e]vflip[f];[d][f]vstack" \
    "$TMP/tile.png"
  pal "$TMP/tile.png" "$out" "$n"
}

# Pack frames into one sprite sheet plus a JSON of frame rects.
#   sheet <out-base> <tall-side> <frame>...
# Frames of the same size share one crop (their union bounding box) so the
# animation stays registered; mixed sizes are scaled by one common factor.
sheet() {
  local base=$1 tall=$2; shift 2
  local frames=("$@") n=$# f i x0=99999 y0=99999 x1=0 y1=0 same=1 dims first maxw=0 maxh=0
  first=$(ffprobe -v error -show_entries stream=width,height -of csv=p=0 "${frames[0]}")
  for f in "${frames[@]}"; do
    dims=$(ffprobe -v error -show_entries stream=width,height -of csv=p=0 "$f")
    [ "$dims" = "$first" ] || same=0
    maxw=$(( ${dims%,*} > maxw ? ${dims%,*} : maxw )); maxh=$(( ${dims#*,} > maxh ? ${dims#*,} : maxh ))
  done
  local crop=""
  if [ $same = 1 ]; then
    for f in "${frames[@]}"; do
      IFS=: read -r w h x y <<< "$(bbox "$f")"
      (( x < x0 )) && x0=$x; (( y < y0 )) && y0=$y
      (( x + w > x1 )) && x1=$((x + w)); (( y + h > y1 )) && y1=$((y + h))
    done
    crop="crop=$((x1 - x0)):$((y1 - y0)):$x0:$y0,"
    maxw=$((x1 - x0)); maxh=$((y1 - y0))
  fi
  # Cell size: the biggest frame scaled so its taller side is $tall (even numbers).
  local cw ch
  if (( maxh >= maxw )); then ch=$tall; cw=$(( (maxw * tall / maxh + 1) / 2 * 2 ));
  else cw=$tall; ch=$(( (maxh * tall / maxw + 1) / 2 * 2 )); fi
  local cols rows
  cols=$(awk -v n=$n -v w=$cw -v h=$ch 'BEGIN{c=int(sqrt(n*h/w)+0.999); if(c>n)c=n; if(c<1)c=1; print c}')
  rows=$(( (n + cols - 1) / cols ))
  rm -f "$TMP"/sf_*.png
  i=0
  for f in "${frames[@]}"; do
    local vf
    if [ $same = 1 ]; then vf="${crop}scale=$cw:$ch:flags=area"
    else
      # common factor: the largest source frame fills the cell
      vf="scale=iw*$cw/$maxw:ih*$ch/$maxh:flags=area,scale=w=min(iw\,$cw):h=min(ih\,$ch):force_original_aspect_ratio=decrease,pad=$cw:$ch:(ow-iw)/2:(oh-ih)/2:color=0x00000000"
    fi
    "${FF[@]}" -i "$f" -vf "format=rgba,$vf,format=rgba" "$TMP/sf_$(printf %03d $i).png"
    i=$((i + 1))
  done
  while (( i < cols * rows )); do # blank cells so the tile filter gets a full grid
    "${FF[@]}" -f lavfi -i "color=c=0x00000000:s=${cw}x${ch},format=rgba" -frames:v 1 "$TMP/sf_$(printf %03d $i).png"
    i=$((i + 1))
  done
  "${FF[@]}" -framerate 1 -i "$TMP/sf_%03d.png" -vf "format=rgba,tile=${cols}x${rows}" -frames:v 1 "$TMP/sheet.png"
  pal "$TMP/sheet.png" "$base.png" 32
  {
    printf '{\n  "image": "%s.png",\n  "frameW": %d, "frameH": %d, "cols": %d, "rows": %d, "count": %d,\n  "frames": [\n' \
      "$(basename "$base")" "$cw" "$ch" "$cols" "$rows" "$n"
    for ((i = 0; i < n; i++)); do
      printf '    { "x": %d, "y": %d, "w": %d, "h": %d, "src": "%s" }%s\n' \
        $(( i % cols * cw )) $(( i / cols * ch )) "$cw" "$ch" "$(basename "${frames[$i]}")" "$([ $i -lt $((n - 1)) ] && echo ,)"
    done
    printf '  ]\n}\n'
  } > "$base.json"
}

# Average colour of a region of an image or video frame as #rrggbb.
avg() {
  local in=$1 crop=$2 seek=${3:-}
  "${FF[@]}" ${seek:+-ss "$seek"} -i "$in" -frames:v 1 -vf "$crop,scale=1:1:flags=area" -f rawvideo -pix_fmt rgb24 - \
    | od -An -tx1 | tr -d ' \n' | sed 's/^/#/'
}

# N dominant colours of an image or video frame, as a JSON list of "#rrggbb".
dominant() {
  local in=$1 n=$2 seek=${3:-}
  "${FF[@]}" ${seek:+-ss "$seek"} -i "$in" -frames:v 1 -vf "scale=256:-2:flags=area,palettegen=max_colors=$n:reserve_transparent=0:stats_mode=full" -f rawvideo -pix_fmt rgb24 - \
    | od -An -v -tx1 | tr -s ' \n' ' ' | awk '{for(i=1;i+2<=NF;i+=3){c="#"$i$(i+1)$(i+2); if(!(c in s)){s[c]=1; o=o (o?", ":"") "\"" c "\""}} print "[" o "]"}'
}

# --- 1. GoatMan --------------------------------------------------------------------
echo "GoatMan sprite sheets..."
front=() three=() side=()
for i in $(seq 1 18); do
  front+=("$GM/$i.png")
  # Frame 1 has no Nturn files; turn1/turn2.png are its turned versions. 5turn2 is missing.
  if [ $i = 1 ]; then three+=("$GM/turn1.png"); side+=("$GM/turn2.png"); continue; fi
  three+=("$GM/${i}turn1.png")
  if [ -f "$GM/${i}turn2.png" ]; then side+=("$GM/${i}turn2.png"); else side+=("$GM/${i}turn1.png"); fi
done
sheet "$OUT/goatman/walk-front" 128 "${front[@]}";  note "$OUT/goatman/walk-front.png" "Goatman Himself/1-18.png" "18-step walk facing the camera (+ .json frame rects)"
sheet "$OUT/goatman/walk-three" 128 "${three[@]}";  note "$OUT/goatman/walk-three.png" "Goatman Himself/turn1.png, 2-18turn1.png" "walk, three-quarter view"
sheet "$OUT/goatman/walk-side" 128 "${side[@]}";    note "$OUT/goatman/walk-side.png" "Goatman Himself/turn2.png, 2-18turn2.png (5turn1 for 5)" "walk, side profile (the frames game.js uses)"
seqf() { local p=$1 n=$2 i; for ((i = 1; i <= n; i++)); do echo "$GM/$p$i.png"; done; }
mapfile -t kneel < <(seqf down 6);   sheet "$OUT/goatman/kneel" 128 "${kneel[@]}"; note "$OUT/goatman/kneel.png" "Goatman Himself/down1-6.png" "kneeling down"
mapfile -t head < <(seqf head 15);   sheet "$OUT/goatman/head" 128 "${head[@]}";   note "$OUT/goatman/head.png" "Goatman Himself/head1-15.png" "kneeling, head lowers to the ground (drink, pet)"
mapfile -t bh < <(seqf backhead 13); sheet "$OUT/goatman/backhead" 128 "${bh[@]}"; note "$OUT/goatman/backhead.png" "Goatman Himself/backhead1-13.png" "head comes off, blue strands (SQUASHED death)"

echo "GoatMan body crops..."
# Regions picked by eye from 1.png (front) and 9turn2.png (side), as fractions.
part() { card "$GM/$2" "$OUT/goatman/part-$1.png" 256 "$(frac "${@:3:4}")" 32; note "$OUT/goatman/part-$1.png" "Goatman Himself/$2" "$7"; }
part face-front 1.png      0.08 0.02 0.32 0.19  "model texture: face from the front"
part face-side  9turn2.png 0.14 0.08 0.38 0.22  "model texture: face in profile"
part hair       9turn2.png 0.16 0.012 0.46 0.075 "model texture: dark hair"
part chest      1.png      0.30 0.25 0.60 0.45  "model texture: chest with yellow highlights"
part arm        1.png      0.06 0.40 0.14 0.75  "model texture: long red arm"
part hand       1.png      0.05 0.81 0.15 0.93  "model texture: hand"
part leg        1.png      0.82 0.55 0.92 0.85  "model texture: hairy goat-leg pattern"
part hoof       1.png      0.55 0.88 0.72 0.99  "model texture: hoof"

# --- 2. Night forest ----------------------------------------------------------------
echo "Forest..."
BG1="$IMG/Background Section 1.jpg"
card "$BG1" "$OUT/forest/wall.png" 256 "" 32;                   note "$OUT/forest/wall.png" "assets/images/Background Section 1.jpg" "far wall of trees / canopy (whole painting)"
tile "$BG1" "$OUT/forest/weave.png" 128 "$(frac 0.40 0.25 0.70 0.60)"; note "$OUT/forest/weave.png" "Background Section 1.jpg" "seamless blue woven tile"
tile "$BG1" "$OUT/forest/floor.png" 64 "$(frac 0.42 0.76 0.52 0.86)"; note "$OUT/forest/floor.png" "Background Section 1.jpg" "seamless dark red forest-floor tile"
# The yellow marks along the ground (pixel rects in the 1227x1080 painting), cut out of the
# dark weave by colour: only the gold paint is bright in both red and green.
marks=()
i=0
for r in 56:941:82:38 174:958:62:43 245:948:62:36 327:953:77:46 465:938:62:33 624:1012:72:35 782:999:77:48 905:1009:72:41 977:1006:77:52 1109:941:72:38; do
  IFS=: read -r x y w h <<< "$r"
  "${FF[@]}" -i "$BG1" -vf "crop=$w:$h:$x:$y,format=rgba,geq=r='min(255,r(X,Y)*2.4)':g='min(255,g(X,Y)*2.4)':b='min(255,b(X,Y)*2.4)':a='255*gt(r(X,Y),40)*gt(g(X,Y),22)*gt(r(X,Y),2*b(X,Y))'" "$TMP/mark$i.png"
  marks+=("$TMP/mark$i.png"); i=$((i + 1))
done
sheet "$OUT/forest/marks" 32 "${marks[@]}"; note "$OUT/forest/marks.png" "Background Section 1.jpg (10 marks)" "glowing yellow ground marks / eyes"
# fore.png is 5976x4284 and 37 MB: shrink it once, then cut the trunks out of the copy.
"${FF[@]}" -i "$IMG/fore.png" -vf "scale=1494:1071:flags=area" "$TMP/fore.png"
i=1
for f in "0.00 0.18" "0.20 0.36" "0.44 0.56" "0.53 0.66" "0.65 0.80" "0.84 1.00"; do
  read -r a b <<< "$f"
  card "$TMP/fore.png" "$OUT/forest/trunk$i.png" 256 "$(frac "$a" 0 "$b" 1)" 24
  note "$OUT/forest/trunk$i.png" "assets/images/fore.png" "bark trunk card with alpha"
  i=$((i + 1))
done
"${FF[@]}" -i "$TMP/fore.png" -f lavfi -i color=c=black:s=1494x1071 -filter_complex "[1][0]overlay=format=auto" -frames:v 1 "$TMP/fore-flat.png"
tile "$TMP/fore-flat.png" "$OUT/forest/bark.png" 128 "$(frac 0.86 0.15 0.94 0.26)"; note "$OUT/forest/bark.png" "assets/images/fore.png" "seamless bark tile for trunk cylinders"

# --- 3. Red field ----------------------------------------------------------------------
echo "Red field..."
card "$WB/BACKGROUND.png" "$OUT/field/sky.png" 256 "" 24; note "$OUT/field/sky.png" "WALKYBOY/BACKGROUND.png" "pink painted sky for the sky dome"
# The cloud layers repeat the same clouds twice; these are the separate clouds of the left half.
i=1
for r in "0.236 0 0.300 0.034" "0.358 0.004 0.432 0.074" "0.228 0.055 0.359 0.123" "0.294 0.125 0.402 0.202" "0.404 0.127 0.500 0.202" \
         "0.353 0.209 0.484 0.266" "0.006 0.231 0.069 0.276" "0.129 0.239 0.202 0.311" "0.000 0.293 0.129 0.363" "0.064 0.362 0.172 0.437" \
         "0.176 0.367 0.272 0.437" "0.124 0.446 0.252 0.499"; do
  card "$WB/BACKCLOUDS.png" "$OUT/field/cloud-back$i.png" 128 "$(frac $r)" 24
  note "$OUT/field/cloud-back$i.png" "WALKYBOY/BACKCLOUDS.png" "far cloud card"
  i=$((i + 1))
done
i=1
for r in "0.016 0.004 0.124 0.063" "0.241 0.011 0.371 0.144" "0.001 0.106 0.236 0.234" "0.121 0.241 0.316 0.376" "0.328 0.246 0.500 0.379" "0.231 0.399 0.464 0.501"; do
  card "$WB/frontclouds.png" "$OUT/field/cloud-front$i.png" 256 "$(frac $r)" 24
  note "$OUT/field/cloud-front$i.png" "WALKYBOY/frontclouds.png" "near cloud card"
  i=$((i + 1))
done
tile "$WB/GROUND.png" "$OUT/field/grass.png" 128 "$(frac 0.35 0.83 0.55 0.97)"; note "$OUT/field/grass.png" "WALKYBOY/GROUND.png" "seamless red grass tile (with the black sprouts)"
"${FF[@]}" -i "$WB/GROUND.png" -vf "$(frac 0 0.64 1 0.82),scale=512:-2:flags=area" "$TMP/peaks.png"
pal "$TMP/peaks.png" "$OUT/field/peaks.png" 24; note "$OUT/field/peaks.png" "WALKYBOY/GROUND.png" "horizon strip of dark peaks (512 wide)"
"${FF[@]}" -i "$WB/foreground1.png" -vf "crop=$(bbox "$WB/foreground1.png"),scale=512:-2:flags=area" "$TMP/fg.png"
pal "$TMP/fg.png" "$OUT/field/foreground.png" 16; note "$OUT/field/foreground.png" "WALKYBOY/foreground1.png" "red foreground strip (512 wide)"
mapfile -t wboy < <(for i in $(seq 1 11); do echo "$WB/WBOY$i.png"; done)
sheet "$OUT/field/wboy" 256 "${wboy[@]}"; note "$OUT/field/wboy.png" "WALKYBOY/WBOY1-11.png" "the Walking Thing's 11-frame walk (+ .json)"
card "$WB/shadow.png" "$OUT/field/shadow.png" 128 auto 8; note "$OUT/field/shadow.png" "WALKYBOY/shadow.png" "the Walking Thing's shadow"

# --- 4. Savanna ------------------------------------------------------------------------
echo "Savanna..."
card "$SV/nsky.png" "$OUT/savanna/stars.png" 256 "" 16;          note "$OUT/savanna/stars.png" "the savannahg/nsky.png" "starry sky for the dome"
# The painting has no sky layer: the crimson sky comes from the video, right of the tree
# and above the striped creature.
"${FF[@]}" -ss 90 -i "$SV/ground1.mp4" -frames:v 1 "$TMP/frame.png"
card "$TMP/frame.png" "$OUT/savanna/sky.png" 256 "crop=495:340:645:0" 32; note "$OUT/savanna/sky.png" "the savannahg/ground1.mp4 (frame at 90 s)" "crimson sky with dark cloud streaks for the dome"
card "$SV/trreeline.png" "$OUT/savanna/treeline.png" 256 auto 24;  note "$OUT/savanna/treeline.png" "the savannahg/trreeline.png" "dark teal treeline card"
card "$SV/tree.png" "$OUT/savanna/tree.png" 256 auto 32;           note "$OUT/savanna/tree.png" "the savannahg/tree.png" "the teal tree card"
tile "$SV/ground1.png" "$OUT/savanna/grass.png" 128 "$(frac 0.35 0.73 0.55 0.82)"; note "$OUT/savanna/grass.png" "the savannahg/ground1.png" "seamless purple grass tile"
i=1
for r in "0 0.65 0.28 0.84" "0.33 0.65 0.60 0.86" "0.72 0.66 1 0.87" "0 0.88 0.30 1"; do
  card "$SV/grass1.png" "$OUT/savanna/blades$i.png" 128 "$(frac $r)" 16
  note "$OUT/savanna/blades$i.png" "the savannahg/grass1.png" "grass blade card (crossed in clumps)"
  i=$((i + 1))
done
card "$GM/thepool.png" "$OUT/savanna/pool.png" 128 auto 24; note "$OUT/savanna/pool.png" "Goatman Himself/thepool.png" "the small pool near the tree"
sheet "$OUT/savanna/cret" 128 "$SV"/cret{1,2,3,4}.png;                          note "$OUT/savanna/cret.png" "the savannahg/cret1-4.png" "striped creature, side view, 4 frames"
sheet "$OUT/savanna/cretb" 128 "$SV/cretb1.png" "$SV/creb2.png" "$SV/creb3.png" "$SV/cretb4.png"; note "$OUT/savanna/cretb.png" "the savannahg/cretb1, creb2, creb3, cretb4.png" "striped creature, back view, 4 frames"
sheet "$OUT/savanna/cretc" 128 "$SV"/cretc{1,2,3,4}.png;                        note "$OUT/savanna/cretc.png" "the savannahg/cretc1-4.png" "striped creature, front view, 4 frames"

# --- 5. Soundscapes ----------------------------------------------------------------------
echo "Audio..."
dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1" | awk '{printf "%.1f", $1}'; }
# Loudness of the first and last half second, to judge whether a track loops cleanly.
edge() { "${FF[@]/error/info}" -ss "$2" -t 0.5 -i "$1" -af volumedetect -f null - 2>&1 | grep -o 'mean_volume: [-0-9.]*' | cut -d' ' -f2; }
AUDIO_REPORT="$TMP/audio.md"
: > "$AUDIO_REPORT"
# The raw tracks are only cut out to be measured and looped; the game plays the loops
# (the cutscene videos carry their own sound).
extract() {
  local name=$1 src=$2
  "${FF[@]}" -i "$src" -map 0:a:0 -vn -c:a copy "$TMP/$name.m4a"
  local d s e
  d=$(dur "$TMP/$name.m4a"); s=$(edge "$TMP/$name.m4a" 0); e=$(edge "$TMP/$name.m4a" "$(awk -v d="$d" 'BEGIN{print d-0.5}')")
  echo "| $name.m4a | ${d} s | start ${s} dB, end ${e} dB |" >> "$AUDIO_REPORT"
}
# A seamless loop: the last X seconds are crossfaded into the first X, so the end flows into
# the start. An optional filter is applied first (evening out a track's loudness).
loopify() {
  local name=$1 src=$2 why=$3 x=${4:-3} pre=${5:+$5,}
  extract "$name" "$src"
  "${FF[@]}" -i "$TMP/$name.m4a" -i "$TMP/$name.m4a" -filter_complex \
    "[0:a]${pre}atrim=start=$x,asetpts=PTS-STARTPTS[rest];[1:a]${pre}atrim=end=$x,asetpts=PTS-STARTPTS[head];[rest][head]acrossfade=d=$x:c1=tri:c2=tri" \
    -c:a aac -b:a 128k "$OUT/audio/$name-loop.m4a"
  local d; d=$(dur "$OUT/audio/$name-loop.m4a")
  echo "| $name-loop.m4a | ${d} s | ${x} s crossfade, seamless${5:+, loudness evened} |" >> "$AUDIO_REPORT"
  note "$OUT/audio/$name-loop.m4a" "${src#"$ROOT"/}" "$why: seamless loop (${x} s crossfade${5:+, loudness evened}, ${d} s)"
}
loopify field "$IMG/GROUND.mp4" "red field soundscape"
loopify savanna "$IMG/savanaScene.mp4" "savanna soundscape, short (not used; the other choice)"
# The long savanna track is much louder in the middle: evened out (about 5 LU of range
# instead of 16) so it can sit under the game without riding the volume.
loopify savanna-long "$SV/ground1.mp4" "savanna soundscape, long (the one the game plays)" 3 "loudnorm=I=-22:LRA=3:TP=-3,aresample=48000"

# --- 6. Cutscene video ---------------------------------------------------------------------
echo "Video..."
fmv() {
  "${FF[@]}" -i "$1" -vf "scale=640:-2:flags=area" -c:v libx264 -preset slow -crf "$3" -maxrate "$4" -bufsize "$4" \
    -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart "$OUT/video/$2.mp4"
  note "$OUT/video/$2.mp4" "${1#"$ROOT"/}" "$5"
}
# The title video and its intro cutscene were dropped for the start screen (revision pass 1).
fmv "$IMG/Savana scene trigger.mp4" finale 30 450k "finale cutscene (640 px FMV)"

# --- 7. Palettes -------------------------------------------------------------------------------
echo "Palettes..."
mkdir -p "$ROOT/goatman3d/data"
scene() { # name, image/video, seek, sky crop, fog crop, ground crop
  printf '  "%s": {\n    "sky": "%s",\n    "fog": "%s",\n    "ground": "%s",\n    "accents": %s\n  }' \
    "$1" "$(avg "$2" "$4" "$3")" "$(avg "$2" "$5" "$3")" "$(avg "$2" "$6" "$3")" "$(dominant "$2" 8 "$3")"
}
{
  echo "{"
  scene forest "$BG1" "" "$(frac 0 0 1 0.3)" "$(frac 0 0.5 1 0.75)" "$(frac 0 0.85 1 1)"; echo ","
  scene field "$IMG/GROUND.mp4" 8 "$(frac 0 0 1 0.4)" "$(frac 0 0.55 1 0.65)" "$(frac 0 0.8 1 1)"; echo ","
  scene savanna "$IMG/savanaScene.mp4" 8 "$(frac 0 0 1 0.3)" "$(frac 0 0.6 1 0.68)" "$(frac 0.3 0.75 0.7 0.85)"; echo ","
  scene title "$IMG/Goatman Title Screen.mp4" 8 "$(frac 0 0 1 0.2)" "$(frac 0 0.4 1 0.6)" "$(frac 0 0.8 1 1)"; echo ","
  scene finale "$IMG/Savana scene trigger.mp4" 30 "$(frac 0 0 1 0.3)" "$(frac 0 0.6 1 0.68)" "$(frac 0 0.75 1 0.9)"; echo
  echo "}"
} > "$ROOT/goatman3d/data/palettes.json"

# --- 8. MANIFEST.md --------------------------------------------------------------------------------
echo "Manifest..."
{
  echo "# goatman3d/assets"
  echo
  echo "Generated by \`goatman3d/tools/prep-assets.sh\`; do not edit by hand, re-run the script."
  echo "Textures are palette-reduced (no dithering) and drawn with NearestFilter in the game."
  echo "Sprite sheets have a .json beside them with every frame's rect and source file."
  echo
  echo "Total: $(du -sh "$OUT" | cut -f1)"
  echo
  echo "| File | Size | Dimensions | Source | Purpose |"
  echo "| --- | --- | --- | --- | --- |"
  while IFS=$'\t' read -r f src why; do
    size=$(du -k "$OUT/$f" | cut -f1)
    dims=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$OUT/$f" 2>/dev/null || true)
    echo "| \`$f\` | ${size} KB | ${dims:--} | $src | $why |"
  done < "$MANIFEST"
  echo
  echo "## Audio loop check"
  echo
  echo "Mean loudness of the first and last half second of each track (very different levels mean an audible jump when looping)."
  echo
  echo "| File | Length | Edges |"
  echo "| --- | --- | --- |"
  cat "$AUDIO_REPORT"
} > "$OUT/MANIFEST.md"
echo "Done: $(du -sh "$OUT" | cut -f1) in $OUT"
