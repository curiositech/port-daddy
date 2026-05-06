import { PRODUCT_FEATURES } from '@/data/product'
import type { DocsContentSection } from './types'

const productPrimitiveItems = PRODUCT_FEATURES.map(
  (feature) => `${feature.title}: ${feature.description}`,
)

export const conceptsSection: DocsContentSection = {
  slug: 'concepts',
  title: 'Concepts',
  summary:
    'The ideas behind semantic identity, ownership primitives, session lifecycle, agent recovery, harbors, channels, tuples, fleet management, and runtime invariant enforcement.',
  pages: [
    {
      slug: 'primitives',
      title: 'Primitives',
      summary:
        'The official Primitive Map: how Port Daddy separates identity, ownership, messaging, recovery, verification, and human control into small runtime primitives.',
      truth: 'source-backed',
      goals: [
        'Understand the six primitive families behind Port Daddy coordination.',
        'Choose the right primitive for ownership, messaging, recovery, verification, or human control.',
        'Use the Primitive Map design variant for source-backed explanations of runtime state.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Small primitives beat one big orchestration claim',
          paragraphs: [
            'Port Daddy works best when coordination is built from small, inspectable primitives. A [session](/docs/features/sessions) is not a [lock](/docs/sdk/locks). A lock is not a [note](/docs/cli/note). A [channel](/docs/cli/pub) is not a handoff. Each primitive stores a different kind of fact with a different lifetime.',
            'The six primitive families are [identity](/docs/features/ports), [ownership](/docs/features/sessions), [messaging](/agents/communication-protocols), [recovery](/docs/features/salvage), [verification](/docs/features/arbiter), and [human control](/mac-preview). Together they answer the questions a human or agent needs before changing a repo: who is acting, who owns the surface, what changed, what survived, what checked it, and where can the operator see it?',
          ],
        },
        {
          type: 'checklist',
          items: [
            'Identity: [agents](/agents), [sessions](/docs/features/sessions), [semantic service names](/docs/features/ports), and [project-scoped channels](/docs/cli/pub).',
            'Ownership: [service claims](/docs/features/ports), [file claims](/docs/features/sessions), [region claims](/docs/features/sessions), and [locks](/docs/sdk/locks).',
            'Messaging: [channels](/docs/cli/pub), [inboxes](/agents/communication-protocols), and [tuples](/docs/features/tuples).',
            'Recovery: [session notes](/docs/cli/note), [activity](/docs/features/timeline), [salvage](/docs/features/salvage), and [resurrection](/agents/resurrection).',
            'Verification: [Arbiter invariants](/docs/features/arbiter), [guard checks](/agents/coordination-guard), [telemetry gates](/agents/smart-resources), and [budget gates](/agents/smart-resources).',
            'Human control: [FleetBar](/mac-preview), [Fleet Control Center](/mac-preview), [Shipwright](/agents/yaml-and-shipwright), [Resources](/agents/smart-resources), and [Sorties](/docs/tutorials/launch-and-inspect-a-sortie).',
          ],
        },
        {
          type: 'paragraph',
          title: 'Choose by lifetime',
          paragraphs: [
            'Use a [file claim](/docs/features/sessions) or [region claim](/docs/features/sessions) when an agent intends to edit a file or symbol. Use a [lock](/docs/sdk/locks) when simultaneous access would corrupt the result. Use a [channel](/docs/cli/pub) when everyone watching a project should know. Use an [inbox](/agents/communication-protocols) when one durable owner should respond. Use a [tuple](/docs/features/tuples) when another process should query a machine-readable fact later.',
            'The rule of thumb is simple: use the primitive whose lifetime matches the fact. A transient event should not become a permanent [note](/docs/cli/note). A scarce resource should not be protected only by prose. A handoff should not be hidden in a broadcast stream.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Primitive Map design variant',
          paragraphs: [
            'Primitive-heavy pages should look like operator instruments, not generic feature grids. The official Primitive Map variant uses hard rules, compact fact tables, semantic color, source rows, and one decisive CTA per viewport.',
            'The variant is documented in `docs/design-system/primitives-variant.md`. Use it for runtime-primitives concept pages, Mac preview proof surfaces, and source-backed launch or review artifacts.',
          ],
        },
      ],
      sources: [
        {
          path: 'docs/concepts/primitives.md',
          rationale: 'Canonical repo concept page for the Primitive Map.',
        },
        {
          path: 'docs/design-system/primitives-variant.md',
          rationale: 'Official design-system variant for primitive explanations.',
        },
        {
          path: 'lib/sessions.ts',
          rationale: 'Sessions, notes, file claims, lifecycle state, and salvage handoff data.',
        },
        {
          path: 'lib/locks.ts',
          rationale: 'Exclusive coordination over scarce resources.',
        },
        {
          path: 'lib/tuples.ts',
          rationale: 'Shared machine-readable facts with pattern matching and TTL.',
        },
        {
          path: 'lib/arbiter.ts',
          rationale: 'Runtime invariant checks over coordination state.',
        },
      ],
    },
    {
      slug: 'daemon-and-authority',
      title: 'Why There Is A Daemon',
      summary:
        'Why Port Daddy runs a local service, what that service enforces, and how it separates infrastructure from orchestration.',
      truth: 'source-backed',
      goals: [
        'Understand why Port Daddy needs one local service.',
        'Understand the building-department model: Port Daddy enforces, orchestrators decide.',
        'Understand the Arbiter and the runtime invariants it checks.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'One service, shared state',
          paragraphs: [
            'Once more than one agent is touching the same repo or machine, private terminal memory is not enough. Port Daddy runs a single local service that stores sessions, notes, locks, ports, file claims, harbors, and salvage state in a SQLite database. Every CLI call, dashboard query, and MCP tool reads from the same record — so handoffs, recovery, and attribution work whether the next reader is a human or another agent.',
            'The daemon uses SQLite with WAL mode so state survives restarts, and agents can reconnect with automatic retry rather than starting from scratch. Agents still do the coding work. The daemon keeps the shared state those agents need so their work does not dissolve into scattered logs and half-remembered handoffs.',
          ],
        },
        {
          type: 'paragraph',
          title: 'The building-department model',
          paragraphs: [
            'A building department issues permits, enforces code, inspects outcomes, and maintains records. It does not decide the floor plan. Port Daddy works the same way: it provides generic infrastructure — ports, locks, identities, sessions, notes, pub/sub, DNS, harbors, the Arbiter — but never decides which tasks to assign, in what order, or with which model. That is the orchestrator\'s job.',
            'Orchestrators decompose work, assign agents, decide merge ordering, choose prompts, and manage context windows. Their competitive advantage is domain knowledge that Port Daddy cannot and should not encode. Port Daddy ships a simple FIFO orchestrator that works for solo developers and small trusted fleets. Custom orchestrators plug in via `lib/orchestrator-plugins.ts` with hot-swap, no daemon restart required.',
          ],
        },
        {
          type: 'checklist',
          items: [
            'Port Daddy provides: ports, sessions, notes, locks, file claims, salvage, pub/sub, DNS, harbors, Arbiter invariants.',
            'Orchestrators provide: task decomposition, agent assignment, merge ordering, prompt engineering, retry logic.',
            'The default FIFO orchestrator is deliberate: solo devs and small trusted fleets do not need more.',
            'Custom orchestrators plug in via lib/orchestrator-plugins.ts and can hot-swap without restarting the daemon.',
          ],
        },
        {
          type: 'paragraph',
          title: 'The Arbiter',
          paragraphs: [
            'The Arbiter subscribes to Port Daddy\'s activity log and checks every state transition against six named invariants: `PID_SQUATTING` (service claims must come from the registered PID), `CAP_ESCALATION` (capability-scoped locks cannot exceed the agent\'s granted capability set), `NOTE_MONOTONICITY` (notes are append-only — no backdating or edits), `ESCROW_POSITIVE` (budget escrow cannot go negative), `LOCK_OWNER_VALID` (lock holders must be live agents), and `HEARTBEAT_FRESHNESS` (heartbeats must reference a registered agent identity).',
            'In observe-only mode the Arbiter logs violations without blocking operations. In strict mode a critical invariant break causes the Arbiter to log a `system.man_overboard` activity event — operators and orchestrators can subscribe to that event and trigger recovery. The Arbiter status and violation log are accessible at `GET /arbiter/status` and `GET /arbiter/violations`.',
          ],
        },
      ],
      sources: [
        {
          path: 'lib/arbiter.ts',
          rationale: 'Arbiter rule definitions, enforcement logic, Rust FFI bridge for constant-time comparison, and violation storage.',
        },
        {
          path: 'lib/orchestrator-plugins.ts',
          rationale: 'The orchestrator plugin interface that lets custom orchestrators replace the default FIFO scheduler.',
        },
        {
          path: 'docs/VISION-AND-PERSPECTIVES.md',
          rationale: 'The building-department model, its relationship to Domain-Driven Design, and the competitive separation between infrastructure and orchestration.',
        },
      ],
    },
    {
      slug: 'sessions-locks-and-tuples',
      title: 'Sessions, Locks, and Tuples',
      summary:
        'The full coordination stack: session lifecycle, the three ownership primitives, the salvage queue, pub/sub channels, tuples, integration signals, and Coordination Guard.',
      truth: 'source-backed',
      goals: [
        'Understand the begin → note → done lifecycle and what each state means.',
        'Distinguish service claims, file claims, and locks from each other.',
        'Know when to use channels versus tuples for coordination.',
        'Use integration signals and Coordination Guard in a multi-agent workflow.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Sessions: durable records of intent',
          paragraphs: [
            'A Port Daddy session ties identity, purpose, file claims, and notes together into a durable record. `pd begin "<purpose>"` creates the session. `pd note` appends immutable evidence — notes are append-only and cannot be edited or deleted individually, which is what makes them trustworthy as handoff context. `pd done "<summary>"` closes it cleanly, releases file claims, and marks the session completed.',
            'The session record in `lib/sessions.ts` stores a `status` of `active`, `completed`, or `abandoned`, and a `phase` (such as `in_progress`, `planning`, or `reviewing`). On top of these, the Coordination Guard and skill references define a derived lifecycle view: a freshly created session with no claims or notes yet, an active session that has been observed recently, an idle session whose heartbeat window has lapsed, an abandoned session that has entered the salvage queue, a salvaged session being continued by a new agent, and a completed session. Knowing these derived states matters for interpreting guard check output and salvage queue entries.',
          ],
        },
        {
          type: 'command',
          title: 'The basic session loop',
          command:
            'pd begin "Add rate limiting to the auth API" --identity myapp:api:main\npd note "Scope: lib/auth.ts, routes/auth.ts. Using sliding-window limiter."\npd session files add lib/auth.ts\npd done "Rate limiting added, tests passing."',
          output:
            'SUCCESS: Agent Add rate limiting to the auth API ready\n  Session: session-add-rate-limiting-to-the-auth-api\n  Identity: myapp:api:main\nSUCCESS: Note added\nSUCCESS: lib/auth.ts claimed\nSUCCESS: Session completed',
          notes: [
            'Drop a scope note immediately after begin to transition the session from CREATED to ACTIVE.',
            'pd whoami confirms the active session before committing or closing.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Service claims, file claims, and locks',
          paragraphs: [
            'Port Daddy has three ownership primitives, each with a different scope and enforcement model. A **service claim** (`pd claim myapp:api`) reserves a deterministic port for a semantic identity — it persists across restarts and answers "what port does myapp:api use?" A **file claim** (`pd session files add <path>`) is advisory ownership of a file during a session, recorded so other agents know where to look before touching the same path. A **lock** (`pd with-lock <name> -- <cmd>`) is an exclusive critical section: only one holder at a time, the caller blocks until released.',
            'Choosing the right primitive matters because enforcement levels differ. Service and file claims are advisory by default — violating them produces warnings unless Coordination Guard is installed in enforce mode. Locks are exclusive and blocking: a second caller waits. Use service claims for port reservations, file claims for edit intent, and locks for migration runs, generated asset production, and any section where simultaneous access would corrupt state.',
          ],
        },
        {
          type: 'command',
          title: 'Claim a port and lock a critical section',
          command:
            'pd claim myapp:api\npd with-lock migration -- npm run migrate',
          output:
            'SUCCESS: myapp:api claimed port 3401\nAcquired lock: migration\nnpm run migrate\nReleased lock: migration',
          notes: [
            'pd release myapp:api frees the port when the service stops.',
            'pd locks lists all currently held locks and their owners.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Agents, services, and sessions are not the same thing',
          paragraphs: [
            'An **agent** is a live process registered with the daemon — it has a heartbeat, a PID, and can own sessions and file claims while it is alive. A **service** is a claimed port assignment that persists independently of any particular process. A **session** is a unit of work: purpose, notes, file claims, and lifecycle state stored durably so it can outlive the process that created it.',
            'The confusion usually comes from the fact that a typical agent flow touches all three. You `pd begin` to create a session, the daemon registers you as an agent, and `pd claim` gives you a service port. But they are separate records with separate lifecycles — a session can survive an agent death, and a service can outlive both.',
          ],
        },
        {
          type: 'paragraph',
          title: 'The salvage queue',
          paragraphs: [
            'When an agent stops heartbeating — context window full, terminal closed, machine slept — the daemon\'s reaper marks it dead and moves its session to the salvage queue. The queue preserves everything: purpose, notes, and file claims. Another agent runs `pd salvage --project myapp` to inspect what was abandoned and `pd salvage claim <agentId>` to continue it. The daemon detects machine sleep and starts a grace period so agents are not falsely killed when the laptop wakes.',
            'Salvage is not cleanup. It is the designed continuation path for multi-agent work where agents regularly fail mid-task. Running `pd salvage` before starting new work is the standard practice.',
          ],
        },
        {
          type: 'command',
          title: 'Inspect and claim abandoned work',
          command:
            'pd salvage --project myapp\npd salvage claim dead-agent-42',
          output:
            'Recoverable work:\n  dead-agent-42  Add rate limiting to the auth API  (myapp:api:main)\nSUCCESS: Salvage claimed dead-agent-42\n  Continuing session session-add-rate-limiting-to-the-auth-api',
          notes: [
            'Read the original notes with pd notes after claiming to understand what was done before you arrived.',
            'pd salvage dismiss <id> marks the work moot and removes it from the queue.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Channels, pub/sub, and tuples',
          paragraphs: [
            'Port Daddy\'s messaging layer gives agents named event streams and a Linda-style shared data structure. **Channels** are for events: `pd pub git:committed "feat: add rate limiting"` fires an event any subscriber can react to. Channel names follow the semantic identity convention so they are self-describing in logs. `pd sub <channel>` watches and prints messages as they arrive. `pd tube <channel>` adds conversation threading on top of the same channel with a per-message reply envelope.',
            '**Tuples** solve a different problem: structured facts that another process should query by pattern, not read as prose. An agent writes `pd tuple out \'["migration","users","complete"]\'` and another queries it with `pd tuple rd \'["migration","users","*"]\'`. The `rd` operation is non-destructive; `in` atomically takes the tuple out of the space. Use channels for events and notifications; use tuples for machine-queryable coordination facts.',
          ],
        },
        {
          type: 'command',
          title: 'Publish an event and write a tuple',
          command:
            'pd pub git:committed "feat: rate limiting"\npd tuple out \'["build","status","green"]\'\npd tuple rd \'["build","*","*"]\'',
          output:
            'SUCCESS: Message published to git:committed\nSUCCESS: Tuple written (id: 42)\n["build","status","green"]  (myapp:api:main, 3s ago)',
          notes: [
            'pd channels lists all active channels and message counts.',
            'Tuples support --harbor <name> to scope them to a project boundary.',
            'Use --ttl <ms> to set automatic tuple expiry.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Integration signals',
          paragraphs: [
            'Integration signals are a convention on top of pub/sub channels. Two signal types exist: `ready` means a service has finished something and downstream consumers can proceed; `needs` means a service is blocked waiting for an upstream dependency. Port Daddy publishes each signal to a channel named `integration:<project>:ready` or `integration:<project>:needs`, so any agent, watcher, or human can subscribe. Fleet agents can trigger directly on these channels with `trigger: integration:myapp:ready` in `pd-fleet.yml`.',
          ],
        },
        {
          type: 'command',
          title: 'Signal readiness and declare a dependency',
          command:
            'pd integration ready myapp:api "Auth endpoints live at :3401"\npd integration needs myapp:frontend "Waiting for API auth endpoints"',
          output:
            'SUCCESS [ready] myapp:api: Auth endpoints live at :3401\n  Channel: integration:myapp:ready\nSUCCESS [needs] myapp:frontend: Waiting for API auth endpoints\n  Channel: integration:myapp:needs',
          notes: [
            'pd integration list --project myapp shows all recent signals across the project.',
            'The project segment of the identity determines which channel receives the signal.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Coordination Guard',
          paragraphs: [
            'Coordination Guard installs a git pre-commit hook that blocks commits from agents without an active session and matching file claims. Before every commit it asks the daemon two questions: is there an active session attached to this shell, and does that session own all staged files? In enforce mode a failing check blocks the commit entirely. In warn mode it prints a warning but allows it through.',
            'The guard also intercepts destructive git operations — `reset --hard`, `clean -f`, `stash push`, `rebase`, and others — via a shell shim at `~/.port-daddy/bin/git`. This catches the case where an agent unintentionally overwrites another session\'s claimed files. Fix violations by closing the session that owns the contested file or claiming the file in your session; do not use `--no-verify`.',
          ],
        },
        {
          type: 'command',
          title: 'Install the guard and check before committing',
          command:
            'pd guard install --mode enforce\npd guard check --staged',
          output:
            'SUCCESS: Coordination Guard installed\n  Mode: enforce\n  Hook: .git/hooks/pre-commit\nSUCCESS: Coordination Guard check passed\n  Session: session-add-rate-limiting (active)\n  Claims: all staged files owned by active session',
          notes: [
            'The guard config is committed to .portdaddy/coordination-guard.json so all contributors see it.',
            'pd who-owns <path> shows which session owns a file if a violation names a contested path.',
          ],
        },
      ],
      sources: [
        {
          path: 'lib/sessions.ts',
          rationale: 'Session storage, immutable notes, file claims, state machine transitions.',
        },
        {
          path: 'lib/resurrection.ts',
          rationale: 'Salvage queue storage, claim operations, and reaper logic.',
        },
        {
          path: 'server.ts',
          rationale: 'Sleep detection and grace period (`isInSleepGracePeriod`) that suspends agent death checks after the machine wakes.',
        },
        {
          path: 'lib/messaging.ts',
          rationale: 'Pub/sub channels, publish, subscribe, and message storage.',
        },
        {
          path: 'lib/tuples.ts',
          rationale: 'Linda-style tuple space: write, read, take, scan, and pattern-matching.',
        },
        {
          path: 'cli/commands/guard.ts',
          rationale: 'Coordination Guard installation, hook generation, check logic, and destructive-git-verb shim.',
        },
        {
          path: 'cli/commands/integration.ts',
          rationale: 'Integration signal CLI: ready, needs, and list subcommands over pub/sub channels.',
        },
        {
          path: 'docs/adr/0007-immutable-session-notes.md',
          rationale: 'ADR explaining why notes are append-only and the coordination-trust implications.',
        },
        {
          path: 'docs/adr/0008-agent-resurrection-pattern.md',
          rationale: 'ADR describing heartbeat detection, the resurrection queue, and sleep grace period.',
        },
      ],
    },
    {
      slug: 'harbors-and-identity',
      title: 'Harbors and Identity',
      summary:
        'How semantic identity names every resource, how harbors scope coordination to project boundaries, how DNS maps identities to hostnames, and how fleet YAML declares always-on agent topologies.',
      truth: 'source-backed',
      goals: [
        'Use project:stack:context identity correctly and know when partial identities are enough.',
        'Understand harbors as named permission namespaces and when they matter.',
        'Register a service DNS record and reach it by hostname.',
        'Understand pd-fleet.yml and the fleet engine that drives it.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'Semantic identity: project:stack:context',
          paragraphs: [
            'Every service, agent, and session in Port Daddy has a semantic identity of the form `project:stack:context`. The three segments correspond to which application, which service type within that application, and which instance or branch. `myapp:api:main` is the main-branch API server of the myapp project. Identities are hierarchical and queryable: `pd find "myapp:*"` lists every stack under myapp, and `pd release "myapp:api:*"` releases all instances of the API stack at once.',
            'The same identity always resolves to the same port — assignment is deterministic via hashing, so two agents using `myapp:api:main` in the same session will always get port 3401 (or whichever port was assigned) without coordinating out of band. Partial identities are valid: `myapp` and `myapp:api` are both legal, and most single-instance services never need the context segment. The identity parser in `lib/identity.ts` is shared across services, agents, locks, harbors, and salvage filters so the convention works everywhere.',
          ],
        },
        {
          type: 'command',
          title: 'Claim a port and query with wildcards',
          command:
            'pd claim myapp:api\npd find "myapp:*"',
          output:
            'SUCCESS: myapp:api claimed port 3401\nmyapp:api        3401  running\nmyapp:frontend   3402  running',
          notes: [
            'Use quotes around wildcard patterns in the shell to prevent glob expansion.',
            'pd begin --identity myapp:api:main attaches the session to that identity for salvage and briefing filters.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Harbors: named permission namespaces',
          paragraphs: [
            'A harbor is a named namespace that scopes agent coordination, pub/sub channels, tuple spaces, and capabilities to a project boundary. Agents that enter a harbor share visibility of that harbor\'s resources without leaking them to unrelated agents on the same machine. For most solo-developer workflows the implicit per-project harbor is enough and requires no manual setup. Explicit harbors matter when you need clearer isolation between projects or when multiple teams share the same machine.',
            'Harbors issue ed25519-signed tokens that prove an agent was admitted by the daemon. Every daemon route validates the token\'s scope claim, so an agent operating inside `myapp` cannot access resources scoped to `otherapp`. This is the security layer that makes Port Daddy safe to use across unrelated projects on the same machine. The cryptographic work is in `lib/harbor-tokens.ts`; the scope verification runs in every Fastify pre-handler hook.',
          ],
        },
        {
          type: 'command',
          title: 'Create and inspect a harbor',
          command:
            'pd harbor create myapp\npd harbors',
          output:
            'SUCCESS: Harbor myapp created\nHARBOR        MEMBERS  CREATED\nmyapp         1        30s ago',
          notes: [
            'Agents automatically enter the harbor matching their identity prefix when they begin a session.',
            'Tuples written with --harbor myapp are only visible to harbor members.',
          ],
        },
        {
          type: 'paragraph',
          title: 'DNS records: friendly names for local services',
          paragraphs: [
            'When you register a service with Port Daddy\'s DNS layer, it maps the semantic identity to a `.local` hostname in `/etc/hosts`. `myapp:api` becomes `myapp-api.local`. Any process on the machine can then reach the service at `http://myapp-api.local:3401` without knowing the port number was assigned dynamically. Port Daddy manages a delimited section of `/etc/hosts` and syncs it whenever records change.',
            'The DNS module is pure SQLite-backed — it does not require mDNS or Bonjour to function, though optional Bonjour advertisement is supported when available. Run `pd dns setup` once (requires sudo) to initialize the managed `/etc/hosts` section. After that, `pd dns register` and `pd dns unregister` keep the records current.',
          ],
        },
        {
          type: 'command',
          title: 'Register a DNS record',
          command:
            'pd dns register myapp:api --port 3401\npd dns list',
          output:
            'SUCCESS: myapp:api registered as myapp-api.local:3401\nIDENTITY        HOSTNAME              PORT\nmyapp:api       myapp-api.local       3401\nmyapp:frontend  myapp-frontend.local  3402',
          notes: [
            'pd dns setup (requires sudo) initializes the managed /etc/hosts section the first time.',
            'pd dns cleanup removes stale entries whose services are no longer registered.',
          ],
        },
        {
          type: 'paragraph',
          title: 'Fleet and pd-fleet.yml',
          paragraphs: [
            'A fleet is a set of always-on background agents defined in `pd-fleet.yml` at the project root. Each agent has a trigger (a pub/sub channel to react to) or a schedule (a cron expression), a backend (`claude`, `ollama`, `codex`, or `custom`), a prompt with template variables, and optional lifecycle hooks. Port Daddy\'s fleet engine reads the YAML, resolves template variables like `{project}`, `{branch}`, `{changed_files}`, and manages agent lifecycles internally via `pd spawn` and `pd watch`.',
            'The `pd-fleet.yml` format separates services (running servers with port assignments) from agents (AI processes that respond to events). Every fleet agent registers a session and sends heartbeats, so crashed fleet agents land in the salvage queue like any other agent. `pd fleet status` shows the live state of all declared agents and services. `pd fleet run <agent>` runs a specific agent once, ignoring its trigger or schedule.',
          ],
        },
        {
          type: 'command',
          title: 'Inspect a running fleet',
          command: 'pd fleet status',
          output:
            'Fleet: myapp-dev\nAGENT          STATUS   LAST RUN   TRIGGER/SCHEDULE\ngardener       idle     10m ago    */10 * * * *\nqa             idle     8m ago     git:committed\ndocumentarian  idle     8m ago     git:committed\n\nServices: api (3401), frontend (3402)',
          notes: [
            'pd fleet up starts all agents and watchers defined in pd-fleet.yml.',
            'pd fleet down stops all fleet agents cleanly.',
          ],
        },
        {
          type: 'callout',
          tone: 'info',
          title: 'Harbors are where the deeper security story starts',
          body:
            'If you want to understand the cryptographic whitepaper, start with harbors. They are the feature that turns signed identity into something a local agent workflow can actually use — scoped access, portable tokens, and verifiable admission without manual certificate management.',
        },
      ],
      sources: [
        {
          path: 'lib/identity.ts',
          rationale: 'The canonical parser, validator, and SQL wildcard translator for all three-segment identities.',
        },
        {
          path: 'lib/harbors.ts',
          rationale: 'Harbor creation, entry/leave operations, membership queries, and scope enforcement.',
        },
        {
          path: 'lib/harbor-tokens.ts',
          rationale: 'ed25519 token issuance and scope claim verification for harbor admission.',
        },
        {
          path: 'lib/dns.ts',
          rationale: 'DNS record storage, hostname generation from identity, and /etc/hosts management.',
        },
        {
          path: 'lib/fleet-engine.ts',
          rationale: 'Fleet engine: YAML parsing, template resolution, spawn management, and lifecycle events.',
        },
        {
          path: 'docs/adr/0003-semantic-identity-system.md',
          rationale: 'ADR explaining why colon-delimited hierarchical identity was chosen over paths, dots, or UUIDs.',
        },
        {
          path: 'docs/adr/0013-unified-harbor-model.md',
          rationale: 'ADR describing the unified harbor model, implicit sandboxing, and the ed25519 security layer.',
        },
        {
          path: 'docs/adr/0019-declarative-fleet-yaml.md',
          rationale: 'ADR describing the pd-fleet.yml schema, agent properties, template variables, and CLI integration.',
        },
      ],
    },
    {
      slug: 'eleven-product-primitives',
      title: 'Eleven Product Primitives',
      summary:
        'How the home-page feature cards map to the Mac app, CLI, and daemon.',
      truth: 'source-backed',
      goals: [
        'Name the eleven public product primitives.',
        'Understand which primitives appear in the Mac app.',
        'Understand which primitives are CLI or daemon-backed features.',
      ],
      blocks: [
        {
          type: 'paragraph',
          title: 'The primitive list is the product map',
          paragraphs: [
            'The eleven primitives on the public site are not decorative feature cards. They are the quickest map from a visitor question to a real feature: FleetBar, Fleet Control Center, Shipwright, sorties, resources, backend readiness, agent communication, file claims, Coordination Guard, harbors, and salvage.',
            'Together, they answer the basic product question: Port Daddy is a local app and service that makes shared agent work visible, attributable, and recoverable.',
          ],
        },
        {
          type: 'checklist',
          items: productPrimitiveItems,
        },
        {
          type: 'paragraph',
          title: 'The Mac app and daemon work together',
          paragraphs: [
            'FleetBar and Fleet Control Center are the Mac-facing parts. The daemon-backed features underneath are sessions, notes, channels, inboxes, claims, tuples, guard checks, harbors, backend readiness, budgets, and salvage state.',
            'Shipwright connects those layers during cold start. It surveys a repo, proposes a starter fleet, simulates risk and budget, then sends you back to Flow, Agents, YAML, and Resources.',
          ],
        },
      ],
      sources: [
        {
          path: 'website-v2/src/data/product.ts',
          rationale: 'Public product data defines the eleven primitives used by the home page and Mac preview.',
        },
        {
          path: 'website-v2/src/components/landing/MacAppShowcase.tsx',
          rationale: 'Mac app showcase maps those primitives to FleetBar and Fleet Control Center screenshots.',
        },
      ],
    },
  ],
}
