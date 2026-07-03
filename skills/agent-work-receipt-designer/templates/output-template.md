# Agent Work Receipt Template

[One-sentence description of the task the receipt covers.]

```json
{
  "identity": {
    "agent": "[role name, e.g. implementer/reviewer/tester]",
    "model": "[model id if known]",
    "backend": "[claude-code|codex|cursor|aider|windsurf|copilot|homegrown|ci|other]",
    "sessionId": "[durable session id]",
    "operator": "[human supervisor, if any]",
    "worktree": "[absolute path, if isolated]"
  },
  "intent": {
    "goal": "[what the agent set out to do]",
    "scope": ["[file or dir the agent was authorized to touch]"],
    "stopCondition": "[the exact command/behavior that means 'done']",
    "nonGoals": ["[explicitly out of scope]"]
  },
  "contextUsed": {
    "filesRead": ["[files the agent actually read]"],
    "rulesApplied": ["[CLAUDE.md/AGENTS.md/ADRs/lint config consulted]"],
    "attachments": [],
    "priorReceipts": []
  },
  "actions": {
    "commands": [
      { "cmd": "[exact command]", "exitCode": 0, "durationMs": 0, "cwd": "[dir]" }
    ],
    "toolCalls": [
      { "tool": "[tool name]", "count": 0 }
    ],
    "filesChanged": {
      "added": [],
      "modified": [],
      "deleted": [],
      "diffSummary": "[+N -M across K files]"
    }
  },
  "validation": {
    "artifactBacked": false,
    "tests": [
      {
        "name": "[test name]",
        "command": "[command that ran it]",
        "exitCode": 0,
        "artifactPath": "[path to captured stdout/coverage/screenshot]",
        "passed": false,
        "durationMs": 0
      }
    ],
    "manualVerification": "[what a human still needs to check by hand, and why]"
  },
  "spend": {
    "tokensIn": 0,
    "tokensOut": 0,
    "costUsd": 0,
    "wallClockMs": 0,
    "budgetUsd": 0,
    "turns": 0
  },
  "risks": [
    {
      "description": "[most severe unresolved risk first]",
      "severity": "[critical|high|medium|low]",
      "mitigated": false,
      "checkFirst": true
    }
  ],
  "rollback": {
    "checkpoint": "[git sha / stash ref / snapshot id]",
    "method": "[git-revert|git-reset|stash-pop|snapshot-restore|migration-down|feature-flag-off|manual|none]",
    "verified": false
  },
  "provenance": {
    "contentHash": "[sha256 of the receipt body]",
    "signedBy": "[key id or identity, if signed]",
    "signatureAlg": "[algorithm, if signed]",
    "signature": "[signature, if signed]",
    "timestamp": "[ISO 8601 timestamp]",
    "replayCommand": "[command to reconstruct validation from the checkpoint]"
  }
}
```

Validate with `node scripts/receipt_lint.mjs --input <this-file-as-json>.json`
before treating `artifactBacked: true` as real — the linter will catch a
`passed: true` test with no `exitCode`/`artifactPath` and fail the receipt.
