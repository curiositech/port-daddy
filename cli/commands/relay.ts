/**
 * pd relay — relay configuration and status commands (ADR-0049)
 *
 * Switch-CLI handler. The main CLI (bin/port-daddy-cli.ts) is switch-based, so
 * relay dispatches `pd relay <sub>` through `handleRelay` below.
 *
 *   pd relay url <url>       Set the relay URL (persisted to daemon config)
 *   pd relay url --clear     Remove the relay URL (disables relay)
 *   pd relay status          Show relay connection status from daemon
 *   pd relay exchange        Exchange OIDC token for a PD card via the relay
 *
 * NOTE: replaces an earlier never-wired CAC stub that imported non-existent
 * cli/lib/daemon-resolver + daemon-client modules (the relay CLI never ran).
 * Daemon access now goes through the canonical cli/utils/fetch pdFetch helper.
 */

import { pdFetch } from '../utils/fetch.js';

async function relayGet<T>(path: string): Promise<T> {
  const res = await pdFetch(path);
  return (await res.json()) as T;
}

async function relayPost<T>(path: string, body: unknown): Promise<T> {
  const res = await pdFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export async function handleRelay(
  positional: string[],
  options: Record<string, unknown>,
): Promise<void> {
  const sub = positional[0];

  if (sub === 'url') {
    if (options.clear) {
      await relayPost('/relay/config', { relay_url: null });
      console.log('✓ Relay disabled (relay_url cleared)');
      return;
    }
    const url = positional[1];
    if (!url) {
      const current = await relayGet<{ relay_url: string | null }>('/relay/config');
      console.log(
        current.relay_url
          ? `relay_url: ${current.relay_url}`
          : 'relay_url: (not set — relay federation disabled)',
      );
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
    await relayPost('/relay/config', { relay_url: url });
    console.log(`✓ Relay URL set: ${url}`);
    console.log('  Run: pd relay status   — to verify connection');
    return;
  }

  if (sub === 'status') {
    const status = await relayGet<{
      relay_url: string | null;
      connected: boolean;
      session_id: string | null;
      last_handshake: number | null;
      accepted_channels: string[];
      relay_version: string | null;
    }>('/relay/status');
    if (!status.relay_url) {
      console.log('Relay: disabled (no relay_url configured)');
      console.log('  Set with: pd relay url <https://relay.portdaddy.dev>');
      return;
    }
    console.log(`Relay: ${status.relay_url}`);
    console.log(`Status: ${status.connected ? '✓ connected' : '✗ disconnected'}`);
    if (status.session_id) console.log(`Session: ${status.session_id}`);
    if (status.last_handshake) {
      console.log(`Last handshake: ${Math.floor(Date.now() / 1000 - status.last_handshake)}s ago`);
    }
    if (status.accepted_channels.length > 0) {
      console.log(`Subscribed channels (${status.accepted_channels.length}):`);
      for (const ch of status.accepted_channels) console.log(`  - ${ch}`);
    }
    if (status.relay_version) console.log(`Relay version: ${status.relay_version}`);
    return;
  }

  if (sub === 'exchange') {
    const token =
      (options['oidc-token'] as string | undefined) ??
      (options['oidcToken'] as string | undefined) ??
      process.env['ACTIONS_ID_TOKEN'];
    if (!token) {
      console.error('Error: --oidc-token or $ACTIONS_ID_TOKEN required');
      process.exit(1);
      return;
    }
    let cap: unknown[];
    try {
      cap = options.cap ? JSON.parse(options.cap as string) : [{ op: 'pub', channel: '*' }];
    } catch {
      console.error('Error: --cap must be valid JSON array');
      process.exit(1);
      return;
    }
    const result = await relayPost<{ card: string; exp: number }>('/relay/exchange', {
      oidc_token: token,
      cap,
    });
    if (options.out) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(options.out as string, result.card, 'utf8');
      console.log(`✓ Card written to ${options.out} (exp: ${new Date(result.exp * 1000).toISOString()})`);
    } else {
      console.log(result.card);
    }
    return;
  }

  console.log('Usage: pd relay <url [value] | status | exchange>');
  console.log('  pd relay url <https://relay.portdaddy.dev>   set the relay URL');
  console.log('  pd relay url --clear                          disable relay');
  console.log('  pd relay status                               connection status');
  console.log('  pd relay exchange --oidc-token <t>            OIDC → PD card (CI)');
  process.exit(1);
