/** Local-only Ollama discovery for standalone Jury-rig Tool2Vec profiles. */

import { spawn } from 'node:child_process';
import { createLLMClient, ollamaAdapter } from './llm-call.js';
import type { SkillGraftRuntime } from './skill-graft-runtime.js';
import type { SkillEmbedder } from './shipwright/skill-index.js';

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const EMBEDDER_PREFERENCE = ['qwen3-embedding:8b', 'nomic-embed-text:latest'] as const;
const GENERATOR_PREFERENCE = [
  'qwen3.5:latest',
  'gemma4:latest',
  'hermes4:14b',
  'qwen2.5-coder:14b',
  'llama3.1:8b',
  'qwen2.5-coder:7b',
] as const;

interface OllamaTag {
  name?: unknown;
  model?: unknown;
  digest?: unknown;
}

export interface LocalOllamaModel {
  name: string;
  digest: string;
}

export interface LocalTool2VecRuntime {
  runtime: SkillGraftRuntime;
  embedder: SkillEmbedder & { modelId: string };
  baseUrl: string;
  embedderModel: LocalOllamaModel;
  generatorModel: LocalOllamaModel;
}

interface DiscoveryOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  onWarning?: (message: string) => void;
  startServer?: () => void | Promise<void>;
}

function normalizedDigest(value: string): string {
  return value.replace(/^sha256:/i, '').toLowerCase();
}

export function exactOllamaModelId(model: LocalOllamaModel): string {
  return `ollama:${model.name}@sha256:${normalizedDigest(model.digest)}`;
}

export function parseExactOllamaModelId(modelId: string): LocalOllamaModel | null {
  const match = /^ollama:(.+)@sha256:([a-f0-9]{32,})$/i.exec(modelId);
  return match ? { name: match[1], digest: normalizedDigest(match[2]) } : null;
}

function loopbackBaseUrl(env: NodeJS.ProcessEnv): string | null {
  const raw = env.OLLAMA_HOST?.trim() || DEFAULT_OLLAMA_URL;
  try {
    const parsed = new URL(raw.includes('://') ? raw : `http://${raw}`);
    const loopback = parsed.hostname === 'localhost'
      || parsed.hostname === '127.0.0.1'
      || parsed.hostname === '::1'
      || parsed.hostname === '[::1]';
    if (!loopback || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) return null;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

async function fetchInstalledModels(
  baseUrl: string,
  options: DiscoveryOptions,
): Promise<LocalOllamaModel[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 2_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(`${baseUrl}/api/tags`, { signal: controller.signal });
    if (!response.ok) return null;
    const body = await response.json() as { models?: OllamaTag[] };
    const models: LocalOllamaModel[] = [];
    for (const row of body.models ?? []) {
      const name = typeof row.name === 'string' ? row.name : typeof row.model === 'string' ? row.model : '';
      const digest = typeof row.digest === 'string' ? normalizedDigest(row.digest) : '';
      if (name && /^[a-f0-9]{32,}$/i.test(digest)) models.push({ name, digest });
    }
    return models;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function startLocalOllama(env: NodeJS.ProcessEnv): void {
  const child = spawn('ollama', ['serve'], {
    detached: true,
    stdio: 'ignore',
    env,
  });
  child.on('error', () => undefined);
  child.unref();
}

async function installedModels(
  options: DiscoveryOptions = {},
  allowServerStart = false,
): Promise<{ baseUrl: string; models: LocalOllamaModel[] } | null> {
  const env = options.env ?? process.env;
  const baseUrl = loopbackBaseUrl(env);
  if (!baseUrl) {
    options.onWarning?.('jury-rig: automatic Tool2Vec warming rejected a non-loopback OLLAMA_HOST');
    return null;
  }
  let models = await fetchInstalledModels(baseUrl, options);
  if (models) return { baseUrl, models };
  if (!allowServerStart) return null;

  try {
    await (options.startServer ?? (() => startLocalOllama({ ...env, OLLAMA_HOST: baseUrl })))();
  } catch {
    return null;
  }
  for (const delayMs of [100, 250, 500, 1_000, 1_000]) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    models = await fetchInstalledModels(baseUrl, { ...options, timeoutMs: Math.min(options.timeoutMs ?? 2_000, 500) });
    if (models) return { baseUrl, models };
  }
  return null;
}

function selectModel(
  models: readonly LocalOllamaModel[],
  override: string | undefined,
  preference: readonly string[],
): LocalOllamaModel | null {
  if (override?.trim()) return models.find((model) => model.name === override.trim()) ?? null;
  for (const name of preference) {
    const found = models.find((model) => model.name === name);
    if (found) return found;
  }
  return null;
}

function normalize(vector: unknown): number[] {
  if (!Array.isArray(vector) || vector.length === 0 || vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error('Ollama returned a malformed embedding vector');
  }
  const magnitude = Math.sqrt(vector.reduce((sum: number, value: number) => sum + value * value, 0));
  if (!Number.isFinite(magnitude) || magnitude === 0) throw new Error('Ollama returned a zero embedding vector');
  return vector.map((value: number) => value / magnitude);
}

export function createOllamaSkillEmbedder(
  model: LocalOllamaModel,
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): SkillEmbedder & { modelId: string } {
  return {
    modelId: exactOllamaModelId(model),
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const response = await fetchImpl(`${baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.name, input: texts }),
      });
      if (!response.ok) throw new Error(`Ollama embedding request failed with HTTP ${response.status}`);
      const body = await response.json() as { embeddings?: unknown[] };
      if (!Array.isArray(body.embeddings) || body.embeddings.length !== texts.length) {
        throw new Error(`Ollama returned ${body.embeddings?.length ?? 0} embeddings for ${texts.length} inputs`);
      }
      const vectors = body.embeddings.map(normalize);
      const dimensions = vectors[0]?.length;
      if (!dimensions || vectors.some((vector) => vector.length !== dimensions)) {
        throw new Error('Ollama returned inconsistent embedding dimensions');
      }
      return vectors;
    },
  };
}

/** Discover the strongest installed loopback-only embedding/generator pair. */
export async function resolveLocalTool2VecRuntime(options: DiscoveryOptions = {}): Promise<LocalTool2VecRuntime | null> {
  const discovered = await installedModels(options, true);
  if (!discovered) return null;
  const env = options.env ?? process.env;
  const embedderModel = selectModel(
    discovered.models,
    env.PD_JURY_RIG_OLLAMA_EMBED_MODEL,
    EMBEDDER_PREFERENCE,
  );
  const generatorModel = selectModel(
    discovered.models,
    env.PD_JURY_RIG_OLLAMA_GENERATOR_MODEL,
    GENERATOR_PREFERENCE,
  );
  if (!embedderModel || !generatorModel) {
    options.onWarning?.('jury-rig: loopback Ollama has no compatible installed Tool2Vec embedding/generator pair');
    return null;
  }
  const ollamaEnv = { ...env, OLLAMA_HOST: discovered.baseUrl };
  return {
    baseUrl: discovered.baseUrl,
    embedderModel,
    generatorModel,
    embedder: createOllamaSkillEmbedder(embedderModel, discovered.baseUrl, options.fetchImpl),
    runtime: {
      backend: 'ollama',
      model: generatorModel.name,
      generatorId: exactOllamaModelId(generatorModel),
      client: createLLMClient({
        adapter: ollamaAdapter,
        model: generatorModel.name,
        timeoutMs: 90_000,
        callsPerMinute: 30,
        env: ollamaEnv,
      }),
    },
  };
}

/** Re-open an exact cached Ollama embedding space only when its digest still matches. */
export async function resolveOllamaEmbedderForProfile(
  modelId: string,
  options: DiscoveryOptions = {},
): Promise<(SkillEmbedder & { modelId: string }) | null> {
  const expected = parseExactOllamaModelId(modelId);
  if (!expected) return null;
  const discovered = await installedModels(options);
  if (!discovered) return null;
  const installed = discovered.models.find((model) => (
    model.name === expected.name && normalizedDigest(model.digest) === normalizedDigest(expected.digest)
  ));
  return installed
    ? createOllamaSkillEmbedder(installed, discovered.baseUrl, options.fetchImpl)
    : null;
}
