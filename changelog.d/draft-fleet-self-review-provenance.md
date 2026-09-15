type: fixed

- **GitHub App publication no longer suppresses independent Fleet review.** The self-review guard now requires both the Fleet App identity and a Fleet-owned `purser/` or `fleet/` branch. App-published `codex/` branches and unresolved App identities fail toward review instead of a neutral skip.
