# Multi-Agent Coordination Patterns

This isn't a demo. It's the actual protocol for agent coordination.

## The Problem

Multiple agents working on the same codebase need to:
1. **Find each other** — How does Agent B know Agent A exists?
2. **Share discoveries** — How does Agent A's finding reach Agent B?
3. **Avoid conflicts** — How do they not step on each other's work?
4. **Converge** — How do they know when a problem is solved?

## The Protocol

### 1. Channel Naming Convention

Agents find each other through predictable channel names:

```
{scope}:{topic}:{qualifier}

Examples:
  project:myapp:changes      # All changes in myapp
  bug:JIRA-123:war-room      # Debugging session for a specific bug
  file:src/api/users.ts:edits # Edits to a specific file
  agent:agent-xyz:inbox      # Direct messages to an agent
```

**The convention IS the discovery mechanism.** If you're working on bug JIRA-123, you subscribe to `bug:JIRA-123:war-room`. No registry lookup needed.

### 2. Message Schema

Every message follows this structure:

```typescript
interface AgentMessage {
  // Who sent this?
  agent: string;           // Agent identifier

  // What type of message?
  type: 'status' | 'finding' | 'question' | 'answer' | 'claim' | 'release' | 'done';

  // Human-readable summary
  message: string;

  // Structured payload (type-specific)
  data?: Record<string, unknown>;

  // For threading/correlation
  replyTo?: string;        // Message ID being responded to

  // Timestamp (Unix ms)
  ts: number;
}
```

### 3. Coordination Primitives

Port Daddy provides three primitives. Everything else is convention.

| Primitive | CLI | SDK | Purpose |
|-----------|-----|-----|---------|
| **Pub/Sub** | `pd pub`, `pd sub` | `pd.publish()`, `pd.subscribe()` | Broadcast discoveries |
| **Locks** | `pd lock`, `pd unlock` | `pd.lock()`, `pd.unlock()` | Exclusive access to resources |
| **Notes** | `pd note`, `pd notes` | `pd.note()`, `pd.notes()` | Persistent memory |

### 4. Pattern: Join → Work → Share → Done

```bash
# 1. JOIN: Subscribe to the coordination channel
pd sub "bug:JIRA-123:war-room" &

# 2. ANNOUNCE: Let others know you're here
pd pub "bug:JIRA-123:war-room" '{
  "agent": "'"$AGENT_ID"'",
  "type": "status",
  "message": "Joining war room - I will search git history",
  "ts": '"$(date +%s000)"'
}'

# 3. CLAIM: Lock resources you need exclusive access to
pd lock "bug:JIRA-123:git-bisect" -t 300000

# 4. WORK: Do your analysis...
RESULT=$(git bisect ...)

# 5. SHARE: Publish findings
pd pub "bug:JIRA-123:war-room" '{
  "agent": "'"$AGENT_ID"'",
  "type": "finding",
  "message": "Bug introduced in commit abc123",
  "data": {"commit": "abc123", "date": "2024-01-15"},
  "ts": '"$(date +%s000)"'
}'

# 6. RELEASE: Unlock resources
pd unlock "bug:JIRA-123:git-bisect"

# 7. RECORD: Save to permanent memory
pd note "Bug JIRA-123: Introduced in commit abc123 on 2024-01-15"
```

## Real Examples

### Example 1: File Edit Coordination

Two agents want to edit the same file. Here's how they coordinate:

```bash
# Agent A starts editing
pd pub "file:src/api/users.ts:edits" '{
  "agent": "agent-a",
  "type": "claim",
  "message": "Editing lines 40-60 to add null check",
  "data": {"lines": [40, 60], "intent": "null-check"},
  "ts": '"$(date +%s000)"'
}'

# Agent B sees the claim and waits (or works on different lines)
pd sub "file:src/api/users.ts:edits" | jq -r 'select(.type == "claim")'

# Agent A finishes
pd pub "file:src/api/users.ts:edits" '{
  "agent": "agent-a",
  "type": "release",
  "message": "Done editing lines 40-60",
  "ts": '"$(date +%s000)"'
}'
```

### Example 2: Parallel Investigation

Three agents investigate a bug. Each subscribes to the same channel and publishes findings:

```bash
# All agents subscribe
pd sub "bug:JIRA-123:war-room" | while read msg; do
  type=$(echo "$msg" | jq -r '.type')
  agent=$(echo "$msg" | jq -r '.agent')

  # React to other agents' findings
  if [[ "$type" == "finding" && "$agent" != "$MY_ID" ]]; then
    # Maybe this finding helps me narrow my search
    echo "Got finding from $agent: $(echo "$msg" | jq -r '.message')"
  fi

  # Check for convergence
  if [[ "$type" == "done" ]]; then
    echo "Solution found by $agent"
    break
  fi
done
```

### Example 3: Request/Response

Agent A needs help from Agent B:

```bash
# Agent A asks a question
MSG_ID="q-$(date +%s)"
pd pub "project:myapp:help" '{
  "agent": "agent-a",
  "type": "question",
  "message": "What is the auth middleware doing at line 42?",
  "data": {"file": "src/middleware/auth.ts", "line": 42, "msgId": "'"$MSG_ID"'"},
  "ts": '"$(date +%s000)"'
}'

# Agent B sees the question and answers
pd pub "project:myapp:help" '{
  "agent": "agent-b",
  "type": "answer",
  "message": "Line 42 validates JWT expiry. It throws if token is expired.",
  "replyTo": "'"$MSG_ID"'",
  "ts": '"$(date +%s000)"'
}'
```

## What's Reusable

The **protocol** is reusable, not the agents themselves. Any agent that follows this protocol can coordinate with any other agent:

1. **Subscribe to predictable channels** based on what you're working on
2. **Publish structured messages** using the AgentMessage schema
3. **Use locks** for exclusive access
4. **Use notes** for persistent memory

The actual analysis logic (git bisect, code search, etc.) is up to each agent. Port Daddy just provides the coordination infrastructure.

## What You Learn

1. **Coordination is a solved problem** — You don't need custom protocols or file-based locking
2. **Channel naming is discovery** — Predictable names mean agents find each other automatically
3. **Structured messages enable composition** — Any agent can consume any other agent's findings
4. **The primitives are simple** — pub/sub, locks, notes. Everything else is convention.
