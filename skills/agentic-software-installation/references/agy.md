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

- Uses **Claude-named events**. Port Daddy enables only `UserPromptSubmit` and
  `PreToolUse`; it deliberately removes its historical `PostToolUse` observer.
- Block contract: stdin `{ toolName, toolInput }` (camelCase) → stdout
  `{"hookSpecificOutput":{"decision":"block","message":"<why>"}}`.
  The `pd-hook-pre-tool` tentacle detects the camelCase shape and emits this
  deny-JSON automatically.

## Broad tool matcher

Antigravity surfaces a wide set of mutation tools; match all of them:

```
Edit|Write|MultiEdit|write_to_file|replace_file_content|multi_replace_file_content|replace|write_file|edit|apply_patch
```

## Exact JSON shape

The installer produces this shape in `~/.gemini/hooks.json` with a real,
expanded home path:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "/Users/USER/.port-daddy/bin/pd-hook-prompt", "timeout": 1 } ] }
    ],
    "PreToolUse": [
      { "matcher": "Edit|Write|MultiEdit|write_to_file|replace_file_content|multi_replace_file_content|replace|write_file|edit|apply_patch",
        "hooks": [ { "type": "command", "command": "/Users/USER/.port-daddy/bin/pd-hook-pre-tool", "timeout": 1 } ] }
    ]
  }
}
```

## Idempotent installation

Use `pd hooks install`; do not hand-merge the home-scoped JSON. The installer
preserves unrelated hooks, removes only PD-marked historical entries (including
PostToolUse), and adds one bounded prompt and pre-tool registration.

## Verification

Drive a live `agy` session to edit a path locked by another actor. The camelCase
gate should return the deny-JSON `{"hookSpecificOutput":{"decision":"block", ...}}`
and the edit is blocked. Because the config is home-scoped, this should hold in
any Port Daddy-enabled directory and no-op elsewhere. Confirm no PD command
remains in `PostToolUse`; the installed stable post-tool wrapper is only a
zero-work compatibility tombstone for an already-running provider.
