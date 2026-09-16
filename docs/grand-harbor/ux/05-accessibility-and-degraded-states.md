# Accessibility, responsive behavior, and degraded states

**Status:** UX PROPOSAL

## Accessibility contract

- Every graph, topology, and timeline has an equivalent navigable outline/table with the same objects and state.
- Claims and pheromones remain distinguishable with color removed: solid/dotted/hatched line grammar plus literal labels and IDs.
- Dynamic updates announce meaningful state transitions, not token/stream noise.
- Every critical control is keyboard-reachable, visibly focused, and named with verb/target.
- No high-risk decision depends on hover, pointer precision, animation, or color.
- Event and observation times expose timezone; IDs remain selectable and visible.
- Reduced motion replaces wakes/pulses with age/strength text and static contours.
- Pheromone strength and half-life are always textual for screen-reader users.
- Inspector reading order follows selected object → status → authority → evidence → available actions.
- Dense tables support row/column headers, sorting announcements, focus preservation, and horizontal-scroll alternatives.
- Zoom to 200% retains scope, live/replay mode, primary state, and high-risk actions.

## Focus and shortcuts

| Command | Behavior |
|---|---|
| `⌘K` / `Ctrl+K` | command palette, scoped by current Harbor/Convoy |
| `/` | query current projection; never triggers a live action |
| `J` / `K` | next/previous object in current region |
| `[` / `]` | previous/next region |
| `G then C/W/A/P` | Chartroom / Work / Actions / Porthole |
| `⌘Enter` | capture or submit the explicitly focused draft; high-risk authorization never inherits this shortcut |
| `Esc` | close overlay without discarding a durable source/request |

Global stop uses a reserved shortcut with hold/repeat protection and an audible/screen-reader announcement. Its confirmation focuses the scope and known limits, not a decorative title.

## Projection outage

Never replace known state with a blank spinner.

```text
LAST KNOWN · Chartroom seq 18,391 · observed 11m ago
Live mutation unavailable. Raw capture will queue locally with source digest.
```

- already loaded data remains readable;
- freshness and missing ranges remain visible;
- actions that require unavailable authority are disabled with exact remediation;
- reconstruction/retry progress has an accessible status;
- a projection rebuild does not pretend to be canonical mutation.

## Chartroom unavailable

Allow local durable capture if the contract supports it. Do not allow authoritative commit, automatic scheduling, or apparent supersession. On reconnect, propose reconciliation against the new exact revision and expose conflicts.

## Claim service unavailable

Show last-known claims and sequence. For sanctioned mutation, follow an explicit offline policy: deny, allow only pre-held non-overlapping lease, or operator exception under a separate governed action. Do not silently operate as if no claims exist.

## Policy/entity hydration failure

Action review says:

> **Authorization indeterminate. No permit issued.** Entity projection `ep_88` is missing grant `grt_44A`; last complete projection is 4m old. Retry hydration or deny the request.

Any Cedar evaluation diagnostics also cause indeterminate/deny at the wrapper.

## Cost meter unavailable

Show reserved ceiling, last observed usage, unknown interval, and configured behavior (`pause`, `hard ceiling`, or explicitly labeled degraded mode). Never claim budget safety while the credential boundary cannot observe cost.

## Relay partition or divergence

Both Harbor identities, local/remote sequence, last sent/received event, active local interpretation, and divergence remain visible. The phrase `synced` is unavailable unless the contract defines and proves it. Remote actions continue only under local policy and still-valid local evidence.

## Evidence unavailable or redacted

Differentiate:

- absent: no link recorded;
- unavailable: source cannot currently be reached;
- redacted: evidence exists under a disclosure restriction;
- untrusted: provenance/observer is not accepted;
- stale: wrong subject revision;
- indeterminate: available evidence cannot decide.

The accessible table exposes commitment/digest metadata even when payload is redacted, where policy permits.

## Replay mode

- persistent `REPLAY — NO LIVE EFFECTS` in scope bar, canvas, inspector, and screen-reader landmark;
- all live action controls removed, not merely disabled in place;
- selecting a historical request can create a **new draft diagnostic intention**, never replay the action;
- URL/deep link encodes replay cursor and cannot be upgraded to live mode without an explicit navigation transition.

## Narrow view / mobile judgment

The single-column order is:

1. Harbor/Convoy/live-replay scope;
2. object and desired result;
3. exact state and freshness;
4. effect/decision payload;
5. governing evidence/policy;
6. risk/unknowns;
7. explicit actions;
8. supporting history.

Graphs become lists; split diffs become sequential before/after blocks; the primary action remains below all required evidence, never pinned over unread content.

## Failure variants the mocks must carry

| Failure | Required presentation |
|---|---|
| Body dies after external send | unknown effect; observe before retry |
| Test passes at stale head | stale evidence; completion unsatisfied |
| New instruction contradicts | proposed Tension; no silent supersession |
| GitHub write succeeds, browser test fails | effect receipt succeeds; outcome incomplete |
| Grant revoked during execution | permit/admission/revocation/observation times and unresolved cancellation |
| Pheromone suggests unauthorized person | suggestion shown; ordinary claim/grant/action checks still apply |
| Provider success but readback differs | observed mismatch |
| Aggregate CI green hides failed child | failed child visible and policy-blocking |
| Remote Harbor says success without acceptable evidence | remote assertion; insufficient local proof |
| Conflicting receipts | evidence conflict; neither silently selected |
| Original Body returns | split-brain safeguard; no silent concurrent embodiment |

