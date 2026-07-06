import { Link } from 'react-router-dom'
import {
  BracketLink,
  CommandBlock,
  DocsHero,
  DocsNoteCard,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
  SwissGrid,
  SwissGridItem,
} from '@/components/site/primitives'

/**
 * /cli-backend — the pitch for running the agent fleet on a Claude Max or
 * ChatGPT Pro subscription you already pay for, with no extra metered API bill.
 */
export default function CliBackendPage() {
  return (
    <div className="space-y-[var(--space-8)] py-[var(--space-7)] lg:space-y-[var(--space-9)] lg:py-[var(--space-8)]">
      {/* Hero */}
      <PageContainer width="wide">
        <DocsHero
          eyebrow="Run agents on your subscription"
          title="Your AI subscription already pays for the fleet."
          titleClassName="!max-w-[20ch]"
          summary="You already pay $20 a month for ChatGPT Pro, or $200 for Claude Max. Port Daddy runs your background agents on that same login. Every agent that reviews pull requests, lints commits, and drafts release notes uses the seat you already bought. No extra API bill arrives at the end of the month."
          paragraphs={[
            <>
              Most agent tools charge you twice. Once for the seat you type into as a person. Again
              for the API tokens your agents spend overnight. The seat is already paid for. The
              model is already running. The <code>claude</code> command is already on your{' '}
              <code>PATH</code>. Port Daddy hands the fleet that same command and lets it work in
              the quiet hours between your own turns.
            </>,
            <>
              Setup takes about two minutes: install the daemon, confirm <code>claude</code> or{' '}
              <code>codex</code> is logged in, set one environment variable, start the fleet. The
              math is in the middle of this page. The honest limits are at the bottom. Read them in
              any order.
            </>,
          ]}
          aside={
            <SurfacePanel>
              <div className="space-y-[var(--panel-gap)]">
                <CommandBlock
                  title="Set up the fleet"
                  command={`# 1. Install the daemon and CLI\nbrew install curiositech/tap/port-daddy\n\n# 2. Confirm your subscription CLI is logged in\nclaude --version       # or: codex --version\n\n# 3. Point the fleet at your subscription\nexport PD_USE_CLI_BACKEND=claude-cli\npd fleet up`}
                  label="Two-minute setup"
                />
                <PanelBody size="compact" tone="default">
                  That is the whole setup. The fleet now drafts pull-request reviews, lints commits,
                  and writes release notes using the same model you have open in your editor.
                </PanelBody>
              </div>
            </SurfacePanel>
          }
        />
      </PageContainer>

      {/* Hero figure */}
      <PageContainer width="wide">
        <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
          <img
            src="/img/generated/cli-backend-hero.webp"
            alt="Blueprint diagram of a single AI subscription card distributing cobalt-blue pipelines down to seven small sailing ships, each labeled with a fleet agent name: gardener, qa, spider, tenderfoot, cartographer, spark, augur."
            className="block w-full"
            loading="lazy"
          />
          <figcaption className="border-t-2 border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
            One login, shared across the whole fleet. The lines are each a <code>pd spawn</code>;
            the ships are the background agents already listed in your <code>pd-fleet.yml</code>.
          </figcaption>
        </figure>
      </PageContainer>

      {/* How it works */}
      <section className="border-t-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
        <PageContainer width="wide">
          <SwissGrid className="items-start gap-y-[var(--space-7)]">
            <SwissGridItem span="narrow">
              <div className="sticky top-28 space-y-[var(--space-4)]">
                <SectionIntro
                  eyebrow="How it works"
                  title="Port Daddy starts the same CLI you do."
                  description="The spawner is a small piece of plumbing. It starts a local CLI process, hands it a prompt, captures the reply, and records the cost. The shape is the same whether the command is claude, codex, aider, or a shell script you wrote yourself."
                  titleAs="h2"
                />
                <div className="space-y-[var(--space-3)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                  <p>
                    Run <code>pd spawn --backend claude-cli</code> and the daemon calls{' '}
                    <code>claude</code> on your <code>PATH</code>, passes the prompt in on stdin,
                    reads the reply off stdout, saves the transcript to the session record, and
                    exits. The CLI sees one ordinary conversation. You get an agent that works while
                    you are away.
                  </p>
                  <p>
                    Claude Code and Codex plug in directly. Cloudflare Workers AI and the direct
                    Anthropic API are fallbacks. When <code>PD_USE_CLI_BACKEND</code> is set and the
                    command is on your <code>PATH</code>, the spawner uses it first, because it adds
                    nothing to your bill.
                  </p>
                </div>
                <div className="pt-[var(--space-2)]">
                  <BracketLink to="/tutorials/fleet" surface="paper">
                    Walk the fleet tutorial
                  </BracketLink>
                </div>
              </div>
            </SwissGridItem>

            <SwissGridItem span="wide" className="space-y-[var(--space-5)]">
              <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
                <img
                  src="/img/generated/cli-backend-howitworks.webp"
                  alt="Cutaway blueprint of a labeled pd-tube pipe with a claude-code CLI process running inside it; the spawner connects to it on the left, the reply emits on the right."
                  className="block w-full"
                  loading="lazy"
                />
                <figcaption className="border-t-2 border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                  A cutaway of one spawn. The CLI you already have is the process running inside.
                </figcaption>
              </figure>

              <div className="grid gap-[var(--space-4)] md:grid-cols-2">
                <DocsNoteCard label="Step 1" title="It starts your CLI">
                  <PanelBody size="compact" tone="default" className="max-w-none">
                    Port Daddy runs <code>claude --print &quot;…&quot;</code> (or{' '}
                    <code>codex exec …</code>) as a child process of the daemon, in your project
                    directory, under the agent&apos;s identity, with a time limit.
                  </PanelBody>
                </DocsNoteCard>
                <DocsNoteCard label="Step 2" title="It captures the work">
                  <PanelBody size="compact" tone="default" className="max-w-none">
                    The prompt goes in on stdin. The reply comes back on stdout. Errors feed the
                    activity log. Everything is saved to the session transcript, so you can read
                    back the work after the process exits.
                  </PanelBody>
                </DocsNoteCard>
                <DocsNoteCard label="Step 3" title="It records the cost">
                  <PanelBody size="compact" tone="default" className="max-w-none">
                    On a subscription CLI the cost of each spawn is <code>$0.00</code>, because the
                    model is already paid for. Port Daddy still logs the wall-clock time and token
                    count, so you can watch the pace without watching a bill grow.
                  </PanelBody>
                </DocsNoteCard>
                <DocsNoteCard label="Step 4" title="It lands in your timeline">
                  <PanelBody size="compact" tone="default" className="max-w-none">
                    The transcript, exit code, and any tool calls land in the session record.{' '}
                    <Link
                      to="/docs/features/timeline"
                      className="underline decoration-[var(--border-strong)] decoration-2 underline-offset-4"
                    >
                      pd timeline
                    </Link>{' '}
                    shows it like any other agent run. A subscription backend is not a special case.
                  </PanelBody>
                </DocsNoteCard>
              </div>
            </SwissGridItem>
          </SwissGrid>
        </PageContainer>
      </section>

      {/* The math */}
      <section className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--space-7)] lg:py-[var(--space-8)]">
        <PageContainer width="wide">
          <SectionIntro
            eyebrow="The math"
            title="Same work, three bills."
            description="Picture a small fleet — gardener, qa, spider, spark — handling about 100 pull-request reviews and 600 short summaries a month. The work does not change. Only what you pay for it does."
            titleAs="h2"
          />

          <div className="mt-[var(--space-6)] grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            {/* Comparison table */}
            <div className="overflow-x-auto border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
                    <th className="px-[var(--space-3)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
                      Backend
                    </th>
                    <th className="px-[var(--space-3)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
                      Fixed cost
                    </th>
                    <th className="px-[var(--space-3)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
                      Marginal per spawn
                    </th>
                    <th className="px-[var(--space-3)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
                      Monthly bill
                    </th>
                  </tr>
                </thead>
                <tbody className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-primary)]">
                  <tr className="border-b border-[var(--border-default)]">
                    <td className="px-[var(--space-3)] py-[var(--space-3)] align-top">
                      <div className="font-semibold text-[var(--brand-primary)]">Your subscription</div>
                      <div className="text-[var(--text-secondary)]">Claude Max or ChatGPT Pro</div>
                    </td>
                    <td className="px-[var(--space-3)] py-[var(--space-3)] align-top">$20–$200 / mo, already paid</td>
                    <td className="px-[var(--space-3)] py-[var(--space-3)] align-top font-semibold">$0.00</td>
                    <td className="px-[var(--space-3)] py-[var(--space-3)] align-top font-semibold text-[var(--brand-primary)]">
                      Nothing on top of your seat
                    </td>
                  </tr>
                  <tr className="border-b border-[var(--border-default)]">
                    <td className="px-[var(--space-3)] py-[var(--space-3)] align-top">
                      <div className="font-semibold">Cloudflare Workers AI</div>
                      <div className="text-[var(--text-secondary)]">Qwen3 30B, a fallback</div>
                    </td>
                    <td className="px-[var(--space-3)] py-[var(--space-3)] align-top">$0</td>
                    <td className="px-[var(--space-3)] py-[var(--space-3)] align-top">about $0.005 / spawn</td>
                    <td className="px-[var(--space-3)] py-[var(--space-3)] align-top">about $15 / mo</td>
                  </tr>
                  <tr>
                    <td className="px-[var(--space-3)] py-[var(--space-3)] align-top">
                      <div className="font-semibold">Anthropic API direct</div>
                      <div className="text-[var(--text-secondary)]">Sonnet via SDK, a fallback</div>
                    </td>
                    <td className="px-[var(--space-3)] py-[var(--space-3)] align-top">$0</td>
                    <td className="px-[var(--space-3)] py-[var(--space-3)] align-top">about $0.04 / spawn</td>
                    <td className="px-[var(--space-3)] py-[var(--space-3)] align-top">about $120 / mo</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <DocsNoteCard label="A worked example" title="100 reviews in a month">
              <PanelBody size="compact" tone="default" className="max-w-none">
                A mid-sized open-source repo gets about 100 pull requests a month. Each review is
                one spawn of the qa agent: three to five minutes, a modest number of tokens.
              </PanelBody>
              <ul className="grid gap-[var(--space-2)] pt-[var(--space-2)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                <li>
                  <strong className="text-[var(--brand-primary)]">Your subscription:</strong> $0 on
                  top of the $200/mo Max seat you already pay for.
                </li>
                <li>
                  <strong>Cloudflare Workers AI:</strong> about $0.50 in inference. The cheapest
                  option if you do not have a subscription.
                </li>
                <li>
                  <strong>Anthropic API direct:</strong> about $4.00. The same model the seat gives
                  you, but billed per call.
                </li>
              </ul>
              <PanelBody size="compact" tone="default" className="max-w-none">
                If you already use Claude Max in your editor, the first row costs you nothing extra.
                You were going to pay for the seat anyway.
              </PanelBody>
            </DocsNoteCard>
          </div>

          <figure className="mt-[var(--space-6)] overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
            <img
              src="/img/generated/cli-backend-math.webp"
              alt="Blueprint-style bar chart comparing effective per-spawn cost across CLI subscription (smallest bar), Cloudflare Workers AI (medium), and Anthropic API direct (largest)."
              className="block w-full"
              loading="lazy"
            />
            <figcaption className="border-t-2 border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
              The same fleet, three bills. The seat you already pay for adds nothing per spawn, so
              its bar barely registers.
            </figcaption>
          </figure>
        </PageContainer>
      </section>

      {/* The setup */}
      <section className="border-t-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
        <PageContainer width="wide">
          <SectionIntro
            eyebrow="The setup"
            title="Three commands, about two minutes."
            description="There is no plugin to install and no API key to rotate. If your CLI is on your PATH and the daemon is running, the fleet can use it."
            titleAs="h2"
          />
          <div className="mt-[var(--space-6)] grid gap-[var(--space-5)] lg:grid-cols-3">
            <CommandBlock
              title="1. Install the daemon"
              command="brew install curiositech/tap/port-daddy"
              label="One time"
              description={
                <>
                  Daemon, CLI, and MCP server in one Homebrew formula. It starts on its own through{' '}
                  <code>launchd</code>. Run <code>pd status</code> to confirm it is up.
                </>
              }
            />
            <CommandBlock
              title="2. Check your CLI"
              command={`claude --version   # for Claude Max\ncodex --version    # for ChatGPT Pro`}
              label="One time"
              description="The CLI you use as a person is the one the fleet will use. If --version prints a number, you are done: the command is on your PATH and logged in."
            />
            <CommandBlock
              title="3. Point the fleet at it"
              command={`export PD_USE_CLI_BACKEND=claude-cli\n# or PD_USE_CLI_BACKEND=codex\npd fleet up`}
              label="Per project"
              description="Set the variable in your shell startup file, or name the backend per agent in pd-fleet.yml. The cost ledger will start showing $0.00 for each spawn."
              tone="blue"
            />
          </div>
        </PageContainer>
      </section>

      {/* Use this / skip this */}
      <section className="border-t-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
        <PageContainer width="wide">
          <SectionIntro
            eyebrow="Is this for you?"
            title="When to use it. When to skip it."
            description="This setup is a strong fit, but a narrow one. If you already pay for a seat, the math is hard to beat. If you don't, Cloudflare Workers AI is cheap and a fine default. Picking that instead is a reasonable call."
            titleAs="h2"
          />
          <div className="mt-[var(--space-6)] grid gap-[var(--space-5)] md:grid-cols-2">
            <DocsNoteCard label="Use it if" title="You already pay for Max or Pro" tone="blue">
              <ul className="grid gap-[var(--space-2)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[color:var(--brand-primary-foreground-muted)]">
                <li>You use <code>claude</code> or <code>codex</code> in your editor every day.</li>
                <li>You want background agents to draft, review, and summarize without a second invoice arriving.</li>
                <li>You want every spawn on record. The transcripts sit in the same timeline as the work you do by hand.</li>
                <li>You can live with your own CLI slowing down for a moment when the fleet is busy. See the limits below.</li>
              </ul>
            </DocsNoteCard>
            <DocsNoteCard label="Skip it if" title="No subscription, no problem">
              <ul className="grid gap-[var(--space-2)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                <li>You do not have Max or Pro and do not want one. Cloudflare Workers AI on Qwen3 is the cheap default.</li>
                <li>You need agents on a machine without your login: a CI box, a remote build node, a server you do not sit at.</li>
                <li>You need an exact cost for every call, for billing or chargeback. A subscription seat does not break the cost down that way.</li>
                <li>You need a model the subscription does not offer, like Gemini, a fine-tune, or a vision-heavy job. Use the direct API.</li>
              </ul>
            </DocsNoteCard>
          </div>
        </PageContainer>
      </section>

      {/* Fine print */}
      <section className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--space-7)] lg:py-[var(--space-8)]">
        <PageContainer width="wide">
          <SwissGrid>
            <SwissGridItem span="narrow">
              <div className="sticky top-28 space-y-[var(--space-3)]">
                <PanelEyebrow>The honest limits</PanelEyebrow>
                <PanelTitle as="h2" size="display">
                  What to expect.
                </PanelTitle>
                <PanelBody className="max-w-[34rem]">
                  Subscription terms exist for a reason. Anthropic and OpenAI both meter usage by
                  the hour underneath, and a fleet that runs too hot will run into those limits.
                  Here is what that looks like, and the dial that keeps it tame.
                </PanelBody>
              </div>
            </SwissGridItem>
            <SwissGridItem span="wide" className="space-y-[var(--space-4)]">
              <DocsNoteCard label="Rate limits" title="Subscriptions cap you by the hour">
                <PanelBody size="compact" tone="default" className="max-w-none">
                  Claude Max and ChatGPT Pro both set an hourly usage budget. It is generous for one
                  person and tight for a fleet. If the agents use too much in a short window, the
                  CLI asks you to wait, the same way it would for a fast-typing human.
                </PanelBody>
              </DocsNoteCard>
              <DocsNoteCard label="Shared budget" title="The fleet shares your seat">
                <PanelBody size="compact" tone="default" className="max-w-none">
                  While the fleet runs on your seat, your own Claude Code or Codex calls draw from
                  the same budget. Most of the time you will not notice. Now and then you will see a
                  wait-a-moment banner when two agents fire at once. A daily cap per agent keeps your
                  own work fast.
                </PanelBody>
              </DocsNoteCard>
              <DocsNoteCard label="Caps" title="The dial you want">
                <PanelBody size="compact" tone="default" className="max-w-none">
                  Each agent in <code>pd-fleet.yml</code> takes a <code>budget_usd_per_day</code> and
                  a <code>max_spawns_per_hour</code>. On a subscription the dollar cap maps to a
                  token estimate; the spawn-rate cap is the real lever. Start low, around three
                  spawns an hour for the qa agent, watch the ledger, and raise it as you trust it.
                </PanelBody>
              </DocsNoteCard>
              <DocsNoteCard label="Terms" title="Read the agreement you signed">
                <PanelBody size="compact" tone="default" className="max-w-none">
                  Anthropic and OpenAI both allow programmatic use of their CLIs from the account
                  holder&apos;s own machine. Neither allows reselling the inference or spreading it
                  across accounts you do not own. Port Daddy stays on the first side of that line:
                  your agents, your machine, your seat. If you build a business on top of this, read
                  the current terms yourself before you scale.
                </PanelBody>
              </DocsNoteCard>
            </SwissGridItem>
          </SwissGrid>
        </PageContainer>
      </section>

      {/* CTA */}
      <section className="border-t-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
        <PageContainer width="wide">
          <SurfacePanel tone="blue" className="space-y-[var(--panel-gap-loose)] text-center">
            <PanelEyebrow tone="primary" className="justify-center">
              Try the fleet
            </PanelEyebrow>
            <PanelTitle as="h2" size="display" tone="primary" className="mx-auto max-w-[24ch]">
              Three commands. Your subscription does the rest.
            </PanelTitle>
            <PanelBody tone="primary" className="mx-auto max-w-[44rem]">
              If you already pay for Claude Max or ChatGPT Pro, this is the smallest change you can
              make: same model, same login, more hours of work in a day.
            </PanelBody>
            <div className="mx-auto max-w-[44rem]">
              <CommandBlock
                title="Install and start"
                command={`brew install curiositech/tap/port-daddy\nexport PD_USE_CLI_BACKEND=claude-cli\npd fleet up`}
                tone="blue"
                hideLabel
              />
            </div>
            <div className="flex flex-wrap justify-center gap-[var(--space-3)]">
              <BracketLink to="/tutorials/fleet" tone="accent" surface="blue">
                Walk the fleet tutorial
              </BracketLink>
              <BracketLink to="/docs/quickstart" tone="accent" surface="blue">
                Read the quickstart
              </BracketLink>
            </div>
          </SurfacePanel>
        </PageContainer>
      </section>
    </div>
  )
}
