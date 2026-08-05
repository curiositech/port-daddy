# Continuous Documentarian — Push-Reviewed Pass

This directory implements one atomic slice: **documentarian:push-reviewed**, a lightweight continuous documentation-maintenance agent that runs on every GitHub push.

## What It Does

Every pushed commit receives a bounded, low-cost surface audit:

1. **Exact SHA capture** — The agent inspects the exact commit hash that was pushed
2. **Surface check** — Audits five canonical instruction surfaces:
   - `AGENTS.md`, `CLAUDE.md`, `README.md`
   - Both Port Daddy skills (`port-daddy-agent-skill/SKILL.md`, `port-daddy/SKILL.md`)
3. **Drift detection** — Identifies code-doc mismatches (stale filenames, broken links, syntax errors)
4. **Remediation** — On fixable drift, opens a DRAFT PR; on decision-required drift, opens an issue
5. **Durable result** — Publishes a `documentarian:push-reviewed` tuple for release review citation

## Key Design

- **Trigger**: `github:push` (every exact SHA) + `promotion:release-surfaces` (pre-release validation)
- **Model tier**: `low` (Haiku, ~$0.001 per run)
- **Singleton**: One agent reviews all pushes across the repo
- **Worktree isolation**: Each run gets its own Git checkout; no cross-agent conflicts
- **Zero cooldown/dedupe**: Every push is reviewed independent of prior state
- **Result durability**: Tuple published to Port Daddy, read back to verify persistence

## Files

### `pd-fleet.yml`
Fleet configuration for the documentarian agent. Contains:
- Trigger definitions (push + promotion)
- Model selection and fallbacks
- Tool allowlist (Read, Write, Bash git/gh only)
- Full agent prompt (four phases: capture, audit, remediate, publish)

### `tests/config.test.ts`
Focused regression coverage:
- YAML syntax validation
- Trigger parsing (exact-SHA tuple structure)
- Target-branch behavior (feature vs. main)
- Singleton + worktree constraints

## Behavior

### On Clean Push
```
documentarian:push-reviewed = {
  "sha": "abc1234def5678...",
  "agent_id": "doc-agent-xyz",
  "transcript_id": "tsc-abc123",
  "verdict": "CLEAN",
  "surfaces_checked": ["AGENTS.md", "CLAUDE.md", "README.md", ...],
  "changes": ""
}
```

### On Fixable Drift
- Opens draft PR: `documentarian/<SHA-short>-sync`
- Targets feature branch if it exists; otherwise main
- Verdict: `DRIFT_FIXED`

### On Decision-Required Drift
- Opens GitHub issue (label: `docs-drift`)
- Provides surface context for manual fix
- Verdict: `DRIFT_MANUAL_REQUIRED`

## Integration Points

1. **Trigger payload** — `github:push` event contains exact SHA, branch, changed files
2. **Port Daddy tuple API** — Publishing and reading back `documentarian:push-reviewed`
3. **Release review** — Major multi-agent review cites the push-reviewed tuple
4. **GitHub Actions** — No hard requirement; runs via Port Daddy's event streaming

## Constraints

- **Never pushes to main** — Fixes travel with feature branches
- **Never rewrites unbounded** — Only fixes syntax, links, stale filenames
- **Never edits CHANGELOG.md or versions** — Release job owns those
- **Never auto-runs** — Triggered by push events, not scheduled

## Testing

Run focused regression tests:

```bash
npm test -- tests/config.test.ts
```

Coverage:
- YAML parse correctness
- Exact SHA + branch tuple extraction
- Target branch logic (feature exists? use it; else main)
- Singleton + worktree enforcement

## Roadmap

Currently **shipped** as an atomic slice on the `codex/3-28-continuous-documentarian` branch. Next phases:
1. Merge to main
2. Wire trigger payload to Fleet scheduler
3. Add Port Daddy tuple API integration
4. Run against a test push; verify tuple publication + read-back
5. Integrate with release review receipt chain

## See Also

- `docs/fleet/2026-05-20-retool.md` — Fleet output migration to GitHub
- `pd-fleet.yml` in the main port-daddy repo — Original full fleet config
- `lib/fleet/github-output.ts` — GitHub integration primitives (postPRComment, openDraftPR, openIssue)
