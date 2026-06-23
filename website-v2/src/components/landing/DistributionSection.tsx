import { Download, FileText, Github, MonitorCheck, PackageCheck, ShieldAlert } from 'lucide-react'
import { DISTRIBUTION_OPTIONS } from '@/data/product'
import { Button } from '@/components/ui/Button'
import { useTheme } from '@/lib/theme-context'
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

const primaryDownloadHref = '/downloads/PortDaddy-FleetBar-macOS-arm64.zip'
const checksumHref = '/downloads/PortDaddy-FleetBar-macOS-arm64.zip.sha256'
const manifestHref = '/downloads/fleetbar-preview-manifest.json'
const fleetbarNativeShellScreenshots = {
  light: '/img/app-screens/fleetbar-native-shell-light.webp',
  dark: '/img/app-screens/fleetbar-native-shell-dark.webp',
} as const

const statusCopy = {
  available: 'Available',
  'signed-build': 'Signed Mac build',
  'release-channel': 'Release channel',
} as const

const distributionOperatorCopy = {
  brew: 'Use the setup guide for the agent-side install command. FleetBar is the human checkpoint for daemon health, MCP wiring, and project readiness after setup runs.',
  npm: 'Use npm when the CLI and daemon are the installation target. The operator still verifies readiness from the app, not from a pasted prompt.',
  'release-artifacts': 'Use GitHub release artifacts when you need provenance. Checksums, manifests, and release notes carry the proof instead of a homepage command card.',
} as const

const distributionDisplayTitle = {
  brew: 'Guided setup path',
  npm: 'npm package',
  'release-artifacts': 'GitHub release artifacts',
} as const

const downloadFacts = [
  ['Artifact', 'PortDaddy-FleetBar-macOS-arm64.zip'],
  ['Contains', 'FleetBar.app, the native Mac menu-bar shell for Fleet Control Center'],
  ['Platform', 'Apple Silicon Mac, macOS 14 or newer'],
  ['Signature', 'Developer ID Application: Curiositech LLC'],
  ['Notarization', 'Not stapled yet; macOS may require Open Anyway'],
] as const

const downloadSteps = [
  'Download the FleetBar ZIP.',
  'Download the SHA-256 file or manifest if you want provenance before opening it.',
  'Run shasum -a 256 -c PortDaddy-FleetBar-macOS-arm64.zip.sha256 from the folder that contains both files.',
  'Unzip the archive and move FleetBar.app to Applications.',
  'Open FleetBar from Finder. Until notarization is stapled, macOS may ask you to confirm the Developer ID build.',
  'Use Homebrew or npm setup for the daemon, CLI, MCP server, and project onboarding; the ZIP is the Mac operator surface.',
] as const

export function DistributionSection() {
  const primary = DISTRIBUTION_OPTIONS[0]
  const remaining = DISTRIBUTION_OPTIONS.slice(1)
  const { theme } = useTheme()
  const shellScreenshot = theme === 'dark' ? fleetbarNativeShellScreenshots.dark : fleetbarNativeShellScreenshots.light

  return (
    <section
      id="download"
      className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]"
    >
      <PageContainer width="wide">
        <SwissGrid className="items-start">
          <SwissGridItem span="narrow">
            <SectionIntro
              eyebrow="Mac Preview download"
              title="Know what the ZIP is before you open it."
              description="This is a real FleetBar.app preview for Apple Silicon Macs. It is the native operator surface for an existing Port Daddy install, not a replacement for the daemon, CLI, MCP server, or project setup."
              titleAs="h2"
              titleSize="display"
              titleClassName="max-w-[12ch]"
              bodyClassName="max-w-[42rem]"
            />

            <div className="mt-[var(--space-5)] flex flex-wrap gap-[var(--space-3)]">
              <Button asChild variant="primary" size="lg">
                <a href={primaryDownloadHref} download>
                  <Download size={16} />
                  Download FleetBar
                </a>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <a href={checksumHref}>
                  <PackageCheck size={16} />
                  SHA-256
                </a>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <a href={manifestHref}>
                  <FileText size={16} />
                  Manifest
                </a>
              </Button>
            </div>
            <figure className="mt-[var(--space-5)] block overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
              <img
                src={shellScreenshot}
                alt="FleetBar macOS app in a native window shell"
                className="aspect-[16/9] w-full object-cover"
                data-theme-screenshot={theme === 'dark' ? 'dark' : 'light'}
                loading="lazy"
              />
            </figure>
          </SwissGridItem>

          <SwissGridItem span="wide">
            <div className="grid gap-[var(--space-4)]">
              <SurfacePanel elevation="quiet" className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1fr)]">
                <div className="grid content-start gap-[var(--space-3)]">
                  <PanelEyebrow>What downloads</PanelEyebrow>
                  <PanelTitle as="h3" size="card" className="max-w-[16ch]">
                    A FleetBar app preview, not the whole Port Daddy runtime.
                  </PanelTitle>
                  <PanelBody className="max-w-[38rem]">
                    FleetBar embeds the Fleet Control Center so a human can inspect daemon health,
                    projects, agents, resources, inboxes, sorties, Shipwright, and backend readiness
                    from the Mac menu bar. The app expects the Port Daddy runtime to be installed
                    separately through the normal setup path.
                  </PanelBody>
                </div>

                <dl className="grid gap-[var(--space-2)]">
                  {downloadFacts.map(([label, value]) => (
                    <div
                      key={label}
                      className="grid gap-[var(--space-2)] border-t-2 border-[var(--border-default)] pt-[var(--space-2)] sm:grid-cols-[9rem_minmax(0,1fr)]"
                    >
                      <dt className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                        {label}
                      </dt>
                      <dd className="font-sans text-[length:var(--text-sm)] font-semibold leading-snug text-[var(--text-primary)]">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </SurfacePanel>

              <SurfacePanel tone="blue" className="grid gap-[var(--space-4)] md:grid-cols-[minmax(0,1fr)_minmax(260px,0.72fr)]">
                <div className="grid gap-[var(--space-3)]">
                  <PanelEyebrow tone="primary">{statusCopy[primary.status]}</PanelEyebrow>
                  <PanelTitle as="h3" size="card" tone="primary" className="max-w-[18ch]">
                    {primary.title}
                  </PanelTitle>
                  <PanelBody tone="primary" className="max-w-[42rem]">
                    {primary.description}
                  </PanelBody>
                  <div className="inline-flex items-start gap-[var(--space-2)] border-t border-[color:var(--brand-primary-foreground-subtle)] pt-[var(--space-3)]">
                    <ShieldAlert className="mt-0.5 shrink-0" size={16} />
                    <PanelBody tone="primary" size="compact" className="max-w-none">
                      The preview is rebuilt by scripts/package-fleetbar-preview.sh, Developer ID
                      signed when the Curiositech certificate is present, checksummed, and described
                      by the public manifest. The remaining release gate is accepted notarization,
                      so macOS may still require Open Anyway until that artifact is regenerated.
                    </PanelBody>
                  </div>
                </div>
                <div className="grid content-start gap-[var(--space-3)] border-l-2 border-[color:var(--brand-primary-foreground-subtle)] pl-[var(--space-4)]">
                  <PanelEyebrow tone="primary">Human path</PanelEyebrow>
                  <PanelBody tone="primary" size="compact" className="max-w-none">
                    Download FleetBar, inspect the manifest or checksum, then open the Mac app to
                    choose a project, verify readiness, and continue in the GUI. Agent-side install
                    commands live in docs where output is shown with context.
                  </PanelBody>
                  <div className="flex items-center gap-[var(--space-2)] text-[var(--brand-primary-foreground)]">
                    <MonitorCheck size={16} />
                    <PanelEyebrow tone="primary">No input-only terminal card</PanelEyebrow>
                  </div>
                </div>
              </SurfacePanel>

              <SurfacePanel elevation="quiet" className="grid gap-[var(--space-4)]">
                <div className="grid gap-[var(--space-2)]">
                  <PanelEyebrow>How to open it</PanelEyebrow>
                  <PanelTitle as="h3" size="card" className="max-w-[18ch]">
                    The short path is download, verify, unzip, open.
                  </PanelTitle>
                </div>
                <ol className="grid gap-[var(--space-3)] md:grid-cols-2">
                  {downloadSteps.map((step, index) => (
                    <li
                      key={step}
                      className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-[var(--space-3)] border-t-2 border-[var(--border-default)] pt-[var(--space-3)]"
                    >
                      <span className="inline-flex h-8 w-8 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-base)] font-mono text-[length:var(--type-meta-size)] font-black text-[var(--text-primary)]">
                        {index + 1}
                      </span>
                      <PanelBody size="compact" className="max-w-none">
                        {step}
                      </PanelBody>
                    </li>
                  ))}
                </ol>
              </SurfacePanel>

              <div className="grid gap-[var(--space-4)] md:grid-cols-3">
                {remaining.map((option) => (
                  <SurfacePanel key={option.id} elevation="quiet" padding="compact" className="grid gap-[var(--space-3)]">
                    <div className="flex items-start justify-between gap-[var(--space-3)]">
                      <div>
                        <PanelEyebrow>{statusCopy[option.status]}</PanelEyebrow>
                        <PanelTitle as="h3" size="nav" className="mt-[var(--space-2)] max-w-[16ch]">
                          {distributionDisplayTitle[option.id as keyof typeof distributionDisplayTitle]}
                        </PanelTitle>
                      </div>
                      {option.id === 'release-artifacts' ? <Github size={18} /> : <PackageCheck size={18} />}
                    </div>
                    <PanelBody size="compact" className="max-w-none">
                      {option.description}
                    </PanelBody>
                    <div className="border-t-2 border-[var(--border-subtle)] pt-[var(--space-3)]">
                      <PanelEyebrow>Operator note</PanelEyebrow>
                      <PanelBody size="compact" className="mt-[var(--space-2)] max-w-none">
                        {distributionOperatorCopy[option.id as keyof typeof distributionOperatorCopy]}
                      </PanelBody>
                    </div>
                  </SurfacePanel>
                ))}
              </div>
            </div>
          </SwissGridItem>
        </SwissGrid>
      </PageContainer>
    </section>
  )
}
