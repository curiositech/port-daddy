# Design-System Handoff Order

Only begin this phase after the lock-in checkpoint (Step 3 of the core process). Invoke in this order — each step's output is an input to the next, so running them out of order means redoing work.

1. **`color-theory-palette-harmony-expert`** — generate the palette first, seeded with the interview's brand adjectives and any existing brand assets. Everything downstream (typography contrast ratios, dark-mode variants, component theming) depends on the palette existing first.
2. **`typography-expert`** — pick type families/scale that fit the brand adjectives and work with the chosen palette's contrast requirements.
3. **`dark-mode-design-expert`** — derive the dark-mode variant from the palette + typography decisions, per the interview's light/dark/both answer. Don't design light and dark independently — dark mode should be a systematic derivation, not a second design pass.
4. **`tailwind-v4-expert`** — encode the palette/typography/dark-mode decisions as Tailwind theme tokens.
5. **`ideal-web-app-builder`** — assemble the locked screens (from the wireframes, now with real content) into actual layout using the Tailwind tokens from step 4.
6. **21st.dev component generation** — generate polished React components for the locked screens using the design tokens from steps 1-4, rather than hand-rolling components that then need to be retrofitted to match the system.

## Why this order, not parallel
Running these in parallel (e.g., generating components before the palette is decided) means every component gets redone once the palette lands — this is the design-system equivalent of the "caching a bad query" anti-pattern: fixing the root sequencing issue is cheaper than working around it downstream. If the founder's interview didn't clearly answer the brand/tone questions (interview-script.md, section 4), get that answered before starting this phase rather than guessing a palette and hoping it fits.
