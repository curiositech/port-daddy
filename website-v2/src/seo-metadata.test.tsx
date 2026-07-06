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
  OG_SOURCE_IMAGES,
  ogImagePathForRoutePath,
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
    expect(siteMetadataRoutes.every((route) => existsSync(resolve(publicDir, route.ogSourceImage.replace(/^\//, ''))))).toBe(true)
  })

  test('indexable routes have branded route-level social cards', () => {
    const indexableRoutes = siteMetadataRoutes.filter(isIndexableRoute)
    const uniqueSocialImages = new Set(indexableRoutes.map((route) => route.image))

    expect(DEFAULT_SITE_IMAGE).toBe('/img/og/home.jpg')
    expect(uniqueSocialImages.size).toBe(indexableRoutes.length)
    expect(indexableRoutes.every((route) => route.image.startsWith('/img/og/'))).toBe(true)
    expect(indexableRoutes.every((route) => route.image === ogImagePathForRoutePath(route.path))).toBe(true)
  })

  test('blog posts have branded cards backed by their individual generated art', () => {
    for (const post of blogPosts) {
      const route = getRouteMetadata(`/blog/${post.slug}`)

      expect(route.section).toBe('blog')
      expect(route.title).toContain(post.title)
      expect(route.description).toBe(post.excerpt)
      expect(route.image).toBe(ogImagePathForRoutePath(`/blog/${post.slug}`))
      expect(route.ogSourceImage).toBe(post.heroImage)
      expect(existsSync(resolve(publicDir, route.image.replace(/^\//, '')))).toBe(true)
      expect(existsSync(resolve(publicDir, route.ogSourceImage.replace(/^\//, '')))).toBe(true)
      expect(route.publishedAt).toBe(post.date)
      expect(route.author).toBe(post.author)
      expect(absoluteImageUrl(route.image)).toMatch(/^https:\/\/portdaddy\.dev\/img\/og\//)
      expect(new Date(post.date).getTime()).toBeLessThanOrEqual(new Date('2026-06-29T23:59:59-07:00').getTime())
    }
  })

  test('example, tutorial, and docs pages carry subpage-specific social cards', () => {
    const example = getRouteMetadata('/examples/leader-election')
    const tutorial = getRouteMetadata('/tutorials/fleet')
    const docs = getRouteMetadata('/docs/cli/begin')

    expect(example.image).toBe('/img/og/examples-leader-election.jpg')
    expect(example.ogSourceImage).toBe('/img/generated/example-leader-election.jpg')
    expect(example.title).toContain('Elect one leader')
    expect(tutorial.image).toBe('/img/og/tutorials-fleet.jpg')
    expect(tutorial.ogSectionLabel).toBe('Tutorial 18')
    expect(docs.image).toBe('/img/og/docs-cli-begin.jpg')
    expect(docs.ogSourceImage).toBe(OG_SOURCE_IMAGES.controlPlane)
  })

  test('Tube, Relay PKI, and roadmap proof routes are indexable with generated route cards', () => {
    const routes = [
      {
        path: '/scout',
        image: '/img/og/scout.jpg',
        title: 'Port Daddy Scout',
        section: 'product',
        sourceImage: OG_SOURCE_IMAGES.scout,
        label: 'Scout',
      },
      {
        path: '/tutorials/pd-tube',
        image: '/img/og/tutorials-pd-tube.jpg',
        title: 'Pipe Agent Conversations',
        section: 'tutorials',
        sourceImage: OG_SOURCE_IMAGES.agentRuntime,
        label: 'Tutorial 21',
      },
      {
        path: '/docs/cli/tube',
        image: '/img/og/docs-cli-tube.jpg',
        title: 'pd tube',
        section: 'docs',
        sourceImage: OG_SOURCE_IMAGES.controlPlane,
        label: 'Docs',
      },
      {
        path: '/docs/features/relay-pki',
        image: '/img/og/docs-features-relay-pki.jpg',
        title: 'Relay PKI',
        section: 'docs',
        sourceImage: OG_SOURCE_IMAGES.controlPlane,
        label: 'Docs',
      },
      {
        path: '/docs/cli/roadmap',
        image: '/img/og/docs-cli-roadmap.jpg',
        title: 'pd roadmap',
        section: 'docs',
        sourceImage: OG_SOURCE_IMAGES.controlPlane,
        label: 'Docs',
      },
    ] as const

    for (const expected of routes) {
      const route = getRouteMetadata(expected.path)

      expect(route.index).not.toBe(false)
      expect(route.canonicalPath).toBeUndefined()
      expect(route.path).toBe(expected.path)
      expect(route.title).toContain(expected.title)
      expect(route.section).toBe(expected.section)
      expect(route.image).toBe(expected.image)
      expect(route.ogSourceImage).toBe(expected.sourceImage)
      expect(route.ogSectionLabel).toBe(expected.label)
      expect(existsSync(resolve(publicDir, route.image.replace(/^\//, '')))).toBe(true)
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

    expect(generatedFiles).toContain(OG_SOURCE_IMAGES.controlPlane)
    expect(existsSync(resolve(publicDir, DEFAULT_SITE_IMAGE.replace(/^\//, '')))).toBe(true)
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
    expect(llms).toContain('[Skill + MCP for AI Agents - Port Daddy](https://portdaddy.dev/mcp)')
    expect(llms).toContain('[API Reference - Port Daddy](https://portdaddy.dev/docs/api)')
    expect(llms).toContain('Sitemap: https://portdaddy.dev/sitemap.xml')
  })

  test('SPA document metadata updates canonical, social, robots, and article tags', async () => {
    render(<MetaProbe path="/blog/control-plane-is-the-product" />)

    await waitFor(() => {
      expect(document.title).toContain('The Control Plane Is the Product')
    })

    expect(document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content).toContain('identity, ownership, runtime, backend, cost, and recovery')
    expect(document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href).toBe('https://portdaddy.dev/blog/control-plane-is-the-product')
    expect(document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content).toBe('https://portdaddy.dev/img/og/blog-control-plane-is-the-product.jpg')
    expect(document.querySelector<HTMLMetaElement>('meta[name="twitter:image"]')?.content).toBe('https://portdaddy.dev/img/og/blog-control-plane-is-the-product.jpg')
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
