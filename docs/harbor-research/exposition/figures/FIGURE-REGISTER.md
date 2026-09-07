# Figure register

This is the full list of what the book has, and what it could or should render,
for pedagogical clarity — one row per idea that earns a visual, whether or not
a figure for it exists yet. It is medium-agnostic: a row names the *structure*
a picture would need to carry and the *reader question* it answers, not a TikZ
spec. The author renders each row outside TikZ, in whatever medium fits (a
plot from a script's own output, a hand-drawn diagram, a table, a terminal
transcript); this register does not draw anything and does not prescribe a
drawing tool.

The register has three layers, built in three passes:

1. **This skeleton** — the reading contract (the row schema below) and the
   candidates the book's own plan already named, before anyone enumerated a
   chapter page by page.
2. **The enumeration pass** — a full page-by-page sweep of each chapter,
   populating the eight chapter sections below with one row per idea that
   could earn a figure.
3. **The reconciliation pass** — every plan candidate matched to the row that
   covers it, or marked `not enumerated` if the sweep missed it, plus a
   summary table.

Only pass 1 is done here. The chapter sections below are placeholders until
the enumeration pass runs.

## How to read a row

Every row in this register — once the enumeration pass fills the chapter
sections in — follows this schema:

| id | section | idea (one sentence) | structure | reader question | recommended form | existing figure | wave-11 disposition | priority | data source | notes for the renderer |
|---|---|---|---|---|---|---|---|---|---|---|

Column meanings:

- **id** — a short stable identifier for the row (e.g. `swk-07`), so later
  passes and cross-references can point at it without repeating its sentence.
- **section** — the chapter section (and, where useful, the subsection) the
  idea lives in.
- **idea (one sentence)** — the single claim or fact the figure would carry,
  stated as one sentence a reader could quote back.
- **structure** — the shape of the information itself, drawn from a fixed
  vocabulary so rows are comparable across chapters:
  `temporal` (something unfolds over time or steps), `stateful` (a machine
  with states and transitions), `quantitative` (a measured or computed
  number, curve, or region), `relational` (entities and the relations between
  them), `containment` (one thing nested or bounded inside another),
  `provenance` (an evidentiary or lineage trail), `allocation` (a resource or
  authority divided among claimants), `comparison` (two or more things placed
  side by side to be judged against each other).
- **reader question** — the question a reader would have on this page that
  the figure, and only the figure, answers.
- **recommended form** — the concrete rendering the row is asking for (e.g.
  "xy plot, log axis", "state machine, 6 states", "booktabs table"),
  medium-agnostic — no TikZ library or drawing tool named.
- **existing figure** — the `\label` of the figure that already covers this
  idea today, or `none` if nothing does yet.
- **wave-11 disposition** — the verdict this idea's existing figure received
  in `docs/harbor-research/exposition/figures/FIGURE-TRIAGE.md`
  (keep / restyle / redraw / table / delete / add), or `n/a` for an idea the
  Wave 11 triage never looked at.
- **priority** — how much the book needs this figure to exist:
  `must` (the page does not work without it), `should` (the page is
  meaningfully weaker without it), `could` (a nice-to-have that would help a
  slower reader), `no` (prose already carries the idea; a figure would only
  decorate it).
- **data source** — for a quantitative row, the script, proof artifact, or
  log that produces the numbers; `n/a` for a row with no measured content.
- **notes for the renderer** — anything the author needs to know before
  drawing it: a worked-point coordinate to preserve, a caption obligation, a
  cross-reference to a shared figure elsewhere in the book, a pitfall the
  Wave 11 triage already found.

## Candidates named in the plan before the enumeration

These are the figures the book's own plan already called out by name, before
any page-by-page sweep. The enumeration pass (chapter sections below) either
produces a row that covers each one, or the reconciliation pass records it as
`not enumerated`.

| candidate | chapter | recommended form |
|---|---|---|
| The two-run lockstep picture: two runs identical except the secret, evaluated for noninterference | The Sealed Harbor | comparison — side-by-side run pair with equality marks at each step |
| The interleaving lattice for the release ledger: every concurrent interleaving of the atomic append-and-add still conserves the spend bound | The Sealed Harbor | relational — a lattice/DAG over interleavings with the conserved quantity annotated at each node |
| The mint-attack fork DAG: a reputation lineage forked by a copy attempt, and the no-mint rule's refusal | From Spawn to Person | provenance — gitgraph-style DAG with the mint attempt and its rejection marked |
| The boundary surface g(ρ,c): the specialization threshold a sole specialist must clear to beat the pool | The Legible Swarm | quantitative — surface or region plot over (ρ, c) with the worked point marked |
| The cycle-versus-cut consistency graph: equivocation is detectable exactly when the missing edge lies on a cycle, never on a cut | The Federated Harbor | relational — paired graphs (a cycle case and a cut case) with the consistency radius under each |
| The escrow and settlement state machine: an attempted act moves through escrow to a terminal settlement, with no partial-credit path | The Bonded Commons | stateful — state machine with the terminal transitions marked |
| The Anchor handshake ladder: the pairing ceremony between operator, daemon, and verifier | The Anchor Protocol | temporal — sequence/ladder diagram naming what each message binds |
| The supervisory-control automaton with controllable and uncontrollable events | The Single-Writer Kernel | stateful — automaton with controllable events marked distinctly from uncontrollable ones |
| The inspection tower regime: sealed sampling from cliques makes bribery uneconomical above ρ* = G/(dB) | The Harbor Economy | quantitative — regime plot with the ρ* boundary and the worked point |
| The zoom tree with the measured 15.3× (adaptive zoom against a flat baseline) | The Legible Swarm | relational — tree diagram with the measured multiplier labeled at the root |

Simulation-result plots, rendered from the repository's own scripts rather than sketched:

| candidate | chapter | recommended form | data source |
|---|---|---|---|
| The R1 zoom floor sweep | The Legible Swarm | xy plot, measured points | `skills/harbor-results/scripts/a7_experiment.py` |
| The δ* sweep (claim-signaling discount-factor crossover) | The Bonded Commons | xy plot / TLC sweep table | `proofs/economics/sweep-delta.sh`, `proofs/economics/delta-threshold.z3` |
| The ρ* deterrence frontier | From Spawn to Person | xy region plot with the worked point | `skills/harbor-results/scripts/b2_tower.py` |
| The probation cliff | From Spawn to Person | xy plot, expected loss vs probation length | `skills/harbor-results/scripts/b6_probation.py` |
| The escalation band | The Bonded Commons | xy plot / feasible-interval plot | `skills/harbor-results/scripts/b7_escalation_band.py` |
| The consistency radius over cycle length | The Federated Harbor | xy plot | `skills/harbor-results/scripts/sheaf_consistency_radius.py` |
| The SPRT stopping-time histogram | The Sealed Harbor | histogram | `skills/harbor-results/scripts/a4_canary_sprt.py` |

## Chapter 1 — The Single-Writer Kernel

Rows arrive from the enumeration pass.

## Chapter 2 — The Anchor Protocol

Rows arrive from the enumeration pass.

## Chapter 3 — The Sealed Harbor

Rows arrive from the enumeration pass.

## Chapter 4 — The Legible Swarm

Rows arrive from the enumeration pass.

## Chapter 5 — From Spawn to Person

Rows arrive from the enumeration pass.

## Chapter 6 — The Harbor Economy

Rows arrive from the enumeration pass.

## Chapter 7 — The Bonded Commons

Rows arrive from the enumeration pass.

## Chapter 8 — The Federated Harbor

Rows arrive from the enumeration pass.
