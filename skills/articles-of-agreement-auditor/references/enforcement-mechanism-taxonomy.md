# Enforcement Mechanism Taxonomy

Use this when you need to pick a real `enforcementMechanism` for a clause, or decide whether it needs a `denialShape`.

## The core split: gates deny, passives observe

Every legal `enforcementMechanism` value falls into one of three buckets. Confusing "the daemon can see it" with "the daemon can stop it" is the single most common Articles-drafting failure.

| Bucket | Values | What it can do | Needs `denialShape`? |
| --- | --- | --- | --- |
| **Gate** | `pre-tool-gate`, `hook`, `capability-lease`, `mcp-gateway` | Intercepts the action before or during execution and can refuse it outright. | Yes — a gate with no defined denial is a gate nobody has actually built. |
| **Passive** | `probe`, `transcript-event` | Records or samples what happened; the daemon learns about a violation, sometimes after the fact. | No — there is nothing to "deny"; the value of a passive mechanism is the observation itself, surfaced downstream (alerting, salvage, reputation). |
| **Hope** | `none` | Nothing. The clause is a sentence in a document. | N/A — `clause-not-enforced` fires unconditionally. |

`none` is a legal enum value on purpose: an honest draft names an unenforced obligation as `none` instead of omitting the field or picking a mechanism that doesn't actually exist yet. `articles_audit.mjs` treats `none` (and `daemonObservable: false` under any mechanism) as the same failure — a clause degrading to hope — because a mechanism the daemon cannot independently observe is functionally unenforced even if it has a name.

## Picking a mechanism per clause

Match the mechanism to what the daemon can concretely instrument, drawn from the Agent Runtime Protocol (binder `03-agent-contract-and-extension-api.md`):

- **`pre-tool-gate`** — the daemon intercepts a tool call before it executes and can allow, transform, or refuse it. Use for: destructive git actions, secret reads, filesystem writes outside the workspace, registration-before-first-tool-call.
- **`hook`** — the daemon supervises the body process itself (pause, interrupt, checkpoint, kill) independent of whether the agent cooperates. Use for: operator control (C4), forced yield on interrupt, resource-limit enforcement.
- **`capability-lease`** — the agent holds a time- or budget-bounded credential that the daemon can let expire or revoke without touching the tool call path directly. Use for: token/cost budgets, scoped tool grants, delegated authority that should not outlive a session.
- **`mcp-gateway`** — a coordination surface (file/symbol claims, parley routing, shared blackboard) mediates the action and can reject a conflicting or out-of-turn request. Use for: file claims (C5), parley participation, structured status publication.
- **`probe`** — the daemon polls or spot-checks state after the fact (did the agent respond within the window, does its heartbeat context match its claimed token usage). Use for: soft-timing obligations, drift detection, anything that's cheaper to sample than to gate.
- **`transcript-event`** — the obligation *is* the report: every tool call, tool result, shell command, and stop reason streamed as a normalized event (C1). The mechanism and the obligation are the same act, so there is nothing separate to gate.

## Writing a real `denialShape`

A `denialShape` is not "the clause is enforced" restated — it is the literal artifact an agent (or an auditor) would observe when the clause is violated:

- An error code and the policy id it violated (`PD_TOOL_DENIED`, `policy: no-secret-reads-outside-lease`).
- A specific refused call (`git push --force` rejected before the socket opens).
- A revoked or expired credential (`capability lease expires, next tool call returns BUDGET_LEASE_EXPIRED`).
- A process-level action independent of agent cooperation (`the supervision hook suspends the body process`).

"The agent is not allowed to do X" is an obligation, not a `denialShape`. If you cannot describe the artifact a violation produces, the gate has not actually been built yet — the clause should honestly carry `enforcementMechanism: "none"` until it has.

## Never put a `denialShape` on a passive mechanism

A `probe` or `transcript-event` clause with a `denialShape` set signals confusion about what the mechanism does: neither can refuse an action in the moment. If an obligation genuinely needs to be *blocked*, upgrade it to a gate; if it only needs to be *seen*, drop the `denialShape` field entirely.
