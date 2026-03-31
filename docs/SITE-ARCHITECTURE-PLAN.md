# Port Daddy Site Architecture Plan

## Business Context

- **Product:** Multi-agent coordination daemon (ports, sessions, salvage, fleet, pub/sub, tuples, locks, pheromones, formal verification)
- **Primary audiences:**
  1. Solo devs using AI coding agents (Claude Code, Cursor, Aider) — "my port conflicts are killing me"
  2. Teams with multiple AI agents on one repo — "how do we not clobber each other"
  3. Infrastructure engineers evaluating agent coordination — "how does this compare to X"
- **Top 3 goals:** Install conversions, tutorial engagement, blog sharing
- **Growth strategy:** Trojan horse — every entry point installs the full daemon

## Recommended Architecture

```
Homepage (/)                               ← Trojan landing: 6 entry points, install terminal
├── GET STARTED
│   ├── /install                           ← NEW: dedicated install page (brew/npx/mcp/menubar)
│   ├── /quickstart                        ← NEW: 5-minute "pd begin → pd done" walkthrough
│   ├── /tutorials                         ← KEEP: 20 tutorials (strong asset)
│   │   ├── /tutorials/getting-started
│   │   ├── /tutorials/multi-agent
│   │   ├── /tutorials/fleet
│   │   └── ... (18 more)
│   └── /examples                          ← KEEP: code examples
│
├── FEATURES (rename from Documentation)
│   ├── /features/ports                    ← NEW: dedicated feature pages
│   ├── /features/sessions                 ← replaces buried docs pages
│   ├── /features/fleet                    ← the wow-factor page
│   ├── /features/salvage                  ← "Dead Agents Tell Tales" as feature
│   ├── /features/pubsub                   ← event-driven coordination
│   ├── /features/tuples                   ← Linda-style tuple space
│   ├── /features/locks                    ← distributed locks
│   ├── /features/pheromones               ← stigmergic coordination
│   ├── /features/arbiter                  ← formal verification / safety
│   ├── /features/mcp                      ← MOVE from /mcp (becomes feature page)
│   └── /features/dashboard                ← the "3 AM" page
│
├── DOCS (reference, not discovery)
│   ├── /docs/cli                          ← CLI command reference
│   ├── /docs/api                          ← HTTP API reference (OpenAPI)
│   ├── /docs/sdk                          ← JavaScript SDK reference
│   ├── /docs/mcp                          ← MCP tool reference (44 tools)
│   └── /docs/fleet-yaml                   ← pd-fleet.yml schema reference
│
├── COMMUNITY
│   ├── /blog                              ← REDESIGNED: 9 articles with hero images
│   │   └── /blog/:slug
│   ├── /whitepaper                        ← KEEP: Anchor Protocol, Bonded Commons
│   ├── /roadmap                           ← KEEP: V4 unified roadmap
│   └── /agents                            ← KEEP: fleet agent profiles (Spark, Spider, etc.)
│
├── /pricing                               ← NEW: when monetization launches (OSS/Pro/Team)
├── /compare                               ← NEW: vs. manual coordination, vs. nothing
└── /dashboard                             ← KEEP: live daemon viewer
```

## Navigation Spec

### Header Nav (5 items + CTA)

```
[Logo: Port Daddy]   Get Started ▼   Features ▼   Docs ▼   Blog   [★ GitHub]   [Get Started →]
```

**Get Started dropdown:**
- Install (brew, npx, mcp)
- Quickstart (5-minute guide)
- Tutorials
- Examples

**Features dropdown:**
- Ports & Services
- Agent Fleet
- Sessions & Salvage
- Pub/Sub & Tuples
- Locks & Safety
- MCP Integration

**Docs dropdown:**
- CLI Reference
- API Reference
- SDK Reference
- MCP Tools
- Fleet YAML Schema

### Footer (4 columns)

| Product | Learn | Community | Company |
|---------|-------|-----------|---------|
| Features | Quickstart | Blog | About |
| Install | Tutorials | Whitepaper | GitHub |
| Dashboard | API Docs | Roadmap | MIT License |
| MCP Tools | CLI Reference | Agents | — |
| Pricing | SDK Reference | — | — |

## URL Changes (Redirects Needed)

| Old URL | New URL | Reason |
|---------|---------|--------|
| `/mcp` | `/features/mcp` | MCP is a feature, not a top-level section |
| `/docs` (feature pages) | `/features/*` | Features ≠ reference docs |
| `/cookbook` | `/tutorials` (merge) | Recipes are tutorials |
| `/templates` | Consider removing | Low value vs. maintenance cost |
| `/blueprints` | Consider removing | Unclear purpose |
| `/integrations` | `/features` or sub of features | Integrations are features |

## Key Pages to Create

### 1. `/install` — The Trojan Gate

The most important new page. Four tabs:

```
┌──────────────────────────────────────────────────┐
│  INSTALL PORT DADDY                              │
│                                                  │
│  [Homebrew]  [npx]  [MCP]  [Menubar]            │
│                                                  │
│  $ brew install port-daddy                       │
│  $ pd status                                     │
│                                                  │
│  ✓ Daemon runs as launchd service               │
│  ✓ Auto-starts on login                         │
│  ✓ 44 MCP tools for Claude Code                 │
│  ✓ Fleet agents out of the box                  │
│                                                  │
│  After install, try:                             │
│  $ pd claim myapp:api                            │
│  $ pd begin "My first session"                   │
│  $ pd fleet up                                   │
│                                                  │
│  [→ Quickstart Guide]  [→ Full Tutorial]         │
└──────────────────────────────────────────────────┘
```

### 2. `/quickstart` — 5-Minute Path to Value

Stripped-down tutorial. No theory. Just:
1. Install (one command)
2. Claim a port (one command)
3. Start a session (one command)
4. Leave a note (one command)
5. End the session (one command)
6. "You just coordinated your first agent."

### 3. `/features/fleet` — The Wow Page

This is the article-length feature page that showcases Spark + Spider:
- Live fleet status (polls daemon if running)
- Spider's actual syllogisms (embedded from `.spider/connections/`)
- Spark's actual ideas (embedded from `.spark/ideas/`)
- VHS demo GIF of fleet in action
- "Start your fleet" CTA → `/install`

### 4. `/features/tuples` — The Coordination Primitive

Tuples are undersold. This page explains:
- Linda tuple space history (1985 → 2026)
- `out`/`rd`/`in` with interactive examples
- Harbor scoping
- When to use tuples vs pub/sub vs locks
- VHS demo GIF

## Internal Linking Strategy

### Hub-and-Spoke: Blog → Features

Every blog post links to the relevant feature page:
- "Port Collision" → `/features/ports`
- "Dead Agents" → `/features/salvage`
- "Pub/Sub Pipeline" → `/features/pubsub`
- "Fleet Management" → `/features/fleet`
- "Spark & Spider" → `/features/fleet` + `/agents`

### Cross-Section Links

| From | To | Anchor Text |
|------|-----|-------------|
| Feature pages | Tutorials | "Follow the tutorial →" |
| Blog posts | Feature pages | "Learn more about [feature]" |
| Feature pages | API docs | "API Reference →" |
| Tutorials | Blog posts | "Deep dive: [article title]" |
| Install page | Quickstart | "Next: Quickstart →" |
| Quickstart | Tutorials | "Go deeper: [tutorial]" |

### Breadcrumbs

```
Home > Features > Agent Fleet
Home > Blog > Spark and Spider
Home > Tutorials > Getting Started
Home > Docs > CLI Reference
```

## Homepage Redesign Implications

The homepage should serve the Trojan strategy:

```
┌─────────────────────────────────────────────────────────────┐
│  HERO: "The harbormaster for your AI agents"               │
│  Install terminal (brew/npx/mcp tabs)                      │
│  [Get Started →]  [Star on GitHub]                          │
├─────────────────────────────────────────────────────────────┤
│  SIX SUPERPOWERS GRID                                       │
│  (same as blog page "One daemon. Six superpowers.")         │
│  Port Manager | Fleet | Pub/Sub | Safety | Salvage | MCP   │
├─────────────────────────────────────────────────────────────┤
│  TERMINAL DEMO (VHS GIF or live asciinema)                  │
│  Shows: pd begin → note → whoami → done                    │
├─────────────────────────────────────────────────────────────┤
│  FEATURED BLOG POST (latest article with hero image)        │
├─────────────────────────────────────────────────────────────┤
│  SOCIAL PROOF / STATS                                       │
│  "3,700+ tests" | "9 formal proofs" | "44 MCP tools"       │
├─────────────────────────────────────────────────────────────┤
│  DOCS CTA: API Docs | Tutorials | MCP Tools                │
└─────────────────────────────────────────────────────────────┘
```

The install terminal and six superpowers section I built on the blog page should be **extracted as shared components** and used on both the homepage and blog page.

## Implementation Priority

| Page | Effort | Impact | Priority |
|------|--------|--------|----------|
| `/install` | 2-3 hours | Very High | 1 |
| `/quickstart` | 2-3 hours | Very High | 2 |
| Homepage redesign (add install + superpowers) | 3-4 hours | Very High | 3 |
| `/features/fleet` | 3-4 hours | High | 4 |
| `/features/tuples` | 2-3 hours | Medium | 5 |
| Remaining feature pages | 1-2 hours each | Medium | 6 |
| Nav restructure | 2-3 hours | Medium | 7 |
| `/compare` | 3-4 hours | Medium | 8 |
| `/pricing` | Deferred | Deferred | — |

## 21st.dev Component Opportunities

Components to source or reference from 21st.dev for the new pages:

1. **Install terminal with tabs** — already built, could be improved with 21st.dev terminal components
2. **Feature cards with icons** — neumorphic cards with hover animations
3. **Comparison table** — for `/compare` page (vs. manual, vs. nothing)
4. **Stats counter** — animated numbers for social proof (3700+ tests, etc.)
5. **Hero section with background particles/ships** — maritime themed, animated
6. **Testimonial cards** — when we have user quotes
7. **Pricing table** — when monetization launches

All should use the Harbor Heritage design system: sandstone, cinnabar, teal, warm ebony, neumorphic shadows, CVA variants.
