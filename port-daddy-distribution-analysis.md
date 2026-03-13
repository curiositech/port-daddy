# Port Daddy Agent Instructions Distribution Analysis

## The Three Surfaces

### 1. MCP Server (`mcp/server.ts`)
**Activation:** Via `~/.claude.json` MCP configuration
```json
{
  "mcpServers": {
    "port-daddy": {
      "type": "stdio",
      "command": "pd",
      "args": ["mcp"]
    }
  }
}
```

**Current State:**
- **44 MCP tools** exposed (claim_port, release_port, begin_session, end_session_full, etc.)
- Each tool has a full `inputSchema` with types and descriptions
- Tools are organized into logical groups (Port Management, Sessions & Notes, Locks, Messaging, Agents, Salvage, Tunnels, DNS, System, etc.)
- Each tool description is 1-3 sentences explaining what it does
- No "server description" field in Server constructor (just `name: 'port-daddy', version: '3.7.0'`)
- MCP has two delivery mechanisms:
  - **Tools** - Callable functions Claude can use
  - **Resources** - Read-only data Claude can inspect (active services, sessions, agents, locks, tunnels, DNS)

**What Claude Sees:**
- Tool list with descriptions
- Input schemas with field documentation
- Resources metadata
- **NO server-level instructions** (MCP SDK doesn't have this field)

**File Size:**
- `mcp/server.ts`: 1,504 lines
- Implementation-heavy, tool registration focused

**Coverage:**
- ALL Port Daddy capabilities exposed as tools
- Complete parity with REST API
- Real-time resource inspection

---

### 2. Skill (`.claude-plugin/plugin.json` + `skills/port-daddy-cli/SKILL.md`)
**Activation:** Via `.claude-plugin/` directory (distributed with npm package)

**Current State:**
- **Plugin manifest**: Declares `skills: ["port-daddy-cli"]`
- **Skill file** (`SKILL.md`): 424 lines, comprehensive guide
- Content structure:
  - Introduction with philosophy
  - "Compulsory Registration Pattern" workflow
  - Quick reference of commands
  - 5 core philosophies (identity convention, sessions/phases, file claims, integration signals, project briefing)
  - Detailed workflows (dev server, multi-agent, breadcrumbs, locks, direct mode, dashboard)
  - When to use Port Daddy (decision matrix)
  - Anti-patterns
  - Project briefing explanation
  - Worktree-aware development
  - Multi-daemon development
  - DNS for ports
  - Agent resurrection
  - Changelog
  - Change types

**What Claude Sees:**
- Skill activation triggers (keywords like "port conflict", "claim port", "coordinate agents", etc.)
- Complete guide with workflows and philosophy
- Best practices and patterns
- Real-world examples

**File Size:**
- `SKILL.md`: 424 lines (doctrine + examples)
- **Lightweight, readable, pattern-focused**

**Coverage:**
- CLI commands (pd claim, pd session, etc.)
- Workflows and use cases
- Architectural patterns and philosophy
- Best practices and anti-patterns
- Decision matrices for when to use what

**Delivery Model:**
- Bundled with npm package in `package.json` files array
- Installed to `node_modules/port-daddy/skills/` when installed
- Claude's skill system automatically discovers and indexes it

---

### 3. Slash Command (`.claude/commands/port-daddy.md`)
**Activation:** User's personal command configuration

**Current State:**
- 247 lines
- Quick reference format
- Content:
  - "Quick Start: The Sugar Commands" (5 lines on pd begin/done)
  - Port management cheatsheet
  - Locks, messaging, sessions cheatsheet
  - Agent registry API
  - Salvage, DNS, integration signals
  - Briefing
  - File claims
  - REST API quick reference (curl examples)
  - MCP tools list (44 tools in table)
  - Semantic identity format
  - Daemon lifecycle
  - Best practices (7 items)
  - Arguments for context detection

**What Claude Sees:**
- When user types `/port-daddy` or runs it as a command
- Cheatsheet focused on frequently-used operations
- Curl/CLI examples mixed with tool list
- Argument-based context detection

**File Size:**
- **247 lines (ultra-condensed reference)**

**Coverage:**
- CLI cheatsheet
- API reference
- Tool list summary
- Best practices

---

## Comparison Matrix

| Dimension | MCP Server | Skill | Slash Command |
|-----------|-----------|-------|---------------|
| **Lines of Code** | 1,504 | 424 | 247 |
| **Density** | Implementation-heavy | Doctrine + examples | Cheatsheet |
| **Primary Purpose** | Enable tool invocation | Teach patterns & workflows | Quick lookup |
| **Activation Trigger** | Always on (in ~/.claude.json) | Skill activation keywords | User invocation (`/port-daddy`) |
| **What's Included** | 44 callable tools + resources | Philosophy, workflows, patterns | CLI cheatsheet + API reference |
| **Best For** | Programmatic use | Understanding "why" | "How do I do X?" |
| **Discoverability** | Low (must know MCP exists) | High (skill activation) | Manual (requires user knowledge) |
| **Parity** | 100% (all endpoints) | ~70% (common operations) | ~60% (popular commands) |
| **Update Frequency** | Per release (code change) | Per release (content change) | Manual user update |
| **Coupling** | Tight to daemon API | Loose (conceptual) | Loose (reference) |

---

## The Distribution Question: Skill vs MCP vs Both?

### Research: What Makes Sense for Agent Instructions?

#### MCP Server Role
- **Designed for:** Machine-to-machine tool integration
- **Activation:** Configured once, always available
- **Use Case:** "Here are callable operations, Claude use them programmatically"
- **Problem it solves:** Lack of tool capabilities
- **Weakness:** No narrative/pattern guidance — just raw tools with descriptions

#### Skill Role
- **Designed for:** Human-agent knowledge transfer
- **Activation:** Context-aware keyword matching
- **Use Case:** "Here's how to do work in this domain, with examples and philosophy"
- **Problem it solves:** Lack of domain knowledge and pattern understanding
- **Strength:** Teaches *why* and *when*, not just *what*

#### Slash Command Role
- **Designed for:** Quick reference + custom context detection
- **Activation:** Explicit user invocation
- **Use Case:** "Quick lookup of commands I'm about to use"
- **Problem it solves:** Too much information, need condensed form
- **Weakness:** Doesn't teach patterns, just lists options

---

### Current Distribution in Port Daddy (2026-03-02)

**Status:**
1. ✅ **MCP Server** - Fully implemented and active (`~/.claude.json`)
2. ✅ **Skill** - Fully implemented, bundled with npm package
3. ✅ **Slash Command** - Fully implemented, installed to `~/.claude/commands/`

**Alignment:**
- MCP has 44 tools — all major operations exposed
- Skill has workflows covering 5 philosophies + 7 use cases
- Slash command has CLI cheatsheet + tool summary

---

### Should Port Daddy Use Both Skill AND MCP?

**YES. Here's why:**

#### Why Skill is Essential
The MCP server is a **tool enablement layer**. It says:
> "Here's a callable tool. Here's its input schema."

But it does NOT say:
> "Here's when you should use locks vs claims. Here's the registration ceremony. Here's why worktrees matter. Here's the philosophy of advisory claims."

**The Skill teaches the domain.** Without it, Claude knows *what* Port Daddy can do, but not *when* or *why* to use it.

Example: MCP says "acquire_lock" exists. Skill says "use locks for database migrations and deployments, not for file editing."

#### Why MCP is Essential
The Skill is a **knowledge layer**. It says:
> "Here's how Port Daddy works. Here are patterns and workflows."

But it does NOT say:
> "Here are 44 callable operations with precise input/output schemas. Here are resources you can inspect."

**The MCP enables action.** Without it, Claude can *talk about* what to do, but can't actually *invoke* operations.

Example: Skill says "Use pd begin to start a session." MCP says "begin_session tool exists, call it with purpose=..., agent_id=..., etc."

#### The Synergy

**With both:**
1. Skill activates → Claude learns Port Daddy domain
2. MCP always available → Claude can invoke 44 operations
3. Slash command (bonus) → Quick reference when user needs it

**Without skill:**
- MCP tools are exposed
- No guidance on patterns/philosophy
- Claude uses tools reactively (calling them when asked)
- Misses opportunities for proactive coordination

**Without MCP:**
- Skill teaches patterns
- Claude can't actually invoke operations
- Requires user to run CLI commands manually
- Defeats the purpose of agent coordination

---

### Recommendation: **BOTH**

#### Distribution Strategy

| Surface | Current | Recommendation | Rationale |
|---------|---------|-----------------|-----------|
| **MCP Server** | ✅ Active | Keep + enhance | Tool invocation is core; add server description with key patterns |
| **Skill** | ✅ Bundled | Keep + refine | Philosophy + workflows; discoverable via keywords |
| **Slash Command** | ✅ Manual | Keep + simplify | Quick lookup; can be minimal if Skill covers workflows |

#### Specific Enhancements

**1. Add Server Description to MCP**

Current: `new Server({ name: 'port-daddy', version: '3.7.0' }, { ... })`

Better: Add description field (if MCP SDK supports it) or include in tool list metadata:

```typescript
const server = new Server(
  { name: 'port-daddy', version: '3.7.0' },
  {
    capabilities: {
      tools: {
        description: 'Port Daddy: The authoritative port manager for multi-agent development. '
          + 'Use for: claiming ports (no collisions), coordinating agents (sessions + file claims), '
          + 'distributed locks (critical sections), agent resurrection (salvage dead agents), '
          + 'DNS records (semantic hostnames), and integration signals (cross-agent coordination). '
          + 'Always start with begin_session() and end with end_session_full().'
      },
      resources: { ... }
    }
  }
);
```

**2. Enhance Skill with "Sugar" Focus**

Current Skill covers 5 philosophies well. Add explicit section:

```markdown
## Sugar Commands (Start Here)

**Use these 3 commands for every session:**

1. `pd begin "purpose"` — Register + start session
2. `pd note "text"` — Add breadcrumbs as you work
3. `pd done "summary"` — End session + unregister

Everything else is optional. These three are the contract.
```

**3. Keep Slash Command Minimal**

Current 247 lines is good. Consider:
- Remove verbose explanations (Skill covers them)
- Keep it as pure reference (commands, flags, examples)
- Link to Skill for "why" questions

---

## Impact on Agent Behavior

### With Both Skill + MCP

When Claude encounters "coordinate agents":

1. **Skill activation triggers** → Claude reads 424-line guide on Port Daddy patterns
2. **MCP tools available** → Claude can invoke `begin_session`, `add_note`, `end_session_full`, etc.
3. **Synergy** → Claude knows WHEN to use tools (from Skill) AND HOW to invoke them (from MCP)

Result: **Proactive, pattern-aware agent coordination**

---

## Verification: Check Your Current Setup

```bash
# 1. MCP is configured
cat ~/.claude.json | jq '.mcpServers.port-daddy'
# Expected: { "type": "stdio", "command": "pd", "args": ["mcp"] }

# 2. Skill is bundled
ls -la node_modules/port-daddy/skills/port-daddy-cli/SKILL.md
# Expected: 424 lines

# 3. Slash command is installed
cat ~/.claude/commands/port-daddy.md | wc -l
# Expected: ~247 lines

# 4. Plugin is declared
cat /Users/erichowens/coding/port-daddy/.claude-plugin/plugin.json | jq '.skills'
# Expected: ["port-daddy-cli"]
```

---

## Summary

**Port Daddy should distribute BOTH:**

| What | Where | Why |
|------|-------|-----|
| **44 MCP tools** | `mcp/server.ts` (programmatic) | Enable Claude to invoke operations |
| **424-line Skill** | `.claude-plugin/SKILL.md` (bundled) | Teach Port Daddy philosophy + workflows |
| **247-line Command** | `~/.claude/commands/port-daddy.md` (user's home) | Quick reference |

The Skill teaches **domain knowledge** (when/why). The MCP enables **tool invocation** (how). Together, they create **agent coordination** that's pattern-aware and executable.

Removing either breaks the system:
- Without Skill: Tools work, but Claude lacks guidance on patterns
- Without MCP: Claude understands patterns, but can't execute operations
