# Research Report: How Successful Dev Tools Handle Documentation

**Date:** 2026-03-04
**Author:** Research Agent
**Purpose:** Inform Port Daddy's README restructuring, website refresh, and MCP tool documentation strategy

---

## Executive Summary

After analyzing 10 successful developer tools (Turborepo, pnpm, Bun, Biome, mise, Volta, Nx, direnv, just, Starship) and reviewing industry research on README patterns, landing page design, MCP tool documentation, and progressive disclosure, the findings are clear:

1. **Port Daddy's 1,007-line README is 5-20x longer than the best tools.** The most beloved tools keep their README between 48-200 lines and defer everything else to a docs site.
2. **44 MCP tools is a context window killer.** Research shows agents lose accuracy after 2-3 MCP servers, and 50+ tools consume 30,000-50,000 tokens before the user asks a question. Progressive disclosure (meta-tool pattern) can reduce token overhead by 85-95%.
3. **The "too many features" problem is solved by tiered onboarding.** Tools like mise and Bun show only 3 core capabilities upfront and link out to everything else.
4. **Landing pages follow a formula.** Evil Martians' analysis of 100+ dev tool pages found centered hero + tagline + install command + animated demo is nearly universal.
5. **Port Daddy has a brand identity problem.** It does three things (ports, orchestration, agent coordination) but the README tries to explain all three simultaneously at full depth.

The recommended strategy: **ruthlessly compress the README to ~150 lines, create a docs site at docs.portdaddy.dev, implement MCP progressive disclosure, and redesign the landing page around the "one install command, one GIF" pattern.**

---

## Research Question

How do the most successful modern dev tools structure their documentation across README, docs site, landing page, and AI integrations -- and what patterns should Port Daddy adopt as it transitions from "small CLI tool" to "multi-surface coordination platform"?

---

## Methodology

- Fetched and measured actual README files from 10 GitHub repositories via `gh api`
- Analyzed README section structure, line counts, and content allocation
- Researched landing page patterns via Evil Martians' study of 100+ dev tool pages
- Investigated MCP tool documentation quality (arxiv research on 856 tools)
- Studied progressive disclosure patterns for agent tool ecosystems
- Examined npm README best practices from official npm docs
- Reviewed "awesome README" patterns from community-curated lists

---

## Finding 1: README Length — The Data

| Tool | README Lines | H2 Sections | Strategy |
|------|-------------|-------------|----------|
| **Turborepo** | 48 | 5 | Logo + badges + one sentence + "visit docs site" |
| **Volta** | 74 | 5 | Logo + tagline + feature bullets + "read the docs" |
| **Nx** | ~101 | 4 | Logo + one-liner + `npx create` + links to docs |
| **Biome** | 183 | 6 | Logo + feature summary + install + usage + links |
| **mise** | 197 | 5 | Logo + "what is it" + GIF demo + quickstart + links |
| **direnv** | 197 | 7 | Description + use cases + how it works + quick demo |
| **pnpm** | 227 | ~8 | Feature list + sponsors (takes up space) + benchmarks |
| **Bun** | 415 | 5 | Install + quick links index (massive link directory) |
| **Starship** | 475 | 4 | Multi-language support + collapsible install sections |
| **just** | 4,872 | 50+ | README IS the docs (book mirror) |
| **Port Daddy** | 1,007 | 32+ | Everything in one document |

**Key Pattern:** The tools developers love most (Turborepo, Volta, Nx) have READMEs under 100 lines. They function as a business card, not a manual. The only tool with a README longer than Port Daddy's is `just`, which explicitly states "this README is also available as a book" -- it treats the README as the canonical documentation, not as a supplement to a docs site.

**The two viable strategies:**
1. **Business card README** (Turborepo/Volta/Nx): 50-100 lines. Logo, tagline, install, link to docs.
2. **README-as-book** (just): 4,000+ lines but with a parallel docs site rendering the same content as a proper book with navigation.

Port Daddy is stuck in the worst middle ground: too long to scan, too short to be comprehensive.

### What the Top READMEs Include

Every successful README under 200 lines follows this exact structure:

```
1. Centered logo/banner (with light/dark mode variants)
2. Tagline (one sentence)
3. Badge row (npm version, CI status, license, Discord/community)
4. Navigation links (Website / Docs / Discord / Issues)
5. "What is this?" (2-4 sentences max)
6. Install command (one line)
7. Minimal usage example (3-5 lines of code)
8. Link to full docs
9. Contributing link
10. License
```

That is it. Nothing else.

### What Port Daddy's README Includes That Should Be Moved

| Current README Section | Lines | Recommended Location |
|----------------------|-------|---------------------|
| Quick Start | 22 | Keep (compress to 10) |
| Who Uses Port Daddy | 12 | Keep (compress to 4) |
| Just Want Stable Ports | 25 | docs/guides/stable-ports.md |
| Run Your Whole Stack | 60 | docs/guides/orchestration.md |
| Port Management vs Agent Coordination | 10 | docs/guides/getting-started.md |
| Agent Coordination (full section) | 100 | docs/guides/agent-coordination.md |
| Sessions & Notes | 50 | docs/guides/sessions.md |
| Sugar Commands (detailed) | 150 | docs/reference/sugar.md |
| Changelog feature docs | 45 | docs/guides/changelog.md |
| Multi-Agent Patterns | 50 | docs/guides/patterns.md |
| Local DNS | 40 | docs/guides/dns.md |
| When NOT to Use | 12 | Keep |
| JavaScript SDK | 30 | docs/sdk.md (already exists) |
| AI Agent Skill | 20 | docs/guides/ai-agents.md |
| CLI Reference (full) | 160 | docs/reference/cli.md |
| Feature Coverage Matrix | 25 | docs/reference/coverage.md |
| API Reference | 30 | docs/reference/api.md |
| How It Works | 50 | docs/architecture.md |

**Estimated savings:** Reduce from 1,007 lines to ~120-150 lines.

---

## Finding 2: The Three README Archetypes

### Archetype A: "Gateway" (Turborepo, Volta, Nx)

The README exists solely to get you to the docs site. It answers one question: "should I click through to learn more?"

**Turborepo (48 lines):**
```
Logo → Badges → One sentence → "Visit turborepo.dev" → Contributing → Community → Security
```

Turborepo's entire README body is essentially: "Turborepo is a high-performance build system for JavaScript and TypeScript codebases, written in Rust. Visit https://turborepo.dev to get started with Turborepo."

**When this works:** When you have a polished docs site that can handle the full onboarding journey. Requires investment in the docs site.

### Archetype B: "Showcase" (mise, Biome, Bun, pnpm)

The README demonstrates the tool's value proposition with real examples, then links out for depth.

**mise (197 lines):**
```
Logo → "What is it?" (3 bullet comparisons) → GIF Demo → Quickstart (install + 3 use cases) → Link to docs
```

mise's masterstroke is the "What is it?" section that uses comparisons:
- "Like asdf, it manages dev tools"
- "Like direnv, it manages environment variables"
- "Like make, it manages tasks"

Then a GIF demo, then the quickstart shows all three use cases with real shell sessions. You understand the tool in 30 seconds.

**When this works:** When the tool has a clear value proposition and a few core workflows. Best for Port Daddy's situation.

### Archetype C: "Manual" (just, Starship)

The README is the documentation. Everything lives in one file.

**just (4,872 lines):**
The README is explicitly mirrored as a book at just.systems/man/en/. The README IS the documentation, versioned and comprehensive.

**When this works:** When the tool has exactly one surface (CLI) and the documentation is linear. Does not work for multi-surface tools like Port Daddy.

**Recommendation for Port Daddy: Archetype B ("Showcase").** We have too many surfaces for Archetype C and not yet enough docs-site investment for Archetype A.

---

## Finding 3: How Tools Solve "Too Many Features"

### Pattern: "Three Things"

The most successful multi-capability tools lead with exactly three value propositions:

| Tool | Feature 1 | Feature 2 | Feature 3 |
|------|-----------|-----------|-----------|
| **mise** | Dev tools | Environment variables | Tasks |
| **Bun** | Runtime | Package manager | Test runner |
| **Biome** | Formatter | Linter | (coming: bundler) |
| **Nx** | Build caching | Task orchestration | CI optimization |

**Port Daddy should lead with three:**
1. **Stable Ports** -- `pd claim myapp` (same port, every time)
2. **Stack Orchestration** -- `pd up` (start everything, one command)
3. **Agent Coordination** -- `pd begin` / `pd done` (sessions, locks, pub/sub for AI agents)

### Pattern: Progressive Depth

mise and Bun use this pattern in their READMEs:
1. One-sentence description of the capability
2. One code block showing the simplest usage
3. Link: "See [full docs] for more"

They never explain every flag, every option, every edge case in the README. Port Daddy currently does.

### Pattern: Audience Segmentation

Port Daddy already has this in the "Port Management vs Agent Coordination" table, but it is buried at line 203. This should be the FIRST thing after the tagline. The mise "What is it?" pattern handles this elegantly with comparisons.

---

## Finding 4: Landing Page Design Patterns

Evil Martians analyzed 100+ dev tool landing pages in 2025 and found these patterns:

### Hero Section (above the fold)

Four approaches, ranked by frequency:

1. **Animated product UI** -- Shows the tool in action (Linear, Vercel style)
2. **Static product UI** -- Screenshot of the tool working
3. **Switchable product UI** -- Tabs showing different use cases
4. **Live product embed** -- Actual working UI element in the hero

For Port Daddy: a terminal animation (asciinema/vhs GIF or SVG) showing `pd begin` -> `pd note` -> `pd done` would be the strongest pattern.

### Below the Hero

Nearly universal pattern:
1. **Social proof / logos** -- "Used by teams at X, Y, Z" or "N agents coordinated"
2. **Three feature blocks** -- Each with icon, title, 2-sentence description, code snippet
3. **Install section** -- One-line install command
4. **Call to action** -- "Read the docs" or "Get started"

### Two Rules from the Research

1. **No salesy BS.** Developers see through it instantly.
2. **Clever simplicity wins.** Solid typography, clear layout, breathing room. Most pages avoid flashy interactions.

### Dual CTA Strategy

The best landing pages use two CTAs:
- **Primary:** "Install" or "Get started" (bold, high-contrast)
- **Secondary:** "Read the docs" or "View on GitHub" (subtle, text link)

### portdaddy.dev Recommendations

Current state: The dashboard at `public/index.html` serves as the main web presence. This is an operational dashboard, not a marketing/docs landing page.

Recommended structure for portdaddy.dev:

```
/ (landing page)
  - Hero: tagline + terminal GIF + install command
  - Three features: Ports, Orchestration, Coordination
  - Install section
  - "Read the docs" CTA

/docs (documentation)
  /docs/getting-started
  /docs/guides/
    stable-ports, orchestration, sessions, agent-coordination,
    patterns, dns, changelog, ai-agents
  /docs/reference/
    cli, api, sdk, mcp, coverage
  /docs/architecture

/dashboard (existing operational UI)
```

---

## Finding 5: GIF/Animation Usage

### Terminal Recording Tools

| Tool | Output | Best For |
|------|--------|---------|
| **vhs** (charmbracelet) | GIF/SVG | Scriptable, reproducible, CI-friendly |
| **asciinema** + agg | GIF | Interactive recording, manual demos |
| **svg-term-cli** | SVG | Crisp at any resolution, smallest file size |

### Who Uses Terminal Demos in README

| Tool | Demo Type | Where |
|------|-----------|-------|
| **mise** | GIF (asciinema) | README, prominently after "What is it?" |
| **Starship** | GIF | README, immediately after badges |
| **just** | Static screenshot | README, after first description paragraph |
| **direnv** | Code blocks (no GIF) | README only |

**Recommendation:** Create a vhs tape file that records:
```
pd begin "Building auth system"
pd note "JWT middleware done"
pd whoami
pd done "Auth complete"
```

This 4-command sequence demonstrates the core workflow in ~10 seconds. Use the resulting GIF in both the README and landing page.

---

## Finding 6: MCP Tool Documentation — The 44 Tool Problem

### The Research

An arxiv paper analyzing 856 MCP tools across 103 servers found that MCP tool descriptions have six common quality problems:

1. **Unstated Limitations** (89.8% of tools) -- Missing boundary conditions
2. **Missing Usage Guidelines** (89.3%) -- No indication of when to invoke
3. **Opaque Parameters** (84.3%) -- Little insight into parameter meanings
4. **Ambiguous Descriptions** (67.2%) -- Unclear what the tool does
5. **Missing Error Handling** (61.5%) -- No error case documentation
6. **Conflicting Documentation** (23.1%) -- Descriptions contradict behavior

### The Context Window Problem

Standard MCP servers send ALL tool descriptions at connection time. For Port Daddy with 44 tools, this means:

- ~15,000-25,000 tokens of tool schemas loaded before any user interaction
- Agents connecting Port Daddy + 1-2 other MCP servers may hit accuracy degradation
- Most agents will never use more than 5-8 of the 44 tools in a single session

### Progressive Disclosure Strategies

**Strategy 1: Meta-Tool Pattern (Recommended)**

Instead of 44 tools, expose 2-3 meta-tools:

```
Tools loaded at connection (3):
  1. pd_discover  - "List available Port Daddy operations by category"
  2. pd_execute   - "Execute a Port Daddy operation by name with parameters"
  3. pd_status    - "Quick health/context check (combines whoami + health)"

On pd_discover("sessions"):
  Returns full schemas for: begin_session, end_session_full, add_note,
  list_sessions, list_notes, set_session_phase

On pd_execute("begin_session", { purpose: "..." }):
  Executes the operation
```

**Token savings:** From ~20,000 tokens (44 full schemas) to ~2,000 tokens (3 meta-schemas). That is a **90% reduction**.

**Strategy 2: Tiered Tool Loading**

Expose tools in tiers:

```
Tier 1 (always loaded, 8 tools):
  begin_session, end_session_full, whoami, claim_port, release_port,
  add_note, acquire_lock, list_services

Tier 2 (loaded on request, 16 tools):
  Agent registry, salvage, pub/sub, sessions management

Tier 3 (loaded on request, 20 tools):
  DNS, briefing, tunnels, webhooks, integration signals, changelog,
  file claims, activity log, scan
```

**Strategy 3: Skill-Based Disclosure (Claude-specific)**

Port Daddy already has a Claude Code plugin/skill. The skill's SKILL.md can use progressive disclosure:

```
SKILL.md (always loaded):
  - Overview of capabilities (1-sentence each)
  - 3 most common workflows with examples
  - "For X, see references/sessions.md"
  - "For Y, see references/coordination.md"

references/ (loaded on demand):
  - sessions.md (full session/note API)
  - coordination.md (locks, pub/sub, agents)
  - orchestration.md (scan, up, down, DNS)
```

### Recommendation

Implement Strategy 1 (meta-tool pattern) as the default MCP mode, with Strategy 2 available via `pd mcp --full` for power users who want direct tool access. This can be done without breaking existing integrations by making the meta-tool mode opt-in initially.

---

## Finding 7: CLI Reference Documentation Patterns

### Pattern: Table of Contents with Categories

Every successful CLI tool with 10+ commands organizes them into categories:

- **mise:** Dev Tools | Environments | Tasks | Settings
- **Bun:** Runtime | CLI | Bundler | Test | Package Manager
- **Starship:** Uses `<details>` collapsible sections for each shell/OS

### Pattern: Minimal README, Full CLI Docs Elsewhere

| Tool | CLI in README | Full CLI Docs |
|------|--------------|---------------|
| Turborepo | None | turbo.build/repo/docs/reference |
| Biome | 4 commands shown | biomejs.dev/reference/cli |
| mise | 3 example commands | mise.jdx.dev/cli/ |
| Bun | Links directory | bun.com/docs/cli |

Port Daddy currently lists ALL commands in the README (lines 721-895). This is 174 lines of reference tables that belong in `docs/reference/cli.md`.

### Pattern: `--help` as Documentation

The best CLI tools make `pd --help` and `pd <command> --help` genuinely useful. If the help text is good enough, the README does not need to duplicate it.

Port Daddy should ensure `pd --help` outputs a clean, categorized command list that mirrors the docs site structure, then the README can simply say: "Run `pd --help` for the full command reference."

---

## Finding 8: npm README Best Practices

npm's official guidance:

1. README.md must be in the root directory of the package
2. It renders as GitHub Flavored Markdown on npmjs.com
3. It should include: directions for installing, configuring, and using the code
4. "A README should be no more than a few screens long"

The npm page at `npmjs.com/package/port-daddy` shows the full README. At 1,007 lines, this means a user scrolling for minutes to find what they need. The npm audience is typically looking for:

1. What does this do? (10 seconds to understand)
2. How do I install it? (one command)
3. Does it look maintained? (badges, recent version)
4. Quick usage example

Everything after that first screenful is wasted on the npm audience. They will either click through to the GitHub repo or the docs site.

**Recommendation:** The compressed ~150-line README will be ideal for npm display.

---

## Finding 9: The "Small Tool to Platform" Transition

Port Daddy is at the inflection point where it has grown from a simple port manager to a multi-surface coordination platform. The research reveals a common pattern for how tools navigate this:

### Phase 1: Single-Purpose Tool
- README contains everything
- No docs site needed
- Example: early direnv, early Volta

### Phase 2: Feature Accumulation
- README grows to 500-1000+ lines
- **This is where Port Daddy is now**
- Common mistake: trying to keep everything in the README
- Users complain it is "overwhelming" or "hard to find things"

### Phase 3: Documentation Split
- README becomes a gateway/showcase (50-200 lines)
- Docs site handles depth, tutorials, reference
- Landing page handles marketing/positioning
- Example: mise, Bun, Biome at this stage

### Phase 4: Platform Documentation
- Multiple docs sections for different audiences
- API reference auto-generated
- Community-contributed guides
- Example: Nx, Turborepo at this stage

**Port Daddy needs to execute the Phase 2 -> Phase 3 transition.**

### How Other Tools Made the Transition

**Biome** (Rome -> Biome rebrand): Used the rebrand as an opportunity to restructure docs from scratch. Kept the README focused on "what is it + install + basic usage" and built biomejs.dev for everything else.

**mise** (rtx -> mise rebrand): Similarly used the name change to restructure. The README went from a comprehensive manual to the current 197-line showcase format with aggressive linking to mise.jdx.dev.

**Bun:** Started with a comprehensive README but now uses it primarily as a link directory to bun.com/docs. The README is 415 lines but ~250 of those are categorized links to docs pages.

---

## Finding 10: What the "Awesome README" Pattern Actually Is

The community-curated [awesome-readme](https://github.com/matiassingers/awesome-readme) list and Daytona's "How to Write a 4000 Stars README" research converge on these principles:

### The Three Must-Haves

1. **Impactful Header:** Logo, badges, one-liner tagline, visual demo
2. **Engaging Content:** Clear "what/why/how" with a quick start that works in under 60 seconds
3. **Project Hygiene:** Contributing guide, license, code of conduct, no broken links

### The "3x/5x Rule"

Projects with comprehensive READMEs receive 3x more stars and 5x more contributions. But "comprehensive" does not mean "long" -- it means answering the right questions quickly.

### The Time Budget

A visitor's attention budget:
- **5 seconds:** Logo, tagline, badges -- "Is this relevant to me?"
- **15 seconds:** "What is it?" section -- "Do I understand what it does?"
- **30 seconds:** Quick start / demo GIF -- "Can I see it working?"
- **60 seconds:** Install + first command -- "Can I try it right now?"

Everything after 60 seconds is for people who already decided to use the tool. That content belongs in docs, not README.

---

## Synthesis: Port Daddy Documentation Strategy

### The Restructured README (~150 lines)

```markdown
# Port Daddy

[Centered logo/banner with light/dark mode support]
[Tagline: "Your ports. My rules. Zero conflicts."]
[Badges: npm, license, tests, platform, AI agents]
[Nav links: Website | Docs | Dashboard | GitHub]

## What is it?

Port Daddy is a local daemon for multi-project development:

- **Like docker-compose** -- `pd up` starts your entire stack with stable ports
- **Like a port manager** -- `pd claim myapp:api` gives you the same port, every time
- **Like a coordination bus** -- sessions, locks, and pub/sub for parallel AI agents

[Terminal GIF demo: pd begin -> pd note -> pd whoami -> pd done]

## Quick Start

    npm install -g port-daddy
    pd begin "Working on auth"
    pd note "JWT middleware done"
    pd done "Auth complete"

## Three Use Cases

### Stable Ports (Solo Developer)
    pd claim myapp:api     # --> port 3101, every time
    pd claim myapp:web     # --> port 3102

### Stack Orchestration
    pd scan                # auto-detect your project
    pd up                  # start everything

### Agent Coordination (Multi-Agent)
    pd begin "Implementing OAuth"
    pd lock db-migrations
    pd pub build:api '{"status":"ready"}'
    pd done "OAuth complete"

## When NOT to Use Port Daddy
[Keep existing section, 4 bullets]

## Documentation
- [Getting Started](https://docs.portdaddy.dev/getting-started)
- [CLI Reference](https://docs.portdaddy.dev/reference/cli)
- [SDK Reference](https://docs.portdaddy.dev/reference/sdk)
- [API Reference](https://docs.portdaddy.dev/reference/api)
- [Multi-Agent Patterns](https://docs.portdaddy.dev/guides/patterns)

## AI Agent Integration
    npx skills add curiositech/port-daddy    # Claude Code / Cursor / etc.
See [AI Agent Guide](https://docs.portdaddy.dev/guides/ai-agents)

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md)

## License
MIT
```

### The Docs Site Structure

```
docs.portdaddy.dev/
  getting-started/          # Install, first commands, pd learn
  guides/
    stable-ports            # Port claim/release workflow
    orchestration           # pd scan, pd up, .portdaddyrc
    sessions                # Sessions & notes deep dive
    agent-coordination      # Full agent lifecycle
    patterns                # War room, adversarial hardening, etc.
    dns                     # Local DNS setup
    changelog               # Hierarchical changelog feature
    ai-agents               # MCP, Claude Code plugin, skills
    sugar                   # begin/done/whoami detailed docs
  reference/
    cli                     # Full CLI command reference
    api                     # REST API reference
    sdk                     # JavaScript SDK reference
    mcp                     # MCP tool reference
    coverage                # Feature coverage matrix
  architecture              # How it works, security, config
```

### The MCP Progressive Disclosure Plan

Phase 1 (immediate): Improve tool descriptions for the existing 44 tools using the quality rubric from the arxiv research. Address unstated limitations, add usage guidelines, clarify parameters.

Phase 2 (next release): Implement tiered tool loading. Expose 8 core tools by default, load the rest on demand via a `pd_discover` meta-tool.

Phase 3 (future): Full meta-tool pattern with 3 registered tools and dynamic schema loading.

### The Landing Page (portdaddy.dev)

```
[Hero]
  "Your ports. My rules. Zero conflicts."
  [Terminal animation: pd begin -> pd note -> pd done]
  [CTA: npm install -g port-daddy]  [Secondary: Read the docs]

[Three Feature Blocks]
  1. Stable Ports     -- icon + 2 sentences + code snippet
  2. Stack Orchestration -- icon + 2 sentences + code snippet
  3. Agent Coordination  -- icon + 2 sentences + code snippet

[Social Proof]
  "44 MCP tools | 2,000+ tests | 60+ framework detection"

[Install Section]
  npm install -g port-daddy
  pd learn    # interactive tutorial

[CTA]
  Read the documentation ->
```

---

## Actionable Recommendations (Prioritized)

### Tier 1: Do This Week

1. **Compress the README to ~150 lines** using the Archetype B "Showcase" structure outlined above
2. **Create a `docs/` directory** with the content extracted from the README, organized by the structure above
3. **Record a terminal GIF** using vhs or asciinema showing the core `pd begin` -> `pd done` workflow
4. **Add a "What is it?" section** using the mise comparison pattern ("Like X, it does Y")

### Tier 2: Do This Month

5. **Improve MCP tool descriptions** -- audit all 44 tools against the quality rubric (unstated limitations, usage guidelines, parameter clarity)
6. **Implement tiered MCP tool loading** -- core 8 tools always loaded, rest on demand
7. **Set up a docs site** -- even a simple Markdown-based static site (VitePress, Starlight, or similar) at docs.portdaddy.dev
8. **Redesign the landing page** at portdaddy.dev using the hero + three features + install pattern

### Tier 3: Do This Quarter

9. **Implement full MCP meta-tool pattern** (pd_discover + pd_execute)
10. **Add light/dark mode logo variants** for the README banner
11. **Create a CONTRIBUTING.md** (linked from the compressed README)
12. **Auto-generate CLI reference** from the actual `--help` output to keep docs in sync

---

## Uncertainties & Limitations

- **Docs site hosting:** This research does not evaluate docs site frameworks (VitePress vs Starlight vs Docusaurus). A separate evaluation is warranted.
- **SEO impact:** Moving content from README to docs site may affect discoverability. README content is indexed by GitHub search; docs sites need separate SEO work.
- **MCP meta-tool compatibility:** The meta-tool pattern has not been tested with all agent runtimes. Some may not handle dynamic tool discovery well.
- **Brand perception:** A radically shorter README could initially signal "less capable" to developers who equate README length with feature completeness. The docs site must be in place before the README is compressed.
- **Landing page vs dashboard:** The current dashboard at `public/index.html` serves operational needs. A separate landing page requires either a separate deployment or routing logic.

---

## Sources

### Primary Sources (Direct Analysis)
1. [Turborepo README](https://github.com/vercel/turborepo/blob/main/README.md) -- 48 lines, gateway pattern
2. [pnpm README](https://github.com/pnpm/pnpm/blob/main/README.md) -- 227 lines, feature list + sponsors
3. [Bun README](https://github.com/oven-sh/bun/blob/main/README.md) -- 415 lines, link directory pattern
4. [Biome README](https://github.com/biomejs/biome/blob/main/README.md) -- 183 lines, showcase pattern
5. [mise README](https://github.com/jdx/mise/blob/main/README.md) -- 197 lines, comparison + GIF demo
6. [Volta README](https://github.com/volta-cli/volta/blob/main/README.md) -- 74 lines, tagline + features
7. [Nx README](https://github.com/nrwl/nx/blob/master/README.md) -- 101 lines, one-liner + team
8. [direnv README](https://github.com/direnv/direnv/blob/master/README.md) -- 197 lines, use cases + demo
9. [just README](https://github.com/casey/just/blob/master/README.md) -- 4,872 lines, README-as-book
10. [Starship README](https://github.com/starship/starship/blob/master/README.md) -- 475 lines, multi-language + collapsible install

### Research & Analysis
11. [Evil Martians: "We studied 100 dev tool landing pages"](https://evilmartians.com/chronicles/we-studied-100-devtool-landing-pages-here-is-what-actually-works-in-2025) -- Landing page design patterns
12. [Daytona: "How to Write a 4000 Stars GitHub README"](https://www.daytona.io/dotfiles/how-to-write-4000-stars-github-readme-for-your-project) -- README structure for traction
13. [npm: About package README files](https://docs.npmjs.com/about-package-readme-files/) -- npm display requirements
14. [arxiv: MCP Tool Descriptions Are Smelly](https://arxiv.org/html/2602.14878v1) -- Quality analysis of 856 MCP tools
15. [SynapticLabs: Meta-Tool Pattern for MCP](https://blog.synapticlabs.ai/bounded-context-packs-meta-tool-pattern) -- Progressive disclosure for MCP
16. [Claude Skill Authoring Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) -- Official guidance on skill documentation
17. [awesome-readme](https://github.com/matiassingers/awesome-readme) -- Community-curated README examples
18. [awesome-terminal-recorder](https://github.com/orangekame3/awesome-terminal-recorder) -- Terminal recording tools comparison
19. [Honra: "Why AI Agents Need Progressive Disclosure"](https://www.honra.io/articles/progressive-disclosure-for-ai-agents) -- Token optimization for agent tools
20. [Colin Hacks: "From README to docs site in 10 minutes"](https://colinhacks.com/essays/docs-the-smart-way) -- Practical guide for the transition

---

## Appendix A: Port Daddy's Current README Section Map

```
Lines 1-29:    Header (logo, tagline, badges, jump-to links)
Lines 30-53:   Quick Start
Lines 55-66:   Who Uses Port Daddy
Lines 68-117:  Just Want Stable Ports (with naming, install)
Lines 120-200: Run Your Whole Stack (with .portdaddyrc examples)
Lines 203-316: Agent Coordination (sugar, pub/sub, locks, agents, salvage)
Lines 320-371: Sessions & Notes
Lines 373-523: Sugar Commands (detailed CLI + REST + SDK)
Lines 525-567: Changelog feature
Lines 569-616: Multi-Agent Patterns
Lines 618-655: Local DNS
Lines 657-667: When NOT to Use
Lines 670-697: JavaScript SDK
Lines 700-718: AI Agent Skill
Lines 721-895: CLI Reference (ALL commands in tables)
Lines 899-924: Feature Coverage Matrix
Lines 928-957: API Reference
Lines 961-1002: How It Works (architecture, config, security, detection)
Lines 1005-1007: License
```

## Appendix B: Port Daddy's MCP Tools (44 total)

**Core Session Lifecycle (3):** begin_session, end_session_full, whoami

**Port Management (4):** claim_port, release_port, list_services, get_service

**Sessions (5):** start_session, end_session, add_note, list_sessions, list_notes

**Coordination (4):** acquire_lock, release_lock, list_locks, publish_message, get_messages

**Agents (4):** register_agent, agent_heartbeat, list_agents, check_salvage, claim_salvage

**Files (3):** claim_files, list_file_claims, who_owns_file

**Integration (3):** integration_ready, integration_needs, integration_list

**DNS (6):** dns_register, dns_unregister, dns_list, dns_lookup, dns_cleanup, dns_status

**Other (8+):** set_session_phase, briefing_generate, briefing_read, start_tunnel, stop_tunnel, list_tunnels, scan_project, daemon_status, activity_log, health_check

**Recommended Tier 1 (always loaded):** begin_session, end_session_full, whoami, claim_port, release_port, add_note, acquire_lock, list_services

**Recommended Tier 2 (on request):** Everything else, loaded via pd_discover meta-tool

## Appendix C: Terminal Recording Script (vhs)

```tape
# Port Daddy Demo — core workflow
# Run: vhs demo.tape

Output demo.gif
Set FontSize 16
Set Width 800
Set Height 400
Set Theme "Catppuccin Mocha"
Set TypingSpeed 80ms

Type "npm install -g port-daddy"
Enter
Sleep 2s

Type "pd begin 'Building auth system'"
Enter
Sleep 1.5s

Type "pd note 'JWT middleware complete'"
Enter
Sleep 1s

Type "pd note 'OAuth flow working' --type commit"
Enter
Sleep 1s

Type "pd whoami"
Enter
Sleep 2s

Type "pd done 'Auth system complete, all tests passing'"
Enter
Sleep 2s
```
