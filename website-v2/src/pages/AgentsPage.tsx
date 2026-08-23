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
  FilePlus2,
  FileText,
  GitBranch,
  Hammer,
  Lightbulb,
  Route,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Terminal,
  UserPlus,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import fleetYaml from '../../../pd-fleet.yml?raw'
import { Button } from '@/components/ui/Button'
import {
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
import { AgentAnatomy } from '@/components/agents/AgentAnatomy'
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
    label: 'The file',
    title: 'Agents are declared in pd-fleet.yml',
    body: 'Fleet agents live in one file you can read. It says who wakes, why they wake, which model backend they use, and which channels connect them.',
    icon: Code2,
    tone: 'blue',
  },
  {
    label: 'Shipwright',
    title: 'Picks which agents a new repo needs',
    body: 'Shipwright is the helper that surveys a repo and suggests the few agents worth running, instead of dumping every possible role into a new project.',
    icon: Hammer,
    tone: 'accent',
  },
  {
    label: 'The role',
    title: 'A named job with an inbox of its own',
    body: 'A role keeps its inbox, history, notes, and ownership even when no agent is attached to it. Port Daddy calls this an actor.',
    icon: Boxes,
    tone: 'paper',
  },
  {
    label: 'The process',
    title: 'The agent running the role right now',
    body: 'A Claude, Codex, Ollama, Gemini, or Aider process is just the current body doing the role. It can crash without erasing the work.',
    icon: Activity,
    tone: 'paper',
  },
]

// The two STANDING actors — the only roles in lib/actor-roster.ts with
// compatibilityFleetAgent: null, i.e. durable mailboxes that exist whether or
// not a fleet agent is attached. (The earlier maritime cast — Navigator,
// Lookout, Signalman, Harbormaster, Sounder — was not in the roster; the
// responsibilities they named are owned by real fleet agents shown above:
// cartographer keeps the map, documentarian catches drift, qa checks evidence.)
const ACTOR_ROLES: ActorRole[] = [
  {
    name: 'Coxswain',
    roleKey: 'coxswain',
    label: 'Owns claims, locks, and comms',
    body: 'One durable mailbox for coordination: file claims, locks, stale assets, session contention, plus the live comms fabric (channels, tuples, naming hygiene, subscription coverage, silent-agent detection). Reach it at pd actor coxswain whether or not any fleet agent is running.',
    icon: FileLock2,
  },
  {
    name: 'Quartermaster',
    roleKey: 'quartermaster',
    label: 'Owns spend, backends, launch-readiness',
    body: 'Owns spawn discipline, backend readiness, model ladders, telemetry policy, budget ceilings, and spend-related launch blockers. Reachable at pd actor quartermaster; like Coxswain, it persists across runs.',
    icon: Wallet,
  },
]

const FLEET_AGENTS: FleetAgent[] = [
  {
    name: 'gardener',
    roleKey: 'gardener',
    wakes: 'git:committed',
    work: 'After every commit, audits the worktree for anything that looks abandoned, suspicious, or committed by accident, and opens a GitHub issue when it finds something real.',
    runtime: 'cli:claude-code, then codex, then Cloudflare qwen3',
    image: '/img/agents/health-monitor.webp',
    magic: 'It keeps the worktree\'s cleanliness visible to you, so a cold open of the repo never hides a stray binary or stale stash.',
    icon: GitBranch,
  },
  {
    name: 'qa',
    roleKey: 'qa',
    wakes: 'pull_request:opened',
    work: 'Reads every changed file in the PR, names the inputs that would break each change, and audits the tests for tautologies, mock echoes, and missing failure paths.',
    runtime: 'cli:claude-code, then codex, then OpenAI gpt-5-mini',
    image: '/img/agents/qa.webp',
    magic: 'It exists to find the bug the PR would otherwise merge, and stays silent when there isn\'t one.',
    icon: CheckCircle2,
  },
  {
    name: 'test-hunter',
    roleKey: 'test-hunter',
    wakes: 'git:committed',
    work: 'Runs the suite with coverage and opens a coverage-gap issue for each touched module that left a real branch untested. It does not write the tests itself.',
    runtime: 'cli:claude-code, then codex, then Cloudflare qwen-coder',
    image: '/img/agents/session-reaper.webp',
    magic: 'It turns coverage gaps into specific, deduped GitHub issues instead of a guilt-inducing percentage.',
    icon: FileCheck2,
  },
  {
    name: 'documentarian',
    roleKey: 'documentarian',
    wakes: 'promotion:release-surfaces',
    work: 'When a build passes the test gate, it checks every release surface, README, docs, SDK, OpenAPI, website, and the Port Daddy skill, against the code and opens a draft PR for the drift it can fix.',
    runtime: 'cli:claude-code, then codex, then Cloudflare qwen-coder',
    image: '/img/agents/documentarian.webp',
    magic: 'It wakes at the release moment, the one time docs drift is both easiest to spot and most expensive to miss, and keeps every surface honest against runtime truth.',
    icon: FileText,
  },
  {
    name: 'simplifier',
    roleKey: 'simplifier',
    wakes: 'git:committed (paused)',
    work: 'Reviews recent changes for needless complexity and proposes a behavior-preserving cleanup as a draft PR. Paused until you ask for a pass on a specific surface.',
    runtime: 'cli:claude-code, then codex, then Cloudflare qwen-coder',
    image: '/img/agents/dep-watcher.webp',
    magic: 'It removes complexity without changing behavior, but stays off by default because without a scope it just reads the whole tree and burns tokens.',
    icon: Wrench,
  },
  {
    name: 'cartographer',
    roleKey: 'cartographer',
    wakes: 'every 30 min',
    work: 'Reads the roadmap, recovery docs, dogfood feedback, and recent commits, then updates what is built, blocked, or drifting and writes a snapshot to a side branch.',
    runtime: 'cli:claude-code, then codex, then Cloudflare qwen3',
    image: '/img/agents/cartographer.webp',
    magic: 'It keeps the roadmap, the recovery queue, and the live work map aligned even when several agents are shipping at once, and it never rewrites your roadmap\'s voice.',
    icon: Compass,
  },
  {
    name: 'spark',
    roleKey: 'spark',
    wakes: 'git:committed (paused)',
    work: 'Proposes one novel, buildable improvement with traceable lineage, deduped against the idea trove. Paused while execution, not ideation, is the bottleneck.',
    runtime: 'cli:claude-code, then codex, then Cloudflare kimi-k2',
    image: '/img/agents/spark.webp',
    magic: 'It makes ideas durable enough to dedupe instead of evaporating into chat, and it is the one ship that writes to files for other agents rather than to GitHub.',
    icon: Sparkles,
  },
  {
    name: 'spider',
    roleKey: 'spider',
    wakes: 'spark:idea, every 2h',
    work: 'Reads the manifest, roadmap, code headers, and recent ideas, then writes one to three syllogisms connecting features no one has noticed belong together.',
    runtime: 'cli:claude-code, then codex, then Cloudflare qwen3',
    image: '/img/agents/spider.webp',
    magic: 'It finds surprising feature connections without inventing novelty, feeding the cartographer instead of the operator.',
    icon: Lightbulb,
  },
  {
    name: 'code-reviewer',
    roleKey: 'code-reviewer',
    wakes: 'pull_request:opened',
    image: '/img/agents/code-reviewer.webp',
    work: 'Reads the PR diff against your stated priors and the ADRs governing the changed files, then posts one severity-ranked comment, editing it in place on re-review.',
    runtime: 'cli:claude-code, then codex, then anthropic haiku (soft), OpenAI gpt-5-mini, or Cloudflare qwen-coder',
    magic: 'It catches the bugs the diff would otherwise ship and cites the ADR or line that proves it, and "looks good" is silence, not a comment.',
    icon: Code2,
  },
  {
    name: 'red-team',
    roleKey: 'red-team',
    wakes: 'pull_request:opened',
    image: '/img/agents/red-team.webp',
    work: 'On PRs that touch auth, capabilities, secrets, bonds, or crypto, it constructs real attacks: capability escalation, replay, race, cost overrun, auth bypass.',
    runtime: 'cli:claude-code, then codex, then anthropic sonnet (soft), OpenAI, or Cloudflare',
    magic: 'It tries to break the diff and comments only when an attack actually lands. Silence means it could not.',
    icon: ShieldCheck,
  },
  {
    name: 'test-author',
    roleKey: 'test-author',
    wakes: 'pull_request:opened',
    image: '/img/agents/test-author.webp',
    work: 'When test-hunter has flagged a gap for this PR, it writes real tests in a worktree, runs them green, and opens a draft sibling PR linked back to the original.',
    runtime: 'cli:claude-code, then codex, then anthropic haiku (soft), OpenAI gpt-5-mini, or Cloudflare qwen-coder',
    magic: 'It authors tests for coverage gaps as draft siblings you can accept or reject, never tautologies, because the tautology-sniffer would catch those.',
    icon: FilePlus2,
  },
  {
    name: 'tautology-sniffer',
    roleKey: 'tautology-sniffer',
    wakes: 'pull_request:opened',
    image: '/img/agents/tautology-sniffer.webp',
    work: 'On PRs that touch test files, it scores each test on a tautology axis, mocks everything, asserts the mock\'s own return, no fixture anchor, and flags the worst with rewrites.',
    runtime: 'cli:claude-code, then codex, then OpenAI gpt-5-mini, or Cloudflare qwen-coder',
    magic: 'It surfaces tests that pin the implementation to its own assumptions, the kind that pass no matter how broken the code is.',
    icon: ScanSearch,
  },
  {
    name: 'tenderfoot',
    roleKey: 'tenderfoot',
    wakes: 'pull_request:merged, Mondays 8am',
    image: '/img/agents/tenderfoot.webp',
    work: 'Walks the repo as a brand-new developer: reads the README, follows every code example, compares manifest claims to the binary, and files an issue wherever the docs lie.',
    runtime: 'cli:claude-code, then codex, then anthropic haiku (soft), OpenAI gpt-5-mini, or Cloudflare qwen3',
    magic: 'It catches drift between what we tell new operators and what the binary actually does, and dedupes hard so it does not refile the same gripe every Monday.',
    icon: BookOpen,
  },
  {
    name: 'developer-onboarding-sentinel',
    roleKey: 'developer-onboarding-sentinel',
    wakes: 'schedule: daily',
    image: '/img/agents/onboarding-sentinel.webp',
    work: 'Once a day it adopts a different developer persona and OS, then tries to install and use Port Daddy from scratch on a real public repo, filing issues for every install failure.',
    runtime: 'cli:claude-code, then codex, then Cloudflare qwen3',
    magic: 'It owns one question, can any developer on any machine install Port Daddy in under five minutes, and rotates personas so the answer stays honest beyond the author\'s laptop.',
    icon: UserPlus,
  },
]

const ONE_OFFS: OneOff[] = [
  {
    title: 'pd spawn',
    label: 'Hand off one bounded task',
    body: 'Port Daddy launches one supervised run with backend preflight, budget, transcripts, and salvage state. Nothing stays resident afterward.',
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
    icon: FileCheck2,
  },
  {
    title: 'Always-On Dispatcher',
    label: 'Kernel agent',
    path: 'templates/always-on-dispatcher/README.md',
    body: 'A long-lived dispatcher pattern for routing build, security, and performance events to the right handler while leaving an audit trail in session notes.',
    command: `pd begin --identity dispatcher:kernel --lifecycle durable
pd watch build:failed --exec "pd agent 'inspect build failure and leave a note'"
pd notes --limit 10`,
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
    icon: ShieldCheck,
  },
  {
    title: 'Swarm Researcher',
    label: 'Research graph',
    path: 'templates/swarm-researcher/README.md',
    body: 'A search, scrape, and synthesis triad that uses channels for work events, locks for shared stores, and notes for the final claim-backed report trail.',
    command: `pd pub research:start '{"topic":"port-daddy agent coordination"}'
pd lock acquire research-cache
pd note "Research synthesis: sources, open questions, next build"`,
    icon: Lightbulb,
  },
  {
    title: 'Encrypted Messenger',
    label: 'Secure primitive',
    path: 'templates/encrypted-messenger/messenger.ts',
    body: 'A TypeScript example for secure local message exchange when the thing you are building needs agent-to-agent transport as a real primitive, not a hand-waved chat log.',
    command: `tsx templates/encrypted-messenger/messenger.ts
pd pub secure:message '{"to":"qa","topic":"review-ready"}'`,
    icon: Database,
  },
]

const FLOW_SCREENSHOT: ThemedImage = {
  light: '/img/app-screens/fleet-flow-light.webp',
  dark: '/img/app-screens/fleet-flow.webp',
}

const RESOURCES_SCREENSHOT: ThemedImage = {
  light: '/img/app-screens/resources-light.webp',
  dark: '/img/app-screens/resources.webp',
}

const FLEETBAR_SCREENSHOT: ThemedImage = {
  light: '/img/app-screens/fleetbar-native-shell-light.webp',
  dark: '/img/app-screens/fleetbar-native-shell-dark.webp',
}

const SHIPWRIGHT_CONTROL_SCREENSHOT: ThemedImage = {
  light: '/img/app-screens/shipwright-control-light.webp',
  dark: '/img/app-screens/shipwright-control-dark.webp',
}

const SORTIES_SCREENSHOT: ThemedImage = {
  light: '/img/app-screens/sorties-light.webp',
  dark: '/img/app-screens/sorties-dark.webp',
}

const AGENT_SECTIONS: AgentSection[] = [
  {
    slug: 'flow',
    nav: 'Flow',
    title: 'Flow shows what every agent is doing, on one screen.',
    eyebrow: 'Fleet Control Center',
    summary:
      'When a repo has several agents running, Flow puts them on one screen: who woke who, what each is spending, whether the commit guard is on, and what just happened. You read it instead of stitching together ten terminal windows.',
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
      'A terminal is bad at one question: what is happening across this repo right now? Flow answers it. The graph, the launch controls, the budget, the guard state, the agent list, and the recent history sit next to each other, so you read one screen instead of ten command outputs.',
      'The left side is a map of relationships: who wakes who, which events flow between agents, and whether the wiring looks tangled. The right side is the controls: stop the fleet, open Agents, read the YAML, check the commit guard, change the daily spending cap, and scroll the history of sessions, notes, events, and files that moved.',
      'That makes Flow the screen to check before you add more automation. If the map is tangled, the budget is zero, the guard is off, or the history is noisy, you can see it before another agent starts spending money or editing files.',
      'Use Flow when a repo feels busy in a way you cannot quite track. It gives the fleet a shape: events stop being invisible, recurring agents stop being guesswork, and recent activity stops being a pile of scattered logs.',
    ],
    bullets: [
      'The map and the controls live on the same screen, not on separate pages.',
      'The map shows which events connect agents; the panel shows budget, guard state, and what is ready to run.',
      'A running history keeps sessions, notes, events, and file changes visible while the map explains why each agent woke up.',
      'It is where you pause the fleet, read the YAML, jump to Agents, and decide whether more work should start.',
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
      { label: 'Channels feature', href: '/docs/features/radio', body: 'See the publish/subscribe layer behind the Flow map.' },
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
    code: `pd begin "patch the route timeout" --lifecycle durable
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
    title: 'Resources keeps the fleet from outrunning your Mac.',
    eyebrow: 'Resource governance',
    summary:
      'The Resources screen tracks memory, disk, ports, local model processes, and spend. Before Port Daddy asks to run more agents at once, it checks that the machine, the budget, and the backends can take it.',
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
      'A fleet that ignores the machine turns a laptop into a space heater. Resources tracks what agents actually use: which backends are working, what each model costs, local model processes, memory, disk, ports, and the daily spending cap you set for this project.',
      'It suggests, it does not act. Resources can say "this machine looks like it could handle more" without raising the limit on its own. You stay in control, and the agents get an honest read on how much room is left.',
      'This matters because staying out of each other\'s files is not the whole story. Two agents can edit different files and still overload the machine, burn the budget, or kick off more work than the repo can absorb. Strain on the machine is its own kind of collision.',
      'In practice this is what the Quartermaster role watches: how many agents can run, the suggested cap, the last day of spend, free memory, disk space, and port pressure, all in one place you and an agent can look at before adding more.',
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
    title: 'Agents start as a file. Shipwright helps you choose which ones.',
    eyebrow: 'How agents are defined',
    summary:
      'pd-fleet.yml is the file that defines your agents. Shipwright is the helper that reads a new repo and suggests the few agents worth running, so you do not install every possible role on day one.',
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
        body: 'FleetBar is the Mac menu-bar entry point that opens the full app, not a stripped-down dashboard.',
      },
    ],
    builds: [
      {
        label: 'Bootstrap a project fleet',
        href: '/tutorials/fleet',
        body: 'Build the first pd-fleet.yml and learn when recurring automation is better than one spawned task.',
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
      'The old top-level Templates library is deprecated. Current templates are agent operating patterns: starter YAML, always-on fleets, CI repair loops, event ops, research swarms, and secure messaging primitives.',
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
      'YAML templates are for recurring agents; one-off work belongs in pd spawn.',
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
    alt: 'Generated image of Port Daddy coordination primitives around the local app',
    codeLabel: 'Install and use the skill',
    code: `# The skill ships in the Port Daddy package beside the pd binary.
ls skills/port-daddy-agent-skill
python3 skills/port-daddy-agent-skill/scripts/validate_port_daddy_agent_skill.py skills/port-daddy-agent-skill

# The operating loop it teaches agents:
pd status
pd briefing
pd begin "finish the bounded slice" --lifecycle durable
pd note "Scope, files, assumptions, validation plan"
pd session files add website-v2/src/pages/AgentsPage.tsx
pd guard check --staged`,
    theory: [
      'Most agent failures are not model failures. They are coordination failures: stale runtime assumptions, invisible edit intent, ambiguous ownership, missing validation, or a handoff that reads like a vibe instead of an audit trail. The Port Daddy agent skill turns those hazards into a repeatable loop.',
      'The skill is more than a prompt. It is a field manual with references, diagrams, schemas, scripts, templates, and examples. An agent loads the short SKILL.md first, then pulls the deeper guidance only when the task calls for it, like recovering dead work, claiming files, or checking the running daemon.',
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
        body: 'Fleet Control Center is where the skill points agents for project-level truth: active work, activity, resources, spawned runs, and YAML.',
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
      'Coxswain and Quartermaster remain addressable even when no live model process is attached — and every fleet agent keeps its own actor inbox too.',
    image: '/img/generated/virtual-actor-fleet.webp',
    gif: '/gifs/agents/virtual-actors.gif',
    alt: 'Generated image of durable virtual actors connected to temporary runtime bodies',
    codeLabel: 'Actor inboxes',
    code: `pd actors --project port-daddy
pd actor coxswain --inbox --unread
pd actor quartermaster --message "Budget check before the next spawn"
pd actor cartographer --message "Roadmap drifted from what shipped; re-map" --wake
pd notes --limit 10`,
    theory: [
      'A durable actor is a role with memory, addressability, and responsibility. A model process is just one possible body for that role, which is why a dead body does not erase the inbox, session notes, or ownership trail.',
      'This is the move that lets multi-agent work become operational instead of theatrical. You can ask Cartographer for the map, Documentarian for docs drift, and Coxswain for contention without pretending all of them are currently alive in the same chat window.',
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
    title: 'One background process holds the shared state every agent reads.',
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
      'What the code says and what is running are two different things. A route can exist in your checkout while FleetBar still talks to an older installed daemon, and the pd command can point at a different install than the process serving the app.',
      'That background process is where coordination actually lives. It holds the sessions, locks, shared facts, channels, ports, and fleet state, plus the record an agent leaves behind when its process disappears.',
    ],
    bullets: [
      'One process owns ports, sessions, locks, inboxes, shared facts, channels, and fleet state.',
      'FleetBar and the browser app should be reading from that same process.',
      'A clean checkout is not automatically the version that is installed and running.',
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
pd inbox send cartographer "Roadmap changed; please reconcile the recovery ledger"
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
    title: 'Agents announce what they are about to touch, so overlap is visible early.',
    eyebrow: 'Claims, locks, guard',
    summary:
      'An agent announces the files it plans to edit before it edits them. Claims are advisory, so they do not block anyone; they make overlap visible early enough to route around. Locks are the exception, reserved for things that cannot be merged.',
    image: '/img/generated/coordination-guard.webp',
    gif: '/gifs/agents/coordination.gif',
    alt: 'Generated image of a coordination guard protecting file claims and critical sections',
    codeLabel: 'Edit discipline',
    code: `pd begin "fix fleet route timeout" --lifecycle durable
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
        title: 'Spawned runs',
        href: '/mac-preview',
        image: SORTIES_SCREENSHOT,
        body: 'Spawned run history is the complement to recurring fleet work when a bounded task needs status and evidence.',
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
        <PanelEyebrow>{label}</PanelEyebrow>
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
        className="m-0 max-h-[32rem] min-w-0 overflow-auto border-2 border-[var(--border-strong)] bg-[var(--code-bg)] px-[var(--space-4)] py-[var(--space-4)] font-mono text-[length:var(--type-meta-size)] leading-[1.6] text-[var(--code-text)]"
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
            <PanelEyebrow>Agents</PanelEyebrow>
            <div className="space-y-[var(--space-4)]">
              <PanelTitle as="h1" size="hero" className="max-w-[14ch]">
                Run a fleet of coding agents without losing track.
              </PanelTitle>
              <PanelBody className="max-w-[40rem]">
                You have more than one coding agent running on your machine. Port Daddy keeps the
                record so you can see who is working where, read what the others learned, and pick
                up tasks that died mid-run. Each agent is described in a file you can read, not
                hidden behind a button.
              </PanelBody>
              <PanelBody className="max-w-[40rem]">
                The cards below are the agents in Port Daddy's own pd-fleet.yml right now. Every one
                says when it wakes, which backend it prefers, and what it does when it finds
                something, usually a GitHub issue or an edited-in-place PR comment, never a silent
                change. Most of them sit quiet until a commit lands or a pull request opens.
              </PanelBody>
              <PanelBody className="max-w-[40rem]">
                Start with Flow to see everything at once. Reach for Coordination Guard when a
                commit needs proof of who touched what. Open Smart Resources when the machine,
                the budget, or a model backend is the thing slowing you down.
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
          <PanelEyebrow>The whole idea in four parts</PanelEyebrow>
          <PanelTitle as="h2" size="display">
            How an agent fleet fits together.
          </PanelTitle>
          <PanelBody>
            Read these four cards and the rest of the page makes sense. A file declares each agent,
            a helper picks which ones a repo needs, the role outlives the process running it, and a
            crashed process does not erase the work.
          </PanelBody>
        </div>
        <div className="grid gap-[var(--panel-gap)] md:grid-cols-2 xl:grid-cols-4">
          {CONCEPTS.map((concept) => {
            const panelTone = concept.tone === 'blue' ? 'primary' : concept.tone === 'accent' ? 'accent' : 'default'
            const Icon = concept.icon
            return (
              <SurfacePanel key={concept.label} tone={concept.tone} className="space-y-[var(--panel-gap)]">
                <div className="flex items-center justify-between gap-[var(--panel-gap)]">
                  <PanelEyebrow tone={panelTone}>
                    {concept.label}
                  </PanelEyebrow>
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
            <PanelEyebrow>Example fleet</PanelEyebrow>
            <PanelTitle as="h2" size="display">
              Click an agent to read its YAML.
            </PanelTitle>
            <PanelBody>
              This is Port Daddy's own fleet, not a checklist for yours. The review ships,
              code-reviewer, red-team, qa, test-author, and tautology-sniffer, wake on pull requests;
              gardener and test-hunter wake on commits; cartographer and the onboarding sentinel run
              on a clock. A new repo rarely wants all of them on day one. Shipwright, the helper that
              picks agents for a new repo, sorts that out for you.
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
            <PanelEyebrow>Standing roles</PanelEyebrow>
            <PanelTitle as="h2" size="display">
              Two roles stay addressable, fleet or no fleet.
            </PanelTitle>
            <PanelBody>
              The fleet agents above each have their own actor inbox, but two roles have no fleet
              agent behind them at all — Coxswain owns claims, locks, and the comms fabric;
              Quartermaster owns spend, backends, and launch-readiness. They are durable mailboxes
              you can always reach with <code className="font-mono text-[var(--brand-primary)]">pd actor</code>,
              whether or not anything is currently running.
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
            <PanelEyebrow>One-offs</PanelEyebrow>
            <PanelTitle as="h2" size="display">
              A single task with a finish line.
            </PanelTitle>
            <PanelBody>
              Use these when you want one job done, not a standing agent. If you find yourself
              running the same one over and over, move it into pd-fleet.yml so it wakes on its own.
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
                  <div className="block min-w-0 whitespace-pre-wrap break-words border border-[var(--border-default)] bg-[color:var(--surface-sunken)] px-[var(--space-3)] py-[var(--space-2)] font-mono text-[length:var(--type-meta-size)] font-semibold leading-relaxed text-[var(--brand-primary)] [overflow-wrap:anywhere]">
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

/** One section card — shared by the "Start here" row and the "More" grid. */
function SectionCard({ section, headingAs = 'h2' }: { section: AgentSection; headingAs?: 'h2' | 'h3' }) {
  return (
    <Link
      to={`/agents/${section.slug}`}
      className="group grid overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)]"
    >
      <ThemedScreenshot source={section.image} alt="" className="aspect-[16/7] w-full object-cover" loading="lazy" />
      <div className="grid gap-[var(--space-3)] p-[var(--panel-padding)]">
        <PanelEyebrow>{section.eyebrow}</PanelEyebrow>
        <PanelTitle as={headingAs} size="card">
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
  )
}

const PRIORITY_SECTION_SLUGS = ['flow', 'coordination-guard', 'smart-resources']

function AgentsOverview() {
  const sections = AGENT_SECTIONS.filter((section) => section.slug !== 'agent-skill')
  const priority = PRIORITY_SECTION_SLUGS.map((slug) => sections.find((s) => s.slug === slug)).filter(
    (s): s is AgentSection => Boolean(s),
  )
  const rest = sections.filter((s) => !PRIORITY_SECTION_SLUGS.includes(s.slug))

  return (
    <main className="min-h-screen bg-[var(--surface-base)] text-[var(--text-primary)]">
      <AgentSectionNav />
      <AgentHero />

      {/* Start here — the three entry points the hero recommends, promoted out
          of the long section wall so a first-time reader has an obvious move. */}
      <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)]">
        <PageContainer width="wide">
          <div className="mb-[var(--space-4)] flex flex-col gap-[var(--space-1)]">
            <PanelEyebrow>Start here</PanelEyebrow>
            <PanelTitle as="h2" size="display" className="max-w-[26ch]">
              Three places that pay off first.
            </PanelTitle>
          </div>
          <div className="grid gap-[var(--panel-gap)] md:grid-cols-3">
            {priority.map((section) => (
              <SectionCard key={section.slug} section={section} />
            ))}
          </div>
        </PageContainer>
      </section>

      {/* Everything else. */}
      <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)]">
        <PageContainer width="wide">
          <PanelEyebrow className="mb-[var(--space-4)] block">The rest of the surfaces</PanelEyebrow>
          <div className="grid gap-[var(--panel-gap)] md:grid-cols-2">
            {rest.map((section) => (
              <SectionCard key={section.slug} section={section} headingAs="h3" />
            ))}
          </div>
        </PageContainer>
      </section>

      <ConceptStrip />
      <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
        <PageContainer width="wide">
          <AgentAnatomy />
        </PageContainer>
      </section>
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
              {/* Lead with the live GIF (the static shot is already the
                  overview card thumbnail — no need to stack both here). */}
              <div className="grid gap-[var(--panel-gap)] xl:grid-cols-[minmax(0,1fr)_minmax(24rem,1fr)] xl:items-center">
                <SurfacePanel className="space-y-[var(--space-4)]">
                  <PanelEyebrow>{section.eyebrow}</PanelEyebrow>
                  <PanelTitle as="h1" size="hero" className="max-w-[13ch]">
                    {section.title}
                  </PanelTitle>
                  <PanelBody className="max-w-[48rem]">{section.summary}</PanelBody>
                </SurfacePanel>
                <figure className="m-0 overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
                  <img src={section.gif} alt={section.alt} className="aspect-[16/9] w-full object-cover" loading="eager" />
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
                  <PanelEyebrow tone="primary">
                    The short version
                  </PanelEyebrow>
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
                  <PanelEyebrow>Why it works this way</PanelEyebrow>
                  <PanelTitle as="h2" size="card">
                    The reasoning behind it
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
                  <PanelEyebrow tone="accent">
                    Build now
                  </PanelEyebrow>
                  <PanelTitle as="h2" size="card" tone="accent">
                    Try it on something real
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
                    <PanelEyebrow>Template packs</PanelEyebrow>
                    <PanelTitle as="h2" size="card">
                      Starting points you can copy today.
                    </PanelTitle>
                    <PanelBody>
                      Each pack is a real file in the repo. Copy it, validate it, and keep only the
                      agents your project needs. These are starting points, not a separate product.
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
                        <div className="border-2 border-[var(--border-default)] bg-[var(--surface-base)] p-[var(--space-3)]">
                          <PanelEyebrow>Path</PanelEyebrow>
                          <code className="mt-[var(--space-1)] block break-words font-mono text-[length:var(--type-meta-size)] font-semibold text-[var(--brand-primary)]">
                            {pack.path}
                          </code>
                        </div>
                        <div
                          role="textbox"
                          aria-label={`${pack.title} command example`}
                          className="m-0 min-w-0 overflow-auto whitespace-pre-wrap border-2 border-[var(--border-default)] bg-[var(--code-bg)] p-[var(--space-3)] font-mono text-[length:var(--type-meta-size)] leading-relaxed text-[var(--code-text)]"
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
                  <PanelEyebrow>FleetBar and console</PanelEyebrow>
                  <PanelTitle as="h2" size="card">
                    Where to find this in the app
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
                    <PanelEyebrow>Read next in docs</PanelEyebrow>
                    <PanelTitle as="h2" size="card">
                      The docs are the full reference.
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
    return <Navigate to="/mac-preview" replace />
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
