import { useEffect } from 'react'
import {
  absoluteImageUrl,
  canonicalUrlForRoute,
  structuredDataForRoute,
  type SiteMetadata,
} from '@/data/siteMetadata'

/**
 * Keeps route-level metadata aligned after React Router navigation.
 * Missing tags are created so new routes do not depend on index.html coverage.
 */
export function useDocumentMeta(route: SiteMetadata) {
  useEffect(() => {
    document.title = route.title

    setMeta('name', 'description', route.description)
    setMeta('property', 'og:site_name', 'Port Daddy')
    setMeta('property', 'og:type', route.section === 'blog' && route.publishedAt ? 'article' : 'website')
    setMeta('property', 'og:url', canonicalUrlForRoute(route))
    setMeta('property', 'og:title', route.title)
    setMeta('property', 'og:description', route.description)
    setMeta('property', 'og:image', absoluteImageUrl(route.image))
    setMeta('property', 'og:image:width', '1200')
    setMeta('property', 'og:image:height', '630')
    setMeta('name', 'twitter:card', 'summary_large_image')
    setMeta('name', 'twitter:url', canonicalUrlForRoute(route))
    setMeta('name', 'twitter:title', route.title)
    setMeta('name', 'twitter:description', route.description)
    setMeta('name', 'twitter:image', absoluteImageUrl(route.image))
    setMeta('property', 'twitter:card', 'summary_large_image')
    setMeta('property', 'twitter:url', canonicalUrlForRoute(route))
    setMeta('property', 'twitter:title', route.title)
    setMeta('property', 'twitter:description', route.description)
    setMeta('property', 'twitter:image', absoluteImageUrl(route.image))

    setOptionalMeta('property', 'article:published_time', route.publishedAt)
    setOptionalMeta('property', 'article:author', route.author)
    setTagList('article:tag', route.tags)
    setCanonical(canonicalUrlForRoute(route))
    setRobots(route.index === false ? 'noindex,follow' : 'index,follow')
    setStructuredData(route)
  }, [route])
}

function setMeta(attribute: 'name' | 'property', key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`)

  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.append(element)
  }

  element.setAttribute('content', content)
}

function setOptionalMeta(attribute: 'name' | 'property', key: string, content?: string) {
  const element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`)

  if (!content) {
    element?.remove()
    return
  }

  setMeta(attribute, key, content)
}

function setTagList(property: string, values?: string[]) {
  document.head.querySelectorAll<HTMLMetaElement>(`meta[property="${property}"]`).forEach((tag) => tag.remove())

  for (const value of values ?? []) {
    const element = document.createElement('meta')
    element.setAttribute('property', property)
    element.setAttribute('content', value)
    document.head.append(element)
  }
}

function setCanonical(href: string) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')

  if (!element) {
    element = document.createElement('link')
    element.setAttribute('rel', 'canonical')
    document.head.append(element)
  }

  element.setAttribute('href', href)
}

function setRobots(content: string) {
  setMeta('name', 'robots', content)
}

function setStructuredData(route: SiteMetadata) {
  let element = document.head.querySelector<HTMLScriptElement>('script[data-site-metadata="json-ld"]')

  if (!element) {
    element = document.createElement('script')
    element.type = 'application/ld+json'
    element.dataset.siteMetadata = 'json-ld'
    document.head.append(element)
  }

  element.textContent = JSON.stringify(structuredDataForRoute(route))
}
