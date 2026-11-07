type: fixed

- **Dispatch database mutations reject stale or substituted admission.** Queue writes and conflict recovery bind the original operation, inputs, affected IDs and policy/model revision in one SQLite transaction. Database copies no longer resurrect legacy jobs, and generic retention cannot target dispatch control tables. Remote merges and launches remain separate authority boundaries.
