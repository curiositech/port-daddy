---
name: fleet-event-spawn-trust
description: >-
  Secure the path from an inbound event (webhook, email, SMS, GitHub comment,
  file, cron) to an agent spawn in the Port Daddy fleet. Use when wiring trigger
  sources to agents, reviewing the io-wiring registry, adding a trust/permission
  gate, hardening output sinks (SSRF/path traversal), scoping tools by
  provenance, or proving the spawn path is safe against prompt-injection →
  tool-abuse. Encodes ADR-0093 and the red-team threat model. NOT for generic
  Coast Guard sandboxing (ADR-0050), the macaroon push-grant gate alone
  (ADR-0053), or non-fleet code.
metadata:
  type: reference
---

# Fleet Event→Spawn Trust

The governing truth (from OWASP LLM Top-10 2025, CaMeL, and two red-team passes):

> **Prompt-level defenses are probabilistic and broken by adaptive attackers.
> Only ARCHITECTURAL defenses are sound: least-privilege tool gating by
> provenance, allowlists, capability credentials, dual-LLM, and human gates.**

When an inbound webhook/email/SMS/GitHub-comment becomes an agent's task text,
the attacker's words are the agent's instructions — and the agent may hold
`Bash(curl*)`/`Bash(git*)`. This skill is how you stop that.

## The one distinction that drives everything

**Transport auth ≠ content trust.** An HMAC-verified webhook proves the *relay*
is genuine; it says nothing about the *author* of the forwarded payload. Classify
by content source, never by the HTTP wrapper. Violating this is the highest-
severity attack ("webhook relay laundering").

## Where it slots

`#539` wires `trigger → runAgentOnce()` directly. The trust gate inserts in the
`io-dispatch.startTrigger` onFire callback, **before** `requestAgentRun`:

```
trigger fires ─► classifyTrust ─► validateAllowedToolsForTier ─► (approval?) ─► spawn
                 (provenance)      (least privilege, fail-closed)   (gated)      (macaroon-scoped)
```

## Pattern 1 — classify provenance by content source (`lib/fleet/trust.ts`)

```ts
export function classifyTrust(input, policy = {}) {
  const kind = (input.source ?? '').trim().toLowerCase();
  if (kind === 'pd') return 'OPERATOR';
  if (INTERNAL_TRIGGER_KINDS.has(kind)) return 'INTERNAL';     // git/schedule/file/pd
  if (EXTERNAL_TRIGGER_KINDS.has(kind)) {                       // webhook/email/sms/calendar/github
    const author = (input.metadata?.sender ?? '').trim().toLowerCase();
    const allow  = (policy.allowlistedAuthors ?? []).map(a => a.trim().toLowerCase());
    // BOTH required: allowlisted AND verified. Transport HMAC must NOT set consent_verified.
    if (author && allow.includes(author) && input.metadata?.consent_verified === true)
      return 'AUTHENTICATED_EXTERNAL';
    return 'ANONYMOUS_EXTERNAL';
  }
  return 'ANONYMOUS_EXTERNAL';   // unknown kind → fail closed (lowest tier)
}
```

## Pattern 2 — least-privilege, fail-closed tool gating

Allowlist per tier (never denylist — OWASP LLM05). Absent `allowedTools` means
"unrestricted" to the engine, which is the worst case for an untrusted trigger,
so it is **refused**:

```ts
export function validateAllowedToolsForTier(tier, spec) {
  if (tier === 'OPERATOR') return { ok: true, ... };
  const declared = parseAllowedTools(spec);              // "Read,Bash(gh*)" -> {read, bash}
  if (declared.size === 0)                                // absent == unrestricted == DENY
    return { ok: false, reason: 'tier requires an explicit allowedTools set', offendingTools: [] };
  const offending = [...declared].filter(t => !toolAllowedForTier(tier, t)).sort();
  return offending.length
    ? { ok: false, reason: `tools [${offending}] exceed the safe set for ${tier}`, offendingTools: offending }
    : { ok: true, ... };
}
```

Tool-name normalization defeats unicode/case/glob smuggling — `Bash(gh*)` still
grants `bash`:

```ts
export function normalizeToolName(raw) {
  const nfc = (raw ?? '').normalize('NFC').trim().toLowerCase();
  const paren = nfc.indexOf('(');
  return (paren >= 0 ? nfc.slice(0, paren) : nfc).trim();   // "bash(gh*)" -> "bash"
}
```

Approval is a **whitelist** of trusted tiers (a typo/unknown tier fails to gated):

```ts
const TRUSTED_TIERS = new Set(['OPERATOR', 'INTERNAL']);
export const requiresApproval = (tier) => !TRUSTED_TIERS.has(tier);
```

## Pattern 3 — SSRF guard on outbound sinks (`lib/fleet/url-guard.ts`)

Any sink that `fetch()`es an attacker-influenceable URL must call this first. It
classifies IPv4 literals in *all* legal forms (dotted/decimal/octal/hex), blocks
loopback/private/link-local/metadata/CGNAT, IPv6 loopback/ULA/mapped, non-http(s)
schemes, and embedded creds:

```ts
assertSafeOutboundUrl(payload.recipient, allowlist ? { allowlist } : {});
// blocks http://169.254.169.254/... , http://2852039166/ , http://127.0.0.1:6379 ,
// http://[::1]/ , file:// , http://user:pass@host/ ...
```

## Pattern 4 — path containment on file sinks (`lib/fleet/path-guard.ts`)

```ts
const expanded = containPath(payload.recipient);  // replaces unguarded resolve()
// - expands {date}/{time}/{iso} + ~, resolves (collapses ..)
// - contains within home/tmp/cwd; rejects /etc, /usr, other homes
// - realpaths the existing prefix (catches symlink escape; realpaths roots too)
// - refuses sensitive subpaths even inside home: ~/.ssh, ~/Library/LaunchAgents, .git/hooks
```

## Attack → defense (each has a test; the test name is the evidence)

| Attack | Defense | Test |
|---|---|---|
| webhook relay laundering | classify by content, not transport | `fleet-trust` "defeats webhook-relay-laundering" |
| prompt-injection → tool abuse | `allowedTools ⊆ safeSet(tier)` | `fleet-trust` "defeats injection-tool-abuse" |
| "no restriction + untrusted = full" | absent tools = deny (non-trusted) | `fleet-trust` "defeats absent-allowedTools-means-full" |
| silent approval bypass | whitelist tiers, fail closed | `fleet-trust` "defeats silent-approval-bypass" |
| unicode/case/glob tool bypass | NFC+lowercase+base-capability | `fleet-trust` normalize block |
| SSRF (metadata/loopback/obfusc IP) | `assertSafeOutboundUrl` | `fleet-url-guard` (15 vectors) |
| path traversal / abs / symlink | `containPath` | `fleet-path-guard` |
| sensitive write in home | sensitive-segment denylist | `fleet-path-guard` "defeats sensitive-subpath-write" |

## Anti-patterns (refuse these)

1. **Tiering on transport auth.** "the webhook HMAC verified, so trust the body."
   No — HMAC ⇒ relay genuine, not author trusted.
2. **Denylist of dangerous tools.** You cannot enumerate every dangerous tool;
   allowlist the safe ones per tier.
3. **Letting absent `allowedTools` mean "full".** For untrusted triggers that is
   total compromise; require an explicit set.
4. **Trusting the docstring.** #539's webhook output *said* "SSRF-guarded" and was
   not. Read the code; write the regression test.
5. **A weaker TS fallback verifier.** If the Rust macaroon kernel is absent, fail
   closed — never verify with weaker semantics (caveat-omission attack).
6. **Bare green assurance.** Every safety score shows its scan time and links to
   the underlying evidence (digest-with-zoom).
7. **Credentialless evidence mutation.** Loopback, Unix socket possession,
   headers, process labels, and reusable actor credentials do not authorize an
   external caller to append, terminalize, backfill, or delete canonical
   transcripts. Keep evidence production daemon-owned and in-process until a
   one-use broker-redeemed action boundary is actually wired; remove the old
   route instead of preserving a downgrade.
8. **Evidence-producer laundering.** A body or imported snapshot that names an
   internal producer, trusted tier, automatic trigger, or spawned-agent id is
   still caller data. Canonical lifecycle code stamps reserved provenance
   itself; legacy rows stay explicitly untrusted instead of being upgraded by
   inference.

## Quality gates

- [ ] External-triggered ships declare an explicit `allowedTools`; gate refuses otherwise.
- [ ] Trust gate wired BEFORE any untrusted ingress (webhook receiver / inbound email).
- [ ] Every outbound-URL sink calls `assertSafeOutboundUrl`.
- [ ] Every file sink/trigger path goes through `containPath`.
- [ ] Each new attack vector gets a named regression test.
- [ ] Macaroon tool/tier caveats covered by ProVerif before they are critical.
- [ ] Durable evidence sinks publish immutable artifacts from unique private
      temps; shared append rollback is not process-safe. Fsync only after the
      complete write, atomically publish, clamp directories/files to least
      privilege, reject symlink/unsafe targets, and require a receipt binding the
      exact artifact locator/digest/size/format before pruning live evidence.
- [ ] A terminal evidence receipt freezes every field covered by its digest.
      Status checks and child writes are one atomic operation; full-entry imports
      commit header plus children together before publication.
- [ ] The first exact archive success is immutable under interleaved stores; a
      late failure or different-digest success cannot replace it. Archive the
      fresh private-DB snapshot before invoking listeners.
- [ ] Archive roots, partitions, and artifacts are private; reject static
      symlink ancestors as well as symlink targets. If publication is still
      pathname-based, state the residual same-UID concurrent swap race instead
      of claiming an `openat`/dirfd guarantee.
- [ ] Public transcript HTTP/CLI surfaces are read-only unless the action
      service directly redeems a one-use capability. Every retired mutator has
      a hostile 404/405 regression and no compatibility fallback.
- [ ] Producer provenance is daemon-stamped at the in-process boundary; forged
      producer-shaped fields and pre-migration rows never acquire trusted
      provenance by declaration or inference.

## Residual (sound fixes not yet shipped — see ADR-0093 §10)

Dual-LLM/CaMeL for 2nd-order injection; DNS-rebinding resolve-and-pin; O_NOFOLLOW
for path TOCTOU; per-call gating for runtime-loaded MCP tools; signed outbox.
State these; never let green over-claim.

## Reference

- ADR-0093 `docs/adr/0093-event-spawn-trust-substrate.md` (full threat model + log)
- `lib/fleet/trust.ts`, `lib/fleet/url-guard.ts`, `lib/fleet/path-guard.ts`
- Tests: `tests/unit/fleet-trust.test.js`, `tests/unit/fleet-url-guard.test.js`, `tests/unit/fleet-path-guard.test.js`
- Builds on: ADR-0050 (Coast Guard), ADR-0053 (macaroon gate), `lib/macaroon/*`
