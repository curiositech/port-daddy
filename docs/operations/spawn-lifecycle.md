# Spawn lifecycle, liveness, and collection

`pd spawn` creates a durable run resource. The command that asks for the run is
only an observer of that resource. Closing a terminal, losing an HTTP response,
or restarting the Port Daddy daemon must not manufacture a task failure.

This is the canonical contract for CLI, MCP, SDK, Beacon, FleetBar, and
pd-console implementations.

## Why there is no default task timeout

Headless coding agents are not short RPCs. `codex exec` runs non-interactively
until the task completes and persists a resumable session unless the caller asks
for an ephemeral run. `codex exec resume` can resume by session ID or the most
recent run. See the official [Codex exec CLI source](https://github.com/openai/codex/blob/main/codex-rs/exec/src/cli.rs)
and [Codex non-interactive documentation](https://github.com/openai/codex/blob/main/codex-rs/README.md).

Claude Code follows the same general shape: `claude -p` is non-interactive,
`--resume` and `--continue` recover sessions, and `--max-turns` bounds model
turns when a caller needs an explicit limit. The CLI does not promise a single
universal wall-clock duration. See Anthropic's [Claude Code CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage).

A real run can therefore last seconds, hours, or longer. Duration follows the
task, tool calls, approvals, provider latency, and repository size. Port Daddy
must not guess that a healthy run is dead because an arbitrary clock expired.

This matches mature durable-execution guidance. Temporal recommends avoiding a
Workflow Execution Timeout in most cases and defaults it to infinity; task
timeouts detect a lost worker, not the business process's allowed duration. See
[Temporal's workflow failure detection guide](https://docs.temporal.io/encyclopedia/detecting-workflow-failures).
Kubernetes Jobs similarly make `activeDeadlineSeconds` optional and treat
finished-job cleanup as a separate retention concern. See [Kubernetes Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/).

## Five clocks, five different meanings

| Clock | What it bounds | Default | Expiry means |
|---|---|---:|---|
| Admission deadline | Validate request, reserve budget, persist receipt, enqueue start | Short and mandatory | Request was not admitted, or admission outcome must be reconciled by idempotency key |
| Startup deadline | Accepted receipt becoming an observable runtime | Backend-specific and finite | `no_runtime` or `failed_start`, never `timed_out` task work |
| Stall detector | Fresh heartbeat, provider observation, or tool/event progress | Adaptive warning policy | Investigate or offer interrupt; do not silently kill |
| Task deadline | Caller-declared maximum execution time | None | Explicit cancellation with the declared deadline recorded |
| Observation deadline | How long one client waits before returning | Short and local to the client | `outcome_unknown`; reconnect to the monitor URL |

Retention is a sixth policy and is intentionally separate. A terminal receipt,
transcript, event ledger, artifacts, and accounting remain collectible until an
explicit retention policy expires them.

## End-to-end flow

```mermaid
sequenceDiagram
    autonumber
    actor Operator as "Operator in FleetBar, Beacon, or pd-console"
    participant Client as "CLI, MCP, or SDK client"
    participant API as "Port Daddy admission API"
    participant Store as "Durable receipt and event ledger"
    participant Supervisor as "Spawn supervisor"
    participant Provider as "Codex, Claude, or another backend"
    participant UI as "First-class session projection"

    Operator->>Client: "Start or continue work"
    Client->>API: "POST with required idempotency key"
    API->>Store: "Atomically persist accepted receipt, lineage, workdir, budget, and outbox event"
    Store-->>API: "Stable receipt ID and monitor URL"
    API-->>Client: "202 Accepted"
    Client-->>Operator: "Show successor immediately"

    API->>Supervisor: "Dispatch after commit"
    Supervisor->>Store: "starting"
    Supervisor->>Provider: "Launch in requested worktree with selected daemon endpoint"

    alt "PID and fresh heartbeat or fresh remote-provider evidence"
        Provider-->>Supervisor: "Runtime evidence"
        Supervisor->>Store: "live plus PID, backend, model, transcript handle"
    else "Startup cannot produce a runtime"
        Supervisor->>Store: "no_runtime with exact reason"
    end

    loop "While work is observable"
        Provider-->>Store: "Heartbeat, event, tool, transcript, artifact, and accounting updates"
        UI->>Store: "Read or subscribe by stable receipt"
        Store-->>UI: "Current lifecycle and immutable history"
    end

    alt "Client observation ends first"
        Client-->>Operator: "Outcome unknown; reconnecting is safe"
        Client->>Store: "GET monitor URL with last event cursor"
    else "Operator explicitly interrupts or task deadline was declared"
        Operator->>Supervisor: "Cancel with reason"
        Supervisor->>Store: "cancelled"
    else "Backend finishes"
        Provider-->>Store: "completed or failed with terminal evidence"
    end

    Store-->>UI: "Collect transcript, artifacts, costs, lineage, and terminal result"
```

## State contract

| Primary state | Required evidence | Operator meaning | Allowed primary action |
|---|---|---|---|
| `accepted` | Durable receipt exists | The request is owned; no runtime claim yet | Open successor |
| `starting` | Dispatch or startup attempt recorded | Runtime formation is in progress | Open successor |
| `live` | Positive local PID plus fresh registry heartbeat, or fresh authoritative remote-provider evidence | Runtime is observable now | Open successor; interrupt if permitted |
| `completed` | Backend terminal result and sealed collection metadata | Work ended successfully | Open successor |
| `failed` | Backend or supervisor terminal failure evidence | Work ended unsuccessfully | Open successor |
| `cancelled` | Explicit cancellation reason and actor | Work was intentionally stopped | Open successor |
| `no_runtime` | Durable shell exists but no runtime can be verified | The session and history exist; nothing is currently attached | Open successor; offer a deliberate new launch |
| `unknown` | Observer lost contact before a terminal fact was learned | The outcome is not known yet | Reconnect to the same receipt |

`running`, `active`, a session row, a recent file timestamp, or a non-null agent
ID is not enough to claim `live`.

## Idempotency and atomic admission

The idempotency key is required. The same caller intent and key must always
return the same receipt. A conflicting payload under an existing key is a
conflict, not a second run.

The following facts commit together before dispatch:

- predecessor and successor lineage;
- requested working directory and resolved worktree identity;
- backend, model, budget, permission, and sandbox request;
- selected Port Daddy daemon identity, published endpoint, and exact CLI path;
- `accepted` lifecycle event;
- durable monitor, transcript, artifact, and accounting handles when known;
- an outbox item that makes startup retryable after process failure.

If dispatch happens but the admission response is lost, replaying the same key
returns the original receipt. If the caller cannot determine whether admission
committed, the truthful result is `unknown`, followed by reconciliation with the
same key.

## Liveness and recovery

The stable Port Daddy daemon is not the owner of an agent's truth. It projects a
durable ledger and supervises local processes. After a daemon restart:

1. Reload nonterminal receipts and their last event cursors.
2. Reconcile a recorded PID with the operating system and the agent registry.
3. Reconcile remote runs with authoritative provider observations.
4. Resume monitoring when evidence exists.
5. Use `no_runtime` when a durable session remains but no runtime can be proven.
6. Never rewrite a nonterminal receipt to `failed` solely because an in-memory
   process map was lost.

Heartbeat age is evidence, not a task deadline. A stalled run may raise an
operator-visible warning and expose `Interrupt`; automatic cancellation needs a
separate, explicit policy and a recorded reason.

## Collection and first-class UI

Every accepted receipt must be discoverable from the session roster immediately.
Beacon and native surfaces show the same canonical object:

- stable successor session and receipt IDs;
- predecessor link and continuation reason;
- exact lifecycle with freshness provenance;
- worktree and working directory;
- backend and model;
- permissions, sandbox, MCP/connectors, and background grants;
- current event or tool activity;
- transcript and artifact collection status;
- tokens, elapsed time, cost, and budget;
- one obvious **Open successor** action.

Decorative maritime motion is secondary. A working row may shimmer left to
right, carry a small wave, or rotate a ship's wheel while—and only while—the
plain state is `starting` or `live`. Reduced-motion mode removes the animation.
Nautical verbs may accompany exact state text, but never replace it.

## Operational rules

- `Ctrl-C` or a closed client detaches observation; it does not kill the run.
- `pd spawned <id>` and UI reconnects collect by stable receipt and event cursor.
- `pd spawn kill <id>` is an explicit destructive cancellation with an actor and
  reason; it is not timeout cleanup.
- Named development daemons and stable Homebrew daemons publish their actual
  endpoints. Children inherit the selected daemon identity and endpoint; no
  client guesses a port.
- A working directory is part of admission. The child process, session row,
  worktree ID, claims, transcript, and UI must all name the same directory.
- Terminal collection is immutable. Resumption creates a linked successor; it
  does not mutate the predecessor transcript.
