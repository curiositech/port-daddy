# Corpus Curation: Operator Verdicts Per Surface (2026-07-05)

The convergence produced two ch20-conformant mock corpora in tandem —
`docs/design/fleetbar-mockups/triad-*.html` (PR #658, "converged") and
`docs/design/2026-07-05-surface-redesign/mockups-ch20/` (PR #691, "linework").
The operator paired them up and ruled per surface. This ledger is the one
source for which render leads each surface and what must be grafted from the
loser before it retires.

## Verdicts

| Surface | Winner | Why (operator's words) | Graft from the other / follow-up |
| --- | --- | --- | --- |
| Coop Harbor | **linework** `mockups-ch20/coop-harbor.html` | "best information density, sense of ease" | carry the converged mock's ch19 fixtures if any diverge |
| Scout | **linework** `mockups-ch20/scout-popup.html` | "I love story linework's targeting logo and it looks sleek as hell" | keep converged's honest daemon-chip triple + routed-intent confirmation (convergence §8 named them adopted-verbatim) |
| Fleet Control Center | **linework** `mockups-ch20/control-center.html` | "linework is better, especially cuz animations" — but "I don't think even port-daddy's agents know what this tool is; it extrapolated from the one screenshot I sent" | **product-definition gap**: FCC needs a real charter (what it is, who opens it, when) before further design; `product-reality-reviewer` + `operator-surface-authority-designer` lenses |
| pd-console | **converged** `fleetbar-mockups/triad-console-detail.html` | "narrowly — glad it didn't forget compliance levels" | take linework's motion where it earns it |
| Account | **converged** `fleetbar-mockups/triad-account.html` | wins, "but miss the color blocking fun of the linework" | graft linework account's color-blocked section plates into the converged render |
| Login | (no ruling) | — | converged stands until ruled |
| FleetBar | **NEITHER** | "both are too tied to the fleets instead of programming"; direction = `fleetbar-mockups/v4-mockup.html` ("the sounds are so good") | see FleetBar reset below |

## The two elevated ancestors

**`operator-tui-v9.html` — the persona preset picker.** "Different experiences
for different users, genius." A persona preset dials the whole console's air
and pins a first-thing-you-see per persona cluster, one keymap underneath.
**Ruling: pd-console and Fleet Control Center adopt persona presets as a
structural requirement** — the deep surfaces render differently for different
operator personas without forking the surface. (Backing: `agentic-coding-ux-designer`,
`ux-friction-analyzer`, `human-centered-design-fundamentals`.)

**`v4-mockup.html` — "FleetBar v3: session shield · scope toggle · enforced
gates."** The generation whose *feel* (including its sound design) the operator
wants back. Note honestly: the HTML carries no audio code — the sounds live in
operator memory of the live demo, so the sound design gets rebuilt
deliberately per ch13's restraint policy (`app-sound-design`,
`sound-design-and-audio`), not recovered by archaeology.

## The FleetBar reset

Both current FleetBar renders foreground *fleet administration*. The operator's
correction: FleetBar is about **programming** — the work, the session, the
scope you're protecting — not the org chart of agents. v4's vocabulary is the
seed: session shield, scope toggle, enforced gates, sound as state. This is
consistent with (and sharpens) ch19's own reframe ("the fleet is plumbing; the
front door is intent"): the next FleetBar iteration leads with the *program
being built* — current session, its shield/scope, its gates — with fleet
status demoted below even the drawer. Requires a fresh work order:
v4 verbs + ch20 skin + verdict-1 state-dependent stacking + rebuilt sound set.

## Disposition

1. `mockups-ch20/` leads: coop-harbor, scout, control-center (content charter
   pending). `fleetbar-mockups/triad-*` leads: pd-console, account, login.
2. Neither FleetBar survives as-is; both are reference until the reset lands.
3. Each losing render gets a pointer comment to this ledger; no deletions —
   they remain gate-anatomy references (IT-015..IT-018).
4. Follow-up work orders, in value order: (a) FleetBar reset (v4 verbs, sound
   rebuild), (b) persona presets into pd-console/FCC, (c) account
   color-blocking graft, (d) FCC product charter.

## Addendum (operator, same day)

- `v4-mockup.html`: "looks and feels good, great motion and color and space —
  though the dark needs a different palette." FleetBar-reset work order
  inherits v4's motion/spacing; dark theme gets its own palette pass (ch20
  luminous stack, not v4's dark as-is).
- `operator-tui-v9.html`: the **translation layer** is elevated alongside the
  persona presets ("genius") — the same underlying state rendered per-persona
  through a translation layer, not forked views. Deep-surface requirement.
