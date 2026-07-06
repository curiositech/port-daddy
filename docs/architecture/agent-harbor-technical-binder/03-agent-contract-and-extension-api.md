# 03 Agent Contract And Extension API

## What compliance means

An official Port Daddy Agent Node is not merely a process with a note. It is a
body bound to a soul through the Articles of Agreement.

Compliance must be daemon-witnessed, not self-attested by the body. The daemon
issues Agent Node ids, signs Articles, grants expiring capability leases, and
uses nonce challenges for adapters. A body can request capabilities; it cannot
declare itself compliant.

Compliance levels:

C0 - Registered:
  The daemon knows the Agent Node identity, provider, body type, workspace,
  authority, and heartbeat.

C1 - Transcripted:
  The body streams normalized events: operator messages, assistant deltas, tool
  calls, tool results, shell commands, file touches, approvals, errors, and stop
  reasons. If a provider does not expose hidden reasoning, Port Daddy records
  visible reasoning summaries and tool traces, not fabricated private thought.

C2 - Governed:
  The body routes tool use through pre-tool and post-tool checks. Port Daddy can
  block destructive git actions, secret exfiltration, broad filesystem writes,
  deploys, and budget violations.

C3 - Suggestible:
  Turn-start guidance, inbox messages, repo updates, parley suggestions, skill
  grafts, memory packets, and conflict warnings can be injected before the next
  model turn.

C4 - Controllable:
  The operator can pause, interrupt, send a message, request a checkpoint,
  fork/take over, retire, or create a successor without destroying old evidence.

C5 - Cooperative:
  The node can claim files or symbols, respond to parleys, participate in a
  shared channel or blackboard, receive assignments from Longshoremen, and
  publish structured status.

C6 - Resumable:
  The node can be reconstructed from transcript, memory packet, workspace,
  model/provider metadata, and active commitments. Resume means "create a
  successor with enough captured state to act as the same role," not "mutate old
  history."

The UI should show compliance as a ladder with failed probes and remediation.

## Agent Runtime Protocol

Every native or custom body should target the same protocol. It can be exposed
over stdio, HTTP+SSE, WebSocket, or a local adapter.

Required lifecycle calls:

```json
{
  "type": "agent.register",
  "agentId": "agent-...",
  "registrationNonce": "nonce-issued-by-daemon",
  "articlesSignature": "sig:...",
  "sessionId": "session-...",
  "identity": "repo:role:purpose",
  "body": {
    "kind": "codex-cli",
    "provider": "openai",
    "modelTier": "strong",
    "modelName": "provider-specific-name"
  },
  "workspace": {
    "repo": "/abs/path/repo",
    "worktree": "/abs/path/worktree",
    "branch": "pd/agent-node"
  },
  "capabilities": ["stream", "tool-gate", "interrupt", "checkpoint"]
}
```

```json
{
  "type": "agent.heartbeat",
  "agentId": "agent-...",
  "status": "active",
  "context": {
    "windowTokens": 200000,
    "usedTokensEstimate": 71000,
    "compactionNeeded": false
  }
}
```

```json
{
  "type": "agent.complete",
  "agentId": "agent-...",
  "result": "success",
  "summary": "Implemented the focused patch and opened a draft PR.",
  "artifacts": ["pr:625", "file:/abs/path"]
}
```

Required stream event fields:

```json
{
  "eventId": "evt-...",
  "harborId": "harbor-...",
  "agentId": "agent-...",
  "sessionId": "session-...",
  "turnId": "turn-...",
  "sequence": 42,
  "occurredAt": "2026-06-30T12:00:00.000Z",
  "ingestedAt": "2026-06-30T12:00:00.120Z",
  "schemaVersion": 1,
  "kind": "assistant_delta",
  "visibility": "operator",
  "source": {
    "adapter": "codex-cli",
    "offset": "jsonl:12345"
  },
  "body": {},
  "blobRefs": [],
  "parentEventIds": [],
  "contentHash": "sha256:...",
  "prevHash": "sha256:...",
  "redaction": "none",
  "retention": "local-default",
  "provenance": {
    "provider": "openai",
    "body": "codex-cli",
    "modelTier": "strong"
  }
}
```

Event kinds should include:

- `operator_message`
- `system_guidance`
- `assistant_delta`
- `assistant_message`
- `tool_call`
- `tool_result`
- `shell_command`
- `file_read`
- `file_write`
- `file_diff`
- `git_action`
- `claim_update`
- `parley_event`
- `memory_retrieval`
- `skill_graft`
- `approval_request`
- `approval_result`
- `budget_event`
- `error`
- `checkpoint`
- `compaction_packet`
- `turn_end`
- `session_end`

## Tool gate protocol

Pre-tool check:

```json
{
  "type": "tool.preflight",
  "agentId": "agent-...",
  "tool": "bash",
  "intent": "git reset --hard",
  "cwd": "/abs/path/worktree",
  "risk": "destructive_git"
}
```

Possible daemon responses:

- `allow`
- `allow_with_note_required`
- `deny`
- `require_operator_approval`
- `rewrite_suggestion`
- `create_safe_alternative`

Example denial:

```json
{
  "decision": "deny",
  "reason": "Destructive git action would discard uncommitted work.",
  "alternatives": [
    "git status --short",
    "git stash push --include-untracked -m <reason>",
    "pd worktree reset --safe <id>"
  ]
}
```

Post-tool event:

```json
{
  "type": "tool.result",
  "agentId": "agent-...",
  "toolCallId": "tool-...",
  "exitCode": 0,
  "stdoutRef": "blob:...",
  "stderrRef": "blob:...",
  "filesTouched": ["/abs/path/file.ts"]
}
```

## Hooks

Port Daddy should support several integration strengths:

Native adapter:
  The agent is launched by Port Daddy and speaks the protocol directly.

Hooked adapter:
  The agent is launched by its native CLI, but hooks call Port Daddy at
  session start, turn start, pre-tool, post-tool, stop, and compact.

Proxy adapter:
  A compatibility layer such as Squid speaks a provider-shaped API to the agent
  body and speaks Port Daddy protocol to the daemon.

Observed adapter:
  The daemon tails logs or transcript files without tool control. This is useful
  for discovery but should remain marked weak.

Unmanaged:
  No reliable transcript or control. The app may list it if detected, but it
  must not pretend it is compliant.

Hook names and descriptions must be plain and above board. Example:

- "Port Daddy session registration: identifies this agent to your local Port
  Daddy daemon."
- "Port Daddy tool safety check: asks your local daemon before destructive or
  sensitive tool use."
- "Port Daddy transcript event: records visible agent messages and tool results
  according to your local retention settings."

No hook should claim to capture private model reasoning when the provider does
not expose it.

## MCP and scripts

Users should be able to use their MCP servers and scripts, but not as an
unguarded escape hatch.

Port Daddy should provide an MCP gateway:

- manifest for each MCP server;
- declared permissions: filesystem, network, secrets, browser, GitHub, shell;
- capability grants per harbor, repo, agent, and path;
- pre-tool decisions for high-risk calls;
- transcript events for calls and results;
- redaction rules for secrets and personal data;
- disable or repair flow in `pd doctor`.

Official launches should rewrite MCP config, environment, and PATH so the body
sees the daemon gateway and approved script shims, not arbitrary direct tools.
If an agent uses modified MCP config, direct PATH scripts, or a disabled hook,
Port Daddy downgrades it to observed or unmanaged until `pd doctor` repairs the
path. The probe suite needs a fixture where an agent tries direct MCP access
after hook removal.

Scripts should use the same model. A user can register a script as a tool with a
manifest:

```json
{
  "name": "run-focused-tests",
  "command": "npm test -- --runInBand",
  "cwdPolicy": "worktree",
  "permissions": ["read_repo", "write_artifacts"],
  "risk": "low"
}
```

High-risk scripts need explicit approval or a narrower sandbox.

## Custom agent API

Custom agents should target a small public contract:

1. Register with the daemon.
2. Stream normalized transcript events.
3. Request tool execution or report externally executed tools.
4. Accept turn-start guidance and interrupts.
5. Emit heartbeats and checkpoints.
6. Report context pressure.
7. Emit checkpoint and successor metadata.
8. Respect denied tool actions.
9. Accept negative probes that verify denied tools had no side effect.

For an agent that cannot accept all controls, the compliance probe reports the
truth. "Partial compliance" is fine. Fake compliance is not.

## Provider mappings

Claude Code:
  Use hooks for session start, turn start, pre-tool, post-tool, compact, stop,
  and transcript pointers where available. Claude Code native auth remains
  Claude Code auth. A Squid bridge may provide compatibility, but it is not an
  official Claude auth mode.

Codex CLI:
  Launch through Port Daddy when possible. Capture stream events, tool calls,
  approvals, file diffs, and session metadata. Native Codex transcripts should
  be imported into the same event store.

Cloudflare AI / Workers:
  Remote body with explicit authority, cost, secrets, and artifact retention.
  Streams over relay or direct daemon endpoint. Must checkpoint before teardown.

Ollama / LM Studio:
  Local open-weight body through an Anthropic/OpenAI-style router or native
  adapter. Compliance depends on tool loop support. Mark experimental until
  streaming, tools, and context accounting are proven.

Custom:
  Use the Agent Runtime Protocol. The app should include a developer page with
  sample stdio and HTTP adapters plus a compliance test harness.

## Compliance probe

`pd agent probe <command-or-endpoint>` should test:

- can register;
- can heartbeat;
- can stream an assistant message;
- can record an operator message;
- can report a tool call and result;
- can be denied a destructive git command;
- can receive turn-start guidance;
- can receive an interrupt;
- can checkpoint;
- can report context pressure;
- can publish files touched;
- can generate a successor packet and replay it into a new session;
- can prove a denied destructive action had no side effect;
- can end with result artifacts.

The probe should produce:

- compliance level;
- failed checks;
- remediation steps;
- privacy implications;
- sample UI card;
- machine-readable report for `pd doctor`.

C6 resumability probe:

1. Create a session with transcript, tool, file, claim, memory, and commitment
   events.
2. Generate a compaction/checkpoint packet.
3. Spawn a successor without mutating the old session.
4. Verify active commitments, files, denied actions, permissions, and next
   action survive.
5. Verify old transcript remains append-only and linked as predecessor.

## Remediation protocol

When an Agent Node is non-compliant, the app should say exactly why:

- "No transcript stream. Install or enable the Port Daddy hook pack."
- "No tool gate. This agent can edit files without daemon approval."
- "No workspace binding. Start it in a Port Daddy worktree."
- "No heartbeat for 11 minutes. Mark stale, attach, or retire."
- "Missing skill graft tool. Reinstall MCP config."
- "Provider stream unavailable. Use observed mode or supported adapter."

Remediation should be one click when possible:

- install hooks;
- refresh MCP config;
- restart daemon;
- relaunch as compliant;
- attach worktree;
- rotate token;
- start successor from transcript;
- mark unmanaged.

`pd doctor` should expose the same checks for CLI and CI.
