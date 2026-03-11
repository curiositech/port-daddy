import { motion } from 'framer-motion'

interface Agent {
  id: string
  label: string
  angle: number  // degrees
  status: 'active' | 'idle' | 'dead'
  harbor?: string
}

const AGENTS: Agent[] = [
  { id: 'a1', label: 'claude\ncoder', angle: 30, status: 'active', harbor: 'auth' },
  { id: 'a2', label: 'claude\nreviewer', angle: 90, status: 'active', harbor: 'auth' },
  { id: 'a3', label: 'aider\nrefactor', angle: 150, status: 'idle', harbor: 'ops' },
  { id: 'a4', label: 'gemini\nplanner', angle: 210, status: 'active', harbor: 'ops' },
  { id: 'a5', label: 'ollama\ndraft', angle: 270, status: 'idle' },
  { id: 'a6', label: 'claude\ntest-gen', angle: 330, status: 'dead' },
]

const STATUS_COLORS = {
  active: 'var(--p-teal-400)',
  idle: 'var(--p-navy-300)',
  dead: 'var(--p-red-500)',
}

const HARBOR_COLORS: Record<string, string> = {
  auth: 'rgba(58, 173, 173, 0.15)',
  ops: 'rgba(251, 191, 36, 0.12)',
}

function polarToCart(cx: number, cy: number, r: number, angleDeg: number) {
  const a = (angleDeg - 90) * (Math.PI / 180)
  return {
    x: cx + r * Math.cos(a),
    y: cy + r * Math.sin(a),
  }
}

export function HarborViz() {
  const cx = 220
  const cy = 220
  const orbitR = 150
  const agentR = 22

  const harbors = [
    { name: 'auth', agents: AGENTS.filter(a => a.harbor === 'auth'), color: HARBOR_COLORS.auth, borderColor: 'var(--p-teal-700)' },
    { name: 'ops', agents: AGENTS.filter(a => a.harbor === 'ops'), color: HARBOR_COLORS.ops, borderColor: 'var(--p-amber-600)' },
  ]

  return (
    <div className="relative flex items-center justify-center">
      <svg
        viewBox="0 0 440 440"
        className="w-full max-w-sm"
        style={{ filter: 'drop-shadow(0 0 40px rgba(58, 173, 173, 0.15))' }}
      >
        {/* Orbit ring */}
        <circle
          cx={cx} cy={cy} r={orbitR}
          fill="none"
          stroke="var(--border-default)"
          strokeWidth="1"
          strokeDasharray="4 6"
        />

        {/* Harbor regions — draw ellipses around groups */}
        {harbors.map(h => {
          const points = h.agents.map(a => polarToCart(cx, cy, orbitR, a.angle))
          if (points.length < 2) return null
          const midX = points.reduce((s, p) => s + p.x, 0) / points.length
          const midY = points.reduce((s, p) => s + p.y, 0) / points.length
          return (
            <g key={h.name}>
              <ellipse
                cx={midX} cy={midY}
                rx={55} ry={45}
                fill={h.color}
                stroke={h.borderColor}
                strokeWidth="1.5"
                strokeDasharray="3 4"
              />
              <text
                x={midX}
                y={midY - 52}
                textAnchor="middle"
                fontSize="10"
                fill={h.borderColor}
                fontFamily="monospace"
                fontWeight="600"
                letterSpacing="2"
              >
                {h.name.toUpperCase()}
              </text>
            </g>
          )
        })}

        {/* Port Daddy core */}
        <motion.circle
          cx={cx} cy={cy} r={36}
          fill="var(--bg-overlay)"
          stroke="var(--brand-primary)"
          strokeWidth="2"
          animate={{ r: [36, 38, 36] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Glow */}
        <motion.circle
          cx={cx} cy={cy} r={50}
          fill="none"
          stroke="var(--brand-primary)"
          strokeWidth="1"
          animate={{ opacity: [0.15, 0.3, 0.15], r: [50, 56, 50] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
        <text x={cx} y={cy - 8} textAnchor="middle" fontSize="18" fill="var(--brand-primary)">
          ⚓
        </text>
        <text x={cx} y={cy + 8} textAnchor="middle" fontSize="9" fill="var(--text-muted)" fontFamily="monospace" fontWeight="600" letterSpacing="1">
          PORT
        </text>
        <text x={cx} y={cy + 19} textAnchor="middle" fontSize="9" fill="var(--text-muted)" fontFamily="monospace" fontWeight="600" letterSpacing="1">
          DADDY
        </text>

        {/* Connection lines + agents */}
        {AGENTS.map(agent => {
          const pos = polarToCart(cx, cy, orbitR, agent.angle)
          const color = STATUS_COLORS[agent.status]
          const lines = agent.label.split('\n')

          return (
            <g key={agent.id}>
              {/* Line to center */}
              <motion.line
                x1={cx} y1={cy} x2={pos.x} y2={pos.y}
                stroke={color}
                strokeWidth={agent.status === 'active' ? 1.5 : 0.75}
                strokeDasharray={agent.status === 'dead' ? '3 5' : agent.status === 'idle' ? '5 3' : undefined}
                animate={agent.status === 'active' ? { opacity: [0.4, 0.8, 0.4] } : { opacity: 0.3 }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: Math.random() * 2 }}
              />

              {/* Agent node */}
              <motion.circle
                cx={pos.x} cy={pos.y} r={agentR}
                fill="var(--bg-elevated)"
                stroke={color}
                strokeWidth="2"
                animate={agent.status === 'active'
                  ? { r: [agentR, agentR + 2, agentR], opacity: [0.9, 1, 0.9] }
                  : {}
                }
                transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut', delay: Math.random() * 2 }}
              />

              {/* Status dot */}
              <motion.circle
                cx={pos.x + agentR - 5}
                cy={pos.y - agentR + 5}
                r={5}
                fill={color}
                animate={agent.status === 'active' ? { opacity: [0.7, 1, 0.7] } : { opacity: 0.5 }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />

              {/* Label */}
              {lines.map((line, li) => (
                <text
                  key={li}
                  x={pos.x}
                  y={pos.y + (li === 0 ? -6 : 7)}
                  textAnchor="middle"
                  fontSize="8"
                  fill={agent.status === 'dead' ? 'var(--text-disabled)' : 'var(--text-secondary)'}
                  fontFamily="monospace"
                >
                  {line}
                </text>
              ))}
            </g>
          )
        })}

        {/* Pulse ring animation from center when active */}
        <motion.circle
          cx={cx} cy={cy} r={36}
          fill="none"
          stroke="var(--brand-primary)"
          strokeWidth="1"
          animate={{ r: [36, 180], opacity: [0.3, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeOut', repeatDelay: 2 }}
        />
      </svg>

      {/* Legend */}
      <div
        className="absolute bottom-2 right-2 text-xs font-mono flex flex-col gap-1"
        style={{ color: 'var(--text-muted)' }}
      >
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: STATUS_COLORS.active }} />
          active
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: STATUS_COLORS.idle }} />
          idle
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: STATUS_COLORS.dead }} />
          dead → salvage
        </div>
      </div>
    </div>
  )
}
