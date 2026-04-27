# CLAUDE.md — Claude Code Workflow

Project-specific guidance for Claude Code sessions. Pairs with `AGENTS.md`,
which holds the Port Daddy operating shibboleths every agent should follow.

## Read first

- `AGENTS.md` — Port Daddy primitives (sessions, claims, locks, daemon
  promotion, symbol claims). Read these before editing.
- `docs/plans/port-daddy-website-ideal-web-app-rehab.md` — the authoritative
  approved web-app rehab plan. Do not redo this work.
- `docs/plans/PHONE-INTEGRATION-MASTER-PLAN.md` — the phone-integration
  synthesis layer (relay, `pd tube`, Merkle lib, ProVerif, V4 redefinition).
- `skills/pd-relay-zero-trust/SKILL.md` — deliberation-aware authority for
  relay decisions. Pairs with `skill-architect`.

## Branch and Push Preference

**Preferred default**: develop on `main` and push directly. No PR step unless
explicitly requested.

**Caveats** (the harness may override this):

1. The Claude Code Web integration sometimes injects a *"designated branch"*
   directive into the system prompt of new sessions. When present, that
   directive **wins** over this file. To stop the directive, edit the per-repo
   agent configuration in the Claude Code Web UI (claude.ai/code) — that
   change has to happen there, not from inside a session.
2. GitHub branch protection on `main` may reject direct pushes. If the push
   fails with "protected branch hook declined":
   - Bypass: add the bot account to "Allow specified actors to bypass" in
     repo settings (Settings → Branches → main).
   - Or use auto-merge: open a PR, let CI run, configure auto-merge so it
     merges itself when green.

## Commit Style

- Small, single-purpose commits. Prefer multiple commits over one giant one.
- Imperative subject ("Add X", "Fix Y", "Remove Z"). Body explains the why
  when the diff doesn't.
- Stage files explicitly. Avoid `git add -A` / `git add .` (might capture
  secrets or build residue).
- Do not amend pushed commits.
- Do not skip hooks (`--no-verify`, `--no-gpg-sign`) without an explicit user
  request.

## Push Behavior

- After committing, push to whatever branch you're on.
- Use `--force-with-lease`, never plain `--force`.
- Retry up to 4 times with exponential backoff (2s, 4s, 8s, 16s) on network
  errors. Do not retry on auth/permission errors — surface those to the user.

## Pull Requests

- Do **not** create PRs unless the user explicitly asks ("open a PR", "make
  a pull request", "let's get this reviewed").
- If main is protected and direct push fails, ask the user before creating
  a PR — they may want to flip protection instead.

## Stop Hook

This repo runs `~/.claude/stop-hook-git-check.sh` on Stop events. It blocks
session end while there are uncommitted changes, untracked files, or unpushed
commits. The fix is always: commit + push (to whatever branch you're on),
not bypass.

## When in Doubt

- Ask the user before destructive operations (`git reset --hard`, `--force`
  to a non-personal branch, `branch -D`, `clean -f`).
- Do not edit configuration that affects others (`.gitignore`, CI workflows,
  branch protection) without explicit go-ahead.
- Read `AGENTS.md` if you're starting on this repo for the first time. The
  Port Daddy primitives there are non-negotiable.
