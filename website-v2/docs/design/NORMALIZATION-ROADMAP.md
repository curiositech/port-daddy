# Website Normalization — the pessimistic plan

**Goal.** Every route on portdaddy.dev in the story-linework register, built on
one design system, with zero off-system values in production components.

**Status.** Intake complete, measured 2026-09-08. Nothing in Wave 0 has started.
This document is the plan of record; it is wrong the moment the numbers move, so
re-run the intake command before trusting any figure in it.

---

## 1. The finding that reorders everything

The deck shipped today at `/whitepaper` and `/research` is the target *look*.
It is not the target *system*. The contract audit puts
`src/pages/whitepaper/index.tsx` at **110 violations** — the site's
second-worst raw-colour offender, because its `PART_INK` map hard-codes
twenty-one hexes at lines 31–33 — and `DeckShell` sizes its type with
`text-[15px]`, `text-[clamp(22px,2.4vw,34px)]` and friends throughout.

That matters more than it sounds. "Convert the site to this style" executed as
"write every page the way the deck is written" would take a per-file drift of
~110 and multiply it across 187 routes. The deck is the reference
implementation or it is the vector.

**So Wave 0 is not the rest of the site. Wave 0 is the deck.** Promote its
values into tokens, rebuild it on them, and only then let anything copy it.

## 2. Current-state intake (measured, not estimated)

Re-run: `python3 ~/.claude/skills/ideal-web-app-builder/scripts/audit_web_app_contract.py website-v2`

| Measure | Now | Target |
|---|---:|---|
| Arbitrary Tailwind values (`text-[14px]`, `bg-[var(--x)]`, …) | **8,897** | 0 in `src/pages` and `src/components` |
| Raw colour literals outside token sources | **223** | 0 outside `styles/tokens.source.css` and generated files |
| Components with no Storybook story | **90** of 117 | 0 for primitives and composites |
| Primitive bypasses (raw HTML where a primitive exists) | **58** | 0 |
| Placeholder/fake-content markers | **11** | 0 |
| Routes | **187** | — |
| `.tsx` files | **311** (189 pages, 117 components) | — |
| Storybook stories | **9** | one per primitive and composite |
| Sentry or equivalent | **absent** | configured with release, env, source maps |
| Terms / privacy surfaces | **absent** | present or recorded as out of scope |

Where the mass sits: **5,822** violations in `src/pages`, **3,192** in
`src/components`. The single worst file is `src/components/site/primitives.tsx`
at **286** — the primitives file is the biggest offender in the codebase, which
is exactly backwards and is why Wave 1 is where it is.

Top ten by count: `site/primitives.tsx` 286 · `whitepaper/HowWeProveGameTheory`
281 · `ManifestoPage` 274 · `AgentsPage` 214 · `whitepaper/PaperDetailPage` 196
· `whitepaper/RoundsPage` 159 · `HarnessPage` 157 · `docs/features/FleetFeature`
155 · `landscape/index` 154 · `ScoutPage` 142.

**What is already good, and is the reason this is tractable.** The three-layer
token model exists and is real: `tokens.source.css` (304 lines, the only place
hexes belong) → `tokens.semantic.css` (318) → `tokens.roles.css` (66, the
component/application layer). Radix is a dependency. The story palette is
CIEDE2000-separated and documented in `BRAND.md` and `color-rollout.md`. The
ICS flag alphabet landed today as `styles/signal-flags.css`.

The job is not building a design system. **The job is routing 8,897 bypasses
through the one that already exists.**

## 3. The gate, and why it comes before the work

8,897 is not a number anyone fixes by hand, and a sweep that lands in one PR is
a sweep nobody can review. The mechanism is a **ratchet**:

1. Land `scripts/check-design-drift.mjs` (proposed — it does not exist yet)
   wrapping the audit, with a committed baseline file recording the current
   count per directory.
2. CI fails if any count **rises**. It does not fail on the existing debt.
3. Every wave lowers the baseline and commits the new number.

This is the difference between a cleanup that finishes and one that is re-done
in six months. Without the ratchet, wave 6 re-dirties what wave 2 cleaned and
nobody notices until the next audit.

**Also fix the reason nobody noticed.** CI runs only `test:porthole` for this
package, never the vitest suite — which is how 18 contract tests came to be red
with no signal. Wiring the suite in *now* would create a red gate on arrival, so
it is sequenced: Wave 1 fixes the 18, Wave 1 wires the suite, and the ratchet
starts the same day.

## 4. Waves

Sequenced by mass and by blast radius. Each is one PR, each ends green, each
lowers the baseline. Estimates are working sessions, and they are pessimistic
on purpose.

### Wave 0 — Make the deck the reference implementation (1 session)
The style must be expressible in tokens before it is copied 187 times.
- Promote `PART_INK` to semantic tokens (`--part-machine`, `--part-operator`,
  `--part-person`, `--part-market`, each with its `-on` ink), light and dark.
- Promote the deck's type steps to role tokens (`--deck-head`, `--deck-body`,
  `--deck-label`) instead of `text-[15px]`.
- Rebuild `DeckShell`, `/whitepaper`, `/research` on those tokens.
- **Gate:** those three files at 0 violations. Re-measure and record.
- **Deliverable:** the deck becomes the thing every later wave copies.

### Wave 1 — The primitives, and the tests that guard them (2 sessions)
- Rewrite `src/components/site/primitives.tsx` (286) on role tokens. Everything
  downstream inherits the fix, so this is the highest-leverage file on the site.
- Close the 58 primitive bypasses.
- Fix the 18 red contract tests (drift from the Textbook Edition rewrite; they
  pin copy that no longer exists — re-pin to shape, as the whitepaper contract
  now does).
- Wire `npm test` for `website-v2` into CI, and land the drift ratchet.
- **Gate:** suite green, ratchet armed, primitives at 0.

### Wave 2 — Storybook as the state matrix (2 sessions)
90 components have no story, so no component has a recorded empty, loading,
error, or focus state. This is not documentation work — it is where those states
get *defined*.
- Stories for every primitive and composite: default, hover, focus-visible,
  active, disabled, loading, error, empty, selected, dark, responsive.
- **Gate:** 0 primitives/composites without a story.

### Wave 3 — The library routes (1 session)
Already in the register after today. Normalize the rest of the family:
`PaperDetailPage` (196), `RoundsPage` (159), `HowWeProveGameTheory` (281).
Decide whether `RoundsPage` and `HowWeProveGameTheory` become deck panels
rather than routes — both are single-subject pages that the deck idiom fits.

### Wave 4 — The landing and product pages (3 sessions)
`ManifestoPage` (274), `AgentsPage` (214), `HarnessPage` (157), `ScoutPage`
(142), `landscape` (154), `SecurityPage` (136), the `landing/` components
(`TubeMultiplexSection` 135, `MacAppShowcase` 125). Highest visitor traffic,
so this is where the register change is actually *seen*.

### Wave 5 — Docs shell (3 sessions)
`docs/` pages and components — the long tail, and the most mechanical. Best
candidate for bounded subagents once Waves 0–2 have set the pattern: disjoint
write sets, one directory each, the ratchet as the acceptance gate.

### Wave 6 — The rest, then zero (2 sessions)
`pd-tube` demos, `viz/`, `blueprints/`, `integrations/`. Baseline reaches 0 and
the ratchet flips from "must not rise" to "must stay at 0".

### Wave 7 — Production foundations (2 sessions)
Not polish, and not optional — recorded here because the audit found them
missing, not because a checklist asked:
- Sentry with release, environment, source maps, and a privacy-aware
  replay/tracing policy. Currently there is no error reporting at all: the
  first real user is the monitor.
- Terms and privacy surfaces, or an explicit written decision that this site
  does not need them.
- The 11 placeholder-content markers resolved.
- Per-page OG images in the `og.html` register; SEO metadata audit.

## 5. What this plan does not do

Stated so the omissions are decisions rather than oversights.

- **No visual redesign beyond the register.** The story-linework direction is
  settled; this roadmap is about making it systematic, not re-opening it.
- **No i18n.** The site is English-only and there is no localisation plan;
  recorded as an intentional constraint, not an unowned risk.
- **No component library swap.** Radix stays. Tailwind stays.
- **No route consolidation beyond Wave 3's question.** 187 routes is a lot, but
  pruning them is a content decision and belongs to whoever owns the content.

## 6. Risks, pessimistically

- **The ratchet gets bypassed.** A `--no-verify` culture kills it in a month.
  Mitigation: the baseline is a committed file, so a bypass shows in the diff.
- **Wave 1 is bigger than it looks.** `primitives.tsx` is consumed everywhere;
  changing its token surface may cascade. Mitigation: it is the second wave, not
  the first, so the deck has already proven the token vocabulary.
- **Storybook rots.** 9 stories today is what happens when nobody gates them.
  Mitigation: the audit already warns per-component; promote to error in Wave 2.
- **8,897 is the count the tool finds.** It flags `bg-[var(--token)]`, which is
  arbitrary syntax around a legitimate token, so some fraction is a
  find-and-replace into a Tailwind theme extension rather than a real design
  decision. That fraction is unmeasured. Wave 0 measures it on three files and
  the estimate for Waves 3–6 should be revised from what it finds.
- **Sessions are estimates from file counts, not from having done it.** The
  first wave that overruns should update this table rather than absorb it
  silently.

## 7. Verification, per wave

Every wave, no exceptions:
- `npx tsc -b && npm run build`
- `npx vitest run` — no new failures against the previous wave's set
- audit re-run, baseline lowered and committed
- the viewport/overflow measurement for any route touched
  (page scroll +0, horizontal +0, both themes, ≥4 widths)
- light and dark screenshots of every route touched

## Change log

- 2026-09-08 — intake measured, plan written. Nothing executed yet.
