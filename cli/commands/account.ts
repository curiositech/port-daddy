/**
 * `pd account` — GitHub device-flow login for the CLI (ADR-0101 Phase 1).
 *
 *   pd account login   Run the GitHub device flow; store a pdu_ token locally.
 *   pd account pair     Alias of login (the storefront pages call it "pair").
 *   pd account status   Show who this machine is signed in as.
 *   pd account logout   Forget the stored token.
 *   pd account token     Print the stored pdu_ token (for scripting).
 *
 * The pdu_ token is minted by the relay and stored at ~/.port-daddy/account.json
 * (0600). The relay origin defaults to the public relay and is overridable with
 * PD_ACCOUNTS_RELAY_URL.
 */

import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { PD_HOME } from '../../shared/paths.js';
import { parseRelayTombstone, renderRelayTombstone } from '../../shared/relay-tombstone.js';

const DEFAULT_RELAY = 'https://port-daddy-relay.erich-owens.workers.dev';
const ACCOUNT_FILE = join(PD_HOME, 'account.json');

interface StoredAccount {
  token: string;
  login: string;
  relayUrl: string;
  createdAt: number;
}

function relayUrl(): string {
  const u = process.env.PD_ACCOUNTS_RELAY_URL?.trim() || DEFAULT_RELAY;
  return u.replace(/\/+$/, '');
}

function readStored(): StoredAccount | null {
  try {
    return JSON.parse(readFileSync(ACCOUNT_FILE, 'utf8')) as StoredAccount;
  } catch {
    return null;
  }
}

function writeStored(a: StoredAccount): void {
  if (!existsSync(PD_HOME)) mkdirSync(PD_HOME, { recursive: true });
  writeFileSync(ACCOUNT_FILE, `${JSON.stringify(a, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(ACCOUNT_FILE, 0o600);
  } catch {
    /* best effort */
  }
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* the user can open it manually */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function deviceLogin(): Promise<number> {
  const relay = relayUrl();
  const start = await fetch(`${relay}/auth/device/start`, { method: 'POST' });
  const s = (await start.json().catch(() => ({}))) as {
    user_code?: string;
    verification_uri?: string;
    device_code?: string;
    interval?: number;
    expires_in?: number;
    error?: string;
  };
  if (!start.ok || !s.device_code || !s.user_code || !s.verification_uri) {
    // X6: a sunset surface answers a structured 410 - render it actionably.
    const tomb = parseRelayTombstone(start.status, s);
    if (tomb) {
      console.error(renderRelayTombstone(tomb));
      return 1;
    }
    console.error(`✖ Could not start device login: ${s.error ?? start.status}`);
    console.error('  If this says device flow is not enabled, turn on "Enable Device Flow" on the Port Daddy Fleet GitHub App.');
    return 1;
  }

  console.log('');
  console.log(`  Open:  ${s.verification_uri}`);
  console.log(`  Code:  ${s.user_code}`);
  console.log('');
  console.log('  Opening your browser… (authorize, then come back here)');
  openBrowser(s.verification_uri);

  const interval = Math.max(2, s.interval ?? 5);
  const deadline = Date.now() + (s.expires_in ?? 900) * 1000;
  const label = `pd CLI on ${process.env.HOSTNAME || process.env.HOST || 'this machine'}`;

  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    const poll = await fetch(`${relay}/auth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: s.device_code, label }),
    });
    const t = (await poll.json().catch(() => ({}))) as { token?: string; login?: string; pending?: boolean; error?: string };
    if (t.token) {
      writeStored({ token: t.token, login: t.login ?? '', relayUrl: relay, createdAt: Math.floor(Date.now() / 1000) });
      console.log(`✓ Signed in as ${t.login ?? 'your account'}. Token stored in ~/.port-daddy/account.json`);
      return 0;
    }
    if (!t.pending) {
      console.error(`✖ Login failed: ${t.error ?? 'unknown error'}`);
      return 1;
    }
    // still pending — keep polling
  }
  console.error('✖ Timed out waiting for authorization.');
  return 1;
}

async function status(): Promise<number> {
  const a = readStored();
  if (!a) {
    console.log('Not signed in. Run: pd account login');
    return 0;
  }
  const res = await fetch(`${a.relayUrl}/auth/whoami`, { headers: { Authorization: `Bearer ${a.token}` } });
  if (res.status === 401) {
    console.log(`Stored token for ${a.login || 'account'} is no longer valid (revoked or expired). Run: pd account login`);
    return 1;
  }
  if (res.status === 410) {
    // X6: structured tombstone - the surface is gone; say what replaces it.
    const tomb = parseRelayTombstone(res.status, await res.json().catch(() => null));
    if (tomb) {
      console.error(renderRelayTombstone(tomb));
      return 1;
    }
  }
  if (!res.ok) {
    console.error(`✖ Could not reach the relay (${res.status}).`);
    return 1;
  }
  const body = (await res.json()) as { user?: { login: string; email: string | null; emailVerified: boolean } };
  const u = body.user;
  console.log(`Signed in as ${u?.login ?? a.login}${u?.email ? ` <${u.email}>` : ''}${u?.emailVerified ? ' (verified)' : ''}`);
  console.log(`Relay: ${a.relayUrl}`);
  return 0;
}

function logout(): number {
  if (existsSync(ACCOUNT_FILE)) rmSync(ACCOUNT_FILE);
  console.log('✓ Signed out (local token forgotten). Revoke it server-side from your account page if needed.');
  return 0;
}

export async function handleAccount(args: string[]): Promise<number> {
  const sub = (args[0] ?? 'status').toLowerCase();
  switch (sub) {
    case 'login':
    case 'pair':
      return deviceLogin();
    case 'status':
    case 'whoami':
      return status();
    case 'logout':
      return logout();
    case 'token': {
      const a = readStored();
      if (!a) {
        console.error('Not signed in.');
        return 1;
      }
      console.log(a.token);
      return 0;
    }
    default:
      console.error(`Unknown: pd account ${sub}. Use: login | status | logout | token`);
      return 1;
  }
}
