# Maintainer: Andy Bao <contact@andybao.me>
# Fork maintainer: Joop Kiefte <ikojba@gmail.com>
_pkgname=cinny-web
# Renamed cinny-web-git -> wally-web-git (5.0.0). Install path moved
# /usr/share/webapps/cinny -> /wally. wally-web-git.install does a one-time,
# idempotent migration of any /etc/caddy/Caddyfile still pointing at the old path
# (+ the admin config.json) and reloads caddy. Because the new path differs from
# the old one, wally-web-git owns different files than cinny-web-git, so there is
# no file conflict: pacman -U installs it cleanly alongside the old package (which
# can then be removed — wally-web-git provides cinny-web-git). _pkgname stays
# cinny-web only as the upstream source-clone subdir name (no install-path role).
pkgname="wally-web-git"
pkgver=r2023.d6d47e0e
pkgrel=1
pkgdesc="Yet another matrix client — web version (with Element Call, accessibility, issue tracker, and other patches)"
arch=('any')
url="https://github.com/LaPingvino/wally"
license=('AGPL3')
makedepends=('git' 'npm' 'yarn')
provides=('cinny-web-git')
install=wally-web-git.install
source=("${_pkgname}::git+https://github.com/LaPingvino/wally#branch=main"
        "noto-emoji-bahai::https://github.com/LaPingvino/noto-emoji-bahai/releases/download/v0.0.1-bahai/NotoColorEmoji.ttf"
        )
sha256sums=('SKIP'
            'cb65ec6cb5cef26190505347fc4c1ccc4084fe78eed46bd03bc2e18435073db6'
            )

prepare() {
  cd "$_pkgname"

  # Copy Noto Emoji Bahá'í font to public font directory
  echo "Installing Noto Emoji Bahá'í font..."
  cp "$srcdir/noto-emoji-bahai" "public/font/NotoColorEmoji.Bahai.v0.0.1.ttf"
}

pkgver() {
  cd "$_pkgname"
  printf "r%s.%s" "$(git rev-list --count HEAD)" "$(git rev-parse --short HEAD)"
}

build() {
  cd "$srcdir/$_pkgname"
  npm install --legacy-peer-deps
  npm run build
}

package() {
  cd "$srcdir/$_pkgname"
  install -d "$pkgdir/usr/share/webapps/wally"
  install -d "$pkgdir/etc/webapps/wally"
  cp -r dist/* "$pkgdir/usr/share/webapps/wally"
  chmod -R 0755 "$pkgdir/usr/share/webapps/wally"
  mv "$pkgdir/usr/share/webapps/wally/config.json" "$pkgdir/etc/webapps/wally/config.json.example"
  ln -s /etc/webapps/wally/config.json "$pkgdir/usr/share/webapps/wally/config.json"
}
