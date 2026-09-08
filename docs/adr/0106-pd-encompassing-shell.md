# 0106. PD-Encompassing Shell — Harness-Agnostic Tool Observation via PATH Shims

## Status

Draft (proposed 2026-05-22).

Numbering risk: same collision pattern as noted in ADR-0039. `0040` chosen
on the assumption that `0036` is bosun (PR #130, in-flight) and `0039` is
suggestibility (this batch).

## Context

PD's coordination story today has rich primitives at the *daemon HTTP layer*
(sessions, claims, channels, inbox, attention) but the observation boundary
ends where the HTTP API ends. Inside a session, an agent's tool calls —
git, npm, cargo, cat, sed, awk, curl, rg, jq, anything — execute against
the local OS with no PD round-trip and no audit. PD knows you started a
session; it does not know what you've actually been doing inside it.

ADR-0037 §Layer 1 partially closes this for git: a `pd-shim` wrapper
intercepts git verbs, classifies them by mutation severity, soft-broadcasts
overlap warnings via the ambient context broker, and hard-refuses
destructive verbs without override. The shim works because git is invoked as
a subprocess regardless of which harness or human triggered it — the
observation boundary is the OS-process boundary, not the harness API
boundary. **That's the key insight to generalize.**

The operator's framing on 2026-05-22:

> I'm starting to think we need an honest-to-god pd shell that our agents
> all operate inside of.
>
> [on Claude-Code-tinted framing] — Come on man. [Be harness-agnostic.]

A per-harness integration (Claude Code hooks, codex pre-call hooks, Aider
plugins, Cursor extensions) requires N integrations for N harnesses and a
new one for every future harness. A PATH-prepended shim layer requires zero
harness integration because every harness already invokes tools via
subprocess. The harness API does not need to know PD exists.

## Decision

Three composing layers. The first is the substrate; the second is the
ergonomics; the third is the safety.

### Layer 1 — `pd-shim` generalized to arbitrary tools

A new directory `~/.port-daddy/shims/<session-id>/` is created per active
session. It contains symlinks for each tool the session's policy declares
shim-worthy: `git`, `npm`, `cargo`, `cat`, `sed`, `awk`, `curl`, `gh`, `rg`,
`jq`, `find`, `grep`, `cp`, `mv`, `rm`. Each symlink points at a single
runtime binary `~/.port-daddy/bin/pd-shim-run`.

`pd-shim-run` resolves its own basename to determine the tool, then:

1. Resolves the real binary via `/usr/bin/which -a <tool>` minus the shim
   directory. Cached per-tool in the shim dir.
2. Emits a `tool.invoked` activity event with `{tool, argv, cwd, agentId,
   sessionId, startedAt}` (async insert, non-blocking).
3. Looks up the tool's verb taxonomy. Tool verb taxonomies are declared in
   `~/.port-daddy/shim-policy/<tool>.yml`:

   ```yaml
   tool: git
   verbs:
     read-only:    [status, log, diff, show, blame, branch --list, worktree list]
     local-mut:    [add, restore, stash push, mv, rm]
     destructive: [reset --hard, clean -f, cherry-pick, checkout -- <path>, revert]
     network:      [push, push --force]
   ```

4. Routes by category — the same matrix ADR-0037 defines for git, now
   per-tool: read-only passes through silently (still logged); local-mut
   broadcasts soft-claim warnings via the context broker (Primitive 3 of
   ADR-0039 plugs into this); destructive hard-refuses without
   `PD_SHIM_OFF=1`; network refuses if `pd done` was not called.
5. `execve()` the real binary so `pid`/`stdin`/`stdout`/`stderr`/`exit code`
   are transparent to the caller.

Tools not in policy pass through with logging only — no coordination
checks. Operators add tool taxonomies incrementally; the default starter
set ships with git (from ADR-0037), npm, cargo, gh, rm/cp/mv.

### Layer 2 — `pd shell` as session-bound subshell

`pd shell` is a thin wrapper that:

1. Calls `pd begin` if no session is active; resumes the session otherwise.
2. Composes PATH: `~/.port-daddy/shims/<session-id>/:$PATH`. The shim dir is
   created on demand from the session's shim policy.
3. Sets ambient env: `PD_SESSION_ID`, `PD_AGENT_ID`, `PD_HARBOR`,
   `PD_PROJECT_DIR`.
4. Sources the operator's normal shell init (`~/.zshrc` / `~/.bashrc`) so
   prompts, aliases, history, completions all keep working.
5. Adds a small `pd-shell-prompt` hook (PROMPT_COMMAND / precmd) that:
   - Polls `pd attention --peek --json --limit 5` between commands
   - If new items, prints a one-line summary above the next prompt
   - Pressing `<Enter>` on an empty line runs `pd attention` (mark-read +
     full output)
6. On exit (or `pd done`), tears down the shim dir, ends the session
   cleanly, emits a final `session.end` event with command-count and
   duration.

The result: a session-scoped subshell where every tool invocation is
observed, every coordination check is enforced at the tool level (not
the harness level), and every inbox item lands in the next prompt without
the operator having to remember to poll.

This is what the operator calls "the PD-encompassing shell." It's not a
new REPL — it's `$SHELL` plus PATH composition plus ambient session
binding plus an attention poll on the prompt loop.

### Layer 3 — Harness adoption (no API integration required)

Because the shim layer operates at the OS-process boundary, harnesses get
observation for free *if they exec tools via the shimmed PATH*. Two paths
to that:

1. **Harness's working directory has the shim PATH composed.** Easy to
   guarantee: set the harness's PATH env when it starts. The harness
   itself needs no awareness.
2. **The shim runtime is symlinked from system paths.** More invasive but
   covers harnesses that ignore PATH and shell out via absolute path.
   Not recommended by default.

Concretely, Claude Code today executes Bash tool calls in a subshell that
inherits PATH from its parent. If the parent is `pd shell`, every Bash tool
call inherits the shimmed PATH. Same for codex (it shells out via
`workspace-write` to a subprocess that inherits the parent's env), Aider,
Cursor's terminal pane. No per-harness code.

Harnesses that *don't* shell out — that call tools via direct API (e.g.,
some IDE plugins that use a Git library binding directly instead of git
subprocess) — bypass the shim. That's a real gap, mitigated by:
- Documenting "if your harness has a git library binding, prefer the git
  subprocess path for PD-observed sessions"
- Future ADR for an MCP-style observation channel that those harnesses
  can opt into directly

## What this unlocks

- **Every tool invocation on the activity firehose.** Closes the
  "silent commands" gap the operator called out: ambient observability
  for the full work surface, not just daemon-bound mutations.
- **ADR-0039 suggestion broker has rich input.** The classifier
  fingerprint (§Primitive 1 of ADR-0039) gains `tool.invoked` events as
  a high-signal data source. "This agent ran `cargo build` and then
  `rg 'fleet::dispatch'` and then `git diff lib/dispatch.rs`" is a much
  stronger topic signal than `pd notes` alone.
- **Soft-claim broadcasts work for non-git tools.** Two agents both
  about to `npm install` in adjacent worktrees see a heads-up.
- **Destructive verbs across the toolchain get the same shim guarantee.**
  `rm -rf <somewhere>`, `git reset --hard`, `cargo clean --release` all
  hit the destructive policy table without each one being a per-tool
  integration.
- **Per-tool, per-agent, per-verb cost attribution.** "Which agent ran
  `cargo build` 47 times last hour?" is a SQL query against the activity
  table.

## What this does NOT do

- **Does not replace `$SHELL`.** `pd shell` sources your existing rc,
  inherits your existing prompt, your aliases, your history. It composes
  PATH and binds a session. That's it. Operators who prefer to invoke
  shims explicitly (`pd-shim git status`) without entering `pd shell` can
  do that; the shell is the ergonomic wrapper, not a replacement.
- **Does not block on the network.** All shim emit-events are async
  inserts; the shim never delays the tool's execution. Coordination checks
  for soft-claim are sub-millisecond local lookups; destructive-verb
  refusals are local policy checks.
- **Does not require the daemon to be running.** The shim degrades to
  passthrough + local file logging when the daemon is unreachable. On
  daemon recovery, the file log is replayed into the activity table.

## Risks

1. **Latency cost on tool calls.** A `cat` in a tight loop can be called
   1000s of times per session. The fast-read path (read-only verbs skip
   the claim lookup, emit a single batched event) is non-optional.
   Latency budget: <2ms per shim invocation. Bench this before shipping
   the read-only verbs into policy by default.

2. **Shim escape via absolute paths.** Sophisticated agents (or
   adversarial ones) can `/usr/bin/git ...` to bypass the shim. Document
   as a known limitation; offer `PD_SHIM_STRICT=1` mode that uses fanotify
   (Linux) or DTrace (macOS) to catch absolute-path invocations of policied
   tools, at higher overhead. Not default.

3. **Shim policy file drift.** Tool verb taxonomies evolve (git adds new
   subcommands). Policy files must be versioned and reviewed. Likely
   fleet-config-ui surface for browsing/editing.

4. **Shell startup cost.** `pd shell` invoking `pd begin` adds ~300ms to
   shell startup. Mitigation: persistent shell support (`pd shell --resume
   <session>` skips the begin), and the prompt-loop attention poll uses
   the cached `--peek` path with a 5s TTL.

5. **`pd-shim` collision with shim-style aliases.** Operator may already
   have `alias git=git-pd` or similar; shim composes the PATH so symlinks
   in the shim dir win over aliases. Document override pattern.

## Migration

- Layer 1 ships as a new `pd shim` verb family with no policy active by
  default. Operators opt in by adding to `~/.port-daddy/shim-policy/*.yml`
  or via `pd-fleet.yml`.
- Layer 2 ships as `pd shell` verb. Existing workflows untouched. The
  operator's normal terminal continues to work; `pd shell` is opt-in.
- Layer 3 is documentation only — no code change. The harness-agnostic
  guarantee is `$SHELL` inheriting the shimmed PATH; this is achieved by
  starting the harness from within `pd shell`.

## Open questions

- **Tool policy distribution.** Should starter policies for common tools
  (git, npm, cargo, rm) ship with the binary, or be fetched from a tap-
  managed registry? Probably ship a starter set with the binary, allow
  override via `~/.port-daddy/shim-policy/`.
- **Windows.** Shim symlinks are trivial on Unix. Windows requires
  cmd.exe / pwsh shims. Defer; Windows support follows mainline parity.
- **MCP / direct-API harness gap.** Harnesses that don't shell out
  (Cursor's in-process git bindings, some VSCode extensions) bypass the
  shim entirely. Long-term: an MCP observation resource those harnesses
  can opt into. Out of scope here.

## Composes with

- ADR-0037 — git-shim is the first instance of the general pattern; this
  ADR formalizes the substrate.
- ADR-0039 (suggestibility) — `tool.invoked` events are a high-signal
  input to the topical classifier; the shell's prompt-loop attention poll
  is a delivery surface for suggestions.
- `pd attention` (PR #169) — the prompt-loop polls it; the shell is the
  human-driven counterpart to harness SessionStart hooks.
- ADR-0030 (talent phonebook) — `pd whois <slug>` becomes useful inside
  the shell as a tab-completable verb; the shell is the natural REPL for
  it.
