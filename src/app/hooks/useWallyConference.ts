import { Room } from 'matrix-js-sdk';
import { useMemo } from 'react';
import { useStateEvent } from './useStateEvent';
import { StateEvent } from '../../types/matrix/room';

export type WallyConferenceState = {
  available: boolean;
  endpoint: string | null;
  features: string[];
};

export const useWallyConference = (room: Room): WallyConferenceState => {
  const event = useStateEvent(room, StateEvent.WallyConference);

  return useMemo(() => {
    if (!event) {
      return { available: false, endpoint: null, features: [] };
    }
    const content = event.getContent<{ endpoint?: string; features?: string[] }>();
    return {
      available: true,
      endpoint: content.endpoint ?? null,
      features: Array.isArray(content.features) ? content.features : [],
    };
  }, [event]);
};
