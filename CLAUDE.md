# CLAUDE.md

Claude Code entry point for this repo. Read `AGENTS.md` too; it is the
cross-tool source of truth for Port Daddy work.

## Mandatory Coordination

- Use Port Daddy before repo work: `pd status`, `pd briefing`, `pd salvage`,
  `pd begin`, a scope note, and file claims before edits.
- Before every commit, push, or deploy, fetch and pull against the canonical
  remote branch. This repo uses `origin/main`; use `origin/master` only in a
  repository that actually has `origin/master`.
- Re-read live coordination before publishing: `pd sessions --all-worktrees`,
  `pd notes --limit 20`, and relevant activity/claims. If another agent moved
  the branch or owns the surface, rebase/merge and adjust instead of pushing
  stale work.
- Coordination Guard should be enforcing in this repo. Check `pd guard status`
  and run `pd guard check --staged` before commit. If it is not enforcing,
  install it with `pd guard install --mode enforce` or leave a clear blocker
  note explaining why that could not be done.
- Durable handoffs go into Port Daddy notes, actor inboxes, tuples, or scoped
  channels. Chat-only coordination is not enough.
