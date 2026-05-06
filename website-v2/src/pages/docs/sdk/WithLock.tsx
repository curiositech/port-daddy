import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function WithLock() {
  return (
    <SdkFunctionPage
      function="withLock"
      description="Run a function inside a lock. Acquires lock, runs function, releases lock — even if the function throws."
      module="Locks"
      version="3.13.0"
      signature="withLock<T>(name: string, fn: () => Promise<T>, options?: LockOptions): Promise<T>"
      params={[
        { name: 'name', type: 'string', required: true, description: 'Lock name' },
        { name: 'fn', type: '() => Promise<T>', required: true, description: 'Function to run inside lock' },
        { name: 'options.ttl', type: 'number', description: 'Lock timeout in ms (default: 300000)' },
        { name: 'options.wait', type: 'boolean', description: 'Block until lock available (default: false)' },
      ]}
      returns={{
        type: 'Promise<T>',
        description: 'Return value of the wrapped function'
      }}
      examples={[
        {
          description: 'Run database migration with automatic locking',
          code: `const result = await pd.locks.withLock('db-migration', async () => {
  await runMigrations()
  return 'Migrations complete'
})
console.log(result) // 'Migrations complete'`
        },
        {
          description: 'Lock is always released, even on error',
          code: `await pd.locks.withLock('critical-section', async () => {
  // Do critical work
  if (somethingFails) {
    throw new Error('Failed!')
  }
  // Lock is still released after throw
})`
        },
      ]}
      seeAlso={[
        { name: 'acquireLock()', href: '/docs/sdk/locks' },
        { name: 'releaseLock()', href: '/docs/sdk/release-lock' },
      ]}
    />
  )
}
