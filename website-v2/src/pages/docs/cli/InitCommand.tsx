import { CommandPage } from '@/components/docs/CommandPage'

export default function InitCommand() {
  return (
    <CommandPage
      command="pd init"
      description="One-command project onboarding. Detects your stack, registers the project with the daemon, creates .portdaddy/, initializes a fleet from a template, configures the Port Daddy MCP server in every detected AI editor, and installs a post-commit git hook that fires fleet agents on every commit."
      version="3.9.0"
      syntax="pd init [flags]"
      flags={[
        { flag: '--no-fleet', description: 'Skip creating pd-fleet.yml (run pd fleet init manually later)' },
        { flag: '--no-mcp', description: 'Skip MCP server installation in AI editors' },
        { flag: '--no-hook', description: 'Skip installing the .git/hooks/post-commit hook' },
      ]}
      usagePatterns={[
        'cd my-project && pd init',
        'pd init --no-fleet',
        'pd init --no-mcp --no-hook',
      ]}
      examples={[
        {
          description: 'Full onboarding in a new project',
          code: 'cd ~/projects/my-api && pd init',
          output: `Initializing Port Daddy for /Users/you/projects/my-api

  Detected: Next.js, TypeScript
  Registered with daemon
  Created .portdaddy/context.json
  Created pd-fleet.yml
  MCP configured in 2 AI editors
  Restart your editors to activate Port Daddy tools
  Installed post-commit hook (publishes to git:committed)

  Done:
  + Stack detected: Next.js, TypeScript
  + Project registered with daemon
  + Created .portdaddy/
  + Created pd-fleet.yml
  + MCP configured in 2 AI editors
  + Installed .git/hooks/post-commit

  Next steps:
    pd fleet up         # start background agents
    pd begin "Initial setup" --lifecycle durable
    git commit          # fleet agents trigger automatically`,
        },
        {
          description: 'Skip fleet creation, add it later',
          code: 'pd init --no-fleet',
          output: `Initializing Port Daddy for /Users/you/projects/my-api

  Detected: Express, Node.js
  Registered with daemon
  Created .portdaddy/context.json
  Skipping fleet (--no-fleet)
  MCP configured in 1 AI editor
  Installed post-commit hook (publishes to git:committed)

  Next steps:
    pd fleet init       # create agent fleet
    pd fleet up         # start background agents
    pd begin "Initial setup" --lifecycle durable
    git commit          # fleet agents trigger automatically`,
        },
        {
          description: 'Minimal — daemon registration only',
          code: 'pd init --no-fleet --no-mcp --no-hook',
          output: `Initializing Port Daddy for /Users/you/projects/my-api

  Detected: Rust, Cargo
  Registered with daemon
  Created .portdaddy/context.json
  Skipping fleet (--no-fleet)
  Skipping MCP (--no-mcp)
  Skipping git hook (--no-hook)

  Done:
  + Stack detected: Rust, Cargo
  + Project registered with daemon
  + Created .portdaddy/

  Next steps:
    pd fleet init       # create agent fleet
    pd fleet up         # start background agents
    pd begin "Initial setup" --lifecycle durable
    git commit          # fleet agents trigger automatically`,
        },
      ]}
      seeAlso={[
        { name: 'pd fleet init', href: '/docs/cli/fleet' },
        { name: 'pd fleet up', href: '/docs/cli/fleet' },
        { name: 'pd mcp install', href: '/docs/cli/mcp-install' },
        { name: 'pd begin', href: '/docs/cli/begin' },
        { name: 'pd scan', href: '/docs/cli/scan' },
      ]}
    />
  )
}
