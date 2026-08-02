# 05 — Alert System

This document specifies how Fashion Monitor notifies you when a listing gets a YES or MAYBE Score (the LLM's verdict on a listing — see CONTEXT.md).

## Delivery Method: Telegram

Fashion Monitor sends alerts through Telegram, a messaging app with a free bot API (an interface other programs can use to send messages through it).

**Why Telegram:**
- Free, no monthly cost.
- Supports images inline — important for clothing listings.
- Sends instant push notifications to your phone.
- Its bot API is simple and well documented.
- Works without running your own server — just an HTTP POST request to api.telegram.org.

**Alternative considered:** email. Rejected because images need attachments, there's no push notification, and it's slower.

---

## Setup (one-time)

1. Message @BotFather on Telegram, create a bot, and get a `TELEGRAM_BOT_TOKEN`.
2. Start a chat with the bot.
3. Get your chat ID from `https://api.telegram.org/bot{TOKEN}/getUpdates`.
4. Store both values in `.env` (the environment file that holds secrets).

---

## Alert Format

### Immediate Mode (default)
In immediate mode, the default, the system sends one message per YES or MAYBE listing, as soon as scoring finishes.

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

Size uncertainty is common and expected. A MAYBE based on size alone is still worth alerting on. EU sizing, Japanese sizing, oversized cuts, and listings with only measurements (no size label) all surface as UNCERTAIN, and are worth a quick look.

The image, if there is one, is sent as a photo attachment above the text, using Telegram's `sendPhoto` call with a caption. If no image is available, the alert is text-only.

### Digest Mode (optional)
Digest mode bundles every YES/MAYBE match from a run into a single message. Use it if a run produces enough matches that individual messages get noisy.

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

Switch between modes with `alert.mode` in `config.yaml`.

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

This uses Telegram's `InlineKeyboardMarkup` (a way to attach tappable buttons to a message). When you tap a button:
- The bot receives a `callback_query` (Telegram's event for a button tap) carrying the `listing_id` and a signal, `positive` or `negative`.
- The bot writes a record to the `feedback` table.
- The bot replies: "Got it — I'll learn from this."

**The Telegram bot must poll for updates**, or use a webhook, to receive button-tap callbacks. A simple polling loop, running as a lightweight separate process or thread and checking every 30 seconds, is enough — there's no need for a real-time response.

This feedback powers the few-shot injection described in 04-llm-scoring.md (the process of adding recent feedback examples to the LLM prompt). The system gets meaningfully better after 20-30 button taps, and needs no other action from you.

## No-Match Runs

By default, a run with zero matches sends no message. You can optionally enable a brief "No matches this run" ping with the `alert.notify_empty` config flag. It's off by default.

---

## Error Handling

If a platform scraper fails, log the error, keep going with the other platforms, and note the failure in the run log. Don't send a Telegram alert for a scraper error unless the entire run fails.

If the Claude API call fails, log it, skip scoring for that batch, and don't alert. The pipeline tries again on the next run.

If sending a Telegram message fails, log it and retry once after 30 seconds.

---

## Rate Limiting

Telegram allows 30 messages per second per bot. At personal-use volume — 10 or fewer alerts per run — this limit is never a concern. Add a 0.1-second delay between messages anyway, as good practice.

---

## Alert History — Web App

The web app (`apps/web`) gives you a browsable view of the `alert_log` table. Users with the Curator role or above (see CONTEXT.md's Role definitions) can:
- Filter by Monitor (a saved search — see CONTEXT.md), platform, score, and date range.
- See the full scoring breakdown (aesthetic, quality, value) and the LLM's stated reason.
- Mark feedback directly from the web UI, as an alternative to the Telegram ✅/❌ buttons.

Telegram push stays the primary real-time delivery channel. The web app is for review and analytics, not first notification.

---

## Future: Price Drop Alerts

If a previously-seen listing's price drops by more than 20%, re-alert on it even though it's already been seen. This isn't in v1 (the first release) — it needs the system to store a price history per listing.
