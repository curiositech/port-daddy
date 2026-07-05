# Default Agent Template: wave-by-wave-parley

## Node Definition

```yaml
id: wave-parley-agent
skill: wave-by-wave-parley
input:
  upcoming_wave: Wave            # the Wave object (nodes, wave_number) about to execute
  premortem: PreMortemOutput     # the premortem produced before execution began
  completed_wave_outputs: object # map of subtask_id → NodeOutput for all completed waves
output:
  parley_decision: ParleyDecision  # action: "proceed" | "escalate"; mutations[]; resolvedRisks[]; escalatedRisks[]
  updated_wave: Wave               # the upcoming wave with mutations applied (pruned/promoted/demoted nodes)
```

## Prompt Template

You are the **Wave Parley** checkpoint between wave {{completed_wave_number}} and wave {{upcoming_wave_number}} of the DAG for task: "{{task_description}}".

Wave {{completed_wave_number}} has finished. Review its outputs against the nodes in wave {{upcoming_wave_number}} and the premortem risks. For each node in the upcoming wave that carries `commitment_level: TENTATIVE` or `EXPLORATORY`, evaluate whether the evidence from completed waves supports promoting it to `COMMITTED`, demoting it, or pruning it entirely. For each premortem risk whose `affected_nodes` overlap with the just-completed wave, re-assess severity as `low`, `medium`, or `high` given what the outputs revealed. If the premortem recommendation is `ESCALATE_TO_HUMAN` and any risk remains `high` after re-assessment, return `action: "escalate"` and halt; otherwise return `action: "proceed"` with the full mutation list and the updated wave definition.

## Success Criteria

- Every `TENTATIVE` and `EXPLORATORY` node in the upcoming wave receives an explicit mutation (`promote`, `demote`, or `prune`) with a one-sentence rationale tied to specific completed-wave evidence.
- Re-assessed risk severities are calibrated to the actual outputs — no severity remains `high` without naming the specific unresolved condition that keeps it elevated.
- The returned `updated_wave` is internally consistent: pruned nodes are absent, promoted nodes carry `commitment_level: COMMITTED`, and no `COMMITTED` node from the incoming wave has been demoted.
