import { Link } from 'react-router-dom'
import { ArrowRight, Download, FileText, Github, Terminal } from 'lucide-react'
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
import { WHITE_PAPERS } from '@/data/whitePapers'

const COORDINATION_FEEDBACK = [
  'The paper assets and /whitepaper route were still alive; the homepage rewrite had buried the entry point.',
  'Port Daddy showed the hero and app shell were already claimed, so this restore stayed in the CTA and dossier route.',
  'Live render proof caught the header clipping Whitepaper to WHITE; the nav now points to Papers without hiding the route.',
] as const

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
              <div className="grid gap-[var(--space-3)] md:grid-cols-2">
                {WHITE_PAPERS.map((paper) => (
                  <article
                    key={paper.title}
                    className="grid content-between gap-[var(--space-4)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)]"
                  >
                    <div className="grid gap-[var(--space-3)]">
                      <div className="flex items-center justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-default)] pb-[var(--space-3)]">
                        <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                          {paper.order}
                        </span>
                        <FileText aria-hidden="true" size={16} className="text-[var(--brand-primary)]" />
                      </div>
                      <div className="space-y-[var(--space-2)]">
                        <h3 className="font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] tracking-[var(--tracking-display-nav)] text-[var(--text-primary)]">
                          {paper.title}
                        </h3>
                        <p className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                          {paper.explainerLead}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-[var(--space-2)]">
                      <Link
                        to={paper.readerHref}
                        className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--text-primary)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-inverse)] transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                      >
                        Read inline
                        <ArrowRight aria-hidden="true" size={14} />
                      </Link>
                      <a
                        href={paper.pdfPath}
                        className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                      >
                        PDF
                        <Download aria-hidden="true" size={14} />
                      </a>
                    </div>
                  </article>
                ))}
              </div>
              <div className="grid gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)]">
                <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-default)] pb-[var(--space-3)]">
                  <PanelEyebrow>Coordination feedback</PanelEyebrow>
                  <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                    Dogfood restore
                  </span>
                </div>
                <PanelBody className="max-w-[44rem]">
                  This restore used Port Daddy as the coordination layer: inspect live ownership, avoid contested hero/App edits, then put both papers back where a visitor can actually find them.
                </PanelBody>
                <ul className="grid gap-[var(--space-2)]">
                  {COORDINATION_FEEDBACK.map((item) => (
                    <li
                      key={item}
                      className="flex gap-[var(--space-2)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]"
                    >
                      <span className="shrink-0 font-mono font-black text-[var(--brand-primary)]">-</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap gap-[var(--space-3)]">
                <Button asChild variant="primary" size="lg">
                  <a href="/downloads/PortDaddy-FleetBar-macOS-arm64-dev.zip" download>
                    <Download size={16} />
                    FleetBar preview
                  </a>
                </Button>
                <Button asChild variant="secondary" size="lg">
                  <Link to="/whitepaper">
                    <FileText size={16} />
                    Read both papers
                  </Link>
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
