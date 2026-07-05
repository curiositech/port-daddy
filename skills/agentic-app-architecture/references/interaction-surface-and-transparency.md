# Interaction Surface & Transparency

Use this when deciding what an agentic app shows the human — thinking, tool use, plans, and steering — before it renders a single screen.

## Surface patterns, ranked by trust

| Pattern | What it shows | When it's right | Failure mode if misused |
| --- | --- | --- | --- |
| Inline chat only | Final answer text | Never, for an agent with side effects | Chat box with secret hands: reasoning and tool calls are invisible |
| Streaming thinking block | Reasoning tokens as they generate | Cheap, fast reasoning the user can skim live | Wall of text with no structure; use collapsible sections past ~10 lines |
| Collapsible tool-call log | Every tool call + result, collapsed by default | Any agent with more than 2-3 tool calls per turn | Collapsed-by-default becomes hidden-by-default if there's no summary line |
| Workbench/artifact pane | Diffs, generated files, running commands, separate from chat | Coding agents, document/image producers, anything with a durable output | Splitting chat and workbench with no cross-linking between a message and the artifact it produced |
| Plan-then-act gate | A numbered plan the human can edit/approve before execution | Any action touching more than a read-only surface | A plan shown once, then silently deviated from mid-run with no re-confirmation |

Default assumption: if the agent can write a file, call an external API, or spend money, its thinking and tool calls must be visible by default, not opt-in via a settings toggle.

## What the chat surfaces vs. the workbench

- **Chat**: intent, clarifying questions, short status updates, links into the workbench. Chat should read like a work log, not the work itself.
- **Workbench/artifact pane**: diffs, file trees, rendered documents/images, running command output, test results. This is where a reviewer actually verifies the claim.
- Anti-pattern: dumping a full diff or a full generated document into the chat stream. It works for a single small change and breaks down immediately once a session has more than one artifact.

## Plan-before-act — what "before" means

A plan must be shown before the *first* consequential action, not narrated after the fact. Consequential includes: writing outside a sandbox/worktree, calling a paid or rate-limited API, sending anything to a human other than the operator, or any action tagged irreversible in the execution substrate (see `capabilities-and-execution-substrate.md`). Read-only exploration (grep, list files, read docs) does not need a plan gate — gating that adds friction with no safety benefit.

Plan quality bar: name the files/surfaces to touch, the tools to be used, and an explicit stop condition ("done when X test is green"). A plan that just restates the user's request is not a plan.

## Interruption and steering

- Cancel must take effect mid-run, not just before the run starts. A "stop" button that only prevents the *next* turn from starting is a UX lie.
- Steering (injecting a correction mid-run without a full restart) is a superset of cancel — worth building once a workflow runs longer than ~30 seconds.
- Background agents (see `always-on-agent-architecture` skill for the deeper pattern) need a heartbeat, a current-step indicator, and a spend meter even when nobody is actively watching — silence reads as failure or as a runaway process, and both erode trust.

## Forking, rename, and history as UI surfaces

These are state-model concerns (see `state-memory-and-context.md`) but they are also transparency concerns: a user who cannot see or navigate past sessions cannot audit what the agent has done over time.

- **Forking**: expose it as an explicit action ("branch from here"), not an accidental side effect of editing an old message. Forked threads should be visually distinct from the main line.
- **Rename**: sessions need human-readable names, not just timestamps or the first prompt truncated to 40 characters — long-running operator work (Port Daddy sessions, fleet runs) is unusable to audit without this.
- **History as receipt trail**: the session list itself is a lightweight receipt surface — status (running/done/failed), cost, and duration per session, visible without opening each one.

## Shibboleth

An agent that hides its thinking and tool calls is untrustable and un-steerable — "chat box with secret hands." This is the single most common architecture mistake in shipped agentic apps, because a bare chat UI is the fastest thing to build and the easiest to demo. It fails the moment the agent does something wrong and nobody can see why.
