import { CommandPage } from '@/components/docs/CommandPage'

export default function HarborLeaveCommand() {
  return (
    <CommandPage
      command="harbor leave"
      description="Leave a harbor. Burns the JTI identifier so the token cannot be reused."
      version="3.7.0"
      syntax="pd harbor leave <name>"
      flags={[
        { flag: 'name', description: 'Harbor name to leave' },
      ]}
      usagePatterns={[
        'pd harbor leave myapp:security-review',
      ]}
      examples={[
        {
          description: 'Leave a harbor',
          code: 'pd harbor leave myapp:security-review',
          output: `Left harbor: myapp:security-review (token revoked)`
        },
      ]}
      seeAlso={[
        { name: 'harbor create', href: '/docs/cli/harbor-create' },
        { name: 'harbor enter', href: '/docs/cli/harbor-enter' },
        { name: 'harbors', href: '/docs/cli/harbors' },
      ]}
    />
  )
}
