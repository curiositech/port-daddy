# Operator TUI v9 — Treatment

**The console that fits all fifteen — alive again.**

v9 is v8 with its motion soul restored. Not a redesign: every surface, token,
and feature of v8 is preserved byte-for-byte in structure. What changed is that
the v5→v8 drift toward "motion is sparse" had quietly become "motion is dead,"
and v9 corrects that without surrendering an inch of swiss-modern discipline.

---

## The reconciliation (read this first)

There is no tension between swiss-modern and beautiful motion. They govern
different layers, and v9 states the split explicitly:

| Layer | Authority | v9 stance |
|---|---|---|
| Layout, grid, type scale, color, restraint | **Swiss-modern** | Unchanged from v8. One accent per surface, mayday-red sacred, 14px floor, AAA both themes, no invented color names, no emoji-as-icon. |
| Motion | **First-class delight** | Sparse in *count* — not everything moves — but **rich and beautiful where it does.** Every animation earns its keep by reinforcing reading order, signalling a state change, or showing that an agent/vessel is alive. |

"Sparse" was always meant to mean *intentional and few*, never *absent*. A Swiss
poster is still on a page that can be turned; a Braun radio's dial still has a
satisfying detent. v9 puts the detents back.

**Hard rules motion obeys:**
- transform / opacity / box-shadow only (GPU-friendly, no layout thrash)
- ceiling of **500ms**; the working budget is 140–480ms
- it must read in *both* themes and *not* lower any contrast
- `prefers-reduced-motion: reduce` collapses every motion to instant/opacity —
  and where motion was the *signal* (approve, decline), reduced-motion swaps in
  a non-moving equivalent (outline flash). **Never motion-only signalling.**
- sound stays strictly opt-in (`m` to toggle), and is additionally muted under
  reduced-motion.

---

## MOTION SYSTEM

### Named curves (CSS custom properties on `:root`)

| Token | cubic-bezier | Character | Drives |
|---|---|---|---|
| `--swoosh` | `(.16, 1, .3, 1)` | Long, graceful settle — fast out, gentle landing | View entrances, toasts, the approval sweep |
| `--snap` | `(.34, 1.56, .64, 1)` | Overshoot spring — a confident little bounce past target | Buttons, cards, mode-icon press, fire recoil |
| `--ease` | `(.4, 0, .2, 1)` | Neutral material easing | Color / opacity / border transitions (the quiet majority) |
| `--float` | `(.45, .05, .55, .95)` | Symmetric sine-loop | Vessels bobbing, presence breathing, pulse rings |

### Canonical durations

| Token | Value | Use |
|---|---|---|
| `--dur-micro` | 140ms | Press / tick — instant-feeling feedback |
| `--dur-quick` | 220ms | Hover lift, lead-in, color shifts |
| `--dur-settle` | 340ms | View entrance, row materialize, toast |
| `--dur-flourish` | 480ms | Approval sweep, dispatch materialize (ceiling — never >500) |
| `--lift` | -2px | The one canonical hover-rise distance — kept small and consistent everywhere |

### What each motion animates (the catalog)

| Name | Trigger | Curve · duration | What it does | Why it earns its place |
|---|---|---|---|---|
| `viewIn` | view becomes active | swoosh · 340ms | View plane slides in from `+10px X` | Tells you which way you moved through the rail (left→right read) |
| `swoosh-in` (staggered) | active view's children | swoosh · 340ms, 20–200ms stagger | Sections cascade up `+8px Y` in DOM order | Leads the eye through reading order instead of dumping the whole screen at once |
| `settleHome` | retreat to Sphere (⌥0) | swoosh · 340ms | Calm `scale(.985)→1` settle, *not* a side-slide | Coming home should feel like arriving, not like another lateral hop |
| `modePop` | a rail mode becomes active | snap · 300ms | Active icon pops `.8→1.12→1` | Confirms the switch with a spring; pairs with the moving left-spine |
| mode hover lead-in | hover a rail item | snap · 220ms | Icon lifts `-2px` + `scale 1.06`; press squashes to `.94` | The v4 "lean toward the label" affordance |
| `pulsering` | running agent dot · harbor "here" lamp | float · 1.9–2.2s loop | Ghost ring exhales outward and fades; **dot stays put** | Aliveness without sacrificing legibility — the swarm is doing its thing |
| `doingShimmer` | working agent's pane-head "doing" text | linear · 4.5s loop | A slow specular sweep across the status text | Hints that work is *in motion* at the gate, not frozen |
| `sweep` | operator approves the gate | swoosh · 480ms | A band of light wipes across the mayday gate, then it settles to CLEAR | The single most satisfying confirmation in v4 — restored verbatim |
| `shake` | decline a suggestion | ease · 380ms | Short decaying horizontal jitter | The "no / not that" gesture; reads without relying on color |
| `settle` | new sortie / new mooring arrives | swoosh · 360ms | Row drops in `-8px Y` with a `max-height` open | Growth in the fleet is *felt*, not just rendered |
| `fireRecoil` | dispatch fires a sortie | snap · 260ms | Fire button squash-releases | A vessel leaving the dock has weight |
| `chipPulse` | running sortie status chip | float · 2s loop | Chip outline pulses outward | Work in flight, glanceable in the list |
| `vesselFloat` | moored vessels (harbor) | float · 6s loop, per-vessel phase | Each berth bobs ≤2.5px + ≤0.6° on its own offset | The maritime metaphor finally *moves* — alive at anchor, never seasick |
| `waterShift` | harbor moorings backdrop | linear · 7s loop | A faint dithered tideline drifts behind the roster | Water under the hulls; subtle enough never to touch text legibility |
| `breathe` / `coreglow` | sphere buddy orb (from v8) | ease · 4.5s loop | Orb glow + core opacity breathe | Your buddy is present and calm (kept from v8) |
| `beat` | mayday gate at rest (from v8) | ease · 1.4s loop | Soft mayday-tint pulse ring | The one thing that needs you is quietly insistent (kept from v8) |
| toast in/out (from v8) | any toast | swoosh · 380ms | Rises `+20px Y` into place | Confirmation without a modal (kept from v8) |

Motions are **scoped, not global.** Only the active view animates; only the
*working* agent's dot pulses; only *present* moorings bob; idle ones sit still.
That is the "sparse in count" half of the contract.

---

## v4 → v8 → v9 motion comparison

### What v4 had (the baseline of delight)

v4's mockup (`v4-mockup.html`) treated motion as a designed material with its
own named curves (`--ease-spring` = `cubic-bezier(.22,1,.36,1)`,
`--ease-quick` = `cubic-bezier(.4,0,.2,1)`):

- `viewIn` — directional spring slide (`translateX(8px)`) on every view change
- `sweep` — a light band wiping across the gate on approval (`.fb-hitl-flash`)
- `shake` — decaying jitter on denial
- `settle-in` — new rows materializing with a `max-height` open
- `pulse` rings on every live dot (agents, HiTL eyebrow, menubar)
- hover lifts + `padding-left` lead-in on every row (`.fb-row:hover`)
- a back-arrow that nudged `-3px` on hover
- button press springs (`translateY(-1px)` hover, snap-back on `:active`)

### What v8 kept vs. lost

| v4 motion | v8 state | Verdict |
|---|---|---|
| Named curves | Kept (`--swoosh`, `--snap`, `--ease`) | ✅ Good foundation, under-used |
| Directional view slide | **Lost** — replaced by one flat `translateY(8px)` fade applied to *all* children of *all* views identically | ❌ Inert; no directional read |
| Approval sweep | **Lost** — approval was an instant class swap | ❌ The signature delight gone |
| Deny shake | **Lost** — decline was a toast only | ❌ Lost the gesture |
| Row materialize | **Lost** — new rows just appeared | ❌ Fleet growth not felt |
| Presence pulse rings | **Partially lost** — only the buddy orb breathed; agent/harbor dots were static | ⚠️ Aliveness drained |
| Hover lift + lead-in | **Mostly lost** — a few `translateY(-1px)` survived on buttons; rows went flat | ⚠️ Surfaces felt clickable-but-dead |
| Harbor / vessel motion | **Never existed** — harbor was new in v7/v8 and shipped static | ❌ Maritime metaphor frozen |
| Dispatch fire feedback | **Lost** — fire was a toast only | ❌ No weight to launching |

The net effect: v8 was *correct* and *complete* but felt like a screenshot. The
"motion is sparse" principle had been over-applied from "few and intentional" to
"effectively none."

### What v9 restores (and adds)

- **Directional, staggered view entrance** — `viewIn` slide + cascading
  `swoosh-in`, with a distinct `settleHome` for retreating to the Sphere.
- **The approval light-sweep** — back on the mayday gate, verbatim in spirit,
  recolored to the gate's own foreground so it stays in-palette.
- **Deny shake** — on suggestion decline; reduced-motion → outline flash.
- **Row materialize** — new sorties and (structurally ready) moorings settle in.
- **Presence pulse rings** — on the working agent's dot and harbor "here" lamps;
  the dot itself never moves, preserving legibility.
- **`doingShimmer`** — the working agent's status line shows work in motion.
- **Harbor comes alive** — `vesselFloat` per-vessel bob + a drifting dithered
  `waterShift` tideline + pulsing present-lamps. The maritime payoff finally
  reads as a harbor, not a table.
- **Dispatch fire** — `fireRecoil` spring + a real materialized running sortie
  with a streaming log. Honest: it lands as `running`, never fake-`done`.
- **Mode-rail life** — icon lead-in on hover, `modePop` spring on activation.

Everything new is gated behind `prefers-reduced-motion: no-preference` and has a
reduced-motion fallback that still communicates state.

---

## Accessibility & honesty (unchanged from v8, re-verified)

- **14px floor** held; eyebrows are 13px uppercase/700/tracked (the documented
  exception).
- **AAA contrast** in both themes — re-verified via headless Playwright across
  all thirteen views in light and dark; zero console errors/warnings.
- **Mayday-red** remains reserved for the human gate. The approval sweep uses
  the gate's *own foreground*, not a new red.
- **No invented color names**; all motion colors are `color-mix()` over canon
  tokens.
- **No emoji-as-icon**; glyphs remain Departure-mono pixel marks.
- **`prefers-reduced-motion: reduce`** fully honored: a global
  `*{animation:none !important}` rule plus targeted state-change fallbacks
  (sweep→outline, shake→outline, settle→instant). Verified: under reduce, the
  approve flow still reaches CLEAR with a non-moving confirmation.
- **Zoom never locked** (`maximum-scale=5`, kept from v8).
- **Sound** strictly opt-in and additionally muted under reduced-motion.

## Verification

Headless Chromium (`headless=True`), 1440×900:
- 13 views × {light, dark} screenshotted — no console errors or warnings.
- Approve flow (sweep → CLEAR), dispatch fire (recoil → materialized running
  sortie + streaming log), suggestion decline (shake) all exercised cleanly.
- `prefers-reduced-motion: reduce` pass: `matchMedia` confirmed `true`, approve
  flow completes with a non-moving confirmation, zero page errors.

Screenshots: `~/coding/tmp/v9-shots/` (disposable scratch).
