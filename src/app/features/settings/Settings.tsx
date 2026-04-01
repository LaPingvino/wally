import React, { useMemo, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  config,
  Icon,
  IconButton,
  Icons,
  IconSrc,
  MenuItem,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
} from 'folds';
import FocusTrap from 'focus-trap-react';
import { General } from './general';
import { PageNav, PageNavContent, PageNavHeader, PageRoot } from '../../components/page';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { Account } from './account';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { mxcUrlToHttp } from '../../utils/matrix';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { UserAvatar } from '../../components/user-avatar';
import { Notifications } from './notifications';
import { Devices } from './devices';
import { EmojisStickers } from './emojis-stickers';
import { DeveloperTools } from './developer-tools';
import { About } from './about';
import { KeyboardShortcuts } from './keyboard-shortcuts/KeyboardShortcuts';
import { Performance } from './performance';
import { Accessibility } from './accessibility';
import { UseStateProvider } from '../../components/UseStateProvider';
import { stopPropagation } from '../../utils/keyboard';
import { LogoutDialog } from '../../components/LogoutDialog';
import { NativeDialog } from '../../components/NativeDialog';
import * as dialogCss from '../../components/NativeDialog.css';

export enum SettingsPages {
  GeneralPage,
  AccountPage,
  NotificationPage,
  DevicesPage,
  EmojisStickersPage,
  DeveloperToolsPage,
  AboutPage,
  KeyboardShortcutsPage,
  PerformancePage,
  AccessibilityPage,
}

type SettingsMenuItem = {
  page: SettingsPages;
  name: string;
  icon: IconSrc;
};

const useSettingsMenuItems = (): SettingsMenuItem[] =>
  useMemo(
    () => [
      {
        page: SettingsPages.GeneralPage,
        name: 'General',
        icon: Icons.Setting,
      },
      {
        page: SettingsPages.AccountPage,
        name: 'Account',
        icon: Icons.User,
      },
      {
        page: SettingsPages.NotificationPage,
        name: 'Notifications',
        icon: Icons.Bell,
      },
      {
        page: SettingsPages.DevicesPage,
        name: 'Devices',
        icon: Icons.Monitor,
      },
      {
        page: SettingsPages.EmojisStickersPage,
        name: 'Emojis & Stickers',
        icon: Icons.Smile,
      },
      {
        page: SettingsPages.DeveloperToolsPage,
        name: 'Developer Tools',
        icon: Icons.Terminal,
      },
      {
        page: SettingsPages.AboutPage,
        name: 'About',
        icon: Icons.Info,
      },
      {
        page: SettingsPages.KeyboardShortcutsPage,
        name: 'Keyboard Shortcuts',
        icon: Icons.Alphabet,
      },
      {
        page: SettingsPages.PerformancePage,
        name: 'Performance',
        icon: Icons.Bulb,
      },
      {
        page: SettingsPages.AccessibilityPage,
        name: 'Accessibility',
        icon: Icons.User,
      },
    ],
    []
  );

type SettingsProps = {
  initialPage?: SettingsPages;
  requestClose: () => void;
};
export function Settings({ initialPage, requestClose }: SettingsProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const userId = mx.getUserId() as string;
  const profile = useUserProfile(userId);
  const avatarUrl = profile.avatarUrl
    ? mxcUrlToHttp(mx, profile.avatarUrl, useAuthentication, 96, 96, 'crop') ?? undefined
    : undefined;

  const screenSize = useScreenSizeContext();
  const [activePage, setActivePage] = useState<SettingsPages | undefined>(() => {
    if (initialPage) return initialPage;
    return screenSize === ScreenSize.Mobile ? undefined : SettingsPages.GeneralPage;
  });
  const menuItems = useSettingsMenuItems();

  const handlePageRequestClose = () => {
    if (screenSize === ScreenSize.Mobile) {
      setActivePage(undefined);
      return;
    }
    requestClose();
  };

  return (
    <PageRoot
      nav={
        screenSize === ScreenSize.Mobile && activePage !== undefined ? undefined : (
          <PageNav size="300">
            <PageNavHeader outlined={false}>
              <Box grow="Yes" gap="200">
                <Avatar size="200" radii="300">
                  <UserAvatar
                    userId={userId}
                    src={avatarUrl}
                    renderFallback={() => <Icon size="100" src={Icons.User} filled />}
                  />
                </Avatar>
                <Text size="H4" truncate>
                  Settings
                </Text>
              </Box>
              <Box shrink="No">
                {screenSize === ScreenSize.Mobile && (
                  <IconButton onClick={requestClose} variant="Background">
                    <Icon src={Icons.Cross} />
                  </IconButton>
                )}
              </Box>
            </PageNavHeader>
            <Box grow="Yes" direction="Column">
              <PageNavContent>
                <div style={{ flexGrow: 1 }}>
                  {menuItems.map((item) => (
                    <MenuItem
                      key={item.name}
                      variant="Background"
                      radii="400"
                      aria-pressed={activePage === item.page}
                      before={<Icon src={item.icon} size="100" filled={activePage === item.page} />}
                      onClick={() => setActivePage(item.page)}
                    >
                      <Text
                        style={{
                          fontWeight: activePage === item.page ? config.fontWeight.W600 : undefined,
                        }}
                        size="T300"
                        truncate
                      >
                        {item.name}
                      </Text>
                    </MenuItem>
                  ))}
                </div>
              </PageNavContent>
              <Box style={{ padding: config.space.S200 }} shrink="No" direction="Column">
                <UseStateProvider initial={false}>
                  {(logout, setLogout) => (
                    <>
                      <Button
                        size="300"
                        variant="Critical"
                        fill="None"
                        radii="Pill"
                        before={<Icon src={Icons.Power} size="100" />}
                        onClick={() => setLogout(true)}
                      >
                        <Text size="B400">Logout</Text>
                      </Button>
                      <NativeDialog open={!!logout} onClose={() => setLogout(false)} className={dialogCss.NativeDialog}>
                        <LogoutDialog handleClose={() => setLogout(false)} />
                      </NativeDialog>
                    </>
                  )}
                </UseStateProvider>
              </Box>
            </Box>
          </PageNav>
        )
      }
    >
      {activePage === SettingsPages.GeneralPage && (
        <General requestClose={handlePageRequestClose} />
      )}
      {activePage === SettingsPages.AccountPage && (
        <Account requestClose={handlePageRequestClose} />
      )}
      {activePage === SettingsPages.NotificationPage && (
        <Notifications requestClose={handlePageRequestClose} />
      )}
      {activePage === SettingsPages.DevicesPage && (
        <Devices requestClose={handlePageRequestClose} />
      )}
      {activePage === SettingsPages.EmojisStickersPage && (
        <EmojisStickers requestClose={handlePageRequestClose} />
      )}
      {activePage === SettingsPages.DeveloperToolsPage && (
        <DeveloperTools requestClose={handlePageRequestClose} />
      )}
      {activePage === SettingsPages.AboutPage && <About requestClose={handlePageRequestClose} />}
      {activePage === SettingsPages.KeyboardShortcutsPage && (
        <KeyboardShortcuts requestClose={handlePageRequestClose} />
      )}
      {activePage === SettingsPages.PerformancePage && (
        <Performance requestClose={handlePageRequestClose} />
      )}
      {activePage === SettingsPages.AccessibilityPage && (
        <Accessibility requestClose={handlePageRequestClose} />
      )}
    </PageRoot>
  );
}
