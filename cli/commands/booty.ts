/**
 * CLI Booty Commands — artifact harvest into the blob store with provenance.
 *
 * Slice S4a. Operator ruling: artifacts (design workups, images, HTMLs,
 * videos, shaders) are durable truth on ANY plane/branch — never
 * quarantined, always attributed.
 *
 *   pd booty add <path...> [--roadmap <slug>] [--note "<text>"]
 *   pd booty list [--branch <b>] [--session <id>] [--limit N]
 *
 * `add` content-addresses each file into the daemon's blob store
 * (POST /blob) and then records provenance (POST /booty): branch + worktree
 * from git, session + agent identity from the active pd session context.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isJson, isQuiet } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import { readCurrentContext, type CurrentContext } from '../utils/current-context.js';
import { getWorktreeInfo, type WorktreeInfo } from '../../lib/worktree.js';
import { mediaTypeForPath } from '../../lib/booty.js';
import * as ui from '../utils/ui.js';

export interface BootyProvenance {
  branch: string | null;
  worktree: string | null;
  session_id: string | null;
  agent_identity: string | null;
}

interface BootyRow {
  id: string;
  blob_hash: string;
  media_type: string;
  original_path: string;
  byte_size: number;
  branch: string;
  worktree: string | null;
  session_id: string | null;
  agent_identity: string | null;
  roadmap_link: string | null;
  note: string | null;
  created_at: number;
}

/**
 * Pure mapping from session context + worktree info to provenance fields.
 * Exported for tests.
 */
export function buildBootyProvenance(
  context: Pick<CurrentContext, 'agentId' | 'sessionId' | 'identity'> | null,
  worktree: Pick<WorktreeInfo, 'branch' | 'name'> | null,
): BootyProvenance {
  return {
    branch: worktree?.branch ?? null,
    worktree: worktree?.name ?? null,
    session_id: context?.sessionId || null,
    agent_identity: context?.identity || context?.agentId || null,
  };
}

/**
 * Resolve provenance from the live environment: active pd session context
 * (PD_SESSION_ID/PD_AGENT_ID env or .portdaddy context file) + git worktree.
 */
export function resolveBootyProvenance(cwd: string = process.cwd()): BootyProvenance {
  return buildBootyProvenance(readCurrentContext(cwd), getWorktreeInfo(cwd));
}

function printHelp(): void {
  console.error('Usage: pd booty <subcommand> [options]');
  console.error('');
  console.error('Artifact harvest into the blob store with provenance.');
  console.error('');
  console.error('Subcommands:');
  console.error('  add <path...>       Content-address files into the blob store + record provenance');
  console.error('  list                List harvested artifacts');
  console.error('');
  console.error('Options (add):');
  console.error('  --roadmap <slug>    Link the artifact to a roadmap item');
  console.error('  --note "<text>"     Freeform provenance note');
  console.error('');
  console.error('Options (list):');
  console.error('  --branch <b>        Filter by branch');
  console.error('  --session <id>      Filter by session');
  console.error('  --limit <n>         Max rows (default 50)');
}

async function handleAdd(paths: string[], options: CLIOptions): Promise<void> {
  if (paths.length === 0) {
    console.error('Usage: pd booty add <path...> [--roadmap <slug>] [--note "<text>"]');
    process.exit(1);
  }

  const provenance = resolveBootyProvenance();
  const roadmapLink = typeof options.roadmap === 'string' ? options.roadmap : null;
  const note = typeof options.note === 'string' ? options.note : null;
  const results: Array<{ path: string; booty: BootyRow; deduped: boolean }> = [];

  // Earlier paths in a batch are durably persisted even if a later path
  // fails, so a mid-batch failure must still surface everything that
  // succeeded before exiting non-zero.
  function emitResults(error?: { path: string; message: string }): void {
    if (isJson(options)) {
      const payload: Record<string, unknown> = { success: !error, results };
      if (error) {
        payload.error = error.message;
        payload.failed_path = error.path;
      }
      console.log(JSON.stringify(payload, null, 2));
    } else {
      for (const { path, booty, deduped } of results) {
        const marker = deduped ? ' (already harvested on this branch)' : '';
        ui.success(`${booty.id}  ${booty.blob_hash.slice(0, 12)}  ${path}${marker}`);
      }
      if (error) {
        ui.error(error.message);
        if (results.length > 0) {
          ui.error(`${results.length} artifact(s) were already harvested before the failure (listed above).`);
        }
      } else if (!isQuiet(options)) {
        console.log(`${results.length} artifact(s) harvested on ${provenance.branch ?? '(no branch)'}`);
      }
    }
    if (error) process.exit(1);
  }

  for (const rawPath of paths) {
    const absPath = resolve(rawPath);
    let buf: Buffer;
    try {
      buf = readFileSync(absPath);
    } catch (err) {
      emitResults({ path: absPath, message: `Cannot read ${absPath}: ${(err as Error).message}` });
      return;
    }

    const mediaType = mediaTypeForPath(absPath);

    // 1. Content-address the bytes into the blob store.
    const blobRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/blob`, {
      method: 'POST',
      headers: { 'Content-Type': mediaType },
      body: buf,
    });
    const blobData = await blobRes.json();
    if (!blobRes.ok) {
      emitResults({
        path: absPath,
        message: (blobData.error as string) || `Failed to store blob for ${absPath}`,
      });
      return;
    }
    const blob = blobData.blob as { id: string; size: number };

    // 2. Record provenance.
    const bootyRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/booty`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blob_hash: blob.id,
        media_type: mediaType,
        original_path: absPath,
        byte_size: buf.length,
        branch: provenance.branch ?? '',
        worktree: provenance.worktree,
        session_id: provenance.session_id,
        agent_identity: provenance.agent_identity,
        roadmap_link: roadmapLink,
        note,
      }),
    });
    const bootyData = await bootyRes.json();
    if (!bootyRes.ok) {
      emitResults({
        path: absPath,
        message: (bootyData.error as string) || `Failed to record booty for ${absPath}`,
      });
      return;
    }
    results.push({
      path: absPath,
      booty: bootyData.booty as BootyRow,
      deduped: Boolean(bootyData.deduped),
    });
  }

  emitResults();
}

async function handleList(options: CLIOptions): Promise<void> {
  const params = new URLSearchParams();
  if (typeof options.branch === 'string' && options.branch) params.append('branch', options.branch);
  if (typeof options.session === 'string' && options.session) params.append('session', options.session);
  if (options.limit !== undefined) params.append('limit', String(options.limit));

  const res: PdFetchResponse = await pdFetch(
    `${PORT_DADDY_URL}/booty${params.toString() ? '?' + params : ''}`,
  );
  const data = await res.json();
  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to list booty');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const rows = data.booty as BootyRow[];
  if (rows.length === 0) {
    if (!isQuiet(options)) ui.info('No harvested artifacts yet. Try: pd booty add <path>');
    return;
  }

  console.log('');
  console.log('Harvested Artifacts');
  console.log('─'.repeat(100));
  for (const row of rows) {
    const when = new Date(row.created_at).toISOString().replace('T', ' ').slice(0, 16);
    const who = row.agent_identity ?? row.session_id ?? '-';
    console.log(`${row.id}  ${row.blob_hash.slice(0, 12)}  ${row.media_type.padEnd(24)}  ${row.branch || '(none)'}`);
    console.log(`    ${row.original_path}`);
    console.log(`    ${when}  ${who}${row.roadmap_link ? `  roadmap:${row.roadmap_link}` : ''}${row.note ? `  — ${row.note}` : ''}`);
  }
  console.log('');
  console.log(`${rows.length} artifact(s)`);
}

/**
 * Handle `pd booty` command
 */
export async function handleBooty(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions,
): Promise<void> {
  switch (subcommand) {
    case 'add':
      await handleAdd(args, options);
      break;
    case 'list':
    case undefined:
      await handleList(options);
      break;
    case 'help':
      printHelp();
      process.exit(0);
      break;
    default:
      console.error(`Unknown booty subcommand: ${subcommand}`);
      printHelp();
      process.exit(1);
  }
}
