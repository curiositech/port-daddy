import type { DocsContentSection } from './types'

const repo = (path: string, lines?: string) => ({
  label: lines ? `${path}:${lines}` : path,
  href: `https://github.com/curiositech/port-daddy/blob/main/${path}${lines ? `#L${lines.replace('-', '-L')}` : ''}`,
})

const site = (label: string, path: string, highlight: string) => ({
  label,
  href: `https://portdaddy.dev${path}#:~:text=${encodeURIComponent(highlight)}`,
})

const jury_rig = (path: string) => ({
  label: path,
  href: `http://windag.ai/skills/${path.split('/')[1] ?? ''}`,
})

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
      variant: 'primitive-map',
      primitiveMap: {
        eyebrow: 'Concepts / primitive map',
        title: 'Primitives',
        deck: 'A source-backed map of the small runtime facts Port Daddy uses for multi-agent coordination.',
        thesis:
          'Port Daddy works best when coordination is built from small, inspectable primitives. A session is not a lock. A lock is not a note. A channel is not a handoff.',
        operatorQuestions: [
          'Who is acting?',
          'Who owns the surface?',
          'What changed?',
          'What survived?',
          'What checked it?',
          'Where can the operator see it?',
        ],
        families: [
          {
            family: 'Identity',
            question: 'Who is acting, and under what project context?',
            summary: 'Agents, sessions, semantic service names, and project-scoped channels give work a durable name.',
            tone: 'ink',
            links: [
              { label: 'agents', href: '/agents' },
              { label: 'sessions', href: '/docs/features/sessions' },
              { label: 'semantic service names', href: '/docs/features/ports' },
              { label: 'project-scoped channels', href: '/docs/cli/pub' },
            ],
          },
          {
            family: 'Ownership',
            question: 'Who intends to touch this scarce surface now?',
            summary: 'Service claims, file claims, region claims, and locks make edit intent visible before Git sees a diff.',
            tone: 'blue',
            links: [
              { label: 'service claims', href: '/docs/features/ports' },
              { label: 'file claims', href: '/docs/features/sessions' },
              { label: 'region claims', href: '/docs/features/sessions' },
              { label: 'locks', href: '/docs/sdk/locks' },
            ],
          },
          {
            family: 'Messaging',
            question: 'How do agents and tools notify each other without scraping prose?',
            summary: 'Channels, inboxes, and tuples separate broadcast events from directed handoffs and queryable facts.',
            tone: 'green',
            links: [
              { label: 'channels', href: '/docs/cli/pub' },
              { label: 'inboxes', href: '/agents/communication-protocols' },
              { label: 'tuples', href: '/docs/features/tuples' },
            ],
          },
          {
            family: 'Recovery',
            question: 'What survives when a process dies?',
            summary: 'Session notes, activity, salvage, and resurrection preserve intent after a process or context window disappears.',
            tone: 'amber',
            links: [
              { label: 'session notes', href: '/docs/cli/note' },
              { label: 'activity', href: '/docs/features/timeline' },
              { label: 'salvage', href: '/docs/features/salvage' },
              { label: 'resurrection', href: '/agents/resurrection' },
            ],
          },
          {
            family: 'Verification',
            question: 'What checks the runtime story against actual behavior?',
            summary: 'Arbiter invariants, guard checks, telemetry gates, and budget gates keep invisible policy drift from becoming normal.',
            tone: 'red',
            links: [
              { label: 'Arbiter invariants', href: '/docs/features/arbiter' },
              { label: 'guard checks', href: '/agents/coordination-guard' },
              { label: 'telemetry gates', href: '/agents/smart-resources' },
              { label: 'budget gates', href: '/agents/smart-resources' },
            ],
          },
          {
            family: 'Human Control',
            question: 'Where does a person inspect and approve the state?',
            summary: 'FleetBar, Fleet Control Center, Shipwright, Resources, and Spawned Runs make coordination visible to a human operator.',
            tone: 'ink',
            links: [
              { label: 'FleetBar', href: '/mac-preview' },
              { label: 'Fleet Control Center', href: '/mac-preview' },
              { label: 'Shipwright', href: '/agents/yaml-and-shipwright' },
              { label: 'Resources', href: '/agents/smart-resources' },
              { label: 'Spawned Runs', href: '/docs/tutorials/launch-and-inspect-a-spawn' },
            ],
          },
        ],
        layers: [
          {
            layer: 'Sessions and notes',
            encodes: 'Purpose, assumptions, progress, validation, handoff.',
            reason: 'They give work a durable human-readable trail.',
            links: [{ label: 'sessions', href: '/docs/features/sessions' }, { label: 'notes', href: '/docs/cli/note' }],
            example: {
              command:
                'pd begin "repair docs primitives" --identity port-daddy:docs:main --lifecycle durable\npd note "Scope: docs/concepts/primitives.md and website-v2 docs content."',
              output:
                'SUCCESS: Agent repair docs primitives ready\n  Session: session-repair-docs-primitives\nSUCCESS: Note added',
            },
          },
          {
            layer: 'Claims and locks',
            encodes: 'Current edit intent and scarce-resource ownership.',
            reason: 'They let nearby agents route around each other before conflict.',
            links: [{ label: 'claims', href: '/docs/features/sessions' }, { label: 'locks', href: '/docs/sdk/locks' }],
            example: {
              command:
                'pd session files add website-v2/src/docs-content/concepts.ts\npd with-lock website-build -- npm --prefix website-v2 run build',
              output:
                'Claimed 1 file(s)\nAcquired lock: website-build\n✓ built in 6.16s\nReleased lock: website-build',
            },
          },
          {
            layer: 'Channels and inboxes',
            encodes: 'Broadcast events and directed ownership.',
            reason: 'They prevent coordination from becoming transcript archaeology.',
            links: [{ label: 'channels', href: '/docs/cli/pub' }, { label: 'inboxes', href: '/agents/communication-protocols' }],
            example: {
              command:
                'pd pub coordination:inconsistency "docs surface changed; refresh before editing primitives"',
              output:
                'SUCCESS: Message published to coordination:inconsistency',
            },
          },
          {
            layer: 'Tuples',
            encodes: 'Shared machine-readable facts with TTL and pattern matching.',
            reason: 'They let agents query what the system currently knows.',
            links: [{ label: 'tuples', href: '/docs/features/tuples' }],
            example: {
              command:
                'pd tuple out \'["docs","primitives","build","green"]\' --ttl 3600000\npd tuple rd \'["docs","primitives","build","*"]\'',
              output:
                'SUCCESS: Tuple written\n["docs","primitives","build","green"]',
            },
          },
          {
            layer: 'Activity and salvage',
            encodes: 'What happened, what died, what can be resumed.',
            reason: 'They turn crashes into recoverable state.',
            links: [{ label: 'activity', href: '/docs/features/timeline' }, { label: 'salvage', href: '/docs/features/salvage' }],
            example: {
              command:
                'pd activity --limit 3\npd salvage --project port-daddy',
              output:
                'session.note  docs primitives scope recorded\nfile.claim    website-v2/src/docs-content/concepts.ts\nRecoverable work: 3 abandoned session(s)',
            },
          },
          {
            layer: 'Arbiter and gates',
            encodes: 'Runtime invariants, spend limits, telemetry requirements.',
            reason: 'They keep policy violations from hiding behind a clean commit.',
            links: [{ label: 'Arbiter', href: '/docs/features/arbiter' }, { label: 'Resources', href: '/agents/smart-resources' }],
            example: {
              command:
                'pd guard check --staged',
              output:
                'Coordination Guard: ENFORCE passed\n  checked: website-v2/src/docs-content/concepts.ts',
            },
          },
        ],
        choices: [
          { need: 'I am working on this file or symbol.', use: [{ label: 'File claim', href: '/docs/features/sessions' }, { label: 'region claim', href: '/docs/features/sessions' }], avoid: 'A chat message that no tool can query.' },
          { need: 'Only one process can touch this now.', use: [{ label: 'Lock', href: '/docs/sdk/locks' }], avoid: 'A broad file claim for a generated artifact or migration.' },
          { need: 'Someone needs to own this handoff.', use: [{ label: 'Actor inbox', href: '/agents/communication-protocols' }], avoid: 'A channel broadcast that everyone can ignore.' },
          { need: 'Everyone watching this project should know.', use: [{ label: 'Project-scoped channel', href: '/docs/cli/pub' }], avoid: 'A note hidden inside one session.' },
          { need: 'Another process should query this fact later.', use: [{ label: 'Tuple', href: '/docs/features/tuples' }], avoid: 'A paragraph that must be parsed.' },
          { need: 'This work died but should continue.', use: [{ label: 'Salvage queue', href: '/docs/features/salvage' }], avoid: 'Re-running the task from memory.' },
          { need: 'This launch is too opaque or too expensive.', use: [{ label: 'Budget and telemetry gates', href: '/agents/smart-resources' }], avoid: 'Launching first and hoping logs explain cost later.' },
        ],
        citations: [
          {
            title: 'Sessions, notes, and file or symbol claims',
            summary: 'Work has an identity, immutable notes, and advisory edit claims before Git sees the final diff.',
            websiteDocs: [
              site('Sessions', '/docs/features/sessions', 'every note is append-only, and file claims announce edit intent so overlaps are visible early'),
              site('Session file claims', '/docs/features/sessions', 'File claims are advisory locks that warn agents about overlapping edits'),
            ],
            runtimeCode: [repo('lib/sessions.ts', '1-7'), repo('lib/sessions.ts', '54-77'), repo('lib/sessions.ts', '156-282'), repo('lib/sessions.ts', '1047-1089'), repo('lib/sessions.ts', '1272-1395'), repo('routes/sessions.ts'), repo('cli/commands/sessions.ts')],
            skillDossiers: [jury_rig('skills/multi-agent-coordination/SKILL.md'), jury_rig('skills/agent-conversation-protocols/SKILL.md')],
          },
          {
            title: 'Leases, locks, and semantic port claims',
            summary: 'Scarce resources use ownership, TTLs, cleanup, and conflict responses instead of commit-time convention.',
            websiteDocs: [
              site('Ports', '/docs/features/ports', 'Port conflicts when two agents claim the same port'),
              site('Locks SDK', '/docs/sdk/locks', 'exclusive lock'),
            ],
            runtimeCode: [repo('lib/locks.ts', '1-6'), repo('lib/locks.ts', '75-105'), repo('lib/locks.ts', '126-205'), repo('lib/locks.ts', '313-422'), repo('lib/services.ts', '1-5'), repo('lib/services.ts', '16-58'), repo('routes/locks.ts'), repo('routes/services.ts')],
            skillDossiers: [jury_rig('skills/multi-agent-coordination/SKILL.md'), jury_rig('skills/ipc-communication-patterns/SKILL.md')],
          },
          {
            title: 'Pub/sub channels and direct agent inboxes',
            summary: 'Agents coordinate through project-scoped signals and durable direct messages.',
            websiteDocs: [
              site('Pub command', '/docs/cli/pub', 'Publish a message to a channel'),
              site('Communication protocols', '/agents/communication-protocols', 'communication'),
              site('Radio', '/docs/features/radio', 'task claims, handoffs, done signals'),
            ],
            runtimeCode: [repo('lib/messaging.ts', '1-5'), repo('lib/messaging.ts', '72-140'), repo('lib/messaging.ts', '150-213'), repo('lib/messaging.ts', '303-397'), repo('lib/agent-inbox.ts', '1-10'), repo('routes/messaging.ts')],
            skillDossiers: [jury_rig('skills/agent-conversation-protocols/SKILL.md'), jury_rig('skills/ipc-communication-patterns/SKILL.md')],
          },
          {
            title: 'Tuple space',
            summary: 'Shared facts live in a queryable board with pattern matching, harbor scope, TTL, reads, and takes.',
            websiteDocs: [
              site('Tuples', '/docs/features/tuples', 'a place to post work items, claim tasks, and coordinate state'),
              site('Tuple CLI', '/docs/cli/tuple', 'tuple'),
            ],
            runtimeCode: [repo('lib/tuples.ts', '1-20'), repo('lib/tuples.ts', '40-59'), repo('lib/tuples.ts', '79-159'), repo('lib/tuples.ts', '181-280'), repo('routes/tuples.ts'), repo('cli/commands/tuples.ts'), repo('mcp/server.ts', '2336-2391')],
            skillDossiers: [jury_rig('skills/multi-agent-coordination/SKILL.md'), jury_rig('skills/agent-conversation-protocols/SKILL.md')],
          },
          {
            title: 'Harbors, capability cards, and zero-trust boundaries',
            summary: 'Capability scope is recorded in harbors and backed by daemon-held token issuance and verifier rules.',
            websiteDocs: [
              site('Harbors', '/docs/features/harbors', 'create reviewer --cap'),
              site('Create harbor MCP', '/docs/mcp/create-harbor', 'Create a scoped harbor'),
            ],
            runtimeCode: [repo('lib/harbors.ts', '1-15'), repo('lib/harbors.ts', '41-72'), repo('lib/harbor-tokens.ts', '1-24'), repo('lib/harbor-tokens.ts', '121-380'), repo('routes/harbors.ts')],
            skillDossiers: [jury_rig('skills/agentic-zero-trust-security/SKILL.md'), jury_rig('skills/ostrom-commons-governance/SKILL.md')],
          },
          {
            title: 'Append-only activity, timelines, and evidence trails',
            summary: 'Port Daddy records the operating trace: claims, locks, notes, releases, violations, and spawn events.',
            websiteDocs: [
              site('Timeline', '/docs/features/timeline', 'claim    myapp:api:main'),
              site('Activity CLI', '/docs/cli/activity', 'activity'),
            ],
            runtimeCode: [repo('lib/activity.ts', '1-6'), repo('lib/activity.ts', '16-52'), repo('lib/activity.ts', '147-164'), repo('lib/activity.ts', '226-380'), repo('routes/activity.ts'), repo('cli/commands/activity.ts'), repo('lib/sessions.ts', '1047-1089')],
            skillDossiers: [jury_rig('skills/runtime-verification-for-agents/SKILL.md'), jury_rig('skills/game-theoretic-agent-incentives/SKILL.md')],
          },
          {
            title: 'Runtime monitors and invariant enforcement',
            summary: 'Safety rules can fire while the daemon is running, with strict mode escalating violations.',
            websiteDocs: [
              site('Arbiter', '/docs/features/arbiter', 'Catches impersonation'),
              site('Coordination Guard', '/agents/coordination-guard', 'Coordination Guard'),
            ],
            runtimeCode: [repo('lib/arbiter.ts', '1-12'), repo('lib/arbiter.ts', '102-209'), repo('lib/arbiter.ts', '213-245'), repo('lib/arbiter.ts', '297-353'), repo('lib/agents.ts', '320-390'), repo('lib/bosun-heartbeat.ts')],
            skillDossiers: [jury_rig('skills/runtime-verification-for-agents/SKILL.md'), jury_rig('skills/runtime-verification-for-agents/diagrams/01_flowchart_decision-points.md')],
          },
          {
            title: 'Budget, cost, and economic gates',
            summary: 'Cost recording, exact telemetry policy, budget ledgers, and fleet permits affect whether agents may launch.',
            websiteDocs: [
              site('Spawn MCP', '/docs/mcp/spawn-agent', 'Launch an agent'),
              site('Fleet', '/docs/features/fleet', 'budget'),
              site('Resources', '/agents/smart-resources', 'Resources'),
            ],
            runtimeCode: [repo('lib/budget-guard.ts', '1-52'), repo('lib/budget-guard.ts', '149-232'), repo('lib/cost-tracker.ts', '1-17'), repo('lib/backend-telemetry-policy.ts', '11-99'), repo('lib/fleet-engine.ts', '690-709'), repo('lib/fleet-engine.ts', '1543-1560')],
            skillDossiers: [jury_rig('skills/game-theoretic-agent-incentives/SKILL.md'), jury_rig('skills/ostrom-commons-governance/SKILL.md')],
          },
        ],
        skillTrail: [
          jury_rig('skills/multi-agent-coordination/SKILL.md'),
          jury_rig('skills/agent-conversation-protocols/SKILL.md'),
          jury_rig('skills/ipc-communication-patterns/SKILL.md'),
          jury_rig('skills/agentic-zero-trust-security/SKILL.md'),
          jury_rig('skills/runtime-verification-for-agents/SKILL.md'),
          jury_rig('skills/game-theoretic-agent-incentives/SKILL.md'),
          jury_rig('skills/ostrom-commons-governance/SKILL.md'),
          jury_rig('skills/next-move/SKILL.md'),
          jury_rig('skills/next-move/references/runtime-honesty.md'),
          jury_rig('docs/METHODOLOGY.md'),
          jury_rig('docs/screenshots/skill-search-bm25.png'),
        ],
      },
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
            'Human control: [FleetBar](/mac-preview), [Fleet Control Center](/mac-preview), [Shipwright](/agents/yaml-and-shipwright), [Resources](/agents/smart-resources), and [Spawned Runs](/docs/tutorials/launch-and-inspect-a-spawn).',
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
            'A Port Daddy session ties identity, purpose, lifecycle, file claims, and notes together into a durable record. `pd begin "<purpose>" --lifecycle durable` creates an ordinary agent work session. `pd note` appends immutable evidence — notes are append-only and cannot be edited or deleted individually, which is what makes them trustworthy as handoff context. `pd done "<summary>"` closes it cleanly, releases file claims, and marks the session completed.',
            'The session record in `lib/sessions.ts` stores a `status` of `active`, `completed`, or `abandoned`, and a `phase` (such as `in_progress`, `planning`, or `reviewing`). On top of these, the Coordination Guard and skill references define a derived lifecycle view: a freshly created session with no claims or notes yet, an active session that has been observed recently, an idle session whose heartbeat window has lapsed, an abandoned session that has entered the salvage queue, a salvaged session being continued by a new agent, and a completed session. Knowing these derived states matters for interpreting guard check output and salvage queue entries.',
          ],
        },
        {
          type: 'command',
          title: 'The basic session loop',
          command:
            'pd begin "Add rate limiting to the auth API" --identity myapp:api:main --lifecycle durable\npd note "Scope: lib/auth.ts, routes/auth.ts. Using sliding-window limiter."\npd session files add lib/auth.ts\npd done "Rate limiting added, tests passing."',
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
          title: 'Signal what is ready and declare a dependency',
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
            'pd begin --identity myapp:api:main --lifecycle durable attaches the session to that identity for salvage and briefing filters.',
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
  ],
}
