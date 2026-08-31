type: fixed

- **`pd learn` is now a read-only agent orientation.** The command no longer creates ports, sessions, notes, messages, DNS entries, locks, agents, or credentials; headless execution performs no daemon request, interactive execution limits its optional probe to `GET /health`, and both aliases skip freshness-driven daemon restart before dispatch. Help, first-run, and unknown-command hints now describe that contract instead of promising a stateful tutorial.
