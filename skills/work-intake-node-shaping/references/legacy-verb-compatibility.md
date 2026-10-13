# Route audit and canonical target evidence

The source is `docs/architecture/agent-harbor-technical-binder/work-packets/official-agent-control-plane-synthesis.md` at canonical commit `00ab2c9ab2197ff97e85edc173370b7446fdb2ef`. It describes a desired first-party boundary, not commands to run or evidence of a live route.

| Historical/source word | Binder target meaning |
| --- | --- |
| `spawn` | compatibility WorkIntent entrypoint with adapter preference |
| `dispatch` | queued/background WorkIntent source |
| `sortie` | mission/workgroup recipe source |
| `conjure` | interactive WorkIntent drafting flow |
| `nightshift` | scheduled/background WorkIntent source |

The desired boundary is WorkIntent → WorkPlan → governable AgentNode materialization, followed by Body adapters, TranscriptEvents, daemon-authorized controls, and WorkReceipt. The names remain audit labels in this offline bundle; this is neither a command inventory nor a compatibility-shim preservation rule.

The supplied audit policy recognizes `spawn`, `dispatch`, `sortie`, `conjure`,
and `nightshift`. This is a versioned, imported local list for this audit; it is
not a statement about a live runtime registry. An unknown alias holds the
record until its identity and route evidence are reviewed. This skill does not
recommend adding a compatibility shim.

For every reachable listed route, record its verb, a nonempty `trace:` call-site
reference, a nonempty `readback:` persisted-state reference, and whether the
route declares an independent write. The intended canonical target is
WorkIntent → WorkPlan → governed materialization. The boolean is a supplied
claim, not proof: inspect the cited call chain and persisted record before
claiming the route reaches the target or never creates independent state.

An empty route list is valid only with a nonempty `trace:` reference that
records why no listed legacy route is reachable. A made-up prose assertion,
empty suffix (`trace:`), missing readback, unknown verb, or independent write
makes the declaration invalid. A structurally valid declaration can still be
ineligible to admit when required approval, authority, or resources are absent.
