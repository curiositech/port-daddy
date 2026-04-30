# Dogfood Feedback — Curated Harvest

Last updated: 2026-04-29

This file is the curated harvest of agent dogfooding feedback for Port Daddy.

## Authority and status

- Raw drops live in `.spark/feedback/` (one file per session-level observation).
- This file is the **deduped, curated** index. It is the surface that feeds
  `docs/ROADMAP.md` and `docs/recovery/CURRENT-WORK.md`.
- `IDEAS-TROVE.md` is the parallel surface for Spark/Spider exhaust. The two
  feed the same roadmap; they should not duplicate each other.
- The daemon-mediated `pd feedback list --status open --json` surface was
  unavailable on this pass (`connect EPERM` on `~/.port-daddy/daemon.sock`),
  so the raw `.spark/feedback/` harvest was the source of truth here.
- 2026-04-29 pass: no new dogfood slugs were minted. The raw drops were
  already represented here or in `IDEAS-TROVE.md`, so this was a dedupe pass
  rather than a minting pass.

Status meanings:

- `now` — worth a roadmap slot in the immediate next slices
- `backlog` — valid, preserved, not the next cut
- `parked` — speculative or downstream of other work
- `merge` — duplicate family; do not mint new entries

## Owner

**Cartographer.** Declared in `pd-fleet.yml` (agent `cartographer`),
triggered on `git:committed`. Cartographer's prompt explicitly lists
`.spark/feedback/` as a read source and this file as the curation
surface. Spark/Spider do not touch this lane — they own
`IDEAS-TROVE.md`.

## How Cartographer harvests

1. Read every new file in `.spark/feedback/` since the last pass.
2. For each one, decide:
   - is it already represented here or in `IDEAS-TROVE.md`?
     - if yes: append a one-line provenance pointer to the existing entry
     - if no: mint a new entry using the template below
3. Promote `now` items into `docs/ROADMAP.md` "Next Cuts (From Curated
   Trove)" and add a `roadmap:` backref to the curated entry here.
4. Leave the raw `.spark/feedback/*.md` files in place as provenance.
   Never edit another agent's raw drop.

## Entry template

```markdown
### `<short-slug>`

- status: `now` | `backlog` | `parked` | `merge`
- surface: cli | sdk | mcp | dashboard | daemon | fleet | docs | other
- friction:
  - one-line summary of what hurt or what worked
- next cut:
  - the smallest concrete change that would resolve the friction
- provenance:
  - `.spark/feedback/<file>.md`
  - `.spark/feedback/<other-file>.md`
```

## Curated entries

### `fleet-launchability-and-cadence`

- status: `now`
- surface: daemon | fleet | cli
- friction:
  - Cartographer was wired, but its real launchability state was hidden behind cadence routing, channel-slug drift, and the wallet / telemetry wall.
- next cut:
  - surface `launchable` vs `blocked` state in `pd status`, show the exact blocking gate in spawn/preflight output, and keep cadence/routing honest.
- provenance:
  - `.spark/feedback/2026-04-26-cartographer-cadence-investigation.md`
  - `.spark/feedback/2026-04-26-claude-sdk-wired-final-gate-is-wallet.md`
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove`

### `claim-preserving-git-safety`

- status: `now`
- surface: cli | daemon | other
- friction:
  - advisory claims can still be steamrolled by `git add -A`, `git reset --hard`,
    and `git cherry-pick`
  - if an agent forgets to coordinate, the guardrails need to stop the bulldozer
    instead of letting the edits disappear silently
- next cut:
  - use `pd add --dry-run -A` / `pd add -A` as the safe staging path; it
    expands dirty paths and skips paths claimed by other live sessions unless
    `--force` is explicit
  - wrap destructive git verbs with guardrails that consult claims before they
    bulldoze another session's edits
- provenance:
  - `.spark/feedback/2026-04-28-claims-steamrolled-by-git-reset-hard.md`
  - `.spark/feedback/2026-04-28-coordination-guard-bypassed-by-cherry-pick.md`
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove`

### `session-context-cwd-reset`

- status: `now`
- surface: cli | other
- friction:
  - `pd begin` / `pd note` / `pd whoami` lose the active session when shell cwd resets between Bash calls.
- next cut:
  - recover session context by agent id or a home-scoped current-session file, and make the error point to the actual missing state.
- provenance:
  - `.spark/feedback/2026-04-28-session-drops-on-cwd-reset.md`
- roadmap: `docs/ROADMAP.md#next-cuts-from-curated-trove`

### `feedback-route-stable-gap`

- status: `backlog`
- surface: daemon | cli | other
- friction:
  - `pd feedback drop` 404s on stable until the daemon is promoted, so the new feedback primitive cannot dogfood itself immediately.
- next cut:
  - make the CLI fall back to `.spark/feedback/*.md` or advertise route availability before the operator hits a 404.
- provenance:
  - `.spark/feedback/2026-04-27-stable-blocks-dogfooding-new-routes.md`

### `fleet-status-skipped-duplicates`

- status: `backlog`
- surface: cli | daemon
- friction:
  - `pd status` hides skipped duplicate fleet registrations, so the operator cannot see that one checkout was shadowed by another.
- next cut:
  - include skipped counts and a one-line reason in `pd status`, or warn loudly at registration time.
- provenance:
  - `.spark/feedback/2026-04-26-fleet-status-status-shape.md`

## Cross-refs into the roadmap

When an entry here is promoted into `docs/ROADMAP.md`, add a `roadmap:`
line to the entry pointing at the section it landed in. That is how we
keep the trail honest:

```
- roadmap: `docs/ROADMAP.md#<section-anchor>`
```
