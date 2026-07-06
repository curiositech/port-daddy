# Codex CLI (`codex`) — Interactive Hook Wiring

Sources:
- https://developers.openai.com/codex/hooks
- https://github.com/openai/codex/issues/17532

## WARNING — repo-local hooks do NOT fire in interactive sessions

> **openai/codex#17532:** Hooks defined in a **repo-local** `.codex/config.toml`
> are NOT loaded by **interactive** Codex sessions. They are silently ignored.
> To get the tentacles firing interactively, you MUST put the hook config in the
> **USER-LEVEL** `~/.codex/config.toml`.

This is the single most important fact for this CLI. If a previous install wrote
only `.codex/config.toml` in a repo, interactive coordination is dead — move the
blocks to `~/.codex/config.toml`.

Trust posture:
- **Headless** `codex exec` requires `--dangerously-bypass-hook-trust` to run untrusted hooks.
- **Interactive** sessions use an in-TUI trust flow (approve the hook once in the UI).

## Config surfaces

| Scope | Path | Interactive? |
|-------|------|--------------|
| User (global) | `~/.codex/config.toml` | **YES — use this** |
| Repo | `.codex/config.toml` | **NO (issue #17532)** |

Hooks can live as inline `[[hooks.PreToolUse]]` blocks in `config.toml`, or in a
sibling `hooks.json`. We use inline TOML in the user-level file.

## Events & matcher

- `UserPromptSubmit` → `pd-hook-prompt`
- `PreToolUse` → `pd-hook-pre-tool`
- `PostToolUse` → `pd-hook-post-tool`
- `SessionStart` also available.

Matcher is a regex over **tool names**. Codex tool names to match:
`apply_patch|edit|write|shell|run_shell_command`.

Note: the `pd-hook-pre-tool` tentacle extracts file targets from inside an
`apply_patch` body using the `*** Update File:` / `*** Add File:` /
`*** Delete File:` / `*** Move to:` markers, so matching `apply_patch` is enough
to gate Codex's primary edit path.

## Block contract

Codex accepts BOTH:
- snake_case hook input (`tool_name` …) → exit 2 + stderr block (universal contract).
- Codex *app-server* camelCase input (`toolName` …) → exit 0 + stdout deny-JSON.

The tentacle auto-selects the right dialect; no per-CLI config needed.

## Exact TOML shape (user-level, global)

Append to `~/.codex/config.toml` (use real expanded `$HOME` for `command`):

```toml
[[hooks.UserPromptSubmit]]
[[hooks.UserPromptSubmit.hooks]]
type = "command"
command = "/Users/USER/.port-daddy/bin/pd-hook-prompt"
timeout = 10

[[hooks.PreToolUse]]
matcher = "apply_patch|edit|write|shell|run_shell_command"
[[hooks.PreToolUse.hooks]]
type = "command"
command = "/Users/USER/.port-daddy/bin/pd-hook-pre-tool"
timeout = 10

[[hooks.PostToolUse]]
matcher = "apply_patch|edit|write|shell|run_shell_command"
[[hooks.PostToolUse.hooks]]
type = "command"
command = "/Users/USER/.port-daddy/bin/pd-hook-post-tool"
timeout = 10
```

## Idempotent install (block-replacement, marker = `pd-hook-`)

TOML is array-of-tables; the simplest safe idempotent approach is to strip any
existing PD blocks (lines from a `[[hooks.` header through the block that
references `pd-hook-`) and re-append. Back up first.

```sh
CFG="$HOME/.codex/config.toml"
PD_BIN="$HOME/.port-daddy/bin"
mkdir -p "$(dirname "$CFG")"
[ -f "$CFG" ] || : > "$CFG"
cp "$CFG" "$CFG.bak"

# Remove any prior PD-managed hook section, then re-append a fresh one.
# PD blocks are fenced between these sentinel comments for clean idempotent edits.
awk '
  /^# >>> port-daddy tentacles >>>/ {skip=1}
  skip==0 {print}
  /^# <<< port-daddy tentacles <<</ {skip=0}
' "$CFG.bak" > "$CFG"

{
  printf '\n# >>> port-daddy tentacles >>>\n'
  printf '[[hooks.UserPromptSubmit]]\n[[hooks.UserPromptSubmit.hooks]]\ntype = "command"\ncommand = "%s/pd-hook-prompt"\ntimeout = 10\n\n' "$PD_BIN"
  printf '[[hooks.PreToolUse]]\nmatcher = "apply_patch|edit|write|shell|run_shell_command"\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = "%s/pd-hook-pre-tool"\ntimeout = 10\n\n' "$PD_BIN"
  printf '[[hooks.PostToolUse]]\nmatcher = "apply_patch|edit|write|shell|run_shell_command"\n[[hooks.PostToolUse.hooks]]\ntype = "command"\ncommand = "%s/pd-hook-post-tool"\ntimeout = 10\n' "$PD_BIN"
  printf '# <<< port-daddy tentacles <<<\n'
} >> "$CFG"
```

The sentinel-fence approach makes re-running fully idempotent: the `awk` pass
deletes the old fenced section, then the heredoc rewrites it. Non-PD config
above/below the fence is untouched.

## Verification

In an **interactive** `codex` session (NOT `codex exec`), approve the hook in the
TUI trust prompt, then ask Codex to `apply_patch` a file locked by another actor.
The gate should block (deny-JSON if app-server, exit-2 stderr if hooks shape).
If nothing fires, confirm the config is in `~/.codex/config.toml` and NOT a
repo-local `.codex/config.toml` (issue #17532).
