# Story palette rollout — fix-it tasks

The expanded **story palette** (see `BRAND.md` → "The story palette") adds four
new semantic hues — `--story-health`, `--story-indigo`, `--story-violet`,
`--story-rust` — plus the `--layer-*` aliases that map them onto the ADR-0048
L0→L3 stack. The tokens ship in `src/styles/tokens.semantic.css` (light + dark)
and are AA+ everywhere. This doc is the roll-it-out-everywhere checklist.

> **Why a standalone checklist and not `docs/ROADMAP.md`?** ROADMAP.md is a
> curated narrative fed by the Spark/Spider → IDEAS-TROVE → "Next Cuts"
> promotion pipeline; raw items don't belong inline. These are concrete,
> already-scoped design tasks — they live here and graduate into a roadmap wave
> only via `pd ideas` / the Cartographer harvest if they need sequencing.

Spec sheet: `website-v2/docs/design/story-palette-spec.png` (regenerate from
`story-palette-spec.html` with headless Playwright). A scroll-through
recording lives at `website-v2/docs/design/story-palette-spec.mp4`.

## Tasks

### 1. Chart palette — express the full L0→L3 stack
- **File:** `src/docs-content/chartTokens.ts`
- The `ChartSlot` set is currently 4 node tiers (`cobalt`/`green`/`accent`/`ink`).
  Reference-architecture diagrams that show the stack can only paint 4 classes,
  so L1/L3 collapse into the highlight tier.
- **Do:** add `health`, `indigo`, `violet`, `rust` slots mapped to the
  `--layer-*` / `--story-*` tokens, plus their `*Text` foreground slots. Then
  audit `src/docs-content/referenceArchitectures.ts` and `concepts.ts` for any
  stack diagram and re-tier its nodes by layer (L0 cobalt, L1 health, L2 teal,
  L3 violet, federation indigo, reputation rust, economy amber).

### 2. ADR-0048 stack table / "what Port Daddy is" surface
- **Files:** `src/docs-content/concepts.ts`, any component rendering the L0→L3
  layer table or stack badge (grep `L0`/`L1`/`L2`/`L3` in `src/components`).
- **Do:** color each layer row/badge with its `--layer-*` alias so the stack is
  *read* by color, not just by label. Cobalt/health/teal/violet down the column.

### 3. Library map & agent ecosystem viz
- **Files:** `src/components/site/LibraryMap.tsx` (retired 2026-09-06 with the rest of the reading-order apparatus; the table of contents in `src/components/library/TableOfContents.tsx` is the one map now),
  `src/components/landing/AgentEcosystem.tsx`,
  `src/components/viz/AgentNodeMark.tsx`
- **Do:** where these encode role/state with ad-hoc color, switch to story
  tokens — healthy/ready agents `--story-health`, identity/continuity surfaces
  `--story-violet`, reputation/Elo badges `--story-rust`. Keep surfaces neutral.

### 4. Fleet-health / reputation / identity feature accents (when built)
- **Roadmap items:** `fleet-health-scorecard`, reputation/Elo work,
  resurrection-with-memory surfaces (all in `docs/ROADMAP.md`).
- **Do:** these are the *literal* features the story hues were named for. When
  each lands, accent it with its story token (health scorecard → `--story-health`,
  Elo → `--story-rust`, identity/resurrection → `--story-violet`, Alice's-fleet
  federation views → `--story-indigo`).

### 5. Docs theme / Mermaid classDef defaults
- **Files:** wherever Mermaid `classDef` defaults are set for docs diagrams
  (follows from task 1's `chartTokens.ts` slots).
- **Do:** ship a `layer` classDef set so doc authors write
  `class kernel L0` and get cobalt automatically.

### 6. Storybook coverage
- **Files:** `src/components/ui/*.stories.tsx`, `SignalFlags.tsx` story.
- **Do:** add a "Story palette" `StateMatrix` story rendering all four new hues
  (+ on-tint, foreground) in light & dark so the a11y addon (`wcag2aaa`,
  `color-contrast-enhanced`) gates them as a release check.

### 7. OG cards / social imagery
- **Do:** the OG-card generator and blog hero prompts read `BRAND.md`. Update
  any hardcoded 4-color brand list to mention the story hues so generated
  imagery can use the full wheel (still accents, never page background).

## Acceptance
- [ ] `node scripts/check-brand-colors.mjs` green (retired hexes still banned)
- [ ] `vitest run src/design-system-contracts.test.ts` — brand-doc/token lockstep green
- [ ] No raw hex literals in protected modules (use `--story-*` / `--layer-*`)
- [ ] New surfaces verified AA+ in both themes at 200% zoom (headless Playwright)
