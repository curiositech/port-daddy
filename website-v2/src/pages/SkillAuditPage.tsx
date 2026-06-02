import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileWarning, GitBranch, RefreshCw } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import {
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
  SwissGrid,
  SwissGridItem,
} from '@/components/site/primitives'

type BrokenLink = {
  from: string
  target: string
  resolved: string
  kind: string
  suggestions?: string[]
}

type DriftEntry = {
  index: string
  missing_from_index?: string[]
  ghost_entries?: string[]
}

type SkillReport = {
  name: string
  root: string
  ok: boolean
  orphans: string[]
  drift: DriftEntry[]
  broken_links: BrokenLink[]
  missing_indexes_failure: string[]
  missing_indexes_warning: string[]
}

type Snapshot = {
  // Optional in deterministic mode (when the snapshot is committed to git
  // and we don't want metadata churn). Present in interactive/SQLite mode.
  run_id?: number
  generated_at?: string
  auditor_version: string
  summary: {
    total: number
    passing: number
    failing: number
    warning_only: number
    failing_skills: string[]
  }
  skills: SkillReport[]
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string
  value: number | string
  tone: 'good' | 'warn' | 'bad' | 'neutral'
}) {
  const toneStyles =
    tone === 'good'
      ? 'border-emerald-600/50 text-emerald-700 dark:text-emerald-300'
      : tone === 'warn'
        ? 'border-amber-600/50 text-amber-700 dark:text-amber-300'
        : tone === 'bad'
          ? 'border-rose-600/50 text-rose-700 dark:text-rose-300'
          : 'border-[var(--border-strong)] text-[var(--ink-strong)]'
  return (
    <SurfacePanel elevation="quiet" padding="compact" className={`grid gap-[var(--space-2)] border-2 ${toneStyles}`}>
      <span className="text-[length:var(--text-xs)] font-mono uppercase tracking-[0.15em] opacity-70">{label}</span>
      <span className="text-[length:var(--text-4xl)] font-semibold leading-none">{value}</span>
    </SurfacePanel>
  )
}

function FailingSkillCard({ skill }: { skill: SkillReport }) {
  return (
    <SurfacePanel elevation="quiet" padding="compact" className="grid gap-[var(--space-3)] border-2 border-rose-600/40">
      <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
        <h3 className="font-mono text-[length:var(--text-lg)] font-semibold text-rose-700 dark:text-rose-300">
          {skill.name}
        </h3>
        <span className="font-mono text-[length:var(--text-xs)] opacity-70">{skill.root}</span>
      </div>
      {skill.orphans.length > 0 && (
        <div>
          <p className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.15em] opacity-70">
            Orphans ({skill.orphans.length})
          </p>
          <ul className="mt-[var(--space-1)] grid gap-[var(--space-1)] font-mono text-[length:var(--text-sm)]">
            {skill.orphans.map(o => (
              <li key={o}>· {o}</li>
            ))}
          </ul>
        </div>
      )}
      {skill.drift.length > 0 && (
        <div>
          <p className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.15em] opacity-70">INDEX drift</p>
          <ul className="mt-[var(--space-1)] grid gap-[var(--space-1)] font-mono text-[length:var(--text-sm)]">
            {skill.drift.map((d, i) => (
              <li key={`${d.index}-${i}`}>
                · <span className="font-medium">{d.index}</span>
                {d.missing_from_index && d.missing_from_index.length > 0 && (
                  <> — missing: {d.missing_from_index.join(', ')}</>
                )}
                {d.ghost_entries && d.ghost_entries.length > 0 && <> — ghosts: {d.ghost_entries.join(', ')}</>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {skill.broken_links.length > 0 && (
        <div>
          <p className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.15em] opacity-70">
            Broken links ({skill.broken_links.length})
          </p>
          <ul className="mt-[var(--space-1)] grid gap-[var(--space-1)] font-mono text-[length:var(--text-sm)]">
            {skill.broken_links.map((b, i) => (
              <li key={i}>
                · {b.from} → <span className="line-through">{b.target}</span>
                {b.suggestions && b.suggestions.length > 0 && (
                  <span className="opacity-70"> (did you mean {b.suggestions.join(' or ')}?)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {skill.missing_indexes_failure.length > 0 && (
        <div>
          <p className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.15em] opacity-70">Missing INDEX.md</p>
          <ul className="mt-[var(--space-1)] grid gap-[var(--space-1)] font-mono text-[length:var(--text-sm)]">
            {skill.missing_indexes_failure.map(m => (
              <li key={m}>· {m}/</li>
            ))}
          </ul>
        </div>
      )}
    </SurfacePanel>
  )
}

export function SkillAuditPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'failing' | 'warning' | 'all'>('failing')

  useEffect(() => {
    fetch('/skill-audit.json')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<Snapshot>
      })
      .then(setSnapshot)
      .catch(e => setError(e.message))
  }, [])

  if (error) {
    return (
      <div className="min-h-screen bg-[var(--surface-base)]">
        <main id="main-content">
          <PageContainer width="wide">
            <SurfacePanel elevation="quiet" padding="default" className="mt-[var(--space-8)] border-2 border-rose-600/40">
              <PanelTitle as="h1">Audit snapshot unavailable</PanelTitle>
              <PanelBody>Failed to load /skill-audit.json: {error}</PanelBody>
            </SurfacePanel>
          </PageContainer>
        </main>
        <Footer />
      </div>
    )
  }

  if (!snapshot) {
    return (
      <div className="min-h-screen bg-[var(--surface-base)]">
        <main id="main-content">
          <PageContainer width="wide">
            <PanelBody className="mt-[var(--space-8)]">Loading audit snapshot…</PanelBody>
          </PageContainer>
        </main>
      </div>
    )
  }

  const { summary, skills, generated_at, auditor_version, run_id } = snapshot
  const failing = skills.filter(s => !s.ok)
  const warningOnly = skills.filter(s => s.ok && s.missing_indexes_warning.length > 0)

  const cohort = filter === 'failing' ? failing : filter === 'warning' ? warningOnly : skills
  const cohortLabel =
    filter === 'failing' ? 'Failing' : filter === 'warning' ? 'Passing with warnings' : 'All skills'

  const formatted = generated_at
    ? new Date(generated_at).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null

  return (
    <div className="min-h-screen bg-[var(--surface-base)] selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]">
      <main id="main-content">
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SwissGrid className="items-end">
              <SwissGridItem span="wide">
                <div className="space-y-[var(--space-4)]">
                  <PanelEyebrow>Skill Hygiene</PanelEyebrow>
                  <PanelTitle as="h1" size="hero" className="max-w-[18ch]">
                    Every bundled file should be reachable.
                  </PanelTitle>
                  <PanelBody className="max-w-[44rem]">
                    A skill bundle is only as useful as the parts an agent can find. The hygiene
                    auditor walks every skill in this repo, parses the markdown links from
                    SKILL.md and every INDEX.md, and reports anything that fell out of the
                    reachable graph: orphaned docs, broken links, missing index hubs, and ghost
                    entries.
                  </PanelBody>
                </div>
              </SwissGridItem>
              <SwissGridItem span="narrow">
                <SurfacePanel elevation="quiet" padding="compact" className="grid gap-[var(--space-2)]">
                  <p className="flex items-center gap-[var(--space-2)] font-mono text-[length:var(--text-xs)] uppercase tracking-[0.15em] opacity-70">
                    <RefreshCw size={14} />
                    {run_id != null ? `Run #${run_id}` : 'Latest audit'}
                  </p>
                  {formatted && <p className="font-mono text-[length:var(--text-sm)]">{formatted}</p>}
                  <p className="font-mono text-[length:var(--text-xs)] opacity-70">
                    auditor v{auditor_version}
                  </p>
                </SurfacePanel>
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </section>

        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)]">
          <PageContainer width="wide">
            <div className="grid grid-cols-2 gap-[var(--space-4)] md:grid-cols-4">
              <StatTile label="Total" value={summary.total} tone="neutral" />
              <StatTile label="Passing" value={summary.passing} tone={summary.passing === summary.total ? 'good' : 'neutral'} />
              <StatTile label="Failing" value={summary.failing} tone={summary.failing === 0 ? 'good' : 'bad'} />
              <StatTile
                label="With warnings"
                value={summary.warning_only}
                tone={summary.warning_only === 0 ? 'good' : 'warn'}
              />
            </div>
          </PageContainer>
        </section>

        <section className="py-[var(--section-space-y)]">
          <PageContainer width="wide">
            <div className="mb-[var(--space-6)] flex flex-wrap items-center justify-between gap-[var(--space-3)]">
              <div className="flex items-center gap-[var(--space-3)]">
                <h2 className="font-mono text-[length:var(--text-xl)] font-semibold">{cohortLabel}</h2>
                <span className="font-mono text-[length:var(--text-sm)] opacity-70">({cohort.length})</span>
              </div>
              <div className="flex gap-[var(--space-2)]" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === 'failing'}
                  onClick={() => setFilter('failing')}
                  className={`flex items-center gap-[var(--space-1)] border-2 px-[var(--space-3)] py-[var(--space-1)] font-mono text-[length:var(--text-xs)] uppercase tracking-[0.15em] ${
                    filter === 'failing'
                      ? 'border-rose-600 bg-rose-600/10 text-rose-700 dark:text-rose-300'
                      : 'border-[var(--border-strong)] text-[var(--ink-strong)]'
                  }`}
                >
                  <AlertTriangle size={12} />
                  Failing
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === 'warning'}
                  onClick={() => setFilter('warning')}
                  className={`flex items-center gap-[var(--space-1)] border-2 px-[var(--space-3)] py-[var(--space-1)] font-mono text-[length:var(--text-xs)] uppercase tracking-[0.15em] ${
                    filter === 'warning'
                      ? 'border-amber-600 bg-amber-600/10 text-amber-700 dark:text-amber-300'
                      : 'border-[var(--border-strong)] text-[var(--ink-strong)]'
                  }`}
                >
                  <FileWarning size={12} />
                  Warnings
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === 'all'}
                  onClick={() => setFilter('all')}
                  className={`flex items-center gap-[var(--space-1)] border-2 px-[var(--space-3)] py-[var(--space-1)] font-mono text-[length:var(--text-xs)] uppercase tracking-[0.15em] ${
                    filter === 'all'
                      ? 'border-emerald-600 bg-emerald-600/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-[var(--border-strong)] text-[var(--ink-strong)]'
                  }`}
                >
                  <CheckCircle2 size={12} />
                  All
                </button>
              </div>
            </div>

            {filter === 'failing' && failing.length === 0 && (
              <SurfacePanel elevation="quiet" padding="default" className="border-2 border-emerald-600/40">
                <PanelTitle as="h3" size="card" className="flex items-center gap-[var(--space-2)] text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 size={20} />
                  All {summary.total} skills pass.
                </PanelTitle>
                <PanelBody className="mt-[var(--space-2)]">
                  No orphans, no broken links, no INDEX drift, no missing hubs. Every bundled file
                  is reachable from SKILL.md or one of its index hubs.
                </PanelBody>
              </SurfacePanel>
            )}

            {filter === 'failing' && failing.length > 0 && (
              <div className="grid gap-[var(--space-4)]">
                {failing.map(s => (
                  <FailingSkillCard key={s.name} skill={s} />
                ))}
              </div>
            )}

            {filter === 'warning' && (
              <div className="grid gap-[var(--space-3)]">
                {warningOnly.length === 0 ? (
                  <PanelBody>No skills with hygiene warnings.</PanelBody>
                ) : (
                  warningOnly.map(s => (
                    <SurfacePanel key={s.name} elevation="quiet" padding="compact" className="border-2 border-amber-600/40">
                      <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
                        <h3 className="font-mono text-[length:var(--text-base)] font-medium">{s.name}</h3>
                        <span className="font-mono text-[length:var(--text-xs)] opacity-70">
                          warnings: {s.missing_indexes_warning.join(', ')}
                        </span>
                      </div>
                    </SurfacePanel>
                  ))
                )}
              </div>
            )}

            {filter === 'all' && (
              <div className="grid grid-cols-1 gap-[var(--space-2)] md:grid-cols-2 lg:grid-cols-3">
                {skills.map(s => (
                  <SurfacePanel
                    key={s.name}
                    elevation="quiet"
                    padding="compact"
                    className={`border-2 ${
                      !s.ok
                        ? 'border-rose-600/40'
                        : s.missing_indexes_warning.length > 0
                          ? 'border-amber-600/40'
                          : 'border-emerald-600/40'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-[var(--space-2)]">
                      <h3 className="font-mono text-[length:var(--text-sm)]">{s.name}</h3>
                      <span className="font-mono text-[length:var(--text-xs)] opacity-70">
                        {!s.ok ? 'fail' : s.missing_indexes_warning.length > 0 ? 'warn' : 'ok'}
                      </span>
                    </div>
                  </SurfacePanel>
                ))}
              </div>
            )}
          </PageContainer>
        </section>

        <section className="border-t-2 border-[var(--border-strong)] py-[var(--section-space-y)]">
          <PageContainer width="wide">
            <SwissGrid>
              <SwissGridItem span="wide">
                <PanelEyebrow>How this works</PanelEyebrow>
                <PanelTitle as="h2" size="section" className="mt-[var(--space-2)]">
                  Every commit is audited.
                </PanelTitle>
                <PanelBody className="mt-[var(--space-3)] max-w-[44rem]">
                  The pre-commit hook runs <code>skills/skill-hygiene/scripts/audit_skill_bundle.py</code>
                  {' '}on every skill bundle touched by the commit. A library-wide audit runs
                  separately and writes its result to a local SQLite history, then exports the
                  snapshot powering this page.
                </PanelBody>
                <PanelBody className="mt-[var(--space-3)] max-w-[44rem]">
                  Drift falls into four buckets: <strong>orphan</strong> (file no SKILL or INDEX
                  mentions), <strong>missing-from-index</strong> (file exists, INDEX doesn't list
                  it), <strong> ghost entry</strong> (INDEX lists a file that doesn't exist), and
                  <strong> broken link</strong> (markdown link points at a missing path; fuzzy-matched
                  typo suggestions included). Missing-INDEX in a multi-file directory is a soft
                  warning when SKILL.md already names every file individually.
                </PanelBody>
              </SwissGridItem>
              <SwissGridItem span="narrow">
                <SurfacePanel elevation="quiet" padding="compact" className="grid gap-[var(--space-2)]">
                  <p className="flex items-center gap-[var(--space-2)] font-mono text-[length:var(--text-xs)] uppercase tracking-[0.15em] opacity-70">
                    <GitBranch size={14} />
                    Run locally
                  </p>
                  <pre className="overflow-x-auto whitespace-pre font-mono text-[length:var(--text-xs)] leading-relaxed">
{`python3 skills/skill-hygiene/scripts/audit_skill_bundle.py \\
  skills/<bundle-name>

python3 skills/skill-hygiene/scripts/audit_skill_library.py \\
  --snapshot website-v2/public/skill-audit.json`}
                  </pre>
                </SurfacePanel>
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </section>
      </main>
      <Footer />
    </div>
  )
}

export default SkillAuditPage
