#!/usr/bin/env bun

// Dedicated daemon entrypoint. Keep helper dispatch outside server.ts: ESM
// imports run before module bodies, so compiling server.ts directly makes a
// re-exec helper boot the daemon again before it can inspect argv.
const isDbIntegrityHelper = process.argv[2] === '__db_integrity_check';

if (isDbIntegrityHelper) {
  const dbPath = process.argv[3];
  if (!dbPath || process.env.PORT_DADDY_DB_INTEGRITY_CHILD !== '1') {
    throw new Error('database integrity helper requires an authorized DB path');
  }
  const { createDbIntegrityProof } = await import('../lib/db-integrity.js');
  console.log(JSON.stringify(createDbIntegrityProof(dbPath)));
} else {
  await import('../server.js');
}
