/**
 * apps/relay/src/snipe-chat-page.ts — the Engineman's chat window (G′5, view).
 *
 *   GET /account/seamanship/chat   (session; 302 → /login when signed out)
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHY THIS IS A SEPARATE MODULE, AND WHAT IT EXPORTS FOR THE PAGE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The chat window belongs on the Seamanship page. It is built here as a
 * self-contained fragment plus a standalone mount so that landing it does not
 * require editing the catalog page in the same change:
 *
 *   · {@link SNIPE_CHAT_PANEL_CSS} — the panel's styles.
 *   · {@link renderSnipeChatPanel} — the panel's markup, nonce-free.
 *   · {@link SNIPE_CHAT_CLIENT_JS} — the panel's behavior, to be emitted in
 *     exactly one `<script nonce="…">` tag by whichever page hosts it.
 *
 * Dropping the panel into the Seamanship page is then three additive lines —
 * the CSS into that page's stylesheet, the markup into a section, the script
 * into its nonce tag — with no fork of the chat and no second copy of these
 * styles. Until that happens the window is a real, reachable, complete surface
 * at its own route, which is a shipped feature rather than a promise.
 *
 * ── CSP ─────────────────────────────────────────────────────────────────────
 *
 * Streaming a reply token by token needs client JS, and client JS on this
 * origin means a nonce. The relaxation is scoped to exactly the route that
 * needs it: `script-src 'nonce-…'` plus `connect-src 'self'`, and nothing else
 * widens. Every other storefront page stays script-free.
 *
 * ── EVERY CHARACTER THE AGENT PRODUCES IS TEXT ──────────────────────────────
 *
 * Model output is untrusted input. It reaches the DOM through `textContent`
 * only — never `innerHTML`, never a template that interpolates it. The one
 * structural thing the client does with a reply is split fenced blocks out of
 * it, and each block's contents go into a `<pre>` by `textContent` as well.
 *
 * ── THE BUDGET IS PRINTED ON THE PAGE ───────────────────────────────────────
 *
 * The daily cap is stated in the honesty strip, so a 429 is never the first an
 * operator hears of it. A budget the user discovers only by hitting it reads as
 * a malfunction; a budget stated up front reads as a rule.
 */

import type { Env } from './types.js';
import { resolveSession } from './auth-github.js';
import { randomHex } from './crypto.js';
import { HEAD, TOKENS } from './account-page.js';
import { dailyCaps } from './chat-spend.js';
import { MAX_MESSAGE_CHARS } from './chat-engine.js';
import type { UserRow } from './db.js';

/**
 * Local HTML escape. Every storefront page owns its own on purpose: no page can
 * be made unsafe by an edit to somebody else's module.
 */
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Notices this page will render, keyed by the query value that selects them. */
export const SNIPE_CHAT_NOTICES: Record<string, string> = {
  cross_origin: 'That request did not come from this site, so it was refused.',
  spend_cap: "Today's chat budget is spent. It resets at UTC midnight.",
};

/**
 * The panel's styles.
 *
 * The flag is VICTOR — "I require assistance". Chosen because it is what this
 * surface actually is: the watch below decks asking for a hand with work that
 * keeps coming back. A decorative flag would have been a lie told in signal
 * code, which is worse than no flag.
 */
export const SNIPE_CHAT_PANEL_CSS = `
.snipe-panel{display:flex;flex-direction:column;gap:14px;min-height:0}
.snipe-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.flag-victor{width:28px;height:20px;border:1px solid var(--hair-strong);flex:0 0 auto;
  background:
    linear-gradient(to bottom right,transparent calc(50% - 3px),var(--error) calc(50% - 3px),var(--error) calc(50% + 3px),transparent calc(50% + 3px)),
    linear-gradient(to bottom left,transparent calc(50% - 3px),var(--error) calc(50% - 3px),var(--error) calc(50% + 3px),transparent calc(50% + 3px)),
    var(--flag-white)}
.snipe-head h2{font-size:19px;letter-spacing:-.01em;margin:0}
.flag-mean{font-family:var(--mono);font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-left:auto}
.snipe-honesty{border-left:var(--lw-stripe) solid var(--teal);padding:10px 14px;background:var(--raise);
  font-size:13.5px;line-height:1.55;color:var(--muted)}
.snipe-honesty strong{color:var(--fg)}
.snipe-notice{border-left:var(--lw-stripe) solid var(--amber);padding:10px 14px;background:var(--raise);font-size:13.5px}
.snipe-log{display:flex;flex-direction:column;gap:14px;overflow-y:auto;max-height:56vh;
  border:1px solid var(--hair);padding:16px;background:var(--raise)}
.snipe-msg{display:flex;flex-direction:column;gap:6px;max-width:44em}
.snipe-msg .who{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}
.snipe-msg .body{white-space:pre-wrap;word-break:break-word;font-size:14.5px;line-height:1.6}
.snipe-msg.user{align-self:flex-end;text-align:right}
.snipe-msg.user .body{background:var(--raise2);border:1px solid var(--hair);padding:8px 12px}
.snipe-msg.error .body{color:var(--error)}
.snipe-proposal{border:1px solid var(--hair-strong);background:var(--bg);margin-top:6px}
.snipe-proposal pre{margin:0;padding:12px;overflow-x:auto;font-family:var(--mono);font-size:12.5px;line-height:1.5}
.snipe-verdict{font-family:var(--mono);font-size:11.5px;padding:6px 12px;border-top:1px solid var(--hair)}
.snipe-verdict.ok{color:var(--health)}
.snipe-verdict.dupe{color:var(--amber)}
.snipe-empty{border:1px dashed var(--hair-strong);padding:18px;color:var(--muted);font-size:14px;line-height:1.6}
.snipe-empty .e-title{color:var(--fg);font-weight:600;margin-bottom:6px}
.snipe-composer form{display:flex;gap:10px;align-items:flex-end}
.snipe-composer textarea{flex:1;font:inherit;font-size:14.5px;padding:10px 12px;background:var(--raise);
  color:var(--fg);border:1px solid var(--hair-strong);resize:vertical}
.snipe-composer button{font-family:var(--mono);font-size:12px;text-transform:uppercase;letter-spacing:.1em;
  padding:11px 18px;background:var(--cobalt);color:var(--flag-white);border:0;cursor:pointer}
.snipe-composer button[disabled]{opacity:.5;cursor:not-allowed}
.snipe-hints{display:flex;justify-content:space-between;gap:12px;margin-top:8px;
  font-family:var(--mono);font-size:11.5px;color:var(--muted)}
.snipe-hints button{background:none;border:0;color:var(--muted);font:inherit;text-decoration:underline;cursor:pointer}
`;

/**
 * The panel's markup. Pure — no Request, no I/O — so a test can render it and
 * assert on the honesty copy without standing up a session.
 *
 * @param caps The daily budget in force, printed so the cap is never a surprise.
 * @param notice A key of {@link SNIPE_CHAT_NOTICES}, or null.
 */
export function renderSnipeChatPanel(
  caps: { messages: number; tokens: number },
  notice: string | null,
): string {
  const noticeHtml =
    notice && SNIPE_CHAT_NOTICES[notice]
      ? `<div class="snipe-notice">${esc(SNIPE_CHAT_NOTICES[notice] as string)}</div>`
      : '';
  return `<section class="snipe-panel" aria-labelledby="snipe-h">
  <div class="snipe-head">
    <span class="flag-victor" role="img" aria-label="Signal flag Victor"></span>
    <h2 id="snipe-h">Snipe &mdash; the Engineman</h2>
    <span class="flag-mean">Victor &middot; I require assistance</span>
  </div>
  <div class="snipe-honesty">
    Snipe looks at what your work keeps hand-rolling and asks whether a reusable skill
    would end it. <strong>Talking here writes nothing, anywhere.</strong> A proposal becomes a
    skill only when you approve it and merge the pull request that approval authorizes &mdash;
    private to you, scoped to your repo, by default.
    <br>
    <strong>Daily budget:</strong> ${caps.messages} turns per day, and a token allowance sized to match.
    It resets at UTC midnight. A refused turn stores nothing and spends nothing.
  </div>
  ${noticeHtml}
  <div class="snipe-log" id="snipe-log" role="log" aria-live="polite">
    <div class="snipe-empty" id="snipe-empty">
      <div class="e-title">Nothing proposed yet.</div>
      Tell Snipe which repo you are working in and what keeps coming back &mdash; the fixture you
      rebuild, the migration dance, the checklist that lives in someone's head. It will name the
      friction before it proposes anything, and it will tell you plainly when nothing warrants a skill.
    </div>
  </div>
  <div class="snipe-composer">
    <form id="snipe-form">
      <textarea id="snipe-input" rows="2" maxlength="${MAX_MESSAGE_CHARS}"
        aria-label="Message the Engineman"
        placeholder="Which repo, and what keeps coming back?"></textarea>
      <button id="snipe-send" type="submit">Send</button>
    </form>
    <div class="snipe-hints">
      <span>Enter to send &middot; Shift+Enter for a new line</span>
      <button id="snipe-clear" type="button">Delete conversation</button>
    </div>
  </div>
</section>`;
}

/**
 * The panel's behavior. Emitted in exactly one nonce'd `<script>` by the host
 * page.
 *
 * Reads the SSE stream by hand (an `EventSource` cannot POST), recognizes the
 * server's synthetic `pdProposalVerdict` line as a verdict rather than a token,
 * and renders every character of model output through `textContent`.
 */
export const SNIPE_CHAT_CLIENT_JS = `(function(){
  var log = document.getElementById('snipe-log');
  var form = document.getElementById('snipe-form');
  var input = document.getElementById('snipe-input');
  var sendBtn = document.getElementById('snipe-send');
  var clearBtn = document.getElementById('snipe-clear');
  var empty = document.getElementById('snipe-empty');
  if (!log || !form || !input) return;
  var busy = false;

  function scrollDown(){ log.scrollTop = log.scrollHeight; }
  function hideEmpty(){ if (empty && empty.parentNode) empty.parentNode.removeChild(empty); }

  // Split a reply into plain runs and fenced 'skill' blocks. The same dumb
  // fence scan the server uses, so panels and verdicts always agree on which
  // blocks exist.
  function splitBlocks(text){
    var parts = [], re = /\\u0060\\u0060\\u0060([A-Za-z0-9_-]*)\\r?\\n([\\s\\S]*?)\\u0060\\u0060\\u0060/g;
    var last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parts.push({ lang: null, text: text.slice(last, m.index) });
      parts.push({ lang: (m[1] || '').toLowerCase(), text: m[2] || '' });
      last = re.lastIndex;
    }
    if (last < text.length) parts.push({ lang: null, text: text.slice(last) });
    return parts;
  }

  function fillBody(el, text, verdicts){
    var body = el.querySelector('.body');
    body.textContent = '';
    var extras = el.querySelectorAll('.snipe-proposal');
    for (var k = 0; k < extras.length; k++) extras[k].remove();
    var parts = splitBlocks(text.replace(/<think>[\\s\\S]*?<\\/think>/g, ''));
    var skillIndex = 0;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.lang === 'skill') {
        var box = document.createElement('div');
        box.className = 'snipe-proposal';
        var pre = document.createElement('pre');
        pre.textContent = p.text;           // model output is text, always
        box.appendChild(pre);
        var v = verdicts && verdicts[skillIndex];
        if (v) {
          var vd = document.createElement('div');
          vd.className = 'snipe-verdict ' + (v.ok ? 'ok' : 'dupe');
          vd.textContent = (v.ok ? 'NEW \\u00b7 ' : 'ALREADY PROPOSED \\u00b7 ') + v.message;
          box.appendChild(vd);
        }
        el.appendChild(box);
        skillIndex++;
      } else if (p.text.trim()) {
        body.textContent += p.text;
      }
    }
  }

  function addMsg(role, text, verdicts){
    hideEmpty();
    var el = document.createElement('div');
    el.className = 'snipe-msg ' + role;
    var who = document.createElement('div');
    who.className = 'who';
    who.textContent = role === 'user' ? 'You' : (role === 'error' ? 'Relay' : 'Snipe');
    var body = document.createElement('div');
    body.className = 'body';
    el.appendChild(who); el.appendChild(body);
    log.appendChild(el);
    fillBody(el, text || '', verdicts || null);
    scrollDown();
    return el;
  }

  function setBusy(b){ busy = b; sendBtn.disabled = b; input.disabled = b; if (!b) input.focus(); }

  fetch('/v1/snipe/history').then(function(r){ return r.json(); }).then(function(d){
    var msgs = (d && d.messages) || [];
    for (var i = 0; i < msgs.length; i++) addMsg(msgs[i].role, msgs[i].content, null);
  }).catch(function(){ /* the empty state stays, and teaches */ });

  function send(text){
    setBusy(true);
    addMsg('user', text);
    var live = addMsg('assistant', '');
    var acc = '';
    fetch('/v1/snipe/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    }).then(function(res){
      var ctype = res.headers.get('Content-Type') || '';
      if (ctype.indexOf('text/event-stream') < 0) {
        return res.json().then(function(d){
          live.remove();
          if (res.status === 429) { addMsg('error', (d && d.error) || 'Daily budget spent.'); return; }
          if (d && d.reply) addMsg('assistant', d.reply, d.proposals);
          else addMsg('error', (d && d.error) || 'Snipe did not answer.');
        });
      }
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
      // Set from the server's final synthetic 'pdProposalVerdict' line, which
      // arrives after every real token and before the stream closes.
      var pending = null;
      function pump(){
        return reader.read().then(function(r){
          if (r.done) {
            live.remove();
            if (acc.replace(/<think>[\\s\\S]*?<\\/think>/g, '').trim()) addMsg('assistant', acc, pending);
            else addMsg('error', 'Snipe went quiet mid-sentence. Try again.');
            return;
          }
          buf += dec.decode(r.value, { stream: true });
          var nl;
          while ((nl = buf.indexOf('\\n')) >= 0) {
            var line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line.indexOf('data:') !== 0) continue;
            var payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              var o = JSON.parse(payload);
              if (o && o.pdProposalVerdict) { pending = o.pdProposalVerdict; continue; }
              var tok = typeof o.response === 'string' ? o.response
                : (o.choices && o.choices[0] && o.choices[0].delta && o.choices[0].delta.content) || '';
              if (tok) { acc += tok; fillBody(live, acc, null); scrollDown(); }
            } catch (e) { /* partial line; ignore */ }
          }
          return pump();
        });
      }
      return pump();
    }).catch(function(){
      live.remove();
      addMsg('error', 'Could not reach the relay. Check your connection and try again.');
    }).then(function(){ setBusy(false); });
  }

  form.addEventListener('submit', function(ev){
    ev.preventDefault();
    if (busy) return;
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    send(text);
  });

  input.addEventListener('keydown', function(ev){
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); form.requestSubmit(); }
  });

  if (clearBtn) clearBtn.addEventListener('click', function(){
    if (busy) return;
    fetch('/v1/snipe/clear', { method: 'POST' }).then(function(){ log.innerHTML = ''; })
      .catch(function(){ addMsg('error', 'Could not clear the conversation.'); });
  });
})();`;

/** The standalone window's full document. Pure; testable without a Request. */
export function renderSnipeChatPage(
  user: UserRow,
  nonce: string,
  caps: { messages: number; tokens: number },
  notice: string | null,
): string {
  return `<!doctype html><html lang="en"><head>${HEAD}
<title>Snipe &mdash; Port Daddy</title>
<style>${TOKENS}
.wrap{max-width:900px;margin:0 auto;padding:40px 24px 64px;display:flex;flex-direction:column;gap:22px}
.crumb{font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase}
.crumb a{color:var(--cobalt)}
${SNIPE_CHAT_PANEL_CSS}</style>
</head><body>
<div class="wrap">
  <nav class="crumb"><a href="/account/seamanship">&larr; Seamanship</a> &middot; signed in as ${esc(user.login)}</nav>
  ${renderSnipeChatPanel(caps, notice)}
</div>
<script nonce="${nonce}">${SNIPE_CHAT_CLIENT_JS}</script>
</body></html>`;
}

/**
 * GET /account/seamanship/chat — session-gated; 302 to /login when signed out.
 *
 * CSP note: `script-src 'nonce-…'` is present here because a streaming reply
 * needs client JS, and the relaxation is scoped to this one route.
 */
export async function handleSnipeChatPage(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return new Response(null, { status: 302, headers: { Location: '/login' } });

  const raw = new URL(request.url).searchParams.get('notice');
  const notice = raw && SNIPE_CHAT_NOTICES[raw] ? raw : null;
  const nonce = randomHex(16);
  return new Response(renderSnipeChatPage(session.user, nonce, dailyCaps(env), notice), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; img-src 'self' data:; " +
        `script-src 'nonce-${nonce}'; connect-src 'self'; ` +
        "form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
