import { useState, useCallback } from 'react';
import { AccountDataEvents } from 'matrix-js-sdk';
import { AccountDataEvent } from '../../types/matrix/accountData';
import { useMatrixClient } from './useMatrixClient';
import { useAccountDataCallback } from './useAccountDataCallback';

// Accept a known account-data event type (the AccountDataEvent enum) or a secret-
// storage key event type — previously a bare `string`, which let any typo'd or wrong
// event type through unchecked. The internal cast bridges the enum to the SDK's keyed
// AccountDataEvents map (the enum values ARE valid keys at runtime).
export function useAccountData(eventType: AccountDataEvent | `m.secret_storage.key.${string}`) {
  const mx = useMatrixClient();
  const [event, setEvent] = useState(() => mx.getAccountData(eventType as keyof AccountDataEvents));

  useAccountDataCallback(
    mx,
    useCallback(
      (evt) => {
        if (evt.getType() === eventType) {
          setEvent(evt);
        }
      },
      [eventType, setEvent]
    )
  );

  return event;
}
