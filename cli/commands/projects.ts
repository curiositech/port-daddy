/**
 * CLI Project Commands
 *
 * Handles: scan, projects commands for project discovery and registry
 */

import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isJson } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';
import { requireConfirmation, DESTRUCTIVE_EXIT_CODE } from '../utils/destructive-confirm.js';

/**
 * Handle `pd scan [dir]` command
 */
export async function handleScan(dir: string | undefined, options: CLIOptions): Promise<void> {
  const targetDir: string = dir || (options.dir as string) || process.cwd();
  const dryRun: boolean = options['dry-run'] === true;
  const useBranch: boolean = options.branch === true;

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dir: targetDir, save: !dryRun, dryRun, useBranch })
  });

  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Scan failed');
    if (data.details) console.error(`  ${data.details}`);
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Header
  console.log('');
  console.log(`  Project: ${data.project}`);
  console.log(`  Root:    ${data.root}`);
  console.log(`  Type:    ${data.type}`);
  console.log('');

  if (data.serviceCount === 0) {
    console.log('  No services detected.');
    console.log('');
    if (data.guidance) {
      for (const line of data.guidance as string[]) {
        console.log(`  ${line}`);
      }
    }
    return;
  }

  // Service tree
  console.log(`  Services (${data.serviceCount}):`);
  console.log('');

  const svcMap = data.services as Record<string, { framework?: string; preferredPort?: number; dir?: string }>;
  const entries = Object.entries(svcMap);
  const maxName: number = Math.max(...entries.map(([n]) => n.length));

  for (const [name, svc] of entries) {
    const padded: string = name.padEnd(maxName);
    const framework: string = svc.framework || 'unknown';
    const port: string = svc.preferredPort ? `:${svc.preferredPort}` : '';
    const svcDir: string = svc.dir || '.';
    console.log(`    ${padded}  ${framework.padEnd(20)} ${svcDir}${port}`);
  }
  console.log('');

  // Config status
  if (dryRun) {
    console.log('  Dry run \u2014 config not saved.');
    console.log('  Run without --dry-run to save .portdaddyrc');
  } else if (data.saved) {
    console.log(`  Config saved: ${data.savedPath}`);
  }

  const existingConfig = data.existingConfig as { path: string; serviceCount: number } | undefined;
  if (existingConfig) {
    console.log(`  Existing config: ${existingConfig.path} (${existingConfig.serviceCount} services)`);
  }

  // Guidance
  console.log('');
  if (data.guidance) {
    for (const line of data.guidance as string[]) {
      console.log(`  ${line}`);
    }
  }
  console.log('');
}

/**
 * Handle `pd projects [subcommand]` command
 */
export async function handleProjects(subcommand: string | undefined, args: string[], options: CLIOptions): Promise<void> {
  // Handle "projects rm <id>"
  if (subcommand === 'rm' || subcommand === 'remove' || subcommand === 'delete') {
    const projectId: string | undefined = args[0];
    if (!projectId) {
      console.error('Usage: port-daddy projects rm <project-id>');
      process.exit(1);
    }

    const ok = await requireConfirmation({
      summary: `Projects rm will deregister "${projectId}" from the Port Daddy project registry. Its services, ports, and discovered config are removed from the index (files on disk remain).`,
      args: options as Record<string, unknown>,
    });
    if (!ok) process.exit(DESTRUCTIVE_EXIT_CODE);

    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE'
    });

    const data = await res.json();

    if (!res.ok) {
      ui.error((data.error as string) || 'Failed to remove project');
      process.exit(1);
    }

    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(`  Removed project: ${projectId}`);
    }
    return;
  }

  // Handle "projects <id>" — get specific project
  if (subcommand && subcommand !== 'list') {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/projects/${encodeURIComponent(subcommand)}`);
    const data = await res.json();

    if (!res.ok) {
      ui.error((data.error as string) || 'Project not found');
      if (data.suggestion) console.error(`  ${data.suggestion}`);
      process.exit(1);
    }

    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const p = data.project as { id: string; root: string; type: string; lastScanned: number; services?: Record<string, { stack?: { name: string } }> };
    console.log('');
    console.log(`  Project: ${p.id}`);
    console.log(`  Root:    ${p.root}`);
    console.log(`  Type:    ${p.type}`);
    console.log(`  Scanned: ${new Date(p.lastScanned).toLocaleString()}`);
    console.log('');

    if (p.services) {
      const entries = Object.entries(p.services);
      console.log(`  Services (${entries.length}):`);
      for (const [name, svc] of entries) {
        const framework: string = svc?.stack?.name || 'unknown';
        console.log(`    ${name}  ${framework}`);
      }
    }
    console.log('');
    return;
  }

  // Default: list all projects
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/projects`);
  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to list projects');
    if (data.details) console.error(`  ${data.details}`);
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (data.count === 0) {
    console.log('');
    console.log('  No known Port Daddy projects.');
    console.log('');
    console.log('  Add durable repo markers such as pd-fleet.yml, .portdaddyrc, or .portdaddy/, or run "port-daddy scan".');
    console.log('');
    return;
  }

  console.log('');
  console.log(`  Known Port Daddy projects (${data.count}):`);
  console.log('');

  const projectsList = data.projects as Array<{ id: string; type: string; serviceCount: number; lastScanned?: number; frameworks?: string[] }>;
  const maxId: number = Math.max(...projectsList.map((p) => p.id.length));
  for (const p of projectsList) {
    const padded: string = p.id.padEnd(maxId);
    const type: string = p.type.padEnd(9);
    const svcCount: string = `${p.serviceCount} svc`;
    const scanned: string = p.lastScanned ? new Date(p.lastScanned).toLocaleDateString() : 'never';
    const frameworks: string = p.frameworks?.length ? p.frameworks.join(', ') : '';
    console.log(`    ${padded}  ${type} ${svcCount.padEnd(6)}  scanned ${scanned}  ${frameworks}`);
  }

  console.log('');
}
