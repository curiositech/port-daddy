import { CommandPage } from '@/components/docs/CommandPage'

export default function McpInstallCommand() {
  return (
    <CommandPage
      command="pd mcp install"
      description="Auto-detects installed AI editors and configures Port Daddy as an MCP server for each one. Supports Claude Code, Claude Desktop, Cursor, Windsurf, Gemini CLI, VS Code (Copilot), Continue.dev, and Cline. Also installs the SKILL.md file, writes the Port Daddy Pilot agent definitions for local runtimes, and optionally wires the shell fleet-prompt hook."
      version="3.9.0"
      syntax="pd mcp install [flags]"
      flags={[
        { flag: '--list', description: 'Show detected editors and whether Port Daddy is already configured in each. Does not write anything.' },
        { flag: '--shell', description: 'Install only the shell fleet-prompt hook (skips MCP config and skill install)' },
        { flag: '--claude-code', description: 'Configure Claude Code only (scope flag; can be combined with others)' },
        { flag: '--claude-desktop', description: 'Configure Claude Desktop only' },
        { flag: '--cursor', description: 'Configure Cursor only' },
        { flag: '--windsurf', description: 'Configure Windsurf only' },
        { flag: '--vscode', description: 'Configure VS Code (Copilot). Uses "servers" key instead of "mcpServers" per VS Code spec.' },
        { flag: '--continue', description: 'Configure Continue.dev only' },
        { flag: '--cline', description: 'Configure Cline only' },
        { flag: '--no-agents', description: 'Skip installing the Port Daddy Pilot agent definitions' },
      ]}
      usagePatterns={[
        'pd mcp install',
        'pd mcp install --list',
        'pd mcp install --cursor',
        'pd mcp install --shell',
      ]}
      examples={[
        {
          description: 'Auto-detect and configure all editors',
          code: 'pd mcp install',
          output: `  Port Daddy MCP Installer

  Configuring MCP server:
    Claude Code          configured
    Cursor               configured
    Claude Desktop       not found
    Windsurf             not found
    VS Code (Copilot)    not found
    Continue.dev         not found
    Cline                not found

  Skill installed:
    /Users/you/.port-daddy/skills/SKILL.md

  Pilot agent definitions:
    ✓ installed 5 runtime definition(s) (2 updated)

  Shell hook:
    Added fleet prompt to /Users/you/.zshrc

  Configured 2 editors. Restart them to activate Port Daddy tools.`,
        },
        {
          description: 'Check what is installed and configured',
          code: 'pd mcp install --list',
          output: `  Detected AI editors:
    Claude Code          installed (configured)
    Claude Desktop       not found
    Cursor               installed (configured)
    Windsurf             not found
    VS Code (Copilot)    installed (not configured)
    Continue.dev         not found
    Cline                not found`,
        },
        {
          description: 'Configure a specific editor',
          code: 'pd mcp install --cursor',
          output: `  Port Daddy MCP Installer

  Configuring MCP server:
    Cursor               updated

  Configured 1 editor. Restart it to activate Port Daddy tools.`,
        },
      ]}
      seeAlso={[
        { name: 'pd init', href: '/docs/cli/init' },
        { name: 'MCP overview', href: '/docs/mcp' },
        { name: 'pd fleet init', href: '/docs/cli/fleet' },
      ]}
    />
  )
}
