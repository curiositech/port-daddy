# Capabilities & Execution Substrate

Use this when wiring an agent's powers (tools, skills, MCP servers, secrets) and when deciding where its actions actually land.

## Tools: schemas and lazy loading

A small toolset (under ~10 tools) can have every schema resident in context at all times. Past that, resident schemas start crowding out useful context and slowing first-token time. The fix is the **search-then-load-schema** pattern: expose a lightweight tool-search/index step that returns tool names and short descriptions, then fetch the full parameter schema only for the tools actually about to be called. This is deferred/lazy tool loading — treat a large toolset like a catalog, not a manifest that must always be fully loaded.

## Skills: progressive-disclosure capability packs

Skills solve a related but distinct problem: domain expertise that's too dense to keep in the system prompt but too valuable to omit. A skill's frontmatter (name + description) should be cheap enough to always be scanned; its body and reference files load only when the skill actually triggers. Wiring skills without this discipline (loading every skill's full body up front) defeats the purpose — it's the same context-budget mistake as non-lazy tools.

## MCP: core vs. specialist topology

The failure mode here is well-documented in practice: an ever-growing global MCP config causes a **boot storm** — every session pays the startup cost of every configured server, and heavily loaded configs produce frozen or slow-to-start sessions.

The fix (Port Daddy's own lean-MCP-core policy):

- Keep a **small, always-on global core** — a handful of servers everyone needs everywhere (filesystem, git, the project's own coordination server). Port Daddy trimmed its own global core from 481 to 161 tools by moving project-specific servers out of it.
- Push **per-project specialists** (a database client only one project uses, a design tool only used in one repo) into per-project MCP config, not the global file.
- Treat "over-broad global MCP with no per-project split" as a standing architecture defect, not a one-time cleanup — it recurs every time someone adds "just one more server" to the global config because it's convenient in the moment.

## Secret custody

Secrets reaching a tool call must never pass through argv, shell history, application logs, or the model's own transcript — all three are commonly persisted, screenshotted, or shared, and a secret that reaches any of them is functionally leaked.

Safe patterns, in order of preference:

1. **Hidden-stdin**: the secret is piped to the invoked process's stdin, never appears as a command-line argument, and is scrubbed from process listings. This is the pattern behind `pd secret set` — the value never touches argv.
2. **Secret-store reference**: the tool call carries a reference (a key name, a vault path) and the actual value is resolved by a trusted broker at execution time, not passed through the model at all.
3. **Env-scoped**: the secret is injected into the process environment for exactly the invocation that needs it, then removed — acceptable but weaker than the above two because environment variables are more commonly logged or inherited by accident.

Unsafe and disqualifying: **argv** (`--api-key sk-...` is visible in `ps`, shell history, and often logs), **inline** (the secret appears literally inside a prompt or tool-call argument the model can see and potentially echo back), and **none** (no custody model at all — the secret is handled ad hoc, which in practice means it ends up in one of the first two).

Pair capability-scoped credentials (a token that can only do the one thing the tool needs, not a full-access key) with whichever custody mode you choose — custody without scoping still leaks blast radius even when the transport is safe.

## Coding-agent execution substrate

For an agent that writes code, the substrate is the repo itself:

- **One worktree per writer.** Concurrent writers sharing a single checkout race on the working tree; a worktree per agent (or per task) removes the race by construction.
- **Advisory claims, not locks.** Announce intended edit surface (files/symbols) so other agents can route around it, but don't rely on claims as a hard mutex — they're intent signals, not enforcement.
- **A PR is the finish line**, not a direct commit to the shared branch. The PR carries artifact-backed validation (see the receipt discipline in `agent-work-receipt-designer`), and only a human or a gated merge queue promotes it.
- **Never force-push, never touch main directly.** Both operations destroy other agents' or humans' ability to trust the branch's history.

## Non-coding execution substrate

For an agent that isn't editing a repo, "the substrate" is whatever durable artifact it produces and however it produces it:

- **Durable artifacts**: a document, an image, a dataset, a rendered web artifact. The artifact itself — not the chat message describing it — is the deliverable, and it needs a stable location/URL, not just an ephemeral render in the chat pane.
- **Self-authored tools**: some non-coding agents build their own scripts or small components at runtime to accomplish a task (a one-off data transform, a generated chart component). Treat agent-authored code exactly like agent-authored anything else: it needs the same review/gate discipline as a hand-written change, not an exemption because "it's just a helper script."
- **Human gates on irreversible/outward-facing actions**: sending an email, publishing a post, purchasing something, deleting data — anything that leaves the sandbox or cannot be undone needs an explicit approval step before it fires. This is the same principle as the coding agent's PR finish line, applied to a different kind of side effect.
- **Receipts still apply.** A non-coding agent's receipt looks different from a diff-based one (it names the artifact produced, the validation performed, and the rollback/deletion path) but the discipline — durable, artifact-backed, reviewable without re-reading the transcript — is identical.

## Shibboleth

Agents producing side effects with no isolation, no human gate on irreversible/outward-facing actions, and no artifact receipt are the most common way an otherwise well-designed agentic app causes real damage — the interaction and memory axes can be flawless and this one alone still burns the user.
