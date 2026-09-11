# Commitment Levels as Per-Turn Briefing Signals: COMMITTED / TENTATIVE / EXPLORATORY

`commitment_level` is a first-class field on every `Subtask` in the decomposer's output schema (defined in `meta-dag-predict.ts` line 27 and enforced by the JSON Schema at line 144). It is not a planning annotation — it is a **per-turn briefing signal** that the parley executor reads before launching each wave. The field tells the executor whether a node needs human-loop validation, LLM re-evaluation, or can proceed without any gate.

## The Three Levels

**COMMITTED** — high confidence, well-defined approach, all inputs known or stably predictable. No parley re-evaluation. The decomposer assigns COMMITTED when: (a) wave 0 with a well-structured problem, (b) all upstream dependencies have stable, typed output contracts, and (c) Sensemaker confidence >= 0.8. The `shouldParley` guard in the SKILL.md implementation skips COMMITTED nodes entirely. Commitment is **monotonically downward** during parley: once COMMITTED, a node cannot be demoted. This monotonicity is deliberate — it prevents oscillation between gates and keeps already-validated work from being re-litigated.

**TENTATIVE** — the node is likely necessary and its output shape is understood, but the concrete approach depends on what upstream nodes produce. The decomposer emits TENTATIVE when specification confidence is 0.2–0.8 or when the node depends on a "vague node" (per the decomposer's confidence threshold tree; see `jury_rig-decomposer` SKILL.md lines 59–67). A single TENTATIVE node in the upcoming wave is sufficient to trigger parley — `shouldParley` returns `true` regardless of premortem `recommendation`. **TENTATIVE is the parley trigger.** Parley's job is to consume wave-N evidence and resolve TENTATIVE into either COMMITTED (approach confirmed) or EXPLORATORY/pruned (approach abandoned or deferred).

**EXPLORATORY** — the node might not be needed at all; its necessity is conditional on what earlier waves reveal. Specification confidence < 0.2, or the problem domain was classified as `wicked` by the Sensemaker. An EXPLORATORY node also triggers parley (`shouldParley` treats it identically to TENTATIVE). Parley outcome: promote to COMMITTED if evidence makes the path clear, or prune if evidence makes the path unnecessary. EXPLORATORY nodes should never survive to execution without passing through a parley gate — their presence means the plan has open-world uncertainty that must be closed before compute is spent.

## Decomposer Schema Integration

The authoritative JSON Schema for `DecomposerOutput.Subtask` lives in the Jury-rig repo at `packages/core/src/context/meta-dag-predict.ts` (inline schema object, lines 130–160) and is mirrored in the Jury-rig catalog's `jury_rig-decomposer` skill (`schemas/decomposer-output.schema.json` there) <!-- cite-exempt: Jury-rig-repo paths, not port-daddy paths -->. Both require `commitment_level` as a non-optional enum field: `['COMMITTED', 'TENTATIVE', 'EXPLORATORY']`. The synthesizer in `meta-dag-predict.ts` applies a default of `'TENTATIVE'` (line 579) when the decomposer omits the field — meaning the safe default is always to trigger parley, never to skip it.

The `waves` array in `DecomposerOutput` (`{ wave_number: number; subtask_ids: string[] }`) does not carry commitment levels directly. The executor must join `subtask_ids` against the `subtasks` array to retrieve `commitment_level` for each node before calling `shouldParley`. There is no denormalized "wave-level commitment" — commitment is always per-subtask.

## TENTATIVE as Parley Trigger: Precise Mechanics

`shouldParley(upcomingWave, premortem, waveOutputs)` returns `true` if:

1. `upcomingWave.nodes.some(n => n.commitment_level === 'TENTATIVE' || n.commitment_level === 'EXPLORATORY')`, OR
2. `premortem.recommendation === 'ACCEPT_WITH_MONITORING' || premortem.recommendation === 'ESCALATE_TO_HUMAN'`

Condition 1 is the commitment-level trigger; Condition 2 is the premortem-risk trigger. Either alone is sufficient. Both can fire simultaneously (e.g., a TENTATIVE node in a high-risk plan). When parley runs on a TENTATIVE node, it collects outputs from the completed wave that are listed in the TENTATIVE node's `input_contract` dependencies (`extractDependencyIds(n.input_contract)`), feeds them to `evaluateNodeCommitment`, and produces a mutation: `promote` (→ COMMITTED), `demote` (→ EXPLORATORY), or `prune` (node removed from wave). A TENTATIVE node that parley cannot resolve — because upstream outputs are ambiguous — should be demoted to EXPLORATORY and pushed to a later wave, not forced to COMMITTED.

## Key Points

- TENTATIVE = parley trigger. One TENTATIVE node in the upcoming wave is sufficient to invoke the full parley routine regardless of premortem recommendation.
- The decomposer defaults missing `commitment_level` to TENTATIVE (line 579 of `meta-dag-predict.ts`), so omission always triggers parley — the safe default.
- Commitment is monotonically downward: COMMITTED nodes are never re-evaluated by parley; TENTATIVE can promote to COMMITTED or demote to EXPLORATORY; EXPLORATORY can promote to COMMITTED or be pruned.
- The decomposer's vague-node confidence thresholds (0.8 / 0.5–0.8 / 0.2–0.5 / < 0.2) map directly to COMMITTED / check-dependencies / TENTATIVE / EXPLORATORY — these thresholds are the mechanistic basis for every commitment assignment.
- `DecomposerOutput.waves` carries only `subtask_ids`; the executor must join against `subtasks` to get `commitment_level` per node — there is no wave-level commitment shortcut.

## See Also

- `skills/jury_rig-decomposer/SKILL.md` — Three-pass protocol, vague-node confidence thresholds, and commitment-level assignment decision tree (the upstream source of every TENTATIVE/EXPLORATORY node this skill acts on). <!-- cite-exempt -->
- `packages/core/src/context/meta-dag-predict.ts` lines 23–64 — Canonical TypeScript definitions for `Subtask.commitment_level` and `PreMortemOutput.recommendation`; synthesizer default at line 579.
- `skills/wave-by-wave-parley/diagrams/01_flowchart_decision-points.md` — Visual execution flow showing where `shouldParley` fires and how mutations flow back into the wave plan.
