import { ArrowRight, CheckCircle2, KeyRound, ShipWheel } from 'lucide-react'
import { COLD_START_STEPS } from '@/data/product'
import {
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
  SwissGrid,
  SwissGridItem,
} from '@/components/site/primitives'
import { RoleTerm } from '@/components/site/RoleTerm'

export function ColdStartSection() {
  return (
    <section id="cold-start" className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      <PageContainer width="wide">
        <SwissGrid className="items-start">
          <SwissGridItem span="wide">
            <SectionIntro
              eyebrow="Cold start"
              title="New projects should enter through a fleet architect."
              description={
                <>
                  The first-use path is intentionally concrete: install the local daemon, expose
                  required backend keys, let <RoleTerm role="shipwright">Shipwright</RoleTerm> survey
                  the repo, simulate a bounded starter fleet, and then operate from Flow instead of
                  hand-editing YAML in the dark.
                </>
              }
              titleAs="h2"
              titleSize="display"
              titleClassName="max-w-[13ch]"
              bodyClassName="max-w-[44rem]"
            />
          </SwissGridItem>
          <SwissGridItem span="rail">
            <SurfacePanel tone="blue" padding="compact" className="grid gap-[var(--space-3)]">
              <PanelEyebrow tone="primary">Design rule</PanelEyebrow>
              <PanelBody tone="primary" size="compact" className="max-w-none">
                API keys, budget caps, model readiness, and project onboarding must be visible before a spawn, not discovered after a failed launch.
              </PanelBody>
            </SurfacePanel>
            <picture className="mt-[var(--space-4)] block overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
              <source srcSet="/img/generated/shipwright-proposal.webp" type="image/webp" />
              <img
                src="/img/generated/shipwright-proposal.jpg"
                alt="Abstract Shipwright fleet proposal diagram"
                className="aspect-[16/10] w-full object-cover"
                loading="lazy"
              />
            </picture>
          </SwissGridItem>
        </SwissGrid>

        <div className="mt-[var(--space-7)] grid gap-[var(--space-4)]">
          {COLD_START_STEPS.map((step, index) => (
            <article
              key={step.id}
              className="grid gap-[var(--space-4)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)] md:grid-cols-[5rem_minmax(0,1fr)_minmax(260px,0.8fr)] md:p-[var(--space-5)]"
            >
              <div className="flex items-start justify-between gap-[var(--space-3)] md:block">
                <span className="font-mono text-[length:var(--type-panel-title-card-size)] font-black text-[var(--brand-primary)]">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="mt-[var(--space-3)] hidden h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] md:inline-flex">
                  {step.id === 'keys' ? <KeyRound size={18} /> : step.id === 'survey' || step.id === 'simulate' ? <ShipWheel size={18} /> : <CheckCircle2 size={18} />}
                </div>
              </div>

              <div className="grid gap-[var(--space-3)]">
                <PanelTitle as="h3" size="card" className="max-w-[18ch]">
                  {step.title}
                </PanelTitle>
                <PanelBody className="max-w-[44rem]">
                  {step.description}
                </PanelBody>
                <div className="inline-flex items-center gap-[var(--space-2)] text-[var(--brand-primary)]">
                  <ArrowRight size={16} />
                  <PanelEyebrow className="text-[var(--brand-primary)]">{step.appSurface}</PanelEyebrow>
                </div>
              </div>

              <SurfacePanel elevation="quiet" padding="compact" className="grid content-center gap-[var(--space-2)]">
                <PanelEyebrow>App surface</PanelEyebrow>
                <PanelBody size="compact" className="max-w-none">
                  {step.appSurface} The terminal can execute setup work, but the human-facing
                  cold-start path should stay in FleetBar, <RoleTerm role="shipwright">Shipwright</RoleTerm>,
                  Flow, Agents, Resources, and YAML.
                </PanelBody>
              </SurfacePanel>
            </article>
          ))}
        </div>
      </PageContainer>
    </section>
  )
}
