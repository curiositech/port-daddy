import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import {
  Globe,
  Terminal,
  Network,
  Anchor,
  Cpu,
  Sparkles,
} from "lucide-react";
import { Surface } from "@/components/ui/Surface";

export function RemoteHarbors() {
  return (
    <TutorialLayout
      title="Multiplayer Localhost"
      description="The swarm doesn't stop at your machine. Harbors on the relay let daemons find each other by name; invites, device pairing, and end-to-end sealing are designed-not-built and gate launch."
      number={17}
      total={21}
      level="Advanced"
      readTime="15 min read"
      prev={{ title: "Swarm Observation", href: "/tutorials/watch" }}
      next={{ title: "Fleet: Background Agents", href: "/tutorials/fleet" }}
    >
      <div className="space-y-12">
        {/* Status banner */}
        <p
          className="m-0 text-[length:var(--type-panel-body-compact-size)] border-l-4 border-[var(--brand-accent)] pl-4"
          style={{ color: "var(--text-secondary)" }}
        >
          <strong>Where this actually stands:</strong> harbors exist on the
          relay today -- you can create one, list the ones you belong to, and
          fetch a harbor's detail and member list. Joining a harbor by invite,
          pairing a second device into it, and end-to-end sealing of what
          flows between members are designed-not-built: the plan is written,
          PRs are open, and none of it ships until full end-to-end encryption
          is in place -- that's the gate on launching shared harbors, not on
          building them.
        </p>

        {/* Intro Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Globe className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">The Vision: Multi-Machine Coordination</h2>
          </div>
          <p>
            <strong>Remote Harbors</strong> will let you treat agents running
            on different machines -- a teammate's laptop, a cloud GPU cluster
            -- as members of a single named harbor. The relay already knows
            what a harbor is: a name in a namespace, a public key, and a
            membership list. What it doesn't do yet is move any encrypted
            payload between members, or let someone join without already
            being added.
          </p>
          <div className="space-y-3 pt-2">
            <div className="flex items-start gap-3">
              <Anchor
                size={18}
                className="text-[var(--brand-secondary)] mt-0.5 shrink-0"
              />
              <p className="m-0 text-[length:var(--type-panel-body-compact-size)]">
                <strong>Designed-not-built:</strong> signed single-use invite
                links and a <code>/join</code> endpoint, so a second person can
                get into a harbor without an owner adding them by hand.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <Sparkles
                size={18}
                className="text-[var(--brand-accent)] mt-0.5 shrink-0"
              />
              <p className="m-0 text-[length:var(--type-panel-body-compact-size)]">
                <strong>Designed-not-built:</strong> device pairing and
                daemon-to-daemon end-to-end channel-key distribution, so what
                members send each other is sealed before it touches the
                relay. This is the gate on launching shared harbors to
                anyone outside your own account.
              </p>
            </div>
          </div>
        </section>

        {/* Step 1: What exists on the relay today */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Network className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">1. What Exists on the Relay Today</h2>
          </div>

          <p>
            The relay's harbor surface v1 is live: it ships a name, a
            client-generated public key, and a membership list -- nothing
            more. The relay never holds a key on a harbor's behalf; it's a
            phone book, not a vault.
          </p>

          <CodeBlock copyable={false} language="bash">
            {`# Live on the relay today
POST /v1/harbors                          create a harbor (you supply the pubkey)
GET  /v1/harbors                          list harbors you belong to
GET  /v1/harbors/:namespace/:name         detail + members (member-gated)
POST /v1/harbors/:namespace/:name/members add a member (owner-gated, by hand)`}
          </CodeBlock>

          <p
            className="m-0 text-[length:var(--type-panel-body-compact-size)] border-l-4 border-[var(--brand-secondary)] pl-4"
            style={{ color: "var(--text-secondary)" }}
          >
            Membership here is an operator-plane row -- it controls who can
            see a harbor through this API. It is not yet the same as the
            daemon-to-daemon admission that a real handshake would gate on;
            that crypto plane is still designed-not-built. Discovery never
            grants admission either way: a non-member gets the same 404 as a
            harbor that doesn't exist, so there's no way to probe for names
            you're not already in.
          </p>
        </section>

        {/* Step 2: Designed-not-built */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Cpu className="text-[var(--brand-accent)]" size={20} />
            </div>
            <h2 className="m-0">2. Designed-not-Built: Invites, Pairing, Sealing</h2>
          </div>

          <p>
            The next slice of the plan -- not yet shipped -- adds a signed,
            single-use invite so a harbor owner can hand someone a link
            instead of adding them by hand, plus the key exchange that lets
            a second device join a harbor it wasn't created on:
          </p>

          <CodeBlock copyable={false} language="bash">
            {`# DESIGNED, NOT BUILT — no /join endpoint exists yet
$ pd harbor invite --create
# would mint a signed, single-use invite JTI

$ pd harbor join --invite pd-inv-7f3a-9921
# would exchange the invite for a harbor_members row + your device's card`}
          </CodeBlock>

          <p
            className="m-0 text-[length:var(--type-panel-body-compact-size)] border-l-4 border-[var(--brand-secondary)] pl-4"
            style={{ color: "var(--text-secondary)" }}
          >
            Full end-to-end sealing of what members exchange -- so the relay
            can route a harbor's traffic without reading it -- is
            designed-not-built too, and it's the specific gate on launching
            shared harbors. Harbors you create and use alone today are real;
            harbors with a second person actually exchanging sealed traffic
            are not live until that gate clears. Today, you can expose a
            local service externally with <code>pd tunnel</code> over ngrok
            or cloudflared, but that's one machine reaching out, not two
            daemons coordinating as harbor members.
          </p>
        </section>

        {/* What exists today (non-harbor building blocks) */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Terminal className="text-[var(--brand-accent)]" size={20} />
            </div>
            <h2 className="m-0">3. Other Building Blocks That Work Today</h2>
          </div>

          <p>
            Alongside the relay's harbor API, Port Daddy already has these
            building blocks for external access, all local to your daemon:
          </p>

          <CodeBlock copyable={false} language="bash">
            {`# Expose a local service via tunnel (works today)
pd tunnel myapp:api start --provider ngrok
SUCCESS: tunnel started for myapp:api

# Local DNS for service discovery (works today)
pd dns create myapp-api.local --port 3000
SUCCESS: DNS record myapp-api.local -> localhost:3000

# Pub/sub messaging between local agents (works today)
pd pub deploy:events "build-complete"
pd watch deploy:events --exec ./notify.sh
Watching deploy:events...`}
          </CodeBlock>

          <p>
            Your account page has a live <a href="/account#harbors">Harbors
            section</a> too: today it shows your personal harbor and tells
            you plainly that team and guest harbors surface there once
            membership is linked to your account -- it doesn't pretend the
            multi-person case is live before it is.
          </p>

          <div className="flex items-center justify-center gap-8 py-4">
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 flex items-center justify-center  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
                <Terminal size={20} className="text-[var(--brand-secondary)]" />
              </div>
              <span className="text-[length:var(--type-meta-size)] font-black uppercase tracking-[0.1em] text-[var(--text-muted)]">
                Local Dev
              </span>
            </div>
            <div className="flex-1 max-w-[80px] h-[2px] bg-[var(--border-default)]" />
            <div className="w-14 h-14  flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Globe size={24} className="text-[var(--text-inverse)]" />
            </div>
            <div className="flex-1 max-w-[80px] h-[2px] bg-[var(--border-default)]" />
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 flex items-center justify-center  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
                <Cpu size={20} className="text-[var(--brand-accent)]" />
              </div>
              <span className="text-[length:var(--type-meta-size)] font-black uppercase tracking-[0.1em] text-[var(--text-muted)]">
                Shared Harbors (gated)
              </span>
            </div>
          </div>
        </section>

        {/* Status Callout */}
        <Surface
          depth="raised"
          radius="none"
          className="p-6 text-center space-y-4 relative overflow-hidden"
        >
          <p
            className="text-[length:var(--type-panel-title-nav-size)] font-bold m-0"
            style={{ color: "var(--text-primary)" }}
          >
            Harbors exist. Sharing them across machines is gated on encryption, not on your calendar.
          </p>
          <p className="max-w-xl mx-auto text-[var(--text-secondary)] m-0">
            The relay's harbor surface v1 -- create, list, get, add member --
            is live today. Invites, device pairing, and end-to-end sealing
            are designed-not-built, with PRs open against that plan. Launch
            for shared harbors waits on full end-to-end encryption shipping,
            not on a date -- this page will move each piece from
            designed-not-built to live as it actually ships.
          </p>
        </Surface>
      </div>
    </TutorialLayout>
  );
}
