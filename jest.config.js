/** @type {import('@swc/jest').JestConfigWithTsJest} */
const swcTransform = {
  '^.+\\.tsx?$': ['@swc/jest', {
    jsc: {
      parser: { syntax: 'typescript', decorators: true },
      target: 'es2022',
    },
    module: { type: 'es6' },
  }],
};

export default {
  testEnvironment: 'node',
  transform: {},
  moduleFileExtensions: ['js', 'mjs', 'ts'],
  extensionsToTreatAsEsm: ['.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/tests/benchmark/', '/dist/'],
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
      moduleFileExtensions: ['js', 'mjs', 'ts'],
      extensionsToTreatAsEsm: ['.ts'],
      testMatch: ['<rootDir>/tests/unit/**/*.test.{js,ts}'],
      setupFilesAfterEnv: [],
      testTimeout: 10000
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      transform: { ...swcTransform },
      moduleFileExtensions: ['js', 'mjs', 'ts'],
      extensionsToTreatAsEsm: ['.ts'],
      testMatch: ['<rootDir>/tests/integration/**/*.test.{js,ts}'],
      globalSetup: '<rootDir>/tests/helpers/global-setup.js',
      globalTeardown: '<rootDir>/tests/helpers/global-teardown.js',
      setupFilesAfterEnv: [],
      testTimeout: 15000,
      // Integration tests share a single ephemeral daemon — must run serially
      maxWorkers: 1
    }
  ]
};
