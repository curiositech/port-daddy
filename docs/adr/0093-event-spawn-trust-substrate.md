# ADR-0093 — Event→Spawn Trust Substrate: the secure middle between triggers and agents

- **Status:** Accepted — implemented. Phase-1 hardening merged in PR #632.
  L1 trust gate WIRED into `lib/fleet-engine.ts` (§4.3 insertion point,
  2026-07-04): refuse on tool-set violation; fail-closed refusal when
  approval is required and no queue is wired; injectable
  `enqueueForApproval` seam (the daemon writes durable `fleet:approval`
  tuples; the HITL proposal queue of PR #648 can consume the same seam).
  §5.3 follow-ups all closed. §6 macaroon caveats still gated on ProVerif.
- **Date:** 2026-06-27
- **Deciders:** Erich (operator), fleet/security working session
- **Supersedes/extends:** `docs/design/io-wiring-build-plan.md` (PR #539). Builds on
  ADR-0050 (Coast Guard sandbox), ADR-0053 (macaroon capability gate).
- **Related code:** `lib/fleet/io-dispatch.ts`, `lib/fleet/trust.ts` (new),
  `lib/fleet/url-guard.ts` (new), `lib/fleet/path-guard.ts` (new),
  `lib/fleet/outputs/webhook.ts` + `lib/fleet/outputs/file.ts` (hardened), `lib/macaroon/*`,
  `lib/coast-guard.ts`, `lib/secret-env.ts`.

---

## 1. Context

PR #539 ("I/O wiring Phase 1") merged a **pluggable trigger/output registry**
into the fleet engine. Triggers (`file`, `webhook`, `email`, `sms`, `calendar`,
plus legacy `git`/`pd`/`github`/`schedule`) now fire agents; outputs
(`file`, `webhook`, `notify`, …) deliver their results. The build plan's
Phases 2–5 wire **untrusted external ingress**: Phase 2 a webhook receiver,
Phase 4 inbound email + SMS.

This is the producer/consumer half of a substrate we want. But #539 wires
**trigger → `runAgentOnce()` directly**: there is no queue, no triage, and —
critically — **no trust boundary** between an inbound event and an agent
spawn. The agent runs with whatever `allowedTools` its ship declares, which
for ships like the Steward includes `Bash(gh*)`, `Bash(git*)`, `Bash(curl*)`.

The moment a Phase-2 webhook or a Phase-4 email becomes an agent's task text,
**the attacker's words are the agent's instructions, and the agent holds a
shell.** That is the CRITICAL we must close *before* untrusted ingress lands.

This ADR specifies the **secure middle layer** and hardens the Phase-1 sinks
that an audit found were already exploitable.

### Non-goals

- Re-architecting the agent runtime into a dual-LLM/CaMeL split (tracked as a
  future, sound-by-design upgrade — see §10 Residual).
- The console UI for the queue/telemetry (separate design).
- The local-vs-cloud routing economics (separate design; the trust gate is a
  precondition for it).

---

## 2. Threat model

Adversary: anyone who can deliver an inbound signal the fleet accepts — an
HTTP request to a webhook receiver, an email to a watched inbox, an SMS, a
GitHub comment, or a file in a watched directory. We assume they fully control
the *content* and may control *metadata headers*. We do **not** assume they have
local shell or the daemon's keys (that is the Coast Guard malicious-same-UID
caveat, ADR-0050 §honesty).

Two adversarial passes were run against (a) Phase-1 as-merged and (b) this
design. Findings drove both the code in this PR and the mitigation table in §7.

### 2.1 The load-bearing distinction

> **Transport authentication ≠ content trust.** An HMAC-verified webhook proves
> the *relay* is genuine. It says nothing about the *author* of the payload the
> relay forwarded. A relay-forwarded stranger email is still anonymous.

Every classification decision in this design obeys this. Violating it is the
single highest-severity attack ("webhook relay laundering", §7).

---

## 3. Architecture: the four layers (and where this ADR sits)

```
PRODUCERS (#539 trigger registry)        THIS ADR: the middle                 EXECUTION
─────────────────────────────────   ──────────────────────────────────   ───────────────
git / pd / cron / file        ┐
webhook / email / sms / GH ───┼─► L1 TRUST GATE ─► (approval) ─► L2 QUEUE ─┬─► local
operator dispatch             ┘     classify provenance,         per-backend │   (Ollama)
                                    least-privilege tools,        slots +    └─► cloud
                                    fail-closed                   spillover       (claude/codex)
                                          │                                          │
                                          └─ macaroon caveat scoped to safe tools ───┘
                                                                                      │
                                                                          L3 SURFACE (console + outbox)
```

- **L0 Producers** — #539's registry (done).
- **L1 Trust gate** — `lib/fleet/trust.ts` (this ADR; implemented). Classifies
  provenance, validates `allowedTools ⊆ safeSet(tier)`, decides approval.
- **L2 Queue** — durable spawn queue + per-backend concurrency + spillover
  (proposed; extends `lib/dispatch/queue.ts`).
- **L3 Surface** — console panes + transactional outbox (proposed).
- **Capability enforcement** — a macaroon caveat per spawn scoped to the tier's
  safe tool set (proposed extension to `lib/macaroon/caveats.ts`).

The insertion point is exact: inside the `io-dispatch.startTrigger` `onFire`
callback in `lib/fleet-engine.ts`, **before** `requestAgentRun(...)`.

---

## 4. L1 — the trust gate (implemented in `lib/fleet/trust.ts`)

### 4.1 Provenance tiers

| Tier | Source | Default tools | Approval |
|---|---|---|---|
| `OPERATOR` | `pd` (operator's own action) | all (`*`) | no |
| `INTERNAL` | `git`, `schedule`, `file`, `pd` local signals | read/grep/glob/edit/write/bash | no |
| `AUTHENTICATED_EXTERNAL` | external whose **content author** is allowlisted *and* verified | read/grep/glob | **yes** |
| `ANONYMOUS_EXTERNAL` | any other external (webhook/email/sms/calendar/GH) | read/grep/glob | **yes** |

### 4.2 Five invariants (each defeats a specific attack — each has a test)

1. **Classify by content source, never transport.** `classifyTrust` never
   consults transport HMAC; only an allowlisted-author *and* `consent_verified`
   raises an external trigger above anonymous. → defeats *webhook relay laundering*.
2. **Whitelist the safe tiers, fail closed.** `requiresApproval(tier) = tier ∉
   {OPERATOR, INTERNAL}`, so an unknown/typo tier defaults to *gated*. → defeats
   *silent approval bypass*.
3. **Normalize tool names (NFC + lowercase + trim) before matching.** → defeats
   *unicode/case bypass*.
4. **Absent `allowedTools` == unrestricted == DENY for any non-trusted tier.**
   An external-triggered spawn must declare an explicit safe set. → defeats
   *"no restriction + untrusted = full caps"* (the engine's existing default).
5. **A globbed tool still grants its base capability.** `Bash(gh*)` → `bash`. →
   defeats *glob scoping bypass*.

### 4.3 Insertion (proposed wiring)

```ts
// lib/fleet-engine.ts — inside the registry-trigger onFire callback
const startPromise = ioDispatch.startTrigger(raw, async (event) => {
  if (stopped || !running.has(agent.name)) return;

  const gate = evaluateTrustGate({
    event,                       // { source, metadata.sender, metadata.consent_verified }
    allowedTools: agent.allowedTools,
    policy: trustPolicy,         // operator-configured author allowlist
  });
  if (!gate.allowed) {
    auditAppend({ kind: 'trust-gate.refused', agent: agent.name, raw, reason: gate.reason, tier: gate.tier });
    return;                      // never spawn; reason only, never how-to-bypass
  }
  if (gate.requiresApproval) {
    return enqueueForOperatorApproval(agent, event, gate);  // L2 approval path
  }
  void requestAgentRun(agent, contextFromTriggerEvent(event), { macaroon: mintToolCaveat(gate.safeTools) });
});
```

---

## 5. Phase-1 hardening (implemented in this PR — fixes confirmed exploits)

The audit of #539-as-merged confirmed two CRITICALs by reading the code (not the
docstring). Both are fixed here with real guards + regression tests.

### 5.1 SSRF in the webhook output sink — FIXED

`lib/fleet/outputs/webhook.ts` did `fetch(payload.recipient)` with **zero URL
validation**, despite the build plan claiming "HMAC + SSRF-guarded" (the HMAC is
only on the webhook *trigger*; the *output* had nothing). An agent could POST the
operator's context to `http://169.254.169.254/...` (cloud metadata),
`http://127.0.0.1:6379` (loopback Redis), private ranges, or obfuscated IP forms
(`http://2852039166`).

**Fix:** `lib/fleet/url-guard.ts` — `assertSafeOutboundUrl()` parses the host,
classifies IPv4 literals in all legal-but-evil forms (dotted/decimal/octal/hex),
blocks loopback/private/link-local/CGNAT/metadata, blocks IPv6 loopback/ULA/
link-local and IPv4-mapped forms, rejects non-http(s) schemes and embedded
credentials, and supports an optional exact-host allowlist (allowlist mode is the
sound mode). Wired into `webhook.ts` before `fetch`. Tests:
`tests/unit/fleet-url-guard.test.js`.

### 5.2 Path traversal in the file sink — FIXED

`lib/fleet/outputs/file.ts` `expandPath()` did `resolve(homedir(), tail)` /
`resolve(input)` with **no containment**, so `~/notes/../../../etc/cron.d/evil`
or `/etc/shadow` escaped anywhere writable.

**Fix:** `lib/fleet/path-guard.ts` — `containPath()` expands tokens/`~`, resolves,
asserts containment within allowed roots (home/tmp/cwd), realpath-checks the
existing prefix to catch pre-planted symlink escapes (realpath-ing the roots too,
so macOS `/var→/private/var` doesn't false-positive), and refuses sensitive
subpaths within a root (`~/.ssh`, `~/Library/LaunchAgents`, `.git/hooks`, …).
Wired into `file.ts`. Tests: `tests/unit/fleet-path-guard.test.js`.

### 5.3 Findings deferred to follow-ups (documented, not silently dropped)

| Finding (Phase-1) | Severity | Status |
|---|---|---|
| File trigger path traversal / symlink watch | HIGH | guard exists (`containPath`); wire into `triggers/file.ts` (follow-up) |
| Trigger flooding / no rate limit at trigger layer | HIGH | L2 queue per-backend cap + backlog-age (proposed) |
| Consent enforced inside sinks, not at the bridge | MED | move `assertAllowed` to io-dispatch bridge (follow-up) |
| Missing webhook secret env-var → silent no-HMAC | MED | fail-closed if `secret:VAR` unset (follow-up) |
| Webhook header → `metadata.sender` injection | MED | trust gate already ignores transport for tiering; stop copying attacker headers into `sender` (follow-up) |

---

## 6. Capability enforcement via macaroons (proposed)

The trust gate decides *what tools are safe*; macaroons *enforce it
cryptographically per spawn*. `lib/macaroon/caveats.ts` today has 7 caveat
fields (`op`, `repo`, `branch`, `host`, `spend_usd`, `expires`, `session`) but
**no tool-set caveat**. The ProVerif analysis (`core/kernel/pd-anchor/formal/proverif/macaroon-discharge/macaroon_discharge_v1.pv`)
proved the discharge binding is sound and that a *naive* per-hop binding
(`v2_naive_unsound`) is replayable — so we extend, not reinvent.

Proposed: add an `allowedTools` first-party caveat (`=` only, value = the tier's
safe set) and a `trustTier` caveat. The spawn mints a macaroon caveated to
`gate.safeTools`; the gate verifies it before any tool call. Because caveat
soundness for the new fields is *not yet* in the ProVerif model, this is gated
behind: (a) extend the model, (b) Rust kernel is the only verifier — **no weaker
TS fallback** (defeats *caveat omission via TS fallback*).

---

## 7. Adversarial log (red ↔ shore-up)

### Round 1 — red team (2 independent passes) + external research

Phase-1 audit confirmed 2 CRIT (SSRF, path traversal) + symlink flood + 4 HIGH/MED.
Design audit produced 16 attacks. External research (OWASP LLM Top-10 2025,
CaMeL, dual-LLM, macaroons, AgentDojo/InjecAgent, NeuroTaint) established the
governing truth: **prompt-level defenses are probabilistic and broken by adaptive
attacks; only architectural defenses (least-privilege tool gating, allowlists,
capability credentials, dual-LLM, human gates) are sound.**

### Round 2 — shore-up (this PR) and what each mitigation defeats

| # | Attack | Severity | Mitigation | Status / evidence |
|---|---|---|---|---|
| 1 | Webhook relay laundering (transport≠content) | CRIT | classify by content source; HMAC never upgrades tier | **FIXED** · `fleet-trust.test.js` "defeats webhook-relay-laundering" |
| 2 | Prompt-injection → tool abuse | CRIT | `allowedTools ⊆ safeSet(tier)`, anon = read-only | **FIXED** · `fleet-trust.test.js` "defeats injection-tool-abuse" |
| 3 | "No restriction + untrusted = full" | CRIT | absent tools = deny for non-trusted tiers | **FIXED** · test "defeats absent-allowedTools-means-full" |
| 4 | Silent approval bypass (blacklist/typo tier) | CRIT | whitelist trusted tiers, fail closed | **FIXED** · test "defeats silent-approval-bypass" |
| 5 | Unicode/case/glob tool bypass | HIGH | NFC+lowercase+base-capability normalization | **FIXED** · `fleet-trust.test.js` normalize block |
| 6 | Webhook output SSRF (metadata/loopback/obfusc IP) | CRIT | `assertSafeOutboundUrl` | **FIXED** · `fleet-url-guard.test.js` (15 vectors) |
| 7 | File output path traversal / abs / symlink | CRIT | `containPath` + realpath + sensitive denylist | **FIXED** · `fleet-path-guard.test.js` |
| 8 | Sensitive write inside home (`~/.ssh`, LaunchAgents) | HIGH | sensitive-segment denylist | **FIXED** · test "defeats sensitive-subpath-write" |
| 9 | Macaroon caveat omission via weak TS fallback | CRIT | Rust-only verifier, no weak fallback | **DESIGN** (§6) |
| 10 | Outbox event forgery → downstream escalation | CRIT | sign outbox events; consumers verify | **PROPOSED** (L3) |
| 11 | Approval fatigue / rubber-stamp | CRIT | per-operator approval rate-limit; escalating confirm; auto-deny storm | **PROPOSED** |
| 12 | Git-hook hijack → INTERNAL escalation | CRIT | classify hook-fired git as external until blessed | **PROPOSED** (tier refinement) |
| 13 | MCP runtime tool loading past spawn-time gate | HIGH | gate every tool call, not just spawn (`toolAllowedForTier`) | **PARTIAL** (primitive exists; per-call wiring proposed) |
| 14 | Multi-turn / 2nd-order injection via tool output | HIGH | taint labels through turns; re-frame tainted data | **RESIDUAL** (§10) |
| 15 | Idempotency-key collision / stale-SHA leapfrog | MED | content-hash + headSha in key; revalidate at exec | **PROPOSED** (L2) |
| 16 | Trust-drift / stale assurance score | MED | timestamp every scan; auto-rescan on change | **PROPOSED** (§8) |

---

## 8. Operator assurance — how we *prove* it's safe (see §9 too)

No single artifact proves safety; assurance is layered:

1. **Sound-by-construction core.** The trust gate is pure and deterministic;
   its guarantees are structural (allowlist, fail-closed), not model-behavioral.
2. **Adversarial test corpus as evidence.** Every red-team attack maps to a named
   test (§7). The test name *is* the claim. CI green = those attacks are defeated.
   Plan to import AgentDojo/InjecAgent vectors into a recurring gauntlet.
3. **Formal methods where they pay.** Macaroon discharge is ProVerif-verified;
   extend the model to the new tool/tier caveats before shipping §6.
4. **Runtime verification + audit.** Every trust-gate refusal and approval is an
   append-only, signed audit event (defeats *audit erasure*). An async monitor can
   interrupt before irreversible side effects.
5. **Honest dashboards (digest-with-zoom).** Any "safe" score shows its scan
   timestamp and links to the underlying evidence; never a bare green light
   (defeats *trust drift / false assurance*).
6. **Stated residuals.** §10 names what is *not* yet defeated, so green never
   over-claims.

---

## 9. Decision

1. Land the Phase-1 hardening (SSRF + path guards) now — it fixes live exploits.
2. Land `lib/fleet/trust.ts` as the trust gate primitive (done, tested) and wire
   it into `fleet-engine.ts` **before** the Phase-2 webhook receiver. This is a
   **hard dependency of Phase 2**.
3. Build L2 (queue + approval) and L3 (signed outbox) before Phase-4 inbound
   email/SMS.
4. Extend macaroons (§6) with ProVerif coverage before relying on cryptographic
   tool enforcement.

---

## 10. Residual risks (explicitly not yet closed)

- **2nd-order / multi-turn injection** (#14): probabilistic at the prompt layer.
  Sound fix is a **dual-LLM / CaMeL** split (quarantined parser never holds
  tools). Tracked as the major architectural follow-up.
- **DNS rebinding** past the SSRF literal guard: needs resolve-and-pin at the
  socket; allowlist-only mode is the interim sound option.
- **TOCTOU** between path realpath-check and write: needs `O_NOFOLLOW` open under
  a confined root.
- **Malicious same-UID agent**: out of scope per ADR-0050 honesty — needs a
  separate UID/VM + forced egress.
- **Per-tool-call gating for runtime-loaded MCP tools** (#13): primitive exists;
  enforcement must move into the agent runtime's tool dispatch.

---

## 11. Consequences

- **Positive:** untrusted ingress (Phase 2/4) becomes safe to wire; two live
  exploits closed; a reusable, tested security vocabulary (`trust`, `url-guard`,
  `path-guard`) other surfaces can call.
- **Negative / cost:** external-triggered ships must now declare an explicit
  `allowedTools` or be refused; an approval queue adds operator load (mitigated by
  grouping + rate-limited UI); macaroon extension needs formal work before it's
  load-bearing.
- **Follow-ups:** wire trust gate into the engine; file-trigger guard; consent at
  the bridge; signed outbox; approval UI; macaroon tool caveat + ProVerif.
```
