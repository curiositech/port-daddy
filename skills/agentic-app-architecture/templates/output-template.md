# Agentic App Architecture Decision

[One-sentence description of the app being architected, and whether it is a coding agent or non-coding agent.]

```json
{
  "appName": "[app name]",
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
      "coreSize": 0,
      "perProjectSpecialists": true
    },
    "secretCustody": {
      "mode": "hidden-stdin"
    }
  },
  "execution": {
    "agentType": "coding",
    "isolation": true,
    "sideEffectHumanGate": true,
    "artifactReceipts": true
  }
}
```

## Rationale by axis

- **Transparency**: [what the human sees, and how they interrupt/steer.]
- **State/memory**: [what persists, how forking works, what gets promoted to episodic memory and with what TTL.]
- **Context/caching**: [caching strategy, eviction trigger, what gets promoted out of the window.]
- **Capabilities**: [tools/skills/MCP topology, and exactly how secrets reach tool calls.]
- **Execution substrate**: [isolation model, human-gate points, and what the receipt looks like.]

Validate with `node scripts/agentic_app_audit.mjs --input <this-file-as-json>.json`
before treating the architecture as sound — the auditor will catch a hidden
thinking/tool-use surface, transcript-only state, an unbounded context
strategy, unsafe secret custody, or ungated side effects.
