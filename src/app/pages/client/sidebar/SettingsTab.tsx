import React, { useCallback, useEffect, useState } from 'react';
import { Box, config, Icon, Icons, Line, Menu, MenuItem, PopOut, RectCords, Text, toRem } from 'folds';
import { useAtom } from 'jotai';
import FocusTrap from 'focus-trap-react';
import { SidebarItem, SidebarItemTooltip, SidebarAvatar } from '../../../components/sidebar';
import { UserAvatar } from '../../../components/user-avatar';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { mxcUrlToHttp } from '../../../utils/matrix';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { Settings, SettingsPages } from '../../../features/settings';
import { useUserProfile } from '../../../hooks/useUserProfile';
import { Modal500 } from '../../../components/Modal500';
import { openSettingsAtKeyboardShortcutsAtom } from '../../../state/keyboardShortcutsHelp';
import { getSecondarySessions } from '../../../state/sessions';
import { useClientConfig } from '../../../hooks/useClientConfig';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { AddAccountDialog } from '../AddAccountDialog';
import { stopPropagation } from '../../../utils/keyboard';

export function SettingsTab() {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const userId = mx.getUserId() as string;
  const profile = useUserProfile(userId);

  const [settings, setSettings] = useState(false);
  const [settingsKey, setSettingsKey] = useState(0);
  const [initialPage, setInitialPage] = useState<SettingsPages | undefined>(undefined);
  const [menuAnchor, setMenuAnchor] = useState<RectCords | undefined>();
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [multiAccount] = useSetting(settingsAtom, 'multiAccount');
  const { hashRouter } = useClientConfig();

  const [openAtKbShortcuts, setOpenAtKbShortcuts] = useAtom(openSettingsAtKeyboardShortcutsAtom);

  useEffect(() => {
    if (openAtKbShortcuts) {
      setOpenAtKbShortcuts(false);
      setInitialPage(SettingsPages.KeyboardShortcutsPage);
      setSettingsKey((k) => k + 1);
      setSettings(true);
    }
  }, [openAtKbShortcuts, setOpenAtKbShortcuts]);

  const avatarUrl = profile.avatarUrl
    ? mxcUrlToHttp(mx, profile.avatarUrl, useAuthentication, 96, 96, 'crop') ?? undefined
    : undefined;

  // Account data (localStorage reads; account switching always navigates so stale reads are fine)
  const slotStr = sessionStorage.getItem('cinny-account-slot');
  const currentSlot = slotStr !== null ? parseInt(slotStr, 10) : null;
  const isMainActive = currentSlot === null && !window.location.pathname.startsWith('/account/');
  const mainSession = (() => {
    const b = localStorage.getItem('cinny_hs_base_url');
    const u = localStorage.getItem('cinny_user_id');
    return b && u ? { userId: u } : null;
  })();
  const secondarySessions = getSecondarySessions();

  const switchToSlot = useCallback(
    (slot: number | null) => {
      setMenuAnchor(undefined);
      if (slot === null) {
        sessionStorage.removeItem('cinny-account-slot');
        if (hashRouter?.enabled) window.location.reload();
        else window.location.assign('/');
      } else {
        sessionStorage.setItem('cinny-account-slot', String(slot));
        if (hashRouter?.enabled) window.location.reload();
        else window.location.assign(`/account/${slot}/`);
      }
    },
    [hashRouter]
  );

  const handleClick = (evt: React.MouseEvent<HTMLButtonElement>) => {
    if (multiAccount) {
      const cords = evt.currentTarget.getBoundingClientRect();
      setMenuAnchor((current) => (current ? undefined : cords));
    } else {
      setSettings(true);
    }
  };

  const openSettings = () => {
    setMenuAnchor(undefined);
    setSettings(true);
  };

  const closeSettings = () => {
    setSettings(false);
    setInitialPage(undefined);
  };

  return (
    <SidebarItem active={settings || !!menuAnchor}>
      <SidebarItemTooltip tooltip={multiAccount ? 'Account & Settings' : 'User Settings'}>
        {(triggerRef) => (
          <SidebarAvatar as="button" ref={triggerRef} onClick={handleClick}>
            <UserAvatar
              userId={userId}
              src={avatarUrl}
              renderFallback={() => <Icon size="400" src={Icons.User} filled />}
            />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>

      {multiAccount && menuAnchor && (
        <PopOut
          anchor={menuAnchor}
          position="Right"
          align="End"
          content={
            <FocusTrap
              focusTrapOptions={{
                initialFocus: false,
                returnFocusOnDeactivate: false,
                onDeactivate: () => setMenuAnchor(undefined),
                clickOutsideDeactivates: true,
                isKeyForward: (e: KeyboardEvent) => e.key === 'ArrowDown',
                isKeyBackward: (e: KeyboardEvent) => e.key === 'ArrowUp',
                escapeDeactivates: stopPropagation,
              }}
            >
              <Menu style={{ maxWidth: toRem(220), width: '100vw' }}>
                <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                  {mainSession && (
                    <MenuItem
                      size="300"
                      radii="300"
                      onClick={() => switchToSlot(null)}
                      before={<Icon size="200" src={Icons.User} filled={isMainActive} />}
                      after={isMainActive ? <Icon size="100" src={Icons.Check} /> : undefined}
                    >
                      <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                        {mainSession.userId}
                      </Text>
                    </MenuItem>
                  )}
                  {secondarySessions.map(({ slot, session }) => {
                    const isActive = currentSlot === slot;
                    return (
                      <MenuItem
                        key={slot}
                        size="300"
                        radii="300"
                        onClick={() => switchToSlot(slot)}
                        before={<Icon size="200" src={Icons.User} filled={isActive} />}
                        after={isActive ? <Icon size="100" src={Icons.Check} /> : undefined}
                      >
                        <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                          {session.userId}
                        </Text>
                      </MenuItem>
                    );
                  })}
                  <MenuItem
                    size="300"
                    radii="300"
                    onClick={() => {
                      setMenuAnchor(undefined);
                      setShowAddAccount(true);
                    }}
                    before={<Icon size="200" src={Icons.Plus} />}
                  >
                    <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                      Add Account
                    </Text>
                  </MenuItem>
                  <Line variant="Surface" size="300" />
                  <MenuItem
                    size="300"
                    radii="300"
                    onClick={openSettings}
                    before={<Icon size="200" src={Icons.Setting} />}
                  >
                    <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
                      Settings
                    </Text>
                  </MenuItem>
                </Box>
              </Menu>
            </FocusTrap>
          }
        />
      )}

      {settings && (
        <Modal500 requestClose={closeSettings}>
          <Settings key={settingsKey} initialPage={initialPage} requestClose={closeSettings} />
        </Modal500>
      )}
      {showAddAccount && <AddAccountDialog onClose={() => setShowAddAccount(false)} />}
    </SidebarItem>
  );
}
