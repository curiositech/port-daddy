import { useState, type ReactNode } from 'react'
import { Link, Navigate, NavLink, useParams } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  BookOpen,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  Code2,
  Compass,
  Copy,
  Database,
  FileCheck2,
  FileLock2,
  FileText,
  GitBranch,
  Hammer,
  Lightbulb,
  Map,
  Route,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import fleetYaml from '../../../pd-fleet.yml?raw'
import { Button } from '@/components/ui/Button'
import {
  BracketLabel,
  BracketLink,
  DocsCodeBlock,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
  SwissGrid,
  SwissGridItem,
} from '@/components/site/primitives'
import { RoleTerm } from '@/components/site/RoleTerm'
import { useTheme } from '@/lib/theme-context'

type ThemedImage = string | {
  light: string
  dark: string
}

type Concept = {
  label: string
  title: string
  body: string
  icon: LucideIcon
  tone: 'paper' | 'blue' | 'accent'
}

type ActorRole = {
  name: string
  roleKey: string
  label: string
  body: string
  icon: LucideIcon
}

type FleetAgent = {
  name: string
  roleKey: string
  wakes: string
  work: string
  runtime: string
  image: string
  magic: string
  icon: LucideIcon
}

type OneOff = {
  title: string
  roleKey?: string
  label: string
  body: string
  command: string
  icon: LucideIcon
}

type TemplatePack = {
  title: string
  label: string
  path: string
  body: string
  command: string
  tags: string[]
  icon: LucideIcon
}

type AgentSection = {
  slug: string
  nav: string
  title: string
  eyebrow: string
  summary: string
  image: ThemedImage
  gif: string
  alt: string
  codeLabel: string
  code: string
  theory?: string[]
  bullets: string[]
  screenshots?: Array<{
    label: string
    title: string
    href: string
    image: ThemedImage
    body: string
  }>
  builds?: Array<{
    label: string
    href: string
    body: string
  }>
  templatePacks?: TemplatePack[]
  docs: Array<{
    label: string
    href: string
    body: string
  }>
}

const CONCEPTS: Concept[] = [
  {
    label: 'YAML',
    title: 'The agent contract',
    body: 'Fleet agents are declared in pd-fleet.yml. The file says who wakes, why they wake, what backend they use, and which channels connect them.',
    icon: Code2,
    tone: 'blue',
  },
  {
    label: 'Shipwright',
    title: 'The picker for new repos',
    body: 'Shipwright surveys a repo and helps choose the few agents that are actually useful, instead of dumping every possible role into a new project.',
    icon: Hammer,
    tone: 'accent',
  },
  {
    label: 'Actor',
    title: 'Stable identity',
    body: 'A durable role can have an inbox, history, notes, and ownership even when no model process is currently attached.',
    icon: Boxes,
    tone: 'paper',
  },
  {
    label: 'Body',
    title: 'Temporary runtime',
    body: 'A Claude, Codex, Ollama, Gemini, Aider, or custom process is just the current body for an actor. The body can crash without erasing the work.',
    icon: Activity,
    tone: 'paper',
  },
]

const ACTOR_ROLES: ActorRole[] = [
  {
    name: 'Shipwright',
    roleKey: 'shipwright',
    label: 'Fleet architect',
    body: 'Surveys a repo, proposes a starter fleet, rehearses cost and trigger behavior, then points the operator toward Flow, Agents, Resources, and YAML.',
    icon: Hammer,
  },
  {
    name: 'Navigator / Cartographer',
    roleKey: 'navigator',
    label: 'Roadmap truth',
    body: 'Keeps roadmap, recovery, current work, and product direction aligned with what actually shipped.',
    icon: Map,
  },
  {
    name: 'Coxswain',
    roleKey: 'coxswain',
    label: 'Claims and locks',
    body: 'Watches file claims, symbol ownership, locks, stale assets, and coordination friction before agents collide.',
    icon: FileLock2,
  },
  {
    name: 'Lookout / Documentarian',
    roleKey: 'lookout',
    label: 'Product truth',
    body: 'Finds drift across docs, OpenAPI, CLI help, skills, website copy, and the live control plane.',
    icon: BookOpen,
  },
  {
    name: 'Quartermaster',
    roleKey: 'quartermaster',
    label: 'Budgets and backends',
    body: 'Owns spend ceilings, model tiers, backend readiness, spawn pressure, and resource policy.',
    icon: Wallet,
  },
  {
    name: 'Signalman / QA',
    roleKey: 'signalman',
    label: 'Evidence and validation',
    body: 'Tracks tests, validation proof, teardown warnings, and whether findings are actionable.',
    icon: FileCheck2,
  },
  {
    name: 'Harbormaster',
    roleKey: 'harbormaster',
    label: 'Runtime truth',
    body: 'Checks promotion readiness, daemon freshness, stable checkout cleanliness, and live provenance.',
    icon: ShieldCheck,
  },
  {
    name: 'Sounder',
    roleKey: 'sounder',
    label: 'Memory and tuples',
    body: 'Maintains tuple-first coordination, graph edges, episodic memory, and semantic joins.',
    icon: Database,
  },
]

const FLEET_AGENTS: FleetAgent[] = [
  {
    name: 'gardener',
    roleKey: 'gardener',
    wakes: 'every 10 min',
    work: 'Reports clean or dirty git status so the rest of the fleet knows the ground truth.',
    runtime: 'custom shell',
    image: '/img/agents/health-monitor.png',
    magic: 'It turns "is the repo clean?" into a shared signal instead of a repeated question.',
    icon: GitBranch,
  },
  {
    name: 'qa',
    roleKey: 'qa',
    wakes: 'git:committed',
    work: 'Reviews the commit and hunts for real bugs, weak tests, missing negative paths, and coverage theater.',
    runtime: 'Ollama',
    image: '/img/agents/qa.png',
    magic: 'It reacts to commits, but it also knows when to back off through cooldown and singleton rules.',
    icon: CheckCircle2,
  },
  {
    name: 'test-hunter',
    roleKey: 'test-hunter',
    wakes: 'git:committed',
    work: 'Adds meaningful tests for low-coverage paths and proves they fail against no-op code.',
    runtime: 'Codex mini',
    image: '/img/agents/session-reaper.png',
    magic: 'It treats tests as product evidence, not percentage theater.',
    icon: FileCheck2,
  },
  {
    name: 'documentarian',
    roleKey: 'documentarian',
    wakes: 'promotion gate',
    work: 'Syncs README, docs, SDK, OpenAPI, website, and the Port Daddy skill after a candidate is release-ready.',
    runtime: 'Ollama',
    image: '/img/agents/documentarian.png',
    magic: 'It wakes at the release moment, when docs drift is easiest to catch.',
    icon: FileText,
  },
  {
    name: 'simplifier',
    roleKey: 'simplifier',
    wakes: 'git:committed',
    work: 'Removes needless complexity without changing behavior, then verifies the patch.',
    runtime: 'Codex mini',
    image: '/img/agents/dep-watcher.png',
    magic: 'It keeps the repo from accumulating cleverness after every feature lands.',
    icon: Wrench,
  },
  {
    name: 'cartographer',
    roleKey: 'cartographer',
    wakes: 'every 30 min',
    work: 'Updates roadmap state, harvests dogfood feedback, and marks what is built, blocked, or drifting.',
    runtime: 'Codex mini',
    image: '/img/agents/cartographer.png',
    magic: 'It keeps the map honest even when several agents are shipping in parallel.',
    icon: Compass,
  },
  {
    name: 'spark',
    roleKey: 'spark',
    wakes: 'every 30 min',
    work: 'Proposes one concrete improvement only after deduping against the idea trove.',
    runtime: 'Ollama',
    image: '/img/agents/spark.png',
    magic: 'It makes ideation durable enough to dedupe instead of becoming chat exhaust.',
    icon: Sparkles,
  },
  {
    name: 'spider',
    roleKey: 'spider',
    wakes: 'spark:idea + 2h',
    work: 'Finds non-obvious connections between existing features and emits scoped implementation sketches.',
    runtime: 'Ollama',
    image: '/img/agents/spider.png',
    magic: 'It combines existing primitives into new capabilities instead of inventing from blank paper.',
    icon: Lightbulb,
  },
]

const ONE_OFFS: OneOff[] = [
  {
    title: 'Sortie',
    roleKey: 'sortie',
    label: 'Tracked mission',
    body: 'Best when you have one explicit goal, a budget ceiling, and want status, logs, result, and residual risk tied to one mission id.',
    command: 'pd sortie run "Investigate flaky auth tests" --backend codex --budget 2',
    icon: Route,
  },
  {
    title: 'pd agent',
    label: 'Ad hoc delegation',
    body: 'Best when you want Port Daddy to open a scoped session, launch one worker, and close the loop without adding a recurring fleet member.',
    command: 'pd agent "Review this branch for launch blockers"',
    icon: Terminal,
  },
  {
    title: 'pd spawn',
    label: 'Low-level launch',
    body: 'Best when you need exact backend, model, tools, timeout, identity, or harbor control and want to own the coordination wrapper yourself.',
    command: 'pd spawn --backend codex --model gpt-5.4-mini -- "Inspect src/auth"',
    icon: Code2,
  },
]

const TEMPLATE_PACKS: TemplatePack[] = [
  {
    title: 'Starter Fleet',
    label: 'YAML starter',
    path: 'templates/pd-fleet-starter.yml',
    body: 'A small checked-in fleet for everyday repo work: health, QA, docs drift, simplification, and idea hygiene without pretending every project needs a giant swarm on day one.',
    command: `cp templates/pd-fleet-starter.yml pd-fleet.yml
pd fleet validate
pd fleet up`,
    tags: ['Fleet YAML', 'QA', 'Docs'],
    icon: GitBranch,
  },
  {
    title: 'Always-On Fleet',
    label: 'Background agents',
    path: 'templates/pd-fleet-always-on.yml',
    body: 'A recurring fleet shape with singleton and cooldown posture for repos that are ready to keep lightweight watchdogs alive across commits, timers, and review gates.',
    command: `cp templates/pd-fleet-always-on.yml pd-fleet.yml
pd fleet validate
pd fleet status`,
    tags: ['Always-on', 'Budgets', 'Cooldown'],
    icon: Activity,
  },
  {
    title: 'Reactive CI Pipeline',
    label: 'Repair loop',
    path: 'templates/ai-ci-pipeline/README.md',
    body: 'A code-change pipeline that turns file events, linter output, failing tests, and debugger launches into a recoverable graph with notes and validation evidence.',
    command: `pd watch code:changed --exec "npm test"
pd spawn --backend codex --model gpt-5.4-mini -- "diagnose the failing test"
pd note "CI repair evidence: command, failure, patch, validation"`,
    tags: ['CI', 'Tests', 'Repair'],
    icon: FileCheck2,
  },
  {
    title: 'Always-On Dispatcher',
    label: 'Kernel agent',
    path: 'templates/always-on-dispatcher/README.md',
    body: 'A long-lived dispatcher pattern for routing build, security, and performance events to the right handler while leaving an audit trail in session notes.',
    command: `pd begin --identity dispatcher:kernel
pd watch build:failed --exec "pd agent 'inspect build failure and leave a note'"
pd notes --limit 10`,
    tags: ['Dispatcher', 'SSE', 'Audit'],
    icon: Route,
  },
  {
    title: 'Event-Driven Ops',
    label: 'SRE swarm',
    path: 'templates/event-driven-ops/README.md',
    body: 'An incident-response pattern with event intake, investigation, operator approval, and scarce-resource locks around production-sensitive actions.',
    command: `pd pub incident:raised '{"severity":"critical","service":"api"}'
pd lock acquire production-change
pd note "Ops decision: investigated, mitigated, validation pending"`,
    tags: ['Ops', 'Locks', 'Incidents'],
    icon: ShieldCheck,
  },
  {
    title: 'Multiplayer Dev Environment',
    label: 'Remote harbors',
    path: 'templates/multiplayer-dev-env/README.md',
    body: 'A shared development topology for multiple machines using harbors, tunnels, DNS-style discovery, and cross-machine coordination without losing local ownership.',
    command: `pd harbor create shared-dev
pd harbor discover
pd tunnel expose web 5173`,
    tags: ['Harbors', 'Tunnels', 'DNS'],
    icon: Compass,
  },
  {
    title: 'Swarm Researcher',
    label: 'Research graph',
    path: 'templates/swarm-researcher/README.md',
    body: 'A search, scrape, and synthesis triad that uses channels for work events, locks for shared stores, and notes for the final claim-backed report trail.',
    command: `pd pub research:start '{"topic":"port-daddy agent coordination"}'
pd lock acquire research-cache
pd note "Research synthesis: sources, open questions, next build"`,
    tags: ['Research', 'Locks', 'Synthesis'],
    icon: Lightbulb,
  },
  {
    title: 'Encrypted Messenger',
    label: 'Secure primitive',
    path: 'templates/encrypted-messenger/messenger.ts',
    body: 'A TypeScript example for secure local message exchange when the thing you are building needs agent-to-agent transport as a real primitive, not a hand-waved chat log.',
    command: `tsx templates/encrypted-messenger/messenger.ts
pd pub secure:message '{"to":"qa","topic":"review-ready"}'`,
    tags: ['Messaging', 'Crypto', 'TypeScript'],
    icon: Database,
  },
]

const FLOW_SCREENSHOT: ThemedImage = {
  light: '/img/app-screens/fleet-flow-light.png',
  dark: '/img/app-screens/fleet-flow.png',
}

const RESOURCES_SCREENSHOT: ThemedImage = {
  light: '/img/app-screens/resources-light.png',
  dark: '/img/app-screens/resources.png',
}

const FLEETBAR_SCREENSHOT: ThemedImage = {
  light: '/img/app-screens/fleetbar-native-shell-light.png',
  dark: '/img/app-screens/fleetbar-native-shell-dark.png',
}

const SHIPWRIGHT_CONTROL_SCREENSHOT: ThemedImage = {
  light: '/img/app-screens/shipwright-control-light.png',
  dark: '/img/app-screens/shipwright-control-dark.png',
}

const SORTIES_SCREENSHOT: ThemedImage = {
  light: '/img/app-screens/sorties-light.png',
  dark: '/img/app-screens/sorties-dark.png',
}

const AGENT_SECTIONS: AgentSection[] = [
  {
    slug: 'flow',
    nav: 'Flow',
    title: 'Flow is the living map of what the fleet is doing.',
    eyebrow: 'Fleet Control Center',
    summary:
      'Flow turns a repo full of agents into one inspectable cockpit: triggers, publishes, agent relationships, budget, guard state, signal value, launch roster, and live chronology on the same screen.',
    image: FLOW_SCREENSHOT,
    gif: '/gifs/agents/event-triggers.gif',
    alt: 'Fleet Control Center Flow view showing the flow map, coordination guard, budget, agents, and live chronology',
    codeLabel: 'Open Flow from a real project',
    code: `pd status
pd briefing
pd fleet status
port=$(cat ~/.port-daddy/daemon.port 2>/dev/null || echo 9876)
open "http://127.0.0.1:$port/fleet-ui/?surface=flow"

# In FleetBar, open the project and choose Flow.
# The view should show the topology before you launch more work.`,
    theory: [
      'Flow is the answer to the question the terminal is bad at: what is actually happening across this repo right now? It puts the graph, the launch controls, budget posture, guard state, agent roster, and recent chronology next to each other so the operator does not have to assemble truth from ten command outputs.',
      'The cool part is that Flow is not just a pretty map. It is an operator cockpit. The left side shows the relationship graph: who publishes, who triggers, which channels connect the fleet, and whether topology looks clean. The right side shows the consequences: stop fleet, refresh, open Agents, inspect YAML, check guard state, adjust the daily cap, and read the live history of sessions, notes, events, and file movement.',
      'That makes Flow the safest first screen before adding more automation. If the graph is tangled, the budget is zero, guard is not installed, or live chronology is noisy, you can see it before another model process starts spending money or touching files.',
      'Use Flow when a repo feels alive and slightly too alive. It gives the whole fleet a shape: channels are no longer invisible strings, recurring agents are no longer background folklore, and recent movement stops being a pile of disconnected logs.',
    ],
    bullets: [
      'Flow connects topology and operator controls instead of hiding them on separate pages.',
      'The graph shows trigger and publish relationships, while the cockpit shows budget, guard, signal value, and launch roster.',
      'Live chronology keeps sessions, notes, events, and file movement visible while the graph explains why agents woke up.',
      'It is the right place to pause the fleet, inspect YAML, jump to Agents, and decide whether more work should launch.',
    ],
    screenshots: [
      {
        label: 'Flow map',
        title: 'Triggers and relationships',
        href: '/mac-preview',
        image: FLOW_SCREENSHOT,
        body: 'The map makes the fleet legible: scheduled agents, channel edges, publish events, and topology cleanliness live in one place.',
      },
      {
        label: 'Operator cockpit',
        title: 'Budget, guard, and signal value',
        href: '/mac-preview',
        image: RESOURCES_SCREENSHOT,
        body: 'Flow keeps the safety posture nearby: daily budget, active controls, Coordination Guard, signal counts, and backend roster are part of launch judgment.',
      },
    ],
    builds: [
      {
        label: 'Fleet tutorial',
        href: '/tutorials/fleet',
        body: 'Build the YAML that becomes the Flow graph and learn when recurring work deserves a trigger.',
      },
      {
        label: 'Watch tutorial',
        href: '/tutorials/watch',
        body: 'Publish and subscribe to the events that Flow turns into visible movement.',
      },
      {
        label: 'Mac Preview',
        href: '/mac-preview',
        body: 'Open the FleetBar and Fleet Control Center story that Flow belongs to.',
      },
    ],
    docs: [
      { label: 'Fleet CLI', href: '/docs/cli/fleet', body: 'Validate, run, pause, and inspect the fleet that appears in Flow.' },
      { label: 'pd pub', href: '/docs/cli/pub', body: 'Publish the events that become visible edges and activity.' },
      { label: 'pd watch', href: '/docs/cli/watch', body: 'Subscribe to project-scoped events without creating wakeup storms.' },
      { label: 'Channels feature', href: '/docs/features/radio', body: 'Understand the pub/sub substrate behind the Flow graph.' },
      { label: 'Time travel', href: '/tutorials/time-travel', body: 'Reconstruct what happened from the same chronology Flow summarizes.' },
    ],
  },
  {
    slug: 'coordination-guard',
    nav: 'Coordination Guard',
    title: 'Coordination Guard makes the good agent behavior enforceable.',
    eyebrow: 'Pre-commit discipline',
    summary:
      'Coordination Guard checks that a committing shell has an active Port Daddy session and matching file claims before staged files cross the line.',
    image: FLOW_SCREENSHOT,
    gif: '/gifs/agents/coordination.gif',
    alt: 'Fleet Control Center showing Coordination Guard in enforce mode beside fleet actions and budget controls',
    codeLabel: 'Guard loop',
    code: `pd begin "patch the route timeout"
pd note "Scope: routes/fleet.ts; validation: focused route tests plus typecheck"
pd session files add routes/fleet.ts
pd guard status
pd guard install --mode enforce
pd guard check --staged`,
    theory: [
      'Coordination Guard exists because "please coordinate" is not a system. Agents forget. Humans rush. Terminals get stale. A pre-commit hook is the narrow place where Port Daddy can ask the one question that matters before code leaves the workstation: does this shell have an active session, and did that session claim the files being committed?',
      'The guard is intentionally boring in the best way. It does not decide architecture. It does not arbitrate product direction. It checks the coordination contract that makes the rest of the fleet believable: begin the session, publish scope, claim the touched files, then commit only the slice you can explain.',
      'In Flow, Guard belongs next to actions and budget because it is launch safety. If guard is disabled, another agent can still do careful work, but the operator has no hard edge preventing mystery commits. If guard is enforcing, the system has a shared expectation that edit intent exists before commit time.',
      'The practical result is less cleanup theater. A guard failure tells the agent exactly what is missing. Start a session, claim the file, narrow the staged set, or leave a note explaining why the slice is not ready. It turns coordination discipline into a visible, repeatable product behavior.',
    ],
    bullets: [
      'Guard checks the staged set, not vague intent.',
      'Enforce mode requires an active session and matching file claims before commit.',
      'It pairs with notes and claims; locks remain reserved for scarce resources like promotion, migrations, or generated artifacts.',
      'Failures are useful product feedback because they say which coordination proof is missing.',
    ],
    screenshots: [
      {
        label: 'Flow cockpit',
        title: 'Guard state before launch',
        href: '/mac-preview',
        image: FLOW_SCREENSHOT,
        body: 'Flow puts guard mode beside stop, refresh, agents, YAML, and budget so enforcement is visible before the fleet moves.',
      },
      {
        label: 'Guard artwork',
        title: 'Policy as a product surface',
        href: '/docs/best-practices/coordination-discipline',
        image: '/img/generated/coordination-guard.webp',
        body: 'The guard is policy in code: session, note, claim, check, commit. It gives the next agent an audit trail instead of a rumor.',
      },
    ],
    builds: [
      {
        label: 'Coordination discipline',
        href: '/docs/best-practices/coordination-discipline',
        body: 'Use the operator loop for notes, claims, locks, staged checks, validation, and handoff evidence.',
      },
      {
        label: 'Claim command',
        href: '/docs/cli/claim',
        body: 'Learn how explicit file ownership becomes the proof Guard checks.',
      },
      {
        label: 'With-lock command',
        href: '/docs/cli/with-lock',
        body: 'Escalate from advisory claims to exclusive locks only when the resource truly needs it.',
      },
    ],
    docs: [
      { label: 'pd begin', href: '/docs/cli/begin', body: 'Create the session Guard expects before editing.' },
      { label: 'pd note', href: '/docs/cli/note', body: 'Leave scope and validation context for other agents.' },
      { label: 'pd with-lock', href: '/docs/cli/with-lock', body: 'Protect non-mergeable work while keeping ordinary edits claim-based.' },
      { label: 'Sessions feature', href: '/docs/features/sessions', body: 'The session and claim model behind guard enforcement.' },
      { label: 'Protocol guide', href: '/docs/guides/protocol', body: 'Choose notes, channels, inboxes, tuples, claims, and locks by lifetime and audience.' },
    ],
  },
  {
    slug: 'smart-resources',
    nav: 'Smart Resources',
    title: 'Smart resource management keeps the fleet from outrunning the Mac.',
    eyebrow: 'Resource governance',
    summary:
      'The Resources surface measures memory, disk, local AI processes, ports, spend, backend readiness, and fleet pressure before Port Daddy asks the operator to raise launch caps.',
    image: RESOURCES_SCREENSHOT,
    gif: '/gifs/agents/daemon-runtime.gif',
    alt: 'Fleet Control Center Resources view showing fleet pressure, memory, disk, networking, local AI, and spend',
    codeLabel: 'Check pressure before spawning',
    code: `pd status
pd fleet status
port=$(cat ~/.port-daddy/daemon.port 2>/dev/null || echo 9876)
curl -sS "http://127.0.0.1:$port/fleet/models"
open "http://127.0.0.1:$port/fleet-ui/?surface=resources"
pd fleet run qa

# Raise caps only after Resources says the machine, budget, and backends can handle it.`,
    theory: [
      'Smart resource management is the difference between a useful fleet and a laptop-shaped space heater. Port Daddy is measuring the things agents actually consume: backend readiness, exact model cost posture, local AI processes, memory, disk, ports, streams, daemon overhead, and the daily cap the operator set for this project.',
      'The important move is advisory first. Resources can say "this computer looks comfortable enough to ask for more" without silently increasing the fleet cap. That preserves operator control while still giving the agent system a real picture of headroom.',
      'This matters because agent coordination is not only file coordination. Two agents can avoid editing the same file and still overload the machine, burn budget, or wake more work than the repo can absorb. Resource pressure is coordination pressure.',
      'In practice, Resources gives Quartermaster a product surface. Launchable agents, suggested cap, backend processes, 24-hour spend, memory free, disk space, daemon overhead, and port pressure all become visible facts that a human and an agent can discuss before expanding the fleet.',
    ],
    bullets: [
      'Resources reports fleet pressure before raising launch caps.',
      'Backend readiness includes dependency and credential checks, not just optimistic configuration.',
      'Budget and resource pressure are part of agent safety, alongside claims and guard checks.',
      'The operator stays in the loop when the system wants more concurrency.',
    ],
    screenshots: [
      {
        label: 'Resources',
        title: 'Fleet pressure',
        href: '/mac-preview',
        image: RESOURCES_SCREENSHOT,
        body: 'The Resources page turns computer health, backend processes, local AI, ports, disk, memory, and spend into one launch-readiness view.',
      },
      {
        label: 'Flow',
        title: 'Budget in context',
        href: '/mac-preview',
        image: FLOW_SCREENSHOT,
        body: 'Flow brings the daily cap and backend roster back into the agent graph so resource decisions stay connected to actual work.',
      },
    ],
    builds: [
      {
        label: 'Backend readiness',
        href: '/blog/backend-readiness-is-dependency-truth',
        body: 'Configure model backends so Port Daddy can fail closed instead of launching opaque spend.',
      },
      {
        label: 'Shipwright cold start',
        href: '/mac-preview',
        body: 'Use Shipwright simulation to rehearse backend readiness, resource pressure, and launch count before activating agents.',
      },
      {
        label: 'Fleet tutorial',
        href: '/tutorials/fleet',
        body: 'Start with a small fleet and raise capacity only when the resource story is true.',
      },
    ],
    docs: [
      { label: 'pd status', href: '/docs/cli/status', body: 'Start from live daemon and fleet truth.' },
      { label: 'Fleet CLI', href: '/docs/cli/fleet', body: 'Inspect launchable agents, status, and recurring work.' },
      { label: 'Spawn command', href: '/docs/cli/spawn', body: 'Understand model/backend choices before launching one-off workers.' },
      { label: 'Reference architectures', href: '/docs/reference-architectures', body: 'Place resource governance in the local daemon architecture.' },
      { label: 'Prompting agents', href: '/docs/guides/prompting-agents', body: 'Teach agents to treat spend and pressure as part of coordination.' },
    ],
  },
  {
    slug: 'yaml-and-shipwright',
    nav: 'YAML + Shipwright',
    title: 'Agents start as YAML, then Shipwright helps choose the right set.',
    eyebrow: 'Definition layer',
    summary:
      'The file is the contract. Shipwright is the guided way to create it for a new repo without installing every possible agent.',
    image: '/img/generated/shipwright-proposal.webp',
    gif: '/gifs/agents/yaml-and-shipwright.gif',
    alt: 'Generated image of a Shipwright planning surface turning repo signals into a starter fleet',
    codeLabel: 'New repo flow',
    code: `pd setup
pd status
pd fleet init
pd fleet validate
pd fleet up

# Then open Fleet Control Center > Shipwright Control and accept, edit, or reject the proposal.`,
    theory: [
      'A fleet file is a written constitution for repeatable agent work. The useful move is not to install every agent idea; it is to name the few roles that match the repo evidence, give each one a trigger, and make the operator review the contract before it becomes automation.',
      'Shipwright is the counterweight to automation sprawl. It surveys stack, tests, docs, dirty-state habits, and current pain before proposing agents, then leaves the proposal as YAML so the team can diff it, teach it, and roll it back.',
    ],
    bullets: [
      'Shipwright starts from repo evidence: stack, tests, docs, risk, and existing workflows.',
      'The result is editable YAML, not hidden automation.',
      'The agents shown on the overview are examples. A repo usually needs only a subset.',
    ],
    screenshots: [
      {
        label: 'Fleet Control Center',
        title: 'Shipwright Control',
        href: '/mac-preview',
        image: SHIPWRIGHT_CONTROL_SCREENSHOT,
        body: 'Use the console to inspect the proposed fleet, compare roles, and accept only the agents this repo can actually support.',
      },
      {
        label: 'FleetBar',
        title: 'Native shell',
        href: '/mac-preview#download',
        image: FLEETBAR_SCREENSHOT,
        body: 'FleetBar is the Mac entry point for opening the real control plane instead of a reduced shadow dashboard.',
      },
    ],
    builds: [
      {
        label: 'Bootstrap a project fleet',
        href: '/tutorials/fleet',
        body: 'Build the first pd-fleet.yml and learn when a recurring agent is better than a one-off sortie.',
      },
      {
        label: 'Use the webhook adapter',
        href: '/examples/webhook-to-local-agent',
        body: 'Route external events into a local Port Daddy agent loop without handing every service a direct shell.',
      },
    ],
    docs: [
      { label: 'Fleet tutorial', href: '/tutorials/fleet', body: 'Walk through pd-fleet.yml and recurring agents.' },
      { label: 'Fleet CLI', href: '/docs/cli/fleet', body: 'Read the command reference for fleet operations.' },
      { label: 'Templates guide', href: '/docs/guides/templates', body: 'See how reusable project setup patterns are documented.' },
      { label: 'Reference architectures', href: '/docs/reference-architectures', body: 'Place FleetBar, daemon, and fleet YAML in the system diagram.' },
    ],
  },
  {
    slug: 'templates',
    nav: 'Templates',
    title: 'Fleet templates now live inside the Agents system.',
    eyebrow: 'Reusable agent patterns',
    summary:
      'The old top-level Templates library is deprecated. Current templates are agent operating patterns: starter YAML, always-on fleets, CI repair loops, event ops, remote harbors, research swarms, and secure messaging primitives.',
    image: '/img/generated/virtual-actor-fleet.webp',
    gif: '/gifs/agents/yaml-and-shipwright.gif',
    alt: 'Generated image of reusable Port Daddy agent templates connected to fleet YAML and runtime signals',
    codeLabel: 'Canonical template flow',
    code: `# /templates now redirects to /agents/templates.
# Start from a checked-in template and keep it diffable.
cp templates/pd-fleet-starter.yml pd-fleet.yml
pd fleet validate
pd fleet up
pd fleet status

# When a pattern proves useful, leave the adoption trail.
pd note "Template adopted: starter fleet; validation: pd fleet validate + pd fleet status"`,
    theory: [
      'Templates belong with agents because a useful Port Daddy template is not a decorative starter folder. It is a repeatable coordination pattern: who wakes, what evidence they read, which primitive carries the work, where the operator approves risk, and how the next agent resumes if the first body dies.',
      'The old template library implied a generic marketplace of blueprints. The current system is more honest. These are checked-in patterns that map to actual files under templates/, real daemon primitives, FleetBar and console surfaces, and workflows an agent can run, validate, and explain.',
      'Treat a template as a starting constitution, not a magic spell. Copy it, validate it, trim the agents you do not need, and promote only the habits that survive contact with the repo.',
    ],
    bullets: [
      'Canonical navigation is /agents/templates; old /templates URLs redirect here.',
      'Every listed pack maps to a real file or folder under templates/. No phantom blueprint IDs.',
      'YAML templates are for recurring agents; one-off work still belongs in sorties, pd agent, or pd spawn.',
    ],
    screenshots: [
      {
        label: 'FleetBar',
        title: 'Template readiness',
        href: '/mac-preview#download',
        image: FLEETBAR_SCREENSHOT,
        body: 'Use FleetBar to confirm the daemon and current project are healthy before turning a template into live recurring work.',
      },
      {
        label: 'Console',
        title: 'YAML and Flow',
        href: '/mac-preview',
        image: FLOW_SCREENSHOT,
        body: 'Use Fleet Control Center to inspect the active project, review the Flow view, and keep the template tied to observable agent activity.',
      },
    ],
    builds: [
      {
        label: 'Fleet tutorial',
        href: '/tutorials/fleet',
        body: 'Build a pd-fleet.yml, validate it, and learn when recurring agents are worth installing.',
      },
      {
        label: 'Webhook adapter',
        href: '/examples/webhook-to-local-agent',
        body: 'Turn an event intake pattern into a local agent loop you can reuse in ops templates.',
      },
      {
        label: 'Test failure reporter',
        href: '/examples/test-failure-to-agent',
        body: 'Build the smallest CI-to-agent repair loop before promoting it into a full template.',
      },
    ],
    templatePacks: TEMPLATE_PACKS,
    docs: [
      { label: 'Template guide', href: '/docs/guides/templates', body: 'Adapt recurring project patterns without hiding the coordination contract.' },
      { label: 'Fleet CLI', href: '/docs/cli/fleet', body: 'Validate, run, and inspect fleet YAML.' },
      { label: 'pd pub', href: '/docs/cli/pub', body: 'Publish the events that template agents can consume.' },
      { label: 'Remote harbors', href: '/tutorials/remote-harbors', body: 'Use harbors and tunnels when a template crosses machines.' },
      { label: 'Prompting agents', href: '/docs/guides/prompting-agents', body: 'Teach a copied template the note, claim, and handoff loop.' },
    ],
  },
  {
    slug: 'agent-skill',
    nav: 'Agent Skill',
    title: 'The Port Daddy agent skill is the instruction manual for serious multi-agent coordination.',
    eyebrow: 'Agent skill',
    summary:
      'This is the reusable operating manual for agents driving Port Daddy: start from live truth, publish intent, claim the right surface, coordinate through shared primitives, and leave enough evidence that the next agent can continue without folklore.',
    image: '/img/generated/control-plane-og.webp',
    gif: '/gifs/agents/coordination.gif',
    alt: 'Generated image of Port Daddy coordination primitives around a local control plane',
    codeLabel: 'Install and use the skill',
    code: `# The skill ships in the Port Daddy package beside the pd binary.
ls skills/port-daddy-agent-skill
python3 skills/port-daddy-agent-skill/scripts/validate_port_daddy_agent_skill.py skills/port-daddy-agent-skill

# The operating loop it teaches agents:
pd status
pd briefing
pd begin "finish the bounded slice"
pd note "Scope, files, assumptions, validation plan"
pd session files add website-v2/src/pages/AgentsPage.tsx
pd guard check --staged`,
    theory: [
      'Most agent failures are not model failures. They are coordination failures: stale runtime assumptions, invisible edit intent, ambiguous ownership, missing validation, or a handoff that reads like a vibe instead of an audit trail. The Port Daddy agent skill turns those hazards into a repeatable loop.',
      'The sexy part is that the skill is not just a prompt. It is a field manual with references, diagrams, schemas, scripts, templates, examples, and UI metadata. An agent can load the lean SKILL.md, then pull deeper procedural guidance only when the task asks for salvage, file claims, FleetBar diagnosis, or release-surface sync.',
      'Treat it as the instruction manual for agents doing multi-agent coordination. It teaches the difference between a durable actor and a temporary model body, between notes and channels, between claims and locks, and between process success and operator-visible proof.',
    ],
    bullets: [
      'The repo copy is packaged under skills/port-daddy-agent-skill and exported with the binaries.',
      'Tool-specific mirrors keep Codex, Claude, Gemini, and AGENTS-aware runners pointed at the same operating doctrine.',
      'Schemas make notes, handoffs, and validation reports machine-checkable instead of just nicely worded.',
    ],
    screenshots: [
      {
        label: 'FleetBar',
        title: 'Native agent entry point',
        href: '/mac-preview#download',
        image: FLEETBAR_SCREENSHOT,
        body: 'FleetBar is where an operator should see agent summaries, touched files, readiness, and the launch path into the full console.',
      },
      {
        label: 'Console',
        title: 'Flow view',
        href: '/mac-preview',
        image: FLOW_SCREENSHOT,
        body: 'Fleet Control Center is where the skill points agents for project-level truth: active work, activity, resources, sorties, and YAML.',
      },
    ],
    builds: [
      {
        label: 'Editor lightbulb',
        href: '/examples/editor-lightbulb-to-agent',
        body: 'Build an editor action that sends selected code to the local agent with enough context to respond safely.',
      },
      {
        label: 'Test failure reporter',
        href: '/examples/test-failure-to-agent',
        body: 'Build a reporter that publishes failures to the local agent and prints the diagnosis back in the terminal.',
      },
      {
        label: 'Webhook adapter',
        href: '/examples/webhook-to-local-agent',
        body: 'Accept Slack, Discord, Linear, or generic webhook JSON and route it into the local coordination loop.',
      },
    ],
    docs: [
      { label: 'Prompting agents', href: '/docs/guides/prompting-agents', body: 'Teach agents the session, note, claim, and validation loop.' },
      { label: 'Protocol guide', href: '/docs/guides/protocol', body: 'Pick notes, channels, inboxes, tuples, or locks by job.' },
      { label: 'Fleet CLI', href: '/docs/cli/fleet', body: 'Install recurring agents when the pattern deserves automation.' },
      { label: 'Mac Preview', href: '/mac-preview', body: 'See the FleetBar and Fleet Control Center surfaces the skill references.' },
    ],
  },
  {
    slug: 'event-triggers',
    nav: 'Event triggers',
    title: 'Event triggers wake agents when the repo says something happened.',
    eyebrow: 'pd watch',
    summary:
      'Triggers let agents sleep until a channel event, git commit, timer, or shell watcher says there is work to do.',
    image: '/img/generated/control-plane-hero.webp',
    gif: '/gifs/agents/event-triggers.gif',
    alt: 'Generated image of event routes lighting up from git commits to agent workers',
    codeLabel: 'Watcher loop',
    code: `pd sub git:committed --history --limit 5
pd watch git:committed --exec "pd agent 'review the newest commit and leave a note'"
pd pub qa:findings '{"severity":"high","file":"routes/spawn.ts","owner":"qa"}'

# Recurring version:
pd fleet run qa`,
    theory: [
      'A trigger is useful only when it reduces timing ambiguity. The event should mean something specific enough that the awakened agent can choose a bounded response, attach evidence, and stop.',
      'Port Daddy keeps logical channel names readable while resolving the physical channel to the project. That means humans can say git:committed, while the runtime prevents another checkout with the same fleet name from waking the wrong agents.',
    ],
    bullets: [
      'YAML trigger names stay human-readable, while Port Daddy scopes the physical channel to the project.',
      'Triggered agents use cooldown, singleton, and dedupe windows so they do not stampede.',
      'Raw watchers can run shell commands; fleet agents run backends with identity and telemetry.',
    ],
    screenshots: [
      {
        label: 'Console',
        title: 'Flow events',
        href: '/mac-preview',
        image: FLOW_SCREENSHOT,
        body: 'Use Flow to see project-scoped event movement instead of treating terminal watchers as the whole story.',
      },
      {
        label: 'FleetBar',
        title: 'Menu bar readiness',
        href: '/mac-preview#download',
        image: FLEETBAR_SCREENSHOT,
        body: 'FleetBar gives the operator a fast check that the daemon, project, and launch readiness agree before new agents wake.',
      },
    ],
    builds: [
      {
        label: 'Button to agent',
        href: '/examples/pd-tube-button-to-agent',
        body: 'Publish a browser button event to a local agent and render the answer back on the page.',
      },
      {
        label: 'Pipeline tutorial',
        href: '/tutorials/pipelines',
        body: 'Chain a trigger, a lock, a worker, and a validation note into one recoverable loop.',
      },
    ],
    docs: [
      { label: 'pd watch', href: '/docs/cli/watch', body: 'The CLI primitive behind channel-driven work.' },
      { label: 'Watch tutorial', href: '/tutorials/watch', body: 'Follow channel traffic and trigger bounded responses.' },
      { label: 'Pipelines tutorial', href: '/tutorials/pipelines', body: 'Chain events, locks, and spawned workers.' },
      { label: 'Swarm radio', href: '/docs/features/radio', body: 'Pub/sub semantics for agent events.' },
      { label: 'Fleet feature', href: '/docs/features/fleet', body: 'How recurring agents bind to project events.' },
    ],
  },
  {
    slug: 'virtual-actors',
    nav: 'Virtual actors',
    title: 'The actor is the durable role. The model process is only the current body.',
    eyebrow: 'Actor model',
    summary:
      'Navigator, Coxswain, Lookout, and Shipwright remain addressable even when no live model process is attached.',
    image: '/img/generated/virtual-actor-fleet.webp',
    gif: '/gifs/agents/virtual-actors.gif',
    alt: 'Generated image of durable virtual actors connected to temporary runtime bodies',
    codeLabel: 'Actor inboxes',
    code: `pd actors --project port-daddy
pd actor navigator --inbox --unread
pd actor coxswain --message "Claims check needed before routes/fleet.ts edits"
pd actor lookout --message "Website product copy changed; verify skill/docs drift" --wake
pd notes --limit 10`,
    theory: [
      'A durable actor is a role with memory, addressability, and responsibility. A model process is just one possible body for that role, which is why a dead body does not erase the inbox, session notes, or ownership trail.',
      'This is the move that lets multi-agent work become operational instead of theatrical. You can ask Navigator for roadmap truth, Lookout for docs drift, and Coxswain for contention without pretending all of them are currently alive in the same chat window.',
    ],
    bullets: [
      'The actor has a name, job, inbox, and history.',
      'The body can be Codex, Claude, Ollama, Gemini, Aider, or custom shell.',
      'This is why a dead process does not mean lost work.',
    ],
    screenshots: [
      {
        label: 'Console',
        title: 'Agents surface',
        href: '/mac-preview',
        image: FLOW_SCREENSHOT,
        body: 'Use the console to connect durable roles, live bodies, recent activity, and files touched by each agent.',
      },
      {
        label: 'FleetBar',
        title: 'Recent agent hints',
        href: '/mac-preview#download',
        image: FLEETBAR_SCREENSHOT,
        body: 'FleetBar should expose the high-signal actor summary without requiring a browser tab hunt.',
      },
    ],
    builds: [
      {
        label: 'Inbox tutorial',
        href: '/tutorials/inbox',
        body: 'Build durable role-to-role handoffs and learn when directed mail is better than pub/sub.',
      },
      {
        label: 'Prompting agents',
        href: '/docs/guides/prompting-agents',
        body: 'Give agents the exact operating loop that preserves actor truth.',
      },
    ],
    docs: [
      { label: 'Prompting agents', href: '/docs/guides/prompting-agents', body: 'Teach agents to use sessions, notes, claims, and status.' },
      { label: 'Always-on tutorial', href: '/tutorials/always-on', body: 'See how long-lived roles behave.' },
      { label: 'Sessions feature', href: '/docs/features/sessions', body: 'The durable identity and note layer.' },
      { label: 'MCP reference', href: '/docs/mcp', body: 'Expose the same primitives to MCP clients.' },
    ],
  },
  {
    slug: 'daemon-runtime',
    nav: 'Daemon runtime',
    title: 'The launchd daemon is the local substrate under every agent.',
    eyebrow: 'Runtime',
    summary:
      'Agents coordinate through the same local daemon that serves Fleet Control Center and FleetBar.',
    image: '/img/generated/agent-runtime-map.webp',
    gif: '/gifs/agents/daemon-runtime.gif',
    alt: 'Generated image of a local daemon coordinating ports, sessions, locks, and fleet agents',
    codeLabel: 'Runtime truth check',
    code: `pd status
pd daemon env default
pd services
pd fleet status
launchctl print gui/501/com.portdaddy.daemon

# If source changed runtime routes, rebuild and relaunch before trusting browser proof.`,
    theory: [
      'Runtime truth is not the same as source truth. A route can exist in the checkout while FleetBar is still talking to an older promoted daemon, and a CLI shim can point at a different install root than the process serving the console.',
      'The daemon is the substrate that makes coordination real. It owns sessions, locks, tuples, channels, ports, fleet state, and the evidence surfaces the operator can inspect when a model process disappears.',
    ],
    bullets: [
      'The daemon owns ports, sessions, locks, inboxes, tuples, channels, and fleet state.',
      'FleetBar and the browser control plane should show the same daemon truth.',
      'Promotion matters because a green checkout is not automatically the installed runtime.',
    ],
    screenshots: [
      {
        label: 'Console',
        title: 'Resources',
        href: '/mac-preview',
        image: RESOURCES_SCREENSHOT,
        body: 'Resources is the console view for backend readiness, ports, pressure, and the practical limits around launching agents.',
      },
      {
        label: 'FleetBar',
        title: 'Daemon status',
        href: '/mac-preview#download',
        image: FLEETBAR_SCREENSHOT,
        body: 'FleetBar is where daemon health and project readiness should be visible before the operator launches work.',
      },
    ],
    builds: [
      {
        label: 'Verify runtime tutorial',
        href: '/docs/get-started/verify-runtime',
        body: 'Walk the exact checks that separate an installed daemon from a stale source checkout.',
      },
      {
        label: 'Service discovery example',
        href: '/docs/features/dns',
        body: 'Build around daemon-discovered services instead of hardcoded localhost assumptions.',
      },
    ],
    docs: [
      { label: 'Quickstart', href: '/docs/quickstart', body: 'Install, verify, and start from a known daemon state.' },
      { label: 'pd status', href: '/docs/cli/status', body: 'Check the local runtime before debugging behavior.' },
      { label: 'Reference architectures', href: '/docs/reference-architectures', body: 'Understand the local daemon boundary.' },
      { label: 'Ports feature', href: '/docs/features/ports', body: 'The original daemon-backed local coordination primitive.' },
    ],
  },
  {
    slug: 'communication-protocols',
    nav: 'Protocols',
    title: 'Agents communicate through channels, inboxes, tuples, notes, and semantic memory.',
    eyebrow: 'Communication',
    summary:
      'Port Daddy gives agents structured ways to coordinate without pretending they are all in one chat room.',
    image: '/img/generated/control-plane-og.webp',
    gif: '/gifs/agents/communication-protocols.gif',
    alt: 'Generated image of protocol lanes for tuples, channels, inboxes, and notes',
    codeLabel: 'Protocol primitives',
    code: `pd pub git:committed '{"sha":"abc123","projectDir":"/path/to/project"}'
pd inbox send navigator "Roadmap changed; please reconcile the recovery ledger"
pd tuple out '["coordination:claim","routes/fleet.ts","session-123"]'
pd note "Protocol decision: channel for event, inbox for owner, tuple for machine-readable fact"
pd notes --limit 10`,
    theory: [
      'Communication primitive choice is architecture. Channels are for broadcast events, inboxes are for directed durable ownership, notes are for human-readable context, and tuples are for facts another process should query later.',
      'The skill teaches agents not to turn every interaction into chat. Good coordination is quieter than that: publish the fact in the primitive that matches its lifetime, audience, and machine-readability.',
    ],
    bullets: [
      'Channels are good for events and subscriptions.',
      'Inboxes are good for durable directed handoffs.',
      'Tuples and semantic memory are good for machine-readable shared facts.',
    ],
    screenshots: [
      {
        label: 'Console',
        title: 'Flow and channels',
        href: '/mac-preview',
        image: FLOW_SCREENSHOT,
        body: 'Use the console to trace which channel, inbox, or session note actually carried a coordination fact.',
      },
      {
        label: 'Console',
        title: 'Resources and readiness',
        href: '/mac-preview',
        image: RESOURCES_SCREENSHOT,
        body: 'Resources gives the practical context around whether a backend can consume the protocol you just designed.',
      },
    ],
    builds: [
      {
        label: 'PD Tube button',
        href: '/examples/pd-tube-button-to-agent',
        body: 'Build the smallest browser-to-agent message loop and see why plain JSON events are enough.',
      },
      {
        label: 'Protocol guide',
        href: '/docs/guides/protocol',
        body: 'Use the decision rules for notes, messages, inboxes, tuples, locks, and salvage.',
      },
    ],
    docs: [
      { label: 'Protocol guide', href: '/docs/guides/protocol', body: 'When to use notes, messages, tuples, and inboxes.' },
      { label: 'pd msg', href: '/docs/cli/msg', body: 'Inspect and publish channel messages.' },
      { label: 'pd pub', href: '/docs/cli/pub', body: 'Publish events from scripts and hooks.' },
      { label: 'Inbox tutorial', href: '/tutorials/inbox', body: 'Use durable directed handoffs between agents.' },
      { label: 'Tuples feature', href: '/docs/features/tuples', body: 'Machine-readable shared facts for coordination.' },
    ],
  },
  {
    slug: 'resurrection',
    nav: 'Resurrection',
    title: 'Dead agents leave salvageable work instead of a mystery.',
    eyebrow: 'pd salvage',
    summary:
      'The daemon records sessions, notes, claims, and last-known intent so a new agent can resume from evidence.',
    image: '/img/generated/salvage-ledger.webp',
    gif: '/gifs/agents/resurrection.gif',
    alt: 'Generated image of a salvage ledger preserving dead agent work',
    codeLabel: 'Salvage loop',
    code: `pd salvage --project port-daddy --limit 20
pd salvage claim agent-001
pd notes --limit 20
pd note "Recovered abandoned slice; preserving original scope and validation evidence"
pd done "Recovered, validated, and closed the abandoned work"`,
    theory: [
      'Recovery is where agent systems reveal whether they are serious. If the only trace of an interrupted run is a half-written chat transcript, the next agent has to re-investigate everything and may ship the wrong intent.',
      'Port Daddy treats salvage as a first-class continuation path. A useful dead agent leaves session notes, claimed files, last activity, and enough purpose to decide whether to resume, dismiss, or escalate.',
    ],
    bullets: [
      'Salvage is not cleanup theater. It is the continuation path for interrupted work.',
      'Good agents leave notes, exact files, validation, and blockers before they disappear.',
      'The operator can see what was dead, claimed, dismissed, or finished.',
    ],
    screenshots: [
      {
        label: 'Console',
        title: 'Activity evidence',
        href: '/mac-preview',
        image: FLOW_SCREENSHOT,
        body: 'The console should show the activity trail that makes a salvage decision auditable.',
      },
      {
        label: 'FleetBar',
        title: 'Recoverable hints',
        href: '/mac-preview#download',
        image: FLEETBAR_SCREENSHOT,
        body: 'FleetBar should surface last-active hints and touched files so recovery starts from evidence.',
      },
    ],
    builds: [
      {
        label: 'Recover a dead session',
        href: '/docs/tutorials/recover-a-dead-agent-session',
        body: 'Practice reading the evidence trail before restarting abandoned work.',
      },
      {
        label: 'Time travel tutorial',
        href: '/tutorials/time-travel',
        body: 'Reconstruct what happened from the activity and notes timeline.',
      },
    ],
    docs: [
      { label: 'Salvage feature', href: '/docs/features/salvage', body: 'How interrupted work becomes recoverable.' },
      { label: 'pd salvage', href: '/docs/cli/salvage', body: 'List dead agents and preserved context.' },
      { label: 'pd salvage claim', href: '/docs/cli/salvage-claim', body: 'Claim abandoned work safely.' },
      { label: 'Time-travel tutorial', href: '/tutorials/time-travel', body: 'Reconstruct what happened from activity history.' },
    ],
  },
  {
    slug: 'coordination',
    nav: 'Coordination',
    title: 'Multiple agents avoid stepping on each other by publishing intent before edits.',
    eyebrow: 'Claims, locks, guard',
    summary:
      'Port Daddy uses sessions, notes, file claims, locks, guard checks, and inconsistency channels to make collisions visible.',
    image: '/img/generated/coordination-guard.webp',
    gif: '/gifs/agents/coordination.gif',
    alt: 'Generated image of a coordination guard protecting file claims and critical sections',
    codeLabel: 'Edit discipline',
    code: `pd begin "fix fleet route timeout"
pd advise routes/fleet.ts --task "patch timeout handling without touching spawn policy"
pd note "Scope: routes/fleet.ts only; validation: focused route tests plus typecheck"
pd session files add routes/fleet.ts
pd with-lock stable-promotion -- ./scripts/promote-stable.sh
pd guard check --staged`,
    theory: [
      'Claims are social contracts with machine visibility. They do not prevent edits, but they make intent inspectable early enough that another agent can route around, negotiate, or call out a conflicting goal before a merge conflict becomes the least interesting problem.',
      'Locks are stronger and rarer. Use them for non-mergeable resources like promotion, generated artifacts, migrations, and release packaging. If every edit needs a lock, the problem is workflow design, not lock scarcity.',
    ],
    bullets: [
      'Claims are advisory so agents can route around each other before conflict.',
      'Locks are for scarce resources like migrations, generated artifacts, and promotion.',
      'Coordination Guard makes session and file-claim discipline enforceable at commit time.',
    ],
    screenshots: [
      {
        label: 'Console',
        title: 'Flow view',
        href: '/mac-preview',
        image: FLOW_SCREENSHOT,
        body: 'Flow lets the operator see the current work graph, not just a pile of terminal sessions.',
      },
      {
        label: 'Console',
        title: 'Sorties',
        href: '/mac-preview',
        image: SORTIES_SCREENSHOT,
        body: 'Sorties are the mission-shaped complement to recurring fleet work when a bounded task needs status and evidence.',
      },
    ],
    builds: [
      {
        label: 'Editor lightbulb',
        href: '/examples/editor-lightbulb-to-agent',
        body: 'Use file, selection, and range context as a small version of symbol-scoped coordination.',
      },
      {
        label: 'Coordination discipline',
        href: '/docs/best-practices/coordination-discipline',
        body: 'Learn the operator loop for notes, claims, locks, validation, and handoff evidence.',
      },
    ],
    docs: [
      { label: 'pd begin', href: '/docs/cli/begin', body: 'Start the session before touching shared work.' },
      { label: 'pd note', href: '/docs/cli/note', body: 'Leave durable context other agents can inspect.' },
      { label: 'pd with-lock', href: '/docs/cli/with-lock', body: 'Protect scarce critical sections.' },
      { label: 'Sessions feature', href: '/docs/features/sessions', body: 'How claims, notes, and activity hang together.' },
      { label: 'Arbiter feature', href: '/docs/features/arbiter', body: 'Invariant checks for higher-risk coordination.' },
    ],
  },
]

const NAV_LINKS = [
  { label: 'Overview', href: '/agents', end: true },
  ...AGENT_SECTIONS.filter((section) => section.slug !== 'agent-skill').map((section) => ({
    label: section.nav,
    href: `/agents/${section.slug}`,
    end: true,
  })),
]

function ThemedScreenshot({
  source,
  alt,
  className,
  loading = 'lazy',
}: {
  source: ThemedImage
  alt: string
  className?: string
  loading?: 'eager' | 'lazy'
}) {
  const { theme } = useTheme()

  if (typeof source === 'string') {
    return <img src={source} alt={alt} className={className} loading={loading} />
  }

  const themeKey = theme === 'dark' ? 'dark' : 'light'
  return (
    <img
      src={source[themeKey]}
      alt={alt}
      className={className}
      data-theme-screenshot={themeKey}
      loading={loading}
    />
  )
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function agentYaml(name: string) {
  const lines = fleetYaml.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((line) => new RegExp(`^[ ]{4}${escapeRegex(name)}:\\s*$`).test(line))

  if (start === -1) {
    return `# ${name} was not found in pd-fleet.yml`
  }

  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^[ ]{2}(watchers|channels):\s*$/.test(line) || /^[ ]{4}[A-Za-z0-9_-]+:\s*$/.test(line)) {
      end = index
      break
    }
  }

  return ['# excerpt from pd-fleet.yml', 'fleet:', '  agents:', ...lines.slice(start, end)].join('\n')
}

function highlightYamlValue(value: string): ReactNode {
  if (!value) return value

  const tokens: ReactNode[] = []
  const regex = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\{[A-Za-z0-9_:.-]+\})|(\b(?:true|false|null)\b)|(\b\d+(?:\.\d+)?\b)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(value)) !== null) {
    if (match.index > lastIndex) tokens.push(value.slice(lastIndex, match.index))
    const token = match[0]
    const color = match[1]
      ? 'var(--code-string)'
      : match[2]
        ? 'var(--code-channel-topic)'
        : match[3]
          ? 'var(--brand-accent)'
          : 'var(--code-flag)'
    tokens.push(
      <span key={`${match.index}-${token}`} style={{ color, fontWeight: 600 }}>
        {token}
      </span>,
    )
    lastIndex = match.index + token.length
  }

  if (lastIndex < value.length) tokens.push(value.slice(lastIndex))
  return <>{tokens}</>
}

function highlightYamlLine(line: string) {
  if (!line.trim()) return '\u00A0'

  const trimmed = line.trimStart()
  if (trimmed.startsWith('#')) {
    return <span style={{ color: 'var(--code-comment)' }}>{line}</span>
  }

  const match = line.match(/^(\s*)([A-Za-z0-9_.-]+)(:)(.*)$/)
  if (!match) return <span>{line}</span>

  return (
    <>
      {match[1]}
      <span style={{ color: 'var(--code-command)', fontWeight: 700 }}>{match[2]}</span>
      <span style={{ color: 'var(--code-comment)' }}>{match[3]}</span>
      <span>{highlightYamlValue(match[4])}</span>
    </>
  )
}

function YamlCodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="min-w-0 space-y-[var(--space-2)]">
      <div className="flex items-center justify-between gap-[var(--panel-gap-tight)]">
        <BracketLabel>{label}</BracketLabel>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label={`Copy ${label}`}
          title={copied ? 'Copied' : 'Copy'}
          onClick={handleCopy}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </Button>
      </div>
      <pre
        tabIndex={0}
        aria-label={`${label} YAML`}
        className="m-0 max-h-[32rem] min-w-0 overflow-auto border-2 border-[var(--border-strong)] bg-[var(--code-bg)] px-[var(--space-4)] py-[var(--space-4)] font-mono text-[14px] leading-[1.6] text-[var(--code-text)]"
      >
        {code.split('\n').map((line, index) => (
          <div key={`${index}-${line.slice(0, 16)}`}>{highlightYamlLine(line)}</div>
        ))}
      </pre>
      <span className="sr-only" aria-live="polite">
        {copied ? `${label} copied to clipboard` : ''}
      </span>
    </div>
  )
}

function IconBlock({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div className="flex h-[var(--space-7)] w-[var(--space-7)] shrink-0 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-primary)]">
      <Icon className="h-[var(--space-4)] w-[var(--space-4)]" strokeWidth={2.25} />
    </div>
  )
}

function AgentSectionNav() {
  return (
    <nav
      aria-label="Agents section"
      className="sticky top-[70px] z-40 border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
    >
      <PageContainer width="wide" className="!max-w-none flex items-center gap-[var(--space-3)] overflow-x-auto py-[var(--space-2)]">
        <PanelEyebrow className="hidden shrink-0 text-[var(--text-muted)] md:block">Agents section</PanelEyebrow>
        {NAV_LINKS.map((item) => (
          <NavLink
            key={item.href}
            to={item.href}
            end={item.end}
            className={({ isActive }) =>
              [
                'flex shrink-0 items-center justify-between gap-[var(--space-2)] border-2 px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] transition-colors',
                isActive
                  ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
                  : 'border-transparent text-[var(--text-primary)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-base)]',
              ].join(' ')
            }
          >
            <span>{item.label}</span>
            <ArrowRight className="h-[var(--space-3)] w-[var(--space-3)]" strokeWidth={2.25} />
          </NavLink>
        ))}
      </PageContainer>
    </nav>
  )
}

function AgentHero() {
  return (
    <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-8)] lg:py-[var(--space-9)]">
      <PageContainer width="wide">
        <SwissGrid className="items-center gap-y-[var(--space-7)]">
          <SwissGridItem span="narrow" className="space-y-[var(--space-6)]">
            <BracketLabel>Agents</BracketLabel>
            <div className="space-y-[var(--space-4)]">
              <PanelTitle as="h1" size="hero" className="max-w-[11ch]">
                YAML-defined agents, not mystery automation.
              </PanelTitle>
              <PanelBody className="max-w-[40rem]">
                Port Daddy agents are declared in YAML, run through the local daemon, and leave
                inspectable evidence. Shipwright helps a new repo choose the agents it actually
                needs, then writes a starter fleet you can review and commit.
              </PanelBody>
              <PanelBody className="max-w-[40rem]">
                The cards below are examples from Port Daddy's own fleet. The magic is that each
                role has a trigger, backend, budget posture, communication channel, and salvage
                path instead of being just another tab of chat.
              </PanelBody>
              <PanelBody className="max-w-[40rem]">
                Start with Flow when you want the full cockpit, Coordination Guard when the commit
                needs proof, and Smart Resources when the machine, budget, or backend roster might
                be the real bottleneck.
              </PanelBody>
            </div>
            <div className="flex flex-wrap gap-[var(--space-3)]">
              <BracketLink to="/agents/yaml-and-shipwright">
                <span className="inline-flex items-center gap-[var(--space-2)]">
                  How Shipwright picks agents
                  <ArrowRight className="h-[var(--space-3)] w-[var(--space-3)]" strokeWidth={2.25} />
                </span>
              </BracketLink>
              <BracketLink to="/docs/cli/fleet" tone="accent">
                <span className="inline-flex items-center gap-[var(--space-2)]">
                  Fleet CLI
                  <Terminal className="h-[var(--space-3)] w-[var(--space-3)]" strokeWidth={2.25} />
                </span>
              </BracketLink>
            </div>
          </SwissGridItem>

          <SwissGridItem span="wide">
            <figure className="m-0 overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <picture>
                <source srcSet="/img/generated/virtual-actor-fleet.webp" type="image/webp" />
                <img
                  src="/img/generated/virtual-actor-fleet.jpg"
                  alt="Generated system map of YAML agents, durable actors, and temporary runtime bodies"
                  className="aspect-[16/9] w-full object-cover"
                  loading="eager"
                />
              </picture>
            </figure>
          </SwissGridItem>
        </SwissGrid>
      </PageContainer>
    </section>
  )
}

function ConceptStrip() {
  return (
    <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-8)] lg:py-[var(--space-9)]">
      <PageContainer width="wide">
        <div className="mb-[var(--space-6)] max-w-[50rem] space-y-[var(--space-3)]">
          <BracketLabel>Twenty-second model</BracketLabel>
          <PanelTitle as="h2" size="display">
            Four words explain the system.
          </PanelTitle>
        </div>
        <div className="grid gap-[var(--panel-gap)] md:grid-cols-2 xl:grid-cols-4">
          {CONCEPTS.map((concept) => {
            const panelTone = concept.tone === 'blue' ? 'primary' : concept.tone === 'accent' ? 'accent' : 'default'
            const Icon = concept.icon
            return (
              <SurfacePanel key={concept.label} tone={concept.tone} className="space-y-[var(--panel-gap)]">
                <div className="flex items-center justify-between gap-[var(--panel-gap)]">
                  <BracketLabel tone={panelTone} surface={concept.tone}>
                    {concept.label}
                  </BracketLabel>
                  <Icon className="h-[var(--space-5)] w-[var(--space-5)]" strokeWidth={2.25} />
                </div>
                <PanelTitle as="h3" size="nav" tone={panelTone}>
                  {concept.title}
                </PanelTitle>
                <PanelBody
                  size="compact"
                  tone={concept.tone === 'blue' ? 'primary' : concept.tone === 'accent' ? 'accent' : 'default'}
                  className="max-w-none"
                >
                  {concept.body}
                </PanelBody>
              </SurfacePanel>
            )
          })}
        </div>
      </PageContainer>
    </section>
  )
}

function AgentGrid() {
  return (
    <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-8)] lg:py-[var(--space-9)]">
      <PageContainer width="wide">
        <SwissGrid className="gap-y-[var(--space-6)]">
          <SwissGridItem span="rail" className="space-y-[var(--space-4)]">
            <BracketLabel>Example fleet</BracketLabel>
            <PanelTitle as="h2" size="display">
              Click an agent to see the exact YAML.
            </PanelTitle>
            <PanelBody>
              These are examples, not a mandate. A new repo might need QA and Documentarian,
              but not Spark, Spider, or Cartographer. Shipwright helps choose.
            </PanelBody>
          </SwissGridItem>
          <SwissGridItem span="body">
            <div className="grid gap-[var(--panel-gap)] lg:grid-cols-2">
              {FLEET_AGENTS.map((agent) => (
                <details
                  key={agent.name}
                  className="group border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
                >
                  <summary className="grid cursor-pointer list-none gap-[var(--panel-gap)] p-[var(--panel-padding)] [list-style:none] [&::-webkit-details-marker]:hidden">
                    <div className="grid gap-[var(--panel-gap)] sm:grid-cols-[9rem_minmax(0,1fr)]">
                      <img
                        src={agent.image}
                        alt=""
                        className="aspect-square w-full border-2 border-[var(--border-strong)] object-cover"
                        loading="lazy"
                      />
                      <div className="min-w-0 space-y-[var(--space-3)]">
                        <div className="flex items-start justify-between gap-[var(--space-3)]">
                          <div className="flex min-w-0 items-start gap-[var(--space-3)]">
                            <IconBlock icon={agent.icon} />
                            <div className="min-w-0 space-y-[var(--space-1)]">
                              <PanelEyebrow>{agent.wakes}</PanelEyebrow>
                              <PanelTitle as="h3" size="nav">
                                <RoleTerm role={agent.roleKey}>{agent.name}</RoleTerm>
                              </PanelTitle>
                            </div>
                          </div>
                          <ChevronDown
                            className="h-[var(--space-4)] w-[var(--space-4)] shrink-0 transition-transform group-open:rotate-180"
                            strokeWidth={2.25}
                          />
                        </div>
                        <PanelBody size="compact" className="max-w-none">
                          {agent.work}
                        </PanelBody>
                        <div className="grid gap-[var(--space-2)] md:grid-cols-2">
                          <div>
                            <PanelEyebrow>Runtime</PanelEyebrow>
                            <PanelBody size="compact" className="mt-[var(--space-1)] max-w-none">
                              {agent.runtime}
                            </PanelBody>
                          </div>
                          <div>
                            <PanelEyebrow>Why it feels magic</PanelEyebrow>
                            <PanelBody size="compact" className="mt-[var(--space-1)] max-w-none">
                              {agent.magic}
                            </PanelBody>
                          </div>
                        </div>
                      </div>
                    </div>
                  </summary>
                  <div className="border-t-2 border-[var(--border-strong)] p-[var(--panel-padding)]">
                    <YamlCodeBlock code={agentYaml(agent.name)} label={`pd-fleet.yml / ${agent.name}`} />
                  </div>
                </details>
              ))}
            </div>
          </SwissGridItem>
        </SwissGrid>
      </PageContainer>
    </section>
  )
}

function PlatformActors() {
  return (
    <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-8)] lg:py-[var(--space-9)]">
      <PageContainer width="wide">
        <SwissGrid className="gap-y-[var(--space-6)]">
          <SwissGridItem span="rail" className="space-y-[var(--space-4)]">
            <BracketLabel>Platform actors</BracketLabel>
            <PanelTitle as="h2" size="display">
              Some agents are roles, not templates.
            </PanelTitle>
            <PanelBody>
              These durable actors give the system addresses for roadmap truth, coordination,
              runtime provenance, docs drift, spend, and salvage.
            </PanelBody>
          </SwissGridItem>
          <SwissGridItem span="body">
            <div className="grid gap-[var(--panel-gap)] md:grid-cols-2">
              {ACTOR_ROLES.map((role) => (
                <SurfacePanel key={role.name} elevation="quiet" className="space-y-[var(--panel-gap)]">
                  <div className="flex items-start gap-[var(--panel-gap)]">
                    <IconBlock icon={role.icon} />
                    <div className="min-w-0 space-y-[var(--space-1)]">
                      <PanelEyebrow>{role.label}</PanelEyebrow>
                      <PanelTitle as="h3" size="nav">
                        <RoleTerm role={role.roleKey}>{role.name}</RoleTerm>
                      </PanelTitle>
                    </div>
                  </div>
                  <PanelBody size="compact" className="max-w-none">
                    {role.body}
                  </PanelBody>
                </SurfacePanel>
              ))}
            </div>
          </SwissGridItem>
        </SwissGrid>
      </PageContainer>
    </section>
  )
}

function OneOffs() {
  return (
    <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-8)] lg:py-[var(--space-9)]">
      <PageContainer width="wide">
        <SwissGrid className="gap-y-[var(--space-6)]">
          <SwissGridItem span="rail" className="space-y-[var(--space-4)]">
            <BracketLabel>One-offs</BracketLabel>
            <PanelTitle as="h2" size="display">
              Missions are separate from recurring work.
            </PanelTitle>
            <PanelBody>
              Use these when the task has a finish line. Promote the pattern into YAML only
              after it proves useful enough to repeat.
            </PanelBody>
          </SwissGridItem>
          <SwissGridItem span="body">
            <div className="grid gap-[var(--panel-gap)] lg:grid-cols-3">
              {ONE_OFFS.map((item) => (
                <SurfacePanel key={item.title} className="space-y-[var(--panel-gap)]">
                  <div className="flex items-start gap-[var(--panel-gap)]">
                    <IconBlock icon={item.icon} />
                    <div className="min-w-0 space-y-[var(--space-1)]">
                      <PanelEyebrow>{item.label}</PanelEyebrow>
                      <PanelTitle as="h3" size="nav">
                        {item.roleKey ? <RoleTerm role={item.roleKey}>{item.title}</RoleTerm> : item.title}
                      </PanelTitle>
                    </div>
                  </div>
                  <PanelBody size="compact" className="max-w-none">
                    {item.body}
                  </PanelBody>
                  <div className="block min-w-0 whitespace-pre-wrap break-words border border-[var(--border-default)] bg-[color:var(--surface-sunken)] px-[var(--space-3)] py-[var(--space-2)] font-mono text-[11px] font-semibold leading-relaxed text-[var(--brand-primary)] [overflow-wrap:anywhere]">
                    {item.command}
                  </div>
                </SurfacePanel>
              ))}
            </div>
          </SwissGridItem>
        </SwissGrid>
      </PageContainer>
    </section>
  )
}

function AgentsOverview() {
  return (
    <main className="min-h-screen bg-[var(--surface-base)] text-[var(--text-primary)]">
      <AgentSectionNav />
      <AgentHero />
      <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)]">
        <PageContainer width="wide">
          <div className="grid gap-[var(--panel-gap)] md:grid-cols-2">
            {AGENT_SECTIONS.filter((section) => section.slug !== 'agent-skill').map((section) => (
              <Link
                key={section.slug}
                to={`/agents/${section.slug}`}
                className="group grid overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)]"
              >
                <ThemedScreenshot source={section.image} alt="" className="aspect-[16/7] w-full object-cover" loading="lazy" />
                <div className="grid gap-[var(--space-3)] p-[var(--panel-padding)]">
                  <PanelEyebrow>{section.eyebrow}</PanelEyebrow>
                  <PanelTitle as="h2" size="card">
                    {section.nav}
                  </PanelTitle>
                  <PanelBody size="compact" className="max-w-none">
                    {section.summary}
                  </PanelBody>
                  <span className="inline-flex items-center gap-[var(--space-2)] font-sans text-sm font-semibold text-[var(--brand-primary)]">
                    Open section
                    <ArrowRight
                      className="h-[var(--space-3)] w-[var(--space-3)] transition-transform group-hover:translate-x-1"
                      strokeWidth={2.25}
                    />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </PageContainer>
      </section>
      <ConceptStrip />
      <AgentGrid />
      <PlatformActors />
      <OneOffs />
    </main>
  )
}

function SectionDetail({ section }: { section: AgentSection }) {
  return (
    <main className="min-h-screen bg-[var(--surface-base)] text-[var(--text-primary)]">
      <AgentSectionNav />
      <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
        <PageContainer width="wide">
          <div className="space-y-[var(--space-6)]">
              <div className="grid gap-[var(--panel-gap)] xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]">
                <SurfacePanel className="space-y-[var(--space-4)]">
                  <BracketLabel>{section.eyebrow}</BracketLabel>
                  <PanelTitle as="h1" size="hero" className="max-w-[13ch]">
                    {section.title}
                  </PanelTitle>
                  <PanelBody className="max-w-[48rem]">{section.summary}</PanelBody>
                </SurfacePanel>
                <figure className="m-0 overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
                  <ThemedScreenshot source={section.image} alt={section.alt} className="aspect-[16/9] w-full object-cover" loading="eager" />
                </figure>
                <figure className="m-0 overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] xl:col-span-2">
                  <img src={section.gif} alt="" className="aspect-[16/9] w-full object-cover" loading="lazy" />
                </figure>
              </div>

              <div className="grid gap-[var(--panel-gap)] xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.72fr)]">
                <SurfacePanel className="space-y-[var(--panel-gap)]">
                  <div className="flex items-center gap-[var(--panel-gap)]">
                    <IconBlock icon={Terminal} />
                    <PanelTitle as="h2" size="card">
                      Example code
                    </PanelTitle>
                  </div>
                  <DocsCodeBlock code={section.code} language="cli" label={section.codeLabel} />
                </SurfacePanel>

                <SurfacePanel tone="blue" className="space-y-[var(--panel-gap)]">
                  <BracketLabel tone="primary" surface="blue">
                    What to understand
                  </BracketLabel>
                  <div className="grid gap-[var(--space-3)]">
                    {section.bullets.map((bullet) => (
                      <div key={bullet} className="flex gap-[var(--space-2)]">
                        <Check className="mt-1 h-[var(--space-3)] w-[var(--space-3)] shrink-0" strokeWidth={2.5} />
                        <PanelBody size="compact" tone="primary" className="max-w-none">
                          {bullet}
                        </PanelBody>
                      </div>
                    ))}
                  </div>
                </SurfacePanel>
              </div>

              <div className="grid gap-[var(--panel-gap)] xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.72fr)]">
                <SurfacePanel elevation="quiet" className="space-y-[var(--panel-gap)]">
                  <BracketLabel>Theory</BracketLabel>
                  <PanelTitle as="h2" size="card">
                    Why this page exists
                  </PanelTitle>
                  <div className="space-y-[var(--space-3)]">
                    {(section.theory ?? []).map((paragraph) => (
                      <PanelBody key={paragraph} className="max-w-[56rem]">
                        {paragraph}
                      </PanelBody>
                    ))}
                  </div>
                </SurfacePanel>

                <SurfacePanel tone="accent" className="space-y-[var(--panel-gap)]">
                  <BracketLabel tone="accent" surface="accent">
                    Build now
                  </BracketLabel>
                  <PanelTitle as="h2" size="card" tone="accent">
                    Concrete examples
                  </PanelTitle>
                  <div className="grid gap-[var(--space-2)]">
                    {(section.builds ?? []).map((example) => (
                      <Link
                        key={example.href}
                        to={example.href}
                        className="group grid gap-[var(--space-1)] border-2 border-[var(--border-default)] bg-[var(--surface-base)] p-[var(--space-3)] text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-strong)]"
                      >
                        <span className="flex items-center justify-between gap-[var(--space-3)] font-sans text-sm font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                          {example.label}
                          <ArrowRight
                            className="h-[var(--space-3)] w-[var(--space-3)] shrink-0 transition-transform group-hover:translate-x-1"
                            strokeWidth={2.25}
                          />
                        </span>
                        <PanelBody size="compact" className="max-w-none">
                          {example.body}
                        </PanelBody>
                      </Link>
                    ))}
                  </div>
                </SurfacePanel>
              </div>

              {section.templatePacks?.length ? (
                <section id="template-packs" className="space-y-[var(--space-4)]">
                  <div className="max-w-[56rem] space-y-[var(--space-2)]">
                    <BracketLabel>Current template packs</BracketLabel>
                    <PanelTitle as="h2" size="card">
                      Checked-in patterns you can build from today.
                    </PanelTitle>
                    <PanelBody>
                      These entries mirror the files that exist in the repo now. They are examples of agent
                      coordination surfaces, not a separate top-level product area.
                    </PanelBody>
                  </div>
                  <div className="grid gap-[var(--panel-gap)] md:grid-cols-2">
                    {section.templatePacks.map((pack) => (
                      <SurfacePanel key={pack.path} elevation="quiet" className="space-y-[var(--panel-gap)]">
                        <div className="flex items-start gap-[var(--panel-gap)]">
                          <IconBlock icon={pack.icon} />
                          <div className="min-w-0 space-y-[var(--space-1)]">
                            <PanelEyebrow>{pack.label}</PanelEyebrow>
                            <PanelTitle as="h3" size="nav">
                              {pack.title}
                            </PanelTitle>
                          </div>
                        </div>
                        <PanelBody size="compact" className="max-w-none">
                          {pack.body}
                        </PanelBody>
                        <div className="flex flex-wrap gap-[var(--space-2)]">
                          {pack.tags.map((tag) => (
                            <span
                              key={`${pack.path}-${tag}`}
                              className="border border-[var(--border-default)] bg-[var(--surface-base)] px-[var(--space-2)] py-[var(--space-1)] font-sans text-[0.68rem] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                        <div className="border-2 border-[var(--border-default)] bg-[var(--surface-base)] p-[var(--space-3)]">
                          <PanelEyebrow>Path</PanelEyebrow>
                          <code className="mt-[var(--space-1)] block break-words font-mono text-[12px] font-semibold text-[var(--brand-primary)]">
                            {pack.path}
                          </code>
                        </div>
                        <div
                          role="textbox"
                          aria-label={`${pack.title} command example`}
                          className="m-0 min-w-0 overflow-auto whitespace-pre-wrap border-2 border-[var(--border-default)] p-[var(--space-3)] font-mono text-[12px] leading-relaxed"
                          style={{ background: 'var(--code-bg)', color: 'var(--code-text)' }}
                        >
                          <span>{pack.command}</span>
                        </div>
                      </SurfacePanel>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="space-y-[var(--space-4)]">
                <div className="space-y-[var(--space-2)]">
                  <BracketLabel>FleetBar and console</BracketLabel>
                  <PanelTitle as="h2" size="card">
                    Where to look in the product
                  </PanelTitle>
                </div>
                <div className="grid gap-[var(--panel-gap)] md:grid-cols-2">
                  {(section.screenshots ?? []).map((shot) => (
                    <Link
                      key={`${shot.href}-${shot.title}`}
                      to={shot.href}
                      className="group grid overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)]"
                    >
                      <ThemedScreenshot source={shot.image} alt="" className="aspect-[16/9] w-full object-cover" loading="eager" />
                      <div className="grid gap-[var(--space-2)] p-[var(--panel-padding)]">
                        <PanelEyebrow>{shot.label}</PanelEyebrow>
                        <span className="flex items-center justify-between gap-[var(--space-3)] font-sans text-sm font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                          {shot.title}
                          <ArrowRight
                            className="h-[var(--space-3)] w-[var(--space-3)] shrink-0 transition-transform group-hover:translate-x-1"
                            strokeWidth={2.25}
                          />
                        </span>
                        <PanelBody size="compact" className="max-w-none">
                          {shot.body}
                        </PanelBody>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>

              <SurfacePanel elevation="quiet" className="space-y-[var(--panel-gap)]">
                <div className="flex flex-wrap items-end justify-between gap-[var(--space-3)]">
                  <div className="space-y-[var(--space-2)]">
                    <BracketLabel>Read next in docs</BracketLabel>
                    <PanelTitle as="h2" size="card">
                      The documentation is the authoritative reference.
                    </PanelTitle>
                  </div>
                  <BracketLink to="/docs/reference" tone="accent">
                    Full reference
                  </BracketLink>
                </div>
                <div className="grid gap-[var(--panel-gap-tight)] md:grid-cols-2 xl:grid-cols-3">
                  {section.docs.map((doc) => (
                    <Link
                      key={doc.href}
                      to={doc.href}
                      className="group grid gap-[var(--space-2)] border-2 border-[var(--border-default)] bg-[var(--surface-base)] p-[var(--space-3)] text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-strong)]"
                    >
                      <span className="flex items-center justify-between gap-[var(--space-3)] font-sans text-sm font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                        {doc.label}
                        <ArrowRight
                          className="h-[var(--space-3)] w-[var(--space-3)] shrink-0 transition-transform group-hover:translate-x-1"
                          strokeWidth={2.25}
                        />
                      </span>
                      <PanelBody size="compact" className="max-w-none">
                        {doc.body}
                      </PanelBody>
                    </Link>
                  ))}
                </div>
              </SurfacePanel>
          </div>
        </PageContainer>
      </section>
    </main>
  )
}

export function AgentsPage() {
  const { section } = useParams()

  if (section === 'agent-skill') {
    return <Navigate to="/mcp" replace />
  }

  const matchedSection = section ? AGENT_SECTIONS.find((item) => item.slug === section) : null

  if (section && !matchedSection) {
    return <Navigate to="/agents" replace />
  }

  if (matchedSection) {
    return <SectionDetail section={matchedSection} />
  }

  return <AgentsOverview />
}
