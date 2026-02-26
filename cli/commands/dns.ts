/**
 * CLI DNS Commands
 *
 * Handles: dns list, dns register, dns unregister, dns cleanup
 */

import { status as maritimeStatus } from '../../lib/maritime.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import { separator, tableHeader } from '../utils/output.js';
import type { PdFetchResponse } from '../utils/fetch.js';

/**
 * Handle `pd dns <subcommand>` command
 */
export async function handleDns(subcommand: string | undefined, args: string[], options: CLIOptions): Promise<void> {
  // List DNS registrations (default)
  if (!subcommand || subcommand === 'list' || subcommand === 'ls') {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/dns`);
    const data = await res.json();
    
    if (!res.ok) {
      console.error(maritimeStatus('error', (data.error as string) || 'Failed to list DNS registrations'));
      process.exit(1);
    }
    
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    
    const registrations = data.registrations as Array<{
      identity: string;
      hostname: string;
      port: number;
      registeredAt: number;
    }>;
    
    if (!registrations || registrations.length === 0) {
      console.log('No DNS registrations');
      return;
    }
    
    console.log('');
    console.log(tableHeader(['HOSTNAME', 30], ['PORT', 8], ['IDENTITY', 30]));
    separator(68);
    for (const r of registrations) {
      console.log(
        r.hostname.padEnd(30) +
        String(r.port).padEnd(8) +
        r.identity.padEnd(30)
      );
    }
    console.log('');
    return;
  }

  // Register DNS for an identity
  if (subcommand === 'register' || subcommand === 'add') {
    const identity = args[0];
    const port = parseInt(args[1], 10);
    
    if (!identity || !port) {
      console.error('Usage: pd dns register <identity> <port>');
      console.error('Example: pd dns register myapp:api 3000');
      process.exit(1);
    }
    
    const encodedId = encodeURIComponent(identity);
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/dns/${encodedId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port })
    });
    
    const data = await res.json();
    
    if (!res.ok || !data.success) {
      console.error(maritimeStatus('error', (data.error as string) || 'Failed to register DNS'));
      process.exit(1);
    }
    
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else if (!isQuiet(options)) {
      console.log(maritimeStatus('success', `Registered ${data.hostname} → localhost:${port}`));
      console.log(`  Access at: http://${data.hostname}`);
    }
    return;
  }

  // Unregister DNS
  if (subcommand === 'unregister' || subcommand === 'rm' || subcommand === 'remove') {
    const identity = args[0];
    
    if (!identity) {
      console.error('Usage: pd dns unregister <identity>');
      process.exit(1);
    }
    
    const encodedId = encodeURIComponent(identity);
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/dns/${encodedId}`, {
      method: 'DELETE'
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      console.error(maritimeStatus('error', (data.error as string) || 'Failed to unregister DNS'));
      process.exit(1);
    }
    
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else if (!isQuiet(options)) {
      console.log(maritimeStatus('success', `Unregistered DNS for ${identity}`));
    }
    return;
  }

  // Cleanup all DNS registrations
  if (subcommand === 'cleanup' || subcommand === 'clear') {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/dns/cleanup`, {
      method: 'POST'
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      console.error(maritimeStatus('error', (data.error as string) || 'Failed to cleanup DNS'));
      process.exit(1);
    }
    
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else if (!isQuiet(options)) {
      console.log(maritimeStatus('success', 'All DNS registrations cleaned up'));
    }
    return;
  }

  console.error(`Unknown dns subcommand: ${subcommand}`);
  console.error('Subcommands: list, register <identity> <port>, unregister <identity>, cleanup');
  process.exit(1);
}
