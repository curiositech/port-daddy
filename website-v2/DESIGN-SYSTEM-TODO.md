# Website Design-System Normalization Todo

Last updated: 2026-04-17

## Session Tasks

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

## Validation Results

- `npm test -- src/public-shell-contracts.test.ts src/design-system-contracts.test.ts`
  - passed
  - 22 assertions green
- `npm run build`
  - passed
  - production bundle emitted successfully

## Follow-up Work Discovered

- Additional landing/page surfaces still bypass the shared system and should be normalized in a later slice:
  - `src/components/landing/HowItWorks.tsx`
  - `src/components/landing/DemoGallery.tsx`
  - `src/components/landing/MaturitySection.tsx`
  - `src/components/landing/TerminalReplay.tsx`
  - `src/components/ui/IntentModal.tsx`
  - `src/pages/DashboardPage.tsx`
  - `src/pages/ExamplesPage.tsx`
  - `src/pages/RoadmapPage.tsx`
  - `src/pages/integrations/IntegrationsPage.tsx`
- `src/components/ui/CodeBlock.tsx` and `src/components/ui/SignalFlags.tsx` still contain a lot of inline style logic that should eventually be converted into token-backed helper primitives.
- The full `website-v2` test suite still has unrelated pre-existing failures outside this normalization slice, so validation for this work needs to stay focused on the touched design-system surfaces.
