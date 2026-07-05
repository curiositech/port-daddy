---
title: "Decision tree: who do I message?"
purpose: "Pick the right durable surface — actor inbox, channel, or note — so the message reaches an owner instead of the void."
last_verified: 2026-04-30
---

# Who Do I Message?

Most coordination failures aren't "I forgot to message" — they're "I messaged the wrong surface, so the right actor never saw it." Use this tree.

```
START: I have a fact, blocker, or escalation
│
├─ Is it routine progress on MY current work?
│   → `pd note "<message>"` on your active session. Don't broadcast.
│
├─ Does it need a SPECIFIC actor to see it?
│   │
│   ├─ Roadmap, recovery-ledger, work-slice, status-map, what's-next:
│   │       → pd actor navigator --message "..."
│   │
│   ├─ Roadmap PRIORITIZATION, ideas trove, dogfood feedback synthesis:
│   │       → pd actor cartographer --message "..."
│   │
│   ├─ Release surface drift (README, docs, website, OpenAPI, SDK, MCP, CLI ref, skills, FleetBar):
│   │       → pd actor lookout --message "..."
│   │
│   ├─ Claims, locks, stale assets, symbol coordination, file ownership audits:
│   │       → pd actor coxswain --message "..."
│   │
│   └─ Spawn discipline, model/backend readiness, fleet spend:
│       → pd actor quartermaster --message "..."
│
├─ Is it a coordination INCONSISTENCY operator should see?
│   (two sessions claim same surface, runtime/source disagree, security/auth divergence,
│    UI/UX or roadmap conflict between slices, sessions-active-but-agent-dead)
│   → pd tube coordination:inconsistency --send "..."
│   This is operator-visible. Don't use for routine progress.
│
├─ Is it a TIME-SENSITIVE blocker for a specific other session?
│   → Find their actor (above) AND their session-id, then:
│        pd actor <role> --message "BLOCKER for session-<id>: ..."
│   If you don't know which actor: navigator is the safe default for cross-cutting blockers.
│
├─ Is it a FACT for machine consumption (not for human reading)?
│   → emit a tuple: `pd tuple out <space> <key> <value>`
│   Examples: a build hash, a timing measurement, a port reservation.
│
├─ Is it a CONTENTION SIGNAL (this surface is hot)?
│   → emit a pheromone: `pd pheromone <path> <weight>`
│   Don't use this for ordinary progress narration.
│
├─ Is it a HANDOFF to another agent?
│   → use the schema: skills/port-daddy-agent-skill/schemas/agent-handoff.schema.json
│   → pd actor <relevant-role> --message "HANDOFF: <json conforming to schema>"
│   → also leave the handoff JSON inline in your final pd note.
│
└─ Is it a BROADCAST to the user?
    → don't bury it in pd notes. Stop and tell the user directly in your reply.
      pd notes are for agent-to-agent persistence; user-facing escalation goes to chat.
```

## When to escalate to the user

Per AGENTS.md "Ambient Collaboration" → escalate only for material inconsistencies:

- Two active sessions own/mutate the same scarce surface
- A UI/UX, roadmap, docs, or skill decision in one slice conflicts with another
- A slice violates an implied operator goal even without a local bug
- Security/auth/privacy/data-retention/trust-boundary divergence across slices
- Live daemon/runtime truth disagrees with source/docs/control-plane truth
- Agent stale, orphaned, or marked-active in one surface and dead in another

Routine "I made progress" → notes, not escalation.

## Mailbox delivery is durable, not immediate

Actor inboxes persist messages until the actor processes them. There's no synchronous reply. After messaging:

1. Keep working on the parts that don't depend on a response.
2. Re-read the relevant docs/recovery hub or `.cartographer/status.md` directly — those are the source of truth, not the message you sent.
3. Check inbox stats: `pd actor <role> --inbox-stats` before assuming the message was processed.

## Anti-patterns

| Don't | Do instead |
|---|---|
| Broadcast routine progress to coordination:inconsistency | `pd note` on your session |
| Message Navigator about every commit | Only roadmap/recovery state changes |
| Send a JSON blob in chat | `pd tube` or actor inbox with the schema |
| Wait synchronously on an actor reply | Schema-shaped note + continue with non-dependent work |
| Drop a pheromone for "I'm done" | That's a session note, not contention signal |
