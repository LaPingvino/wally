# cinny-web-git — Arch Linux PKGBUILD

Arch Linux packaging for [Cinny](https://cinny.in) with applied patch sets:

| Patch | Description |
|-------|-------------|
| `01-emoji-font.patch` | Bahá'í emoji font support via [noto-emoji-bahai](https://github.com/LaPingvino/noto-emoji-bahai) |
| `02-element-call.patch` | Element Call (WebRTC group calls) integration |
| `03-pronouns.patch` | Pronouns, timezone, extended profile fields (PR #2487) |

The patches are applied on top of [upstream cinny dev](https://github.com/cinnyapp/cinny).
The full modified source is on the [`element-call`](https://codeberg.org/lapingvino/cinny/src/branch/element-call) branch.

## Usage

```bash
git clone https://codeberg.org/lapingvino/cinny pkgbuild --branch pkgbuild
cd pkgbuild
makepkg -si
```

## Applying individual patches

Skip `01-emoji-font.patch` if you do not need the Bahá'í emoji font:

```bash
# Remove the font patch from PKGBUILD source/sha256sums arrays and
# remove the patch -p1 -i "$srcdir/01-emoji-font.patch" line from prepare()
```

## Maintaining this repo

After making changes to the PKGBUILD, local replacement files, or patches:

```bash
./push-to-codeberg.sh          # builds first, then pushes
./push-to-codeberg.sh --no-build  # skip the build step
```

The script updates both `element-call` (source) and `pkgbuild` (packaging) branches.
