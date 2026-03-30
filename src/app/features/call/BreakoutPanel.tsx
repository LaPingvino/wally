import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  Icon,
  IconButton,
  Icons,
  Input,
  Spinner,
  Text,
  Tooltip,
  TooltipProvider,
} from 'folds';
import { callDebug } from './callDebug';

export interface Breakout {
  id: string;
  topic: string;
  created_by: string;
  created_at: number;
  participants: number;
}

interface BreakoutPanelProps {
  endpoint: string;
  roomId: string;
  userId: string;
  onClose: () => void;
}

async function fetchBreakouts(endpoint: string, roomId: string): Promise<Breakout[]> {
  const url = `${endpoint.replace(/\/$/, '')}/guest/breakout/list/${encodeURIComponent(roomId)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch breakouts: ${resp.status}`);
  const data = await resp.json();
  return data.breakouts ?? [];
}

async function createBreakout(
  endpoint: string,
  roomId: string,
  topic: string,
  userId: string
): Promise<{ breakout_id: string }> {
  const url = `${endpoint.replace(/\/$/, '')}/guest/breakout/create`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room_id: roomId, topic, user_id: userId }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text);
  }
  return resp.json();
}

async function endBreakout(
  endpoint: string,
  breakoutId: string,
  userId: string
): Promise<void> {
  const url = `${endpoint.replace(/\/$/, '')}/guest/breakout/end`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ breakout_id: breakoutId, user_id: userId }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text);
  }
}

export function BreakoutPanel({ endpoint, roomId, userId, onClose }: BreakoutPanelProps) {
  const [breakouts, setBreakouts] = useState<Breakout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTopic, setNewTopic] = useState('');
  const [creating, setCreating] = useState(false);

  const loadBreakouts = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchBreakouts(endpoint, roomId)
      .then((list) => {
        setBreakouts(list);
        setLoading(false);
      })
      .catch((err) => {
        callDebug('breakout', 'Failed to fetch breakouts', err);
        setError('Failed to load breakout rooms');
        setLoading(false);
      });
  }, [endpoint, roomId]);

  useEffect(() => {
    loadBreakouts();
  }, [loadBreakouts]);

  const handleCreate = useCallback(() => {
    const topic = newTopic.trim();
    if (!topic || creating) return;
    setCreating(true);
    createBreakout(endpoint, roomId, topic, userId)
      .then((result) => {
        callDebug('breakout', 'Created breakout', result);
        setNewTopic('');
        setCreating(false);
        loadBreakouts();
      })
      .catch((err) => {
        callDebug('breakout', 'Failed to create breakout', err);
        setError('Failed to create breakout');
        setCreating(false);
      });
  }, [endpoint, roomId, userId, newTopic, creating, loadBreakouts]);

  const handleEnd = useCallback(
    (breakoutId: string) => {
      endBreakout(endpoint, breakoutId, userId)
        .then(() => {
          callDebug('breakout', 'Ended breakout', { breakoutId });
          loadBreakouts();
        })
        .catch((err) => {
          callDebug('breakout', 'Failed to end breakout', err);
          setError('Failed to end breakout');
        });
    },
    [endpoint, userId, loadBreakouts]
  );

  const handleCopyGuestLink = useCallback(
    (breakoutId: string) => {
      const joinUrl = `${endpoint}/${encodeURIComponent(roomId)}?breakout=${breakoutId}`;
      navigator.clipboard.writeText(joinUrl);
    },
    [endpoint, roomId]
  );

  return (
    <Box
      direction="Column"
      gap="200"
      style={{
        padding: '12px',
        background: 'var(--bg-surface)',
        border: '1px solid var(--bg-surface-border)',
        borderRadius: '8px',
        minWidth: '280px',
        maxWidth: '360px',
        maxHeight: '400px',
      }}
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
            variant="Background"
            size="300"
            radii="300"
            placeholder="Breakout topic..."
            value={newTopic}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewTopic(e.target.value)}
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
          disabled={!newTopic.trim() || creating}
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
        {loading && (
          <Box justifyContent="Center" style={{ padding: '12px' }}>
            <Spinner size="200" />
          </Box>
        )}
        {!loading && breakouts.length === 0 && (
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
              padding: '6px 8px',
              borderRadius: '6px',
              background: 'var(--bg-surface-hover)',
            }}
          >
            <Box grow="Yes" direction="Column" gap="100" style={{ minWidth: 0 }}>
              <Text size="T300" truncate>{br.topic || br.id}</Text>
              <Text size="T200" style={{ opacity: 0.6 }}>
                {br.participants} guest{br.participants !== 1 ? 's' : ''}
              </Text>
            </Box>
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
    </Box>
  );
}
