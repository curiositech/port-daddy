# Next-Gen Port Daddy Reconciliation — Stage 1

Status: work packet under the ch16 Binder Architect of Record charter, reconciling the 2026-07-06 binder survey against the 2026-07-06 ADR survey; contradictions are classified per ch16 vocabulary, not silently resolved.

## Contradiction Register

Both surveys independently confirm the same zero-th-order finding: the dedicated,
chartered ch16/ch17 cross-corpus sweep has still never run even once (ch17 remains
a 19-line stub; no `binder-aor-log:` note exists in any reachable state). That
absence is *why* the items below survived undetected across two otherwise careful
surveys. This register does not re-litigate that finding; it registers what the
sweep would have caught.

### 1. ADR-0090 is a triple collision, and the binder survey undercounted it — `contradicted`

The binder survey calls 0090 "two different, unrelated ADRs sharing number 0090"
(`0090-database-distribution-and-sync.md` vs `0090-the-harbor.md`) and files it as
a "minor hygiene defect." The ADR survey found a third claimant hiding under a
non-`NNNN-*.md` filename: `pd-adr-090-interactive-session-hook-installer.md` —
which is **Accepted** (shipped), while the other two are both **Proposed**.
Verified independently in this checkout: `docs/adr/{0090-database-distribution-and-sync,0090-the-harbor,pd-adr-090-interactive-session-hook-installer}.md`
all exist today. The binder survey's characterization is therefore **contradicted**
by the more rigorous ADR-survey sweep, not merely incomplete — "minor hygiene
defect" understates a case where an Accepted ADR and two Proposed ADRs are
indistinguishable by number alone.

This is one instance of a systemic, self-diagnosed, never-fixed problem: **12 ADR
numbers collide across 27 files** (independently recomputed here: 91 non-README
files in `docs/adr/`, 76 unique numbers, 3 triples — `0028`, `0086`, `0090` — plus
9 doubles — `0037`, `0039`, `0040`, `0047`, `0051`, `0056`, `0057`, `0087`,
`0088`). The project diagnosed this **twice** and fixed it **zero** times:
`docs/adr/0087-trusted-computing-base-broker.md:8-10` logs an explicit TODO
("Numbering hygiene is itself broken and needs a sweep... `0028` is used by three
files, and `0037/0039/0040/0047/0057/0086` are each used by two... an
administrative renumber is its own task") and `docs/adr/0092-...md:3-6` predicts
the 0090/0091 collision *before* it lands ("If 0092 collides at merge, renumber
this one"). Both self-diagnoses are still unresolved. **Resolution:** Tier 2 per
ch16 — block any implementation chain that cites a bare `ADR-0090` (or any of the
other 11 collision numbers) until it names the file, not just the number; the
administrative renumber sweep itself is a standing, owned, un-dropped task, not a
new discovery.

### 2. Giant Squid Harness has three disagreeing canonical numbers — `contradicted` (new finding, neither survey caught it)

Three ADRs make mutually exclusive claims about which number is the Giant Squid
Harness:

- `docs/adr/0051-port-daddy-harness.md:167` (still live text): *"The files under
  `lib/squid/*` and `bin/pd-hook-*` cite a non-existent ADR-0091... No ADR-0091
  exists on disk. This ADR-0051 **is** the harness ADR... a follow-up should
  reconcile the dangling `ADR-0091` citations to `ADR-0051`."*
- `docs/adr/0090-the-harbor.md:12` says the harness is *"the Giant Squid Harness
  ADR... in review as PR #545, renumbered to 0091"* — and `docs/adr/0091-giant-squid-harness.md`
  **does now exist**, confirmed merged via PR #545 (`gh pr view 545`:
  merged 2026-07-05T10:45:17Z, title "ADR-0091 — The Giant Squid Harness").
- `docs/adr/pd-adr-090-interactive-session-hook-installer.md:9,101` (Status:
  Accepted, i.e. shipped) calls it *"the Giant Squid Harness (pd-adr-092)"* twice
  — but `docs/adr/0092-suggestibility-ladder-and-cloud-coordination-federation.md`
  is a different, unrelated ADR (suggestibility ladder / cloud federation).

Reality has moved *past* ADR-0051's own recommendation rather than executing it:
0091 became real (superseding 0051's "cite 0051 instead" advice), but nobody went
back to update 0051, so it still asserts a now-false premise ("no ADR-0091 exists")
in the tree today. Meanwhile an **Accepted** (shipped) ADR points at a number
(`092`) that was never the harness at all. Classify as: 0051's claim —
`superseded` (by 0091 landing) but the supersession was never written down, so it
reads as live and current; the `pd-adr-090` citation to "092" — `contradicted`,
plainly wrong on current disk state and needs a direct fix, not a judgment call.

### 3. M6 completion: 4/5 vs 5/5 — timing note, not a hard contradiction

The binder survey states M6 is not fully shipped: *"PR #720 (episodic memory) is
still OPEN, mergeable, with a failing `pr-comments-guard` check and 24 review
rounds outstanding."* Re-checked live in this worktree (`gh pr view`, run
2026-07-06 after fetching `origin/main`): all five M6 PRs are now **MERGED** —
#716 (F0-delta contract freeze, merged 15:04:39Z), #719 (blackboard, merged
15:04:39Z), #718 (transcript search, merged 15:36:14Z), #717 (compaction chain,
merged 17:20:23Z), and **#720 (episodic memory, merged 17:58:34Z)** — all times
2026-07-06 UTC. The binder survey's own cited worktree path
(`wf_db70baa6-c59-1`) is a sibling of this one (`wf_db70baa6-c59-6`), spawned from
the same workflow; #720 evidently cleared its failing check and merged *between*
that survey's checkout and this reconciliation's `git fetch`. **This is a timing
artifact, not a factual dispute** — both surveys accurately described the PR at
their respective observation times. No classification action needed beyond
recording the window: M6 was 4/5 as of the binder survey's read, 5/5 as of
2026-07-06T17:58:34Z onward. Any binder chapter still citing "M6 in progress"
after that timestamp should be updated to "M6 shipped."

### 4. ADR-0027 vs ADR-0049 — self-contradicting status claim — `contradicted` (ADR survey finding, confirmed)

Verified directly: `docs/adr/0027-relay-harbor-mesh.md` header reads `Proposed -
2026-05-06` today. `docs/adr/0049-...md:36` asserts *"ADR-0027 (Accepted)
formalized this pivot"* while its own References list (line 303) says *"ADR-0027
(...depends on this, Proposed → Accepted after this lands)"* — one Accepted ADR
claims a dependency is simultaneously already-Accepted and not-yet-Accepted, and
neither claim matches the file on disk. Not mentioned by the binder survey
(out of its chapter scope) but directly relevant to ch16's "shipped versus target
status" contradiction axis. **Resolution:** Tier 1 — record and fix the two
conflicting sentences in 0049 to read "Proposed" until 0027 actually flips.

### 5. Cross-platform/Windows: ch16's own predicted "orphan" is actually a hard `contradicted`

ch16's ambition-archaeology seed list (this chapter, line 192) flags "Cross-platform
and Windows IPC" as underweighted and asks the binder to "say so and name the
later platform gate" — filing it, implicitly, as `orphaned`. The ADR survey
supplies the concrete evidence that escalates this past orphaned: `docs/adr/0004-*.md`
(Accepted) states *"Windows support is out of scope; adding complexity for it is
premature"* while `docs/adr/0016-hardened-cross-platform-ir-*.md` — also **Accepted**,
same "Deep Engineering Revision" batch — specs a full Windows Named Pipe +
SDDL/DACL scheme in depth (and per the ADR survey's Table 3, that design was never
built). Two Accepted ADRs give opposite scope answers to the same product
question. **Reclassify from `orphaned` to `contradicted`**, and flag Tier 3: this
is an operator decision (is Port Daddy Mac/Linux-only, and is 0016 dead weight to
mark `superseded`, or is Windows still a real gate?), not one an agent should
close by picking a side.

### 6. Anchor Protocol — `superseded` in practice, but the ADR status field never caught up

ch16's own archaeology row ("Anchor Protocol economy," line 179) already flags this
as needing "sharper separation" among Harbor Cards/FloatPlans/escrow/receipts —
tentatively `deferred`/`orphaned`. The ADR survey sharpens this to an actual
contradiction: `docs/adr/0014-*.md` (the Anchor Protocol) sits at plain "Accepted
(Deep Engineering Revision)," while its own named adversarial-review sibling,
`0018-*.md`, carries status "Security Review — Active Threat Modeling" and lists
five categories of unmitigated vulnerabilities. Separately, prior-session memory
(`~/coding/port-daddy` MEMORY.md) and the ADR survey both independently note the
shipped mechanism is a simpler, differently-named one (`lib/bonds.ts`), not the
Anchor Protocol as specified. **Classification: `superseded`, undocumented** — the
implementation moved on, but ADR-0014's status field still reads "Accepted" with
no pointer to `lib/bonds.ts` or to 0018's open findings. Tier 2: block any chain
that cites ADR-0014 as a description of shipped behavior until it's re-stamped
`superseded → see lib/bonds.ts` or the security review in 0018 is closed.

### Not yet reconciled (handover for the next pass)

ADR-0025's header/body self-contradiction (Accepted header, "ADR status remains
Proposed" in body — confirmed still present) and ADR-0044/"Accepted, UNBUILT"
(cited by ADR-0090's own text) are real and already well-evidenced by the ADR
survey; they are lower-value to re-derive here and are left as-is pending a fuller
pass. Chapters 21–24 (Automations/Orchestration/Onboarding/Windows, PRs #711–#714)
are open and unmerged — not yet binder material, flagged so headcount doesn't
surprise the next reconciler.

## Prioritized Execution Backlog

- Run the ADR renumbering sweep (12 numbers collide across 27 files, incl. the 0090 triple) — blocks unambiguous citation of any bare ADR-#, self-diagnosed twice in-repo and fixed zero times — depends on: an assigned owner, no code work required.
- Fix Giant Squid Harness ADR cross-references (0051 still claims "no ADR-0091 exists"; pd-adr-090 cites a nonexistent "092") — three ADRs disagree on the harness's canonical number, confusing every future citation — depends on: doc-only edit; PR #545 (ADR-0091) already merged.
- Reconcile roadmap-item counts (135 committed snapshot vs 37 live-DB vs 13 harbor-scoped, 53 scattered .db files found) — no roadmap total is trustworthy until this lands, undermining all prioritization — depends on: ADR-0090 database-distribution-and-sync plus ADR-0044 dark-launch resolver.
- Fix `roadmap upsert`'s default harbor tag, which currently falls back to a per-worktree scratch harbor instead of canonical `port-daddy` — root cause of live-DB fragmentation across 24 harbor tags — depends on: the roadmap-count diagnosis above being accepted.
- Fix the `parseCronInterval()` day-of-week/day-of-month gap — weekly ships (e.g. tenderfoot) silently degrade to ~10min/hourly polling, burning spawn budget unnoticed — depends on: new unit tests covering weekly/monthly cron shapes in fleet-engine.ts.
- Repair two phantom-trigger ships — documentarian's missing `scripts/promote-stable.sh` producer, and developer-onboarding-sentinel's `schedule:daily` misrouted as a literal pub/sub channel — neither can fire automatically today — depends on: a routing fix in `lib/fleet/io-dispatch.ts`'s LEGACY_TRIGGER_KINDS.
- Rewrite ADR-0049's two conflicting sentences about ADR-0027's status to read "Proposed" — the cheapest fix in the register, Tier 1, ready now — depends on: nothing.
- Re-stamp ADR-0014 (Anchor Protocol) as `superseded → see lib/bonds.ts` — blocks any chain citing 0014 as a description of shipped behavior — depends on: a decision on ADR-0018's still-open security-review findings.
- Decide Windows/cross-platform scope (ADR-0004 "out of scope" vs ADR-0016's full Named Pipe/SDDL design, both Accepted) — determines whether 0016 is dead weight or a real gate, and isn't an agent-closable call — depends on: operator decision (Tier 3).
- Merge skill_graft (PR #723) — zero ships can use it today; only `test-author` is queued to adopt it once merged — depends on: PR #723 review completion.
- Unify the three divergent GitHub-output code paths (`github-output.ts` with zero real importers, `outputs/github.ts`, `harbor-pilot.ts`) — the "known consumers" list matches neither the code nor the YAML's own prompt citations — depends on: a `fleet-ast.ts` consumer audit.
- Enforce or remove the `daily_cap_usd` per-ship field — it is unenforced decoration today, since only the shared $8.50/day fleet pool and global spawn-rate caps are real, which misleads anyone reading `pd-fleet.yml` — depends on: cost-tracking hookup in `fleet-engine.ts`.

## Gap List: What "Finished" Actually Requires

### Shipped
- Rust kernel macaroon/custody enforcement (`pd-anchor`) is live-wired into the TS daemon via `koffi`/`dlopen`, not a parallel demo.
- pd-console the app (not just its design) ships real daemon-write mutations, a signed v3.24.1 release artifact, and a visual-proof harness.
- FleetBar is signed, notarized, and now release-gating — a release aborts if FleetBar fails to build.
- Harbor editor P0/P1 proves the CRDT merge algebra correct (Loro, byte-identical multi-replica merge, per-line authorship).

### Emerging
- pd-console's Harbor design-skin is hand-aligned only; the CI diff-gate against the website's token file is still an unbuilt follow-up.
- pd-console's release packaging is real but fragile — v3.24.0 shipped with the console asset missing entirely.
- FleetBar's public download artifact on the marketing site is 2+ months stale versus the actual signed release.
- Harbor editor work has been stalled for 9 days since P1 landed, with no P2 doc and zero forward-motion commits.

### Aspirational
- Mobile and accounts surfaces are genuinely zero code, unchanged since the ADR table was written.
- FleetBar's Swiss-modern skin has zero lines of code behind it — it exists only as a static HTML mockup.
- Harbor editor has no live keystroke editing and no network/transport code anywhere — still read-only on screen.
- Harbor editor's actual "beat Zed" differentiators (claims, real multi-actor sync) remain entirely unbuilt.
