#!/usr/bin/env tsx
/**
 * Manual end-to-end verification for lib/skill-graft.ts against the REAL
 * local MiniLM embedder and this repo's REAL skills/ directory.
 *
 * Why this is a standalone script and not a Jest test: the real
 * @huggingface/transformers pipeline (onnxruntime-node under the hood)
 * crashes when invoked from inside Jest's `--experimental-vm-modules` ESM
 * sandbox --
 *
 *   TypeError: A float32 tensor's data must be type of function Float32Array()
 *
 * -- a cross-realm TypedArray identity check failing inside Jest's VM
 * context, confirmed to be pre-existing and environment-specific (NOT a
 * skill-graft bug): the exact same embed() call succeeds cleanly when run
 * via plain `tsx`/`node` outside Jest. No existing test anywhere in this
 * repo exercises the real transformers.js pipeline under Jest either
 * (tests/unit/semantic-resolver.test.js and
 * tests/unit/shipwright-skill-index.test.js both inject a deterministic
 * mock embedder for exactly this reason) — this script is the honest
 * substitute: a real, runnable, repo-checked-in end-to-end proof that
 * doesn't fight Jest's sandbox.
 *
 * Run: npx tsx scripts/verify-skill-graft.ts
 */

import { createTool2VecStore } from '../lib/skill-graft-tool2vec.js';
import { createLocalEmbedder, defaultTransformersCacheDir } from '../lib/semantic-resolver.js';
import {
  createSkillGraftIndex,
  defaultSkillGraftRoots,
  renderSkillGraftContext,
} from '../lib/skill-graft.js';

/**
 * Local, deterministic stand-in for the real Haiku-backed synthetic-query
 * generator (`createLLMClientSyntheticQueryGenerator` in
 * `lib/skill-graft-tool2vec.ts`). This script's whole point is proving the
 * REAL embedder + REAL skills/ directory + REAL SQLite cache work end to
 * end without fighting Jest's sandbox — it deliberately does NOT require an
 * Anthropic/Cloudflare/Ollama API key to run, so any contributor can run it
 * with zero extra setup. The vocabulary-mismatch fix ITSELF (does a
 * differently-worded task match a differently-worded skill) is proven
 * precisely, with controlled inputs, by the Jest adversarial test in
 * tests/unit/skill-graft.test.js — this script only needs to prove the real
 * MiniLM pipeline produces real 384-dim centroids and real cosine scores
 * without crashing.
 */
function localSyntheticQueryGenerator(skill: { name: string; description: string; tags: string[] }, count: number): Promise<string[]> {
  const base = `${skill.name} ${skill.description} ${skill.tags.join(' ')}`.trim();
  return Promise.resolve(Array.from({ length: count }, (_, i) => `${base} — example task ${i}`));
}

async function main(): Promise<void> {
  const failures: string[] = [];
  const cacheDir = defaultTransformersCacheDir();
  const embedder = createLocalEmbedder({ cacheDir });

  console.log(`[verify-skill-graft] using real MiniLM embedder (cache: ${cacheDir})`);
  console.log('[verify-skill-graft] scanning real skills/ directory...');

  const graft = createSkillGraftIndex({
    roots: defaultSkillGraftRoots(process.cwd()),
    embedder,
    generateSyntheticQueries: localSyntheticQueryGenerator,
    centroidStore: createTool2VecStore({
      dbDir: process.env.PD_SKILL_GRAFT_VERIFY_DB_DIR,
      embedderModelId: embedder.modelId,
      generatorId: 'verify-script-local-generator',
    }),
  });

  const refreshStats = await graft.refresh();
  console.log(
    `[verify-skill-graft] scanned ${refreshStats.scannedCount} skills ` +
    `(embedded ${refreshStats.embedded}, reused ${refreshStats.reused}, removed ${refreshStats.removed})`,
  );
  if (refreshStats.scannedCount < 100) {
    failures.push(`expected 100+ real skills, scanned only ${refreshStats.scannedCount}`);
  }

  const query = 'choosing chunk size, hybrid BM25 plus dense retrieval with RRF fusion, ' +
    'and adding a cross-encoder reranker for a RAG pipeline';
  const result = await graft.craft(query, { shortlistLimit: 10, topLimit: 2 });
  const ids = result.shortlist.map((entry) => entry.id);
  const rank = ids.indexOf('rag-retrieval-pattern-design');

  console.log(`[verify-skill-graft] query: "${query}"`);
  console.log(`[verify-skill-graft] semanticTier: ${result.semanticTier} (BM25 + Tool2Vec fused via RRF)`);
  console.log(`[verify-skill-graft] shortlist: ${ids.join(', ')}`);
  if (result.semanticTier !== 'hybrid') {
    failures.push(`expected semanticTier 'hybrid' (a generator was configured) but got '${result.semanticTier}'`);
  }

  if (rank === -1) {
    failures.push('rag-retrieval-pattern-design did not appear in the shortlist at all');
  } else if (rank >= 3) {
    failures.push(`rag-retrieval-pattern-design ranked #${rank + 1}; expected top 3`);
  } else {
    console.log(`[verify-skill-graft] rag-retrieval-pattern-design ranked #${rank + 1} — OK`);
  }

  const topMatch = result.top.find((entry) => entry.id === 'rag-retrieval-pattern-design');
  if (topMatch) {
    if (!topMatch.body.includes('rag-retrieval-pattern-design') && !topMatch.body.includes('RAG Retrieval Pattern Design')) {
      failures.push('top match body did not include expected SKILL.md content');
    } else {
      console.log(`[verify-skill-graft] SKILL.md body attached to top match (${topMatch.body.length} chars) — OK`);
    }
    // rag-retrieval-pattern-design/SKILL.md is well over the default 8000-char
    // cap, so the default-config top[].body is EXPECTED to be truncated (that
    // cap is the fix for a real Copilot review finding: an uncapped body could
    // bloat a spawned ship's task). Verify the cap actually fired...
    if (!topMatch.body.includes('[truncated')) {
      failures.push('top match body was not truncated even though the real SKILL.md exceeds the default cap — the size cap may be broken');
    } else {
      console.log('[verify-skill-graft] default maxBodyChars cap correctly truncated the oversized real SKILL.md — OK');
    }
  }

  // ...and separately verify the FULL, uncapped content is still reachable via
  // getReference() (a distinct code path with no size cap), so "the cap
  // truncates top[].body" and "full content is still retrievable on demand"
  // are both proven, not just the first at the expense of the second.
  const fullSkillMd = graft.getReference('rag-retrieval-pattern-design', 'SKILL.md');
  if (!fullSkillMd.found || !fullSkillMd.content?.includes('Reciprocal Rank Fusion')) {
    failures.push('getReference() on SKILL.md itself did not return the full, uncapped content');
  } else {
    console.log(`[verify-skill-graft] getReference() returns the FULL uncapped SKILL.md (${fullSkillMd.content.length} chars) — OK`);
  }

  const ref = graft.getReference('rag-retrieval-pattern-design', 'scripts/rag_retrieval_pattern_design_audit.mjs');
  if (!ref.found || !ref.content) {
    failures.push(`getReference() failed to fetch a real reference file: ${ref.error ?? 'unknown error'}`);
  } else {
    console.log(`[verify-skill-graft] getReference() fetched ${ref.content.length} bytes — OK`);
  }

  const escapeAttempt = graft.getReference('rag-retrieval-pattern-design', '../../../../../../etc/passwd');
  if (escapeAttempt.found) {
    failures.push('getReference() did NOT refuse a path-traversal escape attempt — SECURITY BUG');
  } else {
    console.log('[verify-skill-graft] path-traversal escape correctly refused — OK');
  }

  const rendered = renderSkillGraftContext(result);
  if (!rendered.includes('rag-retrieval-pattern-design')) {
    failures.push('renderSkillGraftContext() output missing the expected skill id');
  } else {
    console.log('[verify-skill-graft] renderSkillGraftContext() rendering — OK');
    console.log('---');
    console.log(rendered.slice(0, 400) + (rendered.length > 400 ? '\n... (truncated)' : ''));
    console.log('---');
  }

  if (failures.length > 0) {
    console.error(`\n[verify-skill-graft] FAILED (${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log('\n[verify-skill-graft] ALL CHECKS PASSED — real embedder, real skills/ directory, real files.');
}

main().catch((err) => {
  console.error('[verify-skill-graft] crashed:', err);
  process.exitCode = 1;
});
