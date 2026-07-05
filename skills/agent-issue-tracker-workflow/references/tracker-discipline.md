# Tracker Discipline

Use this when deciding whether to pull, refine, or file a tracker item, and when deciding whether a status transition is honest.

## The tracker outranks the chat

The tracker (Jira, Linear, GitHub Issues, or port-daddy's own roadmap store) is the shared source of truth for *what* to do and the legible record of *what happened*, for both humans and other agents. GitHub Copilot's cloud coding agent is built on this premise directly: you assign it an issue or a PR, it works from that item's description and acceptance criteria, and the resulting pull request is itself becoming the work receipt reviewers trust — not the chat transcript that produced it. Treat every tracker item the same way: as an assignment with a stop condition, not a suggestion.

Corollary: an agent should not invent work the tracker doesn't know about. If you find yourself doing something not traceable to an item, either it belongs under an existing item's stated scope, or it needs its own item filed first (see "Capturing spawned work" below) — never both invisible and in-flight at once.

## Pull the right next item, don't grab the loudest one

Before starting anything:

1. **Read for priority + dependencies**, not just recency. An item with unmet dependencies (blocked by another open item, waiting on a stale integration) is not "next" even if it is P0 — pulling it produces stalled, half-finished work that looks like progress and isn't.
2. **Read the acceptance criteria before starting**, not after. If an item has none, that is the first problem to fix — see "Actionable items" below — not something to defer to the PR description.
3. **Prefer the smallest coherent slice.** A tracker item scoped to "rewrite the auth system" cannot produce an honest `done`; split it or push back before starting.

## Search before creating — every time

Filing a duplicate issue is not a minor inconvenience; it fragments discussion, invites two agents (or an agent and a human) to do the same work in parallel, and leaves stale links once one copy is closed. The discipline:

- Search the tracker for the problem, not just the proposed fix — "upload retries fail intermittently" and "add exponential backoff to uploader" may be the same underlying item.
- Check both open AND recently-closed items; a "duplicate" of something closed as won't-fix or superseded is a signal to read why, not to re-file blind.
- Record that the search happened (`dedupeSearched: true` in this skill's audit shape) even when nothing turns up — an unrecorded search is indistinguishable from a skipped one to anyone reviewing the trail later.
- If you find a near-match that isn't quite the same scope, link to it explicitly in the new item's description rather than filing in silence — this is what lets a future search actually work.

Do NOT implement duplicate detection as keyword/substring matching over titles — recall is catastrophic (synonyms, rephrasing, different components named for the same symptom). Read the top candidates a normal tracker search or the tracker's own similarity feature returns, and judge by hand.

## Actionable items: what "well-written" means

An item is actionable when someone who has never seen the conversation that produced it could pick it up cold. That requires, at minimum:

| Element | Bad | Good |
| --- | --- | --- |
| Scope | "Fix the uploader" | "Fix upload retry so a transient 503 from S3 retries with backoff instead of failing the whole batch" |
| Reproduction/context | "Users report failures" | Steps, a log excerpt, or a link to the failing run; enough that the next reader doesn't have to ask "wait, what's actually broken?" |
| Acceptance criteria | "Should work now" | "`pytest tests/test_uploader.py::test_retries_on_503` passes; a manual retry against the staging bucket succeeds twice in a row" |
| Stop condition | (implicit / vibes) | The exact command or observable behavior that means done — see `agent-work-receipt-designer`'s `stopCondition` field, which is the same idea applied to the receipt instead of the item |

A vague acceptance criterion is the earliest signal the eventual "done" transition will be status theater (see below) — fix it at filing time, not at review time.

## Honest status transitions

Status is a public claim. Treat each transition as something another agent or a human will act on without re-verifying:

| Transition | What must be true before you make it |
| --- | --- |
| `todo -> in-progress` | You have actually started: a branch exists, or you're actively reading/editing. Do not flip this the moment you glance at the item. |
| `in-progress -> done` | The acceptance criteria are met AND there is validated evidence a reviewer can open (a PR, a passing CI run, a captured test artifact) — not the agent's own narration that it works. |
| `in-progress -> todo` (unblock/park) | State why explicitly (blocked on X, deprioritized) so the next picker-upper doesn't repeat your discovery work. |
| any -> `done` without evidence | Never. If you cannot produce a `ref` a reviewer can open, the transition is not `done`, it is a claim. |

"Status theater" — moving an item forward because it *feels* finished, or because leaving it `in-progress` feels unproductive — is the single most corrosive habit in tracker discipline: it trains every downstream reader (human or agent) to stop trusting the tracker, at which point the tracker stops being the source of truth and everyone reverts to asking in chat, which is the exact failure this discipline exists to prevent.

## Communicate economically

- Batch updates: one comment when you start with your plan, one when you finish with evidence, not a play-by-play of every file you opened.
- Never comment-spam a bot's or reviewer's thread with "still working on it" pings that carry no new information.
- Close with evidence attached (the PR link, the receipt — see `agent-work-receipt-designer`), not a restatement of the diff in prose.
- If a comment doesn't change what the next reader should do, don't post it.

## Capturing spawned work instead of scope-creeping

Discovering new work while executing an item is normal and good — it is a signal you understood the problem better than when the item was filed. What is not acceptable is folding that discovery invisibly into the current item's diff:

- File the newly-discovered work as its own item(s), scoped and with its own acceptance criteria.
- Link it back to the item that surfaced it (a "discovered while working on X" reference) so provenance survives.
- If the discovery is a planning document, ADR, or roadmap proposal (not code), it must enumerate what it spawns — this repo's convention is a `Roadmap-Spawns: <slug-a>, <slug-b>` PR trailer, enforced mechanically because "a plan exists to generate work" and an unenumerated plan is a plan nobody will execute.
- Only fold the discovery into the current item's scope when it is genuinely part of the original acceptance criteria, not adjacent to them — when in doubt, split it out; a slightly-too-granular tracker is far cheaper to live with than an item whose scope quietly doubled.
