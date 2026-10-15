# Book visual review atlas

Build the offline review site from an extracted inventory and optional expert records:

```sh
python3 scripts/book-visual-atlas/build.py .scratch/visual-atlas/inventory/atlas.json \
  --output .scratch/visual-atlas/site --reviews path/to/reviews.json
```

Open `site/index.html`. No server, fetch, CDN, external font or package install is needed. Keep the inventory beside the site: preview and page-context links point to those existing assets. The builder does not copy hundreds of megabytes into tracked source. Source links open portable, hash-bound snapshots packaged with the site.

The root inventory uses `title`, `pdfSha256`, and `items`. Item records carry `id`, `title`, `type`, `chapter`, `purpose`, `occurrences[{page,printedPage,crop,context,bbox}]`, `source`, and `dataProvenance`. Expert reviews are arrays or `{records:[]}` / `{items:[]}`, matched by ID. Review records follow `docs/harbor-research/visual-atlas-rubric.md`. `craft` and `information` are 0–100; their equal mean defines ranking. Missing either leaves the work unranked. Unknown provenance is displayed as unknown. Extraction is not visual judgment.

Choose a visual family for drag arrangement or use the up/down buttons by keyboard. Reordering switches to My arrangement. Filters only change the view. Compare checkboxes retain selections across families. The inspector records separate type/score/notes/exemplar overrides and shows the original expert assessment. Browser storage is scoped by PDF SHA-256. Export decisions for portability; imports reject incompatible versions, different PDF editions, unknown IDs, duplicate arrangement IDs, unsupported fields and invalid scores. Text is escaped before HTML insertion. Imports replace the current edition's decisions; export first to retain another arrangement.

Print review prints the currently filtered family in its current order. Export decisions is the complete machine-readable editorial record, including author, date, and reason. Generated assets and UI test evidence belong under `.scratch/visual-atlas/`; the builder, interface and durable review ledger are tracked; generated image assets remain in the portable review package.

The default grid shows active works, with audit fragments and duplicate occurrences hidden. **Include excluded fragments and duplicates** restores those records and their exclusion reasons; they never acquire a quality score, even through an override. Coverage summaries distinguish active scored works from retained audit records. Expert provenance kind and chain status drive filters independently of quality.

The inspector presents the expert's purpose, contents, strengths, confirmed observations, improvements, eight dimension scores and rationales as readable editorial material. Raw review/provenance JSON, exact source/table excerpts and dependency receipts remain expandable. Every occurrence has its own full-resolution crop and page-context link. Publication blockers have a separate badge.

Initial rendering is limited to 48 works; Show next loads 48 more, with native lazy images and deferred offscreen rendering. Family selection and filters reset the display batch. Printing expands all matching works and restores the normal batch afterwards. Manual arrangement is retained across batches and families.

Run the browser regression check with an installed Playwright module and Chromium/Chrome, for example setting `PLAYWRIGHT_MODULE` to the module path and `CHROME_EXECUTABLE` to the browser executable, then running `node scripts/book-visual-atlas/test.cjs path/to/site/index.html`.
