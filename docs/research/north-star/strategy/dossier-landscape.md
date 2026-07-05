I have everything I need across all six categories. Synthesizing the dossier now.

---

# Agent-Infrastructure Landscape Dossier — June 2026

**Scope:** Coordination/orchestration · runtime/sandbox · identity/auth · payments · local coding agents · papers. Each entry: what it does, where it's strong, and the **gap** a local-first "harbor-master" (Port Daddy) could own. The synthesis is in the **Whitespace Map** at the end.

The through-line: **2026 is the year agent infra went enterprise-cloud, protocol-standardized, and remote.** Almost every credible player assumes a cloud control plane, an enterprise IdP, an OIDC issuer, or an on-chain registry. The **local-first, single-operator, multi-tool, secrets-stay-on-device** seat is conspicuously empty — that is the harbor-master's water.

---

## 1. Coordination / Orchestration

| Project | What it does | Strength | Gap a local-first harbor-master owns |
|---|---|---|---|
| **LangGraph** (LangChain) | Graph state-machine for agents; built-in checkpointing + durable execution; LangSmith tracing. Powers Klarna, Uber, LinkedIn. | The durable-execution leader among *frameworks*; best non-linear recovery semantics. | It's an in-process Python/JS library. No notion of *multiple independent agent processes/tools* (Claude Code + Cursor + Codex) sharing one machine. Coordinates nodes in *one* graph, not rival CLIs. |
| **CrewAI** | Role-based "crew" abstraction; CrewAI Enterprise for deploy. | Fast to prototype; popular for role/task framing. | Young recovery story; cloud-deploy oriented. No cross-process file/lock arbitration. |
| **AutoGen / AG2** | Microsoft conversational MAS; AG2 = community fork. | Historical influence, research patterns. | **AutoGen is in maintenance mode** (README points to MS "Agent Framework"); AG2 is maintenance, not innovation. Dead-ish. |
| **OpenAI Agents SDK** (ex-Swarm) | Production successor to Swarm (Swarm now archived/educational). Handoffs, guardrails, tracing, OTel export. **Apr 15 2026 "Next Evolution"**: native sandbox exec, long-horizon harness, **subagent primitive (beta)**, planned code mode. | First-party, TS+Python parity, sandbox + subagents now native. | Single-vendor (OpenAI models/Responses API). Subagents are *its own* children — not a neutral bus for arbitrary local tools. |
| **Temporal** | Durable execution via journal/replay. **Raised $300M at $5B valuation Feb 17 2026.** 9.1T lifetime actions; **OpenAI runs Codex on Temporal in production.** | The serious durable-workflow backbone; AI-native traction huge. | Heavyweight server + workers; cloud/cluster-oriented. Overkill and wrong shape for a solo dev coordinating local CLIs. |
| **Inngest / Trigger.dev / Restate** | Developer-tier durable execution. Restate = lighter journal/replay (Temporal-like) baked into service boundaries; Inngest/Trigger.dev event-driven steps + HITL gates. | Restate: durability at service boundary, light footprint. Inngest/Trigger: natural for JS task platforms. | All assume a deployed service topology. None arbitrate *who-owns-which-file* between concurrent local agents. |
| **Dagger** | CI/CD-as-code, containerized pipeline DAGs (programmable, cacheable). | Reproducible containerized pipelines. | Not an agent coordinator; barely appears in agent-orchestration discourse. Adjacent, not competitive. |

**Category gap:** Every orchestrator coordinates *steps/nodes inside one runtime*. **Nobody coordinates the messy reality of several heterogeneous agent processes (different vendors, different CLIs) writing to one shared working tree on one developer's laptop.** That's exactly Port Daddy's claims/locks/sessions/guard model.

---

## 2. Agent Runtime / Sandbox

| Project | What it does | Strength | Gap |
|---|---|---|---|
| **E2B** | OSS cloud sandboxes on **Firecracker microVMs**, dedicated kernel per sandbox, ~150ms cold start. | Strongest hardware isolation; Fortune-500 adoption. | Cloud-hosted, ephemeral. Doesn't govern the dev's *real* local checkout — it replaces it with a remote box. |
| **Modal** | gVisor-based sandboxes inside a broader inference/training/batch platform; GPU access. | GPU-heavy workloads; one platform for compute. | Cloud, per-second billed; not local. |
| **Daytona** | Pivoted dev-env → agent infra (early 2025). Docker containers, 27–90ms creation, persistent sandboxes with auto-stop/archive/delete. | Fastest provisioning + persistence. | Container isolation (weaker than microVM); still a remote sandbox model. |
| **Cloudflare Agents / Durable Objects** | Each agent = a **Durable Object** with own SQLite + durable identity + hibernation. Agents Week Apr 2026: long-running sessions (clone repo, run tests, open MR in one session), **Durable Object Facets** (per-tenant isolated SQLite). | Global edge scale (tens of millions of instances), durable identity per session, SQLite-native. | Lives on Cloudflare's edge. The harbor-master is *also* SQLite-backed (`bun:sqlite`) but **runs on the dev's own box** — same primitive, opposite locus of control. |
| **Fly Machines** | Fast-booting Firecracker VMs as a primitive (general compute). | Cheap, fast microVMs you control. | General infra, not agent-specific; you still build the coordination layer yourself. |
| **Firecracker / gVisor** | The underlying isolation tech (microVM vs syscall-filtering). | Firecracker = strongest boundary; gVisor = lighter. | Primitives, not products. |

**Category gap:** All sandbox vendors answer "give the agent a *remote, disposable* box." None answer **"the agent is editing my actual local repo right now — arbitrate that safely."** Local-first coordination over a *live shared tree* (the thing the operator's MEMORY repeatedly bleeds about — stranded dirty lines, destructive git on the main checkout) is unserved by the sandbox category.

---

## 3. Agent Identity / Auth — **the hottest area**

This is where the most spec activity is, and where the local gap is sharpest.

| Standard / effort | What it does | Status (2026) | Gap |
|---|---|---|---|
| **MCP authorization** (Anthropic) | MCP server = **OAuth 2.1 Resource Server**; clients must use Protected Resource Metadata (RFC 9728) for AS discovery + Resource Indicators (RFC 8707) to scope tokens. **June 2025** cleanly separated resource server from auth server. **2026-07-28 RC**: stateless core, MCP Apps (server-rendered UI), Tasks extension, OAuth/OIDC-aligned **Enterprise-Managed Authorization**. | Mainstream; RC for the biggest revision since launch. | Assumes an *external enterprise auth server*. The solo-dev / local case ("there is no IdP, just me and three CLIs on a laptop") is hand-waved. Local MCP secrets sit in **plaintext config** (see §5). |
| **Google A2A / Agent2Agent** | Cross-framework agent-to-agent comms (Agent Cards, tasks, artifacts). Released Apr 9 2025; donated to **Linux Foundation June 2025**; **150+ orgs**, deep on Google/MS/AWS by Apr 2026. | De-facto inter-agent standard. | Inter-*org*, inter-*platform* protocol. Doesn't address intra-machine coordination of one person's tools. |
| **AGNTCY** (Cisco/Outshift → LF) | "Internet of Agents" stack: **Agent Directory (ADS)** + **OASF** schema + **Identity** (decentralized IDs for Agents, MCP servers, MASs) + observability. Leverages A2A + MCP. | LF project; formative members Cisco, Dell, Google Cloud, Oracle, Red Hat; Webex shipping it. | Enterprise discovery/identity fabric. Overweight for a single operator; centralized directory model. |
| **SPIFFE / SPIRE** (CNCF) | Cryptographic workload identity (SPIFFE ID + SVID), no static keys. Integrates to OAuth via **RFC 8693 token exchange**. HashiCorp/Solo/Riptides all pushing SPIFFE-for-agents. | The workload-identity standard now being retrofit to agents. | Needs a SPIRE server + attestation infra; multi-cluster federation complexity. Heavy for local. **But the model (attested identity, no shared secrets) is exactly what a local harbor-master should mint per-agent.** |
| **OIDC-A** (OpenID Connect for Agents 1.0) | Proposed OIDC extension: agent identity claims, **attestation evidence (IETF RATS / EAT)**, **delegation chains** with scope reduction + constraint propagation. | Individual proposal + arXiv (2509.25974); not yet standardized. | Spec-stage; assumes OIDC IdP. The *delegation-chain* idea is portable to local coordination. |
| **Three-layer agent auth** (industry pattern) | **A) ID-JAG/XAA** (human→agent→external API; Okta "Cross-App Access", in MCP Enterprise-Managed Auth; RFC 7523+8693+draft-ietf-oauth-identity-assertion-authz-grant). **B) Transaction Tokens for agents** (`sub`+`act` across internal hops; draft-ietf-oauth-transaction-tokens-08 + draft-araut-…-for-agents-06). **C) Workload Identity Federation** (agent→LLM provider; **Anthropic WIF launched May 2026**, no static `sk-` keys). | Actively drafting at IETF; IETF OAuth list debating **"delegation-chain splicing"** (audience of step N must match subject of N+1). | **Explicitly identified gap: none of the three layers encode whether the agent's own *local execution environment* is trustworthy.** SLSA-provenance-style attestation of the *local* agent is unowned. |
| **ERC-8004 "Trustless Agents"** | On-chain Identity + Reputation + Validation registries (ERC-721 IDs). Contributors: MetaMask, Ethereum Foundation, Google, Coinbase. **Live on mainnet Jan 29 2026.** | Permissionless, cryptographically verifiable reputation. | On-chain, gas, public — wrong trust model for a private single-operator fleet, but **the three-registry decomposition (identity / reputation / validation) is a clean mental model** the harbor-master can mirror locally in SQLite (the operator's MEMORY already mentions a "reputation/quality-eval ledger spine" — task #4). |

**Category gap (the big one):** Every identity effort presumes either (a) an enterprise IdP/OIDC issuer, (b) a CNCF/SPIRE server, or (c) an on-chain registry. **There is no "identity authority for the agents running on *my own machine*."** Port Daddy's semantic identities (`project:stack:context`) + sessions + notes are already a *local identity + delegation + audit* primitive. The whitespace is: make that the **local SPIRE-equivalent** — mint short-lived per-agent credentials, record the delegation chain, attest the local execution environment, and bridge *outward* to MCP/A2A/WIF when an agent needs to leave the harbor.

---

## 4. Payments / Commerce

| Project | What it does | Status | Gap |
|---|---|---|---|
| **x402** (Coinbase) | Revives HTTP **402 Payment Required**; instant USDC-over-HTTP, no accounts/sessions. **x402 Foundation co-founded w/ Cloudflare Sept 2025.** ~75M txns/30d, 94k buyers; Stripe/AWS/Cloudflare/Vercel adoption. | The internet-native payment rail. | Payment rail, not coordination. Relevant only if the harbor-master ever prices inter-agent labor (operator's "priced cooperation / mechanism design" vision). |
| **AP2** (Google + Coinbase) | Agent Payments Protocol: how agents identify, what credentials they carry, how payments get approved across platforms; **uses x402 as a rail.** Sept 2025. | Authorization framework atop rails. | Cross-platform commerce; not local fleet ops. **ADR-0094 adopts its credential formats (SD-JWT-VC/JWS/JCS) at the harbor boundary.** |
| **UCP** (Google + Shopify) | Universal Commerce Protocol: discovery + cart + checkout + orders for agent-mediated retail; `/.well-known/ucp` profiles (capabilities + JWK signing keys), server-selects version negotiation, four transports (REST/MCP/A2A/embedded). Walmart, Target, Visa, Mastercard, Stripe, Amex endorsing. Announced NRF **Jan 2026**, Apache-2.0. | The merchant-hosted transaction envelope; delegates authorization to AP2 mandates. | **Names agent trust out of scope** (its most-cited critique — DataDome 2026): no collateral, no settlement oracle, no reputation. That gap is the harbor economy's product. ADR-0051 Phase 1b lifts its `/.well-known` discovery pattern. |
| **Skyfire / KYAPay** | **Know-Your-Agent** trust framework + USDC micropayments. Provider/policy/purpose/security review → verified agent ID. **IETF draft-skyfire-kyapayprofile-01**; demoed w/ Visa Intelligent Commerce. | Open KYAPay protocol + Agent Checkout. | KYA = "whose agent, what for, what constraints" — **conceptually identical to a local session/identity record**, but aimed at external commerce counterparties. |
| **Payman** | Agentic banking with **human-in-the-loop**: daily limits, per-txn caps, whitelisted payees, manual-approval thresholds, audit trails. Bank partnership (Middlesex Federal). | Risk-controlled spend. | The **HITL spend-gate pattern** (limits + thresholds + approval) maps directly onto the harbor-master's **human-gate / guard** primitives — but for money instead of git. |
| **Amazon Bedrock AgentCore Payments** | AWS + Coinbase + Stripe: agents that transact. | Hyperscaler entry. | Cloud-tied. |

**Category gap:** Payments folks have independently reinvented **KYA = identity + purpose + constraints + audit + HITL approval gates** — which is *the exact shape of agent coordination metadata the harbor-master already stores for free*. Whitespace: be the **local source of agent identity/purpose/constraint** that these external KYA/payment systems can *consume* when a local agent transacts.

---

## 5. Local Coding-Agent Tools (the operator's near-competitors)

How they handle **secrets / MCP config / multi-agent / permissions** — and uniformly, **none coordinate each other.**

| Tool | Secrets | MCP config | Multi-agent | Permissions |
|---|---|---|---|---|
| **Claude Code** | **Plaintext** in `~/.claude.json` (user) + `.mcp.json`/`.claude/mcp.json` (project). No built-in auth for remote MCP, no audit trail. | Project + user config; can be **both MCP server and client** ("agents all the way down"). | **Background Agents** in independent git **worktrees**; **Agent Teams** (research preview); HTTP hooks; bidirectional MCP; Auto Memories. | `default / acceptEdits / auto / dontAsk / plan`; as MCP server defaults to `--dangerously-skip-permissions`. |
| **Cursor** | `.cursor/mcp.json` + `~/.cursor/mcp.json`, plaintext. | Project + user. | IDE-centric. | IDE permissioning. |
| **Windsurf** | Single global `~/.codeium/windsurf/mcp_config.json`. | One global file. | IDE-centric. | IDE permissioning. |
| **Cline** | Plaintext MCP config. | Native MCP. | Single-agent. | Approval prompts. |
| **Aider** | Env-var / config keys. | Recent MCP support. | Single-process pair-programmer. | Diff-approval flow. |
| **Codex CLI** | Sandbox restricts `.env`/secrets dirs by path; team baselines ("team-standard" = write project root, **no access to `.env`/secrets**). | Native MCP. | Cloud-delegated long tasks; subagents. | **Strongest sandbox story**: two axes — *approval policy* × *sandbox mode*; `--full-auto`; Docker-based, network-restricted; permission profiles (v0.135 `doctor`, profiles). |
| **Gemini CLI** | Config-based. | **MCP added early 2026.** | Single. | Approval modes. |
| **Warp** | Terminal-level. | Via agents. | Multi-session terminal; Termdock layers sessions. | Terminal. |

**Category gap (operator's direct moat):** Each tool sandboxes/permissions **itself, in isolation.** Secrets sit in plaintext per-tool configs. **There is zero coordination *between* tools** — if Claude Code (in a worktree), Codex CLI, and Cursor all touch one repo, nothing arbitrates file ownership, locks, or who-broke-main. Codex has the best *intra-tool* sandbox; **nobody owns the *inter-tool* layer.** That layer — a neutral, local, on-bus coordinator the operator already calls the harbor-master — is the unclaimed seat.

---

## 6. Recent Papers (2024–2026)

- **Open Challenges in Multi-Agent Security: Towards Secure Systems of Interacting AI Agents** — arXiv 2505.02077 (Apr 2026 rev). Secret collusion via steganographic channels, coordinated attacks, info-asymmetry manipulation. Notes LLM MAS differ from classic MAS (free-form NL protocols vs rigid APIs). [link](https://arxiv.org/abs/2505.02077)
- **Architecture Matters for Multi-Agent Security** — arXiv 2604.23459 (Apr 2026). How topology/architecture shapes MAS security.
- **Towards Adaptive, Scalable, and Robust Coordination of LLM Agents: A Dynamic Ad-Hoc Networking Perspective** — arXiv 2602.08009 (Feb 2026). Treats agents as **network hosts** that join/leave/misbehave with no central control — directly relevant to a decentralized local fleet.
- **AgenticCyOps** — arXiv 2603.09134 (Mar 2026). Securing multi-agentic AI in enterprise cyber ops.
- **OIDC-A 1.0** — arXiv 2509.25974. Agent identity, RATS/EAT attestation, delegation chains. (See §3.)
- **AGNTCY Agent Directory Service: Architecture & Implementation** — arXiv 2509.18787.
- **Executive Summary on agent auth** — arXiv 2604.23280 (2026).
- Curated tracker: **VoltAgent/awesome-ai-agent-papers** (2026 collection: engineering, memory, eval, workflows).

**Through-line:** classic MAS security (trust/reputation mgmt, Byzantine-resilient consensus, bounded-adversary coordination) is being *re-derived* for LLM agents — but now over **free-form NL channels** and with a sharp **architecture/topology dependence**. A local coordinator that imposes *structured* claims/locks/identity over the free-form chaos is exactly the "architecture matters" intervention these papers argue for.

---

## WHITESPACE MAP — what a local-first harbor-master can own

Five converging vacancies, each backed by a category above:

**1. The inter-tool coordination layer (§1, §5) — the clearest moat.**
LangGraph/Temporal/OpenAI SDK coordinate *nodes inside one runtime*. Claude Code/Codex/Cursor each sandbox *themselves*. **Nobody arbitrates multiple heterogeneous agent processes writing one live local repo.** Port Daddy's claims + locks + sessions + Coordination Guard already *are* this. Whitespace = own "the building department for the agents on this one machine," explicitly neutral across vendors. The operator's own MEMORY is a list of disasters (stranded dirty lines, destructive git on the live main checkout) that this layer prevents — eat your own dog food as the pitch.

**2. Local identity authority / SPIRE-for-laptops (§3) — the hottest-area wedge.**
Every identity effort presumes enterprise IdP, SPIRE server, or on-chain registry. **The "who is this agent on *my* machine, what's it for, what may it touch" authority is unbuilt.** Port Daddy's `project:stack:context` identities + sessions + notes are a proto-version. Whitespace = mint **short-lived per-agent local credentials**, record the **delegation chain** (OIDC-A / transaction-token `sub`+`act` shape), attest the **local execution environment** (the explicit gap all three auth layers leave open), and **bridge outward** — translate a local identity into an MCP/A2A/WIF credential when an agent leaves the harbor. Be the on-ramp from local trust to the cloud standards, not a competitor to them.

**3. Local reputation / validation ledger (§3 ERC-8004, §6 papers, task #4).**
ERC-8004 decomposes trust into **Identity / Reputation / Validation** registries — on-chain, public, wrong for a solo fleet. Mirror it **locally in SQLite (WAL)**: which agent's work landed, which broke main, which got reverted. The operator's MEMORY already names a "reputation/quality-eval ledger spine." Whitespace = the **private, local-first** version of ERC-8004's three registries.

**4. The HITL gate as a universal local primitive (§4 Payman, §5).**
Payman reinvented limits + thresholds + whitelists + manual-approval-gates **for money**. Codex reinvented approval-policy × sandbox-mode **for shell/files**. These are the *same gate*. Whitespace = a **single local human-gate primitive** (the harbor-master's guard / human-gate) that governs *any* sensitive action — git push, secret access, an x402/KYAPay payment — with one audit trail. The operator already has `human-gate-designer` and guard infra; generalize it.

**5. Secrets-stay-on-device brokering (§3, §5).**
Universal finding: local agent secrets live in **plaintext per-tool configs**, no audit, no rotation. The cloud answer is WIF/SPIFFE (no static keys). **Nobody brokers secrets *locally* across tools.** Whitespace = a local broker that hands agents **short-lived, scoped, audited** credentials instead of letting `sk-...` keys sit in `~/.claude.json` / `.cursor/mcp.json` — the WIF pattern, but on the laptop, vendor-neutral.

**One-sentence positioning:** *Everyone else is building the cloud/enterprise/on-chain Internet of Agents; the open seat is the **harbor-master for the agents on your own machine** — local identity, local reputation, local human-gates, local secret brokering, and inter-tool coordination over a live shared tree — that **bridges outward** to MCP, A2A, WIF, KYAPay rather than competing with them.*

---

**Key sources:** [MCP authorization spec](https://modelcontextprotocol.io/specification/draft/basic/authorization) · [MCP 2026-07-28 RC](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) · [LF A2A launch](https://www.linuxfoundation.org/press/linux-foundation-launches-the-agent2agent-protocol-project-to-enable-secure-intelligent-communication-between-ai-agents) · [A2A 150+ orgs](https://www.prnewswire.com/news-releases/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year-302737641.html) · [AGNTCY docs](https://docs.agntcy.org/) · [SPIFFE for agents (HashiCorp)](https://www.hashicorp.com/en/blog/spiffe-securing-the-identity-of-agentic-ai-and-non-human-actors) · [Three layers of agent auth](https://dev.to/kanywst/the-three-layers-of-ai-agent-authentication-what-id-jag-transaction-tokens-and-wif-actually-1mbk) · [OIDC-A 1.0 arXiv](https://arxiv.org/html/2509.25974v1) · [ERC-8004 EIP](https://eips.ethereum.org/EIPS/eip-8004) · [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/) · [OpenAI new agent tools](https://openai.com/index/new-tools-for-building-agents/) · [Temporal $300M/$5B](https://temporal.io/) · [LangGraph/CrewAI/AutoGen 2026](https://qubittool.com/blog/ai-agent-framework-comparison-2026) · [Inngest vs Restate 2026](https://www.pkgpulse.com/guides/inngest-vs-trigger-dev-v3-vs-restate-2026) · [E2B/Daytona/Modal/Firecracker](https://www.spheron.network/blog/ai-agent-code-execution-sandbox-e2b-daytona-firecracker/) · [Cloudflare Agents Week 2026](https://www.cloudflare.com/agents-week/updates/) · [x402 + AP2 (Coinbase)](https://www.coinbase.com/developer-platform/discover/launches/google_x402) · [Skyfire KYAPay](https://skyfire.xyz/) · [KYAPay IETF draft](https://datatracker.ietf.org/doc/draft-skyfire-kyapayprofile/) · [Payman](https://paymanai.com/) · [Codex CLI permissions/sandbox](https://developers.openai.com/codex/agent-approvals-security) · [Claude Code/Cursor/Windsurf MCP config](https://agent-drop.com/claude-code-mcp) · [Open Challenges in Multi-Agent Security](https://arxiv.org/abs/2505.02077) · [Dynamic Ad-Hoc Networking coordination](https://arxiv.org/pdf/2602.08009) · [awesome-ai-agent-papers](https://github.com/VoltAgent/awesome-ai-agent-papers)"