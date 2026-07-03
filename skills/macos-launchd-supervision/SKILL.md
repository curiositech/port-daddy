---
name: macos-launchd-supervision
description: >-
  Author correct macOS launchd plists for long-lived local daemons and design the EXTERNAL
  supervision-integrity check that catches what KeepAlive cannot self-heal: the supervising job
  itself getting unloaded. Use when writing or reviewing a LaunchAgent/LaunchDaemon plist,
  debugging a daemon that "silently died" after a brew upgrade or logout, choosing LaunchAgent vs
  LaunchDaemon, or fixing launchd's minimal-PATH "command not found" failures. NOT for
  systemd/Linux unit files, Windows services, Docker healthchecks, or the daemon's own business
  logic (see daemon-development).
license: Apache-2.0
allowed-tools: Read,Write,Edit,Bash,Grep,Glob
metadata:
  category: Infrastructure & DevOps
  tags:
    - launchd
    - macos
    - plist
    - daemon-supervision
    - keepalive
  provenance:
    kind: first-party
    owners:
      - port-daddy
  pairs-with:
    - skill: daemon-development
      reason: Supplies the daemon's own lifecycle, graceful shutdown, and IPC once launchd supervises it correctly.
    - skill: macos-host-security
      reason: Supplies entitlements, code signing, and sandboxing concerns adjacent to a launchd job.
    - skill: port-daddy-internal-dev
      reason: Home of the real `pd doctor supervision-integrity` precedent (PR #607) this skill generalizes.
  io-contract:
    kind: deliverable
    consumes:
      - kind: launchd-job-plan
        format: json
    produces:
      - kind: plist-lint-report
        format: json
      - kind: annotated-plist
        format: markdown
---

# macOS Launchd Supervision

Author launchd jobs that actually stay supervised, and build the external check that notices when they don't.

## Use This For

- Writing a LaunchAgent or LaunchDaemon plist for a long-lived local daemon (Label, ProgramArguments, RunAtLoad, KeepAlive, ThrottleInterval, log paths).
- Deciding LaunchAgent (`~/Library/LaunchAgents`, per-user GUI session) vs LaunchDaemon (`/Library/LaunchDaemons`, system-wide, no user session).
- Debugging "the daemon silently died and nothing restarted it" — almost always a supervisor that got unloaded, not a KeepAlive bug.
- Designing an EXTERNAL supervision-integrity check, modeled on `pd doctor`, that verifies the *supervisor* is loaded — something KeepAlive cannot verify about itself.
- Fixing launchd's minimal-PATH environment causing `command not found` for tools that work fine in a terminal.

## Do Not Use This For

- systemd unit files, Windows service registration, or any non-Darwin service manager — different lifecycle model entirely.
- Docker/container healthchecks and restart policies.
- The daemon's own business logic, protocol, or graceful-shutdown handling — see `daemon-development`.

## Process

```mermaid
flowchart TD
  A[Define job: Label + ProgramArguments] --> B{GUI session needed?}
  B -->|per-user, login items, Aqua| C[LaunchAgent: ~/Library/LaunchAgents/label.plist]
  B -->|system-wide, boots before login| D[LaunchDaemon: /Library/LaunchDaemons/label.plist]
  C --> E[RunAtLoad true + KeepAlive tuned + ThrottleInterval >= 10s]
  D --> E
  E --> F[StandardOutPath/StandardErrorPath to a durable log dir, never /tmp]
  F --> G[Pin PATH: absolute ProgramArguments[0] or EnvironmentVariables.PATH]
  G --> H[launchctl bootstrap gui/UID or system label.plist]
  H --> I{External supervision-integrity check}
  I -->|supervisor loaded, daemon reachable| J[ok]
  I -->|supervisor loaded, daemon unreachable| K[warn: kickstart the job]
  I -->|supervisor label absent: brew upgrade, logout, bootout| L[critical: nothing will resurrect it]
  L --> M[Re-bootstrap the supervisor, then verify again]
```

1. Decide Agent vs Daemon first: does the job need a logged-in GUI session (Aqua, notifications, keychain UI) or must it run before/without any user session? That answer decides the install location, not preference.
2. Write the plist: unique reverse-DNS `Label`, absolute-path `ProgramArguments`, `RunAtLoad=true` so it survives reboot/login, `KeepAlive` shaped to intent (bare `true`, or `{SuccessfulExit:false, Crashed:true}` to avoid restart-looping a clean exit), `ThrottleInterval >= 10` to stop thrash.
3. Route `StandardOutPath`/`StandardErrorPath` to a durable directory — `~/Library/Logs/<app>/` for an Agent, `/Library/Logs/<app>/` or `/var/log/<app>/` for a Daemon. Never `/tmp` or `/private/tmp`.
4. Pin the runtime environment: launchd jobs start with `PATH=/usr/bin:/bin:/usr/sbin:/sbin` and no shell profile. Use absolute paths in `ProgramArguments` or set `EnvironmentVariables.PATH` explicitly.
5. Lint the plan with `scripts/plist_lint.mjs` before you ever run `launchctl bootstrap`.
6. Load it with the modern `launchctl bootstrap gui/$(id -u) <plist>` (Agent) or `launchctl bootstrap system <plist>` (Daemon) — not the deprecated `load`/`unload`.
7. Add an EXTERNAL supervision-integrity check, separate from both the daemon and its KeepAlive stanza, that runs `launchctl list <label>` for every legitimate supervisor label on a schedule or on `doctor`/health-check invocation, and classifies severity (ok / warn / critical) — because KeepAlive only acts while the job is loaded, and it cannot detect its own absence.

## Output Contract

`scripts/plist_lint.mjs` returns:

- `pass` — boolean, true only when zero `critical` findings remain.
- `findings` — array of `{ severity: "critical"|"warning", code, message }`, one per detected defect.
- `recommendations` — array of concrete fix strings, one per finding, in the same order.

Use `scripts/plist_lint.mjs` to lint a launchd job plan (JSON matching `schemas/launchd-plan.schema.json`) and get a deterministic pass/fail with actionable findings before you ship a plist.

## Anti-Patterns

### KeepAlive Means It'll Always Restart

**Novice**: Sets `KeepAlive: true` and treats the daemon as permanently self-healing — "launchd's got it."
**Expert**: `KeepAlive` only supervises *while the job is loaded*. A `brew upgrade`, a user logout, a `launchctl bootout`, or a corrupted plist unloads the job entirely, and nothing resurrects the daemon until something re-bootstraps the supervisor itself. Port Daddy hit this for real: Homebrew's `KeepAlive` on `homebrew.mxcl.port-daddy` supervised the daemon perfectly — until `brew upgrade` churn unloaded the job, and the daemon died silently with zero supervisors watching. The fix (PR #607) was `pd doctor supervision-integrity`: an external, 3-tier severity check (`ok` / `warn` / `critical`) that queries `launchctl list <label>` for every legitimate supervisor label, independent of the daemon's own health.
**Detection**: A plist with `KeepAlive` set and no separate process, cron, or `doctor` command that periodically confirms the supervisor label itself is still loaded — grep for `KeepAlive` with no companion `launchctl list` call anywhere in the codebase.

### Logging To /tmp

**Novice**: `StandardOutPath` and `StandardErrorPath` point at `/tmp/mydaemon.log` "because logs are temporary anyway."
**Expert**: macOS purges `/tmp` and `/private/tmp` on a schedule and on every reboot. The one log that would explain a boot-time crash is gone before anyone reads it — especially cruel because boot-time failures are exactly when you need durable logs. Use `~/Library/Logs/<app>/` for a LaunchAgent or `/Library/Logs/<app>/` / `/var/log/<app>/` for a LaunchDaemon.
**Detection**: `grep -E 'StandardOutPath|StandardErrorPath' *.plist` shows a value starting with `/tmp` or `/private/tmp`.

### Trusting Shell PATH Inside A launchd Job

**Novice**: `ProgramArguments: ["node", "server.js"]`, assuming `node` resolves the way it does in Terminal.
**Expert**: launchd jobs start with a minimal environment (`PATH=/usr/bin:/bin:/usr/sbin:/sbin`) and never source `.zshrc`/`.bash_profile`. Homebrew-installed binaries, `nvm` shims, and anything on a custom `PATH` all 404 as "command not found" even though `which node` works fine interactively. Use an absolute path (`/opt/homebrew/bin/node`) as `ProgramArguments[0]`, or set `EnvironmentVariables.PATH` explicitly in the plist.
**Detection**: `ProgramArguments[0]` is a bare command name (no leading `/`) and the plist has no `EnvironmentVariables.PATH` key.

## References

| File | Load When |
| --- | --- |
| `references/plist-field-reference.md` | Need the exact meaning and failure semantics of each plist key before writing one. |
| `references/agent-vs-daemon-and-integrity.md` | Need to decide LaunchAgent vs LaunchDaemon, or design a supervision-integrity check. |
| `examples/expected-output.md` | Need a worked example: a real annotated plist plus its lint report. |
| `templates/output-template.md` | Need a reusable skeleton for a plist-plus-lint deliverable. |
| `schemas/launchd-plan.schema.json` | Need to validate a launchd job plan before running the linter. |
| `scripts/plist_lint.mjs` | Need deterministic linting of a launchd job plan. |
| `agents/openai.yaml` | Need a subagent descriptor for delegated launchd plist authoring/review. |

<!-- BEGIN BUNDLE INDEX (auto: index_references.py) -->

## Skill Bundle Index

*Every file in this skill, and when to open it. Auto-generated; run `scripts/index_references.py --fix`.*

**root**
- [`CHANGELOG.md`](CHANGELOG.md) — macOS Launchd Supervision — Changelog — - Initial skill creation - Core process defined - Reference files and deterministic plist_lint script added
- [`README.md`](README.md) — macOS Launchd Supervision — Author correct launchd plists for long-lived local daemons, and design the external supervision-integrity check that catches what `KeepAlive

**`agents/`**
- [`agents/openai.yaml`](agents/openai.yaml) — openai (data/schema)

**`examples/`**
- [`examples/expected-output.md`](examples/expected-output.md) — Example Output: macOS Launchd Supervision — Scenario: Port Daddy's own daemon (`pd start --foreground`) needs a LaunchAgent that survives `brew upgrade` churn, logs durably, and is che
- [`examples/sample-input.json`](examples/sample-input.json) — sample input (data/schema)

**`references/`**
- [`references/agent-vs-daemon-and-integrity.md`](references/agent-vs-daemon-and-integrity.md) — LaunchAgent vs LaunchDaemon, and the Supervision-Integrity Pattern — Use this when deciding where a job lives, or when designing a check that verifies the supervisor itself.
- [`references/plist-field-reference.md`](references/plist-field-reference.md) — Plist Field Reference — Use this when writing or reviewing the actual `.plist` keys, not just the high-level plan.

**`schemas/`**
- [`schemas/launchd-plan.schema.json`](schemas/launchd-plan.schema.json) — launchd plan.schema (data/schema)

**`scripts/`**
- [`scripts/plist_lint.mjs`](scripts/plist_lint.mjs)

**`templates/`**
- [`templates/output-template.md`](templates/output-template.md) — Launchd Supervision Plan — - Label: `[reverse-DNS label]` - Placement: `[agent | daemon]` — because `[GUI-session need / boot-time need]` Run: Paste the lint report an

<!-- END BUNDLE INDEX -->
