# Skill partition, 2026-09-26

Choose the skill by the decision or artifact the task calls for. The checked-in
`skills/` directory is the canonical repository source. Installed plugin and
Homebrew bundles are upstream sources; their staging paths are not publication
paths. See [agency](agency.md) and [Rust/GPUI](rust.md) for the two large source
mappings and activation probes.

## LaTeX and publication

| Task | Skill | Boundary |
|---|---|---|
| Write article math, tables, citations, or preamble | `latex-authoring` | Source content; Beamer, TikZ, and build troubleshooting moved out |
| Build slides | `latex-beamer-presentations` | Frames, overlays, handouts, slide readability |
| Compile or diagnose TeX | `latex-build-diagnostics` | Codex built-in editor for standalone documents; project toolchain for projects |
| Design a standalone paper's pages | `latex-publication-design` | Typography and page rhythm; repository Book style takes precedence |
| Publish committed PDFs and metadata | `latex-whitepaper-engineering` | Port Daddy build, PDF, and registry consistency |
| Design a textbook chapter | `textbook-craft` | Chapter opener, pedagogy, exercises, and claim labels |

The installed `latex:latex-doctor`, `latex:latex-compile`, and
`latex-tectonic:LaTeX Tectonic` remain tool-specific execution skills. Their
plugins can change location. The new build skill routes to them by capability
without copying plugin scripts or claiming they replace the Codex built-in
standalone editor.

## Figures and visualization

| Task | Skill | Boundary |
|---|---|---|
| Decide what a canonical whitepaper figure means | `whitepaper-figure-system` | Reader question, evidence, counter-reading, atlas ID |
| Draw a generic publication figure in TikZ | `tikz-figure-engineering` | Source, geometry, typography, final-size rendering |
| Draw a Harbor Book figure in its edition language | `tikz-diagram-craft` (user skill) | Book templates, palette, three-edition visual QA |
| Run source and rendered geometry checks on Harbor fragments | `harbor-chartwork` | Precheck, standalone compile, figcheck, corpus audit |
| Write a Mermaid diagram | `mermaid-graph-writer` | Mermaid syntax and validation |
| Make an ASCII or Unicode diagram | `diagramming-expert` | Text-only diagrams |
| Choose automatic node placement and edge routing | `node-link-and-diagram-layout` (plugin) | Layout algorithm, constraints, routing, stability |
| Make declarative web charts | `grammar-of-graphics-and-declarative-visualization` (plugin) | Vega-Lite, Vega, Observable Plot |
| Build a custom interactive web chart | `data-viz-2025` | React/TypeScript chart implementation |
| Explain chart use in a commercial story | `data-viz-commercials` | Audience and presentation, not chart code |
| Check HTML text collision or clipping | `layout-overflow-guard` (user skill) | Geometric web QA, not print PDF QA |

`whitepaper-figure-system`, `tikz-figure-engineering`, and `harbor-chartwork`
remain separate because they answer different questions: meaning, drawing,
and measured print geometry. The two plugin skills already have narrow,
non-overlapping contracts. Their names should not be used as a generic
"draw any diagram" trigger.

## Research and prose

| Task | Skill | Boundary |
|---|---|---|
| Establish novelty across vocabulary boundaries | `research-prior-art` | Search ledger and closest-work comparison |
| Choose venue and prepare a formal paper | `research-paper-submission` | Positioning, structure, submission checks |
| Present one Harbor result to a new reader | `harbor-exposition` | One claim, worked numbers, honest boundary |
| Teach a multi-result Book chapter | `textbook-craft` | Chapter sequence and exercises |
| Explain a Port Daddy proof in an essay | `port-daddy-expository-writer` | Companion exposition, not the paper or marketing |
| Write API docs, ADRs, READMEs, or runbooks | `technical-writer` | Operational/documentation forms |

`research-craft` remains an upstream research-method skill; it is not a
substitute for venue work or a claim of proof. The publication skills present
research results after independent correctness checks.

## Agent reasoning and systems

| Task | Skill |
|---|---|
| Strategic advisory claims and repeated-agent incentives | `game-theoretic-agent-incentives` |
| Payments, allocations, and computational mechanism literature | `nisan-et-al-2007-algorithmic-game-theory` |
| Individual BDI state and reconsideration | `bdi-agent-architecture` |
| AgentSpeak and BDI plan/interpreter execution | `bdi-agent-interpreters` |
| Organizational BDI and soft systems | `bdi-organizational-modeling` |
| Norm adoption, obligation, and conflict | `bdi-normative-reasoning` |
| Hierarchical decomposition research | `hypertree-planning` |
| Port Daddy context clusters and execution waves | `pilot-hypertree-execution` |

The former Nisan-derived root was condensed into a literature-routing skill.
Its imported synthesis remains in a marked reference file. It contains
prescriptions that need theorem-level checking before use. The repeated-game
skill has the same source-treatment boundary. Neither skill grants a blanket
truthfulness or equilibrium guarantee.

## Rust and GPUI

Use the [Rust/GPUI routing table](rust.md): compiler and Cargo workflow;
public API; data structures; diagnosis; measured optimization; Rust-to-Bun
FFI; GPUI console; motion; shaders; cooperative editor. The assistant-named
Rust workflow entry was replaced by `rust-development-workflow`.

## Activation examples

- “Why is `\cite{foo}` unresolved?” → `latex-build-diagnostics`.
- “Make this Beamer reveal readable as a handout” → `latex-beamer-presentations`.
- “Which diagram makes the claim visible?” → `whitepaper-figure-system` for a
  canonical Book figure; a general chart selection skill otherwise.
- “The TikZ label crosses an arrow in all editions” → `tikz-diagram-craft`
  with `harbor-chartwork` checks.
- “Find whether another field already proved this theorem” → `research-prior-art`.
- “The agent replans on every belief update” → `bdi-agent-architecture`.
- “How should AgentSpeak select a plan?” → `bdi-agent-interpreters`.
- “A Rust future hangs” → `rust-debugging-mastery`.
- “Implement a GPUI pane's refresh and focus behavior” → `gpui-rust-console`.

## Source and installation rule

The repository can remove or rename its own top-level skills. External plugin,
Homebrew, and other-repository source directories are read-only inputs to this
partition. User-level installed entries are synchronized from the validated
repository bundles separately. No installed link may point into a temporary
Codex worktree after handoff.
