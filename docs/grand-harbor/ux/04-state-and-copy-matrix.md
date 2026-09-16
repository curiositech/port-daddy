# State, copy, and action matrix

**Status:** UX PROPOSAL  
State terms remain contract candidates until ratified. Copy is deliberately more precise than ordinary progress labels.

## Interpretation and intent

| Candidate state | User-facing copy | Available actions | Forbidden implication |
|---|---|---|---|
| Captured | `Captured as utt_991` | inspect source, cancel local interpretation | understood or accepted |
| Interpreting | `Deriving a typed proposal` | inspect source; continue work | model is deciding |
| Proposed | `Interpretation proposed` | commit, edit, keep ambiguity, reject | program changed |
| Ambiguous | `Two materially different interpretations remain` | select/edit, create question, reject | one guess is “best” by default |
| Committed | `3 transitions appended at Chartroom rev 441` | inspect signature/diff, propose successor | universally agreed |
| Rejected | `Proposal rejected; source retained` | retry interpretation, create question | instruction deleted |
| Candidate intention | `Possibility captured; not committed` | accept, park, reject | scheduled work |
| Active | `Accepted intention; currently scheduled` | interrupt, replan, propose fulfillment | outcome complete |
| Interrupted | `Commitment preserved; not advancing` | resume, replan, abandon, supersede | forgotten or cancelled |
| Blocked | `Blocked by grant grt_…` | resolve named blocker | actor is merely idle |
| Fulfillment proposed | `Evidence offered against policy cp_…` | inspect, accept/reject outcome | done |
| Fulfilled | `Outcome accepted under policy cp_…` | inspect evidence, supersede later | permanently correct |

## Actor and Body

| Candidate state | Copy | Safe next action |
|---|---|---|
| Person embodied | `Builder has active Body body_019` | open body/obligations |
| Person unembodied | `Builder remains accountable; no active Body` | start resurrection or reassignment review |
| Body suspected lost | `Heartbeat missing; waiting until 10:44:13` | inspect last event, wait/declare under policy |
| Body lost | `Body lost at event #18,311` | create replacement Body |
| Continuity inherited | `Inherited from signed capsule` | inspect source digest |
| Revalidation required | `External state may have drifted` | observe target |
| Unavailable | `Provider-private state is unavailable` | proceed with explicit gap or stop |
| Unknown | `No evidence establishes whether this transfers` | keep blocked/open policy question |

Avoid `restored` unless the contract defines the exact restored set.

## Governed effect

| State | Exact copy | Primary action |
|---|---|---|
| Draft | `Action request being constructed` | submit immutable request |
| Submitted | `ActionIntent air_901 recorded` | inspect evaluation |
| Evaluating | `Checking legal edge and versioned authority` | cancel request if permitted |
| Awaiting operator | `Exact effect requires your judgment` | authorize once / deny / revise |
| Denied | `No permit issued — [predicate]` | inspect/remediate/new request |
| Permitted | `Permit issued; no effect observed yet` | inspect permit; allow actuator queue |
| Executing | `Actuator admitted permit` | observe; request cancellation if supported |
| Observing | `Effect attempted; checking target state` | wait/inspect raw evidence |
| Succeeded | `Required postconditions observed` | inspect receipt and outcome policy |
| Partial | `2 of 3 postconditions observed` | reconcile or request compensating action |
| Failed | `Effect not admitted` or `Observed mismatch` | inspect/new request |
| Indeterminate | `External effect unknown` | observe before retry |

Do not use `approved` for a permit, because it invites the effect/outcome collapse. Do not use `verified` without naming what was verified and by whom.

## Claim, pheromone, and grant

| Object/state | Copy | Authority reminder |
|---|---|---|
| Claim active | `WRITE claim clm_82f active for exact scope` | coordination ownership, not filesystem capability |
| Claim conflicted | `Incompatible overlap with clm_73a` | no automatic theft or merge |
| Claim stale | `Holder has no live Body; salvage not authorized` | still recorded until transition |
| Pheromone active | `Risk 0.64 · half-life 2h · source Nemesis` | advisory only |
| Pheromone disputed | `Signal disputed; both evidence sets retained` | no aggregate fact |
| Grant offered | `Alice's Harbor offered directional grant` | not active locally |
| Grant active | `Usable under local epoch 8 and remote terms` | every action still locally adjudicated |
| Revocation requested | `Revocation issued; remote receipt pending` | not revoked everywhere |
| Diverged | `Harbors report different grant state` | no implied consensus |

## Evidence

| State | Copy | Meaning |
|---|---|---|
| Proven | `Required chain exists for this exact assertion` | scoped to named policy/artifact |
| Partial | `Missing 2 required links` | names missing links |
| Contradicted | `Evidence conflicts with assertion` | both sides retained |
| Indeterminate | `Evidence cannot resolve assertion` | unknown, not negative |
| Stale | `Evidence addresses head abc, current head def` | cannot satisfy exact-head policy |
| Untrusted | `Observer/provenance not accepted by this Harbor` | remote assertion may still be visible |
| Redacted | `Evidence exists; disclosure contract withholds payload` | commitment metadata stays visible |

## Parley

| State | Copy |
|---|---|
| Draft | `Protocol and disputed proposition not yet opened` |
| Open | `Roles binding; evidence obligations active` |
| Evidence exchange | `3 acts delivered; 2 seen; no agreement implied` |
| Resolved | `Parley resolved; downstream mutations proposed` |
| Impasse | `Closed at impasse; unresolved propositions retained` |
| Timeout | `Deadline elapsed under protocol v1` |
| Protocol violation | `Act invalid for state/role; recovery required` |
| Cancelled | `Cancelled by [authority] for [reason]` |

## Budget and settlement

| State | Copy |
|---|---|
| Estimated | `Estimated COGS $0.11–$0.18` |
| Reserved | `$0.18 execution authority held in res_21C` |
| Boundary-observed | `Credential boundary observed $0.13 usage` |
| Provider-confirmed | `Provider statement confirms $0.13` |
| Delayed/unattributed | `$0.04 usage cannot yet be attributed` |
| Released | `$0.05 unused reservation released` |
| Settlement held | `$10 buyer payment held; outcome evidence pending` |
| Disputed | `Settlement disputed; incurred COGS remains recorded` |

## Action-label rules

Controls name verb, object, scope, and cardinality where risk matters:

- `Authorize UpdatePullRequestBody once`
- `Deny request and record reason`
- `Request WRITE claim for 4 files`
- `Start salvage review for clm_82f`
- `Issue Convoy stop and revocation requests`
- `Commit 3 Chartroom transitions`

Avoid generic `OK`, `Confirm`, `Sync`, `Restore`, `Approve`, `Resolve`, and `Done`.

