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

  classDef cobalt fill:{{cobalt}},color:{{cobaltText}},stroke:{{stroke}},stroke-width:2px;
  classDef green fill:{{green}},color:{{greenText}},stroke:{{stroke}},stroke-width:2px;
  classDef ink fill:{{ink}},color:{{inkText}},stroke:{{stroke}},stroke-width:2px;
  classDef paper fill:{{paper}},color:{{paperText}},stroke:{{stroke}},stroke-width:2px;
  class Operator,Daemon ink;
  class Surfaces,Workers cobalt;
  class State green;`

const relayHarborMesh = String.raw`flowchart TB
  Harbor["Shared harbor<br/>fingerprint + policy<br/>membership"]
  Relay["PD Relay gateway<br/>outbound-only<br/>ciphertext router"]
  Cards["Four separate cards<br/>phone approval<br/>MacBook Pro owner<br/>home PC compute<br/>colleague collaboration"]
  Local["Authority stays local<br/>daemons keep sessions,<br/>files, locks, secrets,<br/>budgets, and tools"]

  Harbor --> Relay --> Cards --> Local

  classDef cobalt fill:{{cobalt}},color:{{cobaltText}},stroke:{{stroke}},stroke-width:2px;
  classDef green fill:{{green}},color:{{greenText}},stroke:{{stroke}},stroke-width:2px;
  classDef ink fill:{{ink}},color:{{inkText}},stroke:{{stroke}},stroke-width:2px;
  classDef accent fill:{{accent}},color:{{accentText}},stroke:{{stroke}},stroke-width:2px;
  class Harbor green;
  class Relay ink;
  class Cards cobalt;
  class Local accent;
`

const relayJoinPath = String.raw`flowchart TB
  Owner["01 MacBook Pro<br/>creates harbor invite"]
  Phone["02 Phone scans QR<br/>or opens magic link"]
  Profile["03 Pick profile<br/>phone, compute PC,<br/>collaborator"]
  Card["04 Relay issues<br/>short card + accepted subs"]
  Live["05 Device appears<br/>with caps + freshness"]
  Revoke["06 Revoke or narrow<br/>without touching<br/>other devices"]

  Owner --> Phone --> Profile --> Card --> Live --> Revoke

  classDef cobalt fill:{{cobalt}},color:{{cobaltText}},stroke:{{stroke}},stroke-width:2px;
  classDef green fill:{{green}},color:{{greenText}},stroke:{{stroke}},stroke-width:2px;
  classDef ink fill:{{ink}},color:{{inkText}},stroke:{{stroke}},stroke-width:2px;
  classDef accent fill:{{accent}},color:{{accentText}},stroke:{{stroke}},stroke-width:2px;
  class Owner,Revoke ink;
  class Phone,Card,Live cobalt;
  class Profile accent;`

const relayComputeRequest = String.raw`flowchart TB
  Proposal["01 MacBook Pro<br/>publishes compute proposal"]
  Phone["02 Phone approves<br/>request:compute:low-risk"]
  Request["03 Relay delivers<br/>encrypted request<br/>to home PC"]
  Gate["04 Home PC checks<br/>card, budget, worktree,<br/>model ready"]
  Result["05 Home PC returns<br/>encrypted result event<br/>+ blob refs"]
  Summary["06 Phone and MacBook<br/>see fresh summary"]
  Handoff["07 Colleague sees<br/>only scoped handoff<br/>if card allows"]

  Proposal --> Phone --> Request --> Gate --> Result --> Summary --> Handoff

  classDef cobalt fill:{{cobalt}},color:{{cobaltText}},stroke:{{stroke}},stroke-width:2px;
  classDef green fill:{{green}},color:{{greenText}},stroke:{{stroke}},stroke-width:2px;
  classDef ink fill:{{ink}},color:{{inkText}},stroke:{{stroke}},stroke-width:2px;
  classDef accent fill:{{accent}},color:{{accentText}},stroke:{{stroke}},stroke-width:2px;
  class Proposal,Gate ink;
  class Phone,Request,Result,Summary cobalt;
  class Handoff accent;`

const relayErgonomicControlPlane = String.raw`flowchart TB
  Quiet["Quiet by default<br/>presence + status"]
  Ask["Ask on side effects<br/>spawn, write, spend,<br/>remote compute"]
  Local["Local daemon decides<br/>claims, locks, budgets,<br/>secrets"]
  Proof["Proof follows action<br/>event hash, actor,<br/>cap, result"]
  Review["Human review<br/>phone, Mac app,<br/>CLI, docs"]

  Quiet --> Ask --> Local --> Proof --> Review

  classDef cobalt fill:{{cobalt}},color:{{cobaltText}},stroke:{{stroke}},stroke-width:2px;
  classDef green fill:{{green}},color:{{greenText}},stroke:{{stroke}},stroke-width:2px;
  classDef ink fill:{{ink}},color:{{inkText}},stroke:{{stroke}},stroke-width:2px;
  classDef accent fill:{{accent}},color:{{accentText}},stroke:{{stroke}},stroke-width:2px;
  class Quiet green;
  class Ask,Proof cobalt;
  class Local ink;
  class Review accent;`

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

  classDef cobalt fill:{{cobalt}},color:{{cobaltText}},stroke:{{stroke}},stroke-width:2px;
  classDef green fill:{{green}},color:{{greenText}},stroke:{{stroke}},stroke-width:2px;
  classDef ink fill:{{ink}},color:{{inkText}},stroke:{{stroke}},stroke-width:2px;
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

  classDef cobalt fill:{{cobalt}},color:{{cobaltText}},stroke:{{stroke}},stroke-width:2px;
  classDef green fill:{{green}},color:{{greenText}},stroke:{{stroke}},stroke-width:2px;
  classDef ink fill:{{ink}},color:{{inkText}},stroke:{{stroke}},stroke-width:2px;
  class Commit,Promotion,Schedule,Manual ink;
  class Evidence green;`

const delegationChoiceMap = String.raw`flowchart TB
  Intent["Operator work<br/>bounded AI task"]
  Spawn["pd spawn<br/>launch + budget<br/>transcript + salvage"]
  Artifacts["Artifacts<br/>screenshots, issues,<br/>notes, test cases"]
  Fleet["pd fleet<br/>always-on project<br/>automation"]
  Harbor["harbor<br/>scope + membership<br/>tuples + channels"]

  Intent --> Spawn --> Artifacts
  Intent -. recurring work .-> Fleet
  Spawn -. grouped work .-> Harbor
  Fleet --> Harbor

  classDef cobalt fill:{{cobalt}},color:{{cobaltText}},stroke:{{stroke}},stroke-width:2px;
  classDef green fill:{{green}},color:{{greenText}},stroke:{{stroke}},stroke-width:2px;
  classDef ink fill:{{ink}},color:{{inkText}},stroke:{{stroke}},stroke-width:2px;
  classDef accent fill:{{accent}},color:{{accentText}},stroke:{{stroke}},stroke-width:2px;
  class Intent,Spawn ink;
  class Fleet,Artifacts cobalt;
  class Harbor green;
  class Artifacts accent;`

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
        'Separate the agents doing work from the daemon that tracks coordination.',
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
            'Treat the daemon as the one place that tracks coordination, not just a helper server. It should be narrow enough to run on a laptop, strict enough to coordinate concurrent agents, and visible enough that FleetBar and the web dashboard do not become decorative wrappers around stale assumptions.',
          ],
        },
        {
          type: 'mermaid',
          title: 'Where the coordination boundary sits',
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
          type: 'command',
          title: 'Live proof the daemon owns the truth',
          command: 'pd status\npd sessions --all-worktrees',
          output:
            'Port Daddy is running\n  Version: 3.12.0 (f3b4f7d40d8c)\n  Runtime: nominal\n  Fleet: 1 project(s), 8 agent(s), 3/8 launchable\n\nID              PURPOSE                    STATUS    FILES  NOTES  AGE\nsession-add-source-backed-operator-examples-to-reference-fba539e7dcb2Add source-backed opera... active        0      0  1m',
          notes: [
            'This was captured from the isolated reference-architecture worktree while editing this page.',
            'The important observable is not the exact age or PID. It is that the CLI can see daemon runtime state and the active docs session from the same local daemon.',
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
          rationale: 'Wires the daemon-owned runtime primitives together: harbors, tokens, spawner, tuples, fleet daemon, and route registration.',
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
          title: 'Recommendation: one harbor, four device roles',
          paragraphs: [
            'The design I would ship is a shared harbor mesh with four explicit roles. Your MacBook Pro is the primary local authority for the repo, sessions, claims, locks, notes, and ordinary agent work. Your phone is a thin approval and reply surface. Your home PC is a second full daemon with compute capabilities such as GPU, Ollama, Docker, or a heavy checkout. A colleague\'s MacBook is a collaborator with its own device key and a narrower card.',
            'All four devices join the same harbor fingerprint, but full daemon state stays local to the machines that own it. The relay federates encrypted events, not SQLite tables, process state, lock rows, or raw filesystem access. The MacBook Pro can ask the home PC to do compute work; the home PC can accept only the request classes its card allows; the phone can approve or reject side effects without becoming a daemon.',
            'This is the useful ergonomic compromise: no inbound port at home, no VPN setup required for the first demo, no owner credential sharing with a colleague, and no fake promise that a phone can safely mutate a repo directly. The phone gets short-lived caps for status, inbox, approvals, replies, and low-risk requests. The MacBook Pro and home PC keep their local operator policies, budgets, checks that the model is ready, and worktree rules.',
          ],
        },
        {
          type: 'mermaid',
          title: 'Relay-backed harbor mesh',
          chart: relayHarborMesh,
          caption:
            'Every device connects outbound to the relay. The relay routes encrypted harbor events; each daemon keeps authority over its own local state and tools.',
        },
        {
          type: 'checklist',
          title: 'Device-role contract',
          tone: 'accent',
          items: [
            'MacBook Pro: primary daemon and owner control panel. It owns repo-local sessions, file claims, locks, notes, secrets, ordinary agent launches, and final publish decisions.',
            'Phone: thin control client. It can read filtered status, receive inbox/approval cards, reply to threads, revoke its own device, and approve predeclared low-risk actions.',
            'Home PC: secondary daemon and compute worker. It advertises resources, accepts only approved request classes, and applies local budget/model/worktree policy before doing work.',
            'Colleague MacBook: scoped collaborator. It gets project channels, coordination tuples, and handoff rights without owner-only revocation, secrets, local filesystem, or home-PC compute authority by default.',
            'Relay: gateway and event fabric. It stores envelopes, chain heads, revocations, and metadata needed for routing, but never needs decrypted payloads or raw daemon master keys.',
            'Harbor: capability boundary. Display names are cosmetic; the authority is the device public key, proof method, card expiry, accepted subscriptions, and approved capabilities.',
          ],
        },
        {
          type: 'paragraph',
          title: 'WinDAGs lenses used',
          paragraphs: [
            'This recommendation was checked against the [WinDAGs skill dossiers](http://windag.ai/), especially `agentic-zero-trust-security`, `tunnels-for-agents`, and `reverse-proxy-for-agents`: reachable does not mean trusted, outbound-only is the default NAT story, and relay headers route envelopes rather than granting authority.',
            'The always-on and vibe-coding skills push the product shape: stale/fresh markers, bounded inputs, cost gates, local policy checks, worktree-aware handoffs, and proof before merge. That is why the phone is a card-based approval surface, the home PC is a locally gated compute worker, and the colleague gets a separate attenuated card.',
          ],
        },
        {
          type: 'mermaid',
          title: 'Join and revoke path',
          chart: relayJoinPath,
          caption:
            'The UX can feel like QR plus magic link, but the important operator affordance is profile selection: phone, compute PC, or collaborator should never receive the same card.',
        },
        {
          type: 'mermaid',
          title: 'Phone approval to home-PC compute',
          chart: relayComputeRequest,
          caption:
            'Remote execution is two-sided: the requester needs send authority, the target needs accept authority, and the target daemon still runs local policy before touching tools or files.',
        },
        {
          type: 'mermaid',
          title: 'Ergonomic safety loop',
          chart: relayErgonomicControlPlane,
          caption:
            'The product should stay quiet for observation and explicit for side effects. Suggestions can be ambient; mutation, spending, remote compute, and publishing need visible approval or predeclared policy.',
        },
        {
          type: 'command',
          title: 'Current runnable boundary check',
          command:
            'pd tunnel --help\npd dns --help\npd pub --help',
          output:
            'Usage: pd tunnel <subcommand> [args]\n  start <identity> [--provider ngrok]  Start a tunnel\n  stop <identity>                      Stop a tunnel\n  status <identity>                    Get tunnel status\n  list                                 List active tunnels\n  providers                            Check installed providers\n\nUsage: pd dns <subcommand> [args] [options]\n  register <identity> --port <n>       Register a DNS record\n  lookup <hostname>                    Lookup by hostname\n  status                               DNS system status\n\nUsage: port-daddy pub <channel> <message> [--message "text"] [-m "text"] [--signal mayday|pan-pan|roger|...]',
          notes: [
            'These commands are the source-backed local building blocks that exist today: tunnels, local DNS, and pub/sub.',
            'The existing remote-harbors tutorial says remote harbor commands are planned and that none of those planned commands exist yet. The relay mesh architecture should not present planned relay syntax as a runnable recipe.',
          ],
        },
        {
          type: 'callout',
          tone: 'info',
          title: 'Planned relay operator result',
          body:
            'The target observable for the future relay surface is specific: a short-lived phone invite or QR, a collaborator invite with narrower caps, connected members, accepted channels, rejected capabilities, and revocation freshness. That is product direction, not a current CLI transcript.',
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
            'The zero-trust rule is simple: connection proves reachability, not authority. Identity should follow the OIDC-first hybrid from the relay PKI ADR, with admin-approved web-of-trust for self-hosted or harbor-local deployments and ACME later for name-bound daemon identity. The relay registry tracks proof method, device public key, accepted subscriptions, expiry, revocation state, and harbor memberships.',
            'Authorization belongs in Port Daddy cards. A phone card is short-lived and narrow; a home-PC card can advertise compute and accept selected requests; a colleague card can publish into project channels but cannot spawn agents, read private notes, revoke owner devices, or inherit home-PC compute. Capability attenuation must never expand rights, and the UI should show rejected capabilities as first-class feedback rather than hiding them.',
            'The relay stores event envelopes, chain heads, revocations, and routing metadata, not decrypted task content. Application payloads are end-to-end encrypted to harbor members; per-publisher event chains make rewrite or broken-history detection possible. Relay metadata is still sensitive, so channel names, payload sizes, retention, source IP handling, and audit export need explicit product policy.',
            'The home PC must be treated like a capable but local resource, not a cloud worker that anyone can drive. It can finish already-accepted local work offline, but new remote request acceptance waits for live card and policy checks. The phone can show cached stale status, but it must never pretend stale authority is live authority.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Ergonomic product design',
          paragraphs: [
            'The happy path should be physical and boring: open Port Daddy on the MacBook Pro, choose Share Harbor, scan the QR on the phone, pick the Phone profile, and see the phone appear with exactly the caps it received. Adding the home PC should feel similar, except the profile is Compute Worker and the approval screen names the resources it advertises. Adding a colleague should use a separate invite and never reuse the owner invite.',
            'The phone surface should be card-based: live/stale marker, who is asking, which device will act, exact capability used, expected cost or budget lane, and the accept/reject buttons. It should not expose a general terminal by default. Replies and approvals are ergonomic; arbitrary remote shell is not.',
            'Background agents should be helpful without becoming spooky. They may publish suggestions, test results, status, and low-risk findings silently. They should ask before side effects: spawning agents, writing files, spending meaningful budget, accepting remote compute, installing dependencies, opening tunnels, or publishing results to a colleague.',
          ],
        },
        {
          type: 'paragraph',
          title: 'What ships first',
          paragraphs: [
            'Ship the smallest useful mesh in three slices. Slice one: MacBook Pro plus phone, with QR join, live/stale status, inbox cards, replies, approval events, revocation, and no remote execution. Slice two: add the home PC as a compute worker that advertises resources, accepts predeclared low-risk requests, returns encrypted result events, and refuses anything outside its card or local policy. Slice three: add a colleague MacBook with project collaboration caps, handoff events, and a visibly narrower authority model.',
            'The first production-quality demo should be physical and plain: start the MacBook Pro daemon, join the phone by QR, see a live session status event, send an approval from the phone, and watch the MacBook Pro daemon apply it locally. Then add the home PC and show a compute result returning to both MacBook Pro and phone. Add the colleague last and prove they can see the handoff without seeing owner-only notes, secrets, or home-PC controls.',
          ],
        },
      ],
      sources: [
        {
          path: 'docs/adr/0027-relay-harbor-mesh.md',
          rationale: 'Official proposed ADR for the relay-backed harbor event mesh, device membership model, capability defaults, and non-goal against database replication.',
        },
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
          path: 'lib/harbor-tokens.ts',
          rationale: 'Current shipped harbor-card boundary: Ed25519 phase-2 cards, one-hour default TTL, JTI persistence, revocation checks, and explicit cross-machine federation deferral.',
        },
        {
          path: 'lib/messaging.ts',
          rationale: 'Current local pub/sub shared memory that relay export/import should wrap as event federation instead of replacing.',
        },
        {
          path: 'lib/tuples.ts',
          rationale: 'Current harbor-scoped tuple space; remote tuple behavior should remain policy-driven events, not distributed atomic memory.',
        },
        {
          path: 'lib/blob.ts',
          rationale: 'Content-addressed blob store now exists locally and can back larger relay/tube artifacts by hash without putting payload semantics into the relay.',
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
            'SUCCESS: Fleet "port-daddy" parsed successfully\n  agents:   8\n  watchers: 2\n  channels: 8\n  budget:   9.76\n\nSUCCESS: No topology warnings\n\nWARN: Fleet "port-daddy" defined in pd-fleet.yml but not running\nINFO:   Start with: pd fleet up\n\nINFO: Configured agents:\n  gardener — custom / backend default / schedule */10 * * * *\n  qa — ollama / qwen2.5-coder:7b / trigger git:committed\n  test-hunter — codex / gpt-5.4-mini / trigger git:committed\n  documentarian — ollama / qwen2.5-coder:7b / trigger promotion:release-surfaces\n\nINFO: Recent fleet events:\n  (no recent events)',
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
            'The failure mode is automation that looks impressive until something goes wrong. Fleet work should be dull to inspect: the same project directory, physical channel, budget decision, backend ready state, run id, and result should show up in every surface.',
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
          rationale: 'Fleet routes expose status, lifecycle controls, config editing, budget updates, backend ready state, and SSE events on the daemon.',
        },
        {
          path: 'routes/projects.ts',
          rationale: 'Project status uses fleet config state to tell operators whether to create, validate, budget, or start a fleet.',
        },
      ],
    },
    {
      slug: 'delegation-surfaces',
      title: 'Delegation Workflows',
      summary:
        'How `pd spawn`, `pd fleet`, and harbors fit together in daily use.',
      truth: 'source-backed',
      goals: [
        'Use one launch primitive for bounded AI work.',
        'Understand how harbors fit across those commands.',
        'Know where richer intake and artifact pages should attach.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'One launch primitive, richer intake around it',
          paragraphs: [
            '`pd spawn` is the public launch primitive for one bounded delegated run. Browser visual intake, roadmap buttons, review helpers, and future artifact pages can all add better context and result views, but they should lower to spawn instead of creating another operator-facing verb.',
            '`pd fleet` is the separate lifecycle for recurring automation from `pd-fleet.yml`. Harbors cut across both: a simple spawn can stay lightweight, while grouped work can enter a harbor for scoped channels, tuple isolation, membership, and capability boundaries.',
            'The most useful product rule is not "which command is newest?" It is "what context and artifacts should travel with this spawned run?"',
          ],
        },
        {
          type: 'mermaid',
          title: 'Delegation surface chooser',
          chart: delegationChoiceMap,
          caption:
            'The chooser is deliberately about work lifetime. Harbor is not a fifth launcher; it is the namespace and capability boundary that coordinated launchers should enter.',
        },
        {
          type: 'checklist',
          title: 'Delegation invariants',
          tone: 'blue',
          items: [
            'Keep `pd spawn` clear enough for scripts, SDK/MCP wrappers, backend debugging, and explicit model/budget/time control.',
            'Route every bounded delegated run through spawn: CLI, SDK, MCP, FleetBar, browser extension, roadmap action, review helper, or dispatch job.',
            'Attach artifacts, screenshots, DOM decompositions, issues, notes, transcripts, and test repros to spawned runs rather than inventing a second launch surface.',
            'Do not describe `pd fleet` like a one-shot task; it is long-lived project automation from `pd-fleet.yml`.',
            'Auto-provision or require harbors for fleets and explicit multi-run workflows instead of letting coordinated work float in the global namespace.',
            'Surface blocked, failed, waiting, completed, and cancelled as different states. Do not flatten "could not launch" and "failed while running" into one generic error.',
          ],
        },
        {
          type: 'command',
          title: 'Shipped command shapes',
          command:
            'pd spawn --backend codex --tier low --budget 0.35 --purpose "Review branch" -- "Review the last commit for regressions"\npd spawned\npd watch <spawn-id>',
          output:
            'pd spawn preflights the runtime, launches one supervised run, records coordination and budget state, and leaves a run id that other surfaces can inspect.',
          notes: [
            'A browser extension, FleetBar action, or roadmap button should collect richer context and still submit through spawn.',
            'Legacy mission records may exist in old databases, but they are not a current launch command.',
          ],
        },
        {
          type: 'command',
          title: 'Non-launching delegation sanity check',
          command: 'pd spawn --help\npd spawned --help',
          output:
            'Usage: pd spawn [options] -- <task>\nUsage: pd spawned [--json] [--limit N]',
          notes: [
            'This help output is a cheap way to verify the shipped CLI surface without launching paid or background work.',
            'It backs the page distinction: spawn launches bounded work, spawned lists what already ran.',
          ],
        },
        {
          type: 'paragraph',
          title: 'What is shipped today versus where it should go',
          paragraphs: [
            'The shipped system already has the crucial first slice: `/spawn` has preflight, launch, list, watch, explicit cancellation, and evidence collection. That is enough to make delegated work inspectable instead of purely terminal-local.',
            'The next layer is not another launch command. It is better intake and better artifacts: screenshot attachments, DOM decomposition, issue creation, roadmap links, approval state, cost so far, and a final briefing that reads like a usable result rather than raw stdout.',
            'A good UI should teach the distinction between bounded spawned work, recurring fleet automation, and harbors as coordination scope. It should not ask the operator to pick a synonym for "launch this task."',
          ],
        },
        {
          type: 'callout',
          tone: 'warning',
          title: 'Do not multiply launch nouns',
          body:
            'Users need to know what context, budget, artifacts, and authority a run has. They should not need to learn separate launch verbs for the same bounded task.',
        },
        {
          type: 'paragraph',
          title: 'Future-facing recommendation',
          paragraphs: [
            'The next version of this architecture should make spawned work visibly artifact-shaped: goal, context captures, browser DOM evidence, what is blocking launch, approval gates, timeline, cost, and final briefing.',
            'Grouped spawned runs should create or enter harbors by default when they need shared channels, tuples, file claims, notes, and approval messages.',
            'Saved templates should be the eventual bridge between one-off prompts and fleet automation. A release-check spawn template can run on demand with human gates; if it becomes routine, promote the behavior into `pd-fleet.yml`. That keeps the system understandable as it grows.',
          ],
        },
      ],
      sources: [
        {
          path: 'docs/DELEGATION-MODES.md',
          rationale: 'Delegation modes document explains spawn as the launch primitive and fleet as recurring automation.',
        },
        {
          path: 'routes/spawn.ts',
          rationale: 'Spawn routes define low-level preflight, launch, list, explicit cancellation, evidence collection, validation, and could-not-launch failures.',
        },
        {
          path: 'docs/adr/0013-unified-harbor-model.md',
          rationale: 'Harbor ADR establishes the namespace/capability model that should frame fleets and explicit multi-run delegation.',
        },
      ],
    },
  ],
}
