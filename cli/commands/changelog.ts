/**
 * CLI Changelog Commands
 *
 * Hierarchical changelog with identity-based rollup.
 * Agents report changes, system rolls up to parent levels.
 */

import { status as maritimeStatus } from '../../lib/maritime.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';

interface ChangelogEntry {
  id: number;
  identity: string;
  sessionId: string | null;
  agentId: string | null;
  type: 'feature' | 'fix' | 'refactor' | 'docs' | 'chore' | 'breaking';
  summary: string;
  description: string | null;
  createdAt: number;
}

const TYPE_ICONS: Record<string, string> = {
  feature: '\u2728',   // sparkles
  fix: '\ud83d\udc1b', // bug -> fixed
  refactor: '\u267b',  // recycle
  docs: '\ud83d\udcdd', // memo
  chore: '\ud83e\uddf9', // broom
  breaking: '\ud83d\udca5', // collision
};

/**
 * Handle `pd changelog` command
 */
export async function handleChangelog(subcommand: string | undefined, args: string[], options: CLIOptions): Promise<void> {
  if (subcommand === 'help') {
    console.error('Usage: port-daddy changelog [subcommand] [options]');
    console.error('');
    console.error('Hierarchical changelog for agent coordination');
    console.error('');
    console.error('Subcommands:');
    console.error('  (none)                          List recent changes');
    console.error('  add <identity> <summary>        Add a changelog entry');
    console.error('  show <identity>                 Show changes for an identity');
    console.error('  tree <identity>                 Show changes for identity + children');
    console.error('  export [identity]               Export as markdown');
    console.error('  identities                      List all identities');
    console.error('');
    console.error('Options:');
    console.error('  --type <type>                   Entry type (feature, fix, refactor, docs, chore, breaking)');
    console.error('  --description <text>            Detailed description');
    console.error('  --session <id>                  Link to session');
    console.error('  --agent <id>                    Link to agent');
    console.error('  --limit <n>                     Limit results');
    console.error('  --format <format>               Export format (flat, tree, keep-a-changelog)');
    console.error('  --since <timestamp>             Filter by time');
    process.exit(0);
  }

  switch (subcommand) {
    case 'add': {
      const identity = args[0];
      const summary = args.slice(1).join(' ');

      if (!identity || !summary) {
        console.error('Usage: pd changelog add <identity> <summary>');
        console.error('  e.g., pd changelog add myapp:api:auth "Added JWT validation"');
        process.exit(1);
      }

      const body: Record<string, unknown> = { identity, summary };
      if (options.type) body.type = options.type;
      if (options.description) body.description = options.description;
      if (options.session) body.sessionId = options.session;
      if (options.agent) body.agentId = options.agent;

      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/changelog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        console.error(maritimeStatus('error', (data.error as string) || 'Failed to add changelog entry'));
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      const result = data as { id: number; ancestors?: string[] };
      console.log(maritimeStatus('success', `Added changelog entry #${result.id}`));
      if (result.ancestors && result.ancestors.length > 0) {
        console.log(`  Rolls up to: ${result.ancestors.join(' \u2192 ')}`);
      }
      break;
    }

    case 'show': {
      const identity = args[0];
      if (!identity) {
        console.error('Usage: pd changelog show <identity>');
        process.exit(1);
      }

      const params = new URLSearchParams();
      if (options.limit) params.append('limit', String(options.limit));

      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/changelog/${encodeURIComponent(identity)}${params.toString() ? '?' + params : ''}`);
      const data = await res.json();

      if (!res.ok) {
        console.error(maritimeStatus('error', (data.error as string) || 'Failed to list changelog'));
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      printEntries(data.entries as ChangelogEntry[], identity, options);
      break;
    }

    case 'tree': {
      const identity = args[0];
      if (!identity) {
        console.error('Usage: pd changelog tree <identity>');
        process.exit(1);
      }

      const params = new URLSearchParams({ tree: 'true' });
      if (options.limit) params.append('limit', String(options.limit));

      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/changelog/${encodeURIComponent(identity)}?${params}`);
      const data = await res.json();

      if (!res.ok) {
        console.error(maritimeStatus('error', (data.error as string) || 'Failed to list changelog'));
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      printEntries(data.entries as ChangelogEntry[], `${identity}/*`, options);
      break;
    }

    case 'export': {
      const identity = args[0];
      const format = (options.format as string) || 'flat';

      const params = new URLSearchParams({ format });
      if (options.limit) params.append('limit', String(options.limit));
      if (options.since) params.append('since', String(options.since));
      params.append('raw', 'true');

      const url = identity
        ? `${PORT_DADDY_URL}/changelog/${encodeURIComponent(identity)}?${params}`
        : `${PORT_DADDY_URL}/changelog?${params}`;

      const res: PdFetchResponse = await pdFetch(url);

      if (!res.ok) {
        const data = await res.json();
        console.error(maritimeStatus('error', (data.error as string) || 'Failed to export changelog'));
        process.exit(1);
      }

      const markdown = await res.text();
      console.log(markdown);
      break;
    }

    case 'identities': {
      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/changelog/identities`);
      const data = await res.json();

      if (!res.ok) {
        console.error(maritimeStatus('error', (data.error as string) || 'Failed to list identities'));
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      const identities = data.identities as string[];
      if (identities.length === 0) {
        if (!isQuiet(options)) {
          console.log(maritimeStatus('ready', 'No changelog entries yet'));
        }
        return;
      }

      console.log('');
      console.log('Changelog Identities:');
      console.log('\u2500'.repeat(40));
      for (const id of identities) {
        console.log(`  ${id}`);
      }
      console.log('');
      console.log(`${data.count} identities with changelog entries`);
      break;
    }

    default: {
      // List recent changes
      const params = new URLSearchParams();
      if (options.limit) params.append('limit', String(options.limit));
      if (options.since) params.append('since', String(options.since));

      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/changelog${params.toString() ? '?' + params : ''}`);
      const data = await res.json();

      if (!res.ok) {
        console.error(maritimeStatus('error', (data.error as string) || 'Failed to list changelog'));
        process.exit(1);
      }

      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      printEntries(data.entries as ChangelogEntry[], 'Recent Changes', options);
    }
  }
}

/**
 * Print changelog entries in a readable format
 */
function printEntries(entries: ChangelogEntry[], title: string, options: CLIOptions): void {
  if (entries.length === 0) {
    if (!isQuiet(options)) {
      console.log(maritimeStatus('ready', 'No changelog entries'));
    }
    return;
  }

  console.log('');
  console.log(`\ud83d\udcdc ${title}`);
  console.log('\u2500'.repeat(60));
  console.log('');

  for (const entry of entries) {
    const icon = TYPE_ICONS[entry.type] || '\u2022';
    const age = formatAge(Date.now() - entry.createdAt);
    const typeTag = `[${entry.type.toUpperCase()}]`;

    console.log(`${icon} ${typeTag} ${entry.summary}`);
    console.log(`    ${entry.identity} \u2022 ${age}`);
    if (entry.description) {
      console.log(`    ${entry.description.split('\n')[0].slice(0, 60)}...`);
    }
    console.log('');
  }

  console.log(`${entries.length} changelog entries`);
}

/**
 * Format age in human-readable form
 */
function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
