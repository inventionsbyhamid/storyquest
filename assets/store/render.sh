#!/usr/bin/env bash
# Render the store assets. Needs rsvg-convert and the Fredoka font (OFL, github.com/google/fonts).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p png
rsvg-convert -w 512 -h 512 emblem.svg -o png/icon-512.png
rsvg-convert -w 114 -h 114 emblem.svg -o png/icon-114.png
rsvg-convert -w 1280 -h 720 firetv-icon.svg -o png/firetv-icon-1280x720.png
rsvg-convert -w 1920 -h 1080 firetv-background.svg -o png/firetv-background-1920x1080.png
for f in png/*.png; do convert "$f" -background '#0b0d1a' -alpha remove -alpha off "$f"; done
ls -la png
