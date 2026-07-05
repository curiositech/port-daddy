import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Node, Project, SyntaxKind, type NoSubstitutionTemplateLiteral, type SourceFile, type StringLiteral } from 'ts-morph'

import { blogPosts, blogPostsMissingContent, deprecatedBlogPosts } from './data/blogData'
import { EXAMPLE_DOCS } from './data/examples'
import { siteMetadataRoutes } from './data/siteMetadata'
import { toDarkSrc } from './components/site/ThemedImageSrc'

type LiteralKind = 'route' | 'asset' | 'mixed'

interface LocalLiteral {
  file: string
  value: string
  kind: LiteralKind
}

const testFile = fileURLToPath(import.meta.url)
const srcRoot = path.dirname(testFile)
const websiteRoot = path.dirname(srcRoot)
const publicRoot = path.join(websiteRoot, 'public')

const routePropertyNames = new Set([
  'href',
  'to',
  'readerHref',
  'overviewHref',
  'canonicalPath',
])

const assetPropertyNames = new Set([
  'dark',
  'gif',
  'heroImage',
  'image',
  'light',
  'ogSourceImage',
  'pdfPath',
  'poster',
  'sourceImage',
  'src',
  'srcSet',
  'webpSrc',
])

const routeCallNames = new Set([
  'absoluteUrl',
  'getRouteMetadata',
  'metadata',
  'normalizeMetadataPath',
  'ogImagePathForRoutePath',
])

const imageExtensions = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp'])
const assetExtensions = new Set([
  ...imageExtensions,
  '.css',
  '.ico',
  '.json',
  '.md',
  '.mp4',
  '.pdf',
  '.svg',
  '.txt',
  '.webm',
  '.woff',
  '.woff2',
])

const redirectOnlyRoutes = new Set([
  '/agents/agent-skill',
  '/cookbook',
  '/cryptography',
  '/docs-old',
  '/docs/get-started',
  '/mcp',
  '/pd-tube/playground',
  '/templates',
  '/whitepaper',
])

const agentSectionSlugs = new Set([
  'agent-skill',
  'communication-protocols',
  'coordination',
  'coordination-guard',
  'daemon-runtime',
  'event-triggers',
  'flow',
  'resurrection',
  'smart-resources',
  'templates',
  'virtual-actors',
  'yaml-and-shipwright',
])

const exactRoutes = new Set(
  [
    ...siteMetadataRoutes.flatMap((route) => [route.path, route.canonicalPath].filter((value): value is string => Boolean(value))),
    ...declaredStaticAppRoutes(),
  ],
)

const blogSlugs = new Set(blogPosts.map((post) => post.slug))
const deprecatedBlogSlugs = new Set(deprecatedBlogPosts.map((post) => post.slug))
const exampleSlugs = new Set([...slugsForPrefix('/examples/'), ...EXAMPLE_DOCS.map((example) => example.slug)])
const integrationSlugs = slugsForPrefix('/integrations/')
const tutorialSlugs = slugsForPrefix('/tutorials/')
const whitePaperSlugs = slugsForPrefix('/whitepaper/')

function slugsForPrefix(prefix: string) {
  return new Set(
    siteMetadataRoutes
      .map((route) => route.path)
      .filter((routePath) => routePath.startsWith(prefix))
      .map((routePath) => routePath.slice(prefix.length).split('/')[0])
      .filter(Boolean),
  )
}

function listFiles(root: string, predicate: (filePath: string) => boolean): string[] {
  return readdirSync(root).flatMap((entry) => {
    const filePath = path.join(root, entry)
    const stats = statSync(filePath)

    if (stats.isDirectory()) return listFiles(filePath, predicate)
    return predicate(filePath) ? [filePath] : []
  })
}

function declaredStaticAppRoutes() {
  const mainSource = readFileSync(path.join(srcRoot, 'main.tsx'), 'utf8')
  return Array.from(mainSource.matchAll(/<Route\s+path="([^"]+)"/g))
    .map((match) => match[1] ?? '')
    .filter((routePath) => routePath.startsWith('/'))
    .filter((routePath) => !routePath.includes(':') && !routePath.includes('*'))
}

function productionSourceFiles() {
  return listFiles(srcRoot, (filePath) => {
    if (!/\.(ts|tsx)$/.test(filePath)) return false
    if (filePath === testFile) return false
    if (/\.(test|stories)\.(ts|tsx)$/.test(filePath)) return false
    if (filePath.endsWith('vite-env.d.ts')) return false
    return true
  })
}

function literalValue(node: StringLiteral | NoSubstitutionTemplateLiteral) {
  return Node.isStringLiteral(node) ? node.getLiteralValue() : node.getLiteralText()
}

function literalKind(node: StringLiteral | NoSubstitutionTemplateLiteral): LiteralKind | undefined {
  const jsxAttribute = node.getFirstAncestorByKind(SyntaxKind.JsxAttribute)

  if (jsxAttribute) {
    const name = jsxAttribute.getNameNode().getText()
    if (routePropertyNames.has(name)) return 'route'
    if (assetPropertyNames.has(name)) return 'asset'
  }

  const propertyAssignment = node.getFirstAncestorByKind(SyntaxKind.PropertyAssignment)

  if (propertyAssignment && propertyAssignment.getInitializer() === node) {
    const name = propertyAssignment.getName()
    if (routePropertyNames.has(name)) return 'route'
    if (assetPropertyNames.has(name)) return 'asset'
  }

  const callExpression = node.getFirstAncestorByKind(SyntaxKind.CallExpression)

  if (callExpression) {
    const expressionName = callExpression.getExpression().getText().split('.').at(-1)
    const [firstArgument] = callExpression.getArguments()

    if (expressionName && routeCallNames.has(expressionName) && firstArgument === node) return 'route'
  }

  return undefined
}

function sourceLiterals() {
  const project = new Project({
    tsConfigFilePath: path.join(websiteRoot, 'tsconfig.app.json'),
    skipAddingFilesFromTsConfig: true,
  })

  project.addSourceFilesAtPaths(productionSourceFiles())

  return project.getSourceFiles().flatMap((sourceFile) => literalsFromSourceFile(sourceFile))
}

function literalsFromSourceFile(sourceFile: SourceFile): LocalLiteral[] {
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.StringLiteral)
    .concat(sourceFile.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral))
    .flatMap((literal) => {
      const value = literalValue(literal)
      const kind = literalKind(literal)

      if (!kind || !isLocalLiteral(value)) return []

      if (kind === 'asset' && literal.getFirstAncestorByKind(SyntaxKind.JsxAttribute)?.getNameNode().getText() === 'srcSet') {
        return srcSetUrls(value).map((srcSetValue) => ({
          file: relativeSourceFile(sourceFile),
          value: srcSetValue,
          kind,
        }))
      }

      return [
        {
          file: relativeSourceFile(sourceFile),
          value,
          kind,
        },
      ]
    })
}

function relativeSourceFile(sourceFile: SourceFile) {
  return path.relative(websiteRoot, sourceFile.getFilePath())
}

function markdownLiterals() {
  return listFiles(srcRoot, (filePath) => filePath.endsWith('.md')).flatMap((filePath) => {
    const source = readFileSync(filePath, 'utf8')

    return [
      ...markdownMatches(source, /!\[[^\]]*]\(([^)\s]+)\)/g, 'asset', filePath),
      ...markdownMatches(source, /(?<!!)\[[^\]]+]\(([^)\s]+)\)/g, 'route', filePath),
    ]
  })
}

function markdownMatches(source: string, pattern: RegExp, kind: LiteralKind, filePath: string): LocalLiteral[] {
  return Array.from(source.matchAll(pattern)).flatMap((match) => {
    const value = match[1]

    if (!value || !isLocalLiteral(value)) return []

    return [
      {
        file: path.relative(websiteRoot, filePath),
        value,
        kind,
      },
    ]
  })
}

function srcSetUrls(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim().split(/\s+/)[0])
    .filter(Boolean)
}

function isLocalLiteral(value: string) {
  return value.startsWith('/') && !value.startsWith('//')
}

function withoutQueryOrHash(value: string) {
  return value.split(/[?#]/)[0]
}

function normalizeRoute(value: string) {
  const routePath = withoutQueryOrHash(value).replace(/\/+$/, '') || '/'
  return routePath
}

function publicAssetPath(value: string) {
  return withoutQueryOrHash(value)
}

function extensionFor(value: string) {
  return path.extname(withoutQueryOrHash(value)).toLowerCase()
}

function isPublicAsset(value: string) {
  return assetExtensions.has(extensionFor(value))
}

function isImageAsset(value: string) {
  return imageExtensions.has(extensionFor(value))
}

function isKnownRoute(value: string) {
  const routePath = normalizeRoute(value)

  if (exactRoutes.has(routePath) || redirectOnlyRoutes.has(routePath)) return true
  if (routePath.startsWith('/docs/')) return true

  const [collection, slug] = routePath.slice(1).split('/')

  if (!slug) return false
  if (collection === 'agents') return agentSectionSlugs.has(slug)
  if (collection === 'blog') return blogSlugs.has(slug) || deprecatedBlogSlugs.has(slug)
  if (collection === 'examples') return exampleSlugs.has(slug)
  if (collection === 'integrations') return integrationSlugs.has(slug)
  if (collection === 'tutorials') return tutorialSlugs.has(slug)
  if (collection === 'whitepaper') return whitePaperSlugs.has(slug)

  return false
}

function publicFileExists(value: string) {
  return existsSync(path.join(publicRoot, publicAssetPath(value).slice(1)))
}

function referencedPublicAssets(literals: LocalLiteral[]) {
  return uniqueLiterals(
    literals
      .filter((literal) => literal.kind !== 'route' || isPublicAsset(literal.value))
      .filter((literal) => isPublicAsset(literal.value)),
  )
}

function referencedRoutes(literals: LocalLiteral[]) {
  return uniqueLiterals(
    literals
      .filter((literal) => literal.kind !== 'asset')
      .filter((literal) => !isPublicAsset(literal.value)),
  )
}

function uniqueLiterals(literals: LocalLiteral[]) {
  const seen = new Set<string>()

  return literals.filter((literal) => {
    const key = `${literal.file}:${literal.kind}:${literal.value}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function shouldHaveDarkPair(value: string) {
  const assetPath = publicAssetPath(value)

  if (!isImageAsset(assetPath)) return false
  if (assetPath.endsWith('.svg')) return false
  if (assetPath.includes('/img/og/')) return false
  if (assetPath.includes('/logos/')) return false
  if (/-dark(?=\.[a-z0-9]+$)/i.test(assetPath)) return false

  return true
}

function formatLiteral(literal: LocalLiteral) {
  return `${literal.file}: ${literal.value}`
}

describe('marketing site literal integrity', () => {
  const literals = uniqueLiterals([...sourceLiterals(), ...markdownLiterals()])

  it('wires every declared blog post to bundled markdown content', () => {
    expect(blogPostsMissingContent).toEqual([])
  })

  it('keeps route literals pointed at registered marketing pages', () => {
    const brokenRoutes = referencedRoutes(literals).filter((literal) => !isKnownRoute(literal.value))

    expect(brokenRoutes.map(formatLiteral)).toEqual([])
  })

  it('keeps public asset literals pointed at files that exist', () => {
    const missingAssets = referencedPublicAssets(literals).filter((literal) => !publicFileExists(literal.value))

    expect(missingAssets.map(formatLiteral)).toEqual([])
  })

  it('keeps referenced light-mode raster images paired with dark variants', () => {
    const missingDarkPairs = referencedPublicAssets(literals)
      .filter((literal) => shouldHaveDarkPair(literal.value))
      .map((literal) => ({
        ...literal,
        value: toDarkSrc(literal.value),
      }))
      .filter((literal) => !publicFileExists(literal.value))

    expect(missingDarkPairs.map(formatLiteral)).toEqual([])
  })
})
