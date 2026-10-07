---
name: layout-overflow-guard
description: >-
  Mechanically detect text overlap, overflow, truncation, and horizontal page
  scroll in any HTML page or web artifact — before shipping it. Purely
  geometric: renders headlessly and measures tight glyph-level bounding boxes
  from Range.getClientRects(), then flags text-vs-text collisions, clipped/
  ellipsis-truncated elements, text escaping its container, and body horizontal
  scroll. No LLM, no vision. Use whenever you produce or edit a UI, Artifact,
  HTML page, dashboard, chart, or component, and ALWAYS before declaring visual
  work done. Triggers: "overflow", "truncation", "text overlap", "clipped",
  "collision", "check layout", "does the UI fit", "before I ship this page".
---

# layout-overflow-guard

Visual bugs hide in the gap between source and rendered output. Eyeballing a
screenshot misses collisions that only appear at a specific width or in one
theme. This skill closes that gap with a deterministic geometry check you run
yourself — never make the user be your overflow detector.

## The rule

**Always run this on any UI/HTML/Artifact you create or edit, at multiple
widths and in both themes, and drive it to zero violations before you ship or
call the work done.** Overflow and truncation are defects, not judgment calls.

## What it detects (purely mechanical)

1. **COLLISION** — two text runs from different elements whose tight
   axis-aligned bounding boxes intersect. Visible text overlapping other text
   is always a bug. Uses `Range.getClientRects()` for glyph-tight boxes, not
   loose element padding boxes, so it catches real visual overlap and ignores
   normal nesting.
2. **OVERFLOW** — an element clipped or ellipsis-truncated because its content
   is larger than its box (`scrollWidth/Height > clientWidth/Height` with
   `overflow: hidden/clip` or `text-overflow: ellipsis`). This is text being
   cut off.
3. **TEXT-ESCAPE** — a text run extending past its nearest block ancestor's
   content box: text spilling outside its container.
4. **PAGE-SCROLL** — the document scrolls horizontally (body wider than the
   viewport). The page body must never scroll sideways.

Exit code is non-zero if anything is found, so it drops into a test/CI gate.

## Usage

```bash
python3 ~/.claude/skills/layout-overflow-guard/scripts/check_layout.py \
  <file-or-url> \
  --widths 1100,860,720,390 \
  --themes light,dark \
  --json /tmp/layout-report.json   # optional full geometry dump
```

- Accepts a local file path (auto-prefixed `file://`) or a URL.
- Defaults: widths `1100,860,720,390`, themes `light,dark`.
- `--min-overlap N` sets the px overlap (both axes) required to flag a collision
  (default 2.0, to ignore sub-pixel rounding).
- Requires `playwright` + chromium (`pip install playwright && playwright
  install chromium`). Always runs `headless=True` per the global rule.

## Reading output

```
[OK  ]    light@1100  (0 issues)
[FAIL]     dark@390    (2 issues)
        COLLISION  '0.75' (.tick > .pct) overlaps 'custodian builds...' (.tick > .act) by 118x14px
        PAGE-SCROLL body scrolls horizontally by 22px ...
PASS/FAIL summary + exit code
```

Each violation names the offending text and its CSS path so the fix is
targeted. Fix, re-run, repeat until every config prints `OK`.

## When a "collision" is intentional

Deliberately stacked text (a caption over an image, a badge over a chip) is rare
for pure text-over-text. If you truly intend an overlap, exclude that subtree by
restructuring so one side isn't a live text node (e.g. background image), rather
than suppressing the check — the check should stay honest for everything else.

## Pairs with

- `make_copy_and_media_human` — humanize the copy after the layout is sound.
- Any Artifact/UI work — this is the gate between "wrote it" and "shipped it".
