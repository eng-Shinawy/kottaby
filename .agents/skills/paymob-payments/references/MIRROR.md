# How this docs mirror was built / how to refresh it

Source: https://developers.paymob.com/paymob-docs (Theneo-hosted Next.js docs).
Mirrored: 2026-06-11 · 116 pages · both tabs (Documentation + Developers).

The site blocks plain curl (403) but accepts a browser User-Agent. Page content
is not in the HTML body — it lives in the Next.js data layer:

1. `__NEXT_DATA__` on any page carries `documents.data.documentMenu` (full nav
   tree for both tabs) and `sectionMap` (every slug). The pipeline enumerates
   pages from there — new pages are picked up automatically on refresh.
2. Each page's full content (rich HTML description + structured API schema:
   endpoints, request/response params, status codes) is fetched from
   `/_next/data/<buildId>/customdomain.json?path=paymob-docs&path=<seg>…&xcustomdomain=developers.paymob.com`
   (the buildId is read from `__NEXT_DATA__`; it changes on every Theneo deploy).

## Refresh procedure

```bash
cd .claude/skills/paymob-payments/scripts
./fetch_mirror.sh /tmp/paymob_pages          # enumerate + download raw JSONs
pip install beautifulsoup4 html2text --break-system-packages  # once
python3 convert.py ../references/docs        # JSON -> markdown (uses /tmp/paymob_pages)
python3 postpass.py ../references/docs       # header stubs + stale-ID link rewrites
```

`convert.py` handles Theneo's Slate HTML (code blocks with hidden duplicate
textareas, callout widgets, accordions) and renders the structured API data as
markdown bullets. `postpass.py` replaces the 12 section-header pages (which
duplicate their first child on the live site) with stubs, and rewrites stale
old-version ID links by anchor text.

## Known source quirks (faithful, not bugs)

- `intention-apis/update-intention.md`: the "Missing Accept Order ID" JSON
  error sample is pasted twice with a missing opening quote — that's how it
  appears on the live site.
- A few pages (`convenience-fee`, `core-features/pay-with-saved-cards`) repeat
  a paragraph/section twice in the source.
- `getting-started/dashboard.md` ends mid-list on the live site too.
