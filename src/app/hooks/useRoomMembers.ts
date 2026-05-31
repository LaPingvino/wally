import { MatrixClient, MatrixEvent, RoomMember, RoomMemberEvent } from 'matrix-js-sdk';
import { useEffect, useState } from 'react';

export const useRoomMembers = (mx: MatrixClient, roomId: string): RoomMember[] => {
  const [members, setMembers] = useState<RoomMember[]>([]);

  useEffect(() => {
    const room = mx.getRoom(roomId);
    let loadingMembers = true;
    let disposed = false;

    const updateMemberList = (event?: MatrixEvent) => {
      if (!room || disposed || (event && event.getRoomId() !== roomId)) return;
      if (loadingMembers) return;
      setMembers(room.getMembers());
    };

    if (room) {
      setMembers(room.getMembers());
      // Under sliding sync, loadMembersIfNeeded is a no-op (lazyLoadMembers is
      // off, so membersPromise is pre-resolved) and the roster only ever holds
      // $LAZY senders — bridged-group members show as mxids and @-mention
      // autocomplete is empty. forceLoadMembers (fork) hits /members directly.
      const ss = (mx as unknown as { getSlidingSync?: () => unknown }).getSlidingSync?.();
      const forceable = room as unknown as { forceLoadMembers?: () => Promise<unknown> };
      const loaded = ss && forceable.forceLoadMembers
        ? forceable.forceLoadMembers()
        : room.loadMembersIfNeeded();
      loaded
        .then(() => {
          loadingMembers = false;
          if (disposed) return;
          updateMemberList();
        })
        .catch(() => {
          // Don't leave the list stuck on "loading" if /members fails.
          loadingMembers = false;
        });
    }

    mx.on(RoomMemberEvent.Membership, updateMemberList);
    mx.on(RoomMemberEvent.PowerLevel, updateMemberList);
    return () => {
      disposed = true;
      mx.removeListener(RoomMemberEvent.Membership, updateMemberList);
      mx.removeListener(RoomMemberEvent.PowerLevel, updateMemberList);
    };
  }, [mx, roomId]);

  return members;
};
