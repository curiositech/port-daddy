/**
 * Render the Shipwright chat page to static files for visual capture
 * (the render-parley-pages.mts precedent).
 *
 * Motivation: screenshots are only evidence if they come from the SAME
 * renderer the Worker serves. This script imports `renderShipwrightPage` and
 * `renderPrTemplate` directly and feeds them realistic view models, so a
 * captured PNG is a picture of production markup — not a mockup.
 *
 * Three states:
 *   - shipwright-main.html      installations present → the Open-PR deck
 *     template ships in the page. Because the deck lives in a <template>
 *     (client JS clones it into validated panels), the main capture also
 *     appends ONE deck instance with the template tags unwrapped — the deck
 *     markup itself is untouched production output of renderPrTemplate.
 *   - shipwright-degraded.html  installation list unknown + a github_error
 *     notice — the honest-degradation state.
 *   - shipwright-empty.html     zero installations — the install-the-app teach.
 *
 * Run with: npx vite-node scripts/render-shipwright-page.mts
 * Output:   .artifacts/shipwright-*.html
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { renderShipwrightPage, renderPrTemplate } from '../src/shipwright-page.js';
import type { UserRow } from '../src/db.js';

const OUT = new URL('../.artifacts/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const operator: UserRow = {
  id: 'u_demo',
  github_user_id: 1,
  login: 'meridian-ops',
  display_name: 'Alice Meridian',
  avatar_url: null,
  primary_email: null,
  email_verified: 1,
  created_at: 0,
  last_login_at: 0,
  deleted_at: null,
};

const installations = [
  { id: 42, accountLogin: 'meridian-ops', accountType: 'User' },
  { id: 77, accountLogin: 'harbor-collective', accountType: 'Organization' },
];

const NONCE = 'ab'.repeat(16);

// Main state: deck template present. Unwrap the template tags so the capture
// shows the deck the client would clone (markup byte-identical inside).
const main = renderShipwrightPage(operator, NONCE, { installations, notice: null });
const deckVisible = renderPrTemplate(installations)
  .replace('<template id="prform-tpl">', '')
  .replace('</template>', '');
const preview = [
  '<main class="chat"><div class="log"><div class="msg msg-ship">',
  '<span class="who">Shipwright</span>',
  '<div class="yamlbox">',
  '<div class="bar"><span class="fn">pd-fleet.yml</span></div>',
  '<div class="v-badge v-ok">Validates ✓ — 3 ships parse clean</div>',
  deckVisible,
  '</div></div></div></main>',
].join('\n');
writeFileSync(
  `${OUT}shipwright-main.html`,
  main.replace('<script nonce=', preview + '\n<script nonce='),
);

// Degraded: unknown installation list + a whitelisted failure notice.
writeFileSync(
  `${OUT}shipwright-degraded.html`,
  renderShipwrightPage(operator, NONCE, { installations: null, notice: 'github_error' }),
);

// Empty: zero installations → the teach-the-install state.
writeFileSync(
  `${OUT}shipwright-empty.html`,
  renderShipwrightPage(operator, NONCE, { installations: [], notice: null }),
);

console.log(`rendered 3 shipwright states into ${OUT}`);
