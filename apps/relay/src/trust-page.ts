/**
 * The relay TRUST PAGE — doctrine D8's one public crypto/policy/unbuilt table.
 *
 *   GET /trust   (public; no session, no token, no secrets, no script)
 *
 * D8, verbatim: "Every trust claim on the trust page is labeled. 'Blind to
 * each other' is policy on a TCB we name (the executor sandbox); it is never
 * sold as math." This page ships in the SAME PR as the blind-sessions
 * substrate (grand-plan node blind-sessions; plan §L2 first slice) because a
 * blind room sold without its labels is the exact dishonesty D8 exists to
 * prevent.
 *
 * Every row carries one of three labels:
 *   CRYPTO   — holds because of mathematics (signatures, AEAD, MACs, chains).
 *   POLICY   — holds because a named component enforces a rule; the component
 *              is the trust boundary and is named in the row.
 *   UNBUILT  — not implemented; claiming it would be a lie, so it is listed
 *              instead.
 *
 * Static, server-rendered, no interpolated user data (nothing to escape but
 * we escape anyway by construction: the table content is literal strings).
 * No-script CSP like every other relay HTML surface.
 */

const ROWS: Array<{ claim: string; label: 'crypto' | 'policy' | 'unbuilt'; detail: string }> = [
  {
    claim: 'Event chains are tamper-evident',
    label: 'crypto',
    detail:
      'Every published event is Ed25519-signed by its sender and hash-chained ' +
      '(SHA-256 over prev_hash|sender|channel|seq|iat|ciphertext). A rewritten ' +
      'history breaks the chain for every subscriber that verifies it.',
  },
  {
    claim: 'Sealed skill material is unreadable to the relay',
    label: 'crypto',
    detail:
      'A lender seals skill text to the executor sandbox’s per-run ephemeral ' +
      'P-256 key (pd-seal/1: ECDH + HKDF-SHA256 + AES-256-GCM). The relay stores ' +
      'ciphertext; no decryption key ever exists relay-side.',
  },
  {
    claim: 'Blind-run receipts are executor-signed',
    label: 'crypto',
    detail:
      'Per-run receipts {run_id, skill_id, verdict_hash, tokens_used, iat} ride ' +
      'the executor’s signed hash chain (its operator-provisioned N2 identity). ' +
      'Both sides receive the same receipt body with the same chain coordinates.',
  },
  {
    claim: 'Capability tokens cannot be forged by outsiders',
    label: 'crypto',
    detail:
      'Borrower capabilities are HMAC-SHA256 tokens (ADR-0101 style) with caveats ' +
      '{skill_id, harbor, max_runs, exp}. Integrity is cryptographic — but see ' +
      'the next row for who can mint.',
  },
  {
    claim: 'Capability caveats are enforced',
    label: 'policy',
    detail:
      'The RELAY is the enforcement point: expiry, harbor match, revocation, and ' +
      'max_runs (an atomic ledger counter — replaying a valid token past its ' +
      'budget is refused by state, not by math). The relay can mint any token it ' +
      'likes; caveats bind the relay’s behavior, which is policy.',
  },
  {
    claim: 'Lender and borrower are blind to each other',
    label: 'policy',
    detail:
      'POLICY ON A NAMED TCB: the executor sandbox. It is the one place skill ' +
      'text and borrower input coexist in plaintext. The borrower chooses inputs, ' +
      'so every run is a model-extraction oracle — the output contract (field ' +
      'whitelist, type check, length caps, refuse-not-strip) RAISES THE COST of ' +
      'exfiltration; it does not make it impossible. Never sold as math.',
  },
  {
    claim: 'Blind sessions are blind to Port Daddy',
    label: 'policy',
    detail:
      'FALSE — and never claimed. Borrower inputs are relay-readable by design; ' +
      'skill material is not. Stating this plainly is the entire point of this table.',
  },
  {
    claim: 'Executor egress is locked down during blind runs',
    label: 'policy',
    detail:
      'The stage kill switch: the executor refuses to run a blind session without ' +
      'the egress-locked attestation (fail-closed), and hands the run only the AI ' +
      'binding — no fetch, no tokens, no network handles. Enforced by code and ' +
      'the adversarial harness in CI, which is policy, not mathematics.',
  },
  {
    claim: 'Royalties, sea-trials, and arbitration',
    label: 'unbuilt',
    detail:
      'Marketplace mechanics are L1/L2 proper and do not exist. No royalty is ' +
      'computed, no sea-trial license is minted, no dispute path is implemented.',
  },
  {
    claim: 'Formally verified broker role',
    label: 'unbuilt',
    detail:
      'No ProVerif/Tamarin model covers the broker. Until one does, no ' +
      '“formally verified” claim appears anywhere on this platform.',
  },
];

const LABEL_STYLE: Record<'crypto' | 'policy' | 'unbuilt', string> = {
  crypto: 'background:#103c2d;color:#7ee2b8;border:1px solid #1d5c46',
  policy: 'background:#3d2e10;color:#ffce6b;border:1px solid #6b5220',
  unbuilt: 'background:#3d1414;color:#ff9a9a;border:1px solid #6b2424',
};

function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Render the D8 table. Exported for tests. */
export function renderTrustPage(relayVersion: string): string {
  const rows = ROWS.map(
    (r) => `<tr>
      <td class="claim">${esc(r.claim)}</td>
      <td><span class="label" style="${LABEL_STYLE[r.label]}">${r.label.toUpperCase()}</span></td>
      <td class="detail">${esc(r.detail)}</td>
    </tr>`,
  ).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Port Daddy Relay — Trust page</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 2rem 1rem 4rem; background: #0d1117; color: #e6edf3;
         font: 1rem/1.55 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  main { max-width: 62rem; margin: 0 auto; }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
  .sub { color: #9aa7b3; margin: 0 0 1.5rem; font-size: .95rem; }
  .doctrine { border-left: 3px solid #2f81f7; background: #11161d; padding: .75rem 1rem;
              margin: 0 0 2rem; border-radius: 0 6px 6px 0; font-size: .95rem; }
  .tablewrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: .95rem; }
  th { text-align: left; padding: .5rem .75rem; border-bottom: 2px solid #30363d;
       color: #9aa7b3; font-weight: 600; }
  td { padding: .7rem .75rem; border-bottom: 1px solid #21262d; vertical-align: top; }
  td.claim { font-weight: 600; min-width: 14rem; }
  td.detail { color: #b7c2cc; }
  .label { display: inline-block; padding: .1rem .55rem; border-radius: 999px;
           font-size: .875rem; font-weight: 700; letter-spacing: .04em; }
  footer { margin-top: 2rem; color: #6e7b87; font-size: .875rem; }
</style>
</head>
<body>
<main>
  <h1>Trust page</h1>
  <p class="sub">Port Daddy Relay ${esc(relayVersion)} — every trust claim, labeled. One table, doctrine D8.</p>
  <div class="doctrine">
    <strong>How to read this:</strong> <em>CRYPTO</em> holds because of mathematics.
    <em>POLICY</em> holds because a named component enforces a rule — the component is the
    trust boundary. <em>UNBUILT</em> means it does not exist yet, and we say so instead of implying it.
    Mutual blindness in blind sessions is <strong>policy on a named TCB (the executor sandbox)</strong> —
    cost-raising, never sold as math.
  </div>
  <div class="tablewrap">
  <table>
    <thead><tr><th>Claim</th><th>Label</th><th>What actually holds</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  </div>
  <footer>Sealed-charter blind sessions are a first slice (grand-plan §L2): the adversarial
  harness in CI — output-exfiltration, egress, and capability-replay containment — is the
  shipping gate, and this table is the product page.</footer>
</main>
</body>
</html>`;
}

/** GET /trust — public, no-script, cache-friendly for an hour. */
export function handleTrustPage(env: { RELAY_VERSION: string }): Response {
  return new Response(renderTrustPage(env.RELAY_VERSION), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
