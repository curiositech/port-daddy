import * as React from 'react'
import { motion } from 'framer-motion'
import {
  CheckCircle,
  Download,
  Eye,
  FileText,
  Handshake,
  Lock,
  Scale,
  Shield,
  Terminal,
  type LucideIcon,
} from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import {
  BracketLabel,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
} from '@/components/site/primitives'

interface Paper {
  id: string
  title: string
  subtitle: string
  thesis: string
  filename: string
  date: string
  pages: number
  sizeKb: number
  status: string
  order: string
  highlights: Array<{ icon: LucideIcon; label: string }>
  sections: Array<{ title: string; content: string }>
}

const PAPERS: Paper[] = [
  {
    id: 'bonded-commons',
    title: 'The Bonded Commons',
    subtitle: 'Pre-transactional trust infrastructure for multi-agent systems',
    thesis:
      'Coordination fails when every agent has to negotiate trust from scratch. Port Daddy treats trust as shared infrastructure: visible claims, durable attribution, and funded accountability before work begins.',
    filename: 'agent-transactions-whitepaper',
    date: 'March 2026',
    pages: 16,
    sizeKb: 400,
    status: 'Mechanism design',
    order: '02',
    highlights: [
      { icon: Scale, label: "Sen's impossibility applied" },
      { icon: Handshake, label: 'Collateralized work contracts' },
      { icon: Eye, label: 'Immutable evidence trails' },
      { icon: Terminal, label: 'TLA+ model boundary' },
    ],
    sections: [
      {
        title: 'The trust problem',
        content:
          'Peer-to-peer promises do not scale to autonomous work. The paper frames a commons authority that records intent, scope, evidence, and accountability before coordination turns into conflict.',
      },
      {
        title: 'Three layers',
        content:
          'Capability boundaries prevent broad damage, Merkle-chained attribution makes work inspectable, and collateralized contracts fund accountability without pretending that intent is observable.',
      },
      {
        title: 'Why advisory claims',
        content:
          "Strict allocation can be worse than conflict when private knowledge matters. The control plane should expose truthful coordination signals instead of pretending it can centrally know every agent's best move.",
      },
      {
        title: 'Open problem',
        content:
          'Bond pricing has to make defection expensive without pricing legitimate agents out of the commons. That is a product, economics, and systems-design problem, not a decorative token mechanic.',
      },
    ],
  },
  {
    id: 'anchor-protocol',
    title: 'The Anchor Protocol',
    subtitle: 'Formal verification for scoped identity and delegated authority',
    thesis:
      'Local agents need identities that survive process churn without turning localhost into a free-for-all. This paper specifies the cryptographic boundary for signed capability tokens and delegation chains.',
    filename: 'anchor-protocol-whitepaper',
    date: 'March 2026',
    pages: 12,
    sizeKb: 368,
    status: 'Protocol foundation',
    order: '01',
    highlights: [
      { icon: Shield, label: 'ProVerif agreement proof' },
      { icon: Lock, label: 'Rust memory-safety path' },
      { icon: CheckCircle, label: 'Constant-time comparison' },
      { icon: Terminal, label: 'Formal methods appendix' },
    ],
    sections: [
      {
        title: 'Abstract',
        content:
          'Defines the identity layer: signed cards, scoped capabilities, and attenuated delegation that let agents prove what they may do without inheriting broad ambient authority.',
      },
      {
        title: 'Local threat model',
        content:
          'Port squatting, resource contention, replay, and privilege confusion are treated as first-class localhost risks. The protocol separates semantic agent identity from ordinary process identity.',
      },
      {
        title: 'Verification strategy',
        content:
          'Symbolic analysis models authentication and delegation properties, while implementation-level checks focus on memory safety, signature verification, and constant-time comparisons.',
      },
      {
        title: 'Implementation boundary',
        content:
          'The daemon mediates runtime authority. The cryptographic core signs and verifies scoped claims, but it does not pretend to solve host-level isolation, process supervision, or user policy alone.',
      },
    ],
  },
]

const READING_ORDER = [
  {
    step: '01',
    title: 'Protocol boundary',
    body: 'Start with the Anchor Protocol when you need the identity, verification, and delegation argument.',
  },
  {
    step: '02',
    title: 'Commons governance',
    body: 'Move to the Bonded Commons when you need the market and accountability layer above protocol identity.',
  },
  {
    step: '03',
    title: 'Product proof',
    body: 'Compare both papers against the live daemon: sessions, claims, locks, salvage, and operator-visible evidence.',
  },
]

function formatSize(sizeKb: number) {
  return `${sizeKb} KB`
}

function paperUrl(paper: Paper) {
  return `/whitepaper/${paper.filename}.pdf`
}

export default function WhitepaperPage() {
  const [activePaper, setActivePaper] = React.useState<string>(PAPERS[0].id)
  const [isLoading, setIsLoading] = React.useState(true)

  const paper = PAPERS.find((candidate) => candidate.id === activePaper) ?? PAPERS[0]
  const totalPages = PAPERS.reduce((sum, candidate) => sum + candidate.pages, 0)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[var(--surface-base)] font-sans selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
    >
      <main id="main-content">
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-7)] lg:grid-cols-[minmax(0,0.88fr)_minmax(22rem,0.42fr)] lg:items-start">
              <div className="space-y-[var(--space-6)]">
                <PanelEyebrow>Research dossier</PanelEyebrow>
                <PanelTitle as="h1" size="hero" className="max-w-[12ch]">
                  The control-plane papers.
                </PanelTitle>
                <PanelBody size="default" className="max-w-[48rem] text-[length:var(--text-lg)]">
                  Two technical papers define the Port Daddy control-plane argument:
                  signed local identity first, then commons governance for accountable
                  multi-agent work.
                </PanelBody>

                <div className="grid gap-[var(--space-3)] border-y-2 border-[var(--border-strong)] py-[var(--space-4)] sm:grid-cols-3">
                  {[
                    { value: String(PAPERS.length).padStart(2, '0'), label: 'public papers' },
                    { value: String(totalPages).padStart(2, '0'), label: 'review pages' },
                    { value: 'PDF', label: 'canonical format' },
                  ].map((stat) => (
                    <div key={stat.label} className="space-y-[var(--space-1)]">
                      <div className="font-mono text-[length:var(--text-xl)] font-black leading-none text-[var(--text-primary)]">
                        {stat.value}
                      </div>
                      <div className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                        {stat.label}
                      </div>
                    </div>
                  ))}
                </div>

                <p className="max-w-[44rem] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                  by <strong className="font-black text-[var(--text-primary)]">Erich Owens</strong> --
                  cryptographic identity, advisory coordination, durable evidence, and
                  collateral-backed work agreements for local agent systems.
                </p>
              </div>

              <aside className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
                <div className="border-b-2 border-[var(--border-strong)] p-[var(--space-4)]">
                  <PanelEyebrow>Available papers</PanelEyebrow>
                </div>
                <div className="grid">
                  {PAPERS.map((candidate) => {
                    const selected = candidate.id === paper.id
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        aria-pressed={selected}
                        aria-controls="active-whitepaper-panel"
                        onClick={() => {
                          setActivePaper(candidate.id)
                          setIsLoading(true)
                        }}
                        className={[
                          'group grid grid-cols-[2.75rem,1fr] gap-[var(--space-3)] border-b-2 border-[var(--border-strong)] p-[var(--space-4)] text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)] last:border-b-0',
                          selected
                            ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
                            : 'bg-[var(--surface-base)] text-[var(--text-primary)] hover:bg-[var(--surface-strong)]',
                        ].join(' ')}
                      >
                        <span
                          className={[
                            'font-mono text-[length:var(--text-xl)] font-black leading-none',
                            selected ? 'text-[var(--brand-primary-foreground)]' : 'text-[var(--brand-primary)]',
                          ].join(' ')}
                        >
                          {candidate.order}
                        </span>
                        <span className="min-w-0 space-y-[var(--space-2)]">
                          <span
                            className={[
                              'block font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] tracking-[var(--tracking-display-nav)]',
                              selected ? 'text-[var(--brand-primary-foreground)]' : 'text-[var(--text-primary)]',
                            ].join(' ')}
                          >
                            {candidate.title}
                          </span>
                          <span
                            className={[
                              'block text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)]',
                              selected ? 'text-[color:var(--brand-primary-foreground-muted)]' : 'text-[var(--text-secondary)]',
                            ].join(' ')}
                          >
                            {candidate.subtitle}
                          </span>
                          <span
                            className={[
                              'block font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]',
                              selected ? 'text-[color:var(--brand-primary-foreground-subtle)]' : 'text-[var(--text-muted)]',
                            ].join(' ')}
                          >
                            {candidate.date} / {candidate.pages} pages / {formatSize(candidate.sizeKb)}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </aside>
            </div>
          </PageContainer>
        </section>

        <section className="py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.66fr)_minmax(20rem,0.34fr)]">
              <article id="active-whitepaper-panel" className="min-w-0 border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
                <header className="grid gap-[var(--space-4)] border-b-2 border-[var(--border-strong)] p-[var(--space-5)] lg:grid-cols-[1fr_auto] lg:items-end">
                  <div className="space-y-[var(--space-3)]">
                    <BracketLabel>{paper.status}</BracketLabel>
                    <div className="space-y-[var(--space-2)]">
                      <PanelTitle as="h2" size="section" className="max-w-[14ch]">
                        {paper.title}
                      </PanelTitle>
                      <PanelBody className="max-w-[48rem]">{paper.thesis}</PanelBody>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-[var(--space-2)]">
                    <a
                      href={paperUrl(paper)}
                      className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--text-primary)] px-[var(--space-4)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-inverse)] transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                      download
                    >
                      <Download aria-hidden="true" size={14} />
                      Download
                    </a>
                    <a
                      href={paperUrl(paper)}
                      className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-4)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                    >
                      <FileText aria-hidden="true" size={14} />
                      Open PDF
                    </a>
                  </div>
                </header>

                <div className="relative aspect-[1/1.34] min-h-[34rem] bg-[var(--surface-sunken)]">
                  {isLoading ? (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--surface-sunken)]">
                      <div className="grid gap-[var(--space-3)] text-center">
                        <div
                          className="mx-auto h-[var(--space-7)] w-[var(--space-7)] animate-spin border-2 border-[var(--border-default)] border-t-[color:var(--brand-primary)]"
                          aria-hidden="true"
                        />
                        <span className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                          Loading paper
                        </span>
                      </div>
                    </div>
                  ) : null}
                  <iframe
                    key={paper.id}
                    src={`${paperUrl(paper)}#toolbar=1&navpanes=0`}
                    className="h-full w-full"
                    onLoad={() => setIsLoading(false)}
                    title={`${paper.title} PDF`}
                  />
                </div>
              </article>

              <aside className="grid content-start gap-[var(--space-4)]">
                <section className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-5)]">
                  <div className="mb-[var(--space-4)] flex items-center justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-strong)] pb-[var(--space-3)]">
                    <PanelEyebrow>Argument map</PanelEyebrow>
                    <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                      {paper.order}/{PAPERS.length.toString().padStart(2, '0')}
                    </span>
                  </div>
                  <div className="grid gap-[var(--space-4)]">
                    {paper.sections.map((section, index) => (
                      <div key={`${paper.id}-${section.title}`} className="grid grid-cols-[2rem,1fr] gap-[var(--space-3)]">
                        <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <div className="space-y-[var(--space-1)]">
                          <h3 className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)]">
                            {section.title}
                          </h3>
                          <p className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                            {section.content}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-5)]">
                  <PanelEyebrow className="mb-[var(--space-4)]">Verification signals</PanelEyebrow>
                  <div className="grid gap-[var(--space-3)]">
                    {paper.highlights.map((highlight) => (
                      <div
                        key={highlight.label}
                        className="flex items-center gap-[var(--space-3)] border-t-2 border-[var(--border-default)] pt-[var(--space-3)] first:border-t-0 first:pt-0"
                      >
                        <highlight.icon aria-hidden="true" className="h-[var(--space-4)] w-[var(--space-4)] shrink-0 text-[var(--brand-primary)]" />
                        <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)]">
                          {highlight.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              </aside>
            </div>
          </PageContainer>
        </section>

        <section className="border-t-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.35fr)_minmax(0,0.65fr)]">
              <div className="space-y-[var(--space-4)]">
                <PanelEyebrow>Reading order</PanelEyebrow>
                <PanelTitle as="h2" size="section" className="max-w-[11ch]">
                  Read the system from proof to practice.
                </PanelTitle>
              </div>

              <div className="grid gap-[var(--space-3)]">
                {READING_ORDER.map((item) => (
                  <div
                    key={item.step}
                    className="grid gap-[var(--space-4)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)] sm:grid-cols-[4rem,1fr]"
                  >
                    <div className="font-mono text-[length:var(--text-xl)] font-black leading-none text-[var(--brand-primary)]">
                      {item.step}
                    </div>
                    <div className="space-y-[var(--space-1)]">
                      <h3 className="font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] tracking-[var(--tracking-display-nav)] text-[var(--text-primary)]">
                        {item.title}
                      </h3>
                      <p className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                        {item.body}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </PageContainer>
        </section>
      </main>

      <Footer />
    </motion.div>
  )
}
