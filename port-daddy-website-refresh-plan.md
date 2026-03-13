# Port Daddy Website Refresh — v3.7 Distribution Launch

## Current State
- **Website**: `website/index.html` (49KB, single-page, beautiful design)
- **Tutorials**: 5 complete tutorials (getting-started through debugging)
- **Docs**: `/docs` folder exists but minimal
- **Images**: Feature images, logos, og-image.png exist
- **Deployment**: Cloudflare Pages (already set up)
- **Missing**: llms.txt, robots.txt, sitemap.xml, distribution documentation, refreshed installation section

## v3.7 Refresh Scope: Add Distribution Channels

### Phase 1: Distribution Documentation (2 hours)

**Create new documentation pages:**

1. **`website/docs/installation.md`** (NEW)
   - Four installation methods:
     - npm (existing + link to updates)
     - Homebrew (new in v3.7)
     - Claude Marketplace Skill (new in v3.7)
     - Claude Code Plugins (new in v3.7)
   - Auto-update instructions per channel
   - Comparison table (which for whom)
   - Troubleshooting install issues

2. **`website/docs/distribution-channels.md`** (NEW)
   - Explain skill vs plugin vs MCP
   - How each channel works
   - Auto-update mechanisms
   - When to use which channel
   - Multi-channel coordination

3. **`website/docs/claude-agent-integration.md`** (NEW - Replaces current MCP docs)
   - Port Daddy as MCP server
   - 44 available MCP tools
   - Agent skill (knowledge layer)
   - Agent coordination patterns
   - Example: Claude Code + Port Daddy workflow

### Phase 2: Update index.html (1 hour)

**Refresh hero section:**
- Update badge: "v3.7.0 — Now on Homebrew, Claude Marketplace, and npm"
- Revise subtitle to highlight multi-channel availability
- Add four installation tabs instead of single command

**Update installation section (#install):**
- Replace 3 cards with 4 cards:
  1. npm (existing, highlight as "most popular")
  2. Homebrew (NEW, highlight for macOS)
  3. Claude Marketplace Skill (NEW, highlight for agents)
  4. Claude Code Plugins (NEW, highlight for full automation)
- Add "Auto-Update" details for each
- Add platform compatibility matrix

**Add new section: "For AI Agents" (after features)**
- Highlight multi-agent coordination
- Show SKILL.md activation keywords
- 44 MCP tools available
- Real workflow: "Claude Code + Port Daddy = agent orchestration"

**Update navigation:**
- Add link to new `/docs/distribution-channels`
- Add link to `/docs/claude-agent-integration`

### Phase 3: SEO Infrastructure (1 hour)

**Create files in `website/`:**

1. **`llms.txt`** (NEW - For LLM indexing)
   ```
   # Port Daddy — Authoritative Port Management for Multi-Agent Development
   
   Project: curiositech/port-daddy
   Version: 3.7.0
   License: MIT
   
   ## Quick Start
   
   npm: npm install -g port-daddy
   Homebrew: brew install port-daddy
   Claude Marketplace: Search "Port Daddy" → Install
   
   ## What it does
   
   - Atomic port assignment (SQLite-backed)
   - Service orchestration (pd up)
   - Multi-agent coordination (sessions, notes, pub/sub, locks)
   - AI agent-native (44 MCP tools)
   - Distributed locks and messaging
   - DNS registration for local hostnames
   - Agent resurrection (salvage system)
   
   ## Supported Frameworks (60+)
   
   Node.js (Next.js, Vite, Nuxt, Svelte, Astro, React, Vue, etc.)
   Python (FastAPI, Flask, Django, Streamlit, etc.)
   Ruby (Rails, Sinatra)
   Java (Spring, Quarkus, Micronaut)
   Go, Rust, PHP, and more
   
   ## Documentation
   
   - Homepage: https://portdaddy.dev
   - GitHub: https://github.com/curiositech/port-daddy
   - npm: https://npmjs.com/package/port-daddy
   - Tutorials: https://portdaddy.dev/tutorials
   ```

2. **`robots.txt`** (NEW)
   ```
   User-agent: *
   Allow: /
   Disallow: /api
   
   Sitemap: https://portdaddy.dev/sitemap.xml
   ```

3. **`sitemap.xml`** (NEW)
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
     <url>
       <loc>https://portdaddy.dev</loc>
       <lastmod>2026-03-02</lastmod>
       <changefreq>weekly</changefreq>
       <priority>1.0</priority>
     </url>
     <url>
       <loc>https://portdaddy.dev/docs/installation</loc>
       <lastmod>2026-03-02</lastmod>
       <changefreq>monthly</changefreq>
       <priority>0.9</priority>
     </url>
     <url>
       <loc>https://portdaddy.dev/docs/distribution-channels</loc>
       <lastmod>2026-03-02</lastmod>
       <changefreq>monthly</changefreq>
       <priority>0.8</priority>
     </url>
     <url>
       <loc>https://portdaddy.dev/docs/claude-agent-integration</loc>
       <lastmod>2026-03-02</lastmod>
       <changefreq>monthly</changefreq>
       <priority>0.8</priority>
     </url>
     <url>
       <loc>https://portdaddy.dev/tutorials</loc>
       <lastmod>2026-03-02</lastmod>
       <changefreq>monthly</changefreq>
       <priority>0.8</priority>
     </url>
   </urlset>
   ```

### Phase 4: New Hero Images via Ideogram (3-4 hours)

**Generate 6 new images for distribution refresh:**

1. **`website/images/distribution-hero.png`**
   - Show Port Daddy across multiple devices/channels
   - npm terminal, Homebrew icon, Claude Code interface, GitHub repo
   - Clean, modern, light palette (matching existing hero.png)
   - Dimensions: 1200x600px
   - Prompt: "Flat design illustration showing Port Daddy installation across npm, Homebrew, and Claude AI agents. Clean, modern palette with navy (#1e3a5f), teal (#4a7c7e), and cream. Show a terminal on left with npm command, Homebrew bottle on right, and Claude Code window in center. Minimalist style, professional."

2. **`website/images/agent-coordination.png`**
   - Multiple AI agents (Claude, Cursor, Aider, Windsurf logos) working together
   - Port numbers assigned, sessions active, pub/sub messaging flowing
   - Show coordination layer between them
   - Dimensions: 1200x600px
   - Prompt: "Flat design illustration of 4 different AI coding agents (Claude, Cursor, Aider, Windsurf) arranged in circle around Port Daddy at center. Agents have distinct colors but cohesive. Show port assignments (3100, 3101, 3102, 3103) and pub/sub message flows (arrows). Minimalist, professional, navy and teal palette."

3. **`website/images/marketplace-showcase.png`**
   - Show "Port Daddy" in Claude Code marketplace UI
   - Install button, description, skill activation
   - Dimensions: 1200x600px
   - Prompt: "Screenshot-style flat design of Claude Code marketplace showing Port Daddy plugin. Show search bar, plugin card with icon, description 'Multi-Agent Coordination', install button, skill keywords below. Professional, modern UI design, matching Claude Code aesthetic."

4. **`website/images/cli-to-cloud.png`**
   - Show Port Daddy command-line on left, cloud/distribution on right
   - npm, Homebrew, marketplace arrows flowing out
   - Show happy developer at desk in background
   - Dimensions: 1200x600px
   - Prompt: "Flat design illustration showing 'pd' command on left side with terminal window, flowing into cloud of distribution options on right: npm package, Homebrew bottle, Claude Marketplace icon, GitHub icon. Minimalist style, navy and teal colors, showing ease of installation."

5. **`website/images/v3.7-features.png`**
   - Highlight new in v3.7: Homebrew, Marketplace, Plugins
   - Grid layout showing the three new features
   - Dimensions: 1200x400px
   - Prompt: "Flat design grid showing three new v3.7 features: Homebrew bottle with checkmark, Claude Marketplace icon with sparkle, and plugin icon with integration arrows. Clean, professional, navy and teal palette, minimalist style."

6. **`website/images/skills-vs-plugins.png`**
   - Left side: Skill (knowledge, SKILL.md, patterns)
   - Right side: Plugin (tools, MCP, automation)
   - Middle: Both options available
   - Dimensions: 1000x600px
   - Prompt: "Comparison flat design illustration: Left shows 'Skill' with book/education icon and SKILL.md file, right shows 'Plugin' with gears/tools icon and 44 MCP tools. Middle shows both available in Port Daddy. Use navy (#1e3a5f), teal (#4a7c7e), and cream (#faf9f6) palette. Professional, minimalist."

### Phase 5: Update Tutorial Index (30 min)

**`website/content/tutorials/README.md`** - Already exists, update:
- Add section: "Learning path for AI agents" (Tutorial 2 focus)
- Add link to new `/docs/claude-agent-integration`
- Add "New in v3.7" callout: Multi-channel installation

### Phase 6: CLAUDE.md Extension (2 hours)

**In project `CLAUDE.md`, add:**

```markdown
## Distribution Channels (v3.7+)

Port Daddy is distributed across four channels for maximum reach:

### Installation Options

1. **npm** (universal)
   ```bash
   npm install -g port-daddy@latest
   ```
   - Works on macOS, Linux, Windows
   - Requires Node.js
   - Update: `npm install -g port-daddy@latest` or automated via Homebrew

2. **Homebrew** (macOS/Linux native)
   ```bash
   brew install port-daddy
   brew upgrade port-daddy  # or autoupdate
   ```
   - Native formula, cleaner than npm
   - Auto-upgrades with `brew autoupdate start`
   - No npm dependency

3. **Claude Marketplace - Skill** (for AI agents)
   - Search "Port Daddy" in Claude Code
   - 1-click install
   - Activation keywords: "port conflict", "coordinate agents", "multi-agent"
   - Gets domain knowledge (SKILL.md, 424 lines of patterns)
   - Auto-updates when released

4. **Claude Code Plugins** (official)
   - GitHub-based, official Anthropic repo
   - Includes Skill + 44 MCP tools
   - Complete automation + knowledge
   - Auto-updates via CI/CD

### Why Multiple Channels?

- **npm**: Reaches Node developers, works everywhere
- **Homebrew**: Native macOS/Linux experience, easy to manage
- **Skill**: Teaches Port Daddy domain knowledge (when/why/patterns)
- **Plugin**: Full tool invocation (how) + knowledge (why)

### Version Management

- npm: Latest is 3.7.0
- Homebrew: Auto-syncs from npm
- Marketplace: Auto-syncs from GitHub releases
- Docs: Always synced at portdaddy.dev

### Release Process (v3.7+)

1. Bump version in package.json
2. Update CHANGELOG.md
3. Run tests: `npm test`
4. Tag release: `git tag v3.7.0 && git push origin v3.7.0`
5. GitHub Actions:
   - npm publish (automatic)
   - Homebrew formula update (automatic)
   - Marketplace webhook (automatic)
6. Users get updates via their chosen channel

### Choosing a Channel

| User Type | Best Channel | Why |
|-----------|-------------|-----|
| Node.js developer | npm | Universal, works everywhere |
| macOS developer | Homebrew | Native, clean, auto-updates |
| Claude Code user | Marketplace Skill | Learn patterns, keyword activation |
| AI agent automation | Claude Code Plugin | Full tools + knowledge |
| All of the above | Install all! | Each has a role |

### For AI Agents Specifically

Port Daddy ships both ways:

**Skill (Knowledge)**
- 424 lines of Port Daddy doctrine
- Activation: Keywords like "coordinate agents", "claim port"
- Teaching: Patterns, philosophy, when to use what
- No MCP server required

**Plugin (Tools + Knowledge)**
- 44 MCP tools (begin_session, end_session, claim_port, etc.)
- Includes Skill (patterns)
- Execution: Can actually invoke operations
- MCP server spawned on-demand

**Both are updated together** when you release a new version.

### Multi-Agent Coordination Workflow

This is where Port Daddy shines. With both Skill + Plugin installed:

```bash
# Agent A starts work
pd begin "Implementing auth feature" --files src/auth.ts

# Agent A signals readiness
pd integration ready port-daddy:api "Auth endpoints ready for frontend"

# Claude reads the skill → understands coordination patterns
# Claude uses MCP tools → invokes begin_session, add_note, integration_ready

# Agent B sees the integration signal
# Both agents coordinate without stepping on each other
```

### SEO & Discovery

- **portdaddy.dev**: Marketing site + docs
- **npm**: `npm search port-daddy`
- **Homebrew**: `brew search port-daddy`
- **Claude Marketplace**: Search "Port Daddy" or keywords
- **GitHub**: `github.com/curiositech/port-daddy`

### Contributing to Marketplaces

If you want Port Daddy in additional marketplaces:

1. **Additional Skill Marketplaces**: Submit to Anthropic's official skill marketplace
2. **Docker**: `docker pull curiositech/port-daddy`
3. **VSCode Extension**: Could be next (integrate Port Daddy into sidebar)
4. **Cursor Extensions**: Similar to VSCode, already Cursor-aware
```

---

## File Checklist: Ready to Ship v3.7 Website Refresh

### Documentation (New)
- [ ] `website/docs/installation.md` (four channels, auto-update, comparison)
- [ ] `website/docs/distribution-channels.md` (skill vs plugin, how each works)
- [ ] `website/docs/claude-agent-integration.md` (MCP, skill, workflows)

### SEO Infrastructure (New)
- [ ] `website/llms.txt` (LLM indexing metadata)
- [ ] `website/robots.txt` (search engine crawling rules)
- [ ] `website/sitemap.xml` (site structure for SEO)

### Images (New, via Ideogram)
- [ ] `website/images/distribution-hero.png` (1200x600)
- [ ] `website/images/agent-coordination.png` (1200x600)
- [ ] `website/images/marketplace-showcase.png` (1200x600)
- [ ] `website/images/cli-to-cloud.png` (1200x600)
- [ ] `website/images/v3.7-features.png` (1200x400)
- [ ] `website/images/skills-vs-plugins.png` (1000x600)

### HTML Updates (index.html)
- [ ] Update badge: "v3.7.0 — Now on Homebrew, Claude Marketplace, npm"
- [ ] Add "For AI Agents" section
- [ ] Replace 3-card install section with 4-card (npm, Homebrew, Skill, Plugin)
- [ ] Add auto-update instructions per channel
- [ ] Update navbar links to point to new /docs pages
- [ ] Add og-image metadata refresh (use new v3.7-features.png)

### Project Documentation
- [ ] CLAUDE.md: Add "Distribution Channels (v3.7+)" section

### Verification
- [ ] All links work (internal: /docs/installation, /tutorials, external: GitHub, npm)
- [ ] Images load correctly
- [ ] Mobile responsive (test on phone)
- [ ] Lighthouse score ≥ 90
- [ ] llms.txt is valid and reachable
- [ ] sitemap.xml validates
- [ ] robots.txt allows search engines
- [ ] og-image.png displays on social shares (LinkedIn, Twitter)

---

## Image Generation Priority

**Create via Ideogram (in order):**

1. **distribution-hero.png** (2 min) - Use in hero section
2. **agent-coordination.png** (3 min) - Use in "For AI Agents" section
3. **marketplace-showcase.png** (2 min) - Use in install section callout
4. **v3.7-features.png** (2 min) - Use as badge/callout
5. **cli-to-cloud.png** (2 min) - Use in footer or CTA
6. **skills-vs-plugins.png** (2 min) - Use in `/docs/distribution-channels`

**Total image generation time: ~15 min on Ideogram**

---

## Parallel Work Breakdown

**If you have 2 agents:**

**Agent A (2 hours):**
- Image generation (6 images, 15 min)
- llms.txt, robots.txt, sitemap.xml creation (15 min)
- Update CLAUDE.md (30 min)
- Total: 1 hour (can do other things with remaining hour)

**Agent B (3 hours):**
- Create 3 new markdown docs (1 hour)
- Update index.html (1 hour)
- Update tutorials README (30 min)
- Test and verify (30 min)
- Total: 3 hours

**Sequential Timeline: 3 hours total** (if parallel)
**Or: 5 hours** (if sequential)

---

## Success Metrics After Refresh

1. **Installation section shows all 4 channels**
2. **SEO files present** (llms.txt, robots.txt, sitemap.xml)
3. **New documentation pages live** at /docs/installation, /docs/distribution-channels, /docs/claude-agent-integration
4. **Images refreshed** showing Homebrew, Marketplace, multi-agent coordination
5. **CLAUDE.md updated** with distribution guidance
6. **Lighthouse score ≥ 90**
7. **All links functional**
8. **og-image renders correctly on social shares**

---

## After v3.7 Ships

1. Tag and release: `git tag v3.7.0 && git push origin v3.7.0`
2. npm publish (automatic via GitHub Actions)
3. Homebrew formula updates (automatic)
4. Marketplace webhooks trigger (automatic)
5. Website redeploy (automatic via Cloudflare Pages)
6. Verify:
   - `brew search port-daddy` → formula found
   - `npm search port-daddy` → v3.7.0 listed
   - Claude Marketplace → Port Daddy available
   - portdaddy.dev homepage → updated

Done. Users get Port Daddy across 4 channels with zero extra work.

