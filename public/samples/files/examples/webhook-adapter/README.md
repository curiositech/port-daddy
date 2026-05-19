# Local Webhook To Agent

This example turns any webhook-shaped POST into a request for the local agent
session already running in the project.

Start the agent side:

```bash
pd tube chat:mentions
```

Run the adapter:

```bash
npx tsx examples/webhook-adapter/local-webhook-to-agent.ts
```

Send a Slack, Discord, Linear, or generic payload:

```bash
curl -sS http://127.0.0.1:8787/webhook \
  -H 'Content-Type: application/json' \
  -d '{"source":"linear","issue":"PD-42","text":"Can you explain the failing release check?"}'
```

The adapter publishes that JSON into `chat:mentions`, tells the caller which
Port Daddy message id was created, and, by default, waits for the agent reply.

For fire-and-forget mode:

```bash
curl -sS 'http://127.0.0.1:8787/webhook?wait=0' \
  -H 'Content-Type: application/json' \
  -d '{"source":"slack","text":"Please inspect the current branch"}'
```

This is the useful core of a bot backend. The bot does not host the agent; the
developer's workstation is the backend.
