import { motion } from 'framer-motion'
import { Surface } from '@/components/ui/Surface'
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
    <section id="features" className="relative py-16 lg:py-24">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="max-w-2xl mb-16">
          <p className="text-sm font-mono text-[var(--brand-secondary)] tracking-wide mb-4 uppercase">
            Primitives
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[var(--text-primary)] mb-4 leading-[1.15]">
            Everything your agents need to cooperate.
          </h2>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed">
            Ten primitives that turn a collection of scripts into a production-grade autonomous system. Each one is a single CLI command.
          </p>
        </div>

        {/* Feature Grid */}
        <motion.div
          className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6"
          variants={container}
          initial="hidden"
          animate="show"
        >
          {PRODUCT_FEATURES.map((feature) => {
            const Icon = ICON_MAP[feature.category] || Terminal

            return (
              <motion.div key={feature.id} variants={item}>
                <Surface depth="raised" radius="2xl" padding="lg" interactive className="h-full">
                  <div className="relative">
                    <Surface depth="inset" radius="md" padding="none" className="w-10 h-10 flex items-center justify-center mb-4">
                      <Icon size={18} className="text-[var(--brand-accent)]" />
                    </Surface>

                    <h3 className="text-[15px] font-semibold text-[var(--text-primary)] mb-2 tracking-[-0.01em]">
                      {feature.title}
                    </h3>

                    <p className="text-sm text-[var(--text-muted)] leading-relaxed mb-4">
                      {feature.description}
                    </p>

                    {/* CLI snippet */}
                    <div
                      className="flex items-center gap-2 px-3 py-2 font-mono text-xs rounded-[var(--radius-sm)]"
                      style={{ background: 'var(--code-bg)' }}
                    >
                      <span className="text-[var(--code-prompt)] select-none">$</span>
                      <span className="text-[var(--code-text)]">{feature.cli}</span>
                    </div>
                  </div>
                </Surface>
              </motion.div>
            )
          })}
        </motion.div>
      </div>
    </section>
  )
}
