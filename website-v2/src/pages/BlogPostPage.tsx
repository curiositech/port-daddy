import { isValidElement, useMemo, type ReactElement, type ReactNode } from 'react'
import { useParams, Link, Navigate } from 'react-router-dom'
import { motion, useScroll, useSpring } from 'framer-motion'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { blogPosts, deprecatedBlogPosts } from '@/data/blogData'
import { Mermaid } from '@/components/ui/Mermaid'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { CommandTerminal } from '@/components/ui/CommandTerminal'
import { Surface } from '@/components/ui/Surface'
import { BlogComments } from '@/components/blog/BlogComments'
import { Calendar, User, ArrowLeft } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import { extractDirectives, SIDENOTE_PATTERN } from '@/lib/blogDirectives'
import { ThemedImage } from '@/components/site/ThemedImage'

// ─── Directive system ─────────────────────────────────────────────────────
// HTML comments in markdown declare how the NEXT block should render:
//   <!-- terminal -->            → CommandTerminal (CLI input/output)
//   <!-- syllogism: FILENAME --> → Document card with filename header
//   <!-- code -->                → CodeBlock (explicit, same as default)
//   <!-- figure: CAPTION -->     → Mermaid diagram with caption text
//   <!-- sidenote: LABEL? -->    → Tufte-style right-gutter aside, anchored
//                                  to the NEXT paragraph/blockquote.
//                                  Drops inline below the anchor on narrow
//                                  viewports.
//
// terminal/syllogism/code/figure attach to the next CODE FENCE.
// sidenote attaches to the next PARAGRAPH or BLOCKQUOTE (never a code fence).
//
// Unmarked code blocks default to CodeBlock. Mermaid blocks default to
// figure with auto-caption unless overridden.

interface MarkdownCodeElementProps {
  className?: string
  children?: ReactNode
}

function isCodeElement(node: ReactNode): node is ReactElement<MarkdownCodeElementProps> {
  return isValidElement<MarkdownCodeElementProps>(node)
}

function PostTag({ children }: { children: string }) {
  return (
    <span className="border border-[var(--border-default)] bg-[var(--surface-base)] px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
      {children}
    </span>
  )
}

/**
 * If the first string child of a markdown-rendered block begins with our
 * sidenote sentinel, return the parsed label plus the stripped children.
 * Otherwise null.
 */
function consumeSidenoteSentinel(children: ReactNode): { label: string; stripped: ReactNode[] } | null {
  const arr = Array.isArray(children) ? [...children] : [children]
  if (arr.length === 0) return null
  const first = arr[0]
  if (typeof first !== 'string') return null
  const match = SIDENOTE_PATTERN.exec(first)
  if (!match) return null
  const label = match[1]
  const remainder = first.slice(match[0].length)
  if (remainder.length > 0) {
    arr[0] = remainder
  } else {
    arr.shift()
  }
  return { label, stripped: arr }
}

/** Render a syllogism as a document card */
function SyllogismCard({ text, filename }: { text: string; filename: string }) {
  return (
    <Surface depth="inset" radius="none" padding="none" className="my-8 max-w-xl">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border-subtle">
        <span className="w-1.5 h-1.5 bg-signal-charlie" />
        <span className="text-xs font-mono font-bold text-text-muted tracking-wider">{filename}</span>
      </div>
      <div className="px-5 py-4 font-mono text-sm leading-relaxed whitespace-pre-wrap text-text-secondary">
        {text.split('\n').map((line, i) => {
          if (line.startsWith('PREMISE')) return <div key={i} className="text-channel-scope">{line}</div>
          if (line.startsWith('THEREFORE')) return <div key={i} className="text-signal-charlie font-bold mt-2">{line}</div>
          if (line.startsWith('CONFIDENCE') || line.startsWith('EFFORT')) return <div key={i} className="text-text-muted mt-2 text-xs">{line}</div>
          return <div key={i}>{line || '\u00A0'}</div>
        })}
      </div>
    </Surface>
  )
}

export function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>()
  const post = blogPosts.find(p => p.slug === slug)
  const deprecatedPost = deprecatedBlogPosts.find(p => p.slug === slug)
  const { scrollYProgress } = useScroll()

  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001
  })

  // Pre-process directives from markdown content
  const { cleaned, directives } = useMemo(() => {
    if (!post) return { cleaned: '', directives: new Map() }
    return extractDirectives(post.content.replace(/^\s*#\s+.+\n/, ''))
  }, [post])

  if (!post && deprecatedPost) {
    return <Navigate to={`/blog/${deprecatedPost.replacementSlug}`} replace />
  }

  if (!post) {
    return <Navigate to="/blog" replace />
  }

  const currentIndex = blogPosts.findIndex(p => p.slug === slug)
  const nextPost = currentIndex >= 0 && currentIndex < blogPosts.length - 1 ? blogPosts[currentIndex + 1] : null
  const prevPost = currentIndex > 0 ? blogPosts[currentIndex - 1] : null
  const heroImg = post.heroImage

  // Track code block index across renders
  let codeBlockCounter = 0
  const markdownComponents: Components = {
    // ── Structural overrides only. Typography comes from .blog-article CSS. ──
    pre({ children }) {
      const codeChild = Array.isArray(children) ? children[0] : children
      if (isCodeElement(codeChild)) {
        const cls = codeChild.props.className || ''
        const match = /language-(\w+)/.exec(cls)
        const lang = match?.[1]
        const text = String(codeChild.props.children ?? '').replace(/\n$/, '')
        const blockIndex = codeBlockCounter++
        const directive = directives.get(blockIndex)

        if (lang === 'mermaid') {
          return (
            <figure>
              <Mermaid chart={text} />
              <figcaption>{directive?.arg || 'Diagram'}</figcaption>
            </figure>
          )
        }

        if (directive?.type === 'terminal') {
          return <CommandTerminal code={text} language="bash" animate={false} />
        }

        if (directive?.type === 'syllogism') {
          return <SyllogismCard text={text} filename={directive.arg || 'SYLLOGISM.md'} />
        }

        if (directive?.type === 'figure') {
          return (
            <figure>
              <CodeBlock language={lang}>{text}</CodeBlock>
              <figcaption>{directive.arg}</figcaption>
            </figure>
          )
        }

        return <CodeBlock language={lang}>{text}</CodeBlock>
      }
      return <pre>{children}</pre>
    },

    // Internal links use React Router
    a({ href, children }) {
      if (href?.startsWith('/')) return <Link to={href}>{children}</Link>
      return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    },

    // Paragraph: a sidenote-tagged paragraph becomes ONLY an <aside>. The
    // aside floats into the right gutter on lg+ and drops inline (with a
    // brand-coloured left border) on mobile / narrow viewports.
    p({ children }) {
      const hit = consumeSidenoteSentinel(children)
      if (!hit) return <p>{children}</p>
      return (
        <aside
          className="sidenote"
          role="note"
          aria-label={hit.label ? `Sidenote: ${hit.label}` : 'Sidenote'}
        >
          {hit.label && <span className="sidenote-label">{hit.label}</span>}
          <span className="sidenote-body">{hit.stripped}</span>
        </aside>
      )
    },

    // Blockquote: render as normal. Sidenote-tagged blockquotes are
    // un-quoted in the markdown pre-processor (we strip the `>` markers),
    // so by the time we get here, the input was a real pull-quote.
    blockquote({ children }) {
      return <blockquote>{children}</blockquote>
    },

    // Tables need overflow wrapper
    table({ children }) {
      return <div className="overflow-x-auto"><table>{children}</table></div>
    },

    // Images get figure treatment
    img({ src, alt }) {
      return (
        <figure>
          <ThemedImage
            src={String(src ?? '')}
            alt={alt ?? ''}
          />
          {alt && <figcaption>{alt}</figcaption>}
        </figure>
      )
    },
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-bg-base flex flex-col font-sans selection:bg-brand-primary selection:text-text-inverse"
    >
      {/* Progress Bar */}
      <motion.div
        className="fixed left-0 right-0 h-1 bg-brand-primary z-50 origin-left"
        style={{ scaleX, top: 'var(--nav-height)' }}
      />

      {/* Hero Section */}
      <motion.header className="py-20 lg:py-24 px-6 sm:px-8 lg:px-10 border-b-2 border-border-strong bg-surface-raised relative overflow-hidden">
        <div className="max-w-5xl mx-auto relative z-10 grid gap-8 lg:grid-cols-[10rem_minmax(0,1fr)]">
          <Link to="/blog" className="no-underline group">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-text-muted group-hover:text-brand-primary transition-all">
              <ArrowLeft size={14} className="group-hover:-translate-x-1 transition-transform" />
              Back to the field log
            </div>
          </Link>

          <div className="flex flex-col gap-6">
            <div>
              <PostTag>Field log</PostTag>
            </div>
            <div className="flex flex-wrap items-center gap-5 text-sm sm:text-base font-bold uppercase tracking-wide text-text-secondary font-mono">
              <div className="flex items-center gap-2">
                <Calendar size={18} className="text-brand-primary" />
                {post.date}
              </div>
              <div className="h-5 w-px bg-border-strong" />
              <div className="flex items-center gap-2">
                <User size={18} className="text-brand-secondary" />
                <span className="text-text-primary">{post.author}</span>
              </div>
            </div>

            <motion.h1
              className="max-w-[13ch] text-4xl sm:text-6xl lg:text-7xl font-black tracking-normal font-display leading-[0.9] text-text-primary"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            >
              {post.title}
            </motion.h1>

            <p className="max-w-3xl text-base leading-relaxed text-text-secondary sm:text-lg">{post.excerpt}</p>

            <div className="flex flex-wrap gap-2">
              {post.tags.map(tag => (
                <PostTag key={tag}>{tag}</PostTag>
              ))}
            </div>
          </div>
        </div>
      </motion.header>

      {/* Hero Image */}
      {heroImg && (
        <div className="w-full max-w-6xl mx-auto px-6 -mt-8 relative z-10">
          <div className="relative overflow-hidden border-2 border-border-strong bg-surface-sunken">
            <ThemedImage
              src={heroImg}
              alt={post.heroAlt}
              className="w-full h-auto object-cover max-h-[36rem]"
              loading="eager"
            />
          </div>
        </div>
      )}

      {/* Main Content — Tufte two-column on lg+: prose left, sidenote gutter right. */}
      <motion.main id="main-content" className="flex-1 py-12 lg:py-16 px-6 sm:px-8 lg:px-10 relative">
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

        {/* Prev / Next Navigation */}
        {(prevPost || nextPost) && (
          <div className="mt-16 max-w-[80ch] mx-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
            {prevPost ? (
              <Link to={`/blog/${prevPost.slug}`} className="no-underline group">
                <Surface depth="flat" radius="none" padding="md" interactive>
                  <div className="text-xs font-black uppercase tracking-widest text-text-muted mb-2 flex items-center gap-1">
                    <ArrowLeft size={12} /> Previous
                  </div>
                  <div className="text-base font-display font-bold text-text-primary group-hover:text-brand-primary transition-colors leading-snug">
                    {prevPost.title}
                  </div>
                </Surface>
              </Link>
            ) : <div />}
            {nextPost && (
              <Link to={`/blog/${nextPost.slug}`} className="no-underline group text-right">
                <Surface depth="flat" radius="none" padding="md" interactive>
                  <div className="text-xs font-black uppercase tracking-widest text-text-muted mb-2 flex items-center gap-1 justify-end">
                    Next <ArrowLeft size={12} className="rotate-180" />
                  </div>
                  <div className="text-base font-display font-bold text-text-primary group-hover:text-brand-primary transition-colors leading-snug">
                    {nextPost.title}
                  </div>
                </Surface>
              </Link>
            )}
          </div>
        )}

        {/* Comments */}
        <div className="mt-16 max-w-[80ch] mx-auto">
          <BlogComments slug={post.slug} />
        </div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
