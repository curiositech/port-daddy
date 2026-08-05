export const DB_INTEGRITY_HELPER_COMMAND = '__db_integrity_check';

export interface DbIntegrityHelperInvocation {
  dbPath: string;
  commandArgIndex: 1 | 2;
}

/**
 * Resolve the hidden database-integrity entrypoint in both supported Bun shapes:
 *
 * - compiled binary: `[binary, __db_integrity_check, dbPath]`
 * - source script: `[bun, script, __db_integrity_check, dbPath]`
 *
 * Only the first command position in either shape is accepted. A later task or
 * prompt argument that happens to contain the sentinel must never switch modes.
 */
export function resolveDbIntegrityHelperInvocation(
  argv: readonly string[],
): DbIntegrityHelperInvocation | null {
  const commandArgIndex = argv[1] === DB_INTEGRITY_HELPER_COMMAND
    ? 1
    : argv[2] === DB_INTEGRITY_HELPER_COMMAND
      ? 2
      : null;
  if (commandArgIndex === null) return null;

  const dbPath = argv[commandArgIndex + 1];
  if (!dbPath) {
    throw new Error('database integrity helper requires a DB path');
  }
  return { dbPath, commandArgIndex };
}

/** Run the authorized read-only integrity helper and emit one JSON proof. */
export async function runDbIntegrityHelper(
  invocation: DbIntegrityHelperInvocation,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (env.PORT_DADDY_DB_INTEGRITY_CHILD !== '1') {
    throw new Error('database integrity helper requires an authorized DB path');
  }
  const { createDbIntegrityProof } = await import('./db-integrity.js');
  console.log(JSON.stringify(createDbIntegrityProof(invocation.dbPath)));
}
