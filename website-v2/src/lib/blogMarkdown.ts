const LEADING_MARKDOWN_IMAGE_PATTERN =
  /^\s*!\[[^\]]*]\((?<src><[^>]+>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\)\s*(?:\n|$)/

function normalizeImagePath(src: string) {
  return src.trim().replace(/^<|>$/g, '').split(/[?#]/)[0]
}

export function stripDuplicateLeadingHeroImage(content: string, heroImage?: string) {
  if (!heroImage) return content
  const match = LEADING_MARKDOWN_IMAGE_PATTERN.exec(content)
  const leadingSrc = match?.groups?.src
  if (!match || !leadingSrc) return content

  if (normalizeImagePath(leadingSrc) !== normalizeImagePath(heroImage)) return content
  return content.slice(match[0].length)
}
