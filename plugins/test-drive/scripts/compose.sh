#!/usr/bin/env bash
# Compose the before/after recordings into one labeled MP4 (labels are already burned in
# by record.mjs, so no ffmpeg text filters are needed).
#
#   compose.sh <before.webm|-> <after.webm|-> <out.mp4> [side-by-side|sequential]
#
# Pass "-" for a side that has no recording, and only the other side is encoded.
set -euo pipefail

before=${1:?usage: compose.sh <before.webm|-> <after.webm|-> <out.mp4> [side-by-side|sequential]}
after=${2:?usage: compose.sh <before.webm|-> <after.webm|-> <out.mp4> [side-by-side|sequential]}
out=${3:?usage: compose.sh <before.webm|-> <after.webm|-> <out.mp4> [side-by-side|sequential]}
mode=${4:-side-by-side}

command -v ffmpeg >/dev/null 2>&1 || { echo "error: ffmpeg not found (brew install ffmpeg)" >&2; exit 2; }
command -v ffprobe >/dev/null 2>&1 || { echo "error: ffprobe not found" >&2; exit 2; }

# Duration in seconds. Playwright webm files sometimes report N/A, so fall back to decoding.
dur() {
  local d
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$1" 2>/dev/null || true)
  if [[ -z "$d" || "$d" == "N/A" ]]; then
    d=$(ffmpeg -i "$1" -f null - 2>&1 | grep -o 'time=[0-9:.]*' | tail -1 | cut -d= -f2 \
        | awk -F: '{print $1*3600 + $2*60 + $3}')
  fi
  printf '%s' "${d:-0}"
}

norm() { # <w> <h> : fit into w x h, letterboxed, constant frame rate
  printf 'fps=25,scale=%s:%s:force_original_aspect_ratio=decrease,pad=%s:%s:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1' "$1" "$2" "$1" "$2"
}

encode=(-an -c:v libx264 -pix_fmt yuv420p -movflags +faststart)

if [[ "$before" == "-" && "$after" == "-" ]]; then
  echo "error: nothing to compose" >&2; exit 2
elif [[ "$before" == "-" || "$after" == "-" ]]; then
  src=$before; [[ "$before" == "-" ]] && src=$after
  ffmpeg -y -loglevel error -i "$src" -vf "$(norm 1280 720)" "${encode[@]}" "$out"
elif [[ "$mode" == "sequential" ]]; then
  ffmpeg -y -loglevel error -i "$before" -i "$after" \
    -filter_complex "[0:v]$(norm 1280 720)[a];[1:v]$(norm 1280 720)[b];[a][b]concat=n=2:v=1:a=0[v]" \
    -map "[v]" "${encode[@]}" "$out"
else
  db=$(dur "$before"); da=$(dur "$after")
  # Hold the last frame of the shorter side so hstack runs for the full length of the longer one.
  pad_b=$(awk -v a="$da" -v b="$db" 'BEGIN { d = a - b; print (d > 0 ? d : 0) }')
  pad_a=$(awk -v a="$da" -v b="$db" 'BEGIN { d = b - a; print (d > 0 ? d : 0) }')
  ffmpeg -y -loglevel error -i "$before" -i "$after" \
    -filter_complex "[0:v]$(norm 960 540),tpad=stop_mode=clone:stop_duration=${pad_b}[l];[1:v]$(norm 960 540),tpad=stop_mode=clone:stop_duration=${pad_a}[r];[l][r]hstack=inputs=2[v]" \
    -map "[v]" "${encode[@]}" "$out"
fi

echo "$out"
