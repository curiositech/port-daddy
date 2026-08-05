# Port Daddy versioning

The version is an operator-trust signal: the value printed by the installed
binary must identify the behavior Homebrew actually installed.

## Semver policy

- **Patch**: compatible runtime fixes, instrumentation, small safe additions,
  and UI corrections.
- **Minor**: visible capabilities, durable API/session changes, new operator
  workflows, or behavior worth calling out in release notes.
- **Major**: intentional compatibility breaks or required migrations.

Choose an exact version. Do not ask a package tool to infer “minor” or “patch”:

```bash
node scripts/set-version.mjs 3.28.0
bun scripts/sync-version.ts
```

`set-version.mjs` updates the two version authorities: `package.json` and the
root entries in `package-lock.json`. `sync-version.ts` stamps product mirrors.

## Product version surfaces

| Surface | Authority |
|---|---|
| `package.json` | sole source version |
| `package-lock.json` root and `packages[""]` | lockfile authority |
| `README.md` title | product front door |
| `VERSION` | plain-text product stamp |
| `mcp-server.json`, `mcp/server.ts` | MCP distribution/runtime |
| `.claude-plugin/plugin.json` | Claude plugin |
| `.gemini/extensions/port-daddy/gemini-extension.json` | Gemini extension |
| `server.ts` embedded version | compiled daemon fallback |
| `website-v2/src/data/referenceCatalog.ts` | public reference site |
| `public/samples/manifest.json` | bundled sample metadata |
| `core/pd-console/Cargo.toml` | native console/app stamp |
| `docs/openapi.yaml` | published API metadata |
| `CHANGELOG.md` | manual release narrative/date |

Library crates under `core/kernel/` keep independent library semver. They are
not the installed Port Daddy product version.

## Drift gates

```bash
bun run check:version-drift
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand \
  tests/unit/distribution-freshness.test.js \
  tests/unit/version-drift-gate.test.js
```

Source CI checks every mirror against `package.json`. Release CI also performs a
deep check against built app/binary metadata. `CHANGELOG.md` remains deliberate
human work.

## Release identity

For a stable release, all of these must agree:

- merged candidate commit;
- exact-SHA source-review evidence;
- immutable `vX.Y.Z` tag;
- binary `--version` output;
- batten imprint `sourceCommit` and `releaseVersion`;
- `latest.json`;
- Homebrew formula and installed keg;
- live supervised daemon response.

Follow [RELEASING.md](RELEASING.md) for the complete proof sequence.
