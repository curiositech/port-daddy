# ADR-0095 — Email ingress over the Relay (E2E-encrypted, capability-scoped)

- **Status:** Proposed
- **Date:** 2026-07-06
- **Deciders:** Erich (operator), fleet/relay working session
- **Skill:** authored under `pd-relay-zero-trust` (threat-review + design branch)
- **Depends on:** ADR-0049 (relay), ADR-0093 (event→spawn trust gate), the
  relay's existing `ciphertext` envelope (`apps/relay/src/crypto.ts`) and
  per-channel hash chains, `lib/note-encryption.ts`.
- **Related code:** `apps/email-ingress/*` (deployed Worker), the fleet email
  trigger (`lib/fleet/triggers/email.ts`), `lib/relay-client.ts`.

---

## 1. Context

PR #672 shipped fleet **email IN** as: a Cloudflare Email Routing Worker
(`pd-email-ingress`) parses inbound mail and POSTs an HMAC-signed envelope to
the daemon's `/webhooks/fleet/email-inbound` receiver. That receiver only works
if the daemon is reachable from Cloudflare — i.e. **behind a tunnel**.

The operator correctly rejected a tunnel: the daemon trusts loopback as the
operator (unauthenticated `/spawn`, `/operator/state`, approval decisions), so
exposing `:9876` publicly is a wholesale auth-bypass. The relay exists precisely
to avoid this: the daemon dials **out** to the relay and subscribes; inbound
events land on the relay and are pushed down. GitHub webhooks already flow this
way. Email should too.

**The trap this ADR exists to avoid:** naively "publish the email envelope to a
relay channel" would write the message body/subject/sender — PII — into
Cloudflare D1 in plaintext, visible to an honest-but-curious relay operator
(adversary A1). That violates relay invariant **I1 (relay never sees payload
plaintext)** and commits the *Conflating Auth with Encryption* anti-pattern:
HMAC authorizes the publisher; it does nothing for confidentiality.

---

## 2. Is this worth building? (the honest product question)

**Would most developers want email ingress? No.** The median agentic-coding user
triggers fleets on git/PR/CI/webhook events, not email. Email ingress is a
**long-tail escape hatch**, valuable to specific segments:

- **"Services that only speak email."** Bank/vendor alerts, legacy monitoring,
  receipts, calendar invites, form notifications — things that will never POST a
  webhook. Email is the universal fallback ingress, the same role the generic
  `webhook:` trigger plays for things that *can* POST.
- **Personal/solo automation.** "Forward this to my triage agent," reply-to-
  approve, inbox digesting. Prosumer, not team.
- **Support/intake triage.** Inbound support mail → an agent drafts a reply /
  files a ticket. Real, but a support-desk use case, not a dev-tool one.

**Verdict:** keep it as *a* channel for completeness ("Port Daddy can trigger on
anything, even email"), but it is **not a headline feature and not on the
critical path.** This shapes the decision below: build the *minimal correct*
version, do not gold-plate (no IMAP threading, no rich MIME features, no
multi-mailbox routing) until real demand appears. The cost that matters here is
the E2E-relay crypto, which we get to reuse, not invent.

---

## 3. Threat model deltas (new surface: email ingress)

Adversary catalog is unchanged (A1–A6). What the new surface touches:

| Invariant | Effect | How preserved |
|---|---|---|
| **I1** relay never sees plaintext | **at risk** | Worker E2E-encrypts the envelope to the daemon's subscriber key (`crypto.ts` / note-encryption envelope). Relay stores + routes **ciphertext**; sees only metadata (channel, seq, ts, sender-domain for routing). |
| **I2** subscribers detect equivocation | preserved | Email events join the per-channel Merkle hash chain the GitHub path already builds; the daemon verifies against the publisher key. |
| **I3** stolen card bounded + revocable | preserved | The Worker publishes under a capability scoped to `cap=publish, aud=email-inbound, exp`; revocable. A leaked Worker secret can only publish forged email events on one channel, time-bounded (bounds A4). |
| **I4** attenuation only contracts | preserved | The Worker's capability is a strict attenuation of the operator's publish right; it cannot widen. |
| **I5** loss of relay ≠ loss of evidence | preserved | Chain heads anchor as today; the Worker's KV dead-letter (7d) is a second copy until the daemon acks. |

**New residual risks (stated, not hidden):**
- **Metadata leak.** The relay necessarily sees channel + timing + whatever
  routing metadata we expose. Keep routing metadata minimal (sender *domain*
  only if a filter needs it; never full address in cleartext metadata).
- **Worker key custody.** The Worker holds a publish capability + the daemon's
  encryption public key. Public key is not secret; the capability is — store as
  a `wrangler secret`, rotate on the card's `exp`.
- **Capability grammar gap (audit finding — `macaroon-capability-credentials`).**
  The `cap=publish, aud=email-inbound` scoping this ADR describes is NOT yet
  expressible: the canonical macaroon caveat grammar (`core/kernel/pd-anchor/
  src/macaroon.rs` `check_caveat`, ADR-0053 Appendix A) supports only
  `op/repo/branch/host/spend_usd/expires/session`. `cap` and `aud` are absent,
  so those predicates would fall through to the fail-closed `_ => false` arm
  (a card scoped that way simply never verifies). Building §5 therefore REQUIRES
  first adding `cap` and `aud` to the grammar + shared byte-parity vectors, or
  expressing the publish scope via existing fields. Until then the card can be
  scoped by `expires` (fail-closed on unset clock) and channel/session only.
- **ProVerif residual (unchanged from the substrate).** The macaroon
  discharge/binding construction is machine-checked, but first-party caveat
  soundness and the `MAX_DISCHARGE_DEPTH` bound are not yet in the symbolic
  model — so the `aud`/`cap` first-party restriction, once added, is enforced
  by the checker grammar but not yet formally proven. No "verified" language
  goes near the email path until §6's ProVerif extension lands.
- **E2E primitive is SYMMETRIC — the "encrypt to the subscriber key" framing
  is imprecise (crypto-review finding).** The reused envelope
  (`lib/note-encryption.ts`) is **AES-256-GCM with a shared 256-bit key**, and
  `apps/relay/src/crypto.ts` provides only Ed25519 signing + hashing — there is
  **no asymmetric encrypt-to-public-key primitive** in the code this ADR
  proposes to reuse. So I1 ("relay never sees plaintext") is deliverable, but
  ONLY via a **Worker↔daemon pre-shared symmetric key that the relay never
  holds** — not by encrypting "to the daemon's subscriber *public* key" as
  §3/§5 imply. This makes **Worker key establishment + rotation the crux**: the
  Worker must hold a symmetric envelope key (a `wrangler secret`), distinct from
  the publish capability, rotated out-of-band; the relay must never receive it.
  The alternative — a real asymmetric primitive (libsodium sealed-box /
  X25519-ECDH→AES-GCM) — would be **new crypto**, contradicting the "no new
  crypto" constraint (§4 Pragmatic). §5 must pick one explicitly before build;
  as written the two claims ("reuse symmetric note-encryption" + "encrypt to
  subscriber key" + "no new crypto") cannot all hold.

**Griefing (cryptoeconomic-protocol-security Attack Class 2 — the one economic
lens that applies to an unbonded system):** email/webhook ingress has
*near-zero cost to the attacker* (mail the address; POST an unsecured channel)
and a real *cost to the system* — flooding the operator's approval queue
(attention burial) and, worse, growing the in-memory pending set without bound
(memory exhaustion). It is NOT undercollateralization (no bond), NOT front-
running (no bids), NOT oracle manipulation (the operator is the sole trust
root and cannot profit by ruling against themselves). Sybil (Class 4) is
structurally neutralized: forged `From` addresses gain nothing because every
external event is `ANONYMOUS_EXTERNAL` regardless, and only a DMARC pass (which
a spoofer cannot forge) upgrades trust.

Griefing defenses, classified:
- **Structural — scope-limit (ADR-0093):** a flood can only *enqueue an
  approval*, never spawn. Damage per event is bounded to "operator sees a gate."
- **Structural — hard pending cap (`MAX_PENDING_APPROVALS = 200`):** the
  approval stream refuses new gates past the ceiling (fail-closed; the trigger
  re-fires once drained), so a distinct-content flood that defeats fingerprint
  dedup cannot exhaust memory. *Implemented this session; applies to the
  already-merged webhook path too, not just email.*
- **Structural — rate-limit the relay publish endpoint** (per-source).
- **Structural — idempotency (delivery-id / content fingerprint):** identical
  floods collapse to one gate.
- **Economic:** N/A — no bond in this design. If email ingress ever grows a
  paid/hosted tier, a per-sender allowlist or a bonded-sender lane would move
  this to an economic defense; that is a Float-Plan-layer decision, explicitly
  deferred (see pd-relay-zero-trust: no Float Plans on the relay critical path).

**Out of scope (unchanged):** side-channel timing on AES-GCM, quantum on
Ed25519, physical key extraction, publishing-OS long-tail compromise.

---

## 4. Deliberation (four voices)

**Proponent (build it, E2E over relay).** The relay already has the ciphertext
envelope, per-channel chains, and outbound-dial transport. Email is just a new
publisher on a proven fabric. It closes the tunnel question permanently and
makes "trigger on anything" literally true. *verdict: accept · confidence: high.*

**Pragmatic (fastest reversible path).** Do not invent crypto — reuse
`note-encryption.ts` / `crypto.ts`. Ship the minimal handler that mirrors
`github-webhook.ts` plus rate-limiting. Keep the local `/webhooks/fleet/*`
receiver as the tested code path and bridge relay events into it, so the trigger
logic is unchanged and the relay is a pure transport swap. Reversible: if the
relay path misbehaves, fall back to fallback-forward + DLQ (already live).
*verdict: accept-with-conditions · condition: no new crypto, no trigger rewrite.*

**Antagonist (assume bad-faith relay, hostile net, key compromise).**
*ship_blocker (would be true) if the envelope were plaintext* — email PII in a
third-party DB is a privacy breach and a reputational one. **Refuted by:** the
E2E ciphertext envelope (I1), so the relay operator sees only ciphertext +
minimal metadata. Remaining objections: (a) metadata correlation — mitigated by
minimizing routing metadata; (b) a compromised Worker forges email events —
bounded by I3 (scoped, revocable, time-limited card) and still gated by
ADR-0093 (every forged email is `ANONYMOUS_EXTERNAL`, requires approval, so a
forgery costs the attacker an approval prompt, not a spawn). *verdict:
accept-with-conditions · conditions: E2E mandatory, minimal metadata,
rate-limit.*

**Product/pragmatic lens (do we want it at all).** Long-tail, not headline
(§2). Accept, but cap the investment: minimal handler, no gold-plating.

**Synthesis:** accept, E2E-mandatory, minimal-metadata, rate-limited, no new
crypto, no trigger rewrite, no gold-plating. The antagonist's would-be
ship-blocker (plaintext PII) is refuted by making E2E non-optional.

---

## 5. Decision

Route fleet email ingress through the Relay, E2E-encrypted and
capability-scoped. Concretely:

1. **`apps/relay/src/email-ingress.ts`** — mirror `github-webhook.ts`:
   - Authenticate the Worker at the edge (HMAC over the raw request).
   - **Rate-limit** per source (new gate).
   - The publisher-side ciphertext is produced by the **Worker**, not the relay
     — the relay receives and stores `ciphertext` only (I1), computes the
     per-channel chain (I2), fans out on `email-inbound`.
2. **`apps/email-ingress` Worker** — before publishing, **E2E-encrypt** the
   envelope to the daemon's subscriber key using the note-encryption envelope;
   publish ciphertext to the relay's publish endpoint (capability-scoped card)
   instead of `PD_FORWARD_URL`. Keep the KV dead-letter + fallback-forward.
3. **Daemon bridge** — on a relay-delivered `email-inbound` event: **decrypt**,
   then feed the *existing* fleet email trigger via the same receiver seam the
   local POST uses today (no trigger-logic change). Every event still passes the
   ADR-0093 trust gate → `ANONYMOUS_EXTERNAL` → operator approval.
4. Retire the tunnel assumption: `PD_FORWARD_URL` becomes optional/legacy;
   the relay publish endpoint is the default.

**Explicitly NOT in scope:** IMAP, mail threading, multi-mailbox routing, rich
MIME, per-address fleets, Float Plans, daemon↔daemon state sync.

---

## 6. Consequences

- **Positive:** no tunnel, no inbound port, no daemon exposure. Email PII never
  leaves ciphertext to the relay. One proven fabric for all inbound (git, email,
  future SMS). Trigger logic untouched (transport swap only). Reversible to
  fallback-forward + DLQ.
- **Negative / cost:** the Worker must hold a scoped publish capability + the
  daemon's public key (custody + rotation). Metadata is visible to the relay
  (minimized, not eliminated). A daemon-side decrypt bridge is new code on the
  hot path.
- **Backlog (crypto touched → ProVerif):** extend the symbolic model to cover
  the email publisher path (it's structurally the GitHub path, so the delta is
  small) before any "formally verified" language goes near email.
- **Follow-ups:** capability issuance/rotation UX for the Worker; a
  `pd fleet sources` line showing email-inbound as relay-backed vs tunnel-legacy.

---

## 7. Threat-review checklist (this surface)

- [x] Which invariants preserved/weakened enumerated (§3).
- [x] E2E envelope reused (note-encryption / crypto.ts), no new crypto.
- [~] Publisher capability scoped + revocable (I3). **Scoping by `exp` +
      channel/session works today; `cap`/`aud` caveat fields must be ADDED to
      the macaroon grammar first (see §3 capability-grammar-gap) — not yet
      deliverable as written.**
- [x] Per-channel Merkle chain applies (I2).
- [x] Rate-limit on the new publish endpoint (spam/flood).
- [x] Idempotency (delivery-id) carried through (no double-fire).
- [x] Metadata minimization stated (no full address in cleartext metadata).
- [x] No Float Plans on the critical path.
- [x] No daemon↔daemon state sync (Part XVII trap).
- [ ] ProVerif extension filed to backlog (do before "verified" marketing).
