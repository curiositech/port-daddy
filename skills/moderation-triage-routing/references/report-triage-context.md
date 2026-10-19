# Assembling Report Triage Context

**Read when**: designing what information a reviewer sees when they open a
report — the difference between a one-person operation that burns hours per
report and one that clears a queue in minutes.

## What a reviewer needs to decide fast

Every report — whether it arrived as a user submission or a classifier flag —
should arrive at the reviewer's screen with four pieces of context already
assembled. Making the reviewer go fetch any of these manually is the single
biggest hidden cost in small-team moderation operations.

1. **The flagged content/message itself** — rendered inline, not just linked.
   If it's an image or video, show a preview (with the Tier-0 isolation
   caveat from `references/queue-architecture.md` — likely-Tier-0 content
   should never render an unwarned preview). If it's a message, show
   surrounding context (a few messages before/after) when the platform's
   data model allows it, since single messages taken out of context are
   often unreviewable.
2. **The reporter's stated reason** — the free-text or categorical reason the
   reporter gave, verbatim. Don't make the reviewer guess why this was
   reported.
3. **The account's prior violation history** — a compact list: prior
   reports against this account, prior actions taken, dates. This is often
   the single most decision-relevant piece of context — a first-time
   borderline report and a fifth-time repeat-offender report with identical
   content should not get identical handling, and a reviewer without history
   visible will often (wrongly) treat them the same.
4. **The automated classifier's confidence score**, when available — surfaced
   as a number or a simple high/medium/low band, not buried in a log. This
   tells the reviewer how much to trust or double-check the automated
   pre-flagging, and should influence tier placement (see decision flow in
   SKILL.md).

## Why this is the efficiency lever, not the queue UI

A well-designed queue UI (Directus, Retool, Refine, self-built — see
`references/tooling-comparison.md`) is necessary but not sufficient. The UI
can be beautiful and still cost a reviewer 10 minutes per report if opening a
report means separately querying the accounts table for history, scrolling
a chat log for context, and checking a classifier dashboard in another tab.
Automating the *assembly* of this context — a single query or view that joins
report + content + reporter reason + account history + classifier score — is
what separates an efficient one-person moderation operation from one that
burns hours per report. This is squarely a data-modeling and view-design
problem, not a UI-polish problem, which is why it belongs in the schema/query
layer (feeding whichever tool from `references/tooling-comparison.md` you
chose) rather than being solved per-tool.

## Templated action responses

Once context is assembled and a decision is made, the *response* to the
reporter and/or the actioned account should draw from a small library of
templated messages per violation category (see
`references/metrics-and-audit.md` for how this reduces time-per-report).
Keep templates:

- Versioned, so policy language changes are traceable
- Specific enough to reference the actual policy violated (not generic
  "content removed" boilerplate that gives the actioned party no way to
  understand or appeal)
- Paired with an explicit appeal/reversal path, since the false-positive-rate
  metric depends on appeals actually being possible and tracked

## Anti-pattern: re-deriving context per report instead of assembling it once

The tell-tale sign: a reviewer (or the operator) opens 3+ tabs/queries per
report to reconstruct context that could have been joined into a single view
ahead of time. If time-per-report is rising (see
`references/metrics-and-audit.md`), this is almost always the root cause.
