---
title: "Decision tree: when is skipping coordination actually OK?"
purpose: "The default is COORDINATE. This is the small list of cases where skipping is safe."
last_verified: 2026-08-21
---

# When Skipping Coordination Is Actually OK

The default rule in this repo is: `pd briefing` + `pd begin ... --lifecycle durable --roadmap <slug>` + claim + note + done. The cost of running them is ~5 seconds. Skipping is rarely worth it. But here are the genuine exceptions.

```
START: I'm tempted to skip pd ceremony for this task
│
├─ Is this a TRULY READ-ONLY question with no follow-up edits?
│   (e.g., user asks "what version is X?" "where is Y defined?")
│   ├─ YES + answer is from one cat / grep
│   │       → skip ceremony. Read, answer, done.
│   ├─ YES + answer requires deep traversal (>3 files)
│   │       → still consider `pd briefing` once, in case state has shifted.
│   └─ NO  → continue.
│
├─ Is the task INSIDE a single isolated worktree that no other agent uses?
│   (Personal scratch, throwaway experiments, generated test fixtures)
│   ├─ YES → can skip claim+note. Still run `pd whoami` to confirm scope.
│   └─ NO  → don't skip.
│
├─ Am I in EMERGENCY MODE (production down, security hot, user says "now")?
│   ├─ YES → shorten ceremony; do not self-authorize around a refusal:
│   │        - publish the smallest useful pd note and claim.
│   │        - publish the blocker to coordination:inconsistency.
│   │        - surface any required operator action in FleetBar/dashboard.
│   └─ NO  → don't skip. The task feels urgent but isn't.
│
├─ Is the operation IDEMPOTENT and reversible in <30s?
│   (Running a test, viewing a log, checking a service status)
│   ├─ YES → skip ceremony for the inspection itself.
│   │       But if the inspection FINDINGS will drive an edit, ceremony resumes.
│   └─ NO  → don't skip.
│
└─ Default: don't skip.
   The friction is the point. It catches the bugs you can't see.
```

## Concrete examples that look like skip cases but aren't

| Looks like skippable | Actually requires ceremony because |
|---|---|
| "Just running tests" | Tests touch state, may write fixtures, may reveal stale-base issues. `pd briefing` first. |
| "Just a quick fix" | "Quick" is what every agent thinks before clobbering. |
| "Nobody else is on this code" | You don't know that until you check. |
| "Writing a one-line README change" | Release surface; Lookout cares. |
| "Running `pd salvage`" | Side-effects (claims). Anchor a session first. |
| "Adding a comment" | Comments are still edits; tracked, blame'd, claim-checked. |

## Concrete examples that ARE skippable

- `pd status` itself.
- Reading a file the user pasted to ask about.
- Answering "what's the version?" from `package.json`.
- Listing files in a known directory.
- Checking your own session: `pd whoami`.
- Running `git log`, `git diff`, `git blame` for orientation.
- Reading documentation to answer a question (no edits planned).
- Sanity-checking that a command exists with `which` or `command -v`.

## When the git shim or Coordination Guard refuses

Treat the refusal as input to repair, not an obstacle to suppress:

- Re-anchor the intended session and claim the exact staged paths.
- Add the missing coordination note or roadmap receipt.
- Salvage a dead holder, or coordinate merge order with a live holder.
- If runtime truth and the refusal still disagree, publish exact evidence to
  `coordination:inconsistency` and make the blocker operator-visible.

If you cannot commit with an active session, that is a signal that:

1. Your shell lost its session anchor (likely due to cwd mismatch). Run `pd begin "<task>" --lifecycle durable --roadmap <same-slug>` here.
2. The repo's guard mode shouldn't be `enforce` for this surface. Discuss before downgrading.

Do not disable hooks or route around the guard. Escalate a genuinely incorrect
refusal through durable coordination and the operator surface.
