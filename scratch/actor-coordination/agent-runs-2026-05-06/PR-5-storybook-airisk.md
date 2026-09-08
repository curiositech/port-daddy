# PR-5 — Storybook coverage + AI risk register

**Branch name:** `voice-design-pr5-storybook-airisk`
**Worktree path:** `~/coding/port-daddy/.claude/worktrees/voice-design-pr5-storybook-airisk`

## Files you own (and ONLY these)

- `website-v2/.storybook/**`
- `website-v2/src/components/site/primitives.stories.tsx` *(create
  if missing)*
- `website-v2/src/components/landing/*.stories.tsx` *(create stories
  for components missing them — audit flagged 57 missing stories
  total)*
- `docs/security/ai-risk-register.md` *(new file)*
- `package.json` only if you need to add `@storybook/*` deps

## What to do

1. **Storybook stories** — the audit flagged 57 missing stories. You
   don't have to write all 57; aim for the design-system primitives
   (PanelTitle, PanelBody, PanelEyebrow, BracketLabel) and the most-used
   landing components. Each story should exercise:
   - default state
   - all `size` variants
   - light + dark theme
   - long-content overflow case
2. **AI risk register** — write `docs/security/ai-risk-register.md`.
   Cover the OWASP LLM Top 10 categories that apply to Port Daddy and
   its agents: prompt injection, insecure output handling, training
   data poisoning (n/a — we don't train), model denial of service,
   supply chain vulnerabilities (the spawned agents *are* a supply
   chain), sensitive information disclosure, insecure plugin design,
   excessive agency, overreliance, model theft (n/a). For each
   applicable risk, document our current mitigation and our residual
   risk with a one-paragraph honest assessment. This is a security
   document; voice it accordingly (less wild analogy, more sober
   inventory; still recognizably Erich).

## Validation gates + PR template

- Storybook builds clean: `npm --prefix website-v2 run build-storybook`
- The new ai-risk-register reads as honest, not aspirational
- Audit re-run: storybook warning count drops by however many you
  added (record the delta in PR description)
