import { SiteFooter } from '@/components/site/SiteFooter'

/**
 * Legacy public pages still import `Footer` directly.
 * Keep the wrapper for compatibility while the shared SiteFooter becomes the
 * single footer truth across the public site.
 */
export function Footer() {
  return <SiteFooter />
}
