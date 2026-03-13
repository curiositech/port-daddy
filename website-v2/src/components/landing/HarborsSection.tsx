import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'

const CAPABILITIES = [
  { cap: 'code:read', color: 'var(--p-teal-300)', bg: 'rgba(58,173,173,0.10)' },
  { cap: 'notes:write', color: 'var(--p-teal-300)', bg: 'rgba(58,173,173,0.10)' },
  { cap: 'tunnel:create', color: 'var(--p-amber-300)', bg: 'rgba(251,191,36,0.10)' },
  { cap: 'lock:acquire', color: 'var(--p-amber-300)', bg: 'rgba(251,191,36,0.10)' },
  { cap: 'msg:publish', color: 'var(--p-green-300)', bg: 'rgba(34,197,94,0.10)' },
  { cap: 'file:claim', color: 'var(--p-green-300)', bg: 'rgba(34,197,94,0.10)' },
]

function CodeStep({ label, lines, delay = 0 }: { label: string; lines: Array<{ type: 'prompt' | 'output' | 'comment' | 'error'; text: string }>; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay }}
      className="rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--border-default)' }}
    >
      <div
        className="px-4 py-2"
        style={{ background: 'var(--codeblock-header-bg)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{label}</span>
      </div>
      <div className="p-4 font-mono text-sm leading-relaxed" style={{ background: 'var(--codeblock-bg)' }}>
        {lines.map((line, i) => (
          <div key={i} className={i > 0 && lines[i - 1].type === 'prompt' && line.type !== 'prompt' ? 'mt-0' : i > 0 ? '' : ''}>
            {line.type === 'prompt' ? (
              <span>
                <span style={{ color: 'var(--code-prompt)' }}>$ </span>
                <span style={{ color: 'var(--text-primary)' }}>{line.text}</span>
              </span>
            ) : line.type === 'comment' ? (
              <span style={{ color: 'var(--code-comment)' }}>{line.text}</span>
            ) : line.type === 'error' ? (
              <span style={{ color: 'var(--p-red-400)' }}>{line.text}</span>
            ) : (
              <span style={{ color: 'var(--code-output)' }}>{line.text}</span>
            )}
          </div>
        ))}
      </div>
    </motion.div>
  )
}

export function HarborsSection() {
  return (
    <section
      className="py-10 px-4 sm:px-6 lg:px-8"
      style={{ background: 'var(--bg-surface)', borderTop: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)' }}
    >
      <div className="max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-10 items-start">

          {/* Left: explanation */}
          <motion.div
            initial={{ opacity: 0, x: -24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <Badge variant="teal" className="mb-4">New in v3.7</Badge>
            <h2
              className="text-3xl sm:text-4xl font-bold mb-4"
              style={{ color: 'var(--text-primary)' }}
            >
              Harbors: permission<br />namespaces for agents
            </h2>
            <p className="text-base mb-4" style={{ color: 'var(--text-secondary)', lineHeight: 1.65 }}>
              A <strong style={{ color: 'var(--text-primary)' }}>harbor</strong> is a named workspace with controlled entry.
              Agents that enter a harbor receive a signed capability token — a short-lived JWT that
              proves exactly what they're allowed to do inside it.
            </p>
            <p className="text-base mb-6" style={{ color: 'var(--text-secondary)', lineHeight: 1.65 }}>
              Tunnels, file claims, pub/sub channels, and locks can all be scoped to a harbor.
              An agent without a token for <code style={{ color: 'var(--text-code)', background: 'var(--bg-overlay)', padding: '1px 5px', borderRadius: 4 }}>myapp:security-review</code> can't
              touch anything inside it — even if it claims the right identity.
            </p>

            {/* Capability pills */}
            <div className="mb-6">
              <p className="text-xs font-medium uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
                Capability scopes
              </p>
              <div className="flex flex-wrap gap-2">
                {CAPABILITIES.map(({ cap, color, bg }) => (
                  <span
                    key={cap}
                    className="text-xs font-mono px-3 py-1 rounded-full"
                    style={{ background: bg, color, border: `1px solid ${color}30` }}
                  >
                    {cap}
                  </span>
                ))}
              </div>
            </div>

            {/* Code block */}
            <div
              className="rounded-xl p-4 font-mono text-sm"
              style={{ background: 'var(--code-bg)', border: '1px solid var(--border-default)' }}
            >
              <div style={{ color: 'var(--code-comment)' }}># Create a security review harbor</div>
              <div className="mt-1">
                <span style={{ color: 'var(--code-prompt)' }}>$ </span>
                <span style={{ color: 'var(--text-code)' }}>pd harbor create myapp:security-review \</span>
              </div>
              <div style={{ paddingLeft: '1.5rem' }}>
                <span style={{ color: 'var(--text-code)' }}>--cap </span>
                <span style={{ color: 'var(--p-teal-300)' }}>"code:read,notes:write,tunnel:create"</span>
              </div>
              <div className="mt-2">
                <span style={{ color: 'var(--code-prompt)' }}>$ </span>
                <span style={{ color: 'var(--text-code)' }}>pd harbor enter myapp:security-review</span>
              </div>
              <div style={{ color: 'var(--code-output)', paddingLeft: '0.5rem', marginTop: 4 }}>
                token: eyJhbGciOiJIUzI1NiJ9... (expires 2h)
              </div>
              <div className="mt-2" style={{ color: 'var(--code-comment)' }}># Tunnels respect the harbor scope</div>
              <div>
                <span style={{ color: 'var(--code-prompt)' }}>$ </span>
                <span style={{ color: 'var(--text-code)' }}>pd tunnel myapp:api --harbor myapp:security-review</span>
              </div>
            </div>
          </motion.div>

          {/* Right: code steps */}
          <div className="flex flex-col gap-4">
            <CodeStep
              label="1 · Create a harbor with capabilities"
              delay={0.1}
              lines={[
                { type: 'prompt', text: 'pd harbor create myapp:security-review \\' },
                { type: 'prompt', text: '    --cap "code:read,notes:write,lock:acquire"' },
                { type: 'output', text: 'Harbor created · 3 capabilities · active' },
              ]}
            />
            <CodeStep
              label="2 · Issue a scoped token to an agent"
              delay={0.2}
              lines={[
                { type: 'prompt', text: 'pd harbor enter myapp:security-review --ttl 2h' },
                { type: 'output', text: 'token: eyJhbGciOiJIUzI1NiJ9... (expires 2h)' },
                { type: 'output', text: 'caps:  code:read, notes:write, lock:acquire' },
              ]}
            />
            <CodeStep
              label="3 · Unauthorized agent blocked"
              delay={0.3}
              lines={[
                { type: 'comment', text: '# Agent without a harbor token' },
                { type: 'prompt', text: 'pd msg security-alerts publish "vuln found"' },
                { type: 'error', text: 'Error: token missing capability msg:publish' },
                { type: 'comment', text: '# Token holder can proceed' },
                { type: 'prompt', text: 'PD_HARBOR_TOKEN=eyJ... pd lock acquire scan' },
                { type: 'output', text: 'Lock acquired · expires 5m' },
              ]}
            />
          </div>
        </div>

        {/* Bottom: three properties */}
        <div className="grid sm:grid-cols-3 gap-6 mt-10 pt-8" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {[
            {
              title: 'HMAC-signed tokens',
              body: 'HS256 JWTs with JTI identifiers. Every capability grant is logged to the audit trail and tied to the issuing agent identity.',
            },
            {
              title: 'Time-limited by default',
              body: 'Harbor tokens expire. A dead agent\'s token can\'t be reused — the JTI is burned on first verification. No orphaned permissions.',
            },
            {
              title: 'Tunnels are harbor-scoped',
              body: 'Creating a tunnel inside a harbor requires tunnel:create capability. External access inherits the harbor\'s permission boundary.',
            },
          ].map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.1 }}
            >
              <div
                className="p-5 rounded-xl h-full"
                style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border-subtle)' }}
              >
                <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                  {item.title}
                </h3>
                <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {item.body}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
