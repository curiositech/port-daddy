import { defineConfig } from 'vitest/config';

/**
 * Plain Node vitest. The executor relies only on Web Crypto (Node 20+ provides
 * `globalThis.crypto`), `fetch`, `atob`/`btoa`, and bindings (KV/AI), all of
 * which the tests stub directly. We do not boot miniflare/workerd: the goal is
 * fast, deterministic unit coverage of the REAL verdict + conclusion logic and
 * the zero-trust ref invariant, with GitHub + Workers AI mocked at the edges.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
