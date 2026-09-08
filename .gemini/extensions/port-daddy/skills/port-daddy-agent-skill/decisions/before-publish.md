---
title: "Decision tree: before commit / push / deploy"
purpose: "Every gate that exists between 'looks done locally' and 'visible to the fleet,' in the right order."
last_verified: 2026-09-02
---

# Before You Publish

Local green is a hypothesis, not a result. The publish path is where stale-base bugs and phantom-claim collisions become visible. Walk this tree in order.

Read-only reviewers must not push or merge; finish the assigned review with
attributable evidence. For authors, a checkpoint is not delivery: code must be
ready to merge, and ownership continues through the actual merge. The PR Finish
Line in `../SKILL.md` is the complete contract, including narrow ledger-only
completion and accepting handoffs.

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
│   ├─ origin/main is an ancestor of HEAD → continue on the linked feature worktree.
│   └─ Main has new commits → reconcile normally; see overlap block below,
│          then re-run affected tests. An ahead count alone is not freshness.
│
├─ pd sessions --all-worktrees
│   ├─ Another active session has claimed files I'm staging?
│   │      → inspect exact repo/world/root and region, then coordinate overlap.
│   │        An advisory claim in another worktree is not a blanket stop;
│   │        preserve intent and record the agreed partition or integration.
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
│       ├─ "no active session" → inspect exact selected context, owner and root;
│       │      use supported authorized recovery, not automatic `pd begin`.
│       ├─ "file not claimed" → verify scope, then `pd session files add <path>`
│       │      or the smallest region; never borrow another owner's claim.
│       └─ inconsistent projection → retain evidence; no selector clearing,
│              credential copying, world edits or refusal bypass.
│
├─ What's the publish surface?
│   ├─ Coherent checkpoint
│   │      → commit often with verified agent author/committer; read back SHA,
│   │        append its note. Keep publication/review/merge tasks unfinished.
│   ├─ Ready source or requested research artifact
│   │      → publish a ready, non-draft App/Fleetbot PR with exact agent/session
│   │        attribution through the repository's authorized path, not as the
│   │        operator using ambient personal credentials.
│   ├─ Missing publication capability
│   │      → retain commits/body and exact missing route in a durable handoff;
│   │        do not invent a publisher verb or planned ActionReceipt API.
│   │        An uncertain write requires exact readback, not another identity.
│   ├─ Direct main push or admin bypass
│   │      → not a routine author path; a hotfix does not grant an exception.
│   └─ Deploy / promote
│          → separate explicit scope and release/runbook authority; a PR is
│            not authorization to install globally or restart the daemon.
│
├─ Reviews and checks on the exact PR head?
│   ├─ Actionable review → respond graciously; incorporate unless clearly
│   │      wrong or harmful, with evidence for disagreement and regression tests.
│   ├─ Required checks red → diagnose and fix, or record a real external blocker.
│   └─ Green + required review gates satisfied → normal protected merge/queue.
│          Neutral/skipped Fleet is not a clean required verdict.
│
├─ Actual merge witnessed?
│   ├─ NO → retain custody; queue admission is not merge. Read current state.
│   └─ YES → read back merged head, merge commit and timestamp; update the
│          complete plan and typed PR field on the existing roadmap item.
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
└─ Only after actual merge, or the assigned non-authoring finish line:
   pd done "<short outcome>"
   Final note BEFORE done:
     pd note "Result: <change + PR + merged SHA>. Validation: <evidence>. Remaining: <risk>."
```

Read-only inspection is distinct from publication and may use tools permitted
by repository/operator policy; where all GitHub access is broker-routed, honor
that policy for reads too. This tree does not grant `gh`/API access forbidden
by the operator, or permission for personal-token mutations.

## Rebase conflicts on overlapping files

```
git fetch produced conflicts
│
├─ Are the conflicts in files claimed by an active session right now?
│   ├─ YES → preserve the index and both intents; coordinate exact regions,
│   │        partition or explicit integration. Do not automatically abort
│   │        someone else's operation or release a claim.
│   └─ NO  → continue.
│
├─ Are the conflicts in files claimed by a DEAD session?
│   ├─ YES → age is not authority. Inspect retained owner, plan and claims;
│   │        use supported authorized recovery or a scoped integration decision.
│   └─ NO  → resolve within your assigned scope, preserving both changes.
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
| `website-v2/` | Local lint + build and authorized preview evidence before protected merge. |
| `package.json version` | All version-stamped surfaces (mcp/server.ts, plugin.json, mcp-server.json) must match. |
