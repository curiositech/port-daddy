# 10 Operator Control Panel

## Purpose

The native Harbor app is the place where the operator sees agents as real
working collaborators rather than invisible subprocesses. It must answer:

- who is working;
- what are they doing;
- what did they say;
- what tools did they run;
- what files changed;
- what are they allowed to do;
- what needs my attention;
- how do I stop, steer, resume, or inspect them?

If the answer is "type an ID into a command line," the surface has failed.

## Primary layout

The default view should be a three-part workspace:

Left rail:
  Navigation and saved views: Agents, Worktrees, PRs, Blackboard, Memory,
  Skills, Doctor, Settings.

Center roster:
  Active and recent Agent Nodes grouped by status. Each row or card is clickable.

Right detail:
  The selected Agent Node with transcript, controls, files, diffs, claims,
  memory, PRs, costs, and remediation.

The center and right panes should be conjoined, not isolated dashboards. The
operator clicks an agent and immediately sees the data.

First acceptance target:
  `docs/proposals/artifacts/agent-control-panel-mock/` is the local mock that
  already exercises roster, transcript, files, compliance, attention, and
  clickable controls. The GPUI implementation should treat it as the minimum
  screen contract, not as final art.

## Roster card

Each roster card should show:

- display name;
- class: Voyager, Longshoreman, human, service;
- body/provider: Claude Code, Codex, Cloudflare, Ollama, custom;
- model tier: fast, mid, strong, local, custom;
- authority: local, hosted, team, observed;
- compliance badge C0-C6;
- live/stale/paused/blocked/complete;
- last activity time;
- current goal;
- worktree or repo;
- files touched count;
- unread attention count;
- cost so far;
- transcript status.

Important: "LIVE" must mean transcript events are arriving or heartbeat is
recent. It cannot only mean a stale session row exists.

## Detail header

The detail pane header should show:

- agent name and role;
- active body and provider;
- model tier and exact model in details;
- status and heartbeat;
- current session id;
- worktree;
- branch;
- compliance;
- cost;
- context pressure;
- sandbox level.

Primary controls:

- Pause;
- Interrupt;
- Send message;
- Checkpoint;
- Fork successor;
- Open worktree;
- Open PR;
- Retire.

Dangerous controls require confirmation and policy checks.

## Transcript renderer

The transcript is the first-class center of the detail pane.

Render:

- operator messages;
- assistant messages with streaming deltas;
- tool calls as expandable blocks;
- shell commands with stdout/stderr tabs;
- file reads/writes;
- diffs;
- GitHub comments and PR events;
- system guidance and skill grafts as clearly labeled operator-only or
  system-only events;
- approvals and denials;
- errors;
- checkpoints;
- compaction packets.

Every block should show timestamp, source, and status. Timestamps should be
human-readable with exact time available on hover or detail.

The transcript must support:

- jump to latest;
- search in session;
- filter event kinds;
- copy event link;
- open source file;
- open blob/log;
- collapse noisy tool output;
- show redactions clearly.

## Live versus historical

Active session:
  Shows live stream at the bottom, heartbeat, active controls, pending tool
  requests, and current context pressure.

Historical session:
  Shows replay mode, exact time span, final status, successor/predecessor links,
  and disabled controls except "fork successor," "search," and "open artifacts."

Stale session:
  Shows last heartbeat, likely cause, and remediation: attach, mark stale,
  fork successor, or retire.

Non-compliant session:
  Shows what is missing: no transcript, no tool gate, no heartbeat, no workspace,
  no context pressure, or no control channel.

## Files and diffs

The detail pane should include a files tab:

- file tree scoped to worktree;
- files touched by this session;
- created/deleted/modified markers;
- symbol claims;
- semantic conflict warnings;
- click to open actual text;
- syntax highlighting;
- line numbers;
- diff view;
- open in editor.

Relative paths should be resolved by daemon against repo/worktree. The operator
should not see clipped paths that cannot be opened.

## PR and GitHub view

For PR-bound agents:

- PR title, number, status;
- CI checks;
- review comments;
- unresolved bot comments;
- last pushed commit;
- roadmap item;
- merge queue state;
- suggested replies;
- approval requirements.

Actions:

- open PR;
- generate reply draft;
- ask Longshoreman to triage comments;
- run focused checks;
- mark blocker;
- request human review.

## Memory and compaction view

The detail pane should show:

- active core memory packet;
- retrieved memories for current turn;
- compaction status;
- context pressure graph;
- source citations for memory;
- "why this memory was retrieved";
- option to exclude a memory from future retrieval;
- option to inspect raw source transcript.

Memory without citations should be visually less trusted.

## Blackboard view

The blackboard should be a separate view and a detail side rail:

- blockers;
- contradictions;
- active parleys;
- file heat;
- agents doing similar work;
- stale agents;
- CI failures;
- skill candidates;
- operator questions.

Clicking any blackboard item opens the source artifacts.

## Doctor and remediation

The app should expose `pd doctor` as a GUI:

- daemon health;
- app and CLI version;
- hook pack installed;
- MCP gateway installed;
- transcript path writable;
- Keychain access;
- provider keys;
- relay pairing;
- sandbox support;
- stale agents;
- missing skills;
- broken worktree root.

Each issue should have:

- impact;
- why it matters;
- fix button when safe;
- command equivalent for advanced users;
- privacy note if relevant.

## Mobile companion

Mobile should use the same Agent Node API with narrower controls.

Mobile screens:

- attention inbox;
- active agents;
- selected transcript;
- approval request;
- PR comment draft;
- cost warning;
- pause/interrupt;
- device pairing and privacy settings.

Mobile should not be the primary file editor in early milestones.

## VS Code plugin

The VS Code plugin should be a daemon client:

- agent roster side panel;
- claims and conflict gutter;
- "open in Harbor";
- transcript peek for current file;
- blackboard warnings;
- approve/deny tool request;
- start Agent Node from selection;
- show file heat.

It should not store its own transcript database.

## Empty states

Bad empty state:
  "No frames yet."

Good empty state:
  "This agent is registered but no transcript source is connected. Install the
  Port Daddy hook pack or relaunch through `pd agent launch`."

Bad empty state:
  "No fleet running."

Good empty state:
  "No Longshoremen are active. Start local Harbor Staff, attach an existing
  agent, or keep working with manual control."

Every empty state should explain what is missing and offer the next action.

## Screen contract

Desktop:

- roster and detail visible together;
- live transcript above the fold for selected active agent;
- files touched visible without scrolling past unrelated metrics;
- controls are buttons with disabled states and explanations;
- status uses words plus color, not color alone.

Mobile:

- agent list first;
- selected agent transcript second;
- approvals and pause/interrupt are reachable in one tap;
- file diffs summarize first and deep-link to desktop or web for full editing.

Required artifact states:

- active stream;
- historical replay;
- non-compliant/remediation;
- empty roster;
- stale agent;
- approval request;
- file preview.

## Visual direction

The app should be dense, legible, and alive:

- stable pane layout;
- crisp typography;
- high contrast;
- clear click targets;
- minimal ornament;
- motion used for state transitions, live streams, and attention shifts;
- no fake terminal prompts when a button should exist;
- no giant unexplained walls of text;
- no clipped identifiers as the main information scent.

Screenshots and motion artifacts for every GPUI surface change are required
because rendering is part of the feature.
