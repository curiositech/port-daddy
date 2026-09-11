# Extensive desktop wireframes

**Status:** UX PROPOSAL  
**Reference:** 1440 × 960, IBM Plex family, Swiss-maritime hierarchy and fine linework  
**Companion:** [interactive high-fidelity mock](mocks/pd-console-workstation.html)

These wireframes specify hierarchy, content, transitions, copy, authority, evidence, and degraded behavior. Measurements are starting constraints, not an implementation mandate.

## WF-01 — Bridge / return-to-work

### Frame

| Coordinate | Region | Content |
|---|---|---|
| 0–52 y | scope bar | `Erich's Harbor / Port Daddy / Grand Harbor` · `main@5e438c7` · policy `pol_7 / schema_3` · live sequence `18,406` · observed `3s ago` · global stop |
| 0–224 x | rail | Bridge selected; Chartroom `2`; Actions `1`; Parleys `1`; Budgets warning label, not color alone |
| 224–544 x | intent stack | Now, Interrupted, Blocked, Next, Parked; each row has relation, owner, last evidence, age |
| 544–1056 x | work canvas | desired result, live browser/editor split, current claims, plan lineage, direct blockers |
| 1056–1440 x | actor inspector | durable person, office, body/provider, intention, claims, budget hold, blocked-on, last receipt |
| bottom 180 | activity dock | aligned lanes: operator/Chartroom, Builder, Nemesis, action kernel, external state |

### Selected content

> **Desired result**  
> Persist Grand Harbor architecture as reviewable repository state while every unresolved policy seam remains explicit.

Status strip:

```text
ACTIVE INTENTION · 4 hard claims · 1 advisory risk · 1 permit awaiting judgment
Evidence: 7/9 required links · exact-head publication missing
```

### Interactions

- `J/K` moves within the current region; `[`/`]` moves between regions; `/` searches the focus tuple.
- Selecting an intention filters the actor and evidence lanes but never hides a countervailing tension; the filter indicator lists exclusions.
- `Resume work` opens the last artifact and last proven event, then shows drift since that event.
- `Mark fulfilled` is unavailable. `Propose fulfillment` is available only if a completion policy exists.

### Degraded

If Chartroom is unavailable, the stack says `Last known at seq 18,391 · 11m stale`; raw capture remains available to a local durable queue. Accepted mutation controls are disabled with the governing reason.

## WF-02 — Chartroom / semantic mutation review

### Frame

| Region | Content |
|---|---|
| left 300 | typed browser: Intent, Requirement, Decision, Hypothesis, Question, Tension; Now/Next/Later is a projection toggle |
| center 570 | relationship graph or accessible outline; selected node shows source, owner, disposition, exact revision, proof state |
| right 346 | proposed interpretation, semantic diff, affected invariants/contracts, ambiguity, deterministic checks |
| bottom 72 | `Tell Chartroom…` capture with `⌘Enter Capture`; captured state appears before interpretation |

### Proposal card

> **Interpretation proposed · ip_204**  
> Adds `E-014 — Full Grand Harbor UX flows`.  
> Depends on `E-003 — pd-console workstation`.  
> Refines archived M5. Does not supersede repository persistence.  
> **Ambiguity:** “afterwards” may mean after ledger reconciliation or after publication.

Semantic diff rows:

| Transition | Source | Impact | Authority |
|---|---|---|---|
| `ADD E-014` | utterance `utt_991` | new acceptance scenario | operator signature |
| `LINK depends-on E-003` | plan + utterance | program edge | operator signature |
| `ADD Q-039` | ambiguity | preserves unresolved timing | ordinary mutation |

Controls:

- `Commit 3 transitions`
- `Edit proposal`
- `Keep ambiguity as question`
- `Reject proposal`
- `Open constitutional amendment` appears only when a candidate contradicts an invariant.

Copy after capture: `Captured as utt_991. Interpretation pending.`  
Copy after rejection: `Proposal rejected. Source utterance remains.`

## WF-03 — Work / Claim Forest + pheromone overlay

### Frame

| Region | Content |
|---|---|
| left 360 | repository → package → file → symbol/range forest; solid brackets for claims; IDs and modes always visible |
| center | editor/diff/browser embodiment with claim gutter and signal contours |
| right 340 | hard claims section first; advisory signals second; selected source/evidence and coordination actions |
| top tools | claim mode, scope, actor, signal filters, history scrubber, `Signals on/off` |
| bottom 120 | activity topology and fading wakes; accessible tabular alternative |

Hard row:

> `Builder · WRITE · docs/grand-harbor/** · clm_82f · expires 15:30`

Advisory row:

> `Risk · 0.64 · failed exact-head check · emitted by Nemesis · half-life 2h · 43m old`

Visual grammar:

| Meaning | Non-color treatment |
|---|---|
| active claim | solid nested bracket + `CLAIM` label + ID |
| incompatible overlap | double slash seam + `CONFLICT` label |
| actor attention | bounded glow + actor initials/name |
| recent wake | dotted path with timestamp/age |
| risk pheromone | hatched field + source/strength |
| opportunity | radiating dotted marker + `OPPORTUNITY` |

### Claim request drawer

Fields: actor/person and body, intention, repository/ref/head, scope/mode, proposed lease, parent/peer overlaps, compatible/incompatible result, missing authority, signals that influenced the suggestion.

Primary action: `Request WRITE claim for exact scope`.  
Conflict actions: `Narrow scope`, `Ask holder`, `Open Parley`, `Cancel`.

Ghost state:

> **Claim holder has no active body.** `Builder` remains accountable. Claim `clm_82f` is 18m beyond heartbeat threshold; lease expires in 12m.  
> `Start salvage review` — never `Take ownership`.

## WF-04 — Actor continuity / resurrection

### Header

> **Builder**  
> Durable person `agn_7M2F` · Office `Implementation lead` · Harbor identity verified  
> Current body `body_019` · provider B · lease active

Tabs: Commitments · Bodies · Context capsule · Claims and grants · Outcomes · Evidence.

### Lost-body treatment

> **Builder's body stopped. Builder remains accountable.**  
> Last heartbeat 10:42:13. Open: 1 intention · 2 obligations · 3 claims · 1 submitted action. State after event `#18,311` is not observed.

### Resurrection drawer

1. **Runtime:** provider, model/runtime profile, sandbox, expected cost, available capabilities.
2. **Identity proof:** durable person, Harbor binding, actor credential verifier, requested Body lease.
3. **Continuity manifest:** filterable table:

| Item | Disposition | Reason / required check |
|---|---|---|
| Accepted intention | inherited | signed Chartroom revision unchanged |
| GitHub external state | revalidate | body lost after request submission |
| Private scratch chain | unavailable | provider-private state not exportable |
| Office-scoped memory | selectively restored | same office; privacy class permitted |
| Existing permit | unknown | transfer semantics unresolved; cannot exercise |

4. **Gap:** last proven event, capsule digest, unobserved interval, first observation before resume.

Primary action: `Create new Body and resume after checks`. Avoid `Restore session`.

## WF-05 — Exact action review

### Header

> **Action requires authority**  
> Builder requests `UpdatePullRequestBody` on `curiositech/port-daddy#9987`.

### Main content

1. Typed effect: request/actor/body/Harbor/intention IDs, repository and PR, expected current body digest, exact patch/diff, idempotency key, expiry, irreversibility.
2. Predicate table:

| Predicate | State | Evidence |
|---|---|---|
| Actor credential valid | Pass | `agn_7M2F`, verifier epoch 9 |
| Grant covers resource/action | Pass | `grt_44A`, expires 15:42 |
| Expected remote state matches | Pass | observed 8s ago, ETag/digest |
| Protected sections unchanged | Pass | deterministic diff rule 3.1 |
| Execution budget reserved | Pass | `res_21C`, max $0.06 |
| Constitutional impact | Judgment | touches architecture source; operator required |

3. Permit binding preview: policy/schema/entity/resource versions, nonce, observation obligations.
4. Payload before/after in a reviewable diff; secrets are absent.

Actions:

- `Authorize exact action once`
- `Deny and record reason`
- `Revise request` (creates a new ActionIntent)
- `Open governing contract`

### State copy

```text
Permit issued; no external effect observed yet.
Actuator executing; provider admission not yet known.
Provider accepted; waiting for read-after-write observation.
Observed and matched; receipt rcp_910.
Indeterminate: provider may have accepted, but target state could not be observed.
```

## WF-06 — Porthole evidence explorer

### Frame

| Region | Content |
|---|---|
| top | semantic or exact-ID query; assertion and completion policy chips; live/replay watermark |
| left/center | aligned lanes: operator, Chartroom, actors, adjudicator, actuator, embodiment, external state, evaluator |
| right 380 | selected payload, causal parents/children, observer, signature/digest, attachments, accepted/untrusted status |
| bottom | inert replay scrubber, event step, zoom, causal/temporal toggle, accessible table |

Query:

> `Prove the Grand Harbor ledger was published at the reviewed head.`

Result summary:

> **Partial evidence · 7/9 links**  
> Publication was observed, but the published artifact's exact head was not validated and the operator outcome transition is absent. “Published” may be asserted; “validated and accepted” may not.

Each link uses edge vocabulary such as `motivates`, `implements`, `requested`, `authorized`, `effected-by`, `observed-by`, `evaluated-by`, and `supersedes`. Temporal adjacency is a view toggle, not the default causal assertion.

Replay mode removes live action controls and persists `REPLAY — NO LIVE EFFECTS` at the scope bar, canvas, and inspector.

## WF-07 — Parley

### Header

> **Should pheromone state influence AgentMatcher selection?**  
> `par_17` · protocol `evidence-deliberation@1` · Deliberation · linked `GH-T-005`

Role-first strip:

| Protocol role | Bound actor | Harbor | State |
|---|---|---|---|
| Proposer | Builder | Erich's | submitted |
| Challenger | Nemesis | Erich's | requested evidence |
| Historian | Historian | Erich's | supplied prior decision |
| Decision authority | Operator | Erich's | not invoked |

Center: structured acts, literal propositions, cited evidence, delivery and seen states.  
Right: protocol FSM, allowed next acts, timeout, obligation, invalid/late act explanation.

Resolution panel:

> **Agreed:** Pheromones may be an input feature.  
> **Preserved constraint:** They confer no assignment or authority.  
> **Unresolved:** Whether the default matcher enables the feature.  
> **Next:** propose one Chartroom relationship and one experiment; neither is applied yet.

## WF-08 — Relay boundary

### Header

> **Erich's Harbor ⇄ Alice's Harbor**  
> transport encrypted · identities verified · 3 active directional grants · evidence states diverged on 1 request

Two-sided frame:

| Local Harbor | Shared contract strip | Remote Harbor |
|---|---|---|
| local actors/resources/adjudicator | grants, subscriptions, protocol roles, evidence commitments, requests; arrows show direction | disclosed actors/resources and remote assertions |

Incoming card:

> **Alice's Harbor requests a local action.** Run `rfc-proof` at head `5e438c7…`. This is an authenticated request, not local authority.

Actions: `Evaluate under local policy`, `Decline`, `Open Parley`, `Inspect disclosure terms`.

Revocation timeline separately shows local issue, transport send, remote receipt, permit/admission/effect, and local observation. A `diverged` badge never collapses to a generic sync error.

## WF-09 — Budgets and economic authority

Top measures:

- authorized execution ceiling;
- held reservations;
- boundary-observed COGS;
- released reservation;
- delayed/unattributed liability;
- separately: buyer revenue, platform compensation, settlement holds.

Allocation tree:

```text
RevenueReceipt (if applicable)
  → EconomicAuthority
Harbor ExecutionBudget
  → Convoy → intention → actor/office → provider/actuator
  → reservation → observed usage → commit/release
ActionBudget
  → governed commerce effect (separate)
```

Paid invocation contract table:

| Term | Example presentation |
|---|---|
| Buyer price | `$10.00 gross` |
| Max execution COGS | `$8.00 authority ceiling` |
| Retained/platform compensation | `at least $2.00 under policy ep_4` |
| Data | exact fields readable/retained/redacted |
| Evidence | declared receipts/outcome proof |
| Failure/refund | contractual states, not a green/red guess |
| Settlement | pending/held/released/refunded/disputed |

The numeric split is an illustrative policy configuration, not a fixed product promise.

## WF-10 — First vertical slice combined frame

The richest combined view uses:

- **center:** live browser embodiment at exact artifact head;
- **left:** Claim Forest showing Builder and Nemesis scopes plus separately toggleable wakes/risk;
- **right:** selected acceptance requirement and evidence chain;
- **bottom:** synchronized Porthole lanes;
- **activity dock:** Builder resurrected as a new Body; GitHub effect observed; exact-head browser evaluation passed; one unrelated tension remains; reservation settled.

Permitted completion copy:

> **Ready for operator outcome judgment.** Four of four required evidence links are present. One unrelated architecture tension remains open.

Forbidden copy:

> Everything is done.

