#!/bin/bash
# push-to-codeberg.sh — Sync PKGBUILD changes to Codeberg branches
#
# Usage: ./push-to-codeberg.sh [--no-build]
#
# Branches:
#   element-call  — full source tree, local replacement files as commits
#   pkgbuild      — PKGBUILD + patches + local files (flat)
#
# Run from the PKGBUILD directory after making changes.

set -euo pipefail

PKGBUILD_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$PKGBUILD_DIR/src/cinny-web"
CODEBERG_REMOTE="git@codeberg.org:lapingvino/cinny.git"

# Mapping: flat filename -> path inside the cinny repo
declare -A FILE_PATHS=(
  ["CallProvider.tsx"]="src/app/pages/client/call/CallProvider.tsx"
  ["CallView.tsx"]="src/app/features/call/CallView.tsx"
  ["useCallMemberships.ts"]="src/app/hooks/useCallMemberships.ts"
  ["Room.tsx"]="src/app/features/room/Room.tsx"
  ["RoomViewHeader.tsx"]="src/app/features/room/RoomViewHeader.tsx"
  ["RoomView.tsx"]="src/app/features/room/RoomView.tsx"
  ["IncomingCallNotification.tsx"]="src/app/features/call/IncomingCallNotification.tsx"
  ["RoomNavItem.tsx"]="src/app/features/room-nav/RoomNavItem.tsx"
  ["SmallWidgetDriver.ts"]="src/app/features/call/SmallWidgetDriver.ts"
  ["RoomCallNavStatus.tsx"]="src/app/features/room-nav/RoomCallNavStatus.tsx"
)

# Patches in order (applied on top of each other on element-call branch)
PATCHES=("01-emoji-font.patch" "02-element-call.patch" "03-pronouns.patch")

# --- Optionally build first ---
if [[ "${1:-}" != "--no-build" ]]; then
  echo "==> Building to verify (run with --no-build to skip)..."
  makepkg -Csf 2>&1 | grep -E "^==>|ERROR|Finished making" || true
fi

# --- Ensure src/cinny-web is available ---
if [[ ! -d "$SRC_DIR/.git" ]]; then
  echo "ERROR: $SRC_DIR/.git not found. Run 'makepkg -o' (without -C) first, or run without --no-build."
  exit 1
fi

# Abort any in-progress git operations
git -C "$SRC_DIR" cherry-pick --abort 2>/dev/null || true
git -C "$SRC_DIR" am --abort 2>/dev/null || true
git -C "$SRC_DIR" merge --abort 2>/dev/null || true

# Ensure codeberg remote exists
git -C "$SRC_DIR" remote add codeberg "$CODEBERG_REMOTE" 2>/dev/null || true
echo "==> Fetching from Codeberg..."
git -C "$SRC_DIR" fetch codeberg element-call pkgbuild 2>&1

# -------------------------------------------------------------------------
# Update element-call branch: local replacement files as individual commits
# -------------------------------------------------------------------------
echo ""
echo "==> Checking out codeberg/element-call..."
git -C "$SRC_DIR" checkout -- . 2>/dev/null || true
git -C "$SRC_DIR" clean -fd 2>/dev/null | grep -c "^" | xargs -I{} echo "   Cleaned {} items" || true
git -C "$SRC_DIR" checkout -B codeberg-element-call codeberg/element-call

ELEMENT_CALL_CHANGED=0

for flat_name in "${!FILE_PATHS[@]}"; do
  repo_path="${FILE_PATHS[$flat_name]}"
  src_file="$PKGBUILD_DIR/$flat_name"

  if [[ ! -f "$src_file" ]]; then
    echo "   WARNING: $src_file not found, skipping"
    continue
  fi

  if ! diff -q "$src_file" "$SRC_DIR/$repo_path" >/dev/null 2>&1; then
    echo "   Changed: $flat_name"
    cp "$src_file" "$SRC_DIR/$repo_path"
    git -C "$SRC_DIR" add "$repo_path"
    git -C "$SRC_DIR" commit -m "chore: update $flat_name" \
      --author="Joop Kiefte <ikojba@gmail.com>"
    ELEMENT_CALL_CHANGED=1
  fi
done

if [[ $ELEMENT_CALL_CHANGED -eq 1 ]]; then
  echo "==> Pushing element-call branch to Codeberg..."
  git -C "$SRC_DIR" push codeberg codeberg-element-call:element-call
else
  echo "   No local file changes for element-call branch."
fi

# -------------------------------------------------------------------------
# Update pkgbuild branch: PKGBUILD + patches + local files (flat)
# -------------------------------------------------------------------------
echo ""
echo "==> Checking out codeberg/pkgbuild..."
git -C "$SRC_DIR" checkout -- . 2>/dev/null || true
git -C "$SRC_DIR" clean -fd 2>/dev/null | grep -c "^" | xargs -I{} echo "   Cleaned {} items" || true
git -C "$SRC_DIR" checkout -B codeberg-pkgbuild codeberg/pkgbuild

PKGBUILD_STAGED=()
CHANGED_DESCRIPTION=()

# PKGBUILD itself
if ! diff -q "$PKGBUILD_DIR/PKGBUILD" "$SRC_DIR/PKGBUILD" >/dev/null 2>&1; then
  cp "$PKGBUILD_DIR/PKGBUILD" "$SRC_DIR/PKGBUILD"
  git -C "$SRC_DIR" add PKGBUILD
  PKGBUILD_STAGED+=("PKGBUILD")
  CHANGED_DESCRIPTION+=("PKGBUILD")
fi

# Patch files
for patch in "${PATCHES[@]}"; do
  if [[ ! -f "$PKGBUILD_DIR/$patch" ]]; then
    echo "   WARNING: $patch not found, skipping"
    continue
  fi
  if [[ ! -f "$SRC_DIR/$patch" ]] || ! diff -q "$PKGBUILD_DIR/$patch" "$SRC_DIR/$patch" >/dev/null 2>&1; then
    cp "$PKGBUILD_DIR/$patch" "$SRC_DIR/$patch"
    git -C "$SRC_DIR" add "$patch"
    PKGBUILD_STAGED+=("$patch")
    CHANGED_DESCRIPTION+=("$patch")
  fi
done

# Local replacement files (flat copies)
for flat_name in "${!FILE_PATHS[@]}"; do
  src_file="$PKGBUILD_DIR/$flat_name"
  if [[ ! -f "$src_file" ]]; then
    continue
  fi
  if [[ ! -f "$SRC_DIR/$flat_name" ]] || ! diff -q "$src_file" "$SRC_DIR/$flat_name" >/dev/null 2>&1; then
    cp "$src_file" "$SRC_DIR/$flat_name"
    git -C "$SRC_DIR" add "$flat_name"
    PKGBUILD_STAGED+=("$flat_name")
    CHANGED_DESCRIPTION+=("$flat_name")
  fi
done

if [[ ${#PKGBUILD_STAGED[@]} -gt 0 ]]; then
  echo "   Changed: ${CHANGED_DESCRIPTION[*]}"
  git -C "$SRC_DIR" commit -m "chore: update ${CHANGED_DESCRIPTION[*]}" \
    --author="Joop Kiefte <ikojba@gmail.com>"
  echo "==> Pushing pkgbuild branch to Codeberg..."
  git -C "$SRC_DIR" push codeberg codeberg-pkgbuild:pkgbuild
else
  echo "   No pkgbuild changes to push."
fi

echo ""
echo "==> Done! Codeberg is up to date."
