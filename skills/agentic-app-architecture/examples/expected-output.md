# Example Output: Agentic App Architecture

Scenario: "Harbor Scout" — a non-coding Port Daddy fleet agent that researches
a competitor's release notes, writes a summary report artifact, and posts a
link to it in a Slack channel. It has no repo to write to; its side effects
are an artifact file and an outward-facing Slack post.

## First pass: the design a team ships under deadline pressure

```json
{
  "appName": "Harbor Scout v0 (weak)",
  "transparency": {
    "thinkingVisible": false,
    "toolUseVisible": false,
    "planBeforeAct": false,
    "interruptible": false
  },
  "stateModel": {
    "durableHistory": true,
    "forking": false,
    "rename": false,
    "episodicMemory": false
  },
  "contextStrategy": {
    "caching": false,
    "eviction": false,
    "memoryPromotion": false
  },
  "capabilities": {
    "tools": true,
    "skills": false,
    "mcp": {
      "coreSize": 14,
      "perProjectSpecialists": false
    },
    "secretCustody": {
      "mode": "argv"
    }
  },
  "execution": {
    "agentType": "non-coding",
    "isolation": true,
    "sideEffectHumanGate": false,
    "artifactReceipts": false
  }
}
```

Running the audit catches four real problems at once — a chat log that
"looks done" but hides its reasoning, an unbounded context strategy, a Slack
webhook token passed on the command line, and an outward-facing post with no
human approval:

```
$ node scripts/agentic_app_audit.mjs --input harbor-scout-v0.json
{
  "pass": false,
  "coverageByAxis": {
    "transparency": 0,
    "stateModel": 40,
    "contextStrategy": 40,
    "capabilities": 10,
    "execution": 40
  },
  "findings": [
    { "id": "hidden-thinking-or-tool-use", "axis": "transparency", "severity": "critical", "message": "Thinking and/or tool use is not surfaced to the human: this is a \"chat box with secret hands.\"" },
    { "id": "no-plan-before-act", "axis": "transparency", "severity": "medium", "message": "The agent does not show a plan before acting on anything consequential." },
    { "id": "not-interruptible", "axis": "transparency", "severity": "high", "message": "There is no interruption/steering affordance while the agent is working." },
    { "id": "transcript-only-state", "axis": "stateModel", "severity": "critical", "message": "Neither thread forking nor episodic memory exists: the transcript is treated as the entire state." },
    { "id": "no-context-caching-strategy", "axis": "contextStrategy", "severity": "critical", "message": "No caching, eviction, or memory-promotion strategy: context grows unbounded, which is a direct cost and latency blowup." },
    { "id": "unsafe-secret-custody", "axis": "capabilities", "severity": "critical", "message": "Capabilities are wired up (tools/skills/MCP) but secretCustody.mode is 'argv': secrets can land in argv, logs, or the transcript." },
    { "id": "mcp-boot-storm-risk", "axis": "capabilities", "severity": "high", "message": "MCP core size is 14 servers with no per-project specialist split: over-broad global MCP config causes a boot storm and frozen sessions." },
    { "id": "no-human-gate-on-side-effects", "axis": "execution", "severity": "high", "message": "Irreversible or outward-facing actions have no human checkpoint before they execute." },
    { "id": "no-artifact-receipt", "axis": "execution", "severity": "high", "message": "Side-effecting work leaves no durable, artifact-backed receipt." }
  ],
  "recommendations": [
    "Stream thinking and tool calls inline or into a collapsible workbench pane; an un-shown tool call is un-steerable.",
    "Surface a short plan (files to touch, commands to run, stop condition) before the first side-effecting action.",
    "Add a cancel/steer control that takes effect mid-run, not just before the run starts.",
    "Add thread forking to explore alternates without destroying the main line, and/or episodic memory to promote salient facts out of the transcript.",
    "Durable history exists but sessions cannot be renamed/organized; add rename so a long history stays navigable.",
    "Pick at least one: prompt caching for stable prefixes, eviction/summarization for stale turns, or promotion of durable facts into memory.",
    "Route secrets through a hidden-stdin or secret-store path scoped to the tool call, never argv/inline/env-dumped-into-prompt. See `pd secret set` for the pattern.",
    "Keep the always-on global MCP core small (a handful of servers) and push project-specific servers to per-project config instead of the global core.",
    "Tools are wired up without skills: consider progressive-disclosure skill packs so large toolsets stay lazy-loaded rather than all schemas resident at once.",
    "Gate merges/pushes/sends/purchases/publishes behind an explicit human approval step; never let an irreversible action fire unattended.",
    "Produce a receipt (diff summary, validation evidence, rollback pointer) for every side-effecting task, not just a chat message claiming success."
  ]
}
```

Note `stateModel` scores 40 rather than 0 even with three of four fields
false: `durableHistory` is `true` here, so only the `transcript-only-state`
critical finding fires (forking and episodic memory are both missing), not a
separate finding for the missing `rename` — that one only surfaces as a
recommendation once durable history exists.

## Second pass: the fixed design

- Streamed the research plan and each search/fetch tool call into a
  collapsible workbench pane; added a cancel button that takes effect between
  fetches.
- Added episodic memory: prior competitor-release facts get promoted with a
  30-day TTL, so next week's run doesn't re-derive what it already learned.
- Added a summarization step once the transcript exceeds ~60% of budget, and
  kept the system prompt / tool schemas as a stable cached prefix.
- Moved the Slack webhook token off the command line into `pd secret set`
  (hidden-stdin), and folded the two competitor-specific MCP servers Harbor
  Scout used into per-project config instead of the shared global core.
- Added a human-approval step before the Slack post fires (the report artifact
  itself is written and reviewable first; the outward-facing post is the
  irreversible action), and a receipt naming the artifact path, the sources
  checked, and the post's message ID once sent.

```json
{
  "appName": "Harbor Scout v1 (fixed)",
  "transparency": {
    "thinkingVisible": true,
    "toolUseVisible": true,
    "planBeforeAct": true,
    "interruptible": true
  },
  "stateModel": {
    "durableHistory": true,
    "forking": true,
    "rename": true,
    "episodicMemory": true
  },
  "contextStrategy": {
    "caching": true,
    "eviction": true,
    "memoryPromotion": true
  },
  "capabilities": {
    "tools": true,
    "skills": true,
    "mcp": {
      "coreSize": 6,
      "perProjectSpecialists": true
    },
    "secretCustody": {
      "mode": "hidden-stdin"
    }
  },
  "execution": {
    "agentType": "non-coding",
    "isolation": true,
    "sideEffectHumanGate": true,
    "artifactReceipts": true
  }
}
```

```
$ node scripts/agentic_app_audit.mjs --input harbor-scout-v1.json
{
  "pass": true,
  "coverageByAxis": {
    "transparency": 100,
    "stateModel": 100,
    "contextStrategy": 100,
    "capabilities": 100,
    "execution": 100
  },
  "findings": [],
  "recommendations": [
    "Architecture covers all five axes at a passing level. Spot-check that the declared booleans reflect what actually ships, not just what is planned."
  ]
}
```

What changed the outcome, in reviewer terms: nothing about the research logic
changed — the fix was entirely architectural. The agent now shows its work,
remembers what it already learned instead of re-researching it, costs less
per run because the prefix is cache-stable, never puts a secret on the
command line, and cannot post to Slack without a human looking at the report
first.
