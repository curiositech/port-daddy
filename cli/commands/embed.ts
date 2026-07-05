/**
 * pd embed — the ONE local embedding surface for skills and matching code.
 *
 * Port Daddy standardizes on a single locally-cached embedding model
 * (`Xenova/all-MiniLM-L6-v2`, ~27 MB — ADR-0061) stored in the shared
 * transformers cache (`~/.port-daddy/transformers-cache`). Every skill,
 * script, or matcher that needs semantic similarity shells out to this
 * command instead of standing up its own model, so the download cost is
 * paid once and semantics stay consistent across surfaces. BM25-only search
 * is banned in skills/NLP code: lexical + this embedder, fused (hybrid).
 *
 * Subcommands:
 *   pd embed status                 Is the model cached? Where? (--json)
 *   pd embed prefetch               Download the model into the shared cache now
 *   pd embed text "a" "b" ...       Embed argument texts → JSON vectors
 *   pd embed stdin                  Embed one text per stdin line → JSON vectors
 *
 * Output contract (text/stdin):
 *   { "model": "Xenova/all-MiniLM-L6-v2", "dims": 384, "vectors": [[...], ...] }
 *
 * Vectors are mean-pooled and L2-normalized, so cosine similarity is a plain
 * dot product. Exit codes: 0 ok; 1 usage or embedding failure; 3 model not
 * cached — from `status` (scriptable presence check) and from `text`/`stdin`
 * under --offline (callers fall back to lexical-only and point the operator
 * at `pd doctor`).
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_SEMANTIC_MODEL_ID,
  createLocalEmbedder,
  defaultTransformersCacheDir,
} from '../../lib/semantic-resolver.js';
import type { CLIOptions } from '../types.js';
import * as ui from '../utils/ui.js';

/** Cached iff the model's directory exists under the cache and is non-empty. */
export function isEmbeddingModelCached(
  cacheDir: string = defaultTransformersCacheDir(),
  modelId: string = DEFAULT_SEMANTIC_MODEL_ID,
): boolean {
  const modelDir = join(cacheDir, ...modelId.split('/'));
  try {
    return existsSync(modelDir) && readdirSync(modelDir).length > 0;
  } catch {
    return false;
  }
}

/**
 * Download the model into the shared cache by embedding a probe string.
 * Idempotent: hits the FS cache instantly when already downloaded.
 */
export async function prefetchEmbeddingModel(
  cacheDir: string = defaultTransformersCacheDir(),
  modelId: string = DEFAULT_SEMANTIC_MODEL_ID,
): Promise<void> {
  const embedder = createLocalEmbedder({ cacheDir, modelId });
  await embedder.embed(['port daddy embedding model prefetch probe']);
}

async function readStdinLines(): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks)
    .toString('utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function embedTexts(texts: string[], options: CLIOptions): Promise<number> {
  const cacheDir = typeof options['cache-dir'] === 'string' ? options['cache-dir'] : defaultTransformersCacheDir();
  const cached = isEmbeddingModelCached(cacheDir);
  if (!cached && options.offline) {
    console.error(
      `embedding model ${DEFAULT_SEMANTIC_MODEL_ID} is not cached at ${cacheDir} ` +
      '(offline mode). Run: pd embed prefetch — or pd doctor to repair.',
    );
    return 3;
  }
  if (texts.length === 0) {
    console.error('nothing to embed (no non-empty texts)');
    return 1;
  }
  const embedder = createLocalEmbedder({ cacheDir });
  const vectors = await embedder.embed(texts);
  console.log(JSON.stringify({
    model: embedder.modelId,
    dims: vectors[0]?.length ?? 0,
    vectors,
  }));
  return 0;
}

export async function handleEmbed(args: string[], options: CLIOptions): Promise<void> {
  const sub = args[0] ?? 'status';
  const cacheDir = typeof options['cache-dir'] === 'string' ? options['cache-dir'] : defaultTransformersCacheDir();

  switch (sub) {
    case 'status': {
      const cached = isEmbeddingModelCached(cacheDir);
      if (options.json) {
        console.log(JSON.stringify({
          model: DEFAULT_SEMANTIC_MODEL_ID,
          cacheDir,
          cached,
        }));
      } else if (cached) {
        ui.success(`Embedding model ${DEFAULT_SEMANTIC_MODEL_ID} cached at ${cacheDir}`);
      } else {
        ui.warn(`Embedding model ${DEFAULT_SEMANTIC_MODEL_ID} NOT cached at ${cacheDir}`);
        ui.info('Run: pd embed prefetch   (one-time ~27 MB download)');
      }
      process.exitCode = cached ? 0 : 3;
      return;
    }

    case 'prefetch': {
      if (isEmbeddingModelCached(cacheDir)) {
        ui.success(`Embedding model already cached at ${cacheDir}`);
        return;
      }
      ui.step(`Downloading ${DEFAULT_SEMANTIC_MODEL_ID} (~27 MB, one-time) into ${cacheDir}`);
      try {
        await prefetchEmbeddingModel(cacheDir);
        ui.success('Embedding model ready');
      } catch (err: unknown) {
        ui.warn(`Download failed: ${(err as Error).message}`);
        ui.info('Retry later with: pd embed prefetch — semantic features fall back until then.');
        process.exitCode = 1;
      }
      return;
    }

    case 'text': {
      process.exitCode = await embedTexts(args.slice(1), options);
      return;
    }

    case 'stdin': {
      process.exitCode = await embedTexts(await readStdinLines(), options);
      return;
    }

    default: {
      console.error(
        'Usage: pd embed status [--json] | prefetch | text "..." ["..."] | stdin\n' +
        '       [--cache-dir DIR] [--offline]',
      );
      process.exitCode = 1;
    }
  }
}
