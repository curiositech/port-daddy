import { motion } from 'framer-motion'

interface AgentTool {
  name: string
  tagline: string
  how: string
}

const TOOLS: AgentTool[] = [
  { name: 'Claude Code', tagline: 'MCP native', how: 'pd mcp install → tools in every session' },
  { name: 'Aider', tagline: 'git-native', how: 'pd begin wraps each coding session' },
  { name: 'Ollama', tagline: 'local models', how: 'SDK registers agent, sends heartbeats' },
  { name: 'Gemini CLI', tagline: 'Google AI', how: 'claim ports, use pub/sub for results' },
  { name: 'Continue.dev', tagline: 'IDE agent', how: 'file claims prevent conflicts' },
  { name: 'LangChain', tagline: 'Python / JS', how: 'REST API, any language supported' },
  { name: 'CrewAI', tagline: 'multi-agent', how: 'one session per crew member' },
  { name: 'Custom', tagline: 'your agent', how: 'HTTP REST → works from any runtime' },
]

// Simple colored initials "logos"
const COLORS = [
  'var(--p-teal-400)',
  'var(--p-amber-400)',
  'var(--p-navy-300)',
  'var(--p-green-500)',
  'var(--p-teal-300)',
  'var(--p-amber-300)',
  'var(--p-navy-200)',
  'var(--border-strong)',
]

export function AgentEcosystem() {
  return (
    <section
      className="py-20 px-4 sm:px-6 lg:px-8"
      style={{ background: 'var(--bg-base)', borderTop: '1px solid var(--border-subtle)' }}
    >
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <p className="text-sm font-mono uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
            Works with every AI agent
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Language-agnostic. Framework-agnostic.
          </h2>
          <p className="mt-3 max-w-xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
            Port Daddy is a local HTTP daemon. If your agent can make an HTTP request, it can coordinate.
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {TOOLS.map((tool, i) => (
            <motion.div
              key={tool.name}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: i * 0.04 }}
            >
              <div
                className="p-4 rounded-xl flex items-start gap-3 h-full group hover:border-[var(--border-strong)] transition-colors"
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {/* Monogram */}
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm flex-shrink-0 font-mono"
                  style={{
                    background: 'var(--bg-overlay)',
                    color: COLORS[i % COLORS.length],
                    border: `1px solid ${COLORS[i % COLORS.length]}40`,
                  }}
                >
                  {tool.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                      {tool.name}
                    </span>
                    <span
                      className="text-xs font-mono px-1.5 py-0.5 rounded"
                      style={{
                        background: 'var(--bg-overlay)',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {tool.tagline}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    {tool.how}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Call to action */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-10 text-center"
        >
          <div
            className="inline-flex items-center gap-3 px-6 py-3 rounded-xl text-sm font-mono"
            style={{
              background: 'var(--bg-overlay)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-secondary)',
            }}
          >
            <span style={{ color: 'var(--code-prompt)' }}>$</span>
            <span style={{ color: 'var(--text-primary)' }}>
              curl localhost:9876/claim/myapp:api -X POST
            </span>
            <span style={{ color: 'var(--code-comment)' }}>
              {'# ← that\'s it'}
            </span>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
