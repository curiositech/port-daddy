import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
} from '@/components/site/primitives'

/**
 * Landing value-prop tile for the CLI backend pitch.
 * The operator's exact framing: your $20/mo Pro or $200/mo Max
 * powers the entire fleet at zero marginal cost. Lives between
 * the hero and the deeper sections; links to /cli-backend for
 * the full pitch.
 */
export function CliBackendValueProp() {
  return (
    <section
      id="cli-backend"
      className="border-t-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]"
    >
      <PageContainer width="wide">
        <SurfacePanel className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="space-y-[var(--space-5)]">
            <PanelTitle as="h2" size="display" className="max-w-[18ch]">
              Your AI subscription already pays for the fleet.
            </PanelTitle>
            <PanelBody className="max-w-[44rem]">
              Bring your Claude Max or ChatGPT Pro login.{' '}
              <strong className="text-[var(--text-primary)]">
                Every agent in the fleet runs on that one seat — no metered API bill.
              </strong>{' '}
              Same login, same model. More hours of work per day. Switching a backend
              on is one environment variable.
            </PanelBody>
            <div className="grid gap-[var(--space-3)] sm:grid-cols-3">
              <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-3)]">
                <PanelEyebrow>Marginal cost</PanelEyebrow>
                <p className="font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] text-[var(--brand-primary)]">
                  $0.00
                </p>
                <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
                  per spawn, on the seat you already pay for
                </p>
              </div>
              <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-3)]">
                <PanelEyebrow>Setup time</PanelEyebrow>
                <p className="font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] text-[var(--brand-primary)]">
                  2 min
                </p>
                <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
                  brew install, one env var, fleet up
                </p>
              </div>
              <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-3)]">
                <PanelEyebrow>Backends</PanelEyebrow>
                <p className="font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] text-[var(--brand-primary)]">
                  claude-cli · codex
                </p>
                <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
                  first-class; Cloudflare and direct API are fallbacks
                </p>
              </div>
            </div>
            <div className="pt-[var(--space-2)]">
              <Link
                to="/cli-backend"
                className="group inline-flex items-center gap-2 border-2 border-[var(--border-strong)] bg-[var(--text-primary)] px-[var(--space-4)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--surface-base)] no-underline transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)]"
              >
                Read the pitch
                <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>

          <div className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
            <img
              src="/img/generated/cli-backend-hero.webp"
              alt="Blueprint illustration of a single AI subscription card distributing pipelines to a fleet of small sailing ships, each labeled with a Port Daddy fleet agent name."
              className="block h-full w-full object-cover"
              loading="lazy"
            />
          </div>
        </SurfacePanel>
      </PageContainer>
    </section>
  )
}
