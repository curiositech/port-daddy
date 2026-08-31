# Cryptoeconomic Security — five attack classes, and which the wedge masks

**Layer.** L3 — *the market between operators* — of the Port Daddy North Star
(**ADR-0048**, `docs/adr/0048-what-port-daddy-is.md`). This doc scores Port Daddy
against the five canonical **cryptoeconomic** attack classes (*attacks where the
adversary's leverage is economic — fake identities, transaction ordering, corrupted
verdicts — not a buffer overflow*), and shows that **single-operator deployment
masks three of them for free**, leaving two live threats with concrete fixes.

**Audience.** A software engineer with a working math/CS background. Every term is
defined on first use.

**Honesty discipline (ADR-0045).** **[BUILT]** = on `origin/main`. **[DESIGNED]** =
accepted ADR, no merged code. **[VISION]** = argued, unspecified.

---

## Scorecard — the five attack classes vs. Port Daddy

| # | Attack class | One-line definition | Single-operator status | Federated status | Grounded at |
|---|---|---|---|---|---|
| S1 | **Sybil** | One party mints many fake identities to overwhelm a scarcity assumption. | **Masked** — daemon mints identity; the operator owns every box. | **LIVE** — other operators' boxes are in the trust boundary; identity is re-mintable. | ADR-0050 threat model; `game-theory.md` §5.1 |
| S2 | **Front-running** | An adversary observes a pending action and races ahead of it for advantage. | **Masked** — deterministic, collision-free port/claim assignment; one writer. | **Largely masked** — claim-blocking is bounded by bonded preemption. | whitepaper §4 (`Port assignment & Race condition & Deterministic`), §5.5 (bonded preemption) |
| S3 | **Oracle collusion** | The parties who attest "a breach happened" conspire to launder a false verdict. | **Masked** — the only oracle is the operator's own daemon. | **LIVE** — co-owned oracles can 2-of-3 a false settlement. | whitepaper §6.7 (line 850) |
| S4 | **Under-collateralization of high-value harm** (secret-exfil, live-state) | The bond is smaller than the damage, so breaching is +EV. | **LIVE** — `cat .env.local` is total key exfil; no feasible bond covers it. | **LIVE** — same. | whitepaper §6.6 (`\SpecOnly`); ADR-0050; `lib/coast-guard.ts` |
| S5 | **Griefing** | An attacker burns value purely to deny it to others, with no gain to itself. | **LIVE (mild)** — a sandbox-hoarder denies the worktree/commons to peers. | **LIVE** — same, plus bond-denial games. | ADR-0050 Phase 7; `lib/coast-guard/compulsion.ts` |

**One-line grade.** The wedge is *cryptoeconomically cheap*: three of the five
attacks (Sybil, front-running, oracle-collusion) are **structurally absent** when
one operator owns every machine, so the wedge needs no crypto. The two that survive
— under-collateralized high-value harm (S4) and griefing (S5) — each have a
*non-economic* fix already in the tree: **isolation** (the Coast Guard) for S4, and
**compulsion-rent** for S5.

---

## 1. Why single-operator masks three of five

> **The same fact that makes L2 coordination a Nash equilibrium — one operator owns
> every box — makes three of the five cryptoeconomic attacks structurally
> impossible. They are not defended; they cannot arise. This is why the wedge is
> sound without a single line of cryptography.**

The masking is the security-side restatement of `game-theory.md`'s thesis. Three
attacks depend on a property federation introduces and the wedge lacks:

- **S1 Sybil [masked].** A **Sybil attack** [Douceur 2002] needs identities to be
  *cheap to mint and trusted on minting*. Single-operator, the **daemon** mints
  identity and the operator owns every machine, so a hostile identity would have to
  originate *on the operator's own box* — which is ADR-0050's explicit
  out-of-scope: *"intra-fleet, single-operator, not-a-PKI, no defense against a
  hostile process on your own box"* (`docs/adr/0050-coast-guard.md`). There is no
  external party to manufacture Sybils. Federation puts other operators inside the
  boundary and the attack goes live (S1 → LIVE), which is exactly why ADR-0040
  (non-forgeable identity) is an L3 prerequisite.

- **S2 Front-running [masked].** **Front-running** [Daian et al. 2019, "Flash Boys
  2.0"] — *exploiting visibility of a pending transaction by ordering your own ahead
  of it* — needs a contested ordering an adversary can jump. Port Daddy's resource
  assignment is **deterministic and collision-free** (whitepaper §4, *"Port
  assignment: Race condition → Deterministic, collision-free"*): the same semantic
  identity always maps to the same port, so there is no auction to front-run. The
  one residual is claim-blocking (the **F** strategy of the signaling game: claim
  files you will not edit to block a rival), and that is bounded by **bonded
  preemption** (whitepaper §5.5): a blocked agent posts an additional bond — capped
  by cleanup cost — to force release, and the preemptor is slashed if wrong. The
  ordering game is priced, not free.

- **S3 Oracle collusion [masked].** **Oracle collusion** needs *multiple*
  attesters who can conspire. Single-operator, settlement has exactly one oracle —
  the operator's own daemon — so there is no second party to collude with. The
  whitepaper §6.7 (line 850) analyzes the federated case directly: *"If Oracles 1
  and 2 are run by agents in the same cartel, a 2-of-3 majority can launder a
  sabotaged settlement past the human audit, modulo the audit sampling rate."* The
  fix is the same folk-theorem calibration as everywhere else — raise the human-audit
  sampling rate σ so the detection probability `p_d = σ` makes collusion
  unprofitable. That machinery is **[DESIGNED]**, needed only once oracles are
  plural, i.e. only federated.

The pattern: each masked attack is masked *by the absence of a second distrusted
party*. The wedge has no second party. The market does.

---

## 2. The two live threats — accepted-risks table

The two attacks that survive single-operator are S4 and S5. Each is recorded here
as a **risk** with four fields (the format an accepted-risks register wants:
*what*, *why it's live*, *the fix and its status*, *the residual after the fix*):

| Field | **S4 — Under-collateralization of high-value harm** | **S5 — Griefing** |
|---|---|---|
| **What** | An agent reads & exfiltrates secrets (`.env.local`, `~/.ssh`, cloud creds) or corrupts live shared state; the damage (account takeover, unbounded spend) dwarfs any feasible bond. | An agent burns a shared resource purely to deny it — most concretely, it **hoards** a Coast-Guard sandbox/worktree (or, federated, posts bond-denial nuisance claims) with no benefit to itself. |
| **Why it's live** | The impossibility is structural: *a secret a process can use, that process can copy* (`strategy/dossier-security-crypto.md` §2). Bonds are inadequate by the whitepaper's own admission (§6.6, marked `\SpecOnly`): *"leaked context is worth far more than any feasible bond."* An economic deterrent cannot price this. | Coordination is *advisory* (`docs/adr/0038-claim-tree.md`): an agent can sit on a sandbox, go dark, and starve peers of the worktree and commons. Pure denial has no bond to slash because nothing was "destroyed." |
| **Fix + status** | **Structural, not economic — the Coast Guard** (`lib/coast-guard.ts`, ADR-0050): **CONFINE** (OS sandbox denies reads to crown jewels), **METER** (egress proxy hard-refuses past a cap), **RECEIPT** (signed append-only record). Separate the authority-*holder* from the authority-*user*; the agent gets *use* without *possession*. **[BUILT]** (`pd-cutter`; hardware-backed signing keys via Secure Enclave are [DESIGNED]). | **The compulsion — "coordination is the price of the sandbox"** (`lib/coast-guard/compulsion.ts` + `compulsion-facts.ts`, ADR-0050 Phase 7): a voyage keeps its sandbox only while it pays **coordination rent** — *no-note-no-commit*, *stay-rebased*, *feed-suggestibility*; a dark/abandoned sandbox is **reclaim-eligible**. This makes "communicate" the Nash-equilibrium behavior. **[BUILT]** (note-per-commit enforced; reclaim sweep CLI is the next slice). |
| **Residual after fix** | Detection is **post-hoc and races the exfil** (`strategy/dossier-security-crypto.md` §6): the Coast Guard quarantines a *turned* agent but cannot prove a clean one will stay clean. Egress *semantic* policy ("talk to OpenAI but don't leak the key") is not an OS-sandbox property; it needs the broker (the agent never holds the raw key). | Reclaim is gated to **never touch the operator's live main checkout** (`isReclaimableSandbox`); grace windows are lenient on purpose so *"rent bites the hoarder, not the operator who walked away."* Residual: a patient griefer can stay just inside the grace window. The reaper CLI that acts on `shouldReclaim` is not yet shipped. |

---

## 3. The bond ↔ Coast-Guard gap (the structural seam)

The deepest finding is that **S4 is where mechanism design admits defeat and hands
off to systems security** — and the hand-off is not yet a clean interface.

The bond layer (`lib/bonds.ts`, see `mechanism-design.md`) prices *outcomes*: it
slashes collateral when a breach is asserted. But the whitepaper §6.6 is explicit
that secret-exfil is **outside bond scope** — no bond is large enough — so the
defense moves entirely to **isolation** (`lib/coast-guard.ts`). The gap: the bond
and the Coast Guard are **two unconnected enforcement systems**. The bond does not
know whether a Float Plan's scope touches secrets; the Coast Guard does not adjust
its confinement profile based on the bond posted. A Float Plan with `db:write` or
`.env` access should *both* raise the bond (deterrence) *and* tighten the sandbox
(prevention) — today these are decided independently.

> **This is the bond↔Coast-Guard gap.** The two halves of the security model —
> *pre-fund the damage you might do* (bonds, economic) and *physically prevent the
> damage you cannot pre-fund* (Coast Guard, structural) — share no interface. Closing
> it means making the **scope** of a Float Plan (`s(F)` in the pricer's
> π = c(1+αs)(1−ρ), `mechanism-design.md` §1) the *same* input that selects the
> sandbox profile. Scope-proportional bonding (PR #339) and scope-proportional
> confinement should read one scope vector. They do not yet.

The reason this matters for the thesis: it is the precise point where "the wedge is
secure because one operator owns everything" stops being enough *even
single-operator*. S4 is live **now**, on the operator's own box — the
`cat .env.local` incident that forced ADR-0050 happened in this repo, this side of
any federation. So unlike S1–S3 (masked until federation), S4's fix (the Coast
Guard) is a **wedge** feature, not an L3 one — and is, per ADR-0050, the layer with
*day-one willingness-to-pay* ("fear converts; legibility does not").

---

## 4. Summary table — what to build, in what order

| Attack | Goes live when | Fix | Status | Priority |
|---|---|---|---|---|
| **S4** exfil/live-state under-collateralization | **now** (own box) | Coast Guard confine+meter+receipt | **[BUILT]**; hardware keys [DESIGNED] | **wedge** — highest WTP |
| **S5** griefing / sandbox-hoarding | **now** (mild) | compulsion-rent + reclaim sweep | **[BUILT]**; reaper CLI next | wedge |
| **S1** Sybil | federation | ADR-0040 non-forgeable identity | **[DESIGNED]** | L3 keystone |
| **S3** oracle collusion | federation (plural oracles) | 3-oracle majority + σ-calibrated audit | **[DESIGNED]** | L3, gated on S1 |
| **S2** front-running | federation (residual only) | bonded preemption (already priced) | **[BUILT, partial]** | low |

The order is the thesis again: **fix the two wedge-live attacks now (S4, S5) with
structural mechanisms; defer the three federation-live attacks (S1, S3, S2) to L3,
where they actually arise.** Building the L3 defenses early would harden against
attacks the single-operator user cannot suffer.

---

## References

- Douceur, J. (2002). *The Sybil Attack.* IPTPS.
- Daian, P. et al. (2019). *Flash Boys 2.0: Frontrunning, Transaction Reordering…*
  IEEE S&P. (Front-running.)
- ADR-0050: `docs/adr/0050-coast-guard.md` (the threat model, the three protections,
  the compulsion).
- Code: `lib/coast-guard.ts` (confine/meter/receipt), `lib/coast-guard/compulsion.ts`
  + `compulsion-facts.ts` (coordination-rent), `lib/bonds.ts` (the bond ledger).
- Whitepaper: `whitepaper/source/agent-transactions-whitepaper.tex` §4
  (deterministic assignment), §5.5 (bonded preemption), §6.6 (`\SpecOnly` exfil),
  §6.7 (oracle collusion).
- Strategy dossier: `../strategy/dossier-security-crypto.md` (the
  use-without-possession impossibility, the egress broker, hardware keys).
- Companion: `mechanism-design.md` (the bond that S4 defeats); `game-theory.md` §5.1
  (the Sybil cliff).
