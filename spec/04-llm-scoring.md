# 04 — LLM Scoring

## Purpose

This document specifies how Fashion Monitor uses an LLM to score each listing against your aesthetic, instead of relying on fixed brand or keyword lists.

A brand list can't recognize an unfamiliar label — a Norwegian knitwear maker, a Japanese workwear brand — even when its clothes match your taste. The LLM reasons about the item itself, so it can surface those listings. It can also reject a listing from a known, trusted brand if that particular item doesn't fit the aesthetic.

---

## Provider Abstraction

The scoring code calls a single `LLMProvider` interface. It never calls Ollama or Claude directly. You switch providers by editing `config.yaml` — no code changes needed. This abstraction is the most interesting architectural piece of this feature, and worth highlighting if you show this project on GitHub.

```typescript
interface LLMProvider {
  scoreBatch(listings: PreparedListing[], systemPrompt: string): Promise<ScoringResult[]>;
  scoreWithImage(listing: PreparedListing, systemPrompt: string): Promise<ScoringResult>;
  healthCheck(): Promise<boolean>;
}

class OllamaProvider implements LLMProvider { ... }    // local, free, private
class ClaudeProvider implements LLMProvider { ... }    // cloud, ~$2-5/month, higher quality vision
class HybridProvider implements LLMProvider { ... }    // Ollama for text, configurable for vision
```

`HybridProvider` uses Ollama for the text batch pass (pass 1) and lets you pick the backend for the vision pass (pass 2). Set the vision backend with `llm.vision_backend` in the config: `"ollama"` or `"claude"`. See `packages/core/src/llm/hybrid.ts`.

The config file selects the provider:
```yaml
llm:
  provider: "hybrid"       # "ollama" | "claude" | "hybrid"
  batch_size: 15
  ollama_host: "http://192.168.1.X:11434"
  models:
    text: "qwen2.5:7b"
    vision: "llama3.2-vision:11b"   # omit if VRAM insufficient
  vision_backend: "ollama"          # "ollama" | "claude"
```

---

## Honest Capability Assessment

**Text scoring (pass 1): a 7B model is enough.**

Pass 1's job: given a listing's title, brand, description, price, and condition, decide YES, MAYBE, or NO against the aesthetic. That's structured classification with some context — a task a well-prompted 7B model handles reliably. `qwen2.5:7b` is especially good at following the structured-output format this system needs.

What 7B gets right:
- Known brand quality signals (Helmut Lang = quality, Zara = fast fashion)
- Explicit fabric/texture keywords (corduroy, waffle, wool)
- Hard-NO rules (graphic print, slim fit, tropical)
- Price tier signals (original retail $400 = quality tier)

What 7B gets wrong sometimes:
- Subtle aesthetic judgment ("does this read Cave or does it read Miami Vice")
- Unknown brands with no brand signal at all
- Very sparse listings (title only, no description)

These edge cases become MAYBE and move to pass 2. That's by design, not a failure.

**Vision scoring (pass 2): quality depends on your GPU.**

Vision models — LLMs that can also look at an image — differ a lot in how well they judge fabric texture, color accuracy, and aesthetic fit from a photo. Here's how they rank for this task, along with the VRAM each needs:

| Model | Capability | VRAM needed |
|-------|-----------|-------------|
| Claude claude-sonnet-4-6 | Best — strong aesthetic reasoning | cloud |
| Claude claude-haiku-4-5 | Good — fast, cheaper | cloud |
| `llama3.2-vision:11b` | Good for obvious cases, weaker on subtle texture | ~8 GB |
| `qwen2.5-vl:7b` | Good structured output, decent visual | ~6 GB |
| `llava:7b` | Acceptable, older architecture | ~5 GB |
| `llava-phi3` | Fast but weak on aesthetic nuance | ~3 GB |

**Recommended setup, by GPU tier:**

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

**The practical setup:** use Ollama for text scoring — it's free, private, and capable enough — and Claude's API only for vision, and only on MAYBE items (about 3-8 per run once the system is running steadily). Vision API cost is about $0.01-0.03 per run, under $1/month. You get the best quality where it matters (images) and keep the rest local and free.

---

## Ollama Structured Output

Use Ollama's built-in JSON schema enforcement (requires Ollama version 0.5 or later). It constrains the model's output token by token to match the schema, which is more reliable than the OpenAI-compatibility shim:

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

This guarantees structurally valid JSON at the token level — no markdown code fences, no parse errors. The Zod parse step afterward is a second check that catches any type mismatches.

---

## Expected Latency

| GPU | Text batch (15 listings) | Vision per MAYBE item |
|-----|--------------------------|-----------------------|
| RTX 3060 12GB | 15–25s | 8–15s local / 1–2s Claude |
| RTX 3080 10GB | 10–18s | 6–12s local / 1–2s Claude |
| RTX 3090/4080 24GB | 5–10s | 4–8s local / 1–2s Claude |
| RTX 4090 24GB | 3–6s | 2–5s local / 1–2s Claude |

At steady state — 10 to 20 new listings per run, 2 to 5 of them MAYBE — total scoring time is 20 to 60 seconds. That's well inside the 60-minute run cycle.

---

## Verdict Caching (biggest cost lever)

**Never re-score a listing that already has a verdict.**

The `seen_listings` table stores a `score` for each listing. Before sending anything to the LLM, filter out any listing where `score IS NOT NULL`. After the first week, most listings seen in a given run already have a score, so only genuinely new listings reach the LLM.

Without this filter, the LLM re-evaluates 40-80 stale listings every run, which wastes money for no benefit. With it, steady-state LLM input drops to 5-15 new listings per run — one or two batches at most.

**This is the single biggest cost reduction available. Build it first.**

---

## Pre-Filter Layer — hard rules, zero LLM cost

Three independent gates run before any LLM call. A listing that fails any one gate is rejected immediately, at zero LLM cost.

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
An item priced far below what its claimed brand normally sells for is likely a replica or badly damaged:
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

Never hard-reject a listing on size alone. Resale sizing is too inconsistent to gate on:
- Japanese/Korean brands run 1-2 sizes small (their XL = US L)
- Italian/European brands run slim (EU 54 ≈ US XL/2XL)
- Oversized cuts labeled S/M/L often fit much larger
- Vintage items rarely have accurate size tags
- Many listings have no size field, or list measurements instead
- Sellers frequently mislabel size

Instead, pass the size field and any measurements in the description to the LLM. The LLM judges fit likelihood using your actual body measurements as ground truth:

**User measurements (inject into system prompt):**
- Height: YOUR_HEIGHT
- Weight: ~YOUR_WEIGHT lbs
- Chest: ~YOUR_CHEST_SIZE"
- Pants: sizing is highly unreliable — default ALL pants to UNCERTAIN unless measurements listed.
  Target cut: mid-rise, relaxed or straight leg, wears with slight natural drop.
  Slim/tapered/low-rise won't fit regardless of waist label.
  
  Brand-level sizing tendencies (inform UNCERTAIN reason, never override to YES without measurements):
  - Japanese brands (Beams Plus, Needles, etc.): run 1-2 sizes small — size up from label
  - Italian/European: EU 56-60 range needed; often slim seat even at large waist — flag
  - Engineered Garments, Universal Works, vintage US military: relaxed cut, label 40-42 may work
  - Modern European slim cut: wrong pattern entirely, no sizing up fixes it — reject
  
  Pants with actual measurements (inseam × waist, or seat/thigh) → LLM can make a real call.
  Pants without measurements → always UNCERTAIN with note "verify measurements before buying".
  
  Note: tops are the primary use case for this monitor. Pants are a secondary, harder signal.
- Belly: ~44" at widest point — relevant for shirt drape through midsection, not pants fit
- Typical US size: XXL tops, though some XL oversized fits work
- Dress shirt: 18" neck, 34-35" sleeve

**LLM size assessment:**
```
"size": "HIGH"      — clearly compatible (XXL, 2XL, EU 54-56, measurements confirm)
"size": "UNCERTAIN" — could work (XL oversized, no size listed, EU 52, Japanese XL)  
"size": "UNLIKELY"  — probably too small (M, L regular fit, EU YOUR_CHEST_SIZE, chest < 46")
```

- HIGH, combined with a pass on quality, value, and aesthetic, produces a YES alert.
- UNCERTAIN, combined with a pass on everything else, produces a MAYBE alert with a size note.
- UNLIKELY produces a reject — the only size-based rejection, and only for clearly incompatible sizes.

**Measurements in the description override the size label.** If a listing says "chest 52 inches," that's a YES regardless of what the size tag says.

Together, these three gates eliminate roughly 40-60% of raw listings before any LLM call runs, and they catch the worst offenders first.

---

## Batching

- Group listings into batches of **15-20** per API call, not 10.
- Larger batches cut down how often the system prompt repeats across calls.
- 15-20 is the sweet spot: beyond 30 listings, the LLM's attention drops for items in the middle of the batch.
- Each listing is identified by its stable `listing_id`, never by its position in the list.

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
``` He is YOUR_HEIGHT, 250 lbs. Chest ~YOUR_CHEST_SIZE", belly ~44" at widest. Tops: XXL.
Pants: label 40-42 is unreliable — fit depends on seat/thigh room and rise.
Relaxed/straight cut with generous seat fits; slim cut or low-rise at 40-42 does not.
Pants sizing is unreliable — default to UNCERTAIN for all pants unless:
actual measurements are listed (inseam × waist, seat, or thigh), OR brand is known to run
relaxed/generous AND cut is explicitly described as relaxed/straight/wide-leg.
Japanese brands run 1-2 sizes small. Italian/EU brands run slim through seat even at large
waist labels. Modern European slim cut is wrong pattern entirely — reject.
Always note "verify measurements before buying" in pants UNCERTAIN reason.
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

Truncate each listing description to 500 characters (about 100 tokens) before sending it to the LLM. Sellers put the key signals — fabric, condition, brand details — in the first two or three sentences. Everything after that is usually shipping policy, measurements, or disclaimers: noise for scoring purposes.

```typescript
interface PreparedListing {
  listing_id: string;
  title: string;
  brand: string;
  description: string;
  price: number;
  condition: string | null;
  size: string;
  image_url?: string;   // included for vision pass (MAYBE items only)
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
    // image_url added only for vision pass — not included in text batch
  };
}
```

This one change cuts the token count per listing from about 150 to about 75-90, which lowers LLM input cost by roughly 40%.

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

## Signals the LLM Should Weight

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

**Default config (`provider: ollama`): $0/month.** Ollama runs on the always-on machine you already have. There's no API bill.

**The paid providers** (`claude`, `hybrid`) only run if you explicitly select them in `config.yaml`. The system never falls back to them automatically if Ollama goes down. The hybrid setup typically costs under $1/month if you use Claude only for the vision pass on MAYBE items.

**Total external service cost (default ollama config):**
- Telegram Bot API: **free**
- Ollama: **free**
- Synology NAS: already owned, already on
- GitHub Actions: **CI only** (free for public repos)
- Claude API: **not used unless configured**
- **Monthly operating cost: $0**

---

## Two-Pass Scoring (images for MAYBE only)

**Pass 1 — text only, every new listing:**
- Fast and cheap.
- Produces a YES, MAYBE, or NO.
- YES items alert immediately.
- NO items get marked and discarded.
- MAYBE items move to pass 2.

**Pass 2 — image scoring, MAYBE items only:**
- Include `image_url` in the prompt for each MAYBE listing.
- Claude fetches the image and evaluates it alongside the text.
- Re-scores the listing as YES (alert) or NO (discard).
- If the image URL is unavailable or requires login, keep the listing as MAYBE and alert with a lower-confidence note.

This two-pass approach uses images only where they matter — ambiguous items — instead of on every listing. Image tokens (about 1,500 per image) are only spent on MAYBE items, which is 2-5 listings per run at steady state.

**Cost impact at steady state:** 3 MAYBE items × 1,500 image tokens = 4,500 extra tokens = $0.0045 per run. Negligible.

---

## Seeded Feedback — ongoing ground truth

The `feedback` table (the Feedback signals described in CONTEXT.md — positive or negative examples fed into the LLM prompt) has two write paths.

**Path 1: Telegram thumbs up / thumbs down** — your in-the-moment reaction to an alert. Covered in 05-alert-system.md.

**Path 2: config seed** — you list known-good and known-bad pieces directly in `config.yaml`, at any time. The system loads these into the `feedback` table every time it starts a run. This lets you set ground truth before the first alert ever fires, and keep calibrating the system as you find new pieces — in stores, secondhand, anywhere.

```yaml
# config.yaml — add to at any time, takes effect next run
seed_feedback:
  positive:
    - brand: "Engineered Garments"
      title: "Fatigue Pant dark olive"
      description: "relaxed straight cut, mid-rise, cotton twill, fits well through seat"
      notes: "pants: relaxed US cut, this brand sizing works for me"
    - brand: "Unknown"
      title: "Wide wale corduroy overshirt charcoal"
      description: "cotton corduroy, boxy, patch pockets, dark charcoal"
      notes: "tops: this is exactly the texture and weight I want"

  negative:
    - brand: "Theory"
      title: "Slim trouser grey"
      description: "slim cut, tapered leg, wool blend"
      notes: "pants: slim cut doesn't fit regardless of brand or waist label"
    - brand: "Any"
      title: "graphic print tee"
      description: "screen print graphic front"
      notes: "hard no — wrong aesthetic entirely"
```

On startup, the system upserts (inserts, or updates if already present) seed entries into the `feedback` table with `source = 'seed'`. Seed entries are permanent — they don't rotate out the way Telegram feedback does. Telegram feedback still rotates to the most recent 30 entries; the seeds stay underneath as permanent anchors.

This means:
- Adding a piece you tried in a store that didn't fit calibrates the system immediately.
- Adding a piece you found and loved reinforces that signal.
- No alert is needed — this works entirely outside the monitoring loop.
- Seed feedback survives DB wipes, since it lives in the config file and gets reapplied on every startup.

**`source` column on the feedback table:** add `source TEXT NOT NULL DEFAULT 'telegram'`, with values `'telegram'` or `'seed'`. Seed entries are never rotated out, and always go first in the few-shot block.

---

## Few-Shot Injection (learning over time)

On each run, the system-prompt builder reads recent feedback from the database and appends examples to the prompt:

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
- 0-10 feedback events: the prompt stays static, same as the baseline.
- 10-25 events: noticeable improvement in YES/NO accuracy.
- 25-50 events: strong calibration to your actual preferences.
- 50+ events: the system rotates to the most recent 30 and the oldest examples fall off.

**Caching advantage:** once the system prompt reaches 4,096 or more tokens — which happens after roughly 20 injected examples — prompt caching kicks in. Cache the full system prompt, examples included. At that point, caching saves real money, since the example block stays the same across every batch in a run.

---

## Honest Accuracy Assessment

| Scenario | Accuracy estimate |
|----------|------------------|
| Text-only, no feedback, known brand | ~70% |
| Text-only, no feedback, unknown brand | ~50% |
| Text + image, no feedback | ~80% |
| Text + image, 30+ feedback events | ~85-90% |

The tool will make mistakes. A false positive — an alert for an item that isn't actually a match — is annoying. A false negative — missing a genuinely good item — is worse, because you never even see it. The MAYBE-to-image-check step exists specifically to cut down false negatives on ambiguous listings.

**What the LLM genuinely cannot assess from text or a photo:**
- How the fabric actually feels and how heavy it is.
- The construction quality of seams and buttons — not visible in standard listing photos.
- Whether "relaxed fit" means your idea of relaxed or the seller's.
- Seller reliability, or how the item's actual condition compares to its described condition.

These all need physical inspection. The tool surfaces candidates; you still make the final call.

---

## Query Refinement Over Time

As feedback accumulates, the system can suggest search query improvements:

- A brand appearing in 3 or more positive feedback events gets added to platform search queries.
- A brand appearing in 3 or more negative feedback events gets added to the pre-filter blocklist.
- A texture keyword appearing in positive feedback gets boosted in queries.
- This runs as a weekly analysis, not on every run — see a future spec for details.

This is not in v1 (version 1, the first shipped release). It's documented here as a planned v2 enhancement.

---

## Parse Error Handling

LLMs can return malformed JSON, wrap output in markdown code fences, return partial output on large batches, or omit listings entirely. The implementation must:
1. Strip markdown fences before parsing — `json.loads` fails otherwise.
2. On a `json.JSONDecodeError`: log the raw response, treat every listing in that batch as MAYBE, and re-score them individually on the next run.
3. Treat any response missing a `listing_id` as MAYBE.
4. Never silently drop a listing. A missing listing becomes MAYBE, never NO.

---

## Tuning

The aesthetic prompt lives in `config.yaml` under `aesthetic_prompt`. Edit it directly — no code changes needed. Changes take effect on the next run, with no retraining or redeployment required.

If false positives are high, add specific exclusions to the hard-NO list. If false negatives are high — meaning you're missing good items — loosen the MAYBE threshold or add more texture keywords.
