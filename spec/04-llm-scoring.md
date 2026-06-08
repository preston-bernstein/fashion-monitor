# 04 — LLM Scoring

## Purpose

Replace hardcoded brand/keyword lists with semantic understanding of the target aesthetic. A listing for a brand never heard of (e.g., a Norwegian knitwear label, a Japanese workwear brand) should surface if it matches the vibe. A listing with a known brand name should still fail if the specific item doesn't fit.

---

## Provider Abstraction

The scoring layer talks to a `LLMProvider` interface — not directly to Ollama or Claude. Switch providers via `config.yaml` with no code changes. This is the architecturally interesting piece worth showing on GitHub.

```typescript
interface LLMProvider {
  scoreBatch(listings: PreparedListing[]): Promise<ScoringResult[]>;
  scoreWithImage(listing: PreparedListing): Promise<ScoringResult>;
  healthCheck(): Promise<boolean>;
}

class OllamaProvider implements LLMProvider { ... }    // local, free, private
class ClaudeProvider implements LLMProvider { ... }    // cloud, ~$2-5/month, higher quality vision
class HybridProvider implements LLMProvider { ... }    // Ollama for text, Claude for vision
```

Config selects the provider:
```yaml
llm:
  provider: "hybrid"       # "ollama" | "claude" | "hybrid"
  ollama_host: "http://192.168.1.X:11434"
  ollama_text_model: "qwen2.5:7b"
  ollama_vision_model: "llama3.2-vision:11b"  # omit if VRAM insufficient
  claude_model: "claude-haiku-4-5"            # used only if provider includes claude
```

---

## Honest Capability Assessment

**Text scoring (pass 1) — Ollama 7B is sufficient.**

The task is: given title, brand, description, price, condition — is this YES/MAYBE/NO for a defined aesthetic? This is structured classification with context. A well-prompted 7B model handles this reliably. `qwen2.5:7b` is particularly strong at following structured output constraints.

What 7B gets right:
- Known brand quality signals (Helmut Lang = quality, Zara = fast fashion)
- Explicit fabric/texture keywords (corduroy, waffle, wool)
- Hard-NO rules (graphic print, slim fit, tropical)
- Price tier signals (original retail $400 = quality tier)

What 7B gets wrong sometimes:
- Subtle aesthetic judgment ("does this read Cave or does it read Miami Vice")
- Unknown brands with no brand signal at all
- Very sparse listings (title only, no description)

These edge cases → MAYBE → pass 2. That's the correct behavior.

**Vision scoring (pass 2) — depends on your GPU.**

Vision models vary significantly in their ability to assess fabric texture, color accuracy, and aesthetic fit from a photo. Honest ranking for this use case:

| Model | Capability | VRAM needed |
|-------|-----------|-------------|
| Claude claude-sonnet-4-6 | Best — strong aesthetic reasoning | cloud |
| Claude claude-haiku-4-5 | Good — fast, cheaper | cloud |
| `llama3.2-vision:11b` | Good for obvious cases, weaker on subtle texture | ~8 GB |
| `qwen2.5-vl:7b` | Good structured output, decent visual | ~6 GB |
| `llava:7b` | Acceptable, older architecture | ~5 GB |
| `llava-phi3` | Fast but weak on aesthetic nuance | ~3 GB |

**Recommended approach by GPU tier:**

```bash
# Check your GPU first
nvidia-smi  # NVIDIA — look for "MiB" VRAM total
rocm-smi    # AMD
```

| VRAM | Text (pass 1) | Vision (pass 2) | Provider config |
|------|--------------|-----------------|-----------------|
| < 6 GB | `qwen2.5:7b` Q4 | Claude API | `hybrid` |
| 6–10 GB | `qwen2.5:7b` | `llava:7b` or Claude | `hybrid` or `ollama` |
| 12–16 GB | `qwen2.5:7b` | `llama3.2-vision:11b` | `ollama` |
| 24 GB+ | `qwen2.5:7b` | `llama3.2-vision:11b` | `ollama` |
| CPU only | too slow | too slow | `claude` |

**The pragmatic hybrid:** Ollama for text (free, private, plenty capable), Claude API for vision only (MAYBE items only, ~3-8 items/run at steady state). Vision API cost: ~$0.01-0.03/run = under $1/month. Best quality where it matters, local where it's sufficient.

---

## Ollama Structured Output

Use Ollama's native JSON schema enforcement (Ollama ≥ 0.5) — grammar-constrained at token level, more reliable than OpenAI shim:

```typescript
import ollama from "ollama";
import { z } from "zod";

const ScoringResultSchema = z.object({
  listing_id: z.string(),
  score:      z.enum(["YES", "MAYBE", "NO"]),
  quality:    z.enum(["pass", "fail", "uncertain"]),
  value:      z.enum(["pass", "fail", "uncertain"]),
  aesthetic:  z.enum(["pass", "fail", "uncertain"]),
  size:       z.enum(["HIGH", "UNCERTAIN", "UNLIKELY"]),
  reason:     z.string().max(120),
});

const BatchSchema = z.array(ScoringResultSchema);

const response = await ollama.chat({
  model: "qwen2.5:7b",
  messages: [...],
  format: BatchSchema.toJSONSchema(),  // Zod v3.24+ — native method, no extra package
  stream: false,
});

const results = BatchSchema.parse(JSON.parse(response.message.content));
```

Structurally valid JSON guaranteed at token level — no markdown fences, no parse errors. Zod parse as a second validation layer catches any type mismatches.

---

## Expected Latency

| GPU | Text batch (15 listings) | Vision per MAYBE item |
|-----|--------------------------|-----------------------|
| RTX 3060 12GB | 15–25s | 8–15s local / 1–2s Claude |
| RTX 3080 10GB | 10–18s | 6–12s local / 1–2s Claude |
| RTX 3090/4080 24GB | 5–10s | 4–8s local / 1–2s Claude |
| RTX 4090 24GB | 3–6s | 2–5s local / 1–2s Claude |

At steady state (10–20 new listings/run, 2–5 MAYBEs): total scoring time 20–60s. Well within 60-min cycle budget.

---

## Verdict Caching (biggest cost lever)

**Do not re-score listings already in the DB with a verdict.**

`seen_listings` stores `score` per listing. Before LLM scoring, filter out any listing where `score IS NOT NULL`. At steady state (after week 1), the vast majority of listings seen per run already have scores — only truly new listings hit the LLM.

Without this: LLM re-evaluates 40-80 stale listings every run = wasted cost.
With this: steady-state LLM input drops to 5-15 new listings/run = 1-2 batches max.

**This is the single largest cost reduction available. Implement first.**

---

## Pre-Filter Layer — hard rules, zero LLM cost

Three independent gates. A listing fails any one → rejected immediately, no LLM call.

### Gate 1: Fast fashion / quality floor blocklist
Brands and keywords that indicate low quality regardless of price or aesthetic:
```typescript
const QUALITY_BLOCKLIST_BRANDS = new Set([
  "zara", "h&m", "shein", "forever 21", "fashion nova", "asos",
  "boohoo", "primark", "uniqlo",
  "old navy", "gap", "banana republic",
]);

const QUALITY_BLOCKLIST_KEYWORDS = [
  "replica", "inspired by", "dupe", "faux leather", "pleather",
  "lot of", "bundle of", "wholesale",
  "slim fit",
  "graphic tee", "graphic print", "tropical", "floral",
];

const PRIMARY_SYNTHETIC_FABRICS = [
  "100% polyester", "100% acrylic", "100% nylon",
  "polyester blend",
];
```

### Gate 2: Price floor (replica/junk signal)
Items priced suspiciously low for their claimed brand are likely replica or severely damaged:
```typescript
const BRAND_PRICE_FLOORS: Record<string, number> = {
  "brunello cucinelli": 80,
  "helmut lang": 40,
  "john varvatos": 35,
  "theory": 30,
  "rag & bone": 40,
  "engineered garments": 50,
};
// If claimed brand is premium and price is below floor → reject
```

### Gate 3: Size — soft signal only, never hard reject

Do NOT hard-reject on size. Resale sizing is too inconsistent to gate on:
- Japanese/Korean brands run 1-2 sizes small (their XL = US L)
- Italian/European brands run slim (EU 54 ≈ US XL/2XL)
- Oversized cuts labeled S/M/L often fit much larger
- Vintage items rarely have accurate size tags
- Many listings have no size field, or list measurements instead
- Sellers frequently mislabel size

Instead: pass size field + any measurements in the description to the LLM.
LLM assesses fit likelihood using user's actual measurements as ground truth:

**User measurements (inject into system prompt):**
- Height: YOUR_HEIGHT
- Weight: ~YOUR_WEIGHT lbs
- Chest: ~YOUR_CHEST_SIZE"
- Waist: ~44" actual (wears 40-42 in pants — prefers a bit of room)
- Typical US size: XXL tops, though some XL oversized fits work
- Dress shirt: 18" neck, 34-35" sleeve

**LLM size assessment:**
```
"size": "HIGH"      — clearly compatible (XXL, 2XL, EU 54-56, measurements confirm)
"size": "UNCERTAIN" — could work (XL oversized, no size listed, EU 52, Japanese XL)  
"size": "UNLIKELY"  — probably too small (M, L regular fit, EU YOUR_CHEST_SIZE, chest < 46")
```

- HIGH + passing quality/value/aesthetic → YES alert
- UNCERTAIN + passing everything else → MAYBE alert with size note
- UNLIKELY → reject (the one size-based rejection, only for clearly incompatible)

**Measurements in description override size label.** If a listing says "chest 52 inches" that's a YES regardless of what the size tag says.

Combined, these three gates eliminate roughly 40-60% of raw listings before any LLM call — and they eliminate the worst offenders first.

---

## Batching

- Group listings into batches of **15-20** per API call (not 10)
- Larger batches reduce system prompt repetition across calls
- 15-20 is the sweet spot — beyond 30, LLM attention dilutes for middle items
- Each listing identified by stable `listing_id`, not positional index

---

## Prompt Structure

### System Prompt
```
You are a personal shopping assistant helping a 38-year-old man find high quality secondhand 
clothing at good value. You assess THREE things independently: quality, value, and aesthetic fit.
A listing must pass all three to be a YES.

QUALITY means: genuine quality construction and materials. Signals:
- Brand reputation for quality (Helmut Lang, Brunello Cucinelli, Engineered Garments, Dale of Norway, 
  Carhartt WIP, Theory, Vince, John Varvatos, Rag & Bone, Todd Snyder = quality tier)
- Natural fabrics as primary material: wool, cashmere, linen, cotton (Supima/Pima preferred), 
  silk-cotton blends, suede, leather
- Country of manufacture: Italy, Japan, USA, Portugal = positive signal
- Construction mentions: unstructured, hand-stitched, selvedge, quality lining
- Original retail price (if mentioned): >$150 suggests quality tier

VALUE means: the asking price is genuinely good for what it is. You know approximate retail:
- A $400 retail shirt for $70 secondhand in excellent condition = excellent value
- A $60 retail shirt for $45 = poor value, even if it looks ok
- Condition matters: excellent/new with tags commands a premium; fair does not
- If original retail is not mentioned, estimate from brand tier

AESTHETIC means: matches his specific vibe (dark, textured, Cave/BJM/Beastie, no gimmicks).
See aesthetic criteria below.

Score as:
- YES: passes quality + value + aesthetic. Alert immediately.
- MAYBE: passes 2 of 3, or insufficient info to judge one dimension. Surface for review.
- NO: fails quality OR fails value OR clear aesthetic mismatch.

Include which dimensions passed/failed in your reason.
``` He is YOUR_HEIGHT, 250 lbs. Body measurements: chest ~YOUR_CHEST_SIZE", waist ~44" (wears 40-42 pants).
Typical size XXL tops, some oversized XL work. Lives in YOUR_CITY, YOUR_STATE (hot, humid).
Programmer, casual office environment.

His aesthetic: dark academic / textured naturalist. Think university professor who
listens to post-punk and wears it well. Intentional, not costumey. Quality fabric is
the primary signal — pieces should look like they have a history or a story.

- Dark palette — black, charcoal, deep navy, dark brown, burgundy, forest green, slate
- Texture is everything: corduroy (wide wale preferred, cotton or lightweight), tweed,
  twill, slub cotton, waffle knit, structured knit, brushed cotton, dark linen, 
  Italian cotton, wool jersey, seersucker (dark tones only)
- Natural fibers: linen, cotton (slub/Pima/Supima), wool (lightweight preferred), 
  cashmere, suede, leather — these are strong positives
- References: Nick Cave (dark poet/academic), Brian Jonestown Massacre (worn, 
  textured, indie), Beastie Boys late 90s (relaxed, confident)
- Known good brands (not exhaustive): John Varvatos, Dale of Norway, Brunello Cucinelli, 
  Helmut Lang, Engineered Garments, Carhartt WIP, Theory, Vince, Rag & Bone, 
  Todd Snyder, AllSaints, Boglioli, Canali (secondhand), Universal Works, 
  Oliver Spencer, Margaret Howell, Beams Plus

CLIMATE CONTEXT — YOUR_CITY, YOUR_STATE (hot, humid most of the year):
- STRONG positive for climate: linen (dark), lightweight cotton, slub cotton, 
  cotton twill, seersucker (dark), cotton corduroy, open-weave fabrics
- SEASONAL OK (fall/winter only): heavy wool, tweed, thick corduroy, heavy flannel.
  If clearly a heavy/warm fabric, note this in the reason — good piece but weather-limited.
- CLIMATE MISMATCH: heavy wool turtlenecks, thick flannel shirts, dense knitwear = 
  mark as MAYBE with note "heavy fabric, limited Atlanta wear"
- Do NOT penalize for climate unless the fabric is clearly impractical (e.g., a Harris 
  Tweed suit jacket is fine for Nov-Feb; a thick wool turtleneck is genuinely limited)

Hard NO regardless of brand:
- Graphic tees or graphic prints
- Embroidery as decoration (subtle logo or maker's mark is fine)
- Tropical, floral, or vacation prints
- Athletic/sportswear styling
- Loud logos
- Light colors (white, cream, pastels, light grey)
- Anything described as "slim fit" or "tailored slim" (too tight for his build)
- Polyester or synthetic primary fabrics (exception: performance outerwear shell)

Score each listing as:
- YES: Strong aesthetic match, would likely want to see this
- MAYBE: Partial match or insufficient info to decide — worth surfacing
- NO: Clear mismatch, skip

Return ONLY valid JSON. No explanation outside the JSON.
```

## Description Truncation

Truncate descriptions to 500 characters (~100 tokens) before passing to LLM. Sellers front-load key signals (fabric, condition, brand details) in the first 2-3 sentences. The remainder is shipping policy, measurements, disclaimers — noise for scoring.

```typescript
interface PreparedListing {
  listing_id: string;
  title: string;
  brand: string;
  description: string;
  price: number;
  condition: string | null;
  size: string;
}

function prepareForLLM(listing: Listing): PreparedListing {
  const desc = listing.description ?? "";
  return {
    listing_id: `${listing.platform}:${listing.id}`,
    title: listing.title,
    brand: listing.brand ?? "unknown",
    description: desc.length > 500 ? desc.slice(0, 500) + "..." : desc,
    price: listing.price,
    condition: listing.condition,
    size: listing.size,
  };
}
```

This alone reduces per-listing token count from ~150 to ~75-90, cutting LLM input cost by ~40%.

---

### User Prompt (per batch)
```
Score these {n} listings. Return a JSON array with one object per listing.

Listings:
[
  {
    "listing_id": "ebay:abc123",
    "title": "...",
    "brand": "...",
    "description": "...",
    "price": 85.00,
    "condition": "excellent",
    "size": "XXL"
  },
  ...
]

Required output format — use the exact listing_id from input:
[
  {
    "listing_id": "ebay:abc123",
    "score": "YES",
    "quality": "pass",
    "value": "pass",
    "aesthetic": "pass",
    "size": "HIGH",
    "reason": "Helmut Lang wool crewneck EU 54, retail ~$280, asking $75 excellent — right size range, great value, Cave-adjacent"
  },
  {
    "listing_id": "grailed:456",
    "score": "MAYBE",
    "quality": "pass",
    "value": "pass",
    "aesthetic": "pass",
    "size": "UNCERTAIN",
    "reason": "Listed XL but described as oversized boxy cut — could fit, worth checking measurements"
  },
  {
    "listing_id": "depop:789",
    "score": "NO",
    "quality": "pass",
    "value": "pass",
    "aesthetic": "pass",
    "size": "UNLIKELY",
    "reason": "Listed M regular fit, chest 42 inches — too small"
  }
]

If the response is malformed JSON or missing listings, the caller will treat all missing entries as MAYBE and re-score individually.
```

---

## Scoring Rubric

| Score | Meaning | Alert? |
|-------|---------|--------|
| YES | Strong match on texture, fabric, color, and vibe | Yes |
| MAYBE | Partial match, ambiguous description, or interesting unknown brand | Yes, marked as MAYBE |
| NO | Clear mismatch on any hard-NO criterion, or wrong vibe entirely | No |

---

## Signals Claude Should Weight

**Strong positive:**
- Texture words: corduroy, wide wale, tweed, twill, slub cotton, waffle knit, bouclé, 
  herringbone, ribbed knit, brushed cotton, linen, suede, seersucker (dark)
- Fabric quality words: Italian cotton, Pima, Supima, 18-wale, selvedge, deadstock,
  Japanese cotton, Portuguese linen, merino, cashmere blend
- Color: black, charcoal, dark grey, navy, dark brown, burgundy, forest green, slate, 
  deep olive, ink blue
- Construction: unstructured, relaxed fit, boxy, interesting seam details, single-pleat,
  patch pockets, workwear details
- "Made in Italy", "Made in Japan", "Made in USA", "Made in Portugal" — quality signal
- Brand with quality reputation, even if not on the known list

**Climate bonus (Atlanta heat):**
- Lightweight linen or cotton-linen blend in dark tones → note it's climate-friendly
- "Breathable" + natural fiber → positive
- Light-for-weight fabric descriptions → positive

**Weak positive:**
- Described as Japanese or Scandinavian brand (often quality-focused)
- "Deadstock" or "NOS" — interesting vintage piece
- High original retail price — signals quality tier
- Italian or Portuguese manufacture

**Negative:**
- "Slim fit", "tailored slim", "skinny" in title or description
- Any mention of logo-forward or statement styling
- Synthetic primary fabric (polyester, nylon, acrylic) unless performance outerwear
- "Statement piece" or fashion-forward styling language
- Light or bright colorways
- Heavy fabric with no seasonal context (thick wool, Harris Tweed) → flag for weather limit, not hard NO

---

## Cost

**Default config (`provider: ollama`): $0/month.** Ollama runs on your existing always-on multimedia machine. No API billing.

**Optional paid providers** (`claude`, `hybrid`) are selected explicitly in `config.yaml` — never auto-invoked when Ollama is down. Hybrid typically costs <$1/month if vision pass uses Claude for MAYBE items only.

**Total external service cost (default ollama config):**
- Telegram Bot API: **free**
- Ollama: **free**
- Synology NAS: already owned, already on
- GitHub Actions: **CI only** (free for public repos)
- Claude API: **not used unless configured**
- **Monthly operating cost: $0**

---

## Two-Pass Scoring (images for MAYBE only)

**Pass 1 — text only, all new listings:**
- Fast, cheap
- Produces YES / MAYBE / NO
- YES items → alert immediately
- NO items → mark, discard
- MAYBE items → pass 2

**Pass 2 — image scoring for MAYBE items only:**
- Include `image_url` in prompt for each MAYBE listing
- Claude fetches and evaluates image alongside text
- Re-scores: YES (alert) or NO (discard)
- If image URL unavailable or auth-gated → keep as MAYBE, alert with lower confidence note

This two-pass approach uses images where they matter (ambiguous items) without multiplying cost across all listings. Image tokens (~1,500 per image) only incurred for MAYBE items, which at steady state is 2-5 listings/run.

**Cost impact at steady state:** 3 MAYBE items × 1,500 image tokens = 4,500 extra tokens = $0.0045/run. Negligible.

---

## Few-Shot Injection (learning over time)

On each run, the system prompt builder reads recent feedback from the DB and appends examples:

```
Recent items you liked (score these similarly):
- [Helmut Lang] Black slub cotton crewneck, relaxed, excellent condition — WHY: quality fabric, Cave-adjacent
- [Unknown brand] Wide-wale corduroy overshirt, dark olive, relaxed fit — WHY: texture, workwear, BJM vibe
- [Engineered Garments] Wool shirt jacket, charcoal, structured — WHY: quality construction, interesting fabric

Recent items that were wrong (avoid these):
- [Ralph Lauren] Blue striped oxford shirt, slim fit — WHY: wrong color, too preppy, slim
- [Zara] Black graphic print t-shirt — WHY: graphic, fast fashion, wrong quality tier
- [Unknown] Light grey polo shirt — WHY: wrong color, wrong style
```

Builder logic:
```typescript
function buildSystemPrompt(config: Config, db: Database): string {
  let base = config.aestheticPrompt;  // from config.yaml

  const positives = db.fetchFeedback("positive", 15);
  const negatives = db.fetchFeedback("negative", 15);

  if (positives.length > 0 || negatives.length > 0) {
    base += "\n\n## Your actual preferences (weight these heavily):\n";
    if (positives.length > 0) {
      base += "Items you liked:\n";
      for (const f of positives) {
        base += `- [${f.brand ?? "Unknown"}] ${f.title.slice(0, 80)} — ${f.description.slice(0, 100)}\n`;
      }
    }
    if (negatives.length > 0) {
      base += "\nItems that were wrong:\n";
      for (const f of negatives) {
        base += `- [${f.brand ?? "Unknown"}] ${f.title.slice(0, 80)} — ${f.description.slice(0, 100)}\n`;
      }
    }
  }

  return base;
}
```

**Learning curve:**
- 0-10 feedback events: prompt is static, same as baseline
- 10-25 events: noticeable improvement in YES/NO accuracy
- 25-50 events: strong calibration to actual preferences
- 50+ events: rotate to most recent 30, oldest examples fall off

**Caching advantage:** Once system prompt hits 4,096+ tokens (it will after injecting ~20 examples), prompt caching kicks in. Cache the full system prompt including examples. At that point caching saves real money — the example block is the same across all batches in a run.

---

## Honest Accuracy Assessment

| Scenario | Accuracy estimate |
|----------|------------------|
| Text-only, no feedback, known brand | ~70% |
| Text-only, no feedback, unknown brand | ~50% |
| Text + image, no feedback | ~80% |
| Text + image, 30+ feedback events | ~85-90% |

The tool will make mistakes. False positives (alerts for bad items) are annoying. False negatives (missing good items) are costly — you never see the item. The MAYBE→image-check step is specifically designed to reduce false negatives on ambiguous listings.

**What the LLM genuinely cannot assess from text or image:**
- Fabric hand-feel and weight
- Construction quality of seams and buttons (not visible in standard listing photos)
- Whether "relaxed fit" means your relaxed or their relaxed
- Seller reliability / actual condition vs described condition

These require physical inspection. The tool surfaces candidates — you still make the final call.

---

## Query Refinement Over Time

As feedback accumulates, the system can suggest search query improvements:

- Brands appearing in 3+ positive feedback events → add to platform search queries
- Brands appearing in 3+ negative feedback events → add to pre-filter blocklist
- Texture keywords appearing in positive feedback → boost in queries
- This runs as a weekly analysis, not per-run — see future spec

Not in v1. Document as v2 enhancement.

---

## Parse Error Handling

LLMs can return malformed JSON, markdown fences, partial output on large batches, or omit listings. Implementation must:
1. Strip markdown fences before parsing (`json.loads` will fail otherwise)
2. On `json.JSONDecodeError`: log the raw response, treat all listings in that batch as MAYBE, re-score individually on next run
3. On missing `listing_id` in response: treat as MAYBE
4. Never silently drop a listing — missing = MAYBE, never NO

---

## Tuning

The aesthetic prompt lives in `config.yaml` under `aesthetic_prompt`. Edit it without touching code. Changes take effect next run. No retraining or redeployment needed.

If false positives are high: add specific exclusions to the hard-NO list.
If false negatives are high (missing good items): loosen the MAYBE threshold or add texture keywords.
