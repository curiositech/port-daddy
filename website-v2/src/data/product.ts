export interface Feature {
  id: string;
  title: string;
  description: string;
  category: 'ports' | 'coordination' | 'security' | 'observability' | 'agents' | 'intelligence' | 'control-plane' | 'resources';
  cli: string;
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
  status: 'available' | 'developer-preview' | 'release-channel';
}

export const PRODUCT_FEATURES = [
  {
    id: 'fleetbar',
    title: 'FleetBar for macOS',
    description: 'A native menu-bar control plane that opens the real Fleet Control Center, shows daemon health, starts and stops fleets, and keeps the selected project one click away.',
    category: 'control-plane',
    cli: 'pd setup',
    status: 'new'
  },
  {
    id: 'fleet-control',
    title: 'Fleet Control Center',
    description: 'The console for Flow, Roadmap, Agents, Resources, Activity, Channels, Inbox, Sorties, Memory, Shipwright, and YAML. It is served by the daemon and embedded by FleetBar.',
    category: 'control-plane',
    cli: 'pd fleet status',
    status: 'new'
  },
  {
    id: 'shipwright',
    title: 'Shipwright cold start',
    description: 'Survey a repo, propose a starter fleet, simulate budget and bond exposure, then move into Flow, Agents, and YAML without leaving the control plane.',
    category: 'agents',
    cli: 'pd setup --project <dir>',
    status: 'preview'
  },
  {
    id: 'sorties',
    title: 'Sortie missions',
    description: 'Launch a tracked delegated mission with a durable id, goal, recipe, backend/model, budget ceiling, logs, and a result surface operators can inspect later.',
    category: 'agents',
    cli: 'pd sortie run --backend codex',
    status: 'new'
  },
  {
    id: 'resource-governance',
    title: 'Resource governance',
    description: 'Inspect memory, disk, Port Daddy process cost, local model pressure, renderer load, fleet activity, daily spend, and the suggested concurrency envelope.',
    category: 'resources',
    cli: 'pd status',
    status: 'new'
  },
  {
    id: 'backend-readiness',
    title: 'Backend readiness',
    description: 'Operator-facing readiness tells you which backends need API keys, CLI login, model access, dependency installation, telemetry parity, or manual confirmation.',
    category: 'observability',
    cli: 'pd fleet models',
    status: 'new'
  },
  {
    id: 'agent-radio',
    title: 'Agent communication substrate',
    description: 'Notes, scoped channels, actor inboxes, claims, tuples, and salvage records give agents durable ways to talk without sharing one chat window.',
    category: 'coordination',
    cli: 'pd note "handoff ready"',
    status: 'core'
  },
  {
    id: 'shared-coordination',
    title: 'Enforced coordination',
    description: 'Sessions, notes, file claims, locks, tuples, inboxes, activity, salvage, and Coordination Guard make repo work attributable before code reaches a commit.',
    category: 'coordination',
    cli: 'pd begin "purpose"',
    status: 'core'
  },
  {
    id: 'coordination-guard',
    title: 'Coordination Guard',
    description: 'Install a local pre-commit guard that checks staged files against the current session and active claims, then blocks uncoordinated commits when enforcement is on.',
    category: 'coordination',
    cli: 'pd guard install --mode enforce',
    status: 'new'
  },
  {
    id: 'harbors',
    title: 'Harbors and verified core',
    description: 'Named authority boundaries, note encryption, Ed25519 harbor-card verification, and proof-backed protocol work sit underneath the local daemon.',
    category: 'security',
    cli: 'pd harbor create <name>',
    status: 'new'
  },
  {
    id: 'self-healing',
    title: 'Session salvage',
    description: 'When an agent crashes, its session notes, file claims, and work context survive. A new agent can claim the abandoned work and continue.',
    category: 'observability',
    cli: 'pd salvage',
    status: 'core'
  }
] satisfies Feature[];

export const MAC_APP_CAPABILITIES = [
  {
    id: 'menu-bar',
    label: '01',
    title: 'Native Mac entrance',
    description: 'FleetBar lives in the menu bar, follows the canonical daemon, shows daemon and fleet health, and opens the full console without making the developer remember a local URL.',
    proof: 'Installed by pd setup on macOS and backed by the same daemon-served /fleet-ui bundle as the browser console.',
  },
  {
    id: 'console',
    label: '02',
    title: 'One console, many operator surfaces',
    description: 'Flow, Roadmap, Agents, Resources, Activity, Channels, Inbox, Sorties, Memory, Shipwright, and YAML are top-level pages instead of hidden side panels.',
    proof: 'FleetBar embeds the same Fleet Control Center surface with ?embed=fleetbar so native chrome and web chrome stay aligned.',
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
    title: 'Budget and resource governance',
    description: 'Projects can set daily fleet budgets, review spawn readiness, and watch machine pressure before adding more background work.',
    proof: 'Resource governance is observe-mode today; launch preflight and budget gates fail closed when required telemetry is missing.',
  },
] satisfies MacAppCapability[];

export const APP_SURFACES = [
  {
    id: 'fleet-flow',
    title: 'Fleet view',
    caption: 'Flow, backend roster, live agent cards, project budget, and coordination guard controls in one operator view.',
    surface: 'Fleet Control Center',
  },
  {
    id: 'resources',
    title: 'Resources',
    caption: 'Memory, disk, renderer, local AI, Port Daddy process, fleet pressure, and spend signals share the same page.',
    surface: 'Fleet Control Center',
  },
  {
    id: 'sorties',
    title: 'Sorties',
    caption: 'Mission recipes, backend/model preflight, budget ceilings, generated brief, logs, and durable run history.',
    surface: 'Fleet Control Center',
  },
  {
    id: 'shipwright-harbor',
    title: 'Shipwright Harbor',
    caption: 'Cold-start survey cards turn discovered repos into candidate fleet proposals.',
    surface: 'Shipwright',
  },
  {
    id: 'shipwright-focus',
    title: 'Shipwright Focus',
    caption: 'A proposed fleet includes rationale, agent roles, model choices, budgets, and risk notes before launch.',
    surface: 'Shipwright',
  },
  {
    id: 'shipwright-control',
    title: 'Shipwright Control',
    caption: 'FleetControl summarizes the envelope and then links back to Flow, Agents, and YAML for real operator action.',
    surface: 'Shipwright',
  },
] satisfies AppSurface[];

export const COLD_START_STEPS = [
  {
    id: 'install',
    title: 'Install the local control plane',
    description: 'Install the daemon, MCP wiring, FleetBar, and project markers with one command. FleetBar becomes the Mac entrance; the daemon remains the source of truth.',
    command: 'brew install curiositech/tap/port-daddy\npd setup --project ~/coding/my-app',
    appSurface: 'FleetBar opens the daemon-served Fleet Control Center.',
  },
  {
    id: 'keys',
    title: 'Verify backend keys and auth',
    description: 'The app surfaces missing ANTHROPIC_API_KEY, GEMINI_API_KEY, Cloudflare credentials, CLI login checks, local Ollama reachability, and telemetry-policy blockers before a launch can surprise you.',
    command: "printf '\\nANTHROPIC_API_KEY=sk-ant-...\\n' >> ~/.port-daddy-env\npd daemon restart",
    appSurface: 'All Projects shows backend readiness and copyable setup commands.',
  },
  {
    id: 'survey',
    title: 'Let Shipwright survey the repo',
    description: 'Shipwright classifies the stack, active files, delivery medium, fleet status, tests, docs freshness, and resource pressure before recommending agents.',
    command: 'open "http://127.0.0.1:9876/fleet-ui/?surface=shipwright"',
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
    description: 'Start the fleet, inspect agents, run a sortie, read activity, tune YAML, and watch resources from the same console the Mac app embeds.',
    command: 'pd fleet up\npd begin "first coordinated change"',
    appSurface: 'Flow, Agents, Sorties, Resources, and Activity stay connected by project identity.',
  },
] satisfies ColdStartStep[];

export const DISTRIBUTION_OPTIONS = [
  {
    id: 'mac-binary',
    title: 'Mac developer preview',
    description: 'A zipped FleetBar.app for Apple Silicon developers who want the native menu-bar companion immediately. It is an unsigned preview until the signing channel is complete.',
    command: 'curl -LO https://portdaddy.dev/downloads/PortDaddy-FleetBar-macOS-arm64-dev.zip',
    status: 'developer-preview',
  },
  {
    id: 'brew',
    title: 'Homebrew + setup',
    description: 'The preferred developer path: install the CLI/daemon, then let setup install FleetBar, MCP, launchd ownership, and project initialization.',
    command: 'brew install curiositech/tap/port-daddy\npd setup --project ~/coding/my-app',
    status: 'available',
  },
  {
    id: 'npm',
    title: 'npm package',
    description: 'A Node-native install path for users who want the CLI, daemon, MCP server, and skills through the package registry.',
    command: 'npm install -g port-daddy\npd setup',
    status: 'available',
  },
  {
    id: 'release-artifacts',
    title: 'GitHub release artifacts',
    description: 'Release builds attach standalone CLI tarballs today; the release workflow now has a Mac app packaging path for FleetBar artifacts.',
    command: 'gh release download --repo curiositech/port-daddy --pattern "PortDaddy-FleetBar-*.zip"',
    status: 'release-channel',
  },
] satisfies DistributionOption[];
