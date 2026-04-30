# Port Daddy Versioning

Port Daddy versions are operator-trust signals. If a promoted daemon is newer than the stable daemon it replaces, `package.json` must be newer too.

## Policy

- **Patch** (`3.11.0` -> `3.11.1`): daemon/runtime fixes, instrumentation, small CLI/SDK/MCP additions, docs that ship with runtime behavior, and safe UI improvements.
- **Minor** (`3.11.x` -> `3.12.0`): user-visible capabilities, new workflow surfaces, new durable APIs, or changes that operators should notice in release notes.
- **Major** (`3.x` -> `4.0.0`): breaking behavior, migration requirements, or a new compatibility line. Do not jump to v4 for ordinary daemon work.

## Promotion Rule

`scripts/promote-stable.sh` refuses to promote when `package.json` on `main` is less than or equal to the stable checkout version. Bump before promotion, then run `scripts/sync-version.ts` so the MCP server, plugin metadata, and distributed surfaces agree.

For normal daemon work:

```bash
npm version patch --no-git-tag-version
npx tsx scripts/sync-version.ts
```

For a new user-facing capability:

```bash
npm version minor --no-git-tag-version
npx tsx scripts/sync-version.ts
```

The version bump is part of the same change as the daemon behavior. A promoted daemon with unchanged version metadata is a release bug.
