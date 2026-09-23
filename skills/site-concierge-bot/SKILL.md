---
name: site-concierge-bot
description: Add an owner-aware AI concierge chatbot to a Cloudflare-hosted site. Visitors get a cheap, budget-capped, site-grounded assistant in the brand's voice; the owner (via Cloudflare Access OIDC) gets a bigger model, a business skill bundle (listings, posts, pricing, photo coaching, draft replies, teaching), and a PR-based sandbox for proposing site changes. Use when adding a chatbot, site assistant, "can I help you" widget, or owner copilot to any Curiositech-built web app on Cloudflare Workers. NOT for standalone chat apps, non-Cloudflare hosting, or bots that need long-term memory/CRM integration.
---

# Site Concierge Bot

One chatbot, two people. Visitors get a counter clerk; the owner gets a
copilot. Reference implementation: whiskeyfundwoodworking.com
(`~/coding/arbor_www` — `app/api/chat/route.ts`, `lib/assistant.ts`,
`components/assistant/chat-widget.tsx`).

## Architecture

```
Widget (client) ──POST /api/chat──▶ Worker route
                                      ├─ isOwner? (Cf-Access-Jwt-Assertion → JWKS verify)
                                      ├─ budget gate (KV counters)
                                      ├─ model router (cheap ⇄ big)
                                      └─ env.AI.run(model, messages)
```

Bindings (wrangler.jsonc): `"ai": {"binding": "AI"}` +
`kv_namespaces: [{binding: "ASSISTANT_KV", id: …}]`
(`npx wrangler kv namespace create ASSISTANT_KV`).
On OpenNext, reach them via `getCloudflareContext().env`.

## The non-negotiables

1. **Two system prompts, never one.** Visitor prompt is grounded ONLY on an
   explicit SITE_FACTS constant (keep in sync with llms.txt) and refuses
   off-topic with brand-voice deflection to the owner's email. Owner prompt
   adds the voice guide, business context, and teaching persona.
2. **LLM routing = cost control.** Visitor: `@cf/meta/llama-3.1-8b-instruct`,
   max_tokens ≤ 400. Owner: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`,
   max_tokens ≤ 1024. Escalate to Claude via AI Gateway only for owner tasks
   that visibly fail on Llama (rare).
3. **Hard budget ceiling in KV, not vibes.** Site-wide daily counters
   (visitor 300/day, owner 500/day) + per-IP hourly cap (20/hr) with TTLd
   keys. Over budget → charming refusal + mailto. At these caps, Workers AI
   free allocation usually covers everything; worst case ≈ $10/month.
   State the ceiling in the client contract.
4. **Owner auth = Cloudflare Access OIDC, verified server-side.** Verify
   `Cf-Access-Jwt-Assertion` (RS256) against
   `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`; check `aud` +
   `exp`. Env: `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` — both empty ⇒ owner
   mode off (safe default). localhost ⇒ owner (dev play). Setup: Cloudflare
   Zero Trust → Access → add app for the site path, allow-list the owner's
   email, copy the AUD tag.
5. **Sandbox = PRs, never prod.** Owner site-change requests become pull
   requests for the developer to review (`GITHUB_REPO` var +
   `GITHUB_TOKEN` secret; disabled with an honest message until set).
   The bot must say it can only *propose*. Previews via Cloudflare branch
   deploys are the play area.
6. **Draft, don't send.** Customer-reply skill outputs drafts and says so
   in the output. No autonomous outbound anything.
7. **The skill bundle is data, not code.** `OWNER_SKILLS` array:
   `{id, label, hint, prompt}`. Each prompt is a complete brief (structure,
   voice, what to ask for when info is missing) so cheap models perform.
   Widget renders them as toggle chips; POST includes `skill: id`; route
   appends the playbook to the system prompt. Standard bundle: marketplace
   listing writer, social post drafter, photo coach, pricing coach
   (materials × 2.5 floor + "you're underpricing" pushback), customer-reply
   drafter, web/DB teacher (map concepts to what the owner already knows).

## Owner onboarding (put this in the site's launch kit)

- The chat bubble is the same for everyone; you get the toolbox when logged
  in through the access page (or on localhost).
- Chips are playbooks: tap one, then just talk. "Price a piece" will ask
  for lumber cost and hours; "Draft a customer reply" wants the pasted
  message. Chips stay lit until tapped off.
- It writes in your voice on purpose. Edit anything before it goes out —
  especially prices.
- Ask it anything about how your own site works; it teaches with your
  site's code as the example.
- It cannot touch the live site. "Propose" turns into a PR a human reviews.

## Gotchas

- OpenNext + Workers: fs is unavailable at runtime — ground facts in
  constants, not file reads.
- Add the widget to `layout.tsx` (site-wide), position `fixed bottom-right`,
  `z-40` so lightboxes/dialogs (z-50) cover it.
- CSP: `connect-src 'self'` is enough — Workers AI runs server-side.
- Trim history server-side (last ~12 messages, 4k chars each) — the client
  is not a trust boundary.
- Test the budget gate by lowering the cap to 2 locally, not by burning 300
  requests.
