# Work Packet: Operator Vision 2026-07-05 — Team Velocity, The Market, And The Kernel

Status: operator ambition capture (verbatim intent, structured for the AoR).
Owner: Harbor Architect of Record classifies each ambition per chapter 16
(absorbed / superseded / deferred / contradicted / orphaned / rejected) on the
next baseline run. Skill lenses grafted per ambition below.

## The operator's thesis, restated

Port Daddy is not just where you organize your agents and cooperate with
buddies. Three expansions:

1. **The daemon is the team-velocity plane.** Spider, Spark, Cartographer, and
   Unspider operate at the *team* level so every IC runs at full speed while
   agents prevent merge disasters, spot duplication, and catch refactors that
   would annihilate each other. Everyone benefits from each other's skills,
   scripts, and tools. Agents bring *humans* into parleys. And the whois
   tables we keep for durable agents ("who is best at what") extend to the
   humans on the team.
2. **Port Daddy is how you sell your tech.** A great model, agent, skill, or
   orchestrator becomes leasable: others run it on their data *without you
   seeing that data*, via remote harbors — nobody gets screwed. Competitive
   advantage in a skill library becomes revenue. This is the manifesto's
   economy made concrete, and it can make money *immediately*.
3. **Quality is rateable, so trust is sellable.** Jury-rig proved skill-grafting
   raises output quality on dev tasks almost always. Neutral red-teamers and
   quality reviewers can rate agents/skills/orchestrators the same way —
   incentivizing guilds ("agentic Moody's").

Plus three concrete follow-ons:

4. **Adopt the commonsense UCP/Agent Protocol additions** in the open PRs
   (ADR-0094 SD-JWT-VC profile + `/.well-known/harbor` discovery, PR #666).
5. **Automation as a product**: io-wiring (PR #672, live) makes agentic
   automation possible; the unlock is agents *writing the trigger/event/agent
   wiring for people* — which then becomes a store / online gallery of
   automations. Manual-config residue lives in
   `phone_outbox/io-wiring-operator-setup.md` (3 steps: Email Routing rule,
   `PD_FORWARD_URL` tunnel, calendar grant).
6. **Resume the Rust kernel** (`core/kernel`, existing crate) — possibly fully.
7. **The paper wave** (`phone_outbox/pd_paper_wave.png`): the unfinished
   3-wave empirical program — W0 voice-rule CI + H1–H7 nominal diagnostic;
   W1 model-provenance schema, tree-of-agents (`parent_session_id`),
   `pd hitl ask`, salvage triage UX, frozen substrate mode; W2 `pd
   conservation`, mid-claim collision handler, decision-level cost
   attribution, expressive-act classification; W3 `pd experiment` primitive,
   `pd route` → empirical runs + paper writes. This is the evidence engine
   for ambitions 2 and 3: ratings need experiments.

## Binder homes and skill backing (Seamanship per ambition)

| Ambition | Binder home | Backing skills (graft before building) |
| --- | --- | --- |
| Team-velocity plane; humans in parleys; human whois | ch05 (cooperative governance) extension; coop-harbor surface (converged mock renders humans on the crew rail already) | `cooperative-vibe-coding`, `multi-agent-coordination`, `semantic-conflict-prediction`, `hr-network-analyst`, `agent-discovery-directories-guilds` |
| Lease your tech; data-blind remote execution | ch02 remote harbors + ch06 billing; Harbor Authority ADR prerequisite | `three-sided-agent-labor-market`, `mechanism-design-for-agent-labor`, `agent-labor-pricing-function`, `local-first-tenancy-boundary`, `pd-relay-zero-trust`, `macaroon-capability-credentials` |
| Ratings, neutral reviewers, guilds (agentic Moody's) | ch18 attestable outcome log (already specified: Merkle-rooted task/skill/judge records); ch05 incentive model | `attestable-skill-quality-signal`, `cost-verification-auditor`, `game-theoretic-agent-incentives`, `cryptoeconomic-protocol-security`, `agent-identity-continuity-reputation`, `llm-as-judge-zheng-2023` |
| UCP/Agent Protocol adoption | ADR-0094 (PR #666) — accept direction | `agent-interchange-formats`, `federated-harbor-author` |
| Automation store; agents write the wiring | io-wiring (ADR-0093, shipped); new: wiring-authoring agent + gallery | `fleet-event-spawn-trust`, `webhook-receiver-design`, `always-on-agent-applications`, `background-job-queue-design` |
| Rust kernel resumption | `core/kernel` crate; needs a focus receipt before a chain launches | `advanced-rust-patterns`, `rust-performance-and-idioms`, `rust-kernel-ffi`, `daemon-development`, `focus-receipt-proof-gate` |
| Paper wave | new: `pd experiment` primitive; ties to M6 memory + receipts | `empirical-systems-evaluation`, `llm-evaluation-harness`, `research-craft`, `agent-rl-sandbox-trainer` |

## Sequencing note (one honest constraint)

Ambitions 2 and 3 are the marketplace the PRD parks until local Agent Node
truth exists (ch00 "What We Toss Or Park"). This packet does not un-park them;
it gives them named homes so F0→C5 work builds *toward* them: Work Receipts
are the trust object buyers inspect, the attestable outcome log is the rating
substrate, remote-harbor tenancy is the leasing substrate. The paper wave and
the ratings program are the same machine: experiments that produce calibrated
quality signals. The team-velocity plane (ambition 1) is *not* parked — it is
M8 cooperative governance plus the converged coop-harbor surface, and the
mocks already render it.

## Immediate actions taken with this capture

- Converged coop-harbor mock renders humans-in-parleys and capability cards
  (PR #658).
- Skills audit: the review worktree's skill set is fully merged to main
  (231 skills on main ⊃ 178 in the worktree; PR #661 et al.) — the corpus is
  live and grafted throughout the converged-mock build.
- Kernel located at `core/kernel` (not `apps/core/kernel`); a focus receipt
  (per `focus-receipt-proof-gate`) is required before an implementation chain
  launches on it.
