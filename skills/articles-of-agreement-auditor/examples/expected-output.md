# Example Output: Articles of Agreement Auditor

Scenario: a new Voyager is drafted with a self-issued identity, an unsigned Articles document, a "be nice" clause with no mechanism at all, a duplicated clause name, a gate with no defined denial, and a logging clause that carries a denial shape it can never use. This is the "hopeful contract" `articles_audit.mjs` is designed to catch.

## Weak Articles — input

```json
{
  "identity": { "daemonIssued": false, "signed": false },
  "clauses": [
    { "name": "be-nice", "obligation": "Agent should behave well and not do anything bad.", "enforcementMechanism": "none", "daemonObservable": false },
    { "name": "route-tools", "obligation": "Route destructive tools through a gate.", "enforcementMechanism": "pre-tool-gate", "daemonObservable": true },
    { "name": "route-tools", "obligation": "Duplicate name on purpose.", "enforcementMechanism": "hook", "daemonObservable": true, "denialShape": "blocked" },
    { "name": "log-only", "obligation": "Just log what happens.", "enforcementMechanism": "probe", "daemonObservable": true, "denialShape": "this makes no sense on a probe" }
  ]
}
```

## Weak Articles — audit result

```json
{
  "pass": false,
  "score": 44,
  "findings": [
    { "severity": "critical", "id": "identity-not-daemon-issued", "message": "Agent identity is not marked daemon-issued — a body that can self-assert its own identity can also self-assert compliance." },
    { "severity": "critical", "id": "identity-unsigned", "message": "Articles are not marked signed — an unsigned contract cannot be proven to bind this specific Agent Node." },
    { "severity": "critical", "id": "clause-not-enforced", "message": "Clause \"be-nice\" has no daemon-observable enforcement mechanism (enforcementMechanism=\"none\", daemonObservable=false) — the obligation degrades to hope." },
    { "severity": "critical", "id": "enforced-clause-no-denial-shape", "message": "Clause \"route-tools\" uses a gate-style mechanism (\"pre-tool-gate\") but defines no denialShape — nothing describes what actually happens when the gate fires." },
    { "severity": "medium", "id": "duplicate-clause-name", "message": "Clause name \"route-tools\" appears more than once — duplicate names make it ambiguous which mechanism actually governs the obligation." },
    { "severity": "medium", "id": "denial-shape-on-non-gate-mechanism", "message": "Clause \"log-only\" defines a denialShape but its mechanism (\"probe\") only observes/records — it cannot itself deny an action." }
  ],
  "recommendations": [
    "Issue the Agent Node id from the daemon at registration (agent.register with a daemon-issued registrationNonce); never accept a body-supplied identity as-is.",
    "Require an articlesSignature over the daemon-issued identity before the agent is treated as compliant at any level.",
    "Wire \"be-nice\" through a concrete mechanism the daemon can observe: a pre-tool gate, hook, capability lease, MCP gateway, probe, or transcript event — never \"none\".",
    "Define denialShape for \"route-tools\": the concrete rejection an agent receives (error code, refused tool call, revoked lease) when it violates the clause.",
    "Rename or merge the duplicate \"route-tools\" clauses so each obligation maps to exactly one mechanism.",
    "Either upgrade \"log-only\" to a gate-style mechanism (pre-tool-gate, hook, capability-lease, mcp-gateway) if it must block a violation, or drop denialShape since a probe/transcript-event has nothing to deny."
  ]
}
```

## What fixing it actually looked like

1. **Re-registered through the daemon.** The agent's id came from `agent.register` against a daemon-issued `registrationNonce` instead of being supplied by the body, and the daemon signed the Articles document — `identity.daemonIssued` and `identity.signed` both became `true`.
2. **Replaced "be nice" with a real clause.** A vague behavioral aspiration became `route-destructive-tools-through-gate`, wired through an actual `pre-tool-gate` that intercepts destructive git actions, secret reads, and out-of-workspace writes.
3. **Renamed the duplicate.** `route-tools` (pre-tool-gate) and its accidental duplicate (hook) became two distinctly-named clauses: `route-destructive-tools-through-gate` and `accept-operator-interrupt`, each mapped to exactly one mechanism.
4. **Defined the missing denial shape.** `route-destructive-tools-through-gate` now states the artifact a violation produces: "the tool call is rejected with `PD_TOOL_DENIED` and the id of the violated policy."
5. **Dropped the nonsensical denial shape.** `log-only` became `respond-to-parley-within-window`, a genuine `probe` clause with no `denialShape` — a probe observes, it does not deny.
6. **Added the remaining C1–C5 coverage** (`stream-transcript-events`, `respect-token-and-cost-budget`, `claim-files-before-editing`) so the contract actually backs the compliance levels it implicitly claims.

## Fixed Articles — input

This is `examples/sample-input.json`, unmodified:

```json
{
  "identity": { "daemonIssued": true, "signed": true },
  "clauses": [
    { "name": "register-with-daemon", "obligation": "Agent must call agent.register with a daemon-issued registrationNonce and articlesSignature before any tool use.", "enforcementMechanism": "pre-tool-gate", "daemonObservable": true, "denialShape": "every tool call before a successful agent.register is refused with UNREGISTERED_AGENT" },
    { "name": "stream-transcript-events", "obligation": "Agent must stream every tool call, tool result, shell command, and stop reason as a normalized transcript event.", "enforcementMechanism": "transcript-event", "daemonObservable": true },
    { "name": "route-destructive-tools-through-gate", "obligation": "Agent must route destructive git actions, secret reads, and writes outside the workspace through the daemon's pre-tool gate.", "enforcementMechanism": "pre-tool-gate", "daemonObservable": true, "denialShape": "the tool call is rejected with PD_TOOL_DENIED and the id of the violated policy" },
    { "name": "respect-token-and-cost-budget", "obligation": "Agent must halt and request an extension once accrued cost or token usage crosses the harbor's configured budget.", "enforcementMechanism": "capability-lease", "daemonObservable": true, "denialShape": "the tool-use capability lease expires and is not renewed, returning BUDGET_LEASE_EXPIRED on the next tool call" },
    { "name": "accept-operator-interrupt", "obligation": "Agent must yield control within one turn when the daemon issues a pause or interrupt control signal.", "enforcementMechanism": "hook", "daemonObservable": true, "denialShape": "the process-supervision hook suspends the body process regardless of agent cooperation and marks the turn interrupted" },
    { "name": "claim-files-before-editing", "obligation": "Agent must register a file or symbol claim with the daemon before editing it, and release the claim on completion.", "enforcementMechanism": "mcp-gateway", "daemonObservable": true, "denialShape": "the coordination MCP gateway rejects a conflicting edit tool call with CLAIM_CONFLICT and the competing claimant's agent id" },
    { "name": "respond-to-parley-within-window", "obligation": "Agent must acknowledge an incoming parley request within the harbor's configured response window.", "enforcementMechanism": "probe", "daemonObservable": true }
  ]
}
```

## Fixed Articles — audit result

```json
{
  "pass": true,
  "score": 100,
  "findings": [],
  "recommendations": [
    "Articles meet the enforcement-beats-hope bar: every clause has a concrete, daemon-observable mechanism, gates define their denial shape, and identity is daemon-issued and signed."
  ]
}
```

Note that `respond-to-parley-within-window` uses `probe` with no `denialShape` at all: that is correct, not incomplete. A passive mechanism observes; it never denies, so it never needs one.
