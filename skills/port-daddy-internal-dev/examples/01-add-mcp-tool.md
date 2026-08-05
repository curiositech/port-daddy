# Example 1 — Add a new MCP tool, end to end

**Slice:** Add `pd_swarm_health` MCP tool. Returns aggregate fleet health
in one call.

This is a small example that exercises every release-surface tier. Follow
the steps; do not reorder. Each step is a real point where contributors
have historically forgotten one of the surfaces.

## 0. Reconnaissance

```bash
pd status
pd briefing
pd salvage --project port-daddy --limit 20
pd sessions --all-worktrees
```

If anyone is mid-flight on `mcp/server.ts` or `lib/swarm/`, route around or
serialize behind their lock first.

## 1. Worktree

```bash
wt="../port-daddy-$(date +%s)-mcp-swarm-health"
git worktree add "$wt" origin/main
cd "$wt"

pd begin "Add pd_swarm_health MCP tool" --identity port-daddy:contrib:mcp-swarm-health \
  --lifecycle durable --roadmap <roadmap-item-slug>
pd note "Scope: mcp/server.ts, lib/swarm-health.ts (new), tests, skill catalog, website /docs/mcp/swarm-health. Validation: mcp-handshake-test.mjs + a real call from Claude Code."
pd session files add mcp/server.ts
pd session files add scripts/mcp-handshake-test.mjs
```

## 2. Implement core

```bash
$EDITOR lib/swarm-health.ts                # new file: aggregateSwarmHealth()
$EDITOR tests/unit/swarm-health.test.ts    # repo convention: tests live under tests/unit/
```

This repo's tests live under `tests/unit/*.test.{js,ts}`, NOT co-located in
`lib/`. Tests outside `tests/unit/` are not picked up by Jest's
`--selectProjects unit` configuration and will silently fail to run in CI.

Follow the existing pattern in `lib/sessions.ts` — pure function over
daemon state, returns a typed object, no side effects.

## 3. Wire into MCP server

```bash
$EDITOR mcp/server.ts
# server.tool("pd_swarm_health", ...)
```

The tool description should include: when to use, when NOT to use,
required vs optional inputs, return shape one-liner. Don't write a
short description; LLMs route on description quality.

## 4. Update the handshake test

```bash
$EDITOR scripts/mcp-handshake-test.mjs
# REQUIRED_TOOLS: bump count + add 'pd_swarm_health'
# Add per-tool input/output schema assertion if missing
```

Run it: `node scripts/mcp-handshake-test.mjs`. Must pass before you move on.

## 5. Update the public skill

```bash
$EDITOR skills/port-daddy-agent-skill/SKILL.md
# MCP Equivalents section — add pd_swarm_health to the comma-list
```

If this tool deserves more than a one-word entry, add a row to
`skills/port-daddy-agent-skill/references/cli-reference.md` (which
doubles as the MCP catalog summary).

## 6. Update the website

```bash
$EDITOR apps/website-v2/.../docs/mcp/index.tsx     # add the new tool to the listing
$EDITOR apps/website-v2/.../docs/mcp/swarm-health.tsx  # new detail route
```

Every MCP tool gets a detail route. The website is the source-of-truth
for human-readable contracts.

## 7. Run the audit

```bash
node scripts/release-surface-audit.mjs   # if it exists; if not, walk the protocol manually
```

Audit must pass with zero drift items.

## 8. Reconcile + guard

```bash
git fetch origin
git rebase origin/main
pd notes --limit 20
pd guard check --staged
```

## 9. Commit (explicit paths only)

```bash
git add lib/swarm-health.ts lib/swarm-health.test.ts \
        mcp/server.ts \
        scripts/mcp-handshake-test.mjs \
        skills/port-daddy-agent-skill/SKILL.md \
        apps/website-v2/src/.../docs/mcp/index.tsx \
        apps/website-v2/src/.../docs/mcp/swarm-health.tsx

git status --porcelain
# Must show ONLY the files above as staged. If anything foreign is dirty, abort.

git commit -m "feat(mcp): pd_swarm_health — aggregate fleet health in one call"
```

## 10. Lookout + close

```bash
pd actor lookout --message "NEW MCP TOOL pd_swarm_health: shipped. Surfaces audited: mcp/server.ts, handshake test, public skill, website /docs/mcp/swarm-health. No drift."

pd note "Result: pd_swarm_health MCP tool. Validation: handshake-test.mjs green; called from Claude Code with success. Remaining: none."
pd done "pd_swarm_health MCP tool shipped"
pd feedback "Adding an MCP tool touches 6 surfaces. release-surface-audit.mjs caught two I forgot. Worth the 30s it added." --hook "mcp-tool-add-flow"
```

## 11. Push (after explicit user confirmation if part of a release)

```bash
git push origin <feature-branch>      # or to main if your slice is the merge target
```

Do not push tags from this slice unless this is a release commit. If it
*is* a release, follow `references/git-discipline-internal.md` brew
formula update protocol — sequence matters.

## What can go wrong (and what catches it)

| Mistake | What catches it |
|---|---|
| Forgot to update handshake test | Step 4 (test fails) |
| Forgot to update website | Step 7 (audit fails) |
| Swept a foreign file | Step 9 (`git status --porcelain` line for it) |
| Pushed before tag tarball was up | Brew users hit 404 — see brew protocol |
| Forgot to drop feedback | Self-discipline. The user notices empty feedback streams. (`pd feedback "..."` CLI bare form, or MCP `drop_feedback`.) |
