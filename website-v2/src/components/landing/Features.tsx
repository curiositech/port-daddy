import { motion } from 'framer-motion'
import { PageContainer, PanelBody, PanelTitle, SectionIntro } from '@/components/site/primitives'
import { PRODUCT_FEATURES } from '@/data/product'

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
          {PRODUCT_FEATURES.map((feature, index) => {
            return (
              <motion.div key={feature.id} variants={item}>
                <article className="h-full border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-5)] transition-colors hover:bg-[var(--surface-raised)]">
                  <div className="relative flex h-full flex-col gap-[var(--space-4)]">
                    <div className="flex items-center justify-between border-b-2 border-[var(--border-strong)] pb-[var(--space-3)]">
                      <span className="font-mono text-[10px] font-black uppercase tracking-[0.22em] text-[var(--text-primary)]">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="border-l-2 border-[var(--border-strong)] pl-[var(--space-3)] font-sans text-[10px] font-black uppercase tracking-[0.22em] text-[var(--text-secondary)]">
                        {feature.category}
                      </span>
                    </div>
                    <PanelTitle as="h3" size="nav" className="max-w-none">
                      {feature.title}
                    </PanelTitle>

                    <PanelBody size="compact" className="max-w-none flex-1">
                      {feature.description}
                    </PanelBody>

                    {/* CLI snippet */}
                    <div
                      className="flex items-center gap-2 border-2 border-[var(--border-strong)] px-3 py-2 font-mono text-xs"
                      style={{ background: 'var(--code-bg)' }}
                    >
                      <span className="text-[var(--code-prompt)] select-none">$</span>
                      <span className="text-[var(--code-text)]">{feature.cli}</span>
                    </div>
                  </div>
                </article>
              </motion.div>
            )
          })}
        </motion.div>
      </PageContainer>
    </section>
  )
}
