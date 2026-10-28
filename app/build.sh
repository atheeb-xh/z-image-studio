#!/bin/bash
# Builds dist/Z-Image Studio.app and dist/Z-Image-Studio.dmg.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="Z-Image Studio"; APP="dist/$NAME.app"; RES="$APP/Contents/Resources"
VERSION="1.0"
rm -rf dist && mkdir -p dist

osacompile -s -o "$APP" app/main.applescript         # -s: stay open, so Dock + Quit work
cp server.py index.html app/launch.sh "$RES/"
cp "$(command -v uv)" "$RES/uv"                        # bundled so friends need nothing installed
[ "$(lipo -archs "$RES/uv")" = "arm64" ] || { echo "uv must be the arm64 build"; exit 1; }

# Icon
TMP=$(mktemp -d); mkdir "$TMP/icon.iconset"
uv run --quiet --with pillow==12.3.0 python app/make_icon.py "$TMP/icon.png"
for s in 16 32 128 256 512; do
  sips -z $s $s "$TMP/icon.png" --out "$TMP/icon.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$TMP/icon.png" --out "$TMP/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$TMP/icon.iconset" -o "$RES/applet.icns"
rm -f "$RES/Assets.car"                               # otherwise the default script icon wins

P="$APP/Contents/Info.plist"; PB=/usr/libexec/PlistBuddy
$PB -c "Set :CFBundleName $NAME" "$P"
$PB -c "Add :CFBundleDisplayName string $NAME" "$P"
$PB -c "Add :CFBundleIdentifier string com.atheeb.zimagestudio" "$P" 2>/dev/null || $PB -c "Set :CFBundleIdentifier com.atheeb.zimagestudio" "$P"
$PB -c "Add :CFBundleShortVersionString string $VERSION" "$P" 2>/dev/null || $PB -c "Set :CFBundleShortVersionString $VERSION" "$P"
$PB -c "Add :LSMinimumSystemVersion string 13.0" "$P" 2>/dev/null || $PB -c "Set :LSMinimumSystemVersion 13.0" "$P"
$PB -c "Add :LSArchitecturePriority array" -c "Add :LSArchitecturePriority:0 string arm64" "$P"

xattr -cr "$APP"
codesign --force --deep --sign - "$APP"               # ad-hoc; no Developer ID on this Mac
codesign --verify --deep "$APP"

# DMG with a shortcut to Applications
STAGE="$TMP/dmg"; mkdir "$STAGE"; cp -R "$APP" "$STAGE/"; ln -s /Applications "$STAGE/Applications"
cp README.txt "$STAGE/Read me.txt"
hdiutil create -quiet -volname "$NAME" -srcfolder "$STAGE" -ov -format UDZO "dist/Z-Image-Studio.dmg"
rm -rf "$TMP"
ls -lh dist/Z-Image-Studio.dmg; du -sh "$APP"
