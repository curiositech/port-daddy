# Relay Threat-Model Delta — ADR-0101 Phase 1 (stored GitHub tokens)

Produced with the `pd-relay-zero-trust` skill's threat-review branch. The
general zero-trust review (`2026-07-14-adr-0101-zero-trust-review.md`) covered
credentials and tokens broadly; this one applies the relay's own adversary
catalog (A1–A6) and invariants (I1–I5) to the **one genuinely new asset** Phase
1 puts on the relay: a **GitHub user-to-server token, stored server-side**.

## The new asset

Per signed-in user, `web_sessions.gh_token_enc` holds the GitHub user-to-server
token, AES-GCM sealed. Verified posture:

- **Wrapping key is a Worker secret** (`USER_TOKEN_WRAPPING_KEY`), *not* a D1
  column. A D1 dump alone therefore does **not** disclose tokens — decryption
  needs the Worker runtime + its secret.
- **Minimal scope**: the OAuth grant is `read:user user:email`, not `repo`. As a
  GitHub *App* user-to-server token its reach is further bounded by the App's
  installation permissions. It is used for exactly one thing: the
  `GET /repos/{owner}/{repo}` visibility check that gates run-page access.
- **Bounded lifetime**: session TTL 7d; the user can revoke on GitHub at any
  time; GitHub App user tokens can themselves expire.
- **Never on the wire to the browser, never logged, never exported** (the
  `/account/export` path explicitly omits it; tests assert `gho_` never appears).

## Invariant check (I1–I5)

| Invariant | Effect of Phase 1 |
|-----------|-------------------|
| **I1 — relay never sees payload plaintext** | **Scoped deviation, by necessity.** I1 governs *channel pub/sub payloads*, which Phase 1 does not touch — those remain relay-opaque. But the stored gh token is a new *credential* asset the relay **can** decrypt (it holds the wrapping key), because the relay must *use* the token to check repo access. There is no E2E formulation that lets the relay perform a repo-access check without the token. This is at-rest protection against DB exfiltration, **not** protection against a compromised relay operator. Stated here so it is not mistaken for E2E. |
| I2 — subscribers detect relay equivocation (Merkle) | Unchanged (no pub/sub change). |
| I3 — stolen card bounded by exp/cap/aud, revocable | Preserved; the gh token has an analogous bound (scope + session TTL + GitHub revocation), and the run-page capability token gained versioned rotation (Z1). |
| I4 — attenuation never expands rights | Unchanged. |
| I5 — loss of relay does not lose past evidence | Unchanged. |

## Adversary catalog delta

- **A1 (honest-but-curious relay operator)** — can, in principle, read stored gh
  tokens (holds the wrapping key). Mitigation is procedural + minimization:
  minimal scope, short TTL, no logging. Not cryptographically prevented — an
  honest operator is trusted not to; this is the accepted cost of a functional
  BFF that must call GitHub on the user's behalf.
- **A2 (malicious relay operator / full Worker+secret compromise)** — **RT1
  (the real finding):** an attacker with the Worker secret *and* D1 can decrypt
  stored tokens and impersonate users to GitHub within `read:user user:email`
  scope + the App's install permissions, until session expiry or user
  revocation. Blast radius: read the user's identity/email and enumerate repo
  visibility the user already has — **not** repo *content* write, and **not**
  beyond the App's granted permissions. Bounded, but real.
- **A4 (compromised publisher)** / **A5 (compromised subscriber)** — unchanged
  by Phase 1; the account layer adds no new publish/subscribe capability.
- **A6 (compromised daemon)** — unchanged; accounts live on the relay, not the
  daemon.

## Findings & dispositions

- **RT1 (A2, MEDIUM) — stored tokens are relay-decryptable.** Accepted for v1
  with these mitigations already in place: Worker-secret wrapping key separated
  from the D1 ciphertext, minimal scope, session TTL, no-log/no-export.
  **Hardening backlog (not v1-blocking):**
  1. Shortest viable token lifetime; prefer GitHub App tokens configured to
     expire, refreshing on use rather than persisting a long-lived grant.
  2. Consider persisting **only the repo-access decision** (already KV-cached
     5 min) and re-authenticating when it lapses, so no reusable token is stored
     at rest at all — the strongest form. Weigh against re-login friction.
  3. Rotate `USER_TOKEN_WRAPPING_KEY` on a schedule; the envelope already
     versions per key so a re-seal migration is tractable.
- **RT2 (crypto → ProVerif backlog).** Phase 1 introduces new key material
  (AES-GCM token sealing). Per this skill's crypto gate, add a symbolic-model
  query covering *seal → store → open* under an A2 relay-compromise assumption
  to the relay's `analyses/` backlog. Tracked, not v1-blocking (the primitive is
  standard AES-256-GCM with a Worker-held key; the model documents the trust
  boundary, it does not gate the ship).

## What this delta does NOT touch (scope discipline)

Per the skill's anti-patterns: no Float Plans, no daemon state-sync, no change
to the pub/sub handshake, PKI (ADR-0025), or per-publisher Merkle chains. Phase
1 is an HTTP account surface layered beside the relay's event fabric, and the
only fabric-relevant fact is the new stored-credential asset documented above.
