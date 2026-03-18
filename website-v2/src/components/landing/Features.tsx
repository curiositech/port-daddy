import { motion } from 'framer-motion'
import { PRODUCT_FEATURES } from '@/data/product'
import {
  Anchor, Radio, Shield, History, Cpu, Sparkles, Terminal
} from 'lucide-react'

const ICON_MAP: Record<string, typeof Anchor> = {
  'ports': Anchor,
  'coordination': Radio,
  'security': Shield,
  'observability': History,
  'agents': Cpu,
  'intelligence': Sparkles
}

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } }
}

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' as const } }
}

export function Features() {
  return (
    <section id="features" className="relative py-24 lg:py-32">
      {/* Subtle section divider glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[1px] bg-gradient-to-r from-transparent via-[#5eead4]/20 to-transparent" />

      <div className="max-w-[1200px] mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="max-w-2xl mb-16">
          <p className="text-sm font-mono text-[#5eead4] tracking-wide mb-4 uppercase">
            Primitives
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[var(--text-primary)] mb-4 leading-[1.15]">
            Everything your agents need to cooperate.
          </h2>
          <p className="text-base text-[var(--text-muted)] leading-relaxed">
            Nine primitives that turn a collection of scripts into a production-grade autonomous system. Each one is a single CLI command.
          </p>
        </div>

        {/* Feature Grid */}
        <motion.div
          className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4"
          variants={container}
          initial="hidden"
          animate="show"
        >
          {PRODUCT_FEATURES.map((feature) => {
            const Icon = ICON_MAP[feature.category] || Terminal

            return (
              <motion.div
                key={feature.id}
                variants={item}
                className="group relative p-6 rounded-xl overflow-hidden
                  bg-[var(--bg-surface)] border border-[var(--border-subtle)]
                  hover:border-[rgba(94,234,212,0.2)]
                  transition-all duration-300
                  hover:shadow-[0_8px_40px_-8px_rgba(13,148,136,0.15)]"
              >
                {/* Shimmer on hover */}
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                  style={{
                    background: 'linear-gradient(135deg, rgba(94,234,212,0.03) 0%, transparent 60%)'
                  }}
                />

                <div className="relative">
                  <Icon size={18} className="text-[#5eead4] mb-4" />

                  <h3 className="text-[15px] font-semibold text-[var(--text-primary)] mb-2 tracking-[-0.01em]">
                    {feature.title}
                  </h3>

                  <p className="text-sm text-[var(--text-muted)] leading-relaxed mb-4">
                    {feature.description}
                  </p>

                  {/* CLI snippet */}
                  <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--bg-base)] border border-[var(--border-subtle)] font-mono text-xs">
                    <span className="text-[#5eead4]/60 select-none">$</span>
                    <span className="text-[var(--text-muted)]">{feature.cli}</span>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </motion.div>
      </div>
    </section>
  )
}
