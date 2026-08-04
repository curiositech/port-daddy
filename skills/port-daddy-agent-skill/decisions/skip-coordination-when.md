---
title: "Decision tree: when is skipping coordination actually OK?"
purpose: "The default is COORDINATE. This is the small list of cases where skipping is safe."
last_verified: 2026-04-30
---

# When Skipping Coordination Is Actually OK

The default rule in this repo is: `pd briefing` + `pd begin ... --lifecycle durable` + claim + note + done. The cost of running them is ~5 seconds. Skipping is rarely worth it. But here are the genuine exceptions.

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
│   ├─ YES → skip the SLOW parts (deep briefing, worktree ceremony) — but
│   │        emergency is not a self-serve bypass of the git guard/shim.
│   │        - drop a pd note describing the emergency and what you're doing.
│   │        - publish to coordination:inconsistency that you went fast-path.
│   │        - if a guarded destructive verb is genuinely the move, that is
│   │          an OPERATOR call — escalate (see guard-or-shim-refused-me.md),
│   │          don't mint your own PD_SHIM_OFF.
│   │        - re-engage normal ceremony as soon as the fire is out.
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

## The git shim and the guard have no agent-mintable bypass

This is the ADR-0102 rule: a documented bypass is not a control. If you can
mint your own escape from the guard, the guard protects nothing. So do not
reach for `PD_SHIM_OFF=1`, `git --no-verify`, `-c core.hooksPath=/dev/null`,
or absolute-path git (`/usr/bin/git ...`) to get past a refusal. The
mechanism may still exist in your installed build; that is not permission —
only the operator authorizes it, through their own surface.

When the shim or Coordination Guard refuses you, the refusal is almost always
pointing at a real coordination problem:

1. Your shell lost its session anchor (likely a cwd mismatch). Run
   `pd begin "<task>" --lifecycle durable` here.
2. You staged a path you never claimed. `pd session files add <path>`.
3. A live or dead session holds the surface. Salvage the dead; coordinate
   with the live.

Fix the guard INPUT, or — if you're genuinely blocked (daemon down, or you
believe the refusal is wrong) — escalate to the operator. The full tree is
[guard-or-shim-refused-me.md](guard-or-shim-refused-me.md). Never "make the
warning go away"; that's how anti-patterns harden.
