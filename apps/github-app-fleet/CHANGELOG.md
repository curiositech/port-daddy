# Changelog — Port Daddy Fleet (GitHub App)

All notable changes to this App scaffolding. Distinct from the parent
`port-daddy` CHANGELOG — this one tracks the App manifest, auth helpers,
and the ship-identity wrapper only.

## [Unreleased]

### Changed

- **Ship roster is now per-repository.** The App no longer ships a closed
  enum of seven ships. `lib/post-as.ts` accepts a caller-supplied
  `ShipMeta` value (handle, role, optional mark); the App receiver
  resolves it from the installed repository's `pd-fleet.yml` at dispatch
  time. The seven port-daddy ships are retained in
  `DEFAULT_PORT_DADDY_SHIPS` as a convenience for the port-daddy runtime
  only — nothing in the App reads that registry by default.
- **`postAs(ship, op)` signature changed.** The `ship` parameter is now
  `ShipMeta`, not a `ShipIdentity` enum. Callers compute the meta
  themselves (typically from `fleet.agents.<key>` in the installed
  repository's `pd-fleet.yml`). The result type's `ship` field is the
  bare handle string instead of an enum value.
- **README rewritten.** Replaced first-person familiar register with a
  GitHub-App documentation register. Removed the seven-ship gallery in
  favor of a generic comment-shape description; the per-project examples
  live in `docs/per-project-ships.md`.
- **`manifest.json > description` no longer enumerates ships.** The
  description names the App, the rendering contract
  (`**[pd-<ship>]**`), and the per-repo `pd-fleet.yml` source of truth.

### Added

- **`docs/per-project-ships.md`** — schema reference for the per-repo
  ship roster, plus three worked examples: port-daddy's seven code
  reviewers, expungement-guide's UPL/citation/plain-language/
  accessibility checkers, jury_rig' skill-media/mermaid-author/
  skill-grammar ships.
- **`isValidShipHandle(handle)`** — exported helper for caller-side
  validation against the lower-kebab-case grammar.

### Migration

Callers that previously wrote

```ts
await postAs('reviewer', { kind: 'pr-comment', payload: {...} })
```

should now resolve a `ShipMeta` and pass it:

```ts
import { postAs, DEFAULT_PORT_DADDY_SHIPS } from './lib/post-as'

await postAs(DEFAULT_PORT_DADDY_SHIPS.reviewer, {
  kind: 'pr-comment',
  payload: {...},
})
```

A per-repo runtime resolves `ShipMeta` from the installed repo's
`pd-fleet.yml` rather than from `DEFAULT_PORT_DADDY_SHIPS`.

## [0.1.0] — 2026-05-20

Initial scaffolding. Not yet a registered App on github.com; the operator
runs the manifest-create flow when ready.

### Added

- `manifest.json` — App manifest with default events (`pull_request`,
  `pull_request_review`, `push`, `issue_comment`, `issues`, `check_run`,
  `check_suite`) and default permissions (`contents:read`,
  `pull_requests:write`, `issues:write`, `checks:write`, `metadata:read`).
- `lib/auth.ts` — `getAppJwt`, `getInstallationToken` (with per-installation
  TTL cache), `getOctokitForInstallation`, `assertGitHubAppEnv`. Supports
  both raw-PEM and base64-encoded private keys in env.
- `lib/post-as.ts` — `postAs(ship, operation)` single entry point. Seven
  ship identities (`reviewer`, `redteam`, `qa`, `test-author`, `tautology`,
  `unspider`, `documentarian`) each with a handle, role line, and unicode
  mark. Body framing is idempotent.
- `icons/` — three direction concepts (A: lighthouse, B: anchor + orbiting
  fleet, C: harbormaster's lantern), each rendered at 1024×1024, 256×256,
  and 60×60. Flat architectural-blueprint style, cream + cobalt + sage +
  near-black palette per the brand reference.
- `scripts/generate-icons.sh` — nano-banana driver that regenerates the
  full set from prompts kept in `scripts/prompts/`.
- `README.md` — installation guide, what-you'll-see gallery, cost table,
  kill-switch instructions, time budget.

### Architectural decision

- **One App, seven identities.** Considered seven separate Apps; rejected
  because the install-friction-per-App is the dominant cost and we have
  zero per-App differentiation that's worth multiplying that cost by
  seven. Per-ship identity lives in body prefixes and (future) avatars.
  Re-evaluate when/if GitHub ships per-message bot identity for Apps.

### Held back (operator-only)

- Not registering the actual App on github.com. That mints a private key
  and an App ID; both are credentials the operator should own.
- Not committing a webhook URL — the receiver is a deployment-time
  decision and we don't want to ship a placeholder that looks valid.
- Not picking one of the three icon directions; all three ship as options.
