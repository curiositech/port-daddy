/**
 * Harbor CLI Commands
 *
 * pd harbor create <name> [--scope <project>] [--cap <caps>] [--channels <chans>] [--expires <duration>]
 * pd harbor enter <name> [--agent <id>] [--cap <caps>]
 * pd harbor leave <name> [--agent <id>]
 * pd harbor show <name>
 * pd harbor destroy <name>
 * pd harbors [--json]
 */

import { join } from 'path';
import { resolveDaemonUrl } from '../../shared/daemon-discovery.js';
import { readCurrentContextFromPaths } from '../utils/current-context.js';
import { requireConfirmation, DESTRUCTIVE_EXIT_CODE } from '../utils/destructive-confirm.js';

const BASE_URL = resolveDaemonUrl(process.env.PORT_DADDY_URL);

type ParsedOptions = Record<string, string | string[] | boolean | undefined>;

// ─── Local Context ────────────────────────────────────────────────────────────

function loadCurrentAgentId(): string | null {
  const context = readCurrentContextFromPaths([
    process.cwd(),
    process.env.HOME ?? '',
  ]);
  return typeof context?.agentId === 'string' ? context.agentId : null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function parseDuration(s: string): number | undefined {
  const m = s.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  const units: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return n * (units[m[2]] ?? 1);
}

function formatExpiry(expiresAt: number | null): string {
  if (!expiresAt) return 'never';
  const diff = expiresAt - Date.now();
  if (diff <= 0) return 'expired';
  if (diff < 60000) return Math.floor(diff / 1000) + 's';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
  return Math.floor(diff / 3600000) + 'h';
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export async function handleHarborCreate(args: string[], options: ParsedOptions): Promise<void> {
  const name = args[0];
  if (!name) { console.error('Usage: pd harbor create <name> [--cap code:read,notes:write] [--channels ch1,ch2] [--expires 2h]'); process.exit(1); }

  const caps = options['cap'] ? String(options['cap']).split(',').map(s => s.trim()) : [];
  const channels = options['channels'] ? String(options['channels']).split(',').map(s => s.trim()) : [];
  const expiresIn = options['expires'] ? parseDuration(String(options['expires'])) : undefined;
  const scope = typeof options['scope'] === 'string' && options['scope'].trim() ? options['scope'].trim() : undefined;

  const result = await api('POST', '/harbors', { name, scope, capabilities: caps, channels, expiresIn }) as Record<string, unknown>;
  if (!(result as Record<string, unknown>)['success']) {
    console.error('Error:', (result as Record<string, unknown>)['error']);
    process.exit(1);
  }

  if (options['json'] || options['j']) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const h = (result as Record<string, unknown>)['harbor'] as Record<string, unknown>;
  console.log(`\n  Harbor created: ${h['name']}`);
  if (scope) console.log(`  Scope:          ${scope}`);
  if (caps.length) console.log(`  Capabilities:   ${caps.join(', ')}`);
  if (channels.length) console.log(`  Channels:       ${channels.join(', ')}`);
  if (expiresIn) console.log(`  Expires in:     ${options['expires']}`);
  console.log(`\n  Next: pd harbor enter ${name}`);
  console.log();
}

export async function handleHarborEnter(args: string[], options: ParsedOptions): Promise<void> {
  const name = args[0];
  if (!name) { console.error('Usage: pd harbor enter <name> [--agent <id>] [--cap code:read]'); process.exit(1); }

  const agentId = options['agent'] ? String(options['agent']) : loadCurrentAgentId();
  if (!agentId) { console.error('No agent ID. Use --agent <id> or run pd begin first.'); process.exit(1); }

  const caps = options['cap'] ? String(options['cap']).split(',').map(s => s.trim()) : [];

  const result = await api('POST', `/harbors/${encodeURIComponent(name)}/enter`, {
    agentId,
    capabilities: caps.length ? caps : undefined,
  }) as Record<string, unknown>;

  if (!result['success']) {
    console.error('Error:', result['error']);
    process.exit(1);
  }

  if (options['json'] || options['j']) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const h = result['harbor'] as Record<string, unknown>;
  const members = (h['members'] as Array<Record<string, unknown>>).length;
  console.log(`\n  Entered harbor: ${name}`);
  console.log(`  Agent:          ${agentId}`);
  if (caps.length) console.log(`  Capabilities:   ${caps.join(', ')}`);
  console.log(`  Members:        ${members}`);
  console.log();
}

export async function handleHarborLeave(args: string[], options: ParsedOptions): Promise<void> {
  const name = args[0];
  if (!name) { console.error('Usage: pd harbor leave <name> [--agent <id>]'); process.exit(1); }

  const agentId = options['agent'] ? String(options['agent']) : loadCurrentAgentId();
  if (!agentId) { console.error('No agent ID. Use --agent <id> or run pd begin first.'); process.exit(1); }

  const result = await api('POST', `/harbors/${encodeURIComponent(name)}/leave`, { agentId }) as Record<string, unknown>;

  if (!result['success']) {
    console.error('Error:', result['error']);
    process.exit(1);
  }

  if (options['quiet'] || options['q']) return;
  console.log(`Left harbor: ${name}`);
}

export async function handleHarborShow(args: string[], options: ParsedOptions): Promise<void> {
  const name = args[0];
  if (!name) { console.error('Usage: pd harbor show <name>'); process.exit(1); }

  const result = await api('GET', `/harbors/${encodeURIComponent(name)}`) as Record<string, unknown>;
  if (!result['success']) {
    console.error('Error:', result['error']);
    process.exit(1);
  }

  if (options['json'] || options['j']) {
    console.log(JSON.stringify(result['harbor'], null, 2));
    return;
  }

  const h = result['harbor'] as Record<string, unknown>;
  const caps = h['capabilities'] as string[];
  const channels = h['channels'] as string[];
  const members = h['members'] as Array<Record<string, unknown>>;

  console.log(`\n  Harbor: ${h['name']}`);
  console.log(`  Capabilities: ${caps.length ? caps.join(', ') : '(none)'}`);
  console.log(`  Channels:     ${channels.length ? channels.join(', ') : '(none)'}`);
  console.log(`  Expires:      ${formatExpiry(h['expiresAt'] as number | null)}`);
  console.log(`\n  Members (${members.length}):`);
  if (!members.length) {
    console.log('    (empty)');
  } else {
    for (const m of members) {
      const mcaps = m['capabilities'] as string[];
      const capStr = mcaps.length ? `  [${mcaps.join(', ')}]` : '';
      const identity = m['identity'] ? `  ${m['identity']}` : '';
      console.log(`    ${m['agentId']}${identity}${capStr}`);
    }
  }
  console.log();
}

export async function handleHarborDestroy(args: string[], options: ParsedOptions): Promise<void> {
  const name = args[0];
  if (!name) { console.error('Usage: pd harbor destroy <name>'); process.exit(1); }

  const ok = await requireConfirmation({
    summary: `Harbor destroy will tear down "${name}" and evict every agent currently entered. Capability grants and channel scopes attached to this harbor are removed.`,
    args: options as Record<string, unknown>,
  });
  if (!ok) process.exit(DESTRUCTIVE_EXIT_CODE);

  const result = await api('DELETE', `/harbors/${encodeURIComponent(name)}`) as Record<string, unknown>;
  if (!result['success']) {
    console.error('Error:', result['error']);
    process.exit(1);
  }

  if (options['quiet'] || options['q']) return;
  console.log(`Harbor destroyed: ${name}`);
}

export async function handleHarbors(args: string[], options: ParsedOptions): Promise<void> {
  const result = await api('GET', '/harbors') as Record<string, unknown>;
  if (!result['success']) {
    console.error('Error:', result['error']);
    process.exit(1);
  }

  const list = result['harbors'] as Array<Record<string, unknown>>;

  if (options['json'] || options['j']) {
    console.log(JSON.stringify(list, null, 2));
    return;
  }

  if (!list.length) {
    console.log('\n  No active harbors. Run: pd harbor create myapp:security-review\n');
    return;
  }

  console.log(`\n  Harbors (${list.length}):\n`);
  for (const h of list) {
    const members = h['members'] as Array<Record<string, unknown>>;
    const caps = h['capabilities'] as string[];
    const channels = h['channels'] as string[];
    console.log(`  ${h['name']}  (${members.length} member${members.length === 1 ? '' : 's'}, expires: ${formatExpiry(h['expiresAt'] as number | null)})`);
    if (caps.length) console.log(`    capabilities: ${caps.join(', ')}`);
    if (channels.length) console.log(`    channels:     ${channels.join(', ')}`);
    if (members.length) {
      console.log(`    members:      ${members.map(m => String(m['agentId'])).join(', ')}`);
    }
  }
  console.log();
}
