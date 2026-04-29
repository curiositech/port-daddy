import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { blogPosts } from '@/data/blogData'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import { Button } from '@/components/ui/Button'
import {
  Activity,
  Anchor,
  ArrowRight,
  BookOpen,
  Calendar,
  Compass,
  Shield,
  Ship,
  Terminal,
  User,
} from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import {
  BracketLabel,
  DocsCodeBlock,
  PanelBody,
  PanelTitle,
  SurfacePanel,
} from '@/components/site/primitives'

// Hero image mapping — matches blog slug to generated Ideogram hero
const heroImages: Record<string, string> = {
  'zero-to-multi-agent-in-5-minutes': '/img/blog/zero-to-multi-agent-hero.png',
  'the-port-collision-that-ate-my-saturday': '/img/blog/port-collision-hero.png',
  'dead-agents-tell-tales': '/img/blog/dead-agents-hero.png',
  'distributed-locks-two-agents-one-migration': '/img/blog/distributed-locks-hero.png',
  'four-agents-zero-clobber': '/img/blog/four-agents-hero.png',
  'pubsub-self-healing-test-pipeline': '/img/blog/pub-sub-hero.png',
  'fleet-agents-as-infrastructure': '/img/blog/fleet-management-hero.png',
  'spark-and-spider-the-creative-engine': '/img/blog/spark-spider-hero.png',
  'formal-verification-anchor-protocol': '/img/hero-portdaddy.png',
}

// Tag color mapping
const tagVariant = (tag: string): 'teal' | 'red' | 'gold' | 'default' | 'success' => {
  const map: Record<string, 'teal' | 'red' | 'gold' | 'default' | 'success'> = {
    'Getting Started': 'teal',
    'Quickstart': 'teal',
    'CLI': 'default',
    'Advanced': 'red',
    'Fleet': 'gold',
    'Salvage': 'red',
    'Security': 'red',
    'Formal Methods': 'red',
    'Pub/Sub': 'teal',
    'Locks': 'gold',
    'Spark': 'gold',
    'Spider': 'gold',
  }
  return map[tag] || 'default'
}

interface SetupStep {
  step: string
  title: string
  description: string
  tone?: 'paper' | 'blue' | 'lime'
  commands: { label: string; code: string }[]
}

const shortcutCommand = {
  title: 'Shortcut if you want the full bootstrap',
  description:
    'Use `pd init` when you want Port Daddy to detect the repo, start the daemon if needed, wire supported MCP clients, and offer fleet bootstrap in one pass.',
  code: 'pd init',
}

const setupSteps: SetupStep[] = [
  {
    step: '01',
    title: 'Install Port Daddy',
    description:
      'Pick one install path. Package manager first, then every editor and script talks to the same local daemon.',
    commands: [
      { label: 'Homebrew', code: 'brew install curiositech/tap/port-daddy' },
      { label: 'npm', code: 'npm install -g port-daddy' },
    ],
  },
  {
    step: '02',
    title: 'Start the daemon',
    description:
      'Bring up the control plane once, then verify the runtime answered before you wire editors or claim ports.',
    commands: [{ label: 'Daemon', code: 'pd start\npd status' }],
  },
  {
    step: '03',
    title: 'Wire MCP clients',
    description:
      'Let Port Daddy detect installed editors and write the MCP server configuration for them.',
    tone: 'blue',
    commands: [{ label: 'MCP', code: 'pd mcp install --list\npd mcp install' }],
  },
  {
    step: '04',
    title: 'Optional fleet bootstrap',
    description:
      'Once the daemon and MCP are live, generate a background fleet and its git-triggered operator loop.',
    tone: 'lime',
    commands: [{ label: 'Fleet', code: 'pd fleet init' }],
  },
]

function SetupCard({ step }: { step: SetupStep }) {
  const tone = step.tone ?? 'paper'
  const panelTone = tone === 'blue' ? 'primary' : tone === 'lime' ? 'accent' : 'default'
  const bodyTone = tone === 'blue' ? 'primary' : tone === 'lime' ? 'accent' : 'default'

  return (
    <SurfacePanel tone={tone} padding="compact" className="flex h-full flex-col gap-[var(--panel-gap)]">
      <div className="space-y-[var(--space-2)] border-b-2 border-current/15 pb-[var(--space-3)]">
        <BracketLabel tone={panelTone} surface={tone} className="self-start">
          Step {step.step}
        </BracketLabel>
        <PanelTitle as="h3" size="card" tone={panelTone} className="max-w-[14ch]">
          {step.title}
        </PanelTitle>
      </div>

      <PanelBody tone={bodyTone} size="compact" className="max-w-none">
        {step.description}
      </PanelBody>

      <div className={`grid gap-[var(--space-3)] ${step.commands.length > 1 ? 'md:grid-cols-2' : ''}`}>
        {step.commands.map((command) => (
          <div key={command.label} className="space-y-[var(--space-2)]">
            <BracketLabel tone={panelTone} surface={tone} className="self-start">
              {command.label}
            </BracketLabel>
            <DocsCodeBlock code={command.code} language="cli" label={command.label} />
          </div>
        ))}
      </div>
    </SurfacePanel>
  )
}

function SetupSequencePanel() {
  return (
    <div className="w-full max-w-[72rem] space-y-[var(--space-4)]">
      <SurfacePanel tone="blue" className="space-y-[var(--panel-gap)]">
        <div className="space-y-[var(--space-2)]">
          <BracketLabel tone="primary" surface="blue" className="self-start">
            Shortcut
          </BracketLabel>
          <PanelTitle as="h2" size="card" tone="primary" className="max-w-[14ch]">
            {shortcutCommand.title}
          </PanelTitle>
          <PanelBody tone="primary" size="compact" className="max-w-none">
            {shortcutCommand.description}
          </PanelBody>
        </div>
        <DocsCodeBlock code={shortcutCommand.code} language="cli" label="pd init" />
      </SurfacePanel>

      <div className="grid gap-[var(--space-4)] lg:grid-cols-2">
        {setupSteps.map((step) => (
          <SetupCard key={step.step} step={step} />
        ))}
      </div>
    </div>
  )
}

// Featured (latest) article gets the big card
function FeaturedArticle({ post }: { post: typeof blogPosts[0] }) {
  const heroImg = heroImages[post.slug]

  return (
    <motion.article
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="group w-full"
    >
      <Link to={`/blog/${post.slug}`} className="no-underline block">
        <Surface depth="raised" radius="2xl" padding="none" interactive className="overflow-hidden sm:rounded-[32px]">
          {/* Hero image */}
          {heroImg && (
            <div className="relative w-full aspect-[16/8] overflow-hidden">
              <img
                src={heroImg}
                alt={post.title}
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                loading="eager"
              />
              <div
                className="absolute inset-0"
                style={{ background: 'linear-gradient(to bottom, transparent 40%, var(--surface-raised) 100%)' }}
              />
              <Badge variant="teal" className="absolute top-5 left-5 px-4 py-1.5 text-[9px] font-black uppercase tracking-[0.25em]">
                Latest
              </Badge>
            </div>
          )}

          {/* Content */}
          <div className="p-6 sm:p-8 lg:p-10 flex flex-col gap-4 -mt-8 relative z-10">
            <div className="flex flex-wrap items-center gap-4 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)] font-mono">
              <div className="flex items-center gap-2">
                <Calendar size={12} className="text-[var(--brand-primary)]" />
                {post.date}
              </div>
              <div className="h-1 w-1 rounded-full bg-[var(--border-strong)]" />
              <div className="flex items-center gap-2">
                <User size={12} className="text-[var(--brand-secondary)]" />
                {post.author}
              </div>
            </div>

            <h2 className="m-0 text-2xl sm:text-3xl lg:text-4xl font-display font-black tracking-tight leading-[1.1] text-[var(--text-primary)] group-hover:text-[var(--brand-primary)] transition-colors">
              {post.title}
            </h2>

            <p className="m-0 text-base sm:text-lg leading-relaxed text-[var(--text-secondary)] max-w-3xl">
              {post.excerpt}
            </p>

            <div className="flex flex-wrap gap-2 pt-1">
              {post.tags.map(tag => (
                <Badge key={tag} variant={tagVariant(tag)} size="sm" className="text-[8px] tracking-[0.2em]">
                  {tag}
                </Badge>
              ))}
            </div>

            <div className="flex items-center gap-3 pt-2 text-[11px] font-black uppercase tracking-widest text-[var(--brand-primary)] group-hover:gap-5 transition-all">
              Read Article
              <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
            </div>
          </div>
        </Surface>
      </Link>
    </motion.article>
  )
}

// Regular article card — compact with side image
function ArticleCard({ post, index }: { post: typeof blogPosts[0]; index: number }) {
  const heroImg = heroImages[post.slug]

  return (
    <motion.article
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.08 }}
      className="group w-full"
    >
      <Link to={`/blog/${post.slug}`} className="no-underline block">
        <Surface depth="raised" radius="xl" padding="none" interactive className="overflow-hidden sm:rounded-[24px] flex flex-col sm:flex-row">
          {/* Side image */}
          {heroImg && (
            <div className="relative w-full sm:w-[280px] lg:w-[340px] shrink-0 aspect-[16/9] sm:aspect-auto overflow-hidden">
              <img
                src={heroImg}
                alt={post.title}
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.05]"
                loading="lazy"
              />
            </div>
          )}

          {/* Content */}
          <div className="p-5 sm:p-6 flex flex-col justify-between gap-3 flex-1 min-w-0">
            <div>
              <div className="flex flex-wrap items-center gap-3 text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)] font-mono mb-2">
                <div className="flex items-center gap-1.5">
                  <Calendar size={10} className="text-[var(--brand-primary)]" />
                  {post.date}
                </div>
              </div>

              <h3 className="m-0 text-lg sm:text-xl font-display font-black tracking-tight leading-snug text-[var(--text-primary)] group-hover:text-[var(--brand-primary)] transition-colors">
                {post.title}
              </h3>

              <p className="m-0 mt-2 text-sm leading-relaxed text-[var(--text-secondary)] line-clamp-2">
                {post.excerpt}
              </p>
            </div>

            <div className="flex items-center justify-between pt-1">
              <div className="flex flex-wrap gap-1.5">
                {post.tags.slice(0, 3).map(tag => (
                  <Badge key={tag} variant={tagVariant(tag)} size="sm" className="text-[7px] tracking-[0.15em]">
                    {tag}
                  </Badge>
                ))}
              </div>
              <ArrowRight size={14} className="text-[var(--brand-primary)] opacity-0 group-hover:opacity-100 transition-all group-hover:translate-x-1 shrink-0" />
            </div>
          </div>
        </Surface>
      </Link>
    </motion.article>
  )
}

// Feature cards — the six superpowers
const entryPoints = [
  {
    icon: Anchor,
    title: 'Deterministic ports',
    description: 'Claim stable local ports by semantic identity and stop debugging collisions that were really routing mistakes.',
    cmd: 'pd claim myapp:api',
    accent: 'primary' as const,
  },
  {
    icon: Activity,
    title: 'Session ledger',
    description: 'Wrap work in begin, note, and done so every handoff, recovery, and audit trail stays attached to a real session.',
    cmd: 'pd begin --identity myapp:api',
    accent: 'secondary' as const,
  },
  {
    icon: Terminal,
    title: 'MCP wiring',
    description: 'Put the real Port Daddy tools into Claude Code, Cursor, and Windsurf instead of narrating coordination in chat.',
    cmd: 'pd mcp install',
    accent: 'primary' as const,
    badge: 'new',
  },
  {
    icon: Shield,
    title: 'Harbor gates',
    description: 'Use harbor-scoped access and cards when local coordination needs real boundaries instead of hand-wavy trust.',
    cmd: 'pd harbors',
    accent: 'secondary' as const,
  },
  {
    icon: Compass,
    title: 'Salvage and recovery',
    description: 'When an agent dies, the session residue stays queryable so the next operator can pick up work without guessing.',
    cmd: 'pd salvage --project myapp',
    accent: 'primary' as const,
  },
  {
    icon: Ship,
    title: 'Fleet triggers',
    description: 'Turn repo events into repeatable background work with pd-fleet.yml and a daemon that actually owns the loop.',
    cmd: 'pd fleet init',
    accent: 'secondary' as const,
  },
]

const featureBadgeLabel: Record<string, { label: string; color: string }> = {
  new: { label: 'Operator', color: 'var(--brand-primary)' },
}

export function BlogPage() {
  const [featured, ...rest] = blogPosts

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[var(--surface-base)] flex flex-col pt-[var(--nav-height)] font-sans selection:bg-[var(--brand-primary)] selection:text-white"
    >
      {/* ===== HERO + FEATURES ===== */}
      <Surface depth="raised" radius="none" padding="none" className="pb-16 sm:pb-20 px-4 sm:px-6 lg:px-10 relative overflow-hidden">
        <div className="pointer-events-none absolute left-[var(--space-5)] top-[var(--space-6)] h-24 w-24 border-2 border-[var(--border-strong)] bg-[var(--brand-primary)]" />
        <div className="pointer-events-none absolute bottom-[var(--space-6)] right-[var(--space-5)] h-16 w-16 border-2 border-[var(--border-strong)] bg-[var(--brand-accent)]" />

        {/* Upper hero: copy + terminal */}
        <div className="max-w-5xl mx-auto pt-14 sm:pt-20 relative z-10 flex flex-col items-center text-center gap-5">

          {/* Badges row */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Badge variant="teal" className="px-4 py-1.5 text-[9px] font-black uppercase tracking-[0.25em]">
              Engineering Log
            </Badge>
            <Badge variant="gold" className="px-4 py-1.5 text-[9px] font-black uppercase tracking-[0.25em]">
              Local-first
            </Badge>
            <Badge variant="default" className="px-4 py-1.5 text-[9px] font-black uppercase tracking-[0.25em]">
              Single daemon
            </Badge>
            <Badge variant="teal" className="px-4 py-1.5 text-[9px] font-black uppercase tracking-[0.25em]">
              Operator workflow
            </Badge>
          </div>

          <motion.h1
            className="text-4xl sm:text-5xl lg:text-[4.5rem] font-black tracking-tighter font-display leading-[0.92] m-0 text-[var(--text-primary)] max-w-4xl"
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            Operator notes from the{' '}
            <span className="text-[var(--brand-primary)]">control plane.</span>
          </motion.h1>

          <motion.p
            className="text-base sm:text-lg lg:text-xl max-w-2xl leading-relaxed text-[var(--text-secondary)]"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
          >
            Read how Port Daddy handles ports, sessions, salvage, harbor flows, and MCP wiring in
            the open. Start the daemon, wire the tools, and use the same operator loop the docs
            describe.
          </motion.p>

          {/* Setup sequence */}
          <motion.div
            className="w-full flex justify-center pt-1"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <SetupSequencePanel />
          </motion.div>
        </div>

        {/* Divider with label */}
        <div className="max-w-5xl mx-auto mt-14 sm:mt-16 mb-8 relative z-10">
          <div className="flex items-center gap-4">
            <div className="h-px flex-1" style={{ background: 'var(--border-subtle)' }} />
            <span className="text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: 'var(--text-muted)' }}>
              Six real operator surfaces
            </span>
            <div className="h-px flex-1" style={{ background: 'var(--border-subtle)' }} />
          </div>
        </div>

        {/* Feature grid — hoisted into hero */}
        <div className="max-w-5xl mx-auto relative z-10">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {entryPoints.map((ep, i) => {
              const badgeMeta = ep.badge ? featureBadgeLabel[ep.badge] : null
              return (
                <motion.div
                  key={ep.title}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.3 + i * 0.07, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Surface depth="raised" radius="xl" padding="md" interactive className="sm:rounded-[20px] h-full flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                          style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}
                        >
                          <ep.icon
                            size={16}
                            style={{ color: ep.accent === 'secondary' ? 'var(--brand-secondary)' : 'var(--brand-primary)' }}
                          />
                        </div>
                        <h3 className="m-0 text-sm font-display font-black tracking-tight text-[var(--text-primary)]">
                          {ep.title}
                        </h3>
                      </div>
                      {badgeMeta && (
                        <span
                          className="shrink-0 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest"
                          style={{ background: `${badgeMeta.color}18`, color: badgeMeta.color }}
                        >
                          {badgeMeta.label}
                        </span>
                      )}
                    </div>
                    <p className="m-0 text-[12.5px] leading-relaxed text-[var(--text-secondary)] flex-1">
                      {ep.description}
                    </p>
                    <div
                      className="flex items-center gap-2 px-3 py-2 rounded-lg font-mono text-[10.5px]"
                      style={{ background: 'var(--surface-overlay)' }}
                    >
                      <span className="select-none" style={{ color: 'var(--brand-primary)' }}>$</span>
                      <span className="truncate" style={{ color: 'var(--text-muted)' }}>{ep.cmd}</span>
                    </div>
                  </Surface>
                </motion.div>
              )
            })}
          </div>
        </div>
      </Surface>

      {/* ===== BLOG ARTICLES ===== */}
      <main id="main-content" className="flex-1 py-10 sm:py-14 px-4 sm:px-6 lg:px-10 max-w-5xl mx-auto w-full">

        {/* Section label */}
        <div className="flex items-center gap-4 mb-8">
          <div className="h-px flex-1" style={{ background: 'var(--border-subtle)' }} />
          <Badge variant="teal" className="px-4 py-1.5 text-[9px] font-black uppercase tracking-[0.25em]">
            Engineering Log
          </Badge>
          <div className="h-px flex-1" style={{ background: 'var(--border-subtle)' }} />
        </div>

        <FeaturedArticle post={featured} />

        {/* Article Grid */}
        <div className="flex flex-col gap-4 mt-8">
          {rest.map((post, index) => (
            <ArticleCard key={post.id} post={post} index={index} />
          ))}
        </div>

        {/* Docs CTA */}
        <Surface depth="raised" radius="2xl" padding="lg" className="sm:rounded-[32px] text-center flex flex-col items-center gap-4 mt-12">
          <BookOpen size={28} className="text-[var(--brand-primary)]" />
          <h3 className="text-xl sm:text-2xl font-display font-black tracking-tight text-[var(--text-primary)] m-0">
            Read the docs. Run the daemon.
          </h3>
          <p className="text-sm sm:text-base text-[var(--text-secondary)] max-w-lg m-0">
            API reference, tutorials, MCP integration guide, white papers, and the full CLI reference.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link to="/docs">
              <Button variant="primary" size="md">API Docs</Button>
            </Link>
            <Link to="/tutorials">
              <Button variant="secondary" size="md">Tutorials</Button>
            </Link>
            <Link to="/whitepaper">
              <Button variant="outline" size="md">White Papers</Button>
            </Link>
          </div>
        </Surface>
      </main>

      <Footer />
    </motion.div>
  )
}
