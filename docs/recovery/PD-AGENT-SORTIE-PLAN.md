# PD Agent And Sortie Plan

Last updated: 2026-04-05

## Why This Needs To Exist

Port Daddy currently has the pieces for coordination, but not a clean user-facing mission surface:

- `pd spawn` is too raw
- `pd agent` is currently a thin admin namespace, not "do the right thing for me"
- `SortiePanel` can launch a one-off process, but not author, explain, or visualize a multi-agent mission
- fleets are always-on background automation, not the right abstraction for "go think about this and bring me back something useful"

The missing product is an ephemeral, user-authored mission layer.

Port Daddy should expose three distinct surfaces:

1. `pd fleet`
   - always-on background automation
   - declarative, project-scoped, long-lived
2. `pd agent`
   - one-shot single-agent delegation
   - auto-wraps Port Daddy coordination primitives
3. `pd sortie`
   - one-shot multi-agent mission
   - ephemeral harbor, explicit budget, explicit roster, visible outcomes

## Product Thesis

`pd agent` should feel like:

> "Handle this task correctly using Port Daddy without making me think about session lifecycle, salvage, identity, or transport."

`pd sortie` should feel like:

> "Take this bigger problem, assemble the right short-lived team, think/build/review in the background, and return with a legible result."

## The User Problems To Solve

Users need to:

- know what kinds of tasks are good candidates for delegation
- choose between one agent and multiple agents without learning internal jargon
- see before launch which backend/model/cost/readiness path will be used
- understand what the mission is waiting on, blocked by, or already completed
- come back later and quickly understand what happened
- hand off creative exploration without losing control of spend or scope

## Proposed Surface Model

### `pd agent`

This becomes the default "safe delegation" entry point.

Example:

```bash
pd agent "Fix the auth bug in session.ts"
```

Expected behavior:

- auto-select identity and purpose from cwd
- auto-run `pd begin`
- auto-spawn the chosen backend
- inject Port Daddy coordination instructions into the prompt
- auto-claim files when appropriate
- auto-write salvage notes if interrupted
- auto-run `pd done`
- emit a summarized outcome, not just raw stdout

Minimal flags:

```bash
pd agent "fix login redirect" --backend gemini --tier mid
pd agent "review the last commit" --recipe review --budget 0.75
pd agent "prototype a landing page" --background
```

### `pd sortie`

This is the mission surface for multi-agent, single-use work.

Example:

```bash
pd sortie "Investigate flaky auth tests, propose root cause, patch if safe, and summarize risks"
```

Expected behavior:

- generate a mission plan first
- choose a recipe and roster
- surface readiness blockers before launch
- run in an ephemeral harbor
- show timeline, artifacts, costs, and handoffs
- end with a single mission briefing

## Authoring Modes

Users should have three ways to author sorties:

### 1. Quick Prompt

Fast path for distracted users.

Example prompts:

- "Investigate why `npm test` got slower"
- "Give me three UI directions for this dashboard"
- "Review this branch and tell me what is risky"
- "Prototype a fix for the auth redirect loop"

The system chooses a recipe and suggests defaults.

### 2. Guided Builder

UI-first authoring in `SortiePanel`.

Fields:

- goal
- recipe
- expected output
- backend/model policy
- cost ceiling
- time ceiling
- approval mode
- roster preview

This is where the system teaches users what to ask for.

### 3. Saved Templates

Reusable mission specs on disk for repeated workflows.

Possible path:

- `.portdaddy/sorties/*.yml`

Example template families:

- `investigate`
- `review`
- `creative`
- `prototype`
- `release-readiness`
- `docs-sync`

## Recipes

Recipes keep users from having to invent orchestration from scratch.

Suggested first recipes:

### `investigate`

- planner
- explorer
- summarizer

Output:

- root-cause memo
- open questions
- suggested next actions

### `fix`

- planner
- builder
- reviewer

Output:

- patch or diff summary
- tests run
- residual risks

### `review`

- reviewer
- tester
- summarizer

Output:

- findings ordered by severity
- gaps in coverage
- commit/PR summary

### `creative`

- spark-style divergence
- spider-style connection making
- prototyper
- synthesizer

Output:

- options
- strongest concepts
- prototype sketch or patch
- recommended next step

This is the user-facing version of:

> "Send this to super creative agents to think, plan, maybe prototype, and bring back something coherent."

## Mission State Model

Internally, a sortie should be represented as a first-class mission object.

Suggested fields:

```ts
interface SortieMission {
  id: string;
  projectDir: string;
  harbor: string;               // project:sortie:<id>
  goal: string;
  recipe: 'investigate' | 'fix' | 'review' | 'creative' | 'custom';
  status: 'draft' | 'planned' | 'blocked' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  requestedBy: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  budgetUsd?: number;
  maxDurationMinutes?: number;
  approvalMode?: 'none' | 'before-build' | 'before-apply' | 'before-close';
  modelPolicy?: {
    backend?: string;
    model?: string;
    modelTier?: 'low' | 'mid' | 'high';
    fallbacks?: Array<{ backend?: string; model?: string; modelTier?: 'low' | 'mid' | 'high' }>;
  };
  roster: SortieAgentPlan[];
  outputs: SortieArtifact[];
  blockers: SortieBlocker[];
}
```

Suggested blocker types:

- backend not installed
- backend auth missing
- local daemon unreachable
- sandbox restriction likely
- budget exceeded
- approval required
- upstream step failed

## Event Model

Sorties should not piggyback on generic spawn logs alone.

Add explicit sortie events:

- `sortie:created`
- `sortie:planned`
- `sortie:blocked`
- `sortie:started`
- `sortie:agent_started`
- `sortie:agent_completed`
- `sortie:agent_failed`
- `sortie:waiting`
- `sortie:artifact`
- `sortie:approved`
- `sortie:cancelled`
- `sortie:completed`
- `sortie:summary`

This gives FleetBar and `fleet-config-ui` something human-readable to show.

## Readiness And Error Boundaries

Every sortie launch should run preflight checks before spending money:

- backend support check
- backend install/auth readiness
- sandbox-sensitive local execution warning
- daemon/IPC/socket readiness
- daemon provenance check so the user can tell whether Port Daddy is serving from the current checkout, an installed stable copy, or another runtime target
- budget check
- output path / worktree readiness if required

Failure handling should be structured:

- `blocked` means "nothing started because a prerequisite failed"
- `failed` means "a running step failed"
- `waiting` means "human approval or another dependency is required"

Do not flatten these into one error string.

## UI Direction For `SortiePanel`

The current panel is a launcher form. It should become a mission workspace.

Suggested sections:

### Left rail: sortie inbox

- drafts
- running missions
- waiting-for-approval missions
- recent completed missions

### Main pane: mission composer / mission detail

For drafts:

- goal input
- recipe picker
- roster preview
- backend/model/cost policy
- readiness summary
- launch button

For running/completed missions:

- mission status
- step graph
- agent roster with per-agent status
- artifacts
- timeline
- cost so far
- final briefing

### Right rail: suggested prompts

- "Investigate and summarize"
- "Brainstorm and prototype"
- "Review and critique"
- "Patch if safe"
- "Gather evidence only"

This is how users learn what to ask for.

## CLI Direction

### `pd agent`

Ship first because it is the smallest leap and fixes the biggest UX gap.

Suggested commands:

```bash
pd agent "<task>"
pd agent "<task>" --recipe review
pd agent "<task>" --background
pd agent "<task>" --backend gemini --tier low --budget 0.25
```

### `pd sortie`

Suggested commands:

```bash
pd sortie "<goal>"
pd sortie plan "<goal>"
pd sortie run .portdaddy/sorties/release-readiness.yml
pd sortie list
pd sortie status <id>
pd sortie logs <id>
pd sortie approve <id>
pd sortie cancel <id>
```

## Rollout Sequence

### Slice 1: `pd agent` autopilot wrapper

- wrap begin/spawn/done/salvage
- inject coordination instructions
- show backend/model/budget upfront

### Slice 2: sortie state and API

- add first-class mission records
- add sortie events
- add blocked/waiting/completed summaries

### Slice 3: recipe-driven multi-agent sorties

- investigate
- review
- creative

### Slice 4: UI mission workspace

- transform `SortiePanel` from launcher to mission console
- add readiness, cost, artifacts, and step graph

### Slice 5: saved templates and "send to creative agents"

- reusable mission specs
- one-click creative divergence/synthesis flow

## Recommendation

Treat this as part of `3.8.4`, with one exception:

- the `pd agent` autopilot wrapper belongs in the `3.8.3` legibility push because it removes avoidable manual coordination friction immediately

The rest of the sortie mission system belongs in `3.8.4` because it is a human surface and recovery UX problem, not just runtime plumbing.
