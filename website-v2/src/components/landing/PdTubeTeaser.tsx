import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
} from '@/components/site/primitives'
import { CodeBlock } from '@/components/ui/CodeBlock'

/**
 * Compact IA-audit replacement for TubeShowcase + TubeMultiplexSection
 * (2026-08-04 home-page IA pass). Those two sections were a single-feature
 * deep dive followed immediately by its own follow-on deep dive — video,
 * GIF, a live fan-out widget, three behavior cards, six "senders" cards —
 * running well over 4,000px combined on mobile, for a feature that already
 * has a full interactive treatment at /pd-tube (playground) and a written
 * walkthrough at /tutorials/pd-tube. This teaser follows the
 * CliBackendValueProp shape: one claim, real proof, one link to the deep
 * page instead of restaging the whole page inline.
 *
 * TubeShowcase.tsx and TubeMultiplexSection.tsx stay on disk unrendered
 * (see App.tsx) — design-system-contracts.test.ts pins TubeShowcase.tsx's
 * filename and Tailwind spacing-token usage, so it is left untouched rather
 * than deleted; TubeMultiplexSection.tsx is not pinned but is kept for the
 * same reason (its content already lives at /pd-tube's playground demos).
 */
export function PdTubeTeaser() {
  return (
    <section
      id="pd-tube"
      className="border-t-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]"
    >
      <PageContainer width="wide">
        <SurfacePanel className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="space-y-[var(--space-5)]">
            <PanelEyebrow>pd tube</PanelEyebrow>
            <PanelTitle as="h2" size="display" className="max-w-[18ch]">
              One command turns any button, hook, or webhook into a message your agent answers.
            </PanelTitle>
            <PanelBody className="max-w-[46rem]">
              There is no SDK and no server to run. The sender uses plain <code>fetch()</code>. The agent
              runs <code>pd tube</code>, waits, replies, and keeps listening — all in one shell call, over
              the same channels Port Daddy already ships. Point several agents at one channel and every
              listener gets every message.
            </PanelBody>
            <div className="flex flex-wrap gap-[var(--space-3)] pt-[var(--space-2)]">
              <Link
                to="/pd-tube"
                className="group inline-flex items-center gap-2 border-2 border-[var(--border-strong)] bg-[var(--text-primary)] px-[var(--space-4)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--surface-base)] no-underline transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)]"
              >
                Open the live playground
                <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                to="/tutorials/pd-tube"
                className="inline-flex items-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-[var(--space-4)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] no-underline transition-colors hover:bg-[var(--surface-raised)]"
              >
                Walk the tutorial
              </Link>
            </div>
          </div>

          <SurfacePanel elevation="quiet" padding="compact" className="overflow-hidden">
            <PanelEyebrow className="mb-[var(--space-2)]">Real terminal output</PanelEyebrow>
            <CodeBlock language="bash" filename="agent terminal" copyable={false}>
              {`$ pd tube ui:clicks
tube waiting on ui:clicks (up to 600s; Ctrl+C to exit)

──── event id=42 · channel ui:clicks ────
Body: {"button":"deploy-staging","user":"erich"}

Act on the event, then reply:
    pd tube ui:clicks --reply "your response here"
──────────────────────────────────────`}
            </CodeBlock>
          </SurfacePanel>
        </SurfacePanel>
      </PageContainer>
    </section>
  )
}
