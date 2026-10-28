#!/bin/bash
# Builds dist/Z-Image Studio.app and dist/Z-Image-Studio.dmg.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="Z-Image Studio"; APP="dist/$NAME.app"; RES="$APP/Contents/Resources"
VERSION="2.0"
rm -rf dist && mkdir -p "$APP/Contents/MacOS" "$RES"

# The native window
swiftc -O -target arm64-apple-macos14.0 app/main.swift -o "$APP/Contents/MacOS/$NAME"

# The engine, the UI, and uv (bundled so nothing needs installing by hand)
mkdir -p "$RES/engine" "$RES/ui"
cp engine/*.py "$RES/engine/"
cp ui/* "$RES/ui/"
cp "$(command -v uv)" "$RES/uv"
[ "$(lipo -archs "$RES/uv")" = "arm64" ] || { echo "uv must be the arm64 build"; exit 1; }

# Icon
TMP=$(mktemp -d); mkdir "$TMP/icon.iconset"
uv run --quiet --with pillow==12.3.0 python app/make_icon.py "$TMP/icon.png"
for s in 16 32 128 256 512; do
  sips -z $s $s "$TMP/icon.png" --out "$TMP/icon.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$TMP/icon.png" --out "$TMP/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$TMP/icon.iconset" -o "$RES/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>$NAME</string>
  <key>CFBundleDisplayName</key><string>$NAME</string>
  <key>CFBundleExecutable</key><string>$NAME</string>
  <key>CFBundleIdentifier</key><string>com.atheeb.zimagestudio</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSArchitecturePriority</key><array><string>arm64</string></array>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>NSHumanReadableCopyright</key><string>Runs image models locally with mflux.</string>
</dict></plist>
PLIST

xattr -cr "$APP"
codesign --force --deep --sign - "$APP"               # ad-hoc; no Developer ID on this Mac
codesign --verify --deep "$APP"

# DMG with a shortcut to Applications
STAGE="$TMP/dmg"; mkdir "$STAGE"; cp -R "$APP" "$STAGE/"; ln -s /Applications "$STAGE/Applications"
cp README.txt "$STAGE/Read me.txt"
hdiutil create -quiet -volname "$NAME" -srcfolder "$STAGE" -ov -format UDZO dist/Z-Image-Studio.dmg
rm -rf "$TMP"
ls -lh dist/Z-Image-Studio.dmg; du -sh "$APP"
