# Stack Modernization Plan (mid-2026)

**Repo:** `fashion-monitor` — personal resale monitoring with LLM aesthetic scoring.
**Scope:** Analysis and planning only. Nothing in this document has been applied. No code, dependencies, configuration, or git state was changed in producing it.
**Date of research:** June 2026. Versions below were web-verified unless explicitly marked _approximate / verify before upgrading_.

---

## 1. Executive summary

The repo is two codebases sharing one Git tree:

- **Backend** (`src/`, root `package.json`) — a TypeScript ESM Node app (scraping pipeline, LLM scoring, Telegram bots, SQLite storage, a Fastify JSON API under `src/web/`). It is roughly **12–18 months behind** current: Zod 3, TypeScript 5.7, Vitest 3, ESLint 9, `@types/node` 22, `engines.node >=20`, Docker base `node:20`, Anthropic SDK 0.39, Playwright 1.49.
- **Frontend** (`web/`, `web/package.json`) — a Vite + React SPA that is **already on mid-2026-current majors**: React 19.2, Vite 8, Tailwind 4, Zod 4, TanStack Router 1.170 / Query 5.101, TypeScript 6, ESLint 10, Vitest 4.

So the work is mostly **pulling the backend up to where the frontend already is**, and unifying the two halves on one toolchain so a future monorepo (see the companion plan) can share code. The single highest-value change is **Zod 3 → 4 on the backend**, because the frontend is already on Zod 4 and a shared-schema package is impossible while they disagree on major versions.

### Top targets at a glance

| Technology | Repo today | mid-2026 target | Priority |
| --- | --- | --- | --- |
| Node.js runtime | `>=20`, Docker `node:20` | **Node 24 LTS** now; adopt **26 LTS** when it promotes (Oct 2026) | High |
| Zod (backend) | 3.24 | **4.x** (frontend already 4.4) | High |
| TypeScript (backend) | 5.7 | **6.0** (unify with frontend) | Medium |
| `@types/node` | 22 | match runtime (**24**) | High |
| Vitest (backend) | 3.0 | **4.x** (frontend already 4.1) | Medium |
| ESLint (backend) | 9 | **10.x** (frontend already 10) | Medium |
| Anthropic SDK | 0.39 | **~0.102** | Medium |
| Playwright | 1.49 | **current 1.5x** + anti-bot rework | Medium |
| better-sqlite3 | 11.8 | **12.x** (keep it; do **not** adopt `node:sqlite`) | Low–Med |
| ollama-js | 0.5.12 | **0.6.3** | Low |
| Fastify + plugins | 5.8.5 / 13 / 10 / 7 / 9 / 11 | already current — **stay patched** | Low |
| Package manager | npm | **pnpm** (sets up the monorepo) | Medium |

---

## 2. Runtime: Node.js

**Today:** `engines.node: ">=20"`, `Dockerfile` is `FROM node:20-bookworm`, `@types/node ^22`.

**Findings (web-verified):**

- Node **24.x "Krypton"** is the current **Active LTS** (entered Active LTS 2025‑10‑28; maintenance starts 2026‑10‑20; EOL 2028‑04‑30). Source: nodejs Release schedule README.
- Node **26.x** shipped as _Current_ on 2026‑05‑05 and is promoted to **LTS in October 2026**.
- Node **20.x "Iron"** is in **Maintenance** and reaches **EOL 2027‑04‑30**. Source: nodejs/Release.
- The release model changes in **October 2026**: one major per year (every April), every release becomes LTS, no more odd/even split (Node 27 is the first under the new model). Source: nodejs.org "Evolving the Node.js Release Schedule"; InfoQ 2026‑06.

**Recommendation:**

- Move to **Node 24 LTS now** (`engines.node: ">=24"`, Docker `node:24-bookworm`, `@types/node ^24`). Node 20 is on the maintenance clock and several toolchain pieces below assume 22+.
- Plan to ride **Node 26 into its October-2026 LTS promotion** in-place (no separate migration step — adopt 26 as Current near the LTS date and stay on it).
- Verify the native modules (`better-sqlite3`, `argon2`) have prebuilt binaries for the chosen Node ABI before bumping the Docker base; they do as of the versions below, but a rebuild step (`python3/make/g++`, already in the Dockerfile) covers the gap.

**Breaking-change risk:** Low for application code; risk concentrates in native addons and the Playwright/Chromium install. **Effort:** Low. **Priority:** High (EOL pressure).

---

## 3. SQLite: keep `better-sqlite3`, do not adopt `node:sqlite`

**Today:** `better-sqlite3 ^11.8.1`, used synchronously throughout `src/storage/` with hand-rolled idempotent SQL migrations loaded at runtime from `dist/storage/migrations/*.sql`.

**Findings (web-verified):**

- `better-sqlite3` is at **12.10.0** (published 2026‑05‑12), 6.6M weekly downloads, still the de-facto production standard.
- Built-in **`node:sqlite`** is still **Stability 1.2 – Release Candidate** as of Node 26.3 docs (it became a "release candidate" in 25.7; left the experimental flag back in 22.13 but is _still_ labelled experimental/RC). It has had recent edge-case segfault reports.

**Recommendation:**

- **Bump `better-sqlite3` 11 → 12** and keep it. The API is stable across this major for typical `prepare/run/all/exec` usage; review the changelog for the bundled SQLite version bump (occasionally changes default pragmas / `defensive` mode).
- **Do not migrate to `node:sqlite`.** It is not yet stable, would not buy us anything (we already have a fast synchronous driver and working migrations), and the synchronous, transaction-heavy code in `src/storage/repos/*` is exactly the pattern `better-sqlite3` is best at.
- Keep the **hand-rolled migration runner**. It works, it is idempotent, and `src/storage/db.ts` resolves `migrations/` relative to `__dirname` — preserve that layout in any build/monorepo change (the SQL files must land next to the compiled `db.js`).

**Risk:** Low. **Effort:** Low. **Priority:** Low–Medium. **Do NOT change:** the choice of driver or the migration approach.

---

## 4. TypeScript + tsconfig + ESM `.js` extensions

**Today (backend):** `typescript ^5.7.3`; `tsconfig.json` uses `module: NodeNext`, `moduleResolution: NodeNext`, `target: ES2022`, `strict: true`, emits to `dist/`. Imports use explicit `.js` extensions (correct for NodeNext ESM). **Frontend** is already on `typescript ^6.0.3`.

**Findings (web-verified):**

- **TypeScript 6.0** shipped **2026‑03‑23**. It is a transition release toward the Go-based 7.0 ("Project Corsa"). New defaults: `strict: true`, `target: es2025`, `module: esnext`, `moduleResolution: bundler`, and **`types` now defaults to `[]`** (you must set `"types": ["node"]` explicitly). `moduleResolution: node` (node10) is **deprecated**; use `nodenext`/`node20`/`bundler`. Sources: TS 6.0 release notes; devblogs "Announcing TypeScript 6.0"; privatenumber 5.x→6.0 migration gist.
- **Native TS type-stripping in Node is now Stable** (Node **25.2.0 / 24.12.0**); Node **26 removed `--experimental-transform-types`**. Node strips _erasable_ syntax only (no `enum`, no parameter properties, no runtime `namespace`) and ignores `tsconfig.json`. `--erasableSyntaxOnly` (TS 5.8+) makes `tsc` reject non-erasable syntax so code stays Node-runnable. Sources: nodejs.org typescript docs; "Running TypeScript Natively".

**Recommendation:**

- **Unify on TypeScript 6.0** across both halves (root devDependency to `^6`). The frontend is already there; the version skew is itself a hazard for shared types.
- **Keep `module`/`moduleResolution` = `NodeNext` on the backend** — it targets Node directly, not a bundler. Do **not** switch the backend to `bundler` resolution.
- Make the new TS-6 defaults explicit in `tsconfig.json` so the upgrade is a no-op semantically: add `"types": ["node"]`, keep `strict`, set `target` to `es2023`/`es2024` (matching Node 24), and set `verbatimModuleSyntax: true` to enforce `import type` discipline.
- **Keep the `.js` import extensions.** They are required by NodeNext ESM and by native type-stripping. Removing them would only be possible under `bundler` resolution, which we are explicitly not adopting for the backend. _This is a "do not change."_
- Optionally add **`erasableSyntaxOnly: true`** to keep the door open to running `.ts` directly with `node` and to dropping `tsx` from the runtime path later. First grep for `enum`/`namespace`/parameter-properties; adopt only if the codebase is already erasable.

**Native execution / `tsx`:** `tsx` (`^4.19`) is still the pragmatic dev runner because Node's native stripping ignores `tsconfig` path aliases and won't run `.tsx`. Keep `tsx` for `dev:*` scripts; you _may_ drop it from production (`start:*` already uses compiled `node dist/...`).

**Risk:** Low–Medium (mostly making implicit config explicit). **Effort:** Medium. **Priority:** Medium.

---

## 5. Fastify + security plugins

**Today:** `fastify ^5.8.5`, `@fastify/cookie ^11`, `@fastify/csrf-protection ^7.1`, `@fastify/helmet ^13`, `@fastify/rate-limit ^10.3`, `@fastify/static ^9.1`. Argon2 auth, SQLite-backed sessions, capability RBAC, `@noble/ciphers` secrets-at-rest.

**Findings (web-verified):**

- Fastify **v5** is the current major; latest is **5.8.5 (2026‑04‑14)**. **5.8.5 is a security release fixing CVE‑2026‑33806** — being on `^5.8.5` is good, but pin/verify the resolved version is `>= 5.8.5`.
- Plugin majors are already correct for v5: helmet **13.x ↔ Fastify ^5**, rate-limit **10.x ↔ ^5**, csrf-protection **7.x ↔ ^5**, static **9.x ↔ ^5**, cookie **11.x ↔ ^5** (per each plugin's compatibility table).

**Recommendation:**

- **No major moves.** Stay on Fastify v5 and the current plugin majors; treat this as "keep patched," not "modernize." Confirm the lockfile resolves Fastify `>= 5.8.5` for the CVE fix.
- **Session strategy is fine as-is.** Hand-rolled signed-cookie sessions backed by a `sessions` SQLite table (see `src/web/app.ts` + `SessionsRepo`) are appropriate for a single-instance app behind Caddy. Do not introduce `@fastify/session`/Redis unless the deployment becomes multi-instance.
- Minor hardening to consider later (not required): tighten the Helmet CSP (`scriptSrc`/`styleSrc` still allow `'unsafe-inline'` for styles), and confirm `trustProxy` is correct behind Caddy (it is set).

**Risk:** Low. **Effort:** Low. **Priority:** Low. **Do NOT change:** the auth/session/RBAC design.

---

## 6. Zod 3 → 4 (the keystone change)

**Today:** backend `zod ^3.24.2` (used in `src/llm/schemas.ts`, `src/web/routes/*`, validation). **Frontend already on `zod ^4.4.3`** with `@hookform/resolvers ^5`.

**Findings (web-verified):** Zod 4 is stable (GA mid‑2025), ~14×/7×/6.5× faster parsing, tree-shakable, adds `@zod/mini`, native JSON-Schema output, metadata. Notable breaking changes:

- **Unified `error` parameter** replaces `message` / `required_error` / `invalid_type_error` / `errorMap`.
- **Top-level format validators**: `z.email()`, `z.uuid()`, `z.url()` etc.; the `z.string().email()` chain is **deprecated** (still works for now). `z.string().ip()/.cidr()` were **removed** in favor of `z.ipv4()/ipv6()` etc.
- `.default()` semantics changed (default must match the **output** type and is applied even under `.optional()` when the value is missing).
- Coercion input types are now `unknown`; some object helpers (`.passthrough()/.strict()/.strip()`, `.nonstrict()`, `deepPartial`, `nativeEnum`) deprecated/removed; schema-level errors take precedence.
- An official-ish **codemod** exists (`npx zod-v3-to-v4`, also `codemod jssg run zod-3-4`) that handles the mechanical rewrites. Sources: zod.dev/v4; Pockit migration guide; InfoQ 2025‑08; codemod docs.

**Recommendation:**

- **Upgrade the backend to Zod 4** to match the frontend. This is the prerequisite for the shared-schema package proposed in the monorepo plan — you cannot share `z.object(...)` schemas across packages while one side is v3 and the other v4.
- Run the codemod, then hand-fix: our schemas are small (`ScoringResultSchema`, `BatchSchema`, the monitor/settings/user route inputs). Audit each `z.enum`, `.default()`, and any custom error messages.
- Standardize imports on the bare `zod` v4 entrypoint across both packages (avoid mixing `zod` and `zod/v4` paths once everything is on 4).

**Risk:** Medium (semantic `.default()`/error changes can pass type-check but change runtime validation — cover with tests). **Effort:** Medium (small surface, codemod-assisted). **Priority:** **High** (unblocks shared code; perf + consistency win).

---

## 7. Frontend stack — already current, mostly "do not change"

**Today (`web/package.json`):** React **19.2.7**, react-dom 19.2.7, Vite **8.0.16** + `@vitejs/plugin-react` 6, Tailwind **4.3** via `@tailwindcss/vite` + `tw-animate-css`, Zod **4.4**, TanStack **Router 1.170 / Query 5.101**, react-hook-form **7.78** + `@hookform/resolvers` 5, Radix UI primitives, `lucide-react` 1.17, recharts 3.8, sonner 2, TypeScript **6.0**, ESLint **10.4**, Vitest **4.1**, `@types/node` 25.

**Findings (web-verified):** These are the mid-2026-current majors. shadcn/ui's current model is the CLI registry approach (`npx shadcn@latest add ...`), `new-york` style as default, `data-slot` attributes, `sonner` replacing the old `toast`, and forwardRef removed for React 19 — consistent with what's already in `web/src/components/ui`. Tailwind 4 uses the CSS-first `@theme` model via the Vite plugin (no `tailwind.config.js` PostCSS chain) — also already in place. An emerging "latest of the latest" option is **`rolldown-vite`** (Vite on the Rolldown bundler) and Oxlint/Oxfmt, seen in fresh 2026 starters.

**Recommendation:**

- **Leave the frontend majors alone.** It is already where we want it. Track minor/patch updates normally.
- **Optional, low priority:** evaluate `rolldown-vite` for faster builds once it's a drop-in for our plugin set; defer until the monorepo lands so the build wiring only changes once.
- The one real frontend item is **deduplication, not upgrading**: `web/src/lib/types.ts` hand-mirrors backend DTOs (and has already drifted — it lists `vinted` as a platform). That is solved structurally by the shared package in the monorepo plan, and is enabled by getting the backend onto Zod 4 (§6).

**Risk:** N/A (no change). **Priority:** Low. **Do NOT change:** React/Vite/Tailwind/TanStack/shadcn majors.

---

## 8. Scraping: Playwright + anti-bot posture

**Today:** `playwright ^1.49.1`, `playwright-extra ^4.3.6` + `puppeteer-extra-plugin-stealth ^2.11`, `impit ^0.5`, `scrapfly-sdk ^0.10.6`, `cheerio ^1.0`, ScrapFly fallback, per-platform scrapers (ebay/grailed/vestiaire/depop/poshmark) plus a Playwright stealth-browser layer.

**Findings (web-verified):**

- Playwright is the active default for scraping in 2026 (latest in the **1.5x** line; repo is on 1.49, several minors behind). Puppeteer's cadence has slowed.
- The **`puppeteer-extra-plugin-stealth` approach is now considered last-resort / brittle.** Modern anti-bot (Cloudflare, DataDome) detects the **`Runtime.enable` CDP leak** that plain Playwright/Puppeteer emit. Current mitigations: **`rebrowser-patches`** / **Patchright** (patch the CDP leak), Camoufox (anti-detect Firefox), or driverless approaches. Sources: rebrowser/rebrowser-patches; rebrowser.net Runtime.Enable writeup; decodo/browserless/bug0 scraping guides.
- Best-practice pattern in 2026: **use a headless browser only to pass the initial JS/challenge, harvest the cookie, then switch to a lightweight HTTP client** (which is exactly what `impit` + the HTTP scrapers already do), and lean on a **managed unblocker (ScrapFly)** as the fallback — both already in the architecture.

**Recommendation:**

- **Bump Playwright to the current 1.5x** (keep `@playwright/test` in lockstep) and re-pin the Chromium install in the Dockerfile/`postinstall`.
- **Re-evaluate the stealth layer.** Treat `playwright-extra` + `puppeteer-extra-plugin-stealth` as on the way out; pilot **`rebrowser-patches`/Patchright** for the Playwright browser path to address the `Runtime.enable` leak. Keep coherent fingerprints (UA/client-hints/viewport/timezone aligned) and human-like pacing — much of `src/lib/user-agent.ts` / `src/platforms/playwright` already gestures at this.
- Keep the **ScrapFly fallback** and the cookie-harvest-then-HTTP pattern; they match current guidance. Expect a permanent "anti-bot drift" maintenance cost — add screenshot/status-code regression checks (the repo already has `scripts/verify-scrapers.ts` and a live smoke test to build on).

**Risk:** Medium (scraper reliability is adversarial and changes break silently). **Effort:** Medium. **Priority:** Medium. This is best treated as its own workstream rather than a version bump.

---

## 9. LLM client SDKs

**Today:** `@anthropic-ai/sdk ^0.39.0`, `ollama ^0.5.12`; providers in `src/llm/` (`claude`, `ollama`, `hybrid`, `mock`, factory).

**Findings (web-verified):**

- **Anthropic TS SDK is at ~`0.102.0` (2026‑06‑06)** — a very large jump from 0.39 across ~170 releases. The core Messages API shape is stable, but model name constants, streaming helpers, and TS types have moved over that range; the upgrade needs a real read of the changelog and a test pass against `src/llm/claude.ts`.
- **ollama-js is at `0.6.3` (2025‑11‑13)** — a small, low-risk bump from 0.5.12.
- **Ollama now exposes an Anthropic-compatible Messages endpoint** (Ollama ≥ 0.14, blog 2026‑01): you can point `@anthropic-ai/sdk` at `http://localhost:11434` with a placeholder key.

**Recommendation:**

- **Bump ollama-js 0.5 → 0.6** (low risk).
- **Upgrade the Anthropic SDK incrementally** (0.39 → recent 0.x), checking: model identifiers, `messages.create`/streaming signatures, and error types. Do it behind the existing provider abstraction (`src/llm/provider.ts` + factory) so the blast radius is one file.
- **Optional simplification (defer):** because Ollama now speaks the Anthropic API, the `ollama` and `claude` providers could eventually converge on a single Anthropic-SDK client differentiated by `baseURL`, shrinking `src/llm/`. Nice-to-have, not part of the core upgrade.

**Risk:** Medium (Anthropic SDK span is large). **Effort:** Medium. **Priority:** Medium.

---

## 10. Tooling: package manager, tests, lint, format

**Today:** **npm** (root + `web/` each have their own lockfile; root build shells into `web/` via `npm --prefix`). Tests **Vitest** (backend 3.0, frontend 4.1) + Stryker mutation + Playwright e2e. Lint **ESLint 9** (backend) / **10** (frontend) flat config + `typescript-eslint`. Format **Prettier 3.4**.

**Findings (web-verified):**

- **pnpm 10** is the 2026 default for teams/monorepos: strict dependency isolation, content-addressable store (~30% disk vs npm), `workspace:*` protocol, version catalogs, graph-aware `--filter`, first-class Turborepo/Nx support. **Bun 1.2** is fastest to install but trades isolation and has monorepo edge cases; **npm 11** workspaces are "fine for small repos" but lack topological/affected commands. Sources: PkgPulse pnpm-vs-bun-2026, pnpm-vs-npm-vs-yarn-vs-bun-2026; Steve Kinney workspace course.
- **Vitest 4** is current. **ESLint 10** (flat config) is current; **Biome 2** is the leading all-in-one (lint+format) for new apps; **Oxlint** is the fastest lint-only pre-pass. Consensus: **keep ESLint for mature, type-aware, plugin-heavy codebases; optionally add Oxlint as a fast CI pre-pass**; Biome is most attractive on greenfield. Sources: PkgPulse/BuildPilot 2026 linter comparisons; youngju.dev 2026 formatters/linters.

**Recommendation:**

- **Adopt pnpm** as the package manager. This is both a modernization step and the foundation for the monorepo plan (which assumes pnpm workspaces). It also kills the awkward `npm --prefix web` indirection.
- **Backend Vitest 3 → 4** and **ESLint 9 → 10** to match the frontend (single toolchain version across the repo).
- **Keep ESLint + typescript-eslint** as the source of truth (we want type-aware rules on a security-sensitive auth/secrets backend). **Optionally add Oxlint** as a fast pre-flight in CI with `eslint-plugin-oxlint` to disable overlapping rules. **Do not** rip ESLint out for Biome wholesale right now.
- **Keep Prettier 3** (or fold formatting into Biome later if you consolidate). Keep Stryker and the Playwright e2e setup.

**Risk:** Low–Medium (pnpm install layout can surface phantom-dependency errors — that's the point, but it can break a sloppy import). **Effort:** Medium. **Priority:** Medium.

---

## 11. Recommended sequenced upgrade order

Each step should land green (typecheck + tests + lint) before the next. Steps 1–3 are pure foundation; 4 is the keystone; 5–7 are independent and can be parallelized; 8 sets up the monorepo.

1. **Node 24 LTS** — `engines.node`, Docker base `node:24-bookworm`, `@types/node ^24`; rebuild native addons; re-pin Playwright Chromium install. _(High)_
2. **TypeScript 6.0 (unify)** — root `typescript ^6`; make TS-6 defaults explicit in `tsconfig.json` (`types: ["node"]`, keep `NodeNext`, add `verbatimModuleSyntax`); keep `.js` extensions. _(Medium)_
3. **Vitest 4 + ESLint 10 on the backend** — bring backend in line with frontend; fix any flat-config/test-API deltas. _(Medium)_
4. **Zod 3 → 4 on the backend** — codemod + manual audit + tests. Unblocks shared schemas. _(High)_
5. **Dependency bumps** — `better-sqlite3` 12, `ollama` 0.6, `@anthropic-ai/sdk` ~0.102 (behind the provider abstraction), Fastify lockfile `>= 5.8.5`. _(Med/Low)_
6. **Playwright current + anti-bot rework** — bump Playwright; pilot `rebrowser-patches`/Patchright; keep ScrapFly + cookie-harvest pattern; add regression checks. _(Medium, own workstream)_
7. **Optional/native-execution** — evaluate `erasableSyntaxOnly` and dropping `tsx` from production; evaluate `rolldown-vite`. _(Low)_
8. **Switch to pnpm** — single workspace install, replace `npm --prefix web`. This is the hand-off point to the monorepo plan. _(Medium)_

---

## 12. Explicitly do NOT change

- **Do not adopt `node:sqlite`.** Still RC; `better-sqlite3` 12 is the right call.
- **Do not remove `.js` import extensions** on the backend (required by NodeNext ESM / native type-stripping).
- **Do not switch the backend to `moduleResolution: bundler`** — it targets Node directly.
- **Do not downgrade or rewrite the frontend** (React 19 / Vite 8 / Tailwind 4 / TanStack / shadcn are already current).
- **Do not replace the Fastify auth/session/RBAC design** or move to Redis sessions for a single-instance deployment.
- **Do not replace ESLint with Biome wholesale**; Oxlint may be added _alongside_ ESLint only.
- **Do not introduce an ORM or a migration framework**; the hand-rolled idempotent SQL migrations are fine — just preserve the `migrations/`-next-to-`db.js` runtime layout.
- **Do not init git** or change deployment topology (Caddy + docker-compose) as part of this plan.

---

## 13. Sources (web-verified, June 2026)

- Node.js release schedule + new model: `nodejs.org/en/blog/announcements/evolving-the-nodejs-release-schedule`; `github.com/nodejs/Release`; InfoQ 2026‑06.
- `node:sqlite` status + `better-sqlite3` 12.10: `nodejs.org/api/sqlite.html` (v24/v26 docs); npm `better-sqlite3`.
- TypeScript 6.0: `typescriptlang.org` 6.0 release notes; `devblogs.microsoft.com/typescript/announcing-typescript-6-0`; privatenumber 5.x→6.0 gist.
- Native TS execution: `nodejs.org/api/typescript.html`; `nodejs.org/learn/typescript/run-natively`.
- Fastify 5.8.5 (CVE‑2026‑33806) + plugin compat tables: npm `fastify`, `@fastify/helmet`, `@fastify/rate-limit`.
- Zod 4: `zod.dev/v4`; Pockit Zod-4 migration guide; InfoQ 2025‑08; `docs.codemod.com/guides/migrations/zod-3-4`.
- Frontend majors / shadcn / Tailwind 4: shadcn-ui discussion #6714; TanStack Router shadcn integration doc; 2026 starter repos.
- Scraping/anti-bot: `github.com/rebrowser/rebrowser-patches`; rebrowser.net Runtime.Enable; decodo/browserless/bug0 2026 guides.
- LLM SDKs: npm `@anthropic-ai/sdk` (0.102.0); `github.com/ollama/ollama-js` (0.6.3); `docs.ollama.com/api/anthropic-compatibility`.
- Tooling: PkgPulse pnpm/Bun/linter 2026 guides; Steve Kinney workspace-package-managers; youngju.dev 2026 formatters/linters.
