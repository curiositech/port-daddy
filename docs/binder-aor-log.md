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

## 2026-09-08 — first mechanized coverage run: the binder enters its own framework

binder-aor-log: 2026-09-08T10:55Z | window 2026-08-23T17:02Z..now |
documents scanned: 30 | capabilities: 0/94 owner+gate+evidence complete |
contradictions: 1/4 resolved (CR-1, CR-2, CR-3 open) | ambitions classified:
0/36 | coverage axes: 0/3 complete | confidence: 0/100 | handover: the
ambition sweep chapter 17 reserves, then owners for the 24 ungated chapters.

### What this run did that prior runs did not

Every prior entry, including 2026-08-23's, reconciled specific claims by hand.
None produced a `binder-coverage-spec`, so `binder_coverage_audit.mjs` had
never been run against this binder at all: the framework had a schema and a
scorer, and the binder had never been through either. This run closes that.

`scripts/binder/build_coverage_spec.mjs` reads the binder every run and emits
`binder-coverage-spec.json`. It is a generator, not a hand-typed file, because
the binder grows: it has gone from 17 documents to 30, and a spec typed once
would have reported a clean binder while a third of it went unread.

**Score: 0/100, pass: false, 136 critical findings.** That is the honest state,
not a failure of the run. The findings:

**94 capabilities without owner + gate + evidence (of 94).** Not one claimed
capability in the binder carries all three. 69 have a gate but no owner and no
evidence link; 4 have none of the three; 1 lacks only an owner.

**23 of 30 documents contain no acceptance gate at all.** The 70 gates in the
binder live in seven documents (00, 07, 12, 13, 15, 18, 19). The chapters with
none are the substance: 01 product and surfaces, 02 runtime authority, 03 agent
contract, 04 context/memory/skills, 05 governance, 06 security/privacy/billing,
09 data model and API, 10 operator control panel, 14 work intake, and every
chapter from 20 to 28. The binder's planning and review chapters are gated; the
chapters that say what the product *is* are not.

**36 ambition families unclassified (of 36).** The sweep chapter 17 reserves
("Status: pending Harbor Architect of Record baseline run") has still not run.
Every entry in the baseline work packet's corpus — the V4 plans, the ideas
trove, the shipwright vision, the north-star research, the website data
modules, the examples — sits at `classification: null`, which the framework
names accidental amnesia and never a valid resting state.

**3 of 4 contradictions still open.** CR-1 and CR-2 (shipped-vs-target: the
pd-console control buttons POST to a contract with no counterparty; the live
interrupt route is lease-less against the control-gate doctrine) and CR-3
(authority: no single system of record for the roadmap) were recorded on
2026-07-10 and are unresolved two months later. CR-4 is closed.

**All 3 coverage axes incomplete.** Chapter 16 names 10 customer types, 15
technical contingencies and 10 architecture axes, each needing six answers.
None of the three matrices has been filled. The booleans are read from
`coverage-matrix.json`, which does not exist, so they cannot be hand-set to
true in the spec to make a run pass.

### A defect in this run's own tooling, found and fixed before it shipped

The first generated spec reported "contradictions: 4/4 resolved" on a binder
with three open ones. The extractor tested `/resolved/i` against the register's
state text, and "unresolved" contains "resolved". That is coverage theater
produced by the instrument meant to detect it. The test is now anchored
(`/^resolved\b/i`) and the three open contradictions surface correctly. Worth
recording rather than quietly fixing: a checker that fails open is worse than
no checker, because it certifies.

### The universe the binder claims to cover has drifted from the binder

`work-packets/harbor-architect-baseline-ambition-archaeology.md` lists chapters
01 through 17 as required reading. Twelve documents that exist today are outside
that declared universe: **00** — the PRD, roadmap and test plan, the chapter a
completeness sweep most needs — and **18 through 28** (build prescription,
operator surface triad, design system, automations, orchestration, onboarding,
cross-platform, the two runtime-refactor chapters, context/memory wiring, and
postmaster). The packet has not been revised as the binder grew, so the baseline
run it specifies would, if executed literally, miss 40 per cent of the binder.

This is not a finding against any chapter's text. It is a finding against the
sweep's own scope, and it has to be fixed before the sweep runs, or the sweep
will certify a universe smaller than the binder.

### Escalation

Tier: record, not block. Nothing here is a new defect in the product; it is the
binder's accumulated distance from its own completeness standard, now measured
instead of asserted. No chapter was patched by this run — the run's output is
the measurement and this entry.

Operator decision requested (one): the ambition sweep is 36 families across
plans, research, website data and examples. It is a substantial pass and its
output is chapter 17. It has been pending since the binder was written. Either
it gets scheduled, or chapter 17's reservation should be withdrawn and the
promise struck, because a chapter that has said "pending" since inception is
itself an unclassified ambition.

### Evidence

- `node scripts/binder/build_coverage_spec.mjs` → 30 documents, 94 capabilities
  (70 gated, 24 ungated), 4 contradictions, 36 ambition families.
- `binder_coverage_audit.mjs` on that spec → `pass:false score:0`, 136 findings:
  94 `capability-without-owner-gate-evidence`, 36 `ambition-unclassified`,
  3 `coverage-axis-incomplete`, 3 `unresolved-contradiction`.
- Gate census, per document, by `grep -cE '^ *(Gate|Acceptance gates?|Human gate|Proof gate):'` — 7 documents carry all 70.
- `comm -13` of the work packet's required-reading chapter list against the
  binder's actual chapter files — 12 documents outside the declared universe.
