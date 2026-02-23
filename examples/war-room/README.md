# War Room: Multi-Agent Debugging Swarm

Three agents attack a bug simultaneously, sharing discoveries via Port Daddy's pub/sub. They build on each other's findings and converge on a solution faster than any single agent could.

## The Agents

| Agent | Role | Approach |
|-------|------|----------|
| **Historian** | Git archaeology | Binary searches history, finds when bug was introduced |
| **Tracer** | Runtime analysis | Traces execution, finds where values go wrong |
| **Scout** | Pattern matching | Searches codebase for similar working code |

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Historian  │     │   Tracer    │     │   Scout     │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────┬───────┴───────────┬───────┘
                   │                   │
                   ▼                   ▼
            ┌──────────────────────────────┐
            │   war-room-{bug-id} channel  │
            │      (Port Daddy Pub/Sub)    │
            └──────────────────────────────┘
                          │
                          ▼
                   ┌─────────────┐
                   │  Human/CLI  │
                   │  (watches)  │
                   └─────────────┘
```

## Quick Start

```bash
# Terminal 1: Watch the war room
pd sub war-room-bug-123

# Terminal 2: Start the historian agent
./historian.sh bug-123 "TypeError: Cannot read property 'id' of undefined"

# Terminal 3: Start the tracer agent
./tracer.sh bug-123 "src/api/users.ts:42"

# Terminal 4: Start the scout agent
./scout.sh bug-123 "property 'id' of undefined"
```

## What You'll See

The war room channel fills with real-time discoveries:

```
[Historian] Starting git bisect for bug-123
[Tracer] Instrumenting src/api/users.ts
[Scout] Searching for similar patterns...
[Scout] FINDING: src/api/posts.ts:87 handles this case with optional chaining
[Historian] FINDING: Bug introduced in commit a]4f2c1 (3 days ago) - "Refactor user fetching"
[Tracer] FINDING: user is undefined when called from /api/users/me with expired session
[Historian] Commit a]4f2c1 removed null check on line 38
[Scout] CORRELATION: posts.ts uses `user?.id` but users.ts uses `user.id`
[Tracer] CONFIRMED: Adding optional chaining fixes the trace
[ALL] ROOT CAUSE: Commit a]4f2c1 removed null check, fix is `user?.id` on line 42
```

**Time to root cause: ~45 seconds** (vs 20+ minutes for sequential debugging)

## The Magic

Each agent publishes findings as structured JSON:

```json
{
  "agent": "historian",
  "type": "finding",
  "confidence": 0.85,
  "data": {
    "commit": "a]4f2c1",
    "message": "Refactor user fetching",
    "date": "3 days ago",
    "diff_summary": "Removed null check on line 38"
  }
}
```

Agents subscribe to each other's findings and **build on them**:
- When Scout finds a pattern, Tracer tests if it applies
- When Historian finds the breaking commit, Scout examines its diff
- When Tracer confirms a fix, all agents converge

## Running the Demo

```bash
# 1. Make sure Port Daddy daemon is running
pd status

# 2. Create a bug to debug (or use your own)
cp demo-bug/broken.ts /tmp/test-project/src/api/users.ts

# 3. Open 4 terminals and run the quick start commands above

# 4. Watch the magic happen
```

## Adapting for Real Use

The agent scripts are templates. For real debugging:

1. **Historian**: Point at your actual git repo
2. **Tracer**: Use your actual test runner / debugger
3. **Scout**: Configure your codebase search paths

The coordination pattern stays the same - only the analysis logic changes.
