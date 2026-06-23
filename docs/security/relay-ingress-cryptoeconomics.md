# Cryptoeconomic security — GitHub-App relay ingress → fleet dispatch

Five-attack-class stress test of the webhook→relay→daemon→fleet-dispatch surface
(the relay-ingress feature) and the bonded layer that backs agent operation.
Grounded in code; numbers are real defaults or stated estimates.

## Scope honesty (read first)

This surface is **capability-gated, not bonded**. `lib/bond-pricing.ts` *prices*
collateral (scope multipliers read 1× / write 3× / critical 10× / full 25×; floor
≈ $50 for a critical-tier op at a $5 base) but it **does not slash, escrow, or
refuse** — its own header calls bond↔Coast-Guard write-gating the "UNBUILT Layer-1
enforcement." So there is **no enforced economic bond** on this path today. The
anti-pattern "the bond exists, therefore we are safe" does not even apply — there is
no enforced bond. Enforcement that *does* exist is **structural**: the Coast Guard
sandbox (crown-jewel read-deny + egress byte/request cap, `lib/coast-guard/*`) and
the relay's per-sender publish rate limit. The economic layer is advisory.

## Summary

| # | Attack class | Verdict (this surface) | Primary defense | Type | Status |
|---|---|---|---|---|---|
| 1 | Undercollateralization | Bond unenforced ⇒ $0 economic deterrence; damage capped structurally instead | Coast Guard scope-limit (sandbox + egress cap) | Structural | Present; economic write-gate **unbuilt** |
| 2 | Griefing | **VULNERABLE** — webhook→spawn cost-amplification, concurrency unlimited by default | Per-installation spawn cap + `budgetUsdPerDay` | Structural + Economic | **Gap: no safe default cap** |
| 3 | Oracle manipulation | N/A — no acceptance oracle / escrow release in the ingress path | — | — | Reactivates with Float Plans (deferred) |
| 4 | Sybil | Identities ≈ free, but per-identity value capped by per-sender rate limit; superlinear gain absent | Per-sender rate limit; (Anchor KYC stubbed) | Structural; Social (stubbed) | Accepted risk pending Anchor |
| 5 | Front-running | Low relevance — not a competitive-bid market; channel names leak repo names | (commit-reveal not warranted) | — | Accepted risk (metadata) |

## Class 1 — Undercollateralization

- **Max damage a triggered agent can inflict:** a fleet ship is an LLM spawn with
  project access. Reads are confined by the Coast Guard sandbox (crown-jewels like
  `.ssh`/`.aws`/`.env` denied; egress byte/request capped). **Writes are not
  bond-gated** (`bond-pricing.ts` header: write-gate unbuilt).
- **Bond-to-damage ratio:** the priced bond for a `full`-tier op is 25× base (≈ $125
  at $5 base), but it is **never collected or slashed** → *effective* deterrence
  **$0**. By the skill's decision tree: bond < damage, and can we cap damage? **Yes**
  → **structural scope-limiting** (the Coast Guard) carries the defense, not the bond.
- **Defense (Structural):** Coast Guard sandbox + egress cap bounds exfiltration and
  runaway cost per spawn. **Economic (advisory):** bond pricing surfaces a `belowFloor`
  flag but does not enforce.

## Class 2 — Griefing  ← the headline finding

- **Vector:** A webhook that passes origin auth (now enforced, PR #431) still triggers
  every ship subscribed to its channel. One webhook → *M* concurrent LLM spawns
  (`lib/fleet-engine.ts:900-925`, multiple `trigger:` subscribers). Each spawn is real
  money (~$0.01–$1+/run depending on context size + backend).
- **Defaults (the gap):** `maxConcurrentSpawns` and `maxSpawnsPerHour` default to
  **unlimited** (`fleet-engine.ts:64-71`); only `budgetUsdPerDay` is required and is a
  **daily** hard stop. The relay's 60/min publish rate limit is **per (sender, channel)**
  and does **not** bound the webhook→spawn path (webhooks arrive from GitHub; the spawn
  is daemon-side after dispatch).
- **Numbers:** with `budgetUsdPerDay = $100` and ~$1/spawn, an attacker who controls an
  installed repo can burn up to **$100/day** by firing webhooks — and an unbounded
  *burst* within any single day (no concurrency/rate ceiling). Decision tree →
  **VULNERABLE** (no hard timeout/concurrency cap by default).
- **Recommended defense (Structural, cheap):** a **per-installation webhook→dispatch
  cap** with a safe default — e.g. concurrency ≤ 3 and ≤ 30 dispatches/min per
  installation (≈ 0.5/s, far above real webhook rates, but caps a flood). Pair with a
  short **debounce** on identical `(installation, event)` deliveries. Economic backstop:
  require a non-trivial `budgetUsdPerDay` and alert at 50%.
  - This is the one concrete code fix this analysis produces; see "Action" below.

## Class 3 — Oracle manipulation

- The ingress→dispatch path has **no acceptance oracle and no escrow release**: ships
  run; nobody adjudicates "work accepted" to release a worker bond or requester escrow.
  There is nothing to bribe or collude over here. **N/A today.**
- **Reactivation trigger:** Float Plans (deferred — they compose *over* the relay later)
  add escrowed agent-work contracts with an acceptance decision. When that lands, Class 3
  (quorum/random-pool/oracle-bonding/costly-appeals) must be re-run. Owner: Erich.

## Class 4 — Sybil economics

- **Identity cost ≈ $0:** harbors/agents self-register; the Anchor (hardware-rooted
  identity) + onboarding KYC that would make re-incarnation costly is **stubbed**
  (`bond-pricing.ts:78-92,130-134`; reputation factor pinned at 1.0×). Cost to mint 100
  identities ≈ 0.
- **But superlinear gain is absent on this surface:** every identity is still gated by
  harbor membership (tenant isolation, proven in `github_ingress_tenant_isolation.pv`)
  and the per-sender publish rate limit, so 10 identities ≈ 10× a linear, rate-capped
  amount — not more. **Linear Sybil, per-identity value capped** by the 60/min limit.
- **Where it bites:** reputation farming once reputation becomes load-bearing in bond
  pricing. Today reputation is 1.0× (not load-bearing) → not yet exploitable.
- **Social defense degradation plan:** the only Sybil-resistance is Anchor's per-principal
  onboarding cost (web-of-trust-like). It is **not built**, so today there is *no* Sybil
  cost. Until Anchor lands, do not make reputation load-bearing for any
  value-at-stake decision (doing so would be exploitable for ~$0).

## Class 5 — Front-running

- Fleet manifests (`pd-fleet.yml`) and harbor card caps are **public before execution**;
  there is **no commit-reveal or sealed bid**. But this is **not a competitive-bid
  market** — agents do not bid against each other for the same task with profit at stake,
  so reading a plan first yields no profit. **Low relevance; commit-reveal not warranted.**
- **Real leak (metadata):** the relay channel name `<harbor_fp>:github:webhook:<owner>/<repo>`
  exposes repo names to the relay operator (unavoidable routing metadata; already noted as
  adversary A1 in the ProVerif threat model). Low impact for a self-hosted relay.

## Accepted risks (name / likelihood·impact / re-eval trigger / owner)

1. **Bond write-gating unbuilt** — high likelihood · medium impact (no enforced economic
   deterrence on writes) — re-eval when an agent can spend real money or cause > a set $
   damage per run, or when the Layer-1 write-gate ADR lands — owner: Erich.
2. **Webhook→spawn cost griefing** — medium · medium (≤ `budgetUsdPerDay` burn + unbounded
   daily burst) — re-eval when the per-installation cap (below) ships, or sooner if a
   real cost incident occurs — owner: Erich.
3. **Free Sybil identities** — high · low-now / medium-later (reputation farming) — re-eval
   when Anchor lands or reputation becomes load-bearing in pricing — owner: Erich.
4. **Channel-name metadata leak** — certain · low (repo names to relay operator) — re-eval
   if the relay hosts third-party tenants with sensitive private-repo names — owner: Erich.

## Action

The only **profitable, currently-exploitable** vector is Class 2 (webhook→spawn cost
griefing), and its fix is a cheap **structural** default cap. Recommended:
per-installation dispatch concurrency + rate cap (safe defaults, env-overridable) at the
webhook ingress boundary, plus a debounce on duplicate `X-GitHub-Delivery`. Where the cap
lives (ingress route vs. fleet-engine spawn quota default) is a design choice with
behavior implications for high-volume fleets — decide before implementing.
