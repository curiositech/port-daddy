import React from 'react'
import { Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { blogPosts } from '@/data/blogData'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import { Button } from '@/components/ui/Button'
import { Calendar, User, ArrowRight, Terminal, Copy, Check, Anchor, Ship, Compass, Shield, Zap, Radio, BookOpen, Package, Code } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'

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

// Install method tabs
interface InstallTab {
  id: string
  label: string
  cmd: string
  description: string
  icon: React.ReactNode
  featured?: boolean
}

const installTabs: InstallTab[] = [
  {
    id: 'init',
    label: 'pd init',
    cmd: 'pd init',
    description: 'One command: detects your stack, configures MCP in every AI editor, installs a fleet, and adds a git hook that fires agents on every commit.',
    icon: <Zap size={14} />,
    featured: true,
  },
  {
    id: 'brew',
    label: 'Homebrew',
    cmd: 'brew install curiositech/tap/port-daddy && pd status',
    description: 'Install the always-on daemon. Auto-starts on login via launchd. Survives terminal close.',
    icon: <Package size={14} />,
  },
  {
    id: 'mcp',
    label: 'MCP',
    cmd: 'pd mcp install',
    description: '44 tools wired into Claude Code. Sessions, salvage, pub/sub, locks, fleet — all from your editor.',
    icon: <Terminal size={14} />,
  },
  {
    id: 'npx',
    label: 'npx',
    cmd: 'npx port-daddy claim myapp:api -q',
    description: 'Zero install. Claim a port by identity. Daemon auto-starts if not running.',
    icon: <Code size={14} />,
  },
]

function TypewriterText({ text, speed = 40 }: { text: string; speed?: number }) {
  const [displayed, setDisplayed] = useState('')
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    setDisplayed('')
    setIdx(0)
  }, [text])

  useEffect(() => {
    if (idx < text.length) {
      const t = setTimeout(() => {
        setDisplayed(prev => prev + text[idx])
        setIdx(prev => prev + 1)
      }, speed)
      return () => clearTimeout(t)
    }
  }, [idx, text, speed])

  return <span>{displayed}<span className="animate-pulse opacity-60">▋</span></span>
}

function InstallTerminal() {
  const [activeId, setActiveId] = useState('init')
  const [copied, setCopied] = useState(false)
  const tab = installTabs.find(t => t.id === activeId) ?? installTabs[0]

  function copy() {
    navigator.clipboard.writeText(tab.cmd)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Surface depth="raised" radius="2xl" padding="none" className="overflow-hidden w-full max-w-2xl">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 pt-3 pb-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        {installTabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveId(t.id)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-[11px] font-bold uppercase tracking-widest transition-all relative"
            style={{
              color: activeId === t.id
                ? (t.featured ? 'var(--brand-secondary)' : 'var(--brand-primary)')
                : 'var(--text-muted)',
              background: activeId === t.id ? 'var(--surface-overlay)' : 'transparent',
              borderBottom: activeId === t.id
                ? `2px solid ${t.featured ? 'var(--brand-secondary)' : 'var(--brand-primary)'}`
                : '2px solid transparent',
            }}
          >
            {t.icon}
            {t.label}
            {t.featured && activeId !== t.id && (
              <span className="ml-1 px-1 py-0.5 rounded text-[8px] font-black uppercase"
                style={{ background: 'rgba(204,61,46,0.15)', color: 'var(--brand-secondary)' }}>
                new
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Command area */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeId}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
          className="px-5 py-5 flex items-center justify-between gap-3"
          style={{ background: 'var(--surface-overlay)' }}
        >
          <div className="flex items-center gap-3 font-mono text-sm overflow-x-auto">
            <span className="text-[var(--brand-primary)] select-none shrink-0">$</span>
            <span className="text-[var(--text-primary)] whitespace-nowrap">
              <TypewriterText text={tab.cmd} speed={35} />
            </span>
          </div>
          <button
            onClick={copy}
            className="shrink-0 p-1.5 rounded-lg transition-all hover:scale-110"
            style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-sm)' }}
            title="Copy"
          >
            {copied
              ? <Check size={14} className="text-[var(--status-success)]" />
              : <Copy size={14} className="text-[var(--text-muted)]" />}
          </button>
        </motion.div>
      </AnimatePresence>

      {/* Description */}
      <div className="px-5 py-3 flex items-start gap-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <span style={{ color: tab.featured ? 'var(--brand-secondary)' : 'var(--brand-primary)' }} className="mt-0.5 shrink-0">
          {tab.icon}
        </span>
        <p className="text-[11px] text-[var(--text-muted)] m-0 font-medium leading-relaxed">{tab.description}</p>
      </div>
    </Surface>
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

// Entry point cards for the install section
const entryPoints = [
  {
    icon: Terminal,
    title: 'Port Manager',
    description: 'Never fight port conflicts again. Deterministic assignment by identity.',
    cmd: 'pd claim myapp:api',
  },
  {
    icon: Ship,
    title: 'Agent Fleet',
    description: '8 background agents. QA, docs, tests, ideas. Declared in YAML.',
    cmd: 'pd fleet up',
  },
  {
    icon: Radio,
    title: 'Pub/Sub + Tuples',
    description: 'Event-driven coordination. Self-healing pipelines. Linda tuple space.',
    cmd: 'pd watch test-results --exec ./fix.sh',
  },
  {
    icon: Shield,
    title: 'Formal Safety',
    description: 'The Arbiter enforces invariants from TLA+ specs. ProVerif-proven crypto.',
    cmd: 'pd arbiter status',
  },
  {
    icon: Compass,
    title: 'Agent Salvage',
    description: 'Dead agents leave notes. New agents pick up where they left off.',
    cmd: 'pd salvage --project myapp',
  },
  {
    icon: Anchor,
    title: 'MCP Integration',
    description: '44 tools for Claude Code. Sessions, notes, claims, locks, spawn.',
    cmd: 'pd mcp install',
  },
]

export function BlogPage() {
  const [featured, ...rest] = blogPosts

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[var(--surface-base)] flex flex-col pt-[var(--nav-height)] font-sans selection:bg-[var(--brand-primary)] selection:text-white"
    >
      {/* Hero Section */}
      <Surface depth="raised" radius="none" padding="none" className="py-14 sm:py-20 px-4 sm:px-6 lg:px-10 relative overflow-hidden">
        {/* Background blobs */}
        <div
          className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full blur-[160px] opacity-[0.08] pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }}
        />
        <div
          className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full blur-[120px] opacity-[0.06] pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--brand-secondary) 0%, transparent 70%)' }}
        />

        <div className="max-w-5xl mx-auto relative z-10 flex flex-col items-center text-center gap-6">
          <Badge variant="teal" className="px-5 py-2 text-[9px] font-black uppercase tracking-[0.25em]">
            Engineering Log
          </Badge>

          <motion.h1
            className="text-4xl sm:text-5xl lg:text-7xl font-black tracking-tighter font-display leading-[0.9] m-0 text-[var(--text-primary)]"
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            The Control{' '}
            <span className="text-[var(--brand-primary)]">Plane.</span>
          </motion.h1>

          <motion.p
            className="text-base sm:text-lg lg:text-xl max-w-2xl leading-relaxed text-[var(--text-secondary)]"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
          >
            Protocol design, formal verification, fleet agents, and the infrastructure behind autonomous coordination.
          </motion.p>

          {/* Install terminal */}
          <motion.div
            className="w-full flex justify-center pt-2"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <InstallTerminal />
          </motion.div>
        </div>
      </Surface>

      {/* Featured Article */}
      <main id="main-content" className="flex-1 py-10 sm:py-14 px-4 sm:px-6 lg:px-10 max-w-5xl mx-auto w-full">
        <FeaturedArticle post={featured} />

        {/* Article Grid */}
        <div className="flex flex-col gap-4 mt-8">
          {rest.map((post, index) => (
            <ArticleCard key={post.id} post={post} index={index} />
          ))}
        </div>

        {/* Entry Points Section */}
        <motion.section
          className="mt-16 mb-8"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
        >
          <div className="text-center mb-8">
            <Badge variant="gold" className="px-5 py-2 text-[9px] font-black uppercase tracking-[0.25em] mb-4">
              Every Entry Point
            </Badge>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-display font-black tracking-tight text-[var(--text-primary)] m-0">
              One daemon.{' '}
              <span className="text-[var(--brand-primary)]">Six superpowers.</span>
            </h2>
            <p className="text-base sm:text-lg text-[var(--text-secondary)] mt-3 max-w-2xl mx-auto">
              Install for port management. Discover agent coordination, formal verification, fleet intelligence, and a tuple space.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {entryPoints.map((ep, i) => (
              <motion.div
                key={ep.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
              >
                <Surface depth="raised" radius="xl" padding="md" interactive className="sm:rounded-[20px] h-full flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}
                    >
                      <ep.icon size={18} className="text-[var(--brand-primary)]" />
                    </div>
                    <h3 className="m-0 text-sm font-display font-black tracking-tight text-[var(--text-primary)]">
                      {ep.title}
                    </h3>
                  </div>
                  <p className="m-0 text-[13px] leading-relaxed text-[var(--text-secondary)] flex-1">
                    {ep.description}
                  </p>
                  <div
                    className="flex items-center gap-2 px-3 py-2 rounded-lg font-mono text-[11px]"
                    style={{ background: 'var(--surface-overlay)' }}
                  >
                    <span className="text-[var(--brand-primary)] select-none">$</span>
                    <span className="text-[var(--text-muted)] truncate">{ep.cmd}</span>
                  </div>
                </Surface>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* Docs CTA */}
        <Surface depth="raised" radius="2xl" padding="lg" className="sm:rounded-[32px] text-center flex flex-col items-center gap-4">
          <BookOpen size={32} className="text-[var(--brand-primary)]" />
          <h3 className="text-xl sm:text-2xl font-display font-black tracking-tight text-[var(--text-primary)] m-0">
            Read the docs. Run the daemon.
          </h3>
          <p className="text-sm sm:text-base text-[var(--text-secondary)] max-w-lg m-0">
            API reference, tutorials, MCP integration guide, and the full CLI reference.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link to="/docs">
              <Button variant="primary" size="md">API Docs</Button>
            </Link>
            <Link to="/tutorials">
              <Button variant="secondary" size="md">Tutorials</Button>
            </Link>
            <Link to="/mcp">
              <Button variant="outline" size="md">MCP Tools</Button>
            </Link>
          </div>
        </Surface>
      </main>

      <Footer />
    </motion.div>
  )
}
