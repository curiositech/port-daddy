# Antigravity CLI (`agy`) — Interactive Hook Wiring

`agy` (Antigravity CLI, approximately v1.0.12) is the live replacement for the
tier-dead `gemini` binary. It ships a **Claude-shaped JSON hook engine** but
auto-loads its hook config from `~/.gemini/hooks.json`.

## Config surface — already global

| Scope | Path | Notes |
|-------|------|-------|
| Home (the only one) | `~/.gemini/hooks.json` | **HOME-scoped — already global.** No user/project split. Interactive sessions read it directly. |

Because the load path is home-scoped, wiring `agy` automatically covers every
directory; there is no separate per-repo config to also write.

> Note: this file is `~/.gemini/hooks.json` (a dedicated hooks file), distinct
> from the `gemini` CLI's `~/.gemini/settings.json`. They do not collide.

## Events & block contract

- Uses **Claude-named events** (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`).
- Block contract: stdin `{ toolName, toolInput }` (camelCase) → stdout
  `{"hookSpecificOutput":{"decision":"block","message":"<why>"}}`.
  The `pd-hook-pre-tool` tentacle detects the camelCase shape and emits this
  deny-JSON automatically.

## Broad tool matcher

Antigravity surfaces a wide set of mutation tools; match all of them:

```
Edit|Write|MultiEdit|write_to_file|replace_file_content|replace|write_file|edit|apply_patch
```

## Exact JSON shape

Write into `~/.gemini/hooks.json` (use real expanded `$HOME`):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "/Users/USER/.port-daddy/bin/pd-hook-prompt" } ] }
    ],
    "PreToolUse": [
      { "matcher": "Edit|Write|MultiEdit|write_to_file|replace_file_content|replace|write_file|edit|apply_patch",
        "hooks": [ { "type": "command", "command": "/Users/USER/.port-daddy/bin/pd-hook-pre-tool" } ] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write|MultiEdit|write_to_file|replace_file_content|replace|write_file|edit|apply_patch",
        "hooks": [ { "type": "command", "command": "/Users/USER/.port-daddy/bin/pd-hook-post-tool" } ] }
    ]
  }
}
```

## Idempotent upsert with `jq`

```sh
HOOKS="$HOME/.gemini/hooks.json"
PD_BIN="$HOME/.port-daddy/bin"
MATCH="Edit|Write|MultiEdit|write_to_file|replace_file_content|replace|write_file|edit|apply_patch"
mkdir -p "$(dirname "$HOOKS")"
[ -f "$HOOKS" ] || echo '{}' > "$HOOKS"
cp "$HOOKS" "$HOOKS.bak"

jq \
  --arg prompt   "$PD_BIN/pd-hook-prompt" \
  --arg pretool  "$PD_BIN/pd-hook-pre-tool" \
  --arg posttool "$PD_BIN/pd-hook-post-tool" \
  --arg matcher  "$MATCH" '
  def strip(arr): [ arr[]? | select(
      ([ .hooks[]?.command // empty ] | map(test("pd-hook-")) | any) | not) ];
  .hooks = (.hooks // {})
  | .hooks.UserPromptSubmit = ( strip(.hooks.UserPromptSubmit) + [ { hooks: [ { type:"command", command:$prompt } ] } ] )
  | .hooks.PreToolUse  = ( strip(.hooks.PreToolUse)  + [ { matcher:$matcher, hooks: [ { type:"command", command:$pretool } ] } ] )
  | .hooks.PostToolUse = ( strip(.hooks.PostToolUse) + [ { matcher:$matcher, hooks: [ { type:"command", command:$posttool } ] } ] )
' "$HOOKS.bak" > "$HOOKS"

jq '.hooks | keys' "$HOOKS"
```

## Verification

Drive a live `agy` session to edit a path locked by another actor. The camelCase
gate should return the deny-JSON `{"hookSpecificOutput":{"decision":"block", ...}}`
and the edit is blocked. Because the config is home-scoped, this should hold in
any directory.
