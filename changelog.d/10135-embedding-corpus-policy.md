type: changed

- **Embedding selection is now corpus-policy-bound.** Registered profiles declare retrieval roles, quality tiers, and execution class; `lib/retrieval-policy.ts` selects by corpus privacy and egress policy; local Transformers.js producers verify pinned artifact/runtime digests and vector shape; and `pd embed text|stdin` requires `--corpus` while returning the selected policy and immutable `spaceId`. MiniLM remains a degraded local fallback, BGE remains remote and declarative-only, and unregistered code-profile requests fail closed instead of guessing a model.
