import { useId, type ReactNode } from 'react'

type RoleDefinition = {
  name: string
  category: string
  short: string
  detail: string
}

const ROLE_DEFINITIONS: Record<string, RoleDefinition> = {
  shipwright: {
    name: 'Shipwright',
    category: 'Fleet designer',
    short: 'Designs a repo-specific fleet.',
    detail: 'Surveys a project, proposes agents, budgets, triggers, and rehearsal paths, then points the operator toward Flow, Agents, and YAML.',
  },
  cartographer: {
    name: 'Cartographer',
    category: 'Fleet template',
    short: 'Turns roadmap drift into visible status.',
    detail: 'Reads roadmap, recovery notes, dogfood feedback, and recent commits, then updates what is built, blocked, or drifting.',
  },
  coxswain: {
    name: 'Coxswain',
    category: 'Platform actor',
    short: 'Coordinates claims and locks.',
    detail: 'Watches file ownership, symbol claims, stale assets, and coordination mismatches before parallel agents collide.',
  },
  documentarian: {
    name: 'Documentarian',
    category: 'Fleet template',
    short: 'Keeps docs in sync after release gates.',
    detail: 'Updates release materials when source behavior changes: README, docs, SDK, OpenAPI, website, and skills.',
  },
  quartermaster: {
    name: 'Quartermaster',
    category: 'Platform actor',
    short: 'Governs spend and launch pressure.',
    detail: 'Owns budget ceilings, backend readiness, model tiers, spawn discipline, and resource pressure.',
  },
  qa: {
    name: 'QA',
    category: 'Fleet template',
    short: 'Reviews commits for real failure modes.',
    detail: 'Looks for bugs, weak tests, missing negative paths, and evidence that would fail against no-op code.',
  },
  gardener: {
    name: 'Gardener',
    category: 'Fleet template',
    short: 'Reports repo ground truth.',
    detail: 'Runs simple local checks such as git status so the fleet knows whether the tree is clean or dirty.',
  },
  'test-hunter': {
    name: 'Test Hunter',
    category: 'Fleet template',
    short: 'Finds and fills meaningful test gaps.',
    detail: 'Adds tests for real behavior, especially negative paths and low-coverage modules.',
  },
  simplifier: {
    name: 'Simplifier',
    category: 'Fleet template',
    short: 'Removes unnecessary complexity.',
    detail: 'Simplifies recent changes without changing behavior, then verifies the result.',
  },
  spark: {
    name: 'Spark',
    category: 'Fleet template',
    short: 'Proposes one concrete improvement.',
    detail: 'Dedupes against the idea trove before writing a small, buildable proposal.',
  },
  spider: {
    name: 'Spider',
    category: 'Fleet template',
    short: 'Finds connections between features.',
    detail: 'Combines existing capabilities into new scoped implementation ideas, with provenance.',
  },
  'code-reviewer': {
    name: 'Code Reviewer',
    category: 'Fleet template',
    short: 'Reviews PR diffs against priors and ADRs.',
    detail: 'Reads the diff, your operator priors, and the governing ADRs, then posts one severity-ranked comment, edited in place. "Looks good" is silence.',
  },
  'red-team': {
    name: 'Red Team',
    category: 'Fleet template',
    short: 'Attacks security-sensitive diffs.',
    detail: 'Fires only on diffs touching auth, capabilities, secrets, bonds, or crypto. Constructs real attacks and comments only when one lands.',
  },
  'test-author': {
    name: 'Test Author',
    category: 'Fleet template',
    short: 'Writes tests for flagged coverage gaps.',
    detail: 'When test-hunter flags a gap for a PR, it writes real tests in a worktree, runs them green, and opens a draft sibling PR. Never tautologies.',
  },
  'tautology-sniffer': {
    name: 'Tautology Sniffer',
    category: 'Fleet template',
    short: 'Catches tests that prove nothing.',
    detail: 'Scores tests on a tautology axis and flags the ones that pin the implementation to its own assumptions, the kind that pass no matter how broken the code is.',
  },
  tenderfoot: {
    name: 'Tenderfoot',
    category: 'Fleet template',
    short: 'Reads the repo as a first-time developer.',
    detail: 'Follows the README and examples as a brand-new dev, then files an issue wherever the docs lie or the binary contradicts them. Dedupes hard.',
  },
  'developer-onboarding-sentinel': {
    name: 'Developer Onboarding Sentinel',
    category: 'Fleet watcher',
    short: 'Tests install realism daily.',
    detail: 'Rotates through developer personas and operating systems, tries to install Port Daddy from scratch on real public repos, and files issues for every failure.',
  },
  spawn: {
    name: 'Spawn',
    category: 'One-off run',
    short: 'A tracked, budgeted run.',
    detail: 'Use it for one explicit goal with a backend, model, budget, transcript, and result.',
  },
  fleet: {
    name: 'Fleet',
    category: 'Recurring repo automation',
    short: 'A declared team for one project.',
    detail: 'A pd-fleet.yml defines agents, triggers, schedules, singleton rules, budgets, and channels.',
  },
}

function getRoleDefinition(role: string): RoleDefinition | undefined {
  const normalized = role
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-agent$/, '')

  return ROLE_DEFINITIONS[normalized] ?? ROLE_DEFINITIONS[normalized.replace(/s$/, '')]
}

export function RoleTerm({
  role,
  children,
  className,
  tooltipAlign = 'start',
}: {
  role: string
  children?: ReactNode
  className?: string
  tooltipAlign?: 'start' | 'center' | 'end'
}) {
  const definition = getRoleDefinition(role)
  const label = children ?? definition?.name ?? role
  const reactId = useId()

  if (!definition) {
    return <span className={className}>{label}</span>
  }

  const tooltipId = `role-term-${role.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}-${reactId.replace(/[^a-z0-9-]+/gi, '')}`
  const tooltipAlignClass = {
    start: 'left-0',
    center: 'left-1/2 -translate-x-1/2',
    end: 'left-0 md:left-auto md:right-0',
  }[tooltipAlign]

  return (
    <span className={`group relative inline-flex align-baseline ${className ?? ''}`}>
      <button
        type="button"
        aria-describedby={tooltipId}
        className="cursor-help border-b-2 border-[var(--brand-primary)] bg-transparent p-0 [font:inherit] font-semibold text-[var(--text-primary)] underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus)]"
      >
        {label}
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className={`pointer-events-none absolute top-[calc(100%+var(--space-2))] z-[80] hidden w-[min(18rem,calc(100vw-var(--space-6)))] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-3)] text-left shadow-none group-focus-within:block group-hover:block ${tooltipAlignClass}`}
      >
        <span className="block font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
          {definition.category}
        </span>
        <span className="mt-[var(--space-1)] block font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] text-[var(--text-primary)]">
          {definition.name}: {definition.short}
        </span>
        <span className="mt-[var(--space-2)] block font-sans text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
          {definition.detail}
        </span>
      </span>
    </span>
  )
}
