# Subagent Design

Official docs:

- Skills: https://code.claude.com/docs/en/skills
- Subagents: https://code.claude.com/docs/en/sub-agents

## What matters for skill authors

There are two different patterns:

1. A skill with `context: fork`, where the skill body becomes the task prompt for a subagent.
2. A subagent with a `skills` field, where full skill content is preloaded into that subagent's context at startup.

Do not confuse them.

## `context: fork`

Use `context: fork` only when:

- isolation materially helps
- the task is explicit enough to stand alone
- independent reasoning or permission boundaries matter

Key facts:

- The forked subagent does not inherit the parent conversation history.
- The skill body becomes the subagent task prompt.
- The `agent` field chooses which subagent configuration executes the task.
- If `agent` is omitted, Claude uses `general-purpose`.

Bad fit:

- background knowledge skills
- style guides
- reference-only skills with no concrete task body

## Subagents that preload skills

The `skills` field on a subagent injects full skill content at startup.

Important rules:

- Full content is injected, not just made available for later invocation.
- Subagents do not inherit skills from the parent conversation automatically.
- Keep preloaded skill sets small and curated.

Good default:

- preload 2-5 small, high-reuse skills
- keep specialized or optional skills discoverable rather than always preloaded

## Permission and isolation considerations

Relevant subagent fields include:

- `tools`
- `disallowedTools`
- `model`
- `permissionMode`
- `mcpServers`
- `hooks`
- `maxTurns`
- `skills`
- `memory`
- `effort`
- `background`
- `isolation`

Important runtime facts:

- `isolation: worktree` gives the subagent a temporary git worktree.
- `permissionMode` supports `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, and `plan`.
- Plugin subagents ignore `hooks`, `mcpServers`, and `permissionMode`.

## Skill design for subagent consumption

Subagent-friendly skills should have:

- explicit When-to-Use and NOT-for boundaries
- numbered procedures instead of mushy prose
- output contracts when downstream agents consume the result
- validation or quality-gate sections
- minimal assumptions about hidden context
- concrete prompt assets under `agents/` when delegation is expected
- cost/model ceilings when cheap execution is intended
- no-revert rules and owned write sets for code or file edits

## Port Daddy-grounded subagents

When subagents operate in a Port Daddy repo, include the coordination contract
in the agent prompt:

- receive or run the current `pd briefing`
- include the active session id and identity in the task
- claim or lock owned files before editing when overlap is possible
- write a `pd note` for scope, files, validation, and handoff
- use tuples for machine-readable ownership, sync state, or validation results
  when another agent or watcher will consume them
- never revert user or other-agent work outside the assigned write set
- report exact files changed, commands run, failures, and residual risk

Cheap execution agents are useful only with bounded write sets and gates. Do
not assign them taste, architecture, destructive cleanup, or final acceptance.

## Design patterns

### Single specialist

- One narrow subagent owns the task.
- The subagent uses a small preloaded skill set.

### Chain

- One specialist produces an artifact.
- Another specialist transforms or validates it.

### Parallel

- Independent specialists solve disjoint pieces.
- The parent orchestrator merges results.

Parallel work is strongest when write scopes are disjoint and the merge contract is explicit.
