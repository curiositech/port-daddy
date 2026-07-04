# Surface Critiques & Redesign Specs — FleetBar, Control Center, pd-console, Scout

**Status:** Design target · companion to `00-unified-design-language.md`; mockups in `mockups/` are the visual source.
Screenshots referenced were taken 2026-07-04 from the shipped builds.

## FleetBar (menu bar popover)

**What it is for** (binder ch. 19): *"the fleet is plumbing; the front door is intent."* FleetBar is the ambient consent surface — the only surface allowed to demand the operator's attention, and only for human gates. Four verbs: intent, gates, resume, quick actions.

**Critique of the current build:**
- It is a *launcher*, not a front door. Sixteen visually identical `pd-console · Dev · <branch>` rows dominate the popover — the dev-berth list, an internal contributor concern, is the primary content. The binder demotes the roster to a drawer; the build promotes the build-lane list above everything.
- No intent composer exists. The binder's verb #1 is absent entirely.
- No human gates section. The one thing FleetBar is *for* has no home.
- "Fleet — 16 idle" renders the most important operator fact in the smallest, grayest type on the surface. There is no ICS glance grammar, no signal-flag language, despite both being specified and tokenized.
- The visual identity is stock iOS: white sheet, rounded cards, systemy blues and a lone orange pill. Nothing connects it to pd-console or the website. No warm paper, no hard borders, no house type.

**Redesign** (`mockups/fleetbar-popover.html`): intent composer on top → crimson-edged gate cards (Foxtrot) → resume cards → quick actions → collapsed fleet drawer with a flag-count glance strip (H/F/V/Y/M counts) → daemon micro-footer. Dev-berth switching moves into the drawer, one level down. Cost appears on gate cards — at the moment of consent — and nowhere else.

## Fleet Control Center

**What it is for** (binder ch. 19): *"FleetBar's deep window face"* — the same surface, expanded; not a fourth product. It renders `/fleet-ui/`.

**Critique of the current build:**
- Three stacked full-width header bands (title row, stat row, "RUNNING" banner) before any content, then a fourth row of 10+ tab-chips with buttons that clip ("Ac…"). A deep window face should have one band and panes.
- The Flow map — the centerpiece — is a near-empty black void with unreadable micro-chips pinned to the bottom edge. A topology visualization that doesn't show topology is worse than a table.
- The right-side cockpit is generic admin-dashboard: buttons in boxes, raw counters ("0 notes", "0 files", "All 0") presented as data rather than as teaching empty states. "16/16 live" and "240 meaningful live signals" sit next to each other with no hierarchy telling the operator which number matters.
- Budget is presented as a settings form, not as the consent object the binder makes it ("The launch flow must show budget and max cost before running").
- Dark theme is closest of the three to the house identity but uses soft grays and rounded chips instead of warm ebony + 2px bone borders; the mustard/crimson operator accents are absent.

**Redesign** (`mockups/control-center.html`): one header band (title, project, four stat plates); three conjoined panes — Gates & Attention (crimson cards + crew grouped by flag state), Flow (an honest SVG topology with named nodes and a legend), Budget-as-consent + Guard; bottom Roadmap Intake as a teaching empty state with an import action.

## pd-console

**What it is for** (binder ch. 10): the command room — *"dense, legible, and alive"*; roster grouped by status; the **live transcript is the first-class center of the detail pane**; click-first; *"no clipped identifiers as the main information scent"*; status words + color; unknowns become remediation prompts.

**Critique of the current build:**
- The left nav is ~20 flat, ungrouped, same-weight text items (Fleet, Cockpit, Sorties, Claims, Peek, Planner, ADRs, Activity…). No watch/work/truth grouping, no counts, no attention routing.
- The agent roster renders raw key-value debug rows: `worktree — unknown`, `doing — no purpose recorded`, `stream — pd agent stream spawned-c4bfd95aeb7a`. This is exactly ch. 10's failure mode: clipped identifiers as information scent, and a command line quoted where a button should exist ("steer — pd agent interrupt spawned-…").
- No transcript anywhere on screen. The surface whose one unique power is "renders transcripts in full" shows none.
- No state grouping, no gates, no cost, no flags. "alive" is absent: nothing indicates stream freshness; "spawned-… - alive" is a label, not evidence.
- The Conjure pane is the exception and the proof: wave-grouped DAG cards with model/cost/duration chips have real design authority. The rest of the app should be built to its standard.

**Redesign** (`mockups/pd-console.html`): three-part workspace — grouped rail (WATCH/WORK/TRUTH), roster grouped by the ICS state grammar with plain-word steps and remediation rows, detail pane with live transcript above the fold, files-touched + claims below, Interrupt/Pause/Fork as real buttons with disabled-state explanations, LIVE defined by stream evidence and labeled so.

## Scout (Chrome extension)

**What it is for** (binder ch. 19): the intake wedge — *"the operator is looking at their running product, sees the defect, and files it from inside the viewport with the evidence already attached."* Intake and observation only; honest daemon chip; deep-links to console.

**Critique of the current build:**
- Functionally correct, visually a fourth brand: ad-hoc palette (blue `#2f7df6`, its own greens/ambers), 10px rounded corners, drop shadows, Inter — every one of these is explicitly banned by the shipped token law ("flat, not skeuomorphic… hard borders are load-bearing").
- The screenshot — the evidence, Scout's entire reason to exist — is a small preview below the fold of the form. Evidence should be the hero.
- Light-only (`color-scheme: light`); no dark parity.
- The marketing imagery already targets the correct brand (warm paper, cobalt, editorial) — the product ships something else.

**Redesign** (`mockups/scout-popup.html`): on-token popup (paper/ebony, 2px borders, mustard accent, reticle mark instead of any mascot), evidence hero with region overlay + DOM strip, honest ONLINE/OFFLINE chip with remediation text, consent footer stating exactly what filing creates and costs, console deep-link.

## Cross-cutting acceptance checklist (all four)

- [ ] The ICS state grammar wherever an agent appears (flag + word + color)
- [ ] One header band max; panes, not tab crowds
- [ ] No identical-row walls; group by status; size = importance
- [ ] Live claims require stream evidence; stale data carries a stale chip
- [ ] Every empty state teaches and offers an action
- [ ] Cost appears at consent moments only
- [ ] Warm paper/ebony substrate, 2px borders, flat, house type (Big Shoulders + Recursive)
- [ ] Body ≥16px, labels ≥14px, AAA contrast, visible focus, no emoji icons
