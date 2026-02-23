# Port Daddy JavaScript SDK Reference

The SDK is a zero-dependency Node.js client for the Port Daddy daemon. It wraps every HTTP endpoint with typed methods, handles connection management, and provides convenience features like `withLock()` and `startHeartbeat()`.

```bash
npm install port-daddy
```

```javascript
import { PortDaddy } from 'port-daddy/client';

const pd = new PortDaddy();
```

---

## Configuration

```javascript
const pd = new PortDaddy({
  url: 'http://localhost:9876',   // Daemon URL (or set PORT_DADDY_URL env)
  agentId: 'my-agent',           // Agent ID for tracking (or PORT_DADDY_AGENT env)
  pid: process.pid,              // Process ID for ownership
  timeout: 5000,                 // Request timeout in ms
});
```

---

## Services

```javascript
// Claim a port
const { port } = await pd.claim('myapp:api');
console.log(`API running on port ${port}`);

// Request a specific port
const { port } = await pd.claim('myapp:frontend', { port: 3000 });

// Find services by pattern
const { services } = await pd.listServices({ pattern: 'myapp:*' });

// Set endpoint URLs for service discovery
await pd.setEndpoint('myapp:api', 'local', `http://localhost:${port}`);
await pd.setEndpoint('myapp:api', 'prod', 'https://api.myapp.com');

// Release a service
await pd.release('myapp:api');

// Release everything for a project
await pd.release('myapp:*');
```

---

## Sessions & Notes

```javascript
// Start a session
const session = await pd.startSession({
  purpose: 'Implementing OAuth flow',
  files: ['src/auth/*', 'src/middleware/auth.ts'],
  agentId: 'agent-1',
});

// Add a note
await pd.note('Started OAuth integration with Google', { type: 'note' });

// Add a note to a specific session
await pd.note('Switched to PKCE flow', { sessionId: session.id });

// Get notes for a session
const { notes } = await pd.notes(session.id);

// Get recent notes across all sessions
const { notes } = await pd.notes({ limit: 20, type: 'commit' });

// List active sessions
const { sessions } = await pd.sessions({ status: 'active' });

// Get session details
const detail = await pd.sessionDetails(session.id);

// Claim files (advisory, with conflict detection)
const result = await pd.claimFiles(session.id, ['src/auth/oauth.ts']);

// Release files
await pd.releaseFiles(session.id, ['src/auth/oauth.ts']);

// End session
await pd.endSession('OAuth flow complete');

// Or abandon it
await pd.abandonSession('Approach was wrong, starting over');

// Delete a session entirely
await pd.removeSession(session.id);
```

---

## Pub/Sub Messaging

```javascript
// Publish
await pd.publish('builds', { status: 'complete', artifact: 'dist.tar.gz' });

// Read messages
const { messages } = await pd.getMessages('builds', { limit: 10 });

// Subscribe to real-time updates (SSE)
const sub = pd.subscribe('deployments');
sub.on('message', (data) => console.log('Deploy event:', data));

// Long-poll for next message
const { message } = await pd.poll('builds');

// Clear a channel
await pd.clearChannel('builds');
```

---

## Distributed Locks

```javascript
// Manual lock/unlock
await pd.lock('db-migrations');
try {
  await runMigrations();
} finally {
  await pd.unlock('db-migrations');
}

// Convenience wrapper (auto-unlocks on success or failure)
await pd.withLock('deploy-prod', async () => {
  await deployToProduction();
});

// Check if a lock exists without acquiring
const lockInfo = await pd.checkLock('db-migrations');

// Extend a lock's TTL
await pd.extendLock('db-migrations', { ttl: 120 });
```

---

## Agent Lifecycle

```javascript
const pd = new PortDaddy({ agentId: 'build-agent-1' });

// Register and start heartbeats
await pd.register({ name: 'Build Agent', type: 'ci' });
const hb = pd.startHeartbeat(30000); // Every 30s

// ... do work ...

// Cleanup
hb.stop();
await pd.unregister();
```

---

## Projects

```javascript
// Deep-scan a directory for frameworks
const result = await pd.scan('/path/to/project', { save: true });
console.log(result.frameworks); // ['react', 'express', ...]

// List all registered projects
const { projects } = await pd.listProjects();

// Get project details
const project = await pd.getProject('myproject');

// Remove a project
await pd.deleteProject('myproject');
```

---

## Webhooks

```javascript
// Register a webhook
const { id } = await pd.addWebhook('https://example.com/hook', {
  events: ['claim', 'release'],
  secret: 'my-secret',
});

// List webhooks
const { webhooks } = await pd.listWebhooks();

// Get, update, test, remove
const hook = await pd.getWebhook(id);
await pd.updateWebhook(id, { events: ['claim'], active: false });
await pd.testWebhook(id);
await pd.removeWebhook(id);

// List available events and delivery history
const { events } = await pd.getWebhookEvents();
const deliveries = await pd.getWebhookDeliveries(id);
```

---

## System & Monitoring

```javascript
// Health, version, metrics
const health = await pd.health();
const ver = await pd.version();
const stats = await pd.metrics();

// Resolved configuration (optionally for a specific directory)
const config = await pd.getConfig('/path/to/project');

// Quick connectivity check
const alive = await pd.ping(); // true | false

// Service health
const allHealth = await pd.listServiceHealth();
const svcHealth = await pd.checkServiceHealth('myapp:api');
```

---

## Activity & Ports

```javascript
// Activity log
const { activity } = await pd.getActivity({ limit: 50, type: 'claim' });

// Time-range query
const range = await pd.getActivityRange(
  '2025-01-01T00:00:00Z',
  '2025-01-31T23:59:59Z'
);

// Summary and stats
const summary = await pd.getActivitySummary('1h');
const activityStats = await pd.getActivityStats();

// Port management
const activePorts = await pd.listActivePorts();
const systemPorts = await pd.getSystemPorts();
const cleaned = await pd.cleanup(); // remove expired
```

---

## Error Handling

```javascript
import { PortDaddy, PortDaddyError, ConnectionError } from 'port-daddy/client';

try {
  await pd.claim('myapp:api');
} catch (err) {
  if (err instanceof ConnectionError) {
    console.error('Daemon not running. Start with: port-daddy start');
  } else if (err instanceof PortDaddyError) {
    console.error(`API error (${err.status}): ${err.message}`);
  }
}
```

---

## Webhook Events Reference

| Event | Payload |
|-------|---------|
| `service.claim` | Service was claimed |
| `service.release` | Service was released |
| `agent.register` | Agent registered |
| `agent.unregister` | Agent unregistered |
| `agent.stale` | Agent went stale |
| `lock.acquire` | Lock was acquired |
| `lock.release` | Lock was released |
| `message.publish` | Message was published |
| `daemon.start` | Daemon started |
| `daemon.stop` | Daemon stopping |

### Payload Verification

Each delivery includes an HMAC-SHA256 signature:

```
X-PortDaddy-Signature: sha256=abc123...
X-PortDaddy-Event: service.claim
X-PortDaddy-Delivery: uuid
X-PortDaddy-Timestamp: 1704000000000
```

Verify in your handler:

```javascript
const crypto = require('crypto');

function verifySignature(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  const expected = `sha256=${hmac.digest('hex')}`;
  return signature === expected;
}
```
