import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Cloudflare Pages refuses to upload any single site asset of 25 MiB or more
 * (https://developers.cloudflare.com/pages/platform/limits/#file-size). That
 * limit is real, and this module exists to deal with it. What it must never do
 * again is *assert* that a given file trips the limit without measuring.
 *
 * WHAT WENT WRONG. This list used to hold exactly one entry,
 * `whitepaper/coordination-papers-mega-volume.pdf`, justified by the 25 MiB
 * limit. The file is 9,740,631 bytes — 9.29 MiB, 37% of the limit. It was
 * never too big. The consequence was not a build error but a silent hole in
 * production: `https://portdaddy.dev/whitepaper/coordination-papers-mega-volume.pdf`
 * answered HTTP 200 with `text/html`, 4,829 bytes — the SPA shell, byte-identical
 * to the response for a path that does not exist at all. A visitor following the
 * Book's own download link got a web page that looked like the site instead of a
 * PDF, and nothing in CI noticed, because the shell is a 200.
 *
 * Meanwhile `whitepaper/art/collected-volume/collected-treatise-inside-jacket.jpg`
 * — 12,641,454 bytes, 30% LARGER than the pruned PDF — was never on this list and
 * serves from production today as `image/jpeg` with its full `content-length`.
 * The deploy path handles multi-megabyte binaries fine. The list was the only
 * thing stopping the PDF.
 *
 * THE RULE NOW. Do not hand-maintain a list of files someone believes are too
 * big; measure. `oversizedPagesAssets()` walks the built `dist` and reports
 * anything that actually meets or exceeds the limit, and the CLI below FAILS the
 * build when it finds one. An oversized asset is a deploy that Cloudflare would
 * reject — that should stop the build loudly, not be quietly deleted behind the
 * operator's back, which is how a missing file survives in production for months.
 *
 * `PAGES_ONLY_EXCLUSIONS` stays as the deliberate escape hatch for an asset that
 * genuinely cannot ship on Pages and is served from somewhere else instead. It is
 * empty because nothing in the tree qualifies. Adding an entry means: the file is
 * measured over the limit (or is served from R2 / another origin on purpose), the
 * comment says which and cites the number, and the route that used to serve it
 * now points somewhere that answers.
 */
export const PAGES_ONLY_EXCLUSIONS = []

/** Cloudflare's per-asset ceiling for Pages, in bytes. */
export const PAGES_MAX_ASSET_BYTES = 25 * 1024 * 1024

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

/**
 * Every file at or above `PAGES_MAX_ASSET_BYTES`, as `{ path, bytes }` with
 * `path` relative to `distRoot` and POSIX-separated. Measured, never declared.
 */
export function oversizedPagesAssets(distRoot, limitBytes = PAGES_MAX_ASSET_BYTES) {
  const found = []
  if (!existsSync(distRoot)) return found
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolutePath = resolve(dir, entry.name)
      if (entry.isDirectory()) walk(absolutePath)
      else if (entry.isFile()) {
        const bytes = statSync(absolutePath).size
        if (bytes >= limitBytes) {
          found.push({ path: relative(distRoot, absolutePath).split('\\').join('/'), bytes })
        }
      }
    }
  }
  walk(distRoot)
  return found.sort((a, b) => b.bytes - a.bytes)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const distRoot = resolve(process.cwd(), 'dist')
  const removed = prunePagesOnlyAssets(distRoot)
  for (const path of removed) console.log(`Pages bundle: omitted ${path}`)

  const oversized = oversizedPagesAssets(distRoot)
  if (oversized.length > 0) {
    console.error(
      `Pages bundle: ${oversized.length} asset(s) meet or exceed Cloudflare's `
      + `${PAGES_MAX_ASSET_BYTES}-byte per-asset limit; the deploy would be rejected:`,
    )
    for (const { path, bytes } of oversized) {
      console.error(`  - ${path} (${bytes} bytes, ${(bytes / 1024 / 1024).toFixed(2)} MiB)`)
    }
    console.error(
      'Shrink the asset, or serve it from another origin and add it to '
      + 'PAGES_ONLY_EXCLUSIONS with the measured size in the comment.',
    )
    process.exit(1)
  }
  console.log(
    `Pages bundle: no asset meets the ${PAGES_MAX_ASSET_BYTES}-byte per-asset limit.`,
  )
}
