import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { motion, useScroll, useSpring } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  Activity,
  Anchor,
  ArrowRight,
  Bot,
  BookOpen,
  Braces,
  Check,
  Cpu,
  Database,
  FileCode,
  FileText,
  FolderTree,
  GitBranch,
  Globe,
  Layers,
  LifeBuoy,
  Play,
  Radio,
  Search,
  Terminal,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import { Mermaid } from '@/components/ui/Mermaid'
import { ALL_CATEGORIES, MCP_DEFAULT_TOOL_TOTAL, MCP_TOOL_TOTAL } from '@/data/mcp'
import {
  MCP_AGENT_TOOL_CATEGORIES,
  MCP_AGENT_TOOL_DEFINITIONS,
  type McpAgentToolDefinition,
  type McpAgentToolParameter,
} from '@/data/mcpAgentToolCatalog'
import {
  BracketLabel,
  BracketLink,
  DocsCodeBlock,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
  SwissGrid,
  SwissGridItem,
} from '@/components/site/primitives'

type Tone = 'paper' | 'blue' | 'accent'
type ToolLanguage = 'cli' | 'typescript' | 'text'

interface ProofMetric {
  value: string
  label: string
  tone: Tone
}

interface RuntimeBackend {
  name: string
  tier: string
  surface: string
}

interface MagicTool {
  name: string
  tagline: string
  description: string
  icon: LucideIcon
  tone: Tone
  example: string
}

interface ChannelSurface {
  id: string
  label: string
  icon: LucideIcon
  language: ToolLanguage
  code: string
  note: string
}

interface SkillExplorerItem {
  id: string
  label: string
  path: string
  badge: string
  summary: string
  icon: LucideIcon
  files: string[]
  markdown: string[]
  comments: string[]
  doItems: string[]
  dontItems: string[]
  codeLabel?: string
  code?: string
  mermaid?: string
  image?: {
    src: string
    alt: string
    caption: string
  }
}

const SKILL_MANUAL_FRONTMATTER = [
  ['name', 'port-daddy-agent-skill'],
  ['description', 'Instruction manual for agents driving Port Daddy multi-agent coordination.'],
  ['allowed-tools', 'Read, Bash, Grep, Glob, Edit, Write'],
  ['category', 'Coordination'],
] as const

const SKILL_MANUAL_SECTIONS = [
  ['Use it when', 'Editing a repo, recovering work, coordinating sessions, inspecting FleetBar, packaging docs, or leaving a durable handoff.'],
  ['NOT For', 'One-line read-only answers, generic git advice, replacing repo truth, or launching extra agents for a bounded local edit.'],
  ['Default Agent Happy Path', 'The normal loop: status, briefing, salvage, begin, note, claim, validate, handoff, done.'],
  ['CLI Documentation Contract', 'Every CLI command needs a real detail page with syntax, options, examples, aliases, provenance, and API contract metadata.'],
] as const

const SKILL_MANUAL_LOOP = [
  ['pd status', 'Confirm the daemon and runtime are alive before trusting local assumptions.'],
  ['pd briefing', 'Read the current work, recovery, and coordination snapshot.'],
  ['pd salvage --project <project> --limit 20', 'Preserve interrupted work before restarting archaeology.'],
  ['pd begin "<bounded task>" --identity <project>:<agent>', 'Register an accountable session and identity.'],
  ['pd note "Scope: <files>. Assumptions: <truth>. Validation: <commands>."', 'Publish scope and proof plan where other agents can find it.'],
  ['pd session files add <path>', 'Claim the smallest real surface before editing.'],
  ['pd guard check --staged', 'Prove staged work is coordinated before publishing.'],
  ['pd done "<short outcome>"', 'Close the loop with result, validation, and remaining risk.'],
] as const

const DIRECTIVE_COPY: Record<string, { label: string; body: string }> = {
  'coordination-contract': {
    label: 'Coordination Contract',
    body: 'This section changes how an agent coordinates, so it must stay aligned with CLI, SDK, MCP, README, and website truth.',
  },
  'live-truth-before-source-truth': {
    label: 'Live Truth First',
    body: 'Check daemon, sessions, notes, claims, and runtime state before trusting stale source, docs, or memory.',
  },
  'handoff-needs-validation-evidence': {
    label: 'Handoff Evidence',
    body: 'A useful handoff names scope, validation, remaining risk, and the next observable state.',
  },
  'reference-depth-on-demand': {
    label: 'Load References On Demand',
    body: 'Agents should open the specific reference needed for the task instead of stuffing every file into context.',
  },
  'release-surface-contract': {
    label: 'Release Surface',
    body: 'Changes here imply matching updates across the website, README, package docs, skill mirrors, and product UI.',
  },
  'diagram-renders-mermaid': {
    label: 'Rendered Diagram',
    body: 'Mermaid source is treated as visual documentation and rendered for humans before publishing.',
  },
  'coordination-loop': {
    label: 'Coordination Loop',
    body: 'The diagram describes the normal status, briefing, session, note, claim, validate, and done path.',
  },
  'schema-shaped-note': {
    label: 'Schema-Shaped Note',
    body: 'The note has fields that can be checked by tools instead of being loose prose.',
  },
  'machine-readable-handoff': {
    label: 'Machine-Readable Handoff',
    body: 'The handoff can be consumed by agents, dashboards, or scripts without guessing at intent.',
  },
  'runnable-proof': {
    label: 'Runnable Proof',
    body: 'This script or command should produce visible output that proves the skill is installed and usable.',
  },
  'diagnostics-before-claims': {
    label: 'Diagnostics Before Claims',
    body: 'Check environment and runtime state before claiming a docs, skill, or install surface is broken.',
  },
  'template-promotes-consistency': {
    label: 'Consistency Template',
    body: 'The template keeps repeated handoffs and notes shaped the same way across agents.',
  },
  'human-readable-plus-machine-readable': {
    label: 'Human And Machine Readable',
    body: 'The artifact should be easy for a person to scan and structured enough for tooling to validate.',
  },
  'visual-example': {
    label: 'Visual Example',
    body: 'The example is meant to be inspected visually, not only skimmed as markdown.',
  },
  'worked-example-needs-output': {
    label: 'Worked Example With Output',
    body: 'Show the command, the resulting output, and the state change so readers can compare their run.',
  },
  'runner-adapter': {
    label: 'Runner Adapter',
    body: 'This surface explains how Codex, Claude, Gemini, and AGENTS.md-aware runners load the same skill.',
  },
  'no-port-daddy-cli-skill': {
    label: 'Single Skill Home',
    body: 'Port Daddy CLI guidance belongs inside port-daddy-agent-skill, not a separate port-daddy-cli skill.',
  },
}

const PROOF_METRICS: ProofMetric[] = [
  { value: `${MCP_TOOL_TOTAL}`, label: 'MCP functions registered by the server', tone: 'blue' },
  { value: `${MCP_DEFAULT_TOOL_TOTAL}`, label: 'default tools before discovery', tone: 'accent' },
  { value: '1', label: 'local daemon for shared state', tone: 'paper' },
]

const PROCEDURAL_KNOWLEDGE_URL = 'https://windags.ai/blog/why-declarative-knowledge-isnt-enough'
const AGENTS_MD_URL = 'https://agents.md/'

const RUNTIME_BACKENDS: RuntimeBackend[] = [
  { name: 'Codex', tier: 'low / mid / high', surface: 'codex exec backend' },
  { name: 'Claude SDK', tier: 'haiku / sonnet / opus', surface: 'exact telemetry path' },
  { name: 'Claude CLI', tier: 'haiku / sonnet / opus', surface: 'local CLI auth' },
  { name: 'Gemini', tier: 'flash / flash / pro', surface: 'Google SDK path' },
  { name: 'Ollama', tier: 'local small / medium / large', surface: 'offline backend' },
  { name: 'Aider', tier: 'mini / standard / high', surface: 'Aider-managed edits' },
]

const MAGIC_TOOLS: MagicTool[] = [
  {
    name: 'fleet_init',
    tagline: 'Create a coordinated project fleet in one call.',
    icon: Cpu,
    tone: 'blue',
    description:
      'Creates the fleet config, installs the scoped commit hook, and starts background agents through the Port Daddy daemon.',
    example: `await fleet_init({
  project: "myapp",
  agents: ["qa", "documentarian", "cartographer"]
})

// hook installed
// scoped git:committed channel ready
// background agents tracked by session`,
  },
  {
    name: 'swarm_awareness',
    tagline: 'Ask who is active before an agent edits.',
    icon: Users,
    tone: 'paper',
    description:
      'Returns active agents, sessions, file claims, and salvage candidates so MCP clients can coordinate before touching files.',
    example: `const state = await swarm_awareness({ project: "myapp" })

// active: qa, cartographer
// claimed: src/auth/*.ts
// salvage: 1 abandoned session`,
  },
  {
    name: 'catch_me_up',
    tagline: 'Rebuild context from durable activity.',
    icon: Activity,
    tone: 'accent',
    description:
      'Summarizes notes, session activity, fleet events, commits, and salvage context since a timestamp or last handoff.',
    example: `const briefing = await catch_me_up({
  since: "1h",
  project: "myapp"
})

// 3 commits reviewed
// 2 findings filed
// 1 route changed by a live agent`,
  },
  {
    name: 'spawn_agent',
    tagline: 'Launch background work with budget and identity.',
    icon: Bot,
    tone: 'blue',
    description:
      'Starts a backend agent with session registration, heartbeat, model tier, budget ceiling, notes, and salvage behavior.',
    example: `await spawn_agent({
  backend: "codex",
  model_tier: "low",
  budget_usd: 0.5,
  identity: "myapp:security:scan",
  purpose: "Review auth changes"
})`,
  },
  {
    name: 'file_heat',
    tagline: 'See contention before it becomes a conflict.',
    icon: GitBranch,
    tone: 'paper',
    description:
      'Combines active claims and coordination signals into a file heat map for safer routing and review decisions.',
    example: `const heat = await file_heat({ project: "myapp" })

// src/auth/middleware.ts  0.87
// src/routes/login.ts    0.62
// src/db/schema.ts       0.21`,
  },
  {
    name: 'fleet_status',
    tagline: 'Inspect health without reading logs.',
    icon: Search,
    tone: 'accent',
    description:
      'Returns fleet agent state, recent notes, trigger channels, last run timestamps, and respawn counters.',
    example: `const status = await fleet_status({ harbor: "myapp:fleet" })

// qa: running, last commit 4m ago
// spark: idle, next cron 22m
// spider: running, 7 findings`,
  },
]

const CHANNEL_SURFACES: ChannelSurface[] = [
  {
    id: 'cli',
    label: 'CLI',
    icon: Terminal,
    language: 'cli',
    code: `$ pd channels discover git --dir .
LOGICAL                   SCOPE       SOURCE      ACTIVE    PHYSICAL
git:committed             repo        declared    0         repo:4bc8ffb2:git:committed

$ pd channels describe git:committed --dir .
logical:  git:committed
physical: repo:4bc8ffb2:git:committed
scope:    repo
source:   declared
active:   0
worktree: fe53192e
branch:   -
aliases:  -
desc:     commit trigger event`,
    note: 'The shell path is best for hooks, local scripts, and recovery flows you want to inspect later.',
  },
  {
    id: 'mcp',
    label: 'MCP',
    icon: Cpu,
    language: 'typescript',
    code: `await subscribe({ channel: "git:committed" })

await publish_message({
  channel: "git:committed",
  content: JSON.stringify({ sha: "abc123" })
})`,
    note: 'The MCP path lets model clients chain coordination without shell parsing.',
  },
  {
    id: 'sdk',
    label: 'SDK',
    icon: Layers,
    language: 'typescript',
    code: `import { PortDaddy } from "port-daddy"

const pd = new PortDaddy()

for await (const msg of pd.subscribe("git:committed")) {
  console.log(msg.content)
}`,
    note: 'The SDK path fits typed app integrations and long-running tools.',
  },
  {
    id: 'api',
    label: 'REST API',
    icon: Globe,
    language: 'cli',
    code: `curl -N http://localhost:9876/msg/git:committed/subscribe
curl http://localhost:9876/msg/git:committed/poll
curl -X POST http://localhost:9876/msg/git:committed \\
  -H 'Content-Type: application/json' \\
  -d '{"content":{"sha":"abc123"}}'`,
    note: 'The REST/SSE path keeps non-TypeScript tools connected to the same Port Daddy state.',
  },
]

const SKILL_EXPLORER_ITEMS: SkillExplorerItem[] = [
  {
    id: 'skill',
    label: 'SKILL.md',
    path: 'skills/port-daddy-agent-skill/SKILL.md',
    badge: 'Markdown operating manual',
    summary: 'The first file an agent reads: when to use Port Daddy, how to start, and how to publish durable truth.',
    icon: FileText,
    files: ['NOT For', 'Default Agent Happy Path', 'Small Decision Table', 'Procedural Cues'],
    markdown: [
      '# Port Daddy Agent Skill',
      '## Default Agent Happy Path',
      '- pd status',
      '- pd briefing',
      '- pd begin "<bounded task>" --identity <project>:<agent>',
      '- pd note "Scope: <files>. Assumptions: <truth>. Validation: <commands>."',
      '- pd session files add <path>',
      '- pd done "<short outcome>"',
    ],
    comments: [
      '<!-- pd:coordination-contract -->',
      '<!-- pd:live-truth-before-source-truth -->',
      '<!-- pd:handoff-needs-validation-evidence -->',
    ],
    doItems: [
      'Start with live status, briefing, salvage, and a bounded session.',
      'Claim the smallest real files or regions before editing.',
      'Leave notes that name scope, assumptions, validation, and remaining risk.',
    ],
    dontItems: [
      'Do not replace repo docs, daemon truth, tests, or operator evidence with vibes.',
      'Do not launch extra agents when one bounded local edit is enough.',
      'Do not publish before fetch, reconcile, notes, and guard checks.',
    ],
    codeLabel: 'Happy path commands',
    code: `$ pd status
Port Daddy is running
  Runtime: nominal

$ pd briefing
SUCCESS: Briefing generated: .portdaddy/briefing.md
SUCCESS: Briefing generated: .portdaddy/briefing.json

$ pd begin "fix docs surface" --identity port-daddy:documentarian
SUCCESS: Agent fix docs surface ready
  Session: session-fix-docs-surface-4a12
  Identity: port-daddy:documentarian

$ pd note "Scope: website-v2/src/pages/MCPPage.tsx. Validation: build + smoke."
SUCCESS: Note added to session session-fix-docs-surface-4a12

$ pd session files add website-v2/src/pages/MCPPage.tsx
Claimed 1 file(s) in session session-fix-docs-surface-4a12`,
  },
  {
    id: 'references',
    label: 'references/',
    path: 'skills/port-daddy-agent-skill/references/',
    badge: 'Long-form source of truth',
    summary: 'Deep doctrine for CLI, SDK, MCP, distribution, FleetBar, salvage, coordination theory, and install surfaces.',
    icon: BookOpen,
    files: ['api-reference.md', 'cli-reference.md', 'sdk-reference.md', 'distribution-and-installation.md'],
    markdown: [
      '# references/INDEX.md',
      '## Load on demand',
      '- cli-reference.md: every pd command family, aliases, examples, and source provenance.',
      '- api-reference.md: daemon routes, payload shapes, and runtime behavior.',
      '- sdk-reference.md: typed helpers for sessions, claims, notes, ports, and locks.',
      '- fleetbar-and-console.md: what counts as visible operator proof.',
    ],
    comments: ['<!-- pd:reference-depth-on-demand -->', '<!-- pd:release-surface-contract -->'],
    doItems: [
      'Open the specific reference that matches the task surface.',
      'Keep CLI, SDK, MCP, website, README, and skill truth aligned.',
      'Use exact command output or runtime proof when the doc describes behavior.',
    ],
    dontItems: [
      'Do not bury a command only in an index row.',
      'Do not make a release claim without source or runtime proof.',
      'Do not split Port Daddy CLI truth into a separate skill.',
    ],
    codeLabel: 'Reference map',
    code: `references/
  api-reference.md
  cli-reference.md
  sdk-reference.md
  distribution-and-installation.md
  fleetbar-and-console.md
  recovery-and-salvage.md`,
  },
  {
    id: 'diagrams',
    label: 'diagrams/',
    path: 'skills/port-daddy-agent-skill/diagrams/',
    badge: 'Mermaid made inspectable',
    summary: 'Flowcharts, sequence diagrams, and lifecycle state diagrams make the coordination loop visible before an agent acts.',
    icon: Workflow,
    files: [
      '01_flowchart_agent_operating_loop.md',
      '02_sequenceDiagram_coordination_handoff.md',
      '03_stateDiagram-v2_agent_lifecycle.md',
      '04_flowchart_decision-points.md',
    ],
    markdown: [
      '# 01_flowchart_agent_operating_loop.md',
      '## Agent Operating Loop',
      '- Discover live state.',
      '- Start a recoverable session.',
      '- Claim work and validate.',
      '- Publish handoff evidence.',
    ],
    comments: ['<!-- pd:diagram-renders-mermaid -->', '<!-- pd:coordination-loop -->'],
    doItems: [
      'Render diagrams, do not leave Mermaid as an opaque code block.',
      'Use the diagrams to explain why a command belongs in the loop.',
      'Keep diagram labels aligned with real CLI and MCP names.',
    ],
    dontItems: [
      'Do not make decorative diagrams that hide the actual command path.',
      'Do not show coordination as chat-only narration.',
      'Do not imply locks are the default when claims are enough.',
    ],
    mermaid: `flowchart TD
  A["pd status"] --> B["pd briefing"]
  B --> C["pd begin + identity"]
  C --> D["note scope and assumptions"]
  D --> E["claim file or symbol"]
  E --> F["work + validate"]
  F --> G["note result and evidence"]
  G --> H["pd done"]`,
  },
  {
    id: 'schemas',
    label: 'schemas/',
    path: 'skills/port-daddy-agent-skill/schemas/',
    badge: 'Machine-checkable handoffs',
    summary: 'JSON schemas and shape docs keep coordination notes, validation reports, tuples, fleets, and salvage entries parseable.',
    icon: Braces,
    files: ['agent-handoff.schema.json', 'coordination-note.schema.json', 'validation-report.schema.json', 'pd-fleet.schema.json'],
    markdown: [
      '# schemas/coordination-note.schema.json',
      '## Required evidence fields',
      '- scope',
      '- assumptions',
      '- validation',
      '- remainingRisk',
    ],
    comments: ['<!-- pd:schema-shaped-note -->', '<!-- pd:machine-readable-handoff -->'],
    doItems: [
      'Prefer schema-shaped notes when another agent or actor will consume the result.',
      'Include exact validation commands and observed output.',
      'Use tuple and handoff shapes for machine-queryable facts.',
    ],
    dontItems: [
      'Do not leave a handoff that only says "fixed".',
      'Do not hide blockers in prose when a schema field exists.',
      'Do not treat JSON validity as proof the runtime behavior worked.',
    ],
    codeLabel: 'Handoff shape',
    code: `{
  "scope": ["website-v2/src/pages/MCPPage.tsx"],
  "assumptions": ["AGENTS.md is an open Markdown instruction format"],
  "validation": ["npm --prefix website-v2 run build", "smoke /mcp"],
  "remainingRisk": []
}`,
  },
  {
    id: 'scripts',
    label: 'scripts/',
    path: 'skills/port-daddy-agent-skill/scripts/',
    badge: 'Executable proof helpers',
    summary: 'Validators, diagnostics, preflights, salvage helpers, handoff emitters, and fleet checks turn the manual into runnable proof.',
    icon: Terminal,
    files: [
      'validate_port_daddy_agent_skill.py',
      'diagnose_port_daddy_agent_context.sh',
      'agent-handshake.sh',
      'emit_agent_handoff.py',
    ],
    markdown: [
      '# scripts/',
      '## When to run',
      '- Validate the installed skill bundle.',
      '- Diagnose daemon, MCP, and repo context.',
      '- Emit structured handoffs.',
      '- Triage salvage before restarting work.',
    ],
    comments: ['<!-- pd:runnable-proof -->', '<!-- pd:diagnostics-before-claims -->'],
    doItems: [
      'Run validators before claiming the skill is installed and usable.',
      'Use diagnostics when CLI, daemon, or MCP truth disagrees.',
      'Prefer scripts over retyping long schema or handoff snippets.',
    ],
    dontItems: [
      'Do not publish a skill update that the validator rejects.',
      'Do not trim diagnostic output that an operator needs to debug.',
      'Do not confuse source existence with installed runtime truth.',
    ],
    codeLabel: 'Validation commands',
    code: `python3 skills/port-daddy-agent-skill/scripts/validate_port_daddy_agent_skill.py skills/port-daddy-agent-skill
bash skills/port-daddy-agent-skill/scripts/diagnose_port_daddy_agent_context.sh
bash skills/port-daddy-agent-skill/scripts/preflight.sh`,
  },
  {
    id: 'templates',
    label: 'templates/',
    path: 'skills/port-daddy-agent-skill/templates/',
    badge: 'Reusable coordination documents',
    summary: 'Starter fleet config, handoff templates, session-note templates, and .portdaddyrc examples reduce drift between agents.',
    icon: FileCode,
    files: ['coordination-note.md', 'handoff.md', 'session-note.template.md', 'pd-fleet.starter.yml'],
    markdown: [
      '# templates/handoff.md',
      '## Result',
      '- What changed',
      '- What was validated',
      '- What remains',
      '## Next agent',
      '- Read the note before editing',
      '- Re-run the smallest useful proof',
    ],
    comments: ['<!-- pd:template-promotes-consistency -->', '<!-- pd:human-readable-plus-machine-readable -->'],
    doItems: [
      'Start from a template when the handoff will outlive the current chat.',
      'Name exact files and commands in every handoff.',
      'Keep templates in sync with the schema docs.',
    ],
    dontItems: [
      'Do not make a template so generic it hides operational truth.',
      'Do not omit validation just because the edit is documentation.',
      'Do not leave project identity ambiguous.',
    ],
    codeLabel: 'Starter fleet snippet',
    code: `agents:
  - id: documentarian
    backend: codex
    model_tier: low
    singleton: true
limits:
  budget_usd_per_day: 2`,
  },
  {
    id: 'examples',
    label: 'examples/',
    path: 'skills/port-daddy-agent-skill/examples/',
    badge: 'Worked operator scenarios',
    summary: 'Concrete walkthroughs show how buttons, tests, webhooks, FleetBar, salvage, and local console proof fit together.',
    icon: Play,
    files: ['build-now.md', 'coordinated-edit.md', 'fleetbar-triage.md', '01-bootstrap-new-session.md'],
    markdown: [
      '# examples/coordinated-edit.md',
      '## Scenario',
      '- Two agents need adjacent code in the same repo.',
      '- One claims the UI file, one claims the docs route.',
      '- Both leave notes before commit.',
      '- Guard checks staged ownership.',
    ],
    comments: ['<!-- pd:visual-example -->', '<!-- pd:worked-example-needs-output -->'],
    doItems: [
      'Show the command, output, and resulting observable state.',
      'Use paired visual proof when a UI or FleetBar surface changes.',
      'Make the example runnable enough for a new agent to rehearse.',
    ],
    dontItems: [
      'Do not show a naked command with no output.',
      'Do not use mock console screenshots when a real capture should exist.',
      'Do not skip the final note or validation proof.',
    ],
    image: {
      src: '/img/generated/example-pd-tube-button-to-agent.webp',
      alt: 'Generated visual of a Port Daddy button sending a pd tube event to an agent workflow',
      caption: 'Example visuals pair the written scenario with an inspectable operator workflow.',
    },
  },
  {
    id: 'agents',
    label: 'agents/',
    path: 'skills/port-daddy-agent-skill/agents/openai.yaml',
    badge: 'Runner-specific adapter',
    summary: 'Adapter metadata keeps OpenAI/Codex-style runners on the same doctrine without creating a separate Port Daddy CLI skill.',
    icon: Bot,
    files: ['openai.yaml', '.codex/skills mirror', '.claude/skills mirror', '.agents/skills mirror'],
    markdown: [
      '# agents/openai.yaml',
      '## What it says',
      '- Use the Port Daddy skill for repo work.',
      '- Prefer live coordination state over memory.',
      '- Keep release surfaces aligned.',
      '- Validate before commit, push, or deploy.',
    ],
    comments: ['<!-- pd:runner-adapter -->', '<!-- pd:no-port-daddy-cli-skill -->'],
    doItems: [
      'Install the skill where the runner actually reads local instructions.',
      'Treat AGENTS.md as a repo instruction format, not a second source of truth.',
      'Keep Codex, Claude, Gemini, and AGENTS.md-aware tools on the same manual.',
    ],
    dontItems: [
      'Do not fork the doctrine by client.',
      'Do not require a separate port-daddy-cli skill.',
      'Do not let runner metadata get ahead of the source skill.',
    ],
    codeLabel: 'Runner adapter shape',
    code: `name: port-daddy-agent-skill
surfaces:
  codex: .codex/skills/port-daddy-agent-skill
  claude: .claude/skills/port-daddy-agent-skill
  agents: .agents/skills/port-daddy-agent-skill
  gemini: .gemini/extensions/port-daddy/skills/port-daddy-agent-skill`,
  },
]

const INSTALL_TRANSCRIPT = `$ pd install
Installing Port Daddy daemon...
  Platform: darwin
  Wrote ~/Library/LaunchAgents/com.portdaddy.daemon.plist
  LaunchAgent loaded (com.portdaddy.daemon)
Port Daddy daemon installed successfully.
  Auto-starts on login
  Test: curl http://127.0.0.1:9876/health

$ pd mcp install
INFO: Port Daddy MCP Installer
  Configuring MCP server:
    ✓ Claude Code          configured
    ✓ Cursor               configured
  Skill installed:
    ✓ ~/.port-daddy/skills/SKILL.md
  Next steps:
    1. Restart your editors to activate Port Daddy tools

$ python3 skills/port-daddy-agent-skill/scripts/validate_port_daddy_agent_skill.py skills/port-daddy-agent-skill
Port Daddy agent skill bundle OK: skills/port-daddy-agent-skill

$ pd begin --identity myapp:agent --purpose "coordinate through Skill + MCP"
SUCCESS: Agent myapp:agent ready
  Session: session-myapp-agent-8f31
  Purpose: coordinate through Skill + MCP
  Identity: myapp:agent`

const ESSENTIAL_TOOLS = [
  ['begin_session', 'Register identity, claim files, and start a recoverable session.'],
  ['end_session_full', 'Release files, close the session, and unregister the agent.'],
  ['whoami', 'Confirm the current agent, session, notes, and file claims.'],
  ['coordination_preflight', 'Check context, claims, symbols, salvage, tuples, channels, and locks before edits.'],
  ['claim_port', 'Get a deterministic port for a semantic identity.'],
  ['release_port', 'Release a semantic port claim.'],
  ['add_note', 'Append durable context to the session ledger.'],
  ['acquire_lock', 'Hold a TTL-protected distributed lock for critical sections.'],
  ['list_services', 'Inspect active service registrations and owners.'],
  ['fleet_init', 'Create a coordinated project fleet.'],
  ['swarm_awareness', 'Check live agents, sessions, file claims, and salvage.'],
  ['sitrep', 'Summarize what happened since the last active context.'],
  ['catch_me_up', 'Back-compatible alias for sitrep.'],
  ['spawn_agent', 'Launch a background agent with identity, budget, and heartbeat tracking.'],
  ['run_sortie', 'Launch and track a sortie mission record.'],
  ['drop_feedback', 'Record structured feedback for Cartographer to harvest.'],
  ['pd_discover', 'List categories, counts, names, and full schemas for more tools.'],
] as const

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  magic: Cpu,
  'session-lifecycle': Activity,
  advisor: Search,
  discovery: Search,
  ports: Anchor,
  sessions: Activity,
  notes: Terminal,
  locks: Database,
  messaging: Radio,
  agents: Users,
  actors: Users,
  inbox: Terminal,
  webhooks: Globe,
  integration: Layers,
  dns: Globe,
  briefing: LifeBuoy,
  tunnels: Globe,
  projects: Layers,
  changelog: GitBranch,
  activity: Activity,
  sorties: Bot,
  system: Database,
  tuples: Layers,
  'fleet-control': Cpu,
  semantic: GitBranch,
  feedback: LifeBuoy,
}

function SectionBand({
  id,
  children,
  tone = 'paper',
}: {
  id?: string
  children: ReactNode
  tone?: 'paper' | 'sunken' | 'raised'
}) {
  const toneClass =
    tone === 'sunken'
      ? 'bg-[var(--surface-sunken)]'
      : tone === 'raised'
        ? 'bg-[var(--surface-raised)]'
        : 'bg-[var(--surface-base)]'

  return (
    <section
      id={id}
      className={`${toneClass} border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]`}
    >
      {children}
    </section>
  )
}

function MetricStrip() {
  return (
    <div className="grid border-2 border-[var(--border-strong)] md:grid-cols-3">
      {PROOF_METRICS.map((metric, index) => (
        <SurfacePanel
          key={metric.label}
          tone={metric.tone}
          elevation="quiet"
          className={index < PROOF_METRICS.length - 1 ? 'border-b-2 md:border-b-0 md:border-r-2' : ''}
        >
          <PanelTitle
            as="p"
            size="card"
            tone={metric.tone === 'blue' ? 'primary' : metric.tone === 'accent' ? 'accent' : 'default'}
          >
            {metric.value}
          </PanelTitle>
          <PanelEyebrow
            tone={metric.tone === 'blue' ? 'primary' : metric.tone === 'accent' ? 'accent' : 'default'}
            className="mt-[var(--space-2)]"
          >
            {metric.label}
          </PanelEyebrow>
        </SurfacePanel>
      ))}
    </div>
  )
}

function RuntimeTable() {
  return (
    <SurfacePanel className="overflow-hidden p-0">
      <div className="grid border-b-2 border-[var(--border-strong)] bg-[var(--surface-strong)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
        <span>Backend</span>
        <span className="hidden sm:block">Tier ladder</span>
        <span className="hidden sm:block">Launch path</span>
      </div>
      {RUNTIME_BACKENDS.map((backend) => (
        <div
          key={backend.name}
          className="grid gap-[var(--space-2)] border-b border-[var(--border-subtle)] px-[var(--space-4)] py-[var(--space-3)] last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]"
        >
          <PanelTitle as="p" size="nav">
            {backend.name}
          </PanelTitle>
          <PanelBody size="compact" className="max-w-none">
            {backend.tier}
          </PanelBody>
          <PanelBody size="compact" className="max-w-none">
            {backend.surface}
          </PanelBody>
        </div>
      ))}
    </SurfacePanel>
  )
}

function ToolCard({ tool }: { tool: MagicTool }) {
  const panelTone = tool.tone === 'blue' ? 'primary' : tool.tone === 'accent' ? 'accent' : 'default'

  return (
    <article className="min-w-0">
      <SurfacePanel tone={tool.tone} className="flex h-full flex-col gap-[var(--panel-gap)]">
        <div className="flex items-start gap-[var(--panel-gap-tight)]">
          <div className="flex h-[var(--space-7)] w-[var(--space-7)] shrink-0 items-center justify-center border-2 border-current">
            <tool.icon aria-hidden="true" className="h-[var(--space-5)] w-[var(--space-5)]" />
          </div>
          <div className="space-y-[var(--space-1)]">
            <PanelEyebrow tone={panelTone}>MCP tool</PanelEyebrow>
            <PanelTitle as="h3" size="nav" tone={panelTone}>
              {tool.name}
            </PanelTitle>
          </div>
        </div>
        <PanelBody size="compact" tone={tool.tone === 'blue' ? 'primary' : tool.tone === 'accent' ? 'accent' : 'default'} className="max-w-none">
          {tool.description}
        </PanelBody>
        <DocsCodeBlock code={tool.example} language="typescript" label={tool.tagline} />
      </SurfacePanel>
    </article>
  )
}

function ChannelTabs() {
  const [active, setActive] = useState(CHANNEL_SURFACES[0].id)
  const surface = CHANNEL_SURFACES.find((item) => item.id === active) ?? CHANNEL_SURFACES[0]
  const activeIndex = CHANNEL_SURFACES.findIndex((item) => item.id === active)
  const focusTab = (index: number) => {
    const next = CHANNEL_SURFACES[index]
    if (!next) return
    document.getElementById(`mcp-channel-tab-${next.id}`)?.focus()
    setActive(next.id)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      focusTab((index + 1) % CHANNEL_SURFACES.length)
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      focusTab((index - 1 + CHANNEL_SURFACES.length) % CHANNEL_SURFACES.length)
    }
    if (event.key === 'Home') {
      event.preventDefault()
      focusTab(0)
    }
    if (event.key === 'End') {
      event.preventDefault()
      focusTab(CHANNEL_SURFACES.length - 1)
    }
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-[var(--space-5)] lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div role="tablist" aria-label="Pub/sub access path" aria-orientation="vertical" className="grid min-w-0 gap-[var(--space-2)]">
        {CHANNEL_SURFACES.map((item, index) => (
          <button
            key={item.id}
            id={`mcp-channel-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={active === item.id}
            aria-controls={`mcp-channel-panel-${item.id}`}
            tabIndex={activeIndex === index ? 0 : -1}
            onClick={() => setActive(item.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className="group flex w-full items-center justify-between border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-4)] py-[var(--space-3)] text-left text-[var(--text-primary)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)] aria-selected:bg-[var(--brand-primary)] aria-selected:text-[var(--brand-primary-foreground)]"
          >
            <span className="flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)]">
              <item.icon aria-hidden="true" className="h-[var(--space-4)] w-[var(--space-4)]" />
              {item.label}
            </span>
            <ArrowRight aria-hidden="true" className="h-[var(--space-4)] w-[var(--space-4)] opacity-60 transition-transform group-hover:translate-x-1" />
          </button>
        ))}
      </div>
      <div id={`mcp-channel-panel-${surface.id}`} role="tabpanel" aria-labelledby={`mcp-channel-tab-${surface.id}`} className="min-w-0">
        <SurfacePanel className="space-y-[var(--panel-gap)]">
          <div className="space-y-[var(--space-2)]">
            <BracketLabel>{surface.label}</BracketLabel>
            <PanelTitle as="h3" size="card">
              One channel, many clients.
            </PanelTitle>
            <PanelBody size="compact" className="max-w-[42rem]">
              {surface.note}
            </PanelBody>
          </div>
          <DocsCodeBlock code={surface.code} language={surface.language} label={`${surface.label} example`} />
        </SurfacePanel>
      </div>
    </div>
  )
}

function MarkdownPreview({ lines }: { lines: string[] }) {
  return (
    <div className="min-w-0 space-y-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-3)]">
      <PanelEyebrow>Markdown preview</PanelEyebrow>
      <div className="space-y-[var(--space-2)]">
        {lines.map((line, index) => {
          if (line.startsWith('# ')) {
            return (
              <PanelTitle key={`${line}-${index}`} as="p" size="nav">
                {line.slice(2)}
              </PanelTitle>
            )
          }

          if (line.startsWith('## ')) {
            return (
              <PanelEyebrow key={`${line}-${index}`} className="text-[var(--text-primary)]">
                {line.slice(3)}
              </PanelEyebrow>
            )
          }

          if (line.startsWith('- ')) {
            return (
              <div key={`${line}-${index}`} className="flex gap-[var(--space-2)] border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-[var(--space-2)]">
                <Check aria-hidden="true" className="mt-[0.2rem] h-[var(--space-4)] w-[var(--space-4)] shrink-0 text-[var(--brand-primary)]" />
                <PanelBody size="compact" className="max-w-none">
                  {line.slice(2)}
                </PanelBody>
              </div>
            )
          }

          return (
            <PanelBody key={`${line}-${index}`} size="compact" className="max-w-none">
              {line}
            </PanelBody>
          )
        })}
      </div>
    </div>
  )
}

function CommentDirectives({ comments }: { comments: string[] }) {
  const directives = comments.map((comment) => {
    const slug = comment.match(/pd:([a-z0-9-]+)/)?.[1] ?? comment
    const copy = DIRECTIVE_COPY[slug] ?? {
      label: slug
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' '),
      body: 'Port Daddy treats this markdown comment as a rendered instruction for agents and docs readers.',
    }

    return { slug, ...copy }
  })

  return (
    <div className="grid min-w-0 gap-[var(--space-3)]">
      <PanelEyebrow className="break-words">Rendered directives</PanelEyebrow>
      <div className="grid min-w-0 max-w-full gap-[var(--space-2)] sm:grid-cols-2">
        {directives.map(({ slug, label, body }) => (
          <article
            key={slug}
            className="grid min-w-0 grid-cols-[2.4rem_minmax(0,1fr)] gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-2)]"
          >
            <span className="grid h-[2.4rem] w-[2.4rem] place-items-center border-2 border-[var(--brand-primary)] bg-[var(--brand-primary)] font-mono text-[0.72rem] font-bold uppercase text-[var(--brand-primary-foreground)]">
              PD
            </span>
            <div className="min-w-0">
              <PanelTitle as="h4" size="nav">
                {label}
              </PanelTitle>
              <PanelBody size="compact" className="mt-[var(--space-1)] max-w-none">
                {body}
              </PanelBody>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

function DoDontPanel({ item }: { item: SkillExplorerItem }) {
  return (
    <div className="grid min-w-0 gap-[var(--space-3)] lg:grid-cols-2">
      <div className="min-w-0 border-2 border-[var(--brand-primary)] bg-[var(--surface-base)] p-[var(--space-3)]">
        <PanelEyebrow>Do</PanelEyebrow>
        <ul className="mt-[var(--space-2)] space-y-[var(--space-2)]">
          {item.doItems.map((entry) => (
            <PanelBody key={entry} as="li" size="compact" className="flex max-w-none gap-[var(--space-2)]">
              <Check aria-hidden="true" className="mt-[0.2rem] h-[var(--space-4)] w-[var(--space-4)] shrink-0 text-[var(--brand-primary)]" />
              <span>{entry}</span>
            </PanelBody>
          ))}
        </ul>
      </div>
      <div className="min-w-0 border-2 border-[var(--border-strong)] bg-[var(--surface-sunken)] p-[var(--space-3)]">
        <PanelEyebrow>Do not</PanelEyebrow>
        <ul className="mt-[var(--space-2)] space-y-[var(--space-2)]">
          {item.dontItems.map((entry) => (
            <PanelBody key={entry} as="li" size="compact" className="flex max-w-none gap-[var(--space-2)]">
              <span aria-hidden="true" className="mt-[0.05rem] font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-none text-[var(--text-primary)]">
                X
              </span>
              <span>{entry}</span>
            </PanelBody>
          ))}
        </ul>
      </div>
    </div>
  )
}

function SkillVisual({ item }: { item: SkillExplorerItem }) {
  const Icon = item.icon

  return (
    <div className="grid min-h-[14rem] min-w-0 content-between gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-3)]">
      <div className="flex items-start justify-between gap-[var(--space-3)]">
        <div className="grid h-[var(--space-8)] w-[var(--space-8)] place-items-center border-2 border-[var(--border-strong)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]">
          <Icon aria-hidden="true" className="h-[var(--space-5)] w-[var(--space-5)]" />
        </div>
        <PanelEyebrow className="text-right">{item.badge}</PanelEyebrow>
      </div>

      <div className="grid gap-[var(--space-2)]">
        {item.files.map((file) => (
          <div key={file} className="flex items-center gap-[var(--space-2)] border border-[var(--border-default)] bg-[var(--surface-base)] px-[var(--space-2)] py-[var(--space-2)]">
            <FileText aria-hidden="true" className="h-[var(--space-4)] w-[var(--space-4)] shrink-0 text-[var(--brand-primary)]" />
            <code className="min-w-0 break-all font-mono text-[0.78rem] text-[var(--text-primary)]">{file}</code>
          </div>
        ))}
      </div>

      <PanelBody size="compact" className="max-w-none">
        {item.summary}
      </PanelBody>
    </div>
  )
}

function SkillManualView({ item }: { item: SkillExplorerItem }) {
  return (
    <div className="grid min-w-0 gap-[var(--space-4)]">
      <div className="grid gap-[var(--space-3)] lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <div className="min-w-0 border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-3)]">
          <PanelEyebrow>Frontmatter contract</PanelEyebrow>
          <div className="mt-[var(--space-3)] grid gap-[var(--space-2)]">
            {SKILL_MANUAL_FRONTMATTER.map(([key, value]) => (
              <div key={key} className="grid gap-[var(--space-1)] border border-[var(--border-default)] bg-[var(--surface-base)] p-[var(--space-2)]">
                <code className="font-mono text-[0.76rem] font-semibold text-[var(--brand-primary)]">{key}</code>
                <PanelBody size="compact" className="max-w-none">
                  {value}
                </PanelBody>
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-0 border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-3)]">
          <PanelEyebrow>Rendered manual map</PanelEyebrow>
          <div className="mt-[var(--space-3)] grid gap-[var(--space-2)]">
            {SKILL_MANUAL_SECTIONS.map(([title, body]) => (
              <section key={title} className="border border-[var(--border-default)] bg-[var(--surface-raised)] p-[var(--space-2)]">
                <PanelTitle as="h4" size="nav">
                  {title}
                </PanelTitle>
                <PanelBody size="compact" className="mt-[var(--space-1)] max-w-none">
                  {body}
                </PanelBody>
              </section>
            ))}
          </div>
        </div>
      </div>

      <div className="min-w-0 border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-3)]">
        <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
          <PanelEyebrow>Default Agent Happy Path</PanelEyebrow>
          <code
            className="border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-[var(--space-2)] py-[var(--space-1)] font-mono text-[0.76rem] text-[var(--text-secondary)]"
            style={{ display: 'block', whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-word' }}
          >
            runnable order, not decorative prose
          </code>
        </div>
        <ol className="mt-[var(--space-3)] grid gap-[var(--space-2)]">
          {SKILL_MANUAL_LOOP.map(([command, reason], index) => (
            <li key={command} className="grid gap-[var(--space-2)] border border-[var(--border-default)] bg-[var(--surface-raised)] p-[var(--space-2)] sm:grid-cols-[2.2rem_minmax(0,1fr)]">
              <span className="grid h-[2.2rem] w-[2.2rem] place-items-center border-2 border-[var(--border-strong)] bg-[var(--brand-primary)] font-mono text-[0.78rem] font-bold text-[var(--brand-primary-foreground)]">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0">
                <code
                  className="font-mono text-[0.84rem] font-semibold text-[var(--text-primary)]"
                  style={{ display: 'block', whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                >
                  {command}
                </code>
                <PanelBody size="compact" className="mt-[var(--space-1)] max-w-none">
                  {reason}
                </PanelBody>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <DocsCodeBlock code={item.code ?? ''} language="cli" label={item.codeLabel ?? 'Happy path commands'} />
      <CommentDirectives comments={item.comments} />
      <DoDontPanel item={item} />
    </div>
  )
}

function SkillExplorer() {
  const [active, setActive] = useState(SKILL_EXPLORER_ITEMS[0].id)
  const activeItem = SKILL_EXPLORER_ITEMS.find((item) => item.id === active) ?? SKILL_EXPLORER_ITEMS[0]
  const activeIndex = SKILL_EXPLORER_ITEMS.findIndex((item) => item.id === active)
  const focusTab = (index: number) => {
    const next = SKILL_EXPLORER_ITEMS[index]
    if (!next) return
    document.getElementById(`skill-explorer-tab-${next.id}`)?.focus()
    setActive(next.id)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      focusTab((index + 1) % SKILL_EXPLORER_ITEMS.length)
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      focusTab((index - 1 + SKILL_EXPLORER_ITEMS.length) % SKILL_EXPLORER_ITEMS.length)
    }
    if (event.key === 'Home') {
      event.preventDefault()
      focusTab(0)
    }
    if (event.key === 'End') {
      event.preventDefault()
      focusTab(SKILL_EXPLORER_ITEMS.length - 1)
    }
  }

  return (
    <div className="grid gap-[var(--space-4)]">
      <div className="flex items-center gap-[var(--space-2)] text-[var(--brand-primary-foreground)]">
        <FolderTree aria-hidden="true" className="h-[var(--space-5)] w-[var(--space-5)]" />
        <PanelEyebrow tone="primary">Clickable skill explorer</PanelEyebrow>
      </div>
      <div className="grid min-w-0 gap-[var(--space-4)]">
        <div role="tablist" aria-label="Port Daddy agent skill file tree" className="grid content-start gap-[var(--space-2)] sm:grid-cols-2">
          {SKILL_EXPLORER_ITEMS.map((item, index) => {
            const Icon = item.icon
            const selected = active === item.id

            return (
              <button
                key={item.id}
                id={`skill-explorer-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`skill-explorer-panel-${item.id}`}
                tabIndex={activeIndex === index ? 0 : -1}
                onClick={() => setActive(item.id)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                className="group flex w-full items-center justify-between gap-[var(--space-2)] border-2 border-current px-[var(--space-3)] py-[var(--space-2)] text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--brand-primary-foreground)]"
                style={
                  selected
                    ? { background: 'var(--surface-base)', color: 'var(--text-primary)' }
                    : { background: 'transparent', color: 'var(--brand-primary-foreground)' }
                }
              >
                <span className="flex min-w-0 items-center gap-[var(--space-2)]">
                  <Icon aria-hidden="true" className="h-[var(--space-4)] w-[var(--space-4)] shrink-0" />
                  <span className="truncate font-mono text-[0.82rem]">{item.label}</span>
                </span>
                <ArrowRight aria-hidden="true" className="h-[var(--space-4)] w-[var(--space-4)] shrink-0 opacity-70 transition-transform group-hover:translate-x-1" />
              </button>
            )
          })}
        </div>

        <div
          id={`skill-explorer-panel-${activeItem.id}`}
          role="tabpanel"
          aria-labelledby={`skill-explorer-tab-${activeItem.id}`}
          className="min-w-0 border-2 border-current bg-[var(--surface-base)] p-[var(--space-4)] text-[var(--text-primary)]"
        >
          <div className="grid gap-[var(--space-4)]">
            <div className="min-w-0 space-y-[var(--space-2)]">
              <PanelEyebrow className="break-all">{activeItem.path}</PanelEyebrow>
              <PanelTitle as="h3" size="card" className="break-words">
                {activeItem.label}
              </PanelTitle>
              <PanelBody size="compact" className="max-w-none">
                {activeItem.summary}
              </PanelBody>
            </div>

            {activeItem.id === 'skill' ? (
              <SkillManualView item={activeItem} />
            ) : (
              <>
                <div className="grid gap-[var(--space-3)]">
                  <SkillVisual item={activeItem} />
                  <MarkdownPreview lines={activeItem.markdown} />
                </div>

                <CommentDirectives comments={activeItem.comments} />

                {activeItem.mermaid ? (
                  <div className="grid gap-[var(--space-3)]">
                    <PanelEyebrow>Mermaid pretty print</PanelEyebrow>
                    <div className="[&>div]:my-0">
                      <Mermaid chart={activeItem.mermaid} />
                    </div>
                    <DocsCodeBlock code={activeItem.mermaid} language="text" label="Mermaid source" />
                  </div>
                ) : null}

                {activeItem.code ? (
                  <DocsCodeBlock code={activeItem.code} language="text" label={activeItem.codeLabel ?? 'Source snippet'} />
                ) : null}

                {activeItem.image ? (
                  <figure className="grid min-w-0 gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-3)]">
                    <img
                      src={activeItem.image.src}
                      alt={activeItem.image.alt}
                      className="block aspect-[16/10] w-full border border-[var(--border-default)] object-cover"
                    />
                    <figcaption className="font-sans text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                      {activeItem.image.caption}
                    </figcaption>
                  </figure>
                ) : null}

                <DoDontPanel item={activeItem} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function LifecycleDiagram() {
  const steps = [
    ['heartbeat gap', 'Detect stale body lease'],
    ['salvage', 'Preserve notes and claims'],
    ['budget check', 'Respect run ceiling'],
    ['respawn', 'Launch same identity'],
  ] as const

  return (
    <div className="grid gap-[var(--space-3)] sm:grid-cols-4">
      {steps.map(([label, description], index) => (
        <div key={label} className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)]">
          <PanelEyebrow>{String(index + 1).padStart(2, '0')}</PanelEyebrow>
          <PanelTitle as="h3" size="nav" className="mt-[var(--space-2)]">
            {label}
          </PanelTitle>
          <PanelBody size="compact" className="mt-[var(--space-2)] max-w-none">
            {description}
          </PanelBody>
        </div>
      ))}
    </div>
  )
}

function EssentialTools() {
  return (
    <SurfacePanel elevation="quiet" padding="compact" className="space-y-[var(--space-3)]">
      <div className="flex flex-wrap items-end justify-between gap-[var(--space-3)]">
        <div className="min-w-0">
          <PanelEyebrow>Default toolset</PanelEyebrow>
          <PanelTitle as="h3" size="nav" className="mt-[var(--space-1)]">
            {ESSENTIAL_TOOLS.length} tools before discovery
          </PanelTitle>
        </div>
        <PanelBody size="compact" className="max-w-[34ch] sm:text-right">
          Compact listTools response. Full specs live below.
        </PanelBody>
      </div>
      <div className="flex flex-wrap gap-[var(--space-1)]">
        {ESSENTIAL_TOOLS.map(([name, description]) => (
          <code
            key={name}
            title={description}
            aria-label={`${name}: ${description}`}
            className="border border-[var(--border-subtle)] bg-[var(--surface-base)] px-[var(--space-2)] py-[var(--space-1)] font-mono text-[0.72rem] font-semibold leading-[var(--leading-code)] text-[var(--brand-primary)]"
          >
            {name}
          </code>
        ))}
      </div>
    </SurfacePanel>
  )
}

function DiscoverGrid() {
  return (
    <div className="grid gap-[var(--space-3)] md:grid-cols-2 xl:grid-cols-3">
      {ALL_CATEGORIES.map((category) => {
        const Icon = CATEGORY_ICONS[category.id] ?? Cpu

        return (
          <SurfacePanel key={category.id} padding="compact" elevation="quiet" className="space-y-[var(--space-3)]">
            <div className="flex items-start justify-between gap-[var(--space-3)]">
              <div className="flex min-w-0 items-center gap-[var(--space-2)]">
                <Icon aria-hidden="true" className="h-[var(--space-5)] w-[var(--space-5)] shrink-0 text-[var(--brand-primary)]" />
                <PanelTitle as="h3" size="nav">
                  {category.label}
                </PanelTitle>
              </div>
              <PanelEyebrow className="shrink-0">{category.tools.length} tools</PanelEyebrow>
            </div>
            <PanelBody size="compact" className="max-w-none">
              {category.description}
            </PanelBody>
            <div className="flex flex-wrap gap-[var(--space-1)]">
              {category.tools.map((tool) => (
                <code
                  id={tool}
                  key={tool}
                  className="scroll-mt-24 border border-[var(--border-subtle)] bg-[var(--surface-base)] px-[var(--space-2)] py-[var(--space-1)] font-mono text-[0.72rem] text-[var(--text-secondary)]"
                >
                  {tool}
                </code>
              ))}
            </div>
          </SurfacePanel>
        )
      })}
    </div>
  )
}

function sampleValueForParameter(parameter: McpAgentToolParameter): string {
  if (parameter.enum?.length) return `"${parameter.enum[0]}"`
  if (parameter.type === 'number') return '123'
  if (parameter.type === 'boolean') return 'true'
  if (parameter.type.endsWith('[]')) return '[]'
  if (parameter.type === 'array') return '[]'
  if (parameter.type === 'object') return '{}'
  return `"<${parameter.name}>"`
}

function agentCallShape(tool: McpAgentToolDefinition): string {
  if (tool.parameters.length === 0) return `await ${tool.name}({})`

  const fields = tool.parameters
    .filter((parameter) => parameter.required)
    .concat(tool.parameters.filter((parameter) => !parameter.required).slice(0, 2))
    .slice(0, 6)

  return `await ${tool.name}({\n${fields.map((parameter) => `  ${parameter.name}: ${sampleValueForParameter(parameter)},`).join('\n')}\n})`
}

function ParameterList({ parameters, depth = 0 }: { parameters: McpAgentToolParameter[]; depth?: number }) {
  if (parameters.length === 0) {
    return (
      <PanelBody size="compact" className="max-w-none border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-[var(--space-2)]">
        No input parameters.
      </PanelBody>
    )
  }

  return (
    <div className="grid gap-[var(--space-2)]">
      {parameters.map((parameter) => (
        <div
          key={`${depth}-${parameter.name}`}
          className="grid min-w-0 gap-[var(--space-2)] border border-[var(--border-default)] bg-[var(--surface-raised)] p-[var(--space-2)]"
        >
          <div className="flex min-w-0 flex-wrap items-start gap-[var(--space-2)]">
            <span className="max-w-full break-words border border-[var(--border-subtle)] bg-[var(--surface-base)] px-[var(--space-2)] py-[var(--space-1)] font-mono text-[0.78rem] font-semibold text-[var(--brand-primary)]">
              {parameter.name}
            </span>
            <span className="border border-[var(--border-subtle)] px-[var(--space-2)] py-[var(--space-1)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
              {parameter.required ? 'required' : 'optional'}
            </span>
            <span className="break-words border border-[var(--border-subtle)] px-[var(--space-2)] py-[var(--space-1)] font-mono text-[0.72rem] text-[var(--text-secondary)]">
              {parameter.type}
            </span>
          </div>
          {parameter.description ? (
            <PanelBody size="compact" className="max-w-none">
              {parameter.description}
            </PanelBody>
          ) : null}
          {parameter.enum?.length ? (
            <div className="flex flex-wrap gap-[var(--space-1)]">
              {parameter.enum.map((value) => (
                <span key={value} className="border border-[var(--border-subtle)] bg-[var(--surface-base)] px-[var(--space-2)] py-[var(--space-1)] font-mono text-[0.72rem] text-[var(--text-secondary)]">
                  {value}
                </span>
              ))}
            </div>
          ) : null}
          {parameter.properties?.length ? (
            <div className="grid min-w-0 gap-[var(--space-2)] border-l-2 border-[var(--border-strong)] pl-[var(--space-2)]">
              <PanelEyebrow>Nested fields</PanelEyebrow>
              <ParameterList parameters={parameter.properties} depth={depth + 1} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function AgentToolSpecCard({ tool }: { tool: McpAgentToolDefinition }) {
  return (
    <article id={`mcp-tool-${tool.name}`} className="scroll-mt-24 border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-3)]">
      <div className="grid gap-[var(--space-3)]">
        <div className="min-w-0 space-y-[var(--space-3)]">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-[var(--space-2)]">
            <span className="max-w-full break-words font-mono text-[1.05rem] font-bold text-[var(--text-primary)]">
              {tool.name}
            </span>
            <span className={`border-2 px-[var(--space-2)] py-[var(--space-1)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] ${
              tool.exposure === 'default'
                ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
                : 'border-[var(--border-default)] text-[var(--text-secondary)]'
            }`}
            >
              {tool.exposure === 'default' ? 'default tool' : 'discoverable'}
            </span>
          </div>
          <PanelEyebrow>{tool.categoryLabel}</PanelEyebrow>
          <PanelBody size="compact" className="max-w-none">
            {tool.description}
          </PanelBody>
          <div className="border border-[var(--border-default)] bg-[var(--surface-raised)] p-[var(--space-2)]">
            <PanelEyebrow>Agent call shape</PanelEyebrow>
            <pre className="mt-[var(--space-2)] overflow-x-auto whitespace-pre-wrap break-words font-mono text-[0.78rem] leading-relaxed text-[var(--text-primary)]">
              {agentCallShape(tool)}
            </pre>
          </div>
        </div>

        <div className="min-w-0 space-y-[var(--space-3)]">
          <div className="min-w-0">
            <PanelEyebrow>Input schema fields</PanelEyebrow>
            <div className="mt-[var(--space-2)]">
              <ParameterList parameters={tool.parameters} />
            </div>
          </div>
          <details className="group border border-[var(--border-default)] bg-[var(--surface-raised)] p-[var(--space-2)]">
            <summary className="cursor-pointer font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)]">
              Raw MCP JSON schema
            </summary>
            <pre className="mt-[var(--space-2)] max-h-[24rem] overflow-auto whitespace-pre-wrap break-words border border-[var(--border-subtle)] bg-[var(--surface-base)] p-[var(--space-2)] font-mono text-[0.72rem] leading-relaxed text-[var(--text-secondary)]">
              {JSON.stringify(tool.inputSchema, null, 2)}
            </pre>
          </details>
        </div>
      </div>
    </article>
  )
}

function AgentToolDefinitionsBrowser() {
  const [activeCategory, setActiveCategory] = useState('all')
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()

  const parameterMatches = (parameter: McpAgentToolParameter): boolean =>
    parameter.name.toLowerCase().includes(normalizedQuery) ||
    parameter.description.toLowerCase().includes(normalizedQuery) ||
    parameter.type.toLowerCase().includes(normalizedQuery) ||
    Boolean(parameter.properties?.some(parameterMatches))

  const categoryOptions = [
    {
      id: 'default',
      label: 'Default',
      description: 'The tools a normal MCP client receives before asking for more.',
      tools: MCP_AGENT_TOOL_DEFINITIONS.filter((tool) => tool.exposure === 'default').map((tool) => tool.name),
    },
    {
      id: 'all',
      label: 'All tools',
      description: 'Every callable tool handled by the Port Daddy MCP server.',
      tools: MCP_AGENT_TOOL_DEFINITIONS.map((tool) => tool.name),
    },
    ...MCP_AGENT_TOOL_CATEGORIES,
  ]

  const selectedCategory = categoryOptions.find((category) => category.id === activeCategory) ?? categoryOptions[0]
  const selectedToolNames = new Set(selectedCategory.tools)
  const visibleTools = MCP_AGENT_TOOL_DEFINITIONS.filter((tool) => {
    if (!selectedToolNames.has(tool.name)) return false
    if (!normalizedQuery) return true
    return (
      tool.name.toLowerCase().includes(normalizedQuery) ||
      tool.description.toLowerCase().includes(normalizedQuery) ||
      tool.categoryLabel.toLowerCase().includes(normalizedQuery) ||
      tool.parameters.some(parameterMatches)
    )
  })

  return (
    <div className="grid min-w-0 gap-[var(--space-5)]">
      <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-3)]">
        <div className="grid gap-[var(--space-4)] lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.32fr)]">
          <div className="min-w-0">
            <PanelEyebrow>{selectedCategory.id === 'default' ? 'ListTools response' : `pd_discover("${selectedCategory.id}")`}</PanelEyebrow>
            <PanelTitle as="h3" size="card" className="mt-[var(--space-2)]">
              {selectedCategory.label}: {visibleTools.length} tool{visibleTools.length === 1 ? '' : 's'}
            </PanelTitle>
            <PanelBody size="compact" className="mt-[var(--space-2)] max-w-none">
              {selectedCategory.description}
            </PanelBody>
          </div>
          <label className="grid min-w-0 gap-[var(--space-1)] self-start">
            <PanelEyebrow>Filter specs</PanelEyebrow>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="tool, parameter, description"
              className="min-h-[3rem] w-full border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-3)] py-[var(--space-2)] font-sans font-opsz-body text-[1rem] text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]"
            />
          </label>
        </div>
        <div role="tablist" aria-label="MCP tool categories" className="mt-[var(--space-4)] grid gap-[var(--space-2)] sm:grid-cols-2 lg:grid-cols-4">
          {categoryOptions.map((category) => {
            const active = category.id === activeCategory
            return (
              <button
                key={category.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveCategory(category.id)}
                className={`grid min-w-0 gap-[var(--space-1)] border-2 p-[var(--space-2)] text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)] ${
                  active
                    ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
                    : 'border-[var(--border-default)] bg-[var(--surface-raised)] text-[var(--text-primary)] hover:border-[var(--border-strong)]'
                }`}
              >
                <span className="flex min-w-0 items-center justify-between gap-[var(--space-2)]">
                  <span className="truncate font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)]">
                    {category.label}
                  </span>
                  <span className="font-mono text-[0.72rem]">{category.tools.length}</span>
                </span>
                <span className={`line-clamp-2 text-[0.78rem] leading-snug ${active ? 'text-[var(--brand-primary-foreground-subtle)]' : 'text-[var(--text-secondary)]'}`}>
                  {category.description}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid min-w-0 gap-[var(--space-3)]">
        {visibleTools.map((tool) => (
          <AgentToolSpecCard key={tool.name} tool={tool} />
        ))}
      </div>
    </div>
  )
}

export default function McpPage() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 100, damping: 30, restDelta: 0.001 })

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[var(--surface-base)] font-sans text-[var(--text-primary)]"
    >
      <motion.div
        aria-hidden="true"
        className="fixed left-0 right-0 top-[var(--nav-height)] z-[100] h-[3px] origin-left bg-[var(--brand-primary)]"
        style={{ scaleX }}
      />

      <main id="main-content">
        <header className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
          <PageContainer
            width="wide"
            className="pb-[var(--space-8)] pt-[var(--section-space-y)] lg:pb-[var(--space-9)] lg:pt-[var(--space-8)]"
          >
            <SwissGrid className="items-start">
              <SwissGridItem span="wide" className="space-y-[var(--space-6)]">
                <BracketLabel>Skill + MCP</BracketLabel>
                <div className="space-y-[var(--space-5)]">
                  <PanelTitle as="h1" size="hero" className="max-w-[12ch]">
                    The manual and the tool socket for serious agent coordination.
                  </PanelTitle>
                  <PanelBody className="max-w-[48rem]">
                    The Port Daddy agent skill teaches agents how to work together. The MCP server gives them the tools to do it: sessions, ports, claims, locks, notes, pub/sub, salvage, fleets, and tuple space wired through the same local daemon and console.
                  </PanelBody>
                  <PanelBody className="max-w-[48rem]">
                    Think of it as the instruction manual plus the control cable. The skill explains when to publish intent, claim a file, lock a critical section, inspect FleetBar, or leave a schema-shaped handoff. MCP makes those moves callable from Claude, Cursor, Windsurf, Codex-adjacent tools, and any client that speaks the protocol.
                  </PanelBody>
                </div>
                <div className="flex flex-wrap gap-[var(--space-3)]">
                  <BracketLink to="/docs/mcp" tone="blue">
                    Read MCP docs
                  </BracketLink>
                  <BracketLink to="/docs/guides/prompting-agents" tone="accent">
                    Prompt agents
                  </BracketLink>
                </div>
              </SwissGridItem>

              <SwissGridItem span="narrow">
                <SurfacePanel tone="blue" className="space-y-[var(--panel-gap-loose)]">
                  <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
                    <picture>
                      <source srcSet="/img/generated/control-plane-og.webp" type="image/webp" />
                      <img
                        src="/img/generated/control-plane-og.jpg"
                        alt="Generated Swiss-modern diagram of an MCP-connected local control plane with agent nodes, locks, ports, and recovery paths"
                        className="block aspect-[16/9] w-full object-cover"
                      />
                    </picture>
                  </figure>
                  <div className="space-y-[var(--space-2)]">
                    <PanelEyebrow tone="primary">Install path</PanelEyebrow>
                    <PanelTitle as="p" size="display" tone="primary">
                      pd mcp install
                    </PanelTitle>
                    <PanelBody tone="primary" className="max-w-none">
                      One local daemon. MCP-compatible clients. Durable session truth.
                    </PanelBody>
                  </div>
                  <DocsCodeBlock
                    code={INSTALL_TRANSCRIPT}
                    language="cli"
                    label="Setup"
                  />
                </SurfacePanel>
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </header>

        <SectionBand id="agent-skill">
          <PageContainer width="wide">
            <SwissGrid className="items-start">
              <SwissGridItem span="rail">
                <div className="space-y-[var(--space-4)]">
                  <SectionIntro
                    eyebrow="Agent skill"
                    title="The instruction manual is now first-class."
                    description="Port Daddy installs the manual in the project folder for Port Daddy-using projects, then mirrors it into the local places Codex, Gemini, Claude, and AGENTS.md-aware tools actually read."
                    titleSize="display"
                  />
                  <a
                    href={AGENTS_MD_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex border-2 border-[var(--border-strong)] px-[var(--space-3)] py-[var(--space-2)] font-sans font-opsz-small text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                  >
                    AGENTS.md open format
                  </a>
                </div>
              </SwissGridItem>
              <SwissGridItem span="body">
                <SurfacePanel
                  tone="blue"
                  className="grid max-h-[min(74rem,calc(100svh-7rem))] min-h-[36rem] grid-rows-[auto_auto_auto_minmax(0,1fr)] gap-[var(--space-4)] overflow-hidden"
                >
                  <BracketLabel tone="primary" surface="blue">
                    What ships
                  </BracketLabel>
                  <PanelTitle as="h2" size="card" tone="primary">
                    A procedural field manual, not a thin prompt.
                  </PanelTitle>
                  <PanelBody tone="primary" className="max-w-none">
                    Procedural knowledge is the repeatable operating know-how an agent uses under pressure, not
                    just facts about a tool.{' '}
                    <a
                      href={PROCEDURAL_KNOWLEDGE_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold underline underline-offset-4"
                    >
                      WinDAGs explains procedural knowledge
                    </a>{' '}
                    in its post on{' '}
                    <a
                      href={PROCEDURAL_KNOWLEDGE_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold underline underline-offset-4"
                    >
                      why declarative knowledge is not enough
                    </a>
                    .
                  </PanelBody>
                  <div className="min-h-0 overflow-y-auto pr-[var(--space-2)]">
                    <SkillExplorer />
                  </div>
                </SurfacePanel>
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </SectionBand>

        <SectionBand tone="raised">
          <PageContainer width="wide" className="space-y-[var(--space-6)]">
            <MetricStrip />
            <RuntimeTable />
          </PageContainer>
        </SectionBand>

      <SectionBand id="tools">
        <PageContainer width="wide">
          <SwissGrid>
            <SwissGridItem span="rail">
              <SectionIntro
                eyebrow="High-level MCP tools"
                title="Useful calls that carry Port Daddy context."
                description="The MCP tools are not a loose bag of shell wrappers. The important calls preserve identity, budget, files, session notes, and recovery semantics."
                titleSize="display"
              />
            </SwissGridItem>
            <SwissGridItem span="body">
              <div className="grid gap-[var(--space-5)] md:grid-cols-2 xl:grid-cols-3">
                {MAGIC_TOOLS.map((tool) => (
                  <ToolCard key={tool.name} tool={tool} />
                ))}
              </div>
            </SwissGridItem>
          </SwissGrid>
        </PageContainer>
      </SectionBand>

      <SectionBand id="channels" tone="sunken">
        <PageContainer width="wide">
          <SwissGrid>
            <SwissGridItem span="rail">
              <SectionIntro
                eyebrow="Pub/Sub radio"
                title="A channel is the same channel everywhere."
                description="CLI hooks, MCP clients, SDK integrations, and REST/SSE consumers publish into the same scoped channel model. That keeps background fleets and interactive agents synchronized."
                titleSize="display"
              />
            </SwissGridItem>
            <SwissGridItem span="body">
              <ChannelTabs />
            </SwissGridItem>
          </SwissGrid>
        </PageContainer>
      </SectionBand>

      <SectionBand id="fleet">
        <PageContainer width="wide">
          <SwissGrid className="items-start">
            <SwissGridItem span="wide" className="space-y-[var(--section-intro-gap)]">
            <SectionIntro
              eyebrow="Fleet recovery"
              title="Respawn is a policy, not a hope."
              description="Fleet agents can restart after crashes, but the important behavior is recoverability: the daemon keeps session notes, salvage state, channel scope, and budget checks visible."
              titleSize="display"
            />
            <LifecycleDiagram />
            </SwissGridItem>
            <SwissGridItem span="narrow">
              <SurfacePanel className="space-y-[var(--panel-gap)]">
                <PanelEyebrow>pd-fleet.yml</PanelEyebrow>
                <DocsCodeBlock
                  code={`fleet:
  name: myapp
  agents:
    qa:
      trigger: git:committed
      backend: ollama
      model: qwen2.5-coder:7b
      respawn: true
      max_respawns: 3
      prompt: |
        Review the last commit. File bugs.

    spark:
      schedule: "*/30 * * * *"
      backend: codex
      model_tier: low
      budget_usd_per_day: 1.00
      prompt: |
        Propose one codebase improvement.`}
                  language="text"
                  label="Fleet config"
                />
              </SurfacePanel>
            </SwissGridItem>
          </SwissGrid>
        </PageContainer>
      </SectionBand>

      <SectionBand id="memory" tone="raised">
        <PageContainer width="wide">
          <SwissGrid className="items-start">
            <SwissGridItem span="half" className="space-y-[var(--section-intro-gap)]">
            <SectionIntro
              eyebrow="Tuple space"
              title="Shared memory for parallel agents."
              description="Agents write structured facts into a harbor-scoped tuple space. Other agents read by pattern, take work items, and coordinate without scraping prose."
              titleSize="display"
            />
            <div className="grid gap-[var(--space-3)] sm:grid-cols-3">
              {[
                ['tuple_out', 'write'],
                ['tuple_rd', 'read'],
                ['tuple_in', 'take'],
                ['tuple_scan', 'inspect'],
                ['tuple_count', 'measure'],
                ['pd tuple', 'operate'],
              ].map(([name, label]) => (
                <SurfacePanel key={name} elevation="quiet" padding="compact">
                  <PanelTitle as="p" size="nav">
                    {name}
                  </PanelTitle>
                  <PanelEyebrow className="mt-[var(--space-1)]">{label}</PanelEyebrow>
                </SurfacePanel>
              ))}
            </div>
            </SwissGridItem>
            <SwissGridItem span="half">
              <DocsCodeBlock
                code={`await tuple_out({
  tuple: ["connection", "trie+pubsub=routing", "spider", 0.9],
  harbor: "myapp:fleet"
})

const finds = await tuple_rd({
  pattern: ["connection", "*", "*", ">0.7"],
  harbor: "myapp:fleet"
})

const task = await tuple_in({
  pattern: ["task", "*", "pending"],
  harbor: "myapp:fleet"
})`}
                language="typescript"
                label="Tuple coordination"
              />
            </SwissGridItem>
          </SwissGrid>
        </PageContainer>
      </SectionBand>

      <SectionBand id="discovery">
        <PageContainer width="wide" className="space-y-[var(--space-7)]">
          <SwissGrid>
            <SwissGridItem span="wide">
              <SectionIntro
                eyebrow="Tool discovery"
                title="Small default toolset, full system on demand."
                description="Agents should not start every turn with an overwhelming tool list. The default set stays tight, then specialized categories unlock only when the task needs them."
                titleSize="display"
              />
            </SwissGridItem>
            <SwissGridItem span="narrow">
              <EssentialTools />
            </SwissGridItem>
          </SwissGrid>
          <DiscoverGrid />
          <div className="space-y-[var(--space-5)]">
            <SectionIntro
              eyebrow="Agent-facing definitions"
              title="Every MCP tool as the agent receives it."
              description="This browser mirrors the MCP registry: tool name, exposure tier, category, description, input fields, required parameters, example call shape, and raw JSON schema."
              titleSize="card"
            />
            <AgentToolDefinitionsBrowser />
          </div>
        </PageContainer>
      </SectionBand>

        <SectionBand tone="sunken">
          <PageContainer className="space-y-[var(--space-6)] text-center">
            <PanelEyebrow>Start coordinated</PanelEyebrow>
            <PanelTitle as="h2" size="display" className="mx-auto max-w-[14ch]">
              Give the next MCP client a real coordination path.
            </PanelTitle>
            <PanelBody className="mx-auto max-w-[44rem]">
              Install the daemon, wire the MCP server, start a session, and let agents use the same coordination features as the CLI and dashboard.
            </PanelBody>
            <div className="flex flex-wrap justify-center gap-[var(--space-3)]">
              <Link
                to="/docs/quickstart"
                className="inline-flex min-h-[calc(var(--space-6)+var(--space-1))] items-center border-2 border-[var(--border-strong)] bg-[var(--brand-primary)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary-foreground)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
              >
                Quick start
              </Link>
              <Link
                to="/docs/mcp"
                className="inline-flex min-h-[calc(var(--space-6)+var(--space-1))] items-center border-2 border-[var(--border-strong)] bg-[var(--brand-accent)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-accent-foreground)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
              >
                MCP reference
              </Link>
            </div>
          </PageContainer>
        </SectionBand>
      </main>

      <Footer />
    </motion.div>
  )
}
