import React, { useState, useSyncExternalStore } from 'react';
import { Box, config, Icon, IconButton, Icons, Text } from 'folds';
import { getSyncMode, subscribeSyncMode, SyncMode } from '../../../client/slidingSyncHealth';
import { ContainerColor } from '../../styles/ContainerColor.css';

const useSyncMode = (): SyncMode => useSyncExternalStore(subscribeSyncMode, getSyncMode);

type ModeStyle = {
  label: string;
  variant: 'Success' | 'Warning' | 'SurfaceVariant';
};

const MODE_STYLE: Record<SyncMode, ModeStyle> = {
  sliding_healthy: { label: 'Full sliding sync', variant: 'Success' },
  sliding_degraded: { label: 'Sliding sync · poll fallback (server bug?)', variant: 'Warning' },
  no_sliding: { label: 'Classic sync', variant: 'SurfaceVariant' },
};

const DISMISS_KEY = 'wally_syncmode_dismissed';
const readDismissed = (): string => {
  try {
    return localStorage.getItem(DISMISS_KEY) ?? '';
  } catch {
    return '';
  }
};

/**
 * Neutral top-bar indicator of the live sync mode (see {@link startSlidingSyncHealth}). Deliberately
 * informational, not a warning — it doubles as a test readout while sliding sync matures, without
 * alarming classic-sync users. Dismissible; the dismissal is per-mode (persisted), so it reappears
 * only when the mode actually changes (e.g. healthy → poll fallback), never nagging on the same mode.
 */
export function SyncModeIndicator() {
  const mode = useSyncMode();
  const [dismissed, setDismissed] = useState(readDismissed);

  if (mode === dismissed) return null;

  const dismiss = (): void => {
    setDismissed(mode);
    try {
      localStorage.setItem(DISMISS_KEY, mode);
    } catch {
      // non-fatal — it just won't persist across reloads
    }
  };

  const { label, variant } = MODE_STYLE[mode];

  return (
    <Box direction="Column" shrink="No">
      <Box
        className={ContainerColor({ variant })}
        style={{ padding: `${config.space.S100} ${config.space.S200}` }}
        alignItems="Center"
        justifyContent="Center"
        gap="200"
      >
        <Icon size="50" src={Icons.Reload} />
        <Text size="T200" align="Center">
          {label}
        </Text>
        <IconButton size="300" radii="300" variant={variant} fill="None" onClick={dismiss} aria-label="Dismiss">
          <Icon size="50" src={Icons.Cross} />
        </IconButton>
      </Box>
    </Box>
  );
}
