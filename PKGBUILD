# Maintainer: Andy Bao <contact@andybao.me>
# Fork maintainer: Joop Kiefte <ikojba@gmail.com>
_pkgname=cinny-web
pkgname="${_pkgname}-git"
pkgver=r1729.1bc5abda
pkgrel=1
pkgdesc="Yet another matrix client — web version (with Element Call, accessibility, issue tracker, and other patches)"
arch=('any')
url="https://codeberg.org/lapingvino/cinny"
license=('AGPL3')
makedepends=('git' 'npm')
source=("${_pkgname}::git+https://codeberg.org/lapingvino/cinny#branch=main"
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
  install -d "$pkgdir/usr/share/webapps/cinny"
  install -d "$pkgdir/etc/webapps/cinny"
  cp -r dist/* "$pkgdir/usr/share/webapps/cinny"
  chmod -R 0755 "$pkgdir/usr/share/webapps/cinny"
  mv "$pkgdir/usr/share/webapps/cinny/config.json" "$pkgdir/etc/webapps/cinny/config.json.example"
  ln -s /etc/webapps/cinny/config.json "$pkgdir/usr/share/webapps/cinny/config.json"
}
