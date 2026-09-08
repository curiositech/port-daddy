#!/usr/bin/env bun

import {
  resolveDbIntegrityHelperInvocation,
  runDbIntegrityHelper,
} from '../lib/db-integrity-entrypoint.js';

const dbIntegrityHelper = resolveDbIntegrityHelperInvocation(process.argv);
if (dbIntegrityHelper) {
  await runDbIntegrityHelper(dbIntegrityHelper);
} else if (process.argv[2] === '__semantic-runtime-check') {
  const { ensureOnnxRuntimeNativeLibFindable } = await import('../lib/semantic-resolver.js');
  ensureOnnxRuntimeNativeLibFindable();
  const runtime = await import('onnxruntime-node');
  const backends = typeof runtime.listSupportedBackends === 'function'
    ? runtime.listSupportedBackends()
    : [];
  process.stdout.write(`${JSON.stringify({ success: true, backends })}\n`);
} else {
  await import('../server.js');
}
