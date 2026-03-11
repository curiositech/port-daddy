import * as React from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { TerminalReplay } from './TerminalReplay'
import { HarborViz } from './HarborViz'
import * as Tabs from '@radix-ui/react-tabs'

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
    commands: ['pd mcp install', '# Adds Port Daddy to ~/.claude.json', '# Restart Claude Code'],
  },
  {
    id: 'sdk',
    label: 'SDK',
    commands: [
      'npm install port-daddy',
      '# In your agent code:',
      "import { PortDaddy } from 'port-daddy'",
      'const pd = new PortDaddy()',
    ],
  },
]

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
}

export function Hero() {
  const [activeTab, setActiveTab] = React.useState('brew')
  const [showViz, setShowViz] = React.useState(false)

  return (
    <section
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

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">

          {/* Left column — text */}
          <div className="flex flex-col gap-6">
            <motion.div {...fadeUp} transition={{ duration: 0.5 }}>
              <Badge variant="teal">v3.5.0 · Now with Harbor Tokens</Badge>
            </motion.div>

            <motion.h1
              {...fadeUp}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight"
              style={{ color: 'var(--text-primary)', lineHeight: 1.1 }}
            >
              Port Daddy Makes<br />
              <span style={{ color: 'var(--brand-primary)' }}>Agents Behave Well</span>
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
              <Button size="lg" onClick={() => document.getElementById('tutorials')?.scrollIntoView({ behavior: 'smooth' })}>
                Get Started
              </Button>
              <Button variant="ghost" size="lg" onClick={() => window.open('https://github.com/erichowens/port-daddy', '_blank')}>
                View on GitHub
              </Button>
            </motion.div>
          </div>

          {/* Right column — terminal + viz toggle */}
          <motion.div
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-col gap-4"
          >
            {/* Toggle between terminal replay and harbor viz */}
            <div className="flex gap-2">
              <button
                onClick={() => setShowViz(false)}
                className="text-sm font-mono px-3 py-1.5 rounded-lg transition-all"
                style={{
                  background: !showViz ? 'var(--bg-overlay)' : 'transparent',
                  color: !showViz ? 'var(--text-primary)' : 'var(--text-muted)',
                  border: '1px solid',
                  borderColor: !showViz ? 'var(--border-default)' : 'transparent',
                }}
              >
                Terminal Replay
              </button>
              <button
                onClick={() => setShowViz(true)}
                className="text-sm font-mono px-3 py-1.5 rounded-lg transition-all"
                style={{
                  background: showViz ? 'var(--bg-overlay)' : 'transparent',
                  color: showViz ? 'var(--text-primary)' : 'var(--text-muted)',
                  border: '1px solid',
                  borderColor: showViz ? 'var(--border-default)' : 'transparent',
                }}
              >
                Agent Map
              </button>
            </div>

            {!showViz ? (
              <TerminalReplay />
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-xl border p-6"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}
              >
                <p className="text-xs font-mono text-center mb-4" style={{ color: 'var(--text-muted)' }}>
                  Live agent coordination — harbors group agents by capability
                </p>
                <HarborViz />
              </motion.div>
            )}
          </motion.div>
        </div>
      </div>
    </section>
  )
}
