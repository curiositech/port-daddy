# Codex CLI (`codex`) — Bounded Interactive Hook Wiring

Sources:
- https://developers.openai.com/codex/hooks
- https://github.com/openai/codex/issues/17532 (historical project-hook loading report)

## Compatibility posture: one scope, never two

Current Codex supports trusted project hook layers. Port Daddy nevertheless
keeps its interactive blocks in the user-level `~/.codex/config.toml` for
compatibility with older clients that did not consistently load repo-local
hooks. The wrapper then performs the exact per-project opt-in check.

Do not install a second copy in a project hook layer. Codex launches every
matching hook concurrently; user plus project registration is multiplication,
not fallback. Interactive Codex presents a one-time trust flow when a hook's
command hash changes.

Trust posture:
- **Headless** `codex exec` requires `--dangerously-bypass-hook-trust` to run untrusted hooks.
- **Interactive** sessions use an in-TUI trust flow (approve the hook once in the UI).

## Config surfaces

| Scope | Path | Interactive? |
|-------|------|--------------|
| User (PD compatibility anchor) | `~/.codex/config.toml` | **YES — use this once** |
| Project hook layer | project config | **Supported; do not duplicate the PD block here** |

Hooks can live as inline `[[hooks.PreToolUse]]` blocks in `config.toml`, or in a
sibling `hooks.json`. We use inline TOML in the user-level file.

## Active events and matcher

- `UserPromptSubmit` → `pd-hook-prompt`
- `PreToolUse` → `pd-hook-pre-tool`

The matcher is deliberately limited to mutation tools:
`apply_patch|Edit|Write|edit|write|str_replace_editor`.

Do not add `shell` or `run_shell_command`: those broad names put a synchronous
process in front of ordinary read-only inspection.

Note: the `pd-hook-pre-tool` tentacle extracts file targets from inside an
`apply_patch` body using the `*** Update File:` / `*** Add File:` /
`*** Delete File:` / `*** Move to:` markers, so matching `apply_patch` is enough
to gate Codex's primary edit path.

There is no interactive PD `PostToolUse` block. Per-tool observation caused
unbounded process fan-out and duplicated cumulative evidence already available
through claims, notes, transcripts, and the daemon stream. The staged stable
`pd-hook-post-tool` remains a zero-work tombstone for provider processes that
cached an older registration.

## Block contract

Codex accepts BOTH:
- snake_case hook input (`tool_name` …) → exit 2 + stderr block (universal contract).
- Codex *app-server* camelCase input (`toolName` …) → exit 0 + stdout deny-JSON.

The tentacle auto-selects the right dialect; no per-CLI config needed.

## Exact TOML shape (user-level, global)

The installer produces this shape in `~/.codex/config.toml` with a real,
expanded home path:

```toml
[[hooks.UserPromptSubmit]]
[[hooks.UserPromptSubmit.hooks]]
type = "command"
command = "/Users/USER/.port-daddy/bin/pd-hook-prompt"
timeout = 1
async = false

[[hooks.PreToolUse]]
matcher = "apply_patch|Edit|Write|edit|write|str_replace_editor"
[[hooks.PreToolUse.hooks]]
type = "command"
command = "/Users/USER/.port-daddy/bin/pd-hook-pre-tool"
timeout = 1
async = false
```

## Idempotent installation

Use `pd hooks install`; do not hand-append TOML. The installer preserves non-PD
hooks, removes historical PD PostToolUse blocks, replaces its fenced section
idempotently, and writes the project gate metadata used by the stable wrapper.

## Verification

In an interactive Codex session, approve the hook once, then ask Codex to
`apply_patch` a file claimed by another actor. The gate should block. Confirm
that one event produces one PD start record and that config contains no PD
PostToolUse entry. Calling the stable post-tool path directly must exit 0 with
no output, debug record, daemon request, or circuit transition.
