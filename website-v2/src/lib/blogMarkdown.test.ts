import { describe, expect, test } from 'vitest'
import { blogPosts } from '@/data/blogData'
import { stripDuplicateLeadingHeroImage } from './blogMarkdown'

function bodyWithoutTitle(content: string) {
  return content.replace(/^\s*#\s+.+\n/, '')
}

function startsWithMarkdownImageFor(content: string, image: string) {
  const escaped = image.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^\\s*!\\[[^\\]]*]\\(${escaped}\\)`).test(content)
}

describe('blog markdown rendering helpers', () => {
  test('strips the leading markdown image when it duplicates the metadata hero', () => {
    const postsWithDuplicateLeadHeroes = blogPosts.filter((post) =>
      startsWithMarkdownImageFor(bodyWithoutTitle(post.content), post.heroImage),
    )

    expect(postsWithDuplicateLeadHeroes.map((post) => post.slug)).toEqual(
      expect.arrayContaining([
        'the-pr-that-reviews-itself',
        'attention-is-the-first-command',
        'bond-pricing-is-a-market',
      ]),
    )

    for (const post of postsWithDuplicateLeadHeroes) {
      const stripped = stripDuplicateLeadingHeroImage(bodyWithoutTitle(post.content), post.heroImage)
      expect(
        startsWithMarkdownImageFor(stripped, post.heroImage),
        `${post.slug} should not render its metadata hero again as the first article figure`,
      ).toBe(false)
    }
  })

  test('leaves non-hero leading images in place', () => {
    const content = '![A supporting figure](/img/supporting.webp)\n\nBody copy.'
    expect(stripDuplicateLeadingHeroImage(content, '/img/hero.webp')).toBe(content)
  })
})
