# Maintainer: Joop Kiefte <ikojba@gmail.com>

pkgname=cinny-lapingvino-git
pkgver=r1498.7181f6b
pkgrel=1
pkgdesc="Yet another matrix client (lapingvino fork) — Electron desktop app with system tray"
arch=('x86_64' 'aarch64')
url="https://codeberg.org/lapingvino/cinny"
license=('AGPL-3.0-only')
depends=('electron')
makedepends=('nodejs' 'npm' 'git')
optdepends=(
  'libnotify: desktop notifications'
  'xdg-utils: open links in default browser'
  'libappindicator-gtk3: system tray support on GTK3 desktops'
)
provides=('cinny-desktop')
conflicts=('cinny-desktop' 'cinny-desktop-bin' 'cinny-electron' 'cinny-electron-git')
source=("$pkgname::git+https://codeberg.org/lapingvino/cinny.git#branch=element-call"
        "main.js")
sha256sums=('SKIP'
            'SKIP')

pkgver() {
  cd "$srcdir/$pkgname"
  printf "r%s.%s" "$(git rev-list --count HEAD)" "$(git rev-parse --short HEAD)"
}

prepare() {
  cd "$srcdir/$pkgname"
  # Replace hardcoded 'Cinny Web' device display name with the Electron app name
  grep -rl "'Cinny Web'" src/ | xargs sed -i "s/'Cinny Web'/'Cinny Electron (lapingvino fork)'/g"
  npm ci
}

build() {
  cd "$srcdir/$pkgname"
  NODE_OPTIONS=--max_old_space_size=4096 npm run build
}

package() {
  cd "$srcdir/$pkgname"

  # Install built web app
  install -d "$pkgdir/usr/lib/cinny-lapingvino"
  cp -r dist/. "$pkgdir/usr/lib/cinny-lapingvino/"

  # Install the shared Electron main process (also used by build-appimage.sh)
  install -Dm644 "$srcdir/main.js" \
    "$pkgdir/usr/lib/cinny-lapingvino-electron/main.js"

  # Icons: SVG for the desktop entry, PNG for Electron (tray + window)
  install -Dm644 public/res/svg/cinny.svg \
    "$pkgdir/usr/share/pixmaps/cinny.svg"
  install -Dm644 public/res/svg/cinny.svg \
    "$pkgdir/usr/share/icons/hicolor/scalable/apps/cinny.svg"
  install -Dm644 public/res/android/android-chrome-512x512.png \
    "$pkgdir/usr/share/pixmaps/cinny.png"
  install -Dm644 public/res/android/android-chrome-512x512.png \
    "$pkgdir/usr/share/icons/hicolor/512x512/apps/cinny.png"

  # Desktop entry
  install -Dm644 /dev/stdin \
      "$pkgdir/usr/share/applications/$pkgname.desktop" << 'DESKEOF'
[Desktop Entry]
Name=Cinny
Comment=Yet another Matrix client
Exec=cinny-lapingvino %u
Icon=cinny
Terminal=false
Type=Application
Categories=Network;InstantMessaging;Chat;
MimeType=x-scheme-handler/matrix;
StartupNotify=true
StartupWMClass=cinny-lapingvino
DESKEOF

  # License
  install -Dm644 LICENSE "$pkgdir/usr/share/licenses/$pkgname/LICENSE"

  # Launcher (uses the system Electron binary)
  install -Dm755 /dev/stdin "$pkgdir/usr/bin/cinny-lapingvino" << 'BINEOF'
#!/bin/sh
exec electron /usr/lib/cinny-lapingvino-electron/main.js "$@"
BINEOF
}
