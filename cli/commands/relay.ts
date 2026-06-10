/**
 * pd relay — relay configuration and status commands (ADR-0049)
 *
 * Subcommands:
 *   pd relay url <url>       Set the relay URL (persisted to daemon config)
 *   pd relay url --clear     Remove the relay URL (disables relay)
 *   pd relay status          Show relay connection status from daemon
 *   pd relay exchange        Exchange OIDC token for a PD card via the relay
 */

import { pdFetch } from '../utils/fetch.js';

/** Parsed CLI options forwarded from bin/port-daddy-cli.ts */
export interface RelayOptions {
  clear?: boolean;
  oidcToken?: string;
  cap?: string;
  out?: string;
  [key: string]: unknown;
}

/**
 * Main handler — dispatches to the appropriate relay subcommand.
 * Called by bin/port-daddy-cli.ts as: handleRelay(subcommand, positional, options)
 */
export async function handleRelay(
  subcmd: string | undefined,
  positional: string[],
  options: RelayOptions,
): Promise<void> {
  switch (subcmd) {
    case 'url': {
      const url = positional[0];
      if (options.clear) {
        await pdFetch('/relay/config', { method: 'POST', body: JSON.stringify({ relay_url: null }) });
        console.log('\u2713 Relay disabled (relay_url cleared)');
        return;
      }
      if (!url) {
        const res = await pdFetch('/relay/config');
        const current = (await res.json()) as { relay_url: string | null };
        if (!current.relay_url) {
          console.log('relay_url: (not set \u2014 relay federation disabled)');
        } else {
          console.log(`relay_url: ${current.relay_url}`);
        }
        return;
      }
      try {
        const parsed = new URL(url);
        if (!['https:', 'http:'].includes(parsed.protocol)) {
          throw new Error('URL must use https: or http: protocol');
        }
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
      await pdFetch('/relay/config', { method: 'POST', body: JSON.stringify({ relay_url: url }) });
      console.log(`\u2713 Relay URL set: ${url}`);
      console.log('  Run: pd relay status   \u2014 to verify connection');
      return;
    }

    case 'status': {
      const res = await pdFetch('/relay/status');
      const status = (await res.json()) as {
        relay_url: string | null;
        connected: boolean;
        session_id: string | null;
        last_handshake: number | null;
        accepted_channels: string[];
        relay_version: string | null;
      };

      if (!status.relay_url) {
        console.log('Relay: disabled (no relay_url configured)');
        console.log('  Set with: pd relay url <https://relay.portdaddy.dev>');
        return;
      }

      const connStr = status.connected ? '\u2713 connected' : '\u2717 disconnected';
      console.log(`Relay: ${status.relay_url}`);
      console.log(`Status: ${connStr}`);
      if (status.session_id) console.log(`Session: ${status.session_id}`);
      if (status.last_handshake) {
        const ago = Math.floor((Date.now() / 1000) - status.last_handshake);
        console.log(`Last handshake: ${ago}s ago`);
      }
      if (status.accepted_channels.length > 0) {
        console.log(`Subscribed channels (${status.accepted_channels.length}):`);
        for (const ch of status.accepted_channels) console.log(`  - ${ch}`);
      }
      if (status.relay_version) console.log(`Relay version: ${status.relay_version}`);
      return;
    }

    case 'exchange': {
      const token = options.oidcToken ?? process.env['ACTIONS_ID_TOKEN'];
      if (!token) {
        console.error('Error: --oidc-token or $ACTIONS_ID_TOKEN required');
        process.exit(1);
      }
      let cap: unknown[];
      try {
        cap = options.cap ? JSON.parse(options.cap) : [{ op: 'pub', channel: '*' }];
      } catch {
        console.error('Error: --cap must be valid JSON array');
        process.exit(1);
      }
      const res = await pdFetch('/relay/exchange', {
        method: 'POST',
        body: JSON.stringify({ oidc_token: token, cap }),
      });
      const result = (await res.json()) as { card: string; exp: number };
      if (options.out) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(options.out, result.card, 'utf8');
        console.log(`\u2713 Card written to ${options.out} (exp: ${new Date(result.exp * 1000).toISOString()})`);
      } else {
        console.log(result.card);
      }
      return;
    }

    default:
      console.error(`Unknown relay subcommand: ${subcmd ?? '(none)'}`);
      console.error('Usage: pd relay url|status|exchange');
      process.exit(1);
  }
}
