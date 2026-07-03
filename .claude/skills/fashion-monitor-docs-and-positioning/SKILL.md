---
name: fashion-monitor-docs-and-positioning
description: >-
  Documentation-of-record map, vocabulary discipline, ADR/plan house style with
  copy-paste templates, and public-repo positioning rules for fashion-monitor.
  Load when writing or editing any doc in this repo (CONTEXT.md, spec/, docs/adr/,
  docs/plans/, README.md), when deciding where a new decision/term/runbook belongs,
  when two docs conflict and precedence must be resolved, or when drafting external
  claims about what the project does (README, portfolio copy). Do NOT load for
  gating whether a change is allowed (fashion-monitor-change-control), for research
  claims and open problems (fashion-monitor-research-frontier), or for debugging or
  running the system.
---

# Fashion Monitor — Docs of Record and Positioning

This skill governs how documentation is written in this repo and what the public
repo may claim about itself. The repo is PUBLIC (ADR-010 in `spec/06-decisions.md`)
— every doc you write is portfolio copy.

## Docs-of-record map and precedence

When two documents conflict, higher rows win:

| Rank | Document | Role | Status discipline |
|---|---|---|---|
| 1 | `CONTEXT.md` | Vocabulary canon (Monitor, Taste, User, Invite, Profile, Role, Score, Query Override, Secret, Connection, Pipeline, Scoring Dimensions, Feedback, Default Searches — plus the "Interface hierarchy" design axiom) | Canonical. Every noun entry has an explicit **Avoid** list. |
| 2 | `docs/adr/000N-*.md` | Accepted decisions — the CURRENT ADR home | Newer `docs/adr/` files supersede same-topic entries in `spec/06-decisions.md`. As of 2026-07-02: 0001–0006; 0003–0006 are untracked (in-flight working tree). |
| 3 | `spec/01..08` | Design intent | Status Draft (per `spec/README.md` status table). Has known stale spots — see the stale-docs register below. |
| 4 | `docs/plans/*.md` | Proposals / analysis | Not decisions until captured in an ADR. |

Supporting docs (not decision-bearing, still docs of record for their topic):
`docs/SMOKE.md`, `docs/web-app.md`, `docs/analytics.md`, `docs/logging-and-audit.md`,
`docs/playwright-stealth-pilot.md` (carries a "do not remove yet" fence on
playwright-extra+stealth), `README.md` (public front door).

### The two ADR homes

- `spec/06-decisions.md` — the LEGACY ADR home (ADR-001..011, prose sections in
  one file). Do not add new ADRs here.
- `docs/adr/` — the current home. One decision per numbered file
  (`0001-mcp-as-primary-interface.md` … `0006-inference-via-shared-gpu-broker.md`).
  New ADRs take the next number.

**Live example of why precedence matters (as of 2026-07-02):** ADR-011 in
`spec/06-decisions.md` says "ntfy.sh is not used" — but the uncommitted working
tree is mid Telegram→ntfy migration (`packages/core/src/alerts/telegram.ts`
deleted, `ntfy.ts` added, orchestrator imports `createNtfyAlerter`,
`config.example.yaml` alert block is ntfy). When the migration lands, it needs a
new `docs/adr/000N` ADR that explicitly supersedes ADR-011; until then, treat
ADR-011 as contradicted-in-flight, not authoritative. The migration campaign
itself is `fashion-monitor-alerting-feedback-campaign`.

## Vocabulary discipline (CONTEXT.md)

`CONTEXT.md` is the language canon. Skills, docs, code identifiers, commit
messages, and UI copy use the canonical term; the **Avoid** list under each entry
names the forbidden synonyms. Examples:

- Say **Monitor**, never "Search Group" / "Saved Search" — even though the DB
  table is `search_groups` (migrations 012/013 renamed the table; the canonical
  *term* stayed Monitor).
- Say **Taste**, never "Aesthetic" / "Preferences".
- Say **Score** (YES/MAYBE/NO), never "Rating" / "Verdict".
- Say **Connection**, never "Integration" / "Account".

If you need a word that is on an Avoid list, either use the canonical term or —
if it is genuinely a new concept — add a new CONTEXT.md entry (template below)
through change control. Never silently introduce a synonym in a doc.

## House style (observed, follow it)

- **ADRs** (`docs/adr/`): short titled prose. A `#` title stating the decision as
  a sentence, then one or a few paragraphs covering decision + context + why +
  rejected alternatives. Bold key terms. Optional `**Status:**` line when the
  decision has caveats (see `0006-inference-via-shared-gpu-broker.md`).
- **Plans** (`docs/plans/`): open with a status header. Observed pattern:
  `**Status:** Planned. Output of a grilling session (YYYY-MM-DD). Decisions
  captured in ADRs 000N–000M; vocabulary in CONTEXT.md (...).`
  (see `docs/plans/self-service-onboarding.md`). Analysis-only plans state scope:
  "Analysis and planning only — no code, dependencies, configuration, or git
  state changed" (see `stack-modernization.md`, `monorepo-workspaces.md`).
- **CONTEXT.md entries**: `**Term**:` line, one-paragraph definition, `_Avoid_:`
  list. No headings per term.

### ADR template (copy-paste into `docs/adr/000N-kebab-title.md`)

```markdown
# <Decision stated as a sentence, e.g. "Alerts are delivered via X, not Y">

**Status: accepted — <caveat / known gap if any>.**  <!-- omit line if none -->

<Context: what problem forced a decision, what the state was before.>
<Decision and why: the chosen approach, bolding key terms, with the concrete
mechanics that make it work in this codebase (table names, config keys, states).>
<Rejected alternatives: "We rejected X because ...; and Y because ...".>
<If this supersedes an earlier decision, say so explicitly:
"Supersedes ADR-011 in spec/06-decisions.md.">
```

### CONTEXT.md entry template

```markdown
**Term**:
One-paragraph definition in canon vocabulary. State what it is, what it is not,
and any load-bearing behavior (e.g. lifecycle, scoping by profile_id).
_Avoid_: Synonym1, Synonym2, Synonym3
```

## Writing rules (all docs, all the time)

1. **No AI/agent attribution anywhere.** `.cursor/rules/no-agent-attribution.mdc`
   is absolute: no Co-authored-by, no "Generated by" comments, no agent credit in
   docs or changelogs. Human owner owns all authorship.
2. **Date-stamp volatile claims.** Anything that can drift (versions, "currently
   broken", "in-flight", counts, measurements) gets "as of YYYY-MM-DD".
3. **Canonical vocabulary** per CONTEXT.md (section above).
4. **Committed vs working-tree state.** While a migration is in flight, docs that
   must describe reality describe BOTH states explicitly ("committed: X;
   working tree as of DATE: Y").
5. **Where new knowledge goes:**

| New knowledge | Home |
|---|---|
| Decision (chose A over B) | New ADR in `docs/adr/` |
| New/changed term | `CONTEXT.md` entry (with Avoid list) |
| Incident, dead end, revert, investigation | `fashion-monitor-failure-archaeology` skill |
| Runbook / how-to for agents | `.claude/skills/*` (the relevant sibling skill) |
| Proposal not yet decided | `docs/plans/` with a Status header |
| Design intent for a subsystem | `spec/` (and keep `spec/README.md` index in sync) |

## Stale-docs register (as of 2026-07-02)

Known-stale spots. This is a REGISTER only — fixing them is repo-write work
outside this skill's scope (skills may only write under `.claude/skills/`).
If you edit near one of these, do not propagate the stale claim.

| Doc | Stale claim | Reality |
|---|---|---|
| `spec/README.md` (Code layout) | "Implementation lives under `src/`" | pnpm+Turborepo monorepo: `packages/*`, `apps/*`, `services/*` |
| `spec/README.md` (index + status tables) | No rows for 07/08 | `spec/07-search-intelligence.md` and `spec/08-mcp-interactive.md` exist |
| `docs/SMOKE.md` | `npm ci` / `npm run ...` commands | Repo is a pnpm workspace (`packageManager` pnpm@9.15, Node >= 24); local truth is `pnpm install`, `pnpm test`, etc. Same mismatch exists in `.github/workflows/*` — a known weak point, do not fix ad hoc |
| `CONTEXT.md` | "alerts the owner via Telegram" (header), Profile "alert destination (Telegram chat)", Feedback "Telegram replies" (4 refs) | Working tree is mid Telegram→ntfy migration; feedback ingestion currently severed |
| `Makefile` (sync target) | Echoes `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` env hints | Alert config is ntfy in the working tree |
| `spec/06-decisions.md` ADR-011 | "ntfy.sh is not used" | Contradicted by the in-flight migration (see precedence section) |

## External positioning — what the public repo may claim

Source decision: ADR-010 (`spec/06-decisions.md`). The repo is a public portfolio
showcase; CI is lint + typecheck + unit tests with mocked providers; the scraper
never runs on GitHub runners.

**Reproducibility standard:** a claim enters README.md (or any public-facing copy)
only when there is a runnable command or committed evidence behind it. If a
reviewer cannot reproduce or inspect it in the repo, it is not claimable.

### Legitimately claimable now (verified in code as of 2026-07-02)

- `LLMProvider` abstraction with swappable Ollama/Claude/Hybrid implementations
  (`packages/core/src/llm/`).
- Two-pass scoring: text batch, then vision only for MAYBE items with an image
  (ADR-008; `packages/core/src/pipeline/scorer.ts`).
- Multi-platform scraping (eBay, Grailed, Vestiaire, Depop, Poshmark) with
  graceful per-platform degradation and tiered access methods (ADR-0004).
- RBAC web app: login, five Roles, DB-backed editable config, audit log.
- MCP server as primary interface (ADR-0001; `services/mcp-server`, 4 tools).

### NOT claimable without new proof (as of 2026-07-02)

| Claim | Why blocked |
|---|---|
| "Feedback/learning loop improves precision" | Feedback INGESTION is severed: `apps/cli/src/feedback-bot.ts` is a stub, no feedback endpoint in `packages/api/src`, ntfy has no reply loop. Injection machinery exists, but no new signal can arrive. Say "few-shot feedback injection (ingestion path in migration)" at most. |
| "Multi-profile" | ADR-0005 accepted but implementation in-flight (Phase 1 of `docs/plans/self-service-onboarding.md`). |
| ">60% alert precision" | spec/01 target, not a measured public result. No committed evidence. |
| "GPU broker integration" | ADR-0006 known gap: deployed broker does not front Ollama's HTTP API; code calls `llm.ollama_host` directly, `PENDING` replay absorbs outages. |

### Keep-out list (never in the public repo)

`.env` · personal `config.yaml` (ship `config.example.yaml` only) · `data/`
(SQLite DB) · the Poshmark browser profile (`data/poshmark-profile`). Also (per
skill-authoring convention): no private LAN IPs, hostnames, or home-network
topology in docs or skills — refer generically ("the NAS host in Makefile
`NAS_HOST`", "the Ollama host in `llm.ollama_host`").

## When NOT to use this skill

- **Gating whether a change/doc edit is allowed at all** (non-negotiables, what
  needs an ADR, approval flow) → `fashion-monitor-change-control` is canon.
- **External claims about research results or SOTA positioning** →
  `fashion-monitor-research-frontier` (open problems) and
  `fashion-monitor-research-methodology` (evidence bar).
- **Recording an incident/dead end** → `fashion-monitor-failure-archaeology`.
- **Architecture invariants themselves** (not where they are documented) →
  `fashion-monitor-architecture-contract`.
- Running, debugging, testing, configuring → the respective operate/debug/QA/
  config sibling skills.

## Provenance and maintenance

Re-verify before trusting; all volatile facts stamped 2026-07-02.

- Vocabulary + Avoid lists: `cat /path/to/repo/CONTEXT.md`
- Current ADR set: `ls docs/adr/`
- Legacy ADR list incl. ADR-010/011 text: `grep -n "ADR-0" spec/06-decisions.md`
- ntfy migration state: `git status --short` and `grep -n createNtfyAlerter packages/core/src/pipeline/orchestrator.ts`
- Feedback ingestion still severed?: `grep -rni feedback packages/api/src | wc -l` (0 = severed) and `head -20 apps/cli/src/feedback-bot.ts`
- SMOKE.md still npm?: `grep -c npm docs/SMOKE.md`
- Makefile Telegram hints: `grep -n TELEGRAM Makefile`
- spec index staleness: `grep -n "src/" spec/README.md` and `ls spec/ | grep -E "07|08"`
- Attribution rule: `cat .cursor/rules/no-agent-attribution.mdc`
- Public-repo keep-outs: `grep -n "keep out" -i spec/06-decisions.md` and `cat .gitignore`
