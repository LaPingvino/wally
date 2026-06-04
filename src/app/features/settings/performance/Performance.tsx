import React, { useEffect, useState, useCallback } from 'react';
import { EventType } from 'matrix-js-sdk';
import { Box, Text, IconButton, Icon, Icons, Scroll, Button } from 'folds';
import { Page, PageContent, PageHeader } from '../../../components/page';
import { SequenceCard } from '../../../components/sequence-card';
import { SequenceCardStyle } from '../styles.css';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { syncBatchStats, resetSyncBatchStats } from '../../../state/syncBatchScheduler';
import { Membership } from '../../../../types/matrix/room';
import { getMDirects } from '../../../utils/room';
import { bytesToSize } from '../../../utils/common';
import { clearCacheAndReload } from '../../../../client/initMatrix';
import {
  clearMemoryReports,
  collectMemoryReport,
  loadMemoryReports,
  logMemoryReport,
  MemoryReport,
  saveMemoryReport,
} from '../../../utils/memoryReport';

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

  const handleCacheReset = useCallback(() => {
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      'Clear the local Matrix cache and reload? You will re-sync from the server. Use this if the tab feels sluggish or if you hit a low-memory warning.'
    );
    if (!ok) return;
    try {
      const report = collectMemoryReport(mx, 'manual');
      saveMemoryReport(report);
      logMemoryReport(report);
    } catch (e) {
      console.warn('Failed to capture memory report:', e);
    }
    clearCacheAndReload(mx).catch(() => window.location.reload());
  }, [mx]);

  const [reports, setReports] = useState<MemoryReport[]>(() => loadMemoryReports());
  const handleClearReports = useCallback(() => {
    clearMemoryReports();
    setReports([]);
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
  const joinedRooms = rooms.filter((r) => r.getMyMembership() === Membership.Join);
  const invitedRooms = rooms.filter((r) => r.getMyMembership() === Membership.Invite);
  const spaces = joinedRooms.filter((r) => r.isSpaceRoom());
  const mDirectEvent = mx.getAccountData(EventType.Direct);
  const dmRoomIds = mDirectEvent ? getMDirects(mDirectEvent) : new Set<string>();
  const dmRooms = joinedRooms.filter((r) => dmRoomIds.has(r.roomId));

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
                      description={bytesToSize(memory.usedJSHeapSize)}
                    />
                    <SettingTile
                      title="JS Heap Total"
                      description={bytesToSize(memory.totalJSHeapSize)}
                    />
                    <SettingTile
                      title="JS Heap Limit"
                      description={bytesToSize(memory.jsHeapSizeLimit)}
                    />
                    <SettingTile
                      title="Heap Pressure"
                      description={`${Math.round((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100)}% of limit (auto-reset at 90%, outside calls)`}
                    />
                  </SequenceCard>
                </Box>
              )}

              {/* Manual recovery */}
              <Box direction="Column" gap="100">
                <Text size="L400">Recovery</Text>
                <SequenceCard
                  className={SequenceCardStyle}
                  variant="SurfaceVariant"
                  direction="Column"
                >
                  <SettingTile
                    title="Clear cache and reload"
                    description="Drops the local Matrix store and reloads the tab. Use if the app feels sluggish or you hit a low-memory warning. A diagnostic report is saved first."
                    after={
                      <Button size="300" variant="Critical" onClick={handleCacheReset}>
                        <Text size="B300">Reset now</Text>
                      </Button>
                    }
                  />
                </SequenceCard>
              </Box>

              {/* Past memory reports */}
              {reports.length > 0 && (
                <Box direction="Column" gap="100">
                  <Text size="L400">Memory Reports</Text>
                  <SequenceCard
                    className={SequenceCardStyle}
                    variant="SurfaceVariant"
                    direction="Column"
                  >
                    {reports.map((r, i) => {
                      const top = r.topByTimelineEvents[0];
                      const when = new Date(r.capturedAt).toLocaleString();
                      const heapPct = r.heap
                        ? `${Math.round((r.heap.used / r.heap.limit) * 100)}%`
                        : 'heap stats unavailable';
                      const culprit = top
                        ? `biggest timeline: "${top.name}" (${formatNumber(top.timelineEvents)} events)`
                        : 'no rooms captured';
                      return (
                        <SettingTile
                          key={`${r.capturedAt}-${i}`}
                          title={`${when} — ${r.trigger === 'auto' ? 'auto-reset' : 'manual'}`}
                          description={`${heapPct} heap, ${formatNumber(r.roomCounts.joined)} rooms · ${culprit}`}
                        />
                      );
                    })}
                    <SettingTile
                      title="Clear reports"
                      description={`Stored locally (up to ${reports.length} report${reports.length === 1 ? '' : 's'}).`}
                      after={
                        <Button size="300" variant="Secondary" onClick={handleClearReports}>
                          <Text size="B300">Clear</Text>
                        </Button>
                      }
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
