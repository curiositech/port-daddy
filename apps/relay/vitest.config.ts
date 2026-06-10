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
    conditions: ['workerd', 'browser', 'import', 'module', 'main'],
  },
});
