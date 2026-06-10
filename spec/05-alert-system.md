# 05 — Alert System

## Delivery Method: Telegram

**Why Telegram:**
- Free, no monthly cost
- Supports images inline — critical for clothing
- Instant push notifications on phone
- Bot API is simple and well-documented
- Works without a server (just HTTP POST to api.telegram.org)

**Alternative considered:** Email — rejected because images require attachments, no push, slower.

---

## Setup (one-time)

1. Message @BotFather on Telegram → create bot → get `TELEGRAM_BOT_TOKEN`
2. Start a chat with the bot
3. Get your chat ID: `https://api.telegram.org/bot{TOKEN}/getUpdates`
4. Store both in `.env`

---

## Alert Format

### Immediate Mode (default)
One message per YES/MAYBE listing, sent as soon as scoring completes.

```
[eBay] ✅ YES

John Varvatos — Linen Overshirt Black
$87 · Excellent · XXL

Quality ✓  Value ✓  Aesthetic ✓
"Retail ~$280, asking $87 excellent — good value. Dark linen, structured, Cave-adjacent."

[View Listing →]
```

MAYBE format shows which dimension is uncertain:
```
[Depop] 🟡 MAYBE

Unknown Brand — Wide Wale Corduroy Shirt
$45 · Good · Listed: XL

Quality ?  Value ✓  Aesthetic ✓  Size: uncertain
"Brand unknown, can't verify quality tier. Listed XL but seller says oversized boxy — 
 could fit. Fabric description looks right."

[View Listing →]

[ ✅ Good find ] [ ❌ Not for me ]
```

Size uncertainty is common and expected — MAYBE on size alone is worth alerting.
EU sizing, Japanese sizing, oversized cuts, and measurement-only listings
all surface as UNCERTAIN and are worth a quick look.

Image sent as photo attachment above the text (Telegram `sendPhoto` with caption).

If no image available: text-only message.

### Digest Mode (optional)
All YES/MAYBE matches from a run bundled into one message. Useful if runs produce many matches and individual messages become noisy.

```
Fashion Monitor — 3 matches found

1. [YES] John Varvatos Linen Overshirt — $87 (eBay)
   Dark linen, minimal, Cave-adjacent
   https://...

2. [MAYBE] Unknown Brand Corduroy Shirt Jacket — $45 (Depop)
   Wide-wale corduroy, dark brown — brand unknown but fabric looks right
   https://...

3. [YES] Helmut Lang Crewneck — $120 (Grailed)
   Black slub cotton, relaxed fit, excellent condition
   https://...
```

Switch between modes in `config.yaml` → `alert.mode`.

---

## Feedback Collection

Every alert message includes inline reply buttons:

```
[eBay] Score: YES

Helmut Lang Crewneck — Black Slub Cotton
$120 · Excellent · XXL

Why: Black slub cotton, relaxed fit, quality brand — Cave-adjacent.

[View Listing →]

[ ✅ Good find ] [ ❌ Not for me ]
```

Implemented via Telegram `InlineKeyboardMarkup`. When user taps a button:
- Bot receives `callback_query` with `listing_id` + signal (`positive` / `negative`)
- Record written to `feedback` table
- Bot replies: "Got it — I'll learn from this."

**Telegram bot must poll for updates** (or use webhook) to receive button callbacks. Simple polling loop runs as a lightweight separate process or thread. Check every 30 seconds — no need for real-time response.

This feedback powers the few-shot injection in 04-llm-scoring.md. System gets meaningfully better after 20-30 button taps. No other action required from the user.

## No-Match Runs

Silent by default — no message if zero matches found.

Optional: send a brief "No matches this run" ping if desired (config flag `alert.notify_empty`). Off by default.

---

## Error Handling

If a platform scraper fails: log the error, continue with other platforms, include a note in the run log. Do not send a Telegram alert for scraper errors unless the entire run fails.

If Claude API fails: log, skip scoring for that batch, do not alert. Try again next run.

If Telegram send fails: log, retry once after 30 seconds.

---

## Rate Limiting

Telegram allows 30 messages per second per bot. At personal use volume (≤10 alerts per run) this is never a concern. Add 0.1s delay between messages anyway as good practice.

---

## Alert History — Web App

The web app (`apps/web`) provides a browsable view of `alert_log`. Curators and above can:
- Filter by Monitor, platform, score, and date range
- See full scoring dimensions (aesthetic/quality/value) and LLM reason
- Mark feedback directly from the web UI (alternative to Telegram ✅/❌ buttons)

Telegram push remains the primary real-time delivery channel. The web app is for review and analytics, not first notification.

---

## Future: Price Drop Alerts

If a listing was previously seen but its price dropped significantly (>20%), re-alert even if already seen. Not in v1 — requires storing price history per listing.
