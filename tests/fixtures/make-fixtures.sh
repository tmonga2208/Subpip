#!/bin/sh
# Regenerates tests/fixtures/test.mp4 (2 minutes, 320x180, tone audio, ~1 MB)
set -e
cd "$(dirname "$0")"
ffmpeg -y -loglevel error \
  -f lavfi -i testsrc=duration=120:size=320x180:rate=15 \
  -f lavfi -i sine=frequency=440:duration=120 \
  -c:v libx264 -crf 35 -preset veryslow -pix_fmt yuv420p \
  -c:a aac -b:a 32k -shortest test.mp4
