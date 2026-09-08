# CI safety and approvals

An operator halt stays in force until the operator explicitly lifts it. Editing
workflows, creating an environment, passing tests, or merging a PR does not lift
that order. Do not start PD, pd-console, FleetBar, supervisors, or paid agents to
validate these changes. Do not re-enable disabled publication or reviewer jobs.

## Merge checks and deployment approval are separate

`ci-gate` includes `unit-tests-macos` (`unit-tests (macos-latest, 22)`). A failure
or current-head cancellation there makes the aggregate fail. Both PR and
`merge_group` events report the gate. The separate macOS required check can be
removed from the ruleset after this aggregate wiring lands and is verified.

`pr-requirements-guard` keeps summary, test-plan, visual-evidence and changelog
validation, including description edits, but has only `contents: read` authority.
It no longer invokes Fleetbot reviewer requests. This does not disable separate
review workflows, installed Apps, or external webhooks; those are independently
controlled by the operator.

`roadmap-link` validates a declaration, not daemon health:

- An existing slug is checked against the committed snapshot. A stale snapshot
  produces an explicit warning, not fabricated current status or a new timestamp.
- Genuinely new work may declare matching `Roadmap-Item:` and `Roadmap-Spawns:`
  trailers. That reviewed PR records intent; it does not create or execute a
  daemon item. Do not call existing work new just to silence an unknown link.
- Chores/docs/hotfixes may use `Roadmap-Item: none — <reason>`.
- Missing or unknown links still fail, as do planning documents without a spawn
  declaration or an explicit no-new-work reason. Missing snapshot evidence still
  fails existing-item links. Restore a known snapshot from Git, never by restarting
  an operator-halted daemon.

The recommended halted ruleset requires `ci-gate`, not `Port Daddy Fleet`.
Keep PRs, resolved review threads, deletion protection and force-push blocking;
use one concurrent merge-group build and `ALLGREEN`. Metadata workflows can be
required once their safe versions are on the default branch and enabled. Do not
require a disabled check: it cannot report. None of these settings is changed by
the workflow files themselves.

## Publication boundary

The following jobs reference `environment: production` before any steps run:

| Workflow | Jobs |
| --- | --- |
| `release-train.yml` | `cut`, `tag-and-publish` |
| `release.yml` | `build-binaries`, `build-fleetbar-preview`, `build-pd-console-app`, `build-latest-json` |
| `publish.yml` | `publish` (including manual dry runs) |
| `deploy-fleet-executor.yml`, `deploy-steward.yml` | `deploy` |
| `deploy-relay.yml`, `deploy-relay-prod.yml`, `deploy-relay-do-migration.yml` | `deploy` |
| `deploy-website-v2.yml` | `build-and-deploy` |

`production` is the shared operator-approval boundary for these live publication
jobs, including relay-latest. A multi-job release may pause for approval again
as downstream publishing jobs become ready. Build and publish remain in their
existing jobs, so approval precedes their builds too. PR test jobs are not gated
on a production approval. `update-homebrew` only waits for the independent tap
producer; it does not publish. PDF build workflows rebuild/check PDFs and can
commit them to same-repository PR branches; they do not deploy the live website.

In repository **Settings → Environments → production**, require the operator as
a reviewer and disallow administrator bypass. A sole operator may leave
**Prevent self-review** off. Review allowed deployment refs deliberately: stable
release tags need access as well as `main`. The YAML reference alone is not
protection: GitHub creates a missing environment without approval rules.
[GitHub environment documentation](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

This is not a global credential confinement guarantee. Existing repository-level
secrets and independent workflows/Apps remain separate surfaces to audit. No
secrets are moved, no runtime data is changed, and no workflow is enabled by this
patch. Older tagged workflow revisions also retain their older behavior; do not
re-run them assuming they acquired a newly merged gate.

## Offline validation for contributors

Prepare the PR description and newline-delimited changed-file list in the linked
worktree. With existing dependencies, this command reads only those files and the
committed snapshot; it never contacts GitHub or PD:

```sh
npx --no-install tsx scripts/check-roadmap-link.ts --body-file pr.md --files-from changed.txt
```

`--files-from` is required in offline mode so planning checks cannot silently
disappear. Exit zero means the declaration and applicable planning rules pass;
it is not permission to publish or operate the daemon. A local PR-number lookup,
even with `--dry-run`, still reads GitHub; use the file-based form for full isolation.

The regression suites `ci-gate-needs`, `ci-publication-boundary`,
`roadmap-link-core`, and `roadmap-link-offline` run in the existing unit-test CI
project. They parse workflow structure and exercise fail/pass cases, including
offline command traps for accidental GitHub/PD calls. During a halt, run only
audited pure tests, not the full integration or release smoke suites.
