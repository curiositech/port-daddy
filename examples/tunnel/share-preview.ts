#!/usr/bin/env npx tsx
/**
 * Managed preview tunnel example.
 *
 * "PD Tube" is the product shorthand. The current shipped CLI/API surface is
 * `pd tunnel` plus SDK methods named `tunnelStart`, `tunnelStatus`, and so on.
 *
 * Run:
 *   npx tsx examples/tunnel/share-preview.ts inspect
 *   npx tsx examples/tunnel/share-preview.ts claim --identity demo:web --port 5173
 *   npx tsx examples/tunnel/share-preview.ts start --identity demo:web --port 5173 --provider cloudflared
 *   npx tsx examples/tunnel/share-preview.ts stop --identity demo:web
 */

import { PortDaddy } from '../../lib/client.js';

type Provider = 'ngrok' | 'cloudflared' | 'localtunnel';

type Options = {
  command: string;
  identity: string;
  port?: number;
  provider?: Provider;
  harbor: string;
};

function parseArgs(argv: string[]): Options {
  const [command = 'inspect', ...rest] = argv;
  const options: Options = {
    command,
    identity: 'examples:web-preview',
    harbor: 'examples',
  };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const next = rest[i + 1];
    if (arg === '--identity' && next) {
      options.identity = next;
      i++;
    } else if (arg === '--port' && next) {
      options.port = Number(next);
      i++;
    } else if (arg === '--provider' && next) {
      options.provider = next as Provider;
      i++;
    } else if (arg === '--harbor' && next) {
      options.harbor = next;
      i++;
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
  }

  return options;
}

function usage(): void {
  console.log(`
Managed preview tunnel example

Usage:
  npx tsx examples/tunnel/share-preview.ts inspect
  npx tsx examples/tunnel/share-preview.ts claim --identity demo:web --port 5173
  npx tsx examples/tunnel/share-preview.ts start --identity demo:web --port 5173 [--provider cloudflared]
  npx tsx examples/tunnel/share-preview.ts status --identity demo:web
  npx tsx examples/tunnel/share-preview.ts list
  npx tsx examples/tunnel/share-preview.ts stop --identity demo:web

Commands:
  inspect  Check installed tunnel providers and show current active tunnels
  claim    Claim a service identity without exposing it
  start    Claim, start a managed tunnel, and publish the preview URL
  status   Show one service's tunnel status
  list     List all active tunnels
  stop     Stop one tunnel and release the service identity
`);
}

function pickProvider(providers: Record<string, boolean>, preferred?: Provider): Provider {
  if (preferred) {
    if (!providers[preferred]) {
      throw new Error(`${preferred} is not installed. Run: pd tunnel providers`);
    }
    return preferred;
  }

  for (const provider of ['cloudflared', 'ngrok', 'localtunnel'] as Provider[]) {
    if (providers[provider]) return provider;
  }

  throw new Error('No tunnel providers are installed. Run: pd tunnel providers for install hints.');
}

async function claimPreview(pd: PortDaddy, options: Options): Promise<void> {
  if (!options.port || Number.isNaN(options.port)) {
    throw new Error('claim/start requires --port <number>');
  }

  const result = await pd.claim(options.identity, {
    port: options.port,
    cwd: process.cwd(),
    cmd: `dev server already running on ${options.port}`,
    metadata: {
      example: 'managed-preview-tunnel',
      publicPreview: true,
    },
  });

  console.log(`Claimed ${result.id} on port ${result.port}`);
}

async function inspect(pd: PortDaddy): Promise<void> {
  const providers = await pd.tunnelProviders();
  const tunnels = await pd.tunnelList();

  console.log('Tunnel providers');
  for (const [name, installed] of Object.entries(providers.providers)) {
    console.log(`  ${name.padEnd(12)} ${installed ? 'installed' : 'missing'}`);
  }

  console.log('');
  console.log('Active tunnels');
  if (!tunnels.tunnels.length) {
    console.log('  none');
    return;
  }

  for (const tunnel of tunnels.tunnels) {
    console.log(`  ${tunnel.serviceId} -> ${tunnel.url ?? '(starting)'} [${tunnel.provider}]`);
  }
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const agentId = `examples:tunnel:${process.pid}`;
  const pd = new PortDaddy({ agentId, timeout: 15000 });

  try {
    switch (options.command) {
      case 'inspect':
        await inspect(pd);
        break;

      case 'claim':
        await claimPreview(pd, options);
        console.log(`Next: pd tunnel start ${options.identity} --provider cloudflared`);
        break;

      case 'start': {
        await claimPreview(pd, options);
        const providers = await pd.tunnelProviders();
        const provider = pickProvider(providers.providers, options.provider);
        const tunnel = await pd.tunnelStart(options.identity, provider);
        await pd.setEndpoint(options.identity, 'public', tunnel.url);
        await pd.tupleOut(['preview-url', options.identity, tunnel.url, provider], {
          harbor: options.harbor,
          writtenBy: agentId,
          ttlMs: 60 * 60 * 1000,
        });
        await pd.publish('examples:preview:tunnel', {
          agent: agentId,
          type: 'preview-url',
          service: options.identity,
          provider,
          url: tunnel.url,
          ts: Date.now(),
        }, { sender: agentId });
        console.log(`Preview URL: ${tunnel.url}`);
        if (tunnel.expiresAt) console.log(`Expires: ${new Date(tunnel.expiresAt).toISOString()}`);
        break;
      }

      case 'status': {
        const status = await pd.tunnelStatus(options.identity);
        console.log(`${status.serviceId}: ${status.status}`);
        console.log(`  provider: ${status.provider}`);
        console.log(`  port: ${status.port}`);
        console.log(`  url: ${status.url ?? '(none)'}`);
        if (status.expiresAt) console.log(`  expires: ${new Date(status.expiresAt).toISOString()}`);
        break;
      }

      case 'list':
        await inspect(pd);
        break;

      case 'stop':
        await pd.tunnelStop(options.identity);
        await pd.release(options.identity).catch(() => undefined);
        console.log(`Stopped tunnel and released ${options.identity}`);
        break;

      default:
        usage();
        process.exit(1);
    }
  } finally {
    pd.destroyIpc();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
