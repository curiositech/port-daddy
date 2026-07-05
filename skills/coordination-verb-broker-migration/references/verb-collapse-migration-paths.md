# Verb Collapse & Migration Paths

Use this when you need to build or review the legacy-verb-to-broker-tool mapping itself: which of the ~19 legacy etiquette verbs maps to which enforced tool, and which retirement path each one takes.

## The core idea: the broker shrinks, it never grows

Once coordination is enforced, the coordination MCP is a capability broker with exactly 5 tools:

| Tool | Answers |
| --- | --- |
| `work` | Claim, hold, and release a unit of work or a resource (session, port, lock). |
| `act` | Cause something to happen (spawn an agent, run a task, initialize a fleet). |
| `ask` | Request permission, review, or a discovery answer before acting. |
| `recall` | Read or write durable memory (a note, feedback, history). |
| `status` | Observe current state without changing anything (who's active, what's running). |

Every one of the ~19 legacy etiquette verbs collapses into exactly one of these 5. A worked example of the full collapse (used verbatim in `examples/sample-input.json`):

| Legacy verb | Collapses into |
| --- | --- |
| `begin_session`, `end_session`, `claim_port`, `release_port`, `acquire_lock` | `work` |
| `spawn_agent`, `run_sortie`, `fleet_init`, `delegate_task` | `act` |
| `coordination_preflight`, `pd_discover`, `request_review`, `propose_change` | `ask` |
| `add_note`, `catch_me_up`, `drop_feedback` | `recall` |
| `sitrep`, `whoami`, `active_agent_roster` | `status` |

**A verb that doesn't fit cleanly into one of the 5 is a sign the taxonomy is wrong, not that the broker needs a 6th tool.** Push on the verb's actual purpose — almost every legacy verb is really "claim something," "cause something," "ask permission," "remember something," or "observe something" once you strip the historical name away.

## The three real retirement paths

A legacy verb is genuinely migrated only when it takes one of these three paths. There is no fourth.

1. **intake-metadata** — the verb's call becomes a structured field on the request that triggers the new tool (e.g. a legacy `add_note` call becomes `{ tool: "recall", intent: "write" }` metadata carried on the `recall` call), rather than a separate code path.
2. **alias** — the legacy verb name still resolves, but purely as a thin, stateless rename to the new tool — same denial shape, same transcript event, same code. Not a second implementation; a name.
3. **doc-history** — the verb is fully retired; its behavior is documented as historical record (what it used to do, why it was retired, what replaced it) and it no longer resolves to anything live.

## The one forbidden path: parallel runtime

**Never** keep a legacy verb alive as a second live implementation that answers the same question as the new tool — even "just for a transition period," even "only for old clients," even "just logging a deprecation warning but still doing the real work." That is parallel runtime truth: two code paths that can disagree about what actually happened, which defeats the entire point of collapsing to a single enforced surface.

If you find yourself routing "some callers" to the old verb and "some callers" to the new tool based on a feature flag, client version, or caller identity — that is a parallel runtime, whatever it's named. `scripts/broker_migration_audit.mjs` treats any `migrationPath` value other than `intake-metadata`, `alias`, or `doc-history` (including but not limited to the literal string `"parallel-runtime"`) as this forbidden case, because a migration path we cannot positively verify as one of the three real retirement paths is not safe to assume is fine.

## Why "no 6th tool" matters more than it looks like it should

The natural failure mode during a migration is a bridge/shim tool: `legacy_bridge`, `verb_router`, `compat_layer`. It always starts as "temporary." It never leaves. Every legacy verb that routes through a bridge tool instead of directly through one of the 5 is a legacy verb that has NOT actually collapsed — it has just changed which tool forwards its call. The broker's tool count is the single cheapest signal for whether the collapse actually happened: if it's still 6+ tools, it hasn't.
