# Tracker Integration Patterns

Use this when you need the actual linking syntax, CLI commands, and gate mechanics for a specific tracker, rather than the general discipline (see `tracker-discipline.md`).

## GitHub Issues

- **Search before filing**: `gh issue list --search "upload retry" --state all` (include closed; a duplicate of something closed as won't-fix is still worth reading).
- **Link a PR to an issue** with closing keywords in the PR body, not just the title: `Fixes #641`, `Closes #641`, `Resolves #641` — GitHub auto-closes the issue on merge and creates the visible cross-link both directions.
- **Non-closing reference**: `Refs #641` or a bare `#641` mention links without closing — use this when the PR only partially addresses the issue.
- **Branch naming as a soft link**: `641-fix-upload-retry` is conventionally understood but is NOT a mechanical link — always still add the trailer, don't rely on branch name parsing.
- **Copilot cloud agent assignment**: issues assigned to `@copilot` (or another cloud agent) are picked up directly from the issue body — this makes the issue's acceptance criteria the entire brief the agent receives; a vague issue produces a vague PR with no way to blame the agent for guessing.
- **Status via labels + project boards**, not a single enum field: `status:in-progress`, `status:blocked` labels, or a Projects (beta) board column. An agent updating "status" on GitHub Issues means moving the card/label, not just commenting.

## Linear

- **Search before filing**: Linear's fuzzy search on issue creation surfaces likely duplicates inline — read them before submitting, don't dismiss the suggestion panel reflexively.
- **Magic words in branch names and commits**: Linear parses issue identifiers (e.g. `ENG-123`) out of branch names and commit messages automatically and links them — `git checkout -b eowens/eng-123-fix-upload-retry` links on push without any extra trailer.
- **Auto-transition on PR lifecycle**: Linear can be configured to move an issue to "In Progress" when a linked branch is created and to "Done" when the linked PR merges — this is the mechanical enforcement of "status transitions require observable work" described in `tracker-discipline.md`; don't manually override the status ahead of the automation unless you have a concrete reason.
- **Sub-issues for spawned work**: when new work surfaces mid-task, create a sub-issue under the current one rather than a same-level duplicate — this preserves the "discovered while working on X" provenance link natively.

## Jira

- **Search before filing**: JQL search (`project = PROJ AND text ~ "upload retry"`) or the create-issue duplicate suggestions; Jira's suggestions are keyword-based and have real recall gaps — always also skim the last 20 items in the relevant epic/component by hand.
- **Issue keys in commits/branches**: `PROJ-123` in a commit message or branch name links automatically if the Jira/GitHub (or Bitbucket) integration is installed — smart commits (`PROJ-123 #comment fixed retry logic #time 2h`) can transition status and log time directly from the commit message, but treat smart-commit status transitions with the same evidence bar as any other: don't `#done` a commit before the PR merges and CI is green.
- **Status via workflow transitions**, not free-text: Jira enforces a workflow graph (`To Do -> In Progress -> In Review -> Done`), so an agent cannot skip straight from `To Do` to `Done` without going through whatever gates the workflow defines — use this as a feature; don't fight it by force-transitioning through the API without the same evidence a human would need.

## Port Daddy's own convention (this repo)

Port Daddy migrated its roadmap toward Jira-style items with slugs (ADR-0086) and enforces linkage mechanically rather than by convention alone:

- Every PR body carries exactly one trailer: `Roadmap-Item: <slug>` (or the explicit opt-out `Roadmap-Item: none — <reason>` for a chore/docs/hotfix).
- No item yet? `npx tsx scripts/roadmap-link.ts <pr-number>` creates a real `roadmap_items` row via `POST /roadmap/items` and stamps the trailer into the PR body in one step — there is no excuse for "I'll link it later."
- The `roadmap-link` GitHub Action is a **required, fail-closed status check**: it reads the committed `docs/roadmap/roadmap.snapshot.json` mirror and blocks merge on a missing/invalid trailer. A PR with no valid link also gets the `needs-roadmap-link` label as a second, human-facing stop.
- **Planning documents must declare what they spawn.** A PR touching an ADR, a `PLAN`/`ROADMAP` file, or a `docs/` proposal must also carry `Roadmap-Spawns: <slug-a>, <slug-b>` (or `none — <reason>`) — this is the mechanical version of "capture spawned work as new items" from `tracker-discipline.md`, enforced by file path so it fires on the actual document regardless of what the prose says.
- The snapshot mirror fails closed if stale (>21 days) or missing — a stale roadmap must never silently read as "all clear," so it blocks every PR, even correctly-linked ones, until regenerated with `npx tsx scripts/export-roadmap-snapshot.ts`.

## Cross-tracker trailer cheat sheet

| Tracker | Link mechanism | Enforced by |
| --- | --- | --- |
| GitHub Issues | `Fixes #123` / `Closes #123` / `Refs #123` in PR body | GitHub native auto-close; not mechanically required unless a bot/Action checks for it |
| Linear | Issue key (`ENG-123`) in branch name or commit | Linear's own branch/commit parser; workflow automation can enforce state |
| Jira | Issue key (`PROJ-123`) in commit/branch; smart commits | Jira/VCS integration; workflow graph blocks illegal transitions |
| Port Daddy | `Roadmap-Item: <slug>` PR trailer; `Roadmap-Spawns:` on planning docs | `roadmap-link` required CI check (fail-closed) + `needs-roadmap-link` label |

Whichever mechanism your tracker uses, the discipline is identical: the link must exist before or as part of the same change that does the work, never bolted on after the fact from memory.
