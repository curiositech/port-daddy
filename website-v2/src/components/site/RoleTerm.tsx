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
    category: 'Platform actor',
    short: 'Designs a repo-specific fleet.',
    detail: 'Surveys a project, proposes agents, budgets, triggers, and rehearsal paths, then points the operator toward Flow, Agents, and YAML.',
  },
  navigator: {
    name: 'Navigator',
    category: 'Platform actor',
    short: 'Owns the roadmap and recovery map.',
    detail: 'Keeps planned work, current work, recovery docs, and shipped reality aligned.',
  },
  cartographer: {
    name: 'Cartographer',
    category: 'Fleet template / Navigator body',
    short: 'Turns roadmap drift into visible status.',
    detail: 'Reads roadmap, recovery notes, dogfood feedback, and recent commits, then updates what is built, blocked, or drifting.',
  },
  coxswain: {
    name: 'Coxswain',
    category: 'Platform actor',
    short: 'Coordinates claims and locks.',
    detail: 'Watches file ownership, symbol claims, stale assets, and coordination mismatches before parallel agents collide.',
  },
  lookout: {
    name: 'Lookout',
    category: 'Platform actor',
    short: 'Watches product truth drift.',
    detail: 'Checks docs, OpenAPI, CLI help, website, skills, and dashboard copy against the live product.',
  },
  documentarian: {
    name: 'Documentarian',
    category: 'Fleet template / Lookout body',
    short: 'Keeps docs in sync after release gates.',
    detail: 'Updates release materials when source behavior changes: README, docs, SDK, OpenAPI, website, and skills.',
  },
  quartermaster: {
    name: 'Quartermaster',
    category: 'Platform actor',
    short: 'Governs spend and launch pressure.',
    detail: 'Owns budget ceilings, backend readiness, model tiers, spawn discipline, and resource pressure.',
  },
  signalman: {
    name: 'Signalman',
    category: 'Platform actor',
    short: 'Tracks validation evidence.',
    detail: 'Keeps test runs, proof, warnings, and signal quality visible to the operator.',
  },
  qa: {
    name: 'QA',
    category: 'Fleet template / Signalman body',
    short: 'Reviews commits for real failure modes.',
    detail: 'Looks for bugs, weak tests, missing negative paths, and evidence that would fail against no-op code.',
  },
  harbormaster: {
    name: 'Harbormaster',
    category: 'Platform actor',
    short: 'Owns runtime and promotion truth.',
    detail: 'Checks daemon freshness, stable checkout cleanliness, promotion readiness, and launch provenance.',
  },
  sounder: {
    name: 'Sounder',
    category: 'Platform actor',
    short: 'Owns tuples, graph, and memory.',
    detail: 'Maintains shared coordination facts, episodic memory, graph edges, and semantic joins.',
  },
  breaker: {
    name: 'Breaker',
    category: 'Platform actor',
    short: 'Maps failure propagation.',
    detail: 'Finds retry storms, circuit-breaker gaps, cascading failures, and forensic context windows.',
  },
  caulker: {
    name: 'Caulker',
    category: 'Platform actor',
    short: 'Repairs robustness leaks.',
    detail: 'Handles teardown debt, orphan cleanup, timeout hygiene, IPC leaks, and brittle fallbacks.',
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
  sortie: {
    name: 'Sortie',
    category: 'One-off mission',
    short: 'A tracked, budgeted run.',
    detail: 'Use it for one explicit goal with a backend, model, budget, harbor, event log, and result.',
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
        className={`pointer-events-none invisible absolute top-[calc(100%+var(--space-2))] z-[80] w-[min(18rem,calc(100vw-var(--space-6)))] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-3)] text-left opacity-0 shadow-none group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100 ${tooltipAlignClass}`}
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
