---
title: "Decision tree: before commit / push / deploy"
purpose: "Every gate that exists between 'looks done locally' and 'visible to the fleet,' in the right order."
last_verified: 2026-04-30
---

# Before You Publish

Local green is a hypothesis, not a result. The publish path is where stale-base bugs and phantom-claim collisions become visible. Walk this tree in order.

```
START: I think my work is ready
│
├─ Have I run my test suite locally?
│   ├─ NO  → run it. `npm test` or the targeted command for this repo.
│   └─ YES → continue.
│
├─ Did the suite actually exercise the surface I changed?
│   ├─ NO  → write a test or run an integration that does. Coverage in name only is worthless.
│   └─ YES → continue.
│
├─ git fetch origin
│   ├─ Local HEAD === origin/main         → continue.
│   ├─ Local HEAD is behind origin/main   → rebase onto origin/main. If conflicts:
│   │      ├─ touched same files          → see "rebase conflicts" block below
│   │      └─ clean rebase                → continue, re-run tests
│   └─ Local HEAD is ahead by my commits  → continue.
│
├─ pd sessions --all-worktrees
│   ├─ Another active session has claimed files I'm staging?
│   │      → don't push. pd note your blocker, message that agent's actor
│   │        (Navigator or Lookout depending on the surface), and pause.
│   └─ No conflicts → continue.
│
├─ pd notes --limit 20
│   ├─ Recent note says "I own X, am mid-flight"  → re-read it. Adjust scope or pause.
│   └─ Nothing relevant                           → continue.
│
├─ Coordination Guard mode?
│   ├─ off    → it's still good practice to check. `pd guard check --staged`.
│   ├─ warn   → fix anything reported, even if non-blocking.
│   └─ enforce → MUST pass `pd guard check --staged` cleanly. If it doesn't:
│       ├─ "no active session" → `pd begin "<task>" --lifecycle durable --roadmap <same-slug>` in this exact shell+cwd.
│       ├─ "file not claimed"  → `pd session files claim <each staged file>`.
│       └─ phantom claim       → see decisions/something-broke.md
│
├─ What's the publish surface?
│   ├─ Commit only (no push)
│   │      → pd note "Result: <what>. Validation: <how>." then `git commit`.
│   ├─ Push to feature branch
│   │      → push, open PR if one is expected, drop a Lookout message if release-surface.
│   ├─ Push to main (direct)
│   │      → only acceptable when:
│   │        - user explicitly authorized this push, OR
│   │        - the change is a hotfix that other agents would block on, AND
│   │        - you ran the full test suite, AND
│   │        - you re-fetched origin/main within the last 60 seconds.
│   │      → If unsure, push to a feature branch and ask.
│   └─ Deploy / promote
│       → see decisions/promote-stable.md (if it exists) or pd lock + promote-stable.sh.
│
├─ Does this change touch ANY release surface?
│   (README, website, docs/, skills/, CHANGELOG, mcp/, marketing copy, public OpenAPI, package.json version)
│   ├─ YES → message the Lookout actor with what changed and where to verify:
│   │       pd actor lookout --message "<surface>: <change>. Verify at <url-or-path>."
│   └─ NO  → continue.
│
├─ Does this change roadmap, recovery state, or skill structure?
│   ├─ YES → message Navigator + Cartographer.
│   └─ NO  → continue.
│
└─ pd done "<short outcome>"
   Final note BEFORE done:
     pd note "Result: <change>. Validation: <evidence>. Remaining: <risk>."
```

## Rebase conflicts on overlapping files

```
git fetch produced conflicts
│
├─ Are the conflicts in files claimed by an active session right now?
│   ├─ YES → DO NOT solo-resolve. The other agent's intent is at stake.
│   │        `git rebase --abort`, message that agent's actor, wait or coordinate.
│   └─ NO  → continue.
│
├─ Are the conflicts in files claimed by a DEAD session?
│   ├─ YES → safe to resolve. Note the salvage in your pd note.
│   └─ NO  → free to resolve.
│
└─ After resolving:
    → Re-run the tests that touch those files.
    → Re-read pd notes — the conflict resolution might invalidate someone's plan.
```

## Specific surface gotchas

| Surface | Extra step before publish |
|---|---|
| `skills/port-daddy-agent-skill/` | Tests in `tests/unit/port-daddy-skill-authority.test.js` and `distribution-freshness.test.js` enforce structure. Run them. |
| `bin/port-daddy-cli.ts` | Re-run `npx tsc --noEmit` and verify a fresh CLI invocation works (`pd status`). |
| `mcp/server.ts` | The MCP version must match `package.json`; `tests/unit/distribution-freshness.test.js` will catch drift. |
| `lib/db.ts` (schema) | Migrations are non-reversible; verify with stable's promote-stable.sh in a separate worktree first. |
| `pd-fleet.yml` | `bash skills/port-daddy-agent-skill/scripts/fleet-validate.sh` before commit. |
| `website-v2/` | Local lint + build, then preview deploy before main push. |
| `package.json version` | All version-stamped surfaces (mcp/server.ts, plugin.json, mcp-server.json) must match. |
