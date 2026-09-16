import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isJson, isQuiet, type CLIOptions } from '../types.js';
import { pdFetch, PORT_DADDY_URL, type PdFetchResponse } from '../utils/fetch.js';
import { requireConfirmation, DESTRUCTIVE_EXIT_CODE } from '../utils/destructive-confirm.js';
import * as ui from '../utils/ui.js';

interface DurableAgentResponse {
  success?: boolean;
  error?: string;
  code?: string;
  agent?: any;
  agents?: any[];
  hits?: any[];
  revisions?: any[];
  warnings?: string[];
  receipt?: any;
}

function commaList(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === false) return undefined;
  const values = Array.isArray(value) ? value : String(value).split(',');
  return values.map((item) => String(item).trim()).filter(Boolean);
}

function integerOption(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === false) return undefined;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    ui.error(`${field} must be a positive integer`);
    process.exit(1);
  }
  return parsed;
}

async function jsonResponse(res: PdFetchResponse): Promise<DurableAgentResponse> {
  const data = await res.json() as DurableAgentResponse;
  if (!res.ok || data.success === false) {
    ui.error(data.error || `Roster request failed (${res.status})`);
    if (data.code) console.error(`  Code: ${data.code}`);
    process.exit(1);
  }
  return data;
}

function printAgent(agent: any, detail = false): void {
  const profile = agent.profile ?? {};
  const scope = profile.scope?.kind === 'repo'
    ? `${profile.scope.repoName ?? 'repo'} · ${profile.scope.repoRoot ?? profile.scope.key}`
    : 'system';
  console.log(`${profile.displayName ?? profile.slug} (${profile.slug})`);
  console.log(`  id:        ${agent.agentNodeId}`);
  console.log(`  scope:     ${scope}`);
  console.log(`  lifecycle: ${profile.lifecycle} · revision ${profile.revision}`);
  console.log(`  remit:     ${profile.remit}`);
  console.log(`  skills:    ${(profile.skills ?? []).join(', ') || '(none)'}`);
  console.log(`  backends:  ${(profile.backendPreferences ?? []).map((item: any) => item.model ? `${item.backend}/${item.model}` : item.backend).join(', ') || '(runtime choice required)'}`);
  console.log(`  memory:    ${profile.memory?.handoffEpisodeIds?.length ?? 0} handoff episode(s)`);
  console.log(`  continue:  ${agent.continuation?.available ? `pd roster continue ${agent.agentNodeId} --backend <backend>` : '(attach a sanitized handoff first)'}`);
  if (detail) {
    console.log(`  tools:     ${(profile.tools ?? []).join(', ') || '(none declared)'}`);
    console.log(`  policy:    fs=${profile.permissionPolicy?.filesystem} network=${profile.permissionPolicy?.network} (${profile.permissionPolicy?.enforcement})`);
    console.log(`  triggers:  ${(profile.triggers ?? []).map((trigger: any) => `${trigger.kind}:${trigger.label} [${trigger.status}]`).join(', ') || '(none declared)'}`);
    console.log('');
    console.log(profile.instructions ?? '');
  }
}

function baseProfile(options: CLIOptions, slug: string) {
  const remit = String(options.remit ?? options.purpose ?? '').trim();
  const instructions = String(options.instructions ?? options.prompt ?? '').trim();
  if (!remit || !instructions) {
    ui.error('Roster creation requires --remit and --instructions');
    process.exit(1);
  }
  const scopeKind = options.system ? 'system' : String(options.scope ?? 'repo');
  if (scopeKind !== 'system' && scopeKind !== 'repo') {
    ui.error('--scope must be system or repo');
    process.exit(1);
  }
  const backendValues = commaList(options.backend) ?? [];
  const models = commaList(options.model) ?? [];
  return {
    slug,
    displayName: options.name,
    scope: scopeKind === 'system'
      ? { kind: 'system' }
      : { kind: 'repo', repoRoot: String(options.repo ?? options.cwd ?? process.cwd()) },
    remit,
    instructions,
    skills: commaList(options.skills),
    tools: commaList(options.tools),
    backendPreferences: backendValues.map((backend, index) => ({ backend, model: models[index] ?? models[0] ?? null })),
    permissionPolicy: {
      filesystem: options.filesystem,
      network: options.network,
      allowedTools: commaList(options['allow-tools']),
      deniedTools: commaList(options['deny-tools']),
    },
    lifecycle: options.lifecycle,
  };
}

export const ROSTER_HELP: string = [
  'Usage: pd roster <subcommand> [options]',
  '',
  'Durable named agents (AgentNode identities, not live process registrations):',
  '  list [--repo <path>] [--all]              List durable agents',
  '  show <agent-node-id>                      Show profile, revisions, and continuation history',
  '  search <query> [--repo <path>]            Hybrid BM25 + shared MiniLM expertise search',
  '  create <slug> --remit <text> --instructions <text> [--scope system|repo]',
  '  promote <session-id> --episode <id> --slug <name> --remit <text> --instructions <text>',
  '  update <agent-node-id> [profile flags]    Append a new profile revision',
  '  attach <agent-node-id> --episode <id>     Attach a sanitized handoff episode',
  '  continue <agent-node-id> --backend <id> [--mode auto|native|handoff] [--model <id>]',
  '  retire <agent-node-id>                    Retire without deleting history',
  '',
  'Profile flags: --name, --skills a,b, --tools a,b, --backend a,b, --model x,',
  '               --filesystem inherit|repo|workspace|read-only, --network inherit|none|restricted|full',
].join('\n');

export async function handleRoster(subcommand: string | undefined, args: string[], options: CLIOptions): Promise<void> {
  const sub = subcommand ?? 'list';
  if (sub === 'help') {
    console.log(ROSTER_HELP);
    return;
  }

  if (sub === 'list' || sub === 'ls') {
    const query = new URLSearchParams();
    if (options.repo) query.set('repoRoot', String(options.repo));
    if (options.all) query.set('includeRetired', 'true');
    if (options.limit) query.set('limit', String(options.limit));
    const data = await jsonResponse(await pdFetch(`${PORT_DADDY_URL}/durable-agents?${query}`));
    if (isJson(options)) return void console.log(JSON.stringify(data, null, 2));
    if (!data.agents?.length) return void console.log('No durable agents in this scope');
    data.agents.forEach((agent, index) => {
      if (index > 0) console.log('');
      printAgent(agent);
    });
    console.log('');
    console.log(`Total: ${data.agents.length} durable agent(s)`);
    return;
  }

  if (sub === 'show') {
    const id = args[0];
    if (!id) return void (ui.error('Usage: pd roster show <agent-node-id>'), process.exit(1));
    const data = await jsonResponse(await pdFetch(`${PORT_DADDY_URL}/durable-agents/${encodeURIComponent(id)}`));
    if (isJson(options)) return void console.log(JSON.stringify(data, null, 2));
    printAgent(data.agent, true);
    console.log('');
    console.log(`Revisions: ${data.revisions?.length ?? 0} · Continuations: ${data.agent?.continuation?.receipts?.length ?? 0}`);
    return;
  }

  if (sub === 'search') {
    const queryText = args.join(' ').trim() || String(options.query ?? '').trim();
    if (!queryText) return void (ui.error('Usage: pd roster search <query>'), process.exit(1));
    const query = new URLSearchParams({ q: queryText });
    if (options.repo) query.set('repoRoot', String(options.repo));
    if (options.limit) query.set('limit', String(options.limit));
    const data = await jsonResponse(await pdFetch(`${PORT_DADDY_URL}/durable-agents/search?${query}`));
    if (isJson(options)) return void console.log(JSON.stringify(data, null, 2));
    if (data.warnings?.length) data.warnings.forEach((warning) => ui.warn(warning));
    if (!data.hits?.length) return void console.log('No matching durable agents');
    data.hits.forEach((hit: any) => {
      console.log(`${hit.rank}. ${hit.agent.profile.displayName} (${hit.agent.profile.slug})`);
      console.log(`   ${hit.agent.profile.remit}`);
      console.log(`   evidence: ${(hit.evidence.sources ?? []).join(' + ') || 'none'}`);
    });
    return;
  }

  if (sub === 'create') {
    const slug = args[0] ?? String(options.slug ?? '');
    if (!slug) return void (ui.error('Usage: pd roster create <slug> --remit <text> --instructions <text>'), process.exit(1));
    const data = await jsonResponse(await pdFetch(`${PORT_DADDY_URL}/durable-agents`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(baseProfile(options, slug)),
    }));
    if (isJson(options)) return void console.log(JSON.stringify(data, null, 2));
    ui.success(`Created durable agent ${data.agent.profile.slug}`);
    console.log(data.agent.agentNodeId);
    data.warnings?.forEach((warning) => ui.warn(warning));
    return;
  }

  if (sub === 'promote') {
    const sessionId = args[0] ?? String(options.session ?? '');
    const slug = String(options.slug ?? options.name ?? '');
    const episodeId = integerOption(options.episode, '--episode');
    if (!sessionId || !slug || !episodeId) {
      return void (ui.error('Usage: pd roster promote <session-id> --episode <id> --slug <name> --remit <text> --instructions <text>'), process.exit(1));
    }
    const payload = { ...baseProfile(options, slug), sourceSessionId: sessionId, handoffEpisodeId: episodeId };
    const data = await jsonResponse(await pdFetch(`${PORT_DADDY_URL}/durable-agents/promote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }));
    if (isJson(options)) return void console.log(JSON.stringify(data, null, 2));
    ui.success(`Promoted ${sessionId} to ${data.agent.profile.slug}`);
    console.log(data.agent.agentNodeId);
    return;
  }

  if (sub === 'update') {
    const id = args[0];
    if (!id) return void (ui.error('Usage: pd roster update <agent-node-id> [profile flags]'), process.exit(1));
    let payload: Record<string, unknown> = {};
    if (options.file) payload = JSON.parse(readFileSync(String(options.file), 'utf8')) as Record<string, unknown>;
    for (const [flag, key] of [
      ['slug', 'slug'], ['name', 'displayName'], ['remit', 'remit'], ['instructions', 'instructions'], ['lifecycle', 'lifecycle'],
    ] as const) if (options[flag] !== undefined) payload[key] = options[flag];
    if (options.skills !== undefined) payload.skills = commaList(options.skills);
    if (options.tools !== undefined) payload.tools = commaList(options.tools);
    if (options.backend !== undefined) {
      const backends = commaList(options.backend) ?? [];
      const models = commaList(options.model) ?? [];
      payload.backendPreferences = backends.map((backend, index) => ({ backend, model: models[index] ?? models[0] ?? null }));
    }
    const data = await jsonResponse(await pdFetch(`${PORT_DADDY_URL}/durable-agents/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }));
    if (isJson(options)) return void console.log(JSON.stringify(data, null, 2));
    ui.success(`Updated ${data.agent.profile.slug} to revision ${data.agent.profile.revision}`);
    return;
  }

  if (sub === 'attach') {
    const id = args[0];
    const episodeId = integerOption(options.episode, '--episode');
    if (!id || !episodeId) return void (ui.error('Usage: pd roster attach <agent-node-id> --episode <id>'), process.exit(1));
    const data = await jsonResponse(await pdFetch(`${PORT_DADDY_URL}/durable-agents/${encodeURIComponent(id)}/handoffs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ episodeId }),
    }));
    if (isJson(options)) return void console.log(JSON.stringify(data, null, 2));
    ui.success(`Attached handoff ${episodeId} to ${data.agent.profile.slug}`);
    return;
  }

  if (sub === 'continue') {
    const id = args[0];
    const targetBackend = String(options.backend ?? '').trim();
    if (!id || !targetBackend) return void (ui.error('Usage: pd roster continue <agent-node-id> --backend <backend>'), process.exit(1));
    const agentData = await jsonResponse(await pdFetch(`${PORT_DADDY_URL}/durable-agents/${encodeURIComponent(id)}`));
    const episodeId = integerOption(options.episode, '--episode') ?? agentData.agent?.continuation?.episodeId;
    if (!episodeId) return void (ui.error('This durable agent has no sanitized handoff episode to continue'), process.exit(1));
    const continuation = await jsonResponse(await pdFetch(`${PORT_DADDY_URL}/memory/handoffs/${episodeId}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetBackend,
        model: options.model,
        mode: options.mode ?? 'auto',
        prompt: options.prompt ?? agentData.agent.profile.remit,
        durableAgentId: id,
        idempotencyKey: options['idempotency-key'] ?? `roster:${id}:${episodeId}:${randomUUID()}`,
        timeoutMs: options.timeout ? Number(options.timeout) : undefined,
      }),
    }));
    if (isJson(options)) return void console.log(JSON.stringify(continuation, null, 2));
    ui.success(`Continuation ${continuation.receipt?.status ?? 'accepted'} via ${continuation.receipt?.effectiveBackend ?? targetBackend}`);
    if (!isQuiet(options)) console.log(continuation.receipt?.id ?? '');
    return;
  }

  if (sub === 'retire') {
    const id = args[0];
    if (!id) return void (ui.error('Usage: pd roster retire <agent-node-id>'), process.exit(1));
    const confirmed = await requireConfirmation({
      summary: `Retire durable agent ${id}. Its AgentNode facts, memories, and continuation receipts remain append-only and readable.`,
      args: options as Record<string, unknown>,
    });
    if (!confirmed) process.exit(DESTRUCTIVE_EXIT_CODE);
    const data = await jsonResponse(await pdFetch(`${PORT_DADDY_URL}/durable-agents/${encodeURIComponent(id)}/retire`, { method: 'POST' }));
    if (isJson(options)) return void console.log(JSON.stringify(data, null, 2));
    ui.success(`Retired ${data.agent.profile.slug}`);
    return;
  }

  ui.error(`Unknown roster subcommand: ${sub}`);
  console.error(ROSTER_HELP);
  process.exit(1);
}
