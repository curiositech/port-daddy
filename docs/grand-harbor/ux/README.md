# Grand Harbor UX package

**Status: UX PROPOSAL**  
This is a projection of the proposed ledger and accepted repository architecture into product behavior. It does not amend the constitution or contract registry. Runtime state names are presentation-model candidates until their governing contracts are ratified. Where policy remains unresolved, the interface exposes the question rather than choosing an answer.

## UX contract

Every surface preserves these distinctions:

- `AgentNode`/actor ≠ Body/incarnation ≠ provider session;
- office or protocol role ≠ person;
- goal ≠ accepted intention;
- interpretation proposal ≠ Chartroom mutation;
- claim ≠ capability;
- pheromone ≠ claim, authority, completion, or evidence;
- credential ≠ authority;
- ActionIntent ≠ ActionPermit ≠ effected action ≠ ActionReceipt;
- receipt ≠ good outcome;
- delivery ≠ understanding ≠ acceptance ≠ agreement;
- transport health ≠ Relay grant;
- one Harbor's assertion ≠ another Harbor's trusted observation;
- estimated cost ≠ boundary-observed COGS;
- historical replay cannot silently cause a live action;
- unknown, partial, stale, contradicted, redacted, untrusted, and indeterminate are first-class states.

## Five questions, five projections

| Operator question | Primary projection |
|---|---|
| Why are we doing this? | Chartroom |
| Where is work occurring? | Work + Claim Forest + pheromone overlay |
| Who remains responsible? | Actors and continuity |
| What exact effect is authorized? | Action review + grants |
| What actually happened, and what proves it? | Porthole |

## Package

- [Information architecture](00-information-architecture.md)
- [Personas and user stories](01-user-stories.md)
- [Extensive desktop wireframes](02-wireframes.md)
- [Complete end-to-end flows](03-full-flows.md)
- [State, copy, and action matrix](04-state-and-copy-matrix.md)
- [Accessibility and degraded states](05-accessibility-and-degraded-states.md)
- [High-fidelity interactive mock](mocks/pd-console-workstation.html)

Reference viewport is 1440 × 960, dense, keyboard-first, with responsive alternatives down to a single-column operator surface. Harbor and Convoy scope remain visible on every page because changing Harbor is an authority-domain transition, not a cosmetic workspace switch.

