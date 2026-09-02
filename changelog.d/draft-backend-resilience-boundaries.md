type: fixed

- Backend recovery now binds circuit probes to one operation and generation, bounds operations and backoff by one deadline, and retains a timed-out operation's reservation until physical completion. Dependency loaders preserve outage cooldown without retrying permanent authentication failures, and governed diagnostics omit raw failures and private dependency names.
- Dispatch no longer launches successors from stderr, arbitrary failure text, or forged error objects. The foreground adapter preserves process-local OS witnesses, but a timeout cannot authorize a successor without proof that descendants stopped. Production Conductor positive recovery still requires structured spawner transport and is not claimed by this fix.
