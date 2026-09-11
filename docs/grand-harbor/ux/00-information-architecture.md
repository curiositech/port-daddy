# Information architecture

**Status:** UX PROPOSAL

## Persistent shell

| Region | Reference size | Contents and behavior |
|---|---:|---|
| Scope bar | 52 px | Harbor, Convoy, repository/environment, exact branch/artifact head, policy epoch, projection sequence/freshness, operator identity, global stop |
| Primary rail | 64 px collapsed / 224 px expanded | Bridge, Chartroom, Work, Actors, Actions, Porthole, Parleys, Relay, Budgets; status count is never the only label |
| Work canvas | flexible | editor, graph, timeline, protocol, evidence, embodiment, or split view |
| Inspector | 360 px, collapsible | selected object, governing contract, provenance, evidence, available transitions; never a generic properties dump |
| Activity dock | 36–260 px | running bodies, blocked requests, operator decisions, tensions, budget alerts, pending/indeterminate receipts |

The global stop is visually distinct from ordinary navigation. It creates a governed stop/revocation request; its confirmation text states what it can stop immediately and what external effects may already be in flight.

## Navigation

| View | Primary question | Objects | Must never imply |
|---|---|---|---|
| Bridge | What needs attention now? | intentions, bodies, blockers, proof gaps, cost holds | aggregate activity equals progress |
| Chartroom | Why and under which commitment? | intent, requirement, decision, hypothesis, question, tension | model interpretation is accepted intent |
| Work | Where is change happening? | resource topology, claims, signals, editor/diff/preview | claim grants filesystem authority |
| Actors | Who is accountable and embodied? | AgentNode, Body, office, obligation, lineage | lost process means lost person |
| Actions | What effect may occur? | request, decision evidence, permit, actuator, observation | authorization means effect happened |
| Porthole | What happened and what proves it? | events, causal links, observations, attachments | temporal proximity proves causation |
| Parleys | What disagreement is active? | protocol, role, proposition, evidence, terminal state | delivered message establishes agreement |
| Relay | What crosses authority boundaries? | directional grants, requests, disclosures, commitments | connected Harbors share ambient authority |
| Budgets | What cost was authorized and observed? | ceilings, reservations, usage, economic authority | payment equals spendable COGS |
| Anchor | Under what economic contract? | future price, bond, escrow, evidence, settlement | market is implemented today |

## Shared focus tuple

Every view retains:

```text
Harbor × Convoy × resource/project × intention × actor × time
```

A receipt deep link therefore opens its exact actor/body, intention, resource claim, Harbor, action request/permit, causal time, observation, and outcome assessment. A link addresses the object and projection, not just a screen.

## Bridge composition

The Bridge is operational, not decorative:

- **left:** intentions grouped by Now, Interrupted, Blocked, Next, Parked;
- **center:** selected desired result, current artifact/embodiment, plan lineage, claims, direct blockers;
- **right:** actor roster with durable identity, office, current body/provider, intention, claims, cost reservation, last receipt;
- **bottom:** condensed lanes for operator/Chartroom, actors, actions, Parleys, observations, and proof gaps.

Example truthful summary:

> **Desired result:** The Grand Harbor architecture exists as reviewable repository state while unresolved questions remain explicit.  
> **Current:** implementation in progress · Builder holds 4 claims · 1 tension open · publication not authorized.

The standalone word “done” is unavailable unless a named completion policy and evidence set authorize that transition.

## Responsive hierarchy

| Width | Adaptation |
|---:|---|
| ≥1280 px | rail + canvas + inspector; dock may expand |
| 960–1279 px | collapsed rail; inspector overlays or pins; two-pane canvas |
| 720–959 px | one primary canvas; context becomes top chips; inspector is a sheet |
| <720 px | action/decision-oriented cards; graph/timeline switch to list/table; no hidden live/replay scope |

Phone-first is an open product decision. The responsive model supports urgent operator judgment without claiming parity with dense development work.

## Truth and freshness chrome

Every projection names:

- authority source and revision/sequence;
- `live`, `last known`, `fixture`, or `replay` mode;
- observation time distinct from event time;
- policy/schema epoch when authority is relevant;
- unresolved hydration or divergence;
- direct path to the governing contract/evidence.

