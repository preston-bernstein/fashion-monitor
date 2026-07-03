#!/usr/bin/env bash
# Prompt-diet feedback status: how many positive/negative examples feed the
# scoring prompt (15/15 most recent are injected). Zero recent rows = the
# feedback loop is starved (known severed state as of 2026-07-02).
# Usage: feedback-diet.sh [db_path]   (default: data/fashion_monitor.db)
set -euo pipefail
DB="${1:-data/fashion_monitor.db}"
[ -f "$DB" ] || { echo "DB not found: $DB" >&2; exit 1; }
sqlite3 -readonly -header -column "$DB" "
SELECT profile_id, signal, COUNT(*) AS total, MAX(recorded_at) AS newest
FROM feedback GROUP BY profile_id, signal;"
echo "--- current diet (what the prompt will actually include) ---"
sqlite3 -readonly -header -column "$DB" "
SELECT signal, brand, substr(title,1,40) AS title, recorded_at
FROM v_prompt_diet_feedback
ORDER BY recorded_at DESC LIMIT 30;"
