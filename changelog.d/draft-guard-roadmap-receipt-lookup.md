type: fixed

- Guard now checks a linked session's exact roadmap item in its intended harbor instead of searching the first 200 global rows; unrelated items cannot satisfy linked work, existing agent/freshness checks remain required, and incomplete or unavailable lookups are reported separately from missing receipts. Checks using `--dir` infer the target repository's harbor, while explicit and environment harbor overrides retain precedence.
