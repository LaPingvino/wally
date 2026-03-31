/**
 * Bridges MatrixRTC encryption keys to LiveKit's E2EE system.
 *
 * MatrixRTCSession emits EncryptionKeyChanged with per-participant keys.
 * This KeyProvider feeds those keys to LiveKit's E2EE worker.
 */
import { BaseKeyProvider } from 'livekit-client';
import { callDebug } from './callDebug';

export class MatrixKeyProvider extends BaseKeyProvider {
  constructor() {
    super({ sharedKey: false, ratchetWindowSize: 0, failureTolerance: -1, keyringSize: 256 });
  }

  /**
   * Called by our bridge code when MatrixRTCSession emits an encryption key.
   * Converts the raw key bytes to a CryptoKey and feeds it to LiveKit.
   */
  async setEncryptionKey(key: Uint8Array, keyIndex: number, participantIdentity: string): Promise<void> {
    callDebug('e2ee', 'Setting encryption key', { participantIdentity, keyIndex, keyLength: key.byteLength });
    try {
      // Use slice() to get exactly the key bytes — key.buffer would pass the
      // entire underlying ArrayBuffer if key is a view/subarray, silently
      // corrupting the imported key material.
      const keyBytes = key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength);
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'AES-GCM', length: 128 },
        false,
        ['encrypt', 'decrypt'],
      );
      this.onSetEncryptionKey(cryptoKey, participantIdentity, keyIndex);
    } catch (e) {
      callDebug('e2ee', 'Failed to import encryption key', e);
    }
  }
}
