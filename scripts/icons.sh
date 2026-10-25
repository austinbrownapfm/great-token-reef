#!/bin/sh
set -e
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/packages/web/public"
mkdir -p "$out"
sips -z 64 64 "$root/icon.png" --out "$out/favicon.png"
sips -z 180 180 "$root/icon.png" --out "$out/apple-touch-icon.png"
sips -z 256 256 "$root/icon.png" --out "$out/icon.png"
