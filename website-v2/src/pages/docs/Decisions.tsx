import { ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import { DocsHero } from '@/components/site/primitives'

const GITHUB_BASE = 'https://github.com/curiositech/port-daddy/blob/main/docs/adr'

type AdrStatus = 'ACCEPTED' | 'PROPOSED' | 'DEPRECATED' | 'DRAFT' | 'SECURITY REVIEW'

interface Adr {
  number: string
  filename: string
  title: string
  status: AdrStatus
  summary: string
}

const ADRS: Adr[] = [
  {
    number: '0026',
    filename: '0026-fleet-ast-and-diagnostics.md',
    title: 'Fleet AST + Diagnostic Taxonomy',
    status: 'PROPOSED',
    summary:
      'Port Daddy is adding structured, line-level error reporting to fleet configuration files. When you write a pd-fleet.yml to declare your background agent network, the system will surface precise diagnostics -- covering topology cycles, cost estimates, cron expressions, and security issues -- instead of opaque error strings. This powers a planned Fleet Console code editor that annotates your YAML with errors and suggested fixes in real time.',
  },
  {
    number: '0025',
    filename: '0025-pki-decision.md',
    title: 'Relay PKI Decision',
    status: 'PROPOSED',
    summary:
      'Port Daddy\'s relay layer -- which bridges local daemons with external event publishers like GitHub Actions -- uses OIDC as its primary identity bootstrap. CI jobs and external services authenticate with the same GitHub OIDC tokens they already hold, eliminating manual key distribution. Self-hosted and air-gapped setups can opt into a web-of-trust mode, with ACME-backed name-bound identity available in a later phase.',
  },
  {
    number: '0024',
    filename: '0024-daemon-profiles.md',
    title: 'Named Daemon Profiles',
    status: 'ACCEPTED',
    summary:
      'Port Daddy supports named daemon profiles, letting you run isolated sidecar instances alongside the canonical daemon without confusion. Each profile gets its own socket, database, and port file. Useful for package contributors and advanced users who need a scratch daemon for experiments -- the canonical daemon your agents coordinate through remains untouched.',
  },
  {
    number: '0023',
    filename: '0023-cartographer-roadmap-actor.md',
    title: 'Cartographer as Navigator Roadmap Actor',
    status: 'ACCEPTED',
    summary:
      'Internal decision. Port Daddy\'s own roadmap ownership is formalized as the Navigator actor -- the same durable actor-soul model exposed to your agents. The Navigator maintains the map between planned work, active recovery state, and committed truth. Port Daddy development is self-coordinated using the same primitives you use.',
  },
  {
    number: '0022',
    filename: '0022-durable-actor-souls-and-body-leases.md',
    title: 'Durable Actor Souls and Body Leases',
    status: 'ACCEPTED',
    summary:
      'Port Daddy now separates an agent\'s durable identity from its live execution authority. An agent\'s soul -- its mailbox, history, and addressability -- persists after the process ends, while the live body lease that grants write authority expires with the process. Salvage, resurrection, and actor inboxes all build on this: the system can reliably distinguish a crashed agent from an active one and hand off its intent to a successor.',
  },
  {
    number: '0021',
    filename: '0021-bosun-consolidation.md',
    title: 'Bosun Consolidation',
    status: 'ACCEPTED',
    summary:
      'Internal naming decision. Port Daddy\'s watchdog subsystem now has a single canonical name: Bosun (pd-bosun). The external supervisor that monitors the daemon heartbeat and triggers restarts is named unambiguously across docs, source, and CLI output. No user-facing behavior changed.',
  },
  {
    number: '0020',
    filename: '0020-ipc-failure-modes.md',
    title: 'IPC Binary Protocol Failure Modes and Mitigations',
    status: 'ACCEPTED',
    summary:
      'The high-frequency binary socket used for agent heartbeats, pub/sub, and pheromone signals has a documented, tested failure catalog. Dead subscribers are automatically cleaned up, stale locks have automated expiry, and the full failure taxonomy -- transport errors, filesystem issues, security edge cases -- is covered by regression tests. This is the engineering record behind the reliability you experience through pd begin, pd tube, and live agent heartbeats.',
  },
  {
    number: '0019',
    filename: '0019-declarative-fleet-yaml.md',
    title: 'Declarative Fleet Configuration (pd-fleet.yml)',
    status: 'PROPOSED',
    summary:
      'Port Daddy is introducing pd-fleet.yml: a declarative file where you define your background agent network, dev servers, watchers, and pub/sub topology in one place. Instead of maintaining imperative shell scripts that launch Claude agents, you declare who runs what -- and pd fleet up manages the full lifecycle. Think Docker Compose, but designed for AI agent coordination.',
  },
  {
    number: '0018',
    filename: '0018-adversarial-security-analysis.md',
    title: 'Adversarial Security Analysis: Attacking the Anchor Protocol',
    status: 'SECURITY REVIEW',
    summary:
      'An adversarial analysis of the Anchor Protocol identified and documented twelve attack vectors -- including token flooding, backup-restore replay, PID reuse races, and covert timing channels -- each with documented severity and a mitigation path. This record informs the security roadmap. It is internal threat modeling published for transparency, not a vulnerability disclosure.',
  },
  {
    number: '0017',
    filename: '0017-db-file-protection-threat-model.md',
    title: 'DB File Protection and Insider Threat Model',
    status: 'DRAFT',
    summary:
      'Port Daddy\'s SQLite database -- holding all session state, locks, notes, and coordination history -- is now governed by an explicit insider-threat model. The v3.8.0 release hardened file permissions to 0600, added deletion monitoring, and created an immutable append-only activity log. Longer-term plans include SQLCipher encryption, remote Lighthouse backup, and OS-level sandboxing.',
  },
  {
    number: '0016',
    filename: '0016-hardened-cross-platform-ipc.md',
    title: 'Hardened Cross-Platform IPC',
    status: 'ACCEPTED',
    summary:
      'Port Daddy\'s IPC layer enforces uniform security invariants on macOS, Linux, and Windows. Unix sockets run at 0600 (owner-only). Windows Named Pipes use an explicit security descriptor that rejects remote clients and restricts access to the session owner. The lib/ipc.ts abstraction handles platform detection transparently -- agents connect the same way on every OS.',
  },
  {
    number: '0015',
    filename: '0015-layered-resurrection.md',
    title: 'Layered Resurrection and the Bosun Watchdog',
    status: 'ACCEPTED',
    summary:
      'Port Daddy\'s self-healing architecture follows a strict one-way supervision chain: OS supervisor -> Bosun watchdog -> daemon -> SQLite state. Bosun monitors the daemon via filesystem heartbeat rather than HTTP, eliminating the circular-death failure mode of the prior mutual-monitoring model. If the daemon\'s event loop freezes, Bosun still detects the stale heartbeat and triggers a restart.',
  },
  {
    number: '0014',
    filename: '0014-the-anchor-protocol.md',
    title: 'The Anchor Protocol and Verifiable Economy',
    status: 'ACCEPTED',
    summary:
      'The Anchor Protocol gives Port Daddy a cryptographically verifiable work-agreement layer. When a requester and worker agent commit to a task, the daemon escrows credits via ed25519-signed Float Plans, accumulates a Merkle-chained evidence trail from session notes, and releases payment only on bilateral signed receipts. Agents and tooling authors can build trusted, auditable task handoffs on top of this foundation.',
  },
  {
    number: '0013',
    filename: '0013-unified-harbor-model.md',
    title: 'The Unified Harbor Model and Cryptographic Security',
    status: 'ACCEPTED',
    summary:
      'Harbors are the universal unit of scope, security, and attribution in Port Daddy. Every pd begin implicitly joins a Harbor scoped to your project root, keeping agent activity cleanly namespaced without extra configuration. For teams sharing a daemon or isolating experimental agents, explicit Harbor tokens (ed25519 JWTs) enforce strict scope boundaries -- other projects\' sessions, locks, and channels are invisible.',
  },
  {
    number: '0012',
    filename: '0012-semantic-token-graph-and-trie.md',
    title: 'The Semantic Token Graph and Radix Trie',
    status: 'ACCEPTED',
    summary:
      'Port Daddy\'s internal identity resolver uses a compressed Radix Trie with bitmask-accelerated subtree filtering to resolve identities like myapp:api:main at sub-millisecond speed. Harbor bitmasks allow instant subtree pruning; lazy promotion keeps memory overhead low. This is internal infrastructure that keeps the project:stack:context system fast as your agent fleet grows.',
  },
  {
    number: '0011',
    filename: '0011-reactive-coordination-kernel.md',
    title: 'The Reactive Coordination Kernel (Bun, Fastify, and WAL)',
    status: 'ACCEPTED',
    summary:
      'Port Daddy V4\'s daemon runs on Bun with Fastify and SQLite WAL, structured as a two-tier scheduler. High-priority operations -- heartbeats, lock acquisitions, Anchor confirmations -- are processed immediately. Low-priority operations -- telemetry, dashboard updates, session logs -- are batched in 100ms windows. Socket-level backpressure prevents slow consumers from overwhelming the coordination layer.',
  },
  {
    number: '0010',
    filename: '0010-maritime-design-language.md',
    title: 'Maritime Design Language Throughout CLI and Dashboard',
    status: 'ACCEPTED',
    summary:
      'Everything you see in Port Daddy -- CLI output colors and status codes, the dashboard palette, documentation copy -- follows a consistent maritime design system drawn from nautical communication protocols. The result is a coherent, recognizable identity across every Port Daddy surface, from pd status to the Fleet Control Center.',
  },
  {
    number: '0009',
    filename: '0009-mcp-server-integration.md',
    title: 'MCP Server Integration for Claude Agent Tooling',
    status: 'ACCEPTED',
    summary:
      'Port Daddy ships a first-class MCP server that Claude Code, Cursor, Windsurf, and other MCP-capable editors can use without subprocess overhead. Register it once in your Claude config and every pd begin, pd note, pd claim, and coordination tool call happens as a direct MCP tool invocation -- faster, cleaner, and fully integrated with the model\'s tool-use loop.',
  },
  {
    number: '0008',
    filename: '0008-agent-resurrection-pattern.md',
    title: 'Agent Resurrection Pattern for Dead-Agent Recovery',
    status: 'ACCEPTED',
    summary:
      'When an AI agent dies mid-task -- context window full, IDE closed, machine asleep -- Port Daddy detects the stale heartbeat and moves the session to the resurrection queue. The next agent runs pd salvage to recover the dead session\'s notes, claimed files, and intent, continuing where the previous agent left off. No work is silently lost.',
  },
  {
    number: '0007',
    filename: '0007-immutable-session-notes.md',
    title: 'Immutable Session Notes (Append-Only)',
    status: 'ACCEPTED',
    summary:
      'Notes written during a Port Daddy session are append-only and permanent. An agent cannot go back and edit what it wrote, making the note stream a trustworthy audit trail rather than a mutable scratchpad. When Agent B picks up a crashed Agent A\'s session, it can read the notes with confidence that nothing has been retroactively altered.',
  },
  {
    number: '0006',
    filename: '0006-synchronous-sqlite-queries.md',
    title: 'Synchronous SQLite Queries via better-sqlite3',
    status: 'ACCEPTED',
    summary:
      'Internal decision. Port Daddy uses better-sqlite3 for all database access, meaning every query runs synchronously. For a local dev tool receiving at most a few dozen requests per minute, synchronous I/O is faster and simpler than promise chains -- no async overhead, no callback complexity, and no risk of event-loop contention under realistic load.',
  },
  {
    number: '0005',
    filename: '0005-single-file-dashboard.md',
    title: 'Single-File HTML Dashboard',
    status: 'ACCEPTED',
    summary:
      'Port Daddy\'s web dashboard is a single self-contained HTML file with all CSS and JavaScript inlined, served directly by the daemon. No build step, no framework, no extra dependencies -- just open it in a browser. It polls the daemon API to show live agent activity, sessions, locks, ports, and notes across 15 panels. You can inspect the file directly or open it without any toolchain installed.',
  },
  {
    number: '0004',
    filename: '0004-unix-socket-primary-transport.md',
    title: 'Unix Socket as Primary CLI-to-Daemon Transport',
    status: 'ACCEPTED',
    summary:
      'pd commands talk to the daemon over a Unix domain socket at /tmp/port-daddy.sock, not a TCP port. This means the CLI never competes with other processes for a port number, and socket connections bypass the rate limiter that protects the HTTP API. TCP on the published local endpoint is still available for the browser dashboard and MCP server.',
  },
  {
    number: '0003',
    filename: '0003-semantic-identity-system.md',
    title: 'Semantic Identity System (project:stack:context)',
    status: 'ACCEPTED',
    summary:
      'Every service, agent, and resource in Port Daddy uses a three-segment identity like myapp:api:main. Port assignments are deterministic: the same identity always maps to the same port across restarts and machines. Wildcard queries like myapp:* let you release all of a project\'s claims in one command, and prefix indexes make fleet-wide lookups fast as your agent count grows.',
  },
  {
    number: '0002',
    filename: '0002-module-factory-pattern.md',
    title: 'Module Factory Pattern for Dependency Injection',
    status: 'ACCEPTED',
    summary:
      'Internal decision. Port Daddy\'s server is composed of about fifteen functional modules -- sessions, locks, messaging, DNS, and so on -- each initialized by a createFoo(db) factory function. The practical benefit for users: every module is independently testable with an in-memory database, so the daemon is reliable and regression-tested as new features ship.',
  },
  {
    number: '0001',
    filename: '0001-sqlite-as-primary-database.md',
    title: 'SQLite as Primary Database',
    status: 'ACCEPTED',
    summary:
      'Port Daddy stores all coordination state -- port assignments, sessions, locks, notes, and agent history -- in a local SQLite database. Choosing SQLite means the daemon needs zero infrastructure: no PostgreSQL, no Redis, no network service. The database survives restarts, supports concurrent readers via WAL mode, and lives in your project root where you can inspect or back it up at any time.',
  },
]

const STATUS_BADGE: Record<AdrStatus, { label: string; variant: 'teal' | 'gold' | 'default' | 'red' | 'warning' }> = {
  ACCEPTED: { label: 'Accepted', variant: 'teal' },
  PROPOSED: { label: 'Proposed', variant: 'gold' },
  DEPRECATED: { label: 'Deprecated', variant: 'default' },
  DRAFT: { label: 'Draft', variant: 'warning' },
  'SECURITY REVIEW': { label: 'Security Review', variant: 'red' },
}

function AdrCard({ adr }: { adr: Adr }) {
  const badge = STATUS_BADGE[adr.status] ?? { label: adr.status, variant: 'default' as const }
  const isDeprecated = adr.status === 'DEPRECATED'
  const githubUrl = `${GITHUB_BASE}/${adr.filename}`

  return (
    <Surface
      depth="raised"
      radius="lg"
      padding="none"
      className={`flex flex-col gap-3 p-5 transition-shadow hover:shadow-[var(--shadow-sm)] ${isDeprecated ? 'opacity-60' : ''}`}
      data-testid="adr-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[length:var(--type-meta-size)] font-semibold text-[var(--text-muted)]">ADR-{adr.number}</span>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>

      <h2
        className={`font-display text-base font-semibold leading-snug text-[var(--text-primary)] ${isDeprecated ? 'line-through' : ''}`}
      >
        {adr.title}
      </h2>

      <p className="flex-1 text-sm leading-relaxed text-[var(--text-secondary)]">{adr.summary}</p>

      <a
        href={githubUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-flex items-center gap-1.5 font-mono text-[length:var(--type-meta-size)] font-semibold text-[var(--brand-primary)] transition-opacity hover:opacity-75"
      >
        Read full ADR on GitHub
        <ExternalLink size={12} />
      </a>
    </Surface>
  )
}

export default function Decisions() {
  return (
    <div className="space-y-8">
      <DocsHero
        eyebrow="Architecture Decision Records"
        title="Why We Built It This Way"
        summary="Architecture Decision Records capture the significant choices made during Port Daddy's development -- what was decided and why. Most readers can skim the summaries. The curious can click through to the full ADR on GitHub."
        paragraphs={[
          'Each record explains a decision that shaped how Port Daddy works: what was chosen, why it beat the alternatives, and what consequences follow. The full text of every ADR lives in the repository.',
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {ADRS.map((adr) => (
          <AdrCard key={adr.number} adr={adr} />
        ))}
      </div>
    </div>
  )
}
