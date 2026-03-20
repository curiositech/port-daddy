# Neumorphic Overhaul DAG — 2026-03-20

## Level 1 — Overview

```
╔══════════════════════════════════════════════════════════════════╗
║              PORT DADDY WEBSITE — NEUMORPHIC OVERHAUL           ║
╚══════════════════════════════════════════════════════════════════╝

  ┌─────────────────────────────────────────────────────────────┐
  │  WAVE 1 ─ FOUNDATION                        3 agents       │
  │  Tokens · Navigation · Contrast                             │
  └──────────────────────────┬──────────────────────────────────┘
                             │
                        < merge >
                             │
  ┌──────────────────────────┴──────────────────────────────────┐
  │  WAVE 2 ─ CONTENT                           3 agents       │
  │  Tutorials · Links · Docs Architecture                      │
  └─────────────────────────────────────────────────────────────┘
                             │
                             v
                    ┌─────────────────┐
                    │  BUILD + DEPLOY │
                    └─────────────────┘
```

## Level 2 — Agents

```
 WAVE 1 ----------------------------------------------------------------

 ┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
 │ A  Neumorphic Tokens │ │ B  Nav & Docs Shell  │ │ C  Contrast Surgeon  │
 │                      │ │                      │ │                      │
 │ Light bg #e0e0e0     │ │ Fix dropdown hover   │ │ Fix ALL contrast     │
 │ Soft shadows         │ │ Add nav to docs      │ │ Terminals readable   │
 │ Warm palette         │ │ Fix sidebar stub     │ │ Code blocks visible  │
 │ Kill dark teal-black │ │                      │ │ CTA heading visible  │
 └──────────┬───────────┘ └──────────┬───────────┘ └──────────┬───────────┘
            │                        │                        │
            └────────────────────────┼────────────────────────┘
                                     │
                                < merge >
                                     │
 WAVE 2 ─────────────────────────────┼─────────────────────────────────────

 ┌──────────────────────┐ ┌──────────┴───────────┐ ┌──────────────────────┐
 │ D  Tutorial Doctor   │ │ E  Link Reaper       │ │ F  Docs Architect    │
 │                      │ │                      │ │                      │
 │ Merge tuts #1 & #2   │ │ Kill dead links      │ │ Features first       │
 │ Scroll-to-top on Next│ │ Fix ecosystem links  │ │ Then CLI/SDK/MCP     │
 │ Render markdown bold │ │ Fix community section│ │ Make it navigable    │
 │ Add pd install       │ │ Fix blog links       │ │                      │
 └──────────┬───────────┘ └──────────┬───────────┘ └──────────┬───────────┘
            │                        │                        │
            └────────────────────────┼────────────────────────┘
                                     │
                                     v
                            ┌─────────────────┐
                            │  BUILD + DEPLOY  │
                            └─────────────────┘
```

## Level 3 — Detail

### Agent A: Neumorphic Tokens
- **Files**: tokens.css, index.css, Hero.tsx, Features.tsx, CTABanner.tsx, App.tsx
- **Tasks**: bg #e0e0e0, soft shadow tokens, warm teal accent, neumorphic utilities
- **Must not touch**: Nav.tsx, DocsLayout.tsx, tutorial pages, CodeBlock.tsx

### Agent B: Nav & Docs Shell
- **Files**: Nav.tsx, DocsLayout.tsx, TutorialLayout.tsx
- **Tasks**: Fix dropdown delay, add nav to docs, fix right sidebar placeholder
- **Must not touch**: tokens.css, index.css, Hero.tsx, Features.tsx

### Agent C: Contrast Surgeon
- **Files**: CodeBlock.tsx, tokens.css (light section only), tutorials/*.tsx, pages/*.tsx
- **Tasks**: Light mode terminals, code blocks, gray-on-gray text, CTA heading
- **Must not touch**: Hero.tsx, Features.tsx, CTABanner.tsx, Nav.tsx

### Agent D: Tutorial Doctor
- **Files**: GettingStarted.tsx, MultiAgentOrchestration.tsx, TutorialLayout.tsx
- **Tasks**: Merge tuts #1/#2, scroll-to-top, **bold** rendering, pd install
- **Must not touch**: tokens.css, index.css, Nav.tsx, CodeBlock.tsx

### Agent E: Link Reaper
- **Files**: Footer.tsx, Nav.tsx, integrations/*.tsx, blog/*.tsx, cookbook/*.tsx, main.tsx
- **Tasks**: Kill all dead links, fix ecosystem links, fix community section
- **Must not touch**: tokens.css, index.css, Hero.tsx, Features.tsx

### Agent F: Docs Architect
- **Files**: DocsOverview.tsx, DocsLayout.tsx, data/docs.ts
- **Tasks**: Features first, then CLI/SDK/MCP, make navigable
- **Must not touch**: tokens.css, index.css, tutorial content, CodeBlock.tsx

## File Conflict Matrix

| File | A | B | C | D | E | F |
|------|---|---|---|---|---|---|
| tokens.css | W1:full | - | W1:light | - | - | - |
| index.css | W1 | - | - | - | - | - |
| Hero.tsx | W1 | - | - | - | - | - |
| Features.tsx | W1 | - | - | - | - | - |
| CTABanner.tsx | W1 | - | - | - | - | - |
| Nav.tsx | - | W1 | - | - | W2:links | - |
| DocsLayout.tsx | - | W1 | - | - | - | W2 |
| TutorialLayout.tsx | - | W1 | - | W2 | - | - |
| CodeBlock.tsx | - | - | W1 | - | - | - |
| GettingStarted.tsx | - | - | - | W2 | - | - |
| Footer.tsx | - | - | - | - | W2 | - |
| DocsOverview.tsx | - | - | - | - | - | W2 |

Conflicts: tokens.css shared between A (full) and C (light only) in Wave 1.
Resolution: Merge A first, then C patches light section only.
