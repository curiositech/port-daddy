---
license: Apache-2.0
name: solo-operator-business-site
description: Build a complete marketing site + phone-first "control center" for a one-person local business (estate sales, trades, services) on Cloudflare Workers + R2 at minimal ongoing cost (often $0/month on the free tier at local-business traffic) — including gated third-party integrations the owner connects themselves, sample content that retires itself, printable business paperwork, and a one-command launch flip. Use when a non-technical solo operator needs to run the whole thing from their phone after handoff. NOT for multi-tenant SaaS, content-heavy publications, or teams with a developer on staff.
allowed-tools: Read,Write,Edit,Bash,Grep,Glob,WebFetch
argument-hint: '[project-dir]'
metadata:
  provenance:
    kind: first-party
    owners: [port-daddy]
    scope: public
  authorship:
    maintainers: [port-daddy]
  category: Product Engineering
  tags:
    - cloudflare-workers
    - small-business
    - solo-operator
    - admin-portal
    - launch-checklist
  pairs-with:
    - skill: make_copy_and_media_human
      reason: every page and admin string this skill produces should pass that skill's AI-ism audit before the owner sees it
    - skill: color-contrast-auditor
      reason: run its WCAG pass on the palette spec; fix failures by HLS-lightness binary search to ≥4.5:1 body / ≥3:1 UI
    - skill: nano-banana-image-gen
      reason: generates the photography set (objects, houses, crew) with style-template reference images so future photos composite consistently
    - skill: ux-friction-analyzer
      reason: run it as an agent once feature-complete; fold findings into a fixed-vs-deferred table
    - skill: product-reality-reviewer
      reason: the second lens of the feature-complete audit — what the site claims vs what actually works — run alongside ux-friction-analyzer
---

# Solo-operator business site

The finished shape, learned end-to-end on a real build (an estate-sale operator in
Detroit): a static marketing site plus a control center that lets one non-technical
person run sales, inventory, leads, email, payments, paperwork and social — from a
phone, with no developer on call. Everything below earned its place by breaking first.

## Architecture that stays cheap and un-breakable

- **Two Workers, one R2 bucket, no database.** An assets-only Worker serves the site
  (`assets.directory`, extensionless `html_handling`, `not_found_handling:
  "404-page"`). A second Worker is the whole backend: public form endpoints + the
  admin SPA + integrations. R2 holds JSON-per-record under prefixes
  (`leads/`, `sales/<slug>.json`, `vault/`, `reviews/`, `expenses/`,
  `paperwork/`, `config/settings.json`, `config/secrets.json`). List-with-prefix +
  sort-by-created replaces every query you'd have written SQL for.
- **Gate private static pages with `run_worker_first`.** The operator handbook stays
  a plain HTML file in the assets dir; a ~20-line `main` script basic-auths just
  `["/playbook", "/playbook.html"]` and hands everything else to `env.ASSETS.fetch`.
  Same credentials as the admin. Don't move the file into the API worker — you'd
  break its relative asset URLs for nothing.
- **Secrets live in `config/secrets.json`, masked on read, env-fallback on use**
  (`getSecret`: R2 first, then `env`). The admin's secret boxes show `sk_live_…4f2`
  after save. Never echo a stored secret; never commit one; when the user pastes a
  credential in chat, store it in the scratchpad `chmod 600` and tell them to rotate.

## The control center: design for a phone and a non-expert

- One `String.raw` template is the entire SPA. **Two traps:** `${...}` still
  interpolates inside `String.raw` — escape literal dollars as `${"$"}{amount}` —
  and validation must *evaluate* the template then `node --check` the extracted
  `<script>` (checking the raw TS source false-positives on the escape).
- Bottom tab bar (Dashboard / Inbox / Sales / Vault / More), 44px targets,
  `main{padding-bottom:6rem}` so the fixed bar never covers the last card.
- **Setup cards, not documentation.** Each third-party account (Stripe, MailerLite,
  Claude, Twilio, Google Business, EstateSales.NET, Facebook) is a collapsible card
  written like you're talking to someone's dad: numbered steps that start "On your
  phone, go to stripe.com", a paste box per secret, a "connected / to do" pill, and
  a note about what stays greyed out until it's done. Order cards by business value;
  auto-open only the first unconnected one.
- **Gated features explain themselves instead of failing.** Every integration path
  returns a friendly sentence when its account is missing ("Connect MailerLite in
  Settings first", "Online passes aren't on yet for this sale — call us"). The
  owner should never see a stack trace or a silent no-op.
- **Paperwork tab** — the documents a real service business runs on: plain-language
  service agreement (terms vary by service type), settlement statement (line items,
  commission math server-side, "pull sold pieces" shortcut), donation record.
  Render each as a letterhead HTML page behind admin auth with a Print button —
  phones save that as PDF; no PDF library needed.
- Small dignities that matter to a solo operator: a "Log a call" form (never
  `prompt()` chains), an expense log with a tax-time CSV, "Send me a test first" on
  email blasts, a "What can I change myself?" explainer separating owner-editable
  content from text-the-developer content.

## Sample content that retires itself (diegetic samples)

Ship the site full of realistic sample pieces, sales, reviews — but every sample is
labeled **in-world** ("Sample review", a preview ribbon, a sample-note above the
grid) and every one has an automatic path out:

- Real vault pieces render ahead of samples immediately; at N real pieces the
  sample cards hide (`data-sample` attribute + a count check in the site JS).
- Real reviews from the admin replace the sample blockquotes on first save.
- The made-up phone/email hydrate to real ones site-wide the moment the owner
  saves Business info: expose them on the existing `/api/status` payload, then in
  site JS walk text nodes (TreeWalker) replacing the placeholder string, and rewrite
  `tel:` / `sms:` / `mailto:` hrefs. No rebuild, no template engine.

## Integrations, the versions that survive contact

- **Stripe** (early-access passes, deposits): Checkout Sessions via form-encoded
  REST + `Idempotency-Key`; webhook HMAC-SHA256 via WebCrypto with constant-time
  compare and 300s skew; **and a lazy reconciliation fallback** — when a pass looks
  pending, query `GET /v1/checkout/sessions/:id` directly so a lost webhook never
  locks out a paid buyer.
- **Email (MailerLite)**: find-or-create the group once and cache its id in
  settings; batch existing subscribers ~35 per click (Worker subrequest limit);
  campaigns are create-then-schedule-instant. Keep a one-member "Owner alerts"
  group for lead notifications and test sends.
- **SMS (Twilio)**: text ONLY the owner (new-lead alerts). Never build customer SMS
  without a consent list — TCPA. Three secrets + owner cell in settings.
- **Claude from a Worker**: `x-api-key` header, `anthropic-version: 2023-06-01`,
  `output_config:{effort,format:{type:"json_schema",schema}}`, no temperature with
  effort; schemas need `additionalProperties:false` and every key in `required`;
  handle `stop_reason:"refusal"`.
- **Scheduled sends**: a `*/15 * * * *` cron scanning for due, unsent, published
  records. On failure, stamp the error ON the record and surface it as a dashboard
  nag — a scheduler that fails silently is worse than no scheduler.

## Launch mechanics

- `noindex` everywhere until the owner flips "site live" (a settings boolean the
  preview ribbon also respects via `/api/status`).
- **One-command origin flip**: a `set-origin.mjs` that swaps every absolute URL
  (og:image, og:url, canonical, JSON-LD, sitemap, robots, llms.txt) between the
  workers.dev preview and the real domain. OG cards then work on the preview URL
  today and the real domain later. List every historical origin in the script.
- Mark preview-only code with `DELETE ... AT LAUNCH` comments and put those
  deletions on a go-live checklist that lives in the README *and* is pointed to
  from the admin's "go live" card.
- Per-page composited OG cards (1200×630 JPEG — link scrapers dislike webp) from a
  sharp script with a `--size og --pos` interface; reuse the same script for every
  future sale announcement.

## QA discipline that actually caught bugs

- **Screenshot everything, and read the screenshots.** A screenshot surfaced that
  `.err{display:block}` silently defeats the `hidden` attribute (author CSS beats
  the UA sheet) — form errors were showing to every visitor and two full review
  passes had missed it. Render admin views by evaluating the template locally and
  stubbing `window.fetch` with canned JSON (include `json`, `text`, AND `headers`
  on the stub). Inject scripts at `</body>`, not `<head>` — the real page defers.
- Fixed-position bars render mid-page in fullPage captures; screenshot
  viewport-sized for anything with a sticky header/footer.
- Verify features by **living the data**: create a record through the real API,
  see it on the public page, then delete it at the storage layer
  (`wrangler r2 object delete --remote`; keys with colons break S3 SigV4 — use
  wrangler). Prove crons by planting a past-due record and polling in the
  background until the tick stamps it.
- Link audit: script every `href` against files-on-disk plus per-page `id`s.
  Split pages always leave `#section` anchors pointing at sections that stayed
  behind on the old page.
- `sed` replacement text containing `&` re-inserts the match — use python string
  replace for surgical HTML edits, and assert `count(old)==1` before replacing.
- Worker deploys propagate across isolates for ~a minute; distinguish old-version
  errors from real ones before debugging, and cache-bust when verifying assets.

## Copy rules for a one-person business

- First person singular. "I clear the whole house", not "our team".
- Never print an unverifiable claim: "Licensed & insured" becomes "Insured ·
  references on request" unless a license number exists.
- One wedge line that names the competitor and the difference: "A junk hauler
  charges you $800 and dumps the rug. I pay you for it."
- Answer the embarrassing questions in the FAQ on purpose (hoarder houses,
  who-enters-my-home, out-of-state) — candor is the marketing.
- Forms fail honestly: real await, an error line with the phone number as
  fallback, and success states that only fire on success.
- Run the humanize pass (make_copy_and_media_human) on every outward artifact,
  including admin strings and setup cards.

## Handoff

The deliverable to the owner is a short message series, not a wall: one message
per page (each link unfurls its OG card), the admin link with login, a numbered
list of accounts to create at their own pace, and the explicit split between
"yours to change in the app" and "text me and I'll change it same-day". The
operator handbook — gated behind the same login — repeats all of it in plain
English with a decisions list. Keep secrets out of the message that carries the
link; send the password separately.
