import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { blogPosts, deprecatedBlogPosts } from './blogData'

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../public')

const weakPhrases = [
  'website caught up',
  'blog is being reset',
  'old article set',
  'decorative metaphor',
  'terminal trivia',
  'vibes',
]

function wordCount(content: string) {
  return content.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)?.length ?? 0
}

function codeBlockCount(content: string) {
  return content.match(/```[\w-]*\n[\s\S]*?\n```/g)?.length ?? 0
}

function imagePaths(content: string) {
  return Array.from(content.matchAll(/!\[[^\]]*]\((\/[^)\s]+)\)/g), (match) => match[1])
}

describe('blog content quality', () => {
  test('current posts are substantial technical articles', () => {
    for (const post of blogPosts) {
      expect(wordCount(post.content), `${post.slug} should read like a full technical article`).toBeGreaterThanOrEqual(1400)
      expect(imagePaths(post.content).length, `${post.slug} should include multiple images or screenshots`).toBeGreaterThanOrEqual(2)
      expect(codeBlockCount(post.content), `${post.slug} should include concrete code, terminal, or diagram examples`).toBeGreaterThanOrEqual(3)
    }
  })

  test('current posts avoid stale internal or placeholder framing', () => {
    for (const post of blogPosts) {
      const searchable = `${post.title}\n${post.excerpt}\n${post.content}`.toLowerCase()

      for (const phrase of weakPhrases) {
        expect(searchable, `${post.slug} should not use weak phrase: ${phrase}`).not.toContain(phrase)
      }

      expect(searchable, `${post.slug} should not leak local machine paths`).not.toMatch(/\/users\/|\/private\/tmp/)
      expect(searchable, `${post.slug} should not depend on private recovery docs`).not.toMatch(/docs\/recovery|\.cartographer/)
      expect(searchable, `${post.slug} should avoid future-dated public claims`).not.toMatch(/\b2027\b|\b2028\b/)
    }
  })

  test('article images resolve to checked-in public assets', () => {
    for (const post of blogPosts) {
      const paths = [post.heroImage, ...imagePaths(post.content)]

      for (const path of paths) {
        expect(existsSync(resolve(publicDir, path.replace(/^\//, ''))), `${post.slug} image missing: ${path}`).toBe(true)
      }
    }
  })

  test('deprecated posts redirect to live replacements', () => {
    const currentSlugs = new Set(blogPosts.map((post) => post.slug))

    for (const post of deprecatedBlogPosts) {
      expect(currentSlugs.has(post.replacementSlug), `${post.slug} replacement should exist`).toBe(true)
    }
  })
})
