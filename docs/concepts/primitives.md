# Primitives

Port Daddy works best when the coordination story is built from small, inspectable primitives instead of one oversized orchestration claim.

This concept page is the cleaned-up version of the earlier runtime-primitives explainer. It removes the interview framing and treats the primitive map as product doctrine: a repo with multiple agents needs live state, ownership signals, recovery evidence, and human-readable proof surfaces.

## Core Thesis

Multi-agent work has facts that move at different speeds.

Some facts are durable and reviewed. Some are live and expire quickly. Some are audit evidence. Some are authority boundaries. A useful coordination system gives each kind of fact the storage and UI shape that matches its lifetime.

Port Daddy's core primitive families are:

| Family | What it answers | Examples |
| --- | --- | --- |
| Identity | Who is acting, and under what project context? | [agents](/agents), [sessions](/docs/features/sessions), [semantic service names](/docs/features/ports), [project-scoped channels](/docs/cli/pub) |
| Ownership | Who intends to touch this scarce surface now? | [service claims](/docs/features/ports), [file claims](/docs/features/sessions), [region claims](/docs/features/sessions), [locks](/docs/sdk/locks) |
| Messaging | How do agents and tools notify each other without scraping prose? | [channels](/docs/cli/pub), [inboxes](/agents/communication-protocols), [tuples](/docs/features/tuples) |
| Recovery | What survives when a process dies or a context window disappears? | [session notes](/docs/cli/note), [activity](/docs/features/timeline), [salvage](/docs/features/salvage), [resurrection](/agents/resurrection) |
| Verification | What checks the runtime story against actual behavior? | [Arbiter invariants](/docs/features/arbiter), [guard checks](/agents/coordination-guard), [telemetry gates](/agents/smart-resources), [budget gates](/agents/smart-resources) |
| Human Control | Where does a person inspect and approve the state? | [FleetBar](/mac-preview), [Fleet Control Center](/mac-preview), [Shipwright](/agents/yaml-and-shipwright), [Resources](/agents/smart-resources), [Spawned Runs](/docs/tutorials/launch-and-inspect-a-spawn) |

The important design principle is that no primitive should pretend to do every job. A lock is not a note. A note is not a queue. A channel is not a handoff. A budget gate is not a review.

## Primitive Stack

Use the primitive whose lifetime matches the fact.

| Layer | Encodes | Why it exists |
| --- | --- | --- |
| [Sessions](/docs/features/sessions) and [notes](/docs/cli/note) | Purpose, assumptions, progress, validation, handoff | They give work a durable human-readable trail. |
| [Claims](/docs/features/sessions) and [locks](/docs/sdk/locks) | Current edit intent and scarce-resource ownership | They let nearby agents route around each other before conflict. |
| [Channels](/docs/cli/pub) and [inboxes](/agents/communication-protocols) | Broadcast events and directed ownership | They prevent "coordination" from becoming transcript archaeology. |
| [Tuples](/docs/features/tuples) | Shared machine-readable facts with TTL and pattern matching | They let agents query what the system currently knows. |
| [Activity](/docs/features/timeline) and [salvage](/docs/features/salvage) | What happened, what died, what can be resumed | They turn crashes into recoverable state instead of folklore. |
| [Arbiter](/docs/features/arbiter) and gates | Runtime invariants, spend limits, telemetry requirements | They keep invisible policy violations from becoming normal. |
| Operator surfaces | [FleetBar](/mac-preview), [Fleet Control Center](/mac-preview), [Shipwright](/agents/yaml-and-shipwright), [Mac preview](/mac-preview) | They let a human see the coordination state without reconstructing it from commands. |

## Choosing The Primitive

| Need | Use | Avoid |
| --- | --- | --- |
| "I am working on this file or symbol." | [File claim](/docs/features/sessions) or [region claim](/docs/features/sessions) | A chat message that no tool can query |
| "Only one process can touch this now." | [Lock](/docs/sdk/locks) | A broad file claim for a generated artifact or migration |
| "Someone needs to own this handoff." | [Actor inbox](/agents/communication-protocols) | A channel broadcast that everyone can ignore |
| "Everyone watching this project should know." | [Project-scoped channel](/docs/cli/pub) | A note hidden inside one session |
| "Another process should query this fact later." | [Tuple](/docs/features/tuples) | A paragraph that must be parsed |
| "This work died but should continue." | [Salvage queue](/docs/features/salvage) | Re-running the task from memory |
| "This launch is too opaque or too expensive." | [Budget and telemetry gates](/agents/smart-resources) | Launching first and hoping logs explain cost later |

## Design Implication

Public pages that explain primitives should look like operator instruments, not generic feature grids.

Use a primitive-map layout when the page needs to show relationships among state, authority, evidence, and recovery:

- hard rules instead of decorative cards;
- compact fact tables with explicit labels;
- one strong color per semantic family;
- source-backed captions and file links;
- visible hierarchy from type, spacing, and grid alignment;
- no abstract "AI magic" copy where a concrete runtime fact exists.

That is now the official Port Daddy design-system variant for primitive explanations: a page should help a reader answer "what does the system know now, who owns it, and what can recover it?"

## Sources

- `lib/sessions.ts` for sessions, notes, file claims, lifecycle state, and salvage handoff data.
- `lib/locks.ts` for exclusive coordination over scarce resources.
- `lib/tuples.ts` for Linda-style shared facts with pattern matching and TTL.
- `lib/activity.ts` for append-only runtime evidence.
- `lib/arbiter.ts` for invariant checks over runtime state.
- `lib/spawner.ts` and `lib/budget-guard.ts` for launch telemetry and spend enforcement.
- `website-v2/src/components/landing/DistributionSection.tsx` for the current Mac preview download truth surface.
- `website-v2/src/styles/tokens.source.css` for the shared typographic, spacing, and grid tokens used by primitive-map pages.
