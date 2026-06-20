# 0087. The Trusted Computing Base — a separate-UID Rust broker is the spine

## Status

Proposed — 2026-06-20

Numbering note: 0086 is the highest ADR on disk; 0087 is the next free number.
**Numbering hygiene is itself broken** and needs a sweep: `0028` is used by three
files, and `0037 / 0039 / 0040 / 0047 / 0057 / 0086` are each used by two. This ADR
does not fix that (an administrative renumber is its own task — see the Matrix), but
records it so the next author doesn't trip on it.

Reconciles (does not supersede): [ADR-0053](0053-out-of-band-enforcement.md) (the
enforcement spine), [ADR-0050](0050-coast-guard.md) (the rent compulsion),
[ADR-0054](0054-release-cadence-and-rust-surface-alignment.md) (kernel-canonical
macaroon), [ADR-0057](0057-unified-distribution.md) (one signed whole).

## Context

We have spent real effort building a **macaroon** discharge gate (a bearer credential
whose authority only ever narrows — Birgisson et al. 2014) and, this week, moving its
keys and the issue-iff-paid decision into the Rust kernel (`pd-anchor`, PR #496). That
is a real brick. But a question forces an honest audit of where it sits:

> Should the Coast Guard, the non-user Unix account, and the other protections be in
> Rust too? (operator, 2026-06-20)

The answer exposes that **two different things get conflated under "in Rust":**

1. **Memory-safety + one canonical implementation** — a property of the *language*.
   It matters most for the crypto and for handling secrets without a GC scraping copies
   out of the heap.
2. **Tamper-resistance** — a property of the *operating system*: a separate process, a
   separate UID, dropped capabilities, a firewall. **Rust buys you none of this.**

Code written in Rust but running in the *same process and UID* as an agent-reachable
daemon is exactly as forgeable as TypeScript: an agent with code-execution in that
process reads its memory, or simply calls `issue_discharge` itself. PR #496 stops the
daemon from *holding* the keys in its own heap — a genuine improvement against key
extraction — but it is **not isolation**.

And there is a sharper problem the macaroon gate alone cannot solve. **The gate is
bypassable today, because the agent still holds the raw `gh` push token.** A gate on
discharges is moot if the holder can just `git push` with the credential directly. The
discharge gate only *bites* once the agent **does not have the raw credential** — which
is exactly what a credential broker (the agent never sees the token) plus forced egress
provides. This is not new doctrine; it is **ADR-0053's existing layering** stated
plainly:

- ADR-0053 already names three layers — *branch protection + push broker*, *credential
  broker*, *separate-UID/VM + `pf` forced egress* — and says only the third "raises the
  boundary to the kernel, removes the ambient credential, forces all egress through the
  meter, and defends the malicious same-UID case."
- ADR-0050 (the **Coast Guard** — `lib/coast-guard/compulsion.ts`, the shipped rent
  evaluator) is explicit that it does **not** defend the malicious same-UID case: *"A
  secret a process can use, it can copy. Real enforcement against this needs a separate
  UID / VM + pf/nftables forced egress."* That is ADR-0050's deferred phase 4.
- ADR-0054 already declares the **Rust kernel (`pd-anchor`) canonical** and the preferred
  runtime via FFI.

So the teeth already have a name in the canon (ADR-0053 Layer 3 / ADR-0050 phase 4). What
has been missing is the recognition that **all of it converges on one object** — and that
object is a process boundary, not a language choice.

## Decision

**The Trusted Computing Base (TCB) is a single, small, separate-UID Rust process.** It is
the same `pd-anchor` kernel ADR-0054 made canonical, run under its own Unix account
(`pd-broker`, distinct from both the operator's UID and the agent's), distributed as a
signed binary (ADR-0057). Everything whose compromise would forge a "yes" lives inside
it; everything else stays outside, untrusted.

### Inside the TCB (the trusted spine)

| Responsibility | Why it must be here |
|---|---|
| **Credential custody** — the `gh` push token, API keys | the agent must never hold the raw credential, or the gate is bypassed. This is the foundation; without it the macaroon gate is advisory. |
| **Macaroon keys + the discharge decision** (PR #496) | the forging material. Already in `pd-anchor`; the separate UID is what makes "the daemon can't read it" true at the OS level, not by convention. |
| **Signed-attestation verification** | the broker mints a credential / discharge only on a rent verdict it can *verify*, not one it is *told* (see below). |
| **Egress ownership** | `pf`/`nftables` force the agent's traffic through the broker, so "use the token directly" is not reachable. |

### Outside the TCB (untrusted, stays in the daemon — and stays in TypeScript)

Rent **policy** (the thresholds in `evaluateLeaseRent`), **facts-gathering** (git state,
notes, claims — a large filesystem/coordination surface we deliberately keep out of the
TCB), the HTTP control plane, grant bookkeeping, the console, FleetBar. None of these
need to be trusted, so **none of them need to be in Rust.** Rewriting the rent
fact-gatherer in Rust would expand the TCB for no security gain and slow the policy
iteration that ADR-0050 depends on.

### The hinge: a *signed* rent attestation

ADR-0050's rent verdict is daemon-computed code. ADR-0053's Layer-1a gate checks live
session state at push time. ADR-0087 refines both: **the daemon computes the rent policy
and emits a signed attestation — "rent paid for session S, as of T" — and the TCB
verifies the signature before it brokers a credential or mints a discharge.** This is the
clean split: **decision in the daemon (where policy iterates), verification in the TCB
(where it can't be forged).** A compromised daemon can still *refuse* to attest (denial,
not forgery) — but it cannot manufacture a "paid" the broker will accept without the
signing key, and the signing key is the TCB's, not the daemon's.

### Rust, restated honestly

The TCB process is Rust because Rust is the right language for memory-safe credential and
key handling and is already the canonical kernel (ADR-0054). But **the security comes from
the UID boundary, not the language.** A Rust TCB in the daemon's process would be theater.
This ADR is therefore as much about `setuid`/`pf`/process-spawn as it is about crates.

## Considered Options

1. **Keep everything in the TS daemon, harden in-band (shims, env scrubbing).** Rejected:
   in-band guards are advisory by construction (ADR-0053) — the agent holds the
   capability, so the verb is always reachable. This is the status quo the whole program
   exists to escape.
2. **Move the rent evaluator + facts-gathering into the Rust kernel too.** Rejected:
   expands the TCB by a large, fast-changing surface (git/coordination fact-gathering) for
   no isolation gain. Policy belongs where it iterates; only the *verdict's
   trustworthiness* matters, and a signature delivers that without importing the surface.
3. **A VM (`Virtualization.framework`) instead of a separate UID.** Stronger isolation,
   but heavier and breaks "the agent edits your live tree" harder (ADR-0050's disclosed
   tension). Keep as the high-assurance option; the separate-UID account is the
   pragmatic first boundary and the same code targets both.
4. **Chosen: one separate-UID Rust broker as the TCB**, holding credentials + keys +
   egress + attestation-verify; daemon outside it, signing verdicts. Smallest TCB that
   actually removes the ambient credential and defends the same-UID case (ADR-0053 Layer
   3 / ADR-0050 phase 4), reusing the canonical kernel (ADR-0054) and the signed-artifact
   pipeline (ADR-0057).

## Implementation Matrix (the spine, roadmap-linked)

Cartographer-owned; each phase promotes to a `roadmap_items` row
(`adr-0087-<slug>`). Phase 1 is landed; the rest are sequenced so each is shippable.

| Phase | Slug | Depends on | What ships |
|---|---|---|---|
| 1 | adr-0087-kernel-key-custody | — | **LANDED (PR #496).** `pd-anchor` holds the macaroon keys + the issue-iff-paid decision; keyless custody FFI. Keys leave the daemon's heap. (Not yet isolated — same process.) |
| 2 | adr-0087-daemon-authorize-orchestrator | 1 | daemon `authorize-push` consumes the keyless custody FFI + the pre-push hook blocks on deny. The daemon becomes a thin untrusted orchestrator. (Refines ADR-0053 Layer-1a.) |
| 3 | adr-0087-signed-rent-attestation | 2 | the daemon signs the rent verdict; the kernel verifies the signature before issuing. Removes "the daemon asserts paid". (Refines ADR-0050 phase 7.) |
| 4 | adr-0087-credential-broker | 3 | the TCB holds the `gh` push token / API keys; the agent gets a brokered, scoped, short-lived credential or none. **The foundation that makes the gate bite.** (= ADR-0053 Layer 1+2, unified into the TCB.) |
| 5 | adr-0087-separate-uid-account | 4 | run the broker as the `pd-broker` Unix account; drop the agent UID's ability to read its memory / signal it. (= ADR-0053 Layer 3 / ADR-0050 phase 4.) |
| 6 | adr-0087-pf-forced-egress | 5 | `pf`/`nftables` rules force the agent's egress through the broker; "use the token directly" becomes unreachable. |
| 7 | adr-0087-tcb-broker-signed-artifact | 5 | build/sign/notarize the broker binary + add it to the `latest.json` feed. (Extends ADR-0057 phase dist-update-channel — the broker is another signed limb of the one whole.) |
| 8 | adr-0087-vm-isolation-optional | 6 | optional high-assurance variant: `Virtualization.framework` instead of a bare UID. Same broker code. |
| — | adr-numbering-audit | — | administrative: renumber the duplicate ADRs (0028×3, 0037/0039/0040/0047/0057/0086×2). Not architectural; tracked so it isn't lost. |

## Consequences

- **Positive:** one coherent TCB instead of scattered, individually-bypassable checks; the
  macaroon work (PR #496) becomes load-bearing instead of advisory once the credential is
  brokered; the canon (0053/0050/0054/0057) composes into a single object rather than four
  partially-overlapping layer lists; the trust boundary is finally an OS fact, not a
  convention.
- **Cost / disclosed tension:** the separate-UID/VM boundary **breaks "the agent edits
  your live working tree"** — the same tension ADR-0050 disclosed at its phase 4. This is
  real and must be opt-in per-project, not forced. The broker is a new signed binary to
  maintain and a new process to supervise.
- **What this does NOT claim:** until phases 4–6 land, the gate is still bypassable (the
  agent holds the token). Phase 1 (done) and phases 2–3 harden the *discharge* path but do
  not remove the *ambient credential* — that is phases 4–6, and the honesty of this whole
  program depends on not overclaiming before then.
- **Operator-owned:** the `pd-broker` UID creation, the `pf` rules, and the per-project
  opt-in are privileged actions the operator authorizes; the agent cannot self-provision
  them (that would defeat the point).

## References

- ADR-0053 — out-of-band enforcement (the 3-layer spine this concretizes).
- ADR-0050 — the Coast Guard (rent compulsion; its phase 4 is this ADR).
- ADR-0054 — kernel-canonical macaroon (the TCB process is this kernel).
- ADR-0057 — unified distribution (the broker is another signed artifact).
- `core/kernel/pd-anchor/src/keystore.rs` — phase 1, lands with PR #496. <!-- cite-exempt: arrives on main with PR #496, in the merge queue ahead of this ADR -->
- `lib/coast-guard/compulsion.ts` — the rent policy that stays outside the TCB and signs
  its verdict.
