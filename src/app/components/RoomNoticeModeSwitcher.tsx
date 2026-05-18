import { Box, config, Icon, Icons, Menu, MenuItem, PopOut, RectCords, Text } from 'folds';
import React, { MouseEventHandler, ReactNode, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import { stopPropagation } from '../utils/keyboard';

export type RoomNoticeMode = 'default' | 'inline' | 'inbox';

const MODE_ORDER: RoomNoticeMode[] = ['default', 'inline', 'inbox'];

const MODE_LABEL: Record<RoomNoticeMode, string> = {
  default: 'Follow global default',
  inline: 'Always inline',
  inbox: 'Always inbox-only',
};

const MODE_DESCRIPTION: Record<RoomNoticeMode, string> = {
  default: 'Use the setting from Notifications preferences',
  inline: 'm.notice messages render in this room’s timeline',
  inbox: 'm.notice messages are hidden here, visible only in the Notices inbox',
};

const overrideToMode = (override: boolean | undefined): RoomNoticeMode => {
  if (override === true) return 'inbox';
  if (override === false) return 'inline';
  return 'default';
};

const modeToOverride = (mode: RoomNoticeMode): boolean | undefined => {
  if (mode === 'inbox') return true;
  if (mode === 'inline') return false;
  return undefined;
};

type RoomNoticeModeSwitcherProps = {
  override: boolean | undefined;
  onChange: (override: boolean | undefined) => void;
  children: (handleOpen: MouseEventHandler<HTMLButtonElement>, opened: boolean) => ReactNode;
};

export function RoomNoticeModeSwitcher({
  override,
  onChange,
  children,
}: RoomNoticeModeSwitcherProps) {
  const value = overrideToMode(override);
  const [menuCords, setMenuCords] = useState<RectCords>();

  const handleOpenMenu: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setMenuCords(evt.currentTarget.getBoundingClientRect());
  };

  const handleClose = () => setMenuCords(undefined);

  const handleSelect = (mode: RoomNoticeMode) => {
    onChange(modeToOverride(mode));
    handleClose();
  };

  return (
    <PopOut
      anchor={menuCords}
      offset={5}
      position="Right"
      align="Start"
      content={
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            onDeactivate: handleClose,
            clickOutsideDeactivates: true,
            isKeyForward: (evt: KeyboardEvent) =>
              evt.key === 'ArrowDown' || evt.key === 'ArrowRight',
            isKeyBackward: (evt: KeyboardEvent) =>
              evt.key === 'ArrowUp' || evt.key === 'ArrowLeft',
            escapeDeactivates: stopPropagation,
          }}
        >
          <Menu>
            <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
              {MODE_ORDER.map((mode) => (
                <MenuItem
                  key={mode}
                  size="300"
                  variant="Surface"
                  aria-pressed={mode === value}
                  radii="300"
                  onClick={() => handleSelect(mode)}
                  before={
                    <Icon size="100" src={Icons.Info} filled={mode === value && mode === 'inbox'} />
                  }
                  title={MODE_DESCRIPTION[mode]}
                >
                  <Text size="T300">
                    {mode === value ? <b>{MODE_LABEL[mode]}</b> : MODE_LABEL[mode]}
                  </Text>
                </MenuItem>
              ))}
            </Box>
          </Menu>
        </FocusTrap>
      }
    >
      {children(handleOpenMenu, !!menuCords)}
    </PopOut>
  );
}
