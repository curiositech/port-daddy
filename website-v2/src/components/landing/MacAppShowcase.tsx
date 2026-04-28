import { MonitorCog, RadioTower, ShieldCheck, WalletCards } from 'lucide-react'
import {
  APP_SURFACES,
  MAC_APP_CAPABILITIES,
  type AppSurface,
  type MacAppCapability,
} from '@/data/product'
import {
  BracketLabel,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
  SwissGrid,
  SwissGridItem,
} from '@/components/site/primitives'

const capabilityIcons = [MonitorCog, RadioTower, ShieldCheck, WalletCards] as const

function CapabilityRow({
  capability,
  index,
}: {
  capability: MacAppCapability
  index: number
}) {
  const Icon = capabilityIcons[index % capabilityIcons.length]

  return (
    <article className="grid gap-[var(--space-4)] border-t-2 border-[var(--border-strong)] py-[var(--space-5)] md:grid-cols-[4.5rem_minmax(0,1fr)]">
      <div className="flex items-start gap-[var(--space-3)] md:flex-col">
        <span className="font-mono text-[length:var(--type-panel-title-nav-size)] font-black text-[var(--brand-primary)]">
          {capability.label}
        </span>
        <span className="inline-flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-primary)]">
          <Icon size={18} />
        </span>
      </div>
      <div className="grid gap-[var(--space-3)]">
        <PanelTitle as="h3" size="card" className="max-w-[18ch]">
          {capability.title}
        </PanelTitle>
        <PanelBody className="max-w-[42rem]">
          {capability.description}
        </PanelBody>
        <PanelBody size="compact" className="max-w-[42rem] text-[var(--text-muted)]">
          {capability.proof}
        </PanelBody>
      </div>
    </article>
  )
}

function SurfaceTile({ appSurface, featured = false }: { appSurface: AppSurface; featured?: boolean }) {
  return (
    <article
      className={[
        'min-w-0 border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]',
        featured ? 'lg:col-span-8' : 'lg:col-span-4',
      ].join(' ')}
    >
      <div className="border-b-2 border-[var(--border-strong)] p-[var(--space-3)]">
        <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
          <PanelEyebrow>{appSurface.surface}</PanelEyebrow>
          <BracketLabel>{appSurface.id}</BracketLabel>
        </div>
      </div>
      <div className="grid aspect-[16/10] content-between border-b-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)]">
        <div className="flex items-center justify-between border-b-2 border-[var(--border-strong)] pb-[var(--space-3)]">
          <span className="font-mono text-[10px] font-black uppercase tracking-[0.22em] text-[var(--text-secondary)]">
            {appSurface.surface}
          </span>
          <span className="h-3 w-3 border-2 border-[var(--border-strong)] bg-[var(--brand-primary)]" aria-hidden="true" />
        </div>
        <PanelTitle as="p" size={featured ? 'card' : 'nav'} className="max-w-[14ch]">
          {appSurface.title}
        </PanelTitle>
      </div>
      <div className="grid gap-[var(--space-2)] p-[var(--space-4)]">
        <PanelTitle as="h3" size="nav" className="max-w-none">
          {appSurface.title}
        </PanelTitle>
        <PanelBody size="compact" className="max-w-none">
          {appSurface.caption}
        </PanelBody>
      </div>
    </article>
  )
}

export function MacAppShowcase() {
  const [firstSurface, ...surfaces] = APP_SURFACES

  return (
    <section id="mac-app" className="border-t-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      <PageContainer width="wide">
        <SwissGrid className="items-start">
          <SwissGridItem span="narrow">
            <div className="sticky top-28 space-y-[var(--space-5)]">
              <SectionIntro
                eyebrow="Mac app"
                title="FleetBar is now the front door."
                description="The native app is not a toy launcher. It is the compact Mac entrance to the daemon, the Fleet Control Center, project fleets, sortie work, Shipwright proposals, and machine-pressure governance."
                titleAs="h2"
                titleSize="display"
                titleClassName="max-w-[12ch]"
              />
              <SurfacePanel elevation="quiet" padding="compact" className="grid gap-[var(--space-2)]">
                <PanelEyebrow>Current distribution stance</PanelEyebrow>
                <PanelBody size="compact" className="max-w-none">
                  Homebrew and npm remain the install path for Port Daddy. The website now also hosts a Mac developer-preview FleetBar app bundle while the signed release channel matures.
                </PanelBody>
              </SurfacePanel>
            </div>
          </SwissGridItem>

          <SwissGridItem span="wide">
            <div className="grid gap-[var(--space-6)]">
              <div className="grid">
                {MAC_APP_CAPABILITIES.map((capability, index) => (
                  <CapabilityRow capability={capability} index={index} key={capability.id} />
                ))}
              </div>

              <div className="grid gap-[var(--space-4)] lg:grid-cols-12">
                <SurfaceTile appSurface={firstSurface} featured />
                {surfaces.map((appSurface) => (
                  <SurfaceTile appSurface={appSurface} key={appSurface.id} />
                ))}
              </div>
            </div>
          </SwissGridItem>
        </SwissGrid>
      </PageContainer>
    </section>
  )
}
