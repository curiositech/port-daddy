# The Relay Grand Plan

**Status:** Proposal — 2026-08-04.
**Scope:** `apps/relay` (Cloudflare Worker + D1 + Durable Objects + Queues), its clients
(local daemons, pd-console, FleetBar, the cloud fleet executor), and the portdaddy.dev
account surface. One synthesis of five lens proposals (reliability, security,
collaboration, governance, platform) and their five steel-man critiques, reconciled
against the whitepapers (Harbor Economy, Bonded Commons, Federated Harbor, Anchor
Protocol, Legible Swarm, Single-Writer Kernel, From Spawn to Person), ADR-0049,
ADR-0101, ADR-0109, ADR-0116, and PLAN.md Part III (lighthouse/registry) + Part XII
(lighthouse threat model).

**Companion skills authored with this plan** (capability gaps the critiques exposed
with no existing skill): `skills/status-attestation-split-plane/`,
`skills/derived-index-consent-boundary/`.

---

## 0. What the relay is, and what it must never quietly become

The relay is the **one shared server every Port Daddy user ever will touch**. Today it
is a 329-line if/else route table (`apps/relay/src/index.ts`) fronting: Ed25519 harbor
cards + OIDC exchange (`auth.ts`, `oidc.ts`), per-publisher hash chains with
relay-countersigned heads (`handlers.ts`), a per-harbor `HarborChannel` Durable Object,
GitHub webhook ingress, the fleet control/observability plane and its kill switch,
ADR-0101 run pages + GitHub login + device flow, and ADR-0116 Stripe billing.

PLAN.md's spine — *"No relay server. No cloud dependency… the registry is a phone book,
not a relay"* — is not a contradiction to resolve by deleting one side. It is a
**two-plane doctrine** this plan makes explicit (§5.1): the **discovery plane**
(lighthouse/registry: phone book, no traffic, no history) stays exactly as PLAN.md
promises; the **event fabric plane** (this relay, per ADR-0027/0049) is the opt-in,
ciphertext-only, hosted-trust product. Every feature below is tagged with which plane
it lives on, and no feature may migrate discovery-plane promises onto fabric-plane
convenience.

### Ground truth (verified in-tree, 2026-08-04)

These are the facts the critiques sharpened; the plan builds on them, not on the
proposals' occasionally looser citations:

1. **`/health` is a liveness lie** — static `{status, version}`, touches no dependency.
2. **The global catch drops evidence** — `index.ts` catch returns `INTERNAL_ERROR`
   without logging or persisting `e`; zero `requestId` anywhere in `apps/relay/src`.
3. **The bearer-publish route does not exist.** `RELAY_PUBLISH_TOKEN` appears only
   under `apps/fleet-executor/`; `emitSquidEvent` POSTs at whatever
   `RELAY_PUBLISH_URL` an operator wires, with no schema tag, no identity, and a
   fire-and-forget contract ("a lost event is a lost event"). The fleet-cloud stream
   is **greenfield**, not a migration.
4. **Invariant I1 is performed, not held.** `github-webhook.ts` base64url-encodes
   plaintext JSON into the `ciphertext` field and writes `sig: ''`, `signed_head: ''`.
   The relay's highest-volume chain is neither encrypted nor signed.
5. **One operator god-token** (`RELAY_OPERATOR_TOKEN`) gates ~14 routes from
   kill-switch to audit to fleet-save-to-PR; `/v1/audit`'s actor column is always
   "the token."
6. **Two schema truths** — idempotent `schema.sql` plus a one-file `migrations/`
   directory; no staging D1.
7. **The maintainers are unmonitored** — the retention sweep (the fix for the
   unbounded-growth incident class) reports only to `console.log`.
8. **ADR-0049 reserved `_relay:status` and committed to a ≤5s revocation-propagation
   SLO; nothing emits the former and nothing measures the latter.**

### The doctrine (rules every feature obeys)

Distilled from where the critiques landed hardest. Each rule names its origin.

- **D1. Honesty before construction.** No feature may build on an invariant the code
  does not hold. I1 gets made real (or honestly relabeled) before anything markets
  "the relay never sees plaintext." *(security critique, attack 1)*
- **D2. Attest the bottom first.** The busiest publisher gets a real identity before
  any index, verdict, or governance artifact is derived from its stream.
  *(collaboration critique)*
- **D3. No shadow index.** Consent gates **derivation**, not just the read. The relay
  never materializes queryable per-operator state from witnessed traffic before an
  explicit listing consent, and derived rows die with the consent. *(collaboration
  critique; PLAN.md "phone book, not a log"; new skill
  `derived-index-consent-boundary`)*
- **D4. Split the status plane.** Anything that attests to the relay's health must not
  share fate with the relay, must speak three-valued verdicts
  (`healthy|degraded|unknown`), and must be externally anchored from day one — per
  ADR-0049's own I2 condition. Clients degrade on `unknown`; they never brick.
  *(reliability critique; new skill `status-attestation-split-plane`)*
- **D5. Presence before enforcement.** Read-poverty is the gap (Legible Swarm), not
  write-contention. Cross-machine coordination ships as legibility first (who's in
  the water), earns enforcement only with measured ignore-rates. *(governance critique)*
- **D6. One decider, no ballots.** Authority artifacts are signed, versioned,
  single-writer documents with succession — not vote machinery (Single-Writer Kernel).
  *(governance critique)*
- **D7. Sell trust, not the rail.** Signed agreements and settlement records ship;
  custody (escrow over the credit ledger) waits for legal review and a liquidity
  threshold. Credits stay closed-loop prepaid compute until a lawyer says otherwise.
  *(Harbor Economy; collaboration critique)*
- **D8. Crypto vs policy vs unbuilt — one public table.** Every trust claim on the
  trust page is labeled. "Blind to each other" is policy on a TCB we name (the
  executor sandbox); it is never sold as math. *(security critique, change 3;
  ADR-0045 honest attestation)*
- **D9. Ship the client half.** A server-side signal with zero client readers is
  legibility theater. `/v1/meta`, Sunset headers, tombstones, and Mercy verdicts each
  ship with at least one consuming surface in the same stage. *(platform critique)*
- **D10. Every control-plane change is an event.** Flag flips, kill-switch trips,
  break-glass uses, Helm changes — all published signed on reserved `_relay:*`
  channels, entering the same tamper-evident chains daemons already verify.
  *(platform killer feature; security "break-glass with a tattletale")*
- **D11. Humans are the scarcest resource.** Any summons spends agent attention before
  human attention (agent-first summons), gates before irreversible actions only, and
  never reintroduces the permission-ask ADR-0109 abolished. *(governance)*
- **D12. Fail-closed writes, fail-open reads, and say which.** The kill switch always
  works (break-glass kept, loudly); reads degrade with reasons, never silent 404s.

### Feature annotation key

Every feature below carries four mandatory fields:

- **Trust boundary** — who is authenticated as what, what the blast radius is, and
  what is crypto vs policy (D8).
- **Channel** — rollout lane. `latest` = dogfood cohort riding the newest promoted
  Worker version (explicit opt-in); `prod` = pinned stable. Everything soaks on
  `latest` (plus staging D1 for schema) before `prod` promotion via Cloudflare
  gradual deployments (1% → 25% → 100%). Note the canary blind spot honestly: traffic
  splits do not exercise mixed-version DO/D1 interactions; staging soak plus the
  replay corpus (L5) cover that class.
- **Mercy hook** — the health signal this feature feeds or is gated by (the Mercy
  program is N3/X7; hooks are named here so no feature ships observability-blind).
- **Cost** — engineering estimate + runtime cost + the honest failure story.

---

## 1. NOW — stop being blind, stop being ambient, stop lying (weeks 1–6)

### N1. Make I1 honest

Enforce AEAD structure at `/v1/publish` for E2E channels; for relay-readable streams
(GitHub webhook ingress, fleet-cloud), rename the field `payload_b64` with an explicit
`relay_readable: true` envelope flag, and **relay-countersign the GitHub stream**
(sign the synthetic sender's events and mint chain heads) so provenance can attach to
a chain subscribers can actually verify. Publish the crypto-vs-policy table (D8) on
the trust page in the same PR.

- **Trust boundary:** No new principals. Removes a false claim: today the trust story
  asserts I1 while `github:*` chains carry readable plaintext under `sig: ''`. After
  N1, every event is either provably AEAD ciphertext or explicitly flagged
  relay-readable — there is no third, lying state.
- **Channel:** `latest` → `prod` in one cycle (envelope change is additive; old rows
  backfilled by a one-shot migration marking them `relay_readable`).
- **Mercy hook:** new counter `events_relay_readable_total` vs `events_sealed_total`
  per channel class; an E2E channel receiving a readable payload is a `crit` incident
  (invariant breach, loud-fail per ADR-0045).
- **Cost:** ~1 engineer-week. Failure story: strict AEAD validation rejects some
  existing daemon publishes → ship detect-and-warn for one release before enforce.

### N2. Executor identity — attest the bottom first (D2)

Give the fleet executor an Ed25519 keypair in Worker secrets and make it speak the
full `/v1/publish` dialect: sender `fleet-executor@<deployment>`, **per-run channel
`<relayFp>:fleet-cloud:<runId>`** so `seq` is monotonic within one executor invocation
and chain sequencing never collides with fire-and-forget (no outbox needed; the
critique's dissolution, adopted). Tag the envelope `schema: 'squid/1'` now, while
there is one producer. Never build the bearer-publish route at all — the stream is
greenfield (ground truth #3). Identity row: `proof_method='operator-provisioned'`,
card capability `{op:'pub', channel:'<relayFp>:fleet-cloud:*', rate_per_min:120}`.

- **Trust boundary:** The executor becomes a named, capability-scoped publisher.
  Blast radius of key leak: forged fleet *telemetry* on one channel family (verdicts
  live in GitHub check runs, not here), bounded by rate + revocable via
  `/v1/revoke-by-issuer`. Fire-and-forget stays: dropped events remain dropped;
  honesty about loss arrives in X7 (reconciliation counts), not by breaking the
  never-blocks contract.
- **Channel:** `latest` only until X7's reconciliation exists; `prod` after.
- **Mercy hook:** per-run event count reconciled at `run-concluded` (X7);
  `unattested_publish_attempts` must read zero forever (there is no bearer route to
  attempt).
- **Cost:** ~1 week. Failure story: executor key in a misconfigured `wrangler.toml`
  leaks → rotation runbook via existing revoke-by-issuer; detection via chain-head
  anomaly (a second writer on a concluded run's channel).

### N3. Mercy v1 — the examination loop, split-plane from day one (D4)

The narrow, unarguable core: **the relay already declared the observability it needs
and never emitted it** (ground truth #1, #2, #7, #8). Mercy v1 is the enforcement arm
of ADR-0045 applied to the relay:

- `GET /v1/mercy/vitals` — deep health: D1 `SELECT 1` + events head, KV pause-flag
  read, synthetic DO round-trip publishing a sealed no-op on reserved
  `_mercy:pulse` in a canary harbor with SSE-delivery latency measured. Finally emits
  the `_relay:status` heartbeat ADR-0049 reserved. Three-valued verdict; a probe that
  cannot run reports `unknown`, never green.
- **Fixed global catch:** hash error → fingerprint, upsert `error_fingerprints`,
  return `{code:'INTERNAL_ERROR', incident: fp}`. RequestId minted at fetch entry,
  threaded **incrementally** (router + top-5 handlers in v1; full ~20-module
  threading is X7 work — the "2 engineer-weeks total" of the original proposal was
  wrong and the critique right).
- **D1 tables:** `health_samples` (7d retention, pruned by the existing sweep),
  `error_fingerprints`, `slo_windows`. The retention sweep's own results move from
  `console.log` into `health_samples` — the maintainers get monitored.
- **The ≤5s revocation-propagation SLO ships in v1** (ADR-0049's only committed SLO;
  the original proposal omitted it): the canary round-trip revokes a throwaway JTI
  and times `_relay:revocations` receipt.
- **Split read plane:** the Mercy report is served by a **separate tiny Worker**
  (own route, own deployment lifecycle) reading D1 + receiving pushed samples, with
  a PagerDuty dead-man switch (absence of heartbeat pages). The report's hash chains
  into `health_incidents` and the **chain head is anchored in the OSS repo from v1**,
  not v3 — per ADR-0049's I2 condition. No availability inversion: no client ever
  hard-gates on Mercy; `unknown` renders as cached-verdict-plus-retry.

- **Trust boundary:** Mercy sees envelope metadata only (I1 preserved — it measures
  delivery of ciphertext). The report is public-readable, relay-signed, externally
  anchored (crypto: signature + anchor; policy: probe honesty). Acks/silences require
  operator card + durable `actor_ack`.
- **Channel:** vitals endpoint `latest`→`prod`; the split-plane reporter is its own
  worker, versioned independently.
- **Mercy hook:** self-referential by design — Mercy's own probe-run success is a
  dead-man-monitored signal; the sweep monitors Mercy's tables' growth.
- **Cost:** ~3 engineer-weeks (was under-estimated at 2 including PagerDuty; the
  requestId scope cut is what makes 3 honest). Runtime: one D1 write per errored
  request + cron probes, negligible. Failure story: total CF control-plane outage
  silences internal probes → the external dead-man pages on silence; the honest
  verdict is `unknown`.

### N4. Split the operator god-token — with a tattletale (ground truth #5)

Relay-minted **operator cards** on the existing JWT machinery: new cap ops
`fleet:read|fleet:write|fleet:kill|issuer:admin|audit:read` via `matchCapability`
(which already handles `admin`), bound to the GitHub session so `/v1/fleet/save`
(it opens PRs!) is attributable to a human. Keep exactly one break-glass root token —
and **every break-glass use atomically publishes a signed `break-glass-used` event to
`_relay:flags` and the audit log before the request executes**. You can always bypass
the card system in an incident; you can never bypass it silently (D10, D12).

- **Trust boundary:** `/v1/audit` actor column becomes a human identity (the
  critique's sharpened win: *attribution*, not just least-privilege). GitHub becomes
  a dependency of card *minting* only — the kill switch accepts break-glass, tested
  in CI, so a GitHub outage cannot lock the pause path. The break-glass copy in CI
  secrets is named as residual risk, mitigated by the tattletale.
- **Channel:** dual-accept window on `latest` while FleetBar/pd-console re-plumb;
  a **dated sunset for the god-token on card-capable routes** (X6 machinery), so the
  migration cannot stall at "both forever."
- **Mercy hook:** `break_glass_used_total` (any nonzero pages), `god_token_hits` per
  route (its decay to zero is the migration's completion metric, on the Mercy report).
- **Cost:** ~2 weeks + client re-plumbing. Failure story: expired operator card
  mid-incident → break-glass path, loudly.

### N5. One schema truth + staging D1 + `/v1/meta` (platform, resequenced)

Freeze `schema.sql` as the historical baseline; all future DDL in numbered
`migrations/` via `wrangler d1 migrations apply` with a `pragma_table_info`
schema-asserting deploy gate (never the history table). Create
`port-daddy-relay-staging`; every migration soaks one retention-sweep cron cycle on
staging before prod. Add `GET /v1/meta`: `{protocol:{min,max}, features, deprecations,
channels}` with date-based protocol identifiers.

**Deliberately deferred** (per the platform critique): the version-transformer chain
waits for the first genuine response-shape break — the skill's own threshold
(>3 breaks/year, >10k consumers) is not met, and `hv:2` / `v1.<hmac>` are
request-path *credential validators*, not response transformers; they stay where they
are. **Client half ships now (D9):** the daemon reads `/v1/meta` at handshake and
pd-console surfaces deprecations; the structured 410 tombstone renderer (machine-
readable reason, migration URL, minimum viable version) ships in clients *now* so
ancient binaries fail actionably when a sunset finally fires years later.

- **Trust boundary:** none new; migrations become Steward-reviewed PRs (ADR-0109's
  single approver, used exactly within its charter: a fleet gate on PRs, not
  governance over humans).
- **Channel:** staging D1 is the schema lane for everything; `/v1/meta` `latest`→`prod`.
- **Mercy hook:** deploy gate emits `schema_drift_detected` (crit); staging soak
  failures land as incidents.
- **Cost:** ~1.5 weeks. Failure story: half-applied prod migration invisible to D1's
  ledger → the schema-asserting gate and staging soak exist precisely for this.

### N6. Flags as first-class, flags as events (D10)

`relay_flags(key, value, type CHECK(type IN ('release','kill','ops','experiment')),
owner, ttl_at, updated_by, updated_at)` in D1, KV-cached 30s, kill defaults compiled
fail-safe into the Worker. The fleet `paused` flag migrates in as
`kill-fleet-executor`. **Every flip publishes a signed event on `_relay:flags`** —
"who paused the fleet, when, on whose authority" becomes subscribable and
tamper-evident with zero new transport. Ramps bucket on `daemon_fingerprint`.

- **Trust boundary:** flips require operator card (N4); the flag *read* path is
  fail-safe (KV blip ≠ outage).
- **Channel:** `latest`→`prod`.
- **Mercy hook:** flag-flip events are themselves the audit trail; a kill flag held
  >24h without an open incident is a `warn` (zombie kill switch).
- **Cost:** ~1 week. Failure story: experiment flags without TTLs accrete → `ttl_at`
  is NOT NULL for `experiment`/`release` types; sweep reaps.

---

## 2. NEXT — tenancy, provenance with teeth, presence, the mediator (quarter 2)

### X1. Provenance tiers, enforced where they bind

`provenance: OPERATOR|INTERNAL|AUTHENTICATED_EXTERNAL|ANONYMOUS_EXTERNAL` classified
by **content author** (PR author's repo permission via the GitHub App; HMAC proves
GitHub sent it, never that the author is trusted — ADR-0093). The tier rides **the
queue message the executor honors**, not merely a D1 column (the critique's Potemkin
warning): tool scope, stacked-PR permission, and spend caps key off it in the
executor. ANONYMOUS_EXTERNAL ⇒ read+comment ships only, no push, purser-capped spend.
Delta ships run per `pull_request:synchronize` so a leaking secret is flagged at
commit 2. Self-authored PRs excluded **by the executor's N2 identity**, not
branch-name heuristics.

- **Trust boundary:** transport auth and content trust permanently separated
  (fleet-event-spawn-trust). Stale-permission window bounded: author-permission
  cache TTL ≤5 min.
- **Channel:** `latest` fleet cohort first; `prod` after two weeks of tier-vs-tool
  audit rows showing zero over-grants.
- **Mercy hook:** `tool_grants_by_tier` distribution on the report; any tool granted
  above its tier ceiling is a crit invariant breach.
- **Cost:** ~2 weeks + 1 cached GitHub API call/delivery. Failure story: permission
  API lag after collaborator removal → bounded by TTL, stated on the trust page.

### X2. Remote harbors = keypair + namespace + membership, nothing more

`POST /v1/harbors` (operator card), `POST /v1/harbors/:fp/invite` (signed single-use
JTI), `POST /v1/harbors/:fp/join` (invite + pubkey → `harbor_members` row + card).
Per-harbor issuer keys served at `/v1/keys/:harborFp` so members verify each other
without trusting the relay's identity table; E2E channel keys distributed
daemon-to-daemon at join (the registry stays a phone book — the relay routes
ciphertext). Member removal: lazy channel-key rotation at next epoch, honestly
documented (a removed member reads until rotation). Lost issuer key: escrow a
recovery share via ADR-0042 team secret sharing.

**Reachability as evidence, not vibes:** "can I reach my harbor" =
canary round-trip ∧ target daemon's recent (opt-in, X7) vitals ∧ valid unrevoked
card ⇒ `possible|degraded|impossible|unknown` with the failed leg named — the exact
boolean a future mobile client needs, and it degrades on `unknown` (D4).

- **Trust boundary:** discovery (lighthouse) never grants admission; membership rows
  do. Federation sovereignty stops at the machine boundary (Federated Harbor).
  Crypto: card verification, invite JTIs. Policy: relay's honesty about membership
  listings — checkable because joins are chained events.
- **Channel:** `latest` harbors (opt-in beta) → `prod`.
- **Mercy hook:** `remote_harbors` verdict per harbor on the report; invite-JTI
  replay attempts logged as security events.
- **Cost:** ~3 weeks. Failure story: key-distribution ceremony UX is the real risk;
  ship with `pd harbor invite` end-to-end tested on two real machines before `prod`.

### X3. Presence, then claims; the Helm, without ballots (D5, D6)

**Stage 1 — presence feed** (read-only): daemons mirror "who's in the water" — active
sessions, files recently touched — onto `claims:<owner>/<repo>` through the zero-trust
publish path. Mirroring local claims off-machine is a **`widensScope` crossing:
explicit ADR-0101 consent screen required** (the governance critique's catch —
private-tier daemon SQLite → repo tier). `pd guard check --staged` gains a relay
lookup that *prints* who else is there. Humans never type claims: their daemon infers
soft claims from worktree watch (save-twice-in-10-min ⇒ modify claim, confidence 0.6).

**Stage 2 — enforcement, only if earned:** WARN → `--acknowledge <claim-id>` →
helm-configurable blocking for direct modify/modify at confidence 1.0, activated only
after measured ignore-rates justify it. Pre-revert knowledge check (unwinding another
principal's <14-day-old merge requires a one-line acknowledgment linking their session
note) ships in stage 2.

**The Helm:** `repo_helm(repo, doc_json, master_fp, sig, seq, updated_at)` — one
master, officers, crew, each binding GitHub login + harbor fingerprints; per-repo
policy (claim TTLs, parley deadlines, mediator thresholds). Bootstrap requires
GitHub **admin** verification (a new check — the existing runs-page path checks read,
not admin; critique accepted). Dead-man succession in v1, not a footnote: a lease;
if the master's harbor is silent past the configured period, officers quorum-sign a
temporary helm, audited, auto-expiring. **No voting machinery, ever, in this plan:**
policy changes are Helm-versioned signed documents by the master (single-writer);
if collective choice is ever wanted, that is a future ADR with its own deliberation.
`repo_helm`, `repo_claims`, and the GitHub-login↔fingerprint linkage join
`retention-sweep.ts` and `/account/export`+`/account/delete` **as a shipping
criterion of this stage** (GDPR surface named up front).

- **Trust boundary:** relay orders and attests; the daemon enforces (suggestibility
  ladder). The relay must never be able to stop a human from coding — only from
  coordinating rudely. Malicious GitHub admin can rewrite a Helm: inherited authority
  root, stated.
- **Channel:** presence on `latest` cohort repos; Helm + stage 2 to `prod` only with
  export/delete integration green.
- **Mercy hook:** claim-collision pressure (contention depth, steal/expire events) as
  a golden signal; stale-Helm detector (master silent > lease) emits `warn`.
- **Cost:** ~4 weeks across daemon + relay. Failure story: claim smog → per-principal
  claim budgets, confidence decay; if ignore-rate stays >80% after a month, stage 2
  is cancelled rather than forced (presence remains valuable alone).

### X4. Parley over the relay, and the harbor-mediator with a real body

Multi-human parley needs delivery, a gate, and a deadline: D1
`parleys(id, repo, trigger, shape, participants, judge, deadline, state, outcome_json,
receipt_sig)`, turns on `parley:<id>` channels. Human gate design: before the
irreversible action **only** (merge/revert/force-push — this is a *new* gate on
multi-human disputes, not a re-gating of the Steward's solo-repo flow; see §5.4),
Approve/Modify/Reject with Modify's free text injected into the losing agent's
re-execution. Agent-first summons: the convener parleys with B's daemon/standing
instructions first; only a daemon `refuse`/`escalate` wakes the human (D11).
Deadlines default 24h; expiry triggers the Helm's default outcome (first claimant
proceeds, second rebases) — parley is never a liveness hole.

**The mediator gets a real body (critique change 2):** the `harbor-mediator` ship
runs in the executor, which after N2 **has a harbor card** — summonses ride the hash
chain with delivery acknowledgment, never the lossy fire-and-forget squid. It runs
symbol-level conflict prediction across open PR pairs (tree-sitter in the executor
container; capped, recency-prioritized, ≤50 pairs), posts neutral check runs, and
convenes parleys at ≥0.7 confidence, one open parley per PR pair. **Pre-collision
parley:** overlapping claims across two open PRs pulls both authors into a signed
agreement via PR comment before the merge conflict exists. **Parley receipts as merge
currency:** a completed parley's signed receipt attaches to the check run and
satisfies the existing pr-requirements-guard review-conversation requirement —
cooperation strictly cheaper than ignoring it (Ostrom P2). Verdicts enter only via
human session auth or daemon chains — never any bearer path (which, after N2, does
not exist).

- **Trust boundary:** summons = chained, acknowledged event (crypto); mediation
  quality = model judgement (policy, labeled). Fleet paused ⇒ verdict buttons gray
  out (no surface renders a verdict the relay can't enforce).
- **Channel:** `latest` repos opt in; `prod` gated on summons→ack rate >90% and
  parley-fatigue check (mute rate <10%).
- **Mercy hook:** summons delivery ack latency SLO; unacknowledged summons past
  deadline = incident; contention burn-rate crossing pages humans into parley with
  the claim-tree evidence attached.
- **Cost:** ~4 weeks. Failure story: parley fatigue → confidence floor + per-pair
  cap + fatigue metric with an explicit kill flag (`kill-mediator`, N6 machinery).

### X5. Directory + whois — consent-first, no shadow index (D3)

`PUT /v1/harbor/card` (signed self-report), `GET /v1/harbor/directory`,
`GET /v1/harbor/whois?q=` with ADR-0030's ranking (declared TF-IDF + demonstrated
recency-decayed signals, refuse-to-route below confidence floor, graceful
`{results: [], reason}` at cold start — never 404). The killer property survives the
critique in narrowed form: demonstrated capability is derived from chain heads and
run verdicts — an index over signatures, not self-reports — **but derivation begins
only at listing consent, covers only post-consent events, carries a retention bound,
and is dropped on delisting**. `capability_index` rows for unlisted operators do not
exist, not "exist but aren't served." Ranking weights are published to the audit log
on every change — down-weighting is accountable, not silent editorial power.
Bearer-tier "unattested" rows are impossible by construction (no bearer path, N2).

- **Trust boundary:** listing = private→public scope crossing with the ADR-0101
  consent screen; hashed harbor names; the directory is an activity oracle only for
  those who opted in, and the audit log proves the weights.
- **Channel:** `latest` (seeded, supply-side-subsidized cohort) → `prod`.
- **Mercy hook:** cold-start emptiness reported with `reason`; index derivation lag
  (consent→first row) as a freshness signal; delist→row-drop verified by sweep.
- **Cost:** ~2.5 weeks + 1 D1 write per consented publish. Failure story: Goodhart
  keyword-stuffing → demonstrated outranks declared; weights tunable *and audited*.

### X6. Deprecation machinery with teeth — and cheap sightings

RFC 9745/8594 lifecycle: `deprecations` table; middleware emits `Deprecation`,
`Sunset`, `Link` headers; `/auth/*` and `/billing/*` come under `/v1/` with old paths
as deprecated aliases. **Sightings made cheap (critique change 2):** last-seen per
(fingerprint, protocol, endpoint) buffered in the DO/KV, flushed to D1 by the
retention sweep, cardinality-capped — never a hot-path D1 write. Deletion of any
surface requires "zero identities seen in 30 days" *as a query*. CI fails 7 days
pre-sunset without the 410 or an extension commit. **Sunset-driven fleet PRs:** the
fleet bot reads sightings and opens a client-bump PR on any repo pinned to a
sunsetting protocol — the deprecation arrives as a mergeable fix. Unpinnable callers
(webhooks, browser pages) get a CI test asserting additive-only forever.

- **Trust boundary:** sightings are operational metadata about authenticated
  identities (repo tier); readable by the fleet bot under its N2 card.
- **Channel:** headers on `latest` immediately; enforcement CI on `prod` surfaces.
- **Mercy hook:** zombie-surface detector (deprecated >180d with traffic and no
  sunset) = `warn`; sunset-fired-with-recent-sightings = crit (the enterprise-
  lighthouse-goes-dark scenario, prevented by query not vibe).
- **Cost:** ~2 weeks. Failure story: bounded by design — the sweep prunes, the cap
  holds cardinality.

### X7. Mercy v2 — the network examines itself, within tenancy bounds

Daemon vitals-reports become **opt-in, aggregate-only, tier-gated** (the critique's
tenancy catch): a daemon that opts in publishes pre-bucketed 5-minute aggregates of
its own observed golden signals as `_mercy:vitals-report` events under its own card —
no cross-harbor quorum reads by the relay; regional degradation is computed per-harbor
and only aggregated across harbors as k-anonymous counts (k≥5). Squid loss honesty
without seq-state: **run-concluded reconciliation** — the executor reports per-run
event totals; the relay compares received vs claimed; gaps become a metric without
breaking fire-and-forget or inventing executor chain state beyond N2's per-run
channels. SLO burn windows + full requestId threading complete here.

**Circuit breaker, demoted to propose-and-page (critique change 3):** ship-verdict
error burning >14x *proposes* a pause — pages the Steward with evidence and a
one-click confirm; auto-engage only at `crit` after a timed window (15 min
unacknowledged), and the auto-engagement is itself a `break-glass`-class loud event.
An attacker who can craft failing PRs can page a human; they cannot silently switch
the fleet off. Spend canary (cost/hour vs baseline) rides the same path.

- **Trust boundary:** vitals are ordinary signed events under harbor cards; a lying
  daemon pollutes only its own harbor's view. The scope crossing (daemon metadata →
  shared server) gets the ADR-0101 consent screen.
- **Channel:** `latest` daemons opt in; `prod` after write-amplification measured
  (aggregation contract enforced server-side: >1 report/5min/daemon is shed).
- **Mercy hook:** is the hook. Also self-monitoring: the daemon-side sampler obeys
  the self-monitoring skill (own footprint, dedup keys, unref'd timers).
- **Cost:** ~4 weeks. Failure story: 10k daemons × 30s melts D1 → contract is
  1/5min pre-bucketed + server-side shedding; per-daemon forensics deliberately
  sacrificed, stated.

### X8. Quotas and budgets — an aggregating DO, priced honestly

Per-harbor daily event/byte budgets need durable counters: a small **aggregating DO**
per harbor using `state.storage` (the in-memory `Map` limiter in `HarborChannel`
resets on eviction and splits per channel — critique accepted; this is a subsystem,
scheduled as one). Budget exhaustion degrades to 429 with a `Retry-After` and a
ledger pointer — never silent drop. Billing wiring reads the credit ledger
asynchronously (cached balance, eventual enforcement) to keep ledger reads off the
publish hot path.

- **Trust boundary:** budget state is repo/team-tier operational metadata; enforcement
  is per-card capability + per-harbor budget, both visible on `/account`.
- **Channel:** shadow mode (count, don't enforce) on `latest` for two weeks → enforce.
- **Mercy hook:** budget-exhaustion events per harbor; enforcement-vs-shadow delta
  published before the flip.
- **Cost:** ~2 weeks. Failure story: DO storage adds latency to publish → batched
  writes, alarm-flushed; measured on `latest` before enforcing.

---

## 3. LATER — the market, the blind room, federation (quarters 3–4+)

### L1. Propositions and settlement — without custody (D7)

Parley kinds `mission|float_plan|charter|claim_dispute`: content-addressed bodies,
dual-signed, chain-anchored on both signers' chains; `POST /v1/parley/{propose,
counter,accept,decline,settle}`; operator DM channels (`dm:<fpA>:<fpB>`) minted in
the existing DO — hash-chained, evidentiary. Settlement records are signed artifacts;
**payment is out-of-band (Stripe Connect)** until (a) legal review of closed-loop
credit transfer between operators (money-transmission exposure is a cliff, not a
framing choice) and (b) a liquidity threshold (~50 tx/day) at which bond pricing can
even be evaluated. Listing fees, bonds, multi-oracle 2-of-3 settlement (with **at
least one non-Port-Daddy-operated oracle** — critique accepted), and escrow all wait
behind that gate. Myerson–Satterthwaite is accepted, not subsidized away silently.
Tide tables (signed availability windows from session heartbeats, consent-gated like
X5) route propositions to operators actually at the helm.

- **Trust boundary:** the relay is notary and phonebook; explicitly *not* escrow
  clerk in this stage. Dual signatures = crypto; arbitration = policy, labeled.
- **Channel:** `latest` invite-only market beta.
- **Mercy hook:** settlement latency, dispute rate, parley-lapse rate on the report.
- **Cost:** ~4 weeks + legal review (external, budgeted). Failure story: thin-market
  emptiness → supply side seeded free before anyone is charged; flip at threshold.

### L2. The blind room and sealed-charter skills — cost-raising, policy-bounded (D8)

Sealed-charter skill escrow: lender publishes skill as E2E ciphertext sealed to the
**executor sandbox's per-run ephemeral key**; borrower holds an execute-only
capability token (ADR-0101 HMAC style, caveats `{skill_id, harbor, max_runs, exp}`);
borrower gets outputs constrained by the parley's output schema (output-contract as
redaction); lender gets signed per-run receipts `{run_id, skill_id, verdict_hash,
tokens_used, iat}` feeding royalties. Blind receipts give both sides golden-signal
attestations. Sea-trial licensing: one free, blind, executor-attested invocation on a
canned public benchmark — portfolio proof against lemons without leaking the recipe.

**Sold honestly, per the security critique:** mutual blindness is a property of the
broker, not of math. The relay can mint any HMAC capability (policy). The borrower
chooses inputs, so the sandbox is a model-extraction oracle — "lender's text hidden"
is **cost-raising, not achievable**; output filtering and schemas raise the cost,
residual risk stated. The TCB is the executor sandbox (no egress, per-run keys,
adversarial harness gated before real payloads — sandboxed-adversarial-test-harness
is the shipping gate). No "formally verified" claim until the ProVerif model covers
the broker role. Disputes: metadata-first arbitration (provable from the audit
chain); content-revealing arbitration only under dual-consent key escrow, graduated,
never automatic.

- **Trust boundary:** the crypto/policy/unbuilt table is the product page. Blind to
  each other: policy on a named TCB. Blind to Port Daddy: false, and never claimed.
- **Channel:** `latest` only until the adversarial harness passes; the harness
  corpus becomes a permanent CI gate.
- **Mercy hook:** blind receipts are the marketplace's SLO currency (error-budget
  history as the only honest advertisement); sandbox-escape canaries are crit.
- **Cost:** ~6 weeks + harness. Failure story: sandbox escape leaks both sides at
  once — the fattest target on the platform, treated as such (egress lockdown is
  the stage kill switch).

### L3. Reputation and guilds — only on non-forgeable identity

Outcome rows from settled parleys feed reputation-adjusted bonds (veteran 0.5×,
unknown 2×); Sybil reset priced out by OIDC-anchored identity + burned listing fee.
Guilds: trust-scoped sub-directories with charter hash and steward (Greif-style
credible commitment, not an ACL with extra steps). Judge-gameable oracles: 2-of-3
rule and sampled audits forever.

- **Trust boundary:** reputation derives only from dual-signed settled artifacts —
  never from raw traffic (D3 applies to reputation as much as discovery).
- **Channel:** `prod` only after L1 has real settlement volume.
- **Mercy hook:** reputation-distribution drift + audit-sample disagreement rate.
- **Cost:** ~3 weeks. Failure story: plutocracy freeze-out → surcharge caps,
  newcomer sea-trials (L2) as the on-ramp.

### L4. Federation and the lighthouse, reconciled

Signed protocol manifests (relay signs `/v1/meta` with the KV-pinned key);
relay↔relay federation handshakes negotiating `max(min_a, min_b)` with crypto-suite
downgrades hard-refused inside the signed handshake; a conformance suite that **is
the same corpus the managed relay's CI runs** (suites that aren't rot). The
lighthouse/registry (PLAN.md Part III) ships as specified — phone book, signed
challenge registration, 24h heartbeat expiry, no history — as a *separate* plane;
self-hosted lighthouses (Layer 3) and self-hosted relays are distinct products that
compose. Gossip chain-head anchoring ("lighthouse beacons"): daemons republish
relay-signed chain heads onto their harbor's audit channel, so relay equivocation
(A2) is caught mechanically by members comparing anchors; FleetBar renders the
"relay honesty" light. Conformance is availability; cards are security (a lying
self-hosted relay is bounded by card verification).

- **Trust boundary:** federation trust = signed manifests + card verification
  (crypto); conformance claims = policy, bounded.
- **Channel:** conformance suite runs on every `latest` build first by construction.
- **Mercy hook:** per-peer federation handshake health; equivocation detections are
  crit and public.
- **Cost:** ~4 weeks. Failure story: named in ADR-0049 — I2 remains conditional on
  anchoring; beacons make the condition cheap to satisfy.

### L5. Replay corpus + the transformer chain, when earned

Sampled real request envelopes (ciphertext + headers, per protocol date) archived to
R2; every deploy candidate replays the corpus for all live-pinned versions against
its preview URL (workers.dev preview URLs — the custom-subdomain claim in the
original proposal was wrong) before canary promotion. The version-transformer chain
is built at the first genuine response-shape break, per N5's deferral.

- **Trust boundary:** corpus is ciphertext + envelope metadata only (I1 holds).
- **Channel:** gate on `latest` promotion.
- **Mercy hook:** corpus-replay pass rate per pinned version is a deploy gate metric.
- **Cost:** ~2 weeks. Failure story: corpus staleness → sampled continuously,
  retention-swept, coverage-per-version reported.

---

## 4. Mercy hook index (every feature, one table)

| Feature | Signal(s) it feeds | Gated by |
|---|---|---|
| N1 I1-honesty | sealed-vs-readable counters; E2E-breach crit | — |
| N2 executor identity | per-run chain integrity; zero-bearer invariant | — |
| N3 Mercy v1 | vitals, error fingerprints, revocation ≤5s SLO, sweep health | external dead-man |
| N4 operator cards | break-glass counter; god-token decay | — |
| N5 schema truth | schema-drift crit; staging soak incidents | staging soak |
| N6 flags | flag-flip events; zombie-kill warn | — |
| X1 provenance | tool-grants-by-tier; over-grant crit | audit rows |
| X2 harbors | `remote_harbors` verdict; invite-replay events | canary round-trip |
| X3 presence/Helm | contention burn; stale-Helm warn | consent + export/delete |
| X4 parley/mediator | summons ack SLO; fatigue metric | ack-rate ≥90% |
| X5 directory | freshness; delist-drop verification; weight audit | consent derivation |
| X6 deprecation | zombie-surface warn; sunset-with-sightings crit | 30-day-zero query |
| X7 Mercy v2 | reconciliation gaps; burn windows; breaker events | opt-in + k-anonymity |
| X8 quotas | exhaustion events; shadow-vs-enforce delta | shadow soak |
| L1 propositions | settlement latency; dispute rate | legal review |
| L2 blind room | receipts; escape canaries | adversarial harness |
| L3 reputation | drift; audit disagreement | settlement volume |
| L4 federation | handshake health; equivocation crit | conformance = CI corpus |
| L5 replay | pass rate per pinned version | — |

---

## 5. Contradictions, named and reconciled

This section exists so no reconciliation is silent. Each entry names the colliding
sources and the decision.

### 5.1 PLAN.md "No relay server" vs the forever-server

**Collision:** PLAN.md's spine ("No relay server. No cloud dependency… the registry
is a phone book, not a relay; no traffic passes through it") vs a relay positioned as
the one server every user hits. **Decision:** two planes, permanently. The
discovery plane (lighthouse/registry, PLAN.md Part III) keeps every promise verbatim:
phone book, no traffic, no history, 24h expiry, fallback to manual `--peer`. The
event fabric plane (this relay, ADR-0027/0049) is opt-in, ciphertext-routing, and is
the hosted-trust product (ADR-0048). The local daemon must remain fully functional
with zero relay (ADR-0101's "local-first stays intact"). Marketing may not blur the
planes; the trust page states both. The platform critique's demand — "pick one" — is
answered: *both, on different planes, with the boundary auditable.*

### 5.2 "Phone book, not a log" vs the capability index

**Collision:** PLAN.md lighthouse threat model ("no historical data stored") and the
directory's relay-derived `capability_index`; the collaboration critique showed
consent gating the read still leaves a shadow index as a breach/subpoena target.
**Decision:** D3. Derivation is consent-gated, post-consent-only, retention-bounded,
dropped on delist. Enforced as a checkable invariant (rows for unlisted fps must not
exist), tested in CI, and covered by the new `derived-index-consent-boundary` skill.

### 5.3 Invariant I1 vs `github-webhook.ts`

**Collision:** ADR-0049 ("relay stores and routes ciphertext only… unconditionally
preserved") vs plaintext base64url in the `ciphertext` column with empty signatures.
**Decision:** N1. Either AEAD or explicitly `relay_readable` — the lying middle state
is abolished, and the GitHub stream gets relay countersignatures so I2-class
verification can reach it. Until N1 lands, the trust page may not cite I1.

### 5.4 ADR-0109 (Steward, anti-gate) vs Helm admin and parley gates

**Collision:** the security proposal promoted the Steward to harbor `op:'admin'`
(a different mechanism wearing an accepted ADR's number — critique correct); the
governance proposal's merge-gates collide with the Steward's charter ("review IS the
gate"). **Decision:** the Steward stays exactly what ADR-0109 says: a fleet ship
owning PR-open→merged on solo-authority repos. Multi-human repos introduce the Helm
(X3) under a **new ADR** — no borrowed legitimacy. Parley gates fire only on
multi-principal disputes over irreversible actions, and the single-operator flow
gains zero new permission-asks. Where the Helm exists, the Steward's merge authority
becomes a caveat-attenuated grant from the master — an office held under the Helm,
revocable via `/v1/revoke`, defined in that new ADR.

### 5.5 Single-Writer Kernel vs governance voting

**Collision:** whitepaper #2 ("the wrong reflex: consensus… one decider dissolves the
hard part") vs proposals/votes/quorums in governance v3. **Decision:** D6 — voting is
cut from this plan entirely. Helm policy is versioned, signed, single-writer, with
dead-man succession. Ostrom P3 (collective choice) is honored socially (the master
consults), not mechanically.

### 5.6 Legible Swarm ("read-poverty") vs a write-contention guard as flagship

**Collision:** the whitepaper says the gap is read-poverty; governance v1 led with a
claims guard. **Decision:** D5 — X3 ships presence first; enforcement is earned by
measured ignore-rates or cancelled. The guard's credibility is the commons.

### 5.7 Harbor Economy ("harbor before economy", "sell trust, not the rail") vs escrow

**Collision:** whitepaper sequencing and pd-relay-zero-trust's explicit Float-Plan
settlement deferral vs v2 escrow riding the credit ledger; plus the
money-transmission cliff and the "notary, not party" claim colliding with
custody + discretionary ranking + platform-operated arbitration. **Decision:** D7 —
L1 ships signed agreements and settlement records with out-of-band payment; custody
waits for legal review + liquidity threshold; ranking weights are audit-logged (X5);
at least one settlement oracle is not Port-Daddy-operated. Myerson–Satterthwaite is
named on the market page, not hidden.

### 5.8 Federated Harbor sovereignty vs Helm/mediator reach

**Collision:** "sovereignty does not extend past the machine boundary" vs a Helm that
could read as governing remote machines. **Decision:** the Helm governs
*coordination artifacts on the relay* (claims, parleys, merges of shared repos) —
never the remote machine's daemon, tools, or files. Sanctions attenuate relay
coordination (rate-limits on publishes, claim budgets); they can never lock a human
out of git or a daemon out of its own machine.

### 5.9 Anchor Protocol / ADR-0049 I2 vs self-attested Mercy chains

**Collision:** a Merkle-chained status page signed and served by the system it
describes is tamper-evident theater (reliability critique); ADR-0049 conditions I2 on
external anchoring. **Decision:** D4 — Mercy's read plane is a separate Worker with a
dead-man switch from v1; the chain head is anchored in the OSS repo from v1; clients
degrade on `unknown` and never hard-gate. The `remote_harbors` verdict informs; it
does not brick.

### 5.10 ADR-0051 marketplace keystone vs zero-trust deferral

**Collision:** ADR-0051 names encrypted-capability trade as the unbuilt keystone;
pd-relay-zero-trust defers Float Plan settlement. **Decision:** the keystone is
scheduled (L2), gated on the substrate the deferral was protecting: per-publisher
identity (N2), per-harbor keys (X2), receipts (L1/L2), adversarial harness. The
deferral was about ordering, not abandonment; this plan is the ordering.

### 5.11 The executor's contract vs every plan that wanted it to be a chain publisher

**Collision:** squid-events' "no harbor card, never blocks, lost events are lost" vs
reliability's seq-gap detection, collaboration's evidence base, governance's mediator
summonses. **Decision:** N2's per-run channels give the executor identity without
per-deployment durable seq state; X7's run-concluded reconciliation gives loss
honesty without breaking fire-and-forget; X4's mediator publishes governance-grade
events under the card with acknowledgment, on a path distinct from telemetry. The
never-blocks contract survives intact for telemetry and is deliberately *not* offered
for summonses.

### 5.12 Small factual corrections adopted from critiques

`dlq.ts`/`telemetry.ts` live in the fleet-executor, not the relay; the fleet health
`queueDepthEstimate: null` is commented "reserved" (intent recorded, still worth
emitting); preview URLs are workers.dev-only (L5); `hv:2`/`v1.<hmac>` are credential
validators, not response transformers (N5); the runs-page ACL path checks read, not
admin (X3 requires a real admin check); the "~2 engineer-week" Mercy v1 estimate was
low (N3 says 3 with a scope cut).

---

## 6. Cost roll-up and ownership

| Stage | Engineering | Runtime | External |
|---|---|---|---|
| NOW (N1–N6) | ~9.5 engineer-weeks | +1 D1 write/errored request; cron probes; KV flag cache | PagerDuty; OSS-repo anchor |
| NEXT (X1–X8) | ~24 engineer-weeks | claim/vitals writes (batched, shed); sightings (sweep-flushed); aggregating DOs | GitHub API (cached, TTL ≤5m) |
| LATER (L1–L5) | ~19 engineer-weeks + legal review | R2 corpus; sandbox runs | counsel (money transmission); external oracle |

Ongoing taxes, stated: SLOs need an owner or they rot (X7 assigns the Mercy report
to the on-call rotation as its artifact); deprecation machinery is ~10% ongoing
platform tax (down from the platform proposal's 15% because the transformer chain is
deferred); flag TTL hygiene is swept mechanically.

The kill switch for each stage: N6 flags (`kill-*`) for NOW; X4 `kill-mediator`,
X5 delist, X8 shadow-revert for NEXT; L1 pause-parleys, L2 executor egress lockdown
for LATER. Every kill-flag trip is a signed `_relay:flags` event (D10).

---

## 7. Capability gaps → new skills

Two failure classes recurred across critiques and had no covering skill in `skills/`:

1. **`skills/status-attestation-split-plane/`** — the shared-fate/self-attestation
   trap (critique 5.9): status planes that die with the patient, green-by-default
   verdicts, availability inversion (clients hard-gating on the monitor), and
   unanchored "tamper-evident" chains. Used by N3, X7, and any future status surface.
2. **`skills/derived-index-consent-boundary/`** — the shadow-index trap (critique
   5.2): consent gating reads while derivation runs anyway, activity-oracle exposure,
   deletion that skips derived rows, and unaudited ranking discretion. Used by X5,
   X7 (vitals aggregation), L3 (reputation), and the lighthouse.

Existing skills carry the rest: `observability-absences-audit` (N3's method),
`api-versioning-strategy` (N5/X6, including its own don't-overbuild threshold),
`pd-relay-zero-trust` + `agentic-zero-trust-security` (N1/N2/X2),
`local-first-tenancy-boundary` (every consent screen), `fleet-event-spawn-trust`
(X1), `three-sided-agent-labor-market` + `mechanism-design-for-agent-labor` (L1/L3),
`ostrom-commons-governance` (X3, minus voting per D6), `semantic-conflict-prediction`
+ `wave-by-wave-parley` + `human-gate-designer` + `operator-surface-authority-designer`
(X4), `sandboxed-adversarial-test-harness` (L2's gate), `d1-and-supabase-migrations`
+ `zero-downtime-database-migration` (N5), `self-monitoring-resource-alarms` (X7's
daemon sampler), `articles-of-agreement-auditor` (L1/L2 session contracts).
