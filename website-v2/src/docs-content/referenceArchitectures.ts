import type { DocsContentSection } from './types'

const singleMachineControlPlane = String.raw`flowchart TB
  Operator["Human<br/>operator"]
  Surfaces["Interface layer<br/>CLI + FleetBar<br/>Control Center + MCP"]
  Daemon["Local daemon<br/>coordination<br/>source of truth"]
  State["Daemon facts<br/>sessions + notes<br/>claims + locks<br/>harbors + tuples<br/>salvage"]
  Workers["Agent runtimes<br/>Codex + Claude<br/>Gemini + custom"]

  Operator --> Surfaces
  Surfaces -->|commands + views| Daemon
  Workers -->|agent events| Daemon
  Daemon -->|context| Workers
  Daemon --> State
  State -->|same live story| Surfaces

  classDef cobalt fill:#003fb8,color:#fbf7ef,stroke:#121212,stroke-width:2px;
  classDef green fill:#006b5f,color:#fbf7ef,stroke:#121212,stroke-width:2px;
  classDef ink fill:#121212,color:#fbf7ef,stroke:#121212,stroke-width:2px;
  classDef paper fill:#f7f3eb,color:#121212,stroke:#121212,stroke-width:2px;
  class Operator,Daemon ink;
  class Surfaces,Workers cobalt;
  class State green;`

const relayHarborMesh = String.raw`flowchart TB
  Harbor["Harbor<br/>fingerprint + keys<br/>policy"]
  Relay["PD Relay<br/>outbound-only ciphertext router"]
  Events["Encrypted events<br/>status + approvals<br/>replies + results"]
  Phone["Phone<br/>reads + approves"]
  Laptop["Laptop daemon<br/>sessions + agents"]
  HomePC["Home PC daemon<br/>compute lane"]
  MacBook["Colleague MacBook<br/>scoped collaborator"]

  Harbor --> Relay --> Events
  Events --> Phone --> Laptop --> HomePC --> MacBook

  classDef cobalt fill:#003fb8,color:#fbf7ef,stroke:#121212,stroke-width:2px;
  classDef green fill:#006b5f,color:#fbf7ef,stroke:#121212,stroke-width:2px;
  classDef ink fill:#121212,color:#fbf7ef,stroke:#121212,stroke-width:2px;
  classDef paper fill:#f7f3eb,color:#121212,stroke:#121212,stroke-width:2px;
  class Harbor,Events green;
  class Relay ink;
  class Phone,Laptop,HomePC,MacBook cobalt;
`

const relayJoinPath = String.raw`flowchart TB
  Invite["01 Owner laptop<br/>makes invite"]
  Phone["02 Phone scans QR<br/>redeems link"]
  Card["03 Relay returns<br/>attenuated card"]
  Listen["04 Phone listens<br/>to channels"]
  Approve["05 Phone sends<br/>approval"]
  Apply["06 Laptop daemon<br/>applies action"]
  Peer["Colleague MacBook<br/>gets narrow invite"]

  Invite --> Phone --> Card --> Listen --> Approve --> Apply
  Invite -. collaborator path .-> Peer

  classDef cobalt fill:#003fb8,color:#fbf7ef,stroke:#121212,stroke-width:2px;
  classDef green fill:#006b5f,color:#fbf7ef,stroke:#121212,stroke-width:2px;
  classDef ink fill:#121212,color:#fbf7ef,stroke:#121212,stroke-width:2px;
  classDef accent fill:#cad900,color:#121212,stroke:#121212,stroke-width:2px;
  class Invite,Apply ink;
  class Phone,Card,Listen,Approve cobalt;
  class Peer accent;`

const fleetAutomationLoop = String.raw`flowchart TB
  Config["pd-fleet.yml<br/>agents + triggers<br/>limits"]
  Parser["Fleet engine<br/>parse config<br/>resolve vars"]
  Topology["Topology check<br/>cycles + orphan<br/>channels"]
  Daemon["Fleet daemon<br/>lease + watch<br/>reload"]
  Trigger["Trigger source<br/>schedule, channel<br/>tuple, manual"]
  Budget["Budget gates<br/>daily + hourly<br/>concurrent"]
  Runner["Fleet runner<br/>worktree + backend<br/>fallback"]
  Evidence["Runtime evidence<br/>events + notes<br/>tuples + status"]
  Surfaces["Operator surfaces<br/>CLI + FleetBar<br/>Control Center"]

  Config --> Parser --> Topology --> Daemon
  Daemon --> Trigger --> Budget --> Runner --> Evidence --> Surfaces
  Surfaces -->|control| Daemon

  classDef cobalt fill:#003fb8,color:#fbf7ef,stroke:#121212,stroke-width:2px;
  classDef green fill:#006b5f,color:#fbf7ef,stroke:#121212,stroke-width:2px;
  classDef ink fill:#121212,color:#fbf7ef,stroke:#121212,stroke-width:2px;
  class Config,Daemon,Runner ink;
  class Parser,Topology,Budget cobalt;
  class Trigger,Evidence,Surfaces green;`

const fleetTriggerTopology = String.raw`flowchart TB
  Commit["git:committed<br/>qa + tests<br/>simplifier"]
  Promotion["promotion docs<br/>documentarian"]
  Schedule["cron schedules<br/>gardener + map<br/>spark + spider"]
  Manual["manual hail<br/>one selected<br/>agent"]
  Evidence["runtime evidence<br/>events, notes, status"]

  Commit --> Promotion --> Schedule --> Manual --> Evidence

  classDef cobalt fill:#003fb8,color:#fbf7ef,stroke:#121212,stroke-width:2px;
  classDef green fill:#006b5f,color:#fbf7ef,stroke:#121212,stroke-width:2px;
  classDef ink fill:#121212,color:#fbf7ef,stroke:#121212,stroke-width:2px;
  class Commit,Promotion,Schedule,Manual ink;
  class Evidence green;`

export const referenceArchitecturesSection: DocsContentSection = {
  slug: 'reference-architectures',
  title: 'Reference Architectures',
  summary:
    'Concrete layouts for the daemon boundary, fleet automation, relay-backed harbors, and delegation workflows.',
  pages: [
    {
      slug: 'single-machine-control-plane',
      title: 'Single-Machine Port Daddy',
      summary:
        'The local baseline: one daemon owns coordination truth while many tools and agent runtimes come and go.',
      truth: 'source-backed',
      goals: [
        'Separate execution workers from the coordination control plane.',
        'Know which state belongs in the daemon instead of in terminal lore.',
        'Use the same model for CLI, FleetBar, dashboard, SDK, and MCP clients.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'The daemon is the local source of truth',
          paragraphs: [
            'The single-machine architecture is intentionally boring in the best way: the agent runtime does the work, but the daemon owns the coordination facts. A Codex process, a Claude session, a FleetBar webview, and an MCP client should all read and write the same sessions, notes, claims, locks, harbors, tuples, and salvage records.',
            'That split matters because agent processes are disposable. They crash, restart, fork into worktrees, lose stdout, or get replaced by a different backend. The daemon is the place where the operator can still ask what happened, who owns which files, what locks are live, which channels fired, and what work needs salvage.',
            'Treat the daemon as a local control plane, not just a helper server. The control plane should be narrow enough to run on a laptop, strict enough to coordinate concurrent agents, and visible enough that FleetBar and the web dashboard do not become decorative wrappers around stale assumptions.',
          ],
        },
        {
          type: 'mermaid',
          title: 'Local control-plane boundary',
          chart: singleMachineControlPlane,
          caption:
            'The important boundary is not "CLI versus UI". It is execution workers versus daemon-owned coordination state. Every surface should tell the same story because every surface resolves through the same daemon.',
        },
        {
          type: 'checklist',
          title: 'Local invariants',
          tone: 'blue',
          items: [
            'Keep one canonical daemon for the checkout unless an extra daemon is explicitly opted in with a separate socket, port, and prefix.',
            'Put shared coordination state in daemon primitives: sessions for lifecycle, claims for edit intent, locks for scarce resources, tuples/channels for machine-readable facts, harbors for scope, and salvage for interrupted work.',
            'Make every human-facing surface resolve through the same daemon truth before it claims that work is active, blocked, complete, or safe to publish.',
            'When CLI, browser, FleetBar, and source code disagree, verify daemon provenance before rewriting docs or trusting an old build.',
          ],
        },
        {
          type: 'command',
          title: 'Operator inspection path',
          command:
            'pd status\npd sessions --all-worktrees\npd notes --limit 20\npd guard check --staged',
          output:
            'Port Daddy is running\nActive sessions and notes describe current work across worktrees\nCoordination Guard checks staged paths against active session claims',
          notes: [
            'This is the small local loop before commit, push, deploy, or any contested edit.',
            'Use the app surfaces for richer browsing, but keep the CLI path boring and dependable.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Design recommendation',
          paragraphs: [
            'Keep the first product promise local. A new user should be able to run one daemon, start one or many agents, and see the exact same coordination facts from CLI, FleetBar, dashboard, SDK, and MCP. Do not ask the user to understand relay, remote harbors, or fleet topology before the local loop is trustworthy.',
            'Use this architecture for solo development, local multi-agent work, CI-adjacent scripts running on the same machine, and any repo where the main risk is agents losing each other inside one worktree. Remote collaboration should extend this model through harbors and relay, not replace it with a second coordination system.',
          ],
        },
      ],
      sources: [
        {
          path: 'AGENTS.md',
          rationale: 'Defines the repo operating contract: Port Daddy first, one canonical daemon, live notes, claims, guard checks, and daemon provenance before publish.',
        },
        {
          path: 'server.ts',
          rationale: 'Wires the daemon-owned runtime primitives together: harbors, tokens, spawner, tuples, fleet daemon, sorties, and route registration.',
        },
        {
          path: 'routes/index.ts',
          rationale: 'Shows the route boundary where CLI, UI, SDK, and MCP clients converge on one local daemon API.',
        },
        {
          path: 'lib/harbors.ts',
          rationale: 'Implements named coordination namespaces and admission state for agents inside a harbor.',
        },
        {
          path: 'lib/tuples.ts',
          rationale: 'Implements the harbor-scoped shared tuple space used for machine-readable coordination facts.',
        },
      ],
    },
    {
      slug: 'pd-relay-harbor-mesh',
      title: 'PD Relay Harbor Mesh',
      summary:
        'A design recommendation for putting a phone, laptop, home PC, and remote colleague into one shared harbor without remote database sync.',
      truth: 'source-backed',
      goals: [
        'Use remote harbors as event federation, not daemon state replication.',
        'Show how phone, laptop, home PC, and colleague devices join one harbor safely.',
        'Keep the relay future-facing while naming what must remain local today.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Recommendation: one harbor, many local authorities',
          paragraphs: [
            'The design I would ship is a shared harbor mesh: your laptop daemon, home PC daemon, phone client, and a colleague\'s MacBook all join the same harbor fingerprint, but each full machine keeps its own local daemon state. The relay federates encrypted events across that harbor. It does not replicate SQLite, claims, notes, or process tables between machines.',
            'That gives the user-visible win: your phone can approve a launch, reply to a tube thread, or inspect live status while your laptop and home PC keep running agents. Your colleague can join from another city and publish scoped collaboration events into the same harbor. Nobody needs an inbound port open at home, and the relay never needs plaintext payloads.',
            'The phone should be a thin control client, not a full coordination authority by default. Give it attenuated capabilities: read status, publish approvals, reply to threads, maybe wake a predeclared run. Do not give it raw filesystem, spawn, or secret-management authority unless the user explicitly promotes it.',
          ],
        },
        {
          type: 'mermaid',
          title: 'Relay-backed harbor mesh',
          chart: relayHarborMesh,
          caption:
            'All devices share the harbor fingerprint, but full daemon state stays on each machine. The stacked members are not a sync chain; they are separate cards attached to one encrypted event bus.',
        },
        {
          type: 'checklist',
          title: 'Harbor mesh invariants',
          tone: 'accent',
          items: [
            'Laptop and home PC run full local daemons and keep local sessions, file claims, locks, process state, and salvage ledgers authoritative for their own machines.',
            'Phone joins through a managed relay or self-hosted relay as a thin member with short-lived, attenuated harbor cards.',
            'A colleague joins through a separate invite with collaborator caps, not through owner credentials.',
            'Relay channels are namespaced by harbor fingerprint so two different harbors cannot collide even when channel names match.',
            'Payloads are end-to-end encrypted to harbor members; the relay can route by header metadata but cannot read the application body.',
            'Per-publisher event chains make relay rewrites and broken histories detectable without turning the relay into a trusted sequencer.',
          ],
        },
        {
          type: 'mermaid',
          title: 'Phone join and approval path',
          chart: relayJoinPath,
          caption:
            'The phone flow should feel like a magic link or QR join, but the underlying model is still capability cards, channel keys, and local daemon authority.',
        },
        {
          type: 'command',
          title: 'Recommended target syntax',
          command:
            'pd harbor create erich-workbench --cap sessions:read --cap tube:pub --cap approvals:pub\npd relay share erich-workbench --aud phone --expires 30m --cap status:read --cap approvals:pub\npd relay share erich-workbench --aud collaborator --expires 7d --cap tube:pub --cap notes:read\npd relay status --harbor erich-workbench',
          output:
            'PLANNED SURFACE\nowner invite: short-lived phone link or QR\ncollaborator invite: scoped MacBook join link\nrelay status: connected members, accepted channels, rejected caps, revocation freshness',
          notes: [
            'This is the product shape to design toward, not a claim that every command is shipped today.',
            'The existing remote-harbors tutorial already marks cross-daemon coordination as planned; this architecture tightens what that planned feature should mean.',
          ],
        },
        {
          type: 'callout',
          tone: 'warning',
          title: 'Do not build state sync first',
          body:
            'The tempting wrong turn is bidirectional daemon state replication: clocks, conflict resolution, database merge rules, and split-brain behavior. For this use case, event federation is enough. State sync can be a later ADR if real users need it, but it should not block phone and remote colleague collaboration.',
        },
        {
          type: 'paragraph',
          title: 'Security posture',
          paragraphs: [
            'Identity should follow the OIDC-first hybrid from the relay PKI ADR: OIDC for managed workload bootstrap, admin-approved web-of-trust for self-hosted or harbor-local deployments, and ACME later for name-bound daemon identity. The relay registry should track proof method, expiry, revocation state, and harbor memberships.',
            'Authorization belongs in Port Daddy cards, not in the fact that a person reached the relay. A phone card can be short lived and narrow; a home PC card can be owner-grade; a colleague card can publish into selected channels but be unable to spawn agents or read private notes. Revocation has to be visible and fast enough that removing a phone or collaborator is operationally boring.',
            'The relay should store event envelopes and chain heads, not decrypted task content. If the phone wants to display rich status, the local daemon publishes a status event intended for harbor members. If the colleague needs more authority, the owner issues a new attenuated card rather than sharing the owner key.',
          ],
        },
        {
          type: 'paragraph',
          title: 'What ships first',
          paragraphs: [
            'Ship the smallest useful mesh: owner laptop plus phone plus one second daemon. Support status, tube replies, approvals, and manual event publish/subscribe before remote spawning. Then add collaborator invites. Only after that should Port Daddy route heavier work to the home PC or let a colleague launch scoped tasks.',
            'The first production-quality demo should be physical and plain: start a laptop daemon, join the phone by QR, see a live session status event, send an approval from the phone, and watch the laptop daemon apply it locally. Add the home PC as a second full daemon and show a compute result event returning to the phone. Add the colleague MacBook last, with a visibly narrower card.',
          ],
        },
      ],
      sources: [
        {
          path: 'skills/pd-relay-zero-trust/references/relay-architecture.md',
          rationale: 'Defines the outbound-only relay, SSE transport, harbor fingerprint namespace, E2E payload invariant, and relay storage model.',
        },
        {
          path: 'skills/pd-relay-zero-trust/references/v4-remote-harbor-redefinition.md',
          rationale: 'Makes the key design call: remote harbor means shared keypair plus relay namespace, not distributed state replication.',
        },
        {
          path: 'docs/adr/0025-pki-decision.md',
          rationale: 'Sets the OIDC-first hybrid identity bootstrap and the self-hosted/admin-approved WoT escape hatch.',
        },
        {
          path: 'docs/adr/0013-unified-harbor-model.md',
          rationale: 'Defines harbors as the unit of scope, security, economy, ambient knowledge, and remote collaboration.',
        },
        {
          path: 'skills/pd-relay-zero-trust/references/e2e-payload-encryption.md',
          rationale: 'Specifies the relay-never-sees-plaintext invariant and the per-channel key wrapping model for harbor members.',
        },
        {
          path: 'skills/pd-relay-zero-trust/references/merkle-chain-design.md',
          rationale: 'Specifies per-publisher event chains for tamper evidence and non-equivocation without a trusted relay sequencer.',
        },
        {
          path: 'website-v2/src/pages/tutorials/RemoteHarbors.tsx',
          rationale: 'Current public tutorial truth: cross-daemon remote harbors are planned, while tunnels, DNS, and local pub/sub exist today.',
        },
      ],
    },
    {
      slug: 'fleet-automation-loop',
      title: 'Fleet Automation Loop',
      summary:
        'A project-level automation architecture in which `pd-fleet.yml`, trigger channels, and the daemon combine into an inspectable always-on workflow.',
      truth: 'source-backed',
      goals: [
        'See how declarative fleet config becomes runtime behavior.',
        'Understand the role of trigger channels and status views.',
        'Keep background automation easy to inspect.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'From config to accountable background work',
          paragraphs: [
            'The fleet architecture is the project-level version of Port Daddy coordination: a checked-in `pd-fleet.yml` declares background agents, channels, schedules, budgets, and launch defaults; the daemon turns that into live runners with status, lifecycle events, pause/resume controls, and a source-backed topology.',
            'This is not supposed to be a pile of hidden watchers. A fleet should answer five operator questions quickly: what is armed, what can wake it, what budget gate protects it, which worktree or backend will run it, and where the evidence goes after it fires.',
            'The current runtime already does the hard parts that matter for trust: templates are resolved from project context, trigger graphs are checked for cycles, project-scoped channels avoid cross-repo wakeups, budget/concurrency gates sit before agent launch, and edit-capable agents default toward isolated worktrees unless the fleet config opts out.',
          ],
        },
        {
          type: 'mermaid',
          title: 'Fleet automation loop',
          chart: fleetAutomationLoop,
          caption:
            'The architecture is a loop, not a fire-and-forget launcher: config becomes topology, topology arms the daemon, triggers request work, budgets gate the spawn, and events return to operator surfaces.',
        },
        {
          type: 'checklist',
          title: 'Fleet invariants',
          tone: 'blue',
          items: [
            'Treat `pd-fleet.yml` as the inspectable declaration of intent, not as an excuse to bury behavior in shell scripts.',
            'Validate the trigger graph before arming automation; cycles and orphan channels are topology facts, not UI trivia.',
            'Scope physical channels by project directory so two repos can both publish `git:committed` without waking each other.',
            'Require a positive daily budget for agentic launches, then enforce concurrent and hourly spawn limits before the backend starts.',
            'Default edit-capable agents into separate worktrees; shared-tree runners should be explicit and usually read-only.',
            'Emit events, notes, tuples, and status so FleetBar, Fleet Control Center, CLI, and API clients can prove what happened.',
          ],
        },
        {
          type: 'command',
          title: 'Inspection path',
          command: 'pd fleet validate\npd fleet status',
          output:
            'SUCCESS: Fleet "port-daddy" parsed successfully\n  agents:   8\n  watchers: 2\n  channels: 8\n  budget:   9.76\n\nSUCCESS: No topology warnings\n\nFleet status then shows configured agents, backend readiness, registered fleet agents, and recent fleet events.',
          notes: [
            'This output is from the current checkout while building this page.',
            'Use `/fleet`, `/fleet/events`, and `/fleet/config/:project` when a UI or SDK needs the same truth over HTTP.',
          ],
        },
        {
          type: 'mermaid',
          title: 'Trigger topology example',
          chart: fleetTriggerTopology,
          caption:
            'A useful fleet is readable as a topology: commits wake review and testing, promotion wakes release-surface docs, schedules wake maintenance, and manual hails stay possible.',
        },
        {
          type: 'callout',
          tone: 'warning',
          title: 'Do not make fleet magic',
          body:
            'The failure mode is automation that looks impressive until something goes wrong. Fleet work should be dull to inspect: the same project directory, physical channel, budget decision, backend readiness, run id, and result should show up in every surface.',
        },
        {
          type: 'paragraph',
          title: 'Future-facing recommendation',
          paragraphs: [
            'The next product step is a Fleet Control Center that edits the topology without hiding it. A user should be able to drag an agent from `git:committed` to `promotion:release-surfaces`, see the YAML diff, preview budget impact, validate the graph, and only then apply the change. The UI can be friendly, but the artifact should remain `pd-fleet.yml` plus daemon events.',
            'The stronger future version is tuple-triggered fleet work with named lanes. A QA agent could write a structured finding tuple, a documentarian could subscribe to only release-surface tuples, and Spark could publish ideas without turning every channel into prose. The runtime already has tuple mailboxes and semantic alias emission for fleet tasks; the architecture should lean into that instead of inventing a second queue.',
            'The user-facing rule: automation should become more ambient without becoming less accountable. A fleet can be always-on only if the operator can stop it, explain it, limit it, and replay the evidence after it acts.',
          ],
        },
      ],
      sources: [
        {
          path: 'docs/adr/0019-declarative-fleet-yaml.md',
          rationale: 'ADR defines the fleet YAML model, lifecycle, and user expectations.',
        },
        {
          path: 'pd-fleet.yml',
          rationale: 'The repo-owned fleet config shows real agents, schedules, triggers, model fallbacks, budget limits, and channel topology.',
        },
        {
          path: 'lib/fleet-engine.ts',
          rationale: 'Parses fleet YAML, infers worktree defaults, validates topology, scopes triggers, enforces budget/concurrency gates, and runs agents/watchers.',
        },
        {
          path: 'lib/fleet-daemon.ts',
          rationale: 'Owns fleet discovery, project leases, config watching, reload, event emission, status aggregation, and project-wide concurrency semaphores.',
        },
        {
          path: 'lib/fleet-channels.ts',
          rationale: 'Scopes human-readable fleet channels like `git:committed` into project-specific physical channels.',
        },
        {
          path: 'routes/fleet.ts',
          rationale: 'Fleet routes expose status, lifecycle controls, config editing, budget updates, backend readiness, and SSE events on the daemon.',
        },
        {
          path: 'routes/projects.ts',
          rationale: 'Project readiness uses fleet config state to tell operators whether to create, validate, budget, or start a fleet.',
        },
      ],
    },
    {
      slug: 'delegation-surfaces',
      title: 'Delegation Workflows',
      summary:
        'How `pd spawn`, `pd agent`, `pd sortie`, `pd fleet`, and harbors differ in daily use.',
      truth: 'source-backed',
      goals: [
        'Choose the right delegation command.',
        'Understand how harbors fit across those commands.',
        'Know which parts are shipped today and which parts are still growing.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Different commands exist because the jobs are different',
          paragraphs: [
            '`pd spawn`, `pd agent`, `pd sortie`, and `pd fleet` should not feel interchangeable because they solve different problems. Spawn is low-level launch control, agent is a bounded one-shot task, sortie is a tracked mission, and fleet is always-on project automation.',
            'Harbors cut across those workflows when the work needs scoped messaging, tuple isolation, or capability boundaries.',
          ],
        },
        {
          type: 'checklist',
          title: 'Delegation choices',
          tone: 'blue',
          items: [
            'Use `pd spawn` when you need explicit low-level control over one launch.',
            'Use `pd agent` when you want the daemon to wrap a bounded one-shot task correctly.',
            'Use `pd sortie` when you need a durable mission record with status and logs.',
            'Use `pd fleet` when the work should stay armed for the project over time.',
          ],
        },
        {
          type: 'paragraph',
          title: 'What is shipped today',
          paragraphs: [
            'The shipped system already gives sortie ids, status, and logs, but it is not yet the full multi-agent mission engine described in the deeper recovery plan. A good architecture page keeps that distinction explicit instead of collapsing every delegation concept into one shiny word.',
            'That distinction helps users choose the right command today and understand which parts are already dependable enough to build around.',
          ],
        },
      ],
      sources: [
        {
          path: 'docs/DELEGATION-MODES.md',
          rationale: 'Delegation modes document explains how spawn, agent, sortie, fleet, and harbor differ today.',
        },
        {
          path: 'docs/recovery/PD-AGENT-SORTIE-PLAN.md',
          rationale: 'Sortie plan explains the intended product layering and the specific problem each delegation workflow should solve.',
        },
        {
          path: 'routes/sorties.ts',
          rationale: 'Live sortie routes confirm the current shipped mission record behavior.',
        },
      ],
    },
  ],
}
