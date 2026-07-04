#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const extensionRoot = join(repoRoot, 'apps/pd-scout-extension')
const outputDir = join(repoRoot, 'website-v2/public/downloads')
const manifestPath = join(extensionRoot, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

const runtimeFiles = [
  'manifest.json',
  'background.js',
  'content-script.js',
  'popup.html',
  'popup.css',
  'popup.js',
]
const runtimeDirectories = ['assets/icons']
const packageName = `pd-scout-chrome-${manifest.version}.zip`
const packagePath = join(outputDir, packageName)
const checksumPath = `${packagePath}.sha256`
const packageManifestPath = join(outputDir, 'pd-scout-chrome-preview-manifest.json')

function assertExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${relative(repoRoot, path)}`)
  }
}

function copyIntoStage(stageDir, relativePath) {
  const source = join(extensionRoot, relativePath)
  const destination = join(stageDir, relativePath)
  assertExists(source, relativePath)
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, { recursive: true })
}

function referencedIconPaths() {
  const paths = new Set()
  for (const value of Object.values(manifest.icons || {})) {
    paths.add(value)
  }
  for (const value of Object.values(manifest.action?.default_icon || {})) {
    paths.add(value)
  }
  return [...paths]
}

assertExists(manifestPath, 'manifest.json')
for (const file of runtimeFiles) {
  assertExists(join(extensionRoot, file), file)
}
for (const directory of runtimeDirectories) {
  assertExists(join(extensionRoot, directory), directory)
}
for (const iconPath of referencedIconPaths()) {
  assertExists(join(extensionRoot, iconPath), `manifest icon ${iconPath}`)
}
assertExists(join(extensionRoot, manifest.background?.service_worker || ''), 'background service worker')
assertExists(join(extensionRoot, manifest.action?.default_popup || ''), 'action popup')

mkdirSync(outputDir, { recursive: true })
rmSync(packagePath, { force: true })
rmSync(checksumPath, { force: true })
rmSync(packageManifestPath, { force: true })

const stageDir = mkdtempSync(join(tmpdir(), 'pd-scout-chrome-'))
try {
  for (const file of runtimeFiles) {
    copyIntoStage(stageDir, file)
  }
  for (const directory of runtimeDirectories) {
    copyIntoStage(stageDir, directory)
  }

  const zipResult = spawnSync('zip', ['-X', '-q', '-r', packagePath, '.'], {
    cwd: stageDir,
    stdio: 'inherit',
  })
  if (zipResult.error) {
    throw zipResult.error
  }
  if (zipResult.status !== 0) {
    throw new Error(`zip exited with status ${zipResult.status}`)
  }
} finally {
  rmSync(stageDir, { recursive: true, force: true })
}

const packageBuffer = readFileSync(packagePath)
const sha256 = createHash('sha256').update(packageBuffer).digest('hex')
writeFileSync(checksumPath, `${sha256}  ${packageName}\n`)

const packageManifest = {
  name: manifest.name,
  shortName: manifest.short_name,
  version: manifest.version,
  versionName: manifest.version_name,
  description: manifest.description,
  package: `/downloads/${packageName}`,
  sha256,
  sizeBytes: statSync(packagePath).size,
  source: 'apps/pd-scout-extension',
  runtimeFiles,
  runtimeDirectories,
  storeListingAssets: [
    'apps/pd-scout-extension/assets/store/scout-store-icon-128.png',
    'apps/pd-scout-extension/assets/store/scout-small-promo-440x280.png',
    'apps/pd-scout-extension/assets/store/scout-marquee-promo-1400x560.png',
    'apps/pd-scout-extension/assets/store/scout-screenshot-1280x800.png',
  ],
  localPreviewInstall:
    'Unzip the package and load the extracted directory from chrome://extensions with Developer mode enabled.',
  chromeWebStoreUpload:
    'Upload this ZIP in the Chrome Web Store Developer Dashboard; the public signed install starts after store review.',
}
writeFileSync(packageManifestPath, `${JSON.stringify(packageManifest, null, 2)}\n`)

console.log(`Packaged ${manifest.name} ${manifest.version}`)
console.log(relative(repoRoot, packagePath))
console.log(`${sha256}  ${packageName}`)
