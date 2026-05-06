import { CommandPage } from '@/components/docs/CommandPage'

export default function ScanServicesTool() {
  return (
    <CommandPage
      command="scan_services"
      description="Deep-scan a directory for services. Detects 60+ frameworks and assigns ports."
      version="3.13.0"
      syntax="scan_services(dir, options?)"
      flags={[
        { flag: 'dir', description: 'Directory to scan (default: current directory)' },
        { flag: 'claim_ports', description: 'Auto-claim ports for detected services (default: true)' },
        { flag: 'json', description: 'Output full JSON with detection details' },
      ]}
      usagePatterns={[
        'scan_services()',
        'scan_services({ dir: "./services" })',
        'scan_services({ dir: ".", claim_ports: false })',
      ]}
      examples={[
        {
          description: 'Scan current directory',
          code: 'scan_services()',
          output: `{\n  "found": 4,\n  "services": [\n    { "identity": "myapp:api", "port": 3001, "framework": "express" },\n    { "identity": "myapp:frontend", "port": 3000, "framework": "vite" }\n  ]\n}`
        },
        {
          description: 'Scan without claiming ports',
          code: 'scan_services({ claim_ports: false })',
        },
      ]}
      seeAlso={[
        { name: 'claim_port', href: '/docs/mcp/claim-port' },
        { name: 'up', href: '/docs/mcp/up' },
        { name: 'SDK: scanServices()', href: '/docs/sdk/scan-services' },
      ]}
    />
  )
}
