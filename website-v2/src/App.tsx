import './App.css'
import { LibraryBanner } from '@/components/landing/LibraryBanner'
import { Hero } from '@/components/landing/Hero'
import { ScopeLadderSection } from '@/components/landing/ScopeLadderSection'
import { CliBackendValueProp } from '@/components/landing/CliBackendValueProp'
import { CoordinationTeaser } from '@/components/landing/CoordinationTeaser'
import { PdTubeTeaser } from '@/components/landing/PdTubeTeaser'
import { AgenticSocialProofSection } from '@/components/landing/AgenticSocialProofSection'
import { Features } from '@/components/landing/Features'
import { TerminalDemos } from '@/components/landing/TerminalDemos'
import { CTABanner } from '@/components/landing/CTABanner'
import { Footer } from '@/components/layout/Footer'

export default function App() {
  return (
    <div className="min-h-screen bg-[var(--surface-base)] selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]">
      <main id="main-content">
        {/*
          IA order rationale (2026-08-04 IA pass — see the session report
          for the full section-by-section audit). The home page was a
          ~38,000px scroll at 390px width: several sections pitched the
          same claim twice (a coordination-guard deep dive AND a separate
          agent-communication deep dive; a pd-tube deep dive immediately
          followed by its own fan-out follow-on deep dive; two back-to-back
          "install Port Daddy" CTAs with duplicate brew instructions). This
          order scans in one or two screens of intent, with depth reachable
          by link instead of by scroll. LibraryBanner (2026-08-27 add) sits
          outside this numbering on purpose — it's a thin signage strip
          below the nav, not a content section, naming and linking the two
          seven-part collections (the Book, the standalone papers) that neither the
          home page nor — until the 2026-08-26 /library fix — the library
          page itself ever distinguished by name:
            1. Hero                    — what is this, why should I care
            2. ScopeLadderSection      — the one-idea-four-scales framing,
                                         links to the Harbor Library for
                                         the full argument
            3. CliBackendValueProp     — the subscription-reuse pitch,
                                         already a compact teaser + link to
                                         /cli-backend (kept as the pattern
                                         every other teaser below follows)
            4. TerminalDemos           — prove it's real with actual daemon
                                         output, before more scaffolding
            5. CoordinationTeaser      — NEW, replaces
                                         CoordinationEnforcementSection +
                                         AgentConversationSection (~1,800px
                                         of stacked cards making the same
                                         "claims and notes are visible in
                                         the app" claim three times). Links
                                         to /docs/best-practices/
                                         coordination-discipline and
                                         /tutorials/multi-agent, both of
                                         which already carry the full depth.
            6. PdTubeTeaser            — NEW, replaces TubeShowcase +
                                         TubeMultiplexSection (~4,000px+ of
                                         video, GIF, a live fan-out widget,
                                         and nine cards, for a feature that
                                         already has a full interactive
                                         playground at /pd-tube and a
                                         written walkthrough at
                                         /tutorials/pd-tube).
            7. AgenticSocialProofSection — quotes, already lean from the
                                         2026-05-20 audit
            8. Features                — the product catalog; every card
                                         already does the "compact summary
                                         + click for depth" job that the
                                         cut sections were duplicating
                                         inline
          InstallCTASection is no longer rendered here: it duplicated
          CTABanner's brew/pd-setup install instructions and FleetBar
          proof back-to-back, which left two primary CTAs on one page.
          CTABanner is the one install CTA (public-shell-contracts.test.ts
          pins '<CTABanner />' in this file). InstallCTASection.tsx,
          CoordinationEnforcementSection.tsx, AgentConversationSection.tsx,
          TubeShowcase.tsx, and TubeMultiplexSection.tsx are left on disk
          untouched rather than deleted: design-system-contracts.test.ts
          and mac-install-contract.test.ts pin filenames and literal
          strings inside several of them, and this codebase already keeps
          a number of retired-but-undeleted landing components in this
          directory (ColdStartSection, DemoGallery, HowItWorks, and others
          predate this pass and were never wired into App.tsx either).
        */}
        <LibraryBanner />
        <Hero />
        <ScopeLadderSection />
        <CliBackendValueProp />
        <TerminalDemos />
        <CoordinationTeaser />
        <PdTubeTeaser />
        <AgenticSocialProofSection />
        <Features />
      </main>

      <CTABanner />
      <Footer />
    </div>
  )
}
