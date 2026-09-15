# ADR-0141: OIDC Workload Identity and the Standing Operator Grant

- **Status:** Proposed; design only — no runtime change lands with this ADR
- **Date:** 2026-09-14
- **Roadmap:** `fleetbot-workload-identity-admission`
- **Builds on:** [ADR-0025](0025-pki-decision.md) (OIDC-first PKI),
  [ADR-0049](0049-relay-architecture.md) (Relay v0, the `/v1/exchange` path),
  [ADR-0040](0040-non-forgeable-actor-identity.md),
  [ADR-0092](0092-suggestibility-ladder-and-cloud-coordination-federation.md)
  (the shipped macaroon grant substrate),
  [ADR-0101](0101-fleet-run-pages-github-login-and-user-funded-fleets.md)
  (the `pdu_` account credential and the scope ladder),
  [ADR-0134](0134-control-command-ingress-and-consent-transport.md) (one consent
  transport), [ADR-0140](0140-provable-action-adjudication-contract.md)
  (proposal → decision → effect binding)
- **Supersedes the admission half of:** the Fleetbot publisher shipped in
  `apps/relay/src/github-publisher.ts`. Execution, idempotency, lease fencing,
  and receipt signing are kept unchanged.

## Context

### The defect, verified in the code rather than paraphrased

`FleetbotPublisherCapability` in `lib/github-publisher-contract.ts` carries
`accountTokenHash`. `apps/relay/src/github-publisher.ts` enforces the binding
twice: `bearer()` requires an `Authorization: Bearer pdu_<64 hex>` header on
every request, and `verifyAndConsumeCapability` refuses the action unless
`capability.accountTokenHash` equals `hashHex(rawToken)` of that same header.
The nonce row written to `github_publisher_capability_uses`
(`apps/relay/migrations/2026-09-11-fleetbot-publisher-hardening.sql`) records
`account_token_hash` a third time.

The bearer is not decoration. `credentialForAccount` uses its hash to open the
operator's sealed GitHub OAuth credential out of `user_tokens.gh_credential_enc`
(`apps/relay/migrations/2026-09-05-fleetbot-publisher.sql`), refreshes it when
stale, and `authorizeExactRepository(installationId, repository,
account.credential.accessToken)` then spends *the operator's own GitHub grant*
to decide whether the repository is in scope. Possession of `pdu_` is therefore
possession of the operator's GitHub reach, mediated by Relay.

**Where the bearer actually lives — the (a)/(b)/(c) answer: (c), and the answer
is worse than either (a) or (b).**

- It is minted by Relay's GitHub device flow and custodied in the OS keychain by
  `lib/account-store.ts` under the account `account-device-token-v1`, with
  `~/.port-daddy/account.json` (mode 0600) still readable as a migration record
  by `cli/commands/account.ts`.
- That keychain entry and that file belong to the **same OS user the agent runs
  as** in a default installation, and `cli/commands/account.ts` documents
  `pd account token` as "Print the stored `pdu_` token (for scripting)". The
  credential is not custodied away from the agent; it is one command away from
  agent stdout. `skills/github-app-actuator/SKILL.md` already says the quiet
  part: "Same-UID policy files are guidance, not confinement."
- And no daemon custodian exists to hold it instead. Nothing outside
  `apps/relay/` and `tests/unit/github-publisher-contract.test.ts` imports
  `lib/github-publisher-contract.ts`. `POST /v1/fleetbot/publish` is a server
  with **no authored client in this repository**. There is no daemon minting
  step to point at and say "the secret stops here."

So the honest statement is not "a daemon holds the bearer." It is: *the design
intends (b), the filesystem delivers (a), and the code delivers neither because
the client was never written.* That is the best possible moment to change the
admission contract — there is no deployed caller to break.

### The substrate this ADR does not need to invent

Three things already exist, and this ADR depends on all three.

1. **An OIDC verifier and an exchange endpoint.** `apps/relay/src/oidc.ts`
   verifies a JWT against a registered issuer with exact-audience matching,
   explicit wildcard rejection, `exp`/`nbf` checks, mandatory `jti`, and a JWKS
   cache with a normal TTL and a fail-soft window. `POST /v1/exchange`
   (`handleExchange` in `apps/relay/src/handlers.ts`) consumes the `jti` exactly
   once, writes an `identities` row with `proof_method: 'oidc'`, and returns a
   relay-signed harbor card carrying server-attenuated capabilities.
2. **A workload identity registry that the publisher already reads.**
   `verifyAndConsumeCapability` resolves `capability.daemonFingerprint` against
   the `identities` table — the *same* table `/v1/exchange` writes. The Fleetbot
   capability is therefore **already** signed by a key that an OIDC exchange can
   register. `accountTokenHash` is a second list bolted beside a first list that
   was already sufficient.
3. **A macaroon grant substrate with an attenuation vocabulary.**
   `apps/relay/src/coordination-auth.ts` mints and verifies macaroons whose
   caveats are `op=`, `repo=`, `session=`, `expires=`, with the root key held
   inside Relay and holders permitted only to append. `lib/coordination-grant-contract.ts`
   is its typed wire shape. `apps/relay/src/scope-ladder.ts` declares the
   `private → repo → team → public` ordering "ONCE, in order, as the single
   source every role and consent check derives from."

### What "already registered via OIDC" refers to — finding, and its limit

The operator's workload identity registration is real and locatable. The seed in
`apps/relay/migrations/2026-08-08-relay-baseline.sql` registers exactly one
issuer:

| Field | Value |
| --- | --- |
| `issuer_id` | `https://token.actions.githubusercontent.com` |
| `jwks_uri` | `https://token.actions.githubusercontent.com/.well-known/jwks` |
| `audience` | `https://github.com/curiositech` |

That is GitHub Actions OIDC with a custom audience naming Relay. The audience
does **not** prove organization or repository authority. The implemented
exchange separately requires a bounded server-side trust policy containing the
numeric `repository_owner_id`, exact repository, `job_workflow_ref`, ref,
environment presence/value, runner environment, and optional event names. It is
managed at runtime through
`PUT /v1/config/issuers/:issuer_id` and can be disabled or revoked wholesale
through `POST /v1/revoke-by-issuer`. This ADR treats it as the named issuer and
designs against it.

**The limit must be stated, not hidden.** GitHub Actions OIDC tokens are minted
only inside a GitHub Actions job, by the runner, against
`ACTIONS_ID_TOKEN_REQUEST_URL`. A Port Daddy daemon on the operator's laptop
cannot obtain one. Searching this repository finds `id-token: write` in
`.github/workflows/publish.yml`, `.github/workflows/release.yml`, and the
Claude review workflows — but all of those consume it for npm provenance,
GitHub attestations, or a vendor action. **No workflow in this repository calls
`/v1/exchange`.** The trust relationship is registered and verified; it has no
live caller here yet.

That leaves a real, undecided fork, recorded below as **OQ-1**: the CI workload
class is covered by the registered issuer today; the laptop-daemon workload class
is not, and this ADR does not invent an issuer for it.

## Decision

### D1 — Two workload classes, one registry

Admission is by **workload identity**, never by an operator credential. A
workload identity is an `identities` row: an Ed25519 public key, its
`daemon_fingerprint`, a `proof_method`, the proof metadata, a `key_generation`,
and an expiry. There is exactly one such registry and this ADR adds none.

| Class | Enrolment proof | Status |
| --- | --- | --- |
| `ci` — a policy-admitted GitHub Actions job | GitHub Actions OIDC token exchanged at `POST /v1/exchange`; exact audience plus trusted numeric owner id, repository, workflow, ref, environment and runner claims; `jti` consumed once | Implemented; remains fail-closed until `OIDC_GITHUB_TRUST_POLICY_JSON` is configured |
| `host` — a daemon on an operator machine | **Undecided — see OQ-1.** The existing non-OIDC precedent is `proof_method: 'operator-provisioned'`, written by the operator-gated route in `apps/relay/src/fleet-executor-identity.ts` | Open |

What changes is only *how a row gets into `identities`*. Everything downstream —
capability signature verification, key-generation checks, revocation — is the
code already in `verifyAndConsumeCapability`, untouched.

### D2 — The standing grant, and what is authoritative for what

A **publisher grant** is a durable Relay-side record saying: *this operator has
decided, once, that this workload identity may perform this operation set on
these repositories, under these branch patterns, within these ceilings, until
this date.*

Proposed table `publisher_grants` in Relay D1 (designed-not-built):

| Column | Meaning |
| --- | --- |
| `grant_id` | `pdg_` + 32 hex. A **reference, not a bearer** — see D5 |
| `epoch` | Monotone integer. Any edit to any scope column bumps it |
| `account_user_id` | The operator who granted it; FK to `users(id)` |
| `subject_fingerprint` | The workload identity's `daemon_fingerprint`; FK to `identities` |
| `subject_class` | `ci` or `host` |
| `installation_id` | The GitHub App installation this grant attenuates |
| `repositories_json` | Exact `owner/name` list. **No globs.** See the note below |
| `operations_json` | Subset of the eight `FleetbotOperation` values |
| `branch_allow_json` | Head-branch prefix patterns, e.g. `["claude/", "fleet/"]` |
| `base_allow_json` | Base-branch exact names, e.g. `["main"]` |
| `mutations_per_day` | Publisher-side volume ceiling — see OQ-5 |
| `expires_at` | Absolute; enrolment cannot extend it |
| `created_at`, `created_via`, `created_ip` | Provenance of the grant itself |
| `revoked_at`, `revoked_reason` | Revocation; see below |

**Who may write one.** Only the operator, only through an interactive
Relay-hosted account surface authenticated by the browser session, never through
a machine-held credential and never through any agent-reachable path. This is
deliberate: writing grants from the machine the agent shares would reintroduce
the exact same-UID problem this ADR exists to remove. (**OQ-2** records the
alternative.)

**Revocation is one upstream edit.** `UPDATE publisher_grants SET revoked_at =
?, revoked_reason = ? WHERE grant_id = ?`. Nothing rotates. No key is
regenerated, no keychain is touched, no agent is restarted. Every capability
already in flight dies on the next request because the grant is re-read per
request (D6, *stale grant*). An operator who wants to stop an agent stops it in
one place, in one edit, from a browser.

**Which list derives from which — the repository scope.** This repository's
recurring defect is two lists that must agree with nothing deriving either from
the other, so this must be answered explicitly:

> The **GitHub App installation is authoritative for reachability**. The
> **grant is authoritative for authorization**. The effective scope is the
> intersection, computed per request, and the grant may only ever narrow.

Concretely: `repositories_json` is not free text. The account surface populates
it *by selection from the live installation repository list* that
`getRepoInstallationId` already walks, and Relay re-checks at publish time that
the named repository is still in the installation. A repository removed from the
installation therefore drops out of every grant automatically, with no second
list to sync. Globs are refused precisely so a future repository cannot enter a
grant's scope without the operator choosing it.

### D3 — What replaces `accountTokenHash`

Capability schema `port-daddy.fleetbot-publisher-capability.v2` (proposed)
replaces the single field `accountTokenHash` with two:

```ts
// proposed — replaces accountTokenHash in FleetbotPublisherCapability
grantId: string;    // 'pdg_' + 32 hex — names the standing grant
grantEpoch: number; // the exact grant version the daemon read when minting
```

Everything else in the capability is unchanged: `daemonFingerprint`,
`signingKeyGeneration`, `sessionId`, `repository`, `operation`, `baseBranch`,
`baseSha`, `headSha`, `requestHash`, `issuedAt`, `expiresAt`, `nonce`.

`grantId` is a reference and possession of it authorizes nothing. A capability
carrying it is admitted only when **all** of the following hold at request time:

1. The grant exists, `revoked_at IS NULL`, and `expires_at > now`.
2. `grant.epoch === capability.grantEpoch` — the daemon acted on the grant the
   operator currently has, not a version they have since edited.
3. `grant.subject_fingerprint === capability.daemonFingerprint`, **and** the
   capability signature verifies under that identity's registered `pub_key` at
   the exact `key_generation` the capability names. This is the binding that
   makes a stolen capability useless to a different workload: the thief would
   have to hold the enrolled private key, which is the thing being protected.
4. `capability.repository ∈ grant.repositories_json` **and** the live
   installation still covers it.
5. `capability.operation ∈ grant.operations_json`.
6. `capability.baseBranch ∈ grant.base_allow_json`, and the published head
   branch matches a `grant.branch_allow_json` prefix.
7. The session binding of D6 holds.
8. The nonce insert into `github_publisher_capability_uses` wins, with
   `account_token_hash` replaced by `grant_id` and `grant_epoch`.

So a stolen capability cannot be replayed against a *different workload* (3), a
*different repository* (4, 6), or a *different session* (7), and cannot be
replayed at all (8) — the existing nonce gate is kept verbatim.

### D4 — Token handling

**The single most important property of this design is where the OIDC token is
touched: at enrolment, once, and never on a publish.** A publish reads the grant
and verifies an Ed25519 signature. It performs no JWKS fetch, no JWT parse, and
no issuer round-trip. Everything below follows from that.

| Concern | Decision |
| --- | --- |
| Audience and workload scope | Exact string match against `issuers.audience`; wildcard and empty audience rejected. Audience identifies Relay only. A bounded `OIDC_GITHUB_TRUST_POLICY_JSON` separately allowlists numeric owner ids, exact repositories, workflow refs, refs, environments, runner environments, and optional events; missing or malformed policy fails closed |
| Token lifetime | GitHub Actions tokens are minutes-long; unchanged. The exchanged card stays ≤ 1h per ADR-0025. The Fleetbot capability keeps its existing `CAPABILITY_MAX_TTL_SECONDS` of 5 minutes |
| Grant lifetime | Operator-chosen absolute `expires_at`. An enrolment can never extend a grant |
| Clock skew | **One constant, not two.** Today the capability path allows 30s (`CAPABILITY_CLOCK_SKEW_SECONDS`) while `verifyOidcToken` allows none on `nbf`/`exp`. Hoist a single shared skew constant; apply it to `nbf` and `iat` in both directions and to `exp` in the *rejecting* direction only (a token past `exp + 0` is expired; skew must never extend a token's life) |
| JWKS cache | Unchanged: normal TTL `JWKS_CACHE_TTL_SECONDS`, fail-soft window `JWKS_FAIL_SOFT_SECONDS`, manual eviction at `DELETE /v1/cache/jwks/:issuer_id` |
| Key rotation | `kid`-directed lookup; an unknown `kid` forces exactly one JWKS refresh and one retry. A missing `kid` uses the first algorithm-compatible key |
| **Issuer unreachable** | **Enrolment fails closed. Publication continues.** No new `identities` row and no new grant may be created while JWKS is unavailable past the fail-soft window. Existing grants keep publishing, because a publish never consults the issuer |

This is a deliberate **departure from the prior research**.
`skills/pd-relay-zero-trust/references/pki-options-oidc.md` prescribes fail-soft
JWKS for an hour and then refusal, treating all OIDC-derived operations
uniformly. That is right for the exchange endpoint and wrong for a mutation
path: fail-soft is fail-*open* on key freshness, and a GitHub-side outage
should never be able to either (i) admit a workload enrolled against a
possibly-rotated key or (ii) stop an operator's already-granted agent from
answering a PR review. Splitting the two paths gives both properties at once,
and it is only available *because* the publish path no longer touches OIDC.

**What the operator sees when the issuer is down.** A named, specific failure —
never a generic 500, and never a silent downgrade:

```
ISSUER_UNREACHABLE  https://token.actions.githubusercontent.com
Last successful JWKS fetch: 2026-09-14T09:12:04Z (74 min ago)
Fail-soft window: 60 min — exceeded.
New workload enrolments are refused. Existing grants are unaffected;
publication is still working. Retry, or evict the cache with
DELETE /v1/cache/jwks/:issuer_id once the issuer recovers.
```

### D5 — What the agent may ever hold

| Artifact | May enter agent memory / env / argv / logs? | Why |
| --- | --- | --- |
| Repository, operation, base/base-SHA, head SHA, PR title and body | Yes | These are the proposal. The agent authors them |
| `grantId`, `grantEpoch` | Yes | A reference with no authority on its own; every request must *also* carry a capability signed by the workload key the grant names |
| The signed `FleetbotReceipt` | Yes | It is the evidence the agent must preserve and read back |
| The operator's `pdu_` account bearer | **No** | Removed from this route entirely |
| The operator's GitHub OAuth access/refresh pair | **No** | Never leaves Relay's sealed `user_tokens` row; unchanged |
| The GitHub App private key or an installation token | **No** | Unchanged; never crosses Relay |
| The OIDC ID token | **No** | Held by the runner for the duration of one exchange |
| The workload's Ed25519 private key | **No** | Held by the enrolled workload. Under a same-UID install this is the one remaining boundary, and it is a *workload* secret, not the operator's |

**Confirming the operator's own claim.** After this change, the set of the
operator's *personal* credentials reachable from the agent path is empty. The
`pdu_` bearer is no longer accepted by `POST /v1/fleetbot/publish`; the OAuth
pair was never reachable; the App key was never reachable. `pd account token`
remains for the non-publisher account APIs, which is a separate scope decision
and out of this ADR's scope — but the publisher no longer benefits from it, so
the actuator skill's boundary is satisfiable for the first time.

What remains agent-adjacent is the *workload's* signing key. That is the
intended residual: compromising it compromises a workload the operator can
revoke in one edit, not a human account that reaches everything the human
reaches.

### D6 — Threat cases, and what stops each mechanically

| Threat | What stops it |
| --- | --- |
| **Replay** of a captured capability | The existing nonce gate, unchanged: an `INSERT OR IGNORE` into `github_publisher_capability_uses` keyed `(daemon_fingerprint, signing_key_generation, nonce)`, followed by a read-back that must match this request's `grant_id`, `grant_epoch`, `request_hash`, and `idempotency_key`. A second use reads back another action's row and fails `CAPABILITY_REPLAY`. Bounded further by the 5-minute capability TTL and the exact `requestHash` binding |
| **Confused deputy** — the agent induces the workload to publish content it did not author | Not solved by identity, and this ADR does not claim it is. The workload signs whatever the agent hands it. What *is* enforced: the capability preimage commits to `requestHash` over the canonical request including `authorship`, so the published artifact is bound to a named actor and session, and `stampPullRequestBody` / `validateRoadmapTrailer` in `lib/github-publisher-contract.ts` force a visible provenance block and exactly one roadmap trailer onto every mutation. The grant bounds the blast radius to the chosen repositories, operations, and branch prefixes. Genuine authorship attestation needs ADR-0140's proposal/adjudication binding at the mint point, recorded as **OQ-4** |
| **Compromised workload** | Its `key_generation` is bumped or its `identities` row is revoked; `verifyAndConsumeCapability` already refuses a mismatched generation and a `revoked != 0` row. Its grants die with it because every grant names `subject_fingerprint`. Because enrolment is OIDC-derived for class `ci`, re-enrolment requires a fresh `jti` from a real job — a stolen old token cannot re-enrol, `oidc_exchanges` having consumed it |
| **Stale grant after the operator revokes** | The grant is re-read on **every** request, not cached into the capability. Revocation is visible at the next request, with no TTL to wait out. The `epoch` check additionally kills capabilities minted against a superseded grant version, so a narrowing edit takes effect immediately rather than at the next expiry |
| **Forged `sessionId`** | Today Relay never independently verifies `sessionId` — the contract comment says the daemon proves ownership. The fix is derivation, not a second list: `sessionId` becomes namespaced to its workload by **first-use binding**. The first capability naming a given `sessionId` binds it to that `daemon_fingerprint` in `github_publisher_capability_uses`; any later capability naming the same `sessionId` under a *different* fingerprint is refused. Cross-workload session theft is therefore impossible. **Within** one workload, `sessionId` remains self-asserted — that is the unchanged daemon trust boundary, and it is a residual risk, stated, not papered over |

### D7 — Migration without a flag day

There is no deployed client, which makes this cheap. Even so, it lands as
dual-accept so that a bootstrap publisher can be used during cutover.

| Phase | What lands | What is still accepted |
| --- | --- | --- |
| M0 | `publisher_grants` table, the operator account surface that writes rows, the read path | Nothing changes; v1 is the only capability schema |
| M1 | Capability schema v2 (`grantId` + `grantEpoch`); Relay accepts v1 **and** v2; the receipt records which admitted it | Both. v1 admissions carry `admission: 'legacy-account-bearer'` in the receipt so the deprecation is visible in evidence, not in a changelog |
| M2 | The first real workload enrols and the operator writes its grant. v2 becomes the documented path; `skills/github-app-actuator/SKILL.md` drops its "Current admission defect" section for a "how to enrol" section | Both, with v1 emitting a warning |
| M3 | `bearer()` is deleted from the route; v1 capabilities are refused with `CAPABILITY_SCHEMA_RETIRED` | v2 only |

**What the retirement ceremony becomes.** The ceremony in
`skills/github-app-actuator/SKILL.md` today retires the operator's *GitHub*
personal credential. It becomes a **two-credential ceremony**, because this ADR
identifies a second personal credential in the agent path that the ceremony
never named:

1. The final allowed legacy operation is the M3 cutover publish itself,
   performed under v1, naming exactly that one operation.
2. Retire the GitHub personal credential exactly as the skill already
   prescribes: remove from every `gh` host config, credential helper,
   environment injection, launcher and CI secret; revoke at GitHub; rotate
   anything ever printed or same-UID exposed.
3. **New:** retire the `pdu_` bearer *from the publisher path*. Delete
   `bearer()`; verify `POST /v1/fleetbot/publish` returns
   `CAPABILITY_SCHEMA_RETIRED` for a v1 request; verify a v2 request with a
   valid grant still publishes; verify a v2 request with a revoked grant fails
   closed.
4. Record kind, storage location, revocation timestamp, verification result and
   actor. Never a token or a recoverable prefix.

The ceremony stops being an exception granted to a bootstrap publisher and
becomes the moment the steady-state interface turns on.

## Part 2 — The consent cadence on the same grant substrate

### The constraint that governs the whole design

This operator has repeatedly and forcefully instructed agents to stop asking
permission and act. A consent ladder is therefore **only correct if it reduces
total interruptions**, and the mechanism by which it does so is the standing
grant: everything already decided is carried by a durable row and is never asked
again. "May I look around the repo?" is asked **once, ever** — not once per
session, not once per worktree, not once per agent.

This is an acceptance criterion, not a sentiment. A rung that adds a prompt to
work that used to just happen is a regression, and the ladder ships with a
counter that proves it: `asks_per_episode`, recorded on the episode receipt,
must fall after the ladder lands relative to the pre-ladder baseline for the
same work shape. If it rises, the ladder is wrong and is reverted.

### The rungs

The consent grant is **the same record shape as the publisher grant**, in the
same table, with a `surface` discriminator (`publisher`, `repo-read`,
`net-egress`, `spend`, `worktree-write`, `plan`). One table, one `epoch`, one
revocation path, one place the operator looks. It is not a parallel system and
the publisher grant is not special-cased.

| Rung | What varies | Satisfied by | Notes |
| --- | --- | --- | --- |
| **R0** Read-only local inspection | Nothing, once granted | **Standing**, asked once ever | Repo read, ripgrep, file read, test read. Scoped by project root. If this is ever asked twice the ladder has failed |
| **R1** Network egress, third-party reads, research subagents | Provider set and volume | **Standing** for the allowed provider set; a **notice**, not an ask, per episode | Becomes an ask only when it crosses into R2 |
| **R2** Spend above a threshold | Estimated cost band | **Per-episode**, but only when the band's *upper* bound crosses the grant ceiling | The default should be that most episodes never trip it. A ceiling tuned so it trips often is a mis-set ceiling, not a safety feature |
| **R3** Writes to the working tree | Worktree and path scope | **Standing**, scoped to worktrees the grant names | Reversible, git-recoverable, already the normal mode of work |
| **R4** Outward-facing mutations — PRs, comments, deploys | Repository, operation, branch | **Standing** — this is exactly the publisher grant of D2 | The whole point: the operator decided the repository and operation set once |
| **R5** Destructive or irreversible acts | Everything | **Per-episode, always. No standing grant may cover R5** | Force-push to a protected ref, history rewrite, secret rotation, production delete, merge-queue bypass, `git push --delete` |

Read down the "Satisfied by" column: four of six rungs are standing. The only
recurring asks are the two that genuinely change the bill (R2) or the blast
radius (R5) — which is precisely the operator's stated shape.

### The cost ask

**What an estimate is computed from.** Not a guess. `lib/cost-tracker.ts` already
holds the per-model rate table; `lib/cost-ledger.ts` already unifies
`cost_events` (per spawn) and `transcript_events` (per LLM turn) into one
time-anchored stream with rollups by actor, backend, model, project and session.
The estimator reads that ledger for prior samples of the same node shape and
multiplies projected tokens by the rate table. It keeps **no history of its
own** — the ledger is authoritative and the estimator derives from it. This is
the "one system, not two" rule applied to cost.

**What a range means.** The p10–p90 band of the matched historical samples, not
a `±x%` cushion around a point estimate. Below a sample-count floor the band is
labelled *uncalibrated* and shown wider, honestly, rather than pretending to a
precision the data does not support.

**How it gets calibrated — the part that is usually theater.** Every episode
receipt carries the triple, and the receipt is the calibration sample:

```ts
// proposed extension to AgentRunReceipt in lib/agent-run-receipts.ts
estimate: { lowUsd: number; highUsd: number; samples: number; calibrated: boolean };
actual:   { usd: number; source: 'cost-ledger' };
variance: { insideBand: boolean; signedPctVsMidpoint: number };
```

The loop closes because the next estimate reads these receipts back out of the
ledger. `skills/cost-verification-auditor/SKILL.md`'s ±20% threshold becomes a
**reported drift statistic over a rolling window, not a gate** — its own
anti-pattern section ("Per-Node Accuracy Obsession") argues for exactly that:
aggregate accuracy matters, per-node output variance of 30–50% is normal. A
band that misses persistently is a defect in the estimator, raised as a finding;
it is not a reason to block work.

**What the operator sees at an R2 ask.** Three numbers and a reason, in one
line: the band, what it is for, and what it is against the ceiling —
`$1.80–$4.60 · 14-node research sweep · ceiling $2.00 · calibrated (n=31)`.

### The plan-level ask — the hypertree case

This is the most valuable rung and the one most likely to be built as a wall of
JSON. It is also the one where the substrate already exists:
`WorkPlanPayload` in `lib/agent-harbor/work-intent-service.ts` already carries
`planId`, `intentId`, `nodeSpecs`, `placeholders`, and
`gates: [{ kind: 'human-approval', reason, status }]` with `requiresApproval:
true`. The plan ask **renders that object**. It does not define a second one.
The DAG edges come from `lib/graph-edges.ts` per ADR-0086, not from a new store.

**What makes it reviewable in under a minute** — this is the design, and it is
mostly about what is *not* shown:

1. **Three numbers above the fold, before any graph.** Total cost band; the
   count of R4 and R5 nodes (the only nodes that can hurt); the longest
   dependency chain (how long this will take). An operator who trusts the plan
   stops reading here and approves.
2. **One line per node, never a paragraph.** `verb · target · band · flags`,
   where flags are single glyphs for egress / write / outward-mutation /
   destructive. A node's full prompt, inputs and outputs live behind a
   per-node disclosure and are never inline.
3. **A visual cap of twelve nodes.** A wider plan collapses subtrees to a single
   summary row with its own band and flag rollup, expandable. A 60-node DAG
   rendered flat is not reviewable at any speed and pretending otherwise is how
   this gets built badly.
4. **Flagged nodes float.** R4/R5 nodes sort to the top of their layer and carry
   the only colour on the screen. The operator's eye should land on the
   irreversible step without searching.
5. **Re-approval is a diff, not a re-read.** A revised plan shows *what changed*
   against the last approved plan digest — nodes added, removed, re-prompted,
   re-costed. The second ask must be cheaper than the first or the ladder
   punishes iteration.
6. **The answer is on the plan digest.** An unchanged plan re-run needs no new
   ask; an edited plan is a new ask. This is the same digest discipline ADR-0140
   uses to bind a decision to an exact proposal.

### How an answer is recorded

An approval **is a grant row** — the same table, the same `epoch`, the same
revocation path. A per-episode approval is a grant with a short `expires_at`, a
`surface` of `plan` or `spend`, and a `plan_digest` scope column. A standing
approval is the same row with a long expiry and no digest.

Every receipt names the grant that authorized it:

```ts
// proposed extension to AgentRunReceipt in lib/agent-run-receipts.ts
authorizedBy: { grantId: string; grantEpoch: number; surface: string };
```

So "why was this allowed?" is answerable from the receipt alone, and "what did
this grant allow?" is answerable from the grant alone, and neither is a
free-text field. This is the same join ADR-0140 requires between an effect and
the decision that permitted it, reusing that vocabulary rather than adding one.

### What happens on no answer

The operator is often away, and the correct behaviour is neither "block
everything" nor "proceed anyway."

| | Behaviour |
| --- | --- |
| **Proceeds** | Every node whose rung is fully covered by a standing grant. Concretely: the agent reads the repo, runs research inside the granted provider set and under the ceiling, works in its worktree, and publishes PRs and review replies under the publisher grant. An away operator returns to finished work, not a stalled session |
| **Waits** | Only R2 nodes above the ceiling and R5 nodes. The DAG executes its standing-grant-covered prefix, then parks at the first gated node with every artifact preserved. Downstream-independent branches keep running; only the gated subtree parks |
| **Expires** | A per-episode ask has a TTL (default 72h) and **expires to not-approved, never to approved**. On expiry the episode is parked, not failed: artifacts, worktree, plan and partial receipts are preserved through the existing salvage path, and the ask joins the durable queue in `lib/fleet-hitl-proposals.ts` — which already enforces `MAX_PENDING_FLEET_PROPOSALS` so an away operator cannot be buried |
| **Never** | Silent escalation. An unanswered R5 ask never downgrades to R4 and never proceeds on a timeout. There is no "assume yes" path anywhere in this design |

## Open questions

Each carries options and a recommendation. None is papered over.

**OQ-1 — Which issuer enrols a laptop daemon?** The registered GitHub Actions
issuer covers class `ci` only; it cannot mint for a host daemon.

| Option | What it would require | Cost |
| --- | --- | --- |
| Extend the existing `operator-provisioned` path in `apps/relay/src/fleet-executor-identity.ts` to a `host` enrolment | An operator-authenticated browser flow that registers the daemon's public key, the same way the fleet executor's key is registered today | Lowest. Reuses shipped code and the existing `proof_method` widening from `apps/relay/migrations/2026-08-09-executor-identity.sql`. Not OIDC — an honest "operator-attested workload", which is materially better than a personal bearer but weaker than a verifiable issuer claim |
| A self-hosted OIDC issuer (Dex / Keycloak / Authentik) | Run and operate an issuer; register it via `PUT /v1/config/issuers/:issuer_id` | Real ops burden for a solo operator; the JWKS path and verifier already exist so the code cost is near zero |
| Cloud workload-identity federation (GCP / AWS / Azure) | Only meaningful if the daemon runs in that cloud | Not applicable to a laptop |
| Cloudflare Access service tokens or mTLS | Relay already runs on Workers | A different trust model from `identities`; risks a second registry, which this ADR forbids |
| ACME, per ADR-0025's v1 hybrid | A name-bound daemon identity | The originally-planned answer; not built, and largest effort |

**Recommendation:** ship class `ci` against the already-registered GitHub Actions
issuer first, since it is complete today and proves the whole grant path
end-to-end. Enrol class `host` through the extended operator-attested route, and
record in the `identities` row that its `proof_method` is attestation and not an
issuer claim so no surface can overstate it. Revisit a self-hosted issuer when a
second operator exists — not before.

**OQ-2 — Where does the operator write a grant?** Recommended: the Relay-hosted
account surface only. A `pd grant` CLI would be more convenient and is the
obvious ask, but it would put grant authorship back on the machine the agent
shares, under the same OS user, which is the defect this ADR removes. If a CLI
is wanted later it should *open the browser surface*, never write the row.

**OQ-3 — Grant versus installation scope.** Recommended and decided in D2:
intersection, with the installation authoritative for reachability and the grant
authoritative for authorization. Recorded here because it is the question most
likely to be re-litigated, and because the alternative (grant as the sole
authority) would create exactly the drifting second list this repository keeps
producing.

**OQ-4 — Confused-deputy: is first-use session binding enough?** It stops
cross-workload session theft but not an agent that persuades its own workload to
publish something it did not author. The stronger fix is to make the mint point
an ADR-0140 `ActionProposal` with an adjudication receipt binding the exact
content digest to the proposing actor before the capability is signed.
**Recommendation:** ship first-use binding now (cheap, no new object), and open
a follow-on to route the mint through ADR-0140's contract rather than inventing
a separate authorship attestation. ADR-0096 (signed guidance envelope and
suggestibility authority) should be evaluated as a second candidate before that
follow-on is scoped, though note its envelope authenticates guidance flowing
*into* an agent's turn rather than attesting what the agent then publishes
outward, so it likely constrains the confused deputy without closing it.

**OQ-5 — Where is a spend ceiling actually enforced?** Relay cannot see local
agent spend; it sees mutations. Pretending otherwise would be the kind of claim
this repository treats as a defect. **Recommendation:** the grant's ceiling is
`mutations_per_day`, a publisher-side volume ceiling Relay can genuinely
enforce. The USD ceiling stays local, in `lib/budget-guard.ts`, which already
splits pre-flight `canSpawn()` from mid-flight `onCharge()`. Two enforcement
points because there are genuinely two resources — and the ADR says so rather
than implying one number governs both.

**OQ-6 — One table or two for publisher grants and consent grants?**
**Recommendation:** one, with a `surface` discriminator. Two tables would mean
two revocation paths and two places the operator has to look to answer "what has
this agent been allowed to do", which is the failure mode this repository names
explicitly. The cost is a slightly wider row with surface-specific columns left
null; that is cheaper than a second system. ADR-0038 (claim tree —
multi-granularity coordination over hierarchical state) is a candidate prior art
for that row's scope representation and should be checked before the Phase 6
schema is cut, so the grant's scope columns do not become a third hierarchical
scope vocabulary beside it.

**OQ-7 — What is the pre-ladder `asks_per_episode` baseline?** It has to be
measured before M1 or the reduction claim is unfalsifiable.
**Recommendation:** instrument the counter first, sample two weeks of real
episodes, and publish the number in the M1 PR body. If the baseline turns out to
be near zero because agents already just act, then the ladder's only honest
justification is R5 containment and the other rungs should not ship.

## Implementation Matrix

| Phase | Roadmap slug | Status | Depends on | Description |
| --- | --- | --- | --- | --- |
| 0 | `fleetbot-workload-identity-admission` | now | — | This ADR: freeze the admission contract, the grant schema, the scope vocabulary, and the threat bindings |
| 1 | `publisher-grant-record` | now | Phase 0 | `publisher_grants` migration, the operator account surface that writes rows, per-request read and intersection with live installation scope |
| 2 | `fleetbot-capability-v2` | now | Phase 1 | Capability schema v2 (`grantId`/`grantEpoch`), **and the route that mints and validates it**: the daemon-side mint that reads the grant and stamps `grantId`/`grantEpoch` into the capability, and the Relay-side enforcement of all eight D3 admission conditions. Plus dual-accept admission, first-use session binding, nonce table column swap, negative fixtures for each D6 row |
| 3 | `fleetbot-host-workload-enrolment` | backlog | Phase 2, OQ-1 | Enrol class `host` per the OQ-1 recommendation; record attestation-versus-issuer provenance honestly in the identity row |
| 4 | `fleetbot-account-bearer-retirement` | backlog | Phase 3 | Delete `bearer()`, refuse v1, run the two-credential retirement ceremony, amend `skills/github-app-actuator/SKILL.md` |
| 5 | `consent-ladder-asks-baseline` | now | Phase 0, OQ-7 | Instrument `asks_per_episode` and publish the pre-ladder baseline — the falsifiability precondition for the whole ladder |
| 6 | `consent-grant-surface` | backlog | Phase 1, Phase 5 | Generalize the grant row with a `surface` discriminator; R0/R1/R3 standing grants; receipts name the authorizing grant |
| 7 | `plan-ask-rendering` | backlog | Phase 6 | Render `WorkPlanPayload` as the sixty-second plan review: three numbers, one line per node, twelve-node cap, flagged-node float, re-approval diff, digest-scoped answers |
| 8 | `cost-band-calibration` | backlog | Phase 6 | Estimate bands derived from `lib/cost-ledger.ts`; estimated-versus-actual on every receipt; drift reported, not gated |

Phase 0 changes no runtime behaviour. Nothing in this ADR should be described as
shipped, enforced, or credential-separated until Phase 4 lands.

To be explicit about the `grantId`/`grantEpoch` contract specified in D3: this
ADR *specifies* the format and the eight admission conditions, and **no phase
before Phase 2 makes them enforceable**. Phase 1 delivers the `publisher_grants`
record and the per-request read; Phase 2 delivers the route that mints a
capability against a grant and the Relay-side check that validates one. Until
Phase 2 lands there is no code path that accepts a `grantId`, so a reader should
not treat D3 as a contract the tree currently enforces — it is a contract this
ADR freezes for Phase 2 to implement.

## Consequences

### Positive

- The operator's personal account bearer leaves the publisher path entirely, and
  the boundary `skills/github-app-actuator/SKILL.md` already declares becomes
  satisfiable rather than aspirational.
- Revocation becomes one upstream edit with immediate effect, because the grant
  is read per request and the `epoch` invalidates capabilities minted against a
  superseded version. No credential rotation, no restart, no keychain surgery.
- A publish stops depending on the OIDC issuer being up, which makes it possible
  to fail *closed* on enrolment and *open* on publication — two behaviours that
  are both correct and were previously coupled.
- The grant is one record with one revocation path serving both machine
  admission and human consent, so "what is this agent allowed to do" has one
  answer in one place.
- The consent ladder's claim is falsifiable: `asks_per_episode` must fall, and
  Phase 5 exists to measure it before anything is built on top of it.

### Negative

- Class `host` has no issuer today, so the laptop daemon is admitted by operator
  attestation rather than a verifiable issuer claim until OQ-1 is settled. This
  is weaker than the ADR's own headline and must not be described otherwise.
- Confused deputy is bounded, not solved. The workload signs what the agent
  hands it; the grant limits the damage and the provenance stamp makes it
  attributable, but authorship is not proven until OQ-4's follow-on lands.
- `sessionId` remains self-asserted within a single workload.
- Relay enforces mutation volume, not dollars. Two enforcement points is a real
  cost of honesty.
- The plan-ask rendering is the only genuinely new UI surface here, and it is
  the piece most likely to be built as a wall of JSON despite the constraints in
  this ADR.

### Rejected alternatives

- **Keep `accountTokenHash` and custody `pdu_` in a separate OS user.** Fixes
  the same-UID reachability but leaves a *personal* credential as the
  authorization root, which the actuator boundary forbids regardless of custody.
  It also leaves revocation as a credential rotation.
- **Put the grant in the capability and skip the per-request read.** Makes
  revocation wait for the capability TTL and reintroduces a cached second list.
  Rejected on the repository's own recurring-defect rule.
- **A separate `consent_grants` table.** Two revocation paths, two audit
  surfaces, and the certainty that they drift.
- **Let the agent hold a long-lived attenuated harbor card instead of a grant.**
  Attenuation per `skills/pd-relay-zero-trust/references/harbor-card-attenuation.md`
  contracts rights correctly, but a card is a **bearer**: possession is
  authority, so revocation returns to rotation and the agent again holds
  something worth stealing. The grant is deliberately a *reference*, authorized
  only alongside a signature the agent cannot produce.
- **Ask per session for read-only repo access.** Directly contradicts the
  operator's standing instruction and would make the ladder a net interruption
  increase — the failure mode this design is explicitly built to avoid.
- **Estimate costs from a fresh estimator-owned history.** A second cost store
  beside `lib/cost-ledger.ts`, which already unifies the two that exist.

Roadmap-Spawns: fleetbot-workload-identity-admission, publisher-grant-record, fleetbot-capability-v2, fleetbot-host-workload-enrolment, fleetbot-account-bearer-retirement, consent-ladder-asks-baseline, consent-grant-surface, plan-ask-rendering, cost-band-calibration
