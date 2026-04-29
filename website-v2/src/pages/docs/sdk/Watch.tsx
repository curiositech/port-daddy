import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function Watch() {
  return (
    <SdkFunctionPage
      function="watch"
      description="Subscribe to a channel and run a callback on every message. Uses SSE for real-time delivery. Auto-reconnects on disconnect. This is the always-on agent primitive."
      module="Messaging"
      version="3.11.0"
      signature="watch(channel: string, callback: (msg: Message) => void | Promise<void>, options?: WatchOptions): Promise<Watcher>"
      params={[
        { name: 'channel', type: 'string', required: true, description: 'Channel to watch' },
        { name: 'callback', type: '(msg: Message) => void | Promise<void>', required: true, description: 'Function to run on each message' },
        { name: 'options.once', type: 'boolean', description: 'Stop after first message (default: false)' },
        { name: 'options.reconnect', type: 'boolean', description: 'Auto-reconnect on disconnect (default: true)' },
      ]}
      returns={{
        type: 'Promise<Watcher>',
        description: 'Watcher handle with stop() method'
      }}
      examples={[
        {
          description: 'Watch for build completions and deploy',
          code: `const watcher = await pd.messaging.watch(
  'build:done',
  async (msg) => {
    console.log('Deploying:', msg.data.sha)
    await deploy(msg.data.sha)
  }
)`
        },
        {
          description: 'Watch once for a specific event',
          code: `await pd.messaging.watch(
  'approval',
  async (msg) => {
    console.log('Approved by:', msg.sender)
    await proceedWithDeployment()
  },
  { once: true }
)`
        },
        {
          description: 'Stop watching when done',
          code: `const watcher = await pd.messaging.watch('events', handleEvent)
// Later...
await watcher.stop()`
        },
      ]}
      seeAlso={[
        { name: 'subscribe()', href: '/docs/sdk/subscribe' },
        { name: 'publish()', href: '/docs/sdk/publish' },
      ]}
    />
  )
}
