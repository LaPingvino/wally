#!/bin/bash
# build-appimage.sh — Build a Cinny-fork Electron AppImage,
#                     and optionally a Windows portable .exe.
#
# Usage:
#   ./build-appimage.sh [--upstream NAME] [--win|--all]
#   ./build-appimage.sh --repo URL[#BRANCH] [--upstream NAME] [...]
#   ./build-appimage.sh --local PATH       [--upstream NAME] [...]
#
# Source selection (highest priority first):
#   --local PATH   Use a pre-existing source tree at PATH. No clone is
#                  performed and the device-name patch is skipped (the
#                  tree is assumed to already be in the state you want).
#                  PATH must contain package.json. If dist/ already exists
#                  the build step is skipped too.
#   --repo URL     Clone URL instead of the upstream's default repo.
#                  Optional '#BRANCH' suffix overrides the branch.
#                  Branding still follows --upstream.
#   --upstream     Selects branding (productName, appId, tray tooltip,
#                  device display name) AND, unless overridden, the source
#                  repo. One of:
#                    cinny  — github.com/cinnyapp/cinny       (dev)
#                    wally  — codeberg.org/lapingvino/cinny   (main)
#                    sable  — github.com/SableClient/Sable    (dev)
#                  Default: wally.
#   --name SHORT   Override the short name. Drives app.setName(), the
#                  userData/partition directory, the electron-builder
#                  package "name", and StartupWMClass. Use this to keep a
#                  custom build's session data isolated from the official
#                  build of the same upstream. Default: per-upstream value
#                  (cinny, cinny-lapingvino, sable).
#
# Output flags:
#   --win | --all  Also build a Windows portable .exe (cross-compiled;
#                  Wine NOT required; signing disabled).
#
# Build-time deps: git, node, npm.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# Upstream catalogue.
# Format: repo|branch|productName|appId|shortName|deviceDisplayName
#   shortName drives app.setName(), the session partition, and the userData
#   directory. Keep it stable across releases of the same upstream so users
#   don't lose login data.
# ---------------------------------------------------------------------------
declare -A UPSTREAMS=(
  [cinny]="https://github.com/cinnyapp/cinny.git|dev|Cinny|in.cinny.app|cinny|Cinny Desktop"
  [wally]="https://codeberg.org/lapingvino/cinny.git|main|Wally|org.lapingvino.wally|cinny-lapingvino|Wally Desktop"
  [sable]="https://github.com/SableClient/Sable.git|dev|Sable|moe.sable.app|sable|Sable Desktop"
)

UPSTREAM=wally
REPO_OVERRIDE=
LOCAL_SRC=
NAME_OVERRIDE=
BUILD_WIN=false

usage() {
  awk 'NR>1 && /^[^#]/ {exit} NR>1 {sub(/^# ?/, ""); print}' "${BASH_SOURCE[0]}"
  exit "${1:-0}"
}

while (( $# )); do
  case "$1" in
    --upstream)   UPSTREAM="${2:?missing value for --upstream}"; shift 2 ;;
    --upstream=*) UPSTREAM="${1#*=}"; shift ;;
    --repo)       REPO_OVERRIDE="${2:?missing value for --repo}"; shift 2 ;;
    --repo=*)     REPO_OVERRIDE="${1#*=}"; shift ;;
    --local)      LOCAL_SRC="${2:?missing value for --local}"; shift 2 ;;
    --local=*)    LOCAL_SRC="${1#*=}"; shift ;;
    --name)       NAME_OVERRIDE="${2:?missing value for --name}"; shift 2 ;;
    --name=*)     NAME_OVERRIDE="${1#*=}"; shift ;;
    --win|--all)  BUILD_WIN=true; shift ;;
    -h|--help)    usage 0 ;;
    *)            echo "ERROR: unknown argument: $1" >&2; usage 2 ;;
  esac
done

if [[ ! -v UPSTREAMS[$UPSTREAM] ]]; then
  echo "ERROR: unknown upstream '$UPSTREAM'. Known: ${!UPSTREAMS[*]}" >&2
  exit 2
fi

IFS='|' read -r U_REPO U_BRANCH U_PRODUCT U_APPID U_SHORT U_DEVICE <<< "${UPSTREAMS[$UPSTREAM]}"

if [[ -n "$NAME_OVERRIDE" ]]; then
  # Sanity-check: short name has to be a valid filesystem / WMClass token.
  if [[ ! "$NAME_OVERRIDE" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "ERROR: --name '$NAME_OVERRIDE' contains invalid characters (allowed: A-Z a-z 0-9 . _ -)" >&2
    exit 2
  fi
  U_SHORT="$NAME_OVERRIDE"
fi
echo "==> Upstream: $UPSTREAM ($U_PRODUCT, short name: $U_SHORT)"

WORK_DIR="$(mktemp -d)"
trap 'echo "==> Cleaning up $WORK_DIR..."; rm -rf "$WORK_DIR"' EXIT

# ---------------------------------------------------------------------------
# 1. Source: --local > --repo > upstream defaults
# ---------------------------------------------------------------------------
if [[ -n "$LOCAL_SRC" ]]; then
  [[ -f "$LOCAL_SRC/package.json" ]] || {
    echo "ERROR: --local path has no package.json: $LOCAL_SRC" >&2
    exit 1
  }
  CINNY_SRC="$(cd "$LOCAL_SRC" && pwd)"
  echo "==> Using local source tree at $CINNY_SRC"
  PATCH_DEVICE_NAME=false
  NEED_NPM_INSTALL=false
  [[ -d "$CINNY_SRC/node_modules" ]] || NEED_NPM_INSTALL=true
else
  if [[ -n "$REPO_OVERRIDE" && "$REPO_OVERRIDE" == *"#"* ]]; then
    CLONE_URL="${REPO_OVERRIDE%%#*}"
    CLONE_BRANCH="${REPO_OVERRIDE#*#}"
  elif [[ -n "$REPO_OVERRIDE" ]]; then
    CLONE_URL="$REPO_OVERRIDE"
    CLONE_BRANCH="$U_BRANCH"
  else
    CLONE_URL="$U_REPO"
    CLONE_BRANCH="$U_BRANCH"
  fi
  echo "==> Cloning $CLONE_URL (branch: $CLONE_BRANCH)..."
  git clone --depth=1 -b "$CLONE_BRANCH" "$CLONE_URL" "$WORK_DIR/src"
  CINNY_SRC="$WORK_DIR/src"
  PATCH_DEVICE_NAME=true
  NEED_NPM_INSTALL=true
fi

# ---------------------------------------------------------------------------
# 2. Patch device display name
# Forks may have already replaced the literal — in that case grep finds
# nothing and we skip the patch silently.
# ---------------------------------------------------------------------------
if [[ "$PATCH_DEVICE_NAME" == "true" ]]; then
  echo "==> Patching device name → '$U_DEVICE'..."
  matches=$(grep -rl "'Cinny Web'" "$CINNY_SRC/src/" 2>/dev/null || true)
  if [[ -n "$matches" ]]; then
    echo "$matches" | xargs sed -i "s/'Cinny Web'/'$U_DEVICE'/g"
  else
    echo "   No 'Cinny Web' literal found; skipping device-name patch."
  fi
fi

# ---------------------------------------------------------------------------
# 3. Build the web app (skip if --local already has dist/)
# ---------------------------------------------------------------------------
if [[ "$NEED_NPM_INSTALL" == "true" ]]; then
  echo "==> Installing npm dependencies..."
  (cd "$CINNY_SRC" && npm ci)
fi

if [[ ! -d "$CINNY_SRC/dist" ]]; then
  echo "==> Building web app..."
  (cd "$CINNY_SRC" && NODE_OPTIONS=--max_old_space_size=4096 npm run build)
else
  echo "==> Reusing existing dist/ from $CINNY_SRC"
fi

# ---------------------------------------------------------------------------
# 4. Set up the Electron wrapper
# ---------------------------------------------------------------------------
echo "==> Preparing Electron wrapper..."
mkdir -p "$WORK_DIR/electron"

cp -r "$CINNY_SRC/dist" "$WORK_DIR/electron/www"

# Copy main.js and substitute upstream-specific values into the placeholders.
sed \
  -e "s/__SHORT_NAME__/$U_SHORT/g" \
  -e "s/__APP_TOOLTIP__/$U_PRODUCT/g" \
  "$SCRIPT_DIR/main.js" > "$WORK_DIR/electron/main.js"

# App icon (512 px PNG — electron-builder scales it for each target).
# Path differs between forks: Cinny/Wally ship the android chrome icon,
# Sable keeps a logo PNG under public/res/logo/.
ICON_CANDIDATES=(
  "public/res/android/android-chrome-512x512.png"
  "public/res/logo/cinny-logo-512x512.png"
)
ICON_SRC=
for cand in "${ICON_CANDIDATES[@]}"; do
  if [[ -f "$CINNY_SRC/$cand" ]]; then
    ICON_SRC="$CINNY_SRC/$cand"
    break
  fi
done
if [[ -z "$ICON_SRC" ]]; then
  echo "ERROR: no 512px icon found in $CINNY_SRC; tried: ${ICON_CANDIDATES[*]}" >&2
  exit 1
fi
cp "$ICON_SRC" "$WORK_DIR/electron/icon.png"

VERSION="$(node -p "require('$CINNY_SRC/package.json').version")"

cat > "$WORK_DIR/electron/package.json" << EOF
{
  "name": "$U_SHORT",
  "version": "$VERSION",
  "description": "$U_PRODUCT — Electron desktop build",
  "main": "main.js",
  "license": "AGPL-3.0-only",
  "devDependencies": {
    "electron": "^34.0.0",
    "electron-builder": "^25.0.0"
  },
  "build": {
    "appId": "$U_APPID",
    "productName": "$U_PRODUCT",
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
        "Name": "$U_PRODUCT",
        "Comment": "$U_PRODUCT (Matrix client)",
        "StartupWMClass": "$U_SHORT"
      }
    },
    "win": {
      "target": [{ "target": "portable", "arch": ["x64"] }],
      "icon": "icon.png"
    },
    "portable": {
      "artifactName": "$U_PRODUCT-\${version}-portable.exe"
    }
  }
}
EOF

# ---------------------------------------------------------------------------
# 5. Build the Electron artifacts
# ---------------------------------------------------------------------------
echo "==> Installing electron-builder..."
(cd "$WORK_DIR/electron" && npm install)

echo "==> Building AppImage..."
(cd "$WORK_DIR/electron" && npx electron-builder --linux AppImage)

# Save AppImage immediately so it survives a later Windows-build failure.
find "$WORK_DIR/electron/dist" -maxdepth 1 -name "*.AppImage" | while read -r artifact; do
  dest="$SCRIPT_DIR/$(basename "$artifact")"
  cp "$artifact" "$dest"
  chmod +x "$dest"
  echo "==> Saved: $dest"
done

if [[ "$BUILD_WIN" == "true" ]]; then
  echo "==> Building Windows portable (cross-compile, code-signing disabled)..."
  # CSC_IDENTITY_AUTO_DISCOVERY=false suppresses Wine-based signing on Linux.
  # The resulting .exe is unsigned but fully functional.
  (cd "$WORK_DIR/electron" && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win portable)

  find "$WORK_DIR/electron/dist" -maxdepth 1 -name "*.exe" | while read -r artifact; do
    dest="$SCRIPT_DIR/$(basename "$artifact")"
    cp "$artifact" "$dest"
    chmod +x "$dest"
    echo "==> Saved: $dest"
  done
fi
