import { resolve } from 'node:path';
import { pdFetch, PORT_DADDY_URL, type PdFetchResponse } from '../utils/fetch.js';
import { readCurrentContext } from '../utils/current-context.js';
import type { CLIOptions } from '../types.js';

interface AdviceAction {
  label: string;
  command?: string;
  method?: string;
  path?: string;
  tool?: string;
}

interface AdviceItem {
  id: string;
  category: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  why: string;
  evidence?: Array<{ label: string; value: unknown; path?: string }>;
  actions?: AdviceAction[];
}

interface AdvisorResponse {
  success: boolean;
  summary?: string;
  advice?: AdviceItem[];
  error?: string;
}

function stringOption(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function boolOption(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function severityLabel(severity: string): string {
  if (severity === 'critical') return 'CRITICAL';
  if (severity === 'warning') return 'WARN';
  return 'INFO';
}

function printAdvice(data: AdvisorResponse): void {
  console.log(`COMPASS · ${data.summary ?? 'No summary returned.'}`);
  const items = data.advice ?? [];
  if (items.length === 0) return;

  for (const item of items) {
    console.log('');
    console.log(`${severityLabel(item.severity)} · ${item.title}`);
    console.log(`  ${item.why}`);

    const evidence = item.evidence ?? [];
    if (evidence.length > 0) {
      const compactEvidence = evidence.slice(0, 4)
        .map(entry => `${entry.label}=${String(entry.value)}`)
        .join('  ');
      console.log(`  evidence: ${compactEvidence}`);
    }

    const action = (item.actions ?? []).find(candidate => candidate.command) ?? item.actions?.[0];
    if (action?.command) {
      console.log(`  try: ${action.command}`);
    } else if (action?.method && action.path) {
      console.log(`  try: ${action.method} ${action.path}`);
    } else if (action?.tool) {
      console.log(`  try tool: ${action.tool}`);
    }
  }
}

export async function handleAdvisor(positional: string[], options: CLIOptions): Promise<void> {
  const current = readCurrentContext();
  const projectRoot = resolve(stringOption(options.dir) ?? stringOption(options.projectRoot) ?? process.cwd());
  const body = {
    projectRoot,
    task: stringOption(options.task) ?? stringOption(options.t),
    sessionId: stringOption(options.session) ?? stringOption(options.sessionId) ?? current?.sessionId,
    agentId: stringOption(options.agent) ?? stringOption(options.agentId) ?? current?.agentId,
    files: positional,
    includeChannels: boolOption(options.channels),
    includeTupleHints: boolOption(options.tuples),
  };

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/advisor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json() as unknown as AdvisorResponse;

  if (!res.ok || !data.success) {
    console.error(`ERROR: ${data.error || `advisor failed with status ${res.status}`}`);
    process.exit(1);
  }

  if (options.json || options.j) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  printAdvice(data);
}
