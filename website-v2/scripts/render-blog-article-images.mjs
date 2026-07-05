import { mkdirSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const outRoot = resolve(scriptDir, '../public/img/generated')
const tmpRoot = resolve(scriptDir, '../public/img/generated/.tmp-blog-art')

const themes = {
  light: {
    bg: '#f6f1e8',
    raised: '#fffaf0',
    inset: '#ebe4d8',
    ink: '#151515',
    muted: '#5e5a52',
    rule: '#171717',
    blue: '#0052cc',
    blueSoft: '#dbeafe',
    teal: '#0aa6a6',
    tealSoft: '#d7f3ef',
    amber: '#c78918',
    amberSoft: '#f7e5bd',
    red: '#b83b3b',
    redSoft: '#f6d2cf',
    violet: '#7257d8',
    violetSoft: '#e4ddff',
    code: '#111722',
    codeText: '#eef4ff',
    grid: 'rgba(21,21,21,0.08)',
  },
  dark: {
    bg: '#0f1419',
    raised: '#161c22',
    inset: '#0a0f15',
    ink: '#f5f1e9',
    muted: '#b7b0a5',
    rule: '#e9edf2',
    blue: '#79adff',
    blueSoft: '#15345f',
    teal: '#35d5c8',
    tealSoft: '#123d3b',
    amber: '#f0b84b',
    amberSoft: '#4b3513',
    red: '#ff736d',
    redSoft: '#54201f',
    violet: '#b49cff',
    violetSoft: '#2e275c',
    code: '#05090f',
    codeText: '#dbe8ff',
    grid: 'rgba(245,241,233,0.08)',
  },
}

const scenes = [
  { id: 'bond-pricing/bond-pricing-hero', width: 1376, height: 768, type: 'bondHero' },
  { id: 'bond-pricing/bond-pricing-villains', width: 1200, height: 896, type: 'bondFailures' },
  { id: 'pr-reviews-itself/hero', width: 1376, height: 768, type: 'prHero' },
  { id: 'pr-reviews-itself/code-reviewer', width: 1024, height: 1024, type: 'reviewRole', role: 'code-reviewer', accent: 'blue' },
  { id: 'pr-reviews-itself/red-team', width: 1024, height: 1024, type: 'reviewRole', role: 'red-team', accent: 'red' },
  { id: 'pr-reviews-itself/test-author', width: 1024, height: 1024, type: 'reviewRole', role: 'test-author', accent: 'teal' },
  { id: 'pr-reviews-itself/tautology-sniffer', width: 1024, height: 1024, type: 'reviewRole', role: 'tautology-sniffer', accent: 'violet' },
  { id: 'pr-reviews-itself/tenderfoot', width: 1024, height: 1024, type: 'reviewRole', role: 'tenderfoot', accent: 'amber' },
  { id: 'pr-reviews-itself/augur', width: 1024, height: 1024, type: 'reviewRole', role: 'augur', accent: 'blue' },
]

function esc(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function css(p) {
  return `
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; background: ${p.bg}; }
    body {
      font-family: "IBM Plex Sans", "IBM Plex Mono", Arial, sans-serif;
      color: ${p.ink};
    }
    .shot {
      position: relative;
      overflow: hidden;
      width: var(--w);
      height: var(--h);
      background:
        linear-gradient(90deg, ${p.grid} 1px, transparent 1px),
        linear-gradient(${p.grid} 1px, transparent 1px),
        ${p.bg};
      background-size: 38px 38px;
      border: 4px solid ${p.rule};
    }
    .frame { position: absolute; inset: 42px; }
    .label {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      border-left: 3px solid currentColor;
      border-right: 3px solid currentColor;
      padding: 8px 14px;
      font: 800 18px/1 "IBM Plex Mono", monospace;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: ${p.muted};
    }
    .title {
      margin: 22px 0 0;
      max-width: 780px;
      font: 900 76px/0.92 "IBM Plex Sans", Arial, sans-serif;
      letter-spacing: 0;
      color: ${p.ink};
    }
    .window {
      border: 3px solid ${p.rule};
      background: ${p.raised};
      box-shadow: 14px 14px 0 ${p.inset};
      overflow: hidden;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 44px;
      border-bottom: 3px solid ${p.rule};
      padding: 0 16px;
      background: ${p.inset};
      font: 800 15px/1 "IBM Plex Mono", monospace;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: ${p.muted};
    }
    .dot { width: 12px; height: 12px; border: 2px solid ${p.rule}; background: ${p.teal}; }
    .dot:nth-child(2) { background: ${p.amber}; }
    .dot:nth-child(3) { background: ${p.red}; }
    .panel {
      border: 3px solid ${p.rule};
      background: ${p.raised};
      padding: 24px;
    }
    .panel.soft { background: ${p.inset}; }
    .small {
      font: 800 17px/1.2 "IBM Plex Mono", monospace;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: ${p.muted};
    }
    .copy {
      font: 700 24px/1.25 "IBM Plex Sans", Arial, sans-serif;
      color: ${p.ink};
    }
    .mono {
      font: 700 18px/1.35 "IBM Plex Mono", monospace;
      color: ${p.ink};
    }
    .line { height: 13px; background: ${p.rule}; opacity: 0.75; }
    .line.blue { background: ${p.blue}; opacity: 1; }
    .line.teal { background: ${p.teal}; opacity: 1; }
    .line.amber { background: ${p.amber}; opacity: 1; }
    .line.red { background: ${p.red}; opacity: 1; }
    .chip {
      display: inline-flex;
      align-items: center;
      border: 2px solid ${p.rule};
      padding: 8px 12px;
      font: 800 15px/1 "IBM Plex Mono", monospace;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      background: ${p.raised};
      color: ${p.ink};
    }
    .arrow {
      position: relative;
      height: 4px;
      background: ${p.blue};
    }
    .arrow::after {
      content: "";
      position: absolute;
      right: -1px;
      top: -8px;
      border-left: 16px solid ${p.blue};
      border-top: 10px solid transparent;
      border-bottom: 10px solid transparent;
    }
    .code {
      border: 3px solid ${p.rule};
      background: ${p.code};
      color: ${p.codeText};
      padding: 18px;
      font: 700 18px/1.45 "IBM Plex Mono", monospace;
      white-space: pre-wrap;
    }
    .accent-blue { --accent: ${p.blue}; --soft: ${p.blueSoft}; }
    .accent-teal { --accent: ${p.teal}; --soft: ${p.tealSoft}; }
    .accent-amber { --accent: ${p.amber}; --soft: ${p.amberSoft}; }
    .accent-red { --accent: ${p.red}; --soft: ${p.redSoft}; }
    .accent-violet { --accent: ${p.violet}; --soft: ${p.violetSoft}; }
  `
}

function chrome(title, inner) {
  return `
    <div class="window">
      <div class="bar">
        <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        <strong>${esc(title)}</strong>
      </div>
      ${inner}
    </div>
  `
}

function bondHero(p) {
  return `
    <div class="frame">
      <div class="label">Bonded Commons</div>
      <div class="title">Price the cleanup, not the tokens.</div>
      <div style="position:absolute; right:0; top:46px; width:570px;">
        ${chrome('risk pricing board', `
          <div style="padding:26px; display:grid; gap:18px;">
            <div class="panel soft" style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
              ${metric('cleanup floor', '$420', p.blue)}
              ${metric('scope multiplier', '2.4x', p.amber)}
              ${metric('reputation', '-18%', p.teal)}
              ${metric('insurer bid', '$71', p.red)}
            </div>
            <div class="panel" style="height:210px; position:relative; overflow:hidden;">
              <div class="small">priced bond</div>
              <div style="position:absolute; left:34px; right:34px; bottom:34px; height:128px; display:flex; align-items:end; gap:22px;">
                ${bar('floor', 44, p.blue)}
                ${bar('scope', 108, p.amber)}
                ${bar('trust', 76, p.teal)}
                ${bar('cover', 92, p.red)}
              </div>
              <div style="position:absolute; left:32px; right:32px; top:78px;" class="arrow"></div>
            </div>
            <div class="code">bond = cleanup * scope - reputation + cover</div>
          </div>
        `)}
      </div>
      <div style="position:absolute; left:0; bottom:0; width:680px; display:grid; grid-template-columns:1fr 1fr; gap:18px;">
        ${riskCard('cleanup funded', 'breach pays for recovery', p.teal)}
        ${riskCard('risk visible', 'bond rises with blast radius', p.blue)}
      </div>
    </div>
  `
}

function metric(label, value, color) {
  return `
    <div style="border:3px solid ${color}; background:rgba(255,255,255,0.02); padding:16px;">
      <div class="small">${esc(label)}</div>
      <div style="margin-top:10px; font:900 42px/1 IBM Plex Sans,Arial,sans-serif;">${esc(value)}</div>
    </div>
  `
}

function bar(label, height, color) {
  return `
    <div style="display:grid; gap:10px; align-items:end; width:90px;">
      <div style="height:${height}px; border:3px solid ${color}; background:${color}; opacity:0.9;"></div>
      <div class="small" style="font-size:12px; text-align:center;">${esc(label)}</div>
    </div>
  `
}

function riskCard(title, body, color) {
  return `
    <div class="panel" style="border-color:${color}; min-height:132px;">
      <div class="small">${esc(title)}</div>
      <div class="copy" style="margin-top:14px;">${esc(body)}</div>
    </div>
  `
}

function bondFailures(p) {
  const failures = [
    ['Hoarder', 'claims everything, blocks everyone', 'claim wall', p.blue],
    ['Slow walker', 'holds the lane while time leaks', 'long timer', p.amber],
    ['Nuker', 'lands a small diff with a large blast radius', 'unsafe patch', p.red],
    ['Quitter', 'abandons state and makes cleanup human work', 'lost branch', p.teal],
  ]
  return `
    <div class="frame">
      <div class="label">Cleanup liabilities</div>
      <div style="margin-top:28px; display:grid; grid-template-columns:1fr 1fr; gap:24px;">
        ${failures.map(([title, body, scene, color]) => failurePanel(title, body, scene, color, p)).join('')}
      </div>
    </div>
  `
}

function failurePanel(title, body, scene, color, p) {
  return `
    <div class="panel" style="height:360px; border-color:${color}; display:grid; grid-template-rows:auto 1fr auto; gap:18px;">
      <div>
        <div class="small">${esc(title)}</div>
        <div class="copy" style="margin-top:8px;">${esc(body)}</div>
      </div>
      ${failureScene(scene, color, p)}
      <div class="line" style="background:${color}; width:72%;"></div>
    </div>
  `
}

function failureScene(scene, color, p) {
  if (scene === 'claim wall') {
    return `<div style="display:grid; grid-template-columns:repeat(5,1fr); gap:10px; align-content:center;">${Array.from({ length: 20 }, (_, i) => `<div style="height:28px; border:2px solid ${color}; background:${i % 3 === 0 ? color : p.inset};"></div>`).join('')}</div>`
  }
  if (scene === 'long timer') {
    return `<div style="position:relative; align-self:center; justify-self:center; width:180px; height:180px; border:8px solid ${color}; border-radius:50%;"><div style="position:absolute; left:84px; top:26px; width:8px; height:76px; background:${color}; transform-origin:bottom; transform:rotate(35deg);"></div><div style="position:absolute; left:84px; top:84px; width:70px; height:8px; background:${color};"></div></div>`
  }
  if (scene === 'unsafe patch') {
    return `<div class="code" style="align-self:center;">- auth/check.ts<br/>+ auth/check.ts<br/>+ migrate-all.ts<br/><span style="color:${color};">! broad write</span></div>`
  }
  return `<div style="display:grid; gap:14px; align-content:center;"><div class="code">branch: clean<br/>notes: missing<br/>reply: none</div><div style="height:32px; border:3px dashed ${color};"></div></div>`
}

function prHero(p) {
  const reviewCards = ['code', 'red', 'tests', 'tautology', 'docs', 'roadmap']
  return `
    <div class="frame">
      <div class="label">Pull request fleet</div>
      <div class="title" style="max-width:690px;">One push. Six critics. One readable case.</div>
      <div style="position:absolute; left:0; bottom:0; width:470px;">
        ${chrome('pull request #601', `
          <div style="padding:22px; display:grid; gap:14px;">
            <div class="line blue" style="width:92%;"></div>
            <div class="line" style="width:70%;"></div>
            <div class="code">+ session.claim(file)<br/>+ reviewer.vote()<br/>- silent merge</div>
          </div>
        `)}
      </div>
      <div style="position:absolute; left:510px; bottom:70px; width:180px;" class="arrow"></div>
      <div style="position:absolute; right:0; bottom:0; width:610px;">
        <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:14px;">
          ${reviewCards.map((card, i) => `<div class="panel" style="height:130px; border-color:${[p.blue,p.red,p.teal,p.violet,p.amber,p.blue][i]};"><div class="small">${esc(card)}</div><div class="line" style="margin-top:20px; width:${72 - i * 4}%; background:${[p.blue,p.red,p.teal,p.violet,p.amber,p.blue][i]};"></div><div class="line" style="margin-top:12px; width:${54 + i * 3}%;"></div></div>`).join('')}
        </div>
        <div class="panel" style="margin-top:18px; border-color:${p.teal};">
          <div class="small">consolidated finding</div>
          <div class="copy" style="margin-top:10px;">BLOCKING / CONCERN / NIT, with evidence attached.</div>
        </div>
      </div>
    </div>
  `
}

const roleData = {
  'code-reviewer': {
    label: 'code-reviewer',
    title: 'Severity-ranked review.',
    body: 'Diff, ADRs, house style, and one comment worth reading.',
    code: 'BLOCKING: ADR-0023 mismatch\nCONCERN: OpenAPI drift\nNIT: none',
  },
  'red-team': {
    label: 'red-team',
    title: 'Exploit attempted.',
    body: 'Trust-boundary changes get a scratch attack, not a hunch.',
    code: 'curl /tokens/forge\nexpect: 403\nresult: attack blocked',
  },
  'test-author': {
    label: 'test-author',
    title: 'Missing tests drafted.',
    body: 'Uncovered changed paths become a sibling branch with tests.',
    code: 'branch: auto-tests-2814\nadds: daemon sqlite case\nstatus: draft PR',
  },
  'tautology-sniffer': {
    label: 'tautology-sniffer',
    title: 'Reality, not self-pinning.',
    body: 'Changed tests are scored for whether they verify production truth.',
    code: 'score: 0.91\nfixture seeds same map\nadd sqlite integration',
  },
  tenderfoot: {
    label: 'tenderfoot',
    title: 'Fresh setup, no memory.',
    body: 'The docs are followed in a clean worktree until they work or fail.',
    code: 'README step 04\nmissing: token panel\nissue opened',
  },
  augur: {
    label: 'augur',
    title: 'Claims checked against canon.',
    body: 'Roadmap, ADRs, issues, and the diff are read together.',
    code: 'PR says closes #487\n#487 needs #492\nask: partial close?',
  },
}

function reviewRole(scene, p) {
  const data = roleData[scene.role]
  const accent = p[scene.accent]
  return `
    <div class="frame accent-${scene.accent}" style="inset:52px;">
      <div class="label">${esc(data.label)}</div>
      <div class="title" style="font-size:72px; max-width:740px;">${esc(data.title)}</div>
      <div class="copy" style="margin-top:22px; max-width:620px; color:${p.muted};">${esc(data.body)}</div>
      <div style="position:absolute; left:26px; right:26px; top:330px; height:300px;">
        <div style="position:absolute; left:0; top:126px; width:100%; height:5px; background:${accent};"></div>
        ${[0, 1, 2, 3].map((i) => `<div style="position:absolute; left:${i * 29}%; top:${i % 2 === 0 ? 70 : 160}px; width:150px; height:84px; border:3px solid ${accent}; background:${i % 2 === 0 ? p.raised : p.inset}; padding:15px;"><div class="line" style="width:${72 - i * 8}%; background:${accent}; opacity:1;"></div><div class="line" style="margin-top:12px; width:${48 + i * 8}%;"></div></div>`).join('')}
      </div>
      <div style="position:absolute; left:0; right:0; bottom:0; display:grid; grid-template-columns:1.05fr 0.95fr; gap:26px;">
        ${chrome('review lane', `
          <div style="padding:22px; display:grid; gap:18px;">
            <div class="line" style="width:86%;"></div>
            <div class="line" style="width:68%;"></div>
            <div class="line" style="width:76%; background:${accent}; opacity:1;"></div>
            <div class="line" style="width:50%;"></div>
          </div>
        `)}
        <div class="panel" style="border-color:${accent}; background:var(--soft);">
          <div class="small">evidence</div>
          <div class="code" style="margin-top:18px;">${esc(data.code)}</div>
        </div>
      </div>
    </div>
  `
}

function render(scene, themeName) {
  const p = themes[themeName]
  const body =
    scene.type === 'bondHero'
      ? bondHero(p)
      : scene.type === 'bondFailures'
        ? bondFailures(p)
        : scene.type === 'prHero'
          ? prHero(p)
          : reviewRole(scene, p)

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>${css(p)}</style>
      </head>
      <body>
        <div class="shot" style="--w:${scene.width}px; --h:${scene.height}px">
          ${body}
        </div>
      </body>
    </html>`
}

function convertToWebp(sourcePng, targetWebp) {
  execFileSync('magick', [sourcePng, '-quality', '86', targetWebp], { stdio: 'inherit' })
}

mkdirSync(tmpRoot, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })

for (const scene of scenes) {
  for (const themeName of ['light', 'dark']) {
    await page.setViewportSize({ width: scene.width, height: scene.height })
    await page.setContent(render(scene, themeName), { waitUntil: 'load' })
    const targetDir = join(outRoot, dirname(scene.id))
    mkdirSync(targetDir, { recursive: true })
    const suffix = themeName === 'dark' ? '-dark' : ''
    const pngPath = join(tmpRoot, `${scene.id.replaceAll('/', '-')}${suffix}.png`)
    const webpPath = join(outRoot, `${scene.id}${suffix}.webp`)
    await page.locator('.shot').screenshot({ path: pngPath })
    convertToWebp(pngPath, webpPath)
    unlinkSync(pngPath)
    console.log(webpPath)
  }
}

await browser.close()
