#!/usr/bin/env -S npx tsx
/**
 * Create (or update) the Port Daddy Pilot as a Claude *managed* (cloud) agent
 * and persist its agent ID + version into a committed manifest.
 *
 *   https://platform.claude.com/docs/en/managed-agents/agent-setup
 *
 * The managed agent is the cloud-hosted, versioned twin of the local Pilot
 * persona. Local runtimes (Claude Code, Codex, Gemini) talk to the Port Daddy
 * MCP server directly on localhost; the cloud agent can't reach localhost MCP,
 * so it is given the pre-built agent toolset PLUS the `custom` tool specs from
 * agent.config.json (pd_preflight / pd_note / pd_status), which a self-hosted
 * worker fulfills by shelling out to `pd`. Same persona, two transports.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-… npx tsx scripts/create-managed-agent.ts
 *   npx tsx scripts/create-managed-agent.ts --dry-run   # print payload, no POST
 *
 * Without ANTHROPIC_API_KEY this records a `pending` entry in the manifest and
 * prints the exact command to run later. It never fabricates an agent ID.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPilotSource } from '../lib/pilot-agent-render.js';
import { resolveModel, type Capability } from '../lib/model-registry.js';

const API_URL = 'https://api.anthropic.com/v1/agents';
const BETA_HEADER = 'managed-agents-2026-04-01';

function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'Formula', 'port-daddy.rb'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
}

interface ManifestEntry {
  status: 'created' | 'pending';
  id: string | null;
  version: number | null;
  name: string;
  model: string;
  source_sha: string;
  created_at?: string;
  updated_at?: string;
  note?: string;
}
interface Manifest {
  $comment: string;
  agents: Record<string, ManifestEntry>;
}

/**
 * Build the create/update payload from the canonical config + system prompt.
 *
 * `resolvedSubAgents` maps a roster member name → its created cloud agent ID.
 * We only attach the `multiagent` coordinator block when EVERY roster member
 * resolves to a real created agent — the API rejects a coordinator that
 * references agents that don't exist. Until the sub-agents (implementer,
 * port-daddy-redteam) are created as their own managed agents, the cloud Pilot
 * ships as a solo agent and the fan-out happens locally via Port Daddy's
 * spawn primitive. See docs/agents/port-daddy-pilot-multiagent.md.
 */
/**
 * Resolve the managed-agent's cloud model. `config.model.claude_cloud`
 * declares INTENT — a `capability` (cheap/balanced/high/max-thinking/code)
 * resolved through the same registry every other Port Daddy caller uses
 * (lib/model-registry.ts resolveModel), or an explicit `id` pin honored
 * verbatim (a real operator override, same precedence resolveModel itself
 * gives an explicit id). Absent both (agent.config.json omits `model`
 * entirely), default to the 'high' capability — the managed Pilot agent is
 * a capable-reasoning persona, not a cheap/fast one. ADR-0057
 * model-abstraction unification: this used to hardcode 'claude-opus-4-8' as
 * the literal fallback, a second unsynced copy of the registry's own answer.
 */
function resolveCloudModel(claudeCloud: unknown): { id: string; speed?: string } {
  const c = (claudeCloud ?? {}) as { id?: string; capability?: string; speed?: string };
  const id = c.id?.trim() || resolveModel({ backend: 'claude', capability: (c.capability as Capability) || 'high' });
  return c.speed ? { id, speed: c.speed } : { id };
}

export function buildCreatePayload(
  config: any,
  system: string,
  resolvedSubAgents: Record<string, string> = {},
) {
  const cloudModel = resolveCloudModel(config.model?.claude_cloud);
  const customTools = (config.tools?.custom ?? []).map((t: any) => ({
    type: 'custom',
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
  const payload: Record<string, unknown> = {
    name: config.name,
    model: cloudModel,
    system,
    description: config.description,
    tools: [{ type: config.tools?.cloudToolset ?? 'agent_toolset_20260401' }, ...customTools],
    metadata: {
      source: 'port-daddy/agents/port-daddy-pilot',
      pilot_version: config.version ?? '0',
    },
  };

  // The cloud `skills` array references either Anthropic pre-built skills
  // (type:"anthropic", skill_id e.g. "xlsx") or CUSTOM skills already uploaded
  // to the workspace (type:"custom", skill_id:"skill_…"). The Pilot's skills
  // (port-daddy-agent-skill, multi-agent-coordination, next-move) are local
  // filesystem skills, not workspace-uploaded, so we cannot reference them by a
  // skill_* id yet. We omit them here — the full coordination discipline is
  // already embedded verbatim in the system prompt. To attach them later:
  // upload each as a custom skill, then add {type:"custom", skill_id:"skill_…"}.
  // config.cloudSkills (if present) may list pre-resolved {type, skill_id} entries.
  if (Array.isArray(config.cloudSkills) && config.cloudSkills.length) {
    payload.skills = config.cloudSkills;
  }

  const roster: string[] = (config.multiagent?.agents ?? [])
    .map((a: any) => a.delegate_to ?? a.role)
    .filter((name: string) => name && name !== config.id); // a coordinator can't delegate to itself
  const uniqueRoster = [...new Set(roster)];
  const allResolved = uniqueRoster.length > 0 && uniqueRoster.every((n) => resolvedSubAgents[n]);
  if (allResolved) {
    payload.multiagent = { agents: uniqueRoster.map((n) => ({ id: resolvedSubAgents[n] })) };
  }
  return payload;
}

function manifestPath(repoRoot: string): string {
  return join(repoRoot, 'config', 'managed-agents.json');
}

function loadManifest(path: string): Manifest {
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
    } catch {
      /* fall through to fresh */
    }
  }
  return {
    $comment:
      'Committed registry of Port Daddy Pilot Claude managed (cloud) agents. ' +
      'Written by scripts/create-managed-agent.ts. Do not hand-edit ids/versions.',
    agents: {},
  };
}

function writeManifest(path: string, manifest: Manifest): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => v === undefined ? null : sortJsonValue(v));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) out[key] = sortJsonValue(child);
    }
    return out;
  }
  return value;
}

export function sourceShaForPayload(payload: unknown): string {
  return sha256(stableJsonStringify(payload));
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const repoRoot = findRepoRoot();
  const sourceDir = join(repoRoot, 'agents', 'port-daddy-pilot');
  const { config, system } = loadPilotSource(sourceDir);
  const payload = buildCreatePayload(config, system);
  // Hash the whole payload (not just the system prompt) so a change to any
  // field — model, tools, description — is detected, and an unchanged re-run is
  // a true no-op instead of churning a new agent version every time.
  const sourceSha = sourceShaForPayload(payload);
  const mPath = manifestPath(repoRoot);
  const manifest = loadManifest(mPath);
  const existing = manifest.agents[config.id];

  if (dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    console.log(`\n# source_sha=${sourceSha}  manifest=${mPath}`);
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    manifest.agents[config.id] = {
      status: 'pending',
      id: existing?.id ?? null,
      version: existing?.version ?? null,
      name: config.name,
      model: typeof payload.model === 'string' ? payload.model : (payload.model as any).id,
      source_sha: sourceSha,
      note: 'ANTHROPIC_API_KEY not set at creation time. Re-run scripts/create-managed-agent.ts with the key to create/update the cloud agent.',
    };
    writeManifest(mPath, manifest);
    console.error('ANTHROPIC_API_KEY is not set — recorded a PENDING entry instead of creating a cloud agent.');
    console.error('Recorded:', mPath);
    console.error('\nTo create it later, run:');
    console.error('  ANTHROPIC_API_KEY=sk-ant-… npx tsx scripts/create-managed-agent.ts');
    console.error('\nThe local agent definitions (Claude/Codex/Gemini) are already installed and do not need the cloud agent.');
    process.exit(0); // expected offline path, not a failure
  }

  const isUpdate = existing?.status === 'created' && existing.id;

  // Idempotent skip: if we already have a created agent and the payload hasn't
  // changed since we last wrote it, don't POST — the server would otherwise mint
  // a new version even for an effectively-identical config.
  if (isUpdate && existing!.source_sha === sourceSha) {
    console.log(`Managed agent ${existing!.id} is already up to date (version ${existing!.version}); nothing to do.`);
    return;
  }

  const url = isUpdate ? `${API_URL}/${existing!.id}` : API_URL;
  const body: Record<string, unknown> = isUpdate
    ? { version: existing!.version, system, model: payload.model, name: payload.name, description: payload.description, tools: payload.tools }
    : payload;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': BETA_HEADER,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Agent ${isUpdate ? 'update' : 'create'} failed: ${res.status} ${res.statusText}`);
    console.error(text.slice(0, 2000));
    process.exit(1);
  }

  const agent = (await res.json()) as { id: string; version: number; created_at?: string; updated_at?: string };
  manifest.agents[config.id] = {
    status: 'created',
    id: agent.id,
    version: agent.version,
    name: config.name,
    model: typeof payload.model === 'string' ? payload.model : (payload.model as any).id,
    source_sha: sourceSha,
    created_at: existing?.created_at ?? agent.created_at,
    updated_at: agent.updated_at,
  };
  writeManifest(mPath, manifest);
  console.log(`${isUpdate ? 'Updated' : 'Created'} managed agent ${agent.id} (version ${agent.version}).`);
  console.log(`Manifest: ${mPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
