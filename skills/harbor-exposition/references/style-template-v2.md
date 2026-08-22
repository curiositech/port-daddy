# Style Template v2 — Seven Moves + Two Rails (full craft guidance)

Load this when drafting or reviewing. The SKILL.md flowchart is the map; this file is the terrain.

## Rail A — Two reading paths
Write the express lane LAST, place it FIRST. Format: one italic sentence (Move 2 verbatim) + "— formal statement in the box below." The expert test: express lane + box, read alone with nothing else, must fully and correctly state the result. If they don't, the box is not self-contained — fix the box, not the lane.

## Rail B — Visual discipline (program-wide grammar)
Two figures, always the same two kinds:
1. **Relation-map** (for Move 3): three columns — base structure | target structure | arrows for the mapped *relations*. Label arrows with the relation ("expected loss = magnitude × probability"), never with nouns. If you cannot draw the arrows, the analogy is surface-level; replace it.
2. **Regime diagram** (for Move 7): axes = the two parameters that most control validity; shade where the result holds; mark the session's measured points on it. Examples in use: zoom advantage (x = flagged-set density, shaded sparse region); sheaf verdict (holds on cycles, fails on cut edges — draw the two topologies); tower (C vs G_k plane, bribery-profitable region G_k > C·B).
Reuse the same drawing conventions in every piece (Distill's sustainability lesson: a style too expensive to run won't be run). Budget ≤ 2 hours per figure; simplify the grammar before exceeding it.

## The seven moves — craft per move

**Move 1 — The scene.** One concrete situation, ≤ 4 sentences, zero jargon, present tense. The reader should recognize the *pain* before hearing any solution. Test: could a smart engineer outside the field nod along?

**Move 2 — One breath.** A single italic sentence carrying the entire result, including its condition if the condition is the point ("…provided anomaly is a calibrated probability"). This sentence is also the express lane and often the abstract's first line. If you need two sentences, you have two results — split the piece.

**Move 3 — Structural analogy.** Choose by Gentner's rule: relations map, attributes don't. Good bases in the program's repertoire (reuse them): speeding tickets → deterrence (ρdB ≥ G); thermometer → scalar heads (comonotonicity); smoke detector → expected-loss inspection; twenty questions → group testing/zoom; bouncer at one door → controllable vs uncontrollable events; watch-offsets around a loop → cocycle condition; hospital chart outliving shifts → the work unit; voting-booth turnstile clicking only party → declassification.
Introduce each symbol here, at first point of use, bound to the scene's referent (N is the thousand files; k is the three bad ones). Never more than ~5 new symbols per piece; if more are needed, the piece is too big.
**End Move 3 with the misread-to-preempt**: one line naming the wrong mental model the analogy invites ("you might think this means summaries are useless — it doesn't; it prices the *guarantee*"). This is distinct from Move 7: the misread is about the reader's model; the boundary is about the theorem's scope. If the misread line is empty for most pieces, fold it into Move 7 rather than forcing it.

**Move 4 — The box.** The precise statement, boxed, self-contained: define every symbol inside the box or cite the exact spot above where it was bound. Written to be quoted in another document without edits. Theorem-numbering optional; self-containment mandatory.

**Move 5 — Numbers by hand, then fade.** One worked example verifiable mentally or on one line of arithmetic, drawn where possible from the *actual session numbers* (ρ* = 10/(0.8·50) = 0.25; H(0.05) = 0.286). Then FADE (Renkl/Atkinson): end with "now you try" and the next case, with the answer in parentheses. One sentence of cost; converts reading into practice.

**Move 6 — What it buys.** The concrete application: which product claim, chapter, or paper this underwrites, named ("this is Paper 3's core"; "this is why the sidecar exists"). No generic "this has implications for…".

**Move 7 — The honest boundary.** What the result does NOT say, at the same prominence as the claim, with the regime diagram. Include, when applicable: modeling conventions that change the number (keep-gain vs confiscation ρ*), assumptions that are measured-not-proven (detection rate d, collusion correlation), and channels out of model (timing, minds). Boundary-writing heuristic: imagine the hostile referee's first sentence and write it yourself, better.

## Notation rules (Halmos / Knuth, enforced)
- Introduce at point of use, bound to the concrete example; never a preliminaries dump.
- Never begin a sentence with a symbol; separate adjacent formulas with words.
- Words over symbols in prose (∀/∃/⇒ stay in the box).
- One alphabet discipline per piece: don't reuse a letter for two roles.

## Numeric-claim provenance policy
Every reported number carries one of two tags, visibly:
- **[verified]** — externally checkable (textbook value, closed form the reader can recompute): e.g., ρ* = G/(dB); R(0) = H(p).
- **[internal, seed/script]** — regenerates from a named script and seed (program convention: seed 20260816): e.g., "0/16 floor violations [internal, a7_experiment.py]"; "536 reachable states [internal, c0_workunit.py]".
Never let a reader confuse the two; the exposition-research audit showed outside readers cannot distinguish them unaided. Wrong-turn numbers (the 8/16 spurious violations) are reported, not hidden — see falsification-first.

## Done-tests (both must pass before shipping)
1. **Expert test**: express lane + box alone state the result completely and correctly.
2. **Novice test**: a smart outsider can restate the one-breath sentence in their own words after one read.
Also: two figures present in the program grammar; misread line present or consciously waived; every number tagged per the provenance policy; boundary includes at least one "does NOT say."

## LaTeX skeleton (drop-in)
```latex
% per-result section skeleton
\subsection*{RESULT NAME}
\emph{Express lane: ONE-BREATH SENTENCE --- formal statement in the box below.}
\paragraph{The scene.} ...
\paragraph{The idea in one breath.} \emph{...}
\paragraph{Intuition.} ... (relation-map figure) ... Misread to preempt: ...
\begin{thebox} Formal statement, self-contained. \end{thebox}
\paragraph{Numbers by hand.} ... \emph{Now you try:} ... (answer).
\paragraph{What it buys.} ...
\begin{boundary} What this does NOT say ... (regime figure) \end{boundary}
```
(`thebox`/`boundary` are mdframed environments: blue-tinted for statements, red-tinted for boundaries — keep the color semantics program-wide.)

## Process guidance (authors)
Spiral-write and rewrite rather than edit (Halmos); read aloud including formulas (Knuth); use the wastebasket (Tao). Write Moves 3–5 first, Move 2 second-to-last, the express lane last.
