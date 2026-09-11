#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const testPath = fileURLToPath(new URL('../tests/harbor_clearance.test.mjs', import.meta.url))
const result = spawnSync(process.execPath, ['--test', testPath], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NO_PROXY: '*',
    no_proxy: '*',
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
    PORT_DADDY_OFFLINE_TEST: '1',
  },
})

if (result.error) throw result.error
process.exitCode = result.status ?? 1
