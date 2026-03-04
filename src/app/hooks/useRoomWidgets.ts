import { useEffect, useState } from 'react';
import { Direction, Room, RoomStateEvent } from 'matrix-js-sdk';

export type RoomWidget = {
  id: string;
  type: string;
  url: string;
  name: string;
  data?: Record<string, unknown>;
  avatarUrl?: string;
};

const WIDGET_STATE_EVENT = 'im.vector.modular.widgets';

function getWidgets(room: Room): RoomWidget[] {
  const state = room.getLiveTimeline().getState(Direction.Forward);
  if (!state) return [];
  const events = state.getStateEvents(WIDGET_STATE_EVENT);
  return events
    .filter((ev) => {
      if (!ev.getContent()?.url) return false; // empty url = widget removed
      return true;
    })
    .map((ev) => ({
      id: ev.getStateKey() ?? '',
      type: ev.getContent().type ?? 'm.custom',
      url: ev.getContent().url ?? '',
      name: ev.getContent().name ?? 'Widget',
      data: ev.getContent().data,
      avatarUrl: ev.getContent().avatar_url,
    }));
}

export function useRoomWidgets(room: Room): RoomWidget[] {
  const [widgets, setWidgets] = useState<RoomWidget[]>(() => getWidgets(room));

  useEffect(() => {
    const refresh = () => setWidgets(getWidgets(room));
    room.on(RoomStateEvent.Events, refresh);
    return () => {
      room.off(RoomStateEvent.Events, refresh);
    };
  }, [room]);

  return widgets;
}
