#!/bin/bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "=== Packaging Luma iOS Bundle into IPA ==="

BUILD_DIR="$DIR/build_temp"
PAYLOAD_DIR="$BUILD_DIR/Payload"
APP_DIR="$PAYLOAD_DIR/Luma.app"

rm -rf "$BUILD_DIR"
mkdir -p "$APP_DIR"

# Copy App Info and Entitlements
cp "$DIR/Luma/Info.plist" "$APP_DIR/Info.plist"
cp "$DIR/Luma/Luma.entitlements" "$APP_DIR/Luma.entitlements"

# Create PkgInfo
printf "APPL????" > "$APP_DIR/PkgInfo"

# Package into IPA
cd "$BUILD_DIR"
zip -qr "$DIR/Luma.ipa" Payload

# Cleanup
rm -rf "$BUILD_DIR"

echo "=== Successfully created $DIR/Luma.ipa ==="
ls -lh "$DIR/Luma.ipa"
