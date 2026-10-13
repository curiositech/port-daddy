# Operational Metrics and the Audit-Log Habit

**Read when**: deciding what to measure about your moderation operation, or
building the weekly/monthly audit-log export that doubles as an ops dashboard
and a compliance evidence trail.

## The three metrics worth tracking even at N=1

You do not need a metrics platform. A spreadsheet or a query against your own
`actions` table is enough — the point is tracking these *at all*, consistently,
not the sophistication of the tooling.

### 1. Report/complaint turnaround time

Time from report submitted → action taken (including "reviewed, no action").

Why this matters beyond ops hygiene: many legal and regulatory notice-and-
action regimes (e.g., intermediary liability frameworks, platform-specific
regulatory obligations) require "expeditious" action rather than specifying a
fixed number of hours or days. That means there usually isn't a bright-line
compliance target to hit — instead, what matters is that you *know* your
actual median and p95 turnaround, can show it trending in a reasonable
direction, and can explain outliers. Track median AND p95 — the p95 is where
your Tier 0/Tier 1 isolation failures and legally time-sensitive misses would
show up first.

### 2. False-positive rate on auto-actioned content

If any content or account action is triggered automatically by a classifier
(from `ml-trust-safety-signal-detection`) without human review, the reversal/
appeal rate on those actions is your false-positive signal. A rising reversal
rate means the auto-action threshold is too aggressive for current classifier
performance — tune the confidence threshold or add a human-review step before
auto-action, don't just accept the appeals as a cost of doing business.

### 3. Reviewer/operator time-per-report

Wall-clock time from opening a report to taking action, averaged and trended.
A *rising* trend is a specific, actionable signal: it means the triage context
you're assembling automatically (see `references/report-triage-context.md`)
is no longer sufficient — reviewers (or you) are spending time re-gathering
context the tool should have surfaced. Treat a rising time-per-report as the
trigger to invest in better tooling, not as a sign reviewers are "getting
slower."

## The weekly audit-log export

Set up a scheduled (weekly is a reasonable default cadence) export summarizing:

- Actions taken, by category and tier
- Turnaround time distribution for the period
- Any escalations to Tier 0 (isolated queue) and their handling
- Appeals/reversals and their outcomes

This does double duty:

1. **Lightweight ops dashboard** — even a solo operator benefits from a
   weekly "how did moderation go" summary rather than only ever looking at
   individual reports.
2. **Compliance evidence trail** — if a regulator, payment processor, or
   platform partner (app store, ad network, upstream host) ever asks for
   proof of a functioning moderation program, a consistent historical export
   is far stronger evidence than "we handle reports as they come in." This is
   often the difference between a partner treating an incident as an isolated
   miss versus evidence of a systemically absent moderation function.

## Automation patterns that keep a small team from drowning

- **Auto-flagging** reduces the *volume* reaching human review to a filtered,
  pre-scored subset rather than a raw firehose of all user activity — this is
  the hand-off point from `ml-trust-safety-signal-detection`'s classifiers
  into this skill's queue-routing layer.
- **Templated action responses** — standard messages for common violation
  types (spam removed, account warned for X, content removed for policy Y) —
  cut per-report handling time on the high-volume, low-severity tiers
  dramatically. Write these once per policy category, keep them versioned so
  you can see how policy language evolved.
- **Scheduled audit-log export** (above) is itself an automation pattern:
  it should run without the operator remembering to run it.

## Anti-pattern: measuring only volume, never turnaround or reversal rate

A queue-length or reports-closed-per-day count tells you throughput, not
whether you're within a defensible turnaround window or whether your
automation is accurate. Volume metrics alone create a false sense of control.
