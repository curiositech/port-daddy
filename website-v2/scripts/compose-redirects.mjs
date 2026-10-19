/**
 * Build the deployed `_redirects` from two sources: the route rewrites derived
 * from siteMetadata, and the rules a human wrote in `public/_redirects`.
 *
 * WHY THIS IS NOT JUST A TEMPLATE STRING. inject-route-html.mjs used to write
 * dist/_redirects from the route list alone, which silently discarded whatever
 * Vite had just copied there from public/. That was invisible while
 * public/_redirects held nothing but the catch-all the generator also emits.
 * It stopped being invisible the moment the retired per-chapter PDFs needed
 * eight 301s: they would have been written to dist and deleted milliseconds
 * later, and nothing would have said so.
 *
 * Cloudflare Pages takes the FIRST matching rule, so ordering is the whole
 * contract: specific paths first, `/*` last and exactly once. The catch-all is
 * appended here rather than trusted from either input, so no edit to either
 * source can strand every rule beneath it.
 */
const CATCH_ALL = '/*  /index.html  200'

const isCatchAll = (line) => line.trim().split(/\s+/)[0] === '/*'

export function composeRedirects(routes, handAuthored = '') {
  const routeRewrites = routes
    .filter((route) => route.path !== '/')
    .flatMap((route) => [
      `${route.path}  ${route.path}/index.html  200`,
      `${route.path}/  ${route.path}/index.html  200`,
    ])

  // Comments and blank lines are kept: they are how the reason for a rule
  // survives to whoever reads the deployed file.
  const kept = handAuthored
    .split('\n')
    .filter((line) => !isCatchAll(line))
    .join('\n')
    .trim()

  return [...routeRewrites, ...(kept ? ['', kept] : []), '', CATCH_ALL, ''].join('\n')
}
