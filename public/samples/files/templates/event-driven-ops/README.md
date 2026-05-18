# Event-Driven Ops Template

A template for an autonomous SRE (Site Reliability Engineer) swarm that monitors production, creates incident tickets, and attempts automated rollbacks or fixes.

## Architecture

1.  **PagerAgent:** Subscribes to a webhook endpoint that receives Datadog/PagerDuty alerts. Translates JSON payloads into `pd msg` events on the `ops:incident` channel.
2.  **Investigator Agent:** Triggered by `ops:incident`. Reads the logs, queries the database, and leaves its findings in its Session Notes.
3.  **Commander Agent:** Reads the Investigator's notes. Uses `pd lock acquire prod-deploy` to prevent human deploys while it attempts to run an automated rollback script.

## Setup

```bash
pd up
# Simulate a PagerDuty webhook
curl -X POST http://localhost:9876/webhooks/incoming -d '{"status":"down"}'
```

## How it uses Port Daddy
*   **Webhooks:** Translates external HTTP calls into internal pub/sub messages.
*   **Agent Inbox:** Commander agent sends direct messages to the Investigator asking for specific log queries.
*   **Locks:** Prevents race conditions during critical production operations (like rollbacks).
*   **Time-Travel Debugging:** The activity log tracks exactly what the autonomous SRE swarm did during the incident for post-mortem analysis.
