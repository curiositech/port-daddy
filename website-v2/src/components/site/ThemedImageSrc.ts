/**
 * Derive a dark-mode sibling:
 *   /img/manifesto/collision.webp -> /img/manifesto/collision-dark.webp
 *   /img/app-screens/resources-light.webp -> /img/app-screens/resources-dark.webp
 * Query strings and hashes (if any) are preserved after the extension.
 */
export function toDarkSrc(src: string): string {
  const [path, ...suffixParts] = src.split(/(?=[?#])/)
  const suffix = suffixParts.join('')
  const dot = path.lastIndexOf('.')
  if (dot <= path.lastIndexOf('/')) return src // no extension — leave untouched
  const stem = path.slice(0, dot)
  if (stem.endsWith('-light')) {
    return `${stem.slice(0, -'-light'.length)}-dark${path.slice(dot)}${suffix}`
  }
  return `${path.slice(0, dot)}-dark${path.slice(dot)}${suffix}`
}
