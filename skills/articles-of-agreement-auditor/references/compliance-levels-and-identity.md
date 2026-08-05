# Compliance Levels And Identity

Use this when you need to ground a clause's mechanism in the daemon's actual compliance ladder, or decide whether an identity claim can be trusted.

## Compliance must be daemon-witnessed, not self-attested

From the binder (`03-agent-contract-and-extension-api.md`): "Compliance must be daemon-witnessed, not self-attested by the body. The daemon issues Agent Node ids, signs Articles, grants expiring capability leases, and uses nonce challenges for adapters. A body can request capabilities; it cannot declare itself compliant."

This is why `identity.daemonIssued` and `identity.signed` are checked before any clause is even considered: an Agent Node that assigned its own id, or an Articles document nobody signed, cannot anchor any enforcement claim that follows. A perfectly-gated clause bound to a self-asserted identity is a perfectly-gated clause enforced against the wrong (or no) agent.

- **`daemonIssued: true`** means the daemon minted the Agent Node id at `agent.register`, typically against a `registrationNonce` it issued first — the body cannot walk in with a pre-chosen identity and have it accepted.
- **`signed: true`** means an `articlesSignature` binds this specific identity to this specific Articles contract, so the daemon (and any auditor) can prove which contract this agent actually agreed to, not just that *some* Articles document exists somewhere.

## The C0–C6 compliance ladder

Each rung names a class of clause the Articles typically need to cover, and the kind of mechanism that satisfies it:

| Level | Name | What it requires | Typical mechanism |
| --- | --- | --- | --- |
| C0 | Registered | Daemon knows identity, provider, body type, workspace, authority, heartbeat. | `pre-tool-gate` at registration, or `probe` on heartbeat presence. |
| C1 | Transcripted | Body streams normalized events: messages, tool calls/results, shell commands, file touches, approvals, errors, stop reasons. | `transcript-event`. |
| C2 | Governed | Tool use routes through pre-/post-tool checks; the daemon can block destructive actions, secret exfiltration, broad writes, deploys, budget violations. | `pre-tool-gate`, `capability-lease`. |
| C3 | Suggestible | Turn-start guidance, inbox messages, repo updates, parley suggestions, skill grafts, memory packets, conflict warnings can be injected before the next turn. | `mcp-gateway`, `hook`. |
| C4 | Controllable | Operator can pause, interrupt, message, checkpoint, fork, retire, or create a linked successor without destroying evidence. | `hook`. |
| C5 | Cooperative | Node can claim files/symbols, respond to parleys, participate in a shared channel/blackboard, receive Longshoreman assignments, publish structured status. | `mcp-gateway`, `probe`. |
| C6 | Resumable | Node can be reconstructed from transcript, memory packet, workspace, and active commitments. | `transcript-event` (as the durable record) plus whatever gate enforced the state being reconstructed. |

A ladder claim ("this agent is C2") is only as strong as the clauses backing it. An Articles contract that claims C2 but has no `pre-tool-gate` or `capability-lease` clause with a real `denialShape` is claiming a compliance level it cannot actually demonstrate — audit the clauses first, then trust the level label.

## Why self-attestation defeats the whole ladder

If a body could report its own compliance level, C2 ("Governed") and C0 ("Registered — I heard about myself") would be indistinguishable from the outside: both would say "yes, I'm compliant." The daemon-witnessed requirement exists precisely so the ladder means something — every rung above C0 is a claim the daemon can independently verify (a transcript it received, a tool call it actually gated, a lease it actually granted and can revoke), not a claim the agent narrates about itself.

This is also why `identity-not-daemon-issued` and `identity-unsigned` are both **critical**, not just one of them: an unsigned-but-daemon-issued identity means anyone could staple a different Articles document to a legitimate id, and a signed-but-self-issued identity means the signature is only as trustworthy as the id it signs — which is to say, not at all.
