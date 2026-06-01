/** @type {import('@swc/jest').JestConfigWithTsJest} */
const swcTransform = {
  '^.+\\.tsx?$': ['@swc/jest', {
    jsc: {
      parser: { syntax: 'typescript', decorators: true, tsx: true },
      target: 'es2022',
      transform: { react: { runtime: 'automatic' } },
    },
    module: { type: 'es6' },
  }],
};

// Map .js imports to .ts files (NodeNext resolution for Jest)
const moduleNameMapper = {
  '^(\\.{1,2}/.*)\\.js$': '$1',
};

export default {
  testEnvironment: 'node',
  transform: {},
  moduleFileExtensions: ['js', 'mjs', 'ts', 'tsx'],
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  // Keep the overall worker pool serial. The integration project shares one
  // ephemeral daemon across files, and cross-project concurrency with the unit
  // pool was starving that daemon and producing suite-only flakes in `npm test`.
  maxWorkers: 1,
  // /tests/bun/ holds `bun:test` specs that import `bun:sqlite` — they run
  // under `npm run test:bun`, never under jest (jest can't load bun: modules).
  testPathIgnorePatterns: ['/node_modules/', '/tests/benchmark/', '/tests/bun/', '/dist/'],
  collectCoverageFrom: [
    'server.{js,ts}',
    'install-daemon.{js,ts}',
    'lib/**/*.{js,ts}',
    'shared/**/*.{js,ts}',
    'routes/**/*.{js,ts}',
    '!node_modules/**'
  ],
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    }
  },
  testTimeout: 10000,
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      transform: { ...swcTransform },
      moduleNameMapper,
      moduleFileExtensions: ['js', 'mjs', 'ts', 'tsx'],
      extensionsToTreatAsEsm: ['.ts', '.tsx'],
      testMatch: ['<rootDir>/tests/unit/**/*.test.{js,ts}'],
      setupFiles: ['<rootDir>/tests/jest.env.js'],
      setupFilesAfterEnv: [],
      testTimeout: 10000
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      transform: { ...swcTransform },
      moduleNameMapper,
      moduleFileExtensions: ['js', 'mjs', 'ts'],
      extensionsToTreatAsEsm: ['.ts'],
      testMatch: ['<rootDir>/tests/integration/**/*.test.{js,ts}'],
      globalSetup: '<rootDir>/tests/helpers/global-setup.js',
      globalTeardown: '<rootDir>/tests/helpers/global-teardown.js',
      setupFiles: ['<rootDir>/tests/jest.env.js'],
      setupFilesAfterEnv: [],
      testTimeout: 15000,
      // Integration tests share a single ephemeral daemon — must run serially
      maxWorkers: 1
    }
  ]
};
