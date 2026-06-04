// native fetch available in Node 18+

const BASE_URL = 'http://localhost:9876';

async function req(method: string, path: string, body?: any) {
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, options);
  return res.json();
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function chaos() {
  console.log('Generating chaos...');

  // 1. Claim a bunch of ports (Services)
  const services = [
    'analytics:dashboard:main',
    'analytics:pipeline:main',
    'armada:auth:oauth2',
    'armada:gateway:ingress',
    'crows-nest:scanner:vuln-check',
    'demo:express-api:main',
    'demo:flask-api:main',
    'demo:static-site:main',
    'expungement-guide:dev:pdf-gen',
    'paymentco:api:main',
    'paymentco:worker:stripe',
    'paymentco:dashboard:admin',
    'legacy:java:monolith'
  ];

  console.log('Claiming ports...');
  for (const s of services) {
    await req('POST', '/claim', { id: s });
    await sleep(50);
  }

  // 2. Register Agents
  const agents = [
    { id: 'agent-db-1', name: 'DB Migrator', type: 'system', purpose: 'Running schema updates' },
    { id: 'agent-api-2', name: 'API Builder', type: 'claude', purpose: 'Implementing Stripe webhooks' },
    { id: 'agent-test-3', name: 'QA Bot', type: 'aider', purpose: 'Writing E2E tests' },
    { id: 'agent-sec-4', name: 'Security Scanner', type: 'script', purpose: 'Checking for vulnerabilities' },
    { id: 'agent-docs-5', name: 'Doc Gen', type: 'gemini', purpose: 'Updating OpenAPI spec' }
  ];

  console.log('Registering agents...');
  for (const a of agents) {
    await req('POST', '/agents', a);
    await req('POST', `/agents/${a.id}/heartbeat`);
    await sleep(50);
  }

  // 3. Create Harbors
  console.log('Creating harbors...');
  await req('POST', '/harbors', { name: 'core-infra', capabilities: ['code:read', 'locks:acquire', 'ports:claim'] });
  await req('POST', '/harbors', { name: 'payment-pci', capabilities: ['locks:acquire', 'tunnels:start'] });
  await req('POST', '/harbors', { name: 'experimental', capabilities: ['code:write', 'spawn:agents'] });

  // 4. Start Sessions & Add Notes
  console.log('Starting sessions...');
  for (let i = 0; i < 5; i++) {
    const s = await req('POST', '/sessions', {
      agentId: agents[i].id,
      identity: services[i],
      purpose: agents[i].purpose,
      phase: ['planning', 'in_progress', 'testing', 'reviewing'][i % 4]
    });
    
    await req('POST', `/sessions/${s.sessionId}/notes`, {
      content: `Initialized workspace for ${services[i]}`,
      type: 'info'
    });
    await sleep(50);
    await req('POST', `/sessions/${s.sessionId}/notes`, {
      content: `Completed phase step: ${agents[i].purpose}`,
      type: 'progress'
    });
  }

  // 5. Acquire Locks
  console.log('Acquiring locks...');
  await req('POST', '/locks/db-migration', { owner: 'agent-db-1', ttl: 300000 });
  await req('POST', '/locks/stripe-sandbox', { owner: 'agent-api-2', ttl: 120000 });
  await req('POST', '/locks/e2e-cluster', { owner: 'agent-test-3', ttl: 60000 });

  // 6. Pub/Sub Messaging
  console.log('Publishing messages...');
  await req('POST', '/msg/build:events', { payload: { status: 'success', service: 'analytics:dashboard' } });
  await req('POST', '/msg/security:alerts', { payload: { level: 'warning', issue: 'outdated dependency' } });
  await req('POST', '/msg/deploy:queue', { payload: { action: 'deploy', target: 'armada:gateway' } });
  
  // 7. Inbox Messaging
  console.log('Sending inbox messages...');
  await req('POST', '/agents/agent-api-2/inbox', { content: 'DB migration finished, safe to start.', from: 'agent-db-1', type: 'handoff' });

  console.log('Chaos generation complete. Check the dashboard!');
}

chaos().catch(console.error);
