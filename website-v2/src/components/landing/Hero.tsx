import * as React from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import * as Tabs from '@radix-ui/react-tabs'
import { useTheme } from '@/lib/theme'

const RAINBOW_SEGMENTS = [
  '#4285f4', // blue
  '#34a853', // green
  '#fbbc04', // yellow
  '#fa7b17', // orange
  '#ea4335', // red
  '#a142f4', // purple
  '#24c1e0', // teal
]

const CHANGELOG_ITEMS = [
  {
    version: 'v3.5',
    label: 'Harbors',
    badge: 'new',
    text: 'Permission namespaces with HMAC-signed capability tokens. Scope any operation to a harbor.',
    color: 'var(--p-teal-400)',
  },
  {
    version: 'v3.5',
    label: 'pd spawn',
    badge: 'new',
    text: 'Launch AI agents (Ollama, Claude, Aider, Gemini) with coordination auto-wired. Heartbeats, notes, salvage — all included.',
    color: 'var(--p-amber-400)',
  },
  {
    version: 'v3.5',
    label: 'pd watch',
    badge: 'new',
    text: 'SSE-backed channel watcher. Subscribe to a channel and execute a script on every message. The "always-on agent" primitive.',
    color: 'var(--p-green-500)',
  },
  {
    version: 'v3.4',
    label: 'Syntactic Sugar',
    badge: 'improved',
    text: 'pd begin, pd done, pd whoami — wrap an entire session lifecycle in three commands.',
    color: 'var(--p-navy-300)',
  },
]

const TUTORIAL_TEASERS = [
  {
    num: '12',
    title: 'Harbors',
    level: 'Advanced',
    summary: 'Create permission namespaces, issue capability tokens, and scope tunnels and locks to a harbor.',
    href: '/tutorials#harbors',
    badgeColor: 'var(--p-teal-400)',
  },
  {
    num: '11',
    title: 'pd spawn',
    level: 'Intermediate',
    summary: 'Launch Ollama, Claude, and Aider agents from the CLI. All coordination happens automatically.',
    href: '/tutorials#spawn',
    badgeColor: 'var(--p-amber-400)',
  },
  {
    num: '10',
    title: 'pd watch',
    level: 'Intermediate',
    summary: 'Build always-on agent triggers. Watch a channel, run a script on every message.',
    href: '/tutorials#watch',
    badgeColor: 'var(--p-green-500)',
  },
]

const INSTALL_TABS = [
  {
    id: 'brew',
    label: 'Homebrew',
    commands: ['brew tap erichowens/port-daddy', 'brew install port-daddy', 'pd --version'],
  },
  {
    id: 'npm',
    label: 'npm / npx',
    commands: ['npx port-daddy start', '# or install globally', 'npm install -g port-daddy'],
  },
  {
    id: 'mcp',
    label: 'MCP (Claude)',
    commands: [
      'pd mcp install',
      '# Adds Port Daddy tools to Claude Code',
      '# begin_session, end_session_full, whoami,',
      '# claim_port, acquire_lock, pd_discover...',
    ],
  },
  {
    id: 'sdk',
    label: 'Agent SDK',
    commands: [
      'npm install port-daddy',
      '# In your agent code:',
      "import { PortDaddy } from 'port-daddy'",
      'const pd = new PortDaddy()',
      'await pd.begin({ identity: "myapp:worker" })',
    ],
  },
]

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
}

const BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  new:      { bg: 'rgba(58,173,173,0.15)',   text: 'var(--p-teal-300)' },
  improved: { bg: 'rgba(167,139,250,0.12)',  text: '#c4b5fd' },
}

export function Hero() {
  const [activeTab, setActiveTab] = React.useState('brew')
  const [activePanel, setActivePanel] = React.useState<'changelog' | 'tutorials'>('changelog')
  const { theme } = useTheme()

  return (
    <section
      id="hero"
      className="relative min-h-screen flex flex-col justify-center overflow-hidden"
      style={{ paddingTop: 'var(--nav-height)' }}
    >
      {/* Background gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(30, 107, 107, 0.18) 0%, transparent 70%)',
        }}
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-start">

          {/* Left column — text */}
          <div className="flex flex-col gap-6">
            {/* Logo */}
            <motion.div {...fadeUp} transition={{ duration: 0.4 }}>
              <img
                src={theme === 'dark' ? '/pd_logo_darkmode.svg' : '/pd_logo.svg'}
                alt="Port Daddy"
                style={{ height: '288px', width: 'auto' }}
              />
            </motion.div>

            {/* Rainbow accent bar */}
            <motion.div {...fadeUp} transition={{ duration: 0.5 }}>
              <div className="flex gap-0 mb-1" style={{ height: '4px', width: '200px', borderRadius: '2px', overflow: 'hidden' }}>
                {RAINBOW_SEGMENTS.map((color, i) => (
                  <div key={i} style={{ flex: 1, background: color }} />
                ))}
              </div>
              <Badge variant="teal" style={{ marginTop: '8px' }}>v3.5.0 · Now with Harbors, pd spawn, pd watch</Badge>
            </motion.div>

            <motion.h1
              {...fadeUp}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight"
              style={{ color: 'var(--text-primary)', lineHeight: 1.1, fontFamily: 'var(--p-font-display)' }}
            >
              Port Authority<br />
              <span style={{ color: 'var(--brand-primary)' }}>for AI Agents</span>
            </motion.h1>

            <motion.p
              {...fadeUp}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-lg lg:text-xl"
              style={{ color: 'var(--text-secondary)', maxWidth: '480px' }}
            >
              Atomic port assignment, session coordination, distributed locks,
              pub/sub messaging, and agent salvage — all in one daemon.
              Built for multi-agent AI workflows.
            </motion.p>

            {/* Key stats */}
            <motion.div
              {...fadeUp}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="flex flex-wrap gap-6"
            >
              {[
                { num: '3100+', label: 'tests passing' },
                { num: '60+', label: 'frameworks detected' },
                { num: '0', label: 'race conditions' },
              ].map(stat => (
                <div key={stat.label}>
                  <div
                    className="text-2xl font-bold font-mono"
                    style={{ color: 'var(--brand-primary)' }}
                  >
                    {stat.num}
                  </div>
                  <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {stat.label}
                  </div>
                </div>
              ))}
            </motion.div>

            {/* Install tabs */}
            <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.4 }} id="install">
              <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
                <Tabs.List
                  className="flex gap-1 p-1 rounded-lg mb-0 overflow-x-auto"
                  style={{ background: 'var(--bg-overlay)', width: 'fit-content' }}
                  aria-label="Install method"
                >
                  {INSTALL_TABS.map(tab => (
                    <Tabs.Trigger
                      key={tab.id}
                      value={tab.id}
                      className="px-3 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-all"
                      style={{
                        color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
                        background: activeTab === tab.id ? 'var(--bg-elevated)' : 'transparent',
                        border: activeTab === tab.id ? '1px solid var(--border-default)' : '1px solid transparent',
                      }}
                    >
                      {tab.label}
                    </Tabs.Trigger>
                  ))}
                </Tabs.List>

                {INSTALL_TABS.map(tab => (
                  <Tabs.Content key={tab.id} value={tab.id}>
                    <div
                      className="rounded-xl p-4 font-mono text-sm mt-2"
                      style={{
                        background: 'var(--codeblock-bg)',
                        border: '1px solid var(--border-default)',
                      }}
                    >
                      {tab.commands.map((cmd, i) => (
                        <div key={i} className="leading-relaxed">
                          {cmd.startsWith('#') ? (
                            <span style={{ color: 'var(--code-comment)' }}>{cmd}</span>
                          ) : (
                            <span>
                              <span style={{ color: 'var(--code-prompt)' }}>$ </span>
                              <span style={{ color: 'var(--text-primary)' }}>{cmd}</span>
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </Tabs.Content>
                ))}
              </Tabs.Root>
            </motion.div>

            {/* CTAs */}
            <motion.div
              {...fadeUp}
              transition={{ duration: 0.5, delay: 0.5 }}
              className="flex flex-wrap gap-3"
            >
              <Button size="lg" onClick={() => document.getElementById('install')?.scrollIntoView({ behavior: 'smooth' })}>
                Get Started
              </Button>
              <Link to="/docs" style={{ textDecoration: 'none' }}>
                <Button variant="ghost" size="lg">
                  Read the Docs
                </Button>
              </Link>
            </motion.div>
          </div>

          {/* Right column — changelog + tutorials */}
          <motion.div
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-col gap-4"
          >
            {/* Panel toggle */}
            <div className="flex gap-2">
              {[
                { id: 'changelog', label: "What's New" },
                { id: 'tutorials', label: 'Latest Tutorials' },
              ].map(p => (
                <button
                  key={p.id}
                  onClick={() => setActivePanel(p.id as typeof activePanel)}
                  className="text-sm px-4 py-1.5 rounded-lg transition-all"
                  style={{
                    background: activePanel === p.id ? 'var(--bg-overlay)' : 'transparent',
                    color: activePanel === p.id ? 'var(--text-primary)' : 'var(--text-muted)',
                    border: '1px solid',
                    borderColor: activePanel === p.id ? 'var(--border-default)' : 'transparent',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Changelog panel */}
            {activePanel === 'changelog' && (
              <div className="flex flex-col gap-3">
                {CHANGELOG_ITEMS.map((item, i) => (
                  <motion.div
                    key={item.label}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: i * 0.06 }}
                    className="rounded-xl p-4"
                    style={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className="text-xs font-bold font-mono px-2 py-0.5 rounded-full"
                        style={{
                          background: BADGE_COLORS[item.badge]?.bg,
                          color: BADGE_COLORS[item.badge]?.text,
                        }}
                      >
                        {item.badge}
                      </span>
                      <span className="text-sm font-semibold" style={{ color: item.color }}>
                        {item.label}
                      </span>
                      <span className="text-xs font-mono ml-auto" style={{ color: 'var(--text-muted)' }}>
                        {item.version}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      {item.text}
                    </p>
                  </motion.div>
                ))}
              </div>
            )}

            {/* Tutorials panel */}
            {activePanel === 'tutorials' && (
              <div className="flex flex-col gap-3">
                {TUTORIAL_TEASERS.map((tut, i) => (
                  <motion.a
                    key={tut.num}
                    href={tut.href}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: i * 0.06 }}
                    className="rounded-xl p-4 block no-underline group"
                    style={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      transition: 'border-color 150ms ease',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className="text-xs font-bold font-mono w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
                        style={{ background: `${tut.badgeColor}20`, color: tut.badgeColor }}
                      >
                        {tut.num}
                      </span>
                      <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {tut.title}
                      </span>
                      <span
                        className="text-xs px-2 py-0.5 rounded ml-auto"
                        style={{ background: 'var(--bg-overlay)', color: 'var(--text-muted)' }}
                      >
                        {tut.level}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      {tut.summary}
                    </p>
                    <div className="mt-2 text-xs font-medium" style={{ color: tut.badgeColor }}>
                      Read tutorial →
                    </div>
                  </motion.a>
                ))}
                <Link
                  to="/tutorials"
                  className="text-sm text-center py-2 no-underline"
                  style={{ color: 'var(--text-muted)' }}
                >
                  All 12 tutorials →
                </Link>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </section>
  )
}
