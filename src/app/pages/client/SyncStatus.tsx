import { MatrixClient, SyncState } from 'matrix-js-sdk';
import React, { useCallback, useRef, useState } from 'react';
import { Box, config, Line, Text } from 'folds';
import { useSyncState } from '../../hooks/useSyncState';
import { ContainerColor } from '../../styles/ContainerColor.css';

// Banner phases. Under simplified sliding sync the SDK polls every ~3s and the
// room window GROWS over several polls, so a single "Connecting…/hidden" flip
// hid what was still happening. Instead we track the loaded room count:
//   connecting — first contact, nothing on screen yet
//   loading    — connected, rooms still streaming in (window growing) — shows the count
//   hidden      — count has settled (steady state)
//   reconnecting / error — connection trouble
// With the persistent cache the room list is already painted on load, so we start
// in `loading` (calm) rather than the alarming `connecting`.
type Phase = 'connecting' | 'loading' | 'hidden' | 'reconnecting' | 'error';

// Consecutive non-growing polls before we call the initial load "settled". A small
// buffer avoids hiding the banner during a brief gap between window-growth bursts.
const SETTLE_POLLS = 2;

type SyncStatusProps = {
  mx: MatrixClient;
};
export function SyncStatus({ mx }: SyncStatusProps) {
  const [phase, setPhase] = useState<Phase>(() => (mx.getRooms().length > 0 ? 'loading' : 'connecting'));
  const [roomCount, setRoomCount] = useState(() => mx.getRooms().length);

  const lastCountRef = useRef(roomCount);
  const stablePollsRef = useRef(0);
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

        // Once the initial load has settled, stay out of the way — only a fresh
        // reconnect/error (handled above) should bring the banner back.
        if (settledRef.current) {
          setPhase('hidden');
          return;
        }

        if (count > lastCountRef.current) {
          lastCountRef.current = count;
          stablePollsRef.current = 0;
          setPhase('loading');
          return;
        }
        // Nothing arrived yet at all → still connecting; otherwise count the quiet
        // polls and settle once the window has stopped growing.
        if (count === 0) {
          setPhase('connecting');
          return;
        }
        stablePollsRef.current += 1;
        if (stablePollsRef.current >= SETTLE_POLLS) {
          settledRef.current = true;
          setPhase('hidden');
        } else {
          setPhase('loading');
        }
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
            {roomCount > 0 ? `Loading rooms… (${roomCount})` : 'Loading rooms…'}
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
