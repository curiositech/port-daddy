import { motion } from 'framer-motion'

interface SailorProps {
  size?: number
  expression?: 'happy' | 'thinking' | 'working' | 'dead'
  color?: string
  className?: string
}

export function SailorAgent({ 
  size = 60, 
  expression = 'happy', 
  color = 'var(--brand-primary)',
  className 
}: SailorProps) {
  return (
    <motion.div
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      whileHover={{ scale: 1.1, rotate: [0, -5, 5, 0] }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
      >
        {/* Shadow */}
        <ellipse cx="50" cy="95" rx="20" ry="5" fill="black" opacity="0.1" />

        {/* Body - A round bouncy blob */}
        <motion.circle
          cx="50" cy="60" r="35"
          fill="var(--bg-overlay)"
          stroke={color}
          strokeWidth="4"
          animate={{
            scaleY: [1, 1.05, 1],
            y: [0, -2, 0]
          }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Sailor Hat */}
        <motion.g
          animate={{
            y: [0, -4, 0],
            rotate: [0, 3, -3, 0]
          }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        >
          <path d="M30 35 C 30 25, 70 25, 70 35 L 70 45 L 30 45 Z" fill="white" stroke={color} strokeWidth="3" />
          <rect x="30" y="40" width="40" height="5" fill={color} />
          <circle cx="50" cy="25" r="5" fill="white" stroke={color} strokeWidth="2" />
        </motion.g>

        {/* Eyes */}
        <g>
          {expression === 'dead' ? (
            <>
              <path d="M35 55 L45 65 M45 55 L35 65" stroke={color} strokeWidth="3" strokeLinecap="round" />
              <path d="M55 55 L65 65 M65 55 L55 65" stroke={color} strokeWidth="3" strokeLinecap="round" />
            </>
          ) : expression === 'thinking' ? (
            <>
              <circle cx="40" cy="60" r="3" fill={color} />
              <circle cx="60" cy="60" r="3" fill={color} />
              <motion.path 
                d="M35 50 Q 40 45, 45 50" stroke={color} strokeWidth="2" fill="none" 
                animate={{ y: [0, -2, 0] }} transition={{ duration: 2, repeat: Infinity }}
              />
            </>
          ) : (
            <>
              <motion.circle 
                cx="40" cy="60" r="4" fill={color} 
                animate={{ scaleY: [1, 0.1, 1] }} 
                transition={{ duration: 4, repeat: Infinity, repeatDelay: 3 }}
              />
              <motion.circle 
                cx="60" cy="60" r="4" fill={color} 
                animate={{ scaleY: [1, 0.1, 1] }} 
                transition={{ duration: 4, repeat: Infinity, repeatDelay: 3 }}
              />
            </>
          )}
        </g>

        {/* Mouth */}
        <motion.path
          d={expression === 'happy' ? "M40 75 Q 50 82, 60 75" : expression === 'working' ? "M40 75 L 60 75" : "M45 78 L 55 78"}
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          animate={expression === 'happy' ? { d: ["M40 75 Q 50 82, 60 75", "M40 75 Q 50 85, 60 75", "M40 75 Q 50 82, 60 75"] } : {}}
          transition={{ duration: 2, repeat: Infinity }}
        />

        {/* Sparkles if working */}
        {expression === 'working' && (
          <motion.g
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 1, repeat: Infinity }}
          >
            <path d="M80 40 L 82 35 L 84 40 L 89 42 L 84 44 L 82 49 L 80 44 L 75 42 Z" fill="var(--p-amber-400)" />
          </motion.g>
        )}
      </svg>
    </motion.div>
  )
}
