import fs from 'node:fs';
const path = process.argv[2];
if (!path) throw new Error('usage: check-managed-billing-readiness.mjs <wrangler-json>');
const payload = JSON.parse(fs.readFileSync(path, 'utf8'));
const rows = Array.isArray(payload) ? payload.flatMap(x => x?.results ?? x?.result?.[0]?.results ?? []) : [];
const count = Number(rows[0]?.active_entitlements);
if (!Number.isSafeInteger(count) || count < 1) {
  throw new Error('deployment blocked: production billing schema is absent or has no explicit active entitlement');
}
console.log(`managed billing ready: ${count} explicit active entitlement(s)`);
