#!/usr/bin/env bun

import {
  resolveDbIntegrityHelperInvocation,
  runDbIntegrityHelper,
} from '../lib/db-integrity-entrypoint.js';

const dbIntegrityHelper = resolveDbIntegrityHelperInvocation(process.argv);
if (dbIntegrityHelper) {
  await runDbIntegrityHelper(dbIntegrityHelper);
} else {
  await import('../server.js');
}
