# Book publication candidate: visual evidence

These images and the video show the local publication preview captured on 5 November 2026. They are not proof of a deployed site.

## Browser capture

`book-public-navigation.webm` is an actual Playwright Chromium viewport recording: 1440×1100, 10.8seconds, VP8. It shows the book landing page, navigation to the first chapter overview, return, keyboard activation of the source link, and appearance switching. No desktop or private pages were recorded.

The PDF and facing-pages links were fetched directly from their rendered local destinations. The source archive used the exact candidate bytes with an explicitly scoped Playwright attachment-header shim: Vite otherwise sends `.tar.gz` as `Content-Encoding:gzip`, which Chromium transparently decodes. Raw local HTTP bytes were hashed independently. This is local candidate interaction evidence; the real Pages/R2 redirect and deployed downloads require separate validation.

| Artifact | SHA-256 |
| --- | --- |
| Read book (PDF) → | `689c7b03ab86233e1db7cb081896a90594e6cbe81a7ff4b59d5d60fa2286d1aa` |
| Read facing pages (PDF) → | `732f0f3da1737283e177b8327bb118f3446f14b9e6cdeba4f1097ab3f135fb2f` |
| Download LaTeX source (.tar.gz) ↓ | `d90a9d6e7ff2985f9d89e1efee6b9ce76042619f8a5129505a5108e438fe1512` |

## Stills

- Desktop light/dark: 1440×1100.
- Phone light/dark: 390×844.
- Desktop 200% root text: 1440×1100.
- Phone 200% root text: 390×1100.

The 200% cases passed menu Enter/Escape/Tab and focus-return checks, with no horizontal overflow or wordmark/menu collision. The browser reported no JavaScript page errors. All displayed metadata says 817 pages.

## Print evidence

The curated preface, contents, and decoded-claims spreads are excerpts from the accepted publication candidate. The final PDF has 817 pages; a 108 dpi comparison to the fully reviewed candidate found only physical pages 210 and799 changed. Both changed spreads were independently inspected; the remaining 815 pages retain pixel-identical visual acceptance.

Detailed receipts are retained in the task evidence directory.
