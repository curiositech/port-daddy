# Recurrence, Privacy, and Escalation

Use this reference when the main skill has already selected the scheduling posture and you need the harder policy details.

## Recurrence Handling

- Expand recurring events into concrete instances before evaluating conflicts.
- Recompute future instances around every DST boundary, not just the next meeting.
- Preserve the recurrence rule for write-back, but never rely on it alone for conflict checks.

## Privacy-Minimized Scheduling

- Default external surfaces to free-busy only.
- Strip titles, attendee emails, notes, and meeting links unless the receiving system truly needs them.
- Log policy exceptions so humans can audit privacy drift.

## Exception Budgets

- Treat override classes separately: executive override, emergency override, and maintenance override.
- Make each override class finite and auditable.
- Escalate to a human when a class exhausts its budget instead of silently weakening the policy.

## Negotiation Guardrails

- Bound the number of counterproposals.
- Require each round to shrink the slot set or raise the issue.
- Escalate when counterparties keep requesting slots outside declared working-hour or focus constraints.
