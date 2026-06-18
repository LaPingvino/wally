import { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { CryptoBackend } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import React, { useCallback, useState } from 'react';
import { Box, Icon, IconButton, Icons, Spinner, color, config } from 'folds';
import { MessageEvent } from '../../../../types/matrix/room';

const warningStyle = { color: color.Warning.Main, opacity: config.opacity.P300 };

type RetryState = 'idle' | 'checking' | 'failed';

type RetryDecryptContentProps = {
  mx: MatrixClient;
  mEvent: MatrixEvent;
};

/**
 * Placeholder for an event that hasn't decrypted yet, with a button to retry now.
 *
 * Wally runs rust-crypto, which already auto-retries decryption when a key arrives and kicks a
 * key-backup fetch on the first failure. So this button isn't the only thing that can decrypt the
 * message — but clicking it re-runs decryption, which re-enters the decryption-failure path and
 * re-kicks the per-session key-backup download. That genuinely helps when the key is in backup but
 * the earlier fetch failed/was throttled, and it gives the user an immediate, honest signal
 * (spinner → the message appears, or "key unavailable") instead of a silent wait.
 *
 * NOTE: we call `attemptDecryption` directly, NOT `mx.decryptEventIfNeeded`. A failed UTD has its
 * `clearEvent` set to the failure placeholder, so `shouldAttemptDecryption()` returns false and
 * `decryptEventIfNeeded` is a silent no-op on exactly the events we care about. `attemptDecryption`
 * re-attempts because its guard is `clearEvent && !isDecryptionFailure()` — false for a UTD. This is
 * the same call the SDK's own auto-retry (onRoomKeyUpdated) uses.
 *
 * On success the event's type flips away from RoomMessageEncrypted; the surrounding
 * `EncryptedContent` listens for MatrixEventEvent.Decrypted and re-renders the real message,
 * unmounting this component — so we only ever land back in a visible state when it's still encrypted.
 */
export function RetryDecryptContent({ mx, mEvent }: RetryDecryptContentProps) {
  const [state, setState] = useState<RetryState>('idle');

  const handleRetry = useCallback(() => {
    setState('checking');
    mEvent
      .attemptDecryption(mx.getCrypto() as CryptoBackend, { isRetry: true })
      .catch(() => undefined)
      .finally(() => {
        // If it decrypted, EncryptedContent unmounts us before this matters; if we're still
        // encrypted the key wasn't available, so surface that and let the user try again.
        if (mEvent.getType() === MessageEvent.RoomMessageEncrypted) {
          setState('failed');
        }
      });
  }, [mx, mEvent]);

  return (
    <Box as="span" alignItems="Center" gap="100" style={warningStyle}>
      <Icon size="50" src={Icons.Lock} />
      <i>{state === 'failed' ? 'Key unavailable — tap to retry' : 'This message is not decrypted yet'}</i>
      {state === 'checking' ? (
        <Spinner size="50" variant="Warning" fill="Soft" aria-label="Checking for keys" />
      ) : (
        <IconButton
          as="button"
          size="300"
          radii="300"
          variant="Background"
          fill="None"
          onClick={handleRetry}
          aria-label="Retry decryption"
          title="Retry decryption"
        >
          <Icon size="50" src={Icons.Reload} />
        </IconButton>
      )}
    </Box>
  );
}
