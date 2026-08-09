# Multi-Tenant Isolation Review — ADR-0101 Relay

Reviewed 2026-07-14 with the `multi-tenant-architecture-expert` skill against
the relay's newly cross-user D1 (Phase 1: `users`, `web_sessions`, plus the
existing `fleet_runs`). Companion to the tenancy-boundary audit (*where data may
go*) and the zero-trust review (*who can be impersonated*); this one asks: **can
one tenant reach another tenant's data?**

## The tenant model (state it before judging it)

Port Daddy Fleet has **no `tenant_id` column and no org table**. The "tenant" is
a **GitHub identity/repo**, and **GitHub's ACL is the authorization oracle**:

- **repo tier** — a run page is visible to whoever GitHub says can read the
  run's `repo_full_name` (`userCanReadRepo` → `GET /repos/{owner}/{repo}`), or to
  a capability-token holder, or to the operator. Isolation key = the repo, not a
  row-keyed tenant id.
- **team tier** — account rows are scoped to the caller's own session
  (`resolveSession().user.id`); `/account/export` and `/account/delete` take **no
  id argument**, so there is no cross-tenant id to guess.

This is a legitimate model — delegating isolation to a strong external ACL beats
a hand-rolled tenant table — but it means the skill's RLS-centric playbook does
**not** apply as written. The findings below are framed for *this* model.

## The structural constraint (the load-bearing finding)

**MT1 — D1 has no row-level security, so there is no database-level isolation
backstop.** The skill's first rule ("enforce at the database level, not just
application-level WHERE clauses") is *unmeetable* on Cloudflare D1. Isolation
therefore lives entirely in a handful of application-layer choke points:
`resolveSession`, `userCanReadRepo`, `hasTokenAuth`, `operatorOnly`. A single
data-returning endpoint added without passing through one of these leaks
cross-tenant, with nothing underneath to catch it.

**Disposition — shipped in this PR:** `apps/relay/tests/tenant-isolation.test.ts`
pins the invariant — every user/account/run data route rejects an
unauthenticated caller against a *permissive* D1 (one that would return a run if
asked), so the test proves the gate, not an empty table. The file documents the
rule: any new data endpoint must be added to its enumeration. This is the
regression guard that substitutes for the RLS the engine can't provide.

## Findings for the Phase 2/3 tenant model

**MT2 — the tenant concept is underspecified for funding (Phase 2/3).** BYOK and
credits introduce "who owns the money," which the current user-only model can't
express: a GitHub **org/installation** is the natural funding tenant (one team,
one BYOK key, one credit balance across many repos and members). `fleet_run_spend`
must be scoped to that tenant, and the run→funder binding must resolve an
installation, not a user. **This is a Phase 2 design gate:** define the tenant as
the GitHub installation (the App already thinks in installations), add an
`installations`/`tenants` table, and scope BYOK keys + spend to it before any
money moves.

**MT3 — no per-tenant rate limit on the fleet/account/run-page endpoints.** The
harbor pub/sub Durable Object rate-limits per `sender` (`harbor-channel.ts`), but
the HTTP data endpoints have only the global window. Harmless while the operator
funds everything; the moment BYOK spend is per-tenant, a noisy tenant can burn
another's quota or the shared Workers-AI budget. **Phase 2:** per-installation
request + spend limits at the funding boundary.

**MT4 — logs are not tenant-scoped.** Structured log lines don't carry the user/
installation id, so cross-tenant debugging and audit are harder. Low stakes at
current scale; worth adding when the tenant table lands (MT2).

## What already meets the bar (keep)

- **Session-scoped, not URL-scoped, account operations** — `/account/*` resolve
  the caller's own session and take no id, so the "tenant id in the URL / guess
  another tenant's id" anti-pattern is structurally absent.
- **Tenant-scoped cache keys** — the repo-access cache is
  `repo_access:<user_id>:<owner>/<repo>` (per user), not a global
  `repo_access:<repo>`; the OAuth `state` key is random. No cross-tenant cache
  bleed.
- **GDPR export/delete per tenant** — `/account/export` + `/account/delete`
  (shipped in this PR) give the team tier its per-tenant data-portability and
  erasure controls; the repo tier has `DELETE /v1/fleet/runs/:id` + the JSON
  export.
- **Isolation delegated to a strong oracle** — GitHub's repo ACL is a better
  authority than a hand-maintained tenant table, and the checks are centralized
  rather than scattered as ad-hoc WHERE clauses.

## Quality-checklist scorecard (skill checklist, applied)

| Item | Status |
|------|--------|
| Isolation enforced below the app layer (RLS) | ✗ **impossible on D1** — mitigated by centralized choke points + MT1 regression test |
| Tenant context propagated (not global state) | ✓ per-request via session resolution + request-scoped `Env` (Workers isolate per request) |
| Cache keys prefixed with tenant id | ✓ `repo_access:<user_id>:…` |
| No tenant id in URLs (JWT/session claims instead) | ✓ account ops are session-derived, id-less |
| Per-tenant rate limits | ✗ pub/sub only; HTTP endpoints global (MT3, Phase 2) |
| Tenant id in structured logs | ✗ (MT4) |
| Cross-tenant access impossible even with direct calls | ✓ at the app layer (no data route without a gate); ✗ no DB backstop (MT1) |
| Per-tenant data export/deletion (GDPR) | ✓ `/account/export`, `/account/delete`, `DELETE /v1/fleet/runs/:id` |
| Integration tests verify cross-tenant access impossible | ✓ `tenant-isolation.test.ts` + session run-page 404 + `userCanReadRepo` false |
| Noisy-neighbor monitoring | ✗ (Phase 2, with MT3) |

## Disposition

MT1 is closed by this PR's regression test (the D1 no-RLS reality is documented,
not wished away). MT2 becomes a **Phase 2 design gate**: the funding tenant is
the GitHub installation, and BYOK keys + `fleet_run_spend` must be scoped to it
before money moves. MT3/MT4 attach to that same Phase 2 tenant table. Nothing
here is an active cross-tenant leak — the model is sound; the gaps are all in the
*absence of a backstop* and the *not-yet-built* funding tenant.
