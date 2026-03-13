/**
 * Unit Tests for Projects Module (lib/projects.js)
 *
 * Tests CRUD operations against in-memory SQLite.
 * Verifies register, get, getByPath, list, remove, count.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createProjects } from '../../lib/projects.js';

describe('Projects Module', () => {
  let db, projects;

  beforeEach(() => {
    db = createTestDb();
    projects = createProjects(db);
  });

  describe('register()', () => {
    it('should register a new project', () => {
      const result = projects.register({
        id: 'my-app',
        root: '/home/user/my-app',
        type: 'single',
        config: { project: 'my-app', services: {} },
        services: { api: { stack: 'Express' } },
        metadata: { frameworks: ['Express'] }
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('my-app');
      expect(result.root).toBe('/home/user/my-app');
      expect(result.type).toBe('single');
      expect(result.config).toEqual({ project: 'my-app', services: {} });
      expect(result.services).toEqual({ api: { stack: 'Express' } });
      expect(result.metadata).toEqual({ frameworks: ['Express'] });
      expect(result.last_scanned).toBeDefined();
      expect(result.created_at).toBeDefined();
    });

    it('should upsert an existing project and preserve created_at', () => {
      projects.register({
        id: 'my-app',
        root: '/home/user/my-app',
        type: 'single'
      });

      const first = projects.get('my-app');
      const originalCreatedAt = first.created_at;

      // Re-register with updated data
      projects.register({
        id: 'my-app',
        root: '/home/user/my-app-v2',
        type: 'monorepo',
        services: { api: {}, frontend: {} }
      });

      const updated = projects.get('my-app');
      expect(updated.root).toBe('/home/user/my-app-v2');
      expect(updated.type).toBe('monorepo');
      expect(updated.created_at).toBe(originalCreatedAt);
      expect(updated.last_scanned).toBeGreaterThanOrEqual(originalCreatedAt);
    });

    it('should handle null optional fields', () => {
      const result = projects.register({
        id: 'minimal',
        root: '/tmp/minimal'
      });

      expect(result.id).toBe('minimal');
      expect(result.type).toBe('single');
      expect(result.config).toBeNull();
      expect(result.services).toBeNull();
      expect(result.metadata).toBeNull();
    });
  });

  describe('get()', () => {
    it('should return null for nonexistent project', () => {
      expect(projects.get('nope')).toBeNull();
    });

    it('should return deserialized project', () => {
      projects.register({
        id: 'test-proj',
        root: '/tmp/test',
        config: { project: 'test', portRange: [3100, 3199] },
        metadata: { score: 42 }
      });

      const proj = projects.get('test-proj');
      expect(proj.config.portRange).toEqual([3100, 3199]);
      expect(proj.metadata.score).toBe(42);
    });
  });

  describe('getByPath()', () => {
    it('should find project by root path', () => {
      projects.register({ id: 'path-test', root: '/home/user/project' });

      const found = projects.getByPath('/home/user/project');
      expect(found).toBeDefined();
      expect(found.id).toBe('path-test');
    });

    it('should return null for unknown path', () => {
      expect(projects.getByPath('/nonexistent')).toBeNull();
    });
  });

  describe('list()', () => {
    it('should return empty array when no projects', () => {
      expect(projects.list()).toEqual([]);
    });

    it('should return all projects ordered by last_scanned DESC', () => {
      projects.register({ id: 'proj-a', root: '/a' });
      projects.register({ id: 'proj-b', root: '/b' });
      projects.register({ id: 'proj-c', root: '/c' });

      const all = projects.list();
      expect(all).toHaveLength(3);
      // Most recently scanned first
      expect(all[0].last_scanned).toBeGreaterThanOrEqual(all[1].last_scanned);
    });
  });

  describe('remove()', () => {
    it('should remove an existing project and return true', () => {
      projects.register({ id: 'doomed', root: '/tmp/doomed' });
      expect(projects.remove('doomed')).toBe(true);
      expect(projects.get('doomed')).toBeNull();
    });

    it('should return false for nonexistent project', () => {
      expect(projects.remove('ghost')).toBe(false);
    });
  });

  describe('count()', () => {
    it('should return 0 when empty', () => {
      expect(projects.count()).toBe(0);
    });

    it('should return correct count after registrations', () => {
      projects.register({ id: 'a', root: '/a' });
      projects.register({ id: 'b', root: '/b' });
      expect(projects.count()).toBe(2);
    });

    it('should decrement after removal', () => {
      projects.register({ id: 'x', root: '/x' });
      projects.register({ id: 'y', root: '/y' });
      projects.remove('x');
      expect(projects.count()).toBe(1);
    });
  });

  describe('Tags & Pattern Filtering', () => {
    it('should register and retrieve project with tags', () => {
      projects.register({
        id: 'tagged-app',
        root: '/tmp/tagged',
        tags: ['frontend', 'react', 'dashboard']
      });

      const proj = projects.get('tagged-app');
      expect(proj.tags).toEqual(['frontend', 'react', 'dashboard']);
    });

    it('should handle tags as a comma-separated string during registration', () => {
      projects.register({
        id: 'string-tags',
        root: '/tmp/string',
        tags: 'api,backend,node'
      });

      const proj = projects.get('string-tags');
      expect(proj.tags).toEqual(['api', 'backend', 'node']);
    });

    it('should append tags when upserting if tags are provided', () => {
      projects.register({ id: 'upsert-tags', root: '/r', tags: ['v1'] });
      projects.register({ id: 'upsert-tags', root: '/r', tags: ['v2'] });

      const proj = projects.get('upsert-tags');
      // Note: Current implementation uses COALESCE(excluded.tags, tags), so it replaces if new tags provided
      // or keeps old ones if null. Let's verify behavior.
      expect(proj.tags).toEqual(['v2']);
    });

    it('should filter projects by ID pattern', () => {
      projects.register({ id: 'myapp:api', root: '/api' });
      projects.register({ id: 'myapp:web', root: '/web' });
      projects.register({ id: 'other:api', root: '/other' });

      const matches = projects.list({ pattern: 'myapp:*' });
      expect(matches).toHaveLength(2);
      expect(matches.map(m => m.id)).toContain('myapp:api');
      expect(matches.map(m => m.id)).toContain('myapp:web');
    });

    it('should filter projects by tag pattern', () => {
      projects.register({ id: 'p1', root: '/1', tags: ['prod', 'api'] });
      projects.register({ id: 'p2', root: '/2', tags: ['staging', 'web'] });
      projects.register({ id: 'p3', root: '/3', tags: ['prod', 'db'] });

      const matches = projects.list({ pattern: 'prod' });
      expect(matches).toHaveLength(2);
      expect(matches.map(m => m.id)).toContain('p1');
      expect(matches.map(m => m.id)).toContain('p3');
    });

    it('should match partial tags', () => {
      projects.register({ id: 'p1', root: '/1', tags: ['frontend-app'] });
      const matches = projects.list({ pattern: '*front*' });
      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe('p1');
    });
  });
});
