export interface Feature {
  id: string;
  title: string;
  description: string;
  category: 'ports' | 'coordination' | 'security' | 'observability' | 'agents' | 'intelligence' | 'control-plane' | 'resources';
  cli: string;
  href: string;
  image: {
    src: string;
    alt: string;
  };
  detail: string;
  outcomes: string[];
  links: Array<{
    label: string;
    href: string;
  }>;
  status: 'core' | 'new' | 'preview';
}

export interface MacAppCapability {
  id: string;
  label: string;
  title: string;
  description: string;
  proof: string;
}

export interface AppSurface {
  id: string;
  title: string;
  caption: string;
  operatorValue: string;
  highlights: string[];
  actions: string[];
  surface: 'FleetBar' | 'Fleet Control Center' | 'Shipwright';
}

export interface ColdStartStep {
  id: string;
  title: string;
  description: string;
  command?: string;
  appSurface: string;
}

export interface DistributionOption {
  id: string;
  title: string;
  description: string;
  command: string;
  status: 'available' | 'mac-app';
}

export const PRODUCT_FEATURES = [
  {
    id: 'fleetbar',
    title: 'FleetBar for macOS',
    description: 'A native menu-bar app that opens the real Fleet Control Center, shows daemon health, starts and stops fleets, and keeps the selected project one click away.',
    category: 'control-plane',
    cli: 'pd setup',
    href: '/mac-preview',
    image: {
      src: '/img/app-screens/fleetbar-native-shell-light.webp',
      alt: 'FleetBar macOS shell showing the embedded Fleet Control Center',
    },
    detail: 'FleetBar is the Mac-native front door for Port Daddy. It keeps daemon health, project selection, fleet state, and the full web dashboard reachable from the menu bar so you do not have to remember ports, tabs, or stale localhost URLs.',
    outcomes: [
      'Open the same daemon-served console from native chrome or the browser.',
      'See whether the main daemon, selected project, and Fleet Control Center agree.',
      'Start from a real install path instead of a throwaway dashboard preview.',
    ],
    links: [
      { label: 'Mac preview', href: '/mac-preview' },
      { label: 'Install path', href: '/docs/get-started' },
    ],
    status: 'new'
  },
  {
    id: 'fleet-control',
    title: 'Fleet Control Center',
    description: 'The console for Flow, Roadmap, Agents, Resources, Activity, Channels, Inbox, Spawned Runs, Memory, Shipwright, and YAML. It is served by the daemon and embedded by FleetBar.',
    category: 'control-plane',
    cli: 'pd fleet status',
    href: '/agents',
    image: {
      src: '/img/app-screens/fleet-flow-light.webp',
      alt: 'Fleet Control Center flow view showing agent coordination',
    },
    detail: 'Fleet Control Center is the dashboard for real multi-agent work. It brings Flow, Agents, Activity, Channels, Inbox, Spawned Runs, Memory, Resources, Shipwright, and YAML into one inspectable console backed by the live daemon.',
    outcomes: [
      'Inspect the current project without guessing which branch, daemon, or browser tab is authoritative.',
      'Move from roadmap and flow state into individual agent, channel, inbox, and resource views.',
      'Keep FleetBar and the browser pointed at the same project identity.',
    ],
    links: [
      { label: 'Agent console', href: '/agents' },
      { label: 'Fleet docs', href: '/docs/features/fleet' },
    ],
    status: 'new'
  },
  {
    id: 'shipwright',
    title: 'Shipwright cold start',
    description: 'Survey a repo, propose a starter fleet, simulate budget and bond exposure, then move into Flow, Agents, and YAML without leaving the app.',
    category: 'agents',
    cli: 'pd setup --project <dir>',
    href: '/docs/get-started',
    image: {
      src: '/img/app-screens/shipwright-control-light.webp',
      alt: 'Shipwright control view proposing a project fleet',
    },
    detail: 'Shipwright is the cold-start path for a new repo. It surveys the project, proposes a small fleet, names ownership boundaries, estimates budget pressure, and turns setup into a reviewable plan before agents start writing.',
    outcomes: [
      'Understand what Port Daddy thinks the repo needs before launching background work.',
      'Review suggested agents, triggers, budget envelopes, and risky areas visually.',
      'Promote the proposal into Flow, Agents, and YAML when it makes sense.',
    ],
    links: [
      { label: 'Get started', href: '/docs/get-started' },
      { label: 'Prompting agents', href: '/docs/guides/prompting-agents' },
    ],
    status: 'preview'
  },
  {
    id: 'spawned-runs',
    title: 'Spawned runs',
    description: 'Launch tracked delegated work with a durable id, backend/model, budget ceiling, transcripts, and result state you can inspect later.',
    category: 'agents',
    cli: 'pd spawn --backend codex',
    href: '/agents',
    image: {
      src: '/img/app-screens/sorties-light.webp',
      alt: 'Spawned runs view showing delegated agent work',
    },
    detail: 'Spawn packages delegated work with a goal, backend, model tier, budget ceiling, transcripts, and result state. It is for bounded agent work that should remain inspectable after the process exits.',
    outcomes: [
      'Launch delegated work without losing the run id, model, budget, or result trail.',
      'Separate planned missions from ad hoc shell commands and background fleet loops.',
      'Review what happened later from the console.',
    ],
    links: [
      { label: 'Agent console', href: '/agents' },
      { label: 'Spawn reference', href: '/docs/cli/spawn' },
    ],
    status: 'new'
  },
  {
    id: 'resource-governance',
    title: 'Resource controls',
    description: 'Inspect memory, disk, Port Daddy process cost, local model pressure, renderer load, fleet activity, daily spend, and the suggested concurrency envelope.',
    category: 'resources',
    cli: 'pd status',
    href: '/docs/cli/status',
    image: {
      src: '/img/app-screens/resources-light.webp',
      alt: 'Resources view with daemon, memory, and fleet pressure indicators',
    },
    detail: 'Resource controls make agent scale visible before it becomes chaos. Port Daddy shows daemon health, memory, disk, renderer pressure, model availability, spend, and concurrency signals so you can decide how much automation the machine can actually carry.',
    outcomes: [
      'See whether the machine is healthy enough for more agents.',
      'Identify budget, backend, and renderer pressure before launching work.',
      'Use one status view across CLI, FleetBar, and the web console.',
    ],
    links: [
      { label: 'Status command', href: '/docs/cli/status' },
      { label: 'Fleet docs', href: '/docs/features/fleet' },
    ],
    status: 'new'
  },
  {
    id: 'backend-readiness',
    title: 'Backend readiness',
    description: 'Readiness tells you which backends need API keys, CLI login, model access, dependency installation, telemetry parity, or manual confirmation.',
    category: 'observability',
    cli: 'pd fleet models',
    href: '/docs/features/fleet',
    image: {
      src: '/img/generated/control-plane-hero.webp',
      alt: 'Generated control-plane diagram with readiness and routing lanes',
    },
    detail: 'Backend readiness turns model configuration into a checklist. It should show missing API keys, CLI auth, SDK packages, local model availability, telemetry gaps, and launch blockers before an agent spends money or fails midway.',
    outcomes: [
      'Know which backends are launchable and which are only configured on paper.',
      'Avoid silent expensive model upgrades or opaque telemetry failures.',
      'Make readiness visible in setup, FleetBar, and Fleet Control Center.',
    ],
    links: [
      { label: 'Fleet readiness', href: '/docs/features/fleet' },
      { label: 'MCP setup', href: '/mcp' },
    ],
    status: 'new'
  },
  {
    id: 'agent-radio',
    title: 'Agent communication',
    description: 'Notes, scoped channels, actor inboxes, claims, tuples, and salvage records give agents durable ways to talk without sharing one chat window.',
    category: 'coordination',
    cli: 'pd note "handoff ready"',
    href: '/docs/features/radio',
    image: {
      src: '/img/generated/agent-runtime-map.webp',
      alt: 'Generated map of agents exchanging claims, notes, and handoffs',
    },
    detail: 'Agent communication is the difference between parallel agents and a pile of untracked edits. Notes, scoped radio channels, actor inboxes, tuples, claims, and salvage records create durable context other agents can read without interrupting the human.',
    outcomes: [
      'Give agents a shared memory trail that survives process exits and branch drift.',
      'Publish machine-readable coordination facts instead of relying on chat prose.',
      'Route warnings to durable actors such as Coxswain, Navigator, Lookout, and Quartermaster.',
    ],
    links: [
      { label: 'Radio messaging', href: '/docs/features/radio' },
      { label: 'Multi-agent tutorial', href: '/tutorials/multi-agent' },
    ],
    status: 'core'
  },
  {
    id: 'shared-coordination',
    title: 'Enforced coordination',
    description: 'Sessions, notes, file claims, locks, tuples, inboxes, activity, salvage, and Coordination Guard make repo work attributable before code reaches a commit.',
    category: 'coordination',
    cli: 'pd begin "purpose" --lifecycle durable',
    href: '/tutorials/multi-agent',
    image: {
      src: '/img/generated/coordination-guard.webp',
      alt: 'Generated coordination guard diagram showing claims and locks',
    },
    detail: 'Enforced coordination makes collaboration concrete. Sessions establish identity, file claims show edit intent, locks protect scarce resources, notes explain decisions, and activity records make handoffs auditable before code reaches a commit.',
    outcomes: [
      'Prevent invisible overlap by making claims and sessions visible.',
      'Use locks only for scarce resources while keeping normal edits mergeable.',
      'Recover who touched what, why, and what evidence they left behind.',
    ],
    links: [
      { label: 'Multi-agent tutorial', href: '/tutorials/multi-agent' },
      { label: 'Sessions docs', href: '/docs/features/sessions' },
    ],
    status: 'core'
  },
  {
    id: 'coordination-guard',
    title: 'Coordination Guard',
    description: 'Install a local pre-commit guard that checks staged files against the current session and active claims, then blocks uncoordinated commits when enforcement is on.',
    category: 'coordination',
    cli: 'pd guard install --mode enforce',
    href: '/docs/best-practices',
    image: {
      src: '/img/generated/coordination-guard.webp',
      alt: 'Generated guard rails around coordinated file claims',
    },
    detail: 'Coordination Guard is the commit-boundary enforcement layer. It checks staged files against the active Port Daddy session and claims so “I forgot to coordinate” becomes a blocked commit, not a postmortem.',
    outcomes: [
      'Catch unclaimed staged files before they enter history.',
      'Make the shell prove it has an active session when enforcement is enabled.',
      'Turn a cultural convention into a local guardrail agents cannot casually skip.',
    ],
    links: [
      { label: 'Best practices', href: '/docs/best-practices' },
      { label: 'Begin command', href: '/docs/cli/begin' },
    ],
    status: 'new'
  },
  {
    id: 'pd-tube',
    title: 'PD Tube',
    description: 'A conversational pipe over Port Daddy channels. Listen, send, reply, resume from cursors, and bridge agent handoffs through block-once prose or JSON output.',
    category: 'coordination',
    cli: 'pd tube <channel> --send',
    href: '/tutorials/pd-tube',
    image: {
      src: '/img/generated/agent-runtime-map.webp',
      alt: 'Generated agent runtime map with channel-backed handoffs',
    },
    detail: 'PD Tube turns a Port Daddy channel into an operator-visible conversation lane. Scripts can send and reply from stdin, agents can listen as a block-once handoff or JSON lines, and demos can prove the same history later.',
    outcomes: [
      'Send durable agent handoffs without inventing a new hosted webhook bridge.',
      'Thread replies by message id so browser buttons, tests, and agents can share one trail.',
      'Use `--once`, `--json`, and `--since` to make automation deterministic.',
    ],
    links: [
      { label: 'PD Tube tutorial', href: '/tutorials/pd-tube' },
      { label: 'Tube command', href: '/docs/cli/tube' },
    ],
    status: 'new'
  },
  {
    id: 'relay-pki',
    title: 'Relay PKI',
    description: 'OIDC-first relay identity with admin-approved local Web-of-Trust fallback. The relay routes ciphertext while daemon fingerprints stay auditable.',
    category: 'security',
    cli: 'python skills/pd-relay-zero-trust/scripts/pki_decision.py',
    href: '/docs/features/relay-pki',
    image: {
      src: '/img/generated/control-plane-og.webp',
      alt: 'Generated control-plane diagram showing verified relay identity',
    },
    detail: 'Relay PKI keeps remote coordination honest: managed bootstrap is OIDC-first, ACME remains a proof method, Web-of-Trust is local/admin-approved, and the relay never becomes the plaintext transport.',
    outcomes: [
      'Keep managed relay identity fail-closed instead of accepting self-attested fingerprints.',
      'Preserve ACME and local WoT as explicit proof modes with narrower trust boundaries.',
      'Separate relay identity metadata from end-to-end payload secrecy.',
    ],
    links: [
      { label: 'Relay PKI docs', href: '/docs/features/relay-pki' },
      { label: 'Whitepaper', href: '/whitepaper' },
    ],
    status: 'preview'
  },
  {
    id: 'harbors',
    title: 'Harbors and signed access',
    description: 'Named work boundaries, note encryption, Ed25519 harbor-card verification, and proof-backed security work sit underneath the local daemon.',
    category: 'security',
    cli: 'pd harbor create <name>',
    href: '/docs/features/harbors',
    image: {
      src: '/img/generated/harbors-signed-access.webp',
      alt: 'Swiss-modern security architecture diagram for scoped agent authority and signed access',
    },
    detail: 'Harbors are named boundaries for agent work. The security story is concrete: capability namespaces, note encryption, Ed25519 harbor-card verification, and proof-backed analysis sit underneath the daemon.',
    outcomes: [
      'Give risky agent work a scoped permission boundary.',
      'Separate everyday coordination from scoped access.',
      'Point security-minded users to the verification work and whitepaper.',
    ],
    links: [
      { label: 'Harbors docs', href: '/docs/features/harbors' },
      { label: 'Whitepaper', href: '/whitepaper' },
    ],
    status: 'new'
  },
  {
    id: 'self-healing',
    title: 'Session salvage',
    description: 'When an agent crashes, its session notes, file claims, and work context survive. A new agent can claim the abandoned work and continue.',
    category: 'observability',
    cli: 'pd salvage',
    href: '/docs/features/salvage',
    image: {
      src: '/img/generated/salvage-ledger.webp',
      alt: 'Generated salvage ledger showing recoverable agent context',
    },
    detail: 'Session salvage is how Port Daddy keeps agent failures from becoming lost work. When an agent dies, its session notes, claims, purpose, and context remain claimable by the next worker.',
    outcomes: [
      'Recover abandoned context instead of asking the human to reconstruct it.',
      'See which sessions died with open claims or incomplete handoffs.',
      'Turn crash recovery into an explicit queue with ownership.',
    ],
    links: [
      { label: 'Salvage docs', href: '/docs/features/salvage' },
      { label: 'Salvage command', href: '/docs/cli/salvage' },
    ],
    status: 'core'
  }
] satisfies Feature[];

export const MAC_APP_CAPABILITIES = [
  {
    id: 'menu-bar',
    label: '01',
    title: 'Native Mac entrance',
    description: 'FleetBar lives in the menu bar, follows the main daemon, shows daemon and fleet health, and opens the full console without making the developer remember a local URL.',
    proof: 'Installed by pd setup on macOS and backed by the same daemon-served /fleet-ui bundle as the browser console.',
  },
  {
    id: 'console',
    label: '02',
    title: 'One console, many views',
    description: 'Flow, Roadmap, Agents, Resources, Activity, Channels, Inbox, Spawned Runs, Memory, Shipwright, and YAML are top-level pages instead of hidden side panels.',
    proof: 'FleetBar embeds the same Fleet Control Center with ?embed=fleetbar so native chrome and web chrome stay aligned.',
  },
  {
    id: 'coordination',
    label: '03',
    title: 'Agent coordination you can inspect',
    description: 'Sessions, claims, locks, tuples, inboxes, notes, handoffs, activity, and salvage appear in the UI, not only in terminal scrollback.',
    proof: 'Activity filtering uses structured agent and project identity before falling back to text matching.',
  },
  {
    id: 'governance',
    label: '04',
    title: 'Budget and resource controls',
    description: 'Projects can set daily fleet budgets, review spawn readiness, and watch machine pressure before adding more background work.',
    proof: 'Resource controls are observe-mode today; launch preflight and budget gates fail closed when required telemetry is missing.',
  },
] satisfies MacAppCapability[];

export const APP_SURFACES = [
  {
    id: 'fleet-flow',
    title: 'Flow',
    caption: 'The command center for one project: live agents, backend readiness, budget pressure, current claims, and the controls that decide whether more work should launch.',
    operatorValue: 'Use Flow when you need the fastest answer to: what is running, what is blocked, and is it safe to start another agent?',
    highlights: [
      'Backend cards show which providers are actually launchable before a mission starts.',
      'Live agent cards keep role, model, touched files, and latest signals on one screen.',
      'Budget and guard controls make coordination state visible before a commit or spawned run.',
    ],
    actions: [
      'Check whether Claude, Codex, Gemini, Ollama, or local tools are actually ready.',
      'See which agents are active, which files they touched, and whether they are stale.',
      'Start coordinated work only after budget, backend, and guard state look sane.',
      'Jump from one project into the exact fleet view FleetBar embeds.',
    ],
    surface: 'Fleet Control Center',
  },
  {
    id: 'agents',
    title: 'Agents',
    caption: 'A roster for durable actors and one-off jobs, with their model choices, latest work, touched files, and handoffs visible together instead of scattered across terminal tabs.',
    operatorValue: 'Use Agents to understand who owns what, which role should receive the next handoff, and whether an agent is configured, active, stale, or just a completed job.',
    highlights: [
      'Durable roles such as Coxswain and Lookout stay named across sessions.',
      'Ad hoc jobs and configured fleet agents appear in the same view.',
      'Touched files and recent messages make agent work inspectable without reading logs first.',
    ],
    actions: [
      'Find the role that owns a handoff, blocker, docs drift, or budget concern.',
      'Compare configured fleet agents with one-off delegated jobs.',
      'Inspect recent messages, files, and status before trusting an agent result.',
      'Route follow-up work to a durable actor instead of reopening the whole context.',
    ],
    surface: 'Fleet Control Center',
  },
  {
    id: 'roadmap',
    title: 'Roadmap',
    caption: 'A live roadmap board that ties built, blocked, drifting, and next-up work to recovery notes, docs drift, and dogfood evidence.',
    operatorValue: 'Use Roadmap when another agent returns and needs the current state, not a stale plan copied from chat.',
    highlights: [
      'Built items point back to evidence and recovery notes.',
      'Blocked items keep the exact release gate or missing dependency in view.',
      'Next-up work stays connected to the current app view that needs attention.',
    ],
    actions: [
      'Recover the current plan after a long agent session or crash.',
      'See what shipped, what is blocked, and what evidence proves it.',
      'Keep docs, recovery notes, and product status from drifting apart.',
      'Give a new agent a reliable starting point without rereading every chat.',
    ],
    surface: 'Fleet Control Center',
  },
  {
    id: 'resources',
    title: 'Resources',
    caption: 'A pressure dashboard for memory, disk, renderer load, local AI, the Port Daddy process, fleet activity, and spend signals.',
    operatorValue: 'Use Resources before launching more background work or when the Mac app feels slow and you need to know whether the daemon, renderer, or local model stack is under pressure.',
    highlights: [
      'Machine pressure and spend sit beside backend readiness.',
      'Renderer and daemon signals separate app UI load from runtime load.',
      'Resource context gives launch preflight a real ceiling instead of a vibes check.',
    ],
    actions: [
      'Check memory, disk, renderer, daemon, and local AI pressure before launching more work.',
      'Understand whether slowness is the Mac app, daemon, model stack, or fleet load.',
      'Review budget pressure before spawning another background task.',
      'Use resource state as part of launch preflight instead of guessing.',
    ],
    surface: 'Fleet Control Center',
  },
  {
    id: 'activity',
    title: 'Activity',
    caption: 'The project audit trail: session starts, notes, file claims, releases, handoffs, mutations, spawned completions, and fleet events in one time-ordered feed.',
    operatorValue: 'Use Activity when you need to reconstruct what changed, who touched it, and which handoff or claim explains the current state.',
    highlights: [
      'Structured events preserve agent id and project identity.',
      'File claims and session notes become visible evidence, not terminal residue.',
      'Handoffs and spawned completions remain discoverable after the original chat is gone.',
    ],
    actions: [
      'Reconstruct who changed what and why across several agents.',
      'Find session notes, claims, releases, handoffs, and completions in time order.',
      'Audit the project without relying on terminal scrollback.',
      'Spot stale or contradictory coordination signals before they become bad commits.',
    ],
    surface: 'Fleet Control Center',
  },
  {
    id: 'channels',
    title: 'Channels',
    caption: 'The agent radio room: scoped publish/subscribe channels with both the human-readable topic and the project-resolved physical channel.',
    operatorValue: 'Use Channels to see how agents talk across sessions, which signals wake downstream work, and whether a message is project-scoped or intentionally global.',
    highlights: [
      'Readable topics like git:committed stay mapped to physical scoped channels.',
      'Coordination channels make agent-to-agent messages inspectable by humans.',
      'Inconsistency channels separate important conflicts from normal progress notes.',
    ],
    actions: [
      'Watch the channels agents use to leave signals for each other.',
      'See the human topic and the project-scoped physical channel together.',
      'Separate normal progress broadcasts from important inconsistency reports.',
      'Debug why a downstream watcher, fleet trigger, or handoff did or did not fire.',
    ],
    surface: 'Fleet Control Center',
  },
  {
    id: 'inbox',
    title: 'Inbox',
    caption: 'Durable direct messages for actors, handoffs, unread work, proof requests, and role-owned follow-up across sessions.',
    operatorValue: 'Use Inbox when one agent needs another role to act later and the handoff must survive context loss, daemon restarts, and chat windows closing.',
    highlights: [
      'Unread handoffs stay attached to the role that should own them.',
      'Direct actor messages give agents a place to coordinate without sharing one prompt.',
      'Proof requests can be routed to a reviewer instead of buried in a note stream.',
    ],
    actions: [
      'Send a durable handoff to a role that may not be running right now.',
      'Track unread proof requests, status pings, and follow-up work.',
      'Keep agent-to-agent communication visible without merging every agent into one chat.',
      'Resume a thread of work after context loss, restart, or a new model session.',
    ],
    surface: 'Fleet Control Center',
  },
  {
    id: 'spawned-runs',
    title: 'Spawned Runs',
    caption: 'Spawned launches with backend/model preflight, budget ceilings, generated briefs, transcripts, result summaries, and durable run history.',
    operatorValue: 'Use Spawned Runs when a bounded task deserves evidence: you can inspect the brief, budget, backend, and result after the run.',
    highlights: [
      'Preflight checks backend readiness and budget before launch.',
      'Generated briefs make the mission goal explicit before the agent starts.',
      'Run history preserves logs and outcomes for later audit or salvage.',
    ],
    actions: [
      'Launch a bounded mission with an explicit recipe, backend, model, and budget.',
      'Read the generated brief before any agent starts writing files.',
      'Inspect logs, result summaries, and durable run history after completion.',
      'Turn a vague delegation into a tracked operation the team can audit later.',
    ],
    surface: 'Fleet Control Center',
  },
  {
    id: 'memory',
    title: 'Memory',
    caption: 'Recovered session context, notes, tuples, semantic joins, salvage trails, and current anchors for agents that need to resume real work.',
    operatorValue: 'Use Memory when context is fractured and the next agent needs durable repo context, not a guess reconstructed from filenames.',
    highlights: [
      'Salvage trails expose what a dead or stale agent left behind.',
      'Tuples and notes make machine-readable coordination state visible.',
      'Session anchors help a new agent continue the same work without starting over.',
    ],
    actions: [
      'Recover abandoned context from a dead or interrupted agent.',
      'Find notes, tuples, session anchors, and semantic joins in one place.',
      'Continue work from durable project memory instead of inventing a new plan.',
      'Show the next agent what is true before it edits anything.',
    ],
    surface: 'Fleet Control Center',
  },
  {
    id: 'yaml',
    title: 'YAML',
    caption: 'The editable fleet file: agents, triggers, schedules, singleton rules, budgets, backend/model choices, and channel wiring as reviewable project configuration.',
    operatorValue: 'Use YAML when you want to see exactly what the daemon will run and keep the UI’s fleet state tied to a file that can be reviewed and committed.',
    highlights: [
      'Agent definitions stay reviewable in source control.',
      'Triggers, schedules, and singleton rules explain why work starts.',
      'Budgets and model choices become explicit configuration instead of hidden launch flags.',
    ],
    actions: [
      'Review the exact fleet configuration the daemon will run.',
      'Edit agents, triggers, schedules, singleton rules, budgets, and model choices.',
      'Connect UI fleet state back to source-controlled project configuration.',
      'Explain why an agent starts without spelunking through launch flags.',
    ],
    surface: 'Fleet Control Center',
  },
  {
    id: 'shipwright-harbor',
    title: 'Shipwright Harbor',
    caption: 'The cold-start intake: discovered repos, app type, tests, docs state, delivery target, and existing Port Daddy wiring become a candidate fleet proposal.',
    operatorValue: 'Use Shipwright Harbor when adding a new project and you want the app to ask the right questions before proposing agents.',
    highlights: [
      'Repo survey turns project facts into launch constraints.',
      'Missing keys, tests, docs, and delivery gaps are shown before activation.',
      'The proposal starts from actual project shape instead of a generic template.',
    ],
    actions: [
      'Add a new coding project without hand-writing the first fleet file.',
      'Let Shipwright inspect repo shape, tests, docs state, and delivery target.',
      'Expose missing keys, missing tests, and readiness gaps before activation.',
      'Start from a proposal grounded in the actual app, not a boilerplate template.',
    ],
    surface: 'Shipwright',
  },
  {
    id: 'shipwright-focus',
    title: 'Shipwright Focus',
    caption: 'A focused proposal page for the starter fleet: rationale, agent roles, model tiers, budget envelope, risk notes, and what each role is expected to own.',
    operatorValue: 'Use Shipwright Focus to edit the plan before it becomes a live fleet, especially when the default roles need project-specific responsibility.',
    highlights: [
      'Agent roles are explained before they are written into YAML.',
      'Model and budget choices are visible before any backend spends money.',
      'Risk notes make coordination hazards part of the launch decision.',
    ],
    actions: [
      'Review why each proposed agent exists and what it should own.',
      'Adjust model tier, budget envelope, and role scope before launch.',
      'Catch overlapping responsibilities while the fleet is still a draft.',
      'Turn a repo survey into a starter team a developer can understand.',
    ],
    surface: 'Shipwright',
  },
  {
    id: 'shipwright-simulation',
    title: 'Shipwright Simulation',
    caption: 'A rehearsal pass for the proposed fleet: backend readiness, resource pressure, daily spend, dependency gaps, launch count, and coordination risk before activation.',
    operatorValue: 'Use Shipwright Simulation when you want the app to fail closed before spawning agents that cannot run cleanly.',
    highlights: [
      'Backend readiness checks keys, CLI login, SDK dependencies, and model availability.',
      'Budget and resource pressure show whether the Mac can safely take more work.',
      'Coordination risk catches overlapping roles and missing ownership before launch.',
    ],
    actions: [
      'Dry-run the proposed fleet against backend readiness and missing credentials.',
      'Check budget, resource pressure, and expected launch count before spending.',
      'Fail closed when required telemetry or dependencies are missing.',
      'Decide whether to activate, revise, or shrink the fleet before it touches files.',
    ],
    surface: 'Shipwright',
  },
  {
    id: 'shipwright-control',
    title: 'Shipwright Control',
    caption: 'The handoff from design to operation: FleetControl summarizes the envelope, writes the starter configuration, and links back to Flow, Agents, Resources, and YAML.',
    operatorValue: 'Use Shipwright Control when the proposal is good enough to operate and you need a clean path from plan to running fleet.',
    highlights: [
      'The proposed fleet becomes concrete YAML and UI state.',
      'Flow and Agents receive the newly configured roles immediately.',
      'Resources and readiness stay connected so launch decisions remain accountable.',
    ],
    actions: [
      'Apply the approved starter fleet and write the configuration.',
      'Move directly into Flow, Agents, Resources, or YAML after activation.',
      'Keep launch readiness connected to the fleet you just designed.',
      'Turn cold-start planning into a running, inspectable project dashboard.',
    ],
    surface: 'Shipwright',
  },
] satisfies AppSurface[];

export const COLD_START_STEPS = [
  {
    id: 'install',
    title: 'Install the local app',
    description: 'Install the daemon, MCP wiring, FleetBar, and project markers with one command. FleetBar becomes the Mac entrance, and the daemon keeps shared state in one place.',
    command: 'brew install curiositech/tap/port-daddy\npd setup --project ~/coding/my-app',
    appSurface: 'FleetBar opens the daemon-served Fleet Control Center.',
  },
  {
    id: 'keys',
    title: 'Verify backend keys and auth',
    description: 'The app shows missing ANTHROPIC_API_KEY, GEMINI_API_KEY, Cloudflare credentials, CLI login checks, local Ollama reachability, and telemetry-policy blockers before a launch can surprise you.',
    command: "printf '\\nANTHROPIC_API_KEY=sk-ant-...\\n' >> ~/.port-daddy-env\npd daemon restart",
    appSurface: 'All Projects shows backend readiness and copyable setup commands.',
  },
  {
    id: 'survey',
    title: 'Let Shipwright survey the repo',
    description: 'Shipwright classifies the stack, active files, delivery medium, fleet status, tests, docs freshness, and resource pressure before recommending agents.',
    command: 'open "$(cat ~/.port-daddy/daemon.port 2>/dev/null | sed \'s#^#http://localhost:#\')/fleet-ui/?surface=shipwright"',
    appSurface: 'Shipwright Harbor and Focus turn repo facts into a proposal.',
  },
  {
    id: 'simulate',
    title: 'Simulate before spending',
    description: 'The proposed fleet gets a budget envelope, bond ceiling, concurrency limit, dry-run timeline, and intervention events before anything writes project files.',
    appSurface: 'Shipwright FleetControl links directly back to Flow, Agents, and YAML.',
  },
  {
    id: 'operate',
    title: 'Operate from the Fleet view',
    description: 'Start the fleet, inspect agents, spawn bounded work, read activity, tune YAML, and watch resources from the same console the Mac app embeds.',
    command: 'pd fleet up\npd begin "first coordinated change" --lifecycle durable',
    appSurface: 'Flow, Agents, Spawned Runs, Resources, and Activity stay connected by project identity.',
  },
] satisfies ColdStartStep[];

export const DISTRIBUTION_OPTIONS = [
  {
    id: 'mac-binary',
    title: 'FleetBar for Mac',
    description: 'The Mac app that pd setup installs for daemon health and project readiness.',
    command: 'pd setup',
    status: 'mac-app',
  },
  {
    id: 'brew',
    title: 'Homebrew + setup',
    description: 'Install Port Daddy, then run setup to add FleetBar, MCP, hooks, skills, and project markers.',
    command: 'brew install curiositech/tap/port-daddy\npd setup',
    status: 'available',
  },
] satisfies DistributionOption[];
