type: fixed

- **Advisory jobs and stale roadmap projections no longer masquerade as merge blockers.** `ci-gate` now summarizes only the CI jobs named by the live 18-context ruleset, the roadmap gate validates an explicit PR declaration without consulting `roadmap.snapshot.json`, and the library workflow no longer fails on an unregistered-work projection count.
