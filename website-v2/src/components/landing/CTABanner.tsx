import { Link } from 'react-router-dom'
import { ArrowRight, FileDown, FileText, Github, MonitorCheck, ShieldCheck, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CodeBlock } from '@/components/ui/CodeBlock'
import {
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
} from '@/components/site/primitives'
import { RoleTerm } from '@/components/site/RoleTerm'
import { WHITE_PAPERS } from '@/data/whitePapers'

const START_PATHS = [
  {
    label: 'For you',
    title: 'Open FleetBar first',
    detail: 'Pick a project, check that the background service is running, and see which agents are working and what they have claimed.',
    icon: MonitorCheck,
  },
  {
    label: 'For your agents',
    title: 'Let agents write to the shared workspace',
    detail: 'Agents use the terminal to start sessions, leave notes, claim files, and hand work to each other. That is where they live.',
    icon: Terminal,
  },
  {
    label: 'Before you commit',
    title: 'Check the work first',
    detail: 'The guard fails closed at the commit: it blocks any commit whose staged files are not claimed by an active session. The commit is the one hard gate — file claims before it are advisory.',
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
              <PanelEyebrow>Install Port Daddy</PanelEyebrow>
              <PanelTitle as="h2" size="display" className="max-w-[15ch]">
                Install it, then run your fleet from FleetBar.
              </PanelTitle>
              <PanelBody className="max-w-[46rem]">
                Port Daddy is open source and free. You run it from the Mac app: pick a project,
                start a <RoleTerm role="shipwright">Shipwright</RoleTerm> to plan a fleet of agents,
                launch one-off <RoleTerm role="spawn">spawned work</RoleTerm>, set spending limits, and
                hand work between agents. Agents stay in the terminal. You should not have to read
                command output to know what is going on.
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
                <Link to="/mac-preview#download">
                  <MonitorCheck size={16} />
                  Get the Mac app
                </Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <Link to="/whitepaper">
                  <FileText size={16} />
                  Read the papers
                </Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <a href="https://github.com/curiositech/port-daddy" target="_blank" rel="noreferrer">
                  <Github size={16} />
                  View source on GitHub
                </a>
              </Button>
            </div>
          </div>

          <SurfacePanel elevation="quiet" padding="compact" className="grid gap-[var(--space-4)]">
            <div className="flex items-center gap-[var(--space-2)] border-b-2 border-[var(--border-strong)] pb-[var(--space-3)]">
              <MonitorCheck size={17} className="text-[var(--brand-primary)]" />
              <PanelEyebrow>What you see in FleetBar</PanelEyebrow>
            </div>
            <picture className="block overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
              <source srcSet="/img/app-screens/fleetbar-native-shell-dark.webp" media="(prefers-color-scheme: dark)" />
              <img
                src="/img/app-screens/fleetbar-native-shell-light.webp"
                alt="FleetBar macOS shell showing the Fleet Control Center"
                className="aspect-[4/3] w-full object-cover object-left-top"
                loading="lazy"
              />
            </picture>
            <PanelBody size="compact" className="max-w-none">
              FleetBar shows whether the background service is running, which project you are on,
              the agents at work, what they have claimed, and where spending stands. Install it,
              then this is what you get.
            </PanelBody>
            <div className="grid gap-[var(--space-2)]">
              <CodeBlock language="bash" showHeaderLabel={false}>
                {`brew install curiositech/tap/port-daddy
pd setup`}
              </CodeBlock>
            </div>
            <div className="grid gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-3)]">
              {[
                ['Open', 'the Fleet Control Center'],
                ['See', 'agents and their claimed files'],
                ['Block', 'commits that skip a claim'],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-[var(--space-3)] border-b border-[var(--border-default)] pb-[var(--space-2)] last:border-b-0 last:pb-0"
                >
                  <span className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                    {label}
                  </span>
                  <span className="text-right text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </SurfacePanel>
        </div>

        {/*
          The "Coordination Feedback" sub-panel that previously sat to
          the left of the whitepaper cards was stripped per IA audit
          (2026-05-20): it was internal build-process commentary in
          incident-report voice ("Port Daddy showed the landing shell
          was already claimed, so this restore stayed in a bounded CTA
          and dossier route"). Readers at this scroll position cannot
          act on dogfood-as-meta-commentary; the page should be
          converting, not explaining how it was built. The whitepaper
          grid takes the full width and does the closing-CTA job alone.

          2026-08-04 IA pass: WHITE_PAPERS grew from 2 papers (when this
          panel was written) to 7, and the full grid was running the
          single-column mobile height past 2,000px at the very end of the
          page — the worst possible place to make a reader scroll more,
          right after they decided to convert. The library at /library
          (linked from ScopeLadderSection higher up the page, and from
          the "read all" link below) already lists every paper with the
          same reader/PDF links, so repeating the full set here was pure
          duplication. Slicing to the first three keeps the closing CTA
          concrete without re-running the whole library inline.

          The link's count is derived from WHITE_PAPERS.length rather
          than written out, because this list has already grown twice and
          a hardcoded number goes quietly wrong the next time it does.
        */}
        <div className="mt-[var(--space-6)] grid gap-[var(--space-5)]">
          <div className="grid gap-[var(--space-3)] md:grid-cols-2">
            {WHITE_PAPERS.slice(0, 3).map((paper) => (
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
                      {paper.thesis}
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
                    <FileDown aria-hidden="true" size={14} />
                  </a>
                </div>
              </article>
            ))}
          </div>
          <Link
            to="/library"
            className="group inline-flex w-fit items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)] no-underline"
          >
            Read all {WHITE_PAPERS.length} in the Harbor Library
            <ArrowRight aria-hidden="true" size={14} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </PageContainer>
    </section>
  )
}
