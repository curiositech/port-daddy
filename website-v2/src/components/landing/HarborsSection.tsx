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

function HarborDiagram() {
  return (
    <svg viewBox="0 0 480 320" className="w-full max-w-lg" style={{ overflow: 'visible' }}>
      {/* Harbor boundary */}
      <ellipse
        cx="240" cy="160" rx="170" ry="120"
        fill="rgba(58,173,173,0.04)"
        stroke="var(--p-teal-600)"
        strokeWidth="1.5"
        strokeDasharray="6 4"
      />

      {/* Harbor label */}
      <text x="240" y="52" textAnchor="middle" fontSize="11" fontFamily="monospace" fill="var(--p-teal-400)" fontWeight="600">
        harbor: myapp:security-review
      </text>

      {/* Center hub — the capability token */}
      <circle cx="240" cy="160" r="36" fill="var(--bg-overlay)" stroke="var(--brand-primary)" strokeWidth="1.5" />
      <text x="240" y="155" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--brand-primary)" fontWeight="700">HARBOR</text>
      <text x="240" y="168" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="var(--text-muted)">TOKEN</text>

      {/* Agent 1 — entering */}
      <circle cx="72" cy="120" r="22" fill="var(--bg-surface)" stroke="var(--p-teal-500)" strokeWidth="1.5" />
      <text x="72" y="116" textAnchor="middle" fontSize="8" fontFamily="monospace" fill="var(--p-teal-300)">agent</text>
      <text x="72" y="128" textAnchor="middle" fontSize="8" fontFamily="monospace" fill="var(--text-muted)">reviewer</text>
      {/* Arrow from agent1 to center */}
      <motion.line
        x1="94" y1="128" x2="204" y2="152"
        stroke="var(--p-teal-500)" strokeWidth="1.5" strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        whileInView={{ pathLength: 1, opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.3 }}
      />
      <polygon points="204,152 195,145 200,156" fill="var(--p-teal-500)" />

      {/* Agent 2 — entering */}
      <circle cx="72" cy="200" r="22" fill="var(--bg-surface)" stroke="var(--p-teal-500)" strokeWidth="1.5" />
      <text x="72" y="196" textAnchor="middle" fontSize="8" fontFamily="monospace" fill="var(--p-teal-300)">agent</text>
      <text x="72" y="208" textAnchor="middle" fontSize="8" fontFamily="monospace" fill="var(--text-muted)">scanner</text>
      <motion.line
        x1="94" y1="192" x2="204" y2="164"
        stroke="var(--p-teal-500)" strokeWidth="1.5" strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        whileInView={{ pathLength: 1, opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.5 }}
      />
      <polygon points="204,164 196,156 200,167" fill="var(--p-teal-500)" />

      {/* Rejected agent */}
      <circle cx="72" cy="280" r="22" fill="var(--bg-surface)" stroke="var(--p-red-400)" strokeWidth="1.5" strokeDasharray="4 3" />
      <text x="72" y="276" textAnchor="middle" fontSize="8" fontFamily="monospace" fill="var(--p-red-400)">agent</text>
      <text x="72" y="288" textAnchor="middle" fontSize="8" fontFamily="monospace" fill="var(--text-muted)">unknown</text>
      {/* X mark */}
      <line x1="110" y1="268" x2="140" y2="258" stroke="var(--p-red-400)" strokeWidth="1.5" />
      <line x1="112" y1="256" x2="140" y2="268" stroke="var(--p-red-400)" strokeWidth="1.5" />
      <text x="150" y="265" fontSize="9" fontFamily="monospace" fill="var(--p-red-400)">denied</text>

      {/* Scoped capabilities radiating right */}
      {[
        { label: 'code:read', x: 360, y: 90 },
        { label: 'notes:write', x: 400, y: 135 },
        { label: 'tunnel:create', x: 415, y: 182 },
        { label: 'msg:publish', x: 395, y: 228 },
      ].map(({ label, x, y }, i) => (
        <g key={label}>
          <motion.line
            x1="276" y1="160" x2={x - 52} y2={y}
            stroke="var(--border-default)" strokeWidth="1" strokeDasharray="3 3"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.3, delay: 0.7 + i * 0.1 }}
          />
          <motion.rect
            x={x - 52} y={y - 10} width={90} height={20} rx={4}
            fill="var(--bg-overlay)" stroke="var(--border-subtle)" strokeWidth="1"
            initial={{ opacity: 0, x: 10 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.3, delay: 0.7 + i * 0.1 }}
          />
          <motion.text
            x={x - 7} y={y + 4}
            textAnchor="middle" fontSize="8" fontFamily="monospace" fill="var(--p-teal-300)"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.3, delay: 0.8 + i * 0.1 }}
          >
            {label}
          </motion.text>
        </g>
      ))}

      {/* Expiry ring pulse */}
      <motion.circle
        cx="240" cy="160" r="170"
        fill="none" stroke="var(--p-teal-600)" strokeWidth="1"
        initial={{ opacity: 0.4, scale: 0.98 }}
        animate={{ opacity: 0, scale: 1.06 }}
        transition={{ duration: 2.5, repeat: Infinity, ease: 'easeOut', delay: 1 }}
        style={{ transformOrigin: '240px 160px' }}
      />
    </svg>
  )
}

export function HarborsSection() {
  return (
    <section
      className="py-24 px-4 sm:px-6 lg:px-8"
      style={{ background: 'var(--bg-surface)', borderTop: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)' }}
    >
      <div className="max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-16 items-center">

          {/* Left: explanation */}
          <motion.div
            initial={{ opacity: 0, x: -24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <Badge variant="teal" className="mb-4">New in v3.5</Badge>
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

          {/* Right: diagram */}
          <motion.div
            initial={{ opacity: 0, x: 24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="flex justify-center"
          >
            <HarborDiagram />
          </motion.div>
        </div>

        {/* Bottom: three properties */}
        <div className="grid sm:grid-cols-3 gap-6 mt-16 pt-12" style={{ borderTop: '1px solid var(--border-subtle)' }}>
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
