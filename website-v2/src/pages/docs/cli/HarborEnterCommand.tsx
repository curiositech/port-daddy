import { CommandPage } from '@/components/docs/CommandPage'

export default function HarborEnterCommand() {
  return (
    <CommandPage
      command="pd harbor enter"
      description="Enter a harbor. Returns a signed JWT capability token. Pass this token to spawned agents or include it in API requests. The token encodes the capabilities granted by the harbor creator."
      version="3.11.0"
      syntax="pd harbor enter <name>"
      usagePatterns={[
        'pd harbor enter myapp:security-review',
        'pd harbor enter myapp:dev',
      ]}
      examples={[
        {
          description: 'Enter a harbor and get capability token',
          code: 'pd harbor enter myapp:security-review',
          output: `Entered harbor: myapp:security-review
Token: eyJhbGciOiJIUzI1NiJ9...
  Expires: 2026-03-16T14:00:00Z
  Capabilities: code:read, notes:write, tunnel:create`
        },
        {
          description: 'Use token with spawned agent',
          code: `TOKEN=$(pd harbor enter myapp:security-review | grep "Token:" | cut -d' ' -f2)
pd spawn --backend claude \\\n  --harbor myapp:security-review \\\n  --identity myapp:auditor \\\n  -- "Audit authentication code"`,
          output: `Entered harbor: myapp:security-review
[pd] Spawned agent myapp:auditor (session harbor-001)
[pd] Using token with capabilities: code:read, notes:write, tunnel:create`
        },
        {
          description: 'Token structure (decoded)',
          code: 'pd harbor enter myapp:dev | jq -R "." | base64 -d 2>/dev/null | jq .',
          output: `{
  "harbor": "myapp:dev",
  "capabilities": ["code:read", "notes:write", "lock:acquire"],
  "iat": 1710590400,
  "exp": 1710604800,
  "jti": "unique-token-id-123"
}`
        },
        {
          description: 'Error - harbor does not exist',
          code: 'pd harbor enter myapp:nonexistent',
          output: `[pd] Error: Harbor 'myapp:nonexistent' not found
[pd] Create it with: pd harbor create myapp:nonexistent --cap "code:read"`
        },
      ]}
      seeAlso={[
        { name: 'pd harbor create', href: '/docs/cli/harbor-create' },
        { name: 'pd harbor leave', href: '/docs/cli/harbor-leave' },
        { name: 'pd harbors', href: '/docs/cli/harbors' },
        { name: 'pd spawn', href: '/docs/cli/spawn' },
      ]}
    />
  )
}
