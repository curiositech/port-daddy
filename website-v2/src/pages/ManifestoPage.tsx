import { isValidElement, useMemo, type ReactElement, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion, useScroll, useSpring } from 'framer-motion'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowLeft, FileText, ShieldCheck, BookOpen, Stamp } from 'lucide-react'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Mermaid } from '@/components/ui/Mermaid'
import { ScopeLadder } from '@/components/library/ScopeLadder'
import { GiscusComments } from '@/components/blog/GiscusComments'
import { Footer } from '@/components/layout/Footer'
import { extractDirectives, SIDENOTE_PATTERN } from '@/lib/blogDirectives'
import {
  cryptoPapers,
  layerPapers,
  manifestoCaptions,
  manifestoContent,
  manifestoMeta,
  technologyPrimitives,
} from '@/data/manifestoContent'
import { findWhitePaperById } from '@/data/whitePapers'

// Figures that should float so prose wraps around them, and the side they go on.
const WRAP_FIGURES: Record<string, 'right' | 'left'> = {
  '/img/manifesto/collision.png': 'right',
  '/img/manifesto/legibility-zoom.png': 'left',
}

interface MarkdownCodeElementProps {
  className?: string
  children?: ReactNode
}

function isCodeElement(node: ReactNode): node is ReactElement<MarkdownCodeElementProps> {
  return isValidElement<MarkdownCodeElementProps>(node)
}

function consumeSidenoteSentinel(children: ReactNode): { label: string; stripped: ReactNode[] } | null {
  const arr = Array.isArray(children) ? [...children] : [children]
  if (arr.length === 0) return null
  const first = arr[0]
  if (typeof first !== 'string') return null
  const match = SIDENOTE_PATTERN.exec(first)
  if (!match) return null
  const label = match[1]
  const remainder = first.slice(match[0].length)
  if (remainder.length > 0) arr[0] = remainder
  else arr.shift()
  return { label, stripped: arr }
}

const markdownComponents: Components = {
  pre({ children }) {
    const codeChild = Array.isArray(children) ? children[0] : children
    if (isCodeElement(codeChild)) {
      const cls = codeChild.props.className || ''
      const match = /language-(\w+)/.exec(cls)
      const lang = match?.[1] ?? 'bash'
      const text = String(codeChild.props.children ?? '').replace(/\n$/, '')
      return <CodeBlock language={lang}>{text}</CodeBlock>
    }
    return <pre>{children}</pre>
  },

  a({ href, children, ...rest }) {
    if (href?.startsWith('/')) return <Link to={href}>{children}</Link>
    if (href?.startsWith('#')) {
      return (
        <a href={href} {...rest}>
          {children}
        </a>
      )
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  },

  // Sidenote-tagged paragraph → Tufte gutter aside (floats right on lg+, drops
  // inline on narrow). Same machinery as the field log.
  p({ children }) {
    const hit = consumeSidenoteSentinel(children)
    if (!hit) return <p>{children}</p>
    return (
      <aside className="sidenote" role="note" aria-label={hit.label ? `Sidenote: ${hit.label}` : 'Sidenote'}>
        {hit.label && <span className="sidenote-label">{hit.label}</span>}
        <span className="sidenote-body">{hit.stripped}</span>
      </aside>
    )
  },

  // Figures: the long alt text stays on the <img> for assistive tech; the
  // VISIBLE caption is the content-meaning line, never the prompt. Inline
  // figures float so prose wraps around the generated art.
  img({ src, alt }) {
    const caption = (src && manifestoCaptions[src]) || undefined
    const wrap = src ? WRAP_FIGURES[src] : undefined
    const cls = wrap === 'left' ? 'figure--wrap-left' : wrap === 'right' ? 'figure--wrap' : undefined
    return (
      <figure className={cls}>
        <img src={src} alt={alt} loading="lazy" />
        {caption && <figcaption>{caption}</figcaption>}
      </figure>
    )
  },

  table({ children }) {
    return (
      <div className="overflow-x-auto">
        <table>{children}</table>
      </div>
    )
  },
}

/** Sequence diagrams of the lost-write collision and the single-writer fix. */
const COLLISION_DIAGRAM = `sequenceDiagram
    participant A as Agent A
    participant F as src/auth.ts
    participant B as Agent B
    Note over A,B: No harbor-master — both think the file is theirs
    A->>F: read
    B->>F: read
    A->>F: save (good work)
    B->>F: save (erases A)
    Note over F: A's hour of work is gone.<br/>The file still looks finished.`

const FIX_DIAGRAM = `sequenceDiagram
    participant A as Agent A
    participant PD as Port Daddy
    participant B as Agent B
    A->>PD: claim src/auth.ts
    PD-->>A: granted
    B->>PD: claim src/auth.ts
    PD-->>B: held — wait
    A->>PD: release (work saved)
    PD-->>B: granted
    Note over A,B: One writer at a time. Nothing is lost.`

// How the seven papers relate: the four explainers form one dependency ladder
// (market rests on trust rests on reputation rests on memory rests on the
// kernel/harbor); each proof underwrites the layer it sits beside.
const PAPERS_RELATION = `flowchart TB
    subgraph Explain["Four explain — one ladder, machine up to market"]
      direction TB
      K["Single-Writer Kernel<br/><i>what is true</i>"]
      L["The Legible Swarm<br/><i>one picture you zoom into</i>"]
      P["From Spawn to Person<br/><i>memory → reputation</i>"]
      H["The Harbor Economy<br/><i>renting trust for money</i>"]
      K --> L --> P --> H
    end
    Anchor["The Anchor Protocol<br/>proves identity w/o a voucher"]
    Bonded["The Bonded Commons<br/>proves value can't vanish"]
    Fed["The Federated Harbor<br/>proves trust crosses machines"]
    Anchor -. underwrites .-> P
    Bonded -. underwrites .-> H
    Fed -. underwrites .-> H`

function SectionEyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex w-fit items-center gap-2 border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-3 py-1 font-mono text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
      {children}
    </span>
  )
}

function CollisionDiagram() {
  return (
    <section aria-labelledby="collision-heading" className="mx-auto mt-[var(--blog-section-break)] w-full max-w-[80ch]">
      <SectionEyebrow>The race, drawn</SectionEyebrow>
      <h2
        id="collision-heading"
        className="mt-[var(--space-3)] font-display text-[length:var(--text-2xl)] font-black leading-tight text-[var(--text-primary)]"
      >
        One file, two writers, one survivor
      </h2>
      <p className="mt-[var(--space-2)] text-[length:var(--text-lg)] leading-relaxed text-[var(--text-secondary)]">
        Read the two timelines side by side. The only structural difference is who keeps the logbook.
      </p>
      <div className="mt-[var(--space-6)] grid gap-[var(--space-5)] lg:grid-cols-2">
        <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-5)]">
          <div className="mb-[var(--space-3)] flex items-center gap-2 text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--status-error)]">
            Without a harbor-master
          </div>
          <Mermaid chart={COLLISION_DIAGRAM} />
        </div>
        <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-5)]">
          <div className="mb-[var(--space-3)] flex items-center gap-2 text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
            With Port Daddy
          </div>
          <Mermaid chart={FIX_DIAGRAM} />
        </div>
      </div>
    </section>
  )
}

function ScopeSection() {
  return (
    <section aria-labelledby="scope-heading" className="mx-auto mt-[var(--blog-section-break)] w-full max-w-[80ch]">
      <SectionEyebrow>The small idea and the big idea</SectionEyebrow>
      <h2
        id="scope-heading"
        className="mt-[var(--space-3)] font-display text-[length:var(--text-2xl)] font-black leading-tight text-[var(--text-primary)]"
      >
        One tool, a widening scope
      </h2>
      <p className="mt-[var(--space-2)] text-[length:var(--text-lg)] leading-relaxed text-[var(--text-secondary)]">
        The file race above is the small idea — keep one logbook inside one repo.
        The big idea is what that same logbook becomes as the scope widens: the
        whole machine made legible, fleets that co-work across the network, and a
        market for agent labor. The left two work today; the right two are where
        it is heading.
      </p>
      <div className="mt-[var(--space-6)]">
        <ScopeLadder />
      </div>
    </section>
  )
}

function TechnologySection() {
  return (
    <section aria-labelledby="tech-heading" className="mx-auto mt-[var(--blog-section-break)] w-full max-w-[80ch]">
      <SectionEyebrow>What you install</SectionEyebrow>
      <h2
        id="tech-heading"
        className="mt-[var(--space-3)] font-display text-[length:var(--text-2xl)] font-black leading-tight text-[var(--text-primary)]"
      >
        The harbor, in six primitives
      </h2>
      <p className="mt-[var(--space-2)] text-[length:var(--text-lg)] leading-relaxed text-[var(--text-secondary)]">
        Not a framework to adopt. A local service that runs on your machine and answers six kinds of question.
        Each one is a real command against a real module.
      </p>

      <div className="mt-[var(--space-6)] grid gap-px border-2 border-[var(--border-strong)] bg-[var(--border-strong)] sm:grid-cols-2">
        {technologyPrimitives.map((p) => (
          <div key={p.name} className="flex flex-col gap-[var(--space-2)] bg-[var(--surface-raised)] p-[var(--space-5)]">
            <h3 className="font-display text-[length:var(--text-lg)] font-black text-[var(--text-primary)]">{p.name}</h3>
            <p className="text-[length:var(--text-base)] leading-relaxed text-[var(--text-secondary)]">{p.does}</p>
            <code className="mt-auto block overflow-x-auto border border-[var(--border-default)] bg-[var(--surface-sunken)] px-[var(--space-2)] py-[var(--space-2)] font-mono text-[length:var(--text-base)] text-[var(--text-primary)]">
              {p.command}
            </code>
            <div className="flex items-center justify-between gap-[var(--space-2)] pt-[var(--space-1)]">
              <span className="font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)]">{p.source}</span>
              {p.docHref && (
                <Link
                  to={p.docHref}
                  className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)] underline-offset-4 hover:underline"
                >
                  Docs
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-[var(--space-6)]">
        <CodeBlock language="bash">brew install curiositech/tap/port-daddy && pd setup</CodeBlock>
      </div>
    </section>
  )
}

function MathSection() {
  return (
    <section aria-labelledby="math-heading" className="mx-auto mt-[var(--blog-section-break)] w-full max-w-[80ch]">
      <SectionEyebrow>The math we don&apos;t wave at</SectionEyebrow>
      <h2
        id="math-heading"
        className="mt-[var(--space-3)] font-display text-[length:var(--text-2xl)] font-black leading-tight text-[var(--text-primary)]"
      >
        You cannot have all three
      </h2>
      <p className="mt-[var(--space-2)] text-[length:var(--text-lg)] leading-relaxed text-[var(--text-secondary)]">
        Before designing a market for agent labor, you meet a wall no cleverness gets around. The
        Myerson–Satterthwaite theorem (1983): for bilateral trade under private values, no mechanism is
        simultaneously efficient, individually rational, and budget-balanced.
      </p>

      <div className="mt-[var(--space-6)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-6)]">
        <p className="text-center font-mono text-[length:var(--text-lg)] leading-relaxed text-[var(--text-primary)]">
          ¬ ∃ M : <span className="text-[var(--brand-primary)]">Efficient(M)</span> ∧{' '}
          <span className="text-[var(--brand-secondary)]">IndividuallyRational(M)</span> ∧{' '}
          <span className="text-[var(--signal-charlie)]">BudgetBalanced(M)</span>
        </p>
        <p className="mt-[var(--space-4)] text-center text-[length:var(--text-base)] text-[var(--text-muted)]">
          No mechanism M satisfies all three at once. Any honest market design gives one up — and says which.
        </p>
      </div>

      <div className="mt-[var(--space-5)] grid gap-px border-2 border-[var(--border-strong)] bg-[var(--border-strong)] sm:grid-cols-3">
        {[
          { t: 'Efficient', d: 'The trade happens whenever the buyer values the work more than the seller.' },
          { t: 'Individually rational', d: 'Nobody is made worse off by participating than by walking away.' },
          { t: 'Budget-balanced', d: 'The mechanism neither prints money nor quietly skims it.' },
        ].map((c) => (
          <div key={c.t} className="bg-[var(--surface-raised)] p-[var(--space-5)]">
            <h3 className="font-display text-[length:var(--text-base)] font-black uppercase tracking-[0.06em] text-[var(--text-primary)]">
              {c.t}
            </h3>
            <p className="mt-[var(--space-2)] text-[length:var(--text-base)] leading-relaxed text-[var(--text-secondary)]">{c.d}</p>
          </div>
        ))}
      </div>
      <p className="mt-[var(--space-4)] text-[length:var(--text-base)] leading-relaxed text-[var(--text-muted)]">
        The Harbor Economy paper names which of the three Port Daddy gives up, and why that is the right trade for
        renting trust between strangers.
      </p>
    </section>
  )
}

/** A shipped, proof-checked paper — surfaced in-line from its real data. */
function ShippedPaperCard({ spec }: { spec: (typeof cryptoPapers)[number] }) {
  const paper = spec.paperId ? findWhitePaperById(spec.paperId) : null
  // Two real section titles convey what the paper actually argues.
  const sectionTitles = paper?.sections.slice(0, 3).map((s) => s.title) ?? []

  return (
    <article className="flex flex-col gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-5)]">
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <span className="inline-flex items-center gap-1 border border-[var(--border-default)] bg-[var(--surface-sunken)] px-2 py-0.5 font-mono text-[length:var(--type-meta-size)] uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
          <ShieldCheck size={12} aria-hidden="true" /> Checked by {spec.checker}
        </span>
        {paper && (
          <span className="font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
            {paper.pages} pp · {paper.status}
          </span>
        )}
      </div>

      <h3 className="font-display text-[length:var(--text-xl)] font-black text-[var(--text-primary)]">{spec.title}</h3>
      <p className="text-[length:var(--text-base)] leading-relaxed text-[var(--text-secondary)]">
        {paper?.thesis ?? spec.blurb}
      </p>

      {sectionTitles.length > 0 && (
        <ul className="flex flex-col gap-[var(--space-1)]">
          {sectionTitles.map((t) => (
            <li
              key={t}
              className="flex items-start gap-[var(--space-2)] text-[length:var(--text-base)] text-[var(--text-secondary)]"
            >
              <span aria-hidden="true" className="mt-[0.55em] h-[6px] w-[6px] shrink-0 bg-[var(--brand-primary)]" />
              {t}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-[var(--space-3)] pt-[var(--space-2)]">
        {paper && (
          <Link
            to={paper.readerHref}
            className="inline-flex items-center gap-1 font-sans text-[length:var(--text-base)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)] underline-offset-4 hover:underline"
          >
            <BookOpen size={14} aria-hidden="true" /> Read it
          </Link>
        )}
        {paper && (
          <a
            href={paper.pdfPath}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-sans text-[length:var(--text-base)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)] underline-offset-4 hover:text-[var(--text-primary)] hover:underline"
          >
            PDF
          </a>
        )}
      </div>
    </article>
  )
}

function PapersSection() {
  return (
    <section aria-labelledby="papers-heading" className="mx-auto mt-[var(--blog-section-break)] w-full max-w-[80ch]">
      <SectionEyebrow>The jewel</SectionEyebrow>
      <h2
        id="papers-heading"
        className="mt-[var(--space-3)] font-display text-[length:var(--text-2xl)] font-black leading-tight text-[var(--text-primary)]"
      >
        Seven papers that work it out
      </h2>
      <p className="mt-[var(--space-2)] text-[length:var(--text-lg)] leading-relaxed text-[var(--text-secondary)]">
        Four explain the system, climbing one ladder from the machine to the market. Three hand the safety
        claims to a proof-checker — the same family of tools used to verify TLS 1.3 and the Signal protocol.
      </p>

      {/* How the seven relate: the dependency ladder + which proof underwrites which layer. */}
      <figure className="mt-[var(--space-6)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-5)]">
        <Mermaid chart={PAPERS_RELATION} />
        <figcaption className="mt-[var(--space-3)] text-[length:var(--text-base)] text-[var(--text-muted)]">
          No market without trust, no trust without reputation, no reputation without memory, no memory without a
          kernel keeping the logbook. Solid arrows are the dependency ladder; dashed arrows show which proof
          underwrites which layer.
        </figcaption>
      </figure>

      {/* Three crypto deep dives — shipped, real content surfaced in-line. */}
      <div className="mt-[var(--blog-subsection-break)] flex items-center gap-2 text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--signal-charlie)]">
        <Stamp size={15} aria-hidden="true" /> Three crypto deep dives · proof-checked
      </div>
      <div className="mt-[var(--space-3)] grid gap-[var(--space-4)] lg:grid-cols-3">
        {cryptoPapers.map((p) => (
          <ShippedPaperCard key={p.title} spec={p} />
        ))}
      </div>

      {/* Four product-layer papers — the L0→L3 ladder, machine up to market. */}
      <div className="mt-[var(--blog-subsection-break)] flex items-center gap-2 text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
        <BookOpen size={15} aria-hidden="true" /> Four product layers · L0 → L3
      </div>
      <div className="mt-[var(--space-3)] grid gap-px border-2 border-[var(--border-strong)] bg-[var(--border-strong)] sm:grid-cols-2">
        {layerPapers.map((p) => (
          <article key={p.title} className="flex flex-col gap-[var(--space-2)] bg-[var(--surface-raised)] p-[var(--space-5)]">
            <div className="flex items-center justify-between">
              <span className="border border-[var(--border-strong)] bg-[var(--surface-sunken)] px-2 py-0.5 font-mono text-[length:var(--type-meta-size)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                {p.layer} · {p.layerName}
              </span>
              <span className="font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
                for {p.forWhom}
              </span>
            </div>
            <h3 className="font-display text-[length:var(--text-lg)] font-black text-[var(--text-primary)]">{p.title}</h3>
            <p className="text-[length:var(--text-base)] leading-relaxed text-[var(--text-secondary)]">{p.blurb}</p>
          </article>
        ))}
      </div>

      <div className="mt-[var(--space-6)]">
        <Link
          to="/whitepaper"
          className="inline-flex items-center gap-2 border-2 border-[var(--border-strong)] bg-[var(--text-primary)] px-[var(--space-5)] py-[var(--space-3)] font-sans text-[length:var(--text-base)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--surface-base)] transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)]"
        >
          Read the papers
          <ArrowLeft size={16} className="rotate-180" aria-hidden="true" />
        </Link>
      </div>
    </section>
  )
}

export function ManifestoPage() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001,
  })

  // Resolve sidenote directives in the manifesto markdown (same machinery as
  // the field log). The manifesto has no code-fence directives, so we use the
  // cleaned output and ignore the code-block directive map.
  const { cleaned } = useMemo(() => extractDirectives(manifestoContent), [])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex min-h-screen flex-col bg-[var(--surface-base)] font-sans selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
    >
      <motion.div
        className="fixed left-0 right-0 z-50 h-1 origin-left bg-[var(--brand-primary)]"
        style={{ scaleX, top: 'var(--nav-height)' }}
      />

      {/* Hero — Swiss-modern: type-led, one accent, hard alignment. */}
      <motion.header className="relative overflow-hidden border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-6 py-20 sm:px-8 lg:px-10 lg:py-24">
        <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[10rem_minmax(0,1fr)]">
          <Link to="/whitepaper" className="group no-underline">
            <div className="flex items-center gap-2 text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)] transition-colors group-hover:text-[var(--brand-primary)]">
              <ArrowLeft size={14} className="transition-transform group-hover:-translate-x-1" />
              The papers
            </div>
          </Link>

          <div className="flex flex-col gap-6">
            <SectionEyebrow>
              <FileText size={14} className="text-[var(--brand-secondary)]" aria-hidden="true" />
              {manifestoMeta.eyebrow}
            </SectionEyebrow>

            <motion.h1
              className="max-w-[18ch] font-display text-4xl font-black leading-[0.95] tracking-normal text-[var(--text-primary)] sm:text-6xl lg:text-7xl"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            >
              {manifestoMeta.title}
            </motion.h1>

            <p className="max-w-3xl text-[length:var(--text-lg)] italic leading-relaxed text-[var(--text-secondary)] sm:text-[length:var(--text-xl)]">
              {manifestoMeta.subtitle}
            </p>

            <div className="text-[length:var(--type-meta-size)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
              {manifestoMeta.readingTime}
            </div>
          </div>
        </div>
      </motion.header>

      {/* Tufte two-column on lg+: prose left, sidenote gutter right — the same
          reading model as the field log. */}
      <motion.main id="main-content" className="relative flex-1 px-6 py-12 sm:px-8 lg:px-10 lg:py-16">
        <div className="mx-auto w-full max-w-[80ch] lg:max-w-[calc(80ch+22ch)] lg:grid lg:grid-cols-[minmax(0,80ch)_minmax(0,18ch)] lg:gap-x-[4ch]">
          <motion.article
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="blog-article blog-article--tufte lg:col-start-1 lg:col-end-2"
          >
            <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
              {cleaned}
            </ReactMarkdown>
          </motion.article>
        </div>

        {/* Designed technical band: the diagram, the technology, the math, the
            papers. Placed after the prose so the markdown footnotes stay intact. */}
        <CollisionDiagram />
        <ScopeSection />
        <TechnologySection />
        <MathSection />
        <PapersSection />

        <div className="mx-auto mt-16 w-full max-w-[80ch]">
          <GiscusComments term="manifesto" />
        </div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}

export default ManifestoPage
