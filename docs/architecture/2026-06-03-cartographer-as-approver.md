# Cartographer as the Durable Approver — Evolution Design

**Status:** PROPOSED — design only, no code in this PR
**Date:** 2026-06-03
**Author:** cartographer sub-agent of the architect (parent: port-daddy:architecture:cartographer-evolution)
**Scope:** docs only. No `routes/cartographer.ts` or `lib/cartographer*` changes. No CLI, schema, or daemon behavior changes in this PR.
**Forcing function:** the operator's vision (memory `project_single_approver_agent`, `project_pd_talent_phonebook`) — make cartography load-bearing roadmap truth and have one agent that **surfaces unresolved decisions upward** instead of letting them rot in markdown.

---

## TL;DR

1. **Cartographer today is a *librarian*, not an *approver*.** It reads curated markdown files plus a tuple stream and renders five HTTP endpoints (roadmap-progress, roadmap-pop, roadmap-release, roadmap-claims, roadmap-claim-link), claims slugs (`/cartographer/roadmap-pop`), and runs a cron prompt every 30 minutes (primary backend `cli:claude-code`) that writes a digest to a `cartographer/INDEX.md` on the `cartographer-state` branch. It is a structured **read of state**, not a generator of operator-facing **questions**.
2. **The operator wants five things cartographer does not yet do** — surface unresolved ambiguities, detect design-gap drift (e.g. two agents drafting contradictory APIs), notice roadmap drift (proposed work with no concrete files), track dropped-but-not-killed drafts, and ping the operator at the right cadence.
3. **Architecture pick: event-driven, not daemon, not cron.** Cartographer earns "durable" by subscribing to the activity stream (commits, sessions, notes, sortie rows, feedback drops, ADR changes), evaluating a small set of detectors after each event, and publishing **Cartographer Questions** — typed tuples in a new `cartographer_questions` table. The existing 30-minute cron stays as a sweeping fallback. No long-lived background JS process; reuse the fleet engine's existing supervised body.
4. **Surfacing UX: one inbox channel + one cockpit panel + one FleetBar badge, all reading the same tuple stream.** Same data, three surfaces; operator gets to choose. PR comments are a stretch goal because they require GitHub webhooks; not for v1.
5. **Cartographer surfaces; release-engineer ships.** Cartographer raises a question and may *block* a PR via the release-engineer's gate; release-engineer never raises a question, only ships. This keeps the soul/body split clean.
6. **Migration in 5 ordered PRs** — table-only PR first, then detectors, then surfaces, then briefing-hook integration, then deprecate the static cron path. Each PR is reversible.

---

## 1. Current state — what cartographer does, and what it doesn't

### What cartographer *does* (the librarian)

**HTTP surface (`routes/cartographer.ts`, ~231 lines):** five endpoints — `GET /cartographer/roadmap-progress`, `POST /cartographer/roadmap-pop`, `POST /cartographer/roadmap-release`, `GET /cartographer/roadmap-claims`, and `POST /cartographer/roadmap-claim-link` — all wrapping `lib/roadmap-progress.ts` and `lib/roadmap-pop.ts`. Read-only, except `roadmap-pop`, `roadmap-release`, and `roadmap-claim-link` which mutate `roadmap_claims`. The file's header comment is explicit: *"Cartographer (the fleet agent) is the only writer. We never mutate `docs/ROADMAP.md`, `IDEAS-TROVE.md`, `DOGFOOD-FEEDBACK.md`, `CURRENT-WORK.md`, or `.cartographer/status.md` from this route."* So the route is a structured *read* over curated markdown files plus a tuple-backed live feedback queue.

**Cron body (`pd-fleet.yml` cartographer block):** scheduled every 30 minutes, primary backend `cli:claude-code` (fallbacks: `cli:codex`, then `cloudflare @cf/qwen/qwen3-30b-a3b-fp8`), singleton, 15-minute timeout. The prompt enumerates 13 sources to read — roadmap docs, recovery hub, `.spark/feedback` drops, the tuple-backed `pd roadmap` / `pd feedback` projection — and then **updates `docs/V4-UNIFIED-ROADMAP.md` in-place** (moving `NEXT→COMPLETE`, flagging stale items, harvesting feedback) and **writes a digest to `cartographer/INDEX.md`** auto-committed to the `cartographer-state` branch. As of the current prompt, cartographer does *not* promote feedback via `pd roadmap promote` or maintain a `.cartographer/status.md` — those are aspirational steps in this design document, not live behavior. (Note: exact line numbers in `pd-fleet.yml` drift as the file evolves; read the file directly rather than relying on line-number references.)

**Soul registration (`lib/actor-roster.ts`):** `id: 'cartographer'`, mailbox `actor:cartographer`, mission *"Maintains roadmap state, recovery ledgers, work-slice evidence, supersession edges, and harvests dogfood feedback."* Owns `roadmap`, `recovery-ledger`, `work-slices`, `cartographer-status`, `feedback-harvest`. So the soul is real — the bodies just don't act on its full mission.

### What cartographer does *not* do (the gap)

Three negative observations from reading the code and the 2026-05-09 findings doc:

**(a) No questions, only assertions.** Every output is a *statement of current state*: "Phase 2 economist 47 days idle." "Phase 4A binary slice active off-main." "34 now-status items curated." There is no place — no table, no channel, no markdown file — where cartographer writes "I don't know whether X." The 2026-05-09 findings doc's "Recommendations for Next Session" section is the closest thing, but it is a flat list inside a recovery markdown file, not a routable durable surface. The Phase 2 economist (Thomas Youle, 47 days idle as of 2026-05-16) is the canonical example: cartographer correctly noticed it stalled, but had no primitive for "block on this until the operator decides" beyond mentioning it in `.cartographer/status.md`, which the operator has to remember to open.

**(b) No drift detectors over agent work.** Cartographer reads the *curated* feedback queue and the *roadmap markdown*. It does not read `sortie_runs`, `session_notes`, or `session_files` claims across worktrees. Two agents could draft contradictory APIs on two branches and cartographer would only notice via downstream signal (a `coordination:inconsistency` event published by some other agent). Watcher entries in `pd-fleet.yml` are wired to publish `coordination:inconsistency` events, but there is no summarizer that consumes them. Any log file that may have accumulated from these events is not on `main` and is not summarized by cartographer. The shape of the problem stands regardless: conflict events are published into a channel and then silently dropped without analysis.

**(c) No memory of dropped drafts.** When an ADR proposal lands in `docs/proposals/` and then gets superseded or forgotten without explicit `Rejected` status, cartographer has no way to surface "this draft has been touched zero times in 30 days and references no shipped code." The operator's complaint about quietly-dropped ADRs is real and exactly this shape. The `.spark/ideas` and `.spark/feedback` raw streams have a harvest discipline ("never edit another agent's raw drop"); proposals and architecture docs do not.

---

## 2. Vision delta — five specific things the operator wants

These are framed against the existing surfaces so each is a buildable contract, not a wish.

### Δ1 — Surface unresolved ambiguities (the "lack of direction" word)

**What's missing:** a place where cartographer writes *"I noticed X and the answer is not in any markdown, ADR, session note, or feedback entry — operator, you must choose."*

**Buildable contract:** a `cartographer_questions` table with columns `(id, posed_at, surface, summary, kind, priority, evidence_json, suggested_options, blocking_slug?, blocking_pr?, resolution_id?, resolved_at?, resolved_by?, resolution_text?)`. Each row is one open question. Two orthogonal fields carry the two concepts:

- **`kind`** — the detector label describing *what type of problem this is*: `design-conflict`, `stale-slug`, `unfulfilled-claim`, `abandoned-claim`, `draft-rot`, `unresolved-ambiguity`. Set by the detector; operator cannot override.
- **`priority`** — the *cadence/surfacing lane*: `blocking`, `needs-decision`, or `fyi`. Set by the detector based on the context, but operator *can* override (see Δ5).

`surface` lets us partition by domain (`roadmap`, `design`, `priority`, `release-policy`, `data-shape`). The `evidence_json` field carries pointers to the git refs / file paths / session ids that triggered the question, so the operator can audit the basis.

**Concrete first example:** "Should Phase 2's pricing function π be operator-defined as a tuple in the daemon, delegated to an economist (Thomas Youle, 47 days idle), or archived as a non-goal?" — three suggested options, evidence = the 2026-03-30 conversation memory + the cartographer status row + the absence of any commit on `lib/pricing/*`. `kind = unresolved-ambiguity`, `priority = blocking` because three downstream cuts (`cost-gated-spawning`, `cost-forecast-alert`, `empirical-model-efficiency-routing`) all depend on π existing.

### Δ2 — Detect design-need gaps (e.g. "two agents drafted contradictory APIs")

**What's missing:** structural detection of *cross-agent contradiction*. Two sortie transcripts producing two PRs against the same symbol with different signatures is a question, not a status.

**Buildable contract:** a periodic (every 5 min via the activity-stream subscription) "conflict scan" that joins `sortie_runs` × `session_files` × `git_branch_diffs` and flags pairs where:
- Two distinct sortie/session origins touch the same file *symbol* (using the existing `lib/symbol-index.ts` tree-sitter index) within a sliding 24-hour window.
- The signatures of the touched symbols diverge (added/removed parameters, return type change).
- Neither branch has merged the other.

For each pair, post a Cartographer Question with `kind = design-conflict`, `priority = blocking`. The question summary names both branches/PRs/sortie ids, the divergent signature, and suggests "consolidate on (a) signature A, (b) signature B, or (c) introduce an adapter."

This is the operationalization of memory `project_single_approver_agent` lines 17–19 ("Does this conflict with another in-flight agent's work? Does it collide with a planned future goal?").

### Δ3 — Notice roadmap drift (proposed work has no concrete files)

**What's missing:** detection of `roadmap_items` (or "Next Cuts" markdown bullets) whose slug has been on the pile for ≥ N days without any commit naming the slug or any file matching the slug's heuristic surface.

**Buildable contract:** every 30 min (the existing cartographer cadence), join `roadmap_items` × `roadmap_claims` × `git log --grep=<slug>`. For each slug:
- If `claimed_at` is `NULL` and `posted_at` is older than 14 days → Cartographer Question `kind = stale-slug`, `priority = needs-decision`, suggested options `(a) keep on pile, (b) move to backlog, (c) kill with rationale`.
- If `claimed_at` is set, `released_at` is set, and `git log --grep=<slug>` returns zero commits → `kind = unfulfilled-claim`, `priority = needs-decision`, suggested options `(a) re-open, (b) close with note 'work did not land', (c) close as superseded by <other slug>`.
- If `claimed_at` is set, `released_at` is `NULL`, claimant session is closed/expired → `kind = abandoned-claim`, `priority = needs-decision` (this composes with the salvage primitive, not duplicates it; the question is whether to *let salvage run* or *retire the slug*).

### Δ4 — Track dropped-but-not-killed drafts (the ADR problem)

**What's missing:** explicit lifecycle for `docs/proposals/*`, `docs/architecture/*`, `docs/adr/*` `Proposed` / `Draft` status. The operator called out "quietly dropped ADRs" and the same disease affects every long-form design doc.

**Buildable contract:** every cartographer cron pass, scan `docs/{proposals,architecture,plans,adr}/` for files where:
- Frontmatter status is `Proposed`, `Draft`, or absent.
- File `mtime` is older than 21 days.
- No git commit in the past 14 days touches the file or references it by basename in the body.
- File is not referenced by any shipped ADR or `roadmap_item`.

For each match, post a Cartographer Question with `kind = draft-rot`, `priority = fyi` (default; escalates to `needs-decision` if the file has a `blocking_slug` set), evidence = git blame summary, suggested options `(a) accept, (b) reject, (c) mark superseded-by, (d) park`. The question contains the file path so a PR with `git mv` or a frontmatter status change can resolve it in one keystroke.

### Δ5 — Ping the operator at the right cadence

**What's missing:** not every change is a question, and not every silence is okay. Two failure modes today: cartographer runs every 30 minutes and emits no upward signal at all (silent for weeks), or — if we naively wire every detector to FleetBar — the operator gets carpet-bombed.

**Buildable contract:** a question-priority lane with three rates:
- **`blocking`** — surface immediately to FleetBar badge + inbox + cockpit. Pages the operator on next look.
- **`needs-decision`** — batched into a *daily digest* at 09:00 local, sent to inbox + cockpit, no FleetBar interrupt.
- **`fyi`** — weekly digest (Mondays 09:00 local), inbox only.

The `priority` lane is set by the detector when it posts the question. Operator can override via `pd cartographer answer <id> --priority needs-decision` (or any of the three lanes). Each question carries a `dedupe_key` (slug + surface) so re-detection updates `evidence_json` instead of spamming a new row.

This realizes memory `feedback_pd_coordination_continuous` ("PD coordination is CONTINUOUS, not just at session start") on the *upward* axis — the operator hears about state changes at the cadence they want, not the rate at which detectors fire.

---

## 3. Architecture — how does cartographer earn "durable"?

The job spec hands three choices:

| Option | Lifecycle | Pros | Cons |
|---|---|---|---|
| **Long-running daemon process** | one extra Node process always running | persistent in-memory caches, fastest reaction | one more failure mode, no supervisor (today PD supervises fleet bodies, not random daemons), 24/7 LLM cost |
| **Periodic cron sortie** (today's design) | wakes every 30 min | simple, supervised, dies cleanly | latency = up to 30 min, no cross-event correlation, expensive prompt rebuild every wake |
| **Event-driven (hook into PD activity stream)** | reacts to specific events, dies between events | bounded cost, low latency, composes with existing pub/sub | requires more event sources to be reliable |

### Recommendation: hybrid, event-driven primary, 30-min cron as sweeper

**Primary path — events.** Cartographer subscribes (via the same `lib/attention.ts` primitive every other agent uses) to four channels:
- `git:committed` — recompute drift detectors on what changed.
- `spawn:completed` — re-scan for conflicting symbol touches.
- `feedback:dropped` — see if the new feedback resolves an existing question (and close it) or implies a new one.
- `roadmap:promoted` — see if the promotion resolves a `stale-slug` question.

On each event, cartographer runs only the detectors relevant to that event (cheap; mostly SQL queries plus one tree-sitter lookup), emits questions, and exits. Each event fires a short-lived spawned run via `pd spawn --backend cli:codex --identity port-daddy:cartographer:event --budget 1 -- "Cartographer event <channel>"` so the work is supervised, budgeted, and transcript-logged.

**Sweeper path — 30-min cron.** The existing cartographer cron keeps running but its prompt is rewritten: instead of "render the roadmap, then update status.md," it becomes "(a) run *all* detectors, picking up anything the event path missed because the daemon was asleep; (b) re-render the digest if it's a new day or new week; (c) update `.cartographer/status.md` only if no event has done it in the past hour." The cron's job is *liveness*, not the main path.

**Why not a long-running daemon process?** PD's whole supervision story (fleet engine, spawned-run records, budget caps, bond escrow) is for bodies that *terminate*. A long-running daemon process bypasses all of that and reintroduces the kind of "what is it doing right now?" opacity the fleet was built to solve. Memory `feedback_never_tsx_daemon` is the project-level rule against side-stepping the binary into a tsx daemon; the same instinct applies here: don't side-step the supervised-body model into an unsupervised cartographer daemon.

**Why the cron stays at all?** Three reasons. (1) Event sources are unreliable — `git:committed` can miss commits made off-fleet (operator typing `git commit` in a non-hooked repo); the cron catches what events missed. (2) Some detectors (Δ3 stale-slug, Δ4 draft-rot) are *aging detectors* — they only fire when wall-clock time crosses a threshold, with no per-event trigger. Cron is the natural lane. (3) Defense in depth.

### What "durable" means concretely

After this design lands:
- The cartographer **actor (soul)** is unchanged — already durable.
- The **state** cartographer cares about lives in two SQLite tables: existing `roadmap_items` + new `cartographer_questions`. Both survive daemon restart.
- The **bodies** are still ephemeral, supervised, budgeted — same fleet contract as everyone else.
- **Durability of *attention*** comes from the question table being the queryable backbone — every detector writes there, every surface reads from there. Lose every body; the questions remain.

---

## 4. Surfacing UX — how cartographer raises a question

One backing table. Three surfaces, all reading the same rows.

### Surface A — Inbox messages

For each new question, `actor:cartographer` posts to `actor:operator` (or a future `actor:approver`) via the existing `agent_inbox` table. Body shape:

```
[cartographer-question #qid]  kind=unresolved-ambiguity  priority=blocking  surface=roadmap
Phase 2 pricing function π is unresolved 47 days after Thomas Youle's
proposal. Three downstream cuts depend on it.

Suggested options:
  (a) define π as a tuple operator-managed in daemon
  (b) re-engage Youle (timeline?)
  (c) archive as non-goal, kill cost-gated-spawning + cost-forecast-alert + empirical-model-efficiency-routing

Evidence: see /cartographer/questions/qid
Resolve: pd cartographer answer qid --option a   (or b/c, or freeform)
```

This is the durable artifact. Inbox messages persist; FleetBar badges and cockpit panels are live views.

### Surface B — Cockpit panel

A new `/cartographer/questions` route (read-only at first) feeds a Cockpit panel: list of open questions grouped by severity, with one-click "Answer" → opens the same `pd cartographer answer` flow.

### Surface C — FleetBar badge

Already-supported pattern: badge count = questions with `priority = blocking` only. Operator clicks → opens the cockpit panel. **No badge** for `needs-decision` or `fyi` — those wait for the daily/weekly digest. This matches memory `feedback_operator_uses_fleetbar_and_cli_not_dashboard` (the operator lives in FleetBar + CLI, so the badge is the primary surface and the CLI verb `pd cartographer questions` is the secondary surface).

### Surface D (stretch, not v1) — PR comments

If the question's `blocking_pr` field is set, cartographer can drop the question as a PR comment via `gh pr comment`. This is the answer to the operator's "review diffs with full-context awareness" line in `project_single_approver_agent`. Stretch because it requires GitHub auth in the fleet body and idempotent comment management; tractable but not v1.

### Why multiple surfaces, not one?

Memory `feedback_pd_coordination_continuous` makes the case explicit: "PD coordination is CONTINUOUS, not just at session start." The operator should hit a cartographer question whenever they look — when they open FleetBar, when they run `pd whoami`, when they check the cockpit, when they read inbox. **The same row visible everywhere is cheaper than three separate question stores and prevents the "wait, did I see this already?" failure mode.**

### Cadence enforcement

The detectors all run. The question's `priority` lane gates which surfaces it reaches:

| Priority | FleetBar badge | Cockpit panel | Inbox message | Digest |
|---|---|---|---|---|
| `blocking` | yes (red dot) | yes | immediate | next digest |
| `needs-decision` | no | yes | next 09:00 digest | next digest |
| `fyi` | no | yes (collapsed by default) | next Monday 09:00 | next digest |

---

## 5. Cartographer vs release-engineer — drawing the line

A parallel architect doc (`docs/architecture/2026-05-31-agent-abstraction-strategy.md`, not yet merged to `main` as of this writing) proposes `release-engineer` as the first canonical persona for the soul/body/sessions model. The split described here is consistent with that framing whether or not the companion doc lands first. There is a real risk of role confusion. Drawn cleanly: <!-- cite-exempt -->

| Role | Verb | Surface it owns | Reads | Writes |
|---|---|---|---|---|
| **Cartographer** | *Surfaces* | `cartographer_questions`, `.cartographer/status.md`, roadmap markdown renders | activity stream, sortie rows, session notes, feedback queue, ADR/proposal files, git log | questions, status snapshots, roadmap render output |
| **Release-engineer** | *Ships* | PRs, branches, CI status, promotion to stable | a PR's diff, CI output, `redteam-review` output, operator's hard-rules | `git push`, `gh pr merge`, `scripts/promote-stable.sh` | <!-- cite-exempt -->

Two crisp rules to maintain the separation:

1. **Cartographer never executes git. Release-engineer never opens a question.** If release-engineer notices a contradiction mid-ship, it *pings cartographer* via `actor:cartographer` inbox, then *waits* for the question to resolve before merging. Cartographer can answer a question that *unblocks* a release-engineer PR, but cartographer doesn't push the merge button.
2. **Cartographer can *block* a PR by posting a question with `blocking_pr: <pr-number>`.** Release-engineer's pre-merge check includes "no open `blocking` cartographer question with my PR number." This is the *teeth* that turn surfacing into approval — the approver vision lives at this intersection.

This split makes the operator's "Single Approver Agent" vision land as **two agents**: cartographer (knows everything, surfaces decisions), release-engineer (knows nothing about strategy, ships PRs). The approver is the *system*, not one persona. Composes with the talent-phonebook vision: `pd whois "this PR"` returns both cartographer (for strategic context) and release-engineer (for shipping mechanics).

---

## 6. Migration path — five ordered PRs

Each PR is reversible, no PR introduces operator-facing breakage, every PR ships green CI before the next starts.

### PR-1 — `cartographer_questions` table, no detectors, no surfaces

**Surface area:** schema migration `migrations/NNN_cartographer_questions.sql`, `lib/cartographer-questions.ts` (CRUD module factory), unit tests, ADR-00NN documenting the contract. <!-- cite-exempt -->

**What ships:** the table, a `Questions` interface, no HTTP routes, no detectors. Existing cartographer cron unchanged.

**Reversible because:** dropping the table is free; no other code reads it yet.

**Test bar:** unit tests for insert / list / resolve / dedupe-by-key. No integration test yet (no detectors firing).

### PR-2 — Read routes + `pd cartographer questions` CLI + cockpit panel (read-only)

**Surface area:** `routes/cartographer.ts` adds `GET /cartographer/questions`, `POST /cartographer/questions/:id/resolve`. New CLI verb `pd cartographer questions [--open|--all] [--severity X]`. New cockpit panel reads the route.

**What ships:** operator can *see* questions and answer them by hand, but no detectors generate them yet. Operator can author a question with `pd cartographer ask "..." --severity blocking` to pilot the surface against synthetic content.

**Reversible because:** routes are read-only over the table; CLI verb is additive; cockpit panel is one component.

**Test bar:** route tests against in-memory daemon, CLI integration tests.

### PR-3 — Detectors Δ3 + Δ4 (the cheap, time-based ones)

**Surface area:** `lib/cartographer-detectors/stale-slug.ts` and `lib/cartographer-detectors/draft-rot.ts`. Each is a pure function `(state) => Question[]`. Wire them into the existing 30-min cartographer cron prompt as a follow-up step. <!-- cite-exempt -->

**What ships:** the two aging-based detectors. The operator starts seeing `stale-slug` and `draft-rot` questions accumulate in the cockpit panel and inbox.

**Reversible because:** detectors are pure functions; remove the call site and they stop running. No event-stream changes yet.

**Test bar:** golden-fixture tests against fake `roadmap_items` and `docs/proposals/` fixtures; each detector has a positive and negative case.

### PR-4 — Event subscription + Δ1, Δ2 detectors + FleetBar badge + digest

**Surface area:** `lib/cartographer-subscriber.ts` (attaches to attention stream), detectors `cartographer-detectors/unresolved-ambiguity.ts` and `conflicting-symbol-edits.ts`. FleetBar reads `/cartographer/questions?severity=blocking`. New `pd cartographer digest` CLI verb. Daily/weekly digest job in `pd-fleet.yml` watchers. <!-- cite-exempt -->

**What ships:** the full vision delta. Event-driven detectors, severity routing, three surfaces backed by one table.

**Reversible because:** event subscription can be unmounted; FleetBar badge falls back to zero gracefully; digest job is one watcher entry.

**Test bar:** integration test spinning up the daemon with a sortie that drops a contradictory symbol edit, asserting a question lands within 60 seconds; FleetBar badge snapshot test.

### PR-5 — Deprecate the static cron *rendering* path; cron becomes a sweeper

**Surface area:** `pd-fleet.yml` cartographer block prompt rewrites. The cron stops re-rendering ROADMAP.md from scratch every 30 min (event-path does that now) and instead only runs aging detectors + liveness checks. `lib/roadmap-render.ts` calls move out of the cron prompt and into a per-event handler triggered by `feedback:dropped` and `roadmap:promoted`.

**What ships:** the cron's job shrinks to a sweeper; expensive operations only happen when they should.

**Reversible because:** if the event-path proves flaky, revert the prompt to PR-3's shape.

**Test bar:** verify ROADMAP.md still gets re-rendered within 60s of a `feedback:dropped` event in integration tests; verify cron pass time drops by 80% on a no-op cycle.

---

## 7. Suggestibility briefing — the integration point (not designed here)

A parallel design effort (branch `design/suggestibility-briefing-spec`, the very branch this worktree forked from) is specifying the per-turn agent briefing pack — the thing each agent reads before acting on a task. **Cartographer questions need to appear in that briefing.**

The integration point is:
- The briefing pack reads `/cartographer/questions?surface=<agent-relevant>&status=open&limit=5`.
- It includes them in a `## Open Cartographer Questions` section near the top, above scope notes.
- Agents are instructed: "if your work touches a surface mentioned in any open question, *first read the question* and either help resolve it or coordinate via `actor:cartographer` before proceeding."

This is the operationalization of memory `project_single_approver_agent` lines 19–22: "Maintain one cohesive vision across all markdowns and all agent chats." The questions table is that vision in queryable form, and the briefing is how every spawned body inherits it. Designing the actual briefing surface is out of scope for *this* doc — but the cartographer side of the contract (the route + the surface filter) lands in PR-2 above, so the briefing design can read from it as soon as PR-2 is in.

---

## 8. Risks + open questions for the operator

### Risks

1. **Question fatigue.** If detectors are too sensitive, the operator gets buried. Mitigation: severity routing (only `blocking` interrupts; rest batched); dedupe keys (rerunning a detector updates a question rather than spawning a new one); per-detector cooldowns.
2. **Cartographer becomes the bottleneck.** Every PR waits on a question. Mitigation: only *cartographer-marked* `blocking` questions gate PRs; release-engineer checks this list, not the broader "any open question" list. Cartographer can downgrade a question's severity at any time.
3. **Question staleness.** A question posted, never answered, sits forever. Mitigation: after 30 days unanswered, cartographer re-evaluates and either escalates the severity (if evidence has accumulated) or auto-closes with `resolution_text: "auto-closed: no operator input in 30 days; re-pose if still relevant"`.
4. **Event source unreliability.** If the daemon misses a `git:committed` event, detectors don't fire. Mitigation: 30-min cron sweeps everything; the event path is for *latency*, the cron path is for *correctness*.
5. **Bleeding cartographer scope into approver.** The operator's "single approver" vision is one agent that gates PRs; this design splits that across cartographer + release-engineer. Risk: operator wanted one agent. Mitigation: open question Q-1 below.

### Open questions for the operator (before code lands)

1. **Soul split or merge?** *The most important question.* Should cartographer absorb the release-engineer role (one approver agent, both surfaces decisions and ships PRs), or should they remain two souls coordinating? **My recommendation: keep them split** because shipping discipline is mostly mechanical and surfacing discipline is mostly judgment, and conflating them risks a release-engineer that hesitates on every push because it's running detectors. But the operator must decide before PR-2 lands.
2. **`actor:operator` mailbox — does it exist yet?** Cartographer needs to send to a stable address. Today, operator interaction is via FleetBar / CLI / cockpit, not an `actor:operator` mailbox. Either we register one, or cartographer's inbox messages go to `actor:cartographer` (self-mailbox) and the operator pulls them via the cockpit panel. Recommendation: register `actor:operator` in `lib/actor-roster.ts` as a special-case "human" actor.
3. **PR-comment surface in v1 or v2?** I deferred PR comments to a stretch. If the operator wants the approver-style PR experience now, that adds GitHub auth + idempotent-comment logic to PR-4. Acceptable; just costs a week.
4. **How aggressive should `draft-rot` be?** 21 days is a guess. Some ADRs are intentionally drafts for months because they're for unresolved questions. The detector itself is a quiet inversion of the problem it's trying to fix — a question may exist *because* a draft is rotting. Recommendation: ship at 21 days, instrument it, halve or double based on the operator's tolerance after 4 weeks.
5. **Backfill questions for the existing 34 now-status items?** Should PR-3 (or PR-4) sweep the current roadmap once at install time and post questions for all matches, or only post for *newly* matching items? Recommendation: opt-in flag, off by default; the operator can run `pd cartographer scan --since 0` to backfill.

---

## 9. Reading list

- `routes/cartographer.ts` — the current shape.
- `lib/roadmap-progress.ts`, `lib/roadmap-pop.ts` — what cartographer reads/writes today.
- `pd-fleet.yml` cartographer block (lines 246–365) — the 30-min cron prompt.
- `lib/actor-roster.ts` — the soul registration.
- `lib/attention.ts` + `routes/attention.ts` — the event-stream primitive PR-4 subscribes to.
- `lib/feedback.ts` + `routes/feedback.ts` — closest existing "surface upward" primitive; cartographer-questions is its strategic-layer cousin.
- `lib/symbol-index.ts` — tree-sitter symbol map; Δ2 conflict detector reads from here.
- `docs/adr/0023-cartographer-roadmap-actor.md`, `docs/adr/0033-roadmap-pop-atomic-claim.md`, `docs/adr/0034-roadmap-claim-session-link.md` — current ADRs for cartographer.
- `docs/architecture/2026-05-31-agent-abstraction-strategy.md` (pending merge to `main`) — soul/body/sessions framing. <!-- cite-exempt -->
- Memory: `project_single_approver_agent.md`, `project_pd_talent_phonebook.md`, `feedback_pd_coordination_continuous.md`, `feedback_dogfood_via_pd_sortie.md`, `feedback_never_tsx_daemon.md`, `feedback_operator_uses_fleetbar_and_cli_not_dashboard.md`.

---

## 10. Closing

Cartographer today reads four files well and renders them into one structured response. That work was the right first move and it should keep working. The next move is to give cartographer **eyes on the agents** (not just the markdown), **a question table** (not just a status file), and **a small severity discipline** (so the operator hears about the right things at the right cadence). With those three additions, the operator's "single approver" vision becomes operational without merging cartographer into release-engineer — cartographer holds the map, release-engineer drives the ship, and the questions table is the chart the captain points at.

The five-PR migration keeps every step reversible and ships value at PR-2 (operator can author questions by hand and start the muscle) before any detector fires. The first real decision — Q-1 above, soul split or merge — is the one that needs to land before PR-2.
