---
name: llm-scoring-reference
description: Domain reference for fashion-monitor's LLM aesthetic scoring — the LLMProvider abstraction (ollama/claude/hybrid/mock), two-pass text→vision scoring, prompt anatomy and the "prompt diet", feedback few-shot injection, YES/MAYBE/NO/PENDING semantics, output parsing, and model/VRAM guidance. Load when working under packages/core/src/llm/ or pipeline/scorer.ts, tuning Taste or prompts, choosing models/providers, or interpreting score behavior. Do NOT load for scraping (resale-platforms-reference), config mechanics (fashion-monitor-config-and-flags), or restoring the feedback loop (fashion-monitor-alerting-feedback-campaign).
---

# LLM Scoring Reference (fashion-monitor)

All claims verified against code on 2026-07-02.

## Vocabulary (CONTEXT.md is canon)

- **Score**: LLM verdict per listing — `YES` / `MAYBE` / `NO`. Both YES and MAYBE alert.
- **PENDING**: pipeline-internal state when the LLM is unreachable; replayed next healthy run. Users never see it as an outcome.
- **Taste**: the aesthetic half of profile config (aesthetic_prompt, hard_no, positive_signals, price ceilings, measurements).
- **Scoring Dimensions**: aesthetic / quality / value — all three appear in every result.
- **Feedback**: positive/negative examples injected as few-shot into the system prompt.
- **Prompt diet**: static Taste + last 15 positive / 15 negative feedback rows (spec/07).

## Provider abstraction

`packages/core/src/llm/provider.ts`:

```ts
interface LLMProvider {
  scoreBatch(listings: PreparedListing[], systemPrompt: string): Promise<ScoringResult[]>;
  scoreWithImage(listing: PreparedListing, systemPrompt: string): Promise<ScoringResult>;
  healthCheck(): Promise<boolean>;
}
```

Four implementations, selected by `createProviderFromConfig(config.llm)` in `llm/factory.ts`:

| Provider | Text pass | Vision pass | Needs |
|---|---|---|---|
| `ollama` | Ollama (`ollama_text_model`, default `qwen2.5:7b`) | Ollama (`ollama_vision_model`) | `llm.ollama_host` reachable |
| `claude` | Claude API (`claude_model`, default `claude-haiku-4-5`) | Claude API | `ANTHROPIC_API_KEY` |
| `hybrid` | Ollama | per `vision_backend: ollama\|claude` (`HybridProvider`, `llm/hybrid.ts`) | both |
| `mock` | deterministic, no network | same | nothing — use for all local/dev/test isolation |

Ollama is called directly at `llm.ollama_host` today. The GPU-broker indirection (docs/adr/0006) is the accepted future direction with a documented known gap — do not claim or code against a broker endpoint yet.

## Two-pass scoring flow (`pipeline/scorer.ts`, exact behavior)

1. `buildSystemPrompt(config, feedbackRepo)` once per run.
2. Listings → `prepareForLLM` → chunks of `llm.batch_size` (default 15, max 30) → `provider.scoreBatch` per chunk. Log event `pipeline.scorer.batch.start` per chunk.
3. **Batch reconciliation** (`reconcileBatchResults`, provider.ts): any listing missing from the LLM's response is forced to `MAYBE` with reason "Missing from LLM batch response" — a malformed batch degrades to MAYBE, never silently drops.
4. Vision pass: every `MAYBE` **with an `image_url`** → `provider.scoreWithImage` (log `pipeline.scorer.vision.start`); its result replaces the text result. MAYBE without image stays MAYBE. Post-vision MAYBE still alerts (signals lower confidence — ADR-008, spec/06-decisions.md).
5. `filterAlertable` = score is `YES` or `MAYBE`.

PENDING is set upstream in the orchestrator when `healthCheck()` fails — unscored listings persist as PENDING in `seen_listings` and are re-fed to the scorer on the next healthy run. Never bulk-clear PENDING; it is the built-in backpressure (also what absorbs "GPU busy" per docs/adr/0006).

## Prompt anatomy (`llm/prompt-builder.ts` + `prompt-template.ts`)

System prompt sections, in order:
1. `SCORING_RUBRIC` (prompt-template.ts) — the fixed rubric.
2. `## Buyer measurements` — formatted from `config.measurements`.
3. `## User aesthetic (primary style guide)` — `aesthetic_prompt` verbatim.
4. `## Additional positive signals from config` — strong/weak lists.
5. `## Hard NO rules from config` — bulleted `hard_no`.
6. `## Your actual preferences (weight these heavily):` — ONLY if feedback rows exist: up to 15 positive ("Items you liked:") + 15 negative ("Items that were wrong:"), each formatted `- [brand] title — description` (truncated 80/100 chars).

User prompt (`buildUserPrompt`): listings as pretty-printed JSON with required output fields listed.

### Prompt-diet reality check (as of 2026-07-02)

- `FeedbackRepo.fetchRecent(signal, 15)` is **pure recency** (`ORDER BY recorded_at DESC LIMIT ?`). CONTEXT.md's "seed entries are permanent anchors that never rotate out" is **design intent with no implementation** — there is no seed/anchor column in the `feedback` table (migration 001). If you implement it, that's a schema change through change control.
- Feedback **ingestion is currently severed** (Telegram bot deleted mid-migration; no API endpoint). The diet's feedback section only reflects historical rows until fashion-monitor-alerting-feedback-campaign restores ingestion. New scoring behavior cannot "learn" right now.

## Output contract (`packages/shared/src/schemas/llm.ts`)

```
{ listing_id, score: YES|MAYBE|NO, quality|value|aesthetic: pass|fail|uncertain,
  size: HIGH|UNCERTAIN|UNLIKELY, reason: string<=200 }
```

`BatchSchema` = array of the above. Parse failures degrade toward MAYBE (`maybeResult` helper: all dimensions "uncertain", reason truncated to 120). Vision parse errors leave the verdict MAYBE (ADR-008).

## Tuning guidance

- Taste is DB-authoritative after first boot (ADR-007) — edit via web UI `PUT /api/taste` or MCP `get_taste`-adjacent flows, NOT config.yaml (see fashion-monitor-config-and-flags for the trap).
- Every Taste/Monitor change writes a `config_revisions` row — use revisions as the changelog for before/after analysis (fashion-monitor-research-methodology).
- Model/VRAM guidance table lives in ADR-008 (spec/06-decisions.md) — dated guidance, re-check before relying: <6GB → hybrid with claude vision; 12–16GB → all-ollama with `llama3.2-vision:11b`; CPU-only → claude.
- Predict numbers before a prompt change: expected yes_rate/alert-precision movement, then measure via scorecard views (v_search_group_scorecard).

## When NOT to use this skill

- Scraper/platform behavior → **resale-platforms-reference**
- Config precedence and .env wiring → **fashion-monitor-config-and-flags**
- Rebuilding feedback ingestion → **fashion-monitor-alerting-feedback-campaign**
- Designing scoring experiments → **fashion-monitor-research-methodology**

## Provenance and maintenance

Verified 2026-07-02 against the uncommitted working tree.

- Interface unchanged: `cat packages/core/src/llm/provider.ts`
- Two-pass flow: `cat packages/core/src/pipeline/scorer.ts` (batch loop, MAYBE+image vision pass, filterAlertable)
- Prompt sections: `cat packages/core/src/llm/prompt-builder.ts`
- Diet still 15/15 recency-only: `grep -n "fetchRecent" packages/core/src/pipeline/scorer.ts packages/core/src/llm/prompt-builder.ts packages/core/src/storage/repos/feedback.ts`
- Seed-anchor still unimplemented: `grep -rn "seed" packages/core/src/storage/repos/feedback.ts packages/core/src/storage/migrations/001_init.sql | grep -i feedback` (no anchor column = still unimplemented)
- Output schema: `cat packages/shared/src/schemas/llm.ts`
- Feedback ingestion still severed: `grep -rni feedback packages/api/src | wc -l` (0 = severed)
