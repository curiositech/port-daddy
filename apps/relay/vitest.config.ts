import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use standard Vitest (not Workers pool) for unit tests on pure logic.
    // Integration tests against real Workers runtime would use
    // @cloudflare/vitest-pool-workers — add a separate vitest.integration.ts for those.
    environment: 'node',
    // The second glob reaches OUTSIDE apps/relay on purpose. The purser writes
    // its adversarial tests to the repo-root `tests/purser/`, and the ones it
    // authors in vitest import relay source (`apps/relay/src/*`) — but vitest
    // is a dependency of apps/relay, not of the root package, so at their own
    // location those files could never resolve `vitest` and never ran. They sat
    // in the tree as decoration. Collecting them here runs them in the one
    // project that can actually load them, under the existing `relay-tests` CI
    // job — the same reasoning that job's own comment already makes about
    // fixtures asserted by only one of two suites.
    include: ['tests/**/*.test.ts', '../../tests/purser/**/*.test.js'],
    globals: false,
  },
  resolve: {
    conditions: ['workerd', 'browser', 'import', 'module', 'main'],
  },
});
