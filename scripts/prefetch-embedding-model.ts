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
 * not break. Running this script IS the explicit download consent; the runtime
 * itself never fetches from huggingface.co unless the operator sets
 * `PORT_DADDY_ALLOW_MODEL_DOWNLOAD=1` (it degrades to the lexical path instead).
 *
 * Usage:
 *   tsx scripts/prefetch-embedding-model.ts                 # into the default cache
 *   tsx scripts/prefetch-embedding-model.ts --cache-dir DIR # override
 */

import {
  DEFAULT_SEMANTIC_MODEL_ID,
  createLocalTextEmbedder,
  defaultTransformersCacheDir,
  isEmbeddingModelCached,
} from '../lib/semantic-resolver.js';

/**
 * Resolve the cache directory to prefetch into.
 *
 * Why: the purpose of the prefetch is to warm the SAME cache the daemon reads
 * (ADR-0061), so the default is `defaultTransformersCacheDir()`; `--cache-dir`
 * exists for tests and non-standard installs.
 *
 * @returns The absolute cache directory the model artifacts land in.
 */
function parseCacheDir(): string {
  const i = process.argv.indexOf('--cache-dir');
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return defaultTransformersCacheDir();
}

/**
 * Download the embedding model into the shared cache, idempotently.
 *
 * Design/motivation: running this script is the operator's explicit consent to
 * a huggingface.co download, which is why it may set `allowRemoteModels = true`
 * while the runtime defaults to no egress. Skips instantly when cached; warns
 * and exits 0 on failure so an offline install never breaks.
 *
 * @returns Resolves when the prefetch has completed, been skipped, or warned.
 */
async function main(): Promise<void> {
  const cacheDir = parseCacheDir();
  const modelId = DEFAULT_SEMANTIC_MODEL_ID;

  if (isEmbeddingModelCached(cacheDir, modelId)) {
    console.log(`[prefetch] ${modelId} already cached at ${cacheDir} — skipping.`);
    return;
  }

  console.log(`[prefetch] downloading ${modelId} into ${cacheDir} …`);

  try {
    // This command is explicit download consent. Reuse the production loader
    // so a successful prefetch also proves exact artifact/runtime/output
    // conformance instead of warming a parallel, unchecked pipeline.
    const embedder = createLocalTextEmbedder('pd.setup.embedding-prefetch', {
      cacheDir,
      allowRemoteModelDownload: true,
    });
    await embedder.embed(['warm']);

    console.log(`[prefetch] done — ${modelId} cached at ${cacheDir}.`);
  } catch (err) {
    // Best-effort: never break the install. Without the cached model the runtime
    // stays local-only and degrades to lexical retrieval; re-run this script when
    // online (or set PORT_DADDY_ALLOW_MODEL_DOWNLOAD=1 for a runtime download).
    console.warn(
      `[prefetch] could not pre-download ${modelId} (${(err as Error).message}). ` +
        `Semantic retrieval will run degraded (lexical fallback) until this script is ` +
        `re-run online or PORT_DADDY_ALLOW_MODEL_DOWNLOAD=1 is set.`,
    );
  }
}

main().catch((err) => {
  // Even an unexpected failure must not fail the install.
  console.warn(`[prefetch] skipped: ${(err as Error).message}`);
});
