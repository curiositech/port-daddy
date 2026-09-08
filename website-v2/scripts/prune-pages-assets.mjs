import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PAGES_ONLY_EXCLUSIONS = [
  'whitepaper/coordination-papers-mega-volume.pdf',
]

/**
 * Cloudflare Pages rejects individual assets above 25 MiB
 * (https://developers.cloudflare.com/pages/platform/limits/#file-size). The
 * collected volume is deliberately kept full fidelity in the repository and
 * downloaded from its canonical raw URL; only the redundant copy in dist is
 * removed.
 */
export function prunePagesOnlyAssets(distRoot) {
  const removed = []
  for (const relativePath of PAGES_ONLY_EXCLUSIONS) {
    const absolutePath = resolve(distRoot, relativePath)
    if (!existsSync(absolutePath)) continue
    rmSync(absolutePath)
    removed.push(absolutePath)
  }
  return removed
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const removed = prunePagesOnlyAssets(resolve(process.cwd(), 'dist'))
  for (const path of removed) console.log(`Pages bundle: omitted ${path}`)
}
