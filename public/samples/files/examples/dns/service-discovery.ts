#!/usr/bin/env npx tsx
/**
 * Port Daddy SDK DNS service discovery.
 *
 * Shows how services can register local names and discover each other through
 * the current SDK instead of hardcoded daemon URLs.
 *
 * Run:
 *   npx tsx examples/dns/service-discovery.ts
 */

import { PortDaddy } from '../../lib/client.js';

const pd = new PortDaddy({ agentId: `examples:dns:${process.pid}`, timeout: 10000 });

const services = [
  { identity: 'examples-shop:api', hostname: 'examples-shop-api.local', port: 3100 },
  { identity: 'examples-shop:web', hostname: 'examples-shop-web.local', port: 3200 },
  { identity: 'examples-shop:worker', hostname: 'examples-shop-worker.local', port: 3300 },
];

async function main(): Promise<void> {
  console.log('DNS service discovery');
  console.log('---------------------');

  try {
    for (const service of services) {
      await pd.dnsRegister(service.identity, {
        hostname: service.hostname,
        port: service.port,
      });
      console.log(`registered ${service.identity} -> ${service.hostname}:${service.port}`);
    }

    const records = await pd.dnsList({ pattern: 'examples-shop:*' });
    console.log('');
    console.log('discovered records');
    for (const record of records.records) {
      console.log(`  ${record.identity} -> ${record.hostname}:${record.port}`);
    }

    const api = await pd.dnsGet('examples-shop:api');
    console.log('');
    console.log(`api endpoint: http://${api.record.hostname}:${api.record.port}`);
  } finally {
    for (const service of services) {
      await pd.dnsUnregister(service.identity).catch(() => undefined);
    }
    pd.destroyIpc();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
