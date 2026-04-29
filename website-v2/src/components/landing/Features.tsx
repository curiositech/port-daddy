import { motion } from 'framer-motion'
import { Anchor, Cpu, History, Radio, Shield, Sparkles, Terminal } from 'lucide-react'
import {
  BracketLabel,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
} from '@/components/site/primitives'
import { PRODUCT_FEATURES } from '@/data/product'
import { cn } from '@/lib/utils'

const ICON_MAP: Record<string, typeof Anchor> = {
  ports: Anchor,
  coordination: Radio,
  security: Shield,
  observability: History,
  agents: Cpu,
  intelligence: Sparkles,
}

const FEATURE_TONE: Partial<Record<string, 'blue' | 'lime'>> = {
  'agent-spawning': 'blue',
  'pheromone-trails': 'lime',
}

const STATUS_LABEL = {
  core: 'Current',
  new: 'New',
  preview: 'Preview',
} as const

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
}

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' as const } },
}

function toneForSurface(tone: 'paper' | 'blue' | 'lime') {
  return tone === 'blue' ? 'primary' : tone === 'lime' ? 'accent' : 'default'
}

export function Features() {
  return (
    <section
      id="features"
      className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]"
    >
      <PageContainer width="wide">
        <SectionIntro
          eyebrow="Primitives"
          title="One command per primitive. One system voice."
          description="Port Daddy exposes coordination as sharp, legible building blocks. The control plane stays small enough to reason about and strong enough to run real work."
          titleAs="h2"
          className="mb-[var(--space-7)] max-w-[48rem]"
          titleClassName="max-w-[15ch]"
          bodyClassName="max-w-[42rem]"
        />

        <motion.div
          className="grid gap-[var(--space-4)] md:grid-cols-2 xl:grid-cols-3"
          variants={container}
          initial="hidden"
          animate="show"
        >
          {PRODUCT_FEATURES.map((feature, index) => {
            const Icon = ICON_MAP[feature.category] ?? Terminal
            const tone = FEATURE_TONE[feature.id] ?? 'paper'
            const panelTone = toneForSurface(tone)

            return (
              <motion.article key={feature.id} variants={item}>
                <SurfacePanel
                  tone={tone}
                  elevation={tone === 'paper' ? 'quiet' : 'raised'}
                  className="flex h-full flex-col gap-[var(--panel-gap-loose)]"
                >
                  <div className="flex items-start justify-between gap-[var(--panel-gap)] border-b-2 border-current/20 pb-[var(--panel-gap)]">
                    <div className="flex items-start gap-[var(--space-3)]">
                      <div
                        className={cn(
                          'flex h-12 w-12 items-center justify-center border-2',
                          tone === 'blue'
                            ? 'border-[color:var(--brand-primary-foreground-subtle)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
                            : tone === 'lime'
                              ? 'border-[color:var(--brand-accent-foreground-muted)] bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)]'
                              : 'border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--brand-primary)]',
                        )}
                      >
                        <Icon size={18} />
                      </div>

                      <div className="space-y-[var(--space-1)]">
                        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                          <PanelEyebrow tone={panelTone}>{String(index + 1).padStart(2, '0')}</PanelEyebrow>
                          <div className="h-[var(--space-4)] w-px bg-current/30" />
                          <PanelEyebrow tone={panelTone}>{feature.category}</PanelEyebrow>
                        </div>
                        <PanelTitle as="h3" size="nav" tone={panelTone} className="max-w-none">
                          {feature.title}
                        </PanelTitle>
                      </div>
                    </div>

                    <BracketLabel tone={panelTone} surface={tone}>
                      {STATUS_LABEL[feature.status]}
                    </BracketLabel>
                  </div>

                  <PanelBody
                    size="compact"
                    tone={panelTone}
                    className="max-w-none"
                  >
                    {feature.description}
                  </PanelBody>

                  <div className="mt-auto space-y-[var(--space-2)]">
                    <PanelEyebrow tone={panelTone}>Command</PanelEyebrow>
                    <div
                      className={cn(
                        'flex items-center gap-[var(--space-2)] border-2 px-[var(--space-3)] py-[var(--space-3)] font-mono text-xs',
                        tone === 'blue'
                          ? 'border-[color:var(--brand-primary-foreground-subtle)] bg-[#0f1730] text-[var(--brand-primary-foreground)]'
                          : tone === 'lime'
                            ? 'border-[color:var(--brand-accent-foreground-muted)] bg-[#171d05] text-[#f6ffd1]'
                            : 'border-[var(--code-border)] bg-[var(--code-bg)] text-[var(--code-text)]',
                      )}
                    >
                      <span
                        className={cn(
                          'select-none',
                          tone === 'lime' ? 'text-[#dfff00]' : 'text-[var(--code-prompt)]',
                        )}
                      >
                        $
                      </span>
                      <span>{feature.cli}</span>
                    </div>
                  </div>
                </SurfacePanel>
              </motion.article>
            )
          })}
        </motion.div>
      </PageContainer>
    </section>
  )
}
