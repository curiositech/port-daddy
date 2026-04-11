export function extractMentionedPaths(text: string, limit = 8): string[] {
  const matches = text.match(/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+(?:\.[A-Za-z0-9_-]+)?/g) ?? [];
  return [...new Set(matches.filter((match) => match.includes('/')).slice(0, limit))];
}
