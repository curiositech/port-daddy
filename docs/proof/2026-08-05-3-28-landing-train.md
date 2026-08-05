# Port Daddy 3.28 landing train

This ledger preserves the release candidate while converting it into reviewable
merge units. It is evidence, not a second release authority.

## Why the aggregate PR closed

The preserved integration branch is
`codex/first-class-agent-sessions-integration-20260804`. Pull request #5714
opened from that branch and Fleet failed closed before model spend: its unified
diff required 554 review chunks.

Production Fleet aligns chunks to file boundaries, hard-splits a larger file,
and permits at most two 12,000-character chunks per review delivery. Ninety-nine
meaningful commits inside one PR therefore did not make the PR review-atomic.
The PR was closed; its branch, commits, failed check, review comment, runtime
receipts, screenshot, GIF, and diagnostic failures remain preserved.

No synthetic check, manual success conclusion, enlarged emergency budget, or
required-check bypass is permitted. The work lands as a train of bounded PRs.

## Train rules

1. Preserve integration commit order whenever one slice depends on another.
2. Parallelize only disjoint files whose behavior is independently valid on
   current `origin/main`.
3. Predict the exact Fleet chunks from the unified diff before push. A unit over
   two chunks must be decomposed again before a PR exists.
4. Every unit gets its own linked worktree, Port Daddy session, claims, scope and
   result notes, focused tests, adversarial review, required checks, and merge.
5. Generated mirrors and pure generated-artifact deletion may use mechanical
   equivalence evidence, but they may not be silently omitted from the diff.
6. Rebase each pending unit after its predecessor merges; never force an old
   integration snapshot over a moved `main`.
7. The release tree is reconstructed only when `git diff --exit-code` proves the
   merged tree agrees with the preserved integration target, including later
   reviewer fixes and honest proof artifacts.

## First parallel wave

| Unit | Integration source | Files | Spawn receipt | State |
| --- | --- | ---: | --- | --- |
| FleetBar selected endpoint | `96b85df264` | 2 | `run-2e087c0809addfda` | In flight |
| GPUI console selected endpoint | `96b85df264` | 2 | `run-42ba14680d51ddfd` | In flight |
| Shell completion endpoint guidance | `96b85df264` | 3 | `run-36e51331f0579eed` | In flight |
| Tube example endpoint discovery | `96b85df264` | 7 | `run-496ea07e33840cb0` | In flight |
| GPUI skill endpoint guidance | `96b85df264` | 2 | `run-3fa3d9426dac2bfb` | In flight |

The remaining file in the first integration commit,
`scripts/dev-triple.sh`, is itself larger than two Fleet chunks. It needs a
behavior-preserving two-step refactor; it must not be waved through as “one
file.”

## Release gates after the train

- Re-run the complete Jest, TypeScript, version-drift, skill-sync, public-boundary,
  documentation-citation, compiled-daemon, single-binary, and dynamic-endpoint
  validations on the reconstructed merged SHA.
- Build and select a named development daemon from that exact SHA. Read its
  published endpoint; never assume its preferred seed became the listener.
- Prove `pd squid on`, `pd attention`, a live receipt, transcript collection,
  exact accounting, Coast Guard confinement, and idempotent linked continuation.
- Obtain three independent exact-SHA guide verdicts: steelman, countercase, and
  adversarial. All must begin with `SHIP`; any code or guide change invalidates
  the set.
- Tag 3.28.0 only at the reviewed merge SHA, wait for release assets and tap
  provenance, upgrade the Homebrew installation, restart the installed daemon,
  and repeat the installed Squid attention/continuation proof.
