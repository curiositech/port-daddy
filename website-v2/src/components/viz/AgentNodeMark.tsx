import { motion } from 'framer-motion'

interface AgentNodeMarkProps {
  size?: number
  status?: 'active' | 'idle' | 'dead' | string
  color?: string
  className?: string
}

export function AgentNodeMark({
  size = 60,
  status = 'active',
  color = 'var(--brand-primary)',
  className,
}: AgentNodeMarkProps) {
  const isActive = status === 'active'
  const isDead = status === 'dead'

  return (
    <motion.div
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      whileHover={{ scale: 1.08 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
      >
        <motion.rect
          x="18"
          y="18"
          width="64"
          height="64"
          rx="10"
          fill="var(--surface-overlay)"
          stroke={color}
          strokeWidth="3"
          animate={{
            opacity: isDead ? 0.45 : 1,
            y: isActive ? [0, -1.5, 0] : 0,
          }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
        <path d="M28 36 H72" stroke={color} strokeWidth="3" strokeLinecap="square" opacity="0.72" />
        <path d="M28 50 H72" stroke={color} strokeWidth="3" strokeLinecap="square" opacity="0.42" />
        <path d="M28 64 H72" stroke={color} strokeWidth="3" strokeLinecap="square" opacity="0.72" />
        <motion.path
          d="M36 28 V72 M64 28 V72"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="square"
          opacity="0.32"
        />
        {isActive ? (
          <motion.g
            animate={{ opacity: [0.35, 1, 0.35] }}
            transition={{ duration: 1.8, repeat: Infinity }}
          >
            <rect x="44" y="44" width="12" height="12" rx="2" fill="var(--brand-accent)" />
          </motion.g>
        ) : null}
        {isDead ? <path d="M30 30 L70 70 M70 30 L30 70" stroke={color} strokeWidth="3" /> : null}
      </svg>
    </motion.div>
  )
}
