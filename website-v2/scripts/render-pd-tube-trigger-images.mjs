import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const outDir = path.resolve('public/img/generated/pd-tube-playground')

const scenes = [
  {
    id: 'switchboard-hero',
    title: 'desk:requests',
    subtitle: 'Seven ordinary surfaces post to one local channel.',
    mode: 'switchboard',
  },
  {
    id: 'trigger-button',
    title: 'Internal deploy desk',
    subtitle: 'A button posts a request without opening a terminal.',
    mode: 'button',
  },
  {
    id: 'trigger-git-hook',
    title: 'VS Code commit',
    subtitle: 'A post-commit hook publishes while the branch is fresh.',
    mode: 'git',
  },
  {
    id: 'trigger-tests',
    title: 'Watch-mode tests',
    subtitle: 'A failed run becomes a structured request.',
    mode: 'tests',
  },
  {
    id: 'trigger-slack',
    title: '#deploys',
    subtitle: 'A team chat asks the local fleet for status.',
    mode: 'slack',
  },
  {
    id: 'trigger-webhook',
    title: 'Webhook intake',
    subtitle: 'An external POST lands on the local daemon.',
    mode: 'webhook',
  },
  {
    id: 'trigger-jupyter',
    title: 'Notebook run',
    subtitle: 'A finished cell asks the repo agent what changed.',
    mode: 'jupyter',
  },
  {
    id: 'trigger-scan',
    title: 'Scan intake',
    subtitle: 'A QR or barcode scan becomes a local agent task.',
    mode: 'scan',
  },
]

const palette = {
  light: {
    paper: '#f6f1e8',
    raised: '#fffaf0',
    sunken: '#ebe4d8',
    ink: '#151515',
    muted: '#5e5a52',
    rule: '#171717',
    blue: '#0052cc',
    cyan: '#0aa6a6',
    amber: '#c78918',
    red: '#b83b3b',
    green: '#16896f',
    code: '#111722',
    codeText: '#eef4ff',
  },
  dark: {
    paper: '#10151a',
    raised: '#161c22',
    sunken: '#0b1016',
    ink: '#f5f1e9',
    muted: '#b7b0a5',
    rule: '#eef1f5',
    blue: '#79adff',
    cyan: '#35d5c8',
    amber: '#f0b84b',
    red: '#ff736d',
    green: '#4bd6a6',
    code: '#060a0f',
    codeText: '#dbe8ff',
  },
}

function esc(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function chrome(title, children) {
  return `
    <div class="window">
      <div class="bar">
        <span></span><span></span><span></span>
        <strong>${esc(title)}</strong>
      </div>
      ${children}
    </div>
  `
}

function code(lines) {
  return `<pre>${lines.map((line) => esc(line)).join('\n')}</pre>`
}

function renderScene(scene, theme) {
  const p = palette[theme]
  const body = renderSceneBody(scene.mode, p)

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        * { box-sizing: border-box; }
        body {
          margin: 0;
          min-height: 100vh;
          display: grid;
          place-items: center;
          background: ${p.paper};
          color: ${p.ink};
          font-family: "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif;
        }
        .shot {
          position: relative;
          width: 960px;
          height: 540px;
          overflow: hidden;
          border: 3px solid ${p.rule};
          background:
            linear-gradient(90deg, color-mix(in srgb, ${p.rule} 8%, transparent) 1px, transparent 1px),
            linear-gradient(0deg, color-mix(in srgb, ${p.rule} 8%, transparent) 1px, transparent 1px),
            ${p.paper};
          background-size: 48px 48px;
        }
        .caption {
          position: absolute;
          left: 28px;
          right: 28px;
          top: 24px;
          display: flex;
          justify-content: space-between;
          gap: 18px;
          align-items: start;
          font-size: 16px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: ${p.muted};
          font-weight: 700;
        }
        .caption h1 {
          margin: 0;
          color: ${p.ink};
          font-size: 34px;
          line-height: 1;
          letter-spacing: 0;
          text-transform: none;
        }
        .stage {
          position: absolute;
          left: 28px;
          right: 28px;
          bottom: 26px;
          top: 96px;
          display: grid;
          gap: 18px;
        }
        .window, .panel, .card {
          border: 3px solid ${p.rule};
          background: ${p.raised};
          box-shadow: 10px 10px 0 color-mix(in srgb, ${p.rule} 16%, transparent);
        }
        .bar {
          height: 42px;
          border-bottom: 3px solid ${p.rule};
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 14px;
          background: ${p.sunken};
          font-size: 15px;
          color: ${p.muted};
        }
        .bar span {
          width: 12px;
          height: 12px;
          display: inline-block;
          border: 2px solid ${p.rule};
          background: ${p.blue};
        }
        .bar span:nth-child(2) { background: ${p.amber}; }
        .bar span:nth-child(3) { background: ${p.green}; }
        .bar strong {
          margin-left: auto;
          color: ${p.ink};
          font-size: 14px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .grid { display: grid; gap: 16px; }
        .cols-2 { grid-template-columns: 1fr 1fr; }
        .cols-3 { grid-template-columns: repeat(3, 1fr); }
        .row { display: flex; align-items: center; gap: 12px; }
        .button {
          border: 3px solid ${p.rule};
          background: ${p.blue};
          color: white;
          padding: 18px 22px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          text-align: center;
        }
        .ghost {
          border: 2px solid ${p.rule};
          padding: 10px 12px;
          color: ${p.muted};
          background: ${p.paper};
          font-weight: 700;
        }
        pre {
          margin: 0;
          padding: 18px;
          height: 100%;
          overflow: hidden;
          background: ${p.code};
          color: ${p.codeText};
          font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
          font-size: 20px;
          line-height: 1.45;
          border: 3px solid ${p.rule};
        }
        .message {
          border: 2px solid ${p.rule};
          background: ${p.paper};
          padding: 14px;
          display: grid;
          gap: 6px;
        }
        .message strong { color: ${p.blue}; }
        .meta-row {
          border-top: 2px solid ${p.rule};
          border-bottom: 2px solid ${p.rule};
          padding: 7px 0;
          color: ${p.muted};
          font-size: 14px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .line {
          height: 10px;
          background: ${p.sunken};
          border: 2px solid ${p.rule};
        }
        .pulse {
          height: 8px;
          background: linear-gradient(90deg, ${p.blue}, ${p.cyan}, ${p.green});
          border: 2px solid ${p.rule};
        }
        .qr {
          width: 150px;
          height: 150px;
          background:
            linear-gradient(90deg, ${p.rule} 10px, transparent 10px) 0 0/30px 30px,
            linear-gradient(${p.rule} 10px, transparent 10px) 0 0/30px 30px,
            ${p.raised};
          border: 3px solid ${p.rule};
        }
        .switch-card {
          min-height: 120px;
          padding: 16px;
          display: grid;
          align-content: space-between;
        }
        .switch-card b { font-size: 22px; }
        .switch-card em {
          color: ${p.muted};
          font-style: normal;
          font-weight: 700;
        }
      </style>
    </head>
    <body>
      <div class="shot">
        <div class="caption">
          <div>
            <h1>${esc(scene.title)}</h1>
            <div>${esc(scene.subtitle)}</div>
          </div>
        </div>
        <div class="stage">${body}</div>
      </div>
    </body>
  </html>`
}

function renderSceneBody(mode, p) {
  switch (mode) {
    case 'switchboard':
      return `
        <div class="grid cols-3">
          ${['Internal tool button', 'Git post-commit', 'Test runner', 'Slack message', 'Webhook event', 'Notebook cell'].map((label, index) => `
            <div class="window switch-card">
              <b>${label}</b>
              <div class="pulse"></div>
              <em>posts to desk:requests</em>
            </div>
          `).join('')}
        </div>
      `
    case 'button':
      return chrome('Operations Console', `
        <div class="grid cols-2" style="padding: 22px;">
          <div class="grid">
            <div class="meta-row">Release desk · staging</div>
            <h2 style="font-size: 44px; line-height: 1; margin: 0;">Deploy copy update?</h2>
            <div class="button">Ask local agent</div>
          </div>
          <div class="panel grid" style="padding: 18px;">
            <b>Request preview</b>
            <div class="line"></div><div class="line"></div><div class="line" style="width: 70%;"></div>
            <div class="pulse"></div>
            <span class="ghost">channel desk:requests</span>
          </div>
        </div>
      `)
    case 'git':
      return `
        <div class="grid cols-2" style="height: 100%;">
          ${chrome('VS Code · commit hook', code([
            'routes/tube.ts',
            '  + publish(channel, payload)',
            '  + await pd.tube.reply(...)',
            '',
            '$ git commit -m \"wire tube trigger\"',
            '> post-commit: pd tube desk:requests',
            '> sender git-post-commit',
          ]))}
          <div class="panel grid" style="padding: 18px;">
            <div class="meta-row">Repository event · post-commit</div>
            <h2 style="font-size: 38px; margin: 0;">Commit landed while context is fresh.</h2>
            <div class="pulse"></div>
            <span class="ghost">Concierge sees commit + branch</span>
          </div>
        </div>
      `
    case 'tests':
      return `
        <div class="grid cols-2" style="height: 100%;">
          ${chrome('Test watcher', code([
            'FAIL  tests/relay.spec.ts',
            '  ✕ resumes after reconnect',
            '',
            'Expected seq 42',
            'Received seq 41',
            '',
            '> pd tube desk:requests',
            '> sender test-runner',
          ]))}
          <div class="panel grid" style="padding: 18px;">
            <div class="meta-row" style="color:${p.red};">Test watcher · red run</div>
            <h2 style="font-size: 38px; margin: 0;">The failure asks for diagnosis.</h2>
            <div class="line"></div>
            <div class="button" style="background:${p.red};">send failing trace</div>
          </div>
        </div>
      `
    case 'slack':
      return chrome('Team chat bridge', `
        <div class="grid cols-2" style="padding: 20px;">
          <div class="grid">
            <div class="message"><strong>Riley · #deploys</strong><span>@concierge status on staging?</span></div>
            <div class="message"><strong>Slack bridge</strong><span>Posting to desk:requests as slack-bot.</span></div>
            <div class="pulse"></div>
          </div>
          <div class="panel grid" style="padding: 18px;">
            <div class="meta-row">Bridge only · local agent stays in control</div>
            <h2 style="font-size: 38px; margin: 0;">Chat sends a request. The local fleet answers.</h2>
          </div>
        </div>
      `)
    case 'webhook':
      return chrome('Webhook deliveries', `
        <div class="grid cols-2" style="padding: 20px;">
          <div class="grid">
            ${['POST /deploy.finished 200', 'POST /issue.opened 200', 'POST /build.failed 200'].map((row) => `<div class="message"><strong>${row}</strong><span>Forwarded to local daemon</span></div>`).join('')}
          </div>
          <div class="panel grid" style="padding: 18px;">
            <div class="meta-row">Delivery stream · incoming POST</div>
            <h2 style="font-size: 38px; margin: 0;">External services become threaded agent work.</h2>
            <div class="pulse"></div>
          </div>
        </div>
      `)
    case 'jupyter':
      return `
        <div class="grid cols-2" style="height: 100%;">
          ${chrome('Notebook.ipynb', code([
            'df = run_experiment(seed=17)',
            'score = summarize(df)',
            '',
            'score',
            '0.938',
            '',
            '!pd tube desk:requests --send',
            ' \"notebook: run complete\"',
          ]))}
          <div class="panel grid" style="padding: 18px;">
            <div class="meta-row">Notebook event · cell complete</div>
            <h2 style="font-size: 38px; margin: 0;">A notebook asks what changed.</h2>
            <div class="pulse"></div>
          </div>
        </div>
      `
    case 'scan':
      return chrome('Inventory scanner', `
        <div class="grid cols-2" style="padding: 20px;">
          <div class="row" style="align-items: flex-start;">
            <div class="qr"></div>
            <div class="grid" style="flex: 1;">
              <div class="meta-row">Scanner intake · accepted</div>
              <h2 style="font-size: 36px; line-height: 1; margin: 0;">SKU-00428 requests repo context.</h2>
              <div class="pulse"></div>
            </div>
          </div>
          <div class="panel grid" style="padding: 18px;">
            <b>Local event</b>
            <div class="line"></div><div class="line"></div><div class="line" style="width: 64%;"></div>
            <span class="ghost">sender qr-scan</span>
          </div>
        </div>
      `)
    default:
      return '<div></div>'
  }
}

mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1 })

for (const scene of scenes) {
  for (const theme of ['light', 'dark']) {
    await page.setContent(renderScene(scene, theme), { waitUntil: 'load' })
    const suffix = theme === 'dark' ? '-dark' : ''
    const file = path.join(outDir, `${scene.id}${suffix}.png`)
    await page.locator('.shot').screenshot({ path: file })
    console.log(file)
  }
}

await browser.close()
