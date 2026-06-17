import { MatrixClient, SyncState } from 'matrix-js-sdk';
import React, { useCallback, useRef, useState } from 'react';
import { Box, config, Line, Text } from 'folds';
import { useSyncState } from '../../hooks/useSyncState';
import { ContainerColor } from '../../styles/ContainerColor.css';

// Banner phases:
//   connecting — first contact, no rooms on screen yet
//   loading    — momentary, while the baseline (cache paint / first sliding-sync window) lands;
//                shows "(x/y)" progress if the total is known
//   hidden      — baseline is in; the rest of the rooms stream in lazily in the background
//   reconnecting / error — connection trouble
// We deliberately do NOT hold the banner through the full window growth — sliding sync loads the
// long tail lazily, so once the baseline is usable we settle and get out of the way.
type Phase = 'connecting' | 'loading' | 'hidden' | 'reconnecting' | 'error';

type SyncStatusProps = {
  mx: MatrixClient;
};
export function SyncStatus({ mx }: SyncStatusProps) {
  const [phase, setPhase] = useState<Phase>(() => (mx.getRooms().length > 0 ? 'loading' : 'connecting'));
  const [roomCount, setRoomCount] = useState(() => mx.getRooms().length);
  // Total joined rooms the server reports for the main sliding-sync list, so the banner can show
  // "checked x/y" progress (how many rooms we've loaded — and therefore counted unread for — out
  // of the total). Undefined under classic /sync, where the count isn't meaningful.
  const [totalRooms, setTotalRooms] = useState<number | undefined>(undefined);

  const settledRef = useRef(false);

  useSyncState(
    mx,
    useCallback(
      (current) => {
        if (current === SyncState.Error) {
          setPhase('error');
          return;
        }
        if (current === SyncState.Reconnecting) {
          setPhase('reconnecting');
          return;
        }
        if (
          current !== SyncState.Prepared &&
          current !== SyncState.Syncing &&
          current !== SyncState.Catchup
        ) {
          return;
        }

        const count = mx.getRooms().length;
        setRoomCount(count);
        const ss = (
          mx as unknown as {
            getSlidingSync?: () => { getListData?: (k: string) => { joinedCount?: number } | null } | undefined;
          }
        ).getSlidingSync?.();
        const jc = ss?.getListData?.('all')?.joinedCount;
        if (typeof jc === 'number' && jc > 0) setTotalRooms(jc);

        // Stay out of the way once settled — only a fresh reconnect/error (handled above)
        // brings the banner back.
        if (settledRef.current) {
          setPhase('hidden');
          return;
        }
        // Nothing at all yet → still connecting.
        if (count === 0) {
          setPhase('connecting');
          return;
        }
        // We have a baseline set of rooms (the cache paint and/or the first sliding-sync window)
        // — enough to use the app. Settle NOW and let the rest of the window stream in lazily in
        // the background, rather than holding the banner through the full room-count growth (which
        // kept "Loading rooms… (597)" up for a long time on large accounts). Sliding sync is built
        // to load the tail lazily; the banner shouldn't wait for it.
        settledRef.current = true;
        setPhase('hidden');
      },
      [mx]
    )
  );

  if (phase === 'connecting') {
    return (
      <Box direction="Column" shrink="No">
        <Box
          className={ContainerColor({ variant: 'Success' })}
          style={{ padding: `${config.space.S100} 0` }}
          alignItems="Center"
          justifyContent="Center"
        >
          <Text size="L400">Connecting...</Text>
        </Box>
        <Line variant="Success" size="300" />
      </Box>
    );
  }

  if (phase === 'loading') {
    return (
      <Box direction="Column" shrink="No">
        <Box
          className={ContainerColor({ variant: 'Success' })}
          style={{ padding: `${config.space.S100} 0` }}
          alignItems="Center"
          justifyContent="Center"
        >
          <Text size="L400">
            {roomCount > 0
              ? `Loading rooms… (${
                  totalRooms && totalRooms >= roomCount ? `${roomCount}/${totalRooms}` : roomCount
                })`
              : 'Loading rooms…'}
          </Text>
        </Box>
        <Line variant="Success" size="300" />
      </Box>
    );
  }

  if (phase === 'reconnecting') {
    return (
      <Box direction="Column" shrink="No">
        <Box
          className={ContainerColor({ variant: 'Warning' })}
          style={{ padding: `${config.space.S100} 0` }}
          alignItems="Center"
          justifyContent="Center"
        >
          <Text size="L400">Connection Lost! Reconnecting...</Text>
        </Box>
        <Line variant="Warning" size="300" />
      </Box>
    );
  }

  if (phase === 'error') {
    return (
      <Box direction="Column" shrink="No">
        <Box
          className={ContainerColor({ variant: 'Critical' })}
          style={{ padding: `${config.space.S100} 0` }}
          alignItems="Center"
          justifyContent="Center"
        >
          <Text size="L400">Connection Lost!</Text>
        </Box>
        <Line variant="Critical" size="300" />
      </Box>
    );
  }

  return null;
}
