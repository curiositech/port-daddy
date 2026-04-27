import { motion } from 'framer-motion'
import { Surface } from '@/components/ui/Surface'
import { PageContainer, PanelBody, PanelTitle, SectionIntro } from '@/components/site/primitives'
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
    <section id="features" className="relative py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      <PageContainer>
        <SectionIntro
          eyebrow="Primitives"
          title="Everything your agents need to cooperate."
          description="Ten primitives that turn a collection of scripts into a production-grade autonomous system. Each one is a single CLI command."
          titleAs="h2"
          className="mb-[var(--space-7)] max-w-[46rem]"
          titleClassName="max-w-[14ch]"
          bodyClassName="max-w-[38rem]"
        />

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
                <Surface depth="raised" radius="lg" padding="lg" interactive className="h-full">
                  <div className="relative space-y-[var(--space-4)]">
                    <Surface depth="inset" radius="md" padding="none" className="flex h-10 w-10 items-center justify-center">
                      <Icon size={18} className="text-[var(--brand-accent)]" />
                    </Surface>

                    <PanelTitle as="h3" size="nav" className="max-w-none">
                      {feature.title}
                    </PanelTitle>

                    <PanelBody size="compact" className="max-w-none">
                      {feature.description}
                    </PanelBody>

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
      </PageContainer>
    </section>
  )
}
