type: added

- **Dispatches can continue on a healthy backend after one backend fails.** The Helmsman failover path retains the predecessor's worktree and handoff context, applies its remaining budget to the successor, and records execution identities so operators can follow a recovery instead of restarting work from scratch.
