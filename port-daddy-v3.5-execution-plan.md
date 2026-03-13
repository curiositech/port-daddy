# Port Daddy v3.7 Release & Distribution Execution Plan

## Status Check
- Current: v3.4.0 (published 2 days ago)
- Is v3.7 good enough? **YES** — v3.4 has all core features, v3.7 is distribution-focused

## Tasks (Ready to Execute)

### Phase 1: Version Bump (1 hour)
```bash
# In port-daddy repo:
# 1. Update package.json version → 3.7.0
# 2. Update CHANGELOG.md with v3.7 distribution changes
# 3. Update VERSION file if it exists
# 4. Ensure .claude-plugin/plugin.json version matches
# 5. Run: npm run typecheck && npm test
# 6. Commit: "chore: bump to v3.7.0 — distribution release"
```

### Phase 2: Homebrew Formula (2 hours)
```bash
# Create: Formula/port-daddy.rb in repo
# Contents: (from earlier analysis)
# - Depends on Node.js
# - Downloads from GitHub releases
# - Installs to /usr/local/bin
# - Test: brew --developer, then: brew install Formula/port-daddy.rb

# Option A (Private Tap): Create curiositech/homebrew-port-daddy repo
# Option B (Public): Submit to homebrew-core (2-week review, eventual `brew install port-daddy`)
```

### Phase 3: GitHub Releases Setup (1 hour)
```bash
# 1. Create GitHub Actions workflow (.github/workflows/release.yml)
# 2. On tag v3.7.0:
#    - Build dist/
#    - Create GitHub release with notes
#    - Generate SHA256 for Homebrew
# 3. Tag release: git tag v3.7.0 && git push origin v3.7.0
```

### Phase 4: Vercel Site (3-4 hours)
```
Deliverables:
  - portdaddy.dev domain (or port-daddy.dev)
  - Hosted on Vercel (0 config)
  - Auto-deploying from GitHub
  - Content:

/
  - Hero: "Port Daddy — The Authoritative Port Manager"
  - CTA: "Install now"
  - Feature highlights

/docs
  - /installation (npm, Homebrew, Claude marketplace)
  - /getting-started
  - /cli-reference
  - /api-reference
  - /mcp-tools
  - /best-practices
  - /troubleshooting

/changelog
  - Auto-generated from CHANGELOG.md

Structure:
  - Next.js + MDX (or Astro for static)
  - Synced from GitHub markdown
  - One-click deploy preview on PRs
  - Dark mode (port-daddy theme colors)
```

### Phase 5: Claude Marketplace Submission (1-2 hours)
```
Two submissions:

A. Port Daddy Skill (lightweight)
   - Name: "Port Daddy Agent Coordination"
   - Type: Skill
   - Content: skills/port-daddy-cli/SKILL.md
   - Keywords: port, agent-coordination, multi-agent, sessions
   - Auto-sync: From GitHub repository
   - Portal: Anthropic marketplace submission

B. Port Daddy Plugin (full)
   - Name: "Port Daddy — Multi-Agent Coordination"
   - Type: Plugin (Skill + MCP)
   - Content: .claude-plugin/ + mcp/server.ts
   - Keywords: port, coordination, locks, agents
   - Auto-sync: From GitHub repository
```

### Phase 6: Claude Code Plugins Submission (2 hours)
```
Submit PR to: github.com/anthropics/claude-code-plugins

Files:
  - port-daddy.json (plugin manifest)
  - Reference to SKILL.md
  - MCP configuration
  - Auto-update on release

Expected timeline: 1-2 weeks review + merge
```

### Phase 7: Update CLAUDE.md (2 hours)
```
Add these sections:

## Distribution Channels (NEW)

Port Daddy is distributed across four channels:

### 1. npm (CLI + Daemon + Skill)
```bash
npm install -g port-daddy@latest
pd version
```

### 2. Homebrew (macOS/Linux)
```bash
brew install port-daddy
pd version
```

### 3. Claude Marketplace (Skill Only)
- Search "Port Daddy" in Claude Code
- Install 1-click
- Activation keywords: "port conflict", "coordinate agents"

### 4. Claude Code Plugins (Full Plugin)
- Marketplace listing (Anthropic official)
- Includes MCP tools + Skill
- Auto-updates when released

## Version Management

- **npm**: Manual `npm install -g port-daddy@latest` or automated via Homebrew
- **Homebrew**: `brew upgrade port-daddy` (auto with `brew autoupdate`)
- **Marketplace**: One-click update in Claude Code UI
- **Changelog**: Always in CHANGELOG.md, synced to docs

## Release Process (v3.7+)

1. Bump version in package.json + .claude-plugin/plugin.json
2. Update CHANGELOG.md
3. Run tests: `npm test`
4. Commit: `git commit -m "chore: bump to vX.Y.Z"`
5. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`
6. GitHub Actions:
   - Publishes to npm
   - Generates release notes
   - Updates Homebrew formula
   - Triggers marketplace sync
7. Users automatically get updates via their preferred channel

## Website (portdaddy.dev)

Documentation site auto-synced from GitHub markdown.
- Installation guides for each channel
- API/CLI reference
- Best practices
- Troubleshooting

Deploy: `git push origin main` → Vercel auto-deploys

## Skill vs Plugin Decision

**Use Skill for:**
- Knowledge transfer (patterns, philosophy)
- Lightweight distribution
- Users who want to read about Port Daddy

**Use Plugin for:**
- Complete automation
- Tool invocation
- Users who want Claude to use Port Daddy

**Port Daddy ships BOTH** via different marketplace channels.
```

### Phase 8: llms.txt & SEO Files (1 hour)
```
Create:
  - /llms.txt (for LLM indexing)
  - /robots.txt (SEO)
  - /sitemap.xml (SEO)
  - /og-image.png (social preview)

llms.txt contents:
  - Project description
  - GitHub URL
  - npm/Homebrew links
  - Installation commands
  - Quick reference
```

### Phase 9: Documentation Sync (1 hour)
```bash
# Vercel will auto-sync from:
# - README.md
# - CLAUDE.md
# - docs/ directory
# - CHANGELOG.md

# Paths:
# /docs/installation → README installation section
# /docs/getting-started → docs/getting-started.md
# /docs/api → docs/api.md
# /changelog → CHANGELOG.md (auto-formatted)
```

---

## Total Effort Estimate

| Phase | Hours | Blocker? |
|-------|-------|----------|
| Version bump | 1 | ❌ No |
| Homebrew | 2 | ❌ No |
| GitHub Actions | 1 | ❌ No |
| Vercel site | 4 | ❌ No |
| Marketplace (Skill) | 1.5 | ❌ No |
| Marketplace (Plugin) | 1.5 | ❌ No |
| Claude Code Plugins | 2 | ❌ No |
| CLAUDE.md update | 2 | ❌ No |
| llms.txt + SEO | 1 | ❌ No |
| Docs sync | 1 | ❌ No |
| **Total** | **16.5 hours** | **All parallelizable** |

---

## Parallelization Strategy

These can run in parallel:
- Homebrew formula (2h) ← Git release workflow (1h) ← Version bump (1h)
- Vercel site (4h) ← GitHub sync setup (1h)
- Marketplace submissions (3h) ← .claude-plugin enhancement (1h)
- CLAUDE.md (2h) ← Documentation review (1h)

**Critical path: 7 hours (if parallelized)**
**Sequential: 16.5 hours**

---

## Checklist: Ready to Ship v3.7

### Code Changes
- [ ] Version bumped to 3.7.0 in package.json
- [ ] Version bumped in .claude-plugin/plugin.json
- [ ] CHANGELOG.md updated with v3.7 distribution notes
- [ ] Tests passing: `npm test`
- [ ] Build successful: `npm run build`

### Distribution Files
- [ ] Formula/port-daddy.rb created
- [ ] .github/workflows/release.yml created (npm + Homebrew sync)
- [ ] .claude-plugin/marketplace.json enhanced
- [ ] llms.txt created with Port Daddy info

### Documentation
- [ ] CLAUDE.md updated with distribution channels section
- [ ] README.md updated with Homebrew installation
- [ ] docs/installation.md created (all channels)
- [ ] docs/getting-started.md (sugar commands focus)
- [ ] docs/faq.md (troubleshooting)

### Website (Vercel)
- [ ] portdaddy.dev domain registered/configured
- [ ] Vercel project created + GitHub synced
- [ ] Next.js or Astro site scaffolded
- [ ] Content pages created (/, /docs, /changelog)
- [ ] Dark mode styled
- [ ] Mobile responsive
- [ ] og-image.png created
- [ ] robots.txt + sitemap.xml

### Marketplace Submissions
- [ ] Anthropic Marketplace account created
- [ ] Port Daddy Skill submitted
- [ ] Port Daddy Plugin submitted
- [ ] Claude Code Plugins PR submitted to Anthropics repo

### Post-Release
- [ ] npm publish successful
- [ ] GitHub release created with notes
- [ ] Homebrew formula accessible
- [ ] Website live at portdaddy.dev
- [ ] Marketplace listings visible
- [ ] Auto-update mechanism tested

---

## What v3.7 Actually Includes

**No new features, just distribution:**
- ✅ All v3.4 functionality
- ✅ Homebrew installation path
- ✅ Claude marketplace presence
- ✅ Documentation website
- ✅ Improved CLAUDE.md
- ✅ SEO infrastructure

**Next version (v3.6) can add:**
- More dashboard features
- Vercel integration examples
- Agent resurrection UI
- Advanced workflows

---

## Success Metrics (After v3.7 release)

1. **Installation Paths** (4 working):
   - npm install -g port-daddy (existing)
   - brew install port-daddy (new)
   - Claude Marketplace skill (new)
   - Claude Code Plugins (new)

2. **Documentation**:
   - portdaddy.dev live with installation guides
   - CLAUDE.md documents distribution process
   - Auto-sync working (docs → website)

3. **Discoverability**:
   - Google search: "port daddy cli" → finds site
   - Claude Code search: "agent coordination" → finds Port Daddy
   - npm search: "port-daddy" → v3.7 listed
   - brew: "brew search port-daddy" → formula found

4. **Auto-Update**:
   - Homebrew users: `brew upgrade` works
   - npm users have docs on auto-update
   - Marketplace shows "update available"

---

## Recommended Agent Assignment

**For parallel execution (2-3 agents):**

**Agent A (2 hours):**
- Version bump
- CLAUDE.md update
- Release coordination

**Agent B (4 hours):**
- Vercel site setup + content
- llms.txt creation
- SEO configuration

**Agent C (4 hours):**
- Homebrew formula + GitHub Actions
- Marketplace submissions
- Documentation sync

**Agent D (optional, 2 hours):**
- Testing all channels after release
- Verifying auto-updates work
- Community testing

---

## Next Steps (If You Have Other Agents)

1. **Declare this as a multi-agent project**
   ```bash
   pd begin "Port Daddy v3.7 distribution release" \
     --agent coordinator \
     --identity port-daddy:release:v3.7
   ```

2. **Claim file ownership**
   ```bash
   pd session files add \
     package.json \
     .claude-plugin/plugin.json \
     CLAUDE.md \
     Formula/port-daddy.rb
   ```

3. **Coordinate via notes**
   ```bash
   pd note "Agent A: version bump done, ready for publishing"
   pd note "Agent B: Vercel site live at portdaddy.dev"
   pd note "Agent C: Homebrew + marketplace ready"
   ```

4. **When complete**
   ```bash
   pd done "v3.7 released across all channels, auto-updates working"
   ```

