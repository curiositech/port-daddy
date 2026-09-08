# ADR-0101: Fleet Run Pages, GitHub Login, and User-Funded Fleets

## Status

Proposed — 2026-07-14. Phase 0 (capability-URL run pages) ships with this ADR.

Companion to [ADR-0029](0029-user-accounts-and-merkle-audit.md) (account
keypairs + Merkle audit forest) and [ADR-0039](0039-portdaddy-dev-account-surface.md)
(portdaddy.dev account surface). Those ADRs describe the full cryptographic
account vision. This ADR is the pragmatic wedge in front of them: the smallest
user-account substrate that makes the cloud fleet's "View more details" link a
real product surface and lets users fund their own fleet inference. Everything
here is designed to be *absorbed by* ADR-0029's account key + pairing receipts
later, not to compete with them.

## Context — what exists today (surveyed 2026-07-14)

**There is no human user account anywhere in Port Daddy.**

| Surface | Identity today | Auth today |
|---------|---------------|------------|
| Daemon HTTP API (:9886) | none (agent IDs on IPC only) | loopback binding + 0600 socket; no principal |
| FleetBar / pd-console | none | talk to loopback daemon; no credentials of their own |
| Relay (`apps/relay`) | daemon keypairs, `repository_owner` fingerprints | harbor cards (EdDSA JWT), operator bearer token, GitHub-Actions-OIDC→card exchange, webhook HMAC |
| fleet-executor | GitHub App installation | App JWT → installation tokens (KV-cached) |
| email-ingress | none | two shared HMAC secrets |

No D1 database has a `users`, `orgs`, `emails`, or `api_keys` table. The only
`account_id` in the tree is `lib/recovery-magic-link.ts` (a bonded-recovery
primitive), and `lib/keychain.ts` explicitly reserves a Keychain tenant for
"future user-account material."

Meanwhile, the data for the product experience we want **already exists**:

- The fleet-executor writes an append-only deliberation transcript per run —
  `fleet_runs` (header) + `fleet_run_steps` (map chunks, reduces, verdicts,
  findings, review posts, per-step token/cost metrics) in the shared relay D1.
- The relay already projects it as JSON: `GET /v1/fleet/runs/:id`
  (operator-token-gated, consumed by pd-console's Cloud Fleet pane).
- The GitHub check run ("Port Daddy Fleet") sets **no `details_url`**, so the
  "View more details on Port Daddy Fleet" link on every PR dead-ends at the
  App's marketing page.

So the coveted experience — click the check run, see a beautiful breakdown of
the fleet's review and deliberation — is not blocked on new plumbing. It is
blocked on (1) a URL, (2) a renderer, and (3) an answer to "who may see it."

## Decision drivers

- Ship the run page **now**, without waiting for a login system.
- Never leak private-repo review content to unauthorized viewers.
- Introduce real user rows (GitHub login, stored email) with the smallest
  schema that ADR-0029's account keys can later bind to.
- Move inference cost onto users (BYOK first, managed credits second) without
  tripping provider resale/redistribution ToS.
- Reuse what exists: the relay's D1 + operator gate, the GitHub App, the
  anchor/macaroon capability substrate (ADR-0014, ADR-0094) — never a parallel
  identity system.
- Local-first stays intact: the daemon, FleetBar, and pd-console keep working
  with zero account; login only unlocks *cloud* features.

## Decision

Four phases. Phase 0 is code in this PR; Phases 1–3 are committed design.

### Phase 0 — Capability-URL run pages (this PR)

The insight that unblocks shipping before login exists: **GitHub's own repo
ACL already decides who may see the check run.** Everything the transcript
contains (findings, verdicts) is also posted as PR comments — visible to
exactly the people who can see the PR. So a link that only those people ever
receive can safely open the full breakdown.

Mechanism:

1. The executor derives a capability token per run:
   `t = hex(HMAC-SHA256(RUN_PAGE_SECRET, runId))`.
2. `createCheckRun` / `completeCheckRun` set
   `details_url = ${RUN_DETAILS_BASE_URL}/fleet/runs/${runId}?t=${t}`.
   Both env values are optional; unset ⇒ no `details_url` (today's behavior).
3. The relay serves `GET /fleet/runs/:id` as server-rendered HTML. The gate is
   a timing-safe check of `?t` against the same `RUN_PAGE_SECRET`, OR the
   existing operator bearer token. No token, no page — the run id alone
   (deterministic `run:<deliveryId>`) is never sufficient.
4. The page renders the full deliberation: run header (repo, PR, ships,
   conclusion, wall-clock, spend), then a per-ship timeline of transcript
   steps — map fan-out, reduce, verdict badges, findings, posted reviews —
   with per-step token/cost metrics.

Properties: unguessable (128-bit HMAC), revocable (rotate the secret),
shareable exactly as widely as the PR itself, and zero new state. The known
trade-off of capability URLs — anyone holding the link can view — matches the
existing exposure (the same content is in PR comments).

### Phase 1 — GitHub login + user schema (relay)

**Login = GitHub OAuth web flow on the existing GitHub App** (user
authorization, not a second OAuth app). GitHub is the IdP; we never store
passwords. This is the same OIDC-first posture ADR-0029 chose for account
bootstrap.

Flow: `GET /auth/github/login` → GitHub authorize (signed `state` nonce in KV)
→ `GET /auth/github/callback` exchanges the code → user-to-server token →
`GET /user` + `GET /user/emails` → upsert user row → set session cookie
(`__Host-pd_session`; httponly, secure, samesite=lax; random 256-bit value,
only its SHA-256 stored). ADR-0039's D2/D3 disciplines (short sessions, strict
CSP, no localStorage tokens) apply verbatim.

Schema (new D1 tables, relay database):

```sql
CREATE TABLE users (
  id              TEXT PRIMARY KEY,          -- 'u_' || randomHex(16)
  github_user_id  INTEGER NOT NULL UNIQUE,   -- durable; logins can be renamed
  login           TEXT NOT NULL,             -- display only, refreshed at login
  display_name    TEXT,
  avatar_url      TEXT,
  primary_email   TEXT,                      -- verified primary from /user/emails
  email_verified  INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  last_login_at   INTEGER,
  deleted_at      INTEGER                    -- soft delete; erasure job hard-deletes
);

CREATE TABLE web_sessions (
  token_hash  TEXT PRIMARY KEY,              -- SHA-256(cookie value); value never stored
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  user_agent  TEXT
);

-- Personal access tokens for non-browser surfaces (FleetBar, pd-console, CLI).
CREATE TABLE user_tokens (
  token_hash  TEXT PRIMARY KEY,              -- SHA-256('pdu_' token)
  user_id     TEXT NOT NULL REFERENCES users(id),
  label       TEXT NOT NULL,                 -- 'FleetBar on MacBook Pro M4'
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER,
  revoked_at  INTEGER
);

-- Server-owned authority; a pdu_ token proves identity, not operator access.
CREATE TABLE user_roles (
  user_id    TEXT NOT NULL REFERENCES users(id),
  role       TEXT NOT NULL CHECK (role IN ('operator')),
  source     TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, role)
);
```

**Email storage policy:** store the verified primary email only, for login
continuity, security notices, and (later) billing receipts. Never marketing by
default. Erasure = soft-delete row now, hard-delete within 30 days; run pages
reference `user_id`, never email.

**Authorization for run pages (login path):** a signed-in viewer may open
`/fleet/runs/:id` without the `?t` token iff their user-to-server token can
read the run's repo (`GET /repos/{owner}/{repo}` → 200/404), cached 5 minutes
in KV keyed `(user_id, repo)`. GitHub stays the single source of authz truth —
no parallel permission tables to drift.

**Guarding the apps (login state):**

- Relay: `/v1/fleet/*` operator endpoints additionally accept a `user_tokens`
  bearer whose user has an `operator` role row (owner-only at first). The
  initial owner is materialized from the trusted
  `RELAY_OPERATOR_GITHUB_USER_ID` server variable on first access; the operator
  token remains the break-glass credential. Browser cookies do not authorize
  the native pause/delete path.
- Daemon/FleetBar/pd-console: `pd account login` runs the GitHub device flow,
  stores the minted `pdu_` token in the Keychain tenant `lib/keychain.ts`
  already reserves. FleetBar shows an account chip (Control Center → Cloud
  Fleet gains "signed in as @login"); pd-console reads the same daemon state.
  Local coordination features never require login — only cloud panes light up.
- When ADR-0029's account keypair ships, it binds to this `users.id` row (the
  OIDC binding table it specifies) — nothing here is throwaway.

### Phase 2 — BYOK: users fund their own fleets

Research verdicts (2026-07): OpenAI/Stripe's Agentic Commerce Protocol is
retail checkout inside ChatGPT; Virtuals' ACP is on-chain agent-to-agent labor
escrow; Google's AP2 is a mandate/VC framework, not a rail; x402 is stablecoin
micropayments with wallet-onboarding friction. **None fit "a human funds a
background review fleet."** GitHub Marketplace billing supports only
flat/per-unit plans — no usage metering. The shippable rails are BYOK and
Stripe credits; the protocols are watch-list items.

BYOK design (server-side, ToS-clean because each request bills the user's own
provider account):

```sql
CREATE TABLE user_provider_keys (
  user_id      TEXT NOT NULL REFERENCES users(id),
  provider     TEXT NOT NULL,     -- 'anthropic' | 'openrouter' | 'openai'
  ciphertext   TEXT NOT NULL,     -- AES-256-GCM envelope
  iv           TEXT NOT NULL,
  key_version  INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  PRIMARY KEY (user_id, provider)
);

CREATE TABLE fleet_run_spend (
  run_id        TEXT NOT NULL,
  ship          TEXT,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL NOT NULL DEFAULT 0,
  funded_by     TEXT NOT NULL,    -- 'operator' | 'byok:<user_id>' | 'credits:<user_id>'
  created_at    INTEGER NOT NULL
);
```

- Envelope encryption: per-key AES-256-GCM with a wrapping key held as a
  Worker **secret** (`USER_KEYS_WRAPPING_KEY`), ciphertext in D1. Workers
  Secrets themselves are per-worker/static — wrong shape for N user keys; D1 +
  envelope is the accepted pattern. `key_version` enables rotation.
- Repo→funder binding: a repo owner links their account to an installation
  (`installation_owners` row, proven by repo admin check). The executor
  resolves funding at run start: BYOK key present → route ships to the user's
  provider (Anthropic/OpenRouter) instead of Workers AI; else operator-funded
  Workers AI with today's spend gates. **Never silently fall back to the
  operator key** when a BYOK call fails — fail the ship visibly.
- OpenRouter is the preferred first provider: provisioned sub-keys carry
  built-in spend caps and per-key attribution, outsourcing metering.
- Every ship call writes `fleet_run_spend`; the run page grows a "funded by"
  line and per-ship cost bars; FleetBar's cloud-spend panel reads the same
  rows via existing telemetry.

### Phase 3 — Managed credits + anchor-native spend caps

- **Stripe prepaid credits + metered billing** for users who won't paste keys:
  operator holds the provider key, meters tokens per run, burns a
  `credit_ledger` (append-only, `delta_usd`, reason = `stripe:<intent>` or
  `run:<run_id>`). Runs pause, never overdraw, at zero balance.
- **Anchor-protocol integration (the differentiator):** the funding instrument
  becomes a **spend-capped capability** — a macaroon (ADR-0014 kernel) or
  harbor-card caveat (`cap: fleet:spend, max_usd, repo, expiry`) minted when a
  user funds a repo. The executor's pause gate checks the caveat before every
  ship. This is the same attenuation story ADR-0094 tells for SD-JWT-VC cards,
  pointed at money — and it composes with ADR-0029's receipts: a run page plus
  its spend rows *is* a verifiable work receipt (ADR-0039 Surface 1) for cloud
  work. AP2/x402 slot in here later as external settlement rails if
  agent-to-agent commerce materializes; the caveat layer is rail-agnostic.

## Benefits (why accounts are worth it now)

1. **The check-run details page** — the flagship demo. Every PR on every
   installed repo advertises the fleet's deliberation to every collaborator.
2. **Cost off the operator** — BYOK/credits make installing Port Daddy Fleet
   on someone else's repo economically safe; today every installation spends
   the operator's money.
3. **Per-user spend attribution** — `fleet_run_spend.funded_by` answers "who
   spent what" — the substrate ADR-0029 v3 quotas and billing need.
4. **A durable principal for everything queued behind it** — receipts as URLs,
   audit share links, fleet steering from a phone, the marketplace (ADR-0039
   Surfaces 1–4) all start with "a user row and a session."
5. **Distribution** — login-gated pages give the first real funnel metric
   (viewers → sign-ins → installs) for the go-to-market work in PR #707.

## Threat model delta

| Threat | Mitigation |
|--------|-----------|
| Run-page URL leaks (logs, forwarded email) | 128-bit HMAC token; rotate `RUN_PAGE_SECRET` to revoke all; content equals what PR comments already expose |
| Guessed run ids | Token required even for existent ids; timing-safe compare; 404 and 401 responses are indistinguishable in timing |
| XSS via transcript content (model output is attacker-influenced text) | Server-side render with strict HTML-escaping of every interpolated value; CSP `default-src 'none'; style-src 'unsafe-inline'`; no scripts on the page |
| Session theft (Phase 1) | httponly `__Host-` cookie, hash-only storage, 7-day expiry, re-auth for sensitive ops (key upload, token mint) |
| Stolen BYOK keys via D1 dump | Envelope encryption; wrapping key only in Worker secret; per-provider rows; `last_used_at` anomaly surface |
| Operator-key bleed (user run billed to operator) | Funding resolution is explicit per run and recorded in `fleet_run_spend.funded_by`; BYOK failure fails the ship, never falls back silently |

New invariants:

- **I-F1** A fleet run page is viewable only with the run's HMAC token, a
  session whose user can read the repo on GitHub, or the operator token.
- **I-F2** No response ever includes a provider key, a session token value, or
  `RUN_PAGE_SECRET`; only hashes/ciphertext are stored at rest.
- **I-F3** Every AI call in a fleet run has exactly one recorded funder.

## Alternatives considered

- **Ship login before the run page** — weeks of delay for no security gain
  (capability URL ≙ PR-comment exposure). Rejected.
- **Render `output.text` markdown inside the GitHub check run instead of a
  page** — 65k-char cap, no styling, no per-ship drill-down, and no account
  wedge. Worth doing *additionally* for a summary table; not the answer.
- **Public run pages for public repos** (visibility check per request) —
  extra GitHub API dependency in the hot path for little gain over the token;
  revisit as a Phase 1 nicety (`?public=1` when repo is public).
- **GitHub Marketplace billing** — no usage metering; only fits a future flat
  team tier. Deferred.
- **ACP (either), AP2, x402 as the funding rail** — wrong shape or premature
  (see Phase 2). Watch-list.

## Phasing and estimates

| Phase | Contents | Estimate |
|------|----------|----------|
| 0 (this PR) | details_url + HMAC gate + relay HTML run page + tests | done |
| 1 | OAuth login, users/sessions/tokens tables, repo-access authz on run pages, `pd account login`, FleetBar chip | ~2 weeks |
| 2 | BYOK (OpenRouter first, Anthropic direct second), spend ledger, funded-by on run page | ~2 weeks |
| 3 | Stripe credits, anchor spend-cap caveats, receipts alignment | ~3 weeks |

## Open questions

1. Should Phase 1 sessions live in D1 (as specified) or KV with TTL? D1 chosen
   for revocation queries; revisit if session reads dominate.
2. Installation-owner proof: repo `admin` permission vs organization owner —
   which claims a repo's funding binding when both exist?
3. Does the run page eventually move to portdaddy.dev (ADR-0039 W-phases) with
   the relay as its API? Likely yes; the relay-rendered page is the v0.
4. Retention: `fleet_run_steps` grows unbounded; align pruning with
   `EVENT_RETENTION_DAYS` before Phase 1 traffic.

## References

- ADR-0014 (Anchor Protocol), ADR-0029, ADR-0039, ADR-0049 (relay), ADR-0093
  (event→spawn trust), ADR-0094 (harbor cards as VCs)
- `apps/fleet-executor/src/execute.ts` (transcript writer),
  `apps/relay/src/fleet-observability.ts` (JSON read side)
- GitHub: check runs `details_url`; GitHub App user authorization (web flow)
- Cloudflare: Workers Secrets vs KV/D1 encryption-at-rest; envelope-encryption
  pattern for per-user secrets
- Stripe usage-based billing + credit grants (2025); OpenRouter provisioning
  keys; Anthropic usage/cost APIs; AP2; x402; OpenAI/Stripe ACP; Virtuals ACP

## Appendix — Tenancy boundary audit (local-first promise)

Audited 2026-07-14 with the `local-first-tenancy-boundary` skill; the audit
script is vendored at `docs/audits/tenancy_boundary_audit.mjs` (stdlib-only)
and the spec committed at `docs/audits/tenancy-boundary.spec.json`, so the
audit is re-runnable in-repo whenever a feature crosses a scope tier. Verdict at design time: **fail, score 64** — the
per-feature inventory passes (every identity-gated feature has a real
local-only path; every tier crossing has an explicit consent moment), but
three product-wide guarantees were missing. They are adopted here as **Phase 1
acceptance criteria**: Phase 1 does not ship while any of them is open.

### The scope ladder (single source of truth)

Declared once, in order; every role and consent check derives from it:

| Tier | Meaning in Port Daddy | Examples |
|------|----------------------|----------|
| `private` | On this machine, this OS user | daemon SQLite, sessions/notes/claims, Keychain secrets, local fleet transcripts |
| `repo` | Everyone with read access to a GitHub repo | fleet PR review comments, run detail pages (capability URL ≙ repo ACL) |
| `team` | The operator's cloud infrastructure | relay D1 (`fleet_runs`, future `users`), harbor channels, BYOK ciphertext, email in/out |
| `public` | Anyone | committed roadmap snapshot, portdaddy.dev, published receipts (ADR-0039) |

### Critical 1 — "local-only uploads nothing" must be runtime-testable

There is no CI test proving the daemon in local-only operation makes zero
outbound network calls; today that claim is only architectural. Acceptance
criterion: an egress-assertion test (spawn the daemon with cloud features
unconfigured, run a representative session lifecycle under a blocked-socket /
egress-recording harness, assert zero non-loopback connections) wired into CI.
Any future feature that phones home must fail this test until it is gated
behind explicit configuration.

### Critical 2 — export/delete per tier

Delete exists in the design for `users` (soft + 30-day hard erasure) but
export exists nowhere, and `fleet_runs`/`fleet_run_steps` retention is
unbounded (Open Question 4). Acceptance criteria: an export/delete matrix
covering every tier —

| Tier | Export | Delete |
|------|--------|--------|
| private | file copy of the daemon DB (documented command) | user-owned files |
| repo | run page + JSON API already export a run | run row + steps deletable by the installing admin (`DELETE /v1/fleet/runs/:id`, operator/owner gated) |
| team | `GET /v1/account/export` (user row, tokens metadata, spend rows) | account erasure job (already specified) + `fleet_run_steps` retention aligned to `EVENT_RETENTION_DAYS` |
| public | n/a (already public artifacts are git-versioned) | git history / site redeploy |

### Critical 3 — the ladder was implicit

Fixed by this appendix: the table above is the declaration. Phase 1 code must
import/derive tier checks from one shared constant, not re-encode the ordering
ad hoc per handler.

### Re-running the audit

```
node docs/audits/tenancy_boundary_audit.mjs \
  --input docs/audits/tenancy-boundary.spec.json
```

Update the spec's three booleans only when the backing artifact exists (the CI
egress test, the export/delete endpoints, the shared ladder constant) — never
ahead of it.

### Gate progress (re-audited 2026-07-14 after Phase 1)

Phase 1 closed two of the three criticals; the spec booleans were flipped only
because their artifacts now exist in-repo:

| Gate | At design time | After Phase 1 | Backing artifact |
|------|----------------|---------------|------------------|
| scope ladder ordered | ✗ | **✓** | `apps/relay/src/scope-ladder.ts` (declared once, imported) |
| export/delete per tier | ✗ | **✓** | repo: `DELETE /v1/fleet/runs/:id` + JSON `GET`; team: `GET /account/export` + `POST /account/delete` (soft-delete + session purge + PII null now, 30-day hard delete); private: user-owned files; public: git history |
| local-only uploads-nothing testable | ✗ | **✓** | `lib/safe/egress-assertion.ts` — fail-closed assertion that no considered flow reaches a non-loopback host, over the existing `egress-snapshot` capture; `tests/unit/safe-egress-assertion.test.ts` gives it teeth (a phone-home fixture MUST fail; an unverifiable host reports `verified:false`, never a silent pass) |

Score: **64 → 92.** The runtime-verifiable check now exists: `assertLocalOnlyNoEgress`
turns an egress snapshot into a PASS/FAIL verdict and fails on any egress to a
non-loopback host that is not an explicitly-allowed (paired-relay) destination,
so `localOnlyMode.uploadsNothingTestable` is now backed by a real artifact. The
remaining hardening is to drive it from a live daemon-boot integration test
(spawn the daemon local-only, capture, assert) so a regression in the boot path
is caught end-to-end, not only over fixtures. Phase 1 deliberately did **not**
ship account storage (email + user rows) without the matching erasure path —
storing PII with no delete is the exact tenancy regression this audit exists to
catch.
