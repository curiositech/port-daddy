import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion } from 'framer-motion'
import { ArrowUpRight, Maximize2, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { BracketLabel, PageContainer, PanelBody, PanelEyebrow, PanelTitle, SectionIntro } from '@/components/site/primitives'
import { PRODUCT_FEATURES, type Feature } from '@/data/product'

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
}

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: 'easeOut' as const } },
}

const wideFeatureIds = new Set(['fleetbar', 'fleet-control'])

function getDarkImageSrc(src: string) {
  return src.includes('-light.')
    ? src.replace('-light.', '-dark.')
    : null
}

function FeatureArt({
  feature,
  wide = false,
}: {
  feature: Feature
  wide?: boolean
}) {
  const darkSrc = getDarkImageSrc(feature.image.src)

  return (
    <div className="relative h-full min-h-[11rem] overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
      <img
        src={feature.image.src}
        alt={feature.image.alt}
        className={[
          'h-full w-full object-cover',
          wide ? 'object-left-top' : 'object-center',
          darkSrc ? 'dark:hidden' : '',
        ].join(' ')}
        loading="lazy"
      />
      {darkSrc ? (
        <img
          src={darkSrc}
          alt={feature.image.alt}
          className={[
            'hidden h-full w-full object-cover dark:block',
            wide ? 'object-left-top' : 'object-center',
          ].join(' ')}
          loading="lazy"
        />
      ) : null}
    </div>
  )
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
              <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                <BracketLabel>{feature.category}</BracketLabel>
                <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                  {feature.status}
                </span>
              </div>
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
              <FeatureArt feature={feature} wide />
              <Dialog.Description asChild>
                <PanelBody className="max-w-none">
                  {feature.detail}
                </PanelBody>
              </Dialog.Description>
              <div className="grid gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-3)]">
                <PanelEyebrow>Primary surface</PanelEyebrow>
                <PanelBody size="compact" className="max-w-none">
                  {feature.href.startsWith('/docs')
                    ? 'The docs explain the workflow; the app and daemon keep the same capability inspectable during live work.'
                    : 'The app surface is the operator-facing entrance; agents can still write the underlying coordination state through Port Daddy APIs.'}
                </PanelBody>
              </div>
              <div className="grid gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-3)]">
                <PanelEyebrow>Concrete command</PanelEyebrow>
                <code className="block overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] font-black leading-[1.45] text-[var(--text-primary)]">
                  {feature.cli}
                </code>
                <Button asChild variant="secondary" size="sm">
                  <Link to={feature.href}>
                    Open surface
                    <ArrowUpRight size={15} />
                  </Link>
                </Button>
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

function FeatureCard({
  feature,
  index,
  onSelect,
}: {
  feature: Feature
  index: number
  onSelect: (feature: Feature) => void
}) {
  const isWide = wideFeatureIds.has(feature.id)

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(feature)
    }
  }

  return (
    <motion.div
      variants={item}
      className={isWide ? 'sm:col-span-2 lg:col-span-3' : 'sm:col-span-1 lg:col-span-2'}
    >
      <article
        aria-haspopup="dialog"
        aria-label={`${feature.title}: open detailed information`}
        className={[
          'group h-full cursor-pointer border-2 border-[var(--border-strong)] bg-[var(--surface-base)] transition-colors hover:bg-[var(--surface-raised)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-base)]',
          isWide ? 'grid gap-[var(--space-4)] p-[var(--space-4)] lg:grid-cols-[minmax(0,0.92fr)_minmax(14rem,1.08fr)]' : 'grid grid-rows-[12rem_minmax(0,1fr)] gap-[var(--space-4)] p-[var(--space-4)]',
        ].join(' ')}
        onClick={() => onSelect(feature)}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
      >
        {isWide ? null : <FeatureArt feature={feature} />}

        <div className="relative flex h-full flex-col gap-[var(--space-4)]">
          <div className="flex items-center justify-between border-b-2 border-[var(--border-strong)] pb-[var(--space-3)]">
            <span className="font-mono text-[12px] font-black uppercase tracking-[0.22em] text-[var(--text-primary)]">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="flex flex-wrap items-center justify-end gap-[var(--space-2)] text-right font-sans text-[12px] font-black uppercase tracking-[0.22em]">
              <span className="text-[var(--text-secondary)]">{feature.category}</span>
              <span className="border-l-2 border-[var(--border-strong)] pl-[var(--space-2)] text-[var(--brand-primary)]">
                {feature.status}
              </span>
            </span>
          </div>
          <PanelTitle as="h3" size={isWide ? 'card' : 'nav'} className="max-w-none">
            {feature.title}
          </PanelTitle>

          <PanelBody size="compact" className="max-w-none flex-1">
            {feature.description}
          </PanelBody>

          <div className="grid gap-[var(--space-2)] border-t-2 border-[var(--border-default)] pt-[var(--space-3)]">
            <PanelEyebrow>What it unlocks</PanelEyebrow>
            <PanelBody size="compact" className="max-w-none">
              {feature.outcomes[0]}
            </PanelBody>
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

        {isWide ? <FeatureArt feature={feature} wide /> : null}
      </article>
    </motion.div>
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
    <section id="features" className="relative border-t-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      <PageContainer width="wide">
        <div className="mb-[var(--space-7)] grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.9fr)_minmax(18rem,0.55fr)] lg:items-end">
          <SectionIntro
            eyebrow="Product surface"
            title="One layer, many ways to inspect work."
            description="Port Daddy is built as infrastructure first, with a real operator surface on top. FleetBar, Fleet Control Center, sessions, guardrails, inboxes, resources, sorties, and relay security all point back to the same local daemon state."
            titleAs="h2"
            className="max-w-[46rem]"
            titleClassName="max-w-[14ch]"
            bodyClassName="max-w-[39rem]"
          />
          <div className="grid border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)]">
            <PanelEyebrow>Evaluation map</PanelEyebrow>
            <PanelBody className="mt-[var(--space-2)] max-w-none">
              For an AI tooling team, the important question is whether the control plane is more than a demo. Each card links a user-facing surface to the command, state, and outcome underneath it.
            </PanelBody>
          </div>
        </div>

        <motion.div
          className="grid gap-[var(--space-5)] sm:grid-cols-2 lg:grid-cols-6"
          variants={container}
          initial="hidden"
          animate="show"
        >
          {PRODUCT_FEATURES.map((feature, index) => (
            <FeatureCard
              key={feature.id}
              feature={feature}
              index={index}
              onSelect={setSelectedFeature}
            />
          ))}
        </motion.div>
      </PageContainer>
      {selectedFeature ? (
        <FeatureDetailDialog feature={selectedFeature} onClose={() => setSelectedFeature(null)} />
      ) : null}
    </section>
  )
}
