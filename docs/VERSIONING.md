# Port Daddy Versioning

Port Daddy versions are operator-trust signals. If users will get a behavior change after `brew upgrade port-daddy`, the binary they download must report a newer version than the one they had.

## Policy

- **Patch** (`3.14.0` → `3.14.1`): daemon/runtime fixes, instrumentation, small CLI/SDK/MCP additions, docs that ship with runtime behavior, and safe UI improvements.
- **Minor** (`3.14.x` → `3.15.0`): user-visible capabilities, new workflow surfaces, new durable APIs, or changes that operators should notice in release notes.
- **Major** (`3.x` → `4.0.0`): breaking behavior, migration requirements, or a new compatibility line. Do not jump to v4 for ordinary daemon work.

## Version surfaces

A bump must update every file the build, MCP, and plugin metadata read from. The canonical set:

- `package.json` (root)
- `package-lock.json` (root `version` plus `packages.""` entry)
- `mcp-server.json`
- `.claude-plugin/plugin.json`
- `.gemini/extensions/port-daddy/gemini-extension.json`
- `CHANGELOG.md` (convert `[Unreleased]` into `[<version>] - YYYY-MM-DD`, add a fresh `[Unreleased]` heading)

`scripts/sync-version.ts` keeps these in lockstep — run it after `npm version`.

## Cutting a release (binary daemon, per ADR-0028)

The daemon, CLI, and MCP server ship as signed binaries through Homebrew. The release flow is tag-driven:

```bash
# 1. Bump every version surface (or use sync-version.ts after npm version)
npm version minor --no-git-tag-version
npx tsx scripts/sync-version.ts

# 2. Update CHANGELOG.md, commit, open PR, merge as usual

# 3. Tag the merged commit
git tag v<version>
git push --tags

# 4. Publish a GitHub Release from the tag — triggers .github/workflows/release.yml,
#    which builds and notarizes the per-platform binaries via Bun's compile target.
gh release create v<version> --generate-notes

# 5. Roll the brew tap (curiositech/homebrew-tap) — manual dispatch:
gh workflow run publish.yml
```

The version bump must land on `main` before the tag. A tag that points at a commit whose `package.json` still reads the previous version is a release bug.

## What you do NOT do anymore

- There is no `~/port-daddy-stable` worktree.
- There is no `scripts/promote-stable.sh`.
- Do not `npm link` from `~/coding/port-daddy` — the `port-daddy` and `pd` CLIs are the Homebrew-installed binaries. Local source work is for development only; users get the signed bottle.
- Do not hand-roll daemon promotion with `launchctl` commands. The brew formula installs the launchd service definition; `brew services restart port-daddy` is the supported operator action.
