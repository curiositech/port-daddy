type: fixed

- **`pd learn` is now an operationally read-only agent orientation.** The handler no longer creates ports, sessions, notes, messages, DNS entries, locks, agents, credentials, or indexes; both aliases skip freshness probes and cache writes, headless execution performs no handler daemon request, and interactive execution limits its optional witness to one 750 ms `GET /health` with reconnect retry disabled. The CLI envelope still makes exactly one append-only usage-telemetry attempt, which the guide and help now disclose.
