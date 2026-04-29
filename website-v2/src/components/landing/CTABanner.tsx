import { Download, Github, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  CommandBlock,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
  SwissGrid,
  SwissGridItem,
} from '@/components/site/primitives'

export function CTABanner() {
  return (
    <section className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-base)] py-[var(--space-8)] lg:py-[var(--section-space-y)]">
      <PageContainer width="wide">
        <SwissGrid className="items-end">
          <SwissGridItem span="wide">
            <div className="space-y-[var(--space-4)]">
              <PanelEyebrow>Developer preview</PanelEyebrow>
              <PanelTitle as="h2" size="display" className="max-w-[13ch]">
                Install the agent communication layer, then open it from FleetBar.
              </PanelTitle>
              <PanelBody className="max-w-[42rem]">
                Port Daddy is still open-source infrastructure. The difference now is that the Mac app, Fleet Control Center, Shipwright, sorties, resource governance, backend readiness, and agent-to-agent handoffs are the product surface, not a hidden terminal story.
              </PanelBody>
              <div className="flex flex-wrap gap-[var(--space-3)]">
                <Button asChild variant="primary" size="lg">
                  <a href="/downloads/PortDaddy-FleetBar-macOS-arm64-dev.zip" download>
                    <Download size={16} />
                    FleetBar preview
                  </a>
                </Button>
                <Button asChild variant="secondary" size="lg">
                  <a href="https://github.com/curiositech/port-daddy" target="_blank" rel="noreferrer">
                    <Github size={16} />
                    GitHub
                  </a>
                </Button>
              </div>
            </div>
          </SwissGridItem>

          <SwissGridItem span="rail">
            <SurfacePanel elevation="quiet" padding="compact" className="grid gap-[var(--space-3)]">
              <div className="inline-flex items-center gap-[var(--space-2)]">
                <Terminal size={16} />
                <PanelEyebrow>Stable install</PanelEyebrow>
              </div>
              <CommandBlock
                title="Install + setup"
                command={'brew install curiositech/tap/port-daddy\npd setup --project ~/coding/my-app'}
                elevation="quiet"
                label="Copy"
              />
            </SurfacePanel>
          </SwissGridItem>
        </SwissGrid>
      </PageContainer>
    </section>
  )
}
