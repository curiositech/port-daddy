import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion, useScroll, useSpring } from 'framer-motion'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowLeft, FileText } from 'lucide-react'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { GiscusComments } from '@/components/blog/GiscusComments'
import { Footer } from '@/components/layout/Footer'
import { manifestoContent, manifestoMeta } from '@/data/manifestoContent'

interface MarkdownCodeElementProps {
  className?: string
  children?: ReactNode
}

function isCodeElement(node: ReactNode): node is ReactElement<MarkdownCodeElementProps> {
  return isValidElement<MarkdownCodeElementProps>(node)
}

const markdownComponents: Components = {
  // Code fences render through the shared CodeBlock so syntax + copy controls
  // match the rest of the site. The manifesto's single fence is an unlabeled
  // shell command (the install line).
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

  // Internal links go through React Router; external open in a new tab.
  a({ href, children, ...rest }) {
    if (href?.startsWith('/')) return <Link to={href}>{children}</Link>
    // Footnote back-references / anchors stay as plain anchors so remark-gfm's
    // jump behaviour keeps working.
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

  // Images become captioned figures using the alt text.
  img({ src, alt }) {
    return (
      <figure>
        <img src={src} alt={alt} loading="lazy" />
        {alt && <figcaption>{alt}</figcaption>}
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

export function ManifestoPage() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001,
  })

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex min-h-screen flex-col bg-[var(--surface-base)] font-sans selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
    >
      {/* Reading-progress bar, anchored under the sticky nav. */}
      <motion.div
        className="fixed left-0 right-0 z-50 h-1 origin-left bg-[var(--brand-primary)]"
        style={{ scaleX, top: 'var(--nav-height)' }}
      />

      {/* Hero — Swiss-modern: type does the work, one accent, hard alignment. */}
      <motion.header className="relative overflow-hidden border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-6 py-20 sm:px-8 lg:px-10 lg:py-24">
        <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[10rem_minmax(0,1fr)]">
          <Link to="/whitepaper" className="group no-underline">
            <div className="flex items-center gap-2 text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)] transition-colors group-hover:text-[var(--brand-primary)]">
              <ArrowLeft size={14} className="transition-transform group-hover:-translate-x-1" />
              The papers
            </div>
          </Link>

          <div className="flex flex-col gap-6">
            <span className="inline-flex w-fit items-center gap-2 border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-3 py-1 font-mono text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
              <FileText size={14} className="text-[var(--brand-secondary)]" aria-hidden="true" />
              {manifestoMeta.eyebrow}
            </span>

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

      {/* Main prose column — same .blog-article typography pipeline as the
          field log, so spacing, footnotes, figures, and pull-quotes all match
          the established system rather than inventing a parallel one. */}
      <motion.main id="main-content" className="relative flex-1 px-6 py-12 sm:px-8 lg:px-10 lg:py-16">
        <motion.article
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="blog-article mx-auto w-full max-w-[80ch]"
        >
          <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
            {manifestoContent}
          </ReactMarkdown>
        </motion.article>

        <div className="mx-auto mt-16 w-full max-w-[80ch]">
          <GiscusComments term="manifesto" />
        </div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}

export default ManifestoPage
