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
   *
   * IMPORTANT: LiveKit's E2EE worker calls deriveKeys() on the key material,
   * using HKDF to derive the actual AES-GCM encryption key. So we must import
   * as HKDF key material (with deriveBits/deriveKey usages), NOT as an AES-GCM
   * key. Importing as AES-GCM would fail silently when the worker tries HKDF
   * derivation, resulting in silence (no decryption).
   */
  async setEncryptionKey(key: Uint8Array, keyIndex: number, participantIdentity: string): Promise<void> {
    callDebug('e2ee', 'Setting encryption key', { participantIdentity, keyIndex, keyLength: key.byteLength });
    try {
      // Import as HKDF key material — LiveKit's E2EE worker calls deriveKeys()
      // to derive the actual AES-GCM encryption key via HKDF.
      // Pass the Uint8Array directly (not .buffer) — matches Element Call's
      // implementation exactly. crypto.subtle.importKey handles Uint8Array
      // natively and respects byteOffset/byteLength correctly.
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        key,
        'HKDF',
        false,
        ['deriveBits', 'deriveKey'],
      );
      this.onSetEncryptionKey(cryptoKey, participantIdentity, keyIndex);
    } catch (e) {
      callDebug('e2ee', 'Failed to import encryption key', e);
    }
  }
}
