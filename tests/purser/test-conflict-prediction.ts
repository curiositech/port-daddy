import { describe, it, expect, beforeEach } from 'vitest';
import { runMediatorScan, computeTotals } from '../src/mediator';
import { parseFleetMediator } from '../src/fleet';

interface TestPR {
  number: number;
  files: Array<{ filename: string; patch: string }>;
}

const mockPRs: TestPR[] = [
  {
    number: 1,
    files: [
      { filename: 'file1.ts', patch: '--- a/file1.ts
+++ b/file1.ts
@@ -1,3 +1,3 @@
-export function foo() {}
+export function foo() { return 42; }' },
    ],
  },
  {
    number: 2,
    files: [
      { filename: 'file1.ts', patch: '--- a/file1.ts
+++ b/file1.ts
@@ -1,3 +1,3 @@
-export function foo() {}
+export function foo() { return 42; }' },
    ],
  },
];

const mockConfig = { enabled: true, harbor: 'test/harbor', action: 'merge', daemons: {} };

beforeEach(() => {
  // Reset any global state
});

describe('Conflict Prediction', () => {
  it('fires at exactly 0.7 confidence', async () => {
    const results = await runMediatorScan({} as any, {
      repo: 'test/repo',
      deliveredPr: 1,
      config: mockConfig,
      io: {
        env: {} as any,
        owner: 'test',
        repo: 'repo',
        token: 'token',
        listOpenPrs: async () => mockPRs,
        fetchPatches: async () => mockPRs[0].files,
        createCheckRun: () => Promise.resolve(),
        completeCheckRun: () => Promise.resolve(),
      },
    });
    expect(results.predictions[0].fired).toBe(true);
  });

  it('does NOT fire below 0.7 confidence', async () => {
    const results = await runMediatorScan({} as any, {
      repo: 'test/repo',
      deliveredPr: 1,
      config: mockConfig,
      io: {
        env: {} as any,
        owner: 'test',
        repo: 'repo',
        token: 'token',
        listOpenPrs: async () => mockPRs,
        fetchPatches: async () => mockPRs[0].files,
        createCheckRun: () => Promise.resolve(),
        completeCheckRun: () => Promise.resolve(),
      },
    });
    expect(results.predictions[0].fired).toBe(false);
  });

  it('handles different file types', async () => {
    const prs = [
      {
        number: 1,
        files: [{ filename: 'file1.py', patch: '--- a/file1.py
+++ b/file1.py
@@ -1,3 +1,3 @@
-def foo():
+def foo():
     return 42' }],
      },
      {
        number: 2,
        files: [{ filename: 'file1.py', patch: '--- a/file1.py
+++ b/file1.py
@@ -1,3 +1,3 @@
-def foo():
+def foo():
     return 42' }],
      },
    ];
    const results = await runMediatorScan({} as any, {
      repo: 'test/repo',
      deliveredPr: 1,
      config: mockConfig,
      io: {
        env: {} as any,
        owner: 'test',
        repo: 'repo',
        token: 'token',
        listOpenPrs: async () => prs,
        fetchPatches: async () => prs[0].files,
        createCheckRun: () => Promise.resolve(),
        completeCheckRun: () => Promise.resolve(),
      },
    });
    expect(results.predictions[0].fired).toBe(true);
  });
});