#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import childProcess from 'node:child_process'
import { isAbsolute, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const { spawnSync } = childProcess

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`)
    options[arg.slice(2)] = value
    index += 1
  }
  return options
}

export function releaseArchivePaths(manifest, stagedDir) {
  if (!manifest || !Array.isArray(manifest.artifacts)) {
    throw new Error('release manifest must contain an artifacts array')
  }
  const stagedRoot = resolve(stagedDir)
  const paths = []
  const seen = new Set()
  for (const artifact of manifest.artifacts) {
    const stagedPath = String(artifact?.stagedPath ?? '')
    if (
      !stagedPath
      || isAbsolute(stagedPath)
      || stagedPath.includes('\\')
      || /[\0\r\n]/.test(stagedPath)
      || normalize(stagedPath) !== stagedPath
      || stagedPath === '.'
      || stagedPath === '..'
      || stagedPath.startsWith('../')
    ) {
      throw new Error(`unsafe stagedPath in release manifest: ${JSON.stringify(stagedPath)}`)
    }
    if (seen.has(stagedPath)) throw new Error(`duplicate stagedPath in release manifest: ${stagedPath}`)
    seen.add(stagedPath)
    const present = existsSync(resolve(stagedRoot, stagedPath))
    if (!present && artifact.required !== false) {
      throw new Error(`required release artifact is absent: ${stagedPath}`)
    }
    if (present) paths.push(stagedPath)
  }
  if (paths.length === 0) throw new Error('release manifest selected no staged artifacts')
  return paths
}

export function packageReleaseArtifacts({
  manifestPath,
  stagedDir,
  outPath,
  run = spawnSync,
}) {
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'))
  const stagedRoot = resolve(stagedDir)
  const archivePath = resolve(outPath)
  const paths = releaseArchivePaths(manifest, stagedRoot)
  const result = run('tar', ['-czf', archivePath, '-C', stagedRoot, '--', ...paths], {
    stdio: 'inherit',
    shell: false,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`tar failed with exit ${result.status}`)
  return { archivePath, stagedDir: stagedRoot, paths }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options.out) throw new Error('--out is required')
  const result = packageReleaseArtifacts({
    manifestPath: options.manifest ?? 'release-artifacts.json',
    stagedDir: options['staged-dir'] ?? 'dist',
    outPath: options.out,
  })
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
