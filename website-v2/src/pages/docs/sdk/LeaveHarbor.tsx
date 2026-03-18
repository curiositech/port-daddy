import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function LeaveHarbor() {
  return (
    <SdkFunctionPage
      function="leaveHarbor"
      description="Leave a harbor. Burns the JTI identifier so the token cannot be reused."
      module="Harbors"
      version="3.7.0"
      signature="leaveHarbor(name: string): Promise<boolean>"
      params={[
        { name: 'name', type: 'string', required: true, description: 'Harbor name to leave' },
      ]}
      returns={{
        type: 'Promise<boolean>',
        description: 'True if successfully left harbor'
      }}
      examples={[
        {
          description: 'Leave a harbor when done',
          code: `await pd.harbors.leave('myapp:security-review')
// Token is now revoked`
        },
        {
          description: 'Leave returns false if not in harbor',
          code: `const left = await pd.harbors.leave('some-harbor')
console.log(left) // false — we weren't in it`
        },
      ]}
      seeAlso={[
        { name: 'createHarbor()', href: '/docs/sdk/harbors' },
        { name: 'enterHarbor()', href: '/docs/sdk/harbors' },
        { name: 'listHarbors()', href: '/docs/sdk/list-harbors' },
      ]}
    />
  )
}
