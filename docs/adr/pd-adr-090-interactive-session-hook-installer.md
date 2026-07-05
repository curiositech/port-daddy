# pd-adr-090. Interactive-session hook installer — squid tentacles in every CLI, every directory

## Status

Accepted

## Context

The Giant Squid Harness (pd-adr-092) injects three "tentacle" hook scripts —
`pd-hook-prompt`, `pd-hook-pre-tool`, `pd-hook-post-tool` — into a vendor CLI's
native hook surface so Port Daddy coordination (lock gating + pheromone trails)
fires inside the vendor's own agent loop. Until now the harness wired tentacles
only for **headless spawned** runs: `claude -p`, `gemini -p`, `codex exec`,
`agy -p`. An engineer sitting in an **interactive** `claude` / `codex` / `gemini`
/ `agy` REPL got no coordination — the most common way humans actually drive
these tools was unguarded.

Two things were missing:

1. **Interactive surfaces.** The same hook config also governs interactive
   sessions, but nothing wrote it there as a normal part of onboarding.
2. **Every directory.** Per-repo config only protects one repo. To make
   coordination fire wherever the user runs an agent CLI, the config must live
   at the **user (home) level**, which every interactive session reads.

A per-CLI caveat shaped the design: Codex hooks placed in a **repo-local**
`.codex/config.toml` do **not** fire in interactive sessions
([openai/codex#17532](https://github.com/openai/codex/issues/17532)); only
user-level `~/.codex/config.toml` works interactively. So "user-level by default"
is not just convenient — for Codex it is the only correct interactive surface.

The tentacles themselves (`bin/pd-hook-*`, `lib/squid/*`) are owned by the squid
program and were, at authoring time, still on a feature branch. This installer
therefore had to be a **consumer**, not an owner: it must never edit the
tentacle scripts, only stage and reference them.

## Decision

Add a thin installer layer, `cli/commands/hooks-install.ts`, exposed as
`pd hooks install` and invoked silently from `pd init` and interactively from
`pd setup` (default **Yes**, auto-detecting installed CLIs).

1. **Stage to a stable absolute path.** Copy the three tentacles from
   `<root>/bin/pd-hook-*` to `~/.port-daddy/bin/pd-hook-*` (the same convention
   as the git shim, ADR git-shim). Interactive sessions run from arbitrary cwds
   and config may be user-level, so hooks must point at an absolute, always-present
   path. The installer never reimplements or edits the tentacles; if they are
   absent on the current build it reports that and writes nothing (no hooks
   pointing at a missing path).

2. **Auto-detect.** Probe `claude`, `codex`, `gemini`, `agy` with `command -v`;
   configure only what is present.

3. **User-level by default (global).** Write each detected CLI's user-level
   config so coordination fires in every directory. `pd init` additionally
   writes the current repo's project-level config for CLIs that have a useful
   project-interactive surface (Claude, Gemini).

4. **Per-CLI surfaces and shapes:**

   | CLI | user-level surface | events | format |
   |-----|--------------------|--------|--------|
   | Claude Code | `~/.claude/settings.json` | UserPromptSubmit / PreToolUse / PostToolUse | JSON, `matcher` regex |
   | Codex | `~/.codex/config.toml` | UserPromptSubmit / PreToolUse / PostToolUse | TOML, fence-delimited block |
   | Gemini | `~/.gemini/settings.json` | BeforeAgent / BeforeTool / AfterTool | JSON, `matcher` regex |
   | agy (Antigravity) | `~/.gemini/hooks.json` | UserPromptSubmit / PreToolUse / PostToolUse | JSON (Claude-shaped), home-scoped |

5. **Idempotent upsert.** JSON surfaces: per event, drop prior entries whose
   command references a `pd-hook-` path, keep all other (user-authored) hooks,
   then add ours. Codex TOML: a sentinel-fenced block
   (`# >>> port-daddy hooks ... # <<<`) is stripped and re-appended, preserving
   surrounding user TOML — no TOML parser dependency.

6. **Codex caveat encoded.** Codex has **no** project surface in this installer
   (`projectConfigPath = null`); it is user-level only, per #17532.

`pd hooks list` shows detection + wiring status; `pd hooks uninstall` removes
Port Daddy entries from every surface.

## Consequences

- Coordination now fires in interactive sessions of all four CLIs, in every
  directory, with a single Yes at `pd setup` or automatically on `pd init`.
- The installer is decoupled from the squid program: it consumes `bin/pd-hook-*`
  but owns none of it. When those scripts are not yet on a build, the feature
  degrades transparently ("tentacles not found — update Port Daddy") rather than
  wiring a broken path.
- Two implementations of the per-CLI hook **shape** now exist: the squid adapter
  (headless spawn) and this installer (interactive). They must stay in sync on
  event names and tool matchers. A future consolidation could have the squid
  adapter import the shape table from this module, or vice versa.
- Companion: the `agentic_software_installation` skill documents the per-CLI
  surfaces, exact shapes, and the #17532 caveat for any agent doing this by hand.

## References

- pd-adr-092 — Giant Squid Harness (tentacle injection, headless spawn)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Codex hooks](https://developers.openai.com/codex/hooks) · [openai/codex#17532](https://github.com/openai/codex/issues/17532)
- [Gemini CLI hooks](https://geminicli.com/docs/hooks/)
