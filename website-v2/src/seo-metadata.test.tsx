// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  absoluteImageUrl,
  absoluteUrl,
  canonicalUrlForRoute,
  DEFAULT_SITE_IMAGE,
  getRouteMetadata,
  isIndexableRoute,
  siteMetadataRoutes,
} from './data/siteMetadata'
import { blogPosts, deprecatedBlogPosts } from './data/blogData'
import { useDocumentMeta } from './lib/useDocumentMeta'

function read(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public')

function sitemapUrls() {
  return Array.from(read('../public/sitemap.xml').matchAll(/<loc>(.*?)<\/loc>/g), (match) => match[1])
}

function MetaProbe({ path }: { path: string }) {
  useDocumentMeta(getRouteMetadata(path))
  return null
}

afterEach(() => {
  cleanup()
  document.head.innerHTML = ''
})

describe('website SEO metadata', () => {
  test('canonical route registry has unique paths and indexable canonical URLs', () => {
    const paths = siteMetadataRoutes.map((route) => route.path)
    const canonicalUrls = siteMetadataRoutes.filter(isIndexableRoute).map(canonicalUrlForRoute)

    expect(new Set(paths).size).toBe(paths.length)
    expect(new Set(canonicalUrls).size).toBe(canonicalUrls.length)
    expect(canonicalUrls.every((url) => url.startsWith('https://portdaddy.dev/'))).toBe(true)
    expect(siteMetadataRoutes.every((route) => route.title.length >= 12)).toBe(true)
    expect(siteMetadataRoutes.every((route) => route.description.length >= 60)).toBe(true)
    expect(siteMetadataRoutes.every((route) => existsSync(resolve(publicDir, route.image.replace(/^\//, ''))))).toBe(true)
  })

  test('blog posts have route metadata, absolute social images, and article fields', () => {
    for (const post of blogPosts) {
      const route = getRouteMetadata(`/blog/${post.slug}`)

      expect(route.section).toBe('blog')
      expect(route.title).toContain(post.title)
      expect(route.description).toBe(post.excerpt)
      expect(route.image).toBe(post.heroImage)
      expect(existsSync(resolve(publicDir, post.heroImage.replace(/^\//, '')))).toBe(true)
      expect(route.publishedAt).toBe(post.date)
      expect(route.author).toBe(post.author)
      expect(absoluteImageUrl(route.image)).toMatch(/^https:\/\/portdaddy\.dev\/img\//)
      expect(new Date(post.date).getTime()).toBeLessThanOrEqual(new Date('2026-04-29T23:59:59-07:00').getTime())
    }
  })

  test('deprecated blog posts noindex and canonicalize to current replacements', () => {
    const slugs = new Set(blogPosts.map((post) => post.slug))

    for (const post of deprecatedBlogPosts) {
      const route = getRouteMetadata(`/blog/${post.slug}`)

      expect(slugs.has(post.replacementSlug)).toBe(true)
      expect(route.index).toBe(false)
      expect(route.canonicalPath).toBe(`/blog/${post.replacementSlug}`)
      expect(canonicalUrlForRoute(route)).toBe(`https://portdaddy.dev/blog/${post.replacementSlug}`)
    }
  })

  test('default social image is generated and does not fall back to the retired legacy hero', () => {
    const manifestPath = resolve(publicDir, 'img/generated/manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const generatedFiles = manifest.generatedAssets.map((asset: { file: string }) => asset.file)

    expect(DEFAULT_SITE_IMAGE).toBe('/img/generated/control-plane-og.jpg')
    expect(generatedFiles).toContain(DEFAULT_SITE_IMAGE)
    expect(existsSync(resolve(publicDir, 'img/hero-portdaddy.png'))).toBe(false)
  })

  test('generated sitemap and robots.txt are derived from indexable metadata routes', () => {
    const expectedUrls = siteMetadataRoutes.filter(isIndexableRoute).map(canonicalUrlForRoute).sort()
    const robots = read('../public/robots.txt')

    expect(sitemapUrls().sort()).toEqual(expectedUrls)
    expect(read('../public/sitemap.xml')).not.toContain('<changefreq>')
    expect(read('../public/sitemap.xml')).not.toContain('<priority>')
    expect(robots).toContain('User-agent: *')
    expect(robots).toContain(`Sitemap: ${absoluteUrl('/sitemap.xml')}`)
  })

  test('LLM discovery file exposes canonical product and docs entrypoints', () => {
    const llms = read('../public/llms.txt')

    expect(llms).toContain('# Port Daddy Docs for LLMs')
    expect(llms).toContain('[Docs Overview - Port Daddy](https://portdaddy.dev/docs)')
    expect(llms).toContain('[MCP Server for AI Agents - Port Daddy](https://portdaddy.dev/mcp)')
    expect(llms).toContain('[API Reference - Port Daddy](https://portdaddy.dev/docs/api)')
    expect(llms).toContain('Sitemap: https://portdaddy.dev/sitemap.xml')
  })

  test('SPA document metadata updates canonical, social, robots, and article tags', async () => {
    render(<MetaProbe path="/blog/control-plane-is-the-product" />)

    await waitFor(() => {
      expect(document.title).toContain('The Control Plane Is the Product')
    })

    expect(document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content).toContain('FleetBar opens the real Fleet Control Center')
    expect(document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href).toBe('https://portdaddy.dev/blog/control-plane-is-the-product')
    expect(document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content).toBe('https://portdaddy.dev/img/generated/blog-control-plane-product.jpg')
    expect(document.querySelector<HTMLMetaElement>('meta[name="twitter:image"]')?.content).toBe('https://portdaddy.dev/img/generated/blog-control-plane-product.jpg')
    expect(document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content).toBe('index,follow')
    expect(document.querySelector<HTMLMetaElement>('meta[property="article:published_time"]')?.content).toBe('2026-04-29')
    expect(document.querySelectorAll('meta[property="article:tag"]').length).toBeGreaterThan(0)
    expect(document.querySelector<HTMLScriptElement>('script[data-site-metadata="json-ld"]')?.textContent).toContain('"@type":"Article"')
  })

  test('unknown docs aliases fall back to noindex canonical docs metadata', () => {
    const route = getRouteMetadata('/docs/not-a-real-section')

    expect(route.index).toBe(false)
    expect(route.canonicalPath).toBe('/docs')
    expect(canonicalUrlForRoute(route)).toBe('https://portdaddy.dev/docs')
  })
})
