import { CommandPage } from '@/components/docs/CommandPage'

export default function LeaveHarborTool() {
  return (
    <CommandPage
      command="leave_harbor"
      description="Leave a harbor. Burns the JTI identifier so the token cannot be reused."
      version="3.7.0"
      syntax="leave_harbor(name)"
      flags={[
        { flag: 'name', description: 'Harbor name to leave' },
      ]}
      usagePatterns={[
        'leave_harbor({ name: "myapp:security-review" })',
      ]}
      examples={[
        {
          description: 'Leave a harbor',
          code: 'leave_harbor({ name: "myapp:security-review" })',
          output: `{\n  "harbor": "myapp:security-review",\n  "left": true,\n  "token_revoked": true\n}`
        },
      ]}
      seeAlso={[
        { name: 'create_harbor', href: '/docs/mcp/create-harbor' },
        { name: 'list_harbors', href: '/docs/mcp/list-harbors' },
        { name: 'SDK: leaveHarbor()', href: '/docs/sdk/leave-harbor' },
      ]}
    />
  )
}
