type: fixed

- **Metric-counter upgrades no longer compact an inherited history in one transaction.** Maintenance now prunes or rolls up at most 5,000 source rows per atomic pass, resumes from remaining rows after interruption or restart, preserves dimension-separated totals and late writes, and drains backlog on later flushes without holding the daemon behind a million-row first-flush lock.
