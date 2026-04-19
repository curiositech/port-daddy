# agentsd.ai Site Contract

Last updated: 2026-04-11
Status: Quarantined design-target contract for a possible `agentsd.ai` rebuild
Authoring session: `port-daddy:agentsd-shell-audit`

This document is reset research, not implementation authority for the current `website-v2` shell.
Use it to guide a deliberate future rebuild, not to overwrite live route/runtime truth by implication.

## Purpose

This document prevents the next public site from repeating the structural failures of the older `portdaddy.dev` surface.

It is intentionally strict.

The problem was not just weak copy. The problem was too many page families, too many hand-wired routes, too many layout exceptions, and no durable content contract separating current runtime truth from target architecture.

Current broad-shell condition in code that motivated this proposal:

- `website-v2/src/main.tsx` hand-wires `153` explicit routes.
- `website-v2/src/main.tsx` mixes landing, dashboard, examples, MCP marketing, roadmap, templates, agents, tutorials, cookbook, integrations, blog, whitepaper, and docs into one public router.
- `website-v2/src/components/docs/DocsLayout.tsx` mixes reader jobs, product marketing, and exhaustive command trees into one sidebar taxonomy.

That architecture is banned for `agentsd.ai`.

## Non-Negotiable Rules

### 1. Tiny public route surface

`agentsd.ai` gets exactly two public route families:

- `/`
- `/docs/**`

Allowed first-wave docs sections:

- `/docs`
- `/docs/getting-started`
- `/docs/concepts`
- `/docs/best-practices`
- `/docs/examples`
- `/docs/tutorials`
- `/docs/reference-architectures`
- `/docs/guides`
- `/docs/reference`
- `/docs/security`
- `/docs/architecture`
- `/docs/operations`
- `/docs/llms.txt`
- `/docs/llms-full.txt`

Everything else is disallowed by default:

- no `/blog`
- no `/tutorials`
- no `/examples`
- no `/roadmap`
- no `/templates`
- no `/agents`
- no `/dashboard`
- no `/cookbook`
- no `/integrations`
- no `/whitepaper` as a separate top-level public product route

If any of those return later, they must be justified in writing and fit under `/docs/**` or a separately approved product surface.

### 2. No hand-maintained route jungle

The public site must not import and wire dozens of pages manually in the app entry point.

Banned pattern:

- a giant router file like `website-v2/src/main.tsx` importing every leaf page individually

Required pattern:

- one landing shell
- one docs shell
- content collections or a structured page registry
- generated nav from metadata, not handwritten route soup

Reference leaves are allowed only when they are generated from structured content and rendered through one reference template.

### 3. Layout freedom is removed

Allowed public page templates:

- Landing overview
- Docs overview
- Concept page
- Guide page
- Reference page

No custom layout is permitted outside these templates without an explicit design review.

Allowed UI composition primitives:

- library layout components
- library section primitives
- library typography primitives
- library interactive primitives

The page layer may compose primitives. It may not invent a visual language.

### 4. No ad hoc page markup

Semantic HTML is still required, but it must live inside vetted React components and layout primitives.

The rule is:

- no freehand page-level HTML structures outside the component library
- no one-off marketing sections built directly in page files
- no raw presentational div soup with local styling logic

Every public section must come from the component library and be storyable in isolation.

### 5. One primitive layer only

Public interactive primitives standardize on:

- React
- Radix primitives
- Tailwind
- semantic design tokens

Do not mix Radix with a second headless primitive system on the same public site.

`shadcn/ui` may be used as scaffolding or a feeder pattern, but it is not the design system. The repo owns the design system.

### 5.5 Recommended baseline stack

Preferred baseline for the rebuild:

- React
- Tailwind
- Radix
- Storybook
- semantic token layer owned by this repo

Preferred docs-shell direction if the site is replatformed:

- Fumadocs or an equivalent content-collection docs system

The point is not the brand name of the framework. The point is:

- generated nav from structured content
- shared docs templates
- stable reference rendering
- no manual route forest

### 6. Storybook is mandatory

Every public primitive and every reusable public section pattern must exist in Storybook before or at the same time it ships.

Required categories:

- Typography
- Tokens
- Buttons
- Inputs
- Navigation
- Cards / surfaces
- Code blocks
- Tables
- Doc callouts
- Section headers
- Hero variants
- Proof/diagram modules
- Footer / header shells

No story means no public component.

### 7. Tokens only

Public-site styling must flow through semantic tokens.

Banned:

- raw hex literals in component code
- raw RGB/OKLCH literals in page files
- one-off spacing systems
- per-page shadow systems
- local typography hacks

Required:

- semantic color tokens
- semantic spacing scale
- semantic type scale
- semantic radius/elevation tokens
- semantic motion tokens

### 8. Accessibility is a ship gate

Minimum requirements:

- keyboard-complete navigation
- visible focus states
- semantic landmarks
- accessible names for all interactive controls
- dark mode parity
- `font-optical-sizing: auto` where variable fonts support it
- WCAG AAA target for body text, nav text, code text, controls, and documentation surfaces

Decorative accent planes may be exempt only when they contain no critical text or controls.

### 9. Truth labels are required

Every substantive claim must be explicitly classed as one of:

- `Current Runtime`
- `Compatibility`
- `Design Target`

The site may not blur:

- current runtime behavior
- compatibility-only behavior
- future design targets

This was one of the old site's worst habits and is now banned.

### 10. The website is not the roadmap

The public site exists to explain the product and help operators succeed.

It is not:

- a dumping ground for internal plans
- a chat transcript graveyard
- a speculative manifesto
- a giant marketing landfill

Roadmap material stays internal unless promoted intentionally and rewritten as public truth.

## Information Architecture

### `/`

The landing page has one job:

- explain what `agentsd` is
- show why it matters
- show what is verifiably true now
- get the reader into docs

Allowed landing sections:

- Value proposition
- Operator proof
- Architecture snapshot
- Security/trust snapshot
- Product boundaries
- Docs CTA

Not allowed on first launch:

- pricing grid
- feature cemetery
- endless scrolling manifesto
- blog excerpts
- fake social proof
- roadmap theater

### `/docs`

The docs shell is the real product surface.

The quality bar is closer to Cloudflare and Firecrawl than to a typical startup docs afterthought:

- Overview that orients the reader quickly
- Get-started paths that actually get a live daemon running
- Concepts that explain the control-plane model
- Best-practices guidance for operator discipline and safe usage
- Examples with complete, runnable code for discrete tasks
- Tutorials for longer multi-step workflows
- Reference architectures / demos with diagrams and end-to-end compositions
- Reference material for CLI, SDK, MCP, daemon APIs, limits, and troubleshooting
- `llms.txt` and `llms-full.txt` exports for model-readable navigation and indexing

- task-first
- precise
- consistent
- navigable
- low-drama
- high signal

The nav should reflect reader jobs, in this order:

1. Getting Started
2. Concepts
3. Guides
4. Reference
5. Security
6. Architecture
7. Operations

### Section purposes

`Getting Started`

- shortest path to first success
- install, verify daemon, run a real operator loop

`Concepts`

- daemon
- harbors
- fleet
- tuples
- arbiter
- delegation modes

`Guides`

- task-oriented workflows
- operator playbooks
- no encyclopedic dumping

`Reference`

- CLI
- SDK
- MCP
- config
- API

`Security`

- protocol status
- threat model
- current vs target trust boundaries
- explicit limits

`Architecture`

- system diagrams
- runtime boundaries
- transport/control-plane relationships

`Operations`

- promotion
- stable rehab
- health checks
- troubleshooting
- runtime verification

## Visual System Rules

### Design stance

Public `agentsd` should read as:

- Swiss modern in structure
- neobrutalist in emphasis
- operator-grade, not startup-cute

### Keep from the `v0-agentsd-main` direction

- paper-toned ground
- hard black rules
- electric cobalt accent
- acid-lime accent
- severe typography hierarchy
- section rails and modular proof blocks
- diagrammatic composition

### Reject from the old public site

- maritime nostalgia as the public-facing visual voice
- soft neumorphism
- decorative layout drift
- too many accent colors
- gradient-heavy identity
- page-by-page reinvention

## Component-System Contract

Public UI must be assembled from a finite library of components:

- `PageShell`
- `DocsShell`
- `SectionHeader`
- `HeroBlock`
- `ProofPanel`
- `ArchitectureDiagramFrame`
- `Callout`
- `CodeBlock`
- `DataTable`
- `NavBar`
- `Footer`
- `Button`
- `Badge`
- `Tabs`
- `Accordion`
- `Dialog`

Every section on the landing page should be expressible as composition of these primitives.

If a section cannot be composed from library primitives, the primitive set changes first. The page does not get a one-off exception.

## Content Governance

### Allowed public sources of truth

- committed code
- committed tests
- committed protocol analyses
- committed docs explicitly marked as current public truth

### Disallowed public sources of truth

- random markdown in the repo
- stale roadmap notes
- generated spider/spark residue
- chat memory
- half-finished mocks

### Public-claim requirement

Each major docs/landing section should carry or derive:

- source file(s)
- truth class (`current`, `compat`, `target`)
- last verification date if the claim is operational

## Immediate pruning plan

### Phase 0: Freeze the failure case

Treat the current `website-v2` route sprawl as legacy, not as architecture to preserve.

### Phase 1: Build the new shell

Create:

- one landing shell
- one docs shell
- one reference renderer
- one docs metadata registry

### Phase 2: Delete by category

Public categories to remove or quarantine from the new shell:

- tutorials academy
- examples
- roadmap
- blog
- cookbook
- integrations marketing
- templates marketing
- whitepaper top-level route

Some of this content may survive as docs pages after rewrite, but the old page families should not survive intact.

### Phase 3: Reintroduce only through approved templates

If a concept deserves a page, it must fit:

- an approved docs section
- an approved template
- a sourced truth class

## CI / enforcement requirements

The new site should fail CI when:

- page files use raw color literals
- page files introduce unapproved layout primitives
- public components lack Storybook stories
- public routes exceed the approved family budget
- public content lacks truth classification metadata
- contrast checks fail on core text surfaces
- links break

## Acceptance criteria

A rebuild based on this contract is considered structurally healthy when:

- the public router has only `/` and `/docs/**`
- all public pages map to the approved template set
- the page layer contains no one-off section styling
- Storybook covers the public primitives and section modules
- the docs nav reflects reader jobs instead of product archaeology
- no public claim depends on unsourced repo residue

## Relationship to Port Daddy

`agentsd.ai` is the public product surface.

`Port Daddy` remains:

- the internal repo name
- the implementation lineage
- the CLI and daemon/operator heritage

The new site should not erase that lineage, but it must not inherit the old public site's information architecture or marketing sprawl.
