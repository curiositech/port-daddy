{
  "schemaVersion":1,
  "enabled":true,
  "enabledAt":"2026-08-21T20:00:00.000Z",
  "capturedAt":"2026-08-21T20:00:00.600Z",
  "workspace":"/Users/operator/coding/port-daddy",
  "privacy":"Sanitized timing only: no argv, environment snapshot, prompts, tool inputs, tool results, stdout, or stderr are captured.",
  "retention":{"maxBytes":2097152,"eventPath":"/Users/operator/.port-daddy/squid/hook-events.log"},
  "sessions":[
    {
      "id":"codex-codex:7312-port-daddy",
      "runtimeSessionId":"codex:7312",
      "provider":"codex",
      "providerLabel":"Codex",
      "workspace":"/Users/operator/coding/port-daddy",
      "workspaceLabel":"port-daddy",
      "state":"running",
      "startedAt":"2026-08-21T20:00:00.000Z",
      "lastActivityAt":"2026-08-21T20:00:00.200Z",
      "steps":[
        {
          "id":"codex-turn-1","phase":"turn","label":"PD TURN","hook":"pd-hook-prompt","state":"completed",
          "startedAt":"2026-08-21T20:00:00.000Z","expectedBy":"2026-08-21T20:00:01.000Z","finishedAt":"2026-08-21T20:00:00.118Z",
          "durationMs":118,"deadlineMs":1000,"outcome":"executed","exitCode":0,
          "description":"PD TURN is gathering fresh coordination context before the agent begins this turn. The hook completed normally."
        },
        {
          "id":"codex-edit-1","phase":"edit","label":"PD EDIT","hook":"pd-hook-pre-tool","state":"running",
          "startedAt":"2026-08-21T20:00:00.200Z","expectedBy":"2026-08-21T20:00:01.200Z","finishedAt":null,
          "durationMs":null,"deadlineMs":1000,"outcome":null,"exitCode":null,
          "description":"PD EDIT is checking project ownership and destructive-command safety before mutation. It is still inside its configured deadline."
        }
      ]
    },
    {
      "id":"claude-claude:8841-port-daddy",
      "runtimeSessionId":"claude:8841",
      "provider":"claude",
      "providerLabel":"Claude Code",
      "workspace":"/Users/operator/coding/port-daddy",
      "workspaceLabel":"port-daddy",
      "state":"skipped",
      "startedAt":"2026-08-21T19:59:58.000Z",
      "lastActivityAt":"2026-08-21T19:59:58.012Z",
      "steps":[{
        "id":"claude-trace-1","phase":"trace","label":"PD TRACE","hook":"pd-hook-post-tool","state":"skipped",
        "startedAt":"2026-08-21T19:59:58.000Z","expectedBy":"2026-08-21T19:59:59.000Z","finishedAt":"2026-08-21T19:59:58.012Z",
        "durationMs":12,"deadlineMs":1000,"outcome":"project_disarmed","exitCode":0,
        "description":"PD TRACE is recording a compact coordination outcome after the tool without retaining its payload. The gate skipped the hook because this project was not armed."
      }]
    }
  ]
}