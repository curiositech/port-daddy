"synthesis": "I'll synthesize the strategy memo directly from the dossiers and critiques. I have everything I need.

# Port Daddy — Strategy Memo

*Chief strategist's synthesis of five dossiers and four adversarial critiques. Honest, not hype. Where the critiques landed real hits, I say so and route around them rather than papering over them.*

---

## 1. What we are giving people

**Primary frame: the *independent system of record* for the agents on your own machine — an auditor, not a vendor.** Not "OAuth for agents" (the IETF, SPIFFE, Okta/Auth0 own that, and it's agent→service auth — adopt it, don't fight it). Not "Moody's for agents" (that's a cross-operator reputation registry, years out, gated on a network you don't have, and politically loaded). The accurate metaphor the operator already reached for is right: **Port Authority + Coast Guard** — the local, neutral authority that makes any vendor's fleet legible, accountable, and safe to one human. But the incumbent critique sharpened it into something more defensible: lead not with the *features* (coordination, sandboxing, spend caps) — every one of those is on a giant's changelog — but with the one **property no model vendor can structurally ship: a true, operator-held, tamper-evident account of what every agent did, *including the vendor's own agent*.** An auditor's value is that it doesn't work for the company it audits. That is the seat OpenAI/Anthropic/GitHub/Cloudflare are *disqualified* from, not merely slow to fill. Expansions, in sequence: Coast Guard (confinement) is the urgency feature *inside* this frame; local identity/continuity is expansion 1; cross-operator reputation/market is the far expansion.

---

## 2. The wedge

**Lead with the security/Coast-Guard "don't let my agents bankrupt me" layer as the *paid* product, with legibility as the *free* layer beneath it — but ship it as a zero-resident-cost wrapper, not a daemon.** Justification, weighing the debate:

- Legibility alone does not convert on day one; *fear* does. The monetization dossier is right that the secret-broker + hard spend-cap is the only feature with day-one willingness-to-pay, no network requirement, and validated comps (Archestra $10M, Portal26, Pipelock).
- But three critiques converged hard on the same flaw: **the daemon is the entry tax that kills adoption, and shared-tree arbitration solves a problem most devs designed away with git worktrees.** The senior-dev critique's prescription is the correct synthesis: ship the *one honestly-defensible slice* — `pd-cutter --cap 5 -- claude ...` — a stateless spawn wrapper (Seatbelt/Landlock profile, no keys in env, ephemeral proxy that dies with the process, signed receipt on exit). No launchd, no Homebrew lag, no three supervisors, no persistent CA. The daemon and the outcome ledger become an *opt-in* you earn after the wrapper proves value, not the customs checkpoint at the harbor mouth.
- **Buyer, honestly:** start with the solo operator (the operator's own profile) to validate, but the VC critique is correct that the venture-scale buyer is the **eng leader with 30 devs each running 3 agents who is terrified of a force-push to main or a leaked prod key.** The wrapper lands solo; the per-seat team policy-and-audit roll-up is the business. Design the signed-receipt format from day one to roll up to a team plane.

---

## 3. The novel-crypto security layer

**Be brutally honest: there is no novel cryptography here, and any deck that says "novel crypto" is selling bookkeeping as a vault.** The cryptographer critique is correct and decisive — every primitive (macaroons 2014, Merkle/CT logs 1991–2013, Secure Enclave keys, Ed25519 JWTs) is off-the-shelf. The one real architectural move is an *operating-systems* result, not a cryptographic one: **privilege separation — put the key in a trust domain the agent's process cannot reach.**

**Real and buildable now:**
- **Hard, non-agent-controlled spend cap** metered at the proxy from observed bytes (fixes `budget-guard.ts`'s fatal self-reported-spend flaw) — *against a cooperative or runaway agent.*
- **Secret broker** so the agent's env holds no raw key — *blast-radius reduction for the confused-deputy case.*
- **Seatbelt/Landlock confinement** of agents PD spawns, denying `~/.ssh`/`~/.aws`/cross-project `.env` reads.
- **Secure-Enclave-signed, append-only receipt** of brokered actions — non-repudiation *for actions the agent routed through the broker.*

**Theater against the *truly malicious* same-UID adversary (must not be claimed):** the cryptographer's Attacks 2–4 land. A turned agent with your shell can `unset HTTPS_PROXY`, read any stray key on disk and hit the upstream directly, decline to launch via `pd spawn`, or — same UID — debug/replace the unprivileged broker process and make the Enclave sign lies. **A secret a process can use, it can copy.** The marketing hook ("wolves in sheep's clothing / prompt-injected agent") describes exactly the case we *cannot* defend with a same-UID wrapper. So: sell the **cooperative-footgun** defense honestly (runaway loops, leaked-key blast radius, confused deputy) and the **signed receipt** as the truthful residual ("undeniable account of what was brokered"). The cryptographer's own prescription is the upgrade path: **a real boundary needs a separate UID / VM (`Virtualization.framework`) with pf/nftables forced egress** — which converts advisory to enforced but breaks "agent edits your live tree." That tension is real and unpriced; flag it, don't bury it.

**Minimal first artifact:** `pd-cutter` — the stateless wrapper above, delivering three demoable "your own agent tried to hurt you and couldn't" moments for the *cooperative* case, plus `pd cutter verify` on the signed log.

---

## 4. Platform & standards

**Barbell. Adopt the settled wires; own the one unowned chokepoint.**

- **Adopt (fighting these is suicide):** MCP (LF-governed, already PD's server), A2A (Google + 150 orgs + LF) for any future federation, OAuth/SPIFFE/WIF/VCs for agent→service auth. These wars are over or have neutral winners.
- **Own (genuinely unowned):** the **portable, operator-signed outcome-record format** — the schema and signature scheme for "agent X, under role Y, completed commitment Z, verified by W." This is the OCI play: own the *format*, stay neutral on the registry. Do **not** try to own a competing coordination wire ("Harbor Protocol") — the incumbent critique is right that without distribution it's a `.md` file, and MCP's Agent-Communication WG will standardize coordination around you. Participate in that WG; don't fork it.
- **Neutrality moat:** structural, made of incentive misalignment with the giants (no model to sell, no cloud to funnel) — harder to copy than code. **But** the critiques are right that neutrality is a *position*, not a product. It only bites when the artifact itself is verifiable-by-anyone (Sigstore's lesson: trust the log, not the company) and when fragmentation persists. Sidestep each giant: **OpenAI/Anthropic** — sit above MCP, be the auditor of their agent, not a rival framework. **GitHub** — lean into cross-vendor + no-account + local-custody; "My Work" is account-bound by construction. **Cloudflare** — their local is a billing funnel; ours is the product. The honest risk: if one ecosystem wins the daily driver, the mixed-fleet thesis weakens (see §6).

---

## 5. Business model

- **Free:** the stateless wrapper's basic mode (1 agent, soft caps) + local legibility/coordination (the data pump). Sigstore/GitLab/Sentry open-core: free for the individual contributor.
- **Paid, Tier 1 — Safety (~$19–29/mo solo, then per-seat):** hard spend caps, secret broker, multi-agent, full signed audit trail. Converts on fear, day one.
- **Paid, Tier 2 — Trust (team, the real business):** hosted/rolled-up verified ledger, reputation/Elo routing, agentic-review-as-a-service. **This is where the moat lives** — and per a16z's own test (which the dossier cites), the moat is *not* data volume but **trust-branded verification**, earned over years.
- **Tier 3 — Harbor (year 2+):** federation, settlement relay, marketplace take-rate. Do not start here; the cold-start kills a broke founder.
- **The moat, honestly:** the auditor property (independence the vendor can't sell) + local custody chain + an outcome ledger a free clone starts at zero on. **No capital bootstrap sequence:** (A) ship `pd-cutter` wrapper, SEO go-to-market ("how to not let your coding agent bankrupt you"), get one paying customer; (B) keep coordination free as the data pump; (C) light up the verified ledger once a corpus + a few payers exist; (D) federation last. Sell fear → accumulate trust → monetize the network.

---

## 6. The honest risks (the three strongest attacks with no great answer yet)

1. **The wedge and the moat are two different companies (VC critique).** The day-one converting feature (spend-cap proxy) is the *weakest* long-run moat and is actively commoditizing — open-source firewalls put its floor price at zero, and the model vendor who owns the token meter can ship per-agent hard caps as a billing toggle, satisfying "the agent never holds the key" *at the source* without any local proxy. I have a sequencing story (proxy funds the ledger) but **not a proof the ledger moat materializes before the proxy is commoditized to zero.**

2. **Real enforcement requires the isolation the positioning sold against (cryptographer critique).** Against the *actual* stated adversary, the same-UID wrapper degrades to advisory; genuine confinement needs a second UID or a VM, which makes the agent work a *copy*, which is the E2B/Daytona/Cloudflare sandbox model PD defined itself against. **"The security you can enforce requires the isolation your positioning forbids" is unresolved.** Honest interim posture: sell the cooperative-case defense truthfully and accept we cannot yet defend the malicious same-UID case without giving up "edits your live tree."

3. **It may be a feature gap closing on the giants' changelog, not a market (incumbent critique).** Worktree isolation + multi-agent dashboards + intra-tool sandboxes are shipping free inside tools devs already have. The mixed-fleet ICP is thin and may be a transitional phase that closes before the ledger compounds. The only durable answer is the auditor-independence framing — and that bet is **unproven**: it requires devs to value an independent record enough to install/pay, a behavior we have no evidence for yet.

---

## 7. What to build in the next 90 days (cheap thesis validation)

1. **`pd-cutter` (weeks 1–4):** stateless wrapper — Seatbelt (macOS) / Landlock (Linux) profile + ephemeral header-injecting egress proxy + byte-metered hard spend cap + Secure-Enclave-signed receipt + `pd cutter verify`. No daemon. Ship the three "your agent tried and couldn't" demos for the *cooperative* case, with the malicious-case limits documented in the README, not hidden.
2. **Honesty pass on all copy (week 2, parallel):** strike "novel crypto" everywhere; reframe the receipt as "an independent, tamper-evident account of what your agents did." Adopt the Sigstore comparable, retire the Stripe one for the security story.
3. **Buyer-discovery sprint (weeks 2–8):** 20–30 conversations split solo-operator vs. eng-leader-with-a-fleet. The single most important datum: **does a team buyer with a budget exist who fears a rogue agent on shared infra?** That answer determines whether this is a $3M utility or a venture company (VC critique's bar).
4. **N=1 ledger probe (weeks 4–8):** instrument the wrapper to record outcomes (did the run's PR land/revert/pass review) and test whether "PD picks the backend that actually ships for *this* task" measurably saves one operator money/time. If the ledger is valuable at N=1, the cold-start objection collapses; if not, the moat thesis is in trouble — better to learn it cheaply now.
5. **Standards reconnaissance (low effort, ongoing):** join the MCP Agent-Communication / Enterprise-Readiness WGs as an implementer; draft the portable signed-outcome-record schema as an open spec. Own the format, not a competing wire.

**The 90-day question being answered:** *Will a buyer pay for an independent, local, signed account of what their agents did — and is that buyer a team, not a hobbyist?* Everything else is downstream of that."