import { useEffect, useReducer } from 'react';
import { RoomEvent } from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';

export function useFavoriteRooms(roomIds: string[]): string[] {
  const mx = useMatrixClient();
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    mx.on(RoomEvent.Tags, rerender);
    return () => { mx.off(RoomEvent.Tags, rerender); };
  }, [mx]);

  return roomIds.filter((id) => !!mx.getRoom(id)?.tags['m.favourite']);
}
