# The Squid Hook Plugin System

Companion doc to [ADR-0051](../adr/0051-port-daddy-harness.md) (the Port Daddy
Harness) — describes how a third tentacle capability was added on top of the
existing 3 built-in ones (`pd-hook-prompt`, `pd-hook-pre-tool`,
`pd-hook-post-tool`) **without editing any Giant Squid source file**.

## Why this exists

Two packaging bugs, fixed back to back, established the pieces this system is
built from:

1. **The tentacle staging fix** (release.yml — "stage squid tentacles into the
   release tarball"): `lib/squid/adapter.ts`'s `tentaclePath()` resolves each
   built-in tentacle at `<install-root>/bin/<name>` — a `bin/` *subdirectory*
   of wherever Port Daddy is installed, not flat like the daemon binary. Once
   the release pipeline actually staged that `bin/` subdirectory into the
   shipped tarball, `<install-root>/bin/` became a real, addressable directory
   on every installed machine — not just a dev-repo path.
2. **`scripts/validate-critical-binaries.mjs`**: a manifest-driven gate that
   fails a release if a declared `dist/` artifact is missing, undersized, or
   not executable — added to all three packaging jobs so the *next* thing that
   should ship in `bin/` doesn't silently go missing the way the tentacles
   once did.

With `bin/` reliably staged and release-verified, it became straightforward to
ask: what if `bin/` could hold hooks Port Daddy itself doesn't know about?
That's the plugin system below — the extension point the tentacle-staging fix
was quietly a prerequisite for.

## The contract

A plugin tentacle is two files, side by side, in the **same `bin/` directory**
the 3 built-ins live in:

```
bin/
  pd-hook-prompt              <- built-in
  pd-hook-pre-tool            <- built-in
  pd-hook-post-tool           <- built-in
  pd-hook-lint-gate           <- your plugin's executable
  pd-hook-lint-gate.hook.json <- your plugin's declaration
```

- The executable: any file starting with `pd-hook-` that isn't one of the 3
  built-in names. It receives the same lifecycle-event JSON on stdin the
  built-ins do (shape depends on which vendor fired it — see ADR-0051 and
  `bin/pd-hook-pre-tool` for the multi-vendor JSON dialects already handled),
  and answers with the same contract: `exit 0` to allow, `exit 2` (+ stderr)
  or the vendor-specific JSON deny shape to block.
- The sidecar (`<name>.hook.json`): a small JSON file declaring which
  lifecycle point the plugin binds to:

  ```json
  {
    "purpose": "postTool",
    "displayName": "Lint gate",
    "description": "Runs lint after a file mutation and surfaces failures.",
    "privacy": "Reads tool output locally; does not transmit it anywhere."
  }
  ```

  `purpose` is required and must be one of `"prompt"`, `"preTool"`, or
  `"postTool"` — the same 3 lifecycle points the built-ins bind to (turn-start,
  before a tool runs, after a tool runs). `displayName`, `description`, and
  `privacy` are optional; each falls back to a generic default naming the
  plugin file if omitted (see `discoverPluginHooks` in
  `lib/squid/hook-shape.ts`).

A sidecar with no matching executable, invalid JSON, or a missing/invalid
`purpose` is **skipped with a console warning, not thrown** — one broken
plugin declaration must never take down the built-in tentacles or any other
plugin. A `bin/` directory with zero sidecars (the default — every existing
Port Daddy install today) discovers nothing and behaves byte-for-byte as
before this system existed.

## What "auto-discover and register" actually means

Nothing needs to be told about a new plugin. Dropping the two files above into
`bin/` is sufficient because every place a hook gets wired already asks
`lib/squid/hook-shape.ts`'s `discoverPluginHooks(binDir)` "what plugins are
here?" and folds the answer in additively:

- **The 4 headless vendor adapters** (`ClaudeCliSquidAdapter`,
  `GeminiSquidAdapter`, `CodexSquidAdapter`, `AntigravitySquidAdapter` in
  `lib/squid/adapter.ts`) each call `discoverPlugins()` — which discovers
  against `tentacleBinDir()`, the *same* root-resolution `tentaclePath()` uses
  — inside `injectHooks()`, and append one matcher-group entry per plugin
  under whichever native event name its declared `purpose` maps to for that
  vendor. The 3 built-in entries are unaffected; a plugin is *only* an
  addition to what's already written.
- **`pd hooks install`** (`cli/commands/hooks-install.ts`) discovers plugins
  in the repo `bin/` at staging time (`stageTentacles`), copies each plugin's
  binary + sidecar into `~/.port-daddy/bin/squid/` and a gate wrapper +
  sidecar copy into `~/.port-daddy/bin/` — identically to how the 3 built-ins
  are staged — so the interactive-session installer wires plugins into
  `.claude/settings.json` / `.codex/config.toml` / `.gemini/settings.json` /
  `~/.gemini/hooks.json` the same way it wires the built-ins, via the shared
  `buildJsonHookMap` / `codexHooksTomlBlock` builders in `hook-shape.ts`.
- **`assertTentaclesPresent()`** additionally verifies every discovered
  plugin's binary exists and is executable before any adapter spawns a
  vendor CLI, exactly like it does for the 3 built-ins.

Because discovery is a pure function of "what's in `bin/`," a plugin dropped
into a packaged install's `<install-root>/bin/` — the directory the tentacle
staging fix established as real and release-verified — is picked up on the
next spawn with **zero code changes and zero redeploy**.

## Per-vendor event mapping (what `purpose` resolves to)

| `purpose` | Claude Code | Gemini CLI | Codex CLI | Antigravity (agy) |
|---|---|---|---|---|
| `prompt` | `UserPromptSubmit` | `BeforeAgent` | `UserPromptSubmit` | `UserPromptSubmit` |
| `preTool` | `PreToolUse` | `BeforeTool` | `PreToolUse` | `PreToolUse` |
| `postTool` | `PostToolUse` | `AfterTool` | `PostToolUse` | `PostToolUse` |

A `preTool`/`postTool` plugin gets the same tool-matcher the built-ins use for
that vendor (e.g. Claude's `Edit|Write|MultiEdit|NotebookEdit`, Codex's wider
`Bash|apply_patch|...` set — see `hook-shape.ts` for the exact per-vendor
strings). A `prompt` plugin gets no matcher, matching the built-in prompt
hook, since `UserPromptSubmit`-class events fire unconditionally.

## Worked example

```bash
cat > bin/pd-hook-lint-gate <<'EOF'
#!/bin/sh
# Read the lifecycle event JSON on stdin, run your check, exit 2 to block.
event="$(cat)"
# ... your logic ...
exit 0
EOF
chmod +x bin/pd-hook-lint-gate

cat > bin/pd-hook-lint-gate.hook.json <<'EOF'
{
  "purpose": "postTool",
  "displayName": "Lint gate",
  "description": "Runs lint after a file mutation and surfaces failures.",
  "privacy": "Reads tool output locally; does not transmit it anywhere."
}
EOF
```

Run `pd hooks install` (or let a headless squid adapter spawn normally) —
`pd-hook-lint-gate` now fires on `PostToolUse` for every wired vendor,
alongside the built-in `pd-hook-post-tool`, with no other change.

## Known limitations (v1)

- **Purpose-only binding.** A plugin picks one of the 3 existing lifecycle
  points and inherits that vendor's existing tool matcher — it cannot declare
  a custom matcher, a new lifecycle event Port Daddy doesn't already bind to,
  or per-vendor overrides. This keeps the discovery contract small and safe;
  widening it is a natural follow-up once a real plugin needs it.
- **`diagnoseSquidHookInstall` does not yet report on plugins.** `pd squid
  hooks diagnose` currently only verifies the 3 built-in tentacles are wired
  with correct metadata. Verify a plugin is wired by inspecting the target
  vendor's config file directly (`.claude/settings.json`, etc.) until
  diagnose coverage is extended.
- **No revocation/allowlist.** Any `pd-hook-*.hook.json` sidecar in `bin/` is
  trusted and wired automatically — there is no signature check or approval
  gate. Treat `bin/` with the same trust boundary as the rest of the Port
  Daddy install; a malicious file dropped there has the same reach a
  malicious built-in tentacle would.

## Where the code lives

- `lib/squid/hook-shape.ts` — `discoverPluginHooks()`, and the `plugins`
  parameter on `buildJsonHookMap()` / `codexHooksTomlBlock()` (the single
  source of truth both injection paths share).
- `lib/squid/adapter.ts` — `tentacleBinDir()` (the shared root resolution),
  `discoverPlugins()`, and the plugin-folding loop in each vendor's
  `injectHooks()`.
- `cli/commands/hooks-install.ts` — plugin staging in `stageTentacles()`, and
  plugin discovery against the staged dir in `configureTarget()`.
- `tests/unit/squid-harness.test.ts` — the `Giant Squid Harness — plugin
  tentacle auto-discovery` suite, including an end-to-end test that drops a
  real plugin into the repo's actual `bin/` and proves `injectHooks()` wires
  it with no code changes.
