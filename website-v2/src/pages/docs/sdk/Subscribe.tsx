import { SdkFunctionPage } from '@/components/docs/SdkFunctionPage'

export default function Subscribe() {
  return (
    <SdkFunctionPage
      function="subscribe"
      description="Subscribe to a Swarm Radio channel. Returns an async iterator that yields messages as they arrive."
      module="Messaging"
      version="3.8.3"
      signature="subscribe(channel: string, options?: SubscribeOptions): AsyncIterable<Message>"
      params={[
        { name: 'channel', type: 'string', required: true, description: 'Channel name to subscribe to' },
        { name: 'options.filter', type: '(msg: Message) => boolean', description: 'Optional message filter function' },
        { name: 'options.once', type: 'boolean', description: 'Unsubscribe after first message (default: false)' },
      ]}
      returns={{
        type: 'AsyncIterable<Message>',
        description: 'Async iterator of messages'
      }}
      examples={[
        {
          description: 'Subscribe to a channel and process messages',
          code: `for await (const msg of pd.messaging.subscribe('build:done')) {
  console.log('Build completed:', msg.data.sha)
  await deploy(msg.data.sha)
}`
        },
        {
          description: 'Subscribe with filter',
          code: `const builds = pd.messaging.subscribe('build:done', {
  filter: msg => msg.data.branch === 'main'
})

for await (const msg of builds) {
  console.log('Main build:', msg.data.sha)
}`
        },
        {
          description: 'Wait for single message',
          code: `const msg = await pd.messaging.subscribe('approval', { once: true }).next()
console.log('Approved by:', msg.value.sender)`
        },
      ]}
      seeAlso={[
        { name: 'publish()', href: '/docs/sdk/publish' },
        { name: 'watch()', href: '/docs/sdk/watch' },
      ]}
    />
  )
}
