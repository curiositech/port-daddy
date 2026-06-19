/**
 * Unit Tests for Deep Recursive Scanner (lib/scan.js)
 *
 * Tests scanProject, generateGuidance, and buildConfigFromScan.
 * Uses real temp directories with actual files for accurate detection.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scanProject, generateGuidance, buildConfigFromScan } from '../../lib/scan.js';

// Create unique temp dirs per test to avoid cross-test pollution
let testRoot;

function createTempProject() {
  const id = `pd-scan-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = join(tmpdir(), id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writePackageJson(dir, content) {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(content, null, 2));
}

describe('Deep Recursive Scanner', () => {
  beforeEach(() => {
    testRoot = createTempProject();
  });

  afterEach(() => {
    if (testRoot && existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  describe('scanProject()', () => {
    it('should detect a single Express project', () => {
      writePackageJson(testRoot, {
        name: 'my-api',
        dependencies: { express: '^4.18.0' }
      });

      const result = scanProject(testRoot);

      expect(result.project).toBe('my-api');
      expect(result.type).toBe('single');
      expect(result.serviceCount).toBe(1);
      expect(result.services['my-api']).toBeDefined();
      expect(result.services['my-api'].stack.name).toBe('Express');
      expect(result.guidance).toBeDefined();
      expect(result.guidance.length).toBeGreaterThan(0);
    });

    it('should detect a Next.js project by config file', () => {
      writePackageJson(testRoot, { name: 'my-frontend' });
      writeFileSync(join(testRoot, 'next.config.js'), 'module.exports = {}');

      const result = scanProject(testRoot);

      expect(result.serviceCount).toBe(1);
      expect(result.services['my-frontend'].stack.name).toBe('Next.js');
    });

    it('should detect nested services in subdirectories', () => {
      // Root has no framework
      writePackageJson(testRoot, { name: 'monorepo-test' });

      // packages/api has Express
      const apiDir = join(testRoot, 'packages', 'api');
      mkdirSync(apiDir, { recursive: true });
      writePackageJson(apiDir, {
        name: 'api',
        dependencies: { express: '^4.18.0' }
      });

      // packages/web has Next.js
      const webDir = join(testRoot, 'packages', 'web');
      mkdirSync(webDir, { recursive: true });
      writePackageJson(webDir, { name: 'web' });
      writeFileSync(join(webDir, 'next.config.js'), 'module.exports = {}');

      const result = scanProject(testRoot);

      expect(result.serviceCount).toBe(2);
      expect(result.services['api']).toBeDefined();
      expect(result.services['api'].stack.name).toBe('Express');
      expect(result.services['web']).toBeDefined();
      expect(result.services['web'].stack.name).toBe('Next.js');
    });

    it('should detect npm workspace monorepos', () => {
      writePackageJson(testRoot, {
        name: 'mono',
        workspaces: ['packages/*']
      });

      const svcDir = join(testRoot, 'packages', 'svc');
      mkdirSync(svcDir, { recursive: true });
      writePackageJson(svcDir, {
        name: '@mono/svc',
        dependencies: { fastify: '^4.0.0' }
      });

      const result = scanProject(testRoot);

      expect(result.type).toBe('monorepo');
      expect(result.serviceCount).toBeGreaterThanOrEqual(1);
      expect(result.services['svc']).toBeDefined();
      expect(result.services['svc'].stack.name).toBe('Fastify');
    });

    it('should skip node_modules and .git directories', () => {
      writePackageJson(testRoot, { name: 'skip-test' });

      // Hidden framework in node_modules (should NOT be found)
      const nmDir = join(testRoot, 'node_modules', 'some-pkg');
      mkdirSync(nmDir, { recursive: true });
      writeFileSync(join(nmDir, 'next.config.js'), '{}');

      // Hidden framework in .git (should NOT be found)
      const gitDir = join(testRoot, '.git', 'hooks');
      mkdirSync(gitDir, { recursive: true });
      writeFileSync(join(gitDir, 'go.mod'), 'module test');

      const result = scanProject(testRoot);

      // Should not detect the hidden frameworks
      expect(result.serviceCount).toBe(0);
    });

    it('should return empty services for a bare directory', () => {
      // No package.json, no framework files
      const result = scanProject(testRoot);

      expect(result.serviceCount).toBe(0);
      expect(result.type).toBe('single');
    });

    it('should detect Cloudflare Workers by wrangler.toml', () => {
      writeFileSync(join(testRoot, 'wrangler.toml'), 'name = "my-worker"');
      writePackageJson(testRoot, { name: 'my-worker' });

      const result = scanProject(testRoot);

      expect(result.serviceCount).toBe(1);
      expect(result.services['my-worker'].stack.name).toBe('Cloudflare Workers');
      expect(result.services['my-worker'].preferredPort).toBe(8787);
    });

    it('should detect Go projects by go.mod', () => {
      writeFileSync(join(testRoot, 'go.mod'), 'module example.com/myapp\n\ngo 1.21');
      // go.mod alone triggers detection; no package.json needed

      const result = scanProject(testRoot);

      expect(result.serviceCount).toBe(1);
      const svcName = Object.keys(result.services)[0];
      expect(result.services[svcName].stack.name).toBe('Go');
    });

    it('should detect Rust projects by Cargo.toml', () => {
      writeFileSync(join(testRoot, 'Cargo.toml'), '[package]\nname = "my-rs"');

      const result = scanProject(testRoot);

      expect(result.serviceCount).toBe(1);
      const svcName = Object.keys(result.services)[0];
      expect(result.services[svcName].stack.name).toBe('Rust');
    });

    it('should detect Docker projects by Dockerfile', () => {
      writeFileSync(join(testRoot, 'Dockerfile'), 'FROM node:20');
      writePackageJson(testRoot, { name: 'dockerized' });

      const result = scanProject(testRoot);

      expect(result.serviceCount).toBe(1);
      expect(result.services['dockerized'].stack.name).toBe('Docker');
    });

    it('should respect MAX_DEPTH and not recurse infinitely', () => {
      // Create a deep nesting: 7 levels deep (beyond MAX_DEPTH of 5)
      let currentDir = testRoot;
      for (let i = 0; i < 7; i++) {
        currentDir = join(currentDir, `level${i}`);
        mkdirSync(currentDir, { recursive: true });
      }
      // Put an Express project at the deepest level
      writePackageJson(currentDir, {
        name: 'deep-svc',
        dependencies: { express: '^4.0.0' }
      });

      const result = scanProject(testRoot);

      // Should NOT find the service at depth 7
      expect(result.services['deep-svc']).toBeUndefined();
    });

    it('should derive service name from @scoped packages', () => {
      const svcDir = join(testRoot, 'packages', 'auth');
      mkdirSync(svcDir, { recursive: true });
      writePackageJson(svcDir, {
        name: '@myorg/auth-service',
        dependencies: { express: '^4.0.0' }
      });
      writePackageJson(testRoot, { name: 'root' });

      const result = scanProject(testRoot);

      // Should strip the @scope/ prefix
      expect(result.services['auth-service']).toBeDefined();
    });
  });

  describe('generateGuidance()', () => {
    it('should suggest manual config when no services found', () => {
      const guidance = generateGuidance({
        services: {},
        existingConfig: null,
        type: 'single',
        projectName: 'empty'
      });

      expect(guidance.some(l => l.includes('No services detected'))).toBe(true);
    });

    it('should suggest port-daddy up when services found', () => {
      const guidance = generateGuidance({
        services: { api: {} },
        existingConfig: null,
        type: 'single',
        projectName: 'test'
      });

      expect(guidance.some(l => l.includes('port-daddy up'))).toBe(true);
      expect(guidance.some(l => l.includes('Discovered 1 service'))).toBe(true);
    });

    it('should note config update when existing config has fewer services', () => {
      const guidance = generateGuidance({
        services: { api: {}, web: {}, worker: {} },
        existingConfig: { services: { api: {} } },
        type: 'monorepo',
        projectName: 'test'
      });

      expect(guidance.some(l => l.includes('Found 3 services (config has 1)'))).toBe(true);
    });

    it('should note config is up to date when counts match', () => {
      const guidance = generateGuidance({
        services: { api: {} },
        existingConfig: { services: { api: {} } },
        type: 'single',
        projectName: 'test'
      });

      expect(guidance.some(l => l.includes('up to date'))).toBe(true);
    });
  });

  describe('buildConfigFromScan()', () => {
    it('should build a valid config from scan results', () => {
      const scanResult = {
        project: 'test-proj',
        services: {
          api: {
            relativePath: 'packages/api',
            stack: { name: 'Express', defaultPort: 3000 },
            dev: 'npm run dev',
            health: '/health',
            preferredPort: 3000
          },
          web: {
            relativePath: 'packages/web',
            stack: { name: 'Next.js', defaultPort: 3001 },
            dev: 'npm run dev',
            health: '/',
            preferredPort: 3001
          }
        },
        suggestions: {
          api: { full: 'test-proj:api:main' },
          web: { full: 'test-proj:frontend:main' }
        },
        existingConfig: null
      };

      const config = buildConfigFromScan(scanResult);

      expect(config.project).toBe('test-proj');
      expect(config.services.api).toBeDefined();
      expect(config.services.api.dev).toBe('npm run dev');
      expect(config.services.api._detected).toBe('Express');
      expect(config.services.api._identity).toBe('test-proj:api:main');
      expect(config.services.web._detected).toBe('Next.js');
      expect(config.portRange).toBeDefined();
      expect(config.portRange[0]).toBeLessThanOrEqual(config.portRange[1]);
    });

    it('should compute port range from service defaults', () => {
      const scanResult = {
        project: 'test',
        services: {
          a: { stack: { name: 'Express' }, preferredPort: 3000, relativePath: '.', dev: null, health: '/' },
          b: { stack: { name: 'Next.js' }, preferredPort: 5173, relativePath: 'web', dev: null, health: '/' }
        },
        suggestions: {},
        existingConfig: null
      };

      const config = buildConfigFromScan(scanResult);

      expect(config.portRange[0]).toBe(3000);
      expect(config.portRange[1]).toBe(5173 + 49);
    });

    // Bug #9: existingConfig.portRange was being ignored
    // buildConfigFromScan would use calculated range instead of config's range
    it('should preserve portRange from existingConfig (Bug #9 regression)', () => {
      const scanResult = {
        project: 'test-proj',
        services: {
          api: {
            relativePath: '.',
            stack: { name: 'Express', defaultPort: 3000 },
            dev: 'npm run dev',
            health: '/health',
            preferredPort: 3000
          }
        },
        suggestions: {},
        existingConfig: {
          project: 'my-project',
          portRange: [8000, 8050],
          services: {}
        },
        serviceCount: 1,
        guidance: []
      };

      const config = buildConfigFromScan(scanResult);

      // portRange should be preserved from existingConfig, NOT calculated
      expect(config.portRange).toEqual([8000, 8050]);
      // project name should also be preserved from existingConfig
      expect(config.project).toBe('my-project');
    });

    it('should use calculated portRange when no existingConfig', () => {
      const scanResult = {
        project: 'test-proj',
        services: {
          api: {
            relativePath: '.',
            stack: { name: 'Express', defaultPort: 3000 },
            dev: 'npm run dev',
            health: '/health',
            preferredPort: 5000
          }
        },
        suggestions: {},
        existingConfig: null,
        serviceCount: 1,
        guidance: []
      };

      const config = buildConfigFromScan(scanResult);

      // Without existingConfig, should use calculated range
      expect(config.portRange[0]).toBe(5000);
      expect(config.portRange[1]).toBe(5049);
    });
  });
});
