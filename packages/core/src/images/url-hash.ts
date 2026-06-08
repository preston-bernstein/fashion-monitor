import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export function normalizeImageUrl(url: string): string {
  return url.trim();
}

export function hashImageUrl(url: string): string {
  const normalized = normalizeImageUrl(url);
  return bytesToHex(sha256(new TextEncoder().encode(normalized)));
}
