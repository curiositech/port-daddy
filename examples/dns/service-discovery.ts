/**
 * Port Daddy SDK — DNS Service Discovery
 *
 * Shows how services can discover each other by hostname
 * using Port Daddy's DNS records.
 *
 * Run: npx tsx examples/dns/service-discovery.ts
 */

const BASE = 'http://localhost:9876';

interface DnsRecord {
  identity: string;
  hostname: string;
  port: number;
}

async function main() {
  console.log('=== DNS Service Discovery ===\n');

  // Register services with DNS
  const services = [
    { identity: 'shop:api', hostname: 'shop-api.local', port: 3100 },
    { identity: 'shop:web', hostname: 'shop-web.local', port: 3200 },
    { identity: 'shop:worker', hostname: 'shop-worker.local', port: 3300 },
  ];

  for (const svc of services) {
    const res = await fetch(`${BASE}/dns/${svc.identity}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname: svc.hostname, port: svc.port }),
    });
    const data = await res.json();
    console.log(`Registered: ${svc.identity} → ${svc.hostname}:${svc.port}`);
  }

  // Discover services by listing DNS records
  console.log('\n--- Service Discovery ---');
  const listRes = await fetch(`${BASE}/dns`);
  const records: DnsRecord[] = await listRes.json();

  for (const record of records) {
    if (record.identity.startsWith('shop:')) {
      console.log(`  ${record.identity}: ${record.hostname}:${record.port}`);
    }
  }

  // Look up a specific service
  console.log('\n--- Specific Lookup ---');
  const apiRes = await fetch(`${BASE}/dns/shop:api`);
  const apiRecord: DnsRecord = await apiRes.json();
  console.log(`API endpoint: http://${apiRecord.hostname}:${apiRecord.port}`);

  // Cleanup
  console.log('\n--- Cleanup ---');
  for (const svc of services) {
    await fetch(`${BASE}/dns/${svc.identity}`, { method: 'DELETE' });
  }
  console.log('All DNS records removed.');
}

main().catch(console.error);
