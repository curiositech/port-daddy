/**
 * Fail-closed production database guard shared by every SQLite open path.
 *
 * Keep this module dependency-light so narrowly scoped read-only probes can
 * enforce the same test isolation as initDatabase() without importing the
 * schema initializer (or creating a db.ts <-> probe dependency cycle).
 */
import { dirname, resolve as resolvePath, sep } from 'node:path';
import { tmpdir } from 'node:os';

/** Detect whether the current process is running under a test runner. */
export function isTestContext(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.NODE_ENV === 'test' ||
    env.JEST_WORKER_ID !== undefined ||
    env.BUN_TEST !== undefined ||
    env.PD_TEST !== undefined
  );
}

/** True when `child` is `parent` itself or nested anywhere beneath it. */
function isPathUnder(child: string, parent: string): boolean {
  const c = resolvePath(child);
  const p = resolvePath(parent);
  if (c === p) return true;
  const prefix = p.endsWith(sep) ? p : p + sep;
  return c.startsWith(prefix);
}

/**
 * A resolved DB path is an allowed scratch target in a test context when it is:
 *   - an in-memory DB (':memory:')
 *   - exactly the path named by PORT_DADDY_TEST_DB, or nested beneath its dir
 *   - anywhere under the OS temp dir (os.tmpdir() / mkdtemp output)
 */
export function isAllowedTestDbPath(
  resolvedPath: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (resolvedPath === ':memory:' || resolvedPath === '') return true;

  const testDb = env.PORT_DADDY_TEST_DB;
  if (testDb) {
    if (resolvePath(resolvedPath) === resolvePath(testDb)) return true;
    if (isPathUnder(resolvedPath, dirname(testDb))) return true;
  }

  return isPathUnder(resolvedPath, tmpdir());
}

/** Refuse a non-scratch database before SQLite obtains a handle in tests. */
export function assertNotProdInTest(
  resolvedPath: string,
  ctx: { isTest: boolean; inMemory?: boolean },
): void {
  if (!ctx.isTest || ctx.inMemory || isAllowedTestDbPath(resolvedPath)) return;

  throw new Error(
    `[port-daddy] Refusing to open the production database from a test context.\n` +
      `  path: ${resolvedPath}\n` +
      `Tests must not touch the live registry. Set PORT_DADDY_TEST_DB to a ` +
      `throwaway path (e.g. one created with fs.mkdtempSync) or use ` +
      `createTestDb() from tests/setup-unit.js for an in-memory database.`,
  );
}
