/**
 * pd relay — relay configuration and status commands (ADR-0049)
 *
 * Subcommands:
 *   pd relay url <url>       Set the relay URL (persisted to daemon config)
 *   pd relay url --clear     Remove the relay URL (disables relay)
 *   pd relay status          Show relay connection status from daemon
 *   pd relay exchange        Exchange OIDC token for a PD card via the relay
 */

import type { CAC } from 'cac';
import { resolveDaemonTarget } from '../lib/daemon-resolver.js';
import { callDaemon } from '../lib/daemon-client.js';

export function registerRelayCommands(cli: CAC): void {
  const relay = cli.command('relay', 'Relay configuration and status (ADR-0049)');

  // ── pd relay url <url> ──────────────────────────────────────────────────
  relay
    .command('url [url]', 'Get or set the relay URL')
    .option('--clear', 'Remove relay URL (disables relay federation)')
    .action(async (url: string | undefined, opts: { clear?: boolean }) => {
      const daemon = await resolveDaemonTarget();

      if (opts.clear) {
        await callDaemon(daemon, 'POST', '/relay/config', { relay_url: null });
        console.log('✓ Relay disabled (relay_url cleared)');
        return;
      }

      if (!url) {
        // Get current
        const current = await callDaemon<{ relay_url: string | null }>(
          daemon, 'GET', '/relay/config'
        );
        if (!current.relay_url) {
          console.log('relay_url: (not set — relay federation disabled)');
        } else {
          console.log(`relay_url: ${current.relay_url}`);
        }
        return;
      }

      // Validate URL format
      try {
        const parsed = new URL(url);
        if (!['https:', 'http:'].includes(parsed.protocol)) {
          throw new Error('URL must use https: or http: protocol');
        }
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }

      await callDaemon(daemon, 'POST', '/relay/config', { relay_url: url });
      console.log(`✓ Relay URL set: ${url}`);
      console.log('  Run: pd relay status   — to verify connection');
    });

  // ── pd relay status ──────────────────────────────────────────────────────
  relay
    .command('status', 'Show relay connection status')
    .action(async () => {
      const daemon = await resolveDaemonTarget();
      const status = await callDaemon<{
        relay_url: string | null;
        connected: boolean;
        session_id: string | null;
        last_handshake: number | null;
        accepted_channels: string[];
        relay_version: string | null;
      }>(daemon, 'GET', '/relay/status');

      if (!status.relay_url) {
        console.log('Relay: disabled (no relay_url configured)');
        console.log('  Set with: pd relay url <https://relay.portdaddy.dev>');
        return;
      }

      const connStr = status.connected ? '✓ connected' : '✗ disconnected';
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
    });

  // ── pd relay exchange ────────────────────────────────────────────────────
  relay
    .command('exchange', 'Exchange OIDC token for a PD card (for CI runners)')
    .option('--oidc-token <token>', 'OIDC token from GitHub Actions (or $ACTIONS_ID_TOKEN_REQUEST_URL)')
    .option('--cap <cap>', 'JSON capability array, e.g. \'[{"op":"pub","channel":"ci:*"}]\'')
    .option('--out <path>', 'Write card JWT to file instead of stdout')
    .action(async (opts: { oidcToken?: string; cap?: string; out?: string }) => {
      const daemon = await resolveDaemonTarget();
      const token = opts.oidcToken ?? process.env['ACTIONS_ID_TOKEN'];

      if (!token) {
        console.error('Error: --oidc-token or $ACTIONS_ID_TOKEN required');
        process.exit(1);
      }

      let cap: unknown[];
      try {
        cap = opts.cap ? JSON.parse(opts.cap) : [{ op: 'pub', channel: '*' }];
      } catch {
        console.error('Error: --cap must be valid JSON array');
        process.exit(1);
      }

      const result = await callDaemon<{ card: string; exp: number }>(
        daemon, 'POST', '/relay/exchange', { oidc_token: token, cap }
      );

      if (opts.out) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(opts.out, result.card, 'utf8');
        console.log(`✓ Card written to ${opts.out} (exp: ${new Date(result.exp * 1000).toISOString()})`);
      } else {
        console.log(result.card);
      }
    });
}
