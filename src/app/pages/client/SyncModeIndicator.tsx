import React, { useSyncExternalStore } from 'react';
import { Box, config, Icon, Icons } from 'folds';
import { getSyncMode, subscribeSyncMode, SyncMode } from '../../../client/slidingSyncHealth';
import { ContainerColor } from '../../styles/ContainerColor.css';

const useSyncMode = (): SyncMode => useSyncExternalStore(subscribeSyncMode, getSyncMode);

type ModeStyle = {
  label: string;
  variant: 'Success' | 'Warning' | 'SurfaceVariant';
};

const MODE_STYLE: Record<SyncMode, ModeStyle> = {
  sliding_healthy: { label: 'Full sliding sync', variant: 'Success' },
  sliding_degraded: { label: 'Sliding sync · slow wake measured (diagnostic)', variant: 'Warning' },
  no_sliding: { label: 'Classic sync', variant: 'SurfaceVariant' },
};

/**
 * Discreet live sync-mode status (see {@link startSlidingSyncHealth}). A small colour-coded dot pinned
 * to the bottom-left corner — green = full sliding sync, amber = poll fallback, grey = classic — with
 * the full label on hover (title) and for screen readers (aria-label). Replaced the full-width top
 * strip: persistent and glanceable without taking layout space or needing per-mode dismissal.
 */
export function SyncModeIndicator() {
  const mode = useSyncMode();
  const { label, variant } = MODE_STYLE[mode];

  return (
    <Box
      shrink="No"
      alignItems="Center"
      justifyContent="Center"
      className={ContainerColor({ variant })}
      title={label}
      aria-label={`Sync mode: ${label}`}
      style={{
        position: 'fixed',
        bottom: config.space.S200,
        left: config.space.S200,
        zIndex: 200,
        width: '22px',
        height: '22px',
        borderRadius: '50%',
        opacity: 0.75,
        pointerEvents: 'auto',
      }}
    >
      <Icon size="50" src={Icons.Reload} />
    </Box>
  );
}
