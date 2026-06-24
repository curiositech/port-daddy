/**
 * A tiny module-level store that broadcasts whether the hero's big animated
 * brand mark is currently on screen. The Hero updates it from an
 * IntersectionObserver; the SiteHeader subscribes so it can hide the small,
 * now-redundant nav mark while the hero mark is visible.
 *
 * Deliberately dependency-free (no context provider needed) since exactly one
 * Hero exists at a time and the header lives above it in the tree.
 */

let heroLogoVisible = false
const listeners = new Set<(visible: boolean) => void>()

export function setHeroLogoVisible(visible: boolean): void {
  if (visible === heroLogoVisible) return
  heroLogoVisible = visible
  listeners.forEach((fn) => fn(heroLogoVisible))
}

export function getHeroLogoVisible(): boolean {
  return heroLogoVisible
}

export function subscribeHeroLogoVisible(fn: (visible: boolean) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
