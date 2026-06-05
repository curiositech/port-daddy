// The manifesto is authored as a single markdown document under docs/ and
// imported here verbatim. Keeping a thin metadata layer next to the raw import
// mirrors the blogData.ts pattern so the page can render through the same
// .blog-article typography pipeline used by every other long-form surface.
import manifestoMarkdown from '../../../docs/manifesto-why-agent-economies.md?raw'

export interface ManifestoMeta {
  /** H1 / page title, also used for <title> and OG. */
  title: string
  /** Dek shown under the title — the italic standfirst from the document. */
  subtitle: string
  eyebrow: string
  readingTime: string
}

export const manifestoMeta: ManifestoMeta = {
  title: 'A Profit Incentive for Solving Anything',
  subtitle:
    'Software learned to hire its own help. Here is what happens next, why it needs a harbor before it needs anything else, and the seven papers that work it out.',
  eyebrow: 'Manifesto',
  readingTime: '8 min read',
}

/**
 * The raw markdown, with the leading H1 and the italic standfirst paragraph
 * stripped — both are rendered by the page hero instead of inside the prose
 * column, so we avoid duplicating them. The trailing `---` rule that precedes
 * the footnotes is preserved (it visually separates body from citations).
 */
export const manifestoContent: string = (() => {
  let md = manifestoMarkdown
  // Drop the first H1 line.
  md = md.replace(/^#\s+.+\n/, '')
  // Drop the leading italic standfirst paragraph (a single *...* block) and the
  // first horizontal rule that follows it — the hero owns both.
  md = md.replace(/^\s*\*[\s\S]*?\*\s*\n+/, '')
  md = md.replace(/^\s*---\s*\n+/, '')
  return md.trimStart()
})()
