# Coordination Theory

Port Daddy works because it refuses to treat "many agents" as "one bigger
chat." A healthy multi-agent repo has durable facts, scoped ownership,
recoverable sessions, and product-visible proof. The model is simple: agents are
temporary bodies, actors are durable responsibilities, and the daemon is the
shared substrate that turns coordination into state.

## Primitive Choice

Use the primitive whose lifetime matches the fact.

- **Notes** are for human-readable context: scope, assumptions, validation,
  blockers, and handoff evidence.
- **Channels** are for events: commits, test failures, readiness changes, and
  wakeups.
- **Inboxes** are for durable directed ownership: "Lookout should inspect docs
  drift" or "Navigator should reconcile roadmap truth."
- **Tuples** are for facts another process should query without reading prose.
- **Claims** are early, advisory edit intent.
- **Locks** are rare, exclusive critical sections.

The procedural judgment is not "always coordinate more." It is "publish the smallest
state that lets the next agent make the right decision without repeating your
archaeology."

## Actor Versus Body

Navigator, Lookout, Coxswain, Quartermaster, Signalman, Shipwright, and other
roles are actors. A live Codex, Claude, Ollama, Gemini, Aider, or custom shell
process is a body. Bodies can crash. Actors keep inboxes, notes, history, and
responsibility.

This distinction matters when the UI says an agent is gone. Do not conclude the
work is gone. Check salvage, session notes, claimed files, actor inboxes, and
activity before restarting or overwriting a slice.

## Escalation Threshold

Publish to `coordination:inconsistency` when the conflict changes operator
truth:

- live daemon state disagrees with source or docs
- two sessions imply different product decisions
- a security, auth, cost, or telemetry assumption diverges
- a route or UI exposes raw data beside a secure-surface promise
- an agent is active in one surface and dead in another
- a release surface changed without docs, skills, or packaging parity

Routine progress belongs in notes. Operator-worthy contradictions belong in the
inconsistency channel.
