/**
 * Test stub for @cloudflare/sandbox. The real SDK imports `cloudflare:` scheme
 * modules that exist only inside workerd, which breaks plain-Node vitest at
 * collection time for any test importing src/index.ts. Tests never run a
 * sandbox (sandbox-runner is exercised through its own null-object fallback);
 * they only need these symbols to resolve.
 */
export class Sandbox {}
export function getSandbox(): never {
  throw new Error('cloudflare-sandbox stub: not executable in unit tests');
}
