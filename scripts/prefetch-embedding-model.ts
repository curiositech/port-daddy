#!/usr/bin/env tsx
/**
 * prefetch-embedding-model — download the local embedding model on first install.
 *
 * Port Daddy's semantic resolver + LLM semantic cache use a LOCAL embedding model
 * (`Xenova/all-MiniLM-L6-v2`, ~27 MB) loaded lazily via transformers.js. Lazy means
 * the FIRST semantic operation blocks on a network download — and if the box is
 * offline at that moment, the operation stalls. So we fetch it at install time into
 * the stable shared cache (`defaultTransformersCacheDir()`), the same dir the daemon
 * + resolver read from. (ADR-0061.)
 *
 * Idempotent: skips instantly if the model is already cached. Best-effort: if the
 * download fails (offline during install), it warns and exits 0 — the install must
 * not break, and the runtime will still lazily fetch on first use when a network is
 * available.
 *
 * Usage:
 *   tsx scripts/prefetch-embedding-model.ts                 # into the default cache
 *   tsx scripts/prefetch-embedding-model.ts --cache-dir DIR # override
 */

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SEMANTIC_MODEL_ID, defaultTransformersCacheDir } from '../lib/semantic-resolver.js';

function parseCacheDir(): string {
  const i = process.argv.indexOf('--cache-dir');
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return defaultTransformersCacheDir();
}

/** Cached if the model's directory exists under the cache and is non-empty. */
function isCached(cacheDir: string, modelId: string): boolean {
  // transformers.js lays the model out as <cacheDir>/<org>/<model>/...
  const modelDir = join(cacheDir, ...modelId.split('/'));
  try {
    return existsSync(modelDir) && readdirSync(modelDir).length > 0;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const cacheDir = parseCacheDir();
  const modelId = DEFAULT_SEMANTIC_MODEL_ID;

  if (isCached(cacheDir, modelId)) {
    console.log(`[prefetch] ${modelId} already cached at ${cacheDir} — skipping.`);
    return;
  }

  console.log(`[prefetch] downloading ${modelId} into ${cacheDir} …`);
  mkdirSync(cacheDir, { recursive: true });

  try {
    const { env, pipeline } = await import('@huggingface/transformers');
    env.cacheDir = cacheDir;
    env.useFSCache = true;
    env.allowRemoteModels = true;

    // Loading the pipeline downloads the artifacts; one tiny embed forces the
    // full model + tokenizer fetch so the runtime's first call is offline-safe.
    const extractor = await pipeline('feature-extraction', modelId);
    await extractor('warm', { pooling: 'mean', normalize: true });

    console.log(`[prefetch] done — ${modelId} cached at ${cacheDir}.`);
  } catch (err) {
    // Best-effort: never break the install. The runtime lazily fetches on first
    // use once a network is available.
    console.warn(
      `[prefetch] could not pre-download ${modelId} (${(err as Error).message}). ` +
        `Port Daddy will fetch it lazily on first semantic operation when online.`,
    );
  }
}

main().catch((err) => {
  // Even an unexpected failure must not fail the install.
  console.warn(`[prefetch] skipped: ${(err as Error).message}`);
});
