import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Exercise the real daemon route that crosses Parser.init(), runtime WASM,
 * grammar WASM, AST extraction, and SQLite persistence. Health-only compiled
 * smoke tests do not reach any of those boundaries.
 */
export async function smokeTreeSitterRoute({ baseUrl, scratchRoot }) {
  mkdirSync(scratchRoot, { recursive: true });
  const sourcePath = join(scratchRoot, 'compiled-tree-sitter-smoke.ts');
  writeFileSync(sourcePath, 'export function compiledTreeSitterSmoke(): number { return 42; }\n');

  const parseResponse = await fetch(`${baseUrl}/symbols/parse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ files: [sourcePath] }),
  });
  const parseBody = await parseResponse.json().catch(() => null);
  if (
    !parseResponse.ok ||
    parseBody?.success !== true ||
    parseBody?.parsed !== 1 ||
    parseBody?.errors !== 0 ||
    !Number.isInteger(parseBody?.results?.[0]?.symbols) ||
    parseBody.results[0].symbols < 1
  ) {
    throw new Error(
      `compiled Tree-sitter parse smoke failed: HTTP ${parseResponse.status} ` +
      JSON.stringify(parseBody),
    );
  }

  const queryResponse = await fetch(
    `${baseUrl}/symbols?file=${encodeURIComponent(sourcePath)}`,
  );
  const queryBody = await queryResponse.json().catch(() => null);
  if (!queryResponse.ok || queryBody?.success !== true || queryBody?.count < 1) {
    throw new Error(
      `compiled Tree-sitter read-back smoke failed: HTTP ${queryResponse.status} ` +
      JSON.stringify(queryBody),
    );
  }

  return {
    sourcePath,
    parsed: parseBody.parsed,
    symbols: queryBody.count,
  };
}
