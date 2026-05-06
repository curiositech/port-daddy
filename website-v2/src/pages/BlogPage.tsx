import { Link } from 'react-router-dom'
import { blogPosts, deprecatedBlogPosts, type BlogPost } from '@/data/blogData'
import { Activity, ArrowUpRight, Calendar, CheckCircle2, Cpu, GitBranch, NotebookText, ShieldCheck, Terminal } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'

const focusLanes = [
  {
    icon: Activity,
    title: 'Control-plane truth',
    body: 'FleetBar, Fleet Control Center, project identity, launch state, and runtime provenance that can be inspected before work starts.',
  },
  {
    icon: ShieldCheck,
    title: 'Fail-closed launches',
    body: 'Backend readiness, exact telemetry, model rates, budget ceilings, and explicit blocked states.',
  },
  {
    icon: GitBranch,
    title: 'Recoverable agent work',
    body: 'Session notes, claims, stale work, roadmap drift, and evidence that lets a different model resume cleanly.',
  },
  {
    icon: Terminal,
    title: 'Local integration loops',
    body: 'PD Tube, guard checks, daemon provenance, and command surfaces that let ordinary tools reach the live agent session.',
  },
]

function DateStamp({ date }: { date: string }) {
  return (
    <time dateTime={date} className="inline-flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
      <Calendar size={13} aria-hidden="true" />
      {date}
    </time>
  )
}

function Tag({ children }: { children: string }) {
  return (
    <span className="border border-[var(--border-default)] bg-[var(--surface-base)] px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
      {children}
    </span>
  )
}

function ArticleImage({ post, eager = false }: { post: BlogPost; eager?: boolean }) {
  return (
    <div className="relative aspect-[16/9] w-full overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-sunken)]">
      <img
        src={post.heroImage}
        alt={post.heroAlt}
        className="h-full w-full object-cover"
        loading={eager ? 'eager' : 'lazy'}
      />
    </div>
  )
}

function FeaturedArticle({ post }: { post: BlogPost }) {
  return (
    <article className="grid gap-0 border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] lg:grid-cols-[minmax(0,1.08fr)_minmax(20rem,0.92fr)]">
      <Link to={`/blog/${post.slug}`} className="block no-underline">
        <ArticleImage post={post} eager />
      </Link>
      <div className="flex min-w-0 flex-col justify-between gap-8 border-t-2 border-[var(--border-strong)] p-5 sm:p-7 lg:border-l-2 lg:border-t-0 lg:p-8">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <Tag>Featured</Tag>
            <DateStamp date={post.date} />
          </div>
          <Link to={`/blog/${post.slug}`} className="group block no-underline">
            <h2 className="max-w-[13ch] text-3xl font-black leading-[0.95] tracking-normal text-[var(--text-primary)] sm:text-5xl">
              {post.title}
            </h2>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-[var(--text-secondary)] sm:text-lg">
              {post.excerpt}
            </p>
          </Link>
        </div>
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-2">
            {post.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}
          </div>
          <Link
            to={`/blog/${post.slug}`}
            className="inline-flex w-fit items-center gap-2 border-2 border-[var(--border-strong)] bg-[var(--text-primary)] px-4 py-3 text-[var(--text-inverse)] no-underline transition-colors hover:bg-[var(--brand-primary)]"
          >
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.16em]">Read article</span>
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  )
}

function ArticleRow({ post, index }: { post: BlogPost; index: number }) {
  return (
    <article className="grid gap-5 border-t-2 border-[var(--border-strong)] py-6 sm:grid-cols-[10rem_minmax(0,1fr)_12rem] sm:gap-6 lg:grid-cols-[13rem_minmax(0,1fr)_15rem]">
      <Link to={`/blog/${post.slug}`} className="block no-underline">
        <ArticleImage post={post} />
      </Link>
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
            {String(index + 2).padStart(2, '0')}
          </span>
          <DateStamp date={post.date} />
        </div>
        <Link to={`/blog/${post.slug}`} className="group block no-underline">
          <h3 className="max-w-2xl text-2xl font-black leading-tight tracking-normal text-[var(--text-primary)] group-hover:text-[var(--brand-primary)]">
            {post.title}
          </h3>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[var(--text-secondary)] sm:text-base">
            {post.excerpt}
          </p>
        </Link>
      </div>
      <div className="flex flex-wrap content-start gap-2 sm:justify-end">
        {post.tags.slice(0, 3).map((tag) => <Tag key={tag}>{tag}</Tag>)}
      </div>
    </article>
  )
}

export function BlogPage() {
  const [featured, ...rest] = blogPosts

  return (
    <div className="min-h-screen bg-[var(--surface-base)] text-[var(--text-primary)] selection:bg-[var(--brand-primary)] selection:text-[var(--text-inverse)]">
      <header className="border-b-2 border-[var(--border-strong)] px-4 py-12 sm:px-6 sm:py-16 lg:px-10 lg:py-20">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-7">
            <div className="mb-5 flex flex-wrap gap-2">
              <Tag>Port Daddy Blog</Tag>
              <Tag>AI infrastructure notes</Tag>
              <Tag>Current as of 2026-05-06</Tag>
            </div>
            <h1 className="max-w-[12ch] text-5xl font-black leading-[0.9] tracking-normal text-[var(--text-primary)] sm:text-7xl lg:text-[5.8rem]">
              Engineering notes for agent control planes
            </h1>
            <p className="mt-6 max-w-2xl text-2xl font-black leading-tight tracking-normal text-[var(--text-primary)] sm:text-3xl">
              What breaks when coding agents share a repo, and what a control plane has to make true.
            </p>
          </div>

          <div className="grid gap-6 lg:col-span-5 lg:self-end">
            <p className="max-w-xl text-base leading-relaxed text-[var(--text-secondary)] sm:text-lg">
              A technical journal for AI engineers evaluating Port Daddy as infrastructure: shared state, ownership, launch gates, PD Tube, recovery maps, daemon provenance, and coordination policy.
            </p>
            <div className="grid grid-cols-3 border-2 border-[var(--border-strong)]">
              <div className="border-r-2 border-[var(--border-strong)] p-4">
                <div className="font-mono text-3xl font-black leading-none">{blogPosts.length}</div>
                <div className="mt-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Current</div>
              </div>
              <div className="border-r-2 border-[var(--border-strong)] p-4">
                <div className="font-mono text-3xl font-black leading-none">{deprecatedBlogPosts.length}</div>
                <div className="mt-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Retired</div>
              </div>
              <div className="p-4">
                <div className="font-mono text-3xl font-black leading-none">0</div>
                <div className="mt-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Future-dated</div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main id="main-content" className="px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
        <div className="mx-auto max-w-7xl space-y-14">
          <section aria-labelledby="focus-lanes" className="grid gap-4 border-b-2 border-[var(--border-strong)] pb-10 sm:grid-cols-2 lg:grid-cols-4">
            <h2 id="focus-lanes" className="sr-only">Blog focus lanes</h2>
            {focusLanes.map((lane) => {
              const Icon = lane.icon
              return (
                <div key={lane.title} className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-5">
                  <div className="mb-5 flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
                    <Icon size={18} aria-hidden="true" />
                  </div>
                  <h3 className="text-base font-black tracking-normal text-[var(--text-primary)]">{lane.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">{lane.body}</p>
                </div>
              )
            })}
          </section>

          {featured && <FeaturedArticle post={featured} />}

          <section aria-labelledby="article-index" className="space-y-0">
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <div className="mb-2 flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  <NotebookText size={14} aria-hidden="true" />
                  Article index
                </div>
                <h2 id="article-index" className="text-2xl font-black tracking-normal text-[var(--text-primary)]">Current technical articles</h2>
              </div>
              <Cpu className="hidden text-[var(--text-muted)] sm:block" size={24} aria-hidden="true" />
            </div>
            {rest.map((post, index) => <ArticleRow key={post.id} post={post} index={index} />)}
            <div className="border-t-2 border-[var(--border-strong)]" />
          </section>

          <section aria-labelledby="retired-threads" className="grid gap-6 border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-5 sm:p-7 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <div>
              <div className="mb-3 flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
                <CheckCircle2 size={18} aria-hidden="true" />
              </div>
              <h2 id="retired-threads" className="text-2xl font-black tracking-normal text-[var(--text-primary)]">Retired threads</h2>
              <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
                Future-dated, stale, or visually off-brief articles are no longer part of the public index. Old slugs resolve to current replacements.
              </p>
            </div>
            <div className="divide-y-2 divide-[var(--border-strong)] border-2 border-[var(--border-strong)]">
              {deprecatedBlogPosts.slice(0, 6).map((post) => (
                <div key={post.slug} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,0.75fr)_minmax(0,1fr)]">
                  <div className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-primary)]">
                    {post.retiredLabel}
                  </div>
                  <div className="text-sm leading-relaxed text-[var(--text-secondary)]">
                    {post.reason}
                    <Link to={`/blog/${post.replacementSlug}`} className="ml-2 inline-flex items-center gap-1 font-semibold text-[var(--brand-primary)]">
                      Replacement <ArrowUpRight size={13} aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  )
}
