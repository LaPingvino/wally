import { MatrixClient } from 'matrix-js-sdk';
import { syncBatchStats } from '../state/syncBatchScheduler';

const REPORT_STORAGE_KEY = 'cinny_mem_reports';
const MAX_STORED_REPORTS = 5;

export interface RoomFootprint {
  roomId: string;
  name: string;
  timelineEvents: number;
  memberCount: number;
  isSpace: boolean;
  isDM: boolean;
}

export interface MemoryReport {
  /** Wall-clock time the snapshot was taken. */
  capturedAt: number;
  /** Reason for the snapshot — "auto" (watchdog) or "manual" (user-triggered). */
  trigger: 'auto' | 'manual';
  /** performance.memory values in bytes, when available. */
  heap?: {
    used: number;
    total: number;
    limit: number;
  };
  /** Total joined rooms, spaces, DMs. */
  roomCounts: {
    joined: number;
    spaces: number;
    invites: number;
    total: number;
  };
  /** Top rooms ordered by live-timeline event count (descending). */
  topByTimelineEvents: RoomFootprint[];
  /** Top rooms ordered by member count (descending). */
  topByMembers: RoomFootprint[];
  /** Snapshot of sync batch stats at capture time. */
  syncBatch: {
    eventsEnqueued: number;
    flushesExecuted: number;
    elapsedMs: number;
    topKeys: Array<{ key: string; count: number }>;
  };
}

function buildFootprint(room: ReturnType<MatrixClient['getRooms']>[number]): RoomFootprint {
  const liveTimeline = room.getLiveTimeline();
  return {
    roomId: room.roomId,
    name: room.name || room.roomId,
    timelineEvents: liveTimeline?.getEvents().length ?? 0,
    memberCount: room.getJoinedMemberCount() || room.getInvitedAndJoinedMemberCount() || 0,
    isSpace: room.isSpaceRoom(),
    isDM: !!room.getDMInviter && false, // kept for schema stability; DM detection requires m.direct
  };
}

export function collectMemoryReport(
  mx: MatrixClient,
  trigger: 'auto' | 'manual'
): MemoryReport {
  const rooms = mx.getRooms();
  const footprints = rooms.map(buildFootprint);

  const byTimeline = [...footprints]
    .sort((a, b) => b.timelineEvents - a.timelineEvents)
    .slice(0, 20);
  const byMembers = [...footprints]
    .sort((a, b) => b.memberCount - a.memberCount)
    .slice(0, 20);

  const joined = rooms.filter((r) => r.getMyMembership() === 'join');
  const spaces = joined.filter((r) => r.isSpaceRoom());
  const invites = rooms.filter((r) => r.getMyMembership() === 'invite');

  const memory = (performance as unknown as {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
  }).memory;

  const topKeys = Array.from(syncBatchStats.eventsByKey.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => ({ key, count }));

  return {
    capturedAt: Date.now(),
    trigger,
    heap: memory
      ? {
          used: memory.usedJSHeapSize,
          total: memory.totalJSHeapSize,
          limit: memory.jsHeapSizeLimit,
        }
      : undefined,
    roomCounts: {
      joined: joined.length,
      spaces: spaces.length,
      invites: invites.length,
      total: rooms.length,
    },
    topByTimelineEvents: byTimeline,
    topByMembers: byMembers,
    syncBatch: {
      eventsEnqueued: syncBatchStats.eventsEnqueued,
      flushesExecuted: syncBatchStats.flushesExecuted,
      elapsedMs: Date.now() - syncBatchStats.resetAt,
      topKeys,
    },
  };
}

export function saveMemoryReport(report: MemoryReport): void {
  try {
    const existing = loadMemoryReports();
    const next = [report, ...existing].slice(0, MAX_STORED_REPORTS);
    localStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage quota / access denied — not worth blocking the reset over.
  }
}

export function loadMemoryReports(): MemoryReport[] {
  try {
    const raw = localStorage.getItem(REPORT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function clearMemoryReports(): void {
  try {
    localStorage.removeItem(REPORT_STORAGE_KEY);
  } catch {
    // no-op
  }
}

/** Log a compact single-line summary + the full report as a structured console group. */
export function logMemoryReport(report: MemoryReport): void {
  const top = report.topByTimelineEvents[0];
  const heapPct = report.heap
    ? `${Math.round((report.heap.used / report.heap.limit) * 100)}%`
    : 'unknown';
  console.warn(
    `[Wally] Memory report (${report.trigger}): heap=${heapPct}, rooms=${report.roomCounts.joined}, biggest timeline="${top?.name ?? 'n/a'}" (${top?.timelineEvents ?? 0} events)`
  );
  try {
    console.groupCollapsed('[Wally] Memory report details');
    console.table(report.topByTimelineEvents);
    console.log('Heap:', report.heap);
    console.log('Room counts:', report.roomCounts);
    console.log('Sync batch:', report.syncBatch);
    console.groupEnd();
  } catch {
    // Some environments (e.g. service workers) lack console.table — ignore.
  }
}
