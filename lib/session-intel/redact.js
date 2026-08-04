'use strict';
// redact.js — secret/PII redaction applied AT INGEST, before any excerpt is
// written to the append-only ledger.
//
// WHY AT INGEST: the coordination ledger is append-only (JSONL) and port-daddy
// notes are immutable. A secret that lands in a stored excerpt is PERMANENT and
// unfixable. So no raw excerpt bytes ever reach the store — we redact first, keep
// a one-way content hash of the raw text for dedup/provenance, and store only the
// redacted text plus a redaction tally.
//
// This is STRUCTURED matching (known secret token shapes + KEY=VALUE assignment
// grammar + path/email grammar), NOT keyword-NLP classification of prose.

const crypto = require('crypto');

// Each rule: [name, RegExp(global), replacement]. Order matters — token shapes
// run before the generic long-blob catch so specific labels win.
const RULES = [
  // Provider API keys / tokens (specific, high-confidence shapes).
  ['anthropic_key', /\bsk-ant-[A-Za-z0-9_\-]{16,}/g, '<redacted:anthropic_key>'],
  ['openai_key', /\b(?:sk|pk|rk)-[A-Za-z0-9_\-]{16,}/g, '<redacted:openai_key>'],
  ['github_pat', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, '<redacted:github_token>'],
  ['github_fine_pat', /\bgithub_pat_[A-Za-z0-9_]{20,}/g, '<redacted:github_token>'],
  ['slack_token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, '<redacted:slack_token>'],
  ['aws_akid', /\bAKIA[0-9A-Z]{16}\b/g, '<redacted:aws_key_id>'],
  ['google_key', /\bAIza[0-9A-Za-z_\-]{20,}/g, '<redacted:google_key>'],
  ['jwt', /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{6,}/g, '<redacted:jwt>'],
  ['bearer', /\bBearer\s+[A-Za-z0-9._\-]{12,}/gi, 'Bearer <redacted:token>'],
  ['pem', /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g, '<redacted:private_key>'],

  // KEY=VALUE / KEY: VALUE assignments where the key NAME structurally denotes a
  // secret (ends in KEY/TOKEN/SECRET/PASSWORD/PASSWD/PWD/CREDENTIAL/API...). We
  // match on the key-name grammar, not on the value's prose.
  [
    'env_secret',
    /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|CREDENTIALS|PRIVATE)[A-Z0-9_]*)\s*([=:])\s*("[^"]*"|'[^']*'|\S+)/g,
    (_m, key, sep) => `${key}${sep}<redacted:secret>`,
  ],

  // Emails → PII.
  ['email', /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, '<redacted:email>'],

  // Absolute home paths leak the machine user + local layout. Collapse the
  // `/Users/<name>/` (or `/home/<name>/`) prefix to `~/` — anonymises the user
  // AND shortens the path, while keeping the repo-relative tail intact.
  ['home_path_mac', /\/Users\/[^/\s"'`)]+/g, '~'],
  ['home_path_linux', /\/home\/[^/\s"'`)]+/g, '~'],

  // Generic high-entropy blobs LAST, and conservative: 64+ hex (avoids 40-char
  // git SHAs) or 40+ base64-ish with mixed classes. Prevents over-redacting prose.
  ['long_hex', /\b[0-9a-fA-F]{64,}\b/g, '<redacted:hex_blob>'],
  [
    'base64_blob',
    /\b(?=[A-Za-z0-9+/]{40,}={0,2}\b)(?=[^\s]*[A-Z])(?=[^\s]*[a-z])(?=[^\s]*[0-9])[A-Za-z0-9+/]{40,}={0,2}\b/g,
    '<redacted:blob>',
  ],
];

function sha256(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

// redactExcerpt(raw, opts) → { text, redactions:[{type,count}], redactionCount, sha256, truncated }
// Never throws; a non-string coerces to ''.
function redactExcerpt(raw, opts = {}) {
  const maxLen = opts.maxLen || 1200;
  let text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  const rawHash = sha256(text);

  let truncated = false;
  if (text.length > maxLen) {
    text = text.slice(0, maxLen);
    truncated = true;
  }

  const redactions = [];
  for (const [name, re, repl] of RULES) {
    let count = 0;
    text = text.replace(re, (...args) => {
      count++;
      return typeof repl === 'function' ? repl(...args) : repl;
    });
    if (count > 0) redactions.push({ type: name, count });
  }

  const redactionCount = redactions.reduce((n, r) => n + r.count, 0);
  return { text, redactions, redactionCount, sha256: rawHash, truncated };
}

// redactString(str) → redacted string. The plain-string form of redactExcerpt,
// used to scrub STRUCTURED fields (filePath/symbolPath) and any derived string
// (observation/suggestedChange) that embeds a path — so an absolute
// `/Users/<name>/…` claim path can never reach the append-only ledger. Idempotent:
// re-running over already-redacted text is a no-op. Non-strings pass through.
function redactString(str) {
  if (typeof str !== 'string' || !str) return str;
  let text = str;
  for (const [, re, repl] of RULES) {
    text = text.replace(re, (...args) => (typeof repl === 'function' ? repl(...args) : repl));
  }
  return text;
}

module.exports = { redactExcerpt, redactString, sha256, RULES };
