# Converting the website to the Swiss system

**On a proper design system, 100% normalized — where "100%" is a number a script prints, not a claim anyone makes.**

---

## 0. What "normalized" has to mean before it means anything

A design system that lives in a document is a preference. A design system that lives in a checker is a system. Everything below is organised around one question: *for each rule in this system, what is the script that fails when the rule is broken, and what is the number it prints?*

That gives a definition of done that nobody has to argue about:

> **The site is converted when the ratchet file is empty.**

Not "when it looks Swiss". Not "when the team agrees". When `website-v2/scripts/swiss-normalization-ratchet.json` contains zero entries, and CI has been failing on every regression the whole way there.

Three rules are already mechanized and shipping in #10153. Four more have to be written, and they are the interesting ones, because they are where your taste rules become lint rules.

### Already mechanized (#10153)

| Rule | What it catches | Baseline on `main` |
|---|---|---|
| `literal` | A colour written as a hex/rgb/hsl/oklch literal in a component instead of a token | 95 violations across 20 files |
| `radius` | Any `border-radius` / `rounded-*` — the Swiss square-corner rule | 118 across 33 |
| `flat` | A `box-shadow` used as depth chrome | 56 across 40 |

**264 violations, 67 files, out of 315 in scope. 78.4% of the site is already clean.** The ratchet records the current count per file and fails on three conditions: new drift, a worse count, **or a file that got cleaner without the ratchet being lowered.** That third one is what stops permanent amnesty — the allow-list can only travel toward zero.

### Still to be mechanized — the four that encode this brief

These do not exist yet. They are the deliverable of Wave 0b, and each one turns a sentence you wrote into a script.

**`typeface`** — *"I do not love inter/geist and of course reject them."*
Fails on any `font-family` in a component that is not `var(--display)` or `var(--mono)`, and on any font URL that is not the one house link. Two faces, declared once. A rejected face cannot re-enter by being imported in one page's stylesheet.

**`status`** — *"I LOVE how status is communicated through six states of a dot."*
Six states, and only six: `running · ok · warn · error · blocked · idle`. The rule fails on a seventh state name anywhere in a status prop or a state union type, and on any status colour that is not one of the six role tokens. The `running` pulse is the only animation permitted on a dot; the rule fails on an animation bound to any other state. This is the one that stops the registry rotting — status vocabularies die by accretion, one well-meaning `pending-ish` at a time.

**`frames`** — *"use with restraint: Use two. Mix none. Three or more reads as decorated chaos."*
This is the rule I most want to exist, and it is genuinely checkable. Every fractional border becomes a `<Frame pattern="...">` primitive with one of eight named patterns. The rule then walks each component's JSX tree and **counts distinct `pattern` values within one visual surface**. Two is legal. Three fails, and the message names which three and where. It also fails on a `Frame` that has a `box-shadow` anywhere in its subtree, because your own research names that as the thing that collapses the whole idea.

Honesty about its limits: "one visual surface" is a static approximation — a component tree, bounded at the next `Slab` or `Frame` root. It will miss two components that only ever render adjacent at runtime, and it will occasionally flag a tree that visually reads as two surfaces. It catches the common case, which is a single file accreting decoration, and it is not a substitute for looking at the page.

**`motion`** — *"jitter-free and premium and feel completely solid, and var."*
Fails on three things. (a) A duration or easing that is not one of the four duration tokens or two easing tokens. (b) A `transition` or `@keyframes` that animates any property other than `transform`, `opacity`, `clip-path` or `color` — animating width, height, top, left, filter or box-shadow forces layout or paint, and that *is* the jitter, mechanically. (c) A file with animation that has no `prefers-reduced-motion` escape.

That third check is why this rule earns its place: reduced-motion support is the thing everyone intends and nobody remembers.

---

## 1. The layer model

Four layers. A thing may only reach *down*. That is the whole rule, and every violation type above is a symptom of something reaching sideways or up.

```
  pages          /whitepaper, /library, /docs, /research …
     ↓ compose
  components     LibraryBanner, TableOfContents, AgentCard, WorkflowsTable …
     ↓ compose
  primitives     Slab · Frame · Dot · Numeral · Eyebrow · Flag · Rule
     ↓ read
  tokens         source → semantic → role
```

**Tokens** are already three-layer in this repo (`tokens.source.css` → `tokens.semantic.css` → `tokens.roles.css`) and that structure is right; it is under-populated, not wrong. Source holds raw values and is the only file where a literal is legal. Semantic names meaning (`--story-cobalt`). Role names use (`--part-machine`, `--st-running`, `--t-enter`). **Components read role tokens only** — never semantic, never source. That is one more lint rule, and it is the one that keeps the middle layer from becoming decorative.

**Primitives** are the new work. Seven of them, each the sole legal way to express one idea:

| Primitive | Sole expression of | Props |
|---|---|---|
| `Slab` | A full-bleed colour zone (border pattern 8) | `hue`, `bleed`, `numeral?` |
| `Frame` | Any of the other seven fractional borders | `pattern` (1 of 8), `tone` |
| `Dot` | Liveness | `state` (1 of 6) |
| `Numeral` | An oversized figure | `value`, `scale` |
| `Eyebrow` | A small-caps mono label | `children` |
| `Flag` | An ICS signal face | `letter` |
| `Rule` | A hairline or midline rule | `weight`, `span` |

Once these exist, most of the 264 violations stop being individual fixes and become *deletions* — a card that hand-rolls a border and a radius becomes `<Frame pattern="brackets">`, and its three violations vanish together.

**Note the ordering dependency:** the `frames` lint rule cannot be written before the `Frame` primitive exists, because it counts `pattern` props. Wave 0b therefore ships the primitives and the rules together, not the rules first.

---

## 2. The conversion order, derived from measurement

By *leverage*, not by violation count. A primitive's radius is inherited by everything that renders it; a leaf page's radius is its own.

### Wave 0 — the guard *(shipping, #10153)*
Three rules, the ratchet, 27 tests. Nothing converts yet; this is the instrument.

### Wave 0b — the four new rules + the seven primitives
The primitives, their stories, and the `typeface` / `status` / `frames` / `motion` rules with their own baselines recorded. Ends with `system.html` as the living specimen page, published at `/design` so the system is a URL and not a file anyone has to find.

### Wave 1 — `/whitepaper` *(shipped, #10154)*
The proof page. Already lifted onto `--part-*` role tokens driven by a `slug` field in `textbook.json`, with the hard-coded colour table deleted rather than moved. Ten screenshot pairs prove the page is pixel-identical.

### Wave 2 — the two primitives, alone, in one PR

| file | importers | violations |
|---|---|---|
| `src/components/ui/Surface.tsx` | **33** | 9 radius |
| `src/components/ui/Badge.tsx` | **26** | 1 radius |

Ten violations against fifty-nine import sites. `Surface.tsx` is the site's card primitive and its nine `rounded-*` are precisely the square-corner rule, inherited everywhere. **This is the highest-leverage change on the site by an order of magnitude, and the one most likely to shift pixels on pages nobody thought to check** — so it ships alone, with screenshots of its busiest consumers, never bundled into a cleanup wave.

### Wave 3 — the claim-tree cluster
`pages/docs/concepts/claim-tree/`: `data.ts` (11), `ModesMatrixViz` (10), `SankeyViz` (6), `CalendarViz` (3), `SunburstViz` (2) — **32 violations, every one a colour literal.** Almost certainly one hard-coded categorical palette shared across five views. The fix is one token ramp, not five edits, which makes it a single reviewable PR and converts the site's densest colour surface in one go.

### Wave 4 — the `viz/` cluster
`WorkflowsTable` (9), `ActivityFeed` (8), `MaritimeFlags` (8), `AgentCard` (7), `Graph3D` (6) — ~38 violations, mixed. Mostly single-importer, so these run parallel by worker once waves 2–3 have set the pattern. `MaritimeFlags` is the one to do by hand: it becomes the `Flag` primitive.

### Wave 5 — `PortDaddyMark.tsx`: a policy question, not a cleanup
Seventeen colour literals in what is almost certainly an inline SVG logo. **A brand mark legitimately carries fixed brand colours — a logo that changes hue with the theme is a broken logo, not a normalised one.** This is the clearest case in the codebase for `swiss-allow: literal — <reason>` rather than tokenisation. Decide it explicitly, record the reason at the site, and do not quietly convert it or quietly ratchet it forever. **This one needs your call.**

### Wave 6 — leaf pages
`McpOverview` (11), `sdk/index` (10), `WarRoom` (8), `HarnessPage` (7), `porthole.css` (6) and the tail. Independent, no ordering constraint, worker-parallel.

### Wave 7 — motion and the flags
Once every surface is on primitives, the motion language and the per-page flag go on last, because both are cross-cutting and both are pointless applied to a surface that is about to be rebuilt. Every page gets its ICS flag; every state change gets one of four durations.

---

## 3. The rule that keeps it honest

**Every conversion PR must lower its files' ratchet entries in the same commit.** The guard fails if a file gets cleaner without the ratchet being updated — so the allow-list can only travel toward empty, and "the site is converted" becomes a checkable claim rather than a judgement call.

A conversion PR that does not move a ratchet number has not converted anything.

---

## 4. What cannot be mechanized, and stays a human gate

I would rather name these than pretend the lint covers them.

- **Whether a colour block *means* something.** The rules check that a hue came from a token; they cannot check that the hue was the right hue for that idea. Hue-is-meaning is the brand's thesis and it dies quietly if a slab is picked because it looked good.
- **Whether the grid is real.** Alignment across sections is the load the whole style carries, and no lint sees it. It shows up in a screenshot at three widths and nowhere else.
- **Whether motion is serving orientation or decorating.** The `motion` rule checks that an animation is cheap and interruptible. It cannot check that it was worth running.
- **Whether the page reads.** The `frames` rule counts patterns; it does not know if the surface communicates. The diagnostic from your own research is the one that works here: *remove every fractional border — does the hierarchy survive on colour, spacing and type alone?* If yes, the brackets are refinement. If no, they were hiding the absence of a system.

Each of these gets a screenshot pair at 1280 / 860 / 390 in light and dark on every conversion PR. That is the human gate, and it is not optional.

---

## 5. Open decisions — yours, not mine

1. ~~**The typeface.**~~ **Settled.** `typography-expert` sorts faces by *register*, and this work sits in its **Quiet Swiss / neo-grotesque** row, whose libre entries are **Archivo** and Hanken Grotesk. Archivo is also its named libre replacement for Helvetica and Neue Haas. So the stack stands: **Archivo** (one family, two widths — `wdth` 100 for text, 125 for the oversized numerals) plus **IBM Plex Mono** as the permitted third family for machine truth. Its §8 rules also corrected the first build: type is now sized in `rem` throughout, nothing a reader reads sits below 14px, and every 12px label meets all three conditions of the label exception (weight ≥600, uppercase, tracking ≥0.1em). One exception is stated rather than hidden: display type ≥48px is set at 1.0 leading, below the 1.05 heading floor, because that is how this tradition sets it.
   **One rule still to honour on the site:** §7 says self-host WOFF2 and never `@import` — Google Fonts CSS costs a render-blocking round trip. The local specimen page links Google Fonts because it has to travel as one file; **the site subsets and self-hosts**, with `font-display: swap` and a `size-adjust` fallback to kill CLS. That is a Wave 0b task, not a preference.
2. **`PortDaddyMark.tsx`** (Wave 5) — allow the brand literals with a recorded reason, or tokenise the mark?
3. **Scope.** The ratchet covers `website-v2/src/{components,pages}/**`. `src/app/**` and `src/lib/**` are outside it today, which means drift there is invisible. Widen now, or convert first and widen at the end?
4. **The `frames` rule's surface boundary.** I have proposed "a component tree bounded at the next `Slab` or `Frame` root". If that proves noisy in practice the alternative is to check only at the page level, which catches less but never cries wolf.

### A fifth guard rule falls out of the typography reference

**`type`** — beyond the two-faces check already listed, the skill's §8 is mechanically checkable and worth enforcing, because these are exactly the rules that rot silently: no `font-size` in `px` (breaks the reader's own font-size preference); no type below `0.875rem` except a label carrying weight ≥600 **and** `text-transform: uppercase` **and** `letter-spacing: ≥0.1em`, which may go to `0.75rem`; `clamp()` minimums and maximums in `rem`; no `@import` for fonts; and no font URL outside the one house source. Every one of those failed somewhere in my first draft of `system.html`, which is the argument for the rule.
