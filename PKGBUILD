# Maintainer: Andy Bao <contact@andybao.me>
_pkgname=cinny-web
pkgname="${_pkgname}-git"
pkgver=r1465.29ec172c
pkgrel=1
pkgdesc="Yet another matrix client — web version"
arch=('any')
url="https://github.com/cinnyapp/cinny"
license=('AGPL3')
makedepends=('git' 'npm' 'wget')
source=("${_pkgname}::git+https://github.com/cinnyapp/cinny#branch=dev"
        "noto-emoji-bahai::https://github.com/LaPingvino/noto-emoji-bahai/releases/download/v0.0.1-bahai/NotoColorEmoji.ttf"
        # Element Call component files (from hazre/cinny feat/element-call, unchanged from upstream)
        "PersistentCallContainer.tsx::https://raw.githubusercontent.com/hazre/cinny/feat/element-call/src/app/pages/client/call/PersistentCallContainer.tsx"
        "CallView.css.ts::https://raw.githubusercontent.com/hazre/cinny/feat/element-call/src/app/features/call/CallView.css.ts"
        "CallViewUser.tsx::https://raw.githubusercontent.com/hazre/cinny/feat/element-call/src/app/features/call/CallViewUser.tsx"
        "CinnyWidget.ts::https://raw.githubusercontent.com/hazre/cinny/feat/element-call/src/app/features/call/CinnyWidget.ts"
        "SmallWidget.ts::https://raw.githubusercontent.com/hazre/cinny/feat/element-call/src/app/features/call/SmallWidget.ts"
        "create-room-types.ts::https://raw.githubusercontent.com/hazre/cinny/feat/element-call/src/app/components/create-room/types.ts"
        "CreateRoomKindSelector.tsx::https://raw.githubusercontent.com/hazre/cinny/feat/element-call/src/app/components/create-room/CreateRoomKindSelector.tsx"
        "CreateRoomVoiceSelector.tsx::https://raw.githubusercontent.com/hazre/cinny/feat/element-call/src/app/components/create-room/CreateRoomVoiceSelector.tsx"
        "SearchFilters.tsx::https://raw.githubusercontent.com/hazre/cinny/feat/element-call/src/app/features/message-search/SearchFilters.tsx"
        "RoomNavUser.tsx::https://raw.githubusercontent.com/hazre/cinny/feat/element-call/src/app/features/room-nav/RoomNavUser.tsx"
        "RoomCallNavStatus.css.ts::https://raw.githubusercontent.com/hazre/cinny/feat/element-call/src/app/features/room-nav/RoomCallNavStatus.css.ts"
        # Local replacement files (final versions of heavily-customized files)
        "CallProvider.tsx"
        "CallView.tsx"
        "useCallMemberships.ts"
        "Room.tsx"
        "RoomViewHeader.tsx"
        "RoomView.tsx"
        "IncomingCallNotification.tsx"
        "RoomNavItem.tsx"
        "SmallWidgetDriver.ts"
        "RoomCallNavStatus.tsx"
        # Patches on upstream cinny files (allows security fixes to flow through)
        "01-emoji-font.patch"
        "02-element-call.patch"
        "03-pronouns.patch"
        "04-call-settings.patch"
        "05-login-accessibility.patch"
        "06-accessibility.patch"
        )
sha256sums=('SKIP'
            'cb65ec6cb5cef26190505347fc4c1ccc4084fe78eed46bd03bc2e18435073db6'
            # hazre/cinny unchanged components
            '1aa9da1d106d80de98245f449566142461ce72bb1073a8f3a1c0bcf76b13ab04'
            '15cef9d4e07ba45646f61c3815b33bd328145fb3a863f25c2f7a08e5c82bd7bb'
            '53e650b10f2b5790712b6545a91c46bb9d4599824fc43d0cf2fb73b8b7fd14bd'
            '9add08cd1486eec7cfbd7fd37a09e3df0253afb97e925deca5fc99d7479ca52e'
            'bb9312ef8ab2aac322f173cd98a2285eade61cc4181d68361e978278302db347'
            'f7019c4f971b43aa6fa22b3a652de0c8ef43b3b456c83e05f29d207f949eb229'
            'a8dca554b4bca0e1ca748da4cded2a3320458ed335f8095fcf1b4bbb9db98afe'
            '13fa63e17d0b85b5ab656754f5bd6357f98b67952a8590d94dfcd2524b71dde7'
            '20efc89e180fdf5c562031cd6cacf71d28e52ded166f54302fb852be49bf6daf'
            '20fa38415ab96e564ea863654603d2533f30f97f3d742d52036219e54d742d14'
            '66657dc7aa7cce0aaa84d0f61b3ac2ac6475980f3b89b811f8f9c899e7712a6c'
            # Heavily-customized local replacements
            '1e4e4f07d01867cf704a5f7433bbcf41e92a87e9bca264d6c4e9ee31c4011824'
            'aeb3404add2c68bc952b543d77ef155e60fe7776aaf62e29bc68291b98c016f4'
            '1f8649e1ff1eedc4d7415e4800bade9d5014fbdf80aef80a22909f0abb7e67c1'
            'aac3d97b225d2a3b4ec911f4f3ca9480d2bb8a6c4ec360b7b0fe9762273ebd42'
            'd49748ffeca4ab129433a509997871eb9bd17b2a4d00acf58e8ba7059dc6e7f8'
            'c53be6eed7150f17e28f17f032a32a2bad9b476e59bcfad4d1f5c3abb887e57c'
            'e94efb16081dfc874e21c41fbe3d7644e4e36ef19b418c9267b146f6bfbfb499'
            'b6b545d5827fc5d0dcb3a125f1dd0594e8607826a8576ac0d873bc0953aff113'
            'c922f80a4d7f7c628130f09cba9a8a558041dd53600f47fdc2a0117ce991d2b7'
            '521b980661ce402c10982d8658a18bdc2022e6926d8b391c342800e365e06132'
            # Patches
            '7360808ff556756fa2629017a3d0753fab676a1929094a25902e01e9b8fa5197'
            'c642865176cc7580d61dddfafce973b2b9f2ca47bf0121096d5bc68777c11855'
            '7c767ec55a9845b1513a7441c22dc8a47f71b16236871b3de077a80fdd8b1046'
            'ad484df2baf841eba1b95c7943fcafaecc6e9196bb42c780e2742d5a209b52d3'
            '29c67a170a5b1b65654ba50a28d02a2867168da4c8ab00aca2e51df6f2b54298'
            'fe5488dae9014bce15bcd4605173505371126449f9d2408d0de868ce51e69197'
            )

prepare() {
  cd "$_pkgname"

  echo "Installing Element Call component files..."
  mkdir -p "src/app/pages/client/call"
  mkdir -p "src/app/features/call"
  mkdir -p "src/app/features/room"
  mkdir -p "src/app/features/room-nav"
  mkdir -p "src/app/features/message-search"
  mkdir -p "src/app/components/create-room"
  mkdir -p "src/app/hooks"

  # Files unchanged from hazre/cinny feat/element-call
  cp "$srcdir/PersistentCallContainer.tsx" "src/app/pages/client/call/"
  cp "$srcdir/CallView.css.ts" "src/app/features/call/"
  cp "$srcdir/CallViewUser.tsx" "src/app/features/call/"
  cp "$srcdir/CinnyWidget.ts" "src/app/features/call/"
  cp "$srcdir/SmallWidget.ts" "src/app/features/call/"
  cp "$srcdir/create-room-types.ts" "src/app/components/create-room/types.ts"
  cp "$srcdir/CreateRoomKindSelector.tsx" "src/app/components/create-room/"
  cp "$srcdir/CreateRoomVoiceSelector.tsx" "src/app/components/create-room/"
  cp "$srcdir/SearchFilters.tsx" "src/app/features/message-search/"
  cp "$srcdir/RoomNavUser.tsx" "src/app/features/room-nav/"
  cp "$srcdir/RoomCallNavStatus.tsx" "src/app/features/room-nav/"
  cp "$srcdir/RoomCallNavStatus.css.ts" "src/app/features/room-nav/"

  # Our heavily-customized final versions
  cp "$srcdir/CallProvider.tsx" "src/app/pages/client/call/"
  cp "$srcdir/CallView.tsx" "src/app/features/call/"
  cp "$srcdir/useCallMemberships.ts" "src/app/hooks/"
  cp "$srcdir/Room.tsx" "src/app/features/room/"
  cp "$srcdir/RoomViewHeader.tsx" "src/app/features/room/"
  cp "$srcdir/RoomView.tsx" "src/app/features/room/"
  cp "$srcdir/IncomingCallNotification.tsx" "src/app/features/call/"
  cp "$srcdir/RoomNavItem.tsx" "src/app/features/room-nav/"
  cp "$srcdir/SmallWidgetDriver.ts" "src/app/features/call/"

  echo "Applying emoji font patch..."
  patch -p1 -i "$srcdir/01-emoji-font.patch"

  echo "Applying Element Call integration patch..."
  patch -p1 -i "$srcdir/02-element-call.patch"

  echo "Applying pronoun/timezone/extended profile patch..."
  patch -p1 -i "$srcdir/03-pronouns.patch"

  echo "Applying call ringtone settings patch..."
  patch -p1 -i "$srcdir/04-call-settings.patch"

  echo "Applying login form accessibility patch..."
  patch -p1 -i "$srcdir/05-login-accessibility.patch"

  echo "Applying accessibility improvements patch..."
  patch -p1 -i "$srcdir/06-accessibility.patch"

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
