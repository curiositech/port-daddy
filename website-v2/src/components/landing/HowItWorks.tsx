import { motion } from 'framer-motion'

interface Step {
  number: string
  title: string
  description: string
  code: string[]
  color: string
}

const STEPS: Step[] = [
  {
    number: '01',
    title: 'Register & Claim',
    description:
      'Start a session. Port Daddy gives you a port, an agent ID, and checks if any dead agents left work for you to inherit.',
    code: [
      '$ pd begin --identity myapp:api \\',
      '    --purpose "Refactor auth"',
      '',
      '[pd] Session started · agent-7f3a',
      '  Port 3001 assigned',
      '  No dead agents in myapp:*',
    ],
    color: 'var(--p-teal-400)',
  },
  {
    number: '02',
    title: 'Coordinate',
    description:
      'Claim files, post notes, acquire locks, and exchange pub/sub messages — all with the same daemon, no extra infrastructure.',
    code: [
      '$ pd files claim src/auth/*.ts',
      '✓ Claimed · no conflicts',
      '',
      '$ pd note "JWT middleware done"',
      '✓ Note recorded · 12:04:38',
      '',
      '$ pd msg myapp:events publish \\',
      '    "auth-api ready"',
    ],
    color: 'var(--p-amber-400)',
  },
  {
    number: '03',
    title: 'Finish or Salvage',
    description:
      "When done, pd done releases everything cleanly. If a crash happens, the resurrection queue preserves the work — another agent picks up exactly where you left off.",
    code: [
      '$ pd done',
      '[pd] Complete · 8 notes · 4 files released',
      '',
      '# Or, for the next agent:',
      '$ pd salvage',
      '  Dead: agent-9c2b (myapp:frontend)',
      '  Last note: "Login form 70% done"',
      '$ pd salvage claim agent-9c2b',
    ],
    color: 'var(--p-green-500)',
  },
]

export function HowItWorks() {
  return (
    <section
      className="py-8 px-4 sm:px-6 lg:px-8"
      style={{ background: 'var(--bg-surface)' }}
    >
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-10"
        >
          <h2 className="text-3xl sm:text-4xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
            Three commands to coordinate anything
          </h2>
          <p className="text-lg max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
            Port Daddy wraps every agent session. Register, do your work, then finish — or let the next agent
            pick up if something goes wrong.
          </p>
        </motion.div>

        {/* Steps — horizontal connector line on desktop */}
        <div className="relative">
          {/* Connector line */}
          <div
            className="hidden lg:block absolute top-8 left-0 right-0 h-px"
            style={{ background: 'var(--border-default)', zIndex: 0 }}
          />

          <div className="grid lg:grid-cols-3 gap-8 lg:gap-6 relative">
            {STEPS.map((step, i) => (
              <motion.div
                key={step.number}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.12 }}
                className="flex flex-col gap-5"
              >
                {/* Step number circle */}
                <div className="relative z-10 flex items-center gap-4">
                  <div
                    className="w-16 h-16 rounded-full flex items-center justify-center font-mono font-bold text-xl flex-shrink-0"
                    style={{
                      background: 'var(--bg-elevated)',
                      border: `2px solid ${step.color}`,
                      color: step.color,
                      boxShadow: `0 0 20px color-mix(in srgb, ${step.color} 30%, transparent)`,
                    }}
                  >
                    {step.number}
                  </div>
                  <div className="lg:hidden">
                    <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                      {step.title}
                    </h3>
                  </div>
                </div>

                <div className="hidden lg:block">
                  <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                    {step.title}
                  </h3>
                </div>

                <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: '0.9375rem' }}>
                  {step.description}
                </p>

                {/* Code block */}
                <div
                  className="rounded-xl p-4 font-mono text-xs leading-relaxed flex-1"
                  style={{
                    background: 'var(--codeblock-bg)',
                    border: '1px solid var(--border-default)',
                    borderTop: `2px solid ${step.color}`,
                  }}
                >
                  {step.code.map((line, li) => {
                    if (line === '') return <div key={li} className="h-3" />
                    const isComment = line.startsWith('#')
                    const isOutput = !line.startsWith('$') && !isComment
                    return (
                      <div key={li}>
                        {isComment ? (
                          <span style={{ color: 'var(--code-comment)' }}>{line}</span>
                        ) : isOutput ? (
                          <span style={{ color: 'var(--code-output)' }}>
                            {line.includes('⚓') || line.includes('✓') ? (
                              <span style={{ color: step.color }}>{line}</span>
                            ) : line.includes('Dead:') || line.includes('Last note:') ? (
                              <span style={{ color: 'var(--status-warning)' }}>{line}</span>
                            ) : line}
                          </span>
                        ) : (
                          <span>
                            <span style={{ color: 'var(--code-prompt)' }}>{line.slice(0, 2)}</span>
                            <span style={{ color: 'var(--text-primary)' }}>{line.slice(2)}</span>
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
