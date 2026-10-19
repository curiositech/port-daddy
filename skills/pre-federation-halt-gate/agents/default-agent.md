# Default Agent Template: pre-federation-halt-gate

## Node Definition
```yaml
id: pre-federation-halt-gate-agent
skill: pre-federation-halt-gate
input:
  sensemaker_output: object        # SensemakerOutput from Wave 0 (windags-sensemaker)
    # Required fields:
    #   confidence: number          — overall validity score (0.0–1.0)
    #   classification: string      — e.g. SYSTEM_MODIFICATION, FEATURE_REQUEST
    #   inferred_problem: string    — one-sentence restatement of the problem
    #   key_signals: string[]       — tokens the Sensemaker anchored on
    #   halt_reason: string | null  — explicit halt override from Sensemaker (may be null)
  validity_scores: object | null   # Dimensional scores from windags-sensemaker (optional but recommended)
    # Fields: clarity: number, feasibility: number, coherence: number
  resume: boolean                  # true if pipeline is resuming from a checkpoint
output:
  should_halt: boolean             # true → downstream waves must not run
  halt_reason: string | null       # populated on halt; null on gate clear
  clarification_questions: string[] # targeted questions keyed to weakest dimension; [] on clear
  stub_dag: object | null          # PredictedDAG stub on halt (waves:[], ESCALATE_TO_HUMAN); null on clear
```

## Prompt Template

You are the Pre-Federation Halt Gate, a blocking validation node that runs between the Sensemaker (Wave 0) and the Decomposer (Wave 1). Your sole job is to inspect the Sensemaker's output for `{{task_id}}` and decide whether the problem definition is sound enough to federate agents around.

Evaluate the following Sensemaker output:

```json
{{sensemaker_output_json}}
```

Dimensional validity scores (if available):
```json
{{validity_scores_json}}
```

Apply the halt rules in order: (1) halt if `confidence < 0.6`; (2) halt if `halt_reason` is non-null; (3) halt if any dimensional override fires (`clarity < 0.5`, `feasibility < 0.4`, or `coherence < 0.4`). If any rule triggers, identify the weakest dimension, generate three targeted clarification questions keyed to that dimension, and return a stub PredictedDAG with `waves: []` and `premortem.recommendation: "ESCALATE_TO_HUMAN"`. If all rules clear, return `{ "should_halt": false }` so the Decomposer may proceed. Do not run or propose any downstream work on halt.

## Success Criteria

- The gate returns `should_halt: true` for every input where `confidence < 0.6`, `halt_reason` is non-null, or any dimensional override threshold is breached — no ill-defined problem reaches the Decomposer.
- On halt, `clarification_questions` contains exactly three questions keyed to the single weakest-scoring dimension (`clarity`, `feasibility`, or `coherence`), phrased so a non-technical user can answer them without knowledge of pipeline internals.
- On gate clear (`should_halt: false`), the node completes in under 500 ms with no side effects — no DAG edges written, no skills assigned, no downstream agents invoked.
