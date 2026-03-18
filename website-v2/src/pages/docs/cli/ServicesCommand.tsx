import { CommandPage } from '@/components/docs/CommandPage'

export default function ServicesCommand() {
  return (
    <CommandPage
      command="services"
      description="List all active port claims. Shows identity, port, and last-seen timestamp."
      version="3.7.0"
      syntax="pd services"
      flags={[
        { flag: '-j, --json', description: 'JSON output' },
      ]}
      usagePatterns={[
        'pd services',
        'pd services --json',
      ]}
      examples={[
        {
          description: 'List all services',
          code: 'pd services',
          output: `myapp:api:main       3001   5s ago
myapp:frontend:main  3000   2s ago`
        },
        {
          description: 'JSON output',
          code: 'pd services --json',
          output: `[\n  {\n    "identity": "myapp:api:main",\n    "port": 3001,\n    "lastSeen": "5s ago"\n  }\n]`
        },
      ]}
      seeAlso={[
        { name: 'claim', href: '/docs/cli/claim' },
        { name: 'status', href: '/docs/cli/status' },
        { name: 'scan', href: '/docs/cli/scan' },
      ]}
    />
  )
}
