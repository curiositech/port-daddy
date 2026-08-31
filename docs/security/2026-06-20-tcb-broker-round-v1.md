# TCB Broker Red-Team / White-Team Round v1 — Dialogue Artifact

- **Status:** Closed — 2026-06-20
- **Round:** v1
- **Closed by:** sec-eng-lead (redteam-review + whitehat-defense)
- **Targets under review:**
  - The credential broker on branch `feat/tcb-credential-broker` (the Phase-4 TCB slice; source not yet on `main`, so all `core/pd-broker/...` and `core/kernel/pd-anchor/...` citations below name the branch and are marked not-yet-shipped relative to this doc's landing branch).
  - The macaroon custody kernel landed as **PR #496** (`feat/kernel-key-custody` → in-kernel key custody; not yet shipped on `main`).
  - **ADR-0087** (`docs/adr/0087-trusted-computing-base-broker.md`, on branch `docs/tcb-spine-adr`; PR #500; not yet shipped on `main`), Status *Proposed*.

> This is a **reference** artifact (Diátaxis reference mode): it is a lookup table of every finding, its adjudication, and its disposition. It does not teach the broker architecture (that is ADR-0087's job) and it does not narrate a fix (that is each follow-on PR's job).

---

## 1. Round summary

Twenty-four red-team findings were filed against the credential broker, the macaroon custody kernel, and ADR-0087, then adjudicated by the white-hat defense. Two findings are **confirmed-fix-before-merge** — both availability defects in the broker's single-threaded, unbounded, no-timeout socket read path (`broker-slowloris-self-dos`, `broker-unbounded-readline-mem-dos`) that let one same-UID connection wedge or OOM the credential-minting spine; their fixes are cheap, local, and independent of the unbuilt isolation phases. Seven findings are **confirmed-defer**: each names a real property gap (within-window discharge replay, rent-lapse lag, restart-non-revocation, daemon-asserted "paid" verdicts, self-reported clocks-of-economics) that the code and ADR-0087 *already disclose* as the job of unbuilt Phases 3–6, and whose true fix requires the OS-level **separate-UID** boundary that has not been built. Ten findings are **refuted** with reproduced evidence — discharge unforgeability, the no-leak wire invariant, revoke atomicity, empty-store fail-closed, server-clock freshness, the ProVerif binding, and four documentation-overclaim hypotheses all held under direct probing. The remaining five are **partial**: real latent defects (ref-canonicalization of the protected-branch deny, ticket-scope-from-unverified-ctx, non-finite spend ceilings, stale-socket double-start, silently-honored spend caveats) that are cheap defense-in-depth but do not block the currently-landing PRs because no exploitable consumer ships in them. The honest posture across the whole round: the secret-confidentiality and unforgeability invariants the broker actually claims at this phase **hold and are tested**; the gate is **same-process, not separate-UID**, and does not bite until the egress layer lands.

---

## 2. Findings → verdict → disposition

| # | Finding | Severity | Verdict | Disposition |
|---|---------|----------|---------|-------------|
| 1 | `protected-branch-deny-canonicalization-bypass` | high | partial | Defer + harden — real latent defect; sole exploit path is unwritten Phase-2 code. Land canonicalization before Phase-2 wires a caller. |
| 2 | `ticket-scope-from-unverified-ctx` | medium | partial | Defer + harden — ticket `branch` reflects client claim; no consumer trusts it until Phase 5–6 redemption. Cheap defense-in-depth before phase-5 wiring. |
| 3 | `ticket-forgery-and-key-separation` | info | confirmed-defer | No code change this branch; redemption-layer PR must gate on `TicketSigner::verify`. |
| 4 | `discharge-forgery-cross-grant-replay` | info | **refuted** | Discharge unforgeable + request-bound; matches ProVerif v1 Q1=true. |
| 5 | `spend-usd-float-edge` | info | partial | Defer + harden — fail-open directions closed; non-finite ceiling = self-attenuation no-op. Add `is_finite` guard for decision-parity. |
| 6 | `broker-slowloris-self-dos` | high | **confirmed-fix-before-merge** | **MUST-FIX** — read timeout + per-connection thread. |
| 7 | `broker-unbounded-readline-mem-dos` | high | **confirmed-fix-before-merge** | **MUST-FIX** — cap the read, add timeout, thread the accept loop. |
| 8 | `broker-stale-socket-takeover` | high | partial | Defer + harden — same-UID takeover is the deferred threat model; residual is benign double-start self-DoS. Add connect-probe + flock. |
| 9 | `broker-parent-dir-forced-chmod-0700` | low | **refuted** | Tightens perms; state-dir convention is already 0700. No confidentiality break. |
| 10 | `broker-concurrency-store-corruption` | info | **refuted** | Store write-once; serving is single-threaded; no corruption path. |
| 11 | `discharge-replay-in-window` | medium | confirmed-defer | TTL-bounded bearer is the designed semantic; single-use is declared Phase-4 work. Same defect as same-UID copy → needs the UID wall. |
| 12 | `stale-discharge-outlives-rent-lapse` | medium | confirmed-defer | Verdict is point-in-time "as of T"; per-request re-check is Phase 2–3; `ttl_ms` is caller-tunable today. |
| 13 | `restart-no-ticket-revocation-and-nonce-reset` | low | confirmed-defer | TTL-bounded bearer with no revocation is the documented shape; nonce-epoch hardening is cheap follow-on. |
| 14 | `revoke-toctou` | info | **refuted** | Surface does not exist on any branch (kernel custody is pending task #31); Mutex serializes correctly where it does land. |
| 15 | `empty-store-fail-closed` | info | **refuted** | Empty/foreign store fails closed: "unknown grant" / "no discharge key" / vid mismatch. |
| 16 | `discharge-freshness-clock-injection` | info | **refuted** | No client clock on the wire; one server clock for grant + discharge; fails closed when unset. |
| 17 | `adr0087-tcb-framing-vs-status` | low | **refuted** | Status is *Proposed*; body disclaims isolation; lib.rs "Phase 4, the TCB slice" is literally correct. |
| 18 | `broker-no-leak-test-bites` | info | **refuted** | No-leak test bites: two sabotages reproduced 5 / 2 failures. Not theater. |
| 19 | `adr0087-no-proverif-overclaim` | info | **refuted** | Zero proof claims in ADR or crate; underlying proofs reproduce; broker calls the sound v1 verifier. |
| 20 | `keystore-keys-never-cross-ffi-scoped` | low | **refuted** | The claim is scoped to kernel-generated keys, which never cross; the verify path's keys are caller-supplied parity inputs. |
| 21 | `adr0087-load-bearing-honestly-scoped` | info | **refuted** | "Load-bearing" is gated on `once`; Phase-3 attestation is consistently future-tense. |
| 22 | `rent-verdict-forge-by-assertion` | high | confirmed-defer | Daemon-asserted "paid" is the disclosed Phase-3 gap; deny-not-forge is the signed-attestation target, not a present property. |
| 23 | `discharge-ttl-replay-no-epoch-binding` | medium | confirmed-defer | Within-TTL multi-push replay survives Phase-3 signing; closing it needs rent-epoch binding or the UID wall. Documented design choice. |
| 24 | `self-reported-spend-ceiling` | medium | partial | Defer the egress meter (Phase 6); **strongly recommend** failing closed on `spend_usd` caveats now to avoid a false-assurance trap. |

---

## 3. MUST-FIX before merge

Only the two **confirmed-fix-before-merge** items, ordered by severity (both high). Both are availability defects on the broker's socket read path; both fixes are local to `core/pd-broker` and do **not** depend on the unbuilt separate-UID layer.

### 3.1 `broker-unbounded-readline-mem-dos` (high)

**What breaks.** On `feat/tcb-credential-broker`, the per-request read in `read_one_request` (`core/pd-broker/src/transport.rs`, not yet shipped on `main`) allocates an empty `String` and calls `reader.read_line(&mut line)` with **no length cap**, so an unterminated line grows broker RSS 1:1 with attacker bytes until OOM. The accept loop in `run()` (`core/pd-broker/src/main.rs`, not yet shipped) calls `serve_connection` **inline** (single-threaded, no `thread::spawn`), so the same unterminated line also wedges the entire broker before OOM. A reproduced rustc probe grew the `String` to exactly 52,428,800 bytes on a 50 MB unterminated stream.

> **fail-closed** (Saltzer & Schroeder, *The Protection of Information in Computer Systems*, 1975): when a mechanism cannot complete safely it must deny, not silently proceed. An unbounded read that never returns is the opposite — it neither completes nor denies.

**Patch spec.**

- **Files:** `core/pd-broker/src/transport.rs`, `core/pd-broker/src/main.rs` (both on `feat/tcb-credential-broker`; not yet shipped).
- **Change:** (1) Add `const MAX_REQUEST_BYTES` (e.g. `256 * 1024`) and read through a capped reader: `reader.take(MAX_REQUEST_BYTES as u64).read_line(&mut line)`; if the cap is hit without a trailing `\n`, return `InvalidData` so `serve_connection` emits a `BadRequest` rather than parsing a partial. (2) Add a per-connection read timeout: after `stream.set_nonblocking(false)`, call `stream.set_read_timeout(Some(Duration::from_secs(10)))`; treat `WouldBlock`/`TimedOut` as a clean connection-close. (3) Move `serve_connection` into a `std::thread::spawn` (wrap the `Mutex<Broker>` in an `Arc`), bounded by a small connection counter (e.g. N=64) so threads are not themselves an unbounded-spawn DoS.
- **Test:** `oversized_unterminated_line_is_rejected_not_buffered` (cap fires → `InvalidData`, no unbounded grow); `read_line_buffer_never_exceeds_cap`; an integration test under `tests/` that writes 512 KB with no newline on one connection and asserts a **second** concurrent connection still gets a `Pong` for a `Ping` within a short deadline (regression for the inline-blocking-accept defect). All run under the real binary.

### 3.2 `broker-slowloris-self-dos` (high)

**What breaks.** The same single-threaded accept loop + no read timeout means one half-open connection that never sends a newline parks the only serving thread forever. Reproduced: baseline `Ping` → `Pong` in 37 ms; with one attacker holding `{"type":"pin` (no newline), a second legitimate client's `Ping` timed out after 3 s. One local connection, zero auth, total availability kill of the spine.

**Patch spec.**

- **Files:** `core/pd-broker/src/main.rs` (on `feat/tcb-credential-broker`; not yet shipped).
- **Change:** Resolved by the same two mechanisms as 3.1 — a per-connection read timeout (so a half-open client cannot pin the reader) **plus** moving `serve_connection` off the accept thread (so a stalled client is isolated to its own thread). The two findings share one fix; landing 3.1's transport hardening closes both.
- **Test:** Slowloris regression — a held half-open connection must not block a second client's `Ping` → `Pong` within a short deadline (same integration test as 3.1, point (b)).

> Both fixes are independent of the unbuilt **separate-UID** account (ADR-0087 Phase 5). They harden availability of fail-closed security code that is landing now; there is no reason to merge known-unbounded-blocking I/O into the credential spine.

---

## 4. Confirmed-defer

Each item is a real property gap that the code and/or ADR-0087 already disclose as the job of an unbuilt, correctly-sequenced phase. Deferral is safe because (a) the landing PRs do **not** overclaim the deferred property, and (b) the true fix requires a phase that is explicitly operator-gated and not in scope for these merges.

| # | Finding | Why it is safe to defer | Closing phase |
|---|---------|-------------------------|---------------|
| 3 | `ticket-forgery-and-key-separation` | Ticket unforgeability + three-key separation both hold; `TicketSigner::verify` has zero non-test callers, so nothing trusts a forged ticket today. The only residual is a forward-looking requirement on an unbuilt consumer. | ADR-0053 Phases 5–6 (redemption layer) must gate the secret swap on `TicketSigner::verify`. |
| 11 | `discharge-replay-in-window` | A TTL-bounded **bearer credential** (Birgisson et al., *Macaroons*, 2014) is the *designed* semantic; unlimited reuse within the window is the same property as the disclosed same-UID copy-within-window. A nonce-consumed set without the UID wall is defense theater — a same-UID holder reads the set and the keys. | Single-use redemption (Phase 4, on the ticket nonce) + separate-UID confinement (Phases 5–6). |
| 12 | `stale-discharge-outlives-rent-lapse` | The verdict is a point-in-time "rent paid as of T" attestation, not a continuous check; `ttl_ms` is caller-supplied and tunable to seconds today, and the daemon can re-issue per pre-push. PR #496 makes no live-compulsion claim. | Per-request rent re-check = Phase 2 (daemon authorize-push) + Phase 3 (signed attestation). |
| 13 | `restart-no-ticket-revocation-and-nonce-reset` | TTL-bounded bearer tokens with no revocation and no de-dup store is the documented, intentional shape of this phase; the consuming single-use store does not exist yet, so there is no contract to violate. | Revocation / separate-UID layer (tasks #10/#33). Nonce-epoch hardening is a cheap optional follow-on. |
| 22 | `rent-verdict-forge-by-assertion` | An in-process daemon supplying a bare `RentVerdict::Paid` is named *verbatim* in ADR-0087's Context as the attack Phase 3 closes; the kernel module doc lists it as an explicit follow-on. "Deny not forge" is the signed-attestation **target**, not a present property of PR #496. | Phase 3 (signed rent attestation the kernel verifies) + Phase 5 (separate-UID). |
| 23 | `discharge-ttl-replay-no-epoch-binding` | Within-TTL multi-push replay is metered per-window by design (`DISCHARGE_TTL_MS`); crucially it **survives** Phase-3 signing (signing authenticates *who/when-issued*, not *which push*), which the patch flags as a doc-precision item — but no current code overclaims single-use. | Rent-epoch / counter binding (depends on Phase 3) or the separate-UID wall. |
| — | `signing-key-custody-circularity` (`signing-key-custody-circularity`) | The daemon→TCB split is purely notional at Phase 1: same address space, same `Mutex<HashMap>`, same ability to call `issue_discharge`. The ADR discloses this three times ("a Rust TCB in the daemon's process would be theater"). The implied fix is the not-CI-testable Phases 3 + 5. | Phase 3 (signed attestation) + Phase 5 (separate-UID kernel process). |

> All deferred items are tracked by the existing kernel-slice tasks: Phase 2 = daemon authorize-push route; Phase 3 = signed rent attestation; Phase 5 = separate-UID kernel process. The honesty of the program depends on **not** treating any of these as delivered before its phase lands.

---

## 5. Refuted

Each refutation was confirmed by direct code-reading and/or a reproduced probe against the actual branch — not by trusting the red-team harness.

| # | Finding | Refuting evidence |
|---|---------|-------------------|
| 4 | `discharge-forgery-cross-grant-replay` | `verify_inner` rebuilds the third-party vid commitment `hmac(sig, caveat_key)` per hop and ct-checks `hmac(BIND_KEY, root_bound_sig \|\| sig)`; appended caveats advance the signature so the tag mismatches; `MAX_DISCHARGE_DEPTH=16` backstops cycles. ATTACK 2's only "authorizing" precondition (identical caveat_key + rent id across grants) is unreachable — `issue_grant` draws fresh 32-byte caveat_key + 8-byte nonce per grant. ProVerif `core/kernel/pd-anchor/formal/proverif/macaroon-discharge/macaroon_discharge_v1.pv` (on the branch; not yet shipped on `main`) Q1 = true under an active attacker; the naive v2 model returns false (and the shipped code does **not** use it). |
| 9 | `broker-parent-dir-forced-chmod-0700` | The chmod **tightens** perms (the intended TOCTOU mitigation); the daemon's own state-dir convention is already 0700 (`mkdir(..., { mode: 0o700 })` across `lib/blob.ts`, `lib/ui-preferences.ts`, `lib/tube.ts` — cited from the broker branch, not yet shipped on `main`), and the live `~/.port-daddy` is `drwx------`. The probe manufactured the 0755 precondition. Group/other traversal of that dir would itself be a confidentiality bug. |
| 10 | `broker-concurrency-store-corruption` | `caveat_keys` is populated once in `Broker::new` and read only via `.get(id).cloned()` (no `insert`/`remove`/`get_mut`/`entry`); serving is strictly single-threaded (zero `thread::spawn`/`tokio`/`async`), so the `Mutex<Broker>` is never contended. The forward-looking `.expect("broker mutex poisoned")` poison-DoS is strictly conditional on the unbuilt threading refactor. |
| 14 | `revoke-toctou` | The named surface does not exist <!-- cite-exempt: these paths are absent from every branch; that absence IS the refutation -->: `core/kernel/pd-anchor/src/keystore.rs` and `tests/redteam_replay.rs` are absent from every remote branch, and no `revoke`/`authorize`/`with_store` symbol exists in `pd-anchor`. In-kernel key custody is task #31, pending. The probe describes a run against uncommitted code. |
| 15 | `empty-store-fail-closed` | Self-minted-never-stored grant → "unknown grant"; known id under foreign root → signature mismatch; forged discharge under wrong caveat key → vid commitment mismatch. Broker path resolves caveat keys only from its own config map → empty map → "no discharge key" → `Refused`. Locked by `unknown_caveat_key_revokes_authorization` and `cross_grant_discharge_replay_yields_refusal` (on the branch; not yet on `main`). |
| 16 | `discharge-freshness-clock-injection` | `RequestCtx` carries no `now_ms` field — there is no client clock on the wire. The broker injects one server clock from `pd_core::now_ms()` and reuses the **same** `check` closure for the recursive discharge verification, so grant and discharge share one clock. `expires` fails closed when the clock is unset. Locked by shipped `expired_discharge_replay_yields_refusal` + `stale_discharge_fails_after_ttl`. |
| 17 | `adr0087-tcb-framing-vs-status` | Status line is "Proposed — 2026-06-20"; the body says "a Rust TCB in the daemon's process would be theater" and "What this does NOT claim: until phases 4–6 land, the gate is still bypassable"; the Matrix marks only Phase 1 LANDED and annotates it "Not yet isolated — same process." The lib.rs "Phase 4, the TCB slice" label is literally correct per the Matrix. The red-team's own probe calls the body "the most honest disclaimer I have audited." |
| 18 | `broker-no-leak-test-bites` | Two independently-reproduced sabotages: folding the secret into a reachable `Refused.reason` → 5/10 tests failed including the dedicated one; stuffing it into `scope.session` → 2 failed through the serialized ticket. The test asserts over `serde_json::to_string(resp)` of the whole response and checks the distinctive `ghp_` fragment across all four outcomes — a genuine, reachability-sensitive assertion, not a type-system tautology. |
| 19 | `adr0087-no-proverif-overclaim` | Grep of ADR-0087 and all six broker `.rs` files for `proverif\|q1\|q2\|mechaniz` returns zero. The macaroon proofs reproduce (Q1 true / v2-naive false), and the broker's verify path computes `HMAC(BIND0, grant_sig \|\| discharge_sig)` — the **sound** v1 construction, with `unbound_discharge_is_rejected` guarding the v2 break. There is no proof claim to inflate. |
| 20 | `keystore-keys-never-cross-ffi-scoped` | The module-doc claim is textually scoped to "the root and caveat keys **for every push grant**" — exactly the `rand_bytes(32)` keys `issue_grant` retains in the process-global store, which return only `(Macaroon, String)` and never cross. `pd_macaroon_verify_json`'s caller-supplied `root_key_hex`/`caveat_keys` are independent parity-vector inputs for the deprecated TS byte-parity fallback; `ffi.rs` already disambiguates the two surfaces in-code. |
| 21 | `adr0087-load-bearing-honestly-scoped` | "the macaroon work (PR #496) becomes load-bearing … **once** the credential is brokered" — the `once` clause conditions it on Phase 4 (unbuilt). The signed-attestation passage lives in the Decision as a proposal; the Matrix marks only Phase 1 LANDED; the "What this does NOT claim" bullet states the gate is bypassable until Phases 4–6. The ADR pre-empts the overclaim rather than committing it. |

---

## 6. Honest posture

What the broker **does** defend, today, on the landing branches: the **raw gh push token never crosses the socket** — `SecretVault` has no `Serialize` derive, a redacting `Debug`, and no response-reachable getter, and the only success payload is a scoped, HMAC-signed `CapabilityTicket` (proven non-vacuously by `raw_secret_never_appears_in_any_response`). The macaroon discharge is **unforgeable and request-bound** — a holder lacking the caveat key cannot mint or transplant a discharge, and the per-hop binding matches a machine-checked ProVerif model (Q1 = true). The three signing keys (secret, macaroon root, ticket) are **distinct and never derived from each other**. Empty/foreign stores **fail closed**, freshness uses a **server clock** the client cannot rewind, and `revoke()` atomically drops a grant's root key.

What the broker **does NOT yet defend**: it is **same-process, same-UID, not separate-UID**. ADR-0087's own framing is that the trust boundary is the UID, not the language — "code written in Rust but running in the same process and UID as an agent-reachable daemon is exactly as forgeable as TypeScript." A same-UID attacker can read the in-process key store, exec its own broker with its own keys, or simply `git push` with the ambient token, so the gate is **fully bypassable** until the egress layer (Phases 5–6) forces all pushes through the broker. Concretely: the daemon can still **assert** "rent paid" without paying (Phase-3 signed attestation unbuilt); a paid discharge is a **bearer pass replayable for its whole TTL** and outlives a mid-window rent lapse; a broker restart is **not** a revocation event; and any `spend_usd` economic ceiling is **self-reported by the metered party** with no ground-truth meter. The gate **bites only after the egress layer**; until then this round defends confidentiality and unforgeability of the credential, not OS-level isolation or live economic compulsion — and that scoping is stated plainly so no downstream doc mistakes PR #496 for delivering the wall.
