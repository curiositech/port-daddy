#!/usr/bin/env node

const [githubToken, password, credential] = process.argv.slice(2);

if (!githubToken || !password || !credential) {
  console.error('usage: emit-secret.mjs <github-token> <password> <credential>');
  process.exit(2);
}

console.log(`token ${githubToken}`);
console.log(`RC_PASSWORD=${password}`);
console.error(JSON.stringify({ credential }));
console.error('-----BEGIN PRIVATE KEY-----\nfixture-key-material\n-----END PRIVATE KEY-----');
