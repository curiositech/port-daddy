/**
 * CLI Activity Commands
 *
 * Handles: log, activity commands for audit trail
 */

import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isJson } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';

/**
 * Handle `pd log [subcommand]` command
 */
export async function handleLog(subcommand: string | undefined, options: CLIOptions): Promise<void> {
  if (subcommand === 'summary') {
    const params = new URLSearchParams();
    if (options.since) params.append('since', options.since as string);

    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/activity/summary${params.toString() ? '?' + params : ''}`);
    const data = await res.json();

    if (!res.ok) {
      ui.error((data.error as string) || 'Failed to get summary');
      process.exit(1);
    }

    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    console.log('');
    console.log('Activity Summary');
    console.log('\u2500'.repeat(40));

    const summary = data.summary as Record<string, number>;
    for (const [type, count] of Object.entries(summary)) {
      console.log(`  ${type.padEnd(25)} ${count}`);
    }

    console.log('\u2500'.repeat(40));
    console.log(`  Total: ${data.total}`);
    if ((data.since as number) > 0) {
      console.log(`  Since: ${new Date(data.since as number).toISOString()}`);
    }
    console.log('');
    return;
  }

  if (subcommand === 'stats') {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/activity/stats`);
    const data = await res.json();

    if (!res.ok) {
      ui.error((data.error as string) || 'Failed to get stats');
      process.exit(1);
    }

    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const stats = data.stats as {
      totalEntries: number;
      maxEntries: number;
      retentionMs: number;
      oldestEntry?: number;
      newestEntry?: number;
    };
    console.log('');
    console.log('Activity Log Stats');
    console.log('\u2500'.repeat(40));
    console.log(`  Total entries: ${stats.totalEntries}`);
    console.log(`  Max entries: ${stats.maxEntries}`);
    console.log(`  Retention: ${Math.floor(stats.retentionMs / 86400000)} days`);
    if (stats.oldestEntry) {
      console.log(`  Oldest: ${new Date(stats.oldestEntry).toISOString()}`);
    }
    if (stats.newestEntry) {
      console.log(`  Newest: ${new Date(stats.newestEntry).toISOString()}`);
    }
    console.log('');
    return;
  }

  // Time-range query via --from / --to
  if (options.from || options.to) {
    const rangeParams = new URLSearchParams();
    if (options.from) rangeParams.append('from', String(options.from));
    if (options.to) rangeParams.append('to', String(options.to));
    if (options.limit) rangeParams.append('limit', String(options.limit));
    if (options.type) rangeParams.append('type', options.type as string);

    const rangeRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/activity/range?${rangeParams}`);
    const rangeData = await rangeRes.json();

    if (!rangeRes.ok) {
      console.error((rangeData.error as string) || 'Failed to get activity range');
      process.exit(1);
    }

    if (isJson(options)) {
      console.log(JSON.stringify(rangeData, null, 2));
      return;
    }

    const entries = rangeData.entries as Array<{ timestamp: number; type: string; agentId?: string; details?: string }>;
    if (!entries || entries.length === 0) {
      console.log('No activity in specified range');
      return;
    }

    console.log('');
    console.log('TIMESTAMP'.padEnd(22) + 'TYPE'.padEnd(20) + 'AGENT'.padEnd(18) + 'DETAILS');
    console.log('\u2500'.repeat(85));

    for (const entry of entries) {
      const time: string = new Date(entry.timestamp).toISOString().replace('T', ' ').slice(0, 19);
      console.log(
        time.padEnd(22) +
        entry.type.slice(0, 19).padEnd(20) +
        (entry.agentId || '-').slice(0, 17).padEnd(18) +
        (entry.details || '-')
      );
    }

    console.log('');
    console.log(`Showing ${entries.length} entries`);
    return;
  }

  // Default: show recent activity
  const params = new URLSearchParams();
  if (options.limit) params.append('limit', String(options.limit));
  if (options.type) params.append('type', options.type as string);
  if (options.agent) params.append('agent', options.agent as string);
  if (options.target) params.append('target', options.target as string);
  if (subcommand && subcommand !== 'recent') params.append('type', subcommand);

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/activity${params.toString() ? '?' + params : ''}`);
  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to get activity');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (data.count === 0) {
    console.log('No activity found');
    return;
  }

  console.log('');
  console.log('TIMESTAMP'.padEnd(22) + 'TYPE'.padEnd(20) + 'AGENT'.padEnd(18) + 'DETAILS');
  console.log('\u2500'.repeat(85));

  const entries = data.entries as Array<{ timestamp: number; type: string; agentId?: string; details?: string }>;
  for (const entry of entries) {
    const time: string = new Date(entry.timestamp).toISOString().replace('T', ' ').slice(0, 19);
    console.log(
      time.padEnd(22) +
      entry.type.slice(0, 19).padEnd(20) +
      (entry.agentId || '-').slice(0, 17).padEnd(18) +
      (entry.details || '-')
    );
  }

  console.log('');
  console.log(`Showing ${data.count} entries`);
}
