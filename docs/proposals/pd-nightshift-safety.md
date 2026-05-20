# pd nightshift -- safety-net layer

**Status:** Proposal + first implementation, layered on top of PR #143
**Branch:** `feat/nightshift-safety-net` (PRs to `main`)
**Builds on:** `feat/nightshift-first-cut` (PR #143)
**Author:** safety-net follow-up session (2026-05-20)

> **The pitch in one sentence.** PR #143 authorized `--dangerously-skip-permissions` (claude) and `--full-auto --sandbox workspace-write` (codex) as nightshift defaults. This PR builds the ten-layer cake of defenses that has to sit underneath those bypasses before the cron flips on, and is honest about which layers are wired in code vs documented as operator setup.

## Threat model

The autonomous spawn has CLI flags that suppress operator confirmation. We assume the agent is **benign but possibly buggy, confused, or adversarially prompted** (e.g. a poisoned context, a misunderstood intent that escalates to "fix this by deleting the repo"). Defenses below must prevent damage in *those* failure modes -- not just refuse a maliciously-typed `rm -rf /`.

Specifically we are defending against:

1. **Branch / history damage** -- agent pushes to main, force-pushes, rewrites history, deletes refs.
2. **Filesystem escape** -- agent writes outside its worktree (config files, other repos, ~/.ssh, ~/Library).
3. **System mutation** -- agent installs launchd jobs, modifies cron, disables SIP, disables Time Machine.
4. **Network exfil / lateral movement** -- agent reaches cloud metadata, beachheads another service.
5. **Disk / cost exhaustion** -- agent writes a 50 GB file, loops on API calls until the budget cap blows.
6. **Self-approval** -- agent merges its own PR or approves its own review.

## Layer summary

| # | Layer | Wired in this PR | Operator setup required |
|---|---|---|---|
| 1 | Worktree-only execution | ✅ already in `runner.ts` (PR #143) | — |
| 2 | macOS `sandbox-exec` policy | ✅ `lib/nightshift/sandbox-profile.ts` + opt-in via `--really-run` | Read the profile once; understand what's allowed |
| 3 | Git deny-list wrapper | ✅ `bin/git-nightshift` | Runner installs it ahead of PATH at spawn time |
| 4 | Network allowlist (pf) | ⚠️ Documented only -- needs sudo | **You** must install the `pf` rules; see below |
| 5 | Process limits (timeout + ulimit + cost) | ✅ env hint + timeout in runner; adapter enforces `ulimit -f` | Adapter wiring lands when `pd sortie` integration ships |
| 6 | Pre-commit hook | ✅ `lib/nightshift/precommit-hook.sh` | Runner installs it into the worktree's hooks dir at spawn time |
| 7 | Kill switch (`pd nightshift halt/disable/enable/status`) | ✅ `cli/commands/nightshift.ts` extensions | — |
| 8 | Forensic transcripts | ⚠️ PR #140's machinery integrated lazily | Confirm transcript path is honored once #140 lands on main |
| 9 | No-auto-merge | ✅ git wrapper refuses `gh` is out-of-scope here; see "follow-up" | — |
| 10 | CI gate (label + workflow) | ⚠️ Documented only -- requires workflow edit | **You** must add the workflow step described below |

> **What this means for "is it safe to cron-enable?"** Layers 1, 2, 3, 5 (partial), 6, 7, 9 are wired in code with tests. Layers 4 and 10 are operator setup. Layer 8 wires up automatically when PR #140 lands. **The minimum bar before turning on the cron is: operator installs the `pf` allowlist (Layer 4) and the CI label workflow (Layer 10).**

---

## Layer 1: Worktree-only execution

Already enforced in PR #143's `runner.ts`:

- `planRunFor()` returns `worktreePath = ~/coding/tmp/nightshift/<id>/` -- never `/tmp`, never the main repo
- `branchName = night-shift/<slug>-<idShort>` -- never `main`, `master`, or any release branch
- The intent text is passed as a discrete positional arg, never concatenated into a shell string

The pre-commit hook (Layer 6) refuses to allow a commit on any branch outside `night-shift/*`, so even if the agent tries to `git checkout main` mid-run, it cannot commit there.

## Layer 2: macOS `sandbox-exec` policy

`lib/nightshift/sandbox-profile.ts` emits a Seatbelt profile string that the runner wraps the spawn in:

```
/usr/bin/sandbox-exec -p '<profile>' -- claude --dangerously-skip-permissions -p "<intent>"
```

The profile is **default-deny** and explicitly allows:

- `file-read*` on the nightshift worktree, the port-daddy repo (read-only context), and a curated list of system + user-toolchain dirs (`/usr/bin`, `/opt/homebrew`, `~/.cargo`, `~/.npm`, ...).
- `file-write*` **only** on the worktree (and `/dev/null`, `/dev/tty*`).
- `network*` -- network is not filtered at this layer; see Layer 4.
- `process-exec*` with explicit `(deny process-exec* (regex #"(^|/)<bin>$"))` for: `launchctl`, `crontab`, `softwareupdate`, `defaults`, `sudo`, `mount`, `diskutil`, `tmutil`, `pmset`, `csrutil`, `pfctl`, `osascript`, `open`, and ~15 more.

**Defense-in-depth posture.** Codex already enforces `--sandbox workspace-write` on its own. The Seatbelt layer is belt-and-suspenders for codex and **the primary OS-level sandbox for claude**, whose own bypass flag turns off claude's permission system entirely.

**Caveats reviewers must know:**

- `sandbox-exec` is undocumented, deprecated-but-not-removed since macOS 10.7. We rely on it because there is no userspace alternative without sudo. If a future macOS removes it, this layer collapses to "wrapper-trust only."
- The profile is opt-in at the planning layer (`planRunFor(intent, { wrapWithSandboxExec: true })`); the CLI's `--really-run` path turns it on. Tests for `planRunFor` continue to inspect the unwrapped argv, which is what we want.
- A worktree path under `/tmp` or outside `$HOME` is **refused** by `assertSafeWorktreePath()` before the profile is emitted.

## Layer 3: Git deny-list wrapper

`bin/git-nightshift` is a bash wrapper the runner places ahead of the real `git` in the spawn's `PATH`. It pattern-matches argv and refuses:

| Command pattern | Verdict |
|---|---|
| `git push -f` / `--force` / `--force-with-lease` | **refuse** |
| `git push origin main` / `master` (any branch named main/master) | **refuse** |
| `git push --mirror` / `--all` / `--prune` / `--delete` | **refuse** |
| `git push` from a non-`night-shift/*` current branch | **refuse** |
| `git push origin <ref>` where ref is not `night-shift/*` | **refuse** |
| `git reset --hard origin/main` (or master) | **refuse** |
| `git filter-branch`, `git filter-repo` | **refuse** |
| `git update-ref refs/heads/main` (or master, or remotes/*, or tags/*) | **refuse** |
| `git config --global` / `--system` | **refuse** |
| `git config receive.denyDeletes` / `denyNonFastForwards` | **refuse** |
| `git remote add <name> <non-curiositech-url>` | **refuse** |
| `git remote set-url` / `rename` / `remove` / `prune` | **refuse** |
| `git worktree add <path>` where path is outside `~/coding/tmp/` | **refuse** |
| `git clean` with an absolute path | **refuse** |
| `git checkout -b main` / `git switch -b master` | **refuse** |

Everything else passes through to the real git, including `status`, `diff`, `log`, `add`, `commit`, `branch`, and `push origin night-shift/<branch>`.

**Forensics.** Every invocation (refused or allowed) is appended to `$PD_NIGHTSHIFT_TRANSCRIPT` (default `<worktree>/.nightshift/git-audit.log`). Refused calls land with a clear stderr message pointing the operator at this doc.

**Limitation -- this is wrapper-trust, not OS-trust.** A determined agent could call `/usr/bin/git` directly by absolute path. We mitigate that with:

1. The sandbox-exec profile denies `process-exec*` on the basenames we care about most -- but `git` itself is not on that list because the agent legitimately needs `git`. The wrapper is the only thing that distinguishes "good git use" from "bad git use."
2. The pre-commit hook (Layer 6) is installed inside the worktree's hooks dir, so even a direct-`/usr/bin/git` call is caught at commit time.
3. The pre-receive hook on `origin` is the *real* safety net for the worst case (push past the wrapper). **TODO follow-up:** install a server-side pre-receive on the curiositech remote that refuses pushes to `refs/heads/main` from any user, period. That's out of scope here because it needs the repo admin's coordination.

## Layer 4: Network allowlist (operator setup)

macOS does not provide unprivileged per-process network ACLs. Options considered:

- **pf (packet filter)** -- requires `sudo pfctl -e` and a rules file. Documented below.
- **`sandbox-exec` network primitives** -- `(allow network*)` is binary; the `(allow network-outbound (remote ...))` form exists but is poorly documented and brittle. Skipped.
- **Loopback proxy** -- spawn a proxy on a local port and force the agent to use it. Possible but heavier than the value it adds for a single-host setup.

**Recommended pf rules (operator runs this once):**

```pf
# /etc/pf.anchors/com.curiositech.nightshift
# Loaded via /etc/pf.conf: `anchor "com.curiositech.nightshift"` + `load anchor ...`
# Outbound TCP allowed only to these hosts on standard ports.
block out quick on en0 proto tcp from any to any
pass out quick on en0 proto tcp from any to api.anthropic.com port { 443 }
pass out quick on en0 proto tcp from any to api.openai.com port { 443 }
pass out quick on en0 proto tcp from any to api.github.com port { 443 }
pass out quick on en0 proto tcp from any to github.com port { 22, 443 }
pass out quick on en0 proto tcp from any to codeload.github.com port { 443 }
pass out quick on en0 proto tcp from any to registry.npmjs.org port { 443 }
# Block cloud metadata endpoints (catches a class of escape attempts).
block out quick from any to 169.254.169.254
```

Enable with `sudo pfctl -f /etc/pf.conf -e`. Disable with `sudo pfctl -d`.

**Honest gap.** pf rules apply to the whole machine, not just the nightshift spawn. If you want the rules ONLY during nightshift, wrap the runner in a `sudo pfctl -e ... && trap 'sudo pfctl -d' EXIT` shell. That requires the operator to grant nopassword sudo for `pfctl`, which is a separate decision.

## Layer 5: Process limits

Three caps:

1. **Timeout** -- `timeoutMs` defaults to 3h, max 6h. Already enforced by the spawner in PR #143's runner. The runner's `clampTimeout` rejects out-of-range values.
2. **`ulimit -f 1048576`** (1 GB file size cap). The runner sets `PD_NIGHTSHIFT_ULIMIT_F_BYTES=1073741824` in the spawn env so the adapter can apply it via `ulimit -f` before `exec`. **Wiring status:** env var is set; the adapter wiring lands when `pd sortie` integration ships in a follow-up. For the cron-on milestone, the adapter must read this env var and apply the limit; that's a one-line addition.
3. **Cost cap (`budgetUsd`)** -- defaults to $5, max $25 per intent. Enforced today at queue time (intent value clamped) and at the spawn level via the existing bonded-spawn path in `lib/spawner.ts`. Mid-run hard-cap-then-kill is wired by the spawn adapter, not the runner; ditto follow-up.

## Layer 6: Pre-commit hook in the worktree

`lib/nightshift/precommit-hook.sh` -- installed by the runner into `${worktree}/.git/worktrees/<id>/hooks/pre-commit`. Refuses:

- Commits on any branch not matching `night-shift/*` (including `HEAD` detached).
- Commits touching > 50 files (override: `PD_NIGHTSHIFT_MAX_FILES`).
- Commits adding > 5,000 LOC (override: `PD_NIGHTSHIFT_MAX_ADDED`).
- Commits deleting > 100 lines from any single file **unless** the file contains `ALLOW BIG DELETE` OR the commit message body contains an `ALLOW-BIG-DELETE: <reason>` trailer.
- Commits missing the `Spawned-by: nightshift-runner <run-id>` trailer (when `PD_NIGHTSHIFT_ID` is set).

A companion `prepare-commit-msg-hook.sh` injects the `Spawned-by:` trailer automatically. The pre-commit hook is the auditor; prepare-commit-msg is the producer.

**This hook only governs commits in the nightshift worktree.** The main `port-daddy/.git/hooks/pre-commit` is untouched.

## Layer 7: Kill switch

Four new subcommands wired in `cli/commands/nightshift.ts` and `lib/nightshift/control.ts`:

```
pd nightshift halt [id]     # SIGTERM the spawn(s); use --kill for SIGKILL; no id = halt all
pd nightshift disable [--reason "..."]   # touch ~/.pd/nightshift-disabled; runner refuses new spawns
pd nightshift enable        # remove the flag
pd nightshift status        # show kill-switch state + active spawns (pid, elapsed, cost) + recent results
```

**Disable file mechanism.** `~/.pd/nightshift-disabled` is a POSIX flag file. Zero infrastructure required to set it -- if the daemon is wedged at 2am, `touch ~/.pd/nightshift-disabled` still works. The runner reads the flag at the start of each tick via `readDisableState()` and throws if it's present.

**Halt semantics.** SIGTERM by default -- lets the spawn's own cleanup run, transcripts get flushed, the queue row transitions to `aborted`. `--kill` sends SIGKILL for the nuclear case.

**Status output (human format):**

```
$ pd nightshift status
Nightshift: enabled

Active spawns (1):
  abc12345  normalize-design-tokens     pid 64231   $0.83 / $5.00  17 min elapsed (163 min remaining)

Recent (last 5):
  9f8e7d6c  succeeded   landing-bostock-prototype     $4.81
  ...
```

JSON output via `-j` -- same shape as the `NightshiftStatusReport` interface in `lib/nightshift/control.ts`.

## Layer 8: Forensic transcripts

PR #140 is shipping the transcript pipeline (`scripts/` + `lib/spawner.ts` integration). Nightshift consumes that automatically once the spawn adapter wires through `pd sortie` -- nightshift runs *are* sorties under the hood (per PR #143's proposal §"What exists already").

**Until #140 lands**, the git wrapper writes its own per-spawn audit log at `<worktree>/.nightshift/git-audit.log`. That gives us at minimum a record of every git command the agent tried -- which is the highest-value forensic surface for the threats we care about.

## Layer 9: No auto-merge ever

- PRs opened by nightshift must be **draft**. (Wiring: the spawn intent prompt + the adapter both set `--draft`; the operator review step at `pd nightshift review` is the only path to ready-for-review.)
- The git wrapper does not intercept `gh` -- but the sandbox-exec profile and the deny-list overlap here. A follow-up should add `gh` to the wrapper-intercepted list so `gh pr merge` is refused at the same layer as `git push --force`.

**Status:** the draft-only enforcement is in the intent prompt scaffolding (not in this PR's diff -- it lands when the spawn adapter ships). The wrapper-side `gh` refusal is a TODO.

## Layer 10: CI gate (operator setup)

`Spawned-by: nightshift-runner <run-id>` trailers in commit messages give CI a label to grab. Recommended workflow step in `.github/workflows/ci.yml`:

```yaml
- name: Label nightshift PRs
  if: github.event_name == 'pull_request'
  run: |
    if git log -n1 --format=%B | grep -q '^Spawned-by: nightshift-runner '; then
      gh pr edit "${{ github.event.pull_request.number }}" --add-label 'nightshift:awaiting-review'
    fi
- name: Tag CI failures on nightshift PRs
  if: failure() && github.event_name == 'pull_request'
  run: |
    if git log -n1 --format=%B | grep -q '^Spawned-by: nightshift-runner '; then
      gh pr edit "${{ github.event.pull_request.number }}" --add-label 'nightshift:ci-failed'
    fi
```

**Wiring status:** documented here, NOT wired into the workflow file in this PR. The CI workflow lives in `.github/workflows/` and rewriting it from a feature branch tends to invite unrelated CI churn. The operator (or a follow-up PR scoped to CI) should add the step above.

---

## Per-layer wired-vs-stubbed status

| Layer | Wired (code + tests) | Documented operator-setup | Gap to acknowledge |
|---|---|---|---|
| 1 | ✅ | — | None |
| 2 | ✅ (sandbox-profile.ts + opt-in flag) | — | `sandbox-exec` is deprecated; if Apple removes it we fall back to wrapper-trust |
| 3 | ✅ (git-nightshift + 20 refusal tests) | — | Wrapper-trust, not OS-trust; mitigated by Layer 6 + sandbox |
| 4 | ❌ (no code) | ✅ pf rules in this doc | **Operator must `sudo pfctl` once before cron** |
| 5 | ⚠️ (env hint set; adapter applies `ulimit`) | — | Adapter wiring lands when sortie integration ships |
| 6 | ✅ (precommit + prepare-commit-msg + tests) | — | None |
| 7 | ✅ (halt / disable / enable / status + tests) | — | None |
| 8 | ⚠️ (git-audit.log only until #140) | — | Full transcript wiring blocked on #140 |
| 9 | ⚠️ (draft-only via intent prompt) | — | `gh pr merge` refusal not yet in wrapper |
| 10 | ❌ (no workflow edit) | ✅ yaml in this doc | **Operator must paste the workflow step** |

## Operator pre-flight checklist before turning the cron on

```
[ ] cat lib/nightshift/sandbox-profile.ts          # read the profile once
[ ] pd nightshift status                            # confirm "enabled", nothing running
[ ] sudo pfctl -f /etc/pf.conf -e                   # turn on the network allowlist
[ ] paste the CI workflow step into .github/workflows/ci.yml
[ ] confirm ~/.pd/nightshift-disabled does NOT exist (or is intentional)
[ ] pd nightshift propose "a small no-op intent" && pd nightshift run <id> --really-run
    # watch it run end-to-end once with eyes on
[ ] only AFTER that one-shot succeeds: enable the cron entry in pd-fleet.yml
```

## The one or two layers I would not turn the cron on without

1. **Layer 4 (pf network allowlist).** The agent can call any HTTP endpoint on the open internet through claude or codex. The sandbox-exec profile does not restrict network. If you want defense against exfil + lateral movement, the pf rules in §Layer 4 are the only OS-level enforcement we have. Don't cron-enable until those are loaded.
2. **Layer 5's adapter `ulimit -f` wiring.** The env var hint is set, but the adapter needs to read it and call `ulimit` before exec. Until that's wired, the 1 GB file-size cap is advisory. The cost cap and timeout still hold, so the worst case is "an agent writes a single 50 GB file to its worktree before timing out." That fills disk but doesn't escape the worktree. Acceptable for a first cron, but worth fixing within the first week.

Everything else has a test, a refusal path, or both.
