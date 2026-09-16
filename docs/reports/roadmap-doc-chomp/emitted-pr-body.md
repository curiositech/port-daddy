## Summary

Chomp planning docs into the roadmap DB-of-record and remove them from the repo
(`pd roadmap chomp`). The docs below were parsed into 121 roadmap item(s)
(121 new, 0 pre-existing and left untouched) in harbor `port-daddy`,
with hierarchy (parent_of) and explicit dependencies extracted from the doc structure.
Per ADR-0033 the `roadmap_items` table is the source of truth and markdown is a render,
so the source docs are deleted here and the committed roadmap snapshot is regenerated
in their place.

Docs chomped (removed by this PR):

- `V4-DAG.md`
- `port-daddy-asciinema-skills-plan.md`

Item tree written to the roadmap:

```
- port-daddy-v4-implementation-dag [project/backlog]
    Port Daddy V4: Implementation DAG
  - notation [epic/backlog]
      Notation
  - tier-0-foundations-no-v4-dependencies [epic/backlog]
      Tier 0: Foundations (No V4 Dependencies)
    - part-xviii-key-management-v4-0 [story/backlog]
        Part XVIII: Key Management `[V4.0]`
    - part-vii-semantic-trie-v4-0 [story/backlog]
        Part VII: Semantic Trie `[V4.0]`
    - part-vi-adrs-v4-0 [story/backlog]
        Part VI: ADRs `[V4.0]`
    - part-xx-structured-logging-v4-0 [story/backlog]
        Part XX: Structured Logging `[V4.0]`
  - tier-1-harbor-enforcement-the-critical-path [epic/backlog]
      Tier 1: Harbor Enforcement (The Critical Path)
    - part-i-harbor-first-architecture-local-v4-0-critical-path [story/backlog]
        Part I: Harbor-First Architecture (Local) `[V4.0]` ★ CRITICAL PATH
    - part-xxi-ux-error-catalog-v4-0 [story/backlog]
        Part XXI: UX & Error Catalog `[V4.0]`
  - tier-2-data-layer-can-parallel-with-tier-1-after-xviii [epic/backlog]
      Tier 2: Data Layer (Can Parallel with Tier 1 After XVIII)
    - part-xiii-harbor-kv-v4-0 [story/backlog]
        Part XIII: Harbor KV `[V4.0]`
    - part-xv-stigmergic-coordination-pheromones-v4-0 [story/backlog]
        Part XV: Stigmergic Coordination (Pheromones) `[V4.0]`
    - part-xxvi-invariants-cross-pollination-v4-0-partial-v4-1-full [story/backlog]
        Part XXVI: Invariants (Cross-Pollination) `[V4.0 partial, V4.1 full]`
  - tier-3-mcp-cli-surface [epic/backlog]
      Tier 3: MCP & CLI Surface
    - part-x-mcp-server-v4-tools-v4-0 [story/backlog]
        Part X: MCP Server V4 Tools `[V4.0]`
    - part-xxv-retrospective-amendments-v4-0 [story/backlog]
        Part XXV: Retrospective Amendments `[V4.0]`
  - tier-4-sync-networking-v4-0-foundation-v4-1-full [epic/backlog]
      Tier 4: Sync & Networking (V4.0 Foundation, V4.1 Full)
    - part-xvii-distributed-state-sync-protocol-v4-0-critical-path [story/backlog]
        Part XVII: Distributed State & Sync Protocol `[V4.0]` ★ CRITICAL PATH
    - part-xii-trust-tiers-v4-0-schema-v4-1-enforcement [story/backlog]
        Part XII: Trust Tiers `[V4.0 schema, V4.1 enforcement]`
    - parts-ii-iii-remote-harbors-lighthouse-v4-0-basic-v4-1-full [story/backlog]
        Parts II/III: Remote Harbors & Lighthouse `[V4.0 basic, V4.1 full]`
  - tier-5-advanced-features-v4-1 [epic/backlog]
      Tier 5: Advanced Features (V4.1+)
    - part-viii-socket-transport-v4-1 [story/backlog]
        Part VIII: Socket Transport `[V4.1]`
    - part-xiv-regions-v4-0-manual-v4-1-auto-v4-2-ast [story/backlog]
        Part XIV: Regions `[V4.0 manual, V4.1 auto, V4.2 AST]`
    - part-xxiii-storage-lifecycle-v4-0-basic-v4-1-full [story/backlog]
        Part XXIII: Storage Lifecycle `[V4.0 basic, V4.1 full]`
    - part-ix-dashboard-v4-1-partial-v4-2-full [story/backlog]
        Part IX: Dashboard `[V4.1 partial, V4.2 full]`
    - part-xxvii-anchors-v4-1-layer-1-v4-2-layer-2-v4-3-layer-3 [story/backlog]
        Part XXVII: Anchors `[V4.1 Layer 1, V4.2 Layer 2, V4.3 Layer 3]`
  - tier-6-external-documentation [epic/backlog]
      Tier 6: External & Documentation
    - part-xi-website-v2-v4-0-content-v4-1-full [story/backlog]
        Part XI: Website V2 `[V4.0 content, V4.1 full]`
    - part-v-monetization-pricing-v4-1 [story/backlog]
        Part V: Monetization & Pricing `[V4.1]`
    - part-xxii-market-positioning-v4-1 [story/backlog]
        Part XXII: Market Positioning `[V4.1]`
    - part-xxiv-testing-benchmarks-v4-0-partial-v4-1-full [story/backlog]
        Part XXIV: Testing & Benchmarks `[V4.0 partial, V4.1 full]`
  - critical-path-longest-dependency-chain [epic/backlog]
      Critical Path (Longest Dependency Chain)
  - implementation-phases [epic/backlog]
      Implementation Phases
    - phase-a-foundation-build-first-in-parallel [story/backlog]
        Phase A: Foundation (Build First, In Parallel)
    - phase-b-enforcement-harbor-middleware [story/backlog]
        Phase B: Enforcement (Harbor Middleware)
    - phase-c-data-coordination [story/backlog]
        Phase C: Data & Coordination
    - phase-d-networking [story/backlog]
        Phase D: Networking
    - phase-e-polish-ship-v4-0 [story/backlog]
        Phase E: Polish & Ship V4.0
    - phase-f-v4-1-post-launch [story/backlog]
        Phase F: V4.1+ (Post-Launch)
  - dependency-matrix-adjacency-list [epic/backlog]
      Dependency Matrix (Adjacency List)
  - sub-dags-for-complex-nodes [epic/backlog]
      Sub-DAGs for Complex Nodes
    - part-i-sub-dag-harbor-enforcement [story/backlog]
        Part I Sub-DAG: Harbor Enforcement
    - part-xvii-sub-dag-distributed-state-sync-protocol [story/backlog]
        Part XVII Sub-DAG: Distributed State & Sync Protocol
    - parts-ii-iii-sub-dag-remote-harbors-lighthouse [story/backlog]
        Parts II/III Sub-DAG: Remote Harbors & Lighthouse
    - why-other-large-nodes-don-t-need-sub-dags [story/backlog]
        Why Other Large Nodes Don't Need Sub-DAGs
  - part-xxviii-harbor-gap-analysis-12-gaps [epic/backlog]
      Part XXVIII: Harbor Gap Analysis (12 Gaps)
  - risk-nodes [epic/backlog]
      Risk Nodes
- port-daddy-asciinema-skills-sh-distribution-strategy [project/backlog]
    Port Daddy: Asciinema + skills.sh Distribution Strategy
  - the-core-problem-we-re-solving-for-big-tech-ai-engineers [epic/backlog]
      The Core Problem We're Solving (For Big Tech AI Engineers)
  - asciinema-scripts-6-videos [epic/backlog]
      Asciinema Scripts (6 Videos)
    - video-1-the-port-conflict-hell-1-min-30-sec [story/backlog]
        Video 1: "The Port Conflict Hell" (1 min 30 sec)
    - video-2-enter-port-daddy-1-min [story/backlog]
        Video 2: "Enter Port Daddy" (1 min)
    - video-3-multi-agent-coordination-2-min [story/backlog]
        Video 3: "Multi-Agent Coordination" (2 min)
    - video-4-from-chaos-monorepo-to-orchestrated-symphony-2-min [story/backlog]
        Video 4: "From Chaos Monorepo to Orchestrated Symphony" (2 min)
    - video-5-tunneling-share-localhost-with-the-internet-1-min-30-sec [story/backlog]
        Video 5: "Tunneling: Share Localhost with the Internet" (1 min 30 sec)
    - video-6-the-dashboard-real-time-coordination-1-min-30-sec [story/backlog]
        Video 6: "The Dashboard: Real-Time Coordination" (1 min 30 sec)
  - asciinema-recording-checklist [epic/backlog]
      Asciinema Recording Checklist
    - technical-setup [story/backlog]
        Technical Setup
      - asciinema-cli-installed [task/backlog]
          asciinema CLI installed
      - theme-use-port-daddy-colors-navy-1e3a5f-teal-4a7c7e-cream-bg [task/backlog]
          Theme: Use Port Daddy colors (navy #1e3a5f, teal #4a7c7e, cream bg)
      - font-monospace-16px-for-readability [task/backlog]
          Font: Monospace, 16px for readability
      - speed-0-5x-0-8x-slow-enough-to-read-fast-enough-to-not-bore [task/backlog]
          Speed: 0.5x-0.8x (slow enough to read, fast enough to not bore)
      - no-terminal-bloat-clean-prompt-no-git-branches [task/backlog]
          No terminal bloat (clean prompt, no git branches)
    - recording-quality [story/backlog]
        Recording Quality
      - each-video-2-min-attention-span-for-engineers [task/backlog]
          Each video <2 min (attention span for engineers)
      - clear-loud-typing-sounds-satisfying [task/backlog]
          Clear, loud typing sounds (satisfying)
      - strategic-pauses-let-output-sink-in [task/backlog]
          Strategic pauses (let output sink in)
      - color-output-make-it-pretty [task/backlog]
          Color output (make it pretty)
      - realistic-delays-commands-take-time-servers-start [task/backlog]
          Realistic delays (commands take time, servers start)
    - distribution [story/backlog]
        Distribution
      - upload-to-asciinema-org-platform-agnostic-shareable [task/backlog]
          Upload to asciinema.org (platform-agnostic, shareable)
      - embed-on-portdaddy-dev [task/backlog]
          Embed on portdaddy.dev
      - include-in-skills-sh-listing [task/backlog]
          Include in skills.sh listing
      - link-from-readme [task/backlog]
          Link from README
      - reference-in-tutorials [task/backlog]
          Reference in tutorials
  - skills-sh-integration-agentic-skill-listing [epic/backlog]
      skills.sh Integration (Agentic Skill Listing)
    - what-is-skills-sh [story/backlog]
        What is skills.sh?
    - port-daddy-skill-listing [story/backlog]
        Port Daddy Skill Listing
  - the-big-tech-ai-engineer-pitch-why-port-daddy-is-necessary [epic/backlog]
      The Big Tech AI Engineer Pitch (Why Port Daddy Is Necessary)
    - the-reality-check [story/backlog]
        The Reality Check
    - why-it-s-necessary-not-just-nice [story/backlog]
        Why It's Necessary (Not Just Nice)
    - the-ask-what-we-need [story/backlog]
        The Ask (What We Need)
  - asciinema-script-details-ready-to-record [epic/backlog]
      Asciinema Script Details (Ready to Record)
    - video-1-the-port-conflict-hell-90-seconds [story/backlog]
        Video 1: The Port Conflict Hell (90 seconds)
    - video-2-enter-port-daddy-60-seconds [story/backlog]
        Video 2: Enter Port Daddy (60 seconds)
  - website-integration-skills-sh-promotion [epic/backlog]
      Website Integration (Skills.sh Promotion)
  - faq-why-video-marketing-works-for-port-daddy [epic/backlog]
      FAQ: Why Video Marketing Works for Port Daddy
  - message-clarity-check-for-big-tech [epic/backlog]
      Message Clarity Check (For Big Tech)
    - don-t-say [story/backlog]
        ❌ DON'T Say
    - do-say [story/backlog]
        ✅ DO Say
    - don-t-say-2 [story/backlog]
        ❌ DON'T Say
    - do-say-2 [story/backlog]
        ✅ DO Say
    - don-t-say-3 [story/backlog]
        ❌ DON'T Say
    - do-say-3 [story/backlog]
        ✅ DO Say
  - the-pitch-in-30-seconds-for-skills-sh-profile [epic/backlog]
      The Pitch in 30 Seconds (For Skills.sh Profile)
  - deliverables-checklist [epic/backlog]
      Deliverables Checklist
    - asciinema-videos-6 [story/backlog]
        Asciinema Videos (6)
      - 1-port-conflict-hell-90s-problem-hook [task/backlog]
          1. Port Conflict Hell (90s) — Problem hook
      - 2-enter-port-daddy-60s-solution [task/backlog]
          2. Enter Port Daddy (60s) — Solution
      - 3-multi-agent-coordination-120s-coordination-demo [task/backlog]
          3. Multi-Agent Coordination (120s) — Coordination demo
      - 4-monorepo-orchestration-120s-scale-demo [task/backlog]
          4. Monorepo Orchestration (120s) — Scale demo
      - 5-tunnel-demo-90s-bonus-feature [task/backlog]
          5. Tunnel Demo (90s) — Bonus feature
      - 6-dashboard-90s-visibility [task/backlog]
          6. Dashboard (90s) — Visibility
    - skills-sh-profile [story/backlog]
        skills.sh Profile
      - create-account-and-list-port-daddy [task/backlog]
          Create account and list Port Daddy
      - write-compelling-2-3-paragraph-description [task/backlog]
          Write compelling 2-3 paragraph description
      - add-6-asciinema-video-links [task/backlog]
          Add 6 asciinema video links
      - tag-with-port-management-multi-agent-agent-coordination [task/backlog]
          Tag with: port-management, multi-agent, agent-coordination
      - add-installation-instructions [task/backlog]
          Add installation instructions
      - link-to-github-npm-website [task/backlog]
          Link to GitHub, npm, website
    - website-portdaddy-dev-updates [story/backlog]
        Website (portdaddy.dev) Updates
      - embed-all-6-asciinema-videos-in-dedicated-section [task/backlog]
          Embed all 6 asciinema videos in dedicated section
      - add-use-as-agent-skill-cta [task/backlog]
          Add "Use as Agent Skill" CTA
      - link-to-skills-sh-profile [task/backlog]
          Link to skills.sh profile
      - add-copy-paste-snippets-from-each-video [task/backlog]
          Add copy-paste snippets from each video
    - github-promotion [story/backlog]
        GitHub Promotion
      - add-skills-sh-badge-to-readme [task/backlog]
          Add skills.sh badge to README
      - link-to-asciinema-videos-from-quick-start [task/backlog]
          Link to asciinema videos from "Quick Start"
      - mention-use-as-claude-cursor-agent-skill [task/backlog]
          Mention "Use as Claude/Cursor agent skill"
  - timeline [epic/backlog]
      Timeline
```

## Test Plan

- `pd roadmap chomp V4-DAG.md port-daddy-asciinema-skills-plan.md --dry-run` — previewed the exact tree above; a
  second real run reported 0 new inserts (idempotent).
- `pd roadmap --status all --harbor port-daddy` — all chomped slugs listed from the table.
- `docs/roadmap/roadmap.snapshot.json` regenerated from the live daemon via the export machinery
  (`lib/roadmap-snapshot.ts`) and committed alongside the doc removal; the roadmap-link
  gate reads this mirror.
- The machine-readable work receipt — docs read (+ source commit), items derived, rows
  protected, deps skipped as dangling, and warnings — lands at
  `docs/roadmap/receipts/chomp-receipt.json` when it lands with this PR (the path is
  created by this PR, so it does not exist yet on the base branch). Each derived row also
  carries `source_refs_json` pointing at its source doc + commit.

<!-- visual-exempt: roadmap data + doc removal only; no visual surface changed -->

## Surface Parity & Docs

- [x] N/A — no new CLI/API surface; this PR moves planning-doc content into roadmap_items

## Coverage & Build

- [x] N/A — no code changes; roadmap data + doc removal only

## Roadmap link

Roadmap-Item: none — planning-doc chomp: this PR removes the docs and records their content as the roadmap items listed above
Roadmap-Spawns: port-daddy-v4-implementation-dag, notation, tier-0-foundations-no-v4-dependencies, part-xviii-key-management-v4-0, part-vii-semantic-trie-v4-0, part-vi-adrs-v4-0, part-xx-structured-logging-v4-0, tier-1-harbor-enforcement-the-critical-path, part-i-harbor-first-architecture-local-v4-0-critical-path, part-xxi-ux-error-catalog-v4-0, tier-2-data-layer-can-parallel-with-tier-1-after-xviii, part-xiii-harbor-kv-v4-0, part-xv-stigmergic-coordination-pheromones-v4-0, part-xxvi-invariants-cross-pollination-v4-0-partial-v4-1-full, tier-3-mcp-cli-surface, part-x-mcp-server-v4-tools-v4-0, part-xxv-retrospective-amendments-v4-0, tier-4-sync-networking-v4-0-foundation-v4-1-full, part-xvii-distributed-state-sync-protocol-v4-0-critical-path, part-xii-trust-tiers-v4-0-schema-v4-1-enforcement, parts-ii-iii-remote-harbors-lighthouse-v4-0-basic-v4-1-full, tier-5-advanced-features-v4-1, part-viii-socket-transport-v4-1, part-xiv-regions-v4-0-manual-v4-1-auto-v4-2-ast, part-xxiii-storage-lifecycle-v4-0-basic-v4-1-full, part-ix-dashboard-v4-1-partial-v4-2-full, part-xxvii-anchors-v4-1-layer-1-v4-2-layer-2-v4-3-layer-3, tier-6-external-documentation, part-xi-website-v2-v4-0-content-v4-1-full, part-v-monetization-pricing-v4-1, part-xxii-market-positioning-v4-1, part-xxiv-testing-benchmarks-v4-0-partial-v4-1-full, critical-path-longest-dependency-chain, implementation-phases, phase-a-foundation-build-first-in-parallel, phase-b-enforcement-harbor-middleware, phase-c-data-coordination, phase-d-networking, phase-e-polish-ship-v4-0, phase-f-v4-1-post-launch, dependency-matrix-adjacency-list, sub-dags-for-complex-nodes, part-i-sub-dag-harbor-enforcement, part-xvii-sub-dag-distributed-state-sync-protocol, parts-ii-iii-sub-dag-remote-harbors-lighthouse, why-other-large-nodes-don-t-need-sub-dags, part-xxviii-harbor-gap-analysis-12-gaps, risk-nodes, port-daddy-asciinema-skills-sh-distribution-strategy, the-core-problem-we-re-solving-for-big-tech-ai-engineers, asciinema-scripts-6-videos, video-1-the-port-conflict-hell-1-min-30-sec, video-2-enter-port-daddy-1-min, video-3-multi-agent-coordination-2-min, video-4-from-chaos-monorepo-to-orchestrated-symphony-2-min, video-5-tunneling-share-localhost-with-the-internet-1-min-30-sec, video-6-the-dashboard-real-time-coordination-1-min-30-sec, asciinema-recording-checklist, technical-setup, asciinema-cli-installed, theme-use-port-daddy-colors-navy-1e3a5f-teal-4a7c7e-cream-bg, font-monospace-16px-for-readability, speed-0-5x-0-8x-slow-enough-to-read-fast-enough-to-not-bore, no-terminal-bloat-clean-prompt-no-git-branches, recording-quality, each-video-2-min-attention-span-for-engineers, clear-loud-typing-sounds-satisfying, strategic-pauses-let-output-sink-in, color-output-make-it-pretty, realistic-delays-commands-take-time-servers-start, distribution, upload-to-asciinema-org-platform-agnostic-shareable, embed-on-portdaddy-dev, include-in-skills-sh-listing, link-from-readme, reference-in-tutorials, skills-sh-integration-agentic-skill-listing, what-is-skills-sh, port-daddy-skill-listing, the-big-tech-ai-engineer-pitch-why-port-daddy-is-necessary, the-reality-check, why-it-s-necessary-not-just-nice, the-ask-what-we-need, asciinema-script-details-ready-to-record, video-1-the-port-conflict-hell-90-seconds, video-2-enter-port-daddy-60-seconds, website-integration-skills-sh-promotion, faq-why-video-marketing-works-for-port-daddy, message-clarity-check-for-big-tech, don-t-say, do-say, don-t-say-2, do-say-2, don-t-say-3, do-say-3, the-pitch-in-30-seconds-for-skills-sh-profile, deliverables-checklist, asciinema-videos-6, 1-port-conflict-hell-90s-problem-hook, 2-enter-port-daddy-60s-solution, 3-multi-agent-coordination-120s-coordination-demo, 4-monorepo-orchestration-120s-scale-demo, 5-tunnel-demo-90s-bonus-feature, 6-dashboard-90s-visibility, skills-sh-profile, create-account-and-list-port-daddy, write-compelling-2-3-paragraph-description, add-6-asciinema-video-links, tag-with-port-management-multi-agent-agent-coordination, add-installation-instructions, link-to-github-npm-website, website-portdaddy-dev-updates, embed-all-6-asciinema-videos-in-dedicated-section, add-use-as-agent-skill-cta, link-to-skills-sh-profile, add-copy-paste-snippets-from-each-video, github-promotion, add-skills-sh-badge-to-readme, link-to-asciinema-videos-from-quick-start, mention-use-as-claude-cursor-agent-skill, timeline

## Changelog & Parsimony

- [x] No duplicate / fragmented product path introduced (content moved from markdown into the roadmap DB-of-record)
