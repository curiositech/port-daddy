/**
 * GET /account/shipwright — the Shipwright chat page (MVP v1).
 *
 * Session-gated storefront surface in the ch20 Story-Linework design (tokens
 * single-sourced from account-page.ts). Unlike every other storefront page,
 * THIS page carries client JS — a chat needs it (streamed tokens, keyboard
 * UX, copy/download of the emitted pd-fleet.yml). The CSP relaxation is
 * scoped to exactly this route via a per-request nonce: `script-src
 * 'nonce-…'` admits the one server-rendered inline script and nothing else.
 * The run/transcript/account pages keep their script-free CSP untouched.
 *
 * XSS posture: chat content (user-authored AND model-emitted) is rendered
 * exclusively through DOM textContent — never innerHTML — so neither party
 * can inject markup. The only HTML on the page is the server-rendered shell.
 *
 * PR-OPENING (grand-plan §shipwright-pr-open): a roster that VALIDATES gets an
 * "Open PR" deck — a plain HTML form POST to /v1/shipwright/open-pr, no client
 * JS in the submission path. The page renders the form ONCE, server-side, into
 * a <template>: the installation <select> only ever contains installations
 * GitHub says the signed-in user owns (listUserInstallations — the
 * billing-page tenancy idiom), so the user never submits an id the server did
 * not offer. The client script merely CLONES the template into each panel
 * whose verdict is valid and fills the hidden yaml field; the server
 * re-validates everything on POST regardless. When the installation list is
 * unavailable (no GitHub App, degraded GitHub) the deck degrades to an honest
 * note and the copy/download path still works.
 */

import type { Env } from './types.js';
import type { UserRow } from './db.js';
import {
  resolveSession,
  listUserInstallations,
  type UserInstallation,
} from './auth-github.js';
import { randomHex } from './crypto.js';
import { HEAD, TOKENS } from './account-page.js';
import { SHIPWRIGHT_RETENTION_DAYS } from './retention-sweep.js';

/** Minimal HTML-escape for interpolated user data (XSS guard). */
function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CSS = `
${TOKENS}
html,body{height:100%}
body{display:flex;flex-direction:column}
.site-header{display:flex;justify-content:space-between;align-items:baseline;gap:20px;padding:14px 40px;background:var(--surface-base);border-bottom:2px solid var(--border-strong);flex:none}
.sh-brand{display:flex;align-items:baseline;gap:10px;font-weight:700;font-size:17px;letter-spacing:-.01em;color:var(--text-primary);text-decoration:none}
.sh-mark{color:var(--cobalt);font-family:"IBM Plex Mono",monospace;font-weight:600;font-size:19px}
.sh-links{display:flex;gap:18px;align-items:baseline}
.sh-links a{font-family:"IBM Plex Mono",monospace;font-size:13.5px;font-weight:600}
.masthead{flex:none;max-width:980px;width:100%;margin:0 auto;padding:18px 24px 0}
.masthead .eyebrow{display:block;margin-bottom:6px}
.masthead h1{font-size:clamp(24px,3vw,34px);font-weight:700;letter-spacing:-.03em;line-height:1.05}
.masthead h1 .accent{color:var(--cobalt)}
/* the honesty strip — teal inset stripe, same voice as the login page */
.honesty{margin-top:12px;background:var(--surface-card);border:1px solid var(--hair);padding:10px 16px;box-shadow:inset 3px 0 0 var(--teal)}
.honesty p{font-size:13.5px;line-height:1.5;color:var(--text-secondary)}
.honesty b{color:var(--text-primary)}
.chat{flex:1;min-height:0;max-width:980px;width:100%;margin:0 auto;padding:0 24px;display:flex;flex-direction:column}
.log{flex:1;min-height:0;overflow-y:auto;padding:18px 2px 12px;display:flex;flex-direction:column;gap:14px}
.msg{max-width:72ch;border:1px solid var(--hair-strong);padding:12px 16px;font-size:15px;line-height:1.6;white-space:normal}
.msg .who{display:block;font-family:"IBM Plex Mono",monospace;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;margin-bottom:6px}
.msg p{white-space:pre-wrap;overflow-wrap:break-word;margin:0 0 8px}
.msg p:last-child{margin-bottom:0}
.msg-user{align-self:flex-end;background:var(--surface-strong)}
.msg-user .who{color:var(--text-muted)}
.msg-ship{align-self:flex-start;background:var(--surface-raised);border-left:3px solid var(--cobalt)}
.msg-ship .who{color:var(--cobalt)}
.msg-error{align-self:flex-start;border-left:3px solid var(--error)}
.msg-error .who{color:var(--error)}
.musing{font-family:"IBM Plex Mono",monospace;font-size:12.5px;color:var(--text-ghost)}
/* fenced pd-fleet.yml panel: mono slab + copy/download deck */
.yamlbox{border:2px solid var(--border-strong);margin:10px 0}
.yamlbox .bar{display:flex;justify-content:space-between;align-items:center;gap:10px;border-bottom:2px solid var(--border-strong);padding:7px 12px;background:var(--surface-strong)}
.yamlbox .bar .fn{font-family:"IBM Plex Mono",monospace;font-size:12.5px;font-weight:700;letter-spacing:.06em}
.yamlbox .bar .acts{display:flex;gap:8px}
.yamlbox button{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:700;letter-spacing:.04em;padding:4px 10px;border:1px solid var(--hair-strong);background:transparent;cursor:pointer}
.yamlbox button:hover{border-color:var(--border-strong)}
.yamlbox pre{overflow-x:auto;padding:12px 14px;font-family:"IBM Plex Mono",monospace;font-size:12.5px;line-height:1.55;max-height:340px;overflow-y:auto}
/* validation badge — the deterministic verdict, never the model's say-so */
.v-badge{display:block;font-family:"IBM Plex Mono",monospace;font-size:11.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:7px 12px;border-bottom:1px solid var(--hair-strong)}
.v-badge.v-ok{color:var(--health);background:var(--surface-card);box-shadow:inset 3px 0 0 var(--health)}
.v-badge.v-bad{color:var(--error);background:var(--surface-card);box-shadow:inset 3px 0 0 var(--error)}
.v-badge.v-pending{color:var(--text-ghost)}
.v-errs{margin:0;padding:8px 14px 8px 30px;background:var(--surface-card);border-bottom:1px solid var(--hair-strong);font-family:"IBM Plex Mono",monospace;font-size:11.5px;color:var(--error);line-height:1.6}
.codebox{overflow-x:auto;border:1px solid var(--hair-strong);padding:10px 12px;font-family:"IBM Plex Mono",monospace;font-size:12.5px;line-height:1.55;margin:8px 0}
/* empty state teaches (unified-design-language law 5) */
.empty{border:1px dashed var(--hair-strong);padding:20px 22px;margin-top:16px}
.empty .e-title{font-weight:700;font-size:16px}
.empty p{font-size:14px;color:var(--text-secondary);line-height:1.6;margin-top:6px;max-width:64ch}
.composer{flex:none;border-top:2px solid var(--border-strong);padding:12px 0 16px;background:var(--surface-base)}
.composer form{display:flex;gap:10px;align-items:flex-end}
.composer textarea{flex:1;min-height:52px;max-height:160px;resize:vertical;border:2px solid var(--border-strong);background:var(--surface-raised);padding:10px 12px;font-size:15px;line-height:1.5}
.composer button[type=submit]{font-family:"IBM Plex Mono",monospace;font-size:14px;font-weight:700;letter-spacing:.02em;padding:12px 20px;border:2px solid var(--border-strong);background:var(--cobalt);color:var(--on-accent);cursor:pointer}
.composer button[type=submit]:hover{background:var(--border-strong);color:var(--surface-base)}
.composer button[type=submit][disabled]{opacity:.5;cursor:wait}
.composer .hints{display:flex;justify-content:space-between;gap:10px;margin-top:6px;flex-wrap:wrap}
.composer .hint{font-family:"IBM Plex Mono",monospace;font-size:11.5px;color:var(--text-ghost)}
.composer .clear{font-family:"IBM Plex Mono",monospace;font-size:11.5px;font-weight:600;color:var(--error);background:none;border:none;cursor:pointer;text-decoration:underline;text-underline-offset:3px;padding:0}
/* the Open-PR deck inside a validated yaml panel — plain form, no JS submit */
.prform{display:flex;flex-wrap:wrap;gap:8px;align-items:center;border-top:1px solid var(--hair-strong);padding:10px 12px;background:var(--surface-card)}
.prform .pr-label{flex-basis:100%;font-family:"IBM Plex Mono",monospace;font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)}
.prform select,.prform input[type=text]{border:1px solid var(--hair-strong);background:var(--surface-raised);padding:6px 8px;font-family:"IBM Plex Mono",monospace;font-size:12.5px;min-width:0}
.prform input[type=text]{flex:1 1 180px}
.prform button[type=submit]{font-family:"IBM Plex Mono",monospace;font-size:12.5px;font-weight:700;letter-spacing:.03em;padding:7px 14px;border:2px solid var(--border-strong);background:var(--cobalt);color:var(--on-accent);cursor:pointer}
.prform button[type=submit]:hover{background:var(--border-strong);color:var(--surface-base)}
.prform .pr-note{flex-basis:100%;font-size:12.5px;color:var(--text-muted);line-height:1.5}
.pr-unavail{border-top:1px solid var(--hair-strong);padding:10px 12px;background:var(--surface-card);font-size:12.5px;color:var(--text-secondary);line-height:1.55}
.notice-strip{margin-top:12px;background:var(--surface-card);border:1px solid var(--hair);padding:10px 16px;font-size:13.5px;line-height:1.55;box-shadow:inset 3px 0 0 var(--amber)}
@media (max-width:640px){.site-header{padding:12px 16px}.masthead,.chat{padding-left:14px;padding-right:14px}.msg{max-width:100%}.composer form{flex-direction:column;align-items:stretch}}
`;

/**
 * The one inline script this route's CSP admits (via nonce). Plain ES5-ish
 * DOM code, no template literals (this string lives inside one), no external
 * deps. All chat content flows through textContent — never innerHTML.
 */
const CLIENT_JS = `
(function () {
  'use strict';
  var log = document.getElementById('log');
  var form = document.getElementById('composer');
  var input = document.getElementById('input');
  var sendBtn = document.getElementById('send');
  var clearBtn = document.getElementById('clear');
  var emptyState = document.getElementById('empty');
  var FENCE = '\\u0060\\u0060\\u0060';
  var busy = false;

  function scrollDown() { log.scrollTop = log.scrollHeight; }

  function stripThink(text) {
    // deepseek-style reasoning: hide complete <think> blocks; while a block is
    // still open mid-stream, show a musing indicator instead of raw chain.
    var open = text.indexOf('<think>');
    var out = text.replace(/<think>[\\s\\S]*?<\\/think>/g, '').replace(/^\\s+/, '');
    if (open >= 0 && text.indexOf('</think>', open) < 0) {
      return { text: text.slice(0, open), musing: true };
    }
    return { text: out, musing: false };
  }

  function splitBlocks(text) {
    var parts = [];
    var i = 0;
    for (;;) {
      var s = text.indexOf(FENCE, i);
      if (s < 0) { parts.push({ kind: 'text', v: text.slice(i) }); break; }
      var nl = text.indexOf('\\n', s);
      var e = nl < 0 ? -1 : text.indexOf(FENCE, nl);
      if (e < 0) { parts.push({ kind: 'text', v: text.slice(i) }); break; }
      parts.push({ kind: 'text', v: text.slice(i, s) });
      var lang = text.slice(s + 3, nl).trim().toLowerCase();
      parts.push({ kind: 'code', lang: lang, v: text.slice(nl + 1, e).replace(/\\s+$/, '') });
      i = e + 3;
    }
    return parts;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function yamlPanel(code, verdict) {
    var box = el('div', 'yamlbox');
    var bar = el('div', 'bar');
    bar.appendChild(el('span', 'fn', 'pd-fleet.yml'));
    var acts = el('div', 'acts');
    var copy = el('button', null, 'Copy');
    copy.type = 'button';
    copy.addEventListener('click', function () {
      navigator.clipboard.writeText(code).then(function () {
        copy.textContent = 'Copied';
        setTimeout(function () { copy.textContent = 'Copy'; }, 1500);
      });
    });
    var dl = el('button', null, 'Download');
    dl.type = 'button';
    dl.addEventListener('click', function () {
      var blob = new Blob([code], { type: 'text/yaml' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'pd-fleet.yml';
      a.click();
      URL.revokeObjectURL(a.href);
    });
    acts.appendChild(copy);
    acts.appendChild(dl);
    bar.appendChild(acts);
    box.appendChild(bar);
    // Honest verdict FROM THE DETERMINISTIC PARSER — never the model's own
    // claim. verdict is undefined only while a live stream is still running
    // and the server hasn't sent its final pdYamlVerdict marker yet.
    var badge = el('div', 'v-badge v-pending', 'Validating\\u2026');
    if (verdict) {
      if (verdict.valid) {
        badge.className = 'v-badge v-ok';
        var n = (verdict.ships && verdict.ships.length) || 0;
        badge.textContent = 'Validates \\u2713 \\u2014 ' + n + (n === 1 ? ' ship parses clean' : ' ships parse clean');
      } else {
        badge.className = 'v-badge v-bad';
        badge.textContent = 'Invalid \\u2717 \\u2014 ' + (verdict.message || 'the parser rejected this roster');
      }
    }
    box.appendChild(badge);
    if (verdict && !verdict.valid && verdict.errors && verdict.errors.length) {
      var errList = el('ul', 'v-errs');
      for (var k = 0; k < verdict.errors.length; k++) {
        var eItem = verdict.errors[k];
        errList.appendChild(el('li', null, (eItem.field || 'yaml') + ': ' + (eItem.message || 'invalid')));
      }
      box.appendChild(errList);
    }
    var pre = el('pre');
    pre.appendChild(el('code', null, code));
    box.appendChild(pre);
    // The Open-PR deck: cloned from the server-rendered template, ONLY onto a
    // panel whose deterministic verdict is valid. Client-side UX only — the
    // server re-validates on POST, so hiding/showing here gates nothing.
    if (verdict && verdict.valid) {
      var tpl = document.getElementById('prform-tpl');
      if (tpl && tpl.content && tpl.content.firstElementChild) {
        var deck = tpl.content.firstElementChild.cloneNode(true);
        var yfield = deck.querySelector('textarea[name=yaml]');
        if (yfield) yfield.value = code;
        box.appendChild(deck);
      }
    } else {
      var note = el('p', 'musing',
        'Fix the roster until the badge is green - the Open PR deck appears only on a ' +
        'roster the parser accepts. You can always copy or download and commit by hand.');
      box.appendChild(note);
    }
    return box;
  }

  function fillBody(node, content, verdicts) {
    while (node.childNodes.length > 1) node.removeChild(node.lastChild); // keep .who
    var st = stripThink(content);
    var parts = splitBlocks(st.text);
    var yamlIdx = 0;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.kind === 'code' && (p.lang === 'yaml' || p.lang === 'yml')) {
        // Positional match: the i-th yaml/yml fence here is the i-th verdict
        // the server computed with the identical fence scan (shipwright.ts's
        // extractFencedYamlBlocks) — no id is persisted to link them.
        var v = verdicts && verdicts[yamlIdx] ? verdicts[yamlIdx] : null;
        yamlIdx++;
        node.appendChild(yamlPanel(p.v, v));
      } else if (p.kind === 'code') {
        var cb = el('div', 'codebox');
        cb.appendChild(el('code', null, p.v));
        node.appendChild(cb);
      } else {
        var chunks = p.v.split(/\\n{2,}/);
        for (var j = 0; j < chunks.length; j++) {
          var t = chunks[j].replace(/^\\s+|\\s+$/g, '');
          if (t) node.appendChild(el('p', null, t));
        }
      }
    }
    if (st.musing) node.appendChild(el('p', 'musing', 'the Shipwright is musing\\u2026'));
    return node;
  }

  function addMsg(role, content, verdicts) {
    if (emptyState) { emptyState.remove(); emptyState = null; }
    var who = role === 'user' ? 'You' : 'Shipwright';
    var cls = role === 'user' ? 'msg msg-user' : 'msg msg-ship';
    if (role === 'error') { who = 'Trouble'; cls = 'msg msg-ship msg-error'; }
    var node = el('div', cls);
    node.appendChild(el('span', 'who', who));
    fillBody(node, content, verdicts);
    log.appendChild(node);
    scrollDown();
    return node;
  }

  function setBusy(b) {
    busy = b;
    sendBtn.disabled = b;
    input.disabled = b;
    if (!b) input.focus();
  }

  function loadHistory() {
    fetch('/v1/shipwright/history').then(function (r) { return r.json(); }).then(function (d) {
      var msgs = (d && d.messages) || [];
      for (var i = 0; i < msgs.length; i++) addMsg(msgs[i].role, msgs[i].content, msgs[i].yaml);
    }).catch(function () { /* empty state stays */ });
  }

  function send(text) {
    setBusy(true);
    addMsg('user', text);
    var live = addMsg('assistant', '');
    var acc = '';
    fetch('/v1/shipwright/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    }).then(function (res) {
      var ctype = res.headers.get('Content-Type') || '';
      if (ctype.indexOf('text/event-stream') < 0) {
        return res.json().then(function (d) {
          live.remove();
          if (d && d.reply) { addMsg('assistant', d.reply, d.yaml); }
          else { addMsg('error', (d && d.error) || 'The Shipwright did not answer.'); }
        });
      }
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = '';
      // Filled from the server's final synthetic 'pdYamlVerdict' SSE line
      // (shipwright.ts's flush()) -- arrives after every real token, before
      // the stream closes, so it's set by the time r.done fires below.
      var pendingVerdict = null;
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            live.remove();
            if (acc.replace(/<think>[\\s\\S]*?<\\/think>/g, '').trim()) { addMsg('assistant', acc, pendingVerdict); }
            else { addMsg('error', 'The Shipwright went quiet mid-sentence. Try again.'); }
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
              if (o && o.pdYamlVerdict) { pendingVerdict = o.pdYamlVerdict; continue; }
              var tok = typeof o.response === 'string' ? o.response
                : (o.choices && o.choices[0] && o.choices[0].delta && o.choices[0].delta.content) || '';
              if (tok) { acc += tok; fillBody(live, acc, null); scrollDown(); }
            } catch (e) { /* partial line; ignore */ }
          }
          return pump();
        });
      }
      return pump();
    }).catch(function () {
      live.remove();
      addMsg('error', 'Could not reach the relay. Check your connection and try again.');
    }).then(function () { setBusy(false); });
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (busy) return;
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    send(text);
  });

  input.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      form.requestSubmit();
    }
  });

  clearBtn.addEventListener('click', function () {
    if (busy) return;
    if (!window.confirm('Delete this whole conversation from the relay?')) return;
    fetch('/v1/shipwright/clear', { method: 'POST' }).then(function () {
      window.location.reload();
    });
  });

  loadHistory();
  input.focus();
})();
`;

// ── Open-PR deck (shipwright-pr-open) ────────────────────────────────────────

export interface ShipwrightPageView {
  /** null = could not establish the list (no token / GitHub error) — honest note. */
  installations: UserInstallation[] | null;
  /** Whitelisted notice key from ?notice=, or null. */
  notice: string | null;
}

/**
 * The ONLY notices this page renders — a fixed whitelist keyed by the codes
 * the open-pr form dialect 303s back with. Raw query text is never echoed.
 * (Success needs no notice: a successful form POST 303s straight to the PR.)
 */
export const SHIPWRIGHT_NOTICES: Record<string, string> = {
  pr_unconfigured: 'Opening PRs is unavailable: the GitHub App is not configured on this relay. Copy or download the YAML and commit it by hand.',
  cross_origin: 'Cross-origin request refused — use the Open PR button on this page.',
  bad_request: 'That request did not make sense — no PR was opened. Check the repo field (owner/name) and try again.',
  bad_json: 'That request did not make sense — no PR was opened. Try again.',
  invalid_yaml: 'That roster does not validate, so no PR was opened. The server re-checks every roster itself — fix the YAML until the badge is green.',
  not_from_chat: 'That YAML is not a roster the Shipwright emitted in your conversation, so no PR was opened.',
  forbidden: 'That installation is not yours — GitHub decides ownership, and it said no. No PR was opened.',
  repo_not_installed: 'The Port Daddy Fleet GitHub App is not installed on that repository (or it belongs to a different installation). Install it there, then try again.',
  github_error: 'GitHub had a problem — no PR was opened. Try again shortly.',
};

/**
 * Server-render the Open-PR deck ONCE into a <template> the client clones into
 * each panel whose verdict is valid. Tenancy shape (the billing-page idiom):
 * the <select> holds only installations GitHub attributes to the signed-in
 * user, so the form can never submit an id the server did not offer — and the
 * POST re-verifies ownership server-side anyway. Degraded and empty states
 * stay honest instead of rendering a dead button.
 */
export function renderPrTemplate(installations: UserInstallation[] | null): string {
  if (installations === null) {
    return `<template id="prform-tpl"><div class="pr-unavail"><b>Open PR unavailable:</b> your GitHub App
    installations could not be listed just now, so the button is not shown (never guessed). Copy or
    download the YAML and commit it by hand — or reload to retry.</div></template>`;
  }
  if (installations.length === 0) {
    return `<template id="prform-tpl"><div class="pr-unavail"><b>One step first:</b> install the Port Daddy
    Fleet GitHub App on your repository, then reload — the Shipwright can then open the PR for you.
    Until then, copy or download the YAML and commit it by hand.</div></template>`;
  }
  const options = installations
    .map((i) => `<option value="${i.id}">${esc(i.accountLogin ?? `installation ${i.id}`)}</option>`)
    .join('');
  return `<template id="prform-tpl"><form class="prform" method="post" action="/v1/shipwright/open-pr">
    <span class="pr-label">Open the PR from here — validated rosters only</span>
    <select name="installationId" aria-label="GitHub App installation">${options}</select>
    <input type="text" name="repo" placeholder="owner/repo" required pattern="[A-Za-z0-9_.\\-]+/[A-Za-z0-9_.\\-]+" aria-label="Repository (owner/name)">
    <textarea name="yaml" hidden></textarea>
    <button type="submit">Open PR</button>
    <span class="pr-note">Commits pd-fleet.yml to a <b>fresh branch</b> of that repo and opens a PR — never a
    push to an existing branch, never a merge; your review stays the gate. Prefer your own hands?
    Copy or download above and commit it yourself.</span>
  </form></template>`;
}

/** Render the page shell. `nonce` admits the one inline script under CSP. */
export function renderShipwrightPage(user: UserRow, nonce: string, view: ShipwrightPageView): string {
  const noticeText = view.notice ? SHIPWRIGHT_NOTICES[view.notice] : undefined;
  const noticeHtml = noticeText
    ? `<div class="notice-strip" role="status">${noticeText}</div>`
    : '';
  return `<!DOCTYPE html><html lang="en"><head><title>Port Daddy — Shipwright</title>${HEAD}<style>${CSS}</style></head><body>
<header class="site-header">
  <a class="sh-brand" href="/account"><span class="sh-mark" aria-hidden="true">pd</span>Port Daddy</a>
  <nav class="sh-links" aria-label="Account">
    <a href="/account">Account</a>
    <a href="/account/runs">Fleet runs</a>
    <a href="/account/mercy">Mercy</a>
  </nav>
</header>
<section class="masthead">
  <span class="eyebrow">portdaddy.dev · account · shipwright</span>
  <h1>The <span class="accent rec">Shipwright</span> — design your fleet</h1>
  <div class="honesty">
    <p><b>Honest limits:</b> the Shipwright designs your <b>pd-fleet.yml</b> in conversation, and once
    a roster <b>validates</b> it can <b>open the PR in your own repo</b> at your click — always a fresh
    branch + PR into a repo whose GitHub App installation you own; it never pushes to existing
    branches, never merges, and cannot read your repo. Your review stays the gate. Conversations stay
    on this account only, are yours to export or delete, and are pruned after
    ${SHIPWRIGHT_RETENTION_DAYS} days.</p>
  </div>
  ${noticeHtml}
</section>
<main class="chat">
  <div id="log" class="log" aria-live="polite" aria-label="Conversation with the Shipwright">
    <div id="empty" class="empty">
      <div class="e-title">The Shipwright is aboard, ${esc(user.display_name || user.login)}.</div>
      <p>Tell it about your repository (owner/name, language, what the project is) and what you want a
      fleet of AI ships to watch — review PRs? hunt security holes? imagine products? It will propose a
      bespoke roster (reviewers, ideation ships, a purser with graft skills), then draft a complete
      <b>pd-fleet.yml</b> you can copy or download.</p>
    </div>
  </div>
  <div class="composer">
    <form id="composer">
      <textarea id="input" rows="2" placeholder="Describe your repo and what the fleet should do…" aria-label="Message the Shipwright" maxlength="4000"></textarea>
      <button id="send" type="submit">Send</button>
    </form>
    <div class="hints">
      <span class="hint">Enter to send · Shift+Enter for a new line</span>
      <button id="clear" class="clear" type="button">Delete conversation</button>
    </div>
  </div>
</main>
${renderPrTemplate(view.installations)}
<script nonce="${nonce}">${CLIENT_JS}</script>
</body></html>`;
}

/**
 * GET /account/shipwright — session-gated; 302 to /login when signed out.
 * CSP note: `script-src 'nonce-…'` is deliberately present HERE and nowhere
 * else — the relaxation is scoped to this one route.
 */
export async function handleShipwrightPage(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) {
    return new Response(null, { status: 302, headers: { Location: '/login' } });
  }
  const rawNotice = new URL(request.url).searchParams.get('notice');
  const notice = rawNotice && SHIPWRIGHT_NOTICES[rawNotice] ? rawNotice : null;
  // The Open-PR deck needs the tenancy list; a GitHub hiccup degrades the deck
  // to an honest note (D12), never the whole chat page.
  let installations: UserInstallation[] | null = null;
  try {
    installations = await listUserInstallations(env, session);
  } catch {
    installations = null;
  }
  const nonce = randomHex(16);
  return new Response(renderShipwrightPage(session.user, nonce, { installations, notice }), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
        'font-src https://fonts.gstatic.com; img-src \'self\' data:; ' +
        `script-src 'nonce-${nonce}'; connect-src 'self'; ` +
        "form-action 'self' https://github.com; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
