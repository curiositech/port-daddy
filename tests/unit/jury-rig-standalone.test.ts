import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import {
  parseStandaloneJuryRigArguments,
  runStandaloneJuryRig,
  standaloneWarmupArguments,
} from '../../lib/jury-rig-standalone.js';
import {
  exactOllamaModelId,
  resolveLocalTool2VecRuntime,
  resolveOllamaEmbedderForProfile,
} from '../../lib/jury-rig-local-tool2vec.js';
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

  test('schedules only discovery operations for a detached local full warm', () => {
    expect(standaloneWarmupArguments([
      'search', 'repair', '--root', '/repo', '--db-dir', '/cache', '--json',
    ], {})).toEqual([
      'warm', '--local-only', '--all', '--quiet', '--root', '/repo', '--db-dir', '/cache',
    ]);
    expect(standaloneWarmupArguments(['graft', 'repair'], {})).toEqual([
      'warm', '--local-only', '--all', '--quiet',
    ]);
    expect(standaloneWarmupArguments(['warm'], {})).toBeNull();
    expect(standaloneWarmupArguments(['search', 'repair'], { JURY_RIG_BACKGROUND_WARM: '1' })).toBeNull();
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
    expect(resolveTool2VecReadProfile({ db }))
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

  test('discovers and digest-binds the strongest installed loopback Ollama profile', async () => {
    const embedDigest = 'a'.repeat(64);
    const generatorDigest = 'b'.repeat(64);
    const fetchImpl = jest.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) {
        return new Response(JSON.stringify({ models: [
          { name: 'nomic-embed-text:latest', digest: 'c'.repeat(64) },
          { name: 'qwen3-embedding:8b', digest: embedDigest },
          { name: 'qwen3.5:latest', digest: generatorDigest },
        ] }), { status: 200 });
      }
      if (url.endsWith('/api/embed')) {
        return new Response(JSON.stringify({ embeddings: [[3, 4]] }), { status: 200 });
      }
      throw new Error(`unexpected URL ${url}`);
    });

    const selected = await resolveLocalTool2VecRuntime({ env: {}, fetchImpl });
    expect(selected?.embedderModel.name).toBe('qwen3-embedding:8b');
    expect(selected?.runtime.model).toBe('qwen3.5:latest');
    expect(selected?.embedder.modelId).toBe(`ollama:qwen3-embedding:8b@sha256:${embedDigest}`);
    expect(selected?.runtime.generatorId).toBe(`ollama:qwen3.5:latest@sha256:${generatorDigest}`);
    expect(await selected?.embedder.embed(['repair tests'])).toEqual([[0.6, 0.8]]);
    expect(await resolveOllamaEmbedderForProfile(selected!.embedder.modelId, { env: {}, fetchImpl }))
      .toMatchObject({ modelId: selected!.embedder.modelId });
    expect(exactOllamaModelId(selected!.embedderModel)).toBe(selected!.embedder.modelId);
  });

  test('rejects remote Ollama hosts for automatic warming', async () => {
    const fetchImpl = jest.fn<typeof fetch>();
    const warnings: string[] = [];
    expect(await resolveLocalTool2VecRuntime({
      env: { OLLAMA_HOST: 'https://ollama.example.com' },
      fetchImpl,
      onWarning: (message) => warnings.push(message),
    })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(warnings).toEqual([expect.stringContaining('non-loopback')]);
  });

  test('starts a sleeping local Ollama server and retries model discovery', async () => {
    const startServer = jest.fn<() => void>();
    let attempts = 0;
    const fetchImpl = jest.fn<typeof fetch>(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('connection refused');
      return new Response(JSON.stringify({ models: [
        { name: 'qwen3-embedding:8b', digest: 'a'.repeat(64) },
        { name: 'qwen3.5:latest', digest: 'b'.repeat(64) },
      ] }), { status: 200 });
    });

    const selected = await resolveLocalTool2VecRuntime({
      env: {},
      fetchImpl,
      startServer,
      timeoutMs: 10,
    });
    expect(startServer).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(selected?.runtime.model).toBe('qwen3.5:latest');
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
