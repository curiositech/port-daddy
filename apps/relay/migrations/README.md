# Relay D1 migrations — staging-first discipline (ADR-0119)

This directory holds the relay's forward-only D1 migrations. They are applied
with `wrangler d1 migrations apply`, which tracks applied files per-database
(in D1's own `d1_migrations` table), in **lexicographic filename order**.

## The rules

1. **One migration = one new `.sql` file.** Never edit or delete a migration
   that has been committed — Wrangler's per-database tracking is by filename,
   and an edited file will NOT be re-applied anywhere it already ran. Fix a
   bad migration with a new migration.
2. **Name for ordering:** `YYYY-MM-DD-short-description.sql` (matching the
   existing files). Lexicographic order is application order.
3. **Forward-only, rollback-compatible.** There are no down-migrations. Every
   migration must leave the schema usable by the *previous* Worker release,
   because a prod rollback (`wrangler versions deploy <old-id>@100%`) shifts
   traffic in seconds and does NOT un-migrate the database. Practically:
   additive changes (new tables, new nullable columns, new indexes) are fine;
   destructive changes (drop/rename) must be split across two releases
   (release N stops reading the old shape, release N+1 drops it).
4. **Staging first — enforced, not honor-system.** On every merge to `main`,
   `.github/workflows/deploy-relay.yml` applies pending migrations to the
   STAGING database (`port-daddy-relay-staging`, bound by `[env.latest]` in
   `../wrangler.deploy.toml`) and records them in the ledger below. The prod
   release workflow (`deploy-relay-prod.yml`) runs
   `node scripts/check-migrations-gate.mjs` and REFUSES to deploy while any
   migration file is absent from the ledger.

## The staging ledger: `applied-staging.json`

`applied-staging.json` is the committed record of which migration files have
been applied to the staging database. **It is CI-owned**: the deploy-relay
workflow updates it (`check-migrations-gate.mjs --record`) after a successful
staging apply, deploys `relay-latest`, and publishes the change on the
deterministic `automation/relay-staging-ledger` PR with auto-merge armed.
Protected `main` is never pushed directly, and production remains gated until
that generated PR clears the ordinary review checks.

Do not hand-edit the ledger. A hand edit is the one way to lie the prod gate
green with a migration that never ran on staging — treat any manual change to
this file in review as an incident, not a convenience.

## Typical flow

```text
1. Add migrations/2026-08-10-add-widgets.sql in your PR (additive SQL only).
2. Merge. deploy-relay.yml:
     - wrangler d1 migrations apply port-daddy-relay-staging --env latest --remote
     - check-migrations-gate.mjs --record   → ledger gains the new file
     - deploys relay-latest
     - opens or updates the generated ledger PR and arms auto-merge
3. Soak on the latest channel (relay-latest + staging D1).
4. Tag a relay release (`relay-v*`). deploy-relay-prod.yml:
     - check-migrations-gate.mjs            → passes (ledger has the file)
     - wrangler d1 migrations apply port-daddy-relay --remote   (PROD)
     - wrangler versions upload + versions deploy               (PROD Worker)
```

## Local dev

`wrangler dev --local` uses a local sqlite D1; apply migrations locally with:

```sh
npx wrangler d1 migrations apply port-daddy-relay --local
```
