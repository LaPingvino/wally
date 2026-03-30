import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Room, MatrixClient, RoomStateEvent } from 'matrix-js-sdk';
import {
  Box,
  Button,
  config,
  Icon,
  IconButton,
  Icons,
  Input,
  Menu,
  Spinner,
  Text,
  Tooltip,
  TooltipProvider,
} from 'folds';
import { callDebug } from './callDebug';
import { StateEvent } from '../../../types/matrix/room';

export interface Breakout {
  id: string;
  topic: string;
  created_by: string;
  lk_alias: string;
  active: boolean;
}

interface BreakoutPanelProps {
  room: Room;
  mx: MatrixClient;
  endpoint: string;
  userId: string;
  onClose: () => void;
  onJoinBreakout?: (lkUrl: string, lkToken: string, breakoutId: string) => void;
  onReturnToMain?: () => void;
  activeBreakoutId?: string | null;
}

function getBreakoutsFromState(room: Room): Breakout[] {
  const events = room.currentState.getStateEvents(StateEvent.WallyBreakout);
  const result: Breakout[] = [];
  for (const evt of events) {
    const content = evt.getContent<{
      topic?: string;
      created_by?: string;
      lk_alias?: string;
      active?: boolean;
    }>();
    if (content.active) {
      result.push({
        id: evt.getStateKey() ?? '',
        topic: content.topic ?? '',
        created_by: content.created_by ?? '',
        lk_alias: content.lk_alias ?? '',
        active: true,
      });
    }
  }
  return result;
}

async function joinBreakoutRoom(
  endpoint: string,
  breakoutId: string,
  mx: MatrixClient,
): Promise<{ jwt: string; livekit_url: string; livekit_room: string }> {
  const openIdToken = await mx.getOpenIdToken();
  const deviceId = mx.getDeviceId() ?? 'UNKNOWN';
  const url = `${endpoint.replace(/\/$/, '')}/breakout/join`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ breakout_id: breakoutId, openid_token: openIdToken, device_id: deviceId }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text);
  }
  return resp.json();
}

export function BreakoutPanel({
  room,
  mx,
  endpoint,
  userId,
  onClose,
  onJoinBreakout,
  onReturnToMain,
  activeBreakoutId,
}: BreakoutPanelProps) {
  const [breakouts, setBreakouts] = useState<Breakout[]>(() => getBreakoutsFromState(room));
  const [error, setError] = useState<string | null>(null);
  const topicRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);

  // Re-read breakouts when room state changes
  useEffect(() => {
    const onStateEvent = () => {
      setBreakouts(getBreakoutsFromState(room));
    };
    room.on(RoomStateEvent.Events, onStateEvent);
    return () => { room.off(RoomStateEvent.Events, onStateEvent); };
  }, [room]);

  const handleCreate = useCallback(async () => {
    const topic = topicRef.current?.value.trim() ?? '';
    if (!topic || creating) return;
    setCreating(true);
    setError(null);
    try {
      // Send the state event directly as the user
      const breakoutId = Math.random().toString(36).substring(2, 10);
      // We need the bot to create it (for the LK alias + DB tracking)
      // Use the HTTP endpoint for creation
      const url = `${endpoint.replace(/\/$/, '')}/breakout/create`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id: room.roomId, topic, user_id: userId }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `Failed (${resp.status})`);
      }
      if (topicRef.current) topicRef.current.value = '';
      // State event from bot will trigger the RoomStateEvent.Events listener
    } catch (err) {
      callDebug('breakout', 'Failed to create breakout', err);
      setError(err instanceof Error ? err.message : 'Failed to create breakout');
    }
    setCreating(false);
  }, [endpoint, room.roomId, userId, creating]);

  const handleEnd = useCallback(
    async (breakoutId: string) => {
      setError(null);
      try {
        const url = `${endpoint.replace(/\/$/, '')}/breakout/end`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ breakout_id: breakoutId, user_id: userId }),
        });
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to end breakout');
        }
      } catch (err) {
        callDebug('breakout', 'Failed to end breakout', err);
        setError(err instanceof Error ? err.message : 'Failed to end breakout');
      }
    },
    [endpoint, userId]
  );

  const handleJoinBreakout = useCallback(
    async (breakoutId: string) => {
      if (!onJoinBreakout) return;
      setError(null);
      try {
        const result = await joinBreakoutRoom(endpoint, breakoutId, mx);
        onJoinBreakout(result.livekit_url, result.jwt, breakoutId);
        onClose();
      } catch (err) {
        callDebug('breakout', 'Failed to join breakout', err);
        setError(err instanceof Error ? err.message : 'Failed to join breakout');
      }
    },
    [mx, endpoint, onJoinBreakout, onClose]
  );

  const handleCopyGuestLink = useCallback(
    (breakoutId: string) => {
      const joinUrl = `${endpoint}/${encodeURIComponent(room.roomId)}?breakout=${breakoutId}`;
      navigator.clipboard.writeText(joinUrl);
    },
    [endpoint, room.roomId]
  );

  return (
    <Menu style={{ minWidth: '320px', maxWidth: '420px', maxHeight: '400px' }}>
    <Box
      direction="Column"
      gap="200"
      style={{ padding: config.space.S200 }}
    >
      {/* Header */}
      <Box justifyContent="SpaceBetween" alignItems="Center">
        <Text size="H6" as="h3">Breakout Rooms</Text>
        <IconButton
          variant="Surface"
          size="300"
          radii="300"
          onClick={onClose}
          aria-label="Close breakout panel"
        >
          <Icon src={Icons.Cross} size="200" />
        </IconButton>
      </Box>

      {/* Create form */}
      <Box direction="Row" gap="200" alignItems="Center">
        <Box grow="Yes">
          <Input
            ref={topicRef}
            variant="Background"
            size="300"
            radii="300"
            placeholder="Breakout topic..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
            aria-label="Breakout room topic"
          />
        </Box>
        <Button
          variant="Secondary"
          size="300"
          radii="300"
          disabled={creating}
          onClick={handleCreate}
          aria-label="Create breakout room"
        >
          {creating ? <Spinner size="100" /> : <Icon src={Icons.Plus} size="200" />}
        </Button>
      </Box>

      {/* Error */}
      {error && (
        <Text size="T200" style={{ color: 'var(--mx-critical)' }}>{error}</Text>
      )}

      {/* List */}
      <Box
        direction="Column"
        gap="100"
        style={{ overflowY: 'auto', flexGrow: 1, minHeight: 0 }}
      >
        {breakouts.length === 0 && (
          <Text size="T200" style={{ textAlign: 'center', padding: '8px', opacity: 0.7 }}>
            No active breakout rooms
          </Text>
        )}
        {breakouts.map((br) => (
          <Box
            key={br.id}
            direction="Row"
            alignItems="Center"
            gap="200"
            style={{
              padding: config.space.S100,
              borderRadius: config.radii.R300,
            }}
          >
            <Box grow="Yes" direction="Column" gap="100" style={{ minWidth: 0 }}>
              <Text size="T300" truncate>{br.topic || br.id}</Text>
            </Box>
            {onJoinBreakout && (
              <Button
                variant={activeBreakoutId === br.id ? 'Success' : 'Secondary'}
                size="300"
                radii="300"
                disabled={activeBreakoutId === br.id}
                onClick={() => handleJoinBreakout(br.id)}
                aria-label={activeBreakoutId === br.id ? `In ${br.topic}` : `Join ${br.topic}`}
              >
                <Text size="B300">{activeBreakoutId === br.id ? 'Joined' : 'Join'}</Text>
              </Button>
            )}
            <TooltipProvider
              position="Top"
              delay={400}
              tooltip={<Tooltip><Text size="T200">Copy guest link</Text></Tooltip>}
            >
              {(anchorRef) => (
                <IconButton
                  ref={anchorRef}
                  variant="Surface"
                  size="300"
                  radii="300"
                  onClick={() => handleCopyGuestLink(br.id)}
                  aria-label={`Copy guest link for ${br.topic}`}
                >
                  <Icon src={Icons.Link} size="200" />
                </IconButton>
              )}
            </TooltipProvider>
            <TooltipProvider
              position="Top"
              delay={400}
              tooltip={<Tooltip><Text size="T200">End breakout</Text></Tooltip>}
            >
              {(anchorRef) => (
                <IconButton
                  ref={anchorRef}
                  variant="Critical"
                  size="300"
                  radii="300"
                  onClick={() => handleEnd(br.id)}
                  aria-label={`End breakout ${br.topic}`}
                >
                  <Icon src={Icons.Cross} size="200" />
                </IconButton>
              )}
            </TooltipProvider>
          </Box>
        ))}
      </Box>
      {activeBreakoutId && onReturnToMain && (
        <Button
          variant="Secondary"
          size="300"
          radii="300"
          onClick={() => { onReturnToMain(); onClose(); }}
          aria-label="Return to main room"
        >
          <Text size="B300">Return to Main Room</Text>
        </Button>
      )}
    </Box>
    </Menu>
  );
}
