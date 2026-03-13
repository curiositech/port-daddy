# Port Daddy Distribution Strategy: NPM + Homebrew + Plugin Marketplace

## Executive Summary

Port Daddy should pursue a **multi-channel distribution strategy** across:
1. **npm** (already done, v3.4.0 published)
2. **Homebrew** (recommended)
3. **Claude Plugin Marketplace** (recommended for agent skills)
4. **Claude Code Plugins** (new, emerging)

With **automatic updates** via marketplace refresh + version pinning in `package.json`.

---

## Current State (2026-03-02)

### npm
- **Published:** ✅ v3.4.0 (2 days ago)
- **Binary:** ✅ `pd` and `port-daddy` commands installed globally
- **Includes:** ✅ MCP server (`pd mcp`), CLI, SDK, Skill in `.claude-plugin/`
- **Update:** Manual (`npm install -g port-daddy@latest`)

### Homebrew
- **Status:** ❌ Not available
- **Opportunity:** Large macOS developer audience

### Claude Plugin Marketplace
- **Status:** ❌ Not published
- **Opportunity:** Auto-discovery, skill distribution, auto-update

### Claude Code Plugins
- **Status:** ❌ Not published
- **Opportunity:** New emerging channel (GitHub-based)

### Local Installation
- **Skill:** ✅ `~/.claude/commands/port-daddy.md` (manual, 247 lines)
- **MCP:** ✅ `~/.claude.json` configured (via npm link)

---

## Deep Dive: Distribution Channels

### 1. NPM (Existing)
```bash
npm install -g port-daddy
# → /usr/local/bin/pd
# → Includes SKILL.md in .claude-plugin/
# → Includes mcp/server.ts
# → ~npm link'd globally for MCP
```

**Pros:**
- Already working
- Reaches Node developers
- Natural CLI distribution
- Can include Skill + MCP

**Cons:**
- Manual version management
- Not discoverable to non-Node users
- Requires npm install -g (permissions issues on some systems)

**Update Mechanism:**
```bash
# Manual
npm install -g port-daddy@latest

# Automated (user configures)
npm-upgrade, volta, fnm with auto-upgrade
```

---

### 2. Homebrew (Recommended)

**Why:**
- 40M+ macOS/Linux developers
- Single command: `brew install port-daddy`
- Auto-update: `brew upgrade port-daddy` (or automatic with Homebrew auto-update)
- No permission issues

**How to Submit:**
1. Create homebrew-port-daddy tap (private)
2. Submit to homebrew-core (public)
3. GitHub releases with proper tags

**Formula Structure:**
```ruby
class PortDaddy < Formula
  desc "Authoritative port manager for multi-agent development"
  homepage "https://github.com/curiositech/port-daddy"
  url "https://github.com/curiositech/port-daddy/archive/v3.4.0.tar.gz"
  sha256 "..."
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", "--prefix", buildpath, "--production"
    system "npm", "link", "--prefix", buildpath
    # Installs: /usr/local/bin/pd, /usr/local/bin/port-daddy
  end

  test do
    assert_match "Port Daddy", shell_output("#{bin}/pd version")
  end
end
```

**Update Flow:**
```
1. Release on GitHub (v3.7.0 tag)
2. homebrew-port-daddy tap auto-syncs (or manual PR to homebrew-core)
3. User runs: brew upgrade port-daddy
4. Gets v3.7.0 automatically
```

---

### 3. Claude Plugin Marketplace (Recommended for Skills)

**Status:** Emerging (2026)
**Format:** GitHub-based, auto-discovery
**What:** Skills + plugins + workflows

**Installation Flow:**
```
User opens Claude Code
→ Settings → Plugins → Browse
→ Search "port-daddy"
→ Click Install
→ Downloads from GitHub/marketplace
→ Auto-configures ~/.claude/ entries
```

**Two Types of Listings:**

#### A. Agentic Skill (Pure Knowledge)
```
Name: Port Daddy CLI Patterns
Type: Skill (knowledge base, not callable)
Activation: Keywords ("claim port", "coordinate agents")
Content: SKILL.md (424 lines of doctrine)
Updates: Via GitHub webhook
Version: Synced to port-daddy npm version
```

**Pros:**
- Lightweight (no MCP server startup)
- Auto-discoverable
- Pattern-focused
- Easy to update
- Users don't need to install npm package

**Cons:**
- Tools not directly callable
- Requires CLI for actual operations

#### B. Full Plugin (Skill + MCP Tools)
```
Name: Port Daddy Agent Coordination
Type: Plugin (skill + MCP tools)
Activation: Keywords + MCP tools available
Content: SKILL.md + 44 MCP tools
Includes: mcp/server.ts execution
Updates: Via GitHub webhook
Dependencies: Node.js + npm (for pd mcp)
```

**Pros:**
- Complete system (knowledge + tools)
- Tools directly invokable by Claude
- Single install point
- Auto-update via marketplace

**Cons:**
- Heavier (MCP daemon startup)
- Dependencies (Node, npm)
- More complex manifest

---

### 4. Claude Code Plugins (New, GitHub-Based)

**Status:** Newly emerged (early 2026)
**Format:** Native Claude Code integration
**Repository:** github.com/anthropics/claude-code-plugins

**Installation:**
```
Similar to other marketplace plugins
But hosted in Anthropic's official repo
```

**Advantage:**
- Official Anthropic channels
- High discoverability
- Community vetting
- Auto-updated via CI/CD

---

## Recommended Strategy: Multi-Channel with Auto-Update

### Distribution Matrix

| Channel | Distribution | Content | Update | Auto? |
|---------|--------------|---------|--------|-------|
| **npm** | `npm install -g` | CLI + MCP + Skill | `npm upgrade -g` | With config |
| **Homebrew** | `brew install` | CLI + MCP + Skill | `brew upgrade` | ✅ Yes |
| **Claude Skill Marketplace** | Built-in marketplace | SKILL.md only | GitHub webhook | ✅ Yes |
| **Claude Code Plugins** | Official repo | Skill + MCP | GitHub CI/CD | ✅ Yes |
| **Website** | docs.portdaddy.io | Reference | Manual | — |
| **GitHub** | curiositech/port-daddy | Source + releases | Per tag | — |

### Phase 1 (Immediate: v3.4+)
✅ **Already done:**
- npm package published
- Skill bundled in `.claude-plugin/`
- MCP server working
- Local commands in `~/.claude/commands/`

### Phase 2 (Next Release: v3.7)
1. **Homebrew Formula**
   - Create homebrew-port-daddy tap
   - Test locally with `brew --developer`
   - Submit to homebrew-core (2-week review)
   - Or maintain private tap for users

2. **Claude Skill Marketplace**
   - Create `.claude-plugin/marketplace.json` (already has it!)
   - List port-daddy-cli skill
   - URL points to GitHub raw content (auto-sync)
   - Or publish to official marketplace

3. **GitHub Releases**
   - Tag releases properly (v3.7.0)
   - Include release notes
   - Homebrew will auto-detect

### Phase 3 (Long-term)
- **Documentation Site** (optional)
  - docs.portdaddy.io
  - Hosted on Vercel/Netlify
  - Mirror of GitHub docs
  
- **GitHub Discussions**
  - For user questions
  - Community coordination examples

---

## Auto-Update Mechanisms by Channel

### npm
```bash
# Manual
npm install -g port-daddy@latest

# Automatic (requires user config)
# Option 1: npm-check-updates + cron
npm-check-updates -g -u && npm install -g

# Option 2: npx pm2-installer with auto-update
npx port-daddy install-daemon  # Auto-updater included?

# Option 3: Volta pin + auto-update feature
volta pin node@22 port-daddy@latest
```

### Homebrew
```bash
# Manual
brew upgrade port-daddy

# Automatic (built-in)
brew autoupdate start  # macOS feature
# Or scheduled: brew upgrade port-daddy daily via launchd
```

### Claude Marketplace
```
Marketplace auto-checks GitHub releases
Finds new tags matching version pattern (v*.*.*)
Downloads and reinstalls to ~/.claude/plugins/
User sees "update available" notification
One-click update in Claude Code UI
```

### Direct GitHub Webhook
```json
{
  "source": {
    "source": "github",
    "repo": "curiositech/port-daddy",
    "path": ".claude-plugin"  // Watch this directory for changes
  }
}
```

---

## Architectural Decision: Skill vs Plugin vs MCP

### Option A: Skill Only (Minimal)
```
Distribution: Claude Marketplace Skill
Content: SKILL.md (424 lines, patterns + workflows)
Tools: None (requires CLI invocation)
Auto-Update: ✅ Yes (marketplace webhook)
User Action: Reads skill, runs pd commands manually
```

**Good for:** Knowledge transfer, pattern teaching
**Bad for:** Agent automation, tool invocation

### Option B: Plugin (Full)
```
Distribution: Claude Code Plugins repo
Content: Skill + 44 MCP tools + resources
Execution: MCP daemon spawned on-demand
Auto-Update: ✅ Yes (CI/CD)
User Action: Invoke tools directly, reads patterns
```

**Good for:** Complete automation, pattern-aware tool use
**Bad for:** Lightweight distribution, doesn't include CLI

### Option C: Dual Channel (Recommended)
```
Distribution:
  1. npm + Homebrew (CLI + daemon + MCP server + Skill)
  2. Claude Marketplace (Skill only for knowledge)
  3. Claude Code Plugins (Full plugin for automation)

Synergy:
  - User runs: brew install port-daddy
  - Gets: CLI (pd), MCP server, Skill loaded locally
  - OR: User installs via marketplace (skill-only or full plugin)
  - Either way: Claude knows patterns + can invoke tools
```

**Best for:** Flexibility, multiple user personas, maximum reach

---

## Implementation Roadmap

### v3.4 (Current)
- [x] npm package published
- [x] Skill + MCP in package
- [x] Local commands setup
- [ ] Homebrew formula (document for users)
- [ ] Marketplace.json enhancement
- [ ] Publish to Claude Skill Marketplace (manual submission)

### v3.7 (Next)
- [ ] Homebrew formula in homebrew-core
- [ ] GitHub releases with proper SemVer tags
- [ ] Auto-update documentation for npm users
- [ ] Publish to Claude Code Plugins (official repo)
- [ ] Website docs.portdaddy.io (optional)

### v3.6+
- [ ] Install-daemon with auto-updater
- [ ] Dashboard showing installed version + available updates
- [ ] Marketplace sync automation

---

## Auto-Update Strategies by User Type

### CLI User (npm/Homebrew)
```bash
# Homebrew users (easiest)
brew autoupdate start
# Port Daddy updates automatically nightly

# npm users (requires script)
alias npm-check='npm outdated -g'
# Then: npm install -g port-daddy@latest
```

### MCP User (Claude Code)
```json
// ~/.claude.json
{
  "mcpServers": {
    "port-daddy": {
      "command": "npx",
      "args": ["port-daddy", "mcp"],
      "autoUpgrade": true  // If supported
    }
  }
}
```

### Plugin User (Claude Marketplace)
```
Marketplace handles updates automatically
Users see "update available" in Claude Code
One-click install
```

---

## File Layout for Distribution

### Package.json (current)
```json
{
  "name": "port-daddy",
  "version": "3.4.0",
  "bin": {
    "port-daddy": "./bin/port-daddy-cli.js",
    "pd": "./bin/port-daddy-cli.js"
  },
  "files": [
    ".claude-plugin/",
    "mcp/",
    "skills/",
    "bin/",
    "lib/",
    "dist/",
    // ... etc
  ]
}
```

### .claude-plugin/plugin.json (current)
```json
{
  "name": "port-daddy",
  "description": "...",
  "version": "3.4.0",  // Should match package.json
  "skills": ["port-daddy-cli"]
}
```

### .claude-plugin/marketplace.json (needs enhancement)
```json
{
  "name": "port-daddy",
  "owner": "curiositech",
  "plugins": [
    {
      "name": "port-daddy",
      "type": "plugin",  // or "skill"
      "marketplace": "claude-code-plugins",  // Target listing
      "source": ".",
      "skills": ["./skills/port-daddy-cli"],
      "mcp": {
        "enabled": true,
        "server": "./mcp/server.ts"
      }
    }
  ]
}
```

---

## Specific Recommendations

### 1. Homebrew (Do This)
```bash
# Create homebrew-port-daddy private tap (or use official)
# Maintains formula compatibility with releases
# Users: brew install curiositech/port-daddy/port-daddy
# Or submit to homebrew-core for: brew install port-daddy

# In port-daddy repo, create: Formula/port-daddy.rb
# GitHub Actions CI: publish formula on release
```

### 2. Claude Marketplace (Do This)
```
Files already present:
  .claude-plugin/plugin.json
  .claude-plugin/marketplace.json
  skills/port-daddy-cli/SKILL.md

Steps:
1. Update marketplace.json with metadata
2. Create marketplace submission (portal.anthropic.com or equivalent)
3. Marketplace auto-syncs from GitHub repo
4. Updates flow: Tag release → GitHub webhook → marketplace update
```

### 3. Claude Code Plugins (Do This)
```
Submit PR to: github.com/anthropics/claude-code-plugins
Include:
  - port-daddy.json (plugin manifest)
  - SKILL.md reference
  - MCP configuration
  - Update frequency: per release

Benefits:
  - Official channel
  - Auto-update via Anthropic's CI
  - High discoverability
```

### 4. Website (Consider)
```
Optional: docs.portdaddy.io
  - Hosted on Vercel (zero-config)
  - Synced from GitHub markdown
  - Installation guides per channel
  - Auto-update docs per release

Not critical, but improves SEO + discoverability
```

---

## Comparison: Skill vs MCP vs Plugin

| Feature | Skill | MCP | Plugin |
|---------|-------|-----|--------|
| **Knowledge Transfer** | ✅ Excellent | ❌ Minimal | ✅ Good |
| **Tool Invocation** | ❌ No | ✅ Yes | ✅ Yes |
| **Auto-Discovery** | ✅ Marketplace | ❌ Manual config | ✅ Marketplace |
| **Update Mechanism** | ✅ Auto (webhook) | ❌ Manual npm | ✅ Auto (CI/CD) |
| **Distribution Size** | Small (424 KB) | Large (3.4 MB) | Medium (2 MB) |
| **User Install** | 1-click (marketplace) | Manual (npm install -g) | 1-click (marketplace) |
| **Node/npm Dep** | ❌ No | ✅ Yes | ✅ Yes |
| **Callable by Claude** | ❌ Via CLI examples | ✅ Direct tools | ✅ Direct tools |
| **Best For** | Teaching patterns | Programmatic automation | Complete system |

---

## Summary & Recommendation

**Port Daddy should pursue ALL FOUR channels:**

1. **npm** - CLI distribution, already working ✅
2. **Homebrew** - Easier macOS install (do next)
3. **Claude Skill Marketplace** - Knowledge distribution + auto-update
4. **Claude Code Plugins** - Full plugin with tools + skills + auto-update

**For each release:**
1. Bump version in package.json
2. Tag release on GitHub (v3.7.0)
3. Publish to npm (`npm publish`)
4. Homebrew auto-detects and publishes
5. Marketplace webhooks auto-sync
6. Users get updates via: `brew upgrade`, `npm install -g`, or marketplace UI

**No manual distribution work needed after initial setup.**

This maximizes reach:
- macOS devs via Homebrew
- Node devs via npm
- Claude users via marketplace (both skill + plugin)
- Everyone via GitHub

