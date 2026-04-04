# Homepage Redesign Brief

## Current State
- Split hero: "Port Daddy Makes Agents Behave Well" (left) + hero image (right)
- 4-tab quickstart (brew, npx, pd, mcp)
- Features section
- Terminal demos (asciinema casts)
- CTA banner

## Problem
Homepage doesn't serve the Trojan strategy. It explains Port Daddy but doesn't guide visitors through the funnel: arrive → install → first value → discover depth → advocate.

## Proposed Hero (Pattern 1: Centered + Install Terminal)

```
┌──────────────────────────────────────────────────────────────┐
│  [Logo]  Get Started ▼  Features ▼  Docs ▼  Blog  [GitHub]  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                  THE HARBORMASTER FOR                        │
│                  YOUR AI AGENTS.                             │
│                                                              │
│     Never fight port conflicts. Coordinate without           │
│     clobbering. Let dead agents leave breadcrumbs.           │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ [Homebrew]  [npx]  [MCP]  [Menubar]                  │    │
│  │                                                      │    │
│  │ $ brew install port-daddy && pd status               │ 📋 │
│  │                                                      │    │
│  │ Install the daemon. Auto-starts on login.            │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│    3,700+ tests    9 formal proofs    44 MCP tools           │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  ONE DAEMON. SIX SUPERPOWERS.                                │
│                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                     │
│  │ Port     │ │ Agent    │ │ Pub/Sub  │                     │
│  │ Manager  │ │ Fleet    │ │ + Tuples │                     │
│  └──────────┘ └──────────┘ └──────────┘                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                     │
│  │ Formal   │ │ Agent    │ │ MCP      │                     │
│  │ Safety   │ │ Salvage  │ │ Tools    │                     │
│  └──────────┘ └──────────┘ └──────────┘                     │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  VHS GIF: pd begin → note → whoami → done                   │
│  (speedrun tape from demos/blog/begin-done-speedrun.tape)    │
├──────────────────────────────────────────────────────────────┤
│  FEATURED BLOG POST (latest, with hero image)                │
│  → Link to /blog                                             │
├──────────────────────────────────────────────────────────────┤
│  API Docs  |  Tutorials  |  MCP Tools                        │
└──────────────────────────────────────────────────────────────┘
```

## Shared Components to Extract from BlogPage.tsx

1. `InstallTerminal` → `components/shared/InstallTerminal.tsx`
   - Already built in BlogPage.tsx
   - Tabs: brew / npx / mcp (add menubar tab)
   - Copy button, description per method

2. `EntryPointsGrid` → `components/shared/EntryPointsGrid.tsx`
   - Already built in BlogPage.tsx as the Trojan section
   - 6 cards: Port Manager, Agent Fleet, Pub/Sub + Tuples, Formal Safety, Agent Salvage, MCP

3. `FeaturedArticle` → `components/shared/FeaturedArticle.tsx`
   - Already built in BlogPage.tsx
   - Big card with hero image, gradient overlay, metadata

4. `StatsBar` → `components/shared/StatsBar.tsx` (NEW)
   - "3,700+ tests · 9 formal proofs · 44 MCP tools"
   - Animated counters on scroll-into-view

## 21st.dev Components to Source

- **Animated counter** — for stats bar
- **Terminal/code block** — enhanced version of install terminal
- **Bento grid** — for the six superpowers (instead of flat grid)
- **Marquee/logo strip** — if we get user logos
- **Glow card** — neumorphic cards with hover glow effect

## Design System Specs for 21st.dev

When requesting components from 21st.dev, specify:

```
Design System: Harbor Heritage (Neumorphic)
Framework: React + Tailwind CSS + CVA (class-variance-authority)
Colors:
  --brand-primary: #E58072 (coral/cinnabar)
  --brand-secondary: #7CC4C5 (teal)
  --brand-accent: #E4C899 (rope gold)
  --surface-base: #1E1B18 (warm ebony)
  --surface-raised: #282420
  --text-primary: #E8E0D4
  --text-secondary: #A89E8F
Shadows: neumorphic (raised/flat/inset/floating variants)
Border radius: 8-48px scale (--radius-sm through --radius-4xl)
Fonts: Instrument Sans (display), Inter (body), JetBrains Mono (code)
Icons: Lucide React (NOT emojis)
Animation: Framer Motion
Theme: Dark mode primary, light mode secondary
```

## Priority
Next session: extract shared components, build homepage with Trojan hero.
