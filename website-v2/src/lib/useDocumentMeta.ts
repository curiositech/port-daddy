import { useEffect } from 'react'

/**
 * Sets document title and OG meta tags for the current page.
 * Falls back to defaults from index.html when unmounted.
 */
export function useDocumentMeta({
  title,
  description,
}: {
  title?: string
  description?: string
}) {
  useEffect(() => {
    const prevTitle = document.title

    if (title) {
      const fullTitle = `${title} | Port Daddy`
      document.title = fullTitle
      document.querySelector('meta[property="og:title"]')?.setAttribute('content', fullTitle)
      document.querySelector('meta[property="twitter:title"]')?.setAttribute('content', fullTitle)
    }

    if (description) {
      document.querySelector('meta[name="description"]')?.setAttribute('content', description)
      document.querySelector('meta[property="og:description"]')?.setAttribute('content', description)
      document.querySelector('meta[property="twitter:description"]')?.setAttribute('content', description)
    }

    return () => {
      document.title = prevTitle
    }
  }, [title, description])
}
