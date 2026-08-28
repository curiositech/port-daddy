type: fixed

- **Fleet reviews no longer serialize every active pull request through one worker.** `apps/fleet-executor/wrangler.deploy.toml` now drains at most three checkpointed review slices at once, preserving each run's head checks, delivery fence, retry budget, and fail-closed dead-letter path while removing the backlog that left required `Port Daddy Fleet` checks pending for hours.
