import { CommandPage } from '@/components/docs/CommandPage'

export default function ScanCommand() {
  return (
    <CommandPage
      command="scan"
      description="Deep-scan a directory for services. Detects 60+ frameworks and assigns ports."
      version="3.8.3"
      syntax="pd scan [dir]"
      flags={[
        { flag: 'dir', description: 'Directory to scan (default: current)' },
        { flag: '-j, --json', description: 'Output JSON with full detection details' },
      ]}
      usagePatterns={[
        'pd scan',
        'pd scan ./services',
        'pd scan --json',
      ]}
      examples={[
        {
          description: 'Scan current directory',
          code: 'pd scan ./services',
          output: `Found 4 services:
  myapp:api        → 3001  (express)
  myapp:frontend   → 3000  (vite)
  myapp:jobs       → 3002  (bullmq)
  myapp:db-admin   → 3003  (adminer)`
        },
      ]}
      seeAlso={[
        { name: 'up', href: '/docs/cli/up' },
        { name: 'services', href: '/docs/cli/services' },
        { name: 'claim', href: '/docs/cli/claim' },
      ]}
    />
  )
}
