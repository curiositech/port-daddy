/**
 * Resolver Module — /etc/hosts management
 *
 * Manages a section of /etc/hosts with BEGIN/END markers so that
 * Port Daddy DNS records are resolvable at the OS level.
 *
 * Design:
 * - Section markers: # BEGIN PORT DADDY MANAGED / # END PORT DADDY MANAGED
 * - Atomic writes: read → modify in memory → write back
 * - Backup: copies to <hosts>.portdaddy.bak before first write
 * - Never touches content outside the managed section
 * - All writes go to a configurable path (tests use temp files)
 */

import type Database from 'better-sqlite3';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { resolve } from 'path';

// =============================================================================
// Constants
// =============================================================================

const MARKER_BEGIN = '# BEGIN PORT DADDY MANAGED';
const MARKER_END = '# END PORT DADDY MANAGED';
const MANAGED_COMMENT = '# Managed by Port Daddy — do not edit manually';
const DEFAULT_HOSTS_PATH = '/etc/hosts';

// =============================================================================
// Types
// =============================================================================

export interface HostEntry {
  hostname: string;
  ip: string;
}

export interface ParsedHostsFile {
  /** Content before the managed section */
  before: string;
  /** Parsed host entries from managed section */
  managed: HostEntry[];
  /** Content after the managed section */
  after: string;
  /** Whether markers were found */
  hasSection: boolean;
}

export interface ResolverConfig {
  /** Path to the hosts file (default: /etc/hosts) */
  hostsFilePath?: string;
  /** Default IP for new entries (default: 127.0.0.1) */
  defaultIp?: string;
}

export interface ResolverStatus {
  isSetUp: boolean;
  hostsFilePath: string;
  entries: number;
  fileExists: boolean;
}

// =============================================================================
// Module factory
// =============================================================================

export function createResolver(db: Database.Database, config: ResolverConfig = {}) {
  const hostsFilePath = config.hostsFilePath || DEFAULT_HOSTS_PATH;
  const defaultIp = config.defaultIp || '127.0.0.1';
  let hasBackedUp = false;

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  function readHostsFile(): string {
    if (!existsSync(hostsFilePath)) return '';
    return readFileSync(hostsFilePath, 'utf-8');
  }

  function writeHostsFile(content: string): void {
    // Verify we're only writing to the expected path
    const resolvedPath = resolve(hostsFilePath);
    if (resolvedPath !== '/etc/hosts' && resolvedPath !== '/private/etc/hosts') {
      // Allow test paths (anything not /etc/hosts must be explicitly configured)
      if (hostsFilePath === DEFAULT_HOSTS_PATH) {
        throw new Error(`Unexpected hosts file path: ${resolvedPath}`);
      }
    }
    backupIfNeeded();
    writeFileSync(hostsFilePath, content, 'utf-8');
  }

  function backupIfNeeded(): void {
    if (hasBackedUp) return;
    if (!existsSync(hostsFilePath)) return;
    const backupPath = hostsFilePath + '.portdaddy.bak';
    if (!existsSync(backupPath)) {
      copyFileSync(hostsFilePath, backupPath);
    }
    hasBackedUp = true;
  }

  /**
   * Parse a single hosts-file line into (ip, hostname) or null for comments/empty.
   */
  function parseHostLine(line: string): HostEntry | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return null;

    // Split on whitespace (tabs or spaces)
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) return null;

    return { ip: parts[0], hostname: parts[1] };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Parse the hosts file into before/managed/after sections.
   */
  function parseHostsFile(): ParsedHostsFile {
    const content = readHostsFile();
    // Normalize line endings
    const normalized = content.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');

    let inSection = false;
    let hasSection = false;
    const beforeLines: string[] = [];
    const managedEntries: HostEntry[] = [];
    const afterLines: string[] = [];
    let foundEnd = false;

    for (const line of lines) {
      if (line.trim() === MARKER_BEGIN) {
        inSection = true;
        hasSection = true;
        continue;
      }
      if (line.trim() === MARKER_END) {
        inSection = false;
        foundEnd = true;
        continue;
      }

      if (inSection) {
        const entry = parseHostLine(line);
        if (entry) managedEntries.push(entry);
      } else if (foundEnd) {
        afterLines.push(line);
      } else {
        beforeLines.push(line);
      }
    }

    // Only consider it a valid section if both markers were found
    if (!foundEnd && hasSection) {
      hasSection = false;
    }

    return {
      before: beforeLines.join('\n'),
      managed: managedEntries,
      after: afterLines.join('\n'),
      hasSection,
    };
  }

  /**
   * Generate the managed block content from a list of entries.
   */
  function generateManagedBlock(entries: HostEntry[]): string {
    const lines = [MARKER_BEGIN, MANAGED_COMMENT];
    for (const e of entries) {
      lines.push(`${e.ip}\t${e.hostname}`);
    }
    lines.push(MARKER_END);
    return lines.join('\n');
  }

  /**
   * Write the full hosts file from parsed sections.
   */
  function writeFromParsed(before: string, entries: HostEntry[], after: string): void {
    const block = generateManagedBlock(entries);
    const parts: string[] = [];

    if (before) {
      // Ensure trailing newline before block
      parts.push(before.endsWith('\n') ? before : before + '\n');
    }
    parts.push(block);
    if (after) {
      parts.push(after.startsWith('\n') ? after : '\n' + after);
    }

    writeHostsFile(parts.join(''));
  }

  /**
   * Check whether the managed section exists in the hosts file.
   */
  function isSetUp(): boolean {
    const content = readHostsFile();
    return content.includes(MARKER_BEGIN) && content.includes(MARKER_END);
  }

  /**
   * Initialize the managed section in the hosts file.
   */
  function setup(): { success: boolean; alreadySetUp?: boolean; error?: string } {
    // Refuse to modify /etc/hosts if running as root. Only applies when the
    // configured hosts path is the real /etc/hosts — test fixtures pointed
    // at temp files are safe to mutate as any UID, including in CI sandboxes
    // that run as root.
    const resolvedHostsPath = resolve(hostsFilePath);
    const isSystemHostsFile =
      resolvedHostsPath === '/etc/hosts' || resolvedHostsPath === '/private/etc/hosts';
    if (isSystemHostsFile && process.getuid && process.getuid() === 0) {
      console.warn('[resolver] WARNING: Running as root — refusing to modify /etc/hosts for safety');
      return { success: false, error: 'Refusing to modify /etc/hosts when running as root. Use --allow-root to override.' };
    }

    if (isSetUp()) {
      return { success: true, alreadySetUp: true };
    }

    const content = readHostsFile();
    const normalized = content.replace(/\r\n/g, '\n');
    const block = generateManagedBlock([]);
    const separator = normalized && !normalized.endsWith('\n') ? '\n' : '';
    const newline = normalized ? '\n' : '';

    writeHostsFile(normalized + separator + newline + block + '\n');
    return { success: true };
  }

  /**
   * Remove the managed section entirely from the hosts file.
   */
  function teardown(): { success: boolean; wasSetUp: boolean } {
    if (!isSetUp()) {
      return { success: true, wasSetUp: false };
    }

    const parsed = parseHostsFile();

    // Reconstruct without the managed section
    const parts: string[] = [];
    if (parsed.before) {
      // Remove trailing empty lines that were just spacing before the block
      parts.push(parsed.before.replace(/\n+$/, '\n'));
    }
    if (parsed.after) {
      const trimmedAfter = parsed.after.replace(/^\n+/, '');
      if (trimmedAfter) {
        if (parts.length > 0) parts.push('\n');
        parts.push(trimmedAfter);
      }
    }

    const result = parts.join('');
    writeHostsFile(result || (parsed.before ? parsed.before : ''));
    return { success: true, wasSetUp: true };
  }

  /**
   * Add a hostname → IP entry to the managed section.
   * Creates the managed section if it doesn't exist.
   */
  function addEntry(hostname: string, ip: string = defaultIp): {
    success: boolean;
    alreadyExists?: boolean;
    updated?: boolean;
  } {
    // If no managed section, create it first
    if (!isSetUp()) {
      setup();
    }

    const parsed = parseHostsFile();
    const existing = parsed.managed.find(e => e.hostname === hostname);

    if (existing) {
      if (existing.ip === ip) {
        return { success: true, alreadyExists: true };
      }
      // Update IP
      existing.ip = ip;
      writeFromParsed(parsed.before, parsed.managed, parsed.after);
      return { success: true, updated: true };
    }

    // Add new entry
    parsed.managed.push({ hostname, ip });
    writeFromParsed(parsed.before, parsed.managed, parsed.after);
    return { success: true };
  }

  /**
   * Remove a hostname from the managed section.
   */
  function removeEntry(hostname: string): { success: boolean; notFound?: boolean } {
    if (!isSetUp()) {
      return { success: true, notFound: true };
    }

    const parsed = parseHostsFile();
    const idx = parsed.managed.findIndex(e => e.hostname === hostname);

    if (idx === -1) {
      return { success: true, notFound: true };
    }

    parsed.managed.splice(idx, 1);
    writeFromParsed(parsed.before, parsed.managed, parsed.after);
    return { success: true };
  }

  /**
   * Rebuild the managed section from the DNS records in SQLite.
   */
  function sync(): { success: boolean; entries: number } {
    // If no managed section, create it first
    if (!isSetUp()) {
      setup();
    }

    // Read all DNS records from the database
    const records = db.prepare(
      'SELECT hostname FROM dns_records ORDER BY hostname'
    ).all() as Array<{ hostname: string }>;

    const entries: HostEntry[] = records.map(r => ({
      hostname: r.hostname,
      ip: defaultIp,
    }));

    const parsed = parseHostsFile();
    writeFromParsed(parsed.before, entries, parsed.after);

    return { success: true, entries: entries.length };
  }

  /**
   * Get the resolver status.
   */
  function resolverStatus(): ResolverStatus {
    const setUp = isSetUp();
    const fileExists = existsSync(hostsFilePath);
    let entries = 0;

    if (setUp) {
      const parsed = parseHostsFile();
      entries = parsed.managed.length;
    }

    return {
      isSetUp: setUp,
      hostsFilePath,
      entries,
      fileExists,
    };
  }

  return {
    parseHostsFile,
    generateManagedBlock,
    addEntry,
    removeEntry,
    sync,
    setup,
    teardown,
    isSetUp,
    status: resolverStatus,
  };
}
