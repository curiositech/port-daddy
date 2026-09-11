type: fixed

- **Spawned agents bind their managed session to the verified physical target before any backend starts.** Codex, Claude Code, Antigravity, Gemini and other local harnesses cannot inherit the daemon's working directory; explicit non-Git directories and projectless API agents no longer borrow its Git worktree. Target replacement, mismatched session state and cancellation prevent launch and retain exact-session cleanup.
