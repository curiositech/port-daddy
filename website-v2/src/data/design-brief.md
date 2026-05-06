# Port Daddy — Design Brief

**Scope:** Marketing website at `website-v2/`
**Date:** 2026-03-17
**Status:** For implementation

---

## Executive Summary

The design system is structurally sound — good token architecture, real dark mode, accessibility work done. The problem is execution. The landing page (Hero, Features, CTABanner, Nav, Footer) is clean and restrained to the point of feeling generic. The inner pages (DocsPage, MCPPage, TutorialsPage) went the other direction: enormous border radii (`rounded-[48px]`, `rounded-[80px]`), `font-black` everywhere, and text at `text-9xl`. These two registers never reconcile, and the result is a site that cannot decide if it is Stripe or a brutalist art project.

The sharp, disciplined product goal is achievable from this foundation. It
requires three things: first-class light and dark systems, genuine depth through
planes and grid pressure, and typographic discipline — choosing one voice and
using it with confidence.

## Official Variant: Primitive Map

The Port Daddy design system now has an official **Primitive Map** variant for
runtime-primitives pages, Mac preview proof surfaces, and source-backed concept
explainers. The canonical design note lives at
`docs/design-system/primitives-variant.md`; the canonical concept page lives at
`docs/concepts/primitives.md`.

Use this variant when the page needs to explain live coordination state:
sessions, claims, region claims, locks, channels, inboxes, tuples, activity,
salvage, Arbiter checks, budget gates, telemetry gates, FleetBar, Fleet Control
Center, or Shipwright.

Rules:

- one decisive CTA per viewport;
- hard rules and aligned modules before decorative cards;
- compact fact tables for proof and comparison;
- source rows for code-backed claims;
- black/ink for the primary action, blue for live runtime state, green for
  evidence, amber for preview or pending gates, red for conflict;
- no mystery download CTAs and no abstract "AI magic" copy where a concrete
  primitive exists.

---

## 1. Typography

### Current Situation

- **Display:** Newsreader (serif, italic) — declared in tokens, but inner pages override it with `font-black` + `tracking-tighter` making it look like a startup pitch deck that wants to be a manifesto
- **Body:** Inter — correct choice, no complaints
- **Mono:** JetBrains Mono — correct choice for a dev tool

### Assessment

**Newsreader is wrong for the hero headline.** Serif italic is a deliberate editorial voice — it can work for a dev tool (see Vercel's use of Cal Sans, or Liveblocks' editorial serif moments), but Newsreader italic at `text-6xl` reads as "tech startup imitating a literary magazine." Port Daddy is a daemon. It should feel precise, taut, a little dangerous.

The real problem is that `index.css` sets `h1` to `font-style: italic` globally, then component code fights it with `font-black tracking-tighter` inline classes. This creates inconsistency, not intentionality.

### Recommendation: Replace Newsreader with Geist or Keep Inter + Mono Accent

**Option A (recommended): Geist**
Vercel's Geist font is open-source, engineered for developer tools, and has the technical tightness this product needs. It pairs well with JetBrains Mono.

```css
/* tokens.css */
--font-display: 'Geist', 'Inter', system-ui, sans-serif;
--font-sans:    'Geist', 'Inter', system-ui, sans-serif;
--font-mono:    'JetBrains Mono', 'Fira Code', monospace;
```

**Option B: Keep Inter, add editorial moments with JetBrains Mono**
Use `font-mono` for the hero headline with tight letter spacing. Makes the product feel like it was built from the CLI up. Warp terminal does this effectively.

**If keeping Newsreader:** Constrain it to one use — the hero section display headline only, at exactly 600 weight, no italic, tight tracking. Remove it from all other heading levels.

### Type Scale

The scale in tokens is complete but inner pages use arbitrary sizes (`text-9xl`, `text-8xl`, `text-7xl`) that are not in the token system. This is not an extension of the design system — it is abandoning it.

**Recommended scale (keep existing tokens, delete ad-hoc sizes from page files):**

| Token | Size | Use |
|-------|------|-----|
| `--text-xs` | 12px | Badge labels, legal copy |
| `--text-sm` | 14px | Secondary UI labels, card metadata |
| `--text-base` | 16px | Body text, paragraph |
| `--text-lg` | 18px | Lead paragraphs, card descriptions |
| `--text-xl` | 20px | Section subheadings |
| `--text-2xl` | 24px | Card headings |
| `--text-3xl` | 30px | Page subheadings |
| `--text-4xl` | 36px | Section headlines |
| `--text-5xl` | 48px | Hero headline (mobile) |
| `--text-6xl` | 60px | Hero headline (desktop) — add this token |

Add `--text-6xl: 3.75rem` to tokens. Retire anything above that from marketing pages. `text-9xl` is for a concert poster, not documentation.

### Heading Weights

- Remove the global `font-style: italic` from `h1` in `index.css`. It is causing confusion.
- Standardize to: hero headline = weight 700, section headings = weight 600, card headings = weight 600, UI labels = weight 500.
- Remove `font-black` (weight 900) from body copy and paragraph text. It is being used in MCPPage and DocsPage on `<p>` tags (`font-bold` too), which reads as aggressive and fatiguing.

### Line Heights

Current token set is solid. The application is inconsistent. Inner pages use `leading-[0.85]` on hero text — this is too compressed for multi-line headings and causes descenders to collide.

**Rule:** Hero headlines at min `leading-[1.0]`, section headings at `leading-tight` (1.25), body at `leading-relaxed` (1.625). No sub-1.0 line heights on strings longer than one word.

### Letter Spacing

The tokens are correct. The problem is `tracking-[0.3em]` and `tracking-widest` on body text and paragraph labels. Reserve wide tracking for:
- Badge text (already doing this correctly)
- Section overline labels (e.g., "Academy of Coordination")
- Copyright/legal footer text

Do not use wide tracking on headings larger than `text-sm`.

---

## 2. Color System

### Brand Color: Teal

`#0d9488` (teal-600) as the brand primary. This is a safe, legible, professional color that reads as trustworthy-tech. The problem is not the hue — it is differentiation.

**Current competitive landscape:**
- Supabase: green (`#3ECF8E`)
- Railway: purple (`#B35CFF`)
- Fly.io: lavender/purple
- Render: blue
- Vercel: black/white with occasional blue
- Dagger: orange-red

Teal is currently occupied by Upstash and partially Neon. Port Daddy is not in direct competition with those products, but the color reads "database startup" more than "coordination infrastructure."

**Recommendation: Shift teal toward cyan.**
Move from `#0d9488` (green-teal) toward `#0891b2` (cyan-600) or `#06b6d4` (cyan-500). This reads as more "infrastructure layer" and "system-level" — closer to how monitoring and networking tools present themselves (Grafana uses a similar register). The current teal has too much green in it.

If the anchor to teal is intentional (maritime theme), commit to it harder: make it deeper and more saturated as the primary action color, and use the current `#5eead4` (teal-300) as the only accent. The current palette has too many teal values that are too close together.

### Dark Mode Palette

The tonal elevation system is well-designed. The surfaces from `#0a0a0a` to `#2a2a2a` give real room to work with. The problem is the backgrounds are pure neutral black — no temperature. It reads as default/undesigned.

**Add temperature to the dark base.** A barely-perceptible blue-black or teal-black creates visual richness without being garish:

```css
/* Replace in [data-theme='dark'] */
--surface-base: #050d0c;   /* Very slightly teal-shifted black */
--surface-1:    #0d1917;   /* Surface-1: barely perceptible teal tint */
--surface-2:    #131f1e;   /* Surface-2 */
--surface-3:    #182524;   /* Surface-3 */
--surface-4:    #1e2c2b;   /* Surface-4 */
--surface-5:    #243432;   /* Surface-5 */
```

This is a 4–6 point hue shift. At this scale, users do not perceive it as "colored" — they perceive the dark mode as "rich" vs. "flat." Stripe's dark mode uses exactly this technique with a dark navy base.

Alternatively: keep the neutral base but add a full-bleed structural field on
the landing page only:

```css
/* hero section field — landing page only */
background: var(--surface-base);
background-image:
  linear-gradient(to right, var(--grid-line) 1px, transparent 1px),
  linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px);
```

### Depth Tokens

Depth tokens must resolve to structural differences: borders, rules, surface
steps, and grid density. They must not reintroduce halos, frosted panels, or
ambient soft shadows.

**Depth application rules:**
- Primary CTAs: strong border contrast, clear focus ring, no glow at rest
- Active nav item: hard background shift plus a rule, not a halo
- Feature cards: flat at rest, stronger border and surface step on hover
- Code blocks: inert, stable, and ruled like an instrument panel

### Accent Colors

The amber and green accents are used for badges (amber = intermediate, green = success states). This is fine. Do not add more accent colors. The set is: teal (brand), amber (warning/intermediate), green (success). Three is enough.

A missing color: the dark mode needs a subtle surface highlight for interactive elements that is not the brand teal. Currently everything interactive uses `rgba(20, 184, 166, 0.12)` for hover states. This makes every hover interaction feel "branded" rather than neutral. Add a neutral hover:

```css
--surface-hover: rgba(255, 255, 255, 0.06);   /* Neutral hover — not teal-tinted */
```

Use this for nav items, footer links, and secondary controls. Reserve `--interactive-hover` (teal-tinted) only for elements that are directly related to primary actions.

---

## 3. Spacing and Layout

### The Core Problem

The site has "weird spacing" because different sections use different mental models for spacing:

- Hero: uses gap and padding values from tokens (looks good)
- Features: `py-16 lg:py-24` — reasonable
- TutorialsPage: `p-10`, `gap-12`, `p-20`, `mt-32` — escalating scale
- MCPPage: `p-12`, `gap-12`, `p-10`, `space-y-24` — different escalation pattern
- DocsPage: `p-20`, `mt-32`, `space-y-32`, `gap-16` — yet another pattern

The spacing is not wrong per element. It is inconsistent across sections, so the page feels like multiple designers who never talked.

### Recommended Spacing Scale

Standardize on this progression. Use only these values for section-level spacing:

| Tailwind | Value | Use |
|----------|-------|-----|
| `py-6` | 24px | Tight internal card padding |
| `py-8` | 32px | Default card padding |
| `py-12` | 48px | Section top/bottom padding (mobile) |
| `py-16` | 64px | Section padding (tablet) |
| `py-24` | 96px | Section padding (desktop) |
| `py-32` | 128px | Hero and major breakpoints (desktop) |

Do not use `py-20` or `py-28` — these are the middle values that feel arbitrary. Odd spacings are the source of the "weird" feeling.

For gap between grid items: `gap-6` (24px) for dense content, `gap-8` (32px) for feature cards, `gap-12` (48px) only for hero feature highlights with tall cards. The tutorials page using `gap-12` for a 3-column grid creates excessive whitespace that makes each card feel isolated rather than part of a set.

### Container and Max Width

Current landing page uses `max-w-[1200px]` and inner pages use `max-w-7xl` (1280px). Standardize on one value.

**Recommendation: `max-w-[1200px]` for all pages.** 1200px is a deliberate, common choice that avoids the "full width looks like a web app" problem at 2560px monitors. Keep it consistent.

Content containers (text blocks inside sections): `max-w-2xl` for single-column descriptive copy, `max-w-4xl` for wide headlines. Do not use `max-w-5xl` or wider for body copy.

### Section Padding Uniformity

Every section should use the same pattern:

```html
<section class="py-16 lg:py-24">
  <div class="max-w-[1200px] mx-auto px-6 lg:px-8">
    ...
  </div>
</section>
```

The hero section is allowed to break this pattern (it is special). Every other section must follow it. Currently CTABanner uses `py-16 lg:py-24` correctly, Features uses it correctly, but the inner pages are wild with `space-y-32` creating 128px gaps between every section.

### Border Radius

This is the most glaring issue on the inner pages. Border radius values in use:

- Tokens: `--radius-xl` = 16px, `--radius-2xl` = 24px, `--radius-3xl` = 32px
- Actual usage: `rounded-[48px]`, `rounded-[56px]`, `rounded-[64px]`, `rounded-[80px]`

None of the inner page border radii are from the token system. A `rounded-[80px]` card in a 400px column is wider than the radius of the element, making it look like a pill-shaped blob. This is what reads as "weird."

**Rule:** Cap border radius at `--radius-md` (8px) for cards and containers.
The only exception is circular icon containers (use `rounded-full` for those).
Remove all arbitrary pill radii from the codebase.

```
rounded-sm    → 4px   (tags, code badges)
rounded-md    → 6px   (small buttons, tooltips)
rounded-lg    → 8px   (default buttons)
rounded-lg    → 8px   (cards, code blocks, CTA sections — maximum for containers)
```

---

## 4. Component Polish

### Button

The Button component is well-structured. Two issues:

**1. The `lg` size is too small for a hero CTA.** `px-6 py-3` at `text-lg` — compare to Vercel or Railway hero CTAs which use more generous horizontal padding. Hero CTAs should feel like they have weight.

```tsx
/* Replace lg size in sizeClasses */
lg: 'px-8 py-3.5 text-base rounded-md gap-2.5 tracking-tight font-semibold',
```

**2. Primary button hover depth must be structural**, not a shadow or glow.
Use a tokenized border and background state so the brand can change without
rewriting arbitrary utilities.

```tsx
/* Prefer tokenized hard states */
'hover:bg-[var(--interactive-active)] hover:border-[var(--border-strong)]',
```

**3. The `secondary` variant looks like a disabled primary.** In dark mode, `bg-[var(--bg-surface)]` with `border-[var(--border-default)]` renders as a flat gray box with a slightly lighter gray border. It has no visual weight. A visitor will not reach for it.

```tsx
/* For the secondary variant in dark mode, use a ruled plane */
secondary: [
  'bg-[var(--surface-1)] text-[var(--text-primary)]',
  'border border-[var(--border-default)]',
  'hover:bg-[var(--surface-2)]',
  'hover:border-[var(--border-strong)]',
  'transition-colors duration-160',
  'font-medium',
].join(' '),
```

### Card

The Card component is deliberately minimal — this is correct for a component.
The problem is that it is *used* without hierarchy everywhere, producing
identical flat boxes. Compose depth with border weight, rule placement, grid
alignment, and surface steps.

**Feature cards should use the bordered plane treatment in both modes:**

```tsx
/* On the container in Features.tsx */
className="group relative p-6 rounded-md bg-[var(--surface-1)]
           border border-[var(--border-default)] border-l-4
           border-l-[var(--accent-primary)]
           hover:bg-[var(--surface-2)] hover:border-[var(--border-strong)]
           transition-colors duration-160"
```

This gives depth by making the hierarchy legible, not by making cards float.

**The hover state on cards should be directional.** A refined approach uses a
hard accent rule that makes the left edge carry state:

```css
.surface-plane::before {
  content: '';
  position: absolute;
  inset: -1px auto -1px -1px;
  width: 6px;
  background: var(--accent-secondary);
  pointer-events: none;
}
```

### Badge

The badge is structurally fine. Issues:

**1. `uppercase tracking-wide` on an 11px font is nearly illegible.** The badge text is already small; adding tracking on top makes it extremely light visually. Either drop the uppercase, or drop the letter spacing, or bump to `text-xs` (12px).

**2. The badge is used as a section label in a way it was not designed for.** Pages use badges like:
```tsx
<Badge className="px-8 py-3 text-[10px] font-black uppercase tracking-[0.25em]">
  Academy of Coordination
</Badge>
```

This overrides almost every token the badge provides. Create a distinct `SectionLabel` component (or a badge variant called `label`) for this pattern:

```tsx
/* A dedicated overline / section-label pattern */
<span className="inline-block text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brand-primary)]">
  Academy of Coordination
</span>
```

No border, no background, no pill shape. Just an overline label. This is how Stripe and Linear handle section labels — they are not badges.

**3. The `neutral` badge variant in dark mode** has `bg-[var(--bg-surface)]` which renders as near-invisible on a dark background. Add a minimum visible contrast to the neutral variant:

```css
/* In [data-theme='dark'] */
--badge-neutral-bg: rgba(255, 255, 255, 0.08);
--badge-neutral-text: var(--text-secondary);
--badge-neutral-border: rgba(255, 255, 255, 0.12);
```

### CodeBlock

The CodeBlock is well-constructed. Issues:

**1. Traffic lights are using undefined variables.** `var(--p-red-500)`, `var(--p-amber-500)`, `var(--p-green-500)` are not in the token system. These silently resolve to nothing.

```tsx
/* Replace undefined token references */
<span className="w-3 h-3 rounded-full bg-[#ff5f56] opacity-80" />
<span className="w-3 h-3 rounded-full bg-[#ffbd2e] opacity-80" />
<span className="w-3 h-3 rounded-full bg-[#27c93f] opacity-80" />
```

**2. `var(--codeblock-bg)`, `var(--codeblock-border)`, `var(--codeblock-radius)`, `var(--codeblock-header-bg)`, `var(--code-output)`, `var(--code-prompt)` are all undefined** in tokens.css. The code block is referencing a whole set of tokens that do not exist. This is likely why code blocks look wrong. Add these to tokens.css:

```css
/* In :root / [data-theme='light'] */
--codeblock-bg:         #f8f8f8;
--codeblock-header-bg:  #f0f0f0;
--codeblock-border:     var(--border-subtle);
--codeblock-radius:     var(--radius-xl);
--code-output:          #374151;
--code-prompt:          #0a5f56;

/* In [data-theme='dark'] */
--codeblock-bg:         #111111;
--codeblock-header-bg:  #0d0d0d;
--codeblock-border:     rgba(255, 255, 255, 0.08);
--codeblock-radius:     var(--radius-xl);
--code-output:          #e2e8f0;
--code-prompt:          #5eead4;
```

**3. The code block header has too much visual weight.** The `px-4 py-2` header with traffic lights is correct sizing, but the copy button label "Copy" is unnecessary. Icons with a tooltip are sufficient; the word adds clutter without adding meaning.

---

## 5. Overall Aesthetic Direction

### What "Sharp, Deep, and Professional" Actually Means

The user's goal is a disciplined developer-product interface with the gravity of
Swiss modernism and the immediacy of restrained neobrutalism. Characterized by:

- Light and dark modes that both feel intentional
- Hard planes, measured borders, and visible grid pressure
- No frosted panels, glow blobs, soft shadows, or pill-card blobs
- Typography that is tight, confident, and useful under scanning pressure
- Code and runtime evidence as first-class product material
- Minimal but precise use of color through tokens, not arbitrary literals

**The current site still carries legacy decoration vocabulary.** The correct
direction is not more atmosphere. It is stronger structure: better hierarchy,
less softness, clearer claims, and a repeatable component system.

### Recommended Aesthetic Changes

**1. Make both modes first-class.**

The landing page may prefer the operator's system theme, but it must not look
like the real design only exists in dark mode. Every page needs the same token
discipline, spacing, and contrast in both modes.

**2. Replace hero atmosphere with layout pressure.**

Use grid columns, rules, product screenshots, command traces, and strong type
instead of radial coronas.

```tsx
<div className="absolute inset-x-0 top-0 h-px bg-[var(--border-strong)]" />
<div className="absolute inset-y-0 left-[calc(50%-1px)] w-px bg-[var(--border-subtle)]" />
<div className="grid-pattern opacity-45" aria-hidden />
```

**3. Add structural density only when it clarifies.**

Fine grid texture can work when it supports alignment. Decorative noise and
ambient overlays are not allowed.

```css
.grid-pattern {
  background-image:
    linear-gradient(to right, var(--grid-line) 1px, transparent 1px),
    linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px);
}
```

**4. Feature cards need hierarchy, not floating panels.**

The current flat-token guard prevents shadows from rendering, but the component
text still encodes the old direction. Replace shadow utilities with bordered
planes and accent rules.

```tsx
className="group relative p-6 rounded-md bg-[var(--surface-1)]
  border border-[var(--border-default)] border-l-4
  border-l-[var(--accent-primary)]
  hover:bg-[var(--surface-2)]
  hover:border-[var(--border-strong)]
  transition-colors duration-160"
```

### Reference Sites

These five sites are useful references, but Port Daddy should translate them
through a harder Swiss-modern system instead of copying decorative effects:

1. **Warp (warp.dev)** — Terminal product with confident monospace-forward
   typography and product-led hero composition. Study the hierarchy, not the
   atmospheric effects.

2. **Resend (resend.com)** — Near-perfect dark dev tool site. Black base, white typography at extreme weight contrast, subtle animated code examples, minimal use of color. The grid pattern matches what Port Daddy is already doing, but executed at 2x the contrast.

3. **Raycast (raycast.com)** — The definitive "liquid and slick" dev tool aesthetic. Rainbow gradients on the hero are unique to them and should not be copied, but their card depth, typography scale (Inter at extreme sizes with perfect tracking), and hover interactions are directly applicable.

4. **Turso (turso.tech)** — Database/infrastructure tool that uses a similar dark base + green-teal accent. Direct competitor to the aesthetic Port Daddy wants. The way they use monospace font in section headers is worth studying.

5. **Railway (railway.app)** — Dark mode, purple accent, tight typography. Their feature cards use a very subtle gradient from surface-1 to surface-0 that gives the impression of depth without explicit shadow. Their "Deploy in seconds" section is a good model for how Port Daddy's install command section should feel.

---

## 6. Specific CSS Recommendations (Copy-Paste Ready)

### tokens.css — Missing Tokens to Add

```css
/* Add to :root / [data-theme='light'] */
--text-6xl:             3.75rem;   /* 60px — hero headline desktop */
--bg-code:              #f4f4f5;
--codeblock-bg:         #f8f8f8;
--codeblock-header-bg:  #efefef;
--codeblock-border:     var(--border-subtle);
--codeblock-radius:     var(--radius-xl);
--code-output:          #374151;
--code-prompt:          #0a5f56;
--badge-neutral-bg:     rgba(0, 0, 0, 0.05);
--badge-neutral-text:   var(--text-tertiary);
--badge-neutral-border: var(--border-subtle);

/* Add to [data-theme='dark'] */
--text-6xl:             3.75rem;
--bg-code:              #111111;
--codeblock-bg:         #0f0f0f;
--codeblock-header-bg:  #0a0a0a;
--codeblock-border:     rgba(255, 255, 255, 0.08);
--codeblock-radius:     var(--radius-xl);
--code-output:          #e2e8f0;
--code-prompt:          #5eead4;
--surface-hover:        rgba(255, 255, 255, 0.06);
--badge-neutral-bg:     rgba(255, 255, 255, 0.08);
--badge-neutral-text:   var(--text-secondary);
--badge-neutral-border: rgba(255, 255, 255, 0.12);
```

### index.css — Typography Fixes

```css
/* Remove the global italic from h1 */
h1 {
  font-size: var(--text-5xl);
  line-height: 1.05;
  font-weight: 700;
  /* REMOVE: font-style: italic; */
}

/* Standardize heading weights */
h2 { font-size: var(--text-4xl); font-weight: 600; }
h3 { font-size: var(--text-2xl); font-weight: 600; }

/* Add responsive 6xl */
@media (min-width: 1024px) {
  h1 { font-size: var(--text-6xl); }
}
```

### index.css — Structural Plane Utility

```css
/* Add after existing surface utilities. Depth comes from planes and rules. */
.surface-plane {
  position: relative;
  background: var(--surface-1);
  border: 1px solid var(--border-default);
  border-block-start: 4px solid var(--accent-primary);
  border-radius: var(--radius-md);
  box-shadow: none;
  transition: border-color 160ms ease, background 160ms ease;
}

.surface-plane::before {
  content: '';
  position: absolute;
  inset: -1px auto -1px -1px;
  width: 6px;
  background: var(--accent-secondary);
  pointer-events: none;
}

.surface-plane:hover {
  background: var(--surface-2);
  border-color: var(--border-strong);
}
```

### Hero.tsx — Swiss Field, Not Glow

```tsx
{/* Replace ambient glow with measured structure */}
<div className="absolute inset-x-0 top-0 h-px bg-[var(--border-strong)]" />
<div className="absolute inset-y-0 left-[calc(50%-1px)] w-px bg-[var(--border-subtle)]" />
<div className="grid-pattern opacity-45" aria-hidden />
```

### Features.tsx — Bordered Plane Treatment

```tsx
{/* Replace the card container className */}
className="group relative overflow-hidden rounded-md
  bg-[var(--surface-1)] border border-[var(--border-default)] border-l-4
  border-l-[var(--accent-primary)] p-6
  hover:border-[var(--border-default)]
  hover:bg-[var(--surface-2)]
  transition-colors duration-160"
```

### Nav.tsx — Dropdown Plane

```tsx
{/* Replace the dropdown container className */}
className="absolute top-full left-0 mt-2 w-64
  bg-[var(--surface-1)]
  border-2 border-[var(--border-strong)]
  rounded-md
  py-2 z-50"
```

### Removing Arbitrary Border Radii (Pattern)

In TutorialsPage, MCPPage, DocsPage — replace all instances of the following pattern:

| Current (arbitrary) | Replace with |
|--------------------|--------------|
| `rounded-[48px]` | `rounded-md` (8px) |
| `rounded-[56px]` | `rounded-md` (8px) |
| `rounded-[64px]` | `rounded-md` (8px) |
| `rounded-[80px]` | `rounded-md` (8px) |
| `rounded-[40px]` | `rounded-md` (8px) |
| `rounded-[32px]` | `rounded-md` (8px) |

This is a global find-replace across the `src/pages/` directory. Only controls
and tiny badges may use smaller radii. Marketing cards do not get pill geometry.

### Spacing Normalization (Pattern)

In TutorialsPage, MCPPage, DocsPage — replace these excessive spacings:

| Current | Replace with | Rationale |
|---------|-------------|-----------|
| `p-20` (80px card padding) | `p-8` (32px) | 80px padding in a card is a layout, not padding |
| `space-y-32` between sections | `space-y-24` | 128px gap is too much vertical air |
| `gap-12` in 3-col grids | `gap-8` | 48px column gap creates isolated silos |
| `mt-32` before callout sections | `mt-24` | Use the spacing scale |
| `py-32` on main content | `py-24` | Reserve 32 for hero only |

---

## Priority Order

If implementing incrementally:

1. **Fix undefined tokens** — CodeBlock is currently broken. Add missing `--codeblock-*` and `--code-*` tokens. This is a bug, not a design decision. (1 hour)

2. **Remove arbitrary border radii** — Find-replace in page files. Changes nothing about content, fixes the "looks like a blob" problem immediately. (30 minutes)

3. **Replace hero atmosphere with structure** — measured rules, column pressure,
   and live product evidence instead of glow fields. (30 minutes)

4. **Apply bordered plane treatment** to feature cards in Features.tsx and
   equivalent grid sections in MCPPage and TutorialsPage. (2 hours)

5. **Remove global h1 italic** and standardize heading weights across page files. (1 hour)

6. **Spacing normalization** in inner pages — reduce `p-20` card padding and `space-y-32` gaps. (1–2 hours)

7. **Secondary button variant** — use tokenized border contrast and explicit
   pressed/focus states in both modes. (30 minutes)

8. **Section label pattern** — replace oversized badge usage with plain overline labels. (1 hour across all pages)

9. **Add hard-depth review** — scan for blur, glow, pill radii, soft shadows,
   and off-system color literals before every commit. (30 minutes)

10. **Add temperature to dark base surfaces** (optional — highest visual impact but riskiest regression). (1 hour + visual review)
