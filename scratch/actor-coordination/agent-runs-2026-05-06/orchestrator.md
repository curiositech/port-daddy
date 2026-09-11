# Orchestrator runbook — 2026-05-06 follow-on fanout

This is the orchestrator's (Claude Opus, in this session) playbook for
the six follow-on PRs spawned via `pd spawn` after PR #42 merged.

## Who is who

| PR | Branch | Worktree | Files | Status |
| -- | ------ | -------- | ----- | ------ |
| 1 | `voice-design-pr1-landing` | `~/coding/port-daddy/.claude/worktrees/voice-design-pr1-landing` | landing components | spawned |
| 2 | `voice-design-pr2-agents-integrations` | `…pr2-agents-integrations` | AgentsPage, MCPPage, integrations, chart palette | spawned |
| 3 | `voice-design-pr3-docs` | `…pr3-docs` | DocsPage, docs sections, tutorials | spawned |
| 4 | `voice-design-pr4-blog-examples` | `…pr4-blog-examples` | blog, examples | spawned |
| 5 | `voice-design-pr5-storybook-airisk` | `…pr5-storybook-airisk` | Storybook stories, AI risk register | spawned |
| 6 | `voice-design-pr6-sweep` | `…pr6-sweep` | sweep after 1–5 land | sequential |

## Monitoring loop (run every 20–30 min)

```bash
# 1. See live sessions across all worktrees
pd sessions --all-worktrees

# 2. See recent notes, scan for PR-AGENT-DONE / PR-AGENT-BLOCKED
pd notes --limit 30 | grep -E "PR-AGENT-(DONE|BLOCKED)"

# 3. See open PRs
gh pr list --state open --limit 20

# 4. For each PR-AGENT-DONE, verify CI + merge:
gh pr checks <#>
gh pr merge <#> --merge --admin   # iff ci green
```

## When an agent reports DONE

1. `gh pr checks <pr#>` — verify Cloudflare Pages + lint green
2. Visually eyeball the branch preview URL (Cloudflare comments it on
   the PR within ~1 minute of push)
3. If green: `gh pr merge <pr#> --merge --admin`
4. After merge, prune the worktree:
   ```bash
   git worktree remove <path> --force
   git branch -d <branch>
   git push origin --delete <branch>   # only if PR was merged
   ```
5. `pd done` the corresponding session if still alive.

## When an agent reports BLOCKED

1. Read the note carefully.
2. If it's a scope question (file conflict, ambiguity), inbox the
   agent with clarification: `pd actor inbox <agent-id> "<msg>"`.
3. If it's a real block (build broken, dependency missing, etc.),
   take it over yourself: switch to the agent's worktree and fix.
4. If multiple agents report blocked on the same root cause, pause
   the rest and fix the root cause first.

## After 1–5 land

Spawn PR-6 (sweep) with a prompt that says: re-run the audit, diff
against `docs/audits/website-v2-2026-05-06.json`, and fix whatever
findings remain that the previous five PRs did not catch. Make the
audit re-run a CI step in this PR.

## Closure criteria — the orchestrator is done when

- All six PRs merged to `main`
- `git worktree list` shows no `voice-design-pr*` worktrees
- `git branch -a` shows no orphaned local `voice-design-pr*` branches
- Production at `https://portdaddy.dev` reflects all six merges
  (a curl of the home page confirms the new content)
- A final audit run is saved at
  `docs/audits/website-v2-2026-05-XX-final.{md,json}` showing the
  delta against the 2026-05-06 baseline
