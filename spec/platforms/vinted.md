# Platform: Vinted

## Status: Deprioritized — enable in v2

## Reason for Deferral

- Inventory skews EU — less relevant for US buyer
- Datadome protection requires most maintenance of all platforms
- `vinted-scraper` PyPI package exists but requires monitoring for breakage
- Other 5 platforms cover the use case for v1

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
- TLS fingerprinting via curl-cffi (may be needed if Datadome upgrades)
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

Datadome escalates protections periodically. If `vinted-scraper` breaks:
1. Check for updated package version: `pip install --upgrade vinted-scraper`
2. Check package GitHub for open issues
3. If package is broken: fall back to manual session with `curl-cffi`

### Rate Limits

- 1-2 searches per run, 96 items max per search
- Add 2-3 second delay between requests
- At personal volume (~24 runs/day) should not trigger blocks
