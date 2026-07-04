# Proof Manifest Template

Fill in one block per artifact before opening or marking ready a PR that carries visual evidence. Validate the assembled JSON with `node scripts/proof_manifest_audit.mjs --input <this-as-json>.json` before requesting review.

```markdown
## Proof Artifacts

### <state-name>: <one-line description>

- File: `<path or SHA-pinned raw URL>`
- Daemon port: `<port>`
- Run id: `<run id>`
- Transcript head hash: `<hash>`
- Agent node id: `<node id>`
- Commit: `<branch HEAD sha — must match the PR's current commit>`
- Source: `real` | `fixture` | `mock`   <!-- never leave this blank -->
```

Repeat one block per artifact. For a control-panel PR, one block per required state at minimum: `active`, `historical`, `blocked`, `stale`, `gate`, `interrupt`, `receipt`.

## Checklist before marking ready

- [ ] Every artifact's manifest has all six fields: daemon port, run id, transcript head hash, agent node id, commit, source label.
- [ ] Every artifact's `commit` equals the PR's current branch HEAD — not a stale commit from an earlier push.
- [ ] Every `sourceLabel` is present and honest (`real`/`fixture`/`mock`) — none left undeclared.
- [ ] If this is a control-panel PR: all seven required states are covered by at least one artifact each.
- [ ] Capture technique itself (headless Playwright, `screencapture -x -l`, non-interruptive capture) followed `port-daddy-agent-skill`'s visual-evidence doctrine — this template only records the manifest, not how the capture was taken.
