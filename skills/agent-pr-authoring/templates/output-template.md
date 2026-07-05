# PR Description Template

Fill in every section before opening the PR. Validate the underlying claims with `node scripts/pr_readiness.mjs --input <this-pr-as-json>.json` before marking it ready.

```markdown
## Summary

- <What changed, in plain language.>
- <Why — the problem this solves or the request it fulfills.>
- <What this PR deliberately does NOT do, if that's not obvious from the diff.>

Roadmap-Item: <slug>            <!-- or: Roadmap-Item: none — <one-line reason> -->

## Test Plan

- `<exact command run>`
  ```
  <pasted real output — not a summary of output>
  ```
- `<exact command run>` → exit code `<n>` (paste the relevant output too, not just the code)
- <For a UI diff: screenshot/GIF/recording path, plus the command used to capture it.>
```

## Checklist before marking ready

- [ ] Diff is one reviewable concern (`git diff --stat` fits your own read of "one change").
- [ ] Every required, repo-owned check is green (see `references/gate-taxonomy.md`).
- [ ] Every external check's status is noted, with proof it's pre-existing if it's red — never treated as a blocker.
- [ ] `Roadmap-Item:` trailer present, or an explicit `none — <reason>` opt-out.
- [ ] Test Plan entries are all reproducible from the PR body alone (real commands, real output).
- [ ] No `--admin` bypass of a *failing required* gate (using it only to skip the BEHIND gate or an external non-blocking check like Cloudflare Pages is per repo procedure), no force-push, branch rebased onto the latest base.
