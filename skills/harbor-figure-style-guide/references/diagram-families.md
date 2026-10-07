# Comprehensive Diagram Families: Architectures, Idioms & Clearance Invariants

This guide defines the authoritative architectural patterns, TikZ idioms, layout geometry, and clearance invariants for all seven major diagram families used across *The Harbor, the Person, and the Economy*.

---

## 1. Sequence & Multi-Party Protocol Diagrams

### Information Goal
Illustrate chronological, multi-actor message passing, capability presentation, lease grants, handshakes, or asynchronous race conditions over discrete time steps.

### Geometric Architecture
- **Actors (Columns):** Positioned along a horizontal axis at discrete coordinates $x_1, x_2, \dots, x_N$ with uniform pitch $\Delta x \ge 2.8\,\text{cm}$.
- **Lifelines:** Thin guide rules (`pd guide`, `0.5pt`, `line width=.5pt, dash pattern=on 1.2pt off 2pt`) descending from actor header boxes to the bottom foot.
- **Time Steps (Vertical Cadence):** Monotonically descending time steps $t_1, t_2, \dots, t_M$ with $\Delta y \ge 0.85\,\text{cm}$ (ideally $0.9\,\text{cm}$ to $1.1\,\text{cm}$).
- **Activation Strips:** Slender vertical rectangles ($2.0\,\text{mm}$ to $2.5\,\text{mm}$ wide) along the lifeline during active computation.
- **Message Arrows:** Directed rules (`pd focus rule`, `pd breach rule`) spanning from sender lifeline to receiver lifeline.

### Clearance Invariants
- **Lifeline Collision Avoidance:** Labels on long arrows spanning across intermediate lifelines must use `fill=pdpage` (or local background color) and `inner xsep=4pt, inner ysep=3pt` to cleanly mask crossed lifelines without text strike-through.
- **Lane-Restricted Anchoring:** When possible, anchor message labels within the initiating or terminating actor lane (`pos=0.25` or `pos=0.75`), rather than impaling the center.
- **Response Arrows:** Return messages should use dashed rules (`pd rule, dashed` or `pd breach rule, dashed`) and explicitly state HTTP/status semantics (`200 OK`, `409 Conflict`, `412 Precondition Failed`).

---

## 2. State Machines & Guarded Transition Automata

### Information Goal
Formally model lifecycle states, capability attenuation steps, security taint levels, or protocol progression governed by boolean guards and trigger events.

### Geometric Architecture
- **States (Nodes):** Regular rounded rectangles or ellipses:
  - Initial state: `pd focus state` (or standard `pd state` with entry arrow).
  - Intermediate states: `pd state` with clear semantic fill (`pdcobalt!8`, `pdteal!8`, `pdviolet!8`).
  - Terminal/rejection states: `pd climax state` or `pd terminal` (double stroked border or solid dark fill).
- **Transitions (Edges):** Orthogonal or arched rules (`bend left=15`, `bend right=15`, `pd focus rule`, `pd breach rule`) with explicit arrowheads (`-{Stealth[length=3.5pt,width=2.5pt]}`).
- **Transition Labels:** Event trigger + bracketed boolean guard: `trigger [guard] / action`.

### Clearance Invariants
- **Exterior Edge Routing:** Transition labels must never lie across state node borders. Anchor labels along the path using `above`, `below`, or `sloped` with `fill=pdpage, inner sep=2.5pt`.
- **Bidirectional Disambiguation:** Transitions between two states in opposite directions must use distinct curvatures (`bend left=20` vs `bend left=20` reversed) to guarantee a minimum inter-path clearance of $\ge 8\,\text{pt}$.
- **Self-Loops:** Self-transitions must specify explicit angles (`loop above`, `loop right`) with `distance=1.2cm` and an opaque label backing.

---

## 3. Execution Swimlanes & Concurrency Gantt

### Information Goal
Visualize parallel asynchronous execution, shared resource lock contention, worker task delegation, pause/stall intervals, and serialization commit points along a continuous time scale.

### Geometric Architecture
- **Actor Lanes (Horizontal Rows):** Bounded vertical lanes of uniform height $H \approx 1.2\,\text{cm}$ separated by subtle guide rules (`pd guide`).
- **Time Axis (Horizontal Bottom Rail):** Calibrated continuous or discrete time axis ($t = 0\,\text{s}, 1\,\text{s}, 2\,\text{s}, \dots$) with explicit tick marks (`pd tick`, length 3pt).
- **Execution Intervals (Interval Bars):** Solid or shaded rectangles:
  - Active execution: `pd state` with actor-specific hue (`pdviolet!15`, `pdteal!15`).
  - Blocked / waiting / stall: Hatched or warning fill (`pderror!10`, `dash pattern=on 2pt off 2pt`).
- **Commit / Serialization Point:** Vertical synchronization rule (`1.6pt`, `pd focus rule`) marking the moment of serialization.

### Clearance Invariants
- **Vertical Interval Breathing Room:** Interval bars inside swimlanes must have at least $3\,\text{pt}$ vertical clearance from the swimlane divider rules.
- **Unblocking Leader Clearance:** Vertical dependency leaders indicating unblocking events (`(TaskA.east) |- (TaskB.west)`) must terminate with explicit stand-off (`shorten >= 2pt`).

---

## 4. Directed Acyclic Graphs (DAGs), Dependency Spines & Causal Trees

### Information Goal
Depict task execution graphs, causal provenance, git commit trees, fork attacks, delegation chains, or hierarchical subsumption lattices.

### Geometric Architecture
- **Flow Direction:** Left-to-right (horizontal time) or top-to-bottom (hierarchical causation).
- **Nodes (Vertices):** Compact card nodes (`pd state`, `inner xsep=6pt, inner ysep=4pt`) displaying entity identifier, commit hash, or task status.
- **Edges (Dependencies):** Direct directed paths (`pd rule, -{Stealth[...]}`, `0.9pt`). Invalid/forked branches use dashed error rules (`pd breach rule, dashed`).
- **Levels / Strata:** Distinct topological layers separated by fixed coordinate strides ($\Delta x \ge 3.0\,\text{cm}$ or $\Delta y \ge 1.4\,\text{cm}$).

### Clearance Invariants
- **Layer Packing:** When multiple nodes share a topological rank, space them vertically with at least $0.4\,\text{cm}$ clearance between bounding boxes.
- **Curved Bus Routing:** Edges that skip intermediate ranks must use rounded orthogonal paths (`-|` or `|-` with `rounded corners=3pt`) rather than diagonal cuts that pierce unrelated nodes.

---

## 5. Quantitative PGFPlots & 2D Regime / Decision Quadrant Maps

### Information Goal
Plot measured benchmark data, theoretical scaling functions, decision boundary regimes, equilibrium crossover points, or sensitivity trade-offs.

### Geometric Architecture
- **Axes Environment:** `\begin{axis}[pd axis, ...]` with physical units on every axis label (`Latency ($\mu$s)`, `Concurrency ($N$ agents)`).
- **Axis Styling:** Hairline rules (`pd hairline`, `0.5pt`), ticks with standard `\pdfiglabelsize` numerals.
- **Curves & Empirical Traces:** Smooth plots with standard weight ladder (`0.9pt` for comparison traces, `1.6pt` for focus trace).
- **Regime Shading:** Bounded background fills (`fill=pdteal!8`, `fill=pdink!4`) mapping out operating zones (e.g., Safe vs Contested vs Unstable).

### Clearance Invariants
- **Direct Line Labeling (No Detached Legend Boxes):** Terminate each curve at its rightmost coordinate and place a `pd direct label` node at `(axis cs:x_max, y_end)` with `anchor=west`.
- **Individual Clip Mode:** Set `clip mode=individual` so data lines are bound by domain limits while text labels outside the plot frame remain intact without being clipped.
- **Threshold Annotations:** Threshold lines (`dash pattern=on 2pt off 2pt`) must carry labels with opaque backing (`fill=pdpage`) offset by at least $2.5\,\text{pt}$ from the curve.

---

## 6. Byte-Level Wire Protocols, Memory Layouts & Capability Envelopes

### Information Goal
Illustrate binary wire formats, token struct layouts, cryptographic card fields, attenuation stacks, or serialized frame envelopes.

### Geometric Architecture
- **Bit / Byte Header Ruler:** Top horizontal rule with bit offsets ($0, 8, 16, 24, 31$ or byte indices $0, 4, 8, 12, \dots$) set in `\pdfiglabelmono`.
- **Field Boxes:** Tiled rectangular blocks whose horizontal width corresponds proportionally to the field bit/byte width.
- **Field Annotations:** Bold field name on top line, type/length on second line in `\pdfigsub` (`\mdseries\itshape`).
- **Signature / MAC Footer:** Highlighted terminal block in `pd focus state` or `pdteal!12` showing cryptographic seal.

### Clearance Invariants
- **Proportional Width Bounds:** Ensure narrow bitfields ($\le 4$ bits) have adequate width or use callout leader lines to external labels to prevent text overflow.
- **Border Alignment:** Adjacent field cells must share identical border coordinates without double-stroke jitter (use `xshift=-\pgflinewidth` or TikZ matrix layouts).

---

## 7. Paired Before/After Structural Comparison Panels

### Information Goal
Expose a fundamental failure mode in uncoordinated multi-agent development alongside the structural invariant enforced by the kernel.

### Geometric Architecture
- **Dual Side-by-Side Panels:** Left panel (Failure / Uncoordinated) vs Right panel (Enforced / Coordinated).
- **Identical Dimensions:** Both panels share exact dimensions ($W \approx 5.4\,\text{cm}, H \approx 6.0\,\text{cm}$) and identical baseline layout coordinates for direct cognitive comparison.
- **Consistent Color Polarity:** Left panel uses `pderror` accents (`pderror!8` fill, `pderror` text); right panel uses `pdcobalt` or `pdhealth` accents.
- **Bottom Synthesis Banner:** Full-width invariant card ($10.8\,\text{cm}$) summarizing the architectural takeaway.

### Clearance Invariants
- **Panel Separation:** Maintain a clear gutter of $\ge 0.6\,\text{cm}$ between the two panels.
- **Parallel Object Alignment:** Counterpart entities in the before and after panels must share the exact same $y$-coordinate to allow readers to visually scan across without vertical eye drift.
