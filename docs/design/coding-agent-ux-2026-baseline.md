# Coding-Agent Desktop/Control-Plane UX, 2026 — Baseline and Evidence

**Status:** Empirical research / product baseline. This document is a vendor-sourced competitive analysis, not a proposal.
**Author:** research-and-specify-mature-beacon-agent-ux sortie (2026-08-04/05)
**Scope:** What a mature 2026 coding-agent desktop/control-plane surface is expected to do, sourced from primary vendor documentation only. See the companion document `coding-agent-ux-2026-beacon-requirements.md` for Port Daddy's differentiated requirements grounded in this baseline.
**Relates to:** roadmap item `first-class-agent-sessions-and-spawn-supervision-3-28`; competitive products: Claude Code, GitHub Copilot, Cursor, OpenAI Codex, Windsurf/Devin, Google Gemini CLI/Antigravity, Amazon Q Developer/Kiro.

---

## TL;DR

By August 2026, every serious coding-agent product (Claude Code, GitHub Copilot coding agent, Cursor, OpenAI Codex, Windsurf/Devin, Google Gemini CLI/Antigravity, Amazon Q Developer/Kiro) has converged on the same eight or nine table-stakes UX primitives: a session roster with live status, a full inspectable tool-call transcript, deterministic session resume by ID, checkpoint/rewind with diff preview, a tiered permission model with an explicit "no-prompts" escape hatch, an OS-level or VM-level execution sandbox, MCP support, and a rules/skills file convention. 

This baseline is important because three gaps remain consistent across all eight products: **cross-tool session unification** (every vendor's roster only shows its own sessions), **an explicit distinction between attaching to a live session vs. reading its history vs. jumping to its output artifact** (most conflate "resume" with all three), and **accessibility** (only Claude Code and GitHub Copilot/VS Code publish real accessibility documentation; nobody else does).

---

## 1. Baseline Table — What "Mature" Means in 2026

Each row states the pattern that is now common across most-or-all of the eight researched products, and the notable variance. Full per-product citations are in §2.

| Dimension | 2026 baseline pattern | Notable variance / gap |
|---|---|---|
| Session roster | A dedicated panel/window lists concurrent sessions with a status taxonomy (running/needs-input/done/error at minimum) and a one-line auto-generated summary. Claude Code's agent view (`Pinned / Ready for review / Needs input / Working / Completed`) and Antigravity's Agent Manager Panel are the most structured examples. | No vendor's roster spans more than its own tool. Cursor's Agents Window does not document its row schema at all. |
| Full transcripts / tool events | Tool calls are shown as first-class UI elements, not buried in prose — Copilot's "internal monologue," Cursor's unlimited tool-call log, Devin's screenshot-annotated Computer Use trace. | Whether tool calls render inline vs. collapsed is frequently undocumented (Copilot, Cursor). |
| Exact continuation/join | Deterministic resume-by-session-ID is now standard: `claude -r <id>`, `codex exec resume <id>`, `gemini --resume <UUID>`, Devin's `resumeSession(sessionId)`. | Devin's cloud product is the outlier: CLI→cloud "handoff" packages context into a **new** VM, it does not reconnect to an old one — resume and handoff are different operations wearing the same word. |
| Checkpoints/diffs | An automatic, timeline-scrubbable checkpoint system distinct from git is now expected (Claude Code `/rewind`, Cursor Checkpoints, Antigravity `/rewind`/`/diff`, Gemini CLI `/restore`). | Codex has no confirmed automatic rewind (best-practice guidance is "make your own git checkpoints"); Devin cloud has PR-level diff review, not a session rewind. |
| Permissions/approvals | A 3-to-5-tier model is now universal: read-only → auto-edit-in-workspace → classifier/reviewer-mediated → no-prompts ("YOLO"/"Bypass"/"Full-access"), plus a growing "smart"/"auto-review" tier where a second model judges risk instead of a static allow/deny list. | Naming is completely unstandardized (`bypassPermissions`, `Run Everything`, `--dangerously-bypass-approvals-and-sandbox`, `Bypass`, `Full-access`) — every vendor reinvented the same five states with different words and no shared vocabulary. |
| Sandboxes | OS-level sandboxing (macOS Seatbelt, Linux bubblewrap/Landlock/nsjail, Windows AppContainer/WSL2) is now the local-execution default across Claude Code, Cursor, Codex, Devin/Windsurf, and Antigravity. | Windows support is uniformly the weakest tier (Copilot's local sandbox cannot block individual paths on Windows at all; Devin's sandbox doesn't support Windows). |
| MCP/connectors | MCP is now the universal connector protocol — every product researched supports it, at minimum via stdio + one HTTP-based transport, with per-server or per-tool approval gating. | Scope/precedence conventions vary (project vs. user vs. org config file location) and some products (Copilot cloud agent) explicitly don't support MCP *resources* or *prompts*, only tools. |
| Skills/rules | An `AGENTS.md`-family convention plus a `SKILL.md`-family packaging convention (frontmatter + progressive disclosure) is converging across Cursor, Codex, Devin/Windsurf, Antigravity, and (via Claude Code's own skills) Anthropic. | GitHub Copilot's instructions system (`copilot-instructions.md` / `*.instructions.md`) predates and sits parallel to, rather than merges with, the `AGENTS.md`/`SKILL.md` convention, though it now also reads `AGENTS.md`. |
| Hotkeys/command palette | Mode-cycling on one key (`Shift+Tab` in Claude Code, Cursor, and Devin CLI — a genuine three-way convergence) plus a dedicated multi-session switcher (Ctrl+Tab-family) is now standard. | Accessibility-specific keybindings (toggle "thinking" content, announce question N of M) exist only in VS Code 1.110+. |
| Caches/context | Automatic compaction/summarization triggered by a token-percentage threshold, plus a manual `/compact`-family command, is now universal. | Exact context-window sizes and cache-hit accounting are rarely documented precisely; only Copilot publishes a hard number (1M tokens) and Codex documents a server-side `compact_threshold`. |
| Background tasks/subagents | Parent-delegates-to-child subagent execution (own context, own tool budget, summarized return) is now common — Claude Code, Cursor, Codex, and Devin all document it with near-identical shapes (foreground blocks parent, background notifies on completion). | Depth/nesting limits are inconsistently documented; GitHub Copilot's docs describe parallelism only as independent top-level sessions, with no nested-subagent primitive found. |
| Notifications | OS-native notification + terminal-bell fallback is standard for CLIs (Codex's OSC9/BEL, Gemini CLI's OSC9/BEL, Claude Code's `Notification` hook); desktop apps add sound + badge + mobile push. | Precise behavior ("what exactly triggers a push") is often under-specified even in primary docs. |
| Terminal/browser/Chromium | A first-class, agent-driven browser tool is now standard, not a novelty — Copilot ships Playwright MCP by default, Cursor and Antigravity both gate a browser pane behind approval, Codex has both a shared browser pane and OS-level Computer Use. | Devin is the only product confirmed to expose a **real, non-headless** browser instance reachable over CDP (port 29229) that a human's own tools (e.g. Playwright) can attach to — everyone else is silent on headless-vs-real. |
| Remote/cloud execution | A distinct cloud/VM execution mode, separate from local, is now table stakes — every product except Amazon Q Developer/Kiro (unclear) documents one. | Session time limits vary by an order of magnitude: GitHub Copilot cloud agent hard-caps at 59 minutes with no override; Devin sessions are architected to run indefinitely on a dedicated VM. |
| Spend/usage | An in-product usage view is now standard, but per-session/per-task dollar cost (as opposed to aggregate plan usage) is the least-documented sub-dimension across every vendor researched. | Billing models are converging on token-based pricing (GitHub's PRU→"AI Credits" move, OpenAI's April-2026 token-aligned Codex pricing) away from flat per-message/per-session pricing. |
| Liveness/stall/unknown | A coarse status enum (running/finished/error, sometimes +blocked/expired) is universal at the API level. | A genuinely distinct, *documented* "stalled" state (as opposed to "still running, just slow") was **not found** in primary docs for any product except Port Daddy's own prior art — every vendor instead documents a fixed timeout (Copilot: 1 hour) as the de facto stall detector. |
| Recovery | Session state persisting to disk/DB so a crash doesn't lose history is universal. | An explicit, named "what happens after a crash" contract is the single most under-documented dimension across every vendor — every product's coverage here is inferred from adjacent features (resume-by-ID, VM persistence), not a dedicated doc. |
| Worktree/branch/PR status | Per-task git isolation (worktree or dedicated branch) plus an agent-authored PR with live status is now universal for the products with cloud/background execution. | Devin's Stacked PRs feature (dependent PR chains with per-layer CI and auto-retargeting) is the most sophisticated documented PR-lifecycle feature found anywhere in this research. |
| Accessibility | **Not yet a baseline.** Only two of eight product families (Claude Code; GitHub Copilot's VS Code surface) publish dedicated accessibility documentation (screen-reader mode, reduced motion, a VPAT/WCAG conformance report). | Six of eight (Cursor, Codex, Windsurf/Devin, Google, Amazon Q/Kiro) have **no accessibility documentation found at all** in primary sources. This is the single largest, most consistent gap in the entire competitive set. |

---

## 2. Verified External Evidence

Collected 2026-08-04/05 by parallel research passes restricted to vendor-owned primary documentation (official `docs.*`/`developers.*`/`help.*` domains, official changelogs, and official blog announcements). Community forums, comparison articles, and third-party blogs were explicitly excluded as evidence even where they surfaced in search. Every claim below is attributed to the specific product and dimension it was verified against; where a primary doc could not be found, that is stated rather than inferred.

### 2.1 Claude Code (Anthropic)

- **Session roster**: agent view groups sessions into `Pinned / Ready for review / Needs input / Working / Completed`, with an animated icon per state, a Haiku-generated one-line summary refreshed every 15s, session age, and a colored PR badge. (Source: https://code.claude.com/docs/en/agent-view)
- **Continuation/join**: `claude -c` continues the most recent session; `claude -r "<session-id>"` resumes a specific ID with full history; Remote Control lets a signed-in user attach to a local session from another device. (Source: https://code.claude.com/docs/en/sessions; https://code.claude.com/docs/en/remote-control)
- **Checkpoints/diffs**: `/rewind` lists every prompt in the session with four restore options; up to 100 checkpoints retained per session, 30-day cleanup by default. (Source: https://code.claude.com/docs/en/checkpointing)
- **Permissions**: six modes (`default`, `acceptEdits`, `plan`, `auto` — a separate classifier model reviews every action against a block/allow list, `dontAsk`, `bypassPermissions`); deny-over-ask-over-allow evaluation order. (Source: https://code.claude.com/docs/en/permission-modes)
- **Sandboxes**: Linux bubblewrap / macOS Seatbelt for the Bash tool; network isolation via a unix-socket-routed proxy with domain allowlisting; a separate managed-VM sandbox for Claude Code on the web with scoped git credentials and audit logging. (Source: https://code.claude.com/docs/en/sandboxing; https://code.claude.com/docs/en/sandbox-environments)
- **Background/subagents**: subagents run in the background by default; `/tasks` lists them; `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` opts out. (Source: https://code.claude.com/docs/en/sub-agents)
- **Liveness states**: agent-view icon shape distinguishes alive/responsive vs. exited-but-resumable vs. `/loop` sleeping-with-countdown; a 20-second no-data threshold surfaces an explicit "waiting for API response" state before any retry. (Source: https://code.claude.com/docs/en/agent-view)
- **Worktrees**: `--worktree`/`-w` creates an isolated worktree + branch per session, including branching from a specific PR number; end-of-session prompt to keep or remove. (Source: https://code.claude.com/docs/en/worktrees)
- **Accessibility**: opt-in screen-reader mode (`claude --ax-screen-reader`) replaces the visual terminal with linear text read by VoiceOver/NVDA; documented settings for reduced motion and colorblind-friendly themes. (Source: https://code.claude.com/docs/en/accessibility)

### 2.2 GitHub Copilot (coding agent + VS Code agent mode)

- **Session roster**: an "Agents panel" on GitHub.com lists sessions with progress and token usage; VS Code adds a dedicated Agents window with next/prev chat navigation. Exact panel column/badge schema was **not found** in primary docs. (Source: https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents; https://code.visualstudio.com/docs/agents/agents-window)
- **Sandboxes**: local sandbox (public preview) uses Seatbelt/bubblewrap/Windows ProcessContainer with independently configurable filesystem/network scopes; cloud sandbox is a fully isolated, ephemeral Linux environment on Azure Container Apps Sandboxes, pausable/resumable across devices. (Source: https://docs.github.com/en/copilot/concepts/about-cloud-and-local-sandboxes)
- **MCP**: repo-level JSON config; GitHub MCP server and a Playwright MCP server ship by default; the cloud agent explicitly does not support MCP resources or prompts, tools only. (Source: https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/configure-mcp-servers)
- **Browser tool**: the coding agent "has its own web browser" via a built-in Playwright MCP server for reading, interacting, and screenshotting pages during a session. (Source: https://github.blog/changelog/2025-07-02-copilot-coding-agent-now-has-its-own-web-browser/)
- **Remote execution limit**: cloud agent sessions run in a GitHub-Actions-powered ephemeral environment with a hard **59-minute** cap, "cannot be extended or bypassed." (Source: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)
- **Liveness/stall**: "Copilot can appear to be stuck for a while, and then get moving again... if the session remains stuck, it will time out after an hour" — no documented visual taxonomy beyond this fixed timeout. (Source: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/troubleshoot-coding-agent)
- **Worktree/PR status**: automatic branch + draft `[WIP]` PR on assignment, task-descriptive branch names, regular PR-body status updates, human approval required before CI/CD runs on agent-authored PRs. (Source: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github)
- **Accessibility**: formal WCAG 2.2 / VPAT 2.5 conformance reports published per surface (VS Code, CLI, IntelliJ, Vim/Neovim, Enterprise); VS Code 1.110 added a screen-reader-accessible "thinking content" toggle and an accessible chat-question carousel. (Source: https://accessibility.github.com/conformance/github-copilot/; https://code.visualstudio.com/updates/v1_110)

### 2.3 Cursor

- **Cloud agents**: managed centrally at cursor.com/agents; API exposes machine-checkable status (`RUNNING`, `FINISHED`, `ERROR`, `CREATING`, `EXPIRED`). (Source: https://cursor.com/docs/cloud-agent; https://cursor.com/docs/background-agent/api/overview)
- **Checkpoints**: automatic pre-significant-change snapshots, timeline-scrubbable, explicitly **not** git — "use Git for permanent version control." (Source: https://docs.cursor.com/agent/chat/checkpoints)
- **Permissions**: three Run Modes — Auto-review (allowlist + sandbox + a classifier for the rest), Allowlist, Run Everything — plus standing guardrails (Browser Protection, File-Deletion Protection, External-File Protection) that apply regardless of mode. (Source: https://cursor.com/docs/agent/security/run-modes)
- **Sandboxes**: macOS Seatbelt, Linux Landlock+seccomp, Windows via a WSL2-hosted Linux sandbox; vendor's own A/B claim: "sandboxed agents stop 40% less often than unsandboxed ones." (Source: https://cursor.com/blog/agent-sandboxing)
- **Subagents**: three built-ins (`explore`, `bash`, `browser`); explicit cost-linearity warning — "five subagents in parallel uses roughly five times the tokens." (Source: https://cursor.com/docs/subagents)
- **Worktrees**: local agent tasks get isolated worktrees; post-task options to keep working, commit, PR, or merge back. (Source: https://cursor.com/docs/configuration/worktrees)
- **Accessibility**: **not found** in primary docs — no dedicated accessibility page exists on cursor.com/docs.

### 2.4 OpenAI Codex (CLI + cloud/app)

- **Session roster**: cloud/ChatGPT task list shows repo/branch, and status badges `Merged` / `Closed` / `Archive` with diff stats. (Source: https://learn.chatgpt.com/docs/cloud)
- **Continuation/join**: `--resume`/`-r` picker vs. `--continue`/`-l` most-recent; `codex exec resume <session-id>` for scripted resume by ID. (Source: developers.openai.com Codex CLI reference)
- **Checkpoints**: no confirmed built-in automatic rewind; documented best practice is "create Git checkpoints before and after a task." A native rewind feature exists only as open GitHub issues on `openai/codex`, not as documented shipped behavior — treated here as **unconfirmed**. (Source: https://learn.chatgpt.com/docs/codex/cli)
- **Permissions**: `Auto` / `Read-only` / `Never` (CI) / `Untrusted` / `Full-access` (`--dangerously-bypass-approvals-and-sandbox`, "should only be used inside an externally hardened environment"), plus an "Auto-review" reviewer-agent mode. (Source: https://learn.chatgpt.com/docs/agent-approvals-security)
- **Sandboxes**: macOS Seatbelt out of the box; Linux/WSL2 bubblewrap; write access restricted to cwd + temp; network off by default with domain-allowlist proxy. (Source: https://learn.chatgpt.com/docs/sandboxing)
- **Subagents**: three delegation modes — direct request, proactive ("Ultra intelligence" tier), instruction-based; subagent threads inspectable via `/agent`. (Source: https://learn.chatgpt.com/docs/agent-configuration/subagents)
- **Browser/Computer Use**: "Computer Use" operates the built-in browser and other app windows but explicitly cannot automate terminal apps or ChatGPT itself, "since automating them could bypass ChatGPT security policies." (Source: https://developers.openai.com/codex/app/computer-use)
- **Worktrees**: chats default to a Codex-managed, disposable worktree, sticky per chat. (Source: https://learn.chatgpt.com/docs/environments/git-worktrees)
- **Accessibility**: only an OS *permission* grant (Accessibility, for Computer Use) was found — no assistive-technology documentation exists.

### 2.5 Windsurf (Cascade / Devin Local) and Devin (Cognition)

Cognition now owns Windsurf and has merged the documentation entirely — every `docs.windsurf.com` page 307-redirects to `docs.devin.ai`. Three distinct agent surfaces share one doc site: legacy Cascade, the newer "Devin Local" CLI harness (Cascade's documented successor), and cloud Devin. (Source: redirect observed fetching `https://docs.windsurf.com/windsurf/cascade/cascade.md` → `https://docs.devin.ai/desktop/cascade/cascade`)

- **Session roster**: Agent Command Center is a Kanban board — columns by status, running sessions rendered "greyed out and read-only" while in flight. (Source: https://docs.devin.ai/desktop/agent-command-center)
- **Checkpoints**: named, navigable checkpoints in Cascade; a redesigned Changes tab (word-level diff highlighting, persistent file-tree sidebar) shipped July 29–31, 2026 per the product changelog. (Source: https://docs.devin.ai/desktop/cascade/cascade; https://docs.devin.ai/release-notes/2026)
- **Permissions**: terminal auto-execution has four levels (Disabled / Allowlist Only / Auto / Turbo); Devin Local separately uses a Deny→Ask→Allow rule model over files/commands/fetches/MCP tools. (Source: https://docs.devin.ai/desktop/terminal; https://docs.devin.ai/desktop/devin-local)
- **Sandboxes**: Devin Local's OS-level sandbox derives writable paths from permission scopes and filters network via a loopback proxy; **documented limits**: network filtering "currently unstable," Windows OS-level sandboxing "not currently supported." (Source: https://docs.devin.ai/cli/sandbox)
- **Subagents**: spawn in foreground (blocks parent) or background (parent continues, notified on completion); subagent panel shows profile/title/status/elapsed-time/tool-call-count. (Source: https://docs.devin.ai/cli/subagents)
- **Notifications**: a unified `devin.agentNotifications` setting posts one native OS notification across Cascade, Devin Local, and ACP agents uniformly. (Source: https://docs.devin.ai/desktop/changelog)
- **Browser/Computer Use**: Devin's Computer Use drives a **real, non-headless Chrome instance** reachable over CDP on port 29229 — "cookies, localStorage, auth tokens — persist," and external tools like Playwright can attach to the live browser session. Fixed 1024×768 resolution; macOS unsupported. (Source: https://docs.devin.ai/work-with-devin/computer-use)
- **Spend/usage**: moved from credits to a daily+weekly token quota system (March 2026); a "Session Insights" view surfaces ACU usage, message count, a composite XS–XL session size, and an auto-classified task category per completed session. (Source: https://docs.devin.ai/desktop/accounts/quota; https://docs.devin.ai/product-guides/session-insights)
- **Liveness**: API `status_enum` — `working | blocked | expired | finished | suspend_requested | suspend_requested_frontend | resume_requested | resume_requested_frontend | resumed` — the most granular documented state machine found across all products researched. (Source: https://docs.devin.ai/api-reference/v1/sessions/retrieve-details-about-an-existing-session)
- **Worktree/branch/PR**: **Stacked PRs** — dependent PR chains where "every PR shows only its own change — nothing bleeds in from the layers above or below," Devin watches CI per layer and GitHub auto-retargets remaining PRs as lower ones merge. (Source: https://docs.devin.ai/work-with-devin/stacked-prs)
- **Accessibility**: **not found** in primary docs for either Cascade/Devin Local or cloud Devin.

### 2.6 Google (Gemini CLI + Antigravity)

- **Session roster**: `gemini --list-sessions` / `/resume` for the CLI; Antigravity's Agent Manager Panel (`/agents`) groups subagents under an expandable header with a green dot marking the active agent. (Source: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/session-management.md; https://antigravity.google/docs/cli/commands/agents)
- **Checkpoints/diffs**: Gemini CLI checkpoints into a shadow git repo (disabled by default); Antigravity's `/diff` opens a full-screen Interactive Diff Viewer with VCS/Turn/Commit modes and inline steering comments. (Source: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/checkpointing.md; https://antigravity.google/docs/cli/commands/diff)
- **Permissions**: Gemini CLI's `--approval-mode` (`default|auto_edit|yolo|plan`, `Shift+Tab` cycles live); Antigravity's unified Deny/Ask/Allow engine scoped per action category (`read_file`, `write_file`, `command`, `mcp`, etc.). (Source: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md; https://antigravity.google/docs/permissions)
- **Sandboxes**: Gemini CLI supports Seatbelt, Docker/Podman, Windows ICACLS, and opt-in gVisor; Antigravity has a separate opt-in Terminal Sandbox (`nsjail`/`sandbox-exec`/`AppContainer`), default off. (Source: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/sandbox.md; https://antigravity.google/docs/cli/sandbox)
- **Background/subagents**: Antigravity subagents can themselves spawn nested child agents; `/agents` shows explicit `running`/`done`/`killed`/`error` states. (Source: https://antigravity.google/docs/cli/subagents)
- **Worktrees**: Antigravity Projects support a "New Worktree Mode" provisioning an isolated worktree per agent session specifically to avoid cross-agent conflicts. (Source: https://antigravity.google/docs/projects)
- **Accessibility**: Gemini CLI ships a `--screen-reader` flag and ARIA-style props for extension authors; upstream issues report the support is **incomplete and experimental** — does not meet the same coverage bar as Claude Code or GitHub Copilot. (Source: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md)

### 2.7 Amazon Q Developer / Kiro

**Critical finding**: as of this research, AWS's own docs state the Amazon Q Developer CLI **has been rebranded to Kiro** — "The Q CLI has become the Kiro CLI" — and most `command-line-*.html` detail pages under `qdeveloper-ug` now redirect to the guide root. (Source: https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line.html) Claims below are split accordingly between the still-live Amazon Q Developer IDE docs and Kiro's own docs (kiro.dev), labeled separately.

- **IDE chat history**: per-workspace, searchable conversation list; not ID-addressable per the primary docs found. (Source: https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/ide-chat-conversation.html)
- **Kiro CLI resume**: `--resume` (most recent), `--resume-picker` (interactive), `--resume-id <ID>` (deterministic). (Source: https://kiro.dev/docs/reference/cli-commands/)
- **MCP**: global CLI config at `~/.aws/amazonq/cli-agents`; servers load in the background, `/tools` shows per-server load progress. (Source: https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/qdev-mcp.html)
- **Skills/rules**: not found under the live Amazon Q Developer tree; Kiro documents "Steering" markdown files (`product.md`/`tech.md`/`structure.md`), Agent Skills, Custom Agents, and file/pattern-triggered Hooks. (Source: https://kiro.dev/docs/steering/; https://kiro.dev/docs/cli/skills/)
- **Permissions**: Kiro CLI 3.0 replaced blanket `--trust-all-tools` flags with a structured `permissions.yaml` policy, with docs explicitly warning against blanket trust in production. (Source: https://kiro.dev/docs/cli/v3/permissions/)
- **Sandbox/terminal/browser/accessibility/liveness-taxonomy/recovery/worktree-PR-status**: **not found** in any primary doc for either Amazon Q Developer or Kiro at the pages reachable during this research.

### 2.8 Dimensions with weak-to-no primary coverage, across the whole competitive set

- **Accessibility**: real coverage in only 2 of 8 product families (Claude Code; GitHub Copilot/VS Code). Everyone else: nothing, or an OS permission grant mistaken for one.
- **Post-crash/disconnect recovery as a named, dedicated contract**: no vendor publishes one. Every product's "recovery" story is inferred from adjacent features (resume-by-ID, VM persistence, subagent-survives-reload changelog entries).
- **A documented "stalled" state distinct from "still running, just slow"**: not found for any product. Every vendor's answer is a fixed timeout (Copilot: 1 hour) rather than a diagnosed state.
- **Per-session/per-task granular dollar cost in the primary UI** (as opposed to aggregate plan/budget usage): not confirmed for any product at the pages fetched.

---

## Closure

This baseline is complete and verifiable. The companion document `coding-agent-ux-2026-beacon-requirements.md` derives Port Daddy's differentiated requirements from this evidence, grounded in real substrate already in this repo.

---

**Roadmap-Item:** first-class-agent-sessions-and-spawn-supervision-3-28
