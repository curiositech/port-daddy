# PR-1 — Landing + above-the-fold

**Branch name:** `voice-design-pr1-landing`
**Worktree path:** `~/coding/port-daddy/.claude/worktrees/voice-design-pr1-landing`

## Files you own (and ONLY these)

- `website-v2/src/pages/HomePage.tsx` *(if it exists; the landing route)*
- `website-v2/src/components/landing/Hero.tsx`
- `website-v2/src/components/landing/AboveFoldTeasers.tsx`
- `website-v2/src/components/landing/Features.tsx`
- `website-v2/src/components/landing/HowItWorks.tsx`
- `website-v2/src/components/landing/CTABanner.tsx`
- `website-v2/src/components/landing/InstallCTASection.tsx`

## What to do

1. **Voice pass** — apply the user voice profile to all copy in these
   files. The current copy is competent and corporate-even; rewrite to
   match the patterns established in `website-v2/src/data/whitePapers.ts`
   (which just shipped). Open with the world, not the feature list. One
   wild analogy per teaching paragraph. Em-dash asides. The 12-blog-post
   rule applies — if a list of items can dissolve into prose, dissolve
   it.

2. **Design pass — color blocking** — these landing components are
   currently mostly sandstone-on-sandstone. Apply the surface
   alternation pattern: alternate `surface-base`, `surface-strong`,
   `brand-primary`, `brand-accent`, `text-primary` (dark) section
   surfaces. Cards on a section should use a contrasting surface (card
   on `surface-strong` → card uses `surface-base`).

3. **Design pass — padding** — section vertical padding cap is
   `py-[var(--space-6)] lg:py-[var(--space-7)]`. If you find anything
   larger, cut it.

4. **Raw-color cleanup** — `InstallCTASection.tsx` has 11 raw hex
   literals according to the audit. Move them to design tokens or
   reference existing semantic tokens. Confirm by running:
   `python3 ~/.claude/skills/ideal-web-app-builder/scripts/audit_web_app_contract.py website-v2 2>&1 | grep -E "raw-color.*InstallCTASection"`
   The output should be empty after your fix.

5. **Sentry** — add a one-line Sentry init to the website's main entry
   point. We don't have a DSN yet; gate on `import.meta.env.VITE_SENTRY_DSN`
   and document the env var in `website-v2/.env.example`. Do not break
   builds when DSN is unset.

## Validation gates

- `npm --prefix website-v2 run build` clean
- `npm --prefix website-v2 run lint` clean
- Audit re-run: raw-color count for `InstallCTASection.tsx` reaches 0
- `pd guard check --staged` passes
- Visual: take a Playwright screenshot of `/` at 1440x900 and save it
  to `.scratch/landing-after.png` for the PR description

## PR description template

Title: `landing: voice pass + color blocking + InstallCTA token cleanup`

Body skeleton (fill in):

```
## What
- Voice pass on Hero / AboveFoldTeasers / Features / HowItWorks / CTABanner
  to match the whitepaper rewrite voice
- Surface alternation across landing sections: <list the pattern you
  picked, eg. paper → strong → blue → accent → paper>
- 11 raw-color literals in InstallCTASection moved to design tokens
- Sentry init wired (gated on VITE_SENTRY_DSN env)

## Why
The landing is the storefront for the whole project. The audit at
docs/audits/website-v2-2026-05-06.md found this surface needed both
the voice pass and the color blocking treatment that just landed on
the whitepaper pages.

## Validation
- npm run build clean
- npm run lint clean
- raw-color count in InstallCTASection: 11 → 0
- /scratch/landing-after.png shows alternating surfaces

## Test plan
- [ ] Open / on the preview, scroll top to bottom; sections have visible
      surface alternation
- [ ] Hero copy reads in Erich's voice (compare to whitepaper primer)
- [ ] InstallCTA renders correctly in light + dark mode
- [ ] Sentry: with no DSN, no console errors; with a DSN, errors flow
```
