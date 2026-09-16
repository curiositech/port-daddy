# ADR-0119: Relay Release Channels + Staging D1

- **Status:** Accepted
- **Date:** 2026-08-04

## Context

`apps/relay` is the live control plane for the cloud fleet: GitHub webhook
ingress (producer for the `fleet-runs` queue), the operator fleet API, the
OIDC→card exchange, GitHub login (ADR-0101), and the human-facing run pages.
Until now it had exactly one channel: every merge to `main` that touched
`apps/relay/**` deployed straight to the production Worker at
`relay.portdaddy.dev` (`.github/workflows/deploy-relay.yml`), and D1 schema
changes were hand-applied against the production database with no rehearsal
environment and no record of what had been applied where.

That is a weaker release chain than the rest of the toolchain we depend on.
Rust ships nightly → beta → stable; the TypeScript ecosystem ships `next` /
`latest` dist-tags with explicit promotion. The relay — the single most
stateful, most user-visible Worker we run — shipped every merge directly to
prod, and a bad D1 migration had no staging dress rehearsal before it touched
the only copy of production data.

Cloudflare gives us the primitives for a real chain:

- **Wrangler environments** (`[env.<name>]` in the config) — separate Workers
  with separate bindings from one committed config file.
- **`wrangler versions upload`** — build + upload a *non-deployed* version of a
  Worker, addressable by version id and preview URL.
- **`wrangler versions deploy`** — point traffic at an uploaded version, with
  gradual rollout percentages and instant rollback to any prior version.

Cloudflare also imposes one important boundary on that chain: a Worker version
that contains a pending Durable Object class lifecycle change cannot be
uploaded through `wrangler versions upload`. The lifecycle change is atomic and
must first be applied with `wrangler deploy`; Cloudflare recommends isolating it
from unrelated Worker changes. See [Gradual deployments with Durable
Objects](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/with-durable-objects/).

## Decision

The relay adopts three release channels, in ascending stability, driven by two
GitHub Actions workflows plus a migration gate script:

### 1. `latest` — merge channel (auto, per-merge)

Every push to `main` touching `apps/relay/**` deploys the `latest` environment:

- Worker name **`relay-latest`** (`[env.latest]` in
  `apps/relay/wrangler.deploy.toml`), reachable on its `*.workers.dev` URL —
  no custom domain, no production route.
- Its **own staging D1 database** (`port-daddy-relay-staging`) and its own DO
  namespace (per-environment by construction) — `latest` can never write
  production data.
- The workflow (`deploy-relay.yml`) applies **all pending D1 migrations to the
  staging database first**, records them in the staging ledger
  (`apps/relay/migrations/applied-staging.json`), and then deploys the Worker.
  If the ledger changed, CI publishes it on the deterministic
  `automation/relay-staging-ledger` branch, opens or updates one generated PR,
  and arms auto-merge. Protected `main` is never mutated directly. `latest` is
  the dress rehearsal: code and schema changes soak here between merge and
  release while the ledger PR traverses the same review gates as other state.

### 2. `prod` — release channel (release tag, gated, gradual)

Production (`port-daddy-relay` at `relay.portdaddy.dev`, the top-level config)
deploys **only from a relay release tag** (`relay-v*`) via
`deploy-relay-prod.yml`:

1. **Migration gate** — `node scripts/check-migrations-gate.mjs` fails the
   release unless every file in `apps/relay/migrations/` appears in the
   staging ledger. A migration that has not been applied to staging cannot
   reach prod. (Staging-first is enforced by CI, not by convention.)
2. Pending migrations are applied to the **production** D1 database.
3. The Worker is deployed via the versions flow:
   `wrangler versions upload` (build + upload, no traffic shift), then
   `wrangler versions deploy <id>@100% -y` (or a gradual percentage — see
   below).

**Gradual rollout** — for a risky release, deploy at a percentage first, then
promote:

```sh
npx wrangler versions deploy <new-id>@10% <old-id>@90% -y --config wrangler.deploy.toml
# observe, then:
npx wrangler versions deploy <new-id>@100% -y --config wrangler.deploy.toml
```

**One-command rollback** — every prior version stays addressable; shifting
traffic back is one command and takes seconds (no rebuild, no migration):

```sh
# find the previous version id:
npx wrangler versions list --config wrangler.deploy.toml
# roll all traffic back to it:
npx wrangler versions deploy <previous-version-id>@100% -y --config wrangler.deploy.toml
```

D1 migrations are **forward-only** and must be additive/backward-compatible
for at least one release, so that a rolled-back Worker version still runs
against the migrated schema (see `apps/relay/migrations/README.md`).

### Durable Object lifecycle changes — atomic exception lane

Durable Object class creation, rename, transfer, or deletion is not an ordinary
versioned release. Before the normal production workflow can upload a version
that depends on a new lifecycle tag, run
`.github/workflows/deploy-relay-do-migration.yml` with:

- the full 40-character SHA represented by production's current migration
  prefix;
- the full 40-character SHA of the isolated lifecycle commit on `main`;
- the exact new Wrangler migration tag; and
- explicit confirmation that this is an atomic 100% cutover.

The workflow fails closed unless both SHAs are ancestors of `origin/main`, the
baseline is an ancestor of the migration SHA, the candidate preserves the
baseline migration prefix and adds exactly one lifecycle tag, and the interval
contains no D1 migration files. It checks out that exact commit, runs the Relay
typecheck and complete unit suite, then uses `wrangler deploy` and reads back
production health plus Cloudflare's serving deployment. It shares the
`deploy-relay-prod` concurrency group, so it cannot race an ordinary release.

After the atomic lifecycle deployment succeeds, resume
`deploy-relay-prod.yml` from the intended release tag. The ordinary code release
still uses `versions upload` followed by `versions deploy`; the exception lane
does not become a general-purpose historical deployment mechanism. A lifecycle
change also moves the rollback floor: do not route traffic to a Worker version
from before that lifecycle tag.

### 3. Named feature builds — preview channel (manual, per-branch)

A feature branch that needs a live URL uploads a **non-deployed version**:

```sh
npx wrangler versions upload --config wrangler.deploy.toml --env latest \
  --tag feat-my-thing --message "preview: my thing"
```

The upload returns a version id and a preview URL serving that version only —
shareable, isolated, zero production (and zero `latest`) traffic shift.
Feature previews target the `latest` environment so they read/write the
staging D1, never prod.

### The migration gate, concretely

- `apps/relay/migrations/` holds forward-only `.sql` files (lexicographic
  order) applied via `wrangler d1 migrations apply` (Wrangler tracks applied
  files per-database in its `d1_migrations` table).
- `apps/relay/migrations/applied-staging.json` is the **staging ledger**: the
  committed record of which migration files have been applied to the staging
  database. `deploy-relay.yml` updates it (via
  `check-migrations-gate.mjs --record`) after a successful staging apply,
  deploys `relay-latest`, then publishes a generated PR with auto-merge armed.
  The workflow live-probes the same dedicated mutation-token fallbacks used by
  the release train; it never uses `GITHUB_TOKEN` for the PR because GitHub
  leaves the resulting PR workflow runs approval-gated rather than executing
  them automatically. See [GitHub's `GITHUB_TOKEN` workflow-run
  rules](https://docs.github.com/en/actions/concepts/security/github_token).
- `scripts/check-migrations-gate.mjs` (default/`--check` mode) exits non-zero
  when any migration file is missing from the ledger. `deploy-relay-prod.yml`
  runs it before anything touches prod.

## Consequences

- A merge to `main` no longer touches production. The cost is a second,
  deliberate step (push a `relay-v*` tag) to ship the relay — which is the point.
- Two D1 databases exist; the staging one holds throwaway data and can be
  reset at will. Binding ids for staging live in `[env.latest]` in
  `wrangler.deploy.toml` (placeholder until provisioned — see the comments
  there for the one-time `wrangler d1 create port-daddy-relay-staging` step).
- Wrangler environments do **not** inherit `vars`/bindings from the top level,
  so `[env.latest]` repeats them; drift between the two blocks is a review
  concern (kept adjacent in one file on purpose).
- The staging ledger is CI-written state in git and lands through a generated
  PR. A hand-edit can lie the gate green; the ledger is therefore documented as CI-owned
  (`migrations/README.md`) and any hand edit must be treated as an incident.
- Rollback of the Worker is one command; rollback of a migration is not —
  hence the forward-only, one-release-compatibility rule for schema changes.
- Durable Object lifecycle commits are the deliberate exception to gradual
  rollout. They use the exact-SHA atomic workflow, establish a new rollback
  floor, and then hand control back to the ordinary versioned release lane.
- Secrets are unchanged: `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`
  repository secrets drive both workflows; runtime secrets stay out-of-band
  via `wrangler secret put` (per-environment: `--env latest` for staging).

## Alternatives considered

- **Branch-based prod deploys (a `release` branch)** — rejected: tags are
  immutable, auditable points; a branch invites drift and force-pushes.
- **A single D1 with a staging table prefix** — rejected: shared blast radius
  defeats the purpose; D1 databases are free enough to have two.
- **`wrangler deploy` for prod (as before)** — rejected: it cuts traffic over
  atomically with no percentage rollout and makes rollback a re-deploy of old
  code rather than a traffic shift to a still-uploaded version.
