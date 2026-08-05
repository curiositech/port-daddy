import {
  fingerprintDiff,
  decodeFingerprint,
  decideRerun,
  withAuthoredTests,
  RE_AUTHOR_FILE_CHURN,
  RE_AUTHOR_SIZE_RATIO
} from '../src/purser-rerun';
import { ContractFingerprint } from '../src/purser-rerun';

describe('purser-rerun module', () => {
  describe('fingerprintDiff', () => {
    it('extracts changed files from a diff', () => {
      const diff = `diff --git a/file1.ts b/file1.ts
index 123..456 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,3 +1,3 @@
-const x = 1;
+const x = 2;
 const y = 3;

diff --git a/file2.ts b/file2.ts
index 789..012 100644
--- a/file2.ts
+++ b/file2.ts
@@ -1,2 +1,2 @@
-const a = 1;
+const a = 2;`
      
      const fp = fingerprintDiff(diff);
      expect(fp.files).toEqual(['file1.ts', 'file2.ts']);
      expect(fp.size).toBe(diff.length);
    });

    it('ignores /dev/null', () => {
      const diff = `diff --git a/file3.ts b/file3.ts
index 123..456 100644
--- a/file3.ts
+++ b/file3.ts
@@ -1,3 +0,0 @@
-const z = 1;
-const w = 2;
-const v = 3;`
      
      const fp = fingerprintDiff(diff);
      expect(fp.files).toEqual([]);
    });
  });

  describe('decodeFingerprint', () => {
    it('parses a valid fingerprint', () => {
      const body = `<!-- purser-contract-fingerprint: {"files":["file1.ts","file2.ts"],"size":123,"tests":["test1.ts","test2.ts"]} -->`;
      const fp = decodeFingerprint(body);
      expect(fp).toEqual({ files: ['file1.ts', 'file2.ts'], size: 123, tests: ['test1.ts', 'test2.ts'] });
    });

    it('returns null for invalid JSON', () => {
      const body = `<!-- purser-contract-fingerprint: {invalid} -->`;
      expect(decodeFingerprint(body)).toBeNull();
    });

    it('returns null for missing marker', () => {
      expect(decodeFingerprint('no fingerprint here')).toBeNull();
    });
  });

  describe('decideRerun', () => {
    const previous: ContractFingerprint = { files: ['file1.ts'], size: 100, tests: ['test1.ts'] };
    const current: ContractFingerprint = { files: ['file1.ts'], size: 400, tests: [] };

    it('reuses when file churn is below threshold', () => {
      const decision = decideRerun(previous, current, true);
      expect(decision.action).toBe('reuse');
    });

    it('reauthors when file churn exceeds threshold', () => {
      const current: ContractFingerprint = { files: ['file2.ts'], size: 100, tests: [] };
      const decision = decideRerun(previous, current, true);
      expect(decision.action).toBe('author');
    });

    it('reauthors on size ratio threshold', () => {
      const current: ContractFingerprint = { files: ['file1.ts'], size: 500, tests: [] };
      const decision = decideRerun(previous, current, true);
      expect(decision.action).toBe('author');
    });

    it('reauthors when previous files not readable', () => {
      const decision = decideRerun(previous, current, false);
      expect(decision.action).toBe('author');
    });
  });
});