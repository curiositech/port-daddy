# Claude Code (`claude`) — Bounded Interactive Hook Wiring

Source: https://code.claude.com/docs/en/hooks

Port Daddy writes its entries to the opted-in project's
`.claude/settings.json`. Claude runs all matching hooks in parallel, so do not
also add the same PD entries at user scope.

## Active PD events

- `UserPromptSubmit` -> `pd-hook-prompt`
- `PreToolUse` -> `pd-hook-pre-tool`

The pre-tool matcher is `Edit|Write|MultiEdit|NotebookEdit|Bash|mcp__port-daddy__.*`:
the four edit tools feed the lock gate; `Bash` and the Port Daddy MCP tools
are matched so the ADR-0132 halt sentinel (`~/.port-daddy/HALT`) can refuse
`pd` invocations and Port Daddy MCP calls during a halt. Both commands have a
one-second deadline. The pre-tool gate uses Claude's blocking contract: write
the reason to stderr and exit 2.

Port Daddy does not install a `PostToolUse` observer. Running a process after
every edit multiplied latency and duplicate traces without changing a decision.
The stable `pd-hook-post-tool` path is staged only as a silent, zero-work
tombstone for a Claude process that cached an older configuration.

## Installation and verification

Use `pd hooks install`. It preserves unrelated hooks, deduplicates PD entries,
removes historical PD PostToolUse registrations, and writes absolute wrapper
paths under `~/.port-daddy/bin/`. Never copy the raw tentacles over those
wrappers because that bypasses project gating, deadlines, and circuit breakers.

In a real interactive session, attempt to edit a path claimed by another actor.
The pre-tool hook should block once. Confirm that a single event produces one PD
start record and that no PD command remains under `PostToolUse`.
