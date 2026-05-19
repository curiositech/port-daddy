# Reactive CI Pipeline Template

This template demonstrates a completely local, AI-powered CI/CD pipeline built on Port Daddy's Reactive DAG capabilities.

## Architecture

1.  **Code Watcher (`fs-monitor`):** Watches the `src/` directory for changes.
2.  **Linter Agent:** Triggered by `code:changed` events to lint and format code.
3.  **Test Runner:** Triggered by `lint:passed` events to execute unit tests.
4.  **Debugger Agent:** Automatically spawned if `test:failed` is published. It reads the test output via Port Daddy session notes, attempts a fix, and triggers the pipeline again.

## Setup

```bash
# Start the orchestration daemon if not running
pd start

# Launch the pipeline
pd up
```

## How it uses Port Daddy
*   **Pub/Sub:** Agents use channels like `code:changed`, `test:failed` to trigger each other.
*   **Orchestrator:** `pd watch` scripts listen to these channels and spawn AI agents via `pd spawn`.
*   **Time-Travel Debugging:** If the pipeline loops infinitely, use the Port Daddy Dashboard to trace the exact sequence of events.
