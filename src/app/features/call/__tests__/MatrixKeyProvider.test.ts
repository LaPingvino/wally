/**
 * Tests that MatrixKeyProvider correctly converts MatrixRTC encryption keys
 * to the format LiveKit's E2EE worker expects.
 *
 * The chain: MatrixRTCSession emits raw Uint8Array keys →
 * MatrixKeyProvider.setEncryptionKey() imports as AES-GCM CryptoKey →
 * onSetEncryptionKey() feeds to LiveKit E2EE worker.
 *
 * If any step corrupts the key material, participants hear encrypted noise.
 */
import { describe, it, expect, vi } from 'vitest';

// We can't import MatrixKeyProvider directly because it extends BaseKeyProvider
// from livekit-client which needs browser APIs. Test the crypto logic standalone.

describe('E2EE key import (MatrixKeyProvider logic)', () => {
  it('imports a 128-bit key as AES-GCM and re-exports to same bytes', async () => {
    // Simulate what MatrixRTCSession sends: 16 random bytes
    const rawKey = new Uint8Array([
      0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
      0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10,
    ]);

    // This is exactly what MatrixKeyProvider.setEncryptionKey does:
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      rawKey.buffer as ArrayBuffer,
      { name: 'AES-GCM', length: 128 },
      true, // exportable for test verification
      ['encrypt', 'decrypt'],
    );

    expect(cryptoKey.algorithm).toMatchObject({ name: 'AES-GCM', length: 128 });
    expect(cryptoKey.type).toBe('secret');
    expect(cryptoKey.usages).toContain('encrypt');
    expect(cryptoKey.usages).toContain('decrypt');

    // Verify the key material survived the import
    const exported = new Uint8Array(await crypto.subtle.exportKey('raw', cryptoKey));
    expect(exported).toEqual(rawKey);
  });

  it('different raw keys produce different CryptoKeys', async () => {
    const key1 = new Uint8Array(16).fill(0xaa);
    const key2 = new Uint8Array(16).fill(0xbb);

    const ck1 = await crypto.subtle.importKey('raw', key1.buffer, { name: 'AES-GCM', length: 128 }, true, ['encrypt', 'decrypt']);
    const ck2 = await crypto.subtle.importKey('raw', key2.buffer, { name: 'AES-GCM', length: 128 }, true, ['encrypt', 'decrypt']);

    const ex1 = new Uint8Array(await crypto.subtle.exportKey('raw', ck1));
    const ex2 = new Uint8Array(await crypto.subtle.exportKey('raw', ck2));

    expect(ex1).not.toEqual(ex2);
  });

  it('AES-GCM encrypt/decrypt roundtrip works with imported key', async () => {
    const rawKey = crypto.getRandomValues(new Uint8Array(16));
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      rawKey.buffer,
      { name: 'AES-GCM', length: 128 },
      false,
      ['encrypt', 'decrypt'],
    );

    const plaintext = new TextEncoder().encode('Hello from MatrixRTC');
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      plaintext,
    );

    const decrypted = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      ciphertext,
    ));

    expect(decrypted).toEqual(plaintext);
  });

  it('key imported from Uint8Array.buffer matches key from ArrayBuffer directly', async () => {
    // MatrixRTCSession gives us Uint8Array; we pass key.buffer to importKey.
    // Verify this doesn't cause offset/length issues with TypedArray views.
    const raw = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

    // Method 1: via .buffer (what MatrixKeyProvider does)
    const ck1 = await crypto.subtle.importKey(
      'raw', raw.buffer as ArrayBuffer, { name: 'AES-GCM', length: 128 }, true, ['encrypt', 'decrypt'],
    );

    // Method 2: directly from Uint8Array (which also works in modern browsers)
    const ck2 = await crypto.subtle.importKey(
      'raw', raw, { name: 'AES-GCM', length: 128 }, true, ['encrypt', 'decrypt'],
    );

    const ex1 = new Uint8Array(await crypto.subtle.exportKey('raw', ck1));
    const ex2 = new Uint8Array(await crypto.subtle.exportKey('raw', ck2));
    expect(ex1).toEqual(ex2);
  });

  it('DANGER: sliced Uint8Array.buffer passes the WHOLE underlying buffer', async () => {
    // This test documents a known footgun: if MatrixRTCSession creates
    // the key as a slice/subarray of a larger buffer, passing .buffer
    // gives the entire underlying ArrayBuffer, not just the slice.
    // This would corrupt the key material!
    const bigBuffer = new Uint8Array(32);
    bigBuffer.set([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x11, 0x22,
                   0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0x00], 0);
    bigBuffer.set([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
                   0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10], 16);

    // Simulate a key that's a view into bytes 16-31
    const keySlice = bigBuffer.subarray(16, 32);
    expect(keySlice.length).toBe(16);
    expect(keySlice.buffer.byteLength).toBe(32); // ← the whole buffer!

    // Using .buffer passes 32 bytes, not 16 — importKey would get wrong data
    // (or fail if length doesn't match the specified AES key length)
    // The SAFE way is to use the Uint8Array directly or slice the buffer:
    const safeKey = await crypto.subtle.importKey(
      'raw',
      keySlice.buffer.slice(keySlice.byteOffset, keySlice.byteOffset + keySlice.byteLength),
      { name: 'AES-GCM', length: 128 },
      true,
      ['encrypt', 'decrypt'],
    );
    const exported = new Uint8Array(await crypto.subtle.exportKey('raw', safeKey));
    expect(exported).toEqual(keySlice);
  });
});
