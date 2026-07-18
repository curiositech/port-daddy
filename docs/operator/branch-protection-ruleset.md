# `main` branch protection — the ruleset (operator runbook)

`main` protection on `curiositech/port-daddy` is a single **repository ruleset**,
not legacy "classic branch protection". Classic protection was deleted on
2026-07-18 (it had silently survived a UI "wipe" and its `strict: true` was
overriding the ruleset via union-enforcement). The ruleset is now the sole
authority.

- **Ruleset:** `main merge queue`, id **`17604542`**, target `branch`, enforcement `active`.
- Inspect: `gh api repos/curiositech/port-daddy/rulesets/17604542`

## What the ruleset enforces

| Rule | Setting |
| --- | --- |
| `required_status_checks` | 18 contexts (below), `strict_required_status_checks_policy: **false**` (no require-branch-up-to-date — the merge queue sequences merges, so rebasing before merge is redundant friction) |
| `merge_queue` | `merge_method: REBASE`, `grouping_strategy: ALLGREEN`, `check_response_timeout_minutes: 60` |
| `required_linear_history` | on |
| `deletion` | `main` cannot be deleted |
| `pull_request` | `required_approving_review_count: 0`, `required_review_thread_resolution: true` |
| `bypass_actors` | **Repository admin (`actor_id: 5`), `bypass_mode: pull_request`** — the safety valve |

### The 18 required contexts

`lint` · `unit-tests (ubuntu-latest, 22)` · `unit-tests (macos-latest, 22)` ·
`integration-tests` · `compiled-daemon-smoke` · `rust-kernel` · `rust-console` ·
`rust-console-gpui` · `fleetbar` · `fleet-ui` · `skill-hygiene` · `roadmap-link` ·
`pr-requirements-guard` · `doc-citation-guard` · `version-drift-guard` ·
`brand-color-guard` · `website-terminal-recordings` · `Port Daddy Fleet`

## Editing the ruleset — use `PUT`, NOT `PATCH`

GitHub's "update a repository ruleset" endpoint is **`PUT`**:

```
PUT /repos/{owner}/{repo}/rulesets/{ruleset_id}
```

A `PATCH` to that path matches no route and returns a **misleading `404 Not
Found`** — it looks like a permissions or path bug, but it is just the wrong
verb. (`GET` works with a read token; writing needs the `repo` scope.)

`PUT` can replace the whole ruleset, so **never send a partial body** (you would
wipe the 18 checks). Build the full body from a live `GET` plus your delta:

```bash
# Example: add/replace the admin bypass valve without touching anything else.
# Scratch lives under ~/coding/tmp (never /tmp — macOS purges it).
mkdir -p ~/coding/tmp/ruleset && out=~/coding/tmp/ruleset/put.json
gh api repos/curiositech/port-daddy/rulesets/17604542 | python3 -c "
import sys, json
d = json.load(sys.stdin)
json.dump({
  'name': d['name'], 'target': d['target'], 'enforcement': d['enforcement'],
  'conditions': d.get('conditions', {}), 'rules': d.get('rules', []),
  'bypass_actors': [
    {'actor_id': 5, 'actor_type': 'RepositoryRole', 'bypass_mode': 'pull_request'},
  ],
}, open('$out', 'w'))
"
gh api --method PUT repos/curiositech/port-daddy/rulesets/17604542 --input "$out"
```

Two more gotchas:

- **Editing branch protection / ruleset bypass actors is blocked by the Claude
  Code auto-mode classifier even after plan approval.** The operator must run the
  `gh api` mutation themselves via the `!` prefix (or outside auto mode).
- **Never remove the `bypass_actors` admin valve.** `Port Daddy Fleet` (posted by
  the external fleet app) has outaged before; with zero bypass actors, one stuck
  required check freezes **every** merge in the repo with no manual override.
  `bypass_mode: pull_request` lets an admin merge a stuck PR without allowing
  direct pushes to `main`.

## Never freeze the merge queue: required checks + `merge_group`

Every required context **must also report on `merge_group`**, or a queued PR
hangs forever waiting for a status that never comes. Two safe shapes:

- **Always-run** (ci.yml jobs, `pr-requirements-guard`, `roadmap-link`,
  `Port Daddy Fleet`): the workflow triggers on `merge_group` and reports.
- **Path-gated, skip = pass**: a job with a `merge_group` trigger and a
  `if: github.event_name != 'merge_group'` (or a `detect-changes` job-level
  `if:`) **skips** on the queued group, and a skipped job reports **success**.

**Do NOT require a workflow that is filtered at the *workflow* level**
(`on.pull_request.paths` / `on.push.paths`) unless it also has a `merge_group`
trigger — otherwise it never reports on unrelated PRs and freezes the queue.

`proofs`, `whitepaper-build`, and `whitepaper-metadata` are heavy, path-scoped
workflows. As of 2026-07-18 all three carry a `merge_group` trigger and skip
their heavy jobs on the queued group (`whitepaper-metadata` runs its fast check
unconditionally), so they report a `skipped=success` context and can never hang
the queue — even if later added to the required set. Their substantive work
still runs at `pull_request` time and on `push` to `main`.

Also keep advisory/non-deterministic checks **out** of the required set:
`claude-code-review`, `claude-adversarial-review`, `pr-comments`, and the
push-only `unit-tests-compat`.
