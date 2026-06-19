/**
 * Resolver Unit Tests
 *
 * Tests for the /etc/hosts resolver module.
 * All tests use temp files — NEVER touches real /etc/hosts.
 */

import { createTestDb } from '../setup-unit.js';
import { createDns } from '../../lib/dns.js';
import { createResolver } from '../../lib/resolver.js';
import { writeFileSync, readFileSync, mkdtempSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'pd-resolver-'));
}

function makeTmpHostsFile(dir, content = '') {
  const p = join(dir, 'hosts');
  writeFileSync(p, content, 'utf-8');
  return p;
}

const MARKER_BEGIN = '# BEGIN PORT DADDY MANAGED';
const MARKER_END = '# END PORT DADDY MANAGED';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Resolver', () => {
  let db;
  let dns;

  beforeEach(() => {
    db = createTestDb();
    dns = createDns(db);
  });

  afterEach(() => {
    db.close();
  });

  // =========================================================================
  // generateManagedBlock
  // =========================================================================

  describe('generateManagedBlock()', () => {
    it('generates correct block with entries', () => {
      const dir = makeTmpDir();
      const hostsPath = makeTmpHostsFile(dir);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      const block = resolver.generateManagedBlock([
        { hostname: 'myapp-api.local', ip: '127.0.0.1' },
        { hostname: 'myapp-web.local', ip: '127.0.0.1' },
      ]);

      expect(block).toContain(MARKER_BEGIN);
      expect(block).toContain(MARKER_END);
      expect(block).toContain('127.0.0.1\tmyapp-api.local');
      expect(block).toContain('127.0.0.1\tmyapp-web.local');
    });

    it('generates empty block when no entries', () => {
      const dir = makeTmpDir();
      const hostsPath = makeTmpHostsFile(dir);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      const block = resolver.generateManagedBlock([]);
      expect(block).toContain(MARKER_BEGIN);
      expect(block).toContain(MARKER_END);
      // Only markers plus comment, no host entries
      const lines = block.split('\n').filter(l => l.startsWith('127.'));
      expect(lines).toHaveLength(0);
    });
  });

  // =========================================================================
  // parseHostsFile
  // =========================================================================

  describe('parseHostsFile()', () => {
    it('parses file with no managed section', () => {
      const dir = makeTmpDir();
      const content = '127.0.0.1\tlocalhost\n::1\tlocalhost\n';
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      const parsed = resolver.parseHostsFile();
      expect(parsed.before).toBe(content);
      expect(parsed.managed).toEqual([]);
      expect(parsed.after).toBe('');
      expect(parsed.hasSection).toBe(false);
    });

    it('parses file with managed section', () => {
      const dir = makeTmpDir();
      const content = [
        '127.0.0.1\tlocalhost',
        '::1\tlocalhost',
        '',
        MARKER_BEGIN,
        '# Managed by Port Daddy — do not edit manually',
        '127.0.0.1\tmyapp-api.local',
        '127.0.0.1\tmyapp-web.local',
        MARKER_END,
        '',
        '# some other stuff',
      ].join('\n');
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      const parsed = resolver.parseHostsFile();
      expect(parsed.hasSection).toBe(true);
      expect(parsed.managed).toHaveLength(2);
      expect(parsed.managed[0]).toEqual({ hostname: 'myapp-api.local', ip: '127.0.0.1' });
      expect(parsed.managed[1]).toEqual({ hostname: 'myapp-web.local', ip: '127.0.0.1' });
      expect(parsed.before).toContain('::1\tlocalhost');
      expect(parsed.after).toContain('# some other stuff');
    });

    it('handles empty file', () => {
      const dir = makeTmpDir();
      const hostsPath = makeTmpHostsFile(dir, '');
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      const parsed = resolver.parseHostsFile();
      expect(parsed.before).toBe('');
      expect(parsed.managed).toEqual([]);
      expect(parsed.after).toBe('');
      expect(parsed.hasSection).toBe(false);
    });

    it('handles managed section at start of file', () => {
      const dir = makeTmpDir();
      const content = [
        MARKER_BEGIN,
        '127.0.0.1\ttest.local',
        MARKER_END,
        '127.0.0.1\tlocalhost',
      ].join('\n');
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      const parsed = resolver.parseHostsFile();
      expect(parsed.hasSection).toBe(true);
      expect(parsed.managed).toHaveLength(1);
      expect(parsed.before).toBe('');
      expect(parsed.after).toContain('localhost');
    });

    it('handles managed section at end of file', () => {
      const dir = makeTmpDir();
      const content = [
        '127.0.0.1\tlocalhost',
        MARKER_BEGIN,
        '127.0.0.1\ttest.local',
        MARKER_END,
      ].join('\n');
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      const parsed = resolver.parseHostsFile();
      expect(parsed.hasSection).toBe(true);
      expect(parsed.managed).toHaveLength(1);
      expect(parsed.before).toContain('localhost');
      expect(parsed.after).toBe('');
    });

    it('ignores comments inside managed section', () => {
      const dir = makeTmpDir();
      const content = [
        MARKER_BEGIN,
        '# Managed by Port Daddy — do not edit manually',
        '127.0.0.1\tfoo.local',
        '# A comment about bar',
        '127.0.0.1\tbar.local',
        MARKER_END,
      ].join('\n');
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      const parsed = resolver.parseHostsFile();
      expect(parsed.managed).toHaveLength(2);
    });
  });

  // =========================================================================
  // addEntry
  // =========================================================================

  describe('addEntry()', () => {
    it('adds entry to existing managed section', () => {
      const dir = makeTmpDir();
      const content = [
        '127.0.0.1\tlocalhost',
        '',
        MARKER_BEGIN,
        '# Managed by Port Daddy — do not edit manually',
        '127.0.0.1\texisting.local',
        MARKER_END,
      ].join('\n');
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      const result = resolver.addEntry('new.local', '127.0.0.1');
      expect(result.success).toBe(true);

      const newContent = readFileSync(hostsPath, 'utf-8');
      expect(newContent).toContain('127.0.0.1\texisting.local');
      expect(newContent).toContain('127.0.0.1\tnew.local');
      expect(newContent).toContain(MARKER_BEGIN);
      expect(newContent).toContain(MARKER_END);
    });

    it('creates managed section if not present', () => {
      const dir = makeTmpDir();
      const content = '127.0.0.1\tlocalhost\n';
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      const result = resolver.addEntry('test.local', '127.0.0.1');
      expect(result.success).toBe(true);

      const newContent = readFileSync(hostsPath, 'utf-8');
      expect(newContent).toContain('127.0.0.1\tlocalhost');
      expect(newContent).toContain(MARKER_BEGIN);
      expect(newContent).toContain('127.0.0.1\ttest.local');
      expect(newContent).toContain(MARKER_END);
    });

    it('does not duplicate existing entry', () => {
      const dir = makeTmpDir();
      const content = [
        MARKER_BEGIN,
        '127.0.0.1\ttest.local',
        MARKER_END,
      ].join('\n');
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      const result = resolver.addEntry('test.local', '127.0.0.1');
      expect(result.success).toBe(true);
      expect(result.alreadyExists).toBe(true);

      const newContent = readFileSync(hostsPath, 'utf-8');
      const matches = newContent.match(/test\.local/g);
      expect(matches).toHaveLength(1);
    });

    it('updates IP if hostname exists with different IP', () => {
      const dir = makeTmpDir();
      const content = [
        MARKER_BEGIN,
        '127.0.0.1\ttest.local',
        MARKER_END,
      ].join('\n');
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      const result = resolver.addEntry('test.local', '192.168.1.1');
      expect(result.success).toBe(true);
      expect(result.updated).toBe(true);

      const newContent = readFileSync(hostsPath, 'utf-8');
      expect(newContent).toContain('192.168.1.1\ttest.local');
      expect(newContent).not.toContain('127.0.0.1\ttest.local');
    });

    it('preserves content outside managed section', () => {
      const dir = makeTmpDir();
      const content = [
        '# /etc/hosts',
        '127.0.0.1\tlocalhost',
        '::1\tlocalhost',
        '',
        MARKER_BEGIN,
        MARKER_END,
        '',
        '# custom entry',
        '10.0.0.1\tmy-server',
      ].join('\n');
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      resolver.addEntry('test.local', '127.0.0.1');

      const newContent = readFileSync(hostsPath, 'utf-8');
      expect(newContent).toContain('127.0.0.1\tlocalhost');
      expect(newContent).toContain('::1\tlocalhost');
      expect(newContent).toContain('10.0.0.1\tmy-server');
      expect(newContent).toContain('# custom entry');
    });
  });

  // =========================================================================
  // removeEntry
  // =========================================================================

  describe('removeEntry()', () => {
    it('removes an existing entry', () => {
      const dir = makeTmpDir();
      const content = [
        '127.0.0.1\tlocalhost',
        '',
        MARKER_BEGIN,
        '127.0.0.1\tfoo.local',
        '127.0.0.1\tbar.local',
        MARKER_END,
      ].join('\n');
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      const result = resolver.removeEntry('foo.local');
      expect(result.success).toBe(true);

      const newContent = readFileSync(hostsPath, 'utf-8');
      expect(newContent).not.toContain('foo.local');
      expect(newContent).toContain('bar.local');
      expect(newContent).toContain(MARKER_BEGIN);
      expect(newContent).toContain(MARKER_END);
    });

    it('returns notFound when entry does not exist', () => {
      const dir = makeTmpDir();
      const content = [
        MARKER_BEGIN,
        '127.0.0.1\tfoo.local',
        MARKER_END,
      ].join('\n');
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      const result = resolver.removeEntry('nonexistent.local');
      expect(result.success).toBe(true);
      expect(result.notFound).toBe(true);
    });

    it('does not modify file when entry not found', () => {
      const dir = makeTmpDir();
      const content = [
        MARKER_BEGIN,
        '127.0.0.1\tfoo.local',
        MARKER_END,
      ].join('\n');
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      resolver.removeEntry('nonexistent.local');

      const newContent = readFileSync(hostsPath, 'utf-8');
      expect(newContent).toContain('foo.local');
    });

    it('returns notFound when no managed section', () => {
      const dir = makeTmpDir();
      const content = '127.0.0.1\tlocalhost\n';
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      const result = resolver.removeEntry('foo.local');
      expect(result.success).toBe(true);
      expect(result.notFound).toBe(true);
    });

    it('preserves content outside managed section', () => {
      const dir = makeTmpDir();
      const content = [
        '# header',
        '127.0.0.1\tlocalhost',
        '',
        MARKER_BEGIN,
        '127.0.0.1\tfoo.local',
        MARKER_END,
        '',
        '# footer',
      ].join('\n');
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      resolver.removeEntry('foo.local');

      const newContent = readFileSync(hostsPath, 'utf-8');
      expect(newContent).toContain('# header');
      expect(newContent).toContain('127.0.0.1\tlocalhost');
      expect(newContent).toContain('# footer');
    });
  });

  // =========================================================================
  // sync
  // =========================================================================

  describe('sync()', () => {
    it('rebuilds managed section from DNS registry', () => {
      const dir = makeTmpDir();
      const content = [
        '127.0.0.1\tlocalhost',
        '',
        MARKER_BEGIN,
        '127.0.0.1\told-stale.local',
        MARKER_END,
      ].join('\n');
      const hostsPath = makeTmpHostsFile(dir, content);

      // Register DNS entries
      dns.register('myapp:api', { port: 3000 });
      dns.register('myapp:web', { port: 3001, hostname: 'myapp-web.local' });

      const resolver = createResolver(db, { hostsFilePath: hostsPath });
      const result = resolver.sync();

      expect(result.success).toBe(true);
      expect(result.entries).toBe(2);

      const newContent = readFileSync(hostsPath, 'utf-8');
      // Old stale entry should be gone
      expect(newContent).not.toContain('old-stale.local');
      // New entries from DNS registry
      expect(newContent).toContain('myapp-api.local');
      expect(newContent).toContain('myapp-web.local');
      // Original content preserved
      expect(newContent).toContain('127.0.0.1\tlocalhost');
    });

    it('creates managed section if not present during sync', () => {
      const dir = makeTmpDir();
      const content = '127.0.0.1\tlocalhost\n';
      const hostsPath = makeTmpHostsFile(dir, content);

      dns.register('test:svc', { port: 4000 });

      const resolver = createResolver(db, { hostsFilePath: hostsPath });
      const result = resolver.sync();

      expect(result.success).toBe(true);
      const newContent = readFileSync(hostsPath, 'utf-8');
      expect(newContent).toContain(MARKER_BEGIN);
      expect(newContent).toContain('test-svc.local');
      expect(newContent).toContain(MARKER_END);
    });

    it('clears managed section when DNS registry is empty', () => {
      const dir = makeTmpDir();
      const content = [
        '127.0.0.1\tlocalhost',
        '',
        MARKER_BEGIN,
        '127.0.0.1\told.local',
        MARKER_END,
      ].join('\n');
      const hostsPath = makeTmpHostsFile(dir, content);

      const resolver = createResolver(db, { hostsFilePath: hostsPath });
      const result = resolver.sync();

      expect(result.success).toBe(true);
      expect(result.entries).toBe(0);

      const newContent = readFileSync(hostsPath, 'utf-8');
      expect(newContent).not.toContain('old.local');
      expect(newContent).toContain(MARKER_BEGIN);
      expect(newContent).toContain(MARKER_END);
    });
  });

  // =========================================================================
  // setup / teardown / isSetUp
  // =========================================================================

  describe('setup()', () => {
    it('creates managed section in hosts file', () => {
      const dir = makeTmpDir();
      const content = '127.0.0.1\tlocalhost\n::1\tlocalhost\n';
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      expect(resolver.isSetUp()).toBe(false);

      const result = resolver.setup();
      expect(result.success).toBe(true);

      expect(resolver.isSetUp()).toBe(true);

      const newContent = readFileSync(hostsPath, 'utf-8');
      expect(newContent).toContain(MARKER_BEGIN);
      expect(newContent).toContain(MARKER_END);
      expect(newContent).toContain('127.0.0.1\tlocalhost');
    });

    it('is idempotent — does not duplicate section', () => {
      const dir = makeTmpDir();
      const hostsPath = makeTmpHostsFile(dir, '127.0.0.1\tlocalhost\n');
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      resolver.setup();
      resolver.setup();

      const content = readFileSync(hostsPath, 'utf-8');
      const beginCount = (content.match(/BEGIN PORT DADDY MANAGED/g) || []).length;
      expect(beginCount).toBe(1);
    });
  });

  describe('teardown()', () => {
    it('removes managed section entirely', () => {
      const dir = makeTmpDir();
      const content = [
        '127.0.0.1\tlocalhost',
        '',
        MARKER_BEGIN,
        '# Managed by Port Daddy — do not edit manually',
        '127.0.0.1\ttest.local',
        MARKER_END,
        '',
        '# footer',
      ].join('\n');
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      expect(resolver.isSetUp()).toBe(true);

      const result = resolver.teardown();
      expect(result.success).toBe(true);

      expect(resolver.isSetUp()).toBe(false);

      const newContent = readFileSync(hostsPath, 'utf-8');
      expect(newContent).not.toContain(MARKER_BEGIN);
      expect(newContent).not.toContain(MARKER_END);
      expect(newContent).not.toContain('test.local');
      expect(newContent).toContain('127.0.0.1\tlocalhost');
      expect(newContent).toContain('# footer');
    });

    it('is idempotent — safe to call when no section exists', () => {
      const dir = makeTmpDir();
      const content = '127.0.0.1\tlocalhost\n';
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      const result = resolver.teardown();
      expect(result.success).toBe(true);
      expect(result.wasSetUp).toBe(false);

      const newContent = readFileSync(hostsPath, 'utf-8');
      expect(newContent).toBe(content);
    });
  });

  describe('isSetUp()', () => {
    it('returns false for new file', () => {
      const dir = makeTmpDir();
      const hostsPath = makeTmpHostsFile(dir, '');
      const resolver = createResolver(db, { hostsFilePath: hostsPath });
      expect(resolver.isSetUp()).toBe(false);
    });

    it('returns true when markers present', () => {
      const dir = makeTmpDir();
      const content = `${MARKER_BEGIN}\n${MARKER_END}\n`;
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });
      expect(resolver.isSetUp()).toBe(true);
    });

    it('returns false when only BEGIN marker (corrupt)', () => {
      const dir = makeTmpDir();
      const content = `${MARKER_BEGIN}\n127.0.0.1\ttest.local\n`;
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });
      // Both markers needed
      expect(resolver.isSetUp()).toBe(false);
    });
  });

  // =========================================================================
  // status
  // =========================================================================

  describe('status()', () => {
    it('reports status correctly when not set up', () => {
      const dir = makeTmpDir();
      const hostsPath = makeTmpHostsFile(dir, '');
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      const st = resolver.status();
      expect(st.isSetUp).toBe(false);
      expect(st.hostsFilePath).toBe(hostsPath);
      expect(st.entries).toBe(0);
    });

    it('reports status correctly when set up with entries', () => {
      const dir = makeTmpDir();
      const content = [
        MARKER_BEGIN,
        '127.0.0.1\tfoo.local',
        '127.0.0.1\tbar.local',
        MARKER_END,
      ].join('\n');
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      const st = resolver.status();
      expect(st.isSetUp).toBe(true);
      expect(st.entries).toBe(2);
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe('edge cases', () => {
    it('handles hosts file with Windows-style line endings', () => {
      const dir = makeTmpDir();
      const content = '127.0.0.1\tlocalhost\r\n::1\tlocalhost\r\n';
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      resolver.setup();
      resolver.addEntry('test.local', '127.0.0.1');

      const newContent = readFileSync(hostsPath, 'utf-8');
      expect(newContent).toContain('test.local');
    });

    it('handles hosts file with spaces instead of tabs', () => {
      const dir = makeTmpDir();
      const content = [
        MARKER_BEGIN,
        '127.0.0.1  spaced.local',
        MARKER_END,
      ].join('\n');
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      const parsed = resolver.parseHostsFile();
      expect(parsed.managed).toHaveLength(1);
      expect(parsed.managed[0].hostname).toBe('spaced.local');
    });

    it('handles multiple hostnames on one line', () => {
      const dir = makeTmpDir();
      const content = [
        MARKER_BEGIN,
        '127.0.0.1\tfoo.local bar.local',
        MARKER_END,
      ].join('\n');
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      const parsed = resolver.parseHostsFile();
      // Takes first hostname as primary
      expect(parsed.managed.length).toBeGreaterThanOrEqual(1);
      expect(parsed.managed[0].hostname).toBe('foo.local');
    });

    it('handles non-existent hosts file gracefully in status', () => {
      const dir = makeTmpDir();
      const hostsPath = join(dir, 'nonexistent');
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      const st = resolver.status();
      expect(st.isSetUp).toBe(false);
      expect(st.fileExists).toBe(false);
    });

    it('handles backup creation', () => {
      const dir = makeTmpDir();
      const content = '127.0.0.1\tlocalhost\n';
      const hostsPath = makeTmpHostsFile(dir, content);
      const backupPath = hostsPath + '.portdaddy.bak';
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      resolver.setup();

      // Backup should have been created
      expect(existsSync(backupPath)).toBe(true);
      expect(readFileSync(backupPath, 'utf-8')).toBe(content);
    });
  });

  // =========================================================================
  // DNS integration
  // =========================================================================

  describe('DNS module integration', () => {
    it('resolver hook is called on register when set up', () => {
      const dir = makeTmpDir();
      const content = [
        '127.0.0.1\tlocalhost',
        '',
        MARKER_BEGIN,
        MARKER_END,
      ].join('\n');
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      // Wire resolver into DNS
      dns.setResolver(resolver);

      // Register a DNS entry — should auto-add to hosts
      dns.register('myapp:api', { port: 3000 });

      const newContent = readFileSync(hostsPath, 'utf-8');
      expect(newContent).toContain('127.0.0.1\tmyapp-api.local');
    });

    it('resolver hook is called on unregister', () => {
      const dir = makeTmpDir();
      const content = [
        '127.0.0.1\tlocalhost',
        '',
        MARKER_BEGIN,
        '127.0.0.1\tmyapp-api.local',
        MARKER_END,
      ].join('\n');
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      // First register in SQLite so unregister finds it
      dns.register('myapp:api', { port: 3000 });
      dns.setResolver(resolver);

      dns.unregister('myapp:api');

      const newContent = readFileSync(hostsPath, 'utf-8');
      expect(newContent).not.toContain('myapp-api.local');
    });

    it('DNS operations succeed even if resolver fails', () => {
      const dir = makeTmpDir();
      // Point to non-writable path
      const resolver = createResolver(db, { hostsFilePath: '/nonexistent/path/hosts' });

      dns.setResolver(resolver);

      // Should not throw — graceful fallback
      const result = dns.register('test:svc', { port: 5000 });
      expect(result.success).toBe(true);
    });

    it('resolver is not called when not set up', () => {
      const dir = makeTmpDir();
      const content = '127.0.0.1\tlocalhost\n';
      const hostsPath = makeTmpHostsFile(dir, content);
      const resolver = createResolver(db, { hostsFilePath: hostsPath });

      // Wire but don't setup
      dns.setResolver(resolver);

      dns.register('myapp:api', { port: 3000 });

      // Hosts file should NOT have been modified (no managed section)
      const newContent = readFileSync(hostsPath, 'utf-8');
      expect(newContent).toBe(content);
    });
  });
});
