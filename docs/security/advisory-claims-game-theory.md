# Game-theoretic analysis — advisory claims & coordination rent

Companion to `relay-ingress-cryptoeconomics.md`. The cryptoeconomic analysis found
the bond/claims layer is **advisory** (priced, never slashed) and that the only
deterrent for false claims is *reputation* — the weakest defense class. This
analysis asks the formal question that classification leaves open: **does truthful
claiming actually hold as an equilibrium, given Port Daddy's real parameters?**

## The stage game (advisory file-claim signaling)

Players: agents on a shared project. Actions per file: **T** (claim truthfully) or
**F** (claim falsely — over-claim to block others, or under-claim to dodge scrutiny).
Per-round payoffs (a Prisoner's Dilemma):

```
                 B:T        B:F
   A:T        (3, 3)      (1, 4)
   A:F        (4, 1)      (0, 0)
```

`d=4 > c=3 > p=0` (deviation tempting, mutual lying worst). One-shot: F strictly
dominates T → truthful claiming is **not** a one-shot equilibrium. Advisory claims
are cheap talk absent repetition + observability + reputation.

## Repeated-game structure (Port Daddy's real parameters)

| Folk-theorem condition | Port Daddy reality | Holds? |
|---|---|---|
| Observable history | Immutable note trail (`pd notes`, append-only; "Notes are immutable" is load-bearing infra), timestamped claims + heartbeats | **Yes** |
| Persistent identity (no free Sybil) | Identities are free: harbors/agents self-register; Anchor/KYC **stubbed**; reputation pinned 1.0× (per cryptoeconomic scout) | **No** |
| Patience δ high | High for a genuinely persistent agent — but free re-registration makes effective δ ≈ 0 (Sybil destroys the shadow of the future) | **Conditional** |

## Equilibrium proof (gate: profile + deviation analysis + conditions)

**Strategy profile (graduated trigger):** start T; if the opponent's last observed
action was T, play T; if F was observed, play F for 3 rounds (punishment), then
return to T; restart the 3-round punishment if F recurs during punishment.

**Deviation analysis (each must be unprofitable):**
- *One-shot deviation:* immediate gain `d − c = 1`; discounted punishment cost
  `(c − p)·Σ_{k=1..3} δ^k`. At δ=0.9: `3·(0.9+0.81+0.729) = 7.32` → net `1 − 7.32 = −6.3 < 0`. Unprofitable.
- *Permanent deviation:* 0/round `(F,F)` vs 3/round `(T,T)` — strictly worse for any δ>0.
- *Delayed deviation:* identical to one-shot by stationarity of the trigger.
- *Critical threshold:* `d − c < (δ/(1−δ))(c − p)` → `1 < (δ/(1−δ))·3` → **δ > 0.25** (grim) / **δ ≈ 0.53** (3-round graduated).

**Conditions and what breaks them:**
- (i) Observable history — **holds** (immutable notes). Remove it → deviation undetectable → collapses to repeated one-shot, both play F.
- (ii) Persistent / costly identity — **fails today**. Free re-registration ⇒ deviate, abandon ID before punishment, re-enter clean ⇒ δ_eff ≈ 0.
- (iii) δ > 0.53 — holds **only if** (ii) holds.

**Result:** truthful claim signaling is a Nash equilibrium **iff identity is costly.**
With free identities, condition (ii) fails, δ_eff → 0, and the equilibrium that should
deter false claims **does not hold**. The reputation deterrent the cryptoeconomic
analysis named is, today, not enforceable by repeated-game incentives.

## What actually sustains coordination today (honest)

Not the equilibrium — two non-game-theoretic props:
1. **Narrow structural enforcement:** the Coast Guard coordination rent (note-per-commit,
   `block-commit`) is *enforced*, not advisory. It forces coordination on the commit
   gate regardless of incentives — but only there, not on claim truthfulness. (This is
   the "just add enforcement" anti-pattern used acceptably: a narrow, crash-safe gate,
   not a file lock.)
2. **Single-operator goodwill:** in practice all agents are one operator's, so they do
   not adversarially defect. The game-theoretic risk is **latent** — it activates when
   adversarial / third-party agents join (the hosted / multi-tenant relay future this
   PR's ingress work moves toward). This is exactly why the cryptoeconomic analysis says
   *do not make reputation load-bearing until Anchor lands.*

## The fix (Failure Mode 1: identity anchoring)

The Anchor Protocol (hardware-rooted passkey; non-zero per-principal onboarding cost
`C_kyc`) restores δ by pricing re-registration → condition (ii) holds → the equilibrium
holds. The game theory **proves** the dependency the cryptoeconomic analysis asserted.
Until Anchor ships: reputation must not gate any value-at-stake decision.

## Correlated equilibrium (daemon as correlator) — gate

The daemon can beat Nash. **Device:** it observes the live conflict graph (claims +
identities) and sends *private* `claim`/`wait` recommendations weighted by
priority/history (ADR-0039's claim-overlap detector + `pd nudge` is the seed).
**Obedience:** the recommended winner takes the file; the loser knows fighting yields
the conflict payoff (0) < waiting — so following is a best response. **Welfare:** reaches
the efficient `(T,T)`-equivalent and Pareto-dominates the bad equilibria (all-claim-hot-file,
or bystander-nobody-claims-tests). **Collusion (Failure Mode 3):** randomized priority means
colluders cannot guarantee monopolization. **Caveat:** the "fighting is punished" leg still
needs the identity/reputation backing to bite, so correlation *reduces* the price of anarchy
but does **not** remove the costly-identity dependency.

## Price of anarchy (gate)

- **OPT (centralized):** max parallel, zero conflict = `N·3` for N agents on N distinct files.
- **Worst equilibrium:** all N agents claim the one hot file → conflict, welfare → ~0;
  or the bystander equilibrium (nobody claims tests/docs/config).
- **Bound:** file-claim competition is a congestion game; linear-latency PoA ≤ **5/2**
  (Roughgarden). The degenerate single-hot-file race gives PoA ~ **N** (unbounded in N).
- **Tightness:** 5/2 is tight for linear congestion; ~N is the degenerate single-resource case.
- **Reduction levers (real):** publish the claim distribution (information); daemon
  overlap-broker recommendations (correlation → PoA→1); **claim expiration** (auto-release
  unused claims — currently a *named gap*: claims do not auto-expire, which also enables
  the collusion over-claim in Failure Mode 3); task-bundling over single files.

## Headline

Advisory coordination in Port Daddy is incentive-compatible **only under costly
identity.** Today identities are free, so the deterring equilibrium does not hold —
coordination rests on narrow structural enforcement (Coast Guard `block-commit`) plus
single-operator goodwill. The latent risk activates with adversarial / third-party
agents (the hosted, multi-tenant direction). **Anchor (costly identity) is the
load-bearing fix; until it lands, reputation must not be load-bearing.** The
daemon-as-correlator (ADR-0039) is the complementary efficiency + anti-collusion lever,
and claim auto-expiration is the cheapest missing structural defense.
