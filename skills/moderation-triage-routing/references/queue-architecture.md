# Severity-Tiered Queue Architecture

**Read when**: designing or auditing how flagged items get sorted into review queues, or deciding whether a single queue is good enough (it usually is not).

## Why one flat queue fails

A single FIFO queue for all reports forces every reviewer to context-switch between
severities: a copyright complaint sits next to a credible threat of violence sits
next to routine spam. Two failure modes follow directly from this:

1. **Legally time-sensitive items get buried.** Reports that trigger mandatory
   reporting obligations (child sexual abuse material, imminent threats to life,
   terrorism content in many jurisdictions) often carry statutory or contractual
   clocks — e.g., a payment processor or app store partner agreement requiring
   action within a fixed window, or a legal obligation to report to a hotline/
   authority. A FIFO queue has no concept of "this jumps the line."
2. **Reviewers are exposed to the worst content without warning.** A solo operator
   or a small team doing routine spam/abuse triage should not stumble into CSAM or
   graphic violence between two garden-variety spam reports. This is a real
   occupational-harm issue even at N=1 — it is well documented in commercial
   content-moderation workforces (secondary traumatic stress, PTSD-like symptoms)
   and the same exposure mechanics apply regardless of team size.

## The tiered model

Route every incoming report into one of a small number of queues, decided at
intake, not at review time:

| Tier | Examples | Handling requirement |
|------|----------|----------------------|
| **Tier 0 — Isolated / restricted** | CSAM, imminent physical harm/threats to life, terrorism content, other content triggering mandatory legal reporting | Separate, access-restricted queue. Routed automatically, never mixed with general triage. Often requires a specific reporting workflow (e.g., NCMEC CyberTipline in the US) with its own retention and evidence-handling rules. Access limited to designated, trained personnel — even in a one-person shop, treat this as a distinct "hat" you put on deliberately, with a documented procedure, not something you stumble into mid-triage. |
| **Tier 1 — High severity** | Credible harassment/doxxing, non-consensual intimate imagery, hate speech targeting protected groups, self-harm content | Fast SLA (hours, not days). May require its own escalation path (e.g., resources for self-harm content). |
| **Tier 2 — Standard abuse** | Harassment, impersonation, ToS violations, most user reports | Normal SLA. Bulk of reviewer time. |
| **Tier 3 — Low severity / high volume** | Spam, low-confidence classifier flags, minor formatting/policy violations | Batch-friendly. Good candidate for templated responses and bulk actions. |

Tier boundaries are policy decisions specific to each platform — the point is
the *separation*, not the exact tier count. Two tiers (isolated vs. everything
else) is a legitimate minimum; four is a reasonable ceiling before the
overhead of managing queues exceeds the benefit.

## Isolation mechanics

"Isolated" queue means more than a different label in the same table:

- **Access control**: a separate view/permission scope so the isolated queue is
  not visible by default to anyone triaging the general queues. In tools like
  Directus this is a field/row-level permission rule; in a self-built tool it's
  a route guard plus an explicit "I am opting into this" confirmation step.
- **No accidental exposure**: general-queue reviewers should never see a
  thumbnail, preview, or snippet of Tier 0 content while working the general
  queues. Auto-classification that flags likely-Tier-0 content should reroute
  it before any human preview is rendered, not after.
- **Deliberate entry**: entering the isolated queue should require an explicit
  action (not the default "next item" button in the general queue), so the
  reviewer has a moment to prepare, and so there's an audit trail of who
  reviewed what and when.
- **A documented external-reporting step**: if the jurisdiction/platform type
  requires reporting to an authority or hotline, the isolated queue's action
  buttons should include that reporting step as a first-class action, not a
  side process the operator has to remember.

## Routing decision flow

See the intake→triage→routing→action→audit pipeline in the main SKILL.md. The
severity classification that decides tier placement should run automatically
wherever possible (classifier confidence + report category + keyword/media
signals from `ml-trust-safety-signal-detection`), with a manual override path
for reporters or reviewers to escalate something the automation missed.

## Anti-pattern: tiering by report *volume* instead of report *severity*

A common mistake is to build "queues" that are really just pagination —
splitting the single queue into "today's reports" and "backlog" — which solves
a UX problem but not the severity-mixing problem. Tiering must be by
*content/harm type*, not by arrival time or volume.
