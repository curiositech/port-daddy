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
 * Compact IA-audit replacement for CoordinationEnforcementSection +
 * AgentConversationSection (2026-08-04 home-page IA pass). Those two
 * sections together ran ~1,800px of stacked cards making the same claim
 * three different ways: notes, claims, and the commit guard are visible in
 * the app instead of buried in chat history. The Features grid already
 * carries "agent-radio", "shared-coordination", and "coordination-guard" as
 * compact cards with a click-through detail dialog, and
 * /docs/best-practices/coordination-discipline and /tutorials/multi-agent
 * carry the full depth. This teaser follows the same shape as
 * CliBackendValueProp: one claim, one proof stat row, one link out.
 *
 * CoordinationEnforcementSection.tsx and AgentConversationSection.tsx stay
 * on disk unrendered (see App.tsx) — design-system-contracts.test.ts pins
 * their filenames and Tailwind spacing-token usage, so they are left
 * untouched rather than deleted.
 */
export function CoordinationTeaser() {
  return (
    <section
      id="coordination"
      className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]"
    >
      <PageContainer width="wide">
        <SurfacePanel className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="space-y-[var(--space-5)]">
            <PanelEyebrow>Your control panel</PanelEyebrow>
            <PanelTitle as="h2" size="display" className="max-w-[20ch]">
              Claims, notes, and a commit guard you can see, not chat history you have to scroll back through.
            </PanelTitle>
            <PanelBody className="max-w-[46rem]">
              Agents claim the files they are about to edit and leave notes the next agent can read. The
              guard checks staged files against the active session and blocks the commit when something
              is not claimed. FleetBar and the Fleet Control Center show all of it before you let more
              automation loose.
            </PanelBody>
            <div className="grid gap-[var(--space-3)] sm:grid-cols-3">
              <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-3)]">
                <PanelEyebrow>Claims</PanelEyebrow>
                <p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                  See who is editing what before anyone starts writing
                </p>
              </div>
              <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-3)]">
                <PanelEyebrow>Notes</PanelEyebrow>
                <p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                  Each agent writes down what it proved before it stops
                </p>
              </div>
              <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-3)]">
                <PanelEyebrow>Commit guard</PanelEyebrow>
                <p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                  Fails closed on staged files with no active claim
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-[var(--space-3)] pt-[var(--space-2)]">
              <Link
                to="/docs/best-practices/coordination-discipline"
                className="group inline-flex items-center gap-2 border-2 border-[var(--border-strong)] bg-[var(--text-primary)] px-[var(--space-4)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--surface-base)] no-underline transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)]"
              >
                Coordination discipline
                <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                to="/tutorials/multi-agent"
                className="inline-flex items-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-[var(--space-4)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] no-underline transition-colors hover:bg-[var(--surface-raised)]"
              >
                Multi-agent tutorial
              </Link>
            </div>
          </div>

          <div className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
            <img
              src="/img/generated/coordination-guard.webp"
              alt="Abstract coordination guard diagram showing claims, locks, notes, and guard rails"
              className="block h-full w-full object-cover"
              loading="lazy"
            />
          </div>
        </SurfacePanel>
      </PageContainer>
    </section>
  )
}
