import { Link } from 'react-router-dom'
import {
  BracketLabel,
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
 * /cli-backend — the operator's pitch for using Claude Max / ChatGPT Pro
 * subscriptions as the fleet's execution backend. Voice: cathedral build,
 * cream-blueprint imagery, real numbers, honest fine print.
 */
export default function CliBackendPage() {
  return (
    <div className="space-y-[var(--space-8)] py-[var(--space-7)] lg:space-y-[var(--space-9)] lg:py-[var(--space-8)]">
      {/* Hero */}
      <PageContainer width="wide">
        <DocsHero
          eyebrow="The shape of the deal"
          title="Your AI subscription, but it pays for itself by running the fleet."
          titleClassName="!max-w-[22ch]"
          summary="Already pay $20/month for ChatGPT Pro? $200 for Claude Max? Port Daddy treats those CLIs as first-class execution backends. The same fleet of background agents that lints, reviews, summarizes, and ships rides on the license you already bought, at zero marginal cost per spawn."
          paragraphs={[
            <>
              Most agent platforms hand you the bill twice — once for the chat seat you use as a
              person, again for the API tokens the agents burn at night. That feels backwards. The
              license is already paid. The model is already there. The CLI is already on your
              <code>PATH</code>. Port Daddy just hands the local fleet the same handle you reach
              for, and lets it work in the slack hours between your interactive turns.
            </>,
            <>
              Setup is two minutes — install <code>pd</code>, make sure <code>claude</code> or{' '}
              <code>codex</code> is logged in, set one environment variable, start the fleet. The
              honest fine print is at the bottom of this page; the math is in the middle. Read in
              any order — the punchline doesn&apos;t move.
            </>,
          ]}
          aside={
            <SurfacePanel>
              <div className="space-y-[var(--panel-gap)]">
                <BracketLabel>Two-minute setup</BracketLabel>
                <CommandBlock
                  title="brew install pd"
                  command={`# 1. Daemon + CLI\nbrew install curiositech/tap/port-daddy\n\n# 2. Make sure your subscription CLI is logged in\nclaude --version       # or: codex --version\n\n# 3. Tell the fleet to ride your subscription\nexport PD_USE_CLI_BACKEND=claude-cli\npd fleet up`}
                  hideLabel
                />
                <PanelBody size="compact" tone="default">
                  That is the whole setup. The fleet now drafts PR reviews, lints commits, and
                  drafts release notes against the same model you have open in the editor.
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
            src="/img/generated/cli-backend-hero.png"
            alt="Blueprint diagram of a single AI subscription card distributing cobalt-blue pipelines down to seven small sailing ships, each labeled with a fleet agent name: gardener, qa, spider, tenderfoot, cartographer, spark, augur."
            className="block w-full"
            loading="lazy"
          />
          <figcaption className="border-t-2 border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-3)] text-sm text-[var(--text-muted)]">
            One license, fanned out to the whole fleet. The lines are <code>pd spawn</code>; the
            ships are background agents that already exist in <code>pd-fleet.yml</code>.
          </figcaption>
        </figure>
      </PageContainer>

      {/* How it works */}
      <section className="border-t-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
        <PageContainer width="wide">
          <SwissGrid className="items-start gap-y-[var(--space-7)]">
            <SwissGridItem span="narrow">
              <div className="sticky top-28 space-y-[var(--space-4)]">
                <BracketLabel>How it works</BracketLabel>
                <SectionIntro
                  eyebrow="The wrapper, not a wrapper"
                  title="pd-tube wraps the CLI you already use."
                  description="The Port Daddy spawner is a small piece of plumbing that knows how to start a local CLI process, hand it a prompt, capture its reply, and meter the cost — same shape, whether the binary is claude-code, codex, aider, or a custom shell command."
                  titleAs="h2"
                />
                <div className="space-y-[var(--space-3)] text-[var(--text-muted)]">
                  <p>
                    When you run <code>pd spawn --backend claude-cli</code>, the daemon shells out
                    to <code>claude</code> on your <code>PATH</code>, threads stdin and stdout
                    through the pd-tube envelope, posts the transcript to the session record, and
                    returns. The CLI itself believes it&apos;s having a single conversation with a
                    well-behaved caller. You believe you have a tireless coworker. Both are true.
                  </p>
                  <p>
                    The spawner picks the cheapest available backend by default — if{' '}
                    <code>PD_USE_CLI_BACKEND</code> is set and the binary is on <code>PATH</code>,
                    the marginal cost is zero, so it wins. Everything else (Cloudflare Workers AI,
                    Anthropic API direct, the local Ollama you forgot you installed) lives as a
                    fallback rung.
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
                  src="/img/generated/cli-backend-howitworks.png"
                  alt="Cutaway blueprint of a labeled pd-tube pipe with a claude-code CLI process running inside it; the spawner connects to it on the left, the reply emits on the right."
                  className="block w-full"
                  loading="lazy"
                />
                <figcaption className="border-t-2 border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-3)] text-sm text-[var(--text-muted)]">
                  pd-tube is a cross-section. The CLI you already have is the process inside.
                </figcaption>
              </figure>

              <div className="grid gap-[var(--space-4)] md:grid-cols-2">
                <DocsNoteCard label="Step 1" title="The spawner starts the CLI">
                  <PanelBody size="compact" tone="default" className="max-w-none">
                    Port Daddy invokes <code>claude --print &quot;…&quot;</code> (or{' '}
                    <code>codex exec …</code>) as a subprocess of the daemon, in the project
                    directory, under the agent&apos;s identity, with a tight wall-clock budget.
                  </PanelBody>
                </DocsNoteCard>
                <DocsNoteCard label="Step 2" title="pd-tube envelopes the I/O">
                  <PanelBody size="compact" tone="default" className="max-w-none">
                    stdin is the prompt, stdout is the reply, stderr feeds the activity log.
                    Every byte is captured into the session transcript, so the work is auditable
                    even after the process exits.
                  </PanelBody>
                </DocsNoteCard>
                <DocsNoteCard label="Step 3" title="The cost is metered">
                  <PanelBody size="compact" tone="default" className="max-w-none">
                    For subscription CLIs, marginal cost is <code>$0.00</code> — the model is
                    already paid for. Per-spawn telemetry still records wall-clock and tokens, so
                    you can audit the rate ceiling without inflating your bill.
                  </PanelBody>
                </DocsNoteCard>
                <DocsNoteCard label="Step 4" title="The reply lands in the session">
                  <PanelBody size="compact" tone="default" className="max-w-none">
                    The transcript, return code, and any tool calls land in the session record.{' '}
                    <Link
                      to="/docs/features/timeline"
                      className="underline decoration-[var(--border-strong)] decoration-2 underline-offset-4"
                    >
                      pd timeline
                    </Link>{' '}
                    treats it like any other ship-run — no special case for CLI backends.
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
            eyebrow="The math, honestly"
            title="Same workload, three bills."
            description="A modest fleet — gardener, qa, spider, spark — handling about 100 PR reviews and roughly 600 short summaries a month. The work is the same. Only the meter changes."
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
                      <div className="font-semibold text-[var(--brand-primary)]">CLI subscription</div>
                      <div className="text-[var(--text-muted)]">Claude Max or ChatGPT Pro</div>
                    </td>
                    <td className="px-[var(--space-3)] py-[var(--space-3)] align-top">$20–$200 / mo (already paid)</td>
                    <td className="px-[var(--space-3)] py-[var(--space-3)] align-top font-semibold">$0.00</td>
                    <td className="px-[var(--space-3)] py-[var(--space-3)] align-top font-semibold text-[var(--brand-primary)]">
                      $0 over what you already pay
                    </td>
                  </tr>
                  <tr className="border-b border-[var(--border-default)]">
                    <td className="px-[var(--space-3)] py-[var(--space-3)] align-top">
                      <div className="font-semibold">Cloudflare Workers AI</div>
                      <div className="text-[var(--text-muted)]">Qwen3 30B on @cf</div>
                    </td>
                    <td className="px-[var(--space-3)] py-[var(--space-3)] align-top">$0</td>
                    <td className="px-[var(--space-3)] py-[var(--space-3)] align-top">~$0.005 / spawn</td>
                    <td className="px-[var(--space-3)] py-[var(--space-3)] align-top">~$15 / mo at this workload</td>
                  </tr>
                  <tr>
                    <td className="px-[var(--space-3)] py-[var(--space-3)] align-top">
                      <div className="font-semibold">Anthropic API direct</div>
                      <div className="text-[var(--text-muted)]">Sonnet 4.7 via SDK</div>
                    </td>
                    <td className="px-[var(--space-3)] py-[var(--space-3)] align-top">$0</td>
                    <td className="px-[var(--space-3)] py-[var(--space-3)] align-top">~$0.04 / spawn</td>
                    <td className="px-[var(--space-3)] py-[var(--space-3)] align-top">~$120 / mo at this workload</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <DocsNoteCard label="Worked example" title="100 PR reviews this month">
              <PanelBody size="compact" tone="default" className="max-w-none">
                A medium-sized OSS repo lands roughly 100 PRs / month. Each review is a single
                spawn of the qa ship — 3–5 minute wall-clock, modest token count.
              </PanelBody>
              <ul className="grid gap-[var(--space-2)] pt-[var(--space-2)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                <li>
                  <strong className="text-[var(--brand-primary)]">CLI subscription:</strong> $0 on
                  top of your $200/mo Max seat. You were already paying for the seat.
                </li>
                <li>
                  <strong>Cloudflare Workers AI:</strong> ~$0.50 in inference. Honest cheapest
                  no-strings option.
                </li>
                <li>
                  <strong>Anthropic API direct:</strong> ~$4.00. Same model the seat unlocks, but
                  metered.
                </li>
              </ul>
              <PanelBody size="compact" tone="default" className="max-w-none">
                If you already use Claude Max for your editor and chat work, the second column is
                pure savings — you would have paid the seat anyway.
              </PanelBody>
            </DocsNoteCard>
          </div>

          <figure className="mt-[var(--space-6)] overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
            <img
              src="/img/generated/cli-backend-math.png"
              alt="Blueprint-style bar chart comparing effective per-spawn cost across CLI subscription (smallest bar), Cloudflare Workers AI (medium), and Anthropic API direct (largest)."
              className="block w-full"
              loading="lazy"
            />
            <figcaption className="border-t-2 border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-3)] text-sm text-[var(--text-muted)]">
              Same fleet workload, three bills. Effective per-spawn cost ÷ usage gives you the
              real number — the seat you already paid for divides to zero.
            </figcaption>
          </figure>
        </PageContainer>
      </section>

      {/* The setup */}
      <section className="border-t-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
        <PageContainer width="wide">
          <SectionIntro
            eyebrow="The setup"
            title="Three commands. Two minutes. Done."
            description="There is no plugin to install, no marketplace dance, no API key to rotate. If the CLI is on your PATH and the daemon is up, the fleet can ride it."
            titleAs="h2"
          />
          <div className="mt-[var(--space-6)] grid gap-[var(--space-5)] lg:grid-cols-3">
            <CommandBlock
              title="1. Install the daemon"
              command="brew install curiositech/tap/port-daddy"
              label="One time"
              description={
                <>
                  Daemon, CLI, and MCP server in a single Homebrew formula. Auto-starts via{' '}
                  <code>launchd</code>; <code>pd status</code> confirms.
                </>
              }
            />
            <CommandBlock
              title="2. Verify the CLI"
              command={`claude --version   # for Claude Max\ncodex --version    # for ChatGPT Pro`}
              label="One time"
              description="Whichever CLI you use as a person, that's the one the fleet will reach for. If --version returns a number, you're already done — the binary is on PATH and logged in."
            />
            <CommandBlock
              title="3. Tell the fleet to ride it"
              command={`export PD_USE_CLI_BACKEND=claude-cli\n# or PD_USE_CLI_BACKEND=codex\npd fleet up`}
              label="Per project"
              description="Set the env var in your shell rc, or add the backend to pd-fleet.yml under each ship. Spawn telemetry will start showing $0.00 marginal in the cost ledger."
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
            title="Use it if. Skip it if."
            description="The CLI-backend pitch is sharp but narrow. If you already pay for the seat, the math is unbeatable. If you don't, Cloudflare Workers AI is genuinely cheap and the right default. There is no shame in picking the second column."
            titleAs="h2"
          />
          <div className="mt-[var(--space-6)] grid gap-[var(--space-5)] md:grid-cols-2">
            <DocsNoteCard label="Use this if" title="You already pay for Max or Pro" tone="blue">
              <ul className="grid gap-[var(--space-2)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[color:var(--brand-primary-foreground-muted)]">
                <li>You use <code>claude</code> or <code>codex</code> as your daily driver in the editor.</li>
                <li>You want background agents that draft, review, and summarize without showing up on a separate invoice.</li>
                <li>You care about per-spawn auditability — the transcripts live in the same session timeline as your interactive work.</li>
                <li>You can tolerate brief slowdowns in your interactive CLI when the fleet is busy (see fine print).</li>
              </ul>
            </DocsNoteCard>
            <DocsNoteCard label="Skip this if" title="No subscription, no problem">
              <ul className="grid gap-[var(--space-2)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                <li>You don&apos;t have Max or Pro and don&apos;t want one — Cloudflare Workers AI on Qwen3 is the honest cheap default.</li>
                <li>You need agents to run on a machine without your interactive login — a CI box, a remote build node, a fleet of cattle.</li>
                <li>You need strict per-call metering for billing or chargeback — subscription seats blur per-call cost on purpose.</li>
                <li>You need a model the subscription doesn&apos;t expose (Gemini, a fine-tune, a vision-heavy workload) — API-direct is the right call.</li>
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
                <BracketLabel>The honest fine print</BracketLabel>
                <PanelTitle as="h2" size="display">
                  No magic, no laundering.
                </PanelTitle>
                <PanelBody className="max-w-[34rem]">
                  Subscription terms exist for a reason. Anthropic and OpenAI both meter usage at
                  the hour level under the hood, and there are perfectly reasonable failure modes
                  when a fleet eats too much of the budget. Here is what to expect.
                </PanelBody>
              </div>
            </SwissGridItem>
            <SwissGridItem span="wide" className="space-y-[var(--space-4)]">
              <DocsNoteCard label="Rate ceilings" title="Subscriptions have hourly soft limits">
                <PanelBody size="compact" tone="default" className="max-w-none">
                  Both Claude Max and ChatGPT Pro enforce per-hour rate budgets that are generous
                  for a human but tight for a swarm. If your fleet eats too much in a short
                  window, the CLI will tell you to slow down — the same way it would for a
                  caffeinated programmer.
                </PanelBody>
              </DocsNoteCard>
              <DocsNoteCard label="Your interactive turn pays" title="The fleet competes with you">
                <PanelBody size="compact" tone="default" className="max-w-none">
                  While the fleet is running against your seat, your own interactive Claude Code
                  or Codex calls share the same budget. Most of the time you won&apos;t notice;
                  occasionally you&apos;ll see the &quot;please wait a minute&quot; banner when
                  the spider and the gardener both fire at the wrong moment. Set per-ship daily
                  caps to keep your interactive work fast.
                </PanelBody>
              </DocsNoteCard>
              <DocsNoteCard label="Configurable caps" title="The dial you actually want">
                <PanelBody size="compact" tone="default" className="max-w-none">
                  Every ship in <code>pd-fleet.yml</code> takes a <code>budget_usd_per_day</code>{' '}
                  and a <code>max_spawns_per_hour</code>. For subscription backends the dollar
                  cap maps to a tokens-per-day estimate; the spawn-rate cap is the real lever.
                  Start low (3 spawns/hour for the qa ship), watch the cost ledger, raise as you
                  trust it.
                </PanelBody>
              </DocsNoteCard>
              <DocsNoteCard label="Terms of service" title="Read the agreement you signed">
                <PanelBody size="compact" tone="default" className="max-w-none">
                  Anthropic and OpenAI both permit programmatic use of their CLIs from the
                  account holder&apos;s machine. They do not permit reselling the inference or
                  fan-out across accounts you don&apos;t own. Port Daddy is the first kind — your
                  agents, your machine, your seat. If you&apos;re running a business on top of
                  this, read the actual terms before you scale; we can&apos;t do that for you.
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
              If you already pay for Claude Max or ChatGPT Pro, the fleet is the smallest
              possible upgrade — same model, same login, more hours of work per day.
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
