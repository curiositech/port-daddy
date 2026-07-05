# Example Output: Work Intake Node Shaping

Scenario: a `nightshift` compatibility shim resolves one WorkIntent to two archetypes at once
("dag-workgroup" and an invented "swarm") because nobody wants to pick, and the `nightshift`
route itself opens its own session/transcript instead of routing through the shared WorkPlan
pipeline. This is the "bad intake" `node_shaping_audit.mjs` is designed to catch.

## Weak spec — input

```json
{
  "workIntent": {
    "id": "wi-2026-06-30-nightshift-batch-migration",
    "signals": {
      "coupling": "high",
      "contextPressure": "high",
      "skillBoundary": "many",
      "reviewIndependence": "independent",
      "budget": "large",
      "operatorBurden": "high"
    }
  },
  "selectedArchetypes": ["dag-workgroup", "swarm"],
  "legacyRoutes": [
    { "verb": "nightshift", "writesIndependentState": true },
    { "verb": "summon", "writesIndependentState": false }
  ]
}
```

## Weak spec — audit result

```json
{
  "pass": false,
  "score": 0,
  "findings": [
    {
      "severity": "critical",
      "id": "multiple-archetypes-selected",
      "message": "WorkIntent \"wi-2026-06-30-nightshift-batch-migration\" resolved to 2 topology archetypes (dag-workgroup, swarm) — the Single Operator Action invariant requires exactly one."
    },
    {
      "severity": "critical",
      "id": "unknown-archetype",
      "message": "Selected archetype \"swarm\" is not one of the seven canonical topology archetypes (node, scout, chain, dag-workgroup, tournament, ambient-watcher, human-gate)."
    },
    {
      "severity": "critical",
      "id": "legacy-route-writes-independent-state",
      "message": "Legacy launch verb \"nightshift\" writes its own Agent Node/session/transcript state instead of routing through the shared WorkIntent -> WorkPlan -> Agent Node pipeline."
    },
    {
      "severity": "medium",
      "id": "unknown-legacy-verb",
      "message": "Legacy route verb \"summon\" is not one of the documented compatibility verbs (spawn, dispatch, sortie, conjure, nightshift)."
    }
  ],
  "recommendations": [
    "Resolve the ambiguity in the signal vector itself; a WorkIntent that legitimately fits two archetypes means the scoring is under-specified, not that both should be launched.",
    "Re-map \"swarm\" onto one of the seven canonical archetypes, or fix the typo — the taxonomy is exhaustive by design and the operator should never see an eighth name.",
    "Rewire \"nightshift\" to be compatibility source metadata only (an annotation on the WorkIntent, e.g. \"arrived via nightshift\") — it must terminate in the same single-archetype materialization path as every other entrypoint, never open a parallel governed session.",
    "Confirm \"summon\" is an intentional new compatibility alias and document it alongside spawn/dispatch/sortie/conjure/nightshift, or fix a naming drift."
  ]
}
```

## What fixing it actually looked like

1. **Rescored the signal vector.** High coupling, high context pressure, many skill boundaries, independent review, large budget, high operator burden all point to one archetype: `dag-workgroup` (a workgroup of nodes with independent review lanes). "swarm" wasn't a real disambiguation — it was a second name for the same call. Dropped it.
2. **Rewired `nightshift`.** The shim used to open its own session id and start a transcript before handing off to the batch migration logic. Rewrote it to attach `{ sourceVerb: "nightshift" }` as compatibility metadata on the WorkIntent and route through the same `materializeAgentNode(workIntent)` call every other entrypoint uses — one Agent Node, one session, one transcript.
3. **Renamed `summon`** to `sortie` (it was a naming drift from an earlier prototype, not an intentional sixth compatibility verb) and updated the call site.

## Fixed spec — input

This is `examples/sample-input.json`, unmodified:

```json
{
  "workIntent": {
    "id": "wi-2026-07-03-fix-symbol-index-fd-leak",
    "signals": {
      "coupling": "low",
      "contextPressure": "low",
      "skillBoundary": "single",
      "reviewIndependence": "shared",
      "budget": "small",
      "operatorBurden": "low"
    }
  },
  "selectedArchetypes": ["node"],
  "legacyRoutes": [
    { "verb": "spawn", "writesIndependentState": false }
  ]
}
```

## Fixed spec — audit result

```json
{
  "pass": true,
  "score": 100,
  "findings": [],
  "recommendations": [
    "WorkIntent maps to exactly one valid archetype and no legacy verb writes independent state. Safe to materialize the single Agent Node."
  ]
}
```

Note the surviving `spawn` route: it stays a compatibility annotation, not a finding — `writesIndependentState: false` proves it terminates in the shared pipeline instead of opening a second governed session.
