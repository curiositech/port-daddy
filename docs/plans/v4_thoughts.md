
V4 How to Present the Anchor Protocol

Write it as an ADR in the existing docs/adr/ system, but also publish it as a standalone document. Here’s the structure I’d recommend:

Document: docs/anchor-protocol.md — “The Anchor Protocol: Work Agreements for Autonomous Agents”

1. Problem Statement: Agents today do work with no formal agreement about what they’ll produce, what they’ll receive, and what happens when they fail. This is the “handshake problem” — agents can’t enter binding contracts.

2. The Float Plan (pre-work declaration): Before an agent begins, it files a Float Plan — a structured declaration of:

• What I’ll do (task description, acceptance criteria)

• What I need (compute budget, file access, locks, time)

• What I expect (compensation: credits, experience, output rights)

• My deadlines (TTL, phase gates)

• My contingency (what happens if I die: salvage instructions)

3. The Anchor (the binding): Port Daddy (the harbor master/sheriff/banker) receives the Float Plan, validates it against available resources and harbor permissions, and anchors it — signs it cryptographically, records it in SQLite, and returns an Anchor Token. The agent can now work. The Anchor is the “work agreement.”

4. Payout & Settlement: When the agent calls pd done, the daemon evaluates:

• Did the work meet acceptance criteria? (quality gate)

• Was it completed within TTL?

• What notes/artifacts were produced?

• Settlement: credits transferred, experience points accrued, task outputs released to the requesting agent

5. Death & Resurrection Economics: If an agent dies mid-task:

• The Float Plan is preserved (it’s already in SQLite)

• The partial work is salvageable

• A new agent can pd salvage claim — but they’re claiming the Float Plan, not just the dead agent’s context. They inherit the agreement.

• The original agent’s partial work may earn partial credit

6. Formal Properties (the “proof”): Define the invariants:

• No work without an Anchor (prevents rogue agents)

• Anchors are non-fungible and non-transferable (except via salvage)

• The daemon is the sole arbiter of settlement (sheriff/banker)

• All state changes are atomic (SQLite transactions)

• The append-only notes system (ADR-0007) means work evidence can’t be retroactively altered

This isn’t a cryptographic proof in the academic sense — it’s a protocol specification with stated invariants, which is what you need at this stage. A formal proof (like a TLA+ spec or a Coq verification) would be impressive but premature.



2. Work Agreements, Compute Credits, Quality-Gated Pay

This is the most interesting idea in Port Daddy’s future. Let me design it:

The Economy Model

┌─────────────────────────────────────────────────┐
│                 FLOAT PLAN                       │
│                                                  │
│  task:     "Refactor auth to use JWT"           │
│  identity: myapp:api:auth-refactor              │
│  needs:    { compute: 500 credits,              │
│              files: ["src/auth/*"],              │
│              locks: ["auth-module"],             │
│              ttl: "2h" }                         │
│  offers:   { output: "working JWT auth",        │
│              artifacts: ["src/auth/jwt.ts"] }    │
│  pay:      { on_complete: 500 credits,          │
│              on_partial: "pro-rata by notes",    │
│              on_fail: 0,                         │
│              quality_bonus: 200 credits }        │
│  evaluator: myapp:critic                         │
└─────────────────────────────────────────────────┘
          │
          ▼  pd anchor (daemon validates & signs)
┌─────────────────────────────────────────────────┐
│              ANCHOR TOKEN                        │
│  anchor_id:  anch_7f3k...                       │
│  signed_by:  port-daddy-daemon                  │
│  hash:       sha256(float_plan)                 │
│  status:     ACTIVE                              │
│  escrow:     500 credits held                   │
└─────────────────────────────────────────────────┘
          │
          ▼  Agent works... dies? salvage inherits anchor
          │
          ▼  pd done (or pd salvage complete)
┌─────────────────────────────────────────────────┐
│              SETTLEMENT                          │
│  notes_count:    12                              │
│  files_modified: 3                               │
│  quality_score:  0.87 (from evaluator agent)     │
│  payout:         500 + 174 bonus = 674 credits   │
│  experience:     +87 XP (auth domain)            │
└─────────────────────────────────────────────────┘


What Are Credits?
Start with fungible compute credits — abstract units that represent “work value.” Don’t try to peg them to dollars or tokens yet. They’re internal to the Port Daddy economy:
• Every project starts with a credit pool (configurable)
• Filing a Float Plan escrows credits from the pool
• Completing work releases escrowed credits to the agent’s balance
• Agent balances persist across sessions (in SQLite)
• Credits can be used to “bid” on tasks — higher-paying tasks attract better agents
Later, you can peg credits to real compute cost (Ollama tokens, Claude API spend) if you want a real economy.
Experience Points & Agent Reputation
This is where it gets interesting:
• Agents accumulate XP by completing Anchored tasks
• XP is domain-scoped: myapp:auth:xp, myapp:api:xp
• Higher-XP agents can be preferred for harder tasks
• Agents that die frequently or produce low-quality work accumulate negative reputation
• The pd spawn command could use reputation to select which agent backend to use for which task


3. Build Security: “Isn’t Just Loose TypeScript Running on Someone’s Computer”
Yes, this is a real concern if you’re doing cryptographic signing. The current setup (TypeScript compiled and run via node) has no integrity guarantees. Here’s what you need:
Immediate (V4)
• Reproducible builds: Pin all dependencies, use npm ci, add a sha256 of the built output to each release
• Code signing: Sign npm releases with a GPG key. Users can verify: npm audit signatures
• SBOM (Software Bill of Materials): Generate with npm sbom — this is increasingly required for security-sensitive tools
• Compiled binary distribution: Use pkg or bun build --compile to produce a single binary. This is harder to tamper with than loose .js files
Later (V5+)
• Sigstore/cosign: Sign releases with Sigstore (keyless, tied to your GitHub identity). This is becoming the standard for open-source supply chain security
• Daemon self-verification: On startup, the daemon could hash its own binary and compare against a published hash
• Harbor token signing: Use ed25519 keys (not HMAC) for harbor tokens. Publish the public key so anyone can verify tokens without the daemon’s secret
For the Anchor Protocol Specifically
The daemon doesn’t need to be a blockchain — it just needs to be the trusted authority on this machine. SQLite + HMAC signing is fine for local-first. The real question is: what if the daemon is compromised? For V4, the answer is “it’s a dev tool on your own machine, not a financial system.” For later, you could add remote attestation via a cloud relay.


4. “Who Resurrects the Resurrecter?”
This is the deepest systems question you’ve asked. The daemon is a single point of failure.
Layered Resurrection Strategy
Layer 1: OS Process Manager (launchd/systemd)You already have this — launchd restarts the daemon if it crashes. This handles 90% of cases.
Layer 2: Watchdog TimerThe daemon writes a heartbeat file (~/.port-daddy/heartbeat) every 5 seconds. A separate tiny process (a “bosun” — nautical: the officer who maintains the ship) checks the heartbeat file. If it’s stale > 30 seconds, the bosun kills the daemon process and lets launchd restart it.
Layer 3: Self-Healing StateWhen the daemon starts, it runs a recovery sequence:
1. Read SQLite — it survived because it’s a file
2. Check all registered agents — mark any that missed heartbeats as stale
3. Resume all pd watch subscriptions from a persisted watch registry
4. Re-announce on all pub/sub channels: “Port Daddy is back online”
Layer 4: Client-Side RetryThe SDK and MCP server should have automatic retry with backoff. If the daemon is down for 10 seconds during a restart, clients buffer their requests and replay them.
The philosophical answer: You don’t need infinite recursion of watchers. You need two independent systems: the daemon (managed by launchd) and the data (in SQLite). As long as SQLite survives, the daemon can always reconstruct the world on restart. The data is the resurrecter.


5. Dogfooding: Using Port Daddy to Build Port Daddy
5.1 How to Do It
# In the port-daddy repo:
pd begin --identity port-daddy:core:dev --purpose "V4 development"

# Claim your own ports (the daemon is already running on 9876)
pd claim port-daddy:dashboard 9876

# Use sessions and notes to track what you're working on
pd note "Starting anchor protocol design"

# When you're done for the day:
pd done "anchor protocol ADR drafted"

5.2 Background Agents for Every Project
This is the pd fleet concept. Here’s what it would look like:
A .portdaddy/fleet.yaml file per project:

# .portdaddy/fleet.yaml
project: myapp

agents:
  docs-updater:
    backend: ollama
    model: llama3.2:8b
    purpose: "Watch for code changes, update docs"
    trigger: pd watch myapp:code:changed
    schedule: null  # event-driven only

  test-runner:
    backend: local
    purpose: "Run tests on file changes"
    trigger: pd watch myapp:files:changed
    exec: ./scripts/run-tests.sh

  adversarial-tester:
    backend: claude
    model: claude-haiku-4-5
    purpose: "Find edge cases in new features"
    schedule: "0 */4 * * *"  # every 4 hours
    trigger: pd watch myapp:feature:complete

  task-writer:
    backend: claude
    model: claude-sonnet-4-20250514
    purpose: "Break issues into tasks"
    trigger: pd watch myapp:issue:created
    
pd fleet up reads this file and spawns all agents. pd fleet down kills them. pd fleet status shows their health.
This replaces ad-hoc pd spawn commands with a declarative agent configuration — like docker-compose for agent swarms.
Does Port Daddy need cron? No — pd watch is the event-driven trigger, and for time-based triggers, you use the OS cron (crontab) to run pd msg myapp:scheduled:4h publish "tick", which fires the watch. Keep cron outside Port Daddy.
Local GUI? Yes. The pd dashboard (localhost:9876) is the right place for this. Add a “Fleet” panel that shows:
• All fleet agents and their status
• Watch hooks with message history
• A “Spawn Agent” form for ad-hoc agents
• Fleet.yaml editor
5.3 Building Port Daddy While Port Daddy is Broken
This is the classic bootstrap problem. How teams solve it:
1. Stable branch: Keep a stable branch that always passes tests. Install that version globally (npm install -g ./stable-build). Develop on main.
2. Two daemons: Run the stable daemon on port 9876 (production). Run the dev daemon on port 9877 (PD_PORT=9877 node src/server.ts). Your daily work uses 9876. Your testing uses 9877.
3. Version pinning in CI: CI always installs the last released version, not the working tree.
4. The pd self-test command: Add a command that runs Port Daddy’s own test suite using the running daemon. If self-test passes, you can pd self-upgrade to swap the running daemon for the dev build.
5.4 Episodic Long-Term Memory for Always-On Agents
This is the “Memory Keeper” archetype from your research. Design:

┌─────────────────────────────────────────────┐
│            AGENT MEMORY STORE               │
│                                             │
│  Table: agent_memory                        │
│  ┌─────────┬──────────┬───────────────────┐ │
│  │ agent   │ episode  │ content           │ │
│  ├─────────┼──────────┼───────────────────┤ │
│  │ docs:*  │ ep_001   │ "learned that..." │ │
│  │ docs:*  │ ep_002   │ "user prefers..." │ │
│  │ docs:*  │ ep_003   │ {embeddings}      │ │
│  └─────────┴──────────┴───────────────────┘ │
│                                             │
│  API:                                       │
│  pd memory store <key> <value>              │
│  pd memory recall <query> [--limit 5]       │
│  pd memory forget <key>                     │
│  pd memory episodes [--agent <id>]          │
│                                             │
│  Features:                                  │
│  - Persists across sessions (SQLite)        │
│  - Scoped by agent identity (wildcards!)    │
│  - Episodic: each memory tagged with        │
│    session_id, timestamp, context           │
│  - Semantic recall via local embeddings     │
│    (Ollama embedding model)                 │
│  - Automatic summarization: when episode    │
│    count > threshold, compress old episodes │
│    into a summary                           │
└─────────────────────────────────────────────┘










Current harbors = local permission namespaces on one daemonRemote harbors = the same thing, but the daemon is on someone else’s machine (or a cloud instance)
There’s no reason to have two concepts. A harbor is the unit of collaboration, whether local or remote. pd team should just be pd harbor connect <lighthouse-url>.
Should Every Project Default to a Harbor?
Yes. This is a strong instinct. Here’s why:
Right now, agents operate in a kind of implicit global namespace on the local daemon — any agent can claim any port, read any notes, publish to any channel. That’s fine for solo use but it’s a security posture of “no walls, no doors.” Even locally, you probably don’t want a rogue spawned agent modifying files claimed by another agent’s session.
The default harbor would be:

# Automatically created on `pd begin` or `pd scan`
harbor: myapp           # named after the project
scope:  myapp:*         # controls everything under this identity prefix
caps:   [all]           # full permissions for the creating agent
auto:   true            # created implicitly, not manually

Every pd begin --identity myapp:api:feature would automatically operate within the myapp harbor. No ceremony required — you don’t even see it unless you look. But the mechanism is there, which means:
• When you add a second agent, it requests a token for the harbor
• When you go remote, the harbor is already the unit of sharing
• When you add the anchor protocol, the harbor is where credits live
• Audit logs are scoped to a harbor, not globally
Default security that’s invisible until you need it. Like how HTTPS is the default now — you don’t think about it until you try to do something that requires the certificate.


Part 2: Lighthouses — The Global Registry
I love the name. A lighthouse is a remote daemon that advertises its harbors to the network. Here’s how I’d design it:
Architecture

                    ┌──────────────────────────┐
                    │    LIGHTHOUSE REGISTRY    │
                    │    (lighthouse.pd.dev)    │
                    │                          │
                    │  ┌────────────────────┐  │
                    │  │ Harbor Directory   │  │
                    │  │                    │  │
                    │  │ alice:myapp        │  │
                    │  │ bob:gameserver     │  │
                    │  │ acme:platform      │  │
                    │
















The barrier isn’t technical — it’s trust and sandboxing. Port Daddy’s harbor system is the right primitive for this: each connector gets a harbor token with minimal capabilities.



6. Universal Tokens & Wildcards

You’re absolutely right that the project:stack:context identity system should become the universal addressing scheme for everything

‘’’
myservice:web:feature         ← agent/session
myservice:web:secondfeature   ← another agent
myservice:api:feature         ← API agent
myservice:*                   ← all of myservice
myservice:web:*               ← all web agents
*:*:feature                   ← all "feature" contexts

# Extended to resources:
myservice:web:feature:files:src/auth/*     ← file claims
myservice:web:feature:locks:auth-module    ← locks
myservice:web:feature:memory:ep_003        ← memory episodes
myservice:web:feature:anchor:anch_7f3k     ← float plan anchors
myservice:web:feature:tasks:task_01        ← task definitions

# Wildcard queries:
pd query myservice:*:*:files:*    → all file claims across myservice
pd query *:*:*:locks:*            → all locks everywhere
pd query myservice:web:*:tasks:*  → all tasks for web stack

‘’’
This is the Universal Token Namespace — everything in Port Daddy addressable by one hierarchical scheme. The existing SQL LIKE pattern matching (from ADR-0003) extends naturally.

`pd scan` Is Underbuilt

You’re right. Currently pd scan detects frameworks and assigns ports. It should also:

• Detect agent configuration (.portdaddy/fleet.yaml)

• Map dependencies between services (API imports from DB, frontend calls API)

• Generate a service graph (visual in dashboard)

• Suggest identities based on directory structure

• Detect test suites and register them as adversarial agents

• Find existing .env files and import port assignments

• Recursive monorepo scan with depth control



7. The Complete V4 Roadmap (Revised)

Phase 0: Foundation (Now → Q2 2026)

Fix what’s broken, start dogfooding

ItemDescriptionWhy NowFix GitHub linkNav.tsx and App.tsx point to wrong repoEvery visitor gets a 404Tutorial routesAdd /tutorials/:slug routing + content12 tutorials all 404Stable branch workflowMaintain stable for dogfooding while building on mainUnblocks eating your own dogfoodpd self-testCommand that validates the running daemonBootstrap confidenceAnchor Protocol ADRWrite ADR-0011: formal protocol specMust exist before implementationCLI monolith splitBreak up 4000+ line CLI fileDeveloper velocityUniversal token namespace designExtend project:stack:context to resourcesArchitectural foundation for everything belowPhase 1: The Economy (Q2–Q3 2026)

Float Plans, Anchors, Credits, Quality Gates

ItemDescriptionRevenue ImpactFloat Planspd anchor file <plan.yaml> — declare work agreementsCore differentiatorAnchor tokensDaemon validates, signs, and escrows Float PlansTrust primitiveCredit systemPer-project credit pools, agent balances, escrowEconomy foundationQuality gatesEvaluator agents score work, gate payoutsQuality assuranceExperience pointsDomain-scoped XP, agent reputationAgent selectionPartial credit on deathSalvaged agents earn pro-rata based on notesIncentivizes good note-takingEnforced harborsReal permission enforcement (not advisory)Security requirement for creditsBuild signingReproducible builds, npm signatures, SBOMTrust requirement for cryptoPhase 2: Fleet & Memory (Q3–Q4 2026)

Always-on agents, episodic memory, fleet management

ItemDescriptionRevenue Impact.portdaddy/fleet.yamlDeclarative agent fleet configurationSimplifies multi-agent setuppd fleet up/down/statusManage fleet lifecycleUser-facing simplicityEpisodic memorypd memory store/recall/forgetAgent intelligence over timeSemantic recallOllama embeddings for memory search“Agents that learn”Memory compressionAuto-summarize old episodesPrevents unbounded growthDeep pd scanDependency graphs, test detection, identity suggestionsMakes onboarding magicalDashboard Fleet panelVisual fleet management, watch hooks, spawn UILocal GUI for everythingBosun watchdogSeparate process that resurrects the daemon“Who resurrects the resurrecter” solvedWindows supportPlatform adapter for ps/lsof2-3x user basePhase 3: Connectors & Life Integration (Q4 2026 – Q1 2027)

External data, coaching agents, personal OS

ItemDescriptionRevenue ImpactConnector frameworkRead-only integrations (Gmail, GCal, GitHub)Life integrationOutbound firewallGET-only by default, POST/PUT approval queueTrust & safetyApproval dashboardHuman-in-the-loop for agent writesSecurity UXCoaching agent templatePre-built coach with daily brief, skill tracking“Killer app” for personal useSandboxed connector processesEach connector isolatedDefense in depthVS Code extensionFile claims in gutter, session sidebar, salvage alertsDaily active usagePhase 4: Platform & Revenue (Q1–Q2 2027)

Cloud relay, marketplace, enterprise

ItemDescriptionRevenue ImpactRemote coordination relayMulti-machine daemon syncTeam tier ($99/mo)Cloud pd spawnLaunch agents on cloud computeUsage-based revenueAgent recipe marketplaceCurated fleet templates, 20% cutEcosystem revenueEnterprise licenseSelf-hosted relay, SAML, audit logs$500-2000/moGitHub ActionCI port coordination, PR commentsEcosystem reachA2A protocol supportAgents serve Agent Cards, cross-tool discoveryIndustry standard alignmentFormal TLA+ specProve anchor protocol invariantsAcademic credibilityMonetization Tiers (Revised)

Free (OSS)Pro ($29/seat/mo)Team ($99/team/mo)EnterpriseDaemon, CLI, SDK, MCP✅✅✅✅Sessions, salvage, pub/sub✅✅✅✅Fleet (up to 3 agents)✅✅✅✅Fleet (unlimited agents)❌✅✅✅Anchor Protocol & Credits❌✅✅✅Episodic Memory❌✅✅✅Enforced Harbors❌✅✅✅Session Replays❌✅✅✅Connectors (3 max)❌✅✅✅Connectors (unlimited)❌❌✅✅Remote Relay❌❌✅✅Cloud Spawn❌❌pay-per-use✅SAML/SSO, audit logs❌❌❌✅On-prem relay❌❌❌✅

The Narrative Arc

V3 (now): “Port Daddy coordinates agents on your machine.”V4 (economy): “Port Daddy is where agents enter work agreements.”V5 (platform): “Port Daddy is the operating system for autonomous agent teams.”

The anchor protocol is the conceptual center of V4. Everything else — credits, memory, fleets, quality gates — orbits around the idea that work should be declared, agreed upon, and settled, not just started and hoped for. That’s a genuinely new primitive in the agent coordination space, and it’s the thing worth writing the white paper about.

Would you like me to create a PR with the Anchor Protocol ADR (ADR-0011) to get this into the repo?

What Are Credits?

Start with fungible compute credits — abstract units that represent “work value.” Don’t try to peg them to dollars or tokens yet. They’re internal to the Port Daddy economy:

• Every project starts with a credit pool (configurable)

• Filing a Float Plan escrows credits from the pool

• Completing work releases escrowed credits to the agent’s balance

• Agent balances persist across sessions (in SQLite)

• Credits can be used to “bid” on tasks — higher-paying tasks attract better agents

Later, you can peg credits to real compute cost (Ollama tokens, Claude API spend) if you want a real economy.

Experience Points & Agent Reputation

This is where it gets interesting:

• Agents accumulate XP by completing Anchored tasks

• XP is domain-scoped: myapp:auth:xp, myapp:api:xp

• Higher-XP agents can be preferred for harder tasks

• Agents that die frequently or produce low-quality work accumulate negative reputation

• The pd spawn command could use reputation to select which agent backend to use for which task


Current harbors = local permission namespaces on one daemonRemote harbors = the same thing, but the daemon is on someone else’s machine (or a cloud instance)
There’s no reason to have two concepts. A harbor is the unit of collaboration, whether local or remote. pd team should just be pd harbor connect <lighthouse-url>.
Should Every Project Default to a Harbor?
Yes. This is a strong instinct. Here’s why:
Right now, agents operate in a kind of implicit global namespace on the local daemon — any agent can claim any port, read any notes, publish to any channel. That’s fine for solo use but it’s a security posture of “no walls, no doors.” Even locally, you probably don’t want a rogue spawned agent modifying files claimed by another agent’s session.
The default harbor would be:

# Automatically created on `pd begin` or `pd scan`
harbor: myapp           # named after the project
scope:  myapp:*         # controls everything under this identity prefix
caps:   [all]           # full permissions for the creating agent
auto:   true            # created implicitly, not manually

Every pd begin --identity myapp:api:feature would automatically operate within the myapp harbor. No ceremony required — you don’t even see it unless you look. But the mechanism is there, which means:
• When you add a second agent, it requests a token for the harbor
• When you go remote, the harbor is already the unit of sharing
• When you add the anchor protocol, the harbor is where credits live
• Audit logs are scoped to a harbor, not globally
Default security that’s invisible until you need it. Like how HTTPS is the default now — you don’t think about it until you try to do something that requires the certificate.


Part 2: Lighthouses — The Global Registry
I love the name. A lighthouse is a remote daemon that advertises its harbors to the network. Here’s how I’d design it:
Architecture

                    ┌──────────────────────────┐
                    │    LIGHTHOUSE REGISTRY    │
                    │    (lighthouse.pd.dev)    │
                    │                          │
                    │  ┌────────────────────┐  │
                    │  │ Harbor Directory   │  │
                    │  │                    │  │
                    │  │ alice:myapp        │  │
                    │  │ bob:gameserver     │  │
                    │  │ acme:platform      │  │
                    │




3. Build Security: “Isn’t Just Loose TypeScript Running on Someone’s Computer”

Yes, this is a real concern if you’re doing cryptographic signing. The current setup (TypeScript compiled and run via node) has no integrity guarantees. Here’s what you need:

Immediate (V4)

• Reproducible builds: Pin all dependencies, use npm ci, add a sha256 of the built output to each release

• Code signing: Sign npm releases with a GPG key. Users can verify: npm audit signatures

• SBOM (Software Bill of Materials): Generate with npm sbom — this is increasingly required for security-sensitive tools

• Compiled binary distribution: Use pkg or bun build --compile to produce a single binary. This is harder to tamper with than loose .js files

Later (V5+)

• Sigstore/cosign: Sign releases with Sigstore (keyless, tied to your GitHub identity). This is becoming the standard for open-source supply chain security

• Daemon self-verification: On startup, the daemon could hash its own binary and compare against a published hash

• Harbor token signing: Use ed25519 keys (not HMAC) for harbor tokens. Publish the public key so anyone can verify tokens without the daemon’s secret

For the Anchor Protocol Specifically

The daemon doesn’t need to be a blockchain — it just needs to be the trusted authority on this machine. SQLite + HMAC signing is fine for local-first. The real question is: what if the daemon is compromised? For V4, the answer is “it’s a dev tool on your own machine, not a financial system.” For later, you could add remote attestation via a cloud relay.



4. “Who Resurrects the Resurrecter?”

This is the deepest systems question you’ve asked. The daemon is a single point of failure.

Layered Resurrection Strategy

Layer 1: OS Process Manager (launchd/systemd)You already have this — launchd restarts the daemon if it crashes. This handles 90% of cases.

Layer 2: Watchdog TimerThe daemon writes a heartbeat file (~/.port-daddy/heartbeat) every 5 seconds. A separate tiny process (a “bosun” — nautical: the officer who maintains the ship) checks the heartbeat file. If it’s stale > 30 seconds, the bosun kills the daemon process and lets launchd restart it.

Layer 3: Self-Healing StateWhen the daemon starts, it runs a recovery sequence:

1. Read SQLite — it survived because it’s a file

2. Check all registered agents — mark any that missed heartbeats as stale

3. Resume all pd watch subscriptions from a persisted watch registry

4. Re-announce on all pub/sub channels: “Port Daddy is back online”

Layer 4: Client-Side RetryThe SDK and MCP server should have automatic retry with backoff. If the daemon is down for 10 seconds during a restart, clients buffer their requests and replay them.

The philosophical answer: You don’t need infinite recursion of watchers. You need two independent systems: the daemon (managed by launchd) and the data (in SQLite). As long as SQLite survives, the daemon can always reconstruct the world on restart. The data is the resurrecter.



5. Dogfooding: Using Port Daddy to Build Port Daddy

5.1 How to Do It

# In the port-daddy repo:
pd begin --identity port-daddy:core:dev --purpose "V4 development"

# Claim your own ports (the daemon is already running on 9876)
pd claim port-daddy:dashboard 9876

# Use sessions and notes to track what you're working on
pd note "Starting anchor protocol design"

# When you're done for the day:
pd done "anchor protocol ADR drafted"

5.2 Background Agents for Every Project

This is the pd fleet concept. Here’s what it would look like:

A .portdaddy/fleet.yaml file per project:

# .portdaddy/fleet.yaml
project: myapp

agents:
  docs-updater:
    backend: ollama
    model: llama3.2:8b
    purpose: "Watch for code changes, update docs"
    trigger: pd watch myapp:code:changed
    schedule: null  # event-driven only

  test-runner:
    backend: local
    purpose: "Run tests on file changes"
    trigger: pd watch myapp:files:changed
    exec: ./scripts/run-tests.sh

  adversarial-tester:
    backend: claude
    model: claude-haiku-4-5
    purpose: "Find edge cases in new features"
    schedule: "0 */4 * * *"  # every 4 hours
    trigger: pd watch myapp:feature:complete

  task-writer:
    backend: claude
    model: claude-sonnet-4-20250514
    purpose: "Break issues into tasks"
    trigger: pd watch myapp:issue:created

pd fleet up reads this file and spawns all agents. pd fleet down kills them. pd fleet status shows their health.

This replaces ad-hoc pd spawn commands with a declarative agent configuration — like docker-compose for agent swarms.

Does Port Daddy need cron? No — pd watch is the event-driven trigger, and for time-based triggers, you use the OS cron (crontab) to run pd msg myapp:scheduled:4h publish "tick", which fires the watch. Keep cron outside Port Daddy.

Local GUI? Yes. The pd dashboard (localhost:9876) is the right place for this. Add a “Fleet” panel that shows:

• All fleet agents and their status

• Watch hooks with message history

• A “Spawn Agent” form for ad-hoc agents

• Fleet.yaml editor

5.3 Building Port Daddy While Port Daddy is Broken

This is the classic bootstrap problem. How teams solve it:

1. Stable branch: Keep a stable branch that always passes tests. Install that version globally (npm install -g ./stable-build). Develop on main.

2. Two daemons: Run the stable daemon on port 9876 (production). Run the dev daemon on port 9877 (PD_PORT=9877 node src/server.ts). Your daily work uses 9876. Your testing uses 9877.

3. Version pinning in CI: CI always installs the last released version, not the working tree.

4. The pd self-test command: Add a command that runs Port Daddy’s own test suite using the running daemon. If self-test passes, you can pd self-upgrade to swap the running daemon for the dev build.

5.4 Episodic Long-Term Memory for Always-On Agents

This is the “Memory Keeper” archetype from your research. Design:

┌─────────────────────────────────────────────┐
│            AGENT MEMORY STORE               │
│                                             │
│  Table: agent_memory                        │
│  ┌─────────┬──────────┬───────────────────┐ │
│  │ agent   │ episode  │ content           │ │
│  ├─────────┼──────────┼───────────────────┤ │
│  │ docs:*  │ ep_001   │ "learned that..." │ │
│  │ docs:*  │ ep_002   │ "user prefers..." │ │
│  │ docs:*  │ ep_003   │ {embeddings}      │ │
│  └─────────┴──────────┴───────────────────┘ │
│                                             │
│  API:                                       │
│  pd memory store <key> <value>              │
│  pd memory recall <query> [--limit 5]       │
│  pd memory forget <key>                     │
│  pd memory episodes [--agent <id>]          │
│                                             │
│  Features:                                  │
│  - Persists across sessions (SQLite)        │
│  - Scoped by agent identity (wildcards!)    │
│  - Episodic: each memory tagged with        │
│    session_id, timestamp, context           │
│  - Semantic recall via local embeddings     │
│    (Ollama embedding model)                 │
│  - Automatic summarization: when episode    │
│    count > threshold, compress old episodes │
│    into a summary                           │
└─────────────────────────────────────────────┘

he key insight: sessions are already episodic memory. Session notes are episode records. What’s missing is:

• Cross-session recall (query notes from all past sessions for an identity)

• Semantic search (not just chronological)

• Automatic compression (summarize old episodes)

• Agent-scoped access (only myapp:docs:* agents can read myapp:docs:* memories)

5.5 Life Integration: Email, Calendar, Texts, Coaching

This is the “personal OS” vision. Port Daddy could enable it, but with strict boundaries:

Architecture: Integration via Connectors

# .portdaddy/connectors.yaml
connectors:
  gmail:
    type: gmail-readonly    # READ-ONLY
    scope: "label:inbox"
    poll: "*/5 * * * *"     # every 5 min
    publishes: life:email:new

  calendar:
    type: gcal-readonly
    poll: "*/15 * * * *"
    publishes: life:calendar:upcoming

  github:
    type: github-webhook
    events: [issues, pull_request]
    publishes: life:github:event

Security model — exactly as you described:

• GET only: Connectors can read external data and publish to PD channels

• No writes: No POST/PUT to external services without explicit human approval

• Outbound firewall: Agents can read from connectors but cannot make arbitrary HTTP requests. The daemon is the only process that touches external APIs.

• Approval queue: If an agent wants to write (send an email, create a calendar event, push code), it goes to an approval queue in the dashboard. You approve/deny from the GUI.

• Sandboxed connectors: Each connector runs in a separate process with limited permissions. A compromised email connector can’t access your calendar connector.

The coaching agent:

agents:
  coach:
    backend: claude
    model: claude-sonnet-4-20250514
    purpose: "Daily coaching on [skill goals]"
    memory: life:coach    # persistent memory namespace
    reads:
      - life:calendar:upcoming
      - life:github:event
      - port-daddy:*:done   # all completed work sessions
    schedule: "0 9 * * *"  # daily at 9am
    output: life:coach:daily-brief

The barrier isn’t technical — it’s trust and sandboxing. Port Daddy’s harbor system is the right primitive for this: each connector gets a harbor token with minimal capabilities.



6. Universal Tokens & Wildcards

You’re absolutely right that the project:stack:context identity system should become the universal addressing scheme for everything:

myservice:web:feature         ← agent/session
myservice:web:secondfeature   ← another agent
myservice:api:feature         ← API agent
myservice:*                   ← all of myservice
myservice:web:*               ← all web agents
*:*:feature                   ← all "feature" contexts

# Extended to resources:
myservice:web:feature:files:src/auth/*     ← file claims
myservice:web:feature:locks:auth-module    ← locks
myservice:web:feature:memory:ep_003        ← memory episodes
myservice:web:feature:anchor:anch_7f3k     ← float plan anchors
myservice:web:feature:tasks:task_01        ← task definitions

# Wildcard queries:
pd query myservice:*:*:files:*    → all file claims across myservice
pd query *:*:*:locks:*            → all locks everywhere
pd query myservice:web:*:tasks:*  → all tasks for web stack


This is the Universal Token Namespace — everything in Port Daddy addressable by one hierarchical scheme. The existing SQL LIKE pattern matching (from ADR-0003) extends naturally.

`pd scan` Is Underbuilt

You’re right. Currently pd scan detects frameworks and assigns ports. It should also:

• Detect agent configuration (.portdaddy/fleet.yaml)

• Map dependencies between services (API imports from DB, frontend calls API)

• Generate a service graph (visual in dashboard)

• Suggest identities based on directory structure

• Detect test suites and register them as adversarial agents

• Find existing .env files and import port assignments

• Recursive monorepo scan with depth control



7. The Complete V4 Roadmap (Revised)

Phase 0: Foundation (Now → Q2 2026)

Fix what’s broken, start dogfooding

ItemDescriptionWhy NowFix GitHub linkNav.tsx and App.tsx point to wrong repoEvery visitor gets a 404Tutorial routesAdd /tutorials/:slug routing + content12 tutorials all 404Stable branch workflowMaintain stable for dogfooding while building on mainUnblocks eating your own dogfoodpd self-testCommand that validates the running daemonBootstrap confidenceAnchor Protocol ADRWrite ADR-0011: formal protocol specMust exist before implementationCLI monolith splitBreak up 4000+ line CLI fileDeveloper velocityUniversal token namespace designExtend project:stack:context to resourcesArchitectural foundation for everything belowPhase 1: The Economy (Q2–Q3 2026)

Float Plans, Anchors, Credits, Quality Gates

ItemDescriptionRevenue ImpactFloat Planspd anchor file <plan.yaml> — declare work agreementsCore differentiatorAnchor tokensDaemon validates, signs, and escrows Float PlansTrust primitiveCredit systemPer-project credit pools, agent balances, escrowEconomy foundationQuality gatesEvaluator agents score work, gate payoutsQuality assuranceExperience pointsDomain-scoped XP, agent reputationAgent selectionPartial credit on deathSalvaged agents earn pro-rata based on notesIncentivizes good note-takingEnforced harborsReal permission enforcement (not advisory)Security requirement for creditsBuild signingReproducible builds, npm signatures, SBOMTrust requirement for cryptoPhase 2: Fleet & Memory (Q3–Q4 2026)

Always-on agents, episodic memory, fleet management

ItemDescriptionRevenue Impact.portdaddy/fleet.yamlDeclarative agent fleet configurationSimplifies multi-agent setuppd fleet up/down/statusManage fleet lifecycleUser-facing simplicityEpisodic memorypd memory store/recall/forgetAgent intelligence over timeSemantic recallOllama embeddings for memory search“Agents that learn”Memory compressionAuto-summarize old episodesPrevents unbounded growthDeep pd scanDependency graphs, test detection, identity suggestionsMakes onboarding magicalDashboard Fleet panelVisual fleet management, watch hooks, spawn UILocal GUI for everythingBosun watchdogSeparate process that resurrects the daemon“Who resurrects the resurrecter” solvedWindows supportPlatform adapter for ps/lsof2-3x user basePhase 3: Connectors & Life Integration (Q4 2026 – Q1 2027)

External data, coaching agents, personal OS

ItemDescriptionRevenue ImpactConnector frameworkRead-only integrations (Gmail, GCal, GitHub)Life integrationOutbound firewallGET-only by default, POST/PUT approval queueTrust & safetyApproval dashboardHuman-in-the-loop for agent writesSecurity UXCoaching agent templatePre-built coach with daily brief, skill tracking“Killer app” for personal useSandboxed connector processesEach connector isolatedDefense in depthVS Code extensionFile claims in gutter, session sidebar, salvage alertsDaily active usagePhase 4: Platform & Revenue (Q1–Q2 2027)

Cloud relay, marketplace, enterprise

ItemDescriptionRevenue ImpactRemote coordination relayMulti-machine daemon syncTeam tier ($99/mo)Cloud pd spawnLaunch agents on cloud computeUsage-based revenueAgent recipe marketplaceCurated fleet templates, 20% cutEcosystem revenueEnterprise licenseSelf-hosted relay, SAML, audit logs$500-2000/moGitHub ActionCI port coordination, PR commentsEcosystem reachA2A protocol supportAgents serve Agent Cards, cross-tool discoveryIndustry standard alignmentFormal TLA+ specProve anchor protocol invariantsAcademic credibilityMonetization Tiers (Revised)

Free (OSS)Pro ($29/seat/mo)Team ($99/team/mo)EnterpriseDaemon, CLI, SDK, MCP✅✅✅✅Sessions, salvage, pub/sub✅✅✅✅Fleet (up to 3 agents)✅✅✅✅Fleet (unlimited agents)❌✅✅✅Anchor Protocol & Credits❌✅✅✅Episodic Memory❌✅✅✅Enforced Harbors❌✅✅✅Session Replays❌✅✅✅Connectors (3 max)❌✅✅✅Connectors (unlimited)❌❌✅✅Remote Relay❌❌✅✅Cloud Spawn❌❌pay-per-use✅SAML/SSO, audit logs❌❌❌✅On-prem relay❌❌❌✅

The Narrative Arc

V3 (now): “Port Daddy coordinates agents on your machine.”V4 (economy): “Port Daddy is where agents enter work agreements.”V5 (platform): “Port Daddy is the operating system for autonomous agent teams.”

The anchor protocol is the conceptual center of V4. Everything else — credits, memory, fleets, quality gates — orbits around the idea that work should be declared, agreed upon, and settled, not just started and hoped for. That’s a genuinely new primitive in the agent coordination space, and it’s the thing worth writing the white paper about.





Our harbor design:
• Harbor = the universal unit of collaboration, trust, and scope
• Local harbor = a harbor on your daemon (what exists today, minus the “advisory” weakness)
• Remote harbor = a harbor on someone else’s daemon
• Lighthouse = a daemon that advertises its harbors to the network (your naming, which is perfect)

2. Default Harbors: , Always

 Right now, agents operate in an implicit global namespace — any agent can claim any port, read any notes, publish to any channel. That’s the equivalent of running everything as root.

The Default Harbor Design

Every project gets an implicit harbor on first pd begin or pd scan:

# Automatically created, invisible unless you look
harbor: myapp                    # named after project
scope:  myapp:**                 # everything under this prefix
owner:  erich@local              # the human who created it
default_caps: [all]              # full access for local agents
remote_caps: [read, notes:write] # restricted for visiting agents
created: auto                    # not manually created


You never see it. You never configure it. But the walls exist, which means:

• Adding a second developer = issuing them a harbor token (not redesigning security)

• Going remote = the harbor is already the unit of sharing

• Anchor protocol credits live in the harbor’s ledger

• Audit logs are scoped per harbor, not globally

• A rogue spawned agent can’t escape its harbor

It’s like how every Unix process has a UID even if you never think about permissions. The mechanism is always there. You only notice it when you need it.



3. Lighthouses: The Global Registry

This is where the real architectural thinking lives. A lighthouse is a daemon that says “I exist, here are my harbors, here’s what I offer.”

The Discovery Problem

How does your daemon find other daemons? Three options, and I think you need all three at different scales:

┌─────────────────────────────────────────────────────┐
│              DISCOVERY LAYERS                        │
│                                                      │
│  Layer 1: Local Network (mDNS/Bonjour)              │
│  ┌─────────────────────────────────────────────┐    │
│  │ pd lighthouse announce                       │    │
│  │ → Broadcasts on local network                │    │
│  │ → Other PD daemons auto-discover             │    │
│  │ → Perfect for: same office, same wifi,       │    │
│  │   tandem vibe coding on the couch            │    │
│  │ → Zero config, zero internet                 │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  Layer 2: Relay (lighthouse.portdaddy.dev)           │
│  ┌─────────────────────────────────────────────┐    │
│  │ pd lighthouse publish --relay                │    │
│  │ → Registers with central relay server        │    │
│  │ → Relay brokers connections (no direct IP)   │    │
│  │ → Perfect for: remote teams, cross-network   │    │
│  │ → Relay sees metadata only, not traffic      │    │
│  │ → This is where Curiositech runs a service   │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  Layer 3: Public Registry (open federation)          │
│  ┌─────────────────────────────────────────────┐    │
│  │ pd lighthouse publish --public               │    │
│  │ → Listed in a public directory               │    │
│  │ → Anyone can browse and request access       │    │
│  │ → Perfect for: open source, marketplaces,    │    │
│  │   "I offer GPU compute to the network"       │    │
│  │ → This is the long game                      │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
└─────────────────────────────────────────────────────┘

What a Lighthouse Advertises

Borrowing from A2A Agent Cards (which your research already identified):

// GET https://alice-macbook.lighthouse.portdaddy.dev/.well-known/lighthouse.json
{
  "name": "alice-dev",
  "version": "4.2.0",
  "owner": "alice@curiositech.com",
  "harbors": [
    {
      "id": "myapp",
      "scope": "myapp:**",
      "visibility": "team",           
      "offers": {
        "agents": true,
        "compute": false,
        "memory": true,
        "files": ["src/auth/**", "src/api/**"]
      },
      "requires": {
        "auth": "harbor-token",
        "min_reputation": 50
      },
      "economy": {
        "credit_pool": 10000,
        "accepts_anchors": true,
        "bid_floor": 10
      }
    }
  ],
  "capabilities": ["sessions", "salvage", "pub-sub", "dns", "spawn"],
  "uptime": "99.2%",
  "agents_active": 3
}

The User Experience: Sending Agents to a Remote Harbor

Scenario 1: Tandem Vibe Coding (Layer 1 — local network)

# Alice's machine
pd lighthouse announce
# → Broadcasting on local network...
# → Lighthouse: alice-dev (3 harbors, 2 agents active)

# Bob's machine (same network)
pd lighthouse scan
# → Found 1 lighthouse:
# →   alice-dev (192.168.1.42) — harbors: myapp, gameserver

pd harbor connect alice-dev:myapp
# → Requesting access to alice-dev:myapp...
# → Alice must approve (or auto-approve if pre-authorized)

# Alice sees:
# → 🔔 Bob (bob-dev) requests access to harbor myapp
# → Capabilities requested: notes:write, files:read, pub-sub
# → [Approve] [Deny] [Approve with limits]

# After approval:
pd begin --identity myapp:api:bob-feature --harbor alice-dev:myapp
# → Session started on REMOTE harbor alice-dev:myapp
# → Your notes are visible to Alice's agents
# → Your file claims are coordinated with Alice's agents
# → Pub/sub messages flow between both daemons

Both humans see each other’s agents in their dashboards. File claims prevent conflicts. Notes flow bidirectionally. It’s like pair programming but with your AI agents also pair programming with each other.

Scenario 2: Autonomous Agent Dispatch (Layer 2 — relay)

# You have a task that needs GPU compute you don't have
pd anchor file --plan task.yaml
# task.yaml says: needs { compute: "gpu", model: "llama-70b" }

pd harbor search --capability compute:gpu --relay
# → Found 3 lighthouses offering GPU compute:
# →   gpu-cluster-01    (acme.lighthouse.pd.dev)    $0.02/min
# →   alice-homelab     (alice.lighthouse.pd.dev)   $0.01/min  
# →   free-tier-lambda  (community.pd.dev)          free (queue)

pd anchor dispatch task.yaml --harbor gpu-cluster-01
# → Float Plan anchored on gpu-cluster-01
# → Agent spawned remotely
# → Watching for results on channel myapp:task:result
# → Escrow: 200 credits → gpu-cluster-01 ledger

Your agent’s work runs on someone else’s machine, inside their harbor, with the anchor protocol ensuring the work agreement is honored. You get results back. They get credits.

Scenario 3: Open Marketplace (Layer 3 — public)

pd harbor publish myapp:security-review --public \
  --description "Security audit of Node.js auth system" \
  --offers "code:read, vulnerability-report" \
  --accepts-bids \
  --bid-floor 500 credits

# An agent on the public registry sees this and bids:
# → Agent sec-auditor-pro (reputation: 94, XP: 2300 in security)
# → Bid: 450 credits, estimated 2 hours
# → Anchor: will produce vulnerability report + fix suggestions

# You review the bid in your dashboard:
# → [Accept] [Counter] [Reject]

# On acceptance:
# → Anchor signed by both daemons
# → Credits escrowed
# → Agent gets scoped harbor token (code:read only)
# → Agent works, produces report
# → You review, approve settlement
# → Credits released

4. Agent Transactions: The Full Design

The Transaction Lifecycle

    REQUESTER                    DAEMON                     WORKER
    ─────────                    ──────                     ──────
        │                          │                          │
   1. File Float Plan ────────▶   │                          │
        │                    Validate plan                    │
        │                    Check credit balance             │
        │                    Escrow credits                   │
        │               ◀─── Anchor Token ────                │
        │                          │                          │
   2. Broadcast/Direct ────────▶  │                          │
        │                    Route to worker                  │
        │                          │ ──── Offer ────────▶     │
        │                          │                     Review
        │                          │ ◀─── Accept/Bid ────     │
        │                          │                          │
   3.   │                    Sign bilateral anchor            │
        │                          │ ──── Anchor Token ──▶    │
        │                          │                     Work │
        │                          │ ◀─── Heartbeats ────     │
        │                          │ ◀─── Notes ─────────     │
        │                          │                          │
   4.   │                          │ ◀─── pd done ───────     │
        │                    Evaluate:                        │
        │                     - Acceptance criteria met?      │
        │                     - Within TTL?                   │
        │                     - Quality score?                │
        │                          │                          │
   5.   │               ◀─── Settlement ─────────────────▶    │
        │                    Release escrow                   │
        │                    Transfer credits                 │
        │                    Award XP                         │
        │                    Record in ledger                 │
        │                          │                          │

What Happens When the Worker Dies

   WORKER dies mid-task
        │
   Daemon detects (heartbeat timeout)
        │
   ┌─ Anchor status → SUSPENDED (not FAILED)
   │   Credits remain in escrow
   │   Work preserved in session notes
   │   Float Plan available for re-anchor
   │
   ├─ Option A: Self-resurrection
   │   Worker's daemon restarts it (bosun/launchd)
   │   Worker calls pd anchor resume <anchor_id>
   │   Daemon verifies identity, resumes anchor
   │   No credit penalty (same agent, same work)
   │
   ├─ Option B: Salvage by another agent
   │   New agent: pd salvage claim <dead_agent>
   │   New agent inherits the anchor
   │   Original agent gets partial credit (pro-rata by notes)
   │   New agent completes work, gets remaining credit
   │
   └─ Option C: Timeout → FAILED
       TTL expires with no resume or salvage
       Credits returned to requester (minus small fee)
       Work preserved in archive (still readable)
       Requester can re-anchor with new worker

The Anchor Data Structure

CREATE TABLE anchors (
  id            TEXT PRIMARY KEY,        -- anch_7f3k...
  harbor_id     TEXT NOT NULL,           -- which harbor this lives in
  requester_id  TEXT NOT NULL,           -- who filed the float plan
  worker_id     TEXT,                    -- who accepted (null until accepted)
  session_id    TEXT,                    -- linked session
  
  -- The Float Plan
  plan_hash     TEXT NOT NULL,           -- sha256 of the original plan
  task          TEXT NOT NULL,           -- what to do
  acceptance    TEXT,                    -- JSON: criteria for completion
  needs         TEXT,                    -- JSON: { compute, files, locks, ttl }
  offers        TEXT,                    -- JSON: { outputs, artifacts }
  
  -- Economy
  credit_amount INTEGER NOT NULL,        -- total credits for this work
  escrow_status TEXT DEFAULT 'held',     -- held | released | returned
  quality_score REAL,                    -- 0.0-1.0, set by evaluator
  bonus_amount  INTEGER DEFAULT 0,       -- quality bonus if score > threshold
  
  -- Lifecycle
  status        TEXT DEFAULT 'open',     -- open | accepted | active | 
                                         -- suspended | completed | failed
  created_at    TEXT NOT NULL,
  accepted_at   TEXT,
  completed_at  TEXT,
  ttl_seconds   INTEGER,
  
  -- Signatures
  requester_sig TEXT,                    -- requester's signature of plan
  worker_sig    TEXT,                    -- worker's counter-signature
  daemon_sig    TEXT,                    -- daemon's witness signature
  
  FOREIGN KEY (harbor_id) REFERENCES harbors(id),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE anchor_ledger (
  id          TEXT PRIMARY KEY,
  anchor_id   TEXT NOT NULL,
  from_id     TEXT NOT NULL,             -- credit source
  to_id       TEXT NOT NULL,             -- credit destination
  amount      INTEGER NOT NULL,
  reason      TEXT NOT NULL,             -- escrow | release | partial | refund | bonus | fee
  timestamp   TEXT NOT NULL,
  FOREIGN KEY (anchor_id) REFERENCES anchors(id)
);

CREATE TABLE agent_balances (
  agent_identity TEXT PRIMARY KEY,       -- myapp:api:auth-refactor
  credits        INTEGER DEFAULT 0,
  xp             TEXT DEFAULT '{}',      -- JSON: { "auth": 87, "api": 42 }
  reputation     REAL DEFAULT 50.0,      -- 0-100 scale
  anchors_completed INTEGER DEFAULT 0,
  anchors_failed    INTEGER DEFAULT 0,
  last_active    TEXT
);

5. Harbor Data Structures: What Lives Inside

A harbor is more than permissions. It’s a shared workspace with structured data. Here’s what should live inside:

5a. Common Key-Value Store

Every harbor gets a shared KV namespace:

pd kv set myapp auth:jwt-secret "abc123" --harbor myapp
pd kv get myapp auth:jwt-secret
pd kv list myapp auth:*
pd kv watch myapp auth:* --exec ./on-config-change.s

CREATE TABLE harbor_kv (
  harbor_id  TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  set_by     TEXT NOT NULL,        -- which agent wrote this
  version    INTEGER DEFAULT 1,    -- optimistic concurrency
  ttl        INTEGER,              -- optional expiry
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (harbor_id, key),
  FOREIGN KEY (harbor_id) REFERENCES harbors(id)
);

Use cases:

• Shared configuration across agents (DB connection strings, API keys)
• Feature flags that agents can read and react to
• Build artifacts registry (agent A builds, agent B deploys)
• State machines (current deployment stage, review status)

5b. Shared Memory (The Hive Mind)

This is the most interesting one. Individual agents have episodic memory (per-agent, per-session). But a harbor can have collective memory — knowledge that any agent in the harbor can read and contribute to:

┌──────────────────────────────────────────────────┐
│              HARBOR MEMORY                        │
│              (The Hive Mind)                      │
│                                                   │
│  Layer 1: Facts (structured, queryable)           │
│  ┌──────────────────────────────────────────┐    │
│  │ "auth uses JWT with RS256"               │    │
│  │ "database is PostgreSQL 16"              │    │
│  │ "API rate limit is 100 req/min"          │    │
│  │ "user prefers tabs over spaces" (!)      │    │
│  │                                          │    │
│  │ Contributed by agents over time          │    │
│  │ Conflict resolution: latest writer wins  │    │
│  │ OR: voting (3 agents agree → fact)       │    │
│  └──────────────────────────────────────────┘    │
│                                                   │
│  Layer 2: Embeddings (semantic, searchable)       │
│  ┌──────────────────────────────────────────┐    │
│  │ Every note, every session summary,       │    │
│  │ every completed anchor's output →        │    │
│  │ embedded via Ollama and stored as        │    │
│  │ vectors in a harbor-scoped index         │    │
│  │                                          │    │
│  │ pd memory recall "how does auth work?"   │    │
│  │ → Returns semantically relevant notes    │    │
│  │   from ANY agent's session in this       │    │
│  │   harbor, ranked by similarity           │    │
│  └──────────────────────────────────────────┘    │
│                                                   │
│  Layer 3: Learned Patterns (behavioral)           │
│  ┌──────────────────────────────────────────┐    │
│  │ Over time, the harbor accumulates:       │    │
│  │                                          │    │
│  │ • "Tasks tagged 'auth' take 2x longer   │    │
│  │    than estimated" (calibration)         │    │
│  │                                          │    │
│  │ • "Agent claude-sonnet scores 0.92 on    │    │
│  │    code review but 0.61 on CSS"          │    │
│  │    (agent-skill matching)                │    │
│  │                                          │    │
│  │ • "Files in src/auth/ have 3x more      │    │
│  │    merge conflicts" (hotspot detection)  │    │
│  │                                          │    │
│  │ • "PRs reviewed by critic agent have     │    │
│  │    40% fewer reverts" (process learning) │    │
│  │                                          │    │
│  │ This is NOT an RL model in the           │    │
│  │ traditional sense — it's structured      │    │
│  │ statistics over anchor outcomes.          │    │
│  │ The daemon computes them, not a neural   │    │
│  │ net.                                      │    │
│  └──────────────────────────────────────────┘    │
│                                                   │
└──────────────────────────────────────────────────┘

5c. On RL Policy/Value Models — Be Careful


1. SQLite + statistics gets you 80% of the value. If you track every anchor’s estimated time vs actual time, every agent’s quality scores by domain, every file’s conflict frequency — you can compute optimal agent assignment, realistic time estimates, and risk scores with simple SQL queries. No gradient descent required.
2. The daemon must stay fast and predictable. Sub-2ms latency is a feature. Running inference in the daemon loop would destroy that.
3. Let agents BE the intelligence. The daemon is the sheriff — it enforces rules, keeps ledgers, holds escrow. It doesn’t need to be smart. The agents are smart. Give them the data (harbor statistics, agent reputations, historical outcomes) and let them make the decisions.

What WOULD work:

┌─────────────────────────────────────────────┐
│          HARBOR STATISTICS ENGINE            │
│          (not ML, just SQL)                  │
│                                              │
│  SELECT agent_identity,                      │
│         AVG(quality_score) as avg_quality,   │
│         COUNT(*) as anchors_completed,       │
│         AVG(actual_time / estimated_time)    │
│           as time_accuracy                   │
│  FROM anchors                                │
│  WHERE harbor_id = 'myapp'                   │
│    AND status = 'completed'                  │
│  GROUP BY agent_identity                     │
│                                              │
│  → "claude-sonnet: 0.91 quality, 1.2x time" │
│  → "ollama-8b: 0.67 quality, 0.8x time"     │
│  → "aider-gemini: 0.84 quality, 1.0x time"  │
│                                              │
│  This IS a value model. It's just in SQL.    │
└─────────────────────────────────────────────┘

If someone wants real RL: They can spawn a “Meta-Agent” (archetype: Orchestrator) that reads harbor statistics via the API and uses them as features for its own decision-making. The agent does the learning. The daemon provides the data. Clean separation of concerns.

5d. Task Boards

Every harbor should have a structured task board:

If someone wants real RL: They can spawn a “Meta-Agent” (archetype: Orchestrator) that reads harbor statistics via the API and uses them as features for its own decision-making. The agent does the learning. The daemon provides the data. Clean separation of concerns.

5d. Task Boards

Every harbor should have a structured task board:

Tasks are the bridge between human intent and agent work. A task + an accepted bid = an Anchor.

5e. Artifact Registry

Completed work produces artifacts. The harbor stores them:

CREATE TABLE harbor_artifacts (
  id          TEXT PRIMARY KEY,
  harbor_id   TEXT NOT NULL,
  anchor_id   TEXT NOT NULL,          -- which anchor produced this
  agent_id    TEXT NOT NULL,
  type        TEXT NOT NULL,          -- report | code | test-results | docs
  name        TEXT NOT NULL,
  content     TEXT,                   -- or path to file
  metadata    TEXT,                   -- JSON: { lines_changed, test_coverage, etc }
  quality     REAL,                   -- inherited from anchor quality score
  created_at  TEXT NOT NULL,
  FOREIGN KEY (harbor_id) REFERENCES harbors(id),
  FOREIGN KEY (anchor_id) REFERENCES anchors(id)
);

An artifact registry lets agents say “I need the security audit report from last week” and get it from the harbor, not from some agent’s stale context window.



6. V4 Dashboard Vision

The dashboard stops being a status panel and becomes mission control:

Dashboard Panels (V4)

PanelWhat It ShowsFleetAll agents (local + remote), status, heartbeats, kill buttonsHarborsYour harbors, their stats, connected lighthouses, token managementLighthousesGlobal registry browser, search by capability, connect/disconnectAnchorsActive work agreements, progress bars, escrow status, quality scoresTask BoardOpen tasks, bids, assignments — kanban viewEconomyCredit balances, ledger history, graphs of spend over timeHive MindHarbor memory browser, fact explorer, embedding searchLive FeedReal-time pub/sub messages, SSE stream visualizationSessionsTimeline of sessions, notes, phase transitions, replayFilesFile claim map — who owns what, conflict hotspotsApproval QueuePending actions that need human sign-off (outbound writes, bids)The Lighthouse Browser (the most important new panel)

┌─────────────────────────────────────────────────────┐
│  🔦 LIGHTHOUSE REGISTRY           [search...]  [⟳] │
│─────────────────────────────────────────────────────│
│                                                      │
│  LOCAL NETWORK (mDNS)                               │
│  ┌────────────────────────────────────────────────┐ │
│  │ 🟢 alice-dev    192.168.1.42    2 harbors      │ │
│  │    └ myapp (3 agents, 1200 credits available)  │ │
│  │    └ gameserver (1 agent, private)             │ │
│  │                                    [Connect]   │ │
│  │                                                │ │
│  │ 🟢 bob-laptop   192.168.1.67    1 harbor       │ │
│  │    └ myapp (2 agents, 800 credits)             │ │
│  │                                    [Connect]   │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  RELAY (lighthouse.portdaddy.dev)                   │
│  ┌────────────────────────────────────────────────┐ │
│  │ 🟡 gpu-cluster   us-east     GPU compute       │ │
│  │    └ compute-pool (8x A100, $0.02/min)         │ │
│  │    └ Min reputation: 60  Min XP: 100           │ │
│  │                           [Request Access]     │ │
│  │                                                │ │
│  │ 🟢 acme-corp     relay      Team workspace     │ │
│  │    └ platform (12 agents, enterprise)          │ │
│  │    └ Requires: SAML auth                       │ │
│  │                           [Request Access]     │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  PUBLIC MARKETPLACE                                  │
│  ┌────────────────────────────────────────────────┐ │
│  │ 📋 Open Tasks Seeking Bids              [Filter]│ │
│  │                                                │ │
│  │ "Security audit of Express API" — 500 credits  │ │
│  │  Posted by: anon-startup · 2h ago · 3 bids     │ │
│  │                                [View] [Bid]    │ │
│  │                                                │ │
│  │ "Write unit tests for React hooks" — 200 cr    │ │
│  │  Posted by: oss-project · 5h ago · 0 bids     │ │
│  │                                [View] [Bid]    │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘

7. How to Design the Global Registry

The registry itself should be simple and federated, not monolithic:

Option A: Centralized (Easy, Risky)

Curiositech runs lighthouse.portdaddy.dev. All lighthouses register there. You control the directory.

Pro: Simple, fast to build, you own the marketplaceCon: Single point of failure, trust bottleneck, if you go down, discovery dies

Option B: Federated (Harder, Resilient)

Multiple registries can exist. Each lighthouse can register with any registry. Registries can sync with each other (like email servers or Mastodon instances).

lighthouse.portdaddy.dev    ← Curiositech runs this (default)
lighthouse.acme.com         ← Acme runs their own for internal use
community.pd.network        ← Community-run public registry

Daemons have a registries config:

# ~/.port-daddy/config.yaml
registries:
  - url: https://lighthouse.portdaddy.dev
    type: relay    # default, Curiositech-operated
  - url: https://lighthouse.acme.com
    type: private  # corporate

Pro: Resilient, no single point of failure, enterprises can run private registriesCon: More complex, consistency challenges

Option C: DHT / Peer-to-Peer (Hardest, Most Resilient)

Lighthouses find each other via a distributed hash table (like BitTorrent’s DHT). No central registry at all.

Pro: Truly decentralized, censorship-resistantCon: Massive engineering effort, slow discovery, NAT traversal nightmares

My Recommendation

Start with Option A (centralized), design for Option B (federated). Run lighthouse.portdaddy.dev yourself. Make it the default. But design the protocol so that any Port Daddy daemon can be a registry. When enterprises want private registries, they can run their own. The federation protocol can come later.

The registry is also your primary monetization surface: running the relay is a service worth paying for.



8. The Marketplace: Automated Agentic Bidding

This is the endgame. Here’s how automated bidding would work:

The Bidding Protocol

REQUESTER                  REGISTRY                   WORKER
─────────                  ────────                   ──────
    │                         │                         │
 1. Post task ──────────▶    │                         │
    │                    List in marketplace            │
    │                         │ ──── Notify ─────▶     │
    │                         │    (matching caps)      │
    │                         │                         │
 2. │                         │ ◀──── Auto-bid ────     │
    │                         │    (agent evaluates     │
    │                         │     task, estimates     │
    │                         │     cost, bids)         │
    │                         │                         │
    │               ◀── Bid notification ──             │
    │                         │                         │
 3. Review bids               │                         │
    │                         │                         │
    ├── Manual: human picks   │                         │
    │   winner in dashboard   │                         │
    │                         │                         │
    └── Auto: policy decides  │                         │
        (lowest bid with      │                         │
         reputation > 70)     │                         │
    │                         │                         │
 4. Accept bid ──────────▶   │                         │
    │                    Create bilateral anchor        │
    │                         │ ──── Anchor ─────▶     │
    │                         │                    Work │
    │                         │                         │

Auto-Bidding Policies

Agents can have bidding policies stored in their fleet config:

# .portdaddy/fleet.yaml
agents:
  my-coder:
    backend: claude
    model: claude-sonnet-4-20250514
    bidding:
      enabled: true
      auto_accept: false         # require human approval
      max_credit_spend: 1000     # per task ceiling
      domains: [auth, api, db]   # only bid on matching tasks
      min_requester_reputation: 40
      strategy: quality          # quality | speed | cheapest

Safety in Transactions

The anchor protocol provides safety through atomic escrow:

1. Credits are escrowed before work begins. The requester can’t renege.

2. Work is evaluated before credits are released. The worker can’t deliver garbage.

3. The daemon is the escrow agent. Neither party can unilaterally release funds.

4. Partial credit on death. Workers aren’t penalized for crashes — they get pro-rata credit for work done.

5. Reputation is at stake. Failed anchors reduce reputation. Low-reputation agents can’t bid on high-value tasks. This is the long-term incentive for quality.

6. Dispute resolution. If the requester rejects the work and the worker disagrees, a third-party evaluator agent (or human) can arbitrate. The anchor records everything — notes, file changes, quality scores — so the arbitrator has full context.



9. Putting It All Together: The Revised V4 Hierarchy

PORT DADDY V4: THE HARBOR ECONOMY
══════════════════════════════════

Foundation Layer
├── Universal Token Namespace (project:stack:context:**)
├── Default Harbors (always-on, invisible until needed)
├── Enforced Permissions (not advisory)
└── Build Signing & SBOM

Economy Layer
├── Float Plans & Anchors (work agreements)
├── Credit System (escrow, ledger, balances)
├── Quality Gates (evaluator agents)
├── Experience & Reputation (domain-scoped)
└── Agent Transactions (bid, accept, settle)

Memory Layer
├── Episodic Memory (per-agent, per-session)
├── Harbor KV Store (shared config)
├── Hive Mind (collective embeddings + facts)
├── Harbor Statistics (SQL-computed patterns)
└── Artifact Registry (completed work outputs)

Network Layer
├── Lighthouses (remote daemon advertisement)
├── mDNS Discovery (local network, zero config)
├── Relay Service (lighthouse.portdaddy.dev)
├── Public Marketplace (task posting, bidding)
└── Federation Protocol (multiple registries)

Experience Layer
├── Dashboard Mission Control (all panels above)
├── Fleet Management (fleet.yaml, pd fleet up/down)
├── Approval Queue (human-in-the-loop for writes)
├── Lighthouse Browser (discover, connect, bid)
└── VS Code Extension (inline agent awareness)

The thing that makes this coherent — and what should be the centerpiece of the white paper — is that the harbor is the universal container. Everything lives in a harbor: agents, sessions, anchors, credits, memory, artifacts, permissions. Harbors can be local or remote. The lighthouse is how harbors find each other. The anchor protocol is how work moves between harbors. Credits are how value flows.

It’s a port authority in the truest sense: the place where ships dock, cargo is inspected, manifests are filed, and commerce happens under the watchful eye of the harbor master.
