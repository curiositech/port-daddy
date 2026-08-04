<!-- OPERATOR-ONLY: DO NOT MIRROR TO AGENT-FACING SKILL SURFACES (ADR-0102) -->
<!--
  Audience: the human operator, and ONLY the human operator.
  This file MUST NOT be copied, summarised, or linked into
  skills/port-daddy-agent-skill/, skills/port-daddy-internal-dev/, or any
  other surface an autonomous agent reads. Documenting an escape to agents
  turns the escape into an agent-mintable bypass, and a bypass documented to
  agents is not a control (ADR-0102). The whole value of this path is that
  agents do not know it exists. If you are an agent reading this: stop, and
  escalate to the operator — see "What is NOT a valid escape for agents".
  A guard test (tests/unit/operator-guide-no-agent-leak.test.js) fails CI if
  this guide, or its raw-git recipe, leaks into any skill surface.
-->

# Emergency Raw-Git Escape (Operator-Only)

When the Port Daddy daemon is down and you are doing genuine recovery, the
sanctioned way to run git without the coordination shim in the way is to
invoke the **real git binary by absolute path**. This is deliberate,
logged, operator-only, and — importantly — it does **not** hand you a
force-push to a protected branch. That wall stays up.

This document is intentionally kept out of every agent-facing surface. See
the header for why.

## TL;DR

```sh
# 1. Resolve the real git (skip the Port Daddy shim on PATH):
command -v -a git | grep -v '\.port-daddy'
#    → /opt/homebrew/bin/git   (yours may differ; use YOUR output)

# 2. Run recovery with that absolute path, e.g. rescue a stomped tree:
/opt/homebrew/bin/git reset --hard HEAD@{1}
/opt/homebrew/bin/git stash list
/opt/homebrew/bin/git checkout -- path/to/file
```

Raw git escapes the **advisory working-tree shim**. It does **not** escape
the pre-push hook or GitHub branch protection.

## When this is legitimate

Use raw git **only** when all of these hold:

1. The Port Daddy daemon is **down** (`pd status` errors, or the shim's
   `pd guard check` cannot reach a daemon), AND
2. You are doing **genuine recovery** — un-stomping a working tree,
   recovering from a reflog, unpicking a bad cherry-pick — where the shim's
   guard call would either hang or refuse against stale claims, AND
3. **You** — the human operator — are at the keyboard and have decided this
   is the right move.

If the daemon is *up* and the shim refuses a verb, that refusal is almost
always correct: coordinate, don't escape. The shim refusal names the files
and the sessions holding them. Fix the guard input (`pd salvage`, release a
stale claim, `pd note` the reason) instead of reaching for raw git.

## How to resolve the real git path

The shim lives at `~/.port-daddy/bin/git` and is put on `PATH` ahead of the
real binary. To find the real one, list every `git` on `PATH` and drop the
shim:

```sh
command -v -a git | grep -v '\.port-daddy'
```

The first surviving line is your real git — typically
`/opt/homebrew/bin/git` (Apple Silicon Homebrew), `/usr/local/bin/git`
(Intel Homebrew), or `/usr/bin/git` (system). Verify it is not the shim:

```sh
head -1 "$(command -v -a git | grep -v '\.port-daddy' | head -1)"
#   real git is a binary → you'll see a binary/ELF/Mach-O smudge,
#   NOT the line "#!/usr/bin/env bash" that heads the shim.
```

Do not hardcode a path from this doc into a script. Resolve it live; the
location differs per machine and per Homebrew prefix.

## What raw git CAN and CANNOT do

| Operation                                   | Raw git by absolute path | Why |
|---------------------------------------------|--------------------------|-----|
| `reset --hard`, `checkout -- <p>`, `clean -fd`, `stash`, `cherry-pick`, `rebase` | **Escapes the shim** — runs immediately | These are working-tree verbs. The shim is the *only* pre-hook git offers for them, and it is advisory. Bypassing it by absolute path is exactly what this path is for. |
| `push --force` / `-f` to `main`/`master`/`release/*` | **Still BLOCKED** | git runs `.git/hooks/pre-push` regardless of which binary invoked it. The hook is binary-agnostic; raw git triggers it just like the shim does. |
| Non-fast-forward or deletion push to a protected branch | **Still BLOCKED** | Same pre-push hook. Raw git cannot casually rewrite protected history. |
| Any push, real or forced, that the server rejects | **Still BLOCKED** | GitHub branch-protection is server-side and survives *every* local bypass. It is the true wall. |

The mental model: raw git buys you back the **local working tree**, not the
**public history**. The shim is a soft floor over destructive local verbs;
the pre-push hook and server-side protection are the hard walls over remote
history, and raw git walks through neither.

## The pre-push hook is the real safety, so keep it

The per-repo hook installed by `scripts/install-pre-push-hook.sh` runs on
`git push` no matter which binary calls it. Raw-git recovery is safe
precisely because that hook stays in force. **Do not** pass `--no-verify` on
a push to skirt it, and **do not** reach for `PD_SHIM_OFF=1` on a push —
that variable is honored by the pre-push hook too (it early-exits `0`), so
it defeats the one control raw git otherwise preserves. If you truly must
move a protected branch, the honest path is GitHub: open a PR, or change the
branch-protection ruleset deliberately and change it back. See
`docs/operator/branch-protection-ruleset.md`.

## Log every use

Raw-git recovery is deliberate work; leave a trail so the next operator (or
the next you, at 2am) can reconstruct it:

- `pd note "Raw-git recovery: daemon down, ran /opt/homebrew/bin/git reset --hard HEAD@{1} to un-stomp <tree>. Reason: <x>."`
- If the daemon is fully down, drop a plain line in your recovery journal or
  `~/.port-daddy/recovered/` and back-fill the `pd note` once the daemon is up.
- Prefer the narrowest verb that fixes the problem. `reset --hard HEAD@{1}`
  beats `reset --hard` to an arbitrary sha; `checkout -- <one file>` beats a
  tree-wide checkout.

## What is NOT a valid escape — for AGENTS

If you are an autonomous agent, **none** of the following is available to
you. They are operator judgement calls, and reaching for them without
explicit operator direction is a defect:

- **`PD_SHIM_OFF=1`** — this is not your escape hatch. It bypasses both the
  shim and the pre-push hook. Using it without the operator explicitly
  saying so is the same class of mistake as `--no-verify`.
- **`--no-verify`** on commit or push — never. It disables a hook the
  operator installed on purpose.
- **Raw git by absolute path** (`/opt/homebrew/bin/git ...`) — this recovery
  path is operator-only and deliberately absent from every skill surface.
  An agent that has "discovered" it should treat that as a signal to stop.

The correct agent behavior when the shim refuses, or when the daemon is
down mid-task, is to **escalate to the operator** and to record the blocker:
`pd note "Blocked: <verb> refused / daemon down. Need operator decision."`
Then hand off. Do not improvise around the guard. The full agent discipline
lives in `skills/port-daddy-agent-skill/references/git-discipline.md`, which
covers salvage-if-dead / wait-if-live / coordinate-if-co-located — and which
pointedly does **not** teach the raw-git path documented here.

## Honest limit: this raises deliberateness, not containment

This is the same caveat ADR-0102 states about itself. Every layer here —
the shim, the pre-push hook, this guide's operator-only framing — runs as
**your** user. A determined process running under the **same UID** as the
operator can do anything the operator can: rename the real git, rewrite the
hook, unset the PATH shim, or call the syscall directly. None of these
controls contain a same-UID adversary.

What they buy is **deliberateness and visibility**: destructive local verbs
require a conscious, absolute-path invocation; protected-history rewrites
require consciously stepping past a hook or the server; and every step is
loud enough to notice and log. That is a real safety improvement for the
actual threat model here (an agent or a tired operator doing the wrong thing
by reflex). It is not a sandbox, and it is not a guarantee. True containment
against a hostile same-UID process needs OS-level isolation (a separate UID,
a jail, a VM), which is out of scope for this guide.

## See also

- `docs/operator/destructive-git-ban.md` — the full list of refused verbs
  and the three enforcement layers.
- `docs/operator/branch-protection-ruleset.md` — the server-side wall.
- `scripts/install-pre-push-hook.sh` — the binary-agnostic hook this guide
  relies on.
- `cli/utils/git-shim.ts` — the advisory shim this path escapes.
- `skills/port-daddy-agent-skill/references/git-discipline.md` — the
  agent-facing discipline (which does not, and must not, mention this path).
