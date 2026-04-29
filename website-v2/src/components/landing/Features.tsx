import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'framer-motion'
import { ArrowUpRight, Maximize2, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { BracketLabel, PageContainer, PanelBody, PanelTitle, SectionIntro } from '@/components/site/primitives'
import { PRODUCT_FEATURES, type Feature } from '@/data/product'

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } }
}

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' as const } }
}

function FeatureDetailDialog({
  feature,
  onClose,
}: {
  feature: Feature
  onClose: () => void
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-[var(--scrim-backdrop)]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[101] grid max-h-[calc(100dvh-var(--space-6))] w-[min(calc(100vw-var(--space-6)),72rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-[var(--shadow-brutal)]">
          <div className="flex flex-wrap items-start justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-strong)] p-[var(--space-4)]">
            <div className="grid gap-[var(--space-2)]">
              <BracketLabel>{feature.category}</BracketLabel>
              <Dialog.Title asChild>
                <PanelTitle as="h3" size="card" className="max-w-[18ch]">
                  {feature.title}
                </PanelTitle>
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <Button type="button" variant="secondary" size="sm" aria-label="Close feature details">
                <X size={16} />
                Close
              </Button>
            </Dialog.Close>
          </div>

          <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
            <div className="grid gap-[var(--space-4)] border-b-2 border-[var(--border-strong)] p-[var(--space-4)] lg:border-b-0 lg:border-r-2">
              <img
                src={feature.image.src}
                alt={feature.image.alt}
                className="aspect-[16/10] w-full border-2 border-[var(--border-strong)] bg-[var(--surface-base)] object-cover object-left-top"
                loading="lazy"
              />
              <Dialog.Description asChild>
                <PanelBody className="max-w-none">
                  {feature.detail}
                </PanelBody>
              </Dialog.Description>
              <div
                className="flex items-center gap-2 border-2 border-[var(--border-strong)] px-3 py-2 font-mono text-xs"
                style={{ background: 'var(--code-bg)' }}
              >
                <span className="select-none text-[var(--code-prompt)]">$</span>
                <span className="text-[var(--code-text)]">{feature.cli}</span>
              </div>
            </div>

            <div className="grid content-start gap-[var(--space-5)] p-[var(--space-4)]">
              <div className="grid gap-[var(--space-3)]">
                <PanelTitle as="h4" size="nav" className="max-w-none">
                  Why this matters
                </PanelTitle>
                <ul className="grid gap-[var(--space-2)]">
                  {feature.outcomes.map((outcome) => (
                    <li
                      key={outcome}
                      className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-[var(--space-2)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]"
                    >
                      <span className="mt-[0.45em] h-2 w-2 bg-[var(--brand-primary)]" aria-hidden="true" />
                      <span>{outcome}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="grid gap-[var(--space-3)] border-t-2 border-[var(--border-default)] pt-[var(--space-4)]">
                <PanelTitle as="h4" size="nav" className="max-w-none">
                  Go deeper
                </PanelTitle>
                <div className="grid gap-[var(--space-2)]">
                  {feature.links.map((link) => (
                    <Link
                      key={link.href}
                      to={link.href}
                      className="group flex items-center justify-between gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)] no-underline transition-colors hover:bg-[var(--interactive-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                    >
                      <span>{link.label}</span>
                      <ArrowUpRight
                        size={15}
                        aria-hidden="true"
                        className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                      />
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function Features() {
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null)

  useEffect(() => {
    if (!selectedFeature) {
      return undefined
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedFeature(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedFeature])

  return (
    <section id="features" className="relative py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      <PageContainer>
        <SectionIntro
          eyebrow="Primitives"
          title="Everything your agents need to cooperate."
          description="Eleven primitives that turn a collection of scripts into a production-grade autonomous system. Each one maps to a command, app surface, or operator workflow."
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
            const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setSelectedFeature(feature)
              }
            }

            return (
              <motion.div key={feature.id} variants={item}>
                <article
                  aria-haspopup="dialog"
                  aria-label={`${feature.title}: open detailed information`}
                  className="group h-full cursor-pointer border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-5)] transition-colors hover:bg-[var(--surface-raised)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-base)]"
                  onClick={() => setSelectedFeature(feature)}
                  onKeyDown={handleKeyDown}
                  role="button"
                  tabIndex={0}
                >
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

                    <div className="mt-auto flex items-center justify-between border-t-2 border-[var(--border-strong)] pt-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                      <span>Open full card</span>
                      <Maximize2
                        size={16}
                        aria-hidden="true"
                        className="transition-transform group-hover:scale-110"
                      />
                    </div>
                  </div>
                </article>
              </motion.div>
            )
          })}
        </motion.div>
      </PageContainer>
      {selectedFeature ? (
        <FeatureDetailDialog feature={selectedFeature} onClose={() => setSelectedFeature(null)} />
      ) : null}
    </section>
  )
}
