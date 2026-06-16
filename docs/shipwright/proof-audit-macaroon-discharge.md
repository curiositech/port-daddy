# Proof Audit — Macaroon Discharge Gate (red-team round, 2026-06-15)

**Persona:** `proof-gap-auditor` · **Target:** ADR-0053 macaroon discharge gate /
Single-Writer-Kernel "trust-boundary caveat" / `pd-anchor::macaroon`.

## The probe

```
target:    ADR-0053 §"per-hop verification" + every pd-anchor::macaroon module
           header + ADR-0054 §"kernel-canonical" + lib/macaroon/* TS headers.
claim:     "Verification is per-hop ... the naive final-vs-root verifier is
           unsound — proven on branch `defense/anchor-attenuation-soundness` in
           ProVerif — which is why verify() recomputes the chain hop by hop."
           (verbatim from core/kernel/pd-anchor/src/macaroon.rs and the TS twin)
status:    PARTIALLY MECHANIZED — the citation conflates two mechanisms.
artifact:  analyses/harbor_card_v5_attenuation.pv, _v6_multihop_attack.pv,
           _v7_multihop_fixed.pv  — these model HARBOR-CARD capability-subset
           attenuation (Ed25519-signed cards, is_subset per hop). `grep -c`
           for discharge / caveat_key / prepare_for_request / third_party in
           v7 = 0. They do NOT model the macaroon construction the code ships:
           the HMAC chain, the third-party HMAC-COMMITMENT vid, the discharge
           macaroon, or the request-binding HMAC(BIND0, root_sig||discharge_sig).
gap:       a ProVerif model of the macaroon discharge construction itself.
priority:  HIGH — the citation is load-bearing in ADR-0053, the macaroon module
           headers (both runtimes), and the kernel-canonical decision (ADR-0054).
```

## Why this is a real gap, not pedantry

The harbor-card proofs are sound and load-bearing **for cards** — `is_subset`
per-hop attenuation, the v6→v7 "naive final-vs-root is unsound" result. But the
macaroon discharge gate is a **different mechanism**: cards prove *who you are*
via Ed25519 + capability subset; macaroons gate *what a push may do, while rent
is paid* via an HMAC chain with a third-party caveat discharged by a second
macaroon. The security-critical, novel parts of the macaroon gate —

1. the third-party **vid as an HMAC commitment** (`vid = HMAC(chain_sig, caveat_key)`),
   realigned from AES-GCM sealing **this very session** (#402), and
2. the **request-binding** (`HMAC(BIND0, root_sig || discharge_sig)`) that stops a
   discharge being replayed against a different grant —

were **never modelled**. Citing the card proof for them is overclaiming. (The
overclaim was introduced by the same session that shipped the construction; this
audit corrects it rather than letting it ride.)

## What this round closed

`analyses/macaroon_discharge_v1.pv` (new) models the actual construction in the
symbolic model: HMAC as a public one-way keyed PRF, the daemon's grant chain
(root HMAC → first-party caveat → third-party HMAC-commitment vid → fold), the
discharge macaroon keyed by `caveat_key`, and the `prepare_for_request` binding.
Two grants (A, B) run with their own keys, under an active Dolev-Yao attacker who
sees every public grant and discharge.

**Q1 — unforgeability + binding:**
```
query event(RelayAuthorizes(s)) ==> event(DaemonIssuesDischarge(s)).
RESULT  ... is true.
```
The relay authorizes a grant **only if** the daemon issued a discharge bound to
that exact grant signature. The attacker cannot (a) forge a discharge without
`caveat_key`, nor (b) transfer grant A's discharge to grant B (the binding ties
it to A's signature). This is the load-bearing soundness property of the shipped
construction, now machine-checked.

## What the white-hat round closed (Q2)

The `defense:proofs` obligation named below as "Q2" was answered **in the same
exchange** by the `whitehat-defense` / `proof-completer` persona:
`analyses/macaroon_discharge_v2_naive_unsound.pv` (new) models a verifier that
accepts a well-formed discharge **without** checking the `prepare_for_request`
binding, with two grants (LOW, HIGH) that **share** the rent caveat key (the
realistic case — one live session backs every grant minted under it). The daemon
discharges only LOW; the attacker replays LOW's discharge against the public HIGH
grant.

```
query event(RelayAuthorizesNaive(s)) ==> event(DaemonIssuesDischarge(s)).
RESULT  ... is false.   (* attack reconstructed *)
```

The naive relay **authorizes** the HIGH grant although the daemon never discharged
it. This is the macaroon analogue of the card v6→v7 result and **directly justifies
the per-hop binding check** the correct verifier (v1) performs — v1's `RelayPerHop`
rejects exactly this trace because the binding ties the discharge to LOW's signature,
not HIGH's.

## Residual gap (remaining → `defense:proofs`)

- **First-party caveat soundness** (a push to `main` is never authorized despite
  a valid discharge) — structurally similar to the card `is_subset` result but
  not yet modelled for the macaroon chain.
- **Multi-discharge / depth-bound** interaction (MAX_DISCHARGE_DEPTH) — unmodelled.

## Disposition

- `proof:landed` — macaroon_discharge_v1.pv (Q1 TRUE) +
  macaroon_discharge_v2_naive_unsound.pv (Q2 FALSE, attack found). Re-runnable:
  `~/.opam/pd-proverif/bin/proverif analyses/macaroon_discharge_v1.pv` and the v2
  file.
- The cited claims in ADR-0053 + `pd-anchor::macaroon` + `lib/macaroon` are
  corrected in this round (see the accompanying diff): they now cite the card
  proof for the per-hop *discipline*, `macaroon_discharge_v1.pv` for the discharge
  unforgeability/binding (Q1), `macaroon_discharge_v2_naive_unsound.pv` for the
  per-hop-vs-naive regression (Q2), and name the remaining residual gap honestly.
