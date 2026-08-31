# Manifesto Production — Shared Spec (read by all three subagents)

**Content source of truth:** `docs/manifesto-why-agent-economies.md` (the manifesto
"A Profit Incentive for Solving Anything"). All three artifacts express THIS content.
Do not invent new claims; do not soften the honest caveat (the functor-finding problem).

**Voice:** Erich Owens — high/low collisions, em-dash asides, cathedral build, wild
analogies grounded by self-deprecation, lists with personality. Never corporate-even,
never a "Port Daddy team" (single author). Understate hype (evangelism rule: ≤1
superlative / 500 words); lead with the felt problem, not the formalism.

**Palette / brand:** read `website-v2/src/styles/tokens.semantic.css` for current web
tokens (source of truth — never hardcode hex from memory). For the editorial art's warm
"harbor house" register, read the whitepaper's own palette definitions in
`whitepaper/source/*.tex` (the `hh*` color block — sand, ebony, cinnabar,
brass, patina, paper) rather than copying the literals here; that file is the single
source so this doc can't drift. Cohesion across all three artifacts matters —
National Geographic prestige = ONE coherent visual world.

**Working dir for everything:** `/Users/erichowens/coding/port-daddy-paper3` (a git
worktree). Never write to `/tmp`; scratch goes under `~/coding/tmp/` if needed.

---

## Image manifest (ART DIRECTOR generates ALL of these; BLOG + TALK only reference them)

Output dir: `website-v2/public/img/generated/manifesto/`
Public web path prefix: `/img/generated/manifesto/`

Aesthetic: **prestige editorial — cinematic illustration with dramatic light and depth**
for the narrative heroes (National Geographic / Pixar-concept-art register), and **flat
architectural-blueprint** (crisp lines, hatching, hand-lettered italic labels) for the
technical diagrams. Tie everything to the harbor-house palette. Positive prompting only
(describe what IS in frame). Aspect ratio via generationConfig, never in prompt text.

| filename | aspect | register | depicts |
|---|---|---|---|
| `hero-state-of-nature.png` | 16:9 | cinematic | A dark harbor at 3 a.m. Two luminous autonomous vessels/robot-agents reach for the SAME single glowing artifact (a ledger/file) on a pier — near-collision, electric tension, rim-lit fog. The war of all against all. |
| `leviathan-harbor.png` | 16:9 | cinematic | The same harbor, now ordered: a vast benevolent harbor-authority lighthouse (the Leviathan — protective, NOT menacing) routing the vessels into clean glowing lanes. Relief, not tyranny. |
| `trilogy-arc.png` | 3:2 | blueprint | Three labeled beams in an architectural cross-section: "I Bonded Commons" (one process) → "II Anchor Protocol" (one machine) → "III Federated Harbor" (many machines). Hand-lettered labels, hatching. |
| `functor-transport.png` | 16:9 | cinematic+blueprint | Two distinct domains — a folded protein on the left, a crystalline textile/lattice on the right — joined by a glowing structure-preserving bridge; identical relational scaffolding lighting up on both sides as a theorem "transports" across. |
| `verified-bond-receipt.png` | 3:2 | prestige still-life | A wax-sealed certificate — a "verified functor" — beside a stack of collateral coins/tokens, graded by fidelity (equivalence > functor > Galois > span). The market's quality gate. |
| `olog-exchange.png` | 16:9 | cinematic | A grand trading-floor / exchange where glowing "ologs" (idea-constellations) are bought in one domain and sold into another — the arbitrage. Awe, scale, warm harbor light. |

ART DIRECTOR: generate SEQUENTIALLY (one `generate.py` call at a time — parallel
crashes). Use the `nano-banana-image-gen` skill:
`export GEMINI_API_KEY=$(grep "^GEMINI_API_KEY=" ~/coding/jbuds4life/next-app/.env.local | cut -d= -f2-)`
then `python3 ~/.claude/skills/nano-banana-image-gen/scripts/generate.py --scene "<rich prompt>" --out website-v2/public/img/generated/manifesto/<file> --aspect <ratio>`.
After each image, Read the PNG and verify it matches before moving on. Report which
succeeded. If the API key/quota is unavailable, STOP and report — do not fall back to
parallel Qwen.

---

## Artifact 2 — BLOG POST (prestige, media-rich, National Geographic register)

- FIRST discover the `website-v2` blog pipeline: find existing posts, the MDX/markdown
  location, the bespoke component registry, and the directive idioms (`<!-- COMPONENT: -->`,
  `<!-- figure: -->`, Tufte sidenotes, etc.). Copy the working idioms; read component
  source, do not guess prop shapes. (Per repo blog house style: bespoke components +
  imagery are mandatory; a plain-markdown post is NOT shippable.)
- Express the manifesto as a long-form prestige feature: the hero image up top
  (`hero-state-of-nature.png`), an inline figure per major movement, 4–6 Tufte sidenotes
  for definitions/asides, 1–2 pull-quotes, a trade-off table, the `pd begin` CTA block.
- DO NOT generate images. Reference the manifest paths above (they will exist).
- If the pipeline genuinely cannot be determined, produce a single self-contained,
  gorgeous responsive HTML article styled from the brand tokens as a fallback, and flag
  that clearly. Respect the no-tiny-fonts rule (≥14px body, rem units).

## Artifact 3 — CONFERENCE TALK (presentation)

- Build a self-contained **reveal.js** deck (single `index.html` + the shared images),
  output to `docs/talk/`. CDN reveal.js is fine.
- Structure (25-min, from the evangelism skill): war story → why testing can't fix it →
  what verified coordination means (no jargon) → live demo beat (`pd begin`) → **the
  Hobbes slide AFTER the failure** (`leviathan-harbor.png`) → results → the agent-economy
  + olog horizon (`functor-transport.png`, `olog-exchange.png`) → CTA (`brew install` +
  `pd begin`). Keep the honest functor caveat as its own slide.
- Include speaker notes (reveal.js `<aside class="notes">`) for every slide.
- On-brand palette; large readable type; one idea per slide.
