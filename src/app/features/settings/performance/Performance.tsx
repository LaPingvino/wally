import React, { useEffect, useState, useCallback } from 'react';
import { Box, Text, IconButton, Icon, Icons, Scroll, Button, config, toRem } from 'folds';
import { Page, PageContent, PageHeader } from '../../../components/page';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { syncBatchStats, resetSyncBatchStats } from '../../../state/syncBatchScheduler';

type PerformanceProps = {
  requestClose: () => void;
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatRate(count: number, elapsedMs: number): string {
  if (elapsedMs <= 0) return '0/s';
  const perSec = count / (elapsedMs / 1000);
  if (perSec < 0.1) return `${(perSec * 60).toFixed(1)}/min`;
  return `${perSec.toFixed(1)}/s`;
}

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remainSecs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Performance({ requestClose }: PerformanceProps) {
  const mx = useMatrixClient();
  const [tick, setTick] = useState(0);

  // Refresh stats every 2 seconds
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2000);
    return () => clearInterval(id);
  }, []);

  const handleReset = useCallback(() => {
    resetSyncBatchStats();
    setTick((t) => t + 1);
  }, []);

  // Compute derived stats
  const now = Date.now();
  const elapsed = now - syncBatchStats.resetAt;
  const { eventsEnqueued, flushesExecuted, eventsByKey } = syncBatchStats;
  const coalescingRatio = flushesExecuted > 0
    ? (eventsEnqueued / flushesExecuted).toFixed(1)
    : 'N/A';

  // Room/sync stats from Matrix client
  const rooms = mx.getRooms();
  const joinedRooms = rooms.filter((r) => r.getMyMembership() === 'join');
  const invitedRooms = rooms.filter((r) => r.getMyMembership() === 'invite');
  const spaces = joinedRooms.filter((r) => r.isSpaceRoom());
  const dmRooms = joinedRooms.filter((r) => {
    const isDirect = mx.getAccountData('m.direct');
    if (!isDirect) return false;
    const content = isDirect.getContent();
    return Object.values(content).some(
      (roomIds: unknown) => Array.isArray(roomIds) && roomIds.includes(r.roomId)
    );
  });

  // Memory usage (Chrome/Edge only)
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number; totalJSHeapSize: number } }).memory;

  // Sort event keys by count
  const sortedKeys = Array.from(eventsByKey.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <Page>
      <PageHeader outlined={false}>
        <Box grow="Yes" gap="200">
          <Box grow="Yes" alignItems="Center" gap="200">
            <Text size="H3" truncate>
              Performance
            </Text>
          </Box>
          <Box shrink="No">
            <IconButton onClick={requestClose} variant="Surface" aria-label="Close">
              <Icon src={Icons.Cross} />
            </IconButton>
          </Box>
        </Box>
      </PageHeader>
      <Box grow="Yes">
        <Scroll hideTrack visibility="Hover">
          <PageContent>
            <Box direction="Column" gap="700">
              {/* Sync Batching */}
              <Box direction="Column" gap="100">
                <Text size="L400">Sync Event Batching</Text>
                <SequenceCard
                  className={SequenceCardStyle}
                  variant="SurfaceVariant"
                  direction="Column"
                >
                  <SettingTile
                    title="Events Enqueued"
                    description={`${formatNumber(eventsEnqueued)} total (${formatRate(eventsEnqueued, elapsed)})`}
                  />
                  <SettingTile
                    title="Flushes Executed"
                    description={`${formatNumber(flushesExecuted)} total (${formatRate(flushesExecuted, elapsed)})`}
                  />
                  <SettingTile
                    title="Coalescing Ratio"
                    description={
                      coalescingRatio === 'N/A'
                        ? 'No flushes yet'
                        : `${coalescingRatio}x (${coalescingRatio} events per flush on average)`
                    }
                  />
                  <SettingTile
                    title="Measurement Duration"
                    description={formatDuration(elapsed)}
                    after={
                      <Button size="300" variant="Secondary" onClick={handleReset}>
                        <Text size="B300">Reset</Text>
                      </Button>
                    }
                  />
                </SequenceCard>
              </Box>

              {/* Event Breakdown */}
              {sortedKeys.length > 0 && (
                <Box direction="Column" gap="100">
                  <Text size="L400">Events by Category</Text>
                  <SequenceCard
                    className={SequenceCardStyle}
                    variant="SurfaceVariant"
                    direction="Column"
                  >
                    {sortedKeys.map(([key, count]) => (
                      <SettingTile
                        key={key}
                        title={key}
                        description={`${formatNumber(count)} events (${formatRate(count, elapsed)})`}
                      />
                    ))}
                  </SequenceCard>
                </Box>
              )}

              {/* Room Statistics */}
              <Box direction="Column" gap="100">
                <Text size="L400">Room Statistics</Text>
                <SequenceCard
                  className={SequenceCardStyle}
                  variant="SurfaceVariant"
                  direction="Column"
                >
                  <SettingTile
                    title="Joined Rooms"
                    description={`${joinedRooms.length} rooms (${spaces.length} spaces, ${dmRooms.length} DMs, ${joinedRooms.length - spaces.length - dmRooms.length} group)`}
                  />
                  <SettingTile
                    title="Pending Invites"
                    description={`${invitedRooms.length}`}
                  />
                  <SettingTile
                    title="Total Rooms in Memory"
                    description={`${rooms.length}`}
                  />
                </SequenceCard>
              </Box>

              {/* Memory (Chrome/Edge only) */}
              {memory && (
                <Box direction="Column" gap="100">
                  <Text size="L400">Memory Usage</Text>
                  <SequenceCard
                    className={SequenceCardStyle}
                    variant="SurfaceVariant"
                    direction="Column"
                  >
                    <SettingTile
                      title="JS Heap Used"
                      description={formatBytes(memory.usedJSHeapSize)}
                    />
                    <SettingTile
                      title="JS Heap Total"
                      description={formatBytes(memory.totalJSHeapSize)}
                    />
                    <SettingTile
                      title="JS Heap Limit"
                      description={formatBytes(memory.jsHeapSizeLimit)}
                    />
                  </SequenceCard>
                </Box>
              )}
            </Box>
          </PageContent>
        </Scroll>
      </Box>
    </Page>
  );
}
