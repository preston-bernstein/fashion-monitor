# Secrets stored encrypted in DB, not in .env

Platform credentials and Telegram tokens are encrypted at rest in the `profile_secrets` table using XChaCha20-Poly1305. The encryption key is the only secret in `.env`. This allows per-profile secrets to be managed through the web UI (by users with secrets:write) without plaintext ever persisting, without `.env` growing per-profile, and without the operator needing to see another user's credentials. A flat `.env` approach would not support multi-profile secret isolation.
