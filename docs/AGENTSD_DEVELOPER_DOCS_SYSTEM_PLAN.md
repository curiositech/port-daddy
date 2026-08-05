# agentsd Developer Docs System Plan

Last updated: 2026-04-12
Status: Quarantined planning document for a possible `agentsd.ai` docs rebuild
Owner: current Codex working session

This plan is design-target research, not implementation authority for the current `website-v2` public shell.
It should inform a deliberate docs-system migration, not silently redefine live route truth.

## Why this exists

The experimental `agentsd.ai` docs-shell direction is structurally cleaner than the older site, but it is still too shallow to function as real developer documentation.

The failure mode is straightforward:

- too much explanation compressed into too few pages
- no clear separation between overview, conceptual explanation, task guides, examples, and reference
- too much salvageable documentation trapped in the old route forest
- not enough opinionated migration planning for how to turn existing Port Daddy material into a durable docs system

This document defines the target information architecture, the migration principle, and the implementation workstreams.

## Reference model

The target shape is closer to Cloudflare Durable Objects than to a startup marketing-doc hybrid.

The important pattern is not “copy Cloudflare’s visual style.”

The important pattern is:

- short overview pages
- fast get-started paths
- concepts separated from how-to content
- best practices separated from conceptual explanation
- examples with runnable code
- tutorials for multi-step builds
- reference architectures with diagrams
- machine-readable docs exports

## Non-goals

This plan is not trying to:

- restore the old `website-v2` route forest
- turn the docs shell into a blog or changelog graveyard
- put the entire internal roadmap on the public site
- let reference pages dictate the landing-page IA

## Core rule

Port Daddy docs must follow Diataxis and product workflows at the same time.

That means every public docs artifact belongs primarily to one of these buckets:

- Overview
- Get started
- Concepts
- Best practices
- Examples
- Tutorials
- Reference architectures
- Reference

If a page tries to be three of those at once, it needs to be split.

## Target public docs IA

All of this stays under `/docs/**`.

### 1. Overview

Purpose:

- explain what agentsd is
- explain what problem it solves
- explain what is true now
- route the reader into the right next section

Must not:

- carry reference detail
- pretend to teach operations by itself
- bury the protocol story

Candidate routes:

- `/docs`
- `/docs/whitepaper`

### 2. Get Started

Purpose:

- install the daemon
- verify the live runtime
- perform the first meaningful operator loop
- confirm that the reader is talking to the actual daemon, not stale code

Must contain:

- exact install command
- verification command set
- first successful workflow
- troubleshooting for stale daemon / stale CLI / wrong runtime

Candidate routes:

- `/docs/get-started`

### 3. Concepts

Purpose:

- explain the control-plane model
- explain the core primitives
- explain how identity, sessions, locks, tuples, messaging, fleet, and harbors fit together

Must not:

- become command reference
- become tutorial prose

Candidate routes:

- `/docs/concepts`
- deeper concept leaves under `/docs/concepts/*`

### 4. Best Practices

Purpose:

- teach operator discipline
- teach repo hygiene
- teach canonical-runtime verification
- teach promotion and recovery patterns
- teach how not to lie to yourself with stale state

Candidate routes:

- `/docs/best-practices`
- `/docs/best-practices/canonical-runtime`
- `/docs/best-practices/promotion`
- `/docs/best-practices/recovery`
- `/docs/best-practices/multi-agent-coordination`

### 5. Examples

Purpose:

- small, bounded, runnable code examples
- one problem per example
- complete code, not pseudo-code

Examples should look like:

- “Claim a port and publish service metadata”
- “Create a harbor and mint a card”
- “Use tuples for agent coordination”
- “Watch a git commit channel and trigger a job”
- “Send and consume agent notes”
- “Spawn an agent with bounded budget”

Candidate routes:

- `/docs/examples`
- one leaf per example under `/docs/examples/*`

### 6. Tutorials

Purpose:

- multi-step build or workflow documents
- longer than examples
- outcome-oriented
- should feel like “build a real thing” or “run a real operator workflow”

Tutorial classes:

- first fleet for a repo
- multi-agent code review loop
- harbor-secured local agent collaboration
- commit-triggered background fleet
- monorepo coordination
- recovery after a crashed agent session

Candidate routes:

- `/docs/tutorials`
- one leaf per tutorial under `/docs/tutorials/*`

### 7. Reference Architectures

Purpose:

- show complete system compositions
- explain how multiple Port Daddy features combine
- include diagrams and component responsibilities

Examples:

- local-first single-repo operator setup
- commit-driven fleet architecture
- harbor-gated multi-agent workflow
- cross-machine future-state target architecture

Candidate routes:

- `/docs/reference-architectures`
- one leaf per architecture under `/docs/reference-architectures/*`

### 8. Reference

Purpose:

- fast fact lookup
- exhaustive, structured, searchable material

Sub-buckets:

- CLI reference
- SDK reference
- MCP reference
- daemon/API reference
- config reference
- limits
- troubleshooting
- FAQ
- glossary

Candidate routes:

- `/docs/reference`
- generated leaves under `/docs/reference/*`

### 9. LLM exports

Purpose:

- model-readable navigation and offline ingestion

Required exports:

- `/docs/llms.txt`
- `/docs/llms-full.txt`

These should be generated from the same content registry or collection source as the human docs.

## Migration principle

Do not rewrite the whole doc system from scratch in one giant pass.

Instead:

1. Keep the tiny public route contract for the rebuild target.
2. Expand the docs subtree into the real IA above.
3. Salvage existing material aggressively where it is truthful.
4. Split encyclopedic pages into the correct doc types.
5. Delete or quarantine stale route families instead of dragging them along.

## What already exists in the repo

The repo already contains the raw material for a proper docs system:

- a reduced public docs shell under `website-v2/src/pages/docs/DocsOverview.tsx` and `DocsSectionPage.tsx`
- a content registry in `website-v2/src/data/publicSite.ts`
- a large older docs/reference/tutorial forest under `website-v2/src/pages/docs/**` and `website-v2/src/pages/tutorials/**`
- many reference-page components already structured around commands, SDK calls, and MCP tools

The implementation mistake would be pretending none of that exists.

The other implementation mistake would be surfacing all of it as-is.

## Workstreams

### Workstream A: Information Architecture and content registry

Goal:

- define the permanent docs tree
- define metadata for every docs page
- separate doc types cleanly

Deliverables:

- docs IA registry
- route-generation plan
- section metadata schema
- nav-generation rules

### Workstream B: Overview and whitepaper surfaces

Goal:

- make the overview and whitepaper short, truthful, and routing-focused

Deliverables:

- `/docs`
- `/docs/whitepaper`
- “current runtime vs design target” rules for public truth

### Workstream C: Get-started and best-practices path

Goal:

- create the shortest credible path from install to first meaningful operator success

Deliverables:

- install
- verify
- first workflow
- troubleshooting
- operator discipline / best-practices subtree

### Workstream D: Concepts

Goal:

- explain the model clearly without turning concept pages into references

Deliverables:

- control-plane model
- sessions / locks / tuples / messaging
- fleet
- harbors
- identity / discovery

### Workstream E: Examples

Goal:

- produce complete runnable examples for specific use cases

Deliverables:

- examples index
- code-backed example leaves
- verification standard so examples remain truthful

### Workstream F: Tutorials

Goal:

- convert long-form workflow content into guided outcome-oriented docs

Deliverables:

- tutorials index
- curated tutorial set
- progression rules from beginner to advanced

### Workstream G: Reference architectures

Goal:

- create diagram-backed “how features combine” pages

Deliverables:

- architecture catalog
- canonical diagrams
- explicit “current runtime” vs “future target” marking

### Workstream H: Reference generation

Goal:

- stop hand-maintaining route soup where structured generation is the right answer

Deliverables:

- CLI/SDK/MCP/reference content model
- generated nav
- generated `llms.txt` / `llms-full.txt`

## First implementation sequence

### Phase 1: Stop the architecture mistake

- finalize IA contract
- wire the public docs tree around the new section model
- stop treating `/docs` as a catch-all explanation page

### Phase 2: Get-started + best-practices + whitepaper

- these are the highest-value sections for credibility and operator success

### Phase 3: Concepts + examples

- concepts make the product understandable
- examples make it feel usable

### Phase 4: Tutorials + reference architectures

- these take longer and need better curation

### Phase 5: Generated reference + LLM exports

- this is where the docs system becomes durable instead of artisanal

## Live subagent assignments

These are the current discovery assignments launched from this session.

### `Kuhn`

Task:

- audit current docs/content surface
- classify content into salvage now / salvage later / likely delete

### `Ampere`

Task:

- inventory examples, tutorials, and demo-worthy workflows
- identify what can become examples/tutorials/reference architectures

### `Mill`

Task:

- design the target docs IA tree
- identify anti-patterns that make the docs feel like marketing or encyclopedia pages instead of developer docs

## Discovery synthesis

The discovery pass established three important truths:

1. The current curated docs surface under `/docs/**` is small and real.
   - router truth lives in `website-v2/src/main.tsx`
   - active docs metadata lives in `website-v2/src/data/publicSite.ts`
   - the curated docs families are much smaller than the dormant on-disk docs forest
2. The repo already contains a large amount of salvageable material, but it is unevenly trustworthy.
   - high-confidence raw material lives in `docs/`, `examples/`, `demos/`, and a subset of `templates/`
   - the legacy website tutorial forest under `website-v2/src/pages/tutorials/**` is source material, not publishable truth
3. The next correct move is curation plus restructuring, not another giant rewrite.
   - keep `/docs/**` as the only public docs family
   - promote only source-backed material
   - split orientation, explanation, task guides, examples, tutorials, architectures, and reference instead of compressing them into a few overloaded pages

### Salvage now

- `website-v2/src/main.tsx`
- `website-v2/src/pages/docs/DocsOverview.tsx`
- `website-v2/src/pages/docs/DocsSectionPage.tsx`
- `website-v2/src/data/publicSite.ts`
- `docs/AGENTSD_AI_SITE_CONTRACT.md`
- `docs/SECURITY_SOUNDNESS.md`
- `docs/DELEGATION-MODES.md`
- `docs/sdk.md`
- `docs/openapi.yaml`
- `docs/reports/PORT_DADDY_ANCHOR_WHITEPAPER.md`
- `docs/reports/FORMAL_VERIFICATION_ANCHOR_V3.md`
- `examples/coordination/**`
- `examples/inbox/**`
- `examples/locks/**`
- `examples/services/**`
- `examples/dns/**`
- `demos/tapes/quickstart.tape`

### Salvage later

- `website-v2/src/data/docs.ts`
- `website-v2/src/pages/docs/cli/**`
- `website-v2/src/pages/docs/sdk/**`
- `website-v2/src/pages/docs/mcp/**`
- `website-v2/src/pages/docs/features/**`
- `website-v2/src/pages/docs/guides/**`
- `website-v2/src/data/tutorials.ts`
- `website-v2/src/pages/tutorials/**`
- `website-v2/src/components/tutorials/**`
- `templates/always-on-dispatcher/README.md`
- `templates/event-driven-ops/README.md`
- `templates/ai-ci-pipeline/README.md`
- `docs/adr/**`
- `docs/DAEMON-MESH-ARCHITECTURE.md`
- `docs/IPC-PROTOCOL-DESIGN.md`
- `docs/FLEET-CSP-PROTOCOL.md`

### Delete, archive, or quarantine

- dead top-level website pages outside `/docs/**`
- roadmap/planning/marketing docs that are not developer docs
- stale `website-v2/public/llms.txt` and any `llms` export that points at non-existent routes
- dormant tutorial pages that assert commands or product surfaces not present in code

## Curation rules

Every promoted docs artifact must be classified before it is rewritten:

- `promote now`
  - source-backed, currently truthful, directly useful
- `rewrite before promotion`
  - grounded in real code, but the current writeup is stale, bloated, or mixed-doc-type
- `archive as aspirational`
  - valuable design target, not current product truth
- `delete`
  - dead route residue, duplicate explanation, or misleading product claim

Every page must answer one user job:

- `Overview`: should I care?
- `Get Started`: can I make it work?
- `Concepts`: do I understand the model?
- `Best Practices`: how do I avoid mistakes?
- `Examples`: how do I use one primitive?
- `Tutorials`: how do I build something real?
- `Reference Architectures`: what does a good system shape look like?
- `Reference`: what is the exact contract?

## Implementation backlog

This backlog is intentionally high-signal and route-first. It is not a giant issue cemetery.

### D1. Docs registry and route model

Goal:

- replace the current flat docs registry with a docs-tree model that can express section families under `/docs/**`

Owns:

- `website-v2/src/data/publicSite.ts`
- new docs-tree metadata or registry files under `website-v2/src/data/`
- route tests that prove only `/` and `/docs/**` exist publicly

Done means:

- every planned docs family exists in metadata even if some leaves remain hidden until content is ready
- overview/get-started/concepts/best-practices/examples/tutorials/reference-architectures/reference/whitepaper are first-class doc families
- no new top-level public routes are introduced

### D2. Overview and whitepaper surfacing

Goal:

- make `/docs` a real orientation page and elevate the whitepaper as a top-line technical artifact

Owns:

- `website-v2/src/pages/docs/DocsOverview.tsx`
- `website-v2/src/pages/docs/DocsSectionPage.tsx`
- whitepaper routing copy in the docs shell

Done means:

- `/docs` routes readers into the real docs families
- whitepaper is visible from overview and homepage-adjacent docs entry points
- no vague category copy like "serious evaluation" or "compatibility" survives without concrete meaning

### D3. Get Started and Best Practices

Goal:

- give a skeptical engineer a short path from install to verified runtime truth, then operator discipline

Owns:

- `Get Started` subtree copy and structure
- `Best Practices` subtree copy and structure

Done means:

- install, verify-runtime, first session, first harbor or coordination success, and troubleshooting are explicit
- best-practices pages distill repo rules into developer-doc language instead of copying AGENTS.md verbatim
- all commands and claims are checked against code

### D4. Concepts taxonomy

Goal:

- define the stable mental model pages without mixing them with setup or reference

Owns:

- concepts taxonomy
- concept page contracts
- concept-to-reference cross-links

Done means:

- control plane vs data plane, sessions, harbors, tuples, pheromones, locks, fleet scoping, and delegation modes each have a clear home
- concept pages explain boundaries and relationships, not command syntax

### D5. First examples set

Goal:

- publish the first five truly source-backed examples

Priority examples:

- session lifecycle
- salvage and recovery
- file-edit coordination
- inbox messaging
- service orchestration

Missing examples that should be built immediately after:

- tuples end-to-end
- Phase 2 harbor entry and verification
- fleet bootstrap from scratch
- watch-driven workflow
- pheromone runnable example

Done means:

- each example has exact files, exact commands, expected output, and "when to use this"
- examples are tied to real code in `examples/**` or `demos/**`, not pseudo-product prose

### D6. Tutorial and reference-architecture curation

Goal:

- separate longer build flows from architecture pages and delete aspirational bleed

Likely first tutorials:

- first fleet for a repo
- budgeted one-shot agents
- operator recovery after a dead session

Likely first reference architectures:

- single-developer local control plane
- small-team shared fleet
- monorepo service stack

Done means:

- tutorial pages produce a real outcome in 20 to 60 minutes
- architecture pages are diagram-backed and explicit about current-runtime truth versus future target

### D7. Reference and LLM exports

Goal:

- make the exact surface searchable and machine-readable without maintaining parallel truths by hand

Owns:

- generated or normalized CLI/API/MCP/SDK/config/reference surfaces
- `website-v2/public/llms.txt`
- `website-v2/public/llms-full.txt`

Done means:

- `llms.txt` is a curated index of real docs pages
- `llms-full.txt` is generated from the same docs source of truth
- no export points at dead routes or stale product claims

## Publication order

This is the current forced ranking for what should become real public docs first after the registry work:

1. `Get Started`
   - first because it creates first success, validates runtime truth, and stops the docs from being purely theoretical
2. `Whitepaper`
   - second because it is the top-line technical artifact and belongs near the top of the funnel, not buried
3. `Examples`
   - third because the repo already has source-backed material here and examples are closer to promotable than the tutorial surface
4. `Best Practices`
   - fourth because Port Daddy is unusually sensitive to operator discipline and stale-runtime failure modes
5. `Concepts`
   - fifth because concept pages are necessary, but they should follow first success and first trust
6. `Reference`
   - sixth because exact-surface lookup matters once the first guidance families exist
7. `Reference Architectures`
   - seventh because these need diagram curation and current-vs-future boundary marking
8. `Tutorials`
   - eighth because the legacy tutorial tree has the highest drift and needs the most curation before promotion

Supporting artifact:

- `docs/reports/D5-D6-PROMOTION-MATRIX.md`

## Implementation-agent assignments

These are the bounded slices that should run next. Ownership is disjoint on purpose.

### `Carver` -> D1 Docs registry and route model

Write scope:

- `website-v2/src/data/**`
- docs-shell route tests

Constraints:

- do not touch homepage visuals
- do not create top-level routes outside `/docs/**`
- encode doc family metadata so future content work does not require ad hoc routing

### `Singer` -> D3 Get Started and Best Practices outline

Write scope:

- docs planning artifacts only for now
- content-outline files or structured notes for `Get Started` and `Best Practices`

Constraints:

- no invented commands
- every step must map to code or tested CLI surface
- keep doc types clean: task guides separate from explanations

### `Tesla` -> D5/D6 curation matrix

Write scope:

- docs planning artifacts only for now
- examples/tutorials/reference-architectures promotion matrix

Constraints:

- classify every candidate as `promote now`, `rewrite before promotion`, `archive as aspirational`, or `delete`
- explicitly call out missing but required examples
- use repo truth, not localhost assumptions

Once the discovery audits land, the next worker agents should be assigned these bounded slices:

1. Registry worker
   - own the docs metadata schema and generated tree
   - files: `website-v2/src/data/*`, docs route registry, nav generation

2. Overview/whitepaper worker
   - own `/docs` and `/docs/whitepaper`
   - keep both pages short and routing-focused

3. Get-started/best-practices worker
   - own install, verification, first workflow, and operator discipline docs

4. Concepts worker
   - own concept pages and concept taxonomy

5. Examples worker
   - own examples index plus first 3 to 5 complete examples

6. Tutorials worker
   - own tutorial migration and sequencing

7. Reference-generation worker
   - own CLI/SDK/MCP content normalization plus `llms.txt` export path

## Standards

Every section in the new system must satisfy:

- correct doc type
- current-runtime truthfulness
- explicit future-state boundaries where needed
- component-library-only rendering
- Storybook coverage for reusable doc primitives
- semantic tokens only
- strong accessibility and contrast
- examples that actually run

## Success condition

Port Daddy documentation is successful when:

- a developer can get from zero to a live daemon quickly
- a skeptical engineer can understand the model without reading the whole site
- an operator can learn safe usage patterns
- a builder can copy complete examples
- a deeper evaluator can inspect tutorials and reference architectures
- an LLM can index the documentation without scraping decorative page chrome
