type: fixed

- Runtime skill-link synchronization preserves Git-tracked mirrors, including absent sparse-checkout paths, across every supported agent harness. Excluded directories are no longer replaced by ignored links that make tracked files appear deleted. Unverifiable Git reads and non-cone directory projections remain untouched; concurrent runs preserve existing targets.
