/**
 * Whois CLI Command — Semantic Phonebook lookup
 *
 * pd whois <query> [--kind agent|human|any] [--fresh <seconds>] [--limit <n>] [--json]
 *
 * Pretty-prints up to `limit` (default 10) ranked hits with similarity,
 * harbor, freshness, and the cascade stage that ranked each hit.
 */

import { resolveDaemonUrl } from '../../shared/daemon-discovery.js';

const BASE_URL = resolveDaemonUrl(process.env.PORT_DADDY_URL);

type ParsedOptions = Record<string, string | string[] | boolean | undefined>;

interface WhoisHit {
  agentId: string;
  agentName: string | null;
  harbor: string;
  phrase: string;
  score: number;
  similarity: number;
  bm25Score: number | null;
  freshnessWeight: number;
  lastHeartbeat: number | null;
  stage: 'exact' | 'bm25' | 'semantic' | 'llm';
  source: 'declared' | 'inferred' | 'earned';
}

interface WhoisResponse {
  success: boolean;
  query: string;
  kind: string;
  count: number;
  hits: WhoisHit[];
  error?: string;
}

async function api(path: string): Promise<WhoisResponse> {
  const res = await fetch(BASE_URL + path, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  return res.json() as Promise<WhoisResponse>;
}

function readKindOption(options: ParsedOptions): 'agent' | 'human' | 'any' {
  const raw = options['kind'];
  if (raw === 'agent' || raw === 'human' || raw === 'any') return raw;
  return 'agent';
}

function readNumericOption(options: ParsedOptions, key: string): number | undefined {
  const raw = options[key];
  if (raw === undefined || raw === true || raw === false) return undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function formatHeartbeat(lastHeartbeat: number | null): string {
  if (lastHeartbeat === null) return 'unknown';
  const diff = Date.now() - lastHeartbeat;
  if (diff < 60_000) return Math.floor(diff / 1000) + 's ago';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
  return Math.floor(diff / 86_400_000) + 'd ago';
}

function padRight(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, Math.max(0, width - 1)) + '…';
  return text + ' '.repeat(width - text.length);
}

export async function handleWhois(args: string[], options: ParsedOptions): Promise<void> {
  const query = args.join(' ').trim();
  if (!query) {
    console.error('Usage: pd whois <query> [--kind agent|human|any] [--fresh <seconds>] [--limit <n>] [--json]');
    process.exit(1);
  }

  const kind = readKindOption(options);
  const limit = readNumericOption(options, 'limit') ?? 10;
  const freshMin = readNumericOption(options, 'fresh');

  const params = new URLSearchParams();
  params.set('q', query);
  params.set('kind', kind);
  params.set('limit', String(limit));
  if (freshMin !== undefined) params.set('fresh_min', String(freshMin));

  let response: WhoisResponse;
  try {
    response = await api('/whois?' + params.toString());
  } catch (err) {
    console.error('Error contacting Port Daddy daemon:', (err as Error).message);
    process.exit(1);
    return;
  }

  if (options['json'] || options['j']) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (!response.success) {
    console.error('Error:', response.error ?? 'unknown error');
    process.exit(1);
  }

  if (response.count === 0) {
    console.log(`pd whois "${query}" — no matches.`);
    console.log('');
    console.log('Hints:');
    console.log('  - Try a different phrasing, or relax --fresh (currently ' + (freshMin ?? 'default 7d') + ').');
    console.log('  - Have any agents registered capabilities yet?  pd harbor enter <name> --cap ...');
    return;
  }

  console.log(`pd whois "${query}" — ${response.count} match${response.count === 1 ? '' : 'es'}`);
  console.log('');
  console.log(
    padRight('AGENT', 42),
    padRight('HARBOR', 24),
    padRight('SCORE', 8),
    padRight('SIM', 8),
    padRight('STAGE', 9),
    padRight('HEARTBEAT', 12),
    'PHRASE',
  );
  console.log('-'.repeat(120));
  for (const hit of response.hits) {
    const display = hit.agentName ? `${hit.agentName} (${hit.agentId})` : hit.agentId;
    console.log(
      padRight(display, 42),
      padRight(hit.harbor, 24),
      padRight(hit.score.toFixed(3), 8),
      padRight(hit.similarity.toFixed(3), 8),
      padRight(hit.stage, 9),
      padRight(formatHeartbeat(hit.lastHeartbeat), 12),
      hit.phrase,
    );
  }
}
