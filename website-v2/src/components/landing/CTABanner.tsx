import { Link } from 'react-router-dom'
import { ArrowRight, Download, FileText, Github, MonitorCheck, RadioTower, ShieldCheck, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
} from '@/components/site/primitives'
import { RoleTerm } from '@/components/site/RoleTerm'
import { WHITE_PAPERS } from '@/data/whitePapers'

const EVALUATION_SIGNALS = [
  'Local-first coordination: the daemon, CLI, FleetBar, and console run against repo-local state instead of a hosted black box.',
  'Composable agent APIs: sessions, claims, locks, notes, channels, tuples, budgets, and salvage are capabilities other tools can call.',
  'Operator trust: readiness, cost, ownership, and recovery evidence stay visible before an agent spends money or changes history.',
] as const

const START_PATHS = [
  {
    label: 'AI engineer',
    title: 'Wire existing agents into shared state',
    detail: 'Keep Claude, Codex, Aider, and custom tools from acting like isolated terminals when they touch the same repo.',
    icon: MonitorCheck,
  },
  {
    label: 'Platform team',
    title: 'See readiness before launch',
    detail: 'Check auth, model availability, telemetry, budgets, resources, and guard state before adding more automation.',
    icon: Terminal,
  },
  {
    label: 'Evaluator',
    title: 'Inspect the architecture',
    detail: 'Review the papers, code, commands, and product surfaces that make multi-agent coordination auditable.',
    icon: ShieldCheck,
  },
] as const

export function CTABanner() {
  return (
    <section className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-base)] py-[var(--space-8)] lg:py-[var(--section-space-y)]">
      <PageContainer width="wide">
        <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.96fr)_minmax(24rem,0.74fr)] lg:items-start">
          <div className="grid gap-[var(--space-5)]">
            <div className="space-y-[var(--space-4)]">
              <PanelEyebrow>Try it on a real repo</PanelEyebrow>
              <PanelTitle as="h2" size="display" className="max-w-[13ch]">
                Put a control plane around your AI agents.
              </PanelTitle>
              <PanelBody className="max-w-[46rem]">
                Port Daddy is open-source infrastructure with a Mac operator surface. Start in
                FleetBar, then inspect the Fleet Control Center, <RoleTerm role="shipwright">Shipwright</RoleTerm>,{' '}
                <RoleTerm role="sortie">sorties</RoleTerm>, resource controls, backend readiness,
                and agent-to-agent handoffs. The CLI is there for agents and scripts; the product
                value is the shared state they all leave behind.
              </PanelBody>
            </div>

            <div className="grid gap-[var(--space-3)] md:grid-cols-3">
              {START_PATHS.map((path) => {
                const Icon = path.icon
                return (
                  <article
                    key={path.title}
                    className="grid content-start gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)]"
                  >
                    <div className="flex items-start justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-default)] pb-[var(--space-3)]">
                      <PanelEyebrow>{path.label}</PanelEyebrow>
                      <Icon aria-hidden="true" size={18} className="text-[var(--brand-primary)]" />
                    </div>
                    <PanelTitle as="h3" size="nav" className="max-w-none">
                      {path.title}
                    </PanelTitle>
                    <PanelBody size="compact" className="max-w-none">
                      {path.detail}
                    </PanelBody>
                  </article>
                )
              })}
            </div>

            <div className="flex flex-wrap gap-[var(--space-3)]">
              <Button asChild variant="primary" size="lg">
                <a href="/downloads/PortDaddy-FleetBar-macOS-arm64.zip" download>
                  <Download size={16} />
                  Download FleetBar
                </a>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <Link to="/whitepaper">
                  <FileText size={16} />
                  Read both papers
                </Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <a href="https://github.com/curiositech/port-daddy" target="_blank" rel="noreferrer">
                  <Github size={16} />
                  GitHub
                </a>
              </Button>
            </div>
          </div>

          <SurfacePanel elevation="quiet" padding="compact" className="grid gap-[var(--space-4)]">
            <div className="flex items-center justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-strong)] pb-[var(--space-3)]">
              <div className="inline-flex items-center gap-[var(--space-2)]">
                <MonitorCheck size={17} className="text-[var(--brand-primary)]" />
                <PanelEyebrow>Local control plane</PanelEyebrow>
              </div>
              <span className="border-2 border-[var(--border-strong)] bg-[var(--brand-primary)] px-2 py-1 font-mono text-[10px] font-black uppercase tracking-[0.16em] text-[var(--brand-primary-foreground)]">
                Operator surface
              </span>
            </div>
            <picture className="block overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
              <source srcSet="/img/app-screens/fleetbar-native-shell-dark.png" media="(prefers-color-scheme: dark)" />
              <img
                src="/img/app-screens/fleetbar-native-shell-light.png"
                alt="FleetBar macOS shell showing the Fleet Control Center"
                className="aspect-[4/3] w-full object-cover object-left-top"
                loading="lazy"
              />
            </picture>
            <PanelBody size="compact" className="max-w-none">
              Open FleetBar for daemon health, project selection, agents, resources, handoffs, and
              guard state. Use the console when you need to see who owns what, what is blocked, and
              whether another agent can safely start.
            </PanelBody>
            <div className="grid gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-3)]">
              {[
                ['Observe', 'agents + claims'],
                ['Preflight', 'models + budget'],
                ['Enforce', 'guarded commits'],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-[var(--space-3)] border-b border-[var(--border-default)] pb-2 last:border-b-0 last:pb-0"
                >
                  <span className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                    {label}
                  </span>
                  <span className="text-right font-mono text-[10px] font-black uppercase tracking-[0.14em] text-[var(--brand-primary)]">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </SurfacePanel>
        </div>

        <div className="mt-[var(--space-6)] grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
          <div className="grid content-start gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)]">
            <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-default)] pb-[var(--space-3)]">
              <PanelEyebrow>Technical evaluation</PanelEyebrow>
              <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                Platform-grade signal
              </span>
            </div>
            <PanelBody className="max-w-none">
              The bet is simple: as AI coding tools become normal engineering infrastructure, the
              missing layer is not another model. It is local operational truth for parallel agent
              work.
            </PanelBody>
            <ul className="grid gap-[var(--space-2)]">
              {EVALUATION_SIGNALS.map((item) => (
                <li
                  key={item}
                  className="flex gap-[var(--space-2)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]"
                >
                  <RadioTower aria-hidden="true" size={14} className="mt-[0.2em] shrink-0 text-[var(--brand-primary)]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-[var(--space-3)] md:grid-cols-2">
            {WHITE_PAPERS.map((paper) => (
              <article
                key={paper.title}
                className="grid content-between gap-[var(--space-4)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)]"
              >
                <div className="grid gap-[var(--space-3)]">
                  <div className="flex items-center justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-default)] pb-[var(--space-3)]">
                    <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                      {paper.order}
                    </span>
                    <FileText aria-hidden="true" size={16} className="text-[var(--brand-primary)]" />
                  </div>
                  <div className="space-y-[var(--space-2)]">
                    <h3 className="font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] tracking-[var(--tracking-display-nav)] text-[var(--text-primary)]">
                      {paper.title}
                    </h3>
                    <p className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                      {paper.explainerLead}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-[var(--space-2)]">
                  <Link
                    to={paper.readerHref}
                    className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--text-primary)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-inverse)] transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                  >
                    Read inline
                    <ArrowRight aria-hidden="true" size={14} />
                  </Link>
                  <a
                    href={paper.pdfPath}
                    className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                  >
                    PDF
                    <Download aria-hidden="true" size={14} />
                  </a>
                </div>
              </article>
            ))}
          </div>
        </div>
      </PageContainer>
    </section>
  )
}
