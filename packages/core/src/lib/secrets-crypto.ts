import { randomBytes } from "node:crypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { sha256 } from "@noble/hashes/sha2.js";

const NONCE_BYTES = 24;

/**
 * Derive a 32-byte key from the configured secret material.
 * Accepts a 64-char hex string (used verbatim) or any passphrase (hashed to 32 bytes).
 */
export function deriveKey(material: string): Uint8Array {
  const trimmed = material.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      out[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  return sha256(new TextEncoder().encode(trimmed));
}

export class SecretsCipher {
  private readonly key: Uint8Array;

  constructor(keyMaterial: string) {
    if (!keyMaterial || keyMaterial.trim().length === 0) {
      throw new Error("Secrets encryption key is empty");
    }
    this.key = deriveKey(keyMaterial);
  }

  encrypt(plaintext: string): string {
    const nonce = randomBytes(NONCE_BYTES);
    const aead = xchacha20poly1305(this.key, nonce);
    const ct = aead.encrypt(new TextEncoder().encode(plaintext));
    const packed = new Uint8Array(nonce.length + ct.length);
    packed.set(nonce, 0);
    packed.set(ct, nonce.length);
    return Buffer.from(packed).toString("base64");
  }

  decrypt(packedB64: string): string {
    const packed = new Uint8Array(Buffer.from(packedB64, "base64"));
    const nonce = packed.slice(0, NONCE_BYTES);
    const ct = packed.slice(NONCE_BYTES);
    const aead = xchacha20poly1305(this.key, nonce);
    const pt = aead.decrypt(ct);
    return new TextDecoder().decode(pt);
  }
}

/** Generate a fresh 64-char hex key for first-boot / docs. */
export function generateKeyHex(): string {
  return randomBytes(32).toString("hex");
}
