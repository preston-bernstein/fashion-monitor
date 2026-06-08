# 01 — Overview

## Problem

Resale sites (eBay, Grailed, Vestiaire, etc.) have good inventory of quality designer clothing at reasonable prices. Finding the right pieces requires:
- Knowing which brands/designers to search for in advance (you often don't)
- Manually checking multiple platforms repeatedly
- Missing listings that sell fast

Saved searches on individual platforms only work if you know exactly what to search for. They don't understand aesthetic match — only keyword match.

## Goal

A personal monitoring tool that:
1. Continuously watches 6 resale platforms for men's XXL clothing
2. Uses an LLM to score each result against a defined aesthetic — so unknown brands and new discoveries get surfaced, not just known keywords
3. Sends alerts only for high-confidence matches, so the signal-to-noise ratio stays high

## User Context

- Male, YOUR_HEIGHT, ~YOUR_WEIGHT lbs
- Size: XXL tops, chest ~YOUR_CHEST_SIZE", waist ~44" actual (wears 40-42 pants), dress shirt ~18 neck / 34-35 sleeve
- Wide flat feet, thin orthotics (shoes separately tracked)
- Location: YOUR_CITY, YOUR_STATE — hot, humid climate; fabric breathability is a real constraint
- Office environment, programmer, smart casual acceptable
- Aesthetic: **dark academic / textured naturalist** — think professor who listens to post-punk
- References: Nick Cave (dark poet aesthetic), Brian Jonestown Massacre (worn, textured), Beastie Boys late 90s (relaxed, confident)
- Core vibe: natural textures, quality fabric, intentional not costume-y. Tweed, twill, corduroy, slub cotton, dark linen, Italian fabrics. No graphics, no embroidery gimmicks, no tropical prints
- Climate preference: lightweight natural fabrics year-round (dark linen, cotton twill, slub cotton); heavy wool/tweed acceptable fall/winter only
- Known liked brands: John Varvatos, Dale of Norway, Allen Edmonds, Brunello Cucinelli, Helmut Lang, Engineered Garments, Carhartt WIP, Theory, Boglioli, Universal Works
- Open to unknown brands that match the vibe — this is a key reason for LLM scoring over keyword lists

## Success Criteria

- Alerts arrive within 1-2 hours of a matching item being listed
- False positive rate low enough that alerts are worth opening (target: >60% of alerts are genuinely interesting)
- No duplicate alerts for the same listing
- Works unattended — runs on a schedule, no manual intervention needed
- Easy to tune the aesthetic prompt without touching code

## Non-Goals (v1)

- Not a purchasing tool — no auto-buy, no cart management
- Not a price history tracker — though seen price can be stored
- Not real-time — hourly polling acceptable
- Not covering shoes yet — footwear is a separate future consideration
- Not covering Vinted initially if complexity is too high — deprioritized
- No web UI or account system — config-file based only

## Multi-Profile (v2)

v1 is single-profile (Preston). v2 adds support for wife, friends, family — each with their own aesthetic, measurements, price preferences, and Telegram chat.

**What v1 must do now to make v2 non-destructive:**
- `profile_id TEXT NOT NULL DEFAULT 'default'` column on `seen_listings`, `feedback`, `alert_log` tables — cheap insurance, zero behavioral change in v1
- Aesthetic prompt, measurements, Telegram chat ID, price ceiling — all in config, never in code (already planned)
- No business logic assumes a single profile anywhere

**v2 design (for reference, not in scope now):**

```yaml
# config.yaml
profiles:
  preston:
    telegram_chat_id: "..."
    measurements: {chest: "YOUR_CHEST_SIZEin", waist: "44in", size: "XXL"}
    aesthetic_prompt: "dark academic, corduroy, tweed, slub cotton..."
    price_ceiling: 300
    platforms: [ebay, grailed, vestiaire, depop, poshmark]

  sarah:
    telegram_chat_id: "..."   # different person, different Telegram chat
    measurements: {size: "S/M", ...}
    aesthetic_prompt: "..."
    price_ceiling: 150
    platforms: [depop, poshmark, vestiaire]
```

Each profile gets its own:
- Scoped DB rows (via `profile_id`)
- Scoped feedback loop (her ✅/❌ teaches her model, not Preston's)
- Scoped Telegram destination
- Independent scoring — the LLM prompt is rebuilt per-profile

The scheduler runs profiles sequentially or concurrently (config flag). No shared state between profiles except the DB file.

## Decisions (resolved — see 06-decisions.md for rationale)

- [x] Alert delivery: **Telegram** (ADR-004)
- [x] Execution: **Synology Docker** + Task Scheduler; GitHub Actions **CI only** (ADR-005, ADR-010)
- [x] Vinted: **deprioritized to v2** — EU inventory, maintenance burden (ADR-006)
- [x] Price ceiling: **per-category in config.yaml** (see 03-data-model.md)
- [x] History retention: **90 days** for seen_listings, 30 days for runs (see 03-data-model.md)
