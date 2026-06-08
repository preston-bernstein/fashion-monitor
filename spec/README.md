# Fashion Monitor — Spec Index

Personal resale monitoring tool. Watches eBay, Grailed, Vestiaire Collective, Vinted, Depop, and Poshmark for clothing matching a defined aesthetic. Uses LLM scoring to replace hardcoded brand/keyword lists — describe the vibe once, get alerted when something matches.

## Specs

| File | Contents |
|------|----------|
| [01-overview.md](01-overview.md) | Goals, user context, success criteria, non-goals |
| [02-architecture.md](02-architecture.md) | System design, tech stack, data flow |
| [03-data-model.md](03-data-model.md) | Schema, deduplication, storage |
| [04-llm-scoring.md](04-llm-scoring.md) | Aesthetic prompt, scoring rubric, thresholds |
| [05-alert-system.md](05-alert-system.md) | Notification delivery, format, frequency |
| [06-decisions.md](06-decisions.md) | Architecture Decision Records |
| [platforms/ebay.md](platforms/ebay.md) | eBay integration (official API) |
| [platforms/grailed.md](platforms/grailed.md) | Grailed integration (Algolia) |
| [platforms/vestiaire.md](platforms/vestiaire.md) | Vestiaire Collective (__NEXT_DATA__) |
| [platforms/vinted.md](platforms/vinted.md) | Vinted integration (vinted-scraper) |
| [platforms/depop.md](platforms/depop.md) | Depop integration (webapi endpoints) |
| [platforms/poshmark.md](platforms/poshmark.md) | Poshmark integration (Playwright) |

## Status

| Spec | Status |
|------|--------|
| Overview | Draft |
| Architecture | Draft |
| Data Model | Draft |
| LLM Scoring | Draft |
| Alert System | Draft |
| Decisions | Draft |
| All platforms | Draft |

## Code layout

Implementation lives under `src/` — see root [README.md](../README.md) for module map and build instructions.
