# Always-On Dispatcher Template

This template provides a robust pattern for building a **Kernel Agent**—a long-lived, reactive process that acts as the "nervous system" for your agentic swarm.

## Core Features

1.  **Persistent SSE Connection:** Uses the Port Daddy `watch` primitive to maintain a real-time link to the pub/sub bus.
2.  **Self-Healing Reconnect Loop:** Automatically re-establishes connection with exponential backoff if the Port Daddy daemon restarts.
3.  **Dynamic Dispatch Registry:** Map specific event patterns (e.g., `build:failed`, `deploy:success`) to agent spawning logic.
4.  **Audit Trail Integration:** The kernel agent records every dispatch decision as an immutable Session Note.

## How to use

```bash
# 1. Start Port Daddy
pd start

# 2. Launch the dispatcher
npm run start:dispatcher
```

## Anatomy of the Dispatcher

The dispatcher listens to a broad channel pattern (e.g., `myapp:*`). When a message arrives, it evaluates the payload:

*   **Build Failures:** Spawns a Debugger agent.
*   **Security Alerts:** Spawns a Scanner agent.
*   **Performance Regressions:** Spawns a Profiler agent.

This moves your swarm from a sequential "pipeline" to a truly **event-driven organism**.
