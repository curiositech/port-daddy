# Website Design-System Normalization Todo

Last updated: 2026-04-18

## Current Session Tasks

- [x] Expand the shared tutorial content rail so mid-lesson modules use the available page width instead of collapsing into a narrow article tube.
- [x] Recompose the active `GettingStarted` lesson so steps 2 and 3 can sit in the same row when the viewport supports it.
- [x] Refresh guardrails for the widened tutorial shell and rerun focused validation.
- [x] Refactor `src/pages/tutorials/Fleet.tsx` off legacy low-contrast `Surface`/`Badge` stacks and onto shared high-contrast public primitives.
- [x] Add Fleet-specific guardrails, rerun focused validation, and verify the contrast fix on localhost.
- [x] Remove `/dashboard` from public site chrome and docs shortcuts so the hosted website stops advertising a fake live daemon surface.
- [x] Replace `src/pages/DashboardPage.tsx` with a factual local-control-plane access page instead of fabricated telemetry.
- [ ] Capture the replacement `/dashboard` page locally and record the validation result.

## Previous Session Tasks

- [x] Audit token/component drift and catalog the concrete normalization work.
- [x] Fix token-scale debt and replace undefined spacing references with real semantic layout tokens.
- [x] Define canonical website layout primitives for shared page containers and section intros.
- [x] Refactor `Hero`, `Features`, and `TerminalDemos` onto the normalized primitives and tokens.
- [x] Refactor legacy docs detail surfaces onto shared primitives (`CommandPage`, `SdkFunctionPage`).
- [x] Expand Storybook coverage for the normalized website primitives.
- [x] Add contract coverage for the normalized design system.
- [x] Run focused validation and record the results.

## Audit Findings

- The token layer in `src/styles/tokens.css` is the strongest part of the system, but it is not yet fully authoritative.
- `src/index.css` references undefined spacing tokens (`--space-12`, `--space-20`).
- `src/components/ui/Surface.tsx` exposes a `padding="xl"` size that also maps to undefined `--space-12`.
- The docs shell in `src/components/site/primitives.tsx` is the most normalized component surface in the repo.
- The preserved landing still uses ad hoc section wrappers, typography, spacing, and inline visual decisions in:
  - `src/components/landing/Hero.tsx`
  - `src/components/landing/Features.tsx`
  - `src/components/landing/TerminalDemos.tsx`
- Legacy docs detail surfaces still maintain a parallel page-chrome language in:
  - `src/components/docs/CommandPage.tsx`
  - `src/components/docs/SdkFunctionPage.tsx`

## Completed In This Session

- Replaced all undefined `--space-12` / `--space-20` references with semantic spacing tokens.
- Added semantic layout tokens for:
  - shared page widths
  - shared page gutters
  - shared section spacing
  - oversized surface padding
  - long-form blog section spacing
- Updated `Surface` so `padding="xl"` is backed by a real semantic token instead of an undefined spacing variable.
- Added canonical website layout primitives in `src/components/site/primitives.tsx`:
  - `PageContainer`
  - `SectionIntro`
- Routed existing landing-section helpers through the canonical layout primitives instead of keeping duplicate wrapper logic.
- Refactored the preserved landing’s three highest-signal sections onto the normalized website primitives:
  - `Hero`
  - `Features`
  - `TerminalDemos`
- Refactored the generic legacy docs detail generators onto the shared website primitives:
  - `CommandPage`
  - `SdkFunctionPage`
- Added Storybook coverage for the new shared website layout primitives in `PublicPrimitives.stories.tsx`.
- Added `src/design-system-contracts.test.ts` to enforce the token layer, shared primitives, and landing/docs adoption.
- Ran the repo-local `swiss-modern-website-design` audit against `website-v2` and used its grid/type/component rules to finish the active landing shell.
- Reframed the active landing shell to a stricter Swiss/editorial system:
  - `src/components/landing/Nav.tsx`
  - `src/components/landing/Hero.tsx`
  - `src/components/landing/Features.tsx`
  - `src/components/landing/TerminalDemos.tsx`
  - `src/components/landing/CTABanner.tsx`
  - `src/components/layout/Footer.tsx`
- Replaced hero gradient emphasis and pill-heavy CTA language with stronger type hierarchy, rules, brackets, and shared panel framing.
- Replaced the floating feature-card treatment with repeated module panels, restrained accent usage, and explicit command/status structure.
- Tightened the footer into a compact typographic utility surface instead of a second marketing section.
- Expanded `src/design-system-contracts.test.ts` so the active landing shell is now guarded against reintroducing soft chrome and gradient/pill drift.
- Reframed the shared tutorial shell with the same Swiss/editorial rules:
  - `src/components/tutorials/TutorialLayout.tsx`
  - `src/components/tutorials/TutorialProgress.tsx`
  - `src/components/tutorials/ReorientationPanel.tsx`
- Normalized `src/pages/tutorials/GettingStarted.tsx` away from ad hoc `Surface`/`Badge` stacks and onto shared public primitives (`CommandBlock`, `DocsCodeBlock`, `DocsNoteCard`, `BracketLink`).
- Replaced the tutorial hero’s glow/rounded academy chrome with bracketed breadcrumbs, restrained metadata, a sharper progress panel, and quieter prev/next lesson navigation.
- Expanded `src/design-system-contracts.test.ts` so the tutorial shell and active getting-started lesson are now guarded against reintroducing rounded/glowy academy chrome.
- Expanded the shared tutorial reading rail from a narrow prose column to a wider modular canvas while keeping paragraph/list measure constrained for readability.
- Re-composed `src/pages/tutorials/GettingStarted.tsx` so steps 2 and 3 share a responsive two-column row instead of stacking like long-form essay sections.
- Refreshed the tutorial-shell guardrails to assert the wider content rail and the responsive paired-step layout in `GettingStarted`.
- Rebuilt `src/pages/tutorials/Fleet.tsx` on top of `DocsNoteCard`, `DocsCodeBlock`, `SurfacePanel`, and `BracketLink` so the page no longer depends on the legacy low-contrast tutorial card stack.
- Removed `/dashboard` from the docs-shell header/footer shortcuts and the docs overview/sidebar "broader site" surfaces so the public website no longer advertises a hosted daemon HUD.
- Replaced `src/pages/DashboardPage.tsx` with a compatibility/access page that explains the control plane is local-only and points operators to `pd status`, the daemon URL, FleetBar, and the local control-plane tutorial.
- Expanded both public-shell and design-system guardrails so `/dashboard` cannot drift back to fake telemetry hooks, force-directed swarm art, or invented daemon/version badges.

## Validation Results

- `npm test -- src/public-shell-contracts.test.ts src/design-system-contracts.test.ts`
  - passed
  - 27 assertions green
- `npm run build`
  - passed
  - production bundle emitted successfully
- `npx playwright screenshot --full-page http://127.0.0.1:4174/tutorials/fleet /tmp/port-daddy-fleet-after.png`
  - captured
  - visual check confirms Fleet now uses the higher-contrast tutorial/page primitives instead of the legacy low-contrast card stack

## Follow-up Work Discovered

- Additional landing/page surfaces still bypass the shared system and should be normalized in a later slice:
  - `src/components/landing/HowItWorks.tsx`
  - `src/components/landing/DemoGallery.tsx`
  - `src/components/landing/MaturitySection.tsx`
  - `src/components/landing/TerminalReplay.tsx`
  - `src/components/ui/IntentModal.tsx`
  - `src/pages/ExamplesPage.tsx`
  - `src/pages/RoadmapPage.tsx`
  - `src/pages/integrations/IntegrationsPage.tsx`
- `src/components/ui/CodeBlock.tsx` and `src/components/ui/SignalFlags.tsx` still contain a lot of inline style logic that should eventually be converted into token-backed helper primitives.
- The full `website-v2` test suite still has unrelated pre-existing failures outside this normalization slice, so validation for this work needs to stay focused on the touched design-system surfaces.
