import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import { CodeBlock } from '@/components/ui/CodeBlock'
import {
  BracketLabel,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
} from '@/components/site/primitives'
import { useTheme } from '@/lib/theme-context'
import { AnchorFourPhases } from '@/components/library/AnchorFourPhases'
import { AnchorCapabilityAttenuation } from '@/components/library/AnchorCapabilityAttenuation'
import { AnchorRevocationGossip } from '@/components/library/AnchorRevocationGossip'
import { ZeroTrustEnvelope } from '@/components/library/ZeroTrustEnvelope'
import { RelayTrustBoundary } from '@/components/library/RelayTrustBoundary'
import { SybilResistance } from '@/components/library/SybilResistance'
import { ThreeSidedMarket } from '@/components/library/ThreeSidedMarket'
import { CommonsGovernance } from '@/components/library/CommonsGovernance'
import { BondSlashMechanism } from '@/components/library/BondSlashMechanism'

/**
 * The Cryptography / Security page. Source-of-truth copy authored with the
 * technical-evangelism-for-formal-systems skill: problem-first, plain language
 * up front, formal terms named last, every claim grounded in a real primitive,
 * a runnable CTA at the end. Figures are the bespoke theme-aware SVGs from the
 * library plus two new ones (ZeroTrustEnvelope, CommonsGovernance).
 */

/** A numbered "closes" pill — the way each phase forecloses a threat. */
function ClosesPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-[var(--space-2)] inline-flex items-center border border-[var(--brand-primary)] px-[var(--space-2)] py-[1px] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
      {children}
    </span>
  )
}

export default function SecurityPage() {
  const { theme } = useTheme()
  // Theme-aware hero illustration in the "PR that reviews itself" line-art voice:
  // a row of harbor gatekeepers checking each agent's signed capability card and
  // turning away a forged one — the page's thesis rendered as a picture.
  const heroArt =
    theme === 'dark'
      ? '/img/generated/security/hero-dark.webp'
      : '/img/generated/security/hero-light.webp'
  return (
    <div className="bg-[var(--surface-base)]">
      <main id="main-content">
        {/* ── Section hero — lead with the fear, not the formalism ── */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="space-y-[var(--space-4)]">
              <BracketLabel>The security model</BracketLabel>
              <PanelTitle as="h1" size="display" className="max-w-[22ch]">
                An agent you never authorized just edited your code. What stops that?
              </PanelTitle>
              <PanelBody className="max-w-[58ch] text-[length:var(--type-panel-body-size)]">
                You hand six agents a task and walk away. One of them dies halfway
                through a refactor and leaves the file in a state no test covers.
                Another claims write access to a module it was never granted. A
                third is impersonating an agent you <em>did</em> trust, because it
                got hold of a token. None of these are exotic. They are Tuesday for
                anyone running a swarm.
              </PanelBody>
              <PanelBody className="max-w-[58ch] text-[length:var(--type-panel-body-size)]">
                Port Daddy&rsquo;s answer is not &ldquo;be careful.&rdquo; It is a
                small set of rules that make each of those failures impossible to
                express &mdash; and where it matters most, those rules are checked
                by a machine, not asserted in a blog post. Here is how each one
                closes.
              </PanelBody>
            </div>

            <figure className="mt-[var(--space-6)] m-0">
              <img
                src={heroArt}
                alt="A row of harbor gatekeepers at a customs counter, each inspecting a small signed capability card held up by a hooded coding agent; at the far gate one gatekeeper raises a hand and turns away an agent whose card is crossed out and forged."
                width={1376}
                height={768}
                loading="eager"
                decoding="async"
                className="w-full border-2 border-[var(--border-strong)]"
              />
              <figcaption className="mt-[var(--space-3)] max-w-[58ch] font-sans text-[length:var(--type-meta-size)] uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
                Every action carries a signed card that says what it may do. The card is checked at every door, cannot be forged, and can only ever grant less than the one it came from.
              </figcaption>
            </figure>
          </PageContainer>
        </section>

        {/* ── §1 Who is holding this capability, and can they widen it? ── */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.44fr)_minmax(0,0.56fr)] lg:items-start">
              <div className="space-y-[var(--space-3)]">
                <PanelEyebrow>Forgeable? Expandable?</PanelEyebrow>
                <PanelTitle as="h2" size="section" className="max-w-[20ch]">
                  Who is holding this capability, and can they widen it?
                </PanelTitle>
                <PanelBody className="max-w-[52ch]">
                  Every action an agent takes carries a token that says what it is
                  allowed to do. The whole security question is two words:{' '}
                  <em>forgeable?</em> and <em>expandable?</em> The Anchor Protocol
                  answers both by refinement &mdash; four phases, each one closing
                  a specific way the previous phase could be attacked.
                </PanelBody>
                <ol className="grid gap-[var(--space-3)]">
                  <li className="border-l-2 border-[var(--brand-primary)] pl-[var(--space-3)]">
                    <p className="font-display text-[length:var(--text-lg)] font-black text-[var(--text-primary)]">
                      1. Pin the algorithm (HS256).
                    </p>
                    <PanelBody className="text-[length:var(--type-panel-body-compact-size)]">
                      The token names how it was signed, and a verifier that trusts
                      that field can be tricked into accepting the wrong thing. So
                      the verifier ignores the on-wire algorithm and uses the one
                      it pinned.
                      <ClosesPill>Closes: algorithm confusion</ClosesPill>
                    </PanelBody>
                  </li>
                  <li className="border-l-2 border-[var(--brand-primary)] pl-[var(--space-3)]">
                    <p className="font-display text-[length:var(--text-lg)] font-black text-[var(--text-primary)]">
                      2. Make identity asymmetric (Ed25519).
                    </p>
                    <PanelBody className="text-[length:var(--type-panel-body-compact-size)]">
                      A shared secret is a secret everyone who verifies must also
                      hold &mdash; steal it once and you can mint tokens. So the
                      daemon becomes the only signer; every harbor holds the public
                      key and can check, never forge.
                      <ClosesPill>Closes: shared-secret theft</ClosesPill>
                    </PanelBody>
                  </li>
                  <li className="border-l-2 border-[var(--brand-primary)] pl-[var(--space-3)]">
                    <p className="font-display text-[length:var(--text-lg)] font-black text-[var(--text-primary)]">
                      3. Let authority be handed down, only narrower (Macaroon).
                    </p>
                    <PanelBody className="text-[length:var(--type-panel-body-compact-size)]">
                      An agent that can delegate is an agent that can
                      over-delegate. So a delegated token is provably a{' '}
                      <em>subset</em> of its parent, with a fresh nonce each hop.
                      <ClosesPill>Closes: capability escalation</ClosesPill>
                    </PanelBody>
                  </li>
                  <li className="border-l-2 border-[var(--brand-primary)] pl-[var(--space-3)]">
                    <p className="font-display text-[length:var(--text-lg)] font-black text-[var(--text-primary)]">
                      4. Make revocation arrive (Cuckoo filter).
                    </p>
                    <PanelBody className="text-[length:var(--type-panel-body-compact-size)]">
                      A token good until it expires is a token a compromised agent
                      keeps using. So revocations gossip across the fleet as
                      compact fingerprints and converge in about two minutes.
                      <ClosesPill>Closes: post-issuance compromise</ClosesPill>
                    </PanelBody>
                  </li>
                </ol>
              </div>
              <div className="space-y-[var(--space-4)] lg:sticky lg:top-[var(--space-6)]">
                <AnchorFourPhases />
                <blockquote className="border-l-4 border-[var(--brand-primary)] bg-[var(--surface-raised)] p-[var(--space-4)]">
                  <PanelBody className="text-[length:var(--type-panel-body-compact-size)]">
                    Phases 1&ndash;3 are mechanically verified in ProVerif &mdash;
                    authentication, algorithm pinning, and 17 of 17 replay cases
                    proven safe. Phase 4 is checked at runtime. The correctness of
                    who-can-do-what is not a matter of review taste.{' '}
                    <span className="font-black text-[var(--text-primary)]">It is a proof.</span>
                  </PanelBody>
                  <p className="mt-[var(--space-2)] text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                    A capability system with monotone attenuation &mdash; the model
                    lives in the Anchor Protocol chapter.
                  </p>
                </blockquote>
                {/* Phase 4, drawn: how a revocation reaches the whole fleet. */}
                <AnchorRevocationGossip />
              </div>
            </div>
          </PageContainer>
        </section>

        {/* ── §2 Authority only ever shrinks downstream ── */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.44fr)_minmax(0,0.56fr)] lg:items-center">
              <div className="space-y-[var(--space-3)]">
                <PanelEyebrow>Attenuation by construction</PanelEyebrow>
                <PanelTitle as="h2" size="section" className="max-w-[18ch]">
                  Authority only ever shrinks downstream.
                </PanelTitle>
                <PanelBody className="max-w-[52ch]">
                  When AgentA hands work to AgentB, the dangerous default is that B
                  inherits A&rsquo;s full reach. Port Daddy inverts that. A
                  delegated capability can only <em>contract</em>:
                </PanelBody>
                <ul className="grid gap-[var(--space-2)]">
                  <li className="flex gap-[var(--space-2)]">
                    <span aria-hidden="true" className="font-mono font-black text-[var(--brand-primary)]">⊊</span>
                    <PanelBody className="text-[length:var(--type-panel-body-compact-size)]">
                      the child&rsquo;s permissions are a strict subset of the parent&rsquo;s,
                    </PanelBody>
                  </li>
                  <li className="flex gap-[var(--space-2)]">
                    <span aria-hidden="true" className="font-mono font-black text-[var(--brand-primary)]">&lt;</span>
                    <PanelBody className="text-[length:var(--type-panel-body-compact-size)]">
                      the child&rsquo;s lifetime is shorter than the parent&rsquo;s,
                    </PanelBody>
                  </li>
                  <li className="flex gap-[var(--space-2)]">
                    <span aria-hidden="true" className="font-mono font-black text-[var(--brand-primary)]">✕</span>
                    <PanelBody className="text-[length:var(--type-panel-body-compact-size)]">
                      and the child cannot re-grant a right it never held.
                    </PanelBody>
                  </li>
                </ul>
                <PanelBody className="max-w-[52ch]">
                  The parent signs the child&rsquo;s narrowed claim set at the
                  moment of delegation, and the daemon re-checks it at
                  verification. AgentB inherits exactly what AgentA chose to hand
                  down &mdash; and an attacker who captures B inherits a smaller
                  blast radius than A, by construction.
                </PanelBody>
              </div>
              <div>
                <AnchorCapabilityAttenuation />
              </div>
            </div>
          </PageContainer>
        </section>

        {/* ── §3 Every message is an envelope nobody can quietly open or redirect ── */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.44fr)_minmax(0,0.56fr)] lg:items-center">
              <div className="space-y-[var(--space-3)]">
                <PanelEyebrow>No privileged position</PanelEyebrow>
                <PanelTitle as="h2" size="section" className="max-w-[22ch]">
                  Every message is an envelope nobody can quietly open or redirect.
                </PanelTitle>
                <PanelBody className="max-w-[52ch]">
                  Most systems send messages like a postcard: anyone who handles
                  it on the way can read it, scribble on it, or drop it in a
                  different mailbox. Port Daddy sends a{' '}
                  <span className="font-black text-[var(--text-primary)]">sealed, signed letter with the address baked in</span>.
                  Agents and operators talk constantly &mdash; claims, notes,
                  hand-offs, settlement &mdash; and every one of those messages is
                  sealed and signed before it leaves the sender.
                </PanelBody>
                <PanelBody className="max-w-[52ch]">
                  So picture the worst case in the figure: an attacker who has
                  completely taken over the relay in the middle. They still
                  can&rsquo;t <em>read</em> the message (it&rsquo;s sealed),
                  can&rsquo;t <em>change</em> it (any edit breaks the signature),
                  and can&rsquo;t <em>reroute</em> it (the destination is signed
                  in). Being in the middle buys them nothing &mdash; because the
                  middle was never trusted. That is what zero trust means here.
                </PanelBody>
              </div>
              <div className="space-y-[var(--space-4)]">
                <ZeroTrustEnvelope />
                {/* Where the signing actually matters: the trust boundary. */}
                <RelayTrustBoundary />
              </div>
            </div>
          </PageContainer>
        </section>

        {/* ── §3.5 Sybil resistance — flooding with fakes accomplishes nothing ── */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.44fr)_minmax(0,0.56fr)] lg:items-center">
              <div className="space-y-[var(--space-3)]">
                <PanelEyebrow>Sybil resistance</PanelEyebrow>
                <PanelTitle as="h2" size="section" className="max-w-[22ch]">
                  A thousand fake agents still add up to nothing.
                </PanelTitle>
                <PanelBody className="max-w-[52ch]">
                  The cheapest attack on any open system is to spin up a swarm of
                  fake identities and overwhelm it by sheer count. Port Daddy
                  defeats that without an account gate. Making a new identity is
                  cheap &mdash; on purpose. What is <em>not</em> cheap is making one
                  anybody trusts: that takes a posted bond and a track record built
                  over time.
                </PanelBody>
                <PanelBody className="max-w-[52ch]">
                  Influence comes from <span className="font-black text-[var(--text-primary)]">continuity, not count</span>.
                  One agent with history outweighs a crowd of newborns, so flooding
                  the system with fakes buys the attacker no standing at all.
                </PanelBody>
              </div>
              <div>
                <SybilResistance />
              </div>
            </div>
          </PageContainer>
        </section>

        {/* ── §4 When an agent dies, its work survives ── */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.44fr)_minmax(0,0.56fr)] lg:items-start">
              <div className="space-y-[var(--space-3)]">
                <PanelEyebrow>Collateralized work</PanelEyebrow>
                <PanelTitle as="h2" size="section" className="max-w-[20ch]">
                  When an agent dies, its work survives.
                </PanelTitle>
                <PanelBody className="max-w-[52ch]">
                  When you hire a contractor to remodel a kitchen, they post a
                  performance bond. If they walk off the job, the bond pays for
                  someone else to finish it. The work is protected even though the
                  worker is not guaranteed.
                </PanelBody>
                <PanelBody className="max-w-[52ch]">
                  An agent claiming a file is a contractor claiming a job. Its
                  &ldquo;bond&rdquo; is not money &mdash; it is structured context:
                  its file claims, its notes, its last heartbeat. If the agent dies
                  mid-task, that context is preserved, and the next agent can see
                  exactly what was underway and pick it up. Value moves through the
                  system; it never vanishes. A single conserving ledger sees to
                  that, and the escrow that sits on top of it has only two moves
                  &mdash; pay out, or refund. It can never quietly redirect your
                  money or your work.
                </PanelBody>
                <blockquote className="border-l-4 border-[var(--brand-accent)] bg-[var(--surface-base)] p-[var(--space-4)]">
                  <PanelBody className="text-[length:var(--type-panel-body-compact-size)]">
                    <span className="font-black text-[var(--text-primary)]">No work is lost.</span>{' '}
                    If an agent dies, its last known state is available to its
                    successor. That is the guarantee &mdash; and it is what lets you
                    walk away from a swarm without walking away from the results.
                  </PanelBody>
                </blockquote>
                <p className="text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                  In mechanism-design language this is a collateralized work
                  contract; the market it enables is two-sided until reputation
                  ships, three-sided by design.
                </p>
              </div>
              <div className="space-y-[var(--space-4)] lg:sticky lg:top-[var(--space-6)]">
                <ThreeSidedMarket />
                <CodeBlock language="bash">{`pd begin --identity myapp:api --purpose "refactor auth module"
pd session files claim src/auth.ts src/auth.test.ts
pd note "Race condition in token refresh/retry. Starting there."
# If this agent dies, \`pd salvage\` shows its successor exactly this.`}</CodeBlock>
              </div>
            </div>
          </PageContainer>
        </section>

        {/* ── §5 Governing a commons of agents (Ostrom, not Hobbes-by-default) ── */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.44fr)_minmax(0,0.56fr)] lg:items-center">
              <div className="space-y-[var(--space-3)]">
                <PanelEyebrow>Ostrom, not Hobbes-by-default</PanelEyebrow>
                <PanelTitle as="h2" size="section" className="max-w-[20ch]">
                  Governing a commons of agents.
                </PanelTitle>
                <PanelBody className="max-w-[52ch]">
                  A swarm shares scarce things: ports, files, the single source of
                  truth about what&rsquo;s claimed. Left ungoverned, shared
                  resources get trampled &mdash; the classic tragedy of the
                  commons, now playing out between processes. The reflex is a
                  Leviathan: one all-powerful authority that dictates and punishes.
                  Port Daddy takes the subtler path Elinor Ostrom documented in
                  commons that actually survive: clear boundaries, rules that fit
                  local conditions, monitoring by the participants, and &mdash;
                  crucially &mdash; <em>graduated</em> sanctions. A first missed
                  coordination note is a nudge, not a guillotine. Repeated breaches
                  cost progressively more, capped so a penalty never seizes the
                  whole bond. Punishment is proportionate, and it is the same rule
                  for every actor, human or agent.
                </PanelBody>
                <blockquote className="border-l-4 border-[var(--brand-primary)] bg-[var(--surface-raised)] p-[var(--space-4)]">
                  <PanelBody className="text-[length:var(--type-panel-body-compact-size)]">
                    Without coordination, a swarm is Hobbes&rsquo;s war of all
                    against all. The fix is not a tyrant. It is a small, legible set
                    of rules that every agent can see &mdash; and a coordinator
                    whose correctness you can check.
                  </PanelBody>
                </blockquote>
              </div>
              <div className="space-y-[var(--space-4)]">
                <CommonsGovernance />
                {/* The graduated-sanction ladder, drawn as a mechanism. */}
                <BondSlashMechanism />
              </div>
            </div>
          </PageContainer>
        </section>

        {/* ── Closing CTA ── */}
        <section className="py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.5fr)_minmax(0,0.5fr)] lg:items-center">
              <div className="space-y-[var(--space-3)]">
                <PanelTitle as="h2" size="section" className="max-w-[16ch]">
                  The proofs are public. So is the install.
                </PanelTitle>
                <PanelBody className="max-w-[48ch]">
                  Read the Anchor Protocol chapter for the full model and the
                  ProVerif results &mdash; or just run it.
                </PanelBody>
                <div className="flex flex-wrap gap-[var(--space-3)] text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                  <Link to="/library#the-architecture-drawn" className="inline-flex items-center gap-[var(--space-1)] text-[var(--brand-primary)] hover:underline">
                    Anchor Protocol paper <ArrowRight size={14} />
                  </Link>
                  <Link to="/library" className="inline-flex items-center gap-[var(--space-1)] text-[var(--brand-primary)] hover:underline">
                    Federated Harbor paper <ArrowRight size={14} />
                  </Link>
                  <Link to="/whitepaper" className="inline-flex items-center gap-[var(--space-1)] text-[var(--brand-primary)] hover:underline">
                    The spec <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
              <CodeBlock language="bash">{`brew install curiositech/tap/port-daddy
pd begin --identity myapp:api`}</CodeBlock>
            </div>
          </PageContainer>
        </section>
      </main>
      <Footer />
    </div>
  )
}
