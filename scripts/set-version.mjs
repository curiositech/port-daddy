#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CORE = '(?:0|[1-9]\\d*)'
const IDENTIFIER = '(?:0|[1-9]\\d*|[A-Za-z-][0-9A-Za-z-]*)'
const BUILD_IDENTIFIER = '[0-9A-Za-z-]+'
const SEMVER = new RegExp(
  `^${CORE}\\.${CORE}\\.${CORE}(?:-${IDENTIFIER}(?:\\.${IDENTIFIER})*)?(?:\\+${BUILD_IDENTIFIER}(?:\\.${BUILD_IDENTIFIER})*)?$`,
)

export function setPackageVersion(root, requestedVersion) {
  const version = String(requestedVersion ?? '').trim().replace(/^v/, '')
  if (!SEMVER.test(version)) throw new Error(`invalid semantic version: ${requestedVersion}`)
  const packagePath = resolve(root, 'package.json')
  const lockPath = resolve(root, 'package-lock.json')
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
  const packageLock = JSON.parse(readFileSync(lockPath, 'utf8'))
  if (!packageLock.packages?.['']) throw new Error('package-lock.json is missing the root packages entry')

  packageJson.version = version
  packageLock.version = version
  packageLock.packages[''].version = version
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
  writeFileSync(lockPath, `${JSON.stringify(packageLock, null, 2)}\n`)
  return version
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const version = setPackageVersion(process.cwd(), process.argv[2])
    console.log(`package version source set to ${version}`)
    console.log('run: bun scripts/sync-version.ts')
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
