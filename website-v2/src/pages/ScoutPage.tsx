import { Link } from 'react-router-dom'
import {
  Bug,
  Camera,
  CheckCircle2,
  Chrome,
  Code2,
  Crosshair,
  Download,
  GitPullRequest,
  MonitorCheck,
  PackageCheck,
  Route,
  ShieldCheck,
  Store,
  Terminal,
  UploadCloud,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Footer } from '@/components/layout/Footer'
import scoutManifest from '../../../apps/pd-scout-extension/manifest.json'
import {
  BracketLabel,
  DocsCodeBlock,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
  SwissGrid,
  SwissGridItem,
} from '@/components/site/primitives'

const previewCommand = `git clone https://github.com/curiositech/port-daddy.git
cd port-daddy
pd setup
pd status`

const scoutVersion = scoutManifest.version
const scoutDownloadPath = `/downloads/pd-scout-chrome-${scoutVersion}.zip`
const scoutChecksumPath = `${scoutDownloadPath}.sha256`
const extensionPath = `apps/pd-scout-extension`
const packageCommand = `npm run package:scout-extension`

const brandAssets = [
  'Chrome toolbar icons: 16, 32, 48, and 128 px.',
  'Source Scout mark: Port Daddy glyph plus region-selection brackets.',
  'Chrome Web Store starter assets: 128 px store icon, 440 x 280 promo tile, 1400 x 560 marquee tile, and 1280 x 800 screenshot.',
]

const captureModes = [
  {
    title: 'Visible tab',
    description: 'Capture the exact browser view, URL, title, viewport, and page metadata.',
    icon: Camera,
  },
  {
    title: 'Draw a region',
    description: 'Select the part of the page that is wrong, then send only that rectangle with the screenshot.',
    icon: Crosshair,
  },
  {
    title: 'DOM context',
    description: 'On project pages, Scout samples selectors, XPath, text, bounds, and React debug source hints when available.',
    icon: Code2,
  },
]

const routingModes = [
  'Open a Port Daddy visual issue in the local daemon.',
  'Attach the screenshot through the daemon blob store.',
  'Publish the envelope on the visual-feedback channel.',
  'Optionally ask Port Daddy to spawn work for the task.',
]

const previewSteps = [
  {
    label: 'Preview 1',
    title: 'Install Port Daddy and start the local daemon',
    body:
      'Scout talks to the daemon on your machine. If the local control plane is not running, capture still looks nice but cannot open a Port Daddy issue.',
    code: previewCommand,
  },
  {
    label: 'Preview 2',
    title: 'Load the extension preview',
    body:
      'Download the preview ZIP or build it from the checkout. Chrome Developer Mode loads an unpacked folder; the ZIP is the Store upload shape.',
    code: `Download: ${scoutDownloadPath}
Or build: npm run package:scout-extension
Load unpacked: ${extensionPath}`,
  },
  {
    label: 'Preview 3',
    title: 'Capture any normal web page',
    body:
      'Open a page, click Port Daddy Scout, capture the page or draw a region, write the brief, and open the issue.',
    code: 'Daemon endpoint: published local endpoint',
  },
]

const releaseSteps = [
  {
    title: 'Package the extension',
    description:
      'Create the Chrome Web Store upload ZIP from only the runtime files: manifest, icons, popup, background service worker, and content script.',
    code: packageCommand,
    icon: PackageCheck,
  },
  {
    title: 'Upload it to Chrome',
    description:
      'Use the Chrome Web Store Developer Dashboard to upload the ZIP, then complete Store Listing, Privacy, Distribution, and Test instructions.',
    code: 'Developer Dashboard -> Add new item -> Choose file -> Upload',
    icon: UploadCloud,
  },
  {
    title: 'Submit, then update by version',
    description:
      'Submit for review. For each update, bump manifest.version, upload a fresh ZIP with all extension files, and submit that version for review.',
    code: 'manifest.version: 0.1.1 -> upload new ZIP -> submit for review',
    icon: Store,
  },
]

const worksNow = [
  'Unpacked Manifest V3 Chrome extension.',
  'Chrome Web Store-shaped preview ZIP with checksum and download manifest.',
  'Visible-tab screenshots through chrome.tabs.captureVisibleTab.',
  'Shadow-DOM region picker on ordinary web pages.',
  'Composer reopens after region selection with a captured badge and rectangle preview.',
  'Project picker populated from the local daemon.',
  'DOM selector, XPath, text, bounds, viewport, and URL capture.',
  'Blob-first screenshot upload plus POST /visual-tasks in the local daemon.',
  'Playwright repro for rectangle capture, DOM context, and visual-task payload shape.',
]

const notYet = [
  'No Chrome Web Store listing submitted yet.',
  'No signed, auto-updating public install until Store review is complete.',
  'Browser-restricted pages such as chrome:// cannot be captured.',
  'Third-party sites provide DOM hints, not source-code ownership.',
  'Cloud fleet routing depends on the configured Port Daddy backend; the local path is what works in this branch.',
]

function ScoutFlowGraphic() {
  return (
    <SurfacePanel elevation="quiet" padding="compact" className="space-y-[var(--space-4)]">
      <div className="flex items-center justify-between gap-[var(--space-3)]">
        <div className="space-y-[var(--space-1)]">
          <PanelEyebrow>Product preview</PanelEyebrow>
          <PanelTitle as="h2" size="nav">
            Browser evidence in, reviewable work out.
          </PanelTitle>
        </div>
        <Chrome className="h-[var(--space-6)] w-[var(--space-6)] text-[var(--brand-primary)]" aria-hidden="true" />
      </div>

      <picture className="relative block overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
        <img
          src="/img/generated/scout-extension-preview.png"
          alt="Port Daddy Scout showing a Chrome extension popup beside a selected web page region"
          className="aspect-[16/10] w-full object-cover"
          loading="eager"
        />
        <span className="absolute right-[var(--space-3)] top-[var(--space-3)] flex h-20 w-20 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-2">
          <img
            src="/logos/portdaddy-animated-lightmode.svg"
            alt="Animated Port Daddy radar mark"
            className="h-full w-full"
            loading="eager"
          />
        </span>
      </picture>

      <div className="grid grid-cols-2 border-2 border-[var(--border-strong)] md:grid-cols-4">
        {['Screenshot', 'DOM hints', 'Issue', 'Spawn'].map((label, index) => (
          <div
            key={label}
            className={`p-[var(--space-3)] ${
              index < 3 ? 'border-b-2 border-[var(--border-strong)] md:border-b-0 md:border-r-2' : ''
            }`}
          >
            <PanelEyebrow>{label}</PanelEyebrow>
          </div>
        ))}
      </div>
    </SurfacePanel>
  )
}

export function ScoutPage() {
  return (
    <div className="min-h-screen bg-[var(--surface-base)] selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]">
      <main id="main-content">
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SwissGrid className="items-center">
              <SwissGridItem span="wide">
                <div className="space-y-[var(--space-5)]">
                  <PanelEyebrow>Port Daddy Scout</PanelEyebrow>
                  <PanelTitle as="h1" size="hero" className="max-w-[13ch]">
                    Point at the bug. Send the fleet the evidence.
                  </PanelTitle>
                  <PanelBody className="max-w-[44rem] text-[length:var(--text-lg)]">
                    Scout is the Chrome extension for turning any web app you are
                    looking at into a Port Daddy visual task. It captures a
                    screenshot, optional rectangle, and DOM clues when the page
                    allows it, then opens a reviewable issue in your local daemon.
                  </PanelBody>
                  <div className="flex flex-wrap gap-[var(--space-3)]">
                    <Button asChild variant="primary" size="lg">
                      <a href={scoutDownloadPath} download>
                        Download preview ZIP
                        <Download size={16} aria-hidden="true" />
                      </a>
                    </Button>
                    <Button asChild variant="secondary" size="lg">
                      <a href="#does-it-work">
                        Does it work?
                        <CheckCircle2 size={16} aria-hidden="true" />
                      </a>
                    </Button>
                  </div>
                </div>
              </SwissGridItem>

              <SwissGridItem span="narrow">
                <ScoutFlowGraphic />
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </section>

        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <SwissGrid>
              <SwissGridItem span="narrow">
                <div className="space-y-[var(--section-intro-gap)]">
                  <BracketLabel>Capture</BracketLabel>
                  <PanelTitle as="h2" size="display" className="max-w-[12ch]">
                    The difference between a screenshot and a task.
                  </PanelTitle>
                  <PanelBody>
                    A picture is enough for a human to remember the complaint.
                    Scout adds the machine-readable context a spawned run can
                    actually use.
                  </PanelBody>
                </div>
              </SwissGridItem>

              <SwissGridItem span="body">
                <div className="grid gap-[var(--grid-gap)] md:grid-cols-3">
                  {captureModes.map(({ title, description, icon: Icon }) => (
                    <SurfacePanel key={title} elevation="quiet" className="space-y-[var(--space-4)]">
                      <Icon className="h-[var(--space-6)] w-[var(--space-6)] text-[var(--brand-primary)]" aria-hidden="true" />
                      <div className="space-y-[var(--space-2)]">
                        <PanelTitle as="h3" size="nav">
                          {title}
                        </PanelTitle>
                        <PanelBody size="compact" className="max-w-none">
                          {description}
                        </PanelBody>
                      </div>
                    </SurfacePanel>
                  ))}
                </div>
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </section>

        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <SwissGrid className="items-start">
              <SwissGridItem span="wide">
                <div className="space-y-[var(--section-intro-gap)]">
                  <BracketLabel>Routing</BracketLabel>
                  <PanelTitle as="h2" size="display" className="max-w-[12ch]">
                    The issue lands in Port Daddy, not in another forgotten tab.
                  </PanelTitle>
                  <PanelBody>
                    The extension posts one visual-task envelope to the daemon.
                    Port Daddy stores the image, records the context, and can
                    route it to the review queue or spawn work when the backend is
                    configured.
                  </PanelBody>
                </div>
              </SwissGridItem>

              <SwissGridItem span="narrow">
                <SurfacePanel tone="blue" className="space-y-[var(--space-4)]">
                  <Route className="h-[var(--space-6)] w-[var(--space-6)] text-[var(--brand-primary-foreground)]" aria-hidden="true" />
                  <PanelTitle as="h3" size="card" tone="primary">
                    One envelope, one place to inspect it.
                  </PanelTitle>
                  <div className="space-y-[var(--space-3)]">
                    {routingModes.map((item) => (
                      <div key={item} className="flex gap-[var(--space-3)]">
                        <CheckCircle2 className="mt-[0.15rem] h-[var(--space-4)] w-[var(--space-4)] shrink-0 text-[var(--brand-primary-foreground)]" aria-hidden="true" />
                        <PanelBody size="compact" tone="primary" className="max-w-none">
                          {item}
                        </PanelBody>
                      </div>
                    ))}
                  </div>
                </SurfacePanel>
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </section>

        <section id="preview" className="scroll-mt-[calc(var(--space-10)+var(--space-6))] border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="mb-[var(--space-6)] space-y-[var(--section-intro-gap)]">
              <BracketLabel>Preview</BracketLabel>
              <PanelTitle as="h2" size="display" className="max-w-[13ch]">
                Load it today. Do not pretend this is the final install.
              </PanelTitle>
              <PanelBody>
                The preview is real local plumbing: Chrome loads Scout from this
                checkout, Scout talks to your daemon, and the daemon opens the
                visual task. The real customer install is a Chrome Web Store
                release, described below.
              </PanelBody>
            </div>

            <div className="grid gap-[var(--grid-gap)] lg:grid-cols-3">
              {previewSteps.map((step) => (
                <SurfacePanel key={step.label} elevation="quiet" className="space-y-[var(--space-4)]">
                  <BracketLabel>{step.label}</BracketLabel>
                  <div className="space-y-[var(--space-2)]">
                    <PanelTitle as="h3" size="nav">
                      {step.title}
                    </PanelTitle>
                    <PanelBody size="compact" className="max-w-none">
                      {step.body}
                    </PanelBody>
                  </div>
                  <DocsCodeBlock code={step.code} language="text" label={step.label} />
                </SurfacePanel>
              ))}
            </div>

            <SurfacePanel className="mt-[var(--space-6)] grid gap-[var(--space-4)] lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)]">
              <div className="space-y-[var(--space-3)]">
                <PanelEyebrow>Preview steps</PanelEyebrow>
                <PanelTitle as="h3" size="card">
                  Where the folder goes, for now.
                </PanelTitle>
                <PanelBody className="max-w-none">
                  Open <code className="font-mono">chrome://extensions</code>,
                  enable Developer mode, click <strong>Load unpacked</strong>,
                  and choose <code className="font-mono">apps/pd-scout-extension</code>.
                  The popup resolves the published local endpoint from the running install, or
                  lets you paste one explicitly.
                </PanelBody>
              </div>
              <div className="grid gap-[var(--space-3)] sm:grid-cols-3">
                {[
                  ['1', 'Developer mode'],
                  ['2', 'Load unpacked'],
                  ['3', 'Open issue'],
                ].map(([number, label]) => (
                  <div key={label} className="border-2 border-[var(--border-strong)] p-[var(--space-4)]">
                    <div className="font-display text-[length:var(--type-panel-title-card-size)] font-black text-[var(--brand-primary)]">
                      {number}
                    </div>
                    <PanelEyebrow className="mt-[var(--space-2)]">{label}</PanelEyebrow>
                  </div>
                ))}
              </div>
            </SurfacePanel>
          </PageContainer>
        </section>

        <section id="release" className="scroll-mt-[calc(var(--space-10)+var(--space-6))] border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <SwissGrid>
              <SwissGridItem span="narrow">
                <div className="space-y-[var(--section-intro-gap)]">
                  <BracketLabel>Real release</BracketLabel>
                  <PanelTitle as="h2" size="display" className="max-w-[12ch]">
                    The grown-up install is the Chrome Web Store.
                  </PanelTitle>
                  <PanelBody>
                    Chrome already has the distribution machinery we need:
                    signed delivery, review, listing assets, privacy fields, and
                    automatic updates. Scout should graduate through that path,
                    not a README full of ritual.
                  </PanelBody>
                  <div className="flex flex-wrap gap-[var(--space-3)]">
                    <Button asChild variant="primary" size="lg">
                      <a href={scoutDownloadPath} download>
                        Download preview ZIP
                        <Download size={16} aria-hidden="true" />
                      </a>
                    </Button>
                    <Button asChild variant="secondary" size="lg">
                      <a href={scoutChecksumPath}>
                        Checksum
                        <ShieldCheck size={16} aria-hidden="true" />
                      </a>
                    </Button>
                  </div>
                </div>
              </SwissGridItem>

              <SwissGridItem span="body">
                <div className="grid gap-[var(--grid-gap)] lg:grid-cols-3">
                  {releaseSteps.map(({ title, description, code, icon: Icon }) => (
                    <SurfacePanel key={title} elevation="quiet" className="space-y-[var(--space-4)]">
                      <Icon className="h-[var(--space-6)] w-[var(--space-6)] text-[var(--brand-primary)]" aria-hidden="true" />
                      <div className="space-y-[var(--space-2)]">
                        <PanelTitle as="h3" size="nav">
                          {title}
                        </PanelTitle>
                        <PanelBody size="compact" className="max-w-none">
                          {description}
                        </PanelBody>
                      </div>
                      <DocsCodeBlock code={code} language="text" label={title} />
                    </SurfacePanel>
                  ))}
                </div>

                <SurfacePanel tone="blue" className="mt-[var(--space-6)] grid gap-[var(--space-4)] lg:grid-cols-[minmax(0,0.66fr)_minmax(0,1fr)]">
                  <div className="space-y-[var(--space-3)]">
                    <PanelEyebrow>Store readiness</PanelEyebrow>
                    <PanelTitle as="h3" size="card" tone="primary">
                      What still has to be true before public install.
                    </PanelTitle>
                  </div>
                  <div className="space-y-[var(--space-3)]">
                    {[
                      'A ZIP build step in CI, with only extension files included.',
                      `Preview artifact: ${scoutDownloadPath}.`,
                      'Final store copy, at least one real 1280 x 800 screenshot, and the promo tiles already in assets/store.',
                      'Privacy fields that say exactly what Scout captures: screenshot, URL, optional rectangle, and DOM hints.',
                      'A small trusted-tester rollout before the public listing goes live.',
                    ].map((item) => (
                      <div key={item} className="flex gap-[var(--space-3)]">
                        <CheckCircle2 className="mt-[0.15rem] h-[var(--space-4)] w-[var(--space-4)] shrink-0 text-[var(--brand-primary-foreground)]" aria-hidden="true" />
                        <PanelBody size="compact" tone="primary" className="max-w-none">
                          {item}
                        </PanelBody>
                      </div>
                    ))}
                  </div>
                </SurfacePanel>
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </section>

        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <SwissGrid className="items-start">
              <SwissGridItem span="narrow">
                <div className="space-y-[var(--section-intro-gap)]">
                  <BracketLabel>Chrome identity</BracketLabel>
                  <PanelTitle as="h2" size="display" className="max-w-[12ch]">
                    A browser extension needs a face.
                  </PanelTitle>
                  <PanelBody>
                    Scout is branded as a Port Daddy intake surface, not a loose
                    utility. The extension includes the manifest icons Chrome
                    uses in the toolbar and the starter graphic assets needed for
                    a future Web Store listing.
                  </PanelBody>
                </div>
              </SwissGridItem>

              <SwissGridItem span="body">
                <SurfacePanel elevation="quiet" className="grid gap-[var(--space-5)] md:grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)]">
                  <div className="flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-muted)] p-[var(--space-6)]">
                    <img
                      src="/img/generated/scout-extension-icon.png"
                      alt="Port Daddy Scout extension icon"
                      className="h-32 w-32"
                      loading="eager"
                    />
                  </div>
                  <div className="space-y-[var(--space-4)]">
                    <PanelEyebrow>Included assets</PanelEyebrow>
                    <PanelTitle as="h3" size="card">
                      Manifest-ready now, store-ready starter kit next.
                    </PanelTitle>
                    <div className="space-y-[var(--space-3)]">
                      {brandAssets.map((item) => (
                        <div key={item} className="flex gap-[var(--space-3)]">
                          <CheckCircle2 className="mt-[0.15rem] h-[var(--space-4)] w-[var(--space-4)] shrink-0 text-[var(--brand-primary)]" aria-hidden="true" />
                          <PanelBody size="compact" className="max-w-none">
                            {item}
                          </PanelBody>
                        </div>
                      ))}
                    </div>
                  </div>
                </SurfacePanel>
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </section>

        <section id="does-it-work" className="scroll-mt-[calc(var(--space-10)+var(--space-6))] border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <SwissGrid>
              <SwissGridItem span="narrow">
                <div className="space-y-[var(--section-intro-gap)]">
                  <BracketLabel>Truth table</BracketLabel>
                  <PanelTitle as="h2" size="display" className="max-w-[12ch]">
                    Yes, with the right expectations.
                  </PanelTitle>
                  <PanelBody>
                    Scout works as a local developer-mode Chrome extension in
                    this branch, and the preview ZIP is packaged like a Store
                    upload. The honest caveat is distribution: signed,
                    auto-updating public install still waits on Chrome Web Store
                    submission and review.
                  </PanelBody>
                </div>
              </SwissGridItem>

              <SwissGridItem span="body">
                <div className="grid gap-[var(--grid-gap)] lg:grid-cols-2">
                  <SurfacePanel elevation="quiet" className="space-y-[var(--space-4)]">
                    <div className="flex items-center gap-[var(--space-3)]">
                      <CheckCircle2 className="h-[var(--space-6)] w-[var(--space-6)] text-[var(--brand-primary)]" aria-hidden="true" />
                      <PanelTitle as="h3" size="card">
                        Works now
                      </PanelTitle>
                    </div>
                    <div className="space-y-[var(--space-3)]">
                      {worksNow.map((item) => (
                        <PanelBody key={item} size="compact" className="max-w-none">
                          {item}
                        </PanelBody>
                      ))}
                    </div>
                  </SurfacePanel>

                  <SurfacePanel elevation="quiet" className="space-y-[var(--space-4)]">
                    <div className="flex items-center gap-[var(--space-3)]">
                      <XCircle className="h-[var(--space-6)] w-[var(--space-6)] text-[var(--status-error)]" aria-hidden="true" />
                      <PanelTitle as="h3" size="card">
                        Not yet
                      </PanelTitle>
                    </div>
                    <div className="space-y-[var(--space-3)]">
                      {notYet.map((item) => (
                        <PanelBody key={item} size="compact" className="max-w-none">
                          {item}
                        </PanelBody>
                      ))}
                    </div>
                  </SurfacePanel>
                </div>

                <SurfacePanel className="mt-[var(--space-6)] grid gap-[var(--space-4)] lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)]">
                  <div className="space-y-[var(--space-3)]">
                    <PanelEyebrow>Regression proof</PanelEyebrow>
                    <PanelTitle as="h3" size="card">
                      The rectangle flow is scriptable.
                    </PanelTitle>
                    <PanelBody className="max-w-none">
                      The repro loads Scout in Playwright Chromium, serves a
                      fixture page, draws a rectangle, checks the page highlight
                      and reopened composer, then submits to a mock daemon.
                    </PanelBody>
                  </div>
                  <DocsCodeBlock
                    code="node apps/pd-scout-extension/tests/scout-region-repro.mjs"
                    language="cli"
                    label="Scout repro"
                  />
                </SurfacePanel>
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </section>

        <section className="py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <SwissGrid className="items-center">
              <SwissGridItem span="wide">
                <div className="space-y-[var(--space-4)]">
                  <PanelEyebrow>From visual bug to reviewable work</PanelEyebrow>
                  <PanelTitle as="h2" size="display" className="max-w-[13ch]">
                    The browser becomes another Port Daddy intake surface.
                  </PanelTitle>
                  <PanelBody>
                    Use Scout for UI bugs, copy nits, layout regressions, and
                    “this thing right here” feedback on any ordinary web app.
                    Project pages get better DOM evidence; outside sites still
                    get screenshot evidence and a durable issue.
                  </PanelBody>
                </div>
              </SwissGridItem>
              <SwissGridItem span="narrow">
                <div className="grid gap-[var(--space-3)] sm:grid-cols-2">
                  {[
                    [Bug, 'Fix and bug reports'],
                    [MonitorCheck, 'Project web apps'],
                    [GitPullRequest, 'Reviewable issues'],
                    [ShieldCheck, 'Local-first daemon'],
                  ].map(([Icon, label]) => {
                    const IconComponent = Icon as typeof Bug
                    return (
                      <div key={label as string} className="border-2 border-[var(--border-strong)] p-[var(--space-4)]">
                        <IconComponent className="h-[var(--space-5)] w-[var(--space-5)] text-[var(--brand-primary)]" aria-hidden="true" />
                        <PanelEyebrow className="mt-[var(--space-3)]">{label as string}</PanelEyebrow>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-[var(--space-5)] flex flex-wrap gap-[var(--space-3)]">
                  <Button asChild variant="primary" size="lg">
                    <a href={scoutDownloadPath} download>
                      Download preview ZIP
                      <Download size={16} aria-hidden="true" />
                    </a>
                  </Button>
                  <Button asChild variant="secondary" size="lg">
                    <Link to="/mac-preview#install">
                      Install Port Daddy
                      <Terminal size={16} aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </section>
      </main>
      <Footer />
    </div>
  )
}
