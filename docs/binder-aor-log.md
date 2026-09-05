# Binder Architect of Record — Ledger

Status: append-only ledger of Harbor Architect of Record runs.

## Convention

`docs/architecture/agent-harbor-technical-binder/16-binder-architect-of-record.md`
defines the Harbor Architect of Record role and requires a `binder-aor-log:`
entry after every run, "even ALL QUIET." Its "State surfaces" section names the
operator-visible ledger as append-only `pd note` entries carrying that prefix —
an external note system, not a git file. In practice, no `pd note
"binder-aor-log: ..."` text has ever landed as a git-tracked artifact on
`main`: the only prior trace is a parenthetical in
`17-ambition-archaeology-consistency-proposals.md` ("Interim contradiction
register: state-plane wave 1 (2026-07-10)") that references *a* ledger note by
date without reproducing its text, and a 2026-07-06 work-packet
(`work-packets/2026-07-06-next-gen-reconciliation.md`) that independently
confirms: **"no `binder-aor-log:` note exists in any reachable state."** No
`docs/binder-aor-log.md` file existed on `main` before this entry — confirmed
by `git log --all -- docs/binder-aor-log.md` (no history) and
`git show origin/main:docs/binder-aor-log.md` (path does not exist) at run
time.

This file is that missing log location, created per ch16's mandate and the
Architect of Record run instructions: the binder itself exists (chapters
00–27 are live on `main`), so this is not a "binder does not exist" case —
it is a "the log was never committed anywhere" case. Each run appends one
entry below, oldest first. Do not edit or delete a prior entry; append only.
If a future run migrates the ledger to a first-class table (ch16's own
"Known gaps" anticipates this), leave this file as the historical record and
link forward from here.

---

## Entry 1 — 2026-08-23

```text
pd note "binder-aor-log: 2026-08-23T17:02:06Z | window 2026-07-10 (interim register in ch17, text not recoverable in git)..2026-08-23T17:02:06Z |
chapters scanned: README.md, 16-binder-architect-of-record.md, 17-ambition-archaeology-consistency-proposals.md (full read); 00, 07, 18, 24 (targeted grep, no full read) |
source corpus scanned: docs/adr/adr-numbering-registry.json, docs/roadmap/roadmap.snapshot.json, docs/architecture/agent-harbor-technical-binder/work-packets/2026-07-06-next-gen-reconciliation.md, docs/architecture/agent-harbor-technical-binder/work-packets/harbor-architect-baseline-ambition-archaeology.md, branch claude/mandatory-harbors-adr (docs/adr/0128-mandatory-harbors.md), branch claude/port-daddy-ios-server-fna9dy (docs/adr/0122..0126), branch claude/purser-instrument-integrity, branch purser/pr-9639-tests, PRs #7279 #9639 #9667 #9764 (GitHub API, full bodies + merge state) |
ambitions classified: NONE THIS RUN — scoped reconcile, not a baseline archaeology sweep; ch17's baseline pass status is unchanged (still 52 lines, still \"pending Harbor Architect of Record baseline run\", still zero ambition-corpus rows classified) |
contradictions: 0 found in binder text on main; 3 checked-and-confirmed-absent (see findings) |
coverage gaps: not assessed this run (out of scope; see honestGaps) |
proof gates changed: NONE — no binder chapter edited, no capability marked, no section blocked |
operator decisions: NONE required by this run's findings |
confidence: 0.62 (high confidence in the 3 targeted checks below, verified against git + live PR state; low confidence the binder has no OTHER contradictions, since this run did not execute the full reconcile loop -- see honestGaps) |
handover: next run should (1) execute the full baseline archaeology pass ch17 has awaited since at least 2026-07-06, (2) re-run this entry's 3 checks once any of #7279/#9639-into-main/#9667/#9764 actually merges to main, since a merge is exactly the event that would turn today's ALL QUIET into a real contradiction if the binder is not updated in the same wave, (3) chase down whether the 2026-07-10 pd note's full text is recoverable from an external note store, since only its 4 finding summaries (CR-1..CR-4) survive in ch17 prose"
```

### Why the window start is fuzzy

Chapter 16 says: reconcile from the last `binder-aor-log:` entry, or from the
beginning if none exists. Neither is exactly true here. A ledger entry is
referenced — dated 2026-07-10, described in
`17-ambition-archaeology-consistency-proposals.md` as recording four findings
(CR-1 through CR-4) during a "state-plane wave-1 dispatch" — but its full text
was never committed to git in any reachable ref (checked: `git log --all
--oneline --grep="binder-aor-log"` returns exactly one commit, `c67267dce`,
and that commit's diff is the ch17 prose paragraph itself, not a `pd note`
payload). Treating 2026-07-10 as the window start is the closest honest
reading of "last entry" available from git; it is not a claim that the
window is precisely bounded.

### Task scope

This entry is a **scoped reconcile**, run against this week's three named
decisions (ADR-0128 acceptance, ADR-0122–0126 unmerged, WS-H retirement
merged to a non-`main` base, purser gate fix in flight) — not the full ch16
reconcile loop (contradiction sweep across all axes, ambition archaeology,
coverage-matrix update). Those remain undone; see honestGaps in the digest.

### Findings

**F1 — WS-H retirements are NOT claimed done on `main`, and should not be
(CONFIRMED, no fix needed).**
`git grep -niE "ws-h" origin/main -- docs/` and a repo-wide
`git grep -lniE "ws-h"` on `main` return no hits in any binder chapter, any
roadmap doc, or any other doc that could be read as a shipped claim (the only
matches anywhere in the tree are an unrelated Windows/WSL2 mention in ch24 and
an unrelated skill reference-map hit). Verified independently via the GitHub
API: PR #9639 ("docs(ws-h): retire four superseded plans...") shows
`"merged": true` but `"base": {"ref": "purser/pr-9639-tests"}` — it merged
into a purser test branch, not `main`. That test branch
(`purser/pr-9639-tests`) is itself downstream of `claude/port-daddy-ios-server-fna9dy`
(PR #7279, open, unmerged, `mergeable_state: "blocked"`) — confirmed by
`git merge-base origin/purser/pr-9639-tests origin/claude/port-daddy-ios-server-fna9dy`
== the branch-point commit, and
`git merge-base --is-ancestor origin/claude/port-daddy-ios-server-fna9dy origin/purser/pr-9639-tests`
== true. `main` itself tops out at ADR-0120
(`docs/adr/adr-numbering-registry.json` on `main`: `counts.live = 99`, max
registry key `120`), so none of ADR-0122–0126, which the retirement banners
cite by path, are even present on `main` yet — the retirement PR could not
have safely merged to `main` even if someone tried. No chapter needed
patching because none makes the claim.

**F2 — the purser gate is NOT described as assertion-backed anywhere in the
binder on `main` (CONFIRMED, no fix needed).**
`git grep -niE "purser" origin/main -- docs/architecture/agent-harbor-technical-binder/`
returns zero hits — the binder chapters do not mention the purser gate at
all, so there is no stale "assertion-backed" characterization to correct.
The fix itself (PR #9764, "fix(fleet): purser instrument integrity + citation
audit for every fleet emitter", commits `59be11d41` + `bef8f3eab`) is
open, unmerged, `mergeable_state: "blocked"`, base `main`. Its own body is the
most precise account of the defect it fixes: measured across one 24h window,
the purser BLOCKed 4 of 5 reviewed PRs (#9224, #9333, #9639, #9730) with "not
one block... backed by an assertion that executed against the reviewed code"
— exit-code-only verdicts conflated "suite failed to load" with "suite's
assertions failed." That defect is real and current (unfixed on `main` as of
this run), which is exactly why no binder chapter should describe the gate as
assertion-backed today — and none does.

**F3 — mandatory harbors is not described as an encryption change anywhere on
`main` (CONFIRMED, no fix needed) — and ADR-0128 itself pre-empts the
misreading.**
`git grep -niE "mandatory harbor" origin/main -- docs/ website-v2/` returns
zero hits — "mandatory harbors" as a concept has not yet landed in any
committed doc on `main`, so there is nothing to mischaracterize. ADR-0128
(`docs/adr/0128-mandatory-harbors.md` — not yet shipped to `main`; it lives
on branch `claude/mandatory-harbors-adr`,
PR #9667, open, `mergeable_state: "clean"`, based on the also-unmerged
`claude/port-daddy-ios-server-fna9dy`) is now `Status: Accepted — Option A,
decided by the operator 2026-08-23`, and its Decision section states the
boundary explicitly, in anticipation of exactly this drift: *"This is not an
encryption change... Any surface that describes auto-created harbors as
'encrypting your data' is misdescribing this ADR."* The ADR's own Context
section names the mechanism it is guarding against: *"the Context predicted
exactly this drift and it had already begun (fleet comments were describing
the recommendation as the decision)"* per the acceptance commit message
(`158126b21`). **Forward-looking, not a finding against current text:** when
ADR-0128 and the mandatory-harbors implementation eventually land on `main`
and the binder is updated to describe them (product surfaces chapter,
security/privacy chapter, or wherever "harbor creation" gets documented),
that update must carry ADR-0128's two boundaries — not an encryption claim,
and local at-rest encryption scope stays a separate undecided question. The
next Architect of Record run after that merge should check this specifically.

### Evidence

- `git grep -niE "ws-h|purser" origin/main -- docs/architecture/agent-harbor-technical-binder/` — 0 hits, confirming F1/F2.
- `git grep -niE "mandatory harbor" origin/main -- docs/ website-v2/` — 0 hits, confirming F3.
- `docs/adr/adr-numbering-registry.json` on `origin/main` — `counts.live: 99`, max key `120`.
- GitHub API `pull_request_read` on #7279, #9639, #9667, #9764 (`curiositech/port-daddy`) — full bodies and merge/base state read live at run time (2026-08-23T17:02Z), not recalled.
- `git merge-base` / `git merge-base --is-ancestor` across `origin/main`, `origin/purser/pr-9639-tests`, `origin/claude/port-daddy-ios-server-fna9dy` — confirms the WS-H merge landed downstream of an unmerged PR, not on `main`.
- `docs/adr/0128-mandatory-harbors.md` at `origin/claude/mandatory-harbors-adr` (not yet shipped to `main` — that is this finding's point) — full text read; Decision section quoted directly above.

---

## Entry 2 — 2026-09-04

Tracking issue: [#10038 — Agent Harbor binder truth log](https://github.com/curiositech/port-daddy/issues/10038).

```text
pd note "binder-aor-log: 2026-09-05T05:55:35Z | window 2026-08-23T17:02:06Z..2026-09-05T05:55:35Z | chapters scanned: README, 00, 05, 06, 13, 16, 29 candidate | source corpus scanned: ADR-0022/0122/0124/0134/0136, in-flight ADR-0135 and PRs #6786 #9822 #9914 #9970 #9989 #9992 #9995 #9997 #10013, local roadmap records | ambitions classified: absorbed 4, deferred 2, superseded 1 | contradictions: 1 Tier-2 schema/ordering contradiction on main; resolution candidate in this change | coverage gaps: 6 explicit operator/architecture decisions | proof gates changed: PH-01..PH-07 and F0/M1/M4 contract gates | operator decisions: confidential execution, leakage policy, provider observation, commercial settlement, publisher admission/revocation, Chartroom cutover | confidence: 0.88; repository and live PR state verified, installed/runtime proof not inferred | handover: reconcile this chapter and evidence vocabulary into ADR-0135 before either PR merges; refresh exact PR heads and close the main contradiction only after merge"
```

### Task scope

This is a scoped reconciliation of the Porthole/Grand Harbor architecture and
its directly related active work, not the overdue full-corpus baseline sweep.
It changes only binder, AOR-ledger and changelog surfaces. It does not edit the
in-flight ADR-0135, Porthole schemas/runtime, the separately staged Grand Harbor
product-atlas draft, roadmap snapshots, native capture app, Sugar runtime,
Chartroom kernel, retrieval design, or blind-session implementation.

### Contradiction list

| Kind | Contradiction | Tier | Candidate resolution | Main status |
| --- | --- | --- | --- | --- |
| `schema` | Binder 00 placed cooperation after transcript/control truth and omitted PortholeStage/BodyAdapter/ControlLease/evidence classes from F0, while in-flight ADR-0135 makes the live stage foundational and explicitly forbids recorder-first sequencing | 2 | Chapter 29 owns the binder integration; binder 00 moves the contract into F0 and PH-01 into the immediate local vertical slice; chapter 05 makes advanced cooperation later over that substrate | unresolved until this change and ADR-0135 are reconciled and merged |

The intended resolution does not reorder every later product. Full remote
stages, device breadth, marketplace UX, confidential execution and full Harbor
Editor collaboration remain phased. Their shared identity, capability,
session, evidence, gap and disclosure contracts do not.

### Coverage matrix update

#### Customer and deployment axis

| Customer or deployment | Owner | Status | Gate | Failure mode | Recovery | Source |
| --- | --- | --- | --- | --- | --- | --- |
| Solo local operator | Porthole program | partial across separate PRs | PH-01 | capture starts late, wrong target, silent gap, or decorative control | block action until capture-ready; revoke lease; record gap/unavailable | chapter 29; ADR-0135; PRs #9970/#10013/#9992 |
| Local cooperative team | Porthole + Agent Harbor | target | PH-01/PH-06 | presence treated as authority or participants receive unequal hidden state | signed capabilities, one explicit lease per uninstrumented target, per-Body observation receipts | chapter 29 |
| Multiplayer browser/app testing | Porthole adapter owner | target | PH-02 | browser content instructs authority, anchor drifts, or a candidate test lacks an oracle | treat content as data, re-resolve versioned anchor, refuse unsupported oracle | chapter 29; ADR-0135 |
| Remote participant/device | Remote Porthole owner | deferred | ADR-0135 Phase 6 plus PH-01 prerequisites | realtime disconnect or E2EE confused with durable evidence/authorization | local producing witness, per-participant observation receipt, explicit reconnect gap | chapter 29; ADR-0135 |
| Customer renting capability | Security/capability owner | target/partial substrate | PH-04 | customer data egress or receipt leaks secret input | default-deny egress, typed output, separate disclosure grant, privacy-preserving receipt | chapter 29; PRs #6786/#9822 |
| Provider protecting skill/model | Security/capability owner plus operator decision | deferred strongest claim | PH-05 | customer-controlled host extracts implementation; output becomes extraction oracle | honest unavailable label or attested confidential execution with bounded output/query policy | chapter 29; PR #6786 |

#### Technical contingency axis

| Contingency | Owner | Status | Gate | Failure mode | Recovery | Source |
| --- | --- | --- | --- | --- | --- | --- |
| Required modality absent | BodyAdapter owner | target contract | PH-06 | transcript or composite masquerades as pixels/DOM/AX | `unavailable` plus expected modality/reason; no promotion | chapter 29 |
| Target/focus changes | BodyAdapter and control authority | active target work | PH-01 | queued input reaches another window/secure field | atomically revalidate generation and revoke/discard | ADR-0135; PR #9992 |
| Realtime transport loss | Porthole transport owner | target | PH-01 then remote Phase 6 | missed presence mistaken for missed durable effects, or vice versa | separate lossy/reliable/durable lanes and append explicit gaps | chapter 29; ADR-0135 |
| Evidence store crash/contention | Porthole contract owner | active gate | PR #10013 exact-head gates | committed event outlives or ambiguously binds ciphertext | fail closed, dedicated pinned evidence blobs, crash/contention tests | PRs #9970/#10013 |
| Capability replay/overreach | Security/capability owner | active substrate | PH-04 plus one-use capability gates | expired/replayed/broader grant authorizes effect | signed attenuation, nonce/TTL/audience/resource binding, atomic spend/revocation | chapter 29; PR #9822 |
| Output exfiltration/model extraction | Security/capability owner plus operator decision | residual risk | PH-04/PH-05 | secrets encoded in allowed output or capability behavior extracted by queries | typed output, denial, bounded queries/rates, inspection, attestation where selected, residual-risk disclosure | chapter 29; PR #6786 |

#### Architecture consistency axis

| Axis | Owner | Status | Gate | Failure mode | Recovery | Source |
| --- | --- | --- | --- | --- | --- | --- |
| Terms | Harbor Architect of Record | candidate aligned | F0/PH-06 | Body, Anode, BodyAdapter, Porthole and Parley collapse into aliases | canonical definitions and protocol-independence test | binder README/00/05/29 |
| Authority | Harbor/Chartroom and Porthole owners | explicit target boundary | PH-01/PH-03 | evidence or search authorizes institutional transition; room presence authorizes input | Grand Harbor acceptance policy, signed capabilities and ControlLease, local authority until cutover | ADR-0122; chapter 29; PR #9989 |
| Epistemic schema | Porthole contract owner | target; owner must reconcile into ADR/schema | PH-06 | projections silently promote reported/inferred/unavailable | closed EvidenceClass and lineage-preserving projections | chapter 29; PRs #9970/#10013 |
| Shipped versus target | Harbor Architect of Record and PR owners | explicit | exact-head/runtime/visual/installed/acceptance witnesses remain separate | active PR or synthetic media described as deployed cooperative capture | implementation/evidence map and unavailable labels | chapter 29 |

### Ambition archaeology table

| Ambition family | Classification | Source | Destination | Rationale |
| --- | --- | --- | --- | --- |
| Porthole live cooperative body | `absorbed` | referenced design; ADR-0135 | chapter 29 and PH-01 | foundational live-to-history contract |
| Cooperative coding and multiplayer testing | `absorbed` | referenced design; binder 05; ADR-0135 | chapters 05/29 and PH-01/PH-02 | same bodies, perspectives and control boundary |
| Live Fleet Portholes | `absorbed` | referenced design; ADR-0135 active-body roster | chapter 29 and PH-03 | status/deep-link surface, not a second stage runtime |
| Private data plus rented skill/agent/model | `absorbed` | referenced design; PRs #6786/#9822 | chapter 29 and PH-04/PH-05 | contract now; marketplace product later |
| Hardware-backed mutual confidentiality | `deferred` | referenced design; PR #6786 residual-risk statement | chapter 29 unresolved decisions | named substrate and policy require operator/security selection |
| Remote/mobile/device breadth | `deferred` | ADR-0135 phases 6/8 | chapter 29/ADR-0135 | depends on exact-target local and live-session gates |
| Porthole defined by Parley replay | `superseded` | binder 05; ADR-0135 | chapter 29 protocol-independence rule | Sugar/Parley remains useful as one protocol over bodies |

### Proof gates changed

- Added PH-01 through PH-07 for local live-to-history, multiplayer tests, live
  Fleet, rented capability, mutual-secrecy honesty, epistemic downgrade, and
  Sugar/Parley independence.
- Expanded F0 with the live body, capability, evidence-class, completeness and
  disclosure contract.
- Changed M1 from transcript-only truth to perspective truth and made PH-01 a
  hard part of M4 rather than deferring the live substrate to M8.

### Operator decisions requested

The six decisions in chapter 29 remain open: confidential-computing/attestation
substrate; leakage and query policy; provider observation rights; commercial
license/settlement/dispute rules; publisher-key and execution-measurement
admission/revocation; and the exact Chartroom authority cutover/import gate.
The binder records the alternatives and honest unavailable states without
choosing them.

### Handover

Before either the binder candidate or ADR-0135 merges, the PR owners should
reconcile the closed epistemic vocabulary, `BodyAdapter`, live Fleet references,
governed invocation receipts, and non-exfiltration honesty into the ADR/schema
lane without copying the whole binder chapter. Refresh exact PR heads because
#9970 is dirty and #10013/#9992/#9989/#9995 are blocked or draft. Close the
Tier-2 contradiction only after the final merge state is verified.
