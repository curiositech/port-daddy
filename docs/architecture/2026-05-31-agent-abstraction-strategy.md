# Unified Agent Abstraction Strategy — across Port Daddy, Claude Code, Codex, Gemini

**Status:** PROPOSED — design spike, not yet implemented
**Date:** 2026-05-31
**Author:** architecture-fork sub-agent of the release-engineer (parent: port-daddy:architecture:agent-abstraction)
**Scope:** docs only. No code changes. No CLI changes. No file changes outside this directory.
**Forcing function:** the operator wants a "release-engineer" agent to ship as a first-class artifact. Before we ship it as a one-off, decide the abstraction it lives inside.

---

## TL;DR

1. **The three CLI ecosystems have converged.** Claude Code, Codex CLI, and Gemini CLI all ship subagents as Markdown files with YAML frontmatter under `.{runtime}/agents/*.md` (project) and `~/.{runtime}/agents/*.md` (user), discoverable inside plugins / extensions. The frontmatter fields differ in name but cover the same shape: identity + description + tools + model + (sometimes) hooks/mcp/permissions.
2. **Port Daddy already has the canonical model — and it is more correct than any of them.** ADR-0028 (Actor / Fleet Agent / Session) and `docs/shipwright/AGENT-MODEL.md` (the "Plane") name three orthogonal concepts the runtime vendors all conflate: a durable role + mailbox (actor), an optional process embodiment (fleet agent / subagent), and an ephemeral file-claiming work-slice (session). The CLI vendors only model the middle layer.
3. **PD agents and Claude Code subagents are NOT the same thing.** They are different layers of the same stack. A Claude Code subagent is a *body* — a `pd spawn --backend claude-cli` invocation, scoped to one task, no persistence beyond the transcript. A PD agent is a *soul* — durable identity, mailbox, file-claim authority, supervision contract. Treating them as interchangeable is the root of the operator's "is `cartographer` an agent or an actor?" confusion. They should stay distinct, with one explicit lowering from soul → body per runtime.
4. **Recommended source-of-truth format: PD persona YAML.** The existing `skills/port-daddy-agent-skill/agents/*.yaml` format (`name`, `identity`, `backend`, `model`, `prologue`, `system_prompt`, `allowed_tools`, `stop_conditions`) is already a superset of every runtime's frontmatter. Shipwright already proposes archetypes against this shape via `lib/shipwright/archetypes.ts`. We extend Shipwright with **emitters** — one per runtime — that lower a single persona YAML into `.claude/agents/<name>.md`, `.codex/agents/<name>.md`, `.gemini/agents/<name>.md`, and a `pd-fleet.yml` agent block. The persona YAML is the truth; the markdown files are build artifacts (generated, gitignored or committed-as-derived).
5. **Release-engineer ships as that first instance.** One persona YAML at `skills/port-daddy-agent-skill/agents/release-engineer.yaml` + a thin emitter step + a `pd ship release-engineer` invocation path. Per-runtime mirrors land at `.claude/agents/release-engineer.md`, `.codex/agents/release-engineer.md`, `.gemini/agents/release-engineer.md`, plus a `pd-fleet.yml` entry for daemon-driven background runs. All four point back to the same persona file; the operator never edits four copies.

---

## Question 1 — Are Port Daddy agents identical to Claude Code sub-agents?

### Current state

**Port Daddy.** ADR-0028 defines three layers. The relevant ones here:

- **Actor (Layer 1, durable):** `lib/actor-roster.ts` defines ten canonical actors (`gardener`, `qa`, `test-hunter`, `documentarian`, `simplifier`, `coxswain`, `quartermaster`, `cartographer`, `spark`, `spider`). Each has a stable ID, mailbox at `actor:<id>`, owned surface, mission. **Survives daemon restart.**
- **Fleet agent (Layer 2, process):** A running binary or `pd spawn` child. Embodies an actor. Lives in the OS process table. **Dies when the process dies.** Declared in `pd-fleet.yml` or spawned on demand. `lib/spawner.ts` is the SDK; `lib/fleet-engine.ts` is the supervisor.

Spawn shapes today:
- `pd spawn --backend claude-cli --persona <file>.yaml` — imperative, one-shot or scheduled.
- `pd sortie run` — sortie rows in SQLite, full transcripts, budget caps, auto-wired coordination (ADR-0028 dogfood loop, `feedback_dogfood_via_pd_sortie.md`).
- `pd-fleet.yml` agent blocks — declarative, daemon-managed, trigger-based.

**Claude Code.** `code.claude.com/docs/en/sub-agents` defines subagents as Markdown files at:

| Location | Scope | Priority |
|---|---|---|
| Managed settings | Org-wide | 1 (highest) |
| `--agents` CLI flag (JSON) | Session | 2 |
| `.claude/agents/` | Project | 3 |
| `~/.claude/agents/` | User | 4 |
| Plugin `agents/` directory | Where plugin is enabled | 5 |

Frontmatter fields: `name` (required), `description` (required), `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `effort`, `isolation` (`worktree`), `color`, `initialPrompt`. Plugin subagents are *denied* `hooks`, `mcpServers`, and `permissionMode` for security.

A Claude Code subagent **runs in its own context window, returns a summary, cannot spawn other subagents, and does not persist across sessions** (transcripts persist on disk but the identity does not have a mailbox).

### Gap

The vendor concept (Claude Code subagent) maps cleanly to PD **Layer 2** (fleet agent / body). It has **no analogue for Layer 1** (actor / soul) and **no analogue for Layer 3** (session, file claims). That is why operators kept asking the operator's question — "is `cartographer` an agent or an actor?" — the vendors do not even acknowledge the distinction exists.

| Layer | PD name | Claude Code name | Codex CLI name | Gemini CLI name |
|---|---|---|---|---|
| 1 — durable role + mailbox | actor | (none) | (none) | (none) |
| 2 — process embodiment | fleet agent | subagent | subagent | subagent |
| 3 — ephemeral work-slice | session | (transcript, no claims) | (transcript, no claims) | (transcript, no claims) |

### Recommendation

**Keep them separate. Lower, never unify.** The vendor subagent is one of many possible bodies for a PD actor. A `release-engineer` actor in `lib/actor-roster.ts` is the soul. A `.claude/agents/release-engineer.md` file is one body. A `pd spawn --backend codex` invocation is another body. A human running `pd begin --identity release-engineer:repo:port-daddy` is a third body. They all write to the same soul's mailbox, file claims, and notes.

This matches what `docs/shipwright/AGENT-MODEL.md` already calls "the Plane": souls live in the daemon, bodies attach via HTTP/IPC, identity is stable across body churn.

### Concrete next step

Add a section to `docs/shipwright/AGENT-MODEL.md` titled "Bodies in the wild — Claude Code, Codex, Gemini, fleet" with a table mapping each vendor's subagent file to its PD soul. No code; just doc parity.

---

## Question 2 — Do Codex and Gemini have equivalent abstractions?

### Current state

**Codex CLI** (OpenAI, GA March 14, 2026):

- AGENTS.md is the layered instruction file — discovery order: `$CODEX_HOME/AGENTS.override.md`, then walk project root → cwd checking `AGENTS.override.md` / `AGENTS.md` / `project_doc_fallback_filenames`. This is **closest to PD's CLAUDE.md / AGENTS.md** convention — instruction layering, not subagent registration.
- Custom subagents: discovered via `--agents-dir` arg, `CODEX_SUBAGENTS_DIR` env, then defaults `./agents`, `./.codex-subagents/agents`, `dist/../agents`. Format is TOML or YAML frontmatter on `.md` files. Frontmatter fields: `name`, `description`, `developer_instructions`, `nickname_candidates`, `model`, `model_reasoning_effort`, `sandbox_mode`, `mcp_servers`, `skills` (optional, inherits from parent session when omitted).
- Spawn shape: `codex exec --profile <agent>` — manager Codex dispatches subagents in parallel, waits for all results, returns consolidated response. Codex only spawns subagents when explicitly asked.

**Gemini CLI** (Google, GA April 2026 in v0.38.1):

- Subagents at `.gemini/agents/*.md` (project) and `~/.gemini/agents/*.md` (user). Extension-bundled at `extensions/<name>/agents/`.
- Frontmatter required: `name` (slug), `description`. Optional: `tools` (with wildcards `*`, `mcp_*`, `mcp_<server>_*`), `model`, `temperature`, `max_turns`, `kind` (`local` | `remote`), `timeout_mins`.
- Built-ins: `generalist`, `cli_help`, `codebase_investigator`.
- Parallel dispatch supported; A2A (Agent-to-Agent) protocol for remote subagents.
- **Gemini extensions are exactly what PD already ships at `.gemini/extensions/port-daddy/`** — manifest is `gemini-extension.json` (read in this repo at line 1-12), which registers MCP server `port-daddy` via `pd mcp` and exposes a `contextFileName: GEMINI.md`.

### Gap

| Capability | Claude Code | Codex CLI | Gemini CLI | PD |
|---|---|---|---|---|
| Subagent .md + frontmatter | yes | yes | yes | yes (YAML) |
| Project-level dir | `.claude/agents/` | `./agents` (configurable) | `.gemini/agents/` | `skills/*/agents/` + `pd-fleet.yml` |
| User-level dir | `~/.claude/agents/` | `$CODEX_HOME/agents/` | `~/.gemini/agents/` | `~/.agents/skills/*/agents/` |
| Extension/plugin agents | plugin `agents/` | `--agents-dir` | extension `agents/` | skill `agents/` (already shipping) |
| Built-in agents | Explore, Plan, general-purpose, etc. | none documented | generalist, cli_help, codebase_investigator | actor-roster (10 canonical) |
| Parallel dispatch | Agent tool, fork mode | yes | yes | `pd sortie run` + `pd-fleet.yml` triggers |
| Tool restriction | `tools` allowlist | `mcp_servers` field | `tools` with `*`/`mcp_*` wildcards | `allowedTools` + bond escrow |
| Daemon-persistent identity | no | no | no (except remote A2A) | yes (actor roster) |
| File-claim coordination | no | no | no | yes (`session_files` table) |
| Mailbox / inter-agent messaging | `SendMessage` (experimental) | none | A2A remote only | yes (`agent_inbox`, pub/sub, tuples) |
| Budget / bond enforcement | none documented | none | none | yes (`bonds`, `budget-guard`) |

All three runtimes converge on **the same body shape (markdown + frontmatter)**, but **none of them ship a soul** — there is no durable identity that outlives the spawned process. Every Claude Code subagent invocation starts fresh; every Gemini subagent has its own isolated context; Codex starts a clean workdir per call. The vendor model is **process-bound by design**.

PD's soul/body split is therefore not just terminology — it is a strictly more expressive model. The vendors' "subagent" is what PD calls a body.

### Recommendation

**Treat the three vendors' subagent formats as emit targets, not as the source of truth.** The persona YAML in `skills/port-daddy-agent-skill/agents/` is the canonical shape. Shipwright (or a thin new module, `lib/shipwright/emitters.ts`) lowers one persona YAML into:

- `.claude/agents/<name>.md` — Claude Code frontmatter shape
- `.codex/agents/<name>.md` — Codex frontmatter shape
- `.gemini/agents/<name>.md` — Gemini frontmatter shape (also drops a copy under `.gemini/extensions/port-daddy/agents/<name>.md` when shipping via the extension)
- `pd-fleet.yml` agent block — daemon body (PD-native, no markdown emit needed)

The persona file already contains everything the four emitters need; the emit step is field renaming, not new content.

### Concrete next step

Add `lib/shipwright/emitters.ts` with four functions: `emitClaudeCode(persona)`, `emitCodex(persona)`, `emitGemini(persona)`, `emitFleetYaml(persona)`. Each takes a persona and returns the runtime-specific string. Unit-test each emitter against `agents/lookout.yaml` and `agents/freshness-prober.yaml` (existing personas) — round-trip identity should be preserved.

---

## Question 3 — Is there a high-quality existing SDK that could be the go-between?

### Current state

**Anthropic Agent SDK** (`@anthropic-ai/claude-agent-sdk`, renamed from "Claude Code SDK" Sept 2025):
- The runtime that powers `claude` itself, exposed as a library. Subagent support built-in. Parallel subagent dispatch. Shared filesystem isolation. Used by Claude Managed Agents (Anthropic's hosted offering, May 2026).
- **Does not model PD's actor layer.** Subagents in this SDK are still bodies — they have isolated contexts and return summaries.
- Composable with PD: `pd spawn --backend claude-cli` already shells out to this SDK transitively (via `claude -p`).

**LangGraph / AutoGen / CrewAI / MetaGPT:**
- All model **agents as graph nodes** or **role-based teams**, not as souls/bodies/sessions. Closer in spirit to PD's orchestrator plugin model (`lib/orchestrator-plugins.ts`) than to its actor model.
- Would add a heavyweight dep for not much gain — PD already has the supervision, salvage, bond, budget, and file-claim infra that these libs do not.

**OpenAI Agents SDK** (`developers.openai.com/codex/guides/agents-sdk`):
- Codex-specific. Wraps `codex exec` with the subagent dispatch contract. Same "body" semantics as the others.

### Gap

No existing SDK ships the **soul + body + session three-layer model**. The closest analogue is `agha-actor-model` (Agha 1986) in the PD skill catalog — which is the academic root that ADR-0028 and AGENT-MODEL.md draw from. There is no off-the-shelf TypeScript or Python library that exposes actors with durable mailboxes, file-claim semantics, and ephemeral work-slices as PD does.

### Recommendation

**Do not adopt a third-party SDK as the abstraction layer. Wrap them as backends.** PD already does this — `lib/spawner.ts` line 85 lists eight backends (`ollama`, `claude`, `claude-cli`, `gemini`, `cloudflare`, `codex`, `aider`, `custom`). Each is ~50 lines of subprocess handling. Adding a "managed-claude" backend (Anthropic Managed Agents) is the same shape.

Where vendor SDKs help: when emitting the markdown frontmatter shape, link to the canonical vendor schemas so PD personas are guaranteed-valid against the latest spec. This means: the emitter modules should fetch (or pin) the vendor schemas at build time, not hand-roll them.

### Concrete next step

Add `lib/shipwright/vendor-schemas.ts` with three pinned JSON Schema documents (one per vendor) sourced from the docs. Validate emitter output against them in unit tests. When a vendor releases a new field (`isolation: worktree` was added to Claude Code in late 2026, for example), updating the pinned schema is a one-line change.

---

## Question 4 — Are plugins the best distribution mechanism for our agents?

### Current state

PD already ships agents across **six different runtime configurations**, confirmed by the directory listing on this machine:

```
skills/port-daddy-agent-skill/agents/          ← canonical, YAML
.codex/skills/port-daddy-agent-skill/          ← already-mirrored skill
.claude/skills/port-daddy-agent-skill/         ← already-mirrored skill
.agents/skills/port-daddy-agent-skill/         ← already-mirrored skill
.gemini/extensions/port-daddy/skills/...       ← Gemini extension bundle
.cursor/skills/, .windsurf/skills/, .roo/skills/, .qoder/skills/, .opencode/skills/, .trae/skills/, .continue/skills/  ← additional vendor mirrors
```

The `skills/port-daddy-agent-skill/SKILL.md` frontmatter explicitly declares these mirrors (lines 16–23). The `pd setup` command builds the mirror union via symlinks so vendor updates are visible without re-copying.

**Plugin manifests:** `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` declare PD as a Claude Code plugin with skills `port-daddy` and `port-daddy-agent-skill`. **No `agents:` field** in `plugin.json` yet — Claude Code plugin agents come from `agents/` directories inside the plugin.

**Gemini extension:** `.gemini/extensions/port-daddy/gemini-extension.json` registers MCP server only; no agents currently shipped through the extension path.

### Gap

The skill mirrors work for skills (which are `SKILL.md` files). They are **not** the right shape for vendor subagent registration:

- Claude Code expects `.claude/agents/<name>.md` (or plugin `agents/`), **not** `.claude/skills/<skill>/agents/<name>.yaml`. The current PD layout dumps YAML personas into the skill mirrors, which Claude Code doesn't read as subagents.
- Codex expects `./agents` (configurable). Currently PD writes nothing here — only `.codex/skills/`.
- Gemini reads `.gemini/agents/` directly, and extension-bundled `agents/` inside the extension. Currently PD's Gemini extension ships no `agents/` directory.

The vendors all want **flat markdown files in `agents/`**, not nested YAML inside skill bundles.

### Recommendation

**Ship agents as a peer artifact to skills, not nested inside them.** New layout:

```
skills/port-daddy-agent-skill/         ← skills, unchanged
agents/                                ← NEW: canonical persona YAML (sources of truth)
  release-engineer.yaml
  lookout.yaml                         ← move from skills/.../agents/
  freshness-prober.yaml
  salvage-watcher.yaml
  openai.yaml
  subagent-fork-template.yaml
.claude/agents/                        ← generated markdown, vendor-shape
  release-engineer.md
  lookout.md
  ...
.codex/agents/                         ← generated markdown, vendor-shape
  release-engineer.md
  ...
.gemini/agents/                        ← generated markdown, vendor-shape
  release-engineer.md
  ...
.gemini/extensions/port-daddy/agents/  ← generated, when shipping via extension
  release-engineer.md
```

And update `.claude-plugin/plugin.json` to add `"agents": ["./agents"]` so the plugin marketplace ships them.

The skill mirror (`pd setup`) extends to also mirror `agents/` from canonical → all four vendor dirs as part of the symlink union. **One source, four bodies, zero drift.**

Distribution strategies:

| Audience | Mechanism | Path |
|---|---|---|
| Solo dev, Claude Code | `pd setup` symlinks `.claude/agents/` | `.claude/agents/<name>.md` |
| Solo dev, Codex | `pd setup` symlinks `.codex/agents/` | `.codex/agents/<name>.md` |
| Solo dev, Gemini | `pd setup` symlinks `.gemini/agents/` | `.gemini/agents/<name>.md` |
| Team, any runtime | Commit `agents/*.yaml` + generated mirrors | Repo-tracked |
| Daemon background | `pd-fleet.yml` agent block + persona ref | `pd fleet up` |
| npm consumer | `port-daddy` package exports `agents/` | `import { releaseEngineer } from 'port-daddy/agents'` |
| Plugin user | `.claude-plugin/plugin.json` lists `agents` | `claude --agent release-engineer` |
| Extension user | `gemini-extension.json` ships `agents/` | Gemini auto-discovers |

### Concrete next step

Create `agents/` at the repo root with `release-engineer.yaml` as the first canonical persona. Then have the existing `scripts/build-skill-union.sh` (or `pd setup`) sweep `agents/*.yaml` → emit into all four vendor dirs. Plumb `.claude-plugin/plugin.json` `agents: ["./agents"]`.

---

## Question 5 — Can Shipwright dynamically generate runtime-specific agent definitions?

### Current state

Shipwright is documented in `docs/shipwright/AGENT-MODEL.md` and `lib/shipwright/archetypes.ts`. It already does **half** the job:

- `lib/shipwright/survey.ts` — surveys a target repo (tests, fleet, README, frameworks).
- `lib/shipwright/archetypes.ts` — closed catalog of 12 archetypes (gardener, qa-sentinel, test-gap-hunter, documentarian, simplifier, research-scout, dock-master, spark, sentry-responder, perf-hawk, browser-canary, typesafety-sweeper), each with prompt template and skill query.
- `lib/shipwright/skill-index.ts` — embedding-based skill retrieval per archetype.
- `cli/commands/shipwright.ts` — `pd shipwright survey` ships. `pd shipwright propose` and `pd shipwright apply` are PR3 placeholders (per CLI help text in the file).

Today's output: archetype → `pd-fleet.yml` agent block, with prompt template populated by archetype + skill retrieval. **One target format.**

### Gap

Shipwright does not yet emit to `.claude/agents/`, `.codex/agents/`, or `.gemini/agents/`. It only knows about `pd-fleet.yml`. To make a release-engineer (or any archetype) usable in Claude Code as `claude --agent release-engineer`, the operator has to hand-translate the YAML to markdown frontmatter — exactly the drift the operator wants to avoid.

### Recommendation

**Add an emitter stage to Shipwright. The persona YAML is one stage, the per-runtime markdown is the next.** New module pipeline:

```
pd shipwright survey  →  .portdaddy/shipwright/survey.json
                          ↓
pd shipwright propose →  agents/<name>.yaml          (canonical persona)
                          ↓
pd shipwright emit    →  .claude/agents/<name>.md    (Claude Code)
                      →  .codex/agents/<name>.md     (Codex)
                      →  .gemini/agents/<name>.md    (Gemini)
                      →  pd-fleet.yml block          (daemon)
```

Each emitter is a pure function: persona → runtime-specific frontmatter+body. Round-trip parity is asserted by tests.

### Spec format

The persona YAML schema (extending the existing `lookout.yaml` / `subagent-fork-template.yaml` shape):

```yaml
# Canonical PD persona — source of truth
name: release-engineer
identity: "{project}:fleet:release-engineer"
display_name: Release Engineer
description: |
  Ships PRs through CI safely. Gardens worktrees, rebases stale branches,
  enforces adversarial bar, coordinates via Port Daddy, refuses to skip hooks.
purpose: "Ensure every PR survives CI + /ultrareview before merge."

archetype: release-engineer    # NEW archetype; see Question 6
runtime:
  backend: claude-cli          # default body
  model: claude-sonnet-4-7
  timeout_seconds: 1800
  isolation: worktree          # vendor-portable: lowers to isolation: worktree in Claude, kind: local in Gemini, sandbox_mode: workspace-write in Codex
  background: false

triggers:
  - kind: manual                # human-invoked via `claude --agent release-engineer`
  - kind: pd-fleet               # daemon background, via pd-fleet.yml
    on: git:committed
    cooldown_ms: 900000
    dedupe_window_ms: 1800000
    singleton: true

prologue:
  - skills/port-daddy-agent-skill/scripts/prologue/pd-context.sh
  - skills/port-daddy-agent-skill/scripts/prologue/git-state.sh

# Body-shape neutral system prompt. Templating tokens resolved at emit time
# and at spawn time (pd-fleet uses spawn-time resolution).
system_prompt: |
  You are the Release Engineer. Your job is to ship PRs through CI safely.
  (...full prompt...)

# Tool surface, expressed in PD-neutral verbs. Emitters translate.
allowed_tools:
  read: true
  write:
    paths: ["*", "!.env*", "!**/secrets/**"]
  bash:
    allow: ["git ...", "gh ...", "npm test", "npm run *"]
    deny: ["rm -rf", "git push --force"]
  pd: true
  mcp:
    - port-daddy
    - github (optional)

# Skills to preload (vendor-portable: Claude Code `skills:`, Gemini supports
# via context injection, Codex via skills.config).
skills:
  - port-daddy-agent-skill
  - git-workflow-auditor
  - ci-status-checker
  - redteam-review

# Coordination obligations — every PD-emitted agent inherits these.
coordination:
  must_call_pd_briefing: true
  must_claim_files_before_edit: true
  must_drop_scope_note: true
  must_drop_result_note_on_exit: true
  forbids:
    - "skip hooks"
    - "force push to main/master"
    - "write to /tmp or /private/tmp"

stop_conditions:
  - success: "PR merged or 'release ready' note dropped"
  - elapsed_seconds > 1800
  - "operator stop signal received"
```

### Emitter table — exact field mapping

| Persona field | Claude Code | Codex CLI | Gemini CLI | pd-fleet.yml |
|---|---|---|---|---|
| `name` | `name` | `name` | `name` | agent map key |
| `description` | `description` | `description` | `description` | (in `telos`) |
| `runtime.model` | `model` | `model` | `model` | `model` |
| `runtime.isolation: worktree` | `isolation: worktree` | `sandbox_mode: workspace-write` | `kind: local` (default) | `worktree: true` |
| `runtime.background` | `background` | (default exec) | (default) | (managed) |
| `allowed_tools.read/write/bash` | `tools: Read, Edit, Write, Bash` | `mcp_servers` + sandbox | `tools: ["read", "write", "bash"]` or `"*"` | `allowedTools: "..."` |
| `allowed_tools.mcp` | `mcpServers` (inline or by name) | `mcp_servers` | `mcp_*` wildcards | (via `pd` access) |
| `skills` | `skills:` | `skills.config` | (context injection) | (via prologue / preload) |
| `system_prompt` | markdown body | `developer_instructions` + body | markdown body | `prompt:` |
| `prologue` | (inline at top of prompt) | (via developer_instructions header) | (inline at top of prompt) | `prompt:` prepend |
| `triggers[].kind: pd-fleet` | (not emitted) | (not emitted) | (not emitted) | full `trigger`, `cooldown_ms`, etc. block |
| `coordination.must_*` | (folded into prompt) | (folded into prompt) | (folded into prompt) | (folded into prompt) |

Worktree isolation deserves special note: every vendor has a different name for "give the agent its own checkout" — Claude calls it `isolation: worktree`, Codex calls it `sandbox_mode: workspace-write`, Gemini relies on its `kind: local` execution model. PD's existing `worktree: true` in `pd-fleet.yml` is the most explicit. The emitter normalizes all four to the persona's `runtime.isolation: worktree` declaration.

### Concrete next step

1. Promote `release-engineer` to `ArchetypeId` in `lib/shipwright/archetypes.ts` (13th archetype).
2. Write `lib/shipwright/emitters/` with one file per target: `claude-code.ts`, `codex.ts`, `gemini.ts`, `pd-fleet.ts`.
3. Add `pd shipwright emit <persona> --target {claude,codex,gemini,fleet,all}`.
4. Wire `pd setup` to call `pd shipwright emit --target all` for every `agents/*.yaml` in the repo.
5. Tests: round-trip every emitted .md back into the persona YAML and assert structural equivalence (modulo formatting).

---

## Question 6 — The "release engineer" as the concrete first instance

### Founding conception (recap from the parent)

> I am a "release engineer" agent that ships PRs through CI safely: gardens worktrees, preserves WIP before destructive ops, re-rebases stale branches, verifies adversarial bar (CI green + /ultrareview or redteam-review), coordinates via Port Daddy, never bypasses the shim or skips hooks without explicit reason, knows the operator's hard rules (no /tmp writes, no inline design tokens in memory, 14px font floor, no emojis-as-icons, no co-authored-by-Claude trailers, branch-on-origin discipline, etc.).

### Where it lives

**Source of truth:** `agents/release-engineer.yaml` at the repo root (NEW directory, peer to `skills/`).

**Generated mirrors (emitted by `pd shipwright emit`):**
- `.claude/agents/release-engineer.md`
- `.codex/agents/release-engineer.md`
- `.gemini/agents/release-engineer.md`
- `.gemini/extensions/port-daddy/agents/release-engineer.md` (for extension consumers)
- `pd-fleet.yml` agent block (for daemon background runs, when the operator wants it always-on)

**Plugin registration:**
- `.claude-plugin/plugin.json` gains `"agents": ["./agents"]` so the marketplace ships personas to Claude Code consumers.
- `.gemini/extensions/port-daddy/gemini-extension.json` gains `"agents": ["./agents"]`.

**Roster registration (Layer 1 soul):**
- `lib/actor-roster.ts` gains a `release-engineer` actor entry with mailbox `actor:release-engineer`, owned surface = `[".git/", "pull-request-via-gh", "scripts/promote-stable.sh"]`, mission, and `compatibilityFleetAgent: 'release-engineer'`.

### Concrete file layout to ship

```
port-daddy/
├── agents/                                              # NEW canonical agents dir
│   └── release-engineer.yaml                            # source of truth
├── lib/
│   ├── actor-roster.ts                                  # +1 entry: release-engineer
│   └── shipwright/
│       ├── archetypes.ts                                # +1 archetype: release-engineer
│       └── emitters/                                    # NEW
│           ├── claude-code.ts
│           ├── codex.ts
│           ├── gemini.ts
│           ├── pd-fleet.ts
│           └── index.ts
├── cli/commands/
│   └── shipwright.ts                                    # adds `emit` subcommand
├── skills/port-daddy-agent-skill/
│   ├── agents/                                          # existing — keeps lookout, freshness-prober, etc. as skill-bundled personas
│   └── SKILL.md                                         # documents `pd shipwright emit`
├── .claude/agents/                                      # generated artifacts (committed-as-derived)
│   └── release-engineer.md
├── .codex/agents/                                       # generated
│   └── release-engineer.md
├── .gemini/agents/                                      # generated
│   └── release-engineer.md
├── .gemini/extensions/port-daddy/
│   ├── agents/                                          # generated, for extension consumers
│   │   └── release-engineer.md
│   └── gemini-extension.json                            # +"agents": ["./agents"]
├── .claude-plugin/
│   └── plugin.json                                      # +"agents": ["./agents"]
└── docs/architecture/
    ├── 2026-05-31-agent-abstraction-strategy.md         # this doc
    └── 2026-05-XX-release-engineer-spec.md              # the operator's release-engineer spec doc, to be written next
```

### Invocation surfaces

| Surface | How to invoke | Body created |
|---|---|---|
| Claude Code, ad hoc | `claude --agent release-engineer` | Claude Code subagent with this prompt |
| Claude Code, @-mention | `@release-engineer ship #123` | Claude Code subagent for one task |
| Codex CLI | `codex exec --profile release-engineer` | Codex subagent in temp workdir |
| Gemini CLI | `gemini @release-engineer "ship PR"` | Gemini subagent in isolated context |
| PD CLI, one-shot | `pd spawn --backend claude-cli --persona agents/release-engineer.yaml` | `pd spawn` child |
| PD CLI, sortie | `pd sortie run release-engineer --task "ship #123"` | Sortie row + transcript + budget caps |
| PD daemon, background | `pd-fleet.yml` agent block, `pd fleet up` | Long-running supervised body |
| Human collab | `pd begin --identity port-daddy:fleet:release-engineer` | Operator becomes the body |
| Skill / slash command | `/release-engineer` (via skill registration) | Whichever runtime the operator is in |

The soul is the same. The notes go to the same session table. The mailbox routes to `actor:release-engineer` regardless of which body is attached.

### What the operator types to get there from here

```bash
# (1) Author the persona
$EDITOR agents/release-engineer.yaml

# (2) Add the actor (one-line entry in lib/actor-roster.ts)
$EDITOR lib/actor-roster.ts

# (3) Generate vendor mirrors
pd shipwright emit agents/release-engineer.yaml --target all

# (4) (Optional) wire as a background fleet agent
$EDITOR pd-fleet.yml   # add release-engineer block referencing the persona
pd fleet up

# (5) Use it
claude --agent release-engineer            # in Claude Code
codex exec --profile release-engineer      # in Codex
gemini @release-engineer "ship PR #123"    # in Gemini
pd spawn --backend claude-cli \
  --persona agents/release-engineer.yaml \
  --task "ship PR #123"                    # via PD
```

---

## Migration path — how existing PD fleet ships move to this model

The existing fleet ships are already personas-with-prompts inside `pd-fleet.yml`. The migration is mechanical:

### Phase 0 — no-op baseline
- Existing `pd-fleet.yml` agents (gardener, qa, test-hunter, documentarian, simplifier, cartographer, spark, spider) keep working as-is.
- Existing skill-bundled personas (`skills/port-daddy-agent-skill/agents/lookout.yaml` etc.) keep working when referenced explicitly by `pd spawn --persona`.

### Phase 1 — promote canonical personas
- Move existing `skills/.../agents/*.yaml` into top-level `agents/` (the skill `agents/` dir stays for skill-private personas; canonical ones move up).
- Extract each `pd-fleet.yml` agent's prompt + identity + backend into `agents/<name>.yaml`.
- Rewrite `pd-fleet.yml` to reference personas instead of inlining: `agents: { gardener: { persona: agents/gardener.yaml, trigger: git:committed, ... } }`.
- The fleet-engine loads the persona on spawn; today's inline behavior keeps working as a fallback when no `persona:` is set.

### Phase 2 — emit vendor mirrors
- `pd setup` learns to run `pd shipwright emit agents/*.yaml --target all`.
- `.claude/agents/`, `.codex/agents/`, `.gemini/agents/` populate from the personas.
- Operators using any of the three vendor CLIs see PD's actors as native subagents.

### Phase 3 — actor roster reconciliation
- Audit `lib/actor-roster.ts` against `agents/`. Every actor should have a persona; every persona should reference an actor in `identity:`.
- Actors with no persona (operator-only roles like `coxswain`, `quartermaster`) stay; the soul is sufficient.
- Personas with no actor get a new actor entry, including the release-engineer.

### Phase 4 — plugin marketplace update
- `.claude-plugin/plugin.json` lists `"agents": ["./agents"]`. The next `claude-plugin` install of PD ships every persona as a registered subagent.
- `.gemini/extensions/port-daddy/gemini-extension.json` ships `agents/` directory in the extension manifest.
- npm `port-daddy` package gains an `exports['./agents']` entry for programmatic consumers.

**Backwards compatibility throughout:**
- All four phases preserve `pd-fleet.yml`, `pd spawn --persona`, `pd sortie run` exactly as they work today.
- No skill mirror behavior changes. The `pd setup` symlink union is additive.
- No actor mailbox behavior changes — every existing actor keeps its inbox.

---

## Risks + open questions for the operator

### Risks

1. **Generated-files-vs-source-of-truth ambiguity.** If `agents/release-engineer.yaml` is the source and `.claude/agents/release-engineer.md` is generated, an operator who edits the `.md` will lose their edit on next `pd setup`. Mitigation: emit a `# DO NOT EDIT — generated from agents/release-engineer.yaml — re-emit with: pd shipwright emit ...` banner at the top of every emitted file, and add a `.gitattributes linguist-generated=true` entry.
2. **Vendor schema drift.** Anthropic, OpenAI, and Google update their frontmatter independently. If Gemini renames `kind: local` to `runtime: local` and we don't notice, our emitter ships stale markdown for two weeks until someone catches it. Mitigation: pin the vendor schemas in `lib/shipwright/vendor-schemas.ts`, run schema validation in CI, file a `port-daddy:fleet:lookout` drift alert when validation fails.
3. **Cardinality explosion.** Today PD has ~10 actors + ~6 personas + ~8 fleet ships. After migration, every actor has a persona, every persona emits four vendor files. That is ~40 generated files. Mitigation: keep `agents/` flat (no subfolders), and emit only when an operator-facing surface needs it (operator-only actors don't need a persona).
4. **Plugin subagent restrictions.** Claude Code denies `hooks`, `mcpServers`, and `permissionMode` for plugin subagents. PD personas that need those (e.g. release-engineer's `hooks: pre-commit-validate-no-co-author-trailer`) must be installed user-scope (`~/.claude/agents/`) rather than plugin-scope. The emitter must warn when emitting plugin-scope. Mitigation: persona YAML carries `runtime.scope_required: user | plugin`; emit-time validation fails loudly when the runtime can't support what the persona asks for.
5. **Soul/body confusion in operator docs.** Even with this design, an operator reading `claude --agent release-engineer` may think they are summoning the soul, not creating a new body for the soul. Mitigation: documentation on every emitted .md says "this is one body of the durable actor `actor:release-engineer` — see https://port-daddy.dev/docs/agents/release-engineer for the soul."

### Open questions

1. **Should `agents/` be at the repo root, or under `.portdaddy/agents/`?** Repo root is more discoverable but pollutes the top level. `.portdaddy/agents/` is symmetric with `.portdaddy/shipwright/` but hides personas from grep. **Recommendation:** repo root, because it matches the `skills/` precedent and makes the marketplace `plugin.json` entry trivial.
2. **Should generated markdown be committed?** Two camps: (a) commit — operators see live artifacts in PRs, can review changes; (b) generate on demand — no commit noise, no merge conflicts on regen. **Recommendation:** commit, because PD's whole ethos is "code and live behavior are truth; docs follow." Generated markdown is a doc-shaped artifact.
3. **Is "release-engineer" the right name, or "shipwright-of-PRs" / "harbormaster-of-merges" / "promotion-agent"?** Matches the existing maritime-via-actor-roster naming PD already retired in PR #52, but is more obvious than nautical metaphors. **Recommendation:** keep `release-engineer` — boring and self-documenting beats clever, and PD already has a `coxswain` actor for ship-driving metaphors.
4. **Does the release-engineer get its own bond ceiling and budget cap, or share the project's?** PR-shipping work touches CI minutes, GitHub API calls, sometimes paid review LLMs. **Recommendation:** carve a `release-engineer` budget bucket separate from the fleet bucket, default `$2.00/day`, configurable.
5. **Does Shipwright owning the emitter create a Shipwright-as-bottleneck risk?** Shipwright is an Opus-class meta-agent; running it on every persona edit is expensive. **Recommendation:** the emit step is a pure function (no LLM call). Shipwright runs at *propose* time (LLM-assisted archetype selection); the emit step runs deterministically. They're separable.
6. **What happens when an operator wants a one-off subagent for one repo, without going through the persona YAML?** They can still drop a `.claude/agents/foo.md` directly. The emitter doesn't own that directory, just the files matching `agents/*.yaml` it produces. **Recommendation:** explicitly document that the emitter writes only files matching its source manifest; hand-written `.claude/agents/*.md` files are untouched.

---

## Reading list for the parent (release-engineer triage)

When the release-engineer parent reads this back, the load-bearing files are:

- `docs/adr/0028-actor-fleet-agent-session-three-layers.md` — the three-layer model. The whole strategy stands on this.
- `docs/shipwright/AGENT-MODEL.md` — "the Plane" — souls/bodies/sessions as runtime-neutral concepts.
- `docs/adr/0019-declarative-fleet-yaml.md` — `pd-fleet.yml` schema; the daemon-side body format.
- `skills/port-daddy-agent-skill/agents/lookout.yaml` — best existing reference persona YAML.
- `skills/port-daddy-agent-skill/agents/subagent-fork-template.yaml` — the persona shape for forked sub-agents (closest to release-engineer's needs).
- `lib/spawner.ts` line 84 (SpawnSpec) — the backend matrix already supports all four vendors.
- `lib/shipwright/archetypes.ts` — where the release-engineer archetype gets added.
- `pd-fleet.yml` — the existing fleet agents, for prior-art format.
- `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` — plugin distribution shape.
- This doc — the lift to runtime-neutral.

---

## Closing

The shortest honest summary: **PD already has the model the vendors are converging toward, but PD has not yet emitted itself into the vendor shape.** The release-engineer is the right forcing function to do that emit work, because shipping releases through Claude Code / Codex / Gemini fluidly is the test case that exercises every emit target. Build it as one persona, emit to four runtimes, and the next twelve agents are mechanical.

The release-engineer's existence as an artifact is the proof that the abstraction works.
