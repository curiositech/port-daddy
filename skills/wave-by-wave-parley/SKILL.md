---
name: wave-by-wave-parley
version: 0.1.0
description: >
  After each execution wave completes, inspect the DAG's commitment landscape and premortem risk score. If any
  surviving nodes carry `commitment_level: TENTATIVE`, or if the premortem `recommendation` is `ACCEPT_WITH_MONITORING`
  or `ESCALATE_TO_HUMAN`, pause execution and run a structured parley: re-evaluate TENTATIVE nodes against the evidence
  produced by the just-completed wave, update risk severity where warranted, and either promote nodes to COMMITTED,
  demote them to EXPLORATORY, or prune them before launching the next wave. Parley is a scheduled operation triggered by
  wave completion — not an ad-hoc intervention — making wave boundaries the natural formation-break point where plans
  meet reality.
author: soma-jury_rig-graft
tags:
  - jury_rig
  - dag-execution
  - wave-management
  - parley
  - premortem
  - tentative-nodes
  - commitment-level
  - adaptive-planning
pairs-with:
  - jury_rig-premortem
  - jury_rig-resilience
  - jury_rig-decomposer
  - jury_rig-architect
  - dag-mutation-strategist
license: Apache-2.0
allowed-tools: Read,Write,Edit,Glob,Grep
metadata:
  provenance:
    kind: imported
    source: workgroup-ai / jury_rig skill library (rehomed 2026-07-04)
---

# Wave-by-Wave Parley

## When to Use

- Any multi-wave Jury-rig execution where the decomposer emitted at least one subtask with
  `commitment_level: TENTATIVE` or `EXPLORATORY` — those nodes were uncertain at plan time and
  must be re-evaluated after each wave delivers new evidence.
- The premortem returned `recommendation: ACCEPT_WITH_MONITORING` or `ESCALATE_TO_HUMAN` before
  execution began — standing parley checkpoints convert that intent into a concrete gate.
- Long-horizon DAGs (3+ waves, estimated_total_minutes > 20) where assumptions embedded in wave N+1
  can be falsified by wave N outputs before expensive work begins.
- Manager-led implementation waves where multiple agents may have opened,
  updated, merged, or superseded PRs. Pair the parley with `session-pr-audit`
  before the next wave so plan truth and GitHub/accounting truth move together.

NOT for:
- Single-wave DAGs or tasks where all subtasks are `COMMITTED` and premortem returned `PROCEED` —
  there is nothing to negotiate; proceed directly.
- Ad-hoc mid-wave interruptions — parley fires at wave completion, not at agent completion; do not
  interrupt a running wave.
- Replacing `dag-mutation-strategist` when a node has actually failed — parley is a proactive
  commitment-level review on success, not a failure recovery protocol.

## Core Concepts

**Wave Boundary as Formation Break.** A wave in `metaDAGPredict` is a set of subtask IDs that share
the same `wave_number` and can run in parallel (`parallelizable: true` when `subtask_ids.length > 1`).
Wave completion is deterministic: all nodes in `waves[N].nodes` have produced outputs. The boundary
between wave N and wave N+1 is the only moment where the full output of the parallel formation is
available for inspection before the next formation launches. Parley treats this boundary as a
natural, scheduled formation break.

**Commitment Level as Plan Uncertainty.** The decomposer (`buildDecomposerPrompt`) assigns each
subtask one of three `commitment_level` values:
- `COMMITTED` — high confidence, well-defined, proceed without parley.
- `TENTATIVE` — likely needed but approach may change; parley-required before the wave containing
  this node executes.
- `EXPLORATORY` — might be needed depending on what earlier waves reveal; parley determines whether
  to promote, demote to COMMITTED, or prune entirely.

**Premortem Risk Threshold.** `PreMortemOutput.recommendation` has three values:
- `PROCEED` — parley is optional (run it only if TENTATIVE nodes exist).
- `ACCEPT_WITH_MONITORING` — parley is required at every wave boundary.
- `ESCALATE_TO_HUMAN` — parley gate must surface to the human operator before proceeding past the
  boundary; autonomous continuation is forbidden.

Individual risks carry `severity: 'low' | 'medium' | 'high'` and `affected_nodes: string[]`. After
each wave, re-evaluate severity of risks whose `affected_nodes` intersect the just-completed wave's
`subtask_ids`. Evidence from completed nodes can either resolve or escalate a risk.

**Parley as Scheduled Operation.** Parley is not triggered by anomaly detection or a human command.
It is scheduled by the presence of TENTATIVE nodes or a non-PROCEED premortem before execution
begins. The executor inserts a parley checkpoint into the run plan between every consecutive pair of
waves. The checkpoint runs zero or minimal LLM calls when all conditions are green (no TENTATIVE in
upcoming wave, all risks resolved or low). It runs a structured re-evaluation only when conditions
are not green.

**Swarm Silence vs. DAG Parley.** The swarm topology (`executeSwarm` in `topologies/swarm.ts`)
converges by idle-timeout, vote, or quality-threshold — reactive convergence driven by message bus
drain. Parley is the structural complement: it operates between scheduled waves in a DAG topology,
uses the decomposer's commitment model rather than a message bus, and results in a plan mutation
(node promotion, demotion, or pruning) rather than swarm termination.

## Implementation Pattern

```
function shouldParley(
  upcomingWave: Wave,
  premortem: PreMortemOutput,
  waveOutputs: Map<string, NodeOutput>,  // outputs from all completed waves
): boolean {
  // 1. Check if any upcoming node is TENTATIVE or EXPLORATORY
  const hasUncertain = upcomingWave.nodes.some(
    n => n.commitment_level === 'TENTATIVE' || n.commitment_level === 'EXPLORATORY'
  );

  // 2. Check premortem standing recommendation
  const requiresByPremortem = (
    premortem.recommendation === 'ACCEPT_WITH_MONITORING' ||
    premortem.recommendation === 'ESCALATE_TO_HUMAN'
  );

  return hasUncertain || requiresByPremortem;
}

async function parley(
  upcomingWave: Wave,
  premortem: PreMortemOutput,
  completedWaveOutputs: Map<string, NodeOutput>,
  provider: LLMProvider,
  model: string,
): Promise<ParleyDecision> {
  // Step 1: Collect evidence from completed nodes that are dependencies
  //         of TENTATIVE/EXPLORATORY nodes in the upcoming wave.
  const relevantOutputs = upcomingWave.nodes
    .filter(n => n.commitment_level !== 'COMMITTED')
    .flatMap(n => extractDependencyIds(n.input_contract))
    .map(depId => completedWaveOutputs.get(depId))
    .filter(Boolean);

  // Step 2: Re-evaluate risk severity for risks whose affected_nodes
  //         intersect the just-completed wave.
  const resolvedRisks: string[] = [];
  const escalatedRisks: Risk[] = [];
  for (const risk of premortem.risks) {
    const hasEvidence = risk.affected_nodes.some(
      id => completedWaveOutputs.has(id)
    );
    if (hasEvidence) {
      const updated = await reassessRisk(risk, completedWaveOutputs, provider, model);
      if (updated.severity === 'low') resolvedRisks.push(risk.description);
      else if (updated.severity === 'high') escalatedRisks.push(updated);
    }
  }

  // Step 3: For each uncertain node, promote / demote / prune.
  const mutations: NodeMutation[] = [];
  for (const node of upcomingWave.nodes) {
    if (node.commitment_level === 'COMMITTED') continue;

    const decision = await evaluateNodeCommitment(
      node,
      relevantOutputs,
      escalatedRisks,
      provider,
      model,
    );
    // decision.action: 'promote' | 'demote' | 'prune'
    // decision.new_commitment_level: 'COMMITTED' | 'EXPLORATORY' | null (null = pruned)
    mutations.push(decision);
  }

  // Step 4: If ESCALATE_TO_HUMAN and any risk remains high, surface to operator.
  if (
    premortem.recommendation === 'ESCALATE_TO_HUMAN' &&
    escalatedRisks.some(r => r.severity === 'high')
  ) {
    return { action: 'escalate', mutations, resolvedRisks, escalatedRisks };
  }

  // Step 5: Return updated wave plan. Pruned nodes removed. Promoted nodes
  //         proceed as COMMITTED. Demoted nodes pushed to a later wave.
  return { action: 'proceed', mutations, resolvedRisks, escalatedRisks };
}

// Execution loop with parley:
async function executeWithParley(dag: PredictedDAG, ...) {
  for (let i = 0; i < dag.waves.length; i++) {
    const wave = dag.waves[i];

    // Execute wave N in parallel (as dag-runtime does)
    const waveOutputs = await executeWaveParallel(wave, ...);
    completedOutputs.mergeAll(waveOutputs);

    // Parley before wave N+1
    if (i + 1 < dag.waves.length) {
      const nextWave = dag.waves[i + 1];
      if (shouldParley(nextWave, dag.premortem, completedOutputs)) {
        const decision = await parley(
          nextWave, dag.premortem, completedOutputs, provider, model
        );
        if (decision.action === 'escalate') {
          await notifyOperator(decision);
          return;  // halt until operator responds
        }
        applyMutations(dag.waves[i + 1], decision.mutations);
      }
    }
  }
}
```

Key invariants:
- Parley never interrupts a running wave. It fires exactly once per completed wave, before the next.
- A COMMITTED node is never re-evaluated in parley. Commitment is monotonic downward (TENTATIVE can
  promote to COMMITTED or demote to EXPLORATORY; EXPLORATORY can promote to COMMITTED or be pruned;
  COMMITTED cannot be demoted).
- Parley on a wave where all nodes are COMMITTED and premortem is PROCEED is a no-op (`shouldParley`
  returns false and the checkpoint is skipped entirely).
- `ESCALATE_TO_HUMAN` + a surviving high-severity risk halts the executor and surfaces a human gate.
  This maps to the premortem `recommendation` semantics in `meta-dag-predict.ts` lines 542-550.
- Parley decides whether the next wave should run; `session-pr-audit` decides
  whether the completed wave's code is accounted for. Run both before a manager
  launches the next implementation wave.

## Key References

1. **`packages/core/src/context/meta-dag-predict.ts`** — `DecomposerOutput.Subtask.commitment_level`
   (lines 23-28), `PreMortemOutput.recommendation` (lines 57-64), wave assembly in the Synthesizer
   (lines 558-586). The `commitment_level` enum and premortem thresholds are the source of truth for
   parley trigger conditions.

2. **`packages/core/src/topologies/swarm.ts`** — `executeSwarm` (lines 162-327). Contrast: swarm
   convergence is reactive (idle-timeout, vote, quality-threshold on a message bus); parley is
   structural (scheduled at wave boundaries in a DAG). Both are coordination mechanisms but operate
   at different abstraction levels and on different topologies.

3. **Klein, G. (1993). "A recognition-primed decision (RPD) model of rapid decision making."**
   In G. Klein et al. (Eds.), *Decision Making in Action: Models and Methods*. The formation-break
   model in military planning (after each maneuver element reports in, commanders reassess and
   re-issue orders) is the direct analogue to wave-by-wave parley.

4. **Kahneman, D. & Klein, G. (2009). "Conditions for intuitive expertise: A failure to disagree."**
   *American Psychologist*, 64(6), 515–526. COMMITTED vs. TENTATIVE vs. EXPLORATORY maps to the
   spectrum from high-validity environments (pattern recognition, commit) to low-validity environments
   (uncertainty, parley required). Parley is the mechanism that converts low-validity planning nodes
   into high-validity execution nodes before they run.
