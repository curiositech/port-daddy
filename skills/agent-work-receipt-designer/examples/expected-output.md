# Example Output: Agent Work Receipt

Scenario: Claude Code implementer agent fixes a launchd PATH gap so `pd install`
can find `claude`/`codex`/`aider` absolute paths (mirrors the real port-daddy
backend binary resolver work). This is the receipt a reviewer would see
attached to the PR — not the chat transcript.

```json
{
  "identity": {
    "agent": "implementer",
    "model": "claude-sonnet-5",
    "backend": "claude-code",
    "sessionId": "sess-9f2a",
    "operator": "erich.owens@gmail.com",
    "worktree": "/Users/erichowens/coding/port-daddy/.claude/worktrees/agent-a65f689e86e18f32b"
  },
  "intent": {
    "goal": "Add launchd PATH discovery fallback so pd install finds claude/codex/aider binaries.",
    "scope": ["core/src/install/bin_resolver.rs", "core/tests/bin_resolver_tests.rs"],
    "stopCondition": "cargo test -p port-daddy-core bin_resolver:: is green and pd doctor reports resolved paths.",
    "nonGoals": ["Do not change the daemon supervision code."]
  },
  "contextUsed": {
    "filesRead": ["core/src/install/mod.rs", "core/src/install/bin_resolver.rs", "AGENTS.md"],
    "rulesApplied": ["AGENTS.md", "CLAUDE.md"],
    "attachments": [],
    "priorReceipts": []
  },
  "actions": {
    "commands": [
      { "cmd": "cargo build -p port-daddy-core", "exitCode": 0, "durationMs": 18240, "cwd": "core" },
      { "cmd": "cargo test -p port-daddy-core bin_resolver::", "exitCode": 0, "durationMs": 4310, "cwd": "core" },
      { "cmd": "cargo clippy -p port-daddy-core -- -D warnings", "exitCode": 0, "durationMs": 9021, "cwd": "core" }
    ],
    "toolCalls": [
      { "tool": "Read", "count": 6 },
      { "tool": "Edit", "count": 3 },
      { "tool": "Bash", "count": 4 }
    ],
    "filesChanged": {
      "added": ["core/tests/bin_resolver_tests.rs"],
      "modified": ["core/src/install/bin_resolver.rs"],
      "deleted": [],
      "diffSummary": "+142 -18 across 2 files"
    }
  },
  "validation": {
    "artifactBacked": true,
    "tests": [
      {
        "name": "bin_resolver::finds_absolute_path_via_launchd_env",
        "command": "cargo test -p port-daddy-core bin_resolver::finds_absolute_path_via_launchd_env",
        "exitCode": 0,
        "artifactPath": ".port-daddy/receipts/artifacts/sess-9f2a-bin_resolver_test.log",
        "passed": true,
        "durationMs": 412
      },
      {
        "name": "bin_resolver::falls_back_when_path_missing",
        "command": "cargo test -p port-daddy-core bin_resolver::falls_back_when_path_missing",
        "exitCode": 0,
        "artifactPath": ".port-daddy/receipts/artifacts/sess-9f2a-bin_resolver_test.log",
        "passed": true,
        "durationMs": 388
      }
    ],
    "manualVerification": "Confirm on a machine where claude was installed via nvm (not Homebrew) that resolution still succeeds; CI runners only cover Homebrew paths."
  },
  "spend": {
    "tokensIn": 84210,
    "tokensOut": 6320,
    "costUsd": 1.42,
    "wallClockMs": 612000,
    "budgetUsd": 5,
    "turns": 14
  },
  "risks": [
    {
      "description": "Fallback only probes /opt/homebrew and /usr/local; asdf/nvm-managed installs are untested and may still fail to resolve.",
      "severity": "high",
      "mitigated": false,
      "checkFirst": true
    },
    {
      "description": "New resolver runs an extra `which` shellout at install time, adding ~40ms to `pd install` on cold cache.",
      "severity": "low",
      "mitigated": true
    }
  ],
  "rollback": {
    "checkpoint": "a79dcd81",
    "method": "git-revert",
    "verified": true
  },
  "provenance": {
    "contentHash": "sha256:3fbb0a9e1d9c4c2b8a7e6a4c1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d",
    "signedBy": "claude-code:sess-9f2a",
    "signatureAlg": "none",
    "timestamp": "2026-07-03T02:10:00Z",
    "replayCommand": "git checkout a79dcd81 -- core/src/install/bin_resolver.rs && cargo test -p port-daddy-core bin_resolver::"
  }
}
```

Running it through the linter confirms it is a genuinely high-proof receipt,
not just a well-formatted claim:

```
$ node scripts/receipt_lint.mjs --input receipt.json
{
  "pass": true,
  "score": 100,
  "missingFields": [],
  "findings": [],
  "recommendations": [
    "Receipt is structurally complete. Spot-check that the diff summary and top risk actually match the real change before trusting the score."
  ]
}
```

What makes this a *good* receipt, in reviewer terms: the top risk
(`checkFirst: true`) tells you exactly what to check first (nvm/asdf
installs), the diff summary tells you the blast radius before you open the
diff (+142/-18 across 2 files — small), and every `passed: true` test carries
both an `exitCode` and an `artifactPath` — nobody has to take the agent's word
for it.
