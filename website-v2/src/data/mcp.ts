import {
  MCP_AGENT_DEFAULT_TOOL_NAMES,
  MCP_AGENT_TOOL_CATEGORIES,
  MCP_AGENT_TOOL_DEFINITIONS,
} from './mcpAgentToolCatalog'

export interface McpTool {
  name: string
  description: string
  example: string
}

export interface McpCategory {
  id: string
  label: string
  color: string
  darkColor: string
  bg: string
  border: string
  tools: string[]
  description: string
}

const CATEGORY_THEMES = [
  {
    color: 'var(--p-teal-700)',
    darkColor: 'var(--p-teal-300)',
    bg: 'var(--badge-teal-bg)',
    border: 'var(--badge-teal-border)',
  },
  {
    color: 'var(--p-amber-700)',
    darkColor: 'var(--p-amber-300)',
    bg: 'var(--badge-amber-bg)',
    border: 'var(--badge-amber-border)',
  },
  {
    color: 'var(--p-green-700)',
    darkColor: 'var(--p-green-400)',
    bg: 'var(--badge-green-bg)',
    border: 'var(--badge-green-border)',
  },
  {
    color: '#7c3aed',
    darkColor: '#a78bfa',
    bg: 'rgba(139, 92, 246, 0.1)',
    border: 'rgba(139, 92, 246, 0.2)',
  },
] as const

// The generated catalog is a projection of mcp/server.ts. Keeping the public
// index tied to it prevents a source tool from becoming a silent documentation
// omission, while the small theme layer remains a website concern.
export const MCP_TOOL_TOTAL = MCP_AGENT_TOOL_DEFINITIONS.length
export const MCP_DEFAULT_TOOL_TOTAL = MCP_AGENT_DEFAULT_TOOL_NAMES.length

export const ESSENTIAL_TOOLS: McpTool[] = MCP_AGENT_DEFAULT_TOOL_NAMES.map((name) => {
  const tool = MCP_AGENT_TOOL_DEFINITIONS.find((candidate) => candidate.name === name)
  return {
    name,
    description: tool?.description ?? 'Port Daddy MCP tool.',
    example: `Call ${name} with the schema returned by pd_discover.`,
  }
})

export const ALL_CATEGORIES: McpCategory[] = MCP_AGENT_TOOL_CATEGORIES.map((category, index) => ({
  ...category,
  ...CATEGORY_THEMES[index % CATEGORY_THEMES.length],
}))

export const CONFIG_EXAMPLES = [
  {
    label: 'Gemini CLI',
    file: '.gemini/extensions/port-daddy/GEMINI.md',
    code: `brew install curiositech/tap/port-daddy
pd setup

If you are wiring Gemini by hand:
- MCP Server: "pd mcp"
- Skill: "port-daddy"`,
  },
  {
    label: 'Claude Code',
    file: '~/.claude/settings.json',
    code: `{
  "mcpServers": {
    "port-daddy": {
      "command": "pd",
      "args": ["mcp"]
    }
  }
}`,
  },
  {
    label: 'Cursor',
    file: '.cursor/mcp.json',
    code: `{
  "mcpServers": {
    "port-daddy": {
      "command": "pd",
      "args": ["mcp"]
    }
  }
}`,
  },
  {
    label: 'Aider',
    file: 'Terminal',
    code: '# Launch Aider with the Port Daddy MCP server\\naider --mcp-server "pd mcp"',
  },
  {
    label: 'Agent Skill',
    file: 'Agent Configuration',
    code: `# If your agent framework supports skills, load Port Daddy:
import { PortDaddySkill } from 'port-daddy/skills'
agent.addSkill(new PortDaddySkill())`,
  },
]
