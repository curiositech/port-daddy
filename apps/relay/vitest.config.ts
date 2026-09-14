import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use standard Vitest (not Workers pool) for unit tests on pure logic.
    // Integration tests against real Workers runtime would use
    // @cloudflare/vitest-pool-workers — add a separate vitest.integration.ts for those.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
  resolve: {
    // fleet-control-requeue deliberately imports the sibling Fleet Executor
    // source. Keep its YAML import rooted in this package so Vite applies the
    // Worker/browser export condition instead of rebundling YAML's node CJS
    // entry relative to a synthetic `apps/relay/yaml` module.
    dedupe: ['yaml'],
    alias: {
      '@cloudflare/sandbox': new URL('../fleet-executor/tests/stubs/cloudflare-sandbox.ts', import.meta.url).pathname,
    },
    conditions: ['workerd', 'browser', 'import', 'module', 'main'],
  },
});
