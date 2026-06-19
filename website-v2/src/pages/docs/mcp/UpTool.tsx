import { CommandPage } from '@/components/docs/CommandPage'

export default function UpTool() {
  return (
    <CommandPage
      command="up"
      description="Start all registered services in the current project. Uses the detected start commands."
      version="3.13.0"
      syntax="up(options?)"
      flags={[
        { flag: 'project', description: 'Project name (default: auto-detect)' },
        { flag: 'services', description: 'Specific services to start (default: all)' },
        { flag: 'detached', description: 'Run in background (default: false)' },
      ]}
      usagePatterns={[
        'up()',
        'up({ services: ["myapp:api", "myapp:worker"] })',
      ]}
      examples={[
        {
          description: 'Start all services',
          code: 'up()',
          output: `{\n  "started": [\n    { "identity": "myapp:api", "port": 3001, "pid": 12345 },\n    { "identity": "myapp:frontend", "port": 3000, "pid": 12346 }\n  ]\n}`
        },
      ]}
      seeAlso={[
        { name: 'down', href: '/docs/mcp/down' },
        { name: 'scan_services', href: '/docs/mcp/scan-services' },
        { name: 'SDK: up()', href: '/docs/sdk/up' },
      ]}
    />
  )
}
