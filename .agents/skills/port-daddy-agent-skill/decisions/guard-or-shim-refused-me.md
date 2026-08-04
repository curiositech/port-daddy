---
title: "Decision tree: the guard or pd-shim refused my git command"
purpose: "Turn a coordination-guard / git-shim refusal into the right next move. The fix is almost always the guard INPUT, not a bypass — and there is no agent-mintable bypass to reach for (ADR-0102)."
last_verified: 2026-07-24
---

# The Guard or Shim Refused Me

A refusal is not a bug and it is not a wall to climb. It is the coordination
system telling you that the *input* it can see does not justify the mutation
you asked for. The correct response is to fix the input or escalate — never to
find a way around the control. Port Daddy's doctrine is deliberate: **a
documented bypass is not a control.** If an agent can mint its own escape,
the guard protects nothing. So there is no sanctioned in-band bypass for you
to reach for (see ADR-0102 / `references/git-discipline.md` § *The pd-shim*).

## First: which gate refused you?

Two different things intercept git in a Port-Daddy-managed repo. Read the
refusal text — it tells you which one fired, and they want different fixes.

| Gate | Fires on | Refusal looks like | Owns |
|---|---|---|---|
| **Coordination Guard** (pre-commit hook) | `git commit` | "no active session", "file not claimed", "note required", "roadmap receipt required" | session + claim + note + receipt preconditions |
| **pd-shim** (`~/.port-daddy/bin/git` ahead on PATH) | destructive verbs: `reset --hard`, `checkout -- .`, `clean -fd`, `add -A`/`add .`, `stash push/save`, `cherry-pick`, `rebase`, `push --force`/`push <remote> main` | "pd-shim: `<verb>` refused by Port Daddy coordination guard" | cross-agent blast-radius verbs |

If you are not sure, run `pd guard status` (guard mode) and
`pd guard check --git-verb <verb>` (what the shim sees for a specific verb).

## The tree

```
START: git just refused. I read the refusal text.
│
├─ Was it the COMMIT gate (Coordination Guard)?
│   │
│   ├─ "No active session attached"
│   │     → Your shell lost its anchor — usually a cwd mismatch
│   │       (.portdaddy/contexts/ is per-directory). Re-anchor HERE:
│   │       `pd begin "<task>" --lifecycle durable` in the exact cwd you
│   │       will commit from. Do NOT `--no-verify`.
│   │
│   ├─ "File not claimed: <path>"
│   │     → You staged a path you never claimed. Claim every staged path:
│   │       `pd session files add <path> ...`. If you should NOT be
│   │       editing it, unstage it instead. The guard is correct here.
│   │
│   ├─ "Note required for this commit"
│   │     → You owe a per-commit note. `pd note "Scope/Result: ..."`.
│   │
│   ├─ "Roadmap receipt required" (coordination-roadmap path)
│   │     → Editing a coordination surface (skills/port-daddy-agent-skill,
│   │       docs/adr, guard config) needs a receipt:
│   │       `pd roadmap upsert <slug> --summary "..."`.
│   │
│   └─ Claim held by ANOTHER session
│         → Go to the "held by someone else" branch below.
│
├─ Was it the SHIM (a destructive verb)?
│   │
│   ├─ The refusal names files held by OTHER sessions → "held by someone
│   │   else" branch below.
│   │
│   ├─ No conflicting claim, but the verb is genuinely destructive
│   │   (`reset --hard`, `clean -fd`, `checkout -- .`)
│   │     → Ask: do I actually need the destructive form? Usually not.
│   │       - Discard one file: prefer `git restore <path>` scoped, or
│   │         re-edit, over `checkout -- .`.
│   │       - Sync onto origin/main: `git fetch && git rebase origin/main`
│   │         (the shim allows a clean rebase; it refuses one that would
│   │         stomp foreign WIP — that refusal is the signal below).
│   │       - Throw away the whole worktree: that is an operator decision.
│   │         Escalate; do not `clean -fd` another agent's tree.
│   │
│   └─ Force-push / push to a protected branch (main/master/release/*)
│         → Never force-push shared history from an agent. Push a feature
│           branch and open a PR. If the operator explicitly wants a
│           force-push, THEY authorize it — you do not.
│
├─ Is the holder of the blocking claim DEAD or ALIVE?
│   │  (`pd sessions --all-worktrees`; read the note content — a
│   │   "usage limit exceeded" note from days ago is a corpse)
│   │
│   ├─ DEAD  → `pd salvage --project <project>` clears dead claims. Re-run
│   │           your git command. Salvaging preserves the dead agent's
│   │           intent; don't just delete their work.
│   │
│   ├─ ALIVE → They own that surface until they release it. Working AROUND
│   │           a live claim is the exact failure this guard prevents.
│   │           Coordinate: `pd inbox send <agent> "<ask>"` or the project
│   │           channel. Resolve by file/symbol partition or merge order.
│   │
│   └─ CAN'T TELL → treat as alive. Publish to coordination:inconsistency
│                    and wait, rather than assuming it's a corpse.
│
├─ I fixed the input (claimed / noted / receipted / re-anchored / salvaged)
│   and re-ran. Did it pass?
│   ├─ YES → done. Leave a `pd note` recording what the refusal caught.
│   └─ NO  → continue.
│
└─ I genuinely believe the refusal is WRONG, or the daemon is down so the
   guard can't evaluate my input.
      → This is the ESCALATION leaf. See "When you are genuinely blocked".
        Do NOT reach for a bypass. The bypass is never the answer here.
```

## The bypasses you must NOT self-authorize

When you hit the wall, three escape routes will occur to you. Each one
defeats a safety the operator installed on purpose. Using any of them
without explicit operator direction is the same class of mistake as
`--no-verify` on a commit hook.

| Tempting bypass | Why it exists / why it's forbidden for you |
|---|---|
| `PD_SHIM_OFF=1 git <verb>` | The shim's own refusal copy prints this. It is an operator/recovery escape, audited to `~/.port-daddy/destructive-ops.log`. An agent self-authorizing it is minting its own bypass — exactly the anti-pattern ADR-0102 closes. Do not type it reflexively. |
| `git --no-verify` / `git -c core.hooksPath=/dev/null commit` | Skips the Coordination Guard pre-commit hook. The bypass is itself a violation worth a `coordination:inconsistency` post. |
| Absolute-path git (`/usr/bin/git reset --hard`) | Steps around the shimmed PATH entirely. It looks clever; it is the same defeat of the same control. |

If you catch yourself typing any of these, **stop and read the refusal
again.** It is almost always pointing at a real coordination problem
(a live claim, an unclaimed path, a lost session anchor), not at itself.
The bypass mechanism may still physically exist in your installed build —
that changes nothing. A documented bypass is not permission. Only the
operator authorizes it, and they do it through their own surface.

## Fix-the-input playbook

Map the refusal to the input that makes the guard say yes:

| Refusal says | The input to fix |
|---|---|
| no active session | `pd begin "<task>" --lifecycle durable` in the commit cwd |
| file not claimed | `pd session files add <each staged path>` |
| note required | `pd note "..."` (one per commit) |
| roadmap receipt required | `pd roadmap upsert <slug> --summary "..."` |
| claim held by dead agent | `pd salvage --project <project>` |
| claim held by live agent | `pd inbox send <agent>` / channel; partition or queue |
| rebase would stomp foreign WIP | rebase in a fresh worktree off origin/main; leave theirs alone |
| push to protected branch | push a feature branch, open a PR |

The through-line: every green path is *more* coordination signal, never
less. You are giving the guard the truth it was missing.

## When you are genuinely blocked

Two cases reach this leaf legitimately:

1. **The daemon is down**, so the guard cannot evaluate your claim/session
   state at all. First confirm it's really down and won't respawn:
   `pd status`, and see `something-broke.md` (launchd respawn window is
   ~1s; wait before concluding). If it is durably down, that is an
   operator-visible outage — escalate; do not commit blind by disabling
   the hook.
2. **You believe the refusal is factually wrong** (e.g. it claims a file
   is held but `pd sessions --all-worktrees` shows no live holder and
   salvage didn't clear it).

In both cases the move is the same — **escalate, don't bypass:**

- Leave a precise `pd note`: the exact command, the exact refusal text,
  what you already tried (`pd salvage`, re-anchor, re-claim), and why you
  think you're stuck.
- Publish to `coordination:inconsistency` so another actor / the fleet can
  see it:
  `pd tube coordination:inconsistency --send "BLOCKED: <verb> refused. Tried: <list>. Holder: <session|none>. Repro: <cmd>."`
- Route it to the owning actor: file/claim/lock disputes → **Coxswain**
  (`pd inbox send coxswain "..."` or `pd actor coxswain --message "..."`).
- If it needs a human decision (force-push, discard a tree, downgrade
  guard mode for a surface), that is an **operator** call. Surface it the
  way operators consume signal — a FleetBar-visible blocker, not "run
  `PD_SHIM_OFF=1` for me." If the FleetBar surface to approve this doesn't
  exist yet, that's a product gap: file `high` feedback against FleetBar
  (see SKILL.md § *Operator vs Agent*).

Then wait for the resolution before mutating. A blocked-but-honest agent
is worth far more to the fleet than an unblocked one that clobbered a peer.

## See also

- `references/git-discipline.md` — the pd-shim verb table, the shim flow,
  and the post-mortem incident behind these rules.
- `skip-coordination-when.md` — the small list of cases where skipping
  ceremony is genuinely safe (and the look-alikes that aren't).
- `something-broke.md` — if the refusal is a *symptom* of stale state
  (daemon down, mid-rebase, ABI drift) rather than a real claim conflict.
- `who-do-i-message.md` — picking the right durable surface for the
  escalation once you've decided to raise it.
