import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Bug,
  Camera,
  CheckCircle2,
  Chrome,
  Code2,
  Crosshair,
  GitPullRequest,
  MonitorCheck,
  Route,
  ShieldCheck,
  Terminal,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Footer } from '@/components/layout/Footer'
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

const installCommand = `git clone https://github.com/curiositech/port-daddy.git
cd port-daddy
pd setup
pd status`

const extensionPath = `apps/pd-scout-extension`

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
  'Optionally ask Port Daddy to spawn a worker for the task.',
]

const installSteps = [
  {
    label: 'Step 1',
    title: 'Install Port Daddy and start the local daemon',
    body:
      'Scout talks to the daemon on your machine. The page capture is useful only when the local control plane is running.',
    code: installCommand,
  },
  {
    label: 'Step 2',
    title: 'Load the Chrome extension from this checkout',
    body:
      'Chrome Web Store packaging is not shipped yet. For now this is an unpacked developer-mode extension.',
    code: extensionPath,
  },
  {
    label: 'Step 3',
    title: 'Capture any normal web page',
    body:
      'Open a page, click Port Daddy Scout, capture the page or draw a region, write the brief, and open the issue.',
    code: 'Daemon URL: http://127.0.0.1:9876',
  },
]

const worksNow = [
  'Unpacked Manifest V3 Chrome extension.',
  'Visible-tab screenshots through chrome.tabs.captureVisibleTab.',
  'Shadow-DOM region picker on ordinary web pages.',
  'DOM selector, XPath, text, bounds, viewport, and URL capture.',
  'POST /visual-tasks in the local daemon.',
  'Blob-backed image storage, visual-feedback publish, and reviewable work item creation.',
]

const notYet = [
  'No Chrome Web Store package yet.',
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

      <picture className="block overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
        <img
          src="/img/generated/scout-extension-popup.png"
          alt="Port Daddy Scout showing a Chrome extension popup beside a selected web page region"
          className="aspect-[4/3] w-full object-cover"
          loading="eager"
        />
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
                      <a href="#install">
                        Install the extension
                        <ArrowRight size={16} aria-hidden="true" />
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
                    Scout adds the machine-readable context a spawned worker can
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

        <section id="install" className="scroll-mt-[calc(var(--space-10)+var(--space-6))] border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="mb-[var(--space-6)] space-y-[var(--section-intro-gap)]">
              <BracketLabel>Install</BracketLabel>
              <PanelTitle as="h2" size="display" className="max-w-[13ch]">
                Load it today as an unpacked Chrome extension.
              </PanelTitle>
              <PanelBody>
                This is real local plumbing, but it is not a Web Store release.
                Until packaging lands, install Scout from the repository checkout.
              </PanelBody>
            </div>

            <div className="grid gap-[var(--grid-gap)] lg:grid-cols-3">
              {installSteps.map((step) => (
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
                <PanelEyebrow>Chrome steps</PanelEyebrow>
                <PanelTitle as="h3" size="card">
                  Where the folder goes.
                </PanelTitle>
                <PanelBody className="max-w-none">
                  Open <code className="font-mono">chrome://extensions</code>,
                  enable Developer mode, click <strong>Load unpacked</strong>,
                  and choose <code className="font-mono">apps/pd-scout-extension</code>.
                  The popup defaults to <code className="font-mono">http://127.0.0.1:9876</code>.
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
                    this branch. The honest caveat is distribution: signed,
                    auto-updating Chrome packaging is future work.
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
                    get a pretty picture and a durable issue.
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
                    <a href="#install">
                      Load Scout
                      <ArrowRight size={16} aria-hidden="true" />
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
