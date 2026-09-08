import { isValidElement, useMemo, type ReactElement, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion, useScroll, useSpring } from 'framer-motion'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowLeft, FileText, ShieldCheck, BookOpen, Stamp } from 'lucide-react'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Mermaid } from '@/components/ui/Mermaid'
import { GiscusComments } from '@/components/blog/GiscusComments'
import { Footer } from '@/components/layout/Footer'
import { ThemedImage } from '@/components/site/ThemedImage'
import { extractDirectives, SIDENOTE_PATTERN } from '@/lib/blogDirectives'
import {
  cryptoPapers,
  harborEvolutionFigure,
  layerPapers,
  manifestoCaptions,
  manifestoContent,
  manifestoMeta,
  ologFunctorFigure,
  technologyPrimitives,
} from '@/data/manifestoContent'
import { findWhitePaperById } from '@/data/whitePapers'

// Figures that should float so prose wraps around them, and the side they go on.
const WRAP_FIGURES: Record<string, 'right' | 'left'> = {
  '/img/manifesto/collision.webp': 'right',
  '/img/manifesto/legibility-zoom.webp': 'left',
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

/** Flatten an H2's React children to plain text so we can match the heading. */
function headingText(children: ReactNode): string {
  const parts: string[] = []
  const walk = (node: ReactNode): void => {
    if (typeof node === 'string' || typeof node === 'number') {
      parts.push(String(node))
    } else if (Array.isArray(node)) {
      node.forEach(walk)
    } else if (isValidElement<{ children?: ReactNode }>(node)) {
      walk(node.props.children)
    }
  }
  walk(children)
  return parts.join('').trim()
}

// Diagrams/figures are placed at the prose anchor where the text first discusses
// them — keyed by the H2 they should appear *before*. The single ReactMarkdown
// render is preserved (so footnotes resolve), and the custom `h2` renderer emits
// the matching figure immediately ahead of its heading.
const DIAGRAMS_BEFORE_HEADING: Record<string, () => ReactElement> = {
  // The state of nature — agents colliding over one file — opens the piece as an
  // establishing drawing right before the "3 a.m." scene it illustrates.
  'Start with the file': () => <StateOfNatureFigure />,
  // The file collision is laid out in "Start with the file"; the drawn race and
  // the single-writer fix belong as the reader turns to the economics framing.
  'Agents are becoming economic actors. They have no economy.': () => <CollisionDiagram />,
  // The harbor-master that ends the scramble — order you can check, not trust.
  'The Leviathan you can check': () => <LeviathanHarborFigure />,
  // "The Leviathan you can check" ends on "one process → one machine → many
  // machines" — the harbor-evolution drawing makes that arc literal.
  'Now the part that sounds insane': () => <HarborEvolutionFigure />,
  // The olog/functor idea is introduced just above; the figure + plain-language
  // gloss meet the reader before the honest caveat reins the claim back in.
  'The honest caveat is the whole case': () => <OlogFunctorFigure />,
  // The operad/wiring-diagram figure grounds the abstract category theory back
  // in Port Daddy's mechanics (the claim is decisive by type), then
  // Myerson–Satterthwaite (the impossibility wall) underwrites the market design
  // the "bonded commons" section builds on.
  'The bonded commons is the missing market microstructure': () => (
    <>
      <OperadWiringFigure />
      <MathSection />
    </>
  ),
  // The verifiable bond — collateral plus a receipt anyone can check — is what
  // lets the big claim be earned rather than asserted.
  'Earn the big claim': () => <BondReceiptFigure />,
}

const markdownComponents: Components = {
  h2({ children }) {
    const text = headingText(children)
    const Diagram = DIAGRAMS_BEFORE_HEADING[text]
    return (
      <>
        {Diagram ? <Diagram /> : null}
        <h2>{children}</h2>
      </>
    )
  },

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
        {src ? <ThemedImage src={src} alt={alt} loading="lazy" /> : null}
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
    Note over A,B: One writer at a time — the overwrite is visible and recoverable, not silent.`

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
    <section aria-labelledby="collision-heading" className="mx-auto mt-[var(--blog-section-break)] w-full max-w-[64rem]">
      <SectionEyebrow>The race, drawn</SectionEyebrow>
      <h2
        id="collision-heading"
        className="mt-[var(--space-3)] font-display text-[length:var(--text-2xl)] font-black leading-tight text-[var(--text-primary)]"
      >
        One file, two writers, one survivor
      </h2>
      <p className="mt-[var(--space-2)] max-w-[60ch] text-[length:var(--text-lg)] leading-relaxed text-[var(--text-secondary)]">
        Same two agents, same file, read top to bottom. The only structural difference is who keeps the logbook.
      </p>
      <div className="mt-[var(--space-6)] flex flex-col gap-[var(--space-6)]">
        <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-5)]">
          <div className="mb-[var(--space-3)] flex items-center gap-2 text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--status-error)]">
            Without a harbor-master — both think they own the file
          </div>
          <Mermaid chart={COLLISION_DIAGRAM} />
        </div>
        <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-5)]">
          <div className="mb-[var(--space-3)] flex items-center gap-2 text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
            With Port Daddy — one writer at a time, the other sees it
          </div>
          <Mermaid chart={FIX_DIAGRAM} />
        </div>
      </div>
    </section>
  )
}

/** A single full-width manifesto plate: one house-style drawing + a meaning
 *  caption. Used for the establishing figures that sit before a section heading,
 *  so the manifesto carries its argument in pictures as well as prose. */
function ManifestoPlate({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure className="mx-auto mt-[var(--blog-section-break)] w-full max-w-[80ch] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-5)]">
      <ThemedImage
        src={src}
        alt={alt}
        loading="lazy"
        className="block w-full border border-[var(--border-default)] bg-[var(--surface-base)]"
      />
      <figcaption className="mt-[var(--space-3)] text-[length:var(--text-base)] leading-relaxed text-[var(--text-muted)]">
        {caption}
      </figcaption>
    </figure>
  )
}

/** Establishing image for "Start with the file" — the war of all against all. */
function StateOfNatureFigure() {
  return (
    <ManifestoPlate
      src="/img/generated/manifesto/hero-state-of-nature.webp"
      alt="A blueprint-style pen drawing on cream graph paper: five or six small tugboats all crowd the same stone berth at once with no harbor-master, bumping and knocked askew, while an open logbook sits ignored on a pedestal at the pier's edge. A small spilled crate in red ink marks the lost work."
      caption="The state of nature: every agent races for the same berth, no one keeps the logbook, and the work that gets erased still looks finished."
    />
  )
}

/** Establishing image for "The Leviathan you can check" — order without trust. */
function LeviathanHarborFigure() {
  return (
    <ManifestoPlate
      src="/img/generated/manifesto/leviathan-harbor.webp"
      alt="A blueprint-style pen drawing on cream graph paper: a tall lighthouse — the harbor-master — sweeps a ruled beam across calm water where many small tugboats move in tidy parallel lanes, each heading to its own numbered berth, with no collisions."
      caption="The Leviathan you can check: one office hands out berths, every lane is visible to all, and order replaces the scramble — without anyone having to be trusted."
    />
  )
}

/** Establishing image for "Earn the big claim" — the verifiable bond. */
function BondReceiptFigure() {
  return (
    <ManifestoPlate
      src="/img/generated/manifesto/verified-bond-receipt.webp"
      alt="A blueprint-style pen drawing on cream graph paper: a hand-drawn BOND RECEIPT certificate with a red wax seal, a stack of coins labelled as posted collateral, and a magnifying glass held over a check-mark verifying the signature."
      caption="A bond posts collateral and a receipt anyone can verify: slashed if the agent misbehaves, returned if it behaves. Skin in the game, made checkable."
    />
  )
}

/** The harbor-evolution drawing (I → II → III) with the three stages re-stated in words. */
function HarborEvolutionFigure() {
  return (
    <figure className="mx-auto mt-[var(--blog-section-break)] w-full max-w-[80ch] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-5)]">
      <ThemedImage
        src={harborEvolutionFigure.src}
        alt={harborEvolutionFigure.alt}
        loading="lazy"
        className="block w-full border border-[var(--border-default)] bg-[var(--surface-base)]"
      />
      <div className="mt-[var(--space-4)] grid gap-px border-2 border-[var(--border-strong)] bg-[var(--border-strong)] sm:grid-cols-3">
        {harborEvolutionFigure.stages.map((stage) => (
          <div key={stage.numeral} className="flex flex-col gap-[var(--space-2)] bg-[var(--surface-raised)] p-[var(--space-4)]">
            <span className="font-mono text-[length:var(--text-2xl)] font-black leading-none text-[var(--brand-primary)]">
              {stage.numeral}
            </span>
            <span className="text-[length:var(--text-base)] leading-relaxed text-[var(--text-secondary)]">{stage.label}</span>
          </div>
        ))}
      </div>
      <figcaption className="mt-[var(--space-3)] text-[length:var(--text-base)] leading-relaxed text-[var(--text-muted)]">
        {harborEvolutionFigure.caption}
      </figcaption>
    </figure>
  )
}

/** The olog/functor drawing with a plain-language gloss for non-mathematicians. */
function OlogFunctorFigure() {
  return (
    <section
      aria-labelledby="functor-heading"
      className="mx-auto mt-[var(--blog-section-break)] w-full max-w-[80ch]"
    >
      <figure className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-5)]">
        <ThemedImage
          src={ologFunctorFigure.src}
          alt={ologFunctorFigure.alt}
          loading="lazy"
          className="block w-full border border-[var(--border-default)] bg-[var(--surface-base)]"
        />
        <figcaption className="mt-[var(--space-3)] text-[length:var(--text-base)] leading-relaxed text-[var(--text-muted)]">
          {ologFunctorFigure.caption}
        </figcaption>
      </figure>
      <figure className="mt-[var(--space-5)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-5)]">
        <ThemedImage
          src="/img/generated/manifesto/olog-exchange.webp"
          alt="A blueprint-style pen drawing on cream graph paper: two ologs of labelled boxes joined by a functor F. Left (olog A): a person is born in a city, a city is in a country, a person is a citizen of a country. Right (olog B): a class is declared in a file, a file lives in a package, a class belongs to a package. F maps person to class, city to file, country to package, and each arrow to its match; the 'is in' / 'lives in' pair is highlighted in red."
          loading="lazy"
          className="block w-full border border-[var(--border-default)] bg-[var(--surface-base)]"
        />
        <figcaption className="mt-[var(--space-3)] text-[length:var(--text-base)] leading-relaxed text-[var(--text-muted)]">
          The same move in the abstract: an olog is a diagram of labelled boxes and arrows, and a functor between two
          ologs carries every arrow across, not just the boxes — that is what makes the structure travel. The catch the
          rest of this section insists on: a functor like this is exactly what is hard to find. Most analogies are leaky
          spans wearing a functor&rsquo;s coat.
        </figcaption>
      </figure>
      <div className="mt-[var(--space-5)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-6)]">
        <SectionEyebrow>Functors on ologs, in plain words</SectionEyebrow>
        <h2
          id="functor-heading"
          className="mt-[var(--space-3)] font-display text-[length:var(--text-xl)] font-black leading-tight text-[var(--text-primary)]"
        >
          What the picture is saying
        </h2>
        <div className="mt-[var(--space-3)] flex flex-col gap-[var(--space-3)]">
          {ologFunctorFigure.explainer.map((para) => (
            <p key={para.slice(0, 24)} className="text-[length:var(--text-lg)] leading-relaxed text-[var(--text-secondary)]">
              {para}
            </p>
          ))}
        </div>
      </div>
    </section>
  )
}

function ManifestoMono({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[0.92em] text-[var(--brand-primary)]">{children}</code>
}

/**
 * The operad / wiring-diagram figure: the 3 a.m. collision drawn as a typed task
 * decomposition where `merge` structurally requires the Claim. This is the other
 * half of Spivak's category theory the manifesto leans on — functors say *what*
 * transports between domains; operads say *how* one domain's work composes — and
 * it is the formalism that actually describes a harbor coordinating agents.
 */
function OperadWiringFigure() {
  return (
    <section aria-labelledby="operad-heading" className="mx-auto mt-[var(--blog-section-break)] w-full max-w-[80ch]">
      <figure className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-5)]">
        <ThemedImage
          src="/img/generated/manifesto/operad-wiring.webp"
          alt="A blueprint-style wiring diagram on cream graph paper. Boxes wired left to right: 'claim' takes a Task and emits a Claim; 'implement' takes a Task and the Claim and emits a Patch; the Patch forks to 'test' (emitting Tests) and 'review' (emitting Review) running in parallel; 'merge' takes Patch, Tests, Review and the Claim and emits a Merge. The Claim wire is drawn in red the whole way from claim to merge, annotated 'no Claim, no Merge'."
          loading="lazy"
          className="block w-full border border-[var(--border-default)] bg-[var(--surface-base)]"
        />
        <figcaption className="mt-[var(--space-3)] text-[length:var(--text-base)] leading-relaxed text-[var(--text-muted)]">
          The 3 a.m. collision, drawn as types. Each box is an operation with typed inputs and one typed output;
          <ManifestoMono>test</ManifestoMono> and <ManifestoMono>review</ManifestoMono> run in parallel; and
          <ManifestoMono>merge</ManifestoMono> takes the Claim as an input — the contract the harbor recommends. The claim
          is advisory, made credible by an observable history, not a hard lock.
        </figcaption>
      </figure>
      <div className="mt-[var(--space-5)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-6)]">
        <SectionEyebrow>Operads, or how the harbor composes</SectionEyebrow>
        <h2
          id="operad-heading"
          className="mt-[var(--space-3)] font-display text-[length:var(--text-xl)] font-black leading-tight text-[var(--text-primary)]"
        >
          Functors say what transports. Operads say how it composes.
        </h2>
        <div className="mt-[var(--space-3)] flex flex-col gap-[var(--space-3)] text-[length:var(--text-lg)] leading-relaxed text-[var(--text-secondary)]">
          <p>
            An <strong>operad</strong> is Spivak&rsquo;s other construction: the algebra of typed boxes wired together —
            a thing decomposes into simpler things, and the decomposition itself composes. It is the exact formalism for
            a harbor that coordinates many agents, where each box has typed input and output ports and you may only wire
            ports whose types match.
          </p>
          <p>
            Read the diagram as the opening collision, made honest. <ManifestoMono>claim</ManifestoMono> hands out a
            single-writer <ManifestoMono>Claim</ManifestoMono>; <ManifestoMono>implement</ManifestoMono> turns a{' '}
            <ManifestoMono>Task</ManifestoMono> and that <ManifestoMono>Claim</ManifestoMono> into a{' '}
            <ManifestoMono>Patch</ManifestoMono>; <ManifestoMono>test</ManifestoMono> and{' '}
            <ManifestoMono>review</ManifestoMono> run in parallel on it; <ManifestoMono>merge</ManifestoMono> combines the{' '}
            <ManifestoMono>Patch</ManifestoMono>, the <ManifestoMono>Tests</ManifestoMono>, the{' '}
            <ManifestoMono>Review</ManifestoMono> — and the <ManifestoMono>Claim</ManifestoMono> — into a committed{' '}
            <ManifestoMono>Merge</ManifestoMono>.
          </p>
          <p>
            The whole argument is the red wire — kept honest. Port Daddy&rsquo;s file claims are{' '}
            <em>advisory</em>, not a hard lock: an agent technically can merge without one. What holds the contract
            together is not enforcement but incentives — with an observable, immutable history and a persistent
            identity, defecting from the wiring costs more than complying (the folk-theorem result for repeated games),
            and where the stakes demand a real wall, Anchor&rsquo;s capability tokens supply one cryptographically. So{' '}
            <ManifestoMono>merge</ManifestoMono> &ldquo;needs&rdquo; the <ManifestoMono>Claim</ManifestoMono> is a
            contract the harbor makes legible and self-enforcing — institutions, not cleverness — without pretending the
            wiring physically forbids the merge.
          </p>
        </div>
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
            <h3 className="font-display text-[length:var(--text-base)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)]">
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
      <p className="max-w-[46ch] text-[length:var(--type-panel-body-size)] leading-[var(--leading-body)] text-[var(--text-secondary)]">
        {paper?.thesis ?? spec.blurb}
      </p>

      {sectionTitles.length > 0 && (
        <ul className="flex flex-col gap-[var(--space-2)]">
          {sectionTitles.map((t) => (
            <li
              key={t}
              className="flex items-start gap-[var(--space-2)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]"
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
    <section aria-labelledby="papers-heading" className="mx-auto mt-[var(--blog-section-break)] w-full max-w-[104ch]">
      <SectionEyebrow>The jewel</SectionEyebrow>
      <h2
        id="papers-heading"
        className="mt-[var(--space-3)] font-display text-[length:var(--text-2xl)] font-black leading-tight text-[var(--text-primary)]"
      >
        Seven papers that work it out
      </h2>
      <p className="mt-[var(--space-2)] max-w-[80ch] text-[length:var(--text-lg)] leading-relaxed text-[var(--text-secondary)]">
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

      {/* Three crypto deep dives — shipped, real content surfaced in-line.
          One column on narrow, two on wide: each card keeps a comfortable
          ~40ch+ measure instead of the three cramped columns it used to be. */}
      <div className="mt-[var(--blog-subsection-break)] flex items-center gap-2 text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--signal-charlie)]">
        <Stamp size={15} aria-hidden="true" /> Three crypto deep dives · proof-checked
      </div>
      <div className="mt-[var(--space-3)] grid gap-[var(--space-4)] sm:grid-cols-2">
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

        {/* The race diagram, the harbor-evolution figure, the olog/functor figure,
            and the impossibility wall are now interleaved INLINE at their prose
            anchors (see DIAGRAMS_BEFORE_HEADING). What stays at the close is the
            "what you install" band and "the jewel" — the seven-paper grid — which
            the final prose section sets up. The single markdown render keeps the
            footnotes intact. */}
        <TechnologySection />
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
