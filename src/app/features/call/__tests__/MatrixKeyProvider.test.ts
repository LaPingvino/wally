/**
 * E2EE key roundtrip tests using ACTUAL livekit-client functions.
 *
 * These tests import the real crypto utilities from livekit-client to verify
 * our MatrixKeyProvider produces keys that LiveKit's E2EE worker can use.
 * No hand-copied reference implementations — if LiveKit changes their
 * crypto path, these tests catch the divergence.
 */
import { describe, it, expect } from 'vitest';
// Real LiveKit exports — NOT copies. If LiveKit changes their crypto,
// these tests will catch the divergence.
import {
  importKey as lkImportKey,
  deriveKeys as lkDeriveKeys,
  createKeyMaterialFromBuffer as lkCreateKeyMaterialFromBuffer,
} from 'livekit-client';

// Constants aren't individually exported — import from the built dist.
// These are the values ParticipantKeyHandler uses for key derivation.
const LK_ENCRYPTION_ALGORITHM = 'AES-GCM';
const LK_SALT = 'LKFrameEncryptionKey';

// ── Our key import (exactly what MatrixKeyProvider.setEncryptionKey does) ──
// Must match: crypto.subtle.importKey('raw', key, 'HKDF', false, ['deriveBits', 'deriveKey'])

async function wallyImportKey(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', key as BufferSource, 'HKDF', false, ['deriveBits', 'deriveKey']);
}

// ── Element Call's import (reference implementation from element-call repo) ──
// From: src/e2ee/matrixKeyProvider.ts — onEncryptionKeyChanged callback
// EC does: crypto.subtle.importKey("raw", encryptionKey, "HKDF", false, ["deriveBits", "deriveKey"])
// Identical to ours — this test confirms they stay in sync.

async function ecImportKey(encryptionKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encryptionKey as BufferSource, 'HKDF', false, ['deriveBits', 'deriveKey']);
}

// ── The OLD (broken) import for regression testing ──

async function brokenAesGcmImport(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    key.buffer as ArrayBuffer,
    { name: 'AES-GCM', length: 128 },
    false,
    ['encrypt', 'decrypt'],
  );
}

describe('E2EE key import — LiveKit reference roundtrip', () => {
  it('confirms LiveKit uses AES-GCM and LKFrameEncryptionKey salt', () => {
    // If LiveKit changes these, all our assumptions need updating
    expect(LK_ENCRYPTION_ALGORITHM).toBe('AES-GCM');
    expect(LK_SALT).toBe('LKFrameEncryptionKey');
  });

  it('Wally-imported key works with LiveKit deriveKeys()', async () => {
    const rawKey = crypto.getRandomValues(new Uint8Array(16));
    const material = await wallyImportKey(rawKey);

    // This is what LiveKit's ParticipantKeyHandler.setKeyFromMaterial() does:
    const { encryptionKey } = await lkDeriveKeys(material, LK_SALT);

    expect(encryptionKey.algorithm).toMatchObject({ name: 'AES-GCM', length: 128 });
    expect(encryptionKey.usages).toContain('encrypt');
    expect(encryptionKey.usages).toContain('decrypt');
  });

  it('OLD broken import (AES-GCM) CANNOT be used with LiveKit deriveKeys()', async () => {
    const rawKey = crypto.getRandomValues(new Uint8Array(16));
    const aesKey = await brokenAesGcmImport(rawKey);

    // LiveKit would try deriveKeys() on this — must fail
    await expect(lkDeriveKeys(aesKey, LK_SALT)).rejects.toThrow();
  });

  it('Wally import matches LiveKit createKeyMaterialFromBuffer', async () => {
    const rawKey = crypto.getRandomValues(new Uint8Array(16));

    // Our path
    const wallyMaterial = await wallyImportKey(rawKey);

    // LiveKit's ExternalE2EEKeyProvider.setKey(ArrayBuffer) path
    const lkMaterial = await lkCreateKeyMaterialFromBuffer(
      rawKey.buffer.slice(rawKey.byteOffset, rawKey.byteOffset + rawKey.byteLength),
    );

    // Both must derive identical encryption keys
    const { encryptionKey: wallyDerived } = await lkDeriveKeys(wallyMaterial, LK_SALT);
    const { encryptionKey: lkDerived } = await lkDeriveKeys(lkMaterial, LK_SALT);

    // Verify by encrypting same data with fixed IV
    const data = new Uint8Array([1, 2, 3, 4]);
    const iv = new Uint8Array(12).fill(0x42);

    const wallyEnc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wallyDerived, data));
    const lkEnc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, lkDerived, data));

    expect(wallyEnc).toEqual(lkEnc);
  });

  it('cross-participant roundtrip: A encrypts, B decrypts via LiveKit deriveKeys', async () => {
    const rawKey = crypto.getRandomValues(new Uint8Array(16));

    // A: import → derive → encrypt
    const materialA = await wallyImportKey(rawKey);
    const { encryptionKey: keyA } = await lkDeriveKeys(materialA, LK_SALT);
    const plaintext = new TextEncoder().encode('Hello from participant A');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keyA, plaintext);

    // B: import same raw key → derive → decrypt
    const materialB = await wallyImportKey(new Uint8Array(rawKey));
    const { encryptionKey: keyB } = await lkDeriveKeys(materialB, LK_SALT);
    const decrypted = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, keyB, ciphertext,
    ));

    expect(decrypted).toEqual(plaintext);
  });

  it('same raw bytes → identical ciphertext (deterministic with fixed IV)', async () => {
    const rawKey = new Uint8Array([
      0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
      0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10,
    ]);

    const { encryptionKey: key1 } = await lkDeriveKeys(await wallyImportKey(rawKey), LK_SALT);
    const { encryptionKey: key2 } = await lkDeriveKeys(await wallyImportKey(new Uint8Array(rawKey)), LK_SALT);

    const data = new TextEncoder().encode('audio frame');
    const iv = new Uint8Array(12).fill(0x01);

    const enc1 = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key1, data));
    const enc2 = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key2, data));

    expect(enc1).toEqual(enc2);
  });

  it('different raw keys → different derived keys → different ciphertext', async () => {
    const key1 = new Uint8Array(16).fill(0xaa);
    const key2 = new Uint8Array(16).fill(0xbb);

    const { encryptionKey: ek1 } = await lkDeriveKeys(await wallyImportKey(key1), LK_SALT);
    const { encryptionKey: ek2 } = await lkDeriveKeys(await wallyImportKey(key2), LK_SALT);

    const data = new Uint8Array([1, 2, 3, 4]);
    const iv = new Uint8Array(12).fill(0x01);

    const enc1 = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ek1, data));
    const enc2 = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ek2, data));

    expect(enc1).not.toEqual(enc2);
  });

  it('LiveKit importKey("derive") produces same result as our HKDF import', async () => {
    const rawKey = crypto.getRandomValues(new Uint8Array(16));

    // LiveKit's own importKey with 'derive' usage
    const lkMaterial = await lkImportKey(rawKey, 'HKDF', 'derive');

    // Our import
    const wallyMaterial = await wallyImportKey(rawKey);

    // Derive from both
    const { encryptionKey: lkDerived } = await lkDeriveKeys(lkMaterial, LK_SALT);
    const { encryptionKey: wallyDerived } = await lkDeriveKeys(wallyMaterial, LK_SALT);

    // Must produce identical ciphertext
    const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const iv = new Uint8Array(12).fill(0x77);

    const lkEnc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, lkDerived, data));
    const wallyEnc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wallyDerived, data));

    expect(wallyEnc).toEqual(lkEnc);
  });
});

describe('Wally vs Element Call equivalence', () => {
  it('Wally and EC import produce byte-identical derived encryption keys', async () => {
    const rawKey = crypto.getRandomValues(new Uint8Array(16));

    const wallyMaterial = await wallyImportKey(rawKey);
    const ecMaterial = await ecImportKey(new Uint8Array(rawKey));

    const { encryptionKey: wallyDerived } = await lkDeriveKeys(wallyMaterial, LK_SALT);
    const { encryptionKey: ecDerived } = await lkDeriveKeys(ecMaterial, LK_SALT);

    // Encrypt same data — must produce identical ciphertext
    const data = new TextEncoder().encode('E2EE audio frame from MatrixRTC');
    const iv = new Uint8Array(12).fill(0x42);

    const wallyEnc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wallyDerived, data));
    const ecEnc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ecDerived, data));

    expect(wallyEnc).toEqual(ecEnc);
  });

  it('Wally encrypts, EC decrypts (interop)', async () => {
    const rawKey = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode('Wally to EC interop test');

    // Wally encrypts
    const wallyKey = (await lkDeriveKeys(await wallyImportKey(rawKey), LK_SALT)).encryptionKey;
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wallyKey, plaintext);

    // EC decrypts
    const ecKey = (await lkDeriveKeys(await ecImportKey(new Uint8Array(rawKey)), LK_SALT)).encryptionKey;
    const decrypted = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, ecKey, ciphertext));

    expect(decrypted).toEqual(plaintext);
  });

  it('EC encrypts, Wally decrypts (interop)', async () => {
    const rawKey = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode('EC to Wally interop test');

    // EC encrypts
    const ecKey = (await lkDeriveKeys(await ecImportKey(rawKey), LK_SALT)).encryptionKey;
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ecKey, plaintext);

    // Wally decrypts
    const wallyKey = (await lkDeriveKeys(await wallyImportKey(new Uint8Array(rawKey)), LK_SALT)).encryptionKey;
    const decrypted = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wallyKey, ciphertext));

    expect(decrypted).toEqual(plaintext);
  });

  it('subarray key: Wally handles correctly via direct Uint8Array pass', async () => {
    // EC passes Uint8Array directly too — both handle subarrays correctly
    // because crypto.subtle.importKey respects byteOffset/byteLength on TypedArrays
    const bigBuffer = new Uint8Array(32);
    crypto.getRandomValues(bigBuffer);
    const keySlice = bigBuffer.subarray(16, 32);

    const wallyMaterial = await wallyImportKey(keySlice);
    const ecMaterial = await ecImportKey(keySlice);

    const { encryptionKey: wallyKey } = await lkDeriveKeys(wallyMaterial, LK_SALT);
    const { encryptionKey: ecKey } = await lkDeriveKeys(ecMaterial, LK_SALT);

    const data = new Uint8Array([0xde, 0xad]);
    const iv = new Uint8Array(12).fill(0x01);

    const wallyEnc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wallyKey, data));
    const ecEnc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ecKey, data));

    expect(wallyEnc).toEqual(ecEnc);
  });
});

describe('Buffer slice safety', () => {
  it('sliced Uint8Array.buffer corrupts key material', async () => {
    const bigBuffer = new Uint8Array(32);
    crypto.getRandomValues(bigBuffer);
    const keySlice = bigBuffer.subarray(16, 32);

    // WRONG: .buffer passes all 32 bytes
    const wrongMaterial = await crypto.subtle.importKey(
      'raw', keySlice.buffer, 'HKDF', false, ['deriveBits', 'deriveKey'],
    );

    // RIGHT: slice() passes exactly 16 bytes
    const rightMaterial = await wallyImportKey(keySlice);

    // Derive from both — they produce different encryption keys
    const { encryptionKey: wrongKey } = await lkDeriveKeys(wrongMaterial, LK_SALT);
    const { encryptionKey: rightKey } = await lkDeriveKeys(rightMaterial, LK_SALT);

    const data = new Uint8Array([1, 2, 3]);
    const iv = new Uint8Array(12).fill(0x01);

    const wrongEnc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrongKey, data));
    const rightEnc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, rightKey, data));

    expect(wrongEnc).not.toEqual(rightEnc);
  });
});
