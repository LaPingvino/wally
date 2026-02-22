#!/bin/bash
# build-appimage.sh — Build a Cinny (lapingvino fork) Electron AppImage
#                     and optionally a Windows portable zip.
#
# Usage:
#   ./build-appimage.sh           — Linux AppImage only
#   ./build-appimage.sh --win     — Linux AppImage + Windows portable zip
#                                   (cross-compilation; Wine is NOT required)
#
# The resulting bundles are self-contained — no system Electron or npm packages
# are required at runtime.
#
# Build-time dependencies: git, node, npm

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'echo "==> Cleaning up $WORK_DIR..."; rm -rf "$WORK_DIR"' EXIT

BUILD_WIN=false
[[ "${1:-}" == "--win" ]] && BUILD_WIN=true

# ---------------------------------------------------------------------------
# 1. Clone source
# ---------------------------------------------------------------------------
echo "==> Cloning lapingvino/cinny (element-call branch)..."
git clone --depth=1 -b element-call \
  https://codeberg.org/lapingvino/cinny.git "$WORK_DIR/cinny"

# ---------------------------------------------------------------------------
# 2. Patch device display name
# ---------------------------------------------------------------------------
echo "==> Patching device name..."
grep -rl "'Cinny Web'" "$WORK_DIR/cinny/src/" | \
  xargs sed -i "s/'Cinny Web'/'Cinny Electron (lapingvino fork)'/g"

# ---------------------------------------------------------------------------
# 3. Build web app
# ---------------------------------------------------------------------------
echo "==> Installing cinny npm dependencies..."
(cd "$WORK_DIR/cinny" && npm ci)

echo "==> Building cinny web app..."
(cd "$WORK_DIR/cinny" && NODE_OPTIONS=--max_old_space_size=4096 npm run build)

# ---------------------------------------------------------------------------
# 4. Set up electron-builder project
# ---------------------------------------------------------------------------
echo "==> Preparing Electron wrapper..."
mkdir -p "$WORK_DIR/electron"

# Bundle the built web app under 'www/' so main.js can find it via app.isPackaged
cp -r "$WORK_DIR/cinny/dist" "$WORK_DIR/electron/www"

# Shared main.js from this repository (handles both installed and packaged paths)
cp "$SCRIPT_DIR/main.js" "$WORK_DIR/electron/main.js"

# App icon (512 px PNG — electron-builder scales it for each target)
cp "$WORK_DIR/cinny/public/res/android/android-chrome-512x512.png" \
   "$WORK_DIR/electron/icon.png"

# Read version from cinny's own package.json
VERSION="$(node -p "require('$WORK_DIR/cinny/package.json').version")"

cat > "$WORK_DIR/electron/package.json" << EOF
{
  "name": "cinny-lapingvino",
  "version": "$VERSION",
  "description": "Yet another matrix client (lapingvino fork)",
  "main": "main.js",
  "author": "Joop Kiefte <ikojba@gmail.com>",
  "license": "AGPL-3.0-only",
  "devDependencies": {
    "electron": "^34.0.0",
    "electron-builder": "^25.0.0"
  },
  "build": {
    "appId": "org.lapingvino.cinny",
    "productName": "Cinny",
    "files": [
      "main.js",
      "www/**/*",
      "icon.png"
    ],
    "linux": {
      "target": ["AppImage"],
      "category": "Network",
      "icon": "icon.png",
      "mimeTypes": ["x-scheme-handler/matrix"],
      "desktop": {
        "Name": "Cinny",
        "Comment": "Yet another Matrix client",
        "StartupWMClass": "cinny-lapingvino"
      }
    },
    "win": {
      "target": [{ "target": "portable", "arch": ["x64"] }],
      "icon": "icon.png"
    },
    "portable": {
      "artifactName": "Cinny-\${version}-portable.exe"
    }
  }
}
EOF

# ---------------------------------------------------------------------------
# 5. Install electron-builder and build
# ---------------------------------------------------------------------------
echo "==> Installing electron-builder..."
(cd "$WORK_DIR/electron" && npm install)

echo "==> Building AppImage..."
(cd "$WORK_DIR/electron" && npx electron-builder --linux AppImage)

# Copy AppImage immediately so it is preserved even if the Windows build fails
find "$WORK_DIR/electron/dist" -maxdepth 1 -name "*.AppImage" | while read -r artifact; do
  dest="$SCRIPT_DIR/$(basename "$artifact")"
  cp "$artifact" "$dest"
  chmod +x "$dest"
  echo "==> Saved: $dest"
done

if [[ "$BUILD_WIN" == "true" ]]; then
  echo "==> Building Windows portable (code-signing disabled for cross-compile)..."
  # CSC_IDENTITY_AUTO_DISCOVERY=false suppresses Wine-based code-signing on Linux.
  # The resulting portable .exe is unsigned but fully functional.
  (cd "$WORK_DIR/electron" && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win portable)

  find "$WORK_DIR/electron/dist" -maxdepth 1 -name "*.exe" | while read -r artifact; do
    dest="$SCRIPT_DIR/$(basename "$artifact")"
    cp "$artifact" "$dest"
    chmod +x "$dest"
    echo "==> Saved: $dest"
  done
fi
