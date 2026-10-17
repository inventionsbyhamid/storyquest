#!/usr/bin/env bash
# Render brand and store PNGs. Needs rsvg-convert, ImageMagick and Fraunces.ttf installed as a system font.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p png
rsvg-convert -w 512 -h 512 icon-square.svg -o png/icon-512.png
rsvg-convert -w 114 -h 114 icon-square.svg -o png/icon-114.png
rsvg-convert -w 1280 -h 720 firetv-icon.svg -o png/firetv-icon-1280x720.png
rsvg-convert -w 1920 -h 1080 firetv-background.svg -o png/firetv-background-1920x1080.png
rsvg-convert -w 760 -h 140 -b '#1C2240' lockup.svg -o png/lockup.png
for f in png/*.png; do convert "$f" -background '#1C2240' -alpha remove -alpha off "$f"; done
ls png
