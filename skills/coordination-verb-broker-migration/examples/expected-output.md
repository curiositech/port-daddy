# Example Output: Coordination Verb Broker Migration

Scenario: a team ships a "broker collapse" migration plan that looks done — it has a mapping table and a compliance-mode declaration — but on inspection: one legacy verb was never mapped, one is kept alive as a genuine parallel runtime, the broker grew a sixth "bridge" tool while also dropping `recall` entirely, the surviving `status` tool has no transcript event, the body claims `C5` (enforced) while still emitting legacy-verb calls, and the legacy-verb inventory itself is short by one. This is the "bad migration" `broker_migration_audit.mjs` is designed to catch.

## Bad migration — input

```json
{
  "brokerTools": [
    { "name": "work", "denialShape": true, "transcriptEvent": true },
    { "name": "act", "denialShape": true, "transcriptEvent": true },
    { "name": "ask", "denialShape": true, "transcriptEvent": true },
    { "name": "status", "denialShape": true, "transcriptEvent": false },
    { "name": "legacy_bridge", "denialShape": false, "transcriptEvent": false }
  ],
  "legacyVerbs": [
    { "name": "begin_session", "mappedTo": "work", "migrationPath": "alias" },
    { "name": "end_session", "mappedTo": "work", "migrationPath": "alias" },
    { "name": "claim_port", "mappedTo": "work", "migrationPath": "alias" },
    { "name": "release_port", "mappedTo": "work", "migrationPath": "alias" },
    { "name": "acquire_lock", "mappedTo": "work", "migrationPath": "alias" },
    { "name": "spawn_agent", "mappedTo": "act", "migrationPath": "alias" },
    { "name": "run_sortie", "mappedTo": "act", "migrationPath": "alias" },
    { "name": "fleet_init", "mappedTo": "act", "migrationPath": "alias" },
    { "name": "delegate_task", "mappedTo": null, "migrationPath": "intake-metadata" },
    { "name": "coordination_preflight", "mappedTo": "ask", "migrationPath": "alias" },
    { "name": "pd_discover", "mappedTo": "ask", "migrationPath": "alias" },
    { "name": "request_review", "mappedTo": "ask", "migrationPath": "intake-metadata" },
    { "name": "propose_change", "mappedTo": "ask", "migrationPath": "parallel-runtime" },
    { "name": "add_note", "mappedTo": "recall", "migrationPath": "alias" },
    { "name": "catch_me_up", "mappedTo": "recall", "migrationPath": "alias" },
    { "name": "drop_feedback", "mappedTo": "recall", "migrationPath": "intake-metadata" },
    { "name": "sitrep", "mappedTo": "status", "migrationPath": "alias" },
    { "name": "whoami", "mappedTo": "status", "migrationPath": "alias" }
  ],
  "complianceMode": "C5",
  "emitsLegacyVerbCalls": true
}
```

## Bad migration — audit result

```json
{
  "pass": false,
  "score": 20,
  "findings": [
    { "severity": "critical", "id": "verb-unmapped", "message": "Legacy verb \"delegate_task\" has mappedTo=null, which is not one of the 5 enforced tools (work/act/ask/recall/status)." },
    { "severity": "critical", "id": "parallel-runtime-migration", "message": "Legacy verb \"propose_change\" has migrationPath=\"parallel-runtime\", which is not one of the recognized retirement paths (intake-metadata, alias, doc-history) — treated as a forbidden parallel runtime." },
    { "severity": "high", "id": "legacy-inventory-incomplete", "message": "Spec accounts for 18 legacy verb(s); the documented collapse inventory expects 19." },
    { "severity": "critical", "id": "broker-grew", "message": "Broker tool surface includes \"legacy_bridge\", which is not one of the 5 enforced tools (work/act/ask/recall/status) — the broker is growing, not shrinking." },
    { "severity": "critical", "id": "broker-tool-missing", "message": "Enforced tool \"recall\" is missing from the broker tool surface — any legacy verb mapped to it points at a tool that does not exist." },
    { "severity": "critical", "id": "broker-tool-no-denial-or-transcript", "message": "Enforced tool \"status\" is missing a transcript event — every enforced tool must declare both." },
    { "severity": "critical", "id": "c4plus-emits-legacy-verbs", "message": "Body is declared at compliance mode C5 (C4+) but emitsLegacyVerbCalls is true — the IT-018 Broker Collapse gate requires zero legacy-verb calls at C4 and above." }
  ],
  "recommendations": [
    "Map \"delegate_task\" to exactly one of work/act/ask/recall/status before this migration can be considered complete.",
    "Retire \"propose_change\" through intake-metadata, an alias, or documented history — never keep it live as a second code path answering the same question as the new tool.",
    "Reconcile the legacyVerbs list against the full etiquette-verb inventory before treating the migration as complete — a verb left off the list can still be called by old clients unnoticed.",
    "Remove \"legacy_bridge\" from the broker tool surface; route whatever it does through one of the 5 enforced tools instead.",
    "Add \"recall\" to the broker tool surface with a denial shape and a transcript event before mapping any legacy verb to it.",
    "Give \"status\" both a denial shape and a transcript event before this migration can be considered enforced.",
    "Either stop emitting legacy-verb calls entirely before claiming C5, or move the body back to an advisory mode (C0-C3) until the migration is finished."
  ]
}
```

## What fixing it actually looked like

1. **Mapped the orphan verb.** `delegate_task` got an explicit `mappedTo: "act"` — it spawns work, so it belongs with the other `act` verbs.
2. **Retired the parallel-runtime verb for real.** `propose_change` moved to `migrationPath: "doc-history"`: its old handler was deleted and its behavior documented as history, not kept as a second live path.
3. **Completed the inventory.** The missing 19th verb (`active_agent_roster`, a `status` verb) was added back with a real mapping and migration path.
4. **Removed the bridge tool.** `legacy_bridge` was deleted; whatever it shimmed now goes through `ask` or `act` directly.
5. **Restored `recall`.** The `recall` tool was added back to the broker surface with `denialShape: true` and `transcriptEvent: true`.
6. **Fixed `status`'s transcript event.** `status` now emits its documented transcript event on every call.
7. **Stopped the legacy calls before claiming C5.** `emitsLegacyVerbCalls` was verified `false` end-to-end before the compliance-mode declaration was updated.

## Fixed migration — input

This is `examples/sample-input.json`, unmodified:

```json
{
  "brokerTools": [
    { "name": "work", "denialShape": true, "transcriptEvent": true },
    { "name": "act", "denialShape": true, "transcriptEvent": true },
    { "name": "ask", "denialShape": true, "transcriptEvent": true },
    { "name": "recall", "denialShape": true, "transcriptEvent": true },
    { "name": "status", "denialShape": true, "transcriptEvent": true }
  ],
  "legacyVerbs": [
    { "name": "begin_session", "mappedTo": "work", "migrationPath": "alias" },
    { "name": "end_session", "mappedTo": "work", "migrationPath": "alias" },
    { "name": "claim_port", "mappedTo": "work", "migrationPath": "alias" },
    { "name": "release_port", "mappedTo": "work", "migrationPath": "alias" },
    { "name": "acquire_lock", "mappedTo": "work", "migrationPath": "alias" },
    { "name": "spawn_agent", "mappedTo": "act", "migrationPath": "alias" },
    { "name": "run_sortie", "mappedTo": "act", "migrationPath": "alias" },
    { "name": "fleet_init", "mappedTo": "act", "migrationPath": "alias" },
    { "name": "delegate_task", "mappedTo": "act", "migrationPath": "intake-metadata" },
    { "name": "coordination_preflight", "mappedTo": "ask", "migrationPath": "alias" },
    { "name": "pd_discover", "mappedTo": "ask", "migrationPath": "alias" },
    { "name": "request_review", "mappedTo": "ask", "migrationPath": "intake-metadata" },
    { "name": "propose_change", "mappedTo": "ask", "migrationPath": "doc-history" },
    { "name": "add_note", "mappedTo": "recall", "migrationPath": "alias" },
    { "name": "catch_me_up", "mappedTo": "recall", "migrationPath": "alias" },
    { "name": "drop_feedback", "mappedTo": "recall", "migrationPath": "intake-metadata" },
    { "name": "sitrep", "mappedTo": "status", "migrationPath": "alias" },
    { "name": "whoami", "mappedTo": "status", "migrationPath": "alias" },
    { "name": "active_agent_roster", "mappedTo": "status", "migrationPath": "doc-history" }
  ],
  "complianceMode": "C4",
  "emitsLegacyVerbCalls": false
}
```

## Fixed migration — audit result

```json
{
  "pass": true,
  "score": 100,
  "findings": [],
  "recommendations": [
    "Migration meets the broker-collapse bar: all legacy verbs map to the 5 enforced tools through a real retirement path, every tool declares denial + transcript, and the compliance-mode gate is satisfied."
  ]
}
```

Note that `complianceMode: "C4"` with `emitsLegacyVerbCalls: false` satisfies the IT-018 gate; an advisory body at `C0`-`C3` could still legitimately have `emitsLegacyVerbCalls: true` without any finding — the gate only bites once a body claims enforced coordination.
