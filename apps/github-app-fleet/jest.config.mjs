/**
 * Self-contained Jest config for the github-app-fleet package.
 *
 * The repo root already ships a working jest + @swc/jest toolchain (ESM `.ts`
 * transform, `.js`-import → source mapping). This config reuses that toolchain
 * but scopes it to THIS package so the fleet's tests can run on their own
 * (`npm test` from apps/github-app-fleet) without dragging in the daemon's
 * unit/integration projects.
 *
 * `moduleDirectories` lists this package's own node_modules first so the
 * @octokit/* deps resolve here (they are not hoisted to the repo root).
 *
 * `modulePathIgnorePatterns` silences jest-haste-map "naming collision"
 * warnings caused by sibling git worktrees that contain a duplicate copy of
 * this package.json.
 *
 * (`.mjs` rather than `.cjs` because the repo .gitignore ignores `*.cjs`.)
 */
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  rootDir: __dirname,
  transform: {
    '^.+\\.(t|j)sx?$': [
      '@swc/jest',
      {
        jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
        module: { type: 'es6' },
      },
    ],
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleFileExtensions: ['js', 'mjs', 'ts', 'tsx', 'json'],
  // Map NodeNext-style `./foo.js` imports back to the `.ts` source.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  moduleDirectories: [
    'node_modules',
    `${__dirname}/node_modules`,
    `${__dirname}/../../node_modules`,
  ],
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  // Worktrees hold duplicate package.json copies; keep haste-map quiet.
  modulePathIgnorePatterns: ['<rootDir>/../../.claude/worktrees/'],
  testTimeout: 10000,
}
