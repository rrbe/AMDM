#!/usr/bin/env bash
# Regenerate all icon assets from icon.svg (full) + icon-small.svg (small).
set -euo pipefail
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BUILD=".."

render() { # render <svg> <size> <out.png>
  local svg="$1" size="$2" out="$3"
  cat > _wrap.html <<HTML
<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0}img{display:block;width:${size}px;height:${size}px}</style><img src="${svg}">
HTML
  "$CHROME" --headless=new --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size=${size},${size} \
    --screenshot="$out" "file://$PWD/_wrap.html" >/dev/null 2>&1
}

echo "› rendering masters"
render icon.svg       1024 full-1024.png
render icon-small.svg 1024 small-1024.png

down() { sips -Z "$2" "$1" --out "$3" >/dev/null 2>&1; }   # high-quality raster downscale

echo "› slicing sizes (small→16/32/48, full→64+)"
down small-1024.png 16  px-16.png
down small-1024.png 32  px-32.png
down small-1024.png 48  px-48.png
down full-1024.png  64  px-64.png
down full-1024.png  128 px-128.png
down full-1024.png  256 px-256.png
down full-1024.png  512 px-512.png
cp  full-1024.png       px-1024.png

echo "› building icon.icns"
rm -rf icon.iconset && mkdir icon.iconset
cp px-16.png   icon.iconset/icon_16x16.png
cp px-32.png   icon.iconset/icon_16x16@2x.png
cp px-32.png   icon.iconset/icon_32x32.png
cp px-64.png   icon.iconset/icon_32x32@2x.png
cp px-128.png  icon.iconset/icon_128x128.png
cp px-256.png  icon.iconset/icon_128x128@2x.png
cp px-256.png  icon.iconset/icon_256x256.png
cp px-512.png  icon.iconset/icon_256x256@2x.png
cp px-512.png  icon.iconset/icon_512x512.png
cp px-1024.png icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset -o "$BUILD/icon.icns"

echo "› building icon.ico"
node mkico.js "$BUILD/icon.ico" px-16.png px-32.png px-48.png px-64.png px-128.png px-256.png

echo "› placing png masters (Linux + electron-builder base)"
cp px-1024.png "$BUILD/icon.png"
cp px-512.png  "$BUILD/icon-512.png"

echo "› cleaning intermediates"
rm -rf icon.iconset _wrap.html full-1024.png small-1024.png px-*.png

echo "› done"
ls -la "$BUILD"/icon.icns "$BUILD"/icon.ico "$BUILD"/icon.png "$BUILD"/icon-512.png
