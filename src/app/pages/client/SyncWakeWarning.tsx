import React, { useState, useSyncExternalStore } from 'react';
import { Box, config, Icon, IconButton, Icons, Text } from 'folds';
import { getSyncWakeBug, subscribeSyncWakeBug } from '../../../client/syncWakeHeartbeat';
import { ContainerColor } from '../../styles/ContainerColor.css';

const useSyncWakeBug = (): boolean =>
  useSyncExternalStore(subscribeSyncWakeBug, getSyncWakeBug);

/**
 * Shown when the startup probe found that the homeserver holds the simplified-sliding-sync long-poll
 * open instead of returning new data promptly (a known Continuwuity `v5` bug). Wally compensates with
 * an unconsumed classic `/sync` heartbeat, so latency stays fine — this banner just explains the
 * slightly higher background traffic and points at the underlying server bug. Dismissible per load.
 */
export function SyncWakeWarning() {
  const buggy = useSyncWakeBug();
  const [dismissed, setDismissed] = useState(false);

  if (!buggy || dismissed) return null;

  return (
    <Box direction="Column" shrink="No">
      <Box
        className={ContainerColor({ variant: 'Warning' })}
        style={{ padding: `${config.space.S100} ${config.space.S200}` }}
        alignItems="Center"
        justifyContent="Center"
        gap="200"
      >
        <Icon size="100" src={Icons.Info} />
        <Text size="T300" align="Center">
          Your homeserver holds sliding-sync requests open instead of returning new messages right
          away (a known server bug). Wally is compensating with a background sync, so messages stay
          fast — at a little extra battery/data use until the server is fixed.
        </Text>
        <IconButton
          size="300"
          radii="300"
          variant="Warning"
          fill="None"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
        >
          <Icon size="100" src={Icons.Cross} />
        </IconButton>
      </Box>
    </Box>
  );
}
