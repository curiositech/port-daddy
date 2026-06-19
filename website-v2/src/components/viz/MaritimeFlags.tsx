// import * as React from 'react'
import { motion } from 'framer-motion'

/**
 * Maritime Signal Flags (SVG Components)
 * P: Blue with white square (Pilot)
 * D: Yellow-Blue-Yellow (Daddy)
 */

export function FlagP({ size = 40 }: { size?: number }) {
  return (
    <motion.svg width={size} height={size} viewBox="0 0 100 100" className="shadow-lg rounded-sm overflow-hidden">
      <motion.rect width="100" height="100" fill="#000080" />
      <motion.rect x="25" y="25" width="50" height="50" fill="white" />
    </motion.svg>
  )
}

export function FlagD({ size = 40 }: { size?: number }) {
  return (
    <motion.svg width={size} height={size} viewBox="0 0 100 100" className="shadow-lg rounded-sm overflow-hidden">
      <motion.rect width="100" height="33.3" fill="#FFD700" />
      <motion.rect y="33.3" width="100" height="33.3" fill="#000080" />
      <motion.rect y="66.6" width="100" height="33.4" fill="#FFD700" />
    </motion.svg>
  )
}

export function MaritimeSignalRow({ size = 24 }: { size?: number }) {
  return (
    <motion.div className="flex gap-2 items-center font-sans">
      <motion.div
        initial={{ rotate: -10, scale: 0.8, opacity: 0 }}
        animate={{ rotate: 0, scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, delay: 0.5 }}
      >
        <FlagP size={size} />
      </motion.div>
      <motion.div
        initial={{ rotate: 10, scale: 0.8, opacity: 0 }}
        animate={{ rotate: 0, scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, delay: 0.6 }}
      >
        <FlagD size={size} />
      </motion.div>
    </motion.div>
  )
}
