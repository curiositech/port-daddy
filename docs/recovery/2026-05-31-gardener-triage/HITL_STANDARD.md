# Port Daddy HITL Review Standard

> First instance shipped 2026-05-31 in this directory. **Become the canonical pattern for any Port Daddy human-in-the-loop review surface.**

## What it is

A single-file, offline-capable, beautiful static HTML review UI. Drop one `index.html` next to a directory of artifacts and you have a complete HITL workstation. No server. No build step. Works on `file://`.

`index.html` in this directory is the reference implementation.

## Why this matters

The operator does not want HITL queues that live in spreadsheets, GitHub issue lists, or Linear boards built for someone else's workflow. HITL for an AI-shipping operator needs:

- **Cluster awareness** — each item arrived in a bucket for a reason; filter by it
- **Inline diff visualization** — version control deltas rendered next to the decision
- **Linked artifacts** — A/B HTML comparisons, screenshots, generated images, PR URLs
- **Four-state decision** — approved / rejected / modify-with-reason / skip — not just yes/no
- **Persistence without a database** — `localStorage` keeps decisions across sessions; JSON export is the durable trail
- **Keyboard-first** — `j`/`k` to navigate, `a`/`r`/`m`/`s` for decisions, `/` to search, `esc` to close
- **Vision-accessible** — 16px base, 13px floor for any text, full font-scaling respected; dark mode via `prefers-color-scheme`

## The contract

Any future gardener / approver / cartographer / cockpit surface that asks the operator to make a yes-no-modify decision over a list of artifacts SHOULD:

1. Emit a single `index.html` next to its `raw/`, `diffs/`, `compare/`, `assets/` subdirs.
2. Inline all item metadata as JSON in the HTML. Side-load heavy diff content via separate fetched files in `diffs/`.
3. Use the four decision states: `approved`, `rejected`, `modify`, `skip`. Modify requires a reason; the others don't.
4. Store decisions under a versioned `localStorage` key (`pd-triage-decisions-<date>` style) so multiple instances can coexist.
5. Provide an `Export decisions` button that downloads the full decision set as JSON, ready for ingestion by `pd` (when [[triage-taxonomy-in-pd-db]] lands).
6. Render in light AND dark mode via `@media (prefers-color-scheme: dark)`.
7. Never use `font-size: < 0.875rem` on body or caption text. Eyebrow labels at 12px require weight ≥600 + uppercase + tracking ≥0.06em.
8. Never lock viewport zoom.

## Reference implementation map

| File | Purpose |
|---|---|
| `index.html` | The UI. Single file, ~1.4MB with all metadata embedded |
| `raw/inventory.json` | Source-of-truth pre-classification data |
| `raw/classified.json` | Item-by-item cluster assignment + signals |
| `raw/duplicates.json` | File-overlap pair candidates for DUPLICATIVE_CAN_HARVEST |
| `raw/screenshot-list.png`, `raw/screenshot-modal.png`, `raw/screenshot-dark.png` | Visual regression baselines |
| `diffs/<branch-slug>.diff` | Per-HITL diff stats + first 300 lines of unified diff |
| `compare/<i>_<a>__VS__<b>.html` | Side-by-side comparisons for duplicate-pair candidates |
| `cluster-<NAME>.md` | Per-cluster markdown tables (the alternative read path) |
| `README.md` | Top-level index with counts + HITL queue + methodology |
| `HITL_STANDARD.md` | This file |

## What gets embedded inline vs side-loaded

| Asset | Inline in `index.html`? | Why |
|---|---|---|
| Item metadata (528 items, ~530KB) | ✓ | filter/sort/search require it in-memory |
| Reasons, decision state | ✓ | small, drives card UI |
| Diff stats + first 120 lines | ✓ | enough to make most decisions without leaving the modal |
| Full unified diff | side-loaded via `diffs/` | large; only matters when expanding |
| A/B HTML comparisons | side-loaded via `compare/` | independently shareable |

## When to roll this forward into the PD UI

The architecture fork (`docs/architecture/2026-05-31-agent-abstraction-strategy.md`) proposes a release-engineer agent that ships as `agents/release-engineer.yaml` and emits to four runtimes. When that lands, the release-engineer (or any approver agent) should:

1. Compute the triage payload (cluster, reasons, diff, artifacts).
2. Emit this directory layout as its output contract.
3. Optionally — when `pd backup` (PR #157) lands and [[triage-taxonomy-in-pd-db]] follows — write the same payload to PD's SQLite so the UI becomes a read view over the live DB.

The same HTML scaffolding becomes the live dashboard page once the data is sourced from PD.

## Acceptable extensions

- Mermaid-rendered dependency graphs in the modal when an item has linked roadmap items
- Inline image previews when an item's artifacts include generated PNGs
- Per-cluster summary metrics ("median age", "total +/-")
- A second tab for the operator's prior decision history across all gardener runs

## Anti-patterns to refuse

- Putting decision state in a backend the operator can't run offline
- Replacing the four-state model with binary approve/reject
- Using emoji as icons in the action buttons — UTF symbols are fine (✓ ✗ ✏ ⊘); platform emoji are not
- Dropping the keyboard shortcuts in favor of mouse-only
- Compressing the layout below 14px to fit more on screen
