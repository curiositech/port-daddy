---
title: "Decision tree: something broke"
purpose: "Branch from a vague symptom to the right repair, without solo-fixing what stable already shipped."
last_verified: 2026-04-30
---

# Something Broke

The wrong order is "fix it now"; the right order is "diagnose, then check who already knows."

```
START: I see a failure or "doesn't work"
│
├─ Did I run `pd briefing` and `pd sessions --all-worktrees` in the LAST 60s?
│   ├─ NO  → run them. Many "breaks" are already being fixed by another agent.
│   └─ YES → continue.
│
├─ Is `origin/main` newer than my local HEAD?
│   ├─ YES → git fetch, then re-evaluate. Local stale state is the #1 phantom bug.
│   └─ NO  → continue.
│
├─ Is the daemon process alive?  (`pd status`, `launchctl list | grep portdaddy`)
│   ├─ NO  → check launchd respawn. KeepAlive should bring it back in ~1s.
│   │       If it's been >5s, see launchd block below.
│   └─ YES → continue.
│
├─ Is the canonical socket present? (`ls ~/.port-daddy/daemon.sock`)
│   ├─ NO + daemon alive → daemon mid-startup; pdFetch will retry. Wait, don't kill.
│   └─ YES → continue.
│
├─ Does TCP work but socket doesn't (or vice-versa)?
│   ├─ Socket-only fails  → install permission/path drift. Re-run `pd install`.
│   ├─ TCP-only fails     → port-file freshness; check ~/.port-daddy/daemon.port mtime.
│   └─ Both work          → continue.
│
├─ Is this an `npm test` / `jest` failure?
│   ├─ Many suites failing with "NODE_MODULE_VERSION" mismatch
│   │       → `npm rebuild better-sqlite3`. ABI mismatch after Node version drift.
│   ├─ tuples-delivery / single-suite obscure failure
│   │       → check `git log HEAD..origin/main` first. Likely already fixed upstream.
│   └─ Test you just modified
│       → that's normal; iterate.
│
├─ Coordination Guard refused my commit?
│   ├─ "No active session attached"
│   │       → Run `pd begin "<task>" --lifecycle durable --roadmap <same-slug>` in the SAME shell + cwd you'll commit from.
│   │         Sessions are per-cwd via .portdaddy/contexts/.
│   ├─ "File not claimed"
│   │       → `pd session files claim <files>` for every staged path.
│   └─ Phantom claim from dead agent
│       → check the claimant in `pd whoami` for that agent. If isActive=false,
│         the claim is orphaned; force-release or re-claim.
│
├─ Walked into another agent's interactive rebase?
│   → DO NOT commit. `git format-patch` your work, `git rebase --abort`,
│     start fresh worktree from origin/main. See examples/10-walked-into-anothers-rebase.md.
│
├─ launchd block: daemon didn't come back from SIGTERM?
│   → `launchctl kickstart -k gui/501/com.portdaddy.daemon`
│   → If still dead, check ~/Library/Logs/com.portdaddy.daemon.err.log
│   → If port 9876 is held by something else: `lsof -i :9876` then evict.
│
└─ Still broken AFTER all the above?
    → Don't keep solo-debugging. Publish to coordination:inconsistency:
        pd tube coordination:inconsistency --send "BROKEN: <symptom>. Tried: <list>. Repro: <cmd>."
      Then wait 60s for an actor to claim it before you continue.
```

## Common phantom bugs

These look like real bugs but are almost always state-drift:

| Symptom | First check | Real cause |
|---|---|---|
| 53 unit suites failing | `node -p process.versions.modules` vs `file node_modules/better-sqlite3/build/Release/better_sqlite3.node` | Node ABI mismatch from a stable promotion that rebuilt |
| Tests pass locally, fail on origin/main | `git fetch && git diff HEAD origin/main` | Another agent shipped a fix; you have stale tests |
| "Daemon not running" mid-CLI | Did promote-stable.sh run in the last 5s? | launchd respawn window — pdFetch retry handles it (since d312c87) |
| Coordination Guard blocks commit despite active session | `pwd` and confirm `.portdaddy/contexts/` exists here | Session is anchored to a different cwd |
| Branch full of files I didn't change | `git branch --show-current` and check who owns it | You walked into another agent's worktree state |

## When solo-debugging IS valid

- The fix is bounded (single file, single test) AND
- The symptom is reproducible AND you've ruled out stale state AND
- Live fleet has no one working on it (verified, not assumed).

Otherwise: publish, wait, then act.
