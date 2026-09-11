import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { parseStandaloneJuryRigArguments, runStandaloneJuryRig } from '../../lib/jury-rig-standalone.js';
import { createSkillGraftIndex } from '../../lib/skill-graft.js';
import {
  createTool2VecStore,
  resolveTool2VecReadProfile,
} from '../../lib/skill-graft-tool2vec.js';
import { loadSkillCatalog } from '../../lib/shipwright/skill-index.js';

const roots: string[] = [];

function scratch(): string {
  const base = join(homedir(), 'coding', 'tmp');
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, 'jury-rig-standalone-'));
  roots.push(root);
  return root;
}

function writeSkill(root: string, id: string, description: string): void {
  const dir = join(root, 'skills', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${id}\ndescription: ${description}\n---\n\n# ${id}\n\nFull body.\n`);
}

function vector(text: string): number[] {
  return text.includes('repair') ? [1, 0] : [0, 1];
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('standalone Jury-rig', () => {
  test('parses explicit search limits without entering the Port Daddy CLI', () => {
    expect(parseStandaloneJuryRigArguments([
      'search', 'repair', 'tests', '--shortlist-limit', '4', '--json',
    ])).toEqual({
      positional: ['search', 'repair', 'tests'],
      options: { 'shortlist-limit': '4', json: true, invocation: 'jury-rig' },
    });
    expect(() => parseStandaloneJuryRigArguments(['bootstrap', 'apply']))
      .toThrow(/does not expose Port Daddy machine-bootstrap/);
    expect(readFileSync(join(process.cwd(), 'bin', 'jury-rig.js'), 'utf8'))
      .not.toContain('port-daddy-cli');
  });

  test('forwards only parsed arguments to the shared Jury-rig handler', async () => {
    const handler = jest.fn<(positional: string[], options: Record<string, unknown>) => Promise<void>>()
      .mockResolvedValue(undefined);
    await runStandaloneJuryRig(['graft', 'repair tests', '--top-limit=1'], handler);
    expect(handler).toHaveBeenCalledWith(
      ['graft', 'repair tests'],
      { 'top-limit': '1', invocation: 'jury-rig' },
    );
  });

  test('help describes only daemon-free standalone operations', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await runStandaloneJuryRig(['--help']);
      const output = log.mock.calls.flat().join('\n');
      expect(output).toContain('jury-rig search');
      expect(output).toContain('does not discover,');
      expect(output).not.toContain('pd jury-rig');
      expect(output).not.toContain('bootstrap');
    } finally {
      log.mockRestore();
    }
  });

  test('reuses an exact persisted Tool2Vec profile without a live generator', async () => {
    const root = scratch();
    writeSkill(root, 'repair-tests', 'Repairs focused unit tests');
    const [skill] = loadSkillCatalog([join(root, 'skills')]);
    const db = new Database(':memory:');
    const store = createTool2VecStore({
      db,
      embedderModelId: 'mock-minilm',
      generatorId: 'cached-generator',
    });
    store.put(skill.id, skill.contentHash, {
      skillId: skill.id,
      centroid: [1, 0],
      queries: ['repair a test'],
    });

    expect(resolveTool2VecReadProfile({ db, embedderModelId: 'mock-minilm' }))
      .toEqual({ embedderModelId: 'mock-minilm', generatorId: 'cached-generator' });

    const index = createSkillGraftIndex({
      roots: [{ label: 'fixture', path: join(root, 'skills') }],
      centroidStore: store,
      embedder: { modelId: 'mock-minilm', embed: async (texts) => texts.map(vector) },
    });
    const result = await index.search('repair tests');
    expect(result.semanticTier).toBe('hybrid');
    expect(result.shortlist[0].id).toBe('repair-tests');
    expect(result).not.toHaveProperty('top');
  });

  test('falls back to BM25 metadata when the local query embedder is unavailable', async () => {
    const root = scratch();
    writeSkill(root, 'repair-tests', 'Repairs focused unit tests');
    const [skill] = loadSkillCatalog([join(root, 'skills')]);
    const db = new Database(':memory:');
    const store = createTool2VecStore({ db, embedderModelId: 'mock-minilm', generatorId: 'cached-generator' });
    store.put(skill.id, skill.contentHash, { skillId: skill.id, centroid: [1, 0], queries: ['repair a test'] });
    const warnings: string[] = [];
    const index = createSkillGraftIndex({
      roots: [{ label: 'fixture', path: join(root, 'skills') }],
      centroidStore: store,
      embedder: { modelId: 'mock-minilm', embed: async () => { throw new Error('model offline'); } },
      onWarning: (message) => warnings.push(message),
    });

    const result = await index.search('repair tests');
    expect(result.semanticTier).toBe('lexical-only');
    expect(result.shortlist[0].id).toBe('repair-tests');
    expect(warnings).toEqual([expect.stringContaining('using BM25 only')]);
  });
});
