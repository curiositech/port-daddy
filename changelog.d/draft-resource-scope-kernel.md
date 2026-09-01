type: security

- **A fail-closed multi-repository scope kernel is now available for integration.** `lib/resource-scope.ts` defines immutable account/team/harbor/project/repository/world authority, device- and perspective-bound grant decisions, source-local legacy quarantine, append-only attenuation, and exact embedding-space prefiltering. This is intentionally an unwired policy foundation: existing daemon routes, tables, search, messaging, locks, and vector stores are not claimed as enforced until follow-up migrations call the kernel.
