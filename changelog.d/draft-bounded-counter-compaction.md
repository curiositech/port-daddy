type: fixed

- **Metric-counter upgrades no longer prune inherited history in one unbounded transaction or leave minute history to grow unchecked.** Maintenance now scans at most 5,000 source rows per atomic pass, persists restart progress, rolls completed hours into total-preserving rows, rejects silently inexact partial-hour historical queries, and drains its backlog without a million-row first-flush scan inside the write lock.
