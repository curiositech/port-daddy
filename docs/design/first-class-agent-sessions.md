# First-class agent sessions

A Port Daddy session is the durable projection of an accepted spawn receipt plus the provider conversation. It is not a process row and not a second launcher.

OpenAI's Codex CLI docs frame terminal work as resumable sessions, and the current README points there [Codex CLI README](https://github.com/openai/codex/blob/main/codex-rs/README.md), [Codex CLI](https://developers.openai.com/codex/cli). Anthropic's Claude Code CLI exposes `-p`, `--bg`, `-c`, and `-r` for non-interactive, background, continue, and resume flows [Claude Code CLI reference](https://code.claude.com/docs/en/cli-usage). Port Daddy keeps that ergonomics, but the session object stays authoritative.

## Contract

- One stable session ID maps to one accepted receipt.
- Predecessor and successor lineage are immutable at admission.
- The header must show state, freshness time, daemon endpoint, provider or model, worktree, workdir, and budget.
- The timeline must show prompts, responses, tools, approvals, progress, artifacts, and terminal evidence.
- The inspector must show permissions, sandbox, connectors, memory, and retention state.
- The roster must distinguish active, attention, no-runtime, terminal, and archived sessions.
- `Join session` is primary for a live runtime; `Continue` creates and opens one linked successor when the prior run is terminal or has no runtime.
- Restart reconciliation must preserve the same durable session and refresh its evidence from the receipt store.

## Required fields

| Field | Why it matters |
|---|---|
| Identity | Stable session ID, receipt ID, and provider thread or run ID |
| Lineage | Predecessor, successor, and continuation reason |
| Lifecycle | Exact state plus freshness source and timestamp |
| Location | Repository, worktree, absolute workdir, selected daemon endpoint |
| Activity | Transcript, event cursor, approvals, and artifacts |
| Accounting | Tokens, elapsed time, cost, budget, and bond |
| Controls | Join live runtime, continue as successor, interrupt, cancel, and archive |

## Rules

- Do not infer a live session from a row that merely looks active.
- Do not infer completion from a vanished process.
- Do not mutate a predecessor into a successor; continuation is always a new successor with a preserved link.
- Terminal sessions stay visible and collectible until retention expires them.
- Session state must reconcile with the receipt store after daemon restart or client reconnect.
- The session state vocabulary mirrors [spawn lifecycle](../operations/spawn-lifecycle.md); a session that cannot prove a child PID plus fresh heartbeat is not live.

## Surface

- Roster: state, freshness, lineage, and where the work is running.
- Transcript: prompts, responses, tools, and progress.
- Inspector: permissions, sandbox, connectors, memory, and accounting.
- Controls: join live runtime; continue terminal or no-runtime work as one linked successor; interrupt, cancel, and archive.

## See also

- [Spawn lifecycle](../operations/spawn-lifecycle.md)
- [Daemon and supervision](../operations/daemon-and-supervision.md)
