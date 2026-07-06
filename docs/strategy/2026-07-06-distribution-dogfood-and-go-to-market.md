# Distribution, Dogfood Milestones, And Go-To-Market

Date: 2026-07-06
Status: strategy proposal for operator review
Backing skills: `developer-surface-strategist`, `tech-launch-channels`,
`three-sided-agent-labor-market`, `mechanism-design-for-agent-labor`,
`agent-labor-pricing-function`, `indie-monetization-strategist`,
`agentic-coding-product-research`, `claude-ecosystem-promoter`,
`always-on-agent-applications`

## 1. Where does the M-wave code land? One repo. The current app. On purpose.

There is no separate clean repo, and there should not be. The Agent Harbor
foundation just merged into the *same* `port-daddy` repo that ships today:

- `lib/agent-harbor/` (event ledger, projections, probes) → the **daemon**,
  distributed via **Homebrew** (`brew … port-daddy`).
- `routes/agent-harbor.ts` → the daemon's HTTP API (same binary).
- `core/pd-console/` → the **GPUI console** app.
- `apps/FleetBar/` → the **menu-bar app**, now Developer-ID signed + notarized
  (PR #531).
- `website-v2/` → **portdaddy.dev**.

The M5–M10 waves are features *on these surfaces*, not a rewrite. This is the
product's founding discipline made literal: **Port Daddy is built by Port Daddy.**
Every wave has to survive being the operator's daily driver before it ships to
anyone else. Dogfood is the QA. A separate "clean" repo would break that loop
and let the product drift into a demo.

The only thing that is genuinely separate is **remote/hosted execution** (M10):
the relay, hosted harbors, and the marketplace settlement layer are deployed
Cloudflare Workers (`apps/relay`, `apps/fleet-executor`, `pd-email-ingress`),
already in-repo under `apps/`. Same repo, different deploy target.

## 2. "Erich can do this now" — dogfood milestones

Each binder milestone is only *done* when it changes what the operator can do
with the installed apps that day. This is the acceptance bar, restated as
capability, not code.

| Milestone | The moment it's real: "I can now…" | Surface |
|---|---|---|
| **M1–M4 (shipped)** | …launch a Claude/Codex agent and watch its real transcript, tool calls, files, cost, and compliance level in pd-console — and have destructive git blocked before it fires. The blank terminal is gone. | pd-console + daemon |
| **M5 suggestibility** (needs ADR-0096) | …have the daemon put a *verified* turn-start packet in front of my agent — inbox, conflict warning, the right skill graft — and know the agent can trust it isn't injection. | daemon + adapters |
| **M6 memory/search** | …ask "how did we deploy the relay?" and get cited results across transcripts, and watch a Longshoreman compact a full context window into a resumable packet. | pd-console + CLI |
| **M7 skill grafting (Seamanship live)** | …see the skills auto-selected and grafted onto each agent on the team proposal and the receipt — the WinDAGs graft I do by hand now, done by the daemon. | daemon + console |
| **M8 cooperative governance** | …run two agents on overlapping code and watch claims, a predicted-conflict parley, and a merge gate — the coop-harbor mock, live. | console + FleetBar |
| **M9 Harbor Editor** | …co-edit a file with an agent as a governed CRDT peer, claims rendered on the exact line ranges. | pd-console |
| **M10 cloud/mobile/team/market** | …pair my phone to interrupt a remote agent, invite a teammate into a harbor, and lease a skill pack to someone who runs it on *their* data without me seeing it. | mobile + relay + web |

The rule: no milestone is announced externally until the operator has lived on
it for a week (the soak rule, generalized from PR #681).

## 3. The product is not one product — it's seven wedges into one substrate

The operator's own list *is* the go-to-market map. Each capability is a distinct
entry point a different person discovers first, and all of them are the same
daemon underneath. This is the strategy: **many cheap front doors, one deep
house.** (`developer-surface-strategist`: match the user to the surface, don't
force one surface on everyone.)

| Wedge | Who enters here | The hook | Surface |
|---|---|---|---|
| **AI trigger + event automation** | ops-minded devs, indie hackers | "email/webhook/cron → an agent does the thing, with a receipt" — the io-wiring path, agents *write the wiring for you* | CLI + web gallery |
| **GitHub bot reviews** | any team with a repo | drop-in PR reviewer that leaves *accountable* reviews (transcript + receipt), not a black box | GitHub App |
| **Co-op vibe coding** | pairs, small teams | multiplayer editing with agents as governed peers — claims stop the merge disasters | pd-console + relay |
| **Mobile tunneling** | solo builders away from desk | "interrupt/approve my long-running agent from my phone" | mobile + relay |
| **Remote harbor** | privacy-sensitive teams | run agents on *your* infra/data; the operator never sees it | relay + hosted |
| **Skill + agent leasing** | skill authors, guild builders | "I'm best at X — charge for it; buyers run it data-blind" | marketplace |
| **Multi-agent coordination** | anyone past one agent | the whole fleet console — stop agents annihilating each other's refactors | pd-console + FleetBar |

Each wedge is independently launchable and independently monetizable, but they
compound: a GitHub-bot user discovers co-op; a trigger-automation user discovers
leasing. The moat is the substrate they all share (witnessed transcripts,
receipts, claims, compliance) — copyable features, hard-to-copy accountability.

## 4. The three-sided market (M10, but design for it now)

Per `three-sided-agent-labor-market` + `mechanism-design-for-agent-labor`:

- **Demand side** — people with tasks who lease skills/agents/orchestrators.
- **Supply side** — authors of great skills/agents/orchestrators.
- **Trust side** — neutral red-teamers and quality reviewers who *rate* them
  (the "agentic Moody's" guilds).

What makes it non-exploitative, and therefore possible: **remote harbors run
leased tech data-blind** (supplier never sees buyer data; buyer never sees
supplier IP) and **the Work Receipt is the settleable good** — a signed proof of
what ran, what it cost, and what it produced. WinDAGs already proved the premise
that grafting raises output quality; the attestable outcome log (ADR-shipped in
F0's receipt schema) is the substrate the ratings ride on. That is the
manifesto's economy, and it can bill from day one because the receipt is already
built.

## 5. Pricing and monetization (per `agent-labor-pricing-function`)

Local-first stays free forever — it's the top of the funnel and the dogfood
guarantee. Money attaches only where Port Daddy provides something a local
daemon can't:

| Tier | What's paid for | Model |
|---|---|---|
| **Local** | nothing — full solo operator, BYOK, on-device | Free |
| **Pro** | relay pairing, mobile control, encrypted sync, GitHub App, hosted triggers | Flat subscription (predictable value metric = "peace of mind + reach", not usage) |
| **Team** | shared harbors, roles, claims/parley at team scale, the human whois | Per-seat |
| **Marketplace** | leasing skills/agents/orchestrators; ratings | **Take-rate on settled receipts** (the value metric buyers can predict: they pay per delivered, receipted unit of work — not per token) |
| **Enterprise/self-host** | self-hosted relay, SSO, audit | Contract |

The pricing-trust rule (learned from Cursor/Copilot bill-shock incidents):
**cost is shown at the consent gate before it's spent**, budgets are hard caps,
and metering is transparent — which the FleetBar/coop-harbor mocks already
render (the gold consent-cost line). Trust *is* the product on a marketplace;
opaque metering would kill it.

## 6. Launch sequencing (per `tech-launch-channels`)

Don't launch "Port Daddy, the everything platform." Launch one sharp wedge at a
time, each to the community that already feels that specific pain.

1. **Now — the accountability wedge, to the Claude Code / agentic-coding crowd.**
   The story writes itself and is *true today*: "your coding agent is a blank
   terminal — here's the transcript, the cost, the compliance level, and a git
   guard, in a native app." Channels: Hacker News (Show HN, the founding-
   discipline angle — "I built this to survive building itself"), the Claude
   ecosystem (`claude-ecosystem-promoter`: MCP/skills registries, r/ClaudeAI),
   dev.to deep-dive on the witnessed-compliance ladder.
2. **M5–M7 — the automation + GitHub-bot wedges.** "Agents write your
   trigger→event→agent wiring, and it leaves receipts." The io-wiring gallery
   becomes a store. GitHub Marketplace listing for the PR reviewer.
3. **M8–M9 — co-op vibe coding.** The differentiated demo: two humans + agents
   on one file, claims preventing the collision. This is the "whoa" video.
4. **M10 — the marketplace + mobile + remote.** Only after supply exists
   (skill authors from wedge 1–2) and trust tooling (guild raters) is real.
   Launching the market before the goods and the ratings would be empty.

Cross-cutting: the **portdaddy.dev property must show the receipts** — public,
browser-verifiable Work Receipts are the marketing asset no competitor can fake,
and they double as the trust proof for the marketplace.

## 7. Open operator decisions

1. **Marketplace hosting economics** — take-rate %, who holds the settlement
   escrow (the "who holds the slash pool" question from the Spark mock), and the
   compute pass-through model for hosted harbors.
2. **Open-core line** — daemon/CLI/console open source (drives adoption + trust),
   relay/marketplace/team proprietary? This is the standard defensible split and
   fits the local-free/hosted-paid tiering.
3. **Guild governance** — are raters independent third parties, a staffed
   function, or a staked-reputation open role? Determines whether "agentic
   Moody's" is credible.
4. **Sequencing pull** — if a wedge gets organic traction out of order (e.g. the
   GitHub bot goes viral before M8), do we chase it? Recommend yes; the wedges
   are independent by design.
