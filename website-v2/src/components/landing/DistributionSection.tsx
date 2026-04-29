import { Download, FileText, Github, PackageCheck, ShieldAlert, Terminal } from 'lucide-react'
import { DISTRIBUTION_OPTIONS } from '@/data/product'
import { Button } from '@/components/ui/Button'
import { useTheme } from '@/lib/theme-context'
import {
  CopyableCommandBlock,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
  SwissGrid,
  SwissGridItem,
} from '@/components/site/primitives'

const primaryDownloadHref = '/downloads/PortDaddy-FleetBar-macOS-arm64-dev.zip'
const checksumHref = '/downloads/PortDaddy-FleetBar-macOS-arm64-dev.zip.sha256'
const manifestHref = '/downloads/fleetbar-preview-manifest.json'
const fleetbarNativeShellScreenshots = {
  light: '/img/app-screens/fleetbar-native-shell-light.png',
  dark: '/img/app-screens/fleetbar-native-shell-dark.png',
} as const

const statusCopy = {
  available: 'Available',
  'developer-preview': 'Developer preview',
  'release-channel': 'Release channel',
} as const

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
              eyebrow="Download"
              title="A Mac developer can try FleetBar today."
              description="The download is a real FleetBar.app ZIP for Apple Silicon Macs, generated from the Swift source by npm run package:fleetbar-preview. The stable install path is still Homebrew or npm, because the daemon, MCP wiring, CLI, and project onboarding live there."
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
                alt="FleetBar macOS developer preview in a native window shell"
                className="aspect-[16/9] w-full object-cover"
                data-theme-screenshot={theme === 'dark' ? 'dark' : 'light'}
                loading="lazy"
              />
            </figure>
          </SwissGridItem>

          <SwissGridItem span="wide">
            <div className="grid gap-[var(--space-4)]">
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
                      The preview is rebuilt by scripts/package-fleetbar-preview.sh, ad-hoc signed,
                      checksummed, and described by the public manifest. The next release gate is a
                      Developer ID Application certificate plus notarization, so macOS may require
                      Open Anyway until that artifact is regenerated.
                    </PanelBody>
                  </div>
                </div>
                <CopyableCommandBlock command={primary.command} />
              </SurfacePanel>

              <div className="grid gap-[var(--space-4)] md:grid-cols-3">
                {remaining.map((option) => (
                  <SurfacePanel key={option.id} elevation="quiet" padding="compact" className="grid gap-[var(--space-3)]">
                    <div className="flex items-start justify-between gap-[var(--space-3)]">
                      <div>
                        <PanelEyebrow>{statusCopy[option.status]}</PanelEyebrow>
                        <PanelTitle as="h3" size="nav" className="mt-[var(--space-2)] max-w-[16ch]">
                          {option.title}
                        </PanelTitle>
                      </div>
                      {option.id === 'release-artifacts' ? <Github size={18} /> : <Terminal size={18} />}
                    </div>
                    <PanelBody size="compact" className="max-w-none">
                      {option.description}
                    </PanelBody>
                    <CopyableCommandBlock command={option.command} />
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
