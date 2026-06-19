/**
 * Unit Tests for Service Discovery Module (discover.js)
 *
 * Tests single project detection, monorepo workspace scanning,
 * name suggestion, and config merge precedence.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  discoverServices,
  detectWorkspaceConfig,
  suggestNames,
  mergeWithConfig
} from '../../lib/discover.js';

let tempDir;

function createTempDir() {
  return mkdtempSync(join(tmpdir(), 'pd-discover-'));
}

function writeJson(dir, filename, data) {
  writeFileSync(join(dir, filename), JSON.stringify(data, null, 2));
}

function setupProject(dir, pkg, extraFiles = {}) {
  writeJson(dir, 'package.json', pkg);
  for (const [name, content] of Object.entries(extraFiles)) {
    writeFileSync(join(dir, name), content);
  }
}

describe('Discover Module', () => {
  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('detectWorkspaceConfig()', () => {
    it('should detect npm/yarn workspaces from package.json array', () => {
      setupProject(tempDir, {
        name: 'my-monorepo',
        workspaces: ['packages/*', 'apps/*']
      });

      const result = detectWorkspaceConfig(tempDir);
      expect(result.type).toBe('workspaces');
      expect(result.patterns).toEqual(['packages/*', 'apps/*']);
    });

    it('should detect npm/yarn workspaces from package.json object', () => {
      setupProject(tempDir, {
        name: 'my-monorepo',
        workspaces: { packages: ['packages/*'] }
      });

      const result = detectWorkspaceConfig(tempDir);
      expect(result.type).toBe('workspaces');
      expect(result.patterns).toEqual(['packages/*']);
    });

    it('should detect pnpm workspaces', () => {
      setupProject(tempDir, { name: 'my-monorepo' });
      writeFileSync(join(tempDir, 'pnpm-workspace.yaml'),
        'packages:\n  - "packages/*"\n  - "apps/*"\n');

      const result = detectWorkspaceConfig(tempDir);
      expect(result.type).toBe('pnpm');
      expect(result.patterns).toEqual(['packages/*', 'apps/*']);
    });

    it('should detect lerna configuration', () => {
      setupProject(tempDir, { name: 'my-monorepo' });
      writeJson(tempDir, 'lerna.json', { packages: ['packages/*'] });

      const result = detectWorkspaceConfig(tempDir);
      expect(result.type).toBe('lerna');
      expect(result.patterns).toEqual(['packages/*']);
    });

    it('should return null type for non-monorepo', () => {
      setupProject(tempDir, { name: 'my-app' });

      const result = detectWorkspaceConfig(tempDir);
      expect(result.type).toBeNull();
      expect(result.patterns).toEqual([]);
    });

    it('should return null type when no package.json exists', () => {
      const result = detectWorkspaceConfig(tempDir);
      expect(result.type).toBeNull();
    });
  });

  describe('discoverServices()', () => {
    it('should discover a single Express project', () => {
      setupProject(tempDir, {
        name: 'my-api',
        dependencies: { express: '^4.18.0' }
      });

      const result = discoverServices(tempDir);
      expect(result.type).toBe('single');
      expect(Object.keys(result.services)).toEqual(['my-api']);
      expect(result.services['my-api'].stack.name).toBe('Express');
    });

    it('should discover a single Next.js project', () => {
      setupProject(tempDir, {
        name: 'my-frontend',
        dependencies: { next: '^14.0.0', react: '^18.0.0' }
      }, {
        'next.config.js': 'module.exports = {};'
      });

      const result = discoverServices(tempDir);
      expect(result.type).toBe('single');
      expect(result.services['my-frontend'].stack.name).toBe('Next.js');
    });

    it('should prefer npm run dev when scripts.dev exists', () => {
      setupProject(tempDir, {
        name: 'my-api',
        scripts: { dev: 'nodemon server.js' },
        dependencies: { express: '^4.18.0' }
      });

      const result = discoverServices(tempDir);
      expect(result.services['my-api'].dev).toBe('npm run dev');
    });

    it('should fallback to stack devCmd when no scripts.dev', () => {
      setupProject(tempDir, {
        name: 'my-api',
        dependencies: { express: '^4.18.0' }
      });

      const result = discoverServices(tempDir);
      expect(result.services['my-api'].dev).toBe('node server.js');
    });

    it('should return empty services for unknown project', () => {
      setupProject(tempDir, { name: 'unknown-thing' });

      const result = discoverServices(tempDir);
      expect(result.type).toBe('single');
      expect(Object.keys(result.services)).toHaveLength(0);
    });

    it('should discover monorepo workspace services', () => {
      // Root package.json with workspaces
      setupProject(tempDir, {
        name: 'my-monorepo',
        workspaces: ['packages/*']
      });

      // Create workspace packages
      const apiDir = join(tempDir, 'packages', 'api');
      mkdirSync(apiDir, { recursive: true });
      setupProject(apiDir, {
        name: '@myorg/api',
        dependencies: { express: '^4.18.0' }
      });

      const webDir = join(tempDir, 'packages', 'web');
      mkdirSync(webDir, { recursive: true });
      setupProject(webDir, {
        name: '@myorg/web',
        dependencies: { next: '^14.0.0' }
      }, {
        'next.config.js': 'module.exports = {};'
      });

      const result = discoverServices(tempDir);
      expect(result.type).toBe('monorepo');
      expect(Object.keys(result.services).sort()).toEqual(['api', 'web']);
      expect(result.services['api'].stack.name).toBe('Express');
      expect(result.services['web'].stack.name).toBe('Next.js');
    });

    it('should strip scoped package name prefix', () => {
      setupProject(tempDir, {
        name: '@myorg/cool-api',
        dependencies: { express: '^4.18.0' }
      });

      const result = discoverServices(tempDir);
      expect(Object.keys(result.services)).toEqual(['cool-api']);
    });

    it('should set health path from stack', () => {
      setupProject(tempDir, {
        name: 'my-api',
        dependencies: { express: '^4.18.0' }
      });

      const result = discoverServices(tempDir);
      expect(result.services['my-api'].health).toBe('/health');
    });
  });

  describe('suggestNames()', () => {
    it('should generate semantic identities from discovered services', () => {
      const services = {
        frontend: { stack: { name: 'Next.js' } },
        api: { stack: { name: 'Express' } }
      };

      setupProject(tempDir, { name: 'my-app' });
      const suggestions = suggestNames(services, tempDir);

      expect(suggestions.frontend).toEqual({
        project: 'my-app',
        stack: 'frontend',
        context: 'main',
        full: 'my-app:frontend:main'
      });

      expect(suggestions.api).toEqual({
        project: 'my-app',
        stack: 'api',
        context: 'main',
        full: 'my-app:api:main'
      });
    });

    it('should classify static servers correctly', () => {
      const services = {
        docs: { stack: { name: 'serve' } }
      };

      setupProject(tempDir, { name: 'my-docs' });
      const suggestions = suggestNames(services, tempDir);

      expect(suggestions.docs.stack).toBe('static');
    });

    it('should fallback to "app" for unknown stack types', () => {
      const services = {
        custom: { stack: { name: 'CustomFramework' } }
      };

      setupProject(tempDir, { name: 'custom-proj' });
      const suggestions = suggestNames(services, tempDir);

      expect(suggestions.custom.stack).toBe('app');
    });

    it('should handle null stack gracefully', () => {
      const services = {
        mystery: { stack: null }
      };

      setupProject(tempDir, { name: 'mystery-proj' });
      const suggestions = suggestNames(services, tempDir);

      expect(suggestions.mystery.stack).toBe('app');
    });

    it('should sanitize project names', () => {
      const services = {
        app: { stack: { name: 'Express' } }
      };

      setupProject(tempDir, { name: '@myorg/Weird Name!' });
      const suggestions = suggestNames(services, tempDir);

      // Should lowercase and replace invalid chars
      expect(suggestions.app.project).toMatch(/^[a-z0-9-]+$/);
    });
  });

  describe('mergeWithConfig()', () => {
    it('should return discovered services when no config', () => {
      const discovered = {
        api: { dev: 'node server.js', health: '/health' }
      };

      expect(mergeWithConfig(discovered, null)).toEqual(discovered);
      expect(mergeWithConfig(discovered, {})).toEqual(discovered);
    });

    it('should let config override discovered fields', () => {
      const discovered = {
        api: { dev: 'node server.js', health: '/health', preferredPort: 3000 }
      };
      const config = {
        services: {
          api: { dev: 'nodemon server.js', port: 4000 }
        }
      };

      const merged = mergeWithConfig(discovered, config);
      expect(merged.api.dev).toBe('nodemon server.js');
      expect(merged.api.port).toBe(4000);
      // Discovery values preserved for non-overridden fields
      expect(merged.api.health).toBe('/health');
      expect(merged.api.preferredPort).toBe(3000);
    });

    it('should add config-only services not found by discovery', () => {
      const discovered = {
        api: { dev: 'node server.js' }
      };
      const config = {
        services: {
          worker: { dev: 'node worker.js', noPort: true }
        }
      };

      const merged = mergeWithConfig(discovered, config);
      expect(Object.keys(merged).sort()).toEqual(['api', 'worker']);
      expect(merged.worker.noPort).toBe(true);
    });

    it('should handle remote services from config', () => {
      const discovered = {};
      const config = {
        services: {
          api: { remote: 'https://api.staging.example.com' }
        }
      };

      const merged = mergeWithConfig(discovered, config);
      expect(merged.api.remote).toBe('https://api.staging.example.com');
    });

    it('should not mutate the original discovered object', () => {
      const discovered = {
        api: { dev: 'node server.js' }
      };
      const config = {
        services: {
          api: { port: 4000 }
        }
      };

      const merged = mergeWithConfig(discovered, config);
      expect(discovered.api.port).toBeUndefined();
      expect(merged.api.port).toBe(4000);
    });
  });
});
