# ADR-0119 — Provenance-Gated Git Guard: No Agent-Mintable Escape

- **Status:** Proposed
- **Date:** 2026-07-22
- **Supersedes (in part):** the `PD_SHIM_OFF=1` escape mechanism introduced with ADR-0037 (git access control) and carried into the pre-push hook.
- **Related:** ADR-0037 (git access control + pd feature verbs), ADR-0040 (pd encompassing shell), ADR-0093 (event-spawn trust substrate), Articles of Agreement (agent conduct), the coordination-guard enforce ladder.

## Context

Port Daddy bans destructive git verbs from agent bodies through two layers:

1. **Layer 1 — the git shim** (`~/.port-daddy/bin/git`, source `cli/utils/git-shim.ts`): a PATH-ahead wrapper that intercepts working-tree-destructive verbs (`add -A`, `reset --hard`, `checkout -- .`, `clean -fd`, `stash push/save`, `rebase`, force-push) and consults `pd guard check` before letting the real binary run.
2. **Layer 2 — the pre-push hook** (`scripts/install-pre-push-hook.sh` → `.git/hooks/pre-push`): refuses force-pushes to protected branches and mass-delete pushes. Its stated value is that it "survives PD_SHIM_OFF=1 because git always runs pre-push hooks regardless of which binary called it" — i.e. it is meant to be the *durable* layer the shim is not.

Both layers honor a single escape: the environment variable **`PD_SHIM_OFF=1`**. An audit of that escape found it is not a safety valve — it is a hole through the entire defense, and worse, a **documented** one:

- **It is agent-mintable.** `PD_SHIM_OFF` is an ordinary environment variable. Any body — including a spawned agent running at the operator's UID — sets it with a single `export` and both layers stand down. The escape requires nothing the agent cannot produce itself.
- **It punches through *both* layers.** The pre-push hook — the supposed durable second wall — also checks `PD_SHIM_OFF` (install-pre-push-hook.sh:50) and stands down. So the "second layer" is bypassed by the same one-liner as the first. The two-layer defense collapses to a single agent-settable flag.
- **It has no legitimate internal consumer.** Port Daddy's own privileged git flow, the harbormaster, does not use it — it explicitly *deletes* it from the child environment ("never run with PD_SHIM_OFF, even if the parent had it set", `lib/harbormaster.ts:567`). pd's own code treats the escape as a hazard to defend against, not a tool it needs.
- **It is taught to agents.** `PD_SHIM_OFF=1` is written into three agent-facing skill documents (`port-daddy-agent-skill/references/git-discipline.md`, `port-daddy-agent-skill/decisions/skip-coordination-when.md`, `port-daddy-internal-dev/SKILL.md`) and echoed in two denial surfaces (`guard.ts:994`, the pre-push hook's own stderr). The skills an agent reads at spawn hand it the bypass and, in one file, a decision tree for *when* to reach for it.

The operator's objection is the correct security instinct: **a control whose bypass is documented to the controlled party is not a control.** An agent that knows an in-band escape exists will, under pressure (a blocked commit, a failing guard), reach for it — the same way a reflexive `git add -A` reaches past a claim boundary. The only bypass with no failure mode is the one the agent has never heard of and cannot mint.

## Decision

**Remove the agent-mintable, agent-documented `PD_SHIM_OFF` escape from every layer and every agent-facing surface. Replace the two-layer model with an honest split between *advisory hygiene* and *binary-agnostic enforcement*, and name the true containment boundary as off-box.**

### 1. Layer 1 (shim) — advisory hygiene, no in-band escape

- Delete the `PD_SHIM_OFF` block from `git-shim.ts`. The shim consults `pd guard check` and, on denial, tells the agent only what to do *inside* the rules ("coordinate first — `pd begin`, claim the files, then retry"). It names no escape, and its readable body contains no magic constant to discover.
- Working-tree hygiene (`add -A`, `reset --hard`) is **advisory**: its purpose is to stop a *reflexive* mistake, not to contain a determined adversary. The operator's genuine emergency path is to invoke the real binary by absolute path (`/opt/homebrew/bin/git …`) — a step that is operator knowledge, is documented in *no* agent-facing surface, and (critically) still passes through Layer 2.

### 2. Layer 2 (pre-push hook) — enforcement, no escape at all

- Delete the `PD_SHIM_OFF` bypass from the pre-push hook. Force-push-to-protected-branch and mass-delete refusal must hold **regardless of environment**, because the hook is binary-agnostic (it fires even from raw `/opt/homebrew/bin/git`). This is the layer whose whole value is being un-bypassable-locally; honoring an env flag destroyed that value. Removing it means even the operator's raw-git escape cannot casually force-push `main`.
- The hook's stderr names no bypass.

### 3. Agent-facing surfaces — scrub

- Remove every mention of `PD_SHIM_OFF` (and any equivalent in-band escape) from the three skill docs and both denial messages. Where the docs currently teach "when to bypass," they instead teach "there is no in-band bypass; coordinate, or escalate to the operator." The Articles-of-Agreement posture is preserved: a clause the agent might route around is not a control.

### 4. Regression fixture — keep it removed

- A red-team test asserts, and keeps asserting, the invariants: no `PD_SHIM_OFF` string survives in the shim body, the pre-push hook, the guard denial path, or any agent-facing skill doc; and — functionally — that setting `PD_SHIM_OFF=1` in the environment does **not** cause a refused verb to run. A future re-introduction fails CI.

## Honest limits (what this does NOT claim)

This ADR refuses to sell containment it cannot deliver — that would be the theater the enforce ladder exists to prevent.

- **Same-UID is not a boundary.** On a single-user machine an agent runs at the operator's UID. It can call the real git binary by absolute path (skipping Layer 1), and `git push --no-verify` skips the pre-push hook (Layer 2). No local mechanism can cryptographically contain a same-UID process — that is an OS-isolation problem (separate UID, sandbox/ESF per `macos-host-security`, or a VM), explicitly out of scope here.
- **Therefore the real wall is off-box.** The only chokepoint an agent's local git cannot skip is the remote: **GitHub branch protection / a server-side pre-receive gate** that re-derives coordination facts from the pushed commit itself. Force-push protection on `main` (the single-ruleset cutover already in place) is the enforcement of record; the local hook is fast, courteous early feedback, not the wall.
- **What we actually achieve here** is precise and worth doing: eliminate the *reflexive, documented, agent-mintable* escape that collapsed both local layers into one flag, and make the local defense honest about which half is advisory and which is enforced. We remove the bypass an agent would *find and use*; we do not pretend to have caged an adversary who already owns the UID.

## Consequences

- Agents lose a one-line escape they were being taught; blocked work now routes through coordination or an explicit operator escalation, which is the intended behavior.
- The operator retains a real emergency path (raw git by absolute path) that is undocumented to agents and still honors protected-branch enforcement.
- The pre-push hook becomes genuinely durable rather than nominally so.
- Follow-up (separate ADR, if a *sanctioned* operator escape is ever wanted in-band): a daemon-minted, TTY-only, single-use, loudly-audited bypass token — never a static env var, never a constant in a readable script — issued only to an interactive `pd` call and validated daemon-side. Deferred, because "raw git by absolute path" already covers the operator's real need without any agent-reachable surface.

## Test Plan

- Unit/red-team fixture (new) asserting the four string-absence invariants and the one functional invariant above; runs in CI.
- Manual: in a claimed session, `git add -A` is refused with an escape-free message; `PD_SHIM_OFF=1 git add -A` is *also* refused (no longer honored); `PD_SHIM_OFF=1 git push --force origin main` is refused by the pre-push hook; `/opt/homebrew/bin/git add -A` succeeds (operator escape) but `/opt/homebrew/bin/git push --force origin main` is still refused by the hook.
- Re-shim verification on the operator's machine: after re-install, `~/.port-daddy/bin/git` contains no `PD_SHIM_OFF` block and ordinary `git status`/`git add <path>`/`git commit` continue to work.
