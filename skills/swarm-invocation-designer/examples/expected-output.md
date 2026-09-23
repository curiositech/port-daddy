# Example Output: Swarm Invocation Designer

## Invocation Pattern

Pattern: "summon a three-agent review swarm from one PR"

Roles:
- Skeptic: correctness and edge cases.
- PM reviewer: user impact and release readiness.
- Security reviewer: secrets, auth, sandbox, and data exposure.

Operator flow:
1. Select PR.
2. Click swarm icon.
3. Choose review depth.
4. See roles claim scopes and stream receipt events.
5. Accept fixes, defer findings, or stop the swarm.

## Message Contracts

```json
{
  "type": "agent.intent.v1",
  "traceId": "trace-123",
  "role": "security-reviewer",
  "scope": { "pr": 123, "files": ["routes/auth.ts"] },
  "budget": { "usd": 2, "timeoutMs": 900000 },
  "replyTo": "session://operator/review-swarm"
}
```

Hot path messages stay under 1 KB and carry handles, not full transcripts. Durable receipts store the long-form transcript, diff, and test output.

## Latency Report

```json
{
  "name": "review-swarm-bus",
  "targetP95Ms": 30,
  "hotP95Ms": 6,
  "pass": true,
  "icpGuidance": "If ICP means IPC, yes: typed local messages can be sub-millisecond to low-millisecond..."
}
```

## Hard Boundaries

- Every agent has identity, scope, budget, and kill switch.
- Coordination state is observable from the operator surface.
- Internet Computer style persistence is acceptable for settlement/receipts, not hot chatter.
