import type { Db } from "../db.js";
import type { SecretsCipher } from "@preston-bernstein/credential-crypto";

export interface SecretMeta {
  key: string;
  updated_at: string;
  updated_by: number | null;
}

/**
 * Encrypted-at-rest secret store. Plaintext never persists; only authorized
 * callers (secrets:write) decrypt values. `list()` returns metadata only.
 */
export class ProfileSecretsRepo {
  constructor(
    private readonly db: Db,
    private readonly profileId: string,
    private readonly cipher: SecretsCipher,
  ) {}

  list(): SecretMeta[] {
    return this.db
      .prepare(
        `SELECT key, updated_at, updated_by FROM profile_secrets
         WHERE profile_id = ? ORDER BY key`,
      )
      .all(this.profileId) as SecretMeta[];
  }

  has(key: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM profile_secrets WHERE profile_id = ? AND key = ?`)
      .get(this.profileId, key);
    return row !== undefined;
  }

  get(key: string): string | undefined {
    const row = this.db
      .prepare(`SELECT ciphertext FROM profile_secrets WHERE profile_id = ? AND key = ?`)
      .get(this.profileId, key) as { ciphertext: string } | undefined;
    if (!row) return undefined;
    return this.cipher.decrypt(row.ciphertext);
  }

  getAll(): Record<string, string> {
    const rows = this.db
      .prepare(`SELECT key, ciphertext FROM profile_secrets WHERE profile_id = ?`)
      .all(this.profileId) as Array<{ key: string; ciphertext: string }>;
    const out: Record<string, string> = {};
    for (const row of rows) {
      out[row.key] = this.cipher.decrypt(row.ciphertext);
    }
    return out;
  }

  set(key: string, plaintext: string, updatedAt: string, updatedBy: number | null): void {
    const ciphertext = this.cipher.encrypt(plaintext);
    this.db
      .prepare(
        `INSERT INTO profile_secrets (profile_id, key, ciphertext, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(profile_id, key) DO UPDATE SET
           ciphertext = excluded.ciphertext,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
      )
      .run(this.profileId, key, ciphertext, updatedAt, updatedBy);
  }

  remove(key: string): void {
    this.db
      .prepare(`DELETE FROM profile_secrets WHERE profile_id = ? AND key = ?`)
      .run(this.profileId, key);
  }
}
