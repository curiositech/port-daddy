type: fixed

- Recognize clean work already contained in origin's advertised default branch when ordinary `pd done` lacks local upstream tracking or the feature upstream was deleted. The Git gate now requires origin-bound, freshly observed ancestry, rejects dirty or untracked work, and bounds non-interactive reads without fetching or rewriting Git state. Publication evidence remains separate from reviewed protected merge; the ledger-only `--no-pr` verifier is unchanged.
