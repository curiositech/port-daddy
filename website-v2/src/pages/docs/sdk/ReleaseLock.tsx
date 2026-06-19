import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function ReleaseLock() {
  return (
    <SdkFunctionPage
      function="releaseLock"
      description="Release a distributed lock. Safe to call even if lock is not held."
      module="Locks"
      version="3.13.0"
      signature="releaseLock(name: string): Promise<boolean>"
      params={[
        { name: 'name', type: 'string', required: true, description: 'Lock name to release' },
      ]}
      returns={{
        type: 'Promise<boolean>',
        description: 'True if lock was released, false if not found'
      }}
      examples={[
        {
          description: 'Release a lock after work is done',
          code: `try {
  await pd.locks.acquire('db-migration')
  await runMigrations()
} finally {
  await pd.locks.release('db-migration')
}`
        },
        {
          description: 'Release returns false if not held',
          code: `const released = await pd.locks.release('some-lock')
console.log(released) // false — we didn't hold it`
        },
      ]}
      seeAlso={[
        { name: 'acquireLock()', href: '/docs/sdk/locks' },
        { name: 'withLock()', href: '/docs/sdk/with-lock' },
      ]}
    />
  )
}
