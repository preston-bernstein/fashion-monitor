# Platform: Vinted

## Status: Deprioritized — enable in v2

Vinted is a secondhand-clothing marketplace, mostly used in Europe. It is not enabled in v1 of the scraper. This file specs how to turn it on later.

## Reason for Deferral

Vinted's inventory skews European, which matters less for a US buyer. Vinted's Datadome protection (an anti-bot detection service, similar to Cloudflare but a different vendor) demands more ongoing maintenance than any other platform in this repo. A Python package, `vinted-scraper`, already handles this platform, but it needs monitoring for breakage. The other 5 platforms already cover the v1 use case without it.

## Enable When

- v1 is stable and running cleanly for 2+ weeks
- Flip `platforms.vinted: true` in `config.yaml`

---

## Implementation (when ready)

### Dependencies

```
pip install vinted-scraper
```

### Usage

```python
from vinted_scraper import VintedScraper

scraper = VintedScraper("https://www.vinted.com")

params = {
    "search_text": "corduroy jacket dark men",
    "catalog_ids": "4",          # Men's category
    "size_id": "206",            # XL/XXL — verify current ID
    "price_to": "300",
    "order": "newest_first",
    "per_page": 96
}

items = scraper.search(params)
```

### What vinted-scraper handles

- Session cookie management
- Token refresh (`access_token_web`, `refresh_token_web`)
- Basic Datadome bypass for low-volume personal use
- Response parsing into structured objects

### What it does NOT handle at scale

- Residential proxy rotation (not needed at personal volume)
- TLS fingerprinting via `curl-cffi` (a library that mimics a real browser's encryption handshake) — may be needed if Datadome upgrades
- Geographic routing (vinted.fr vs vinted.de etc.)

### Response Normalization

```python
def normalize_vinted(item) -> Listing:
    return Listing(
        id=str(item.id),
        platform="vinted",
        title=item.title,
        description=item.description or "",
        price=float(item.price),
        currency=item.currency or "EUR",
        size=item.size_title or "",
        brand=item.brand_title,
        url=item.url,
        image_url=item.photo.url if item.photo else None,
        listed_at=item.created_at_ts,
        condition=item.status,
        raw=vars(item)
    )
```

### Maintenance Risk

Datadome escalates its protections periodically. If `vinted-scraper` breaks, follow these steps in order:
1. Check for updated package version: `pip install --upgrade vinted-scraper`
2. Check package GitHub for open issues
3. If package is broken: fall back to manual session with `curl-cffi`

### Rate Limits

- Run 1 to 2 searches per run, up to 96 items per search.
- Add a 2- to 3-second delay between requests.
- At personal volume (about 24 runs a day), this shouldn't trigger blocks.
