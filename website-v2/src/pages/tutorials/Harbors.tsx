import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Badge } from "@/components/ui/Badge";
import { Shield, Lock, Key, Zap, AlertTriangle, Users } from "lucide-react";
import { Surface } from "@/components/ui/Surface";

export function Harbors() {
  return (
    <TutorialLayout
      title="Start Inside a Harbor"
      description="A harbor is the named project boundary where agents, sessions, notes, claims, channels, services, and recovery records belong."
      number={1}
      total={20}
      level="Advanced"
      readTime="12 min read"
      next={{
        title: "Install the Local Control Plane",
        href: "/tutorials/getting-started",
      }}
    >
      <div className="space-y-12">
        {/* Why Harbors Exist */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] flex items-center justify-center">
              <Shield className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">Why the Harbor Comes First</h2>
          </div>
          <p>
            Port Daddy work starts by choosing the harbor: the named boundary
            for a project, team, or sensitive workstream. The harbor is where
            an agent's permissions, notes, file claims, messages, service
            registrations, and recovery evidence line up.
          </p>
          <p>
            Ports still matter, but they are not the product story. A port is
            one resource inside the harbor. The bigger job is making several
            agents legible to each other: who is working, what they claimed,
            what they learned, which channel they signaled, what they are
            allowed to touch, and how another agent can recover the work later.
          </p>
          <p>
            For serious agent work, treat the harbor as compulsory. Older
            low-level commands can still run without an explicit harbor for
            compatibility, but the operator model is harbor-first: create or
            enter the boundary, then begin sessions, spawn agents, publish
            events, register services, and inspect the fleet from there.
          </p>
          <Surface
            depth="flat"
            radius="none"
            padding="md"
            className="border-l-4 border-[var(--brand-secondary)]"
          >
            <p
              className="m-0 text-[length:var(--type-panel-body-compact-size)]"
              style={{ color: "var(--text-secondary)" }}
            >
              <strong>Operator Rule:</strong> if another agent should be able
              to understand, inherit, audit, or safely constrain the work, it
              belongs in a harbor. That includes sessions, notes, files,
              channels, locks, services, tunnels, spawned jobs, and fleet runs.
            </p>
          </Surface>
        </section>

        {/* Step 1: Creation */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] flex items-center justify-center">
              <Lock className="text-[var(--brand-accent)]" size={20} />
            </div>
            <h2 className="m-0">1. Create or Enter the Project Harbor</h2>
          </div>

          <p>
            Start by defining the boundary that all agents should share. A
            common pattern is <code>project:workstream</code>: clear enough for
            humans, specific enough for automation, and stable across sessions.
          </p>

          <CodeBlock copyable={false} language="bash">
            {`$ pd harbor create my-app:main

Created harbor: my-app:main
Default capabilities: sessions, notes, files, channels, locks, services

$ pd harbor enter my-app:main

Harbor: my-app:main
Card:   issued for this shell
Scope:  project coordination`}
          </CodeBlock>

          <p>
            Now the rest of the work has somewhere to land. Sessions and notes
            are not floating terminal residue. File claims, channel events,
            service records, and spawned-agent history can be inspected through
            the same boundary.
          </p>

          <div className="space-y-3">
            <div className="p-4  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Badge variant="teal">Capability: code:read</Badge>
              <p className="text-[length:var(--type-panel-body-compact-size)] m-0 mt-2 leading-relaxed text-[var(--text-secondary)]">
                Sessions, notes, file claims, locks, channels, services, and
                recovery records are recorded against the same named boundary.
              </p>
            </div>
            <div className="p-4  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Badge variant="gold">Capability: notes:write</Badge>
              <p className="text-[length:var(--type-panel-body-compact-size)] m-0 mt-2 leading-relaxed text-[var(--text-secondary)]">
                Risky work can use narrower capabilities and TTLs without
                changing the normal everyday harbor flow.
              </p>
            </div>
          </div>
        </section>

        {/* Step 2: Entrance */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] flex items-center justify-center">
              <Key className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">2. Begin Work Inside It</h2>
          </div>

          <p>
            Once the shell or app has entered the harbor, start a session before
            the agent edits files. This gives the rest of the fleet a live
            identity, a purpose, and a place to read handoffs.
          </p>

          <CodeBlock copyable={false} language="bash">
            {`$ pd begin "Add password reset flow" \\
    --identity my-app:codex:auth \\
    --files src/auth/reset.ts

Started session: session-8a31
Agent: my-app:codex:auth
Harbor: my-app:main
Claimed: src/auth/reset.ts

$ pd note "Reset email template is implemented; API handler remains."

Note added to session-8a31`}
          </CodeBlock>

          <p>
            Spawned agents should enter the same boundary. Their notes,
            heartbeats, cost records, and salvage data become visible beside the
            human session instead of living in an isolated transcript.
          </p>

          <CodeBlock copyable={false} language="bash">
            {`$ pd spawn --backend claude --model claude-haiku-4-5 \\
    --harbor my-app:main \\
    --budget 0.50 \\
    -- "Review the password reset flow and leave notes for the implementer"`}
          </CodeBlock>

          <p>
            This is the value people usually expect from an orchestration layer,
            but Port Daddy is more basic and more portable: it is the shared
            communication substrate underneath whichever agent tool you already
            use.
          </p>
        </section>

        {/* Step 3: What Happens When It Expires */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] flex items-center justify-center border-2 border-[var(--brand-accent)]">
              <AlertTriangle className="text-[var(--brand-accent)]" size={20} />
            </div>
            <h2 className="m-0">3. Tighten Capabilities for Risky Work</h2>
          </div>

          <p>
            The default project harbor is the common workspace. For sensitive
            jobs, create a narrower harbor with explicit capabilities and a TTL.
            A security review should be able to read code and write notes; it
            does not need to edit files, create tunnels, or run migrations.
          </p>

          <CodeBlock copyable={false} language="bash">
            {`$ pd harbor create my-app:security-review \\
    --cap "code:read,notes:write" \\
    --ttl 2h

$ pd spawn --backend claude \\
    --harbor my-app:security-review \\
    -- "Review src/auth for vulnerabilities and write findings as notes"

$ pd harbor leave my-app:security-review

Left harbor: my-app:security-review
Token JTI burned — cannot be reused.`}
          </CodeBlock>

          <p>
            The "JTI burned" message means Port Daddy records the token's unique
            identifier in a revocation list. Even if someone copies the raw JWT
            string, it will be rejected because the daemon checks the JTI
            against the revocation list on every request.
          </p>

          <Surface
            depth="flat"
            radius="none"
            padding="md"
            className="border-l-4 border-[var(--brand-secondary)]"
          >
            <p
              className="m-0 text-[length:var(--type-panel-body-compact-size)]"
              style={{ color: "var(--text-secondary)" }}
            >
              <strong>Common Pitfall:</strong> treating harbors as an advanced
              security feature only. The project harbor is the normal starting
              point. Narrow, expiring harbors are the advanced move.
            </p>
          </Surface>
        </section>

        {/* When to Use Harbors */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] flex items-center justify-center border-2 border-[var(--brand-primary)]">
              <Users className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">What Belongs in the Harbor</h2>
          </div>

          <p>
            Use the harbor as the stable noun for the project. Then attach the
            moving parts to it:
          </p>

          <div className="space-y-3">
            <div className="p-4  bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
              <p className="font-bold text-[var(--text-primary)] m-0 mb-1">
                Sessions and notes
              </p>
              <p className="text-[length:var(--type-panel-body-compact-size)] m-0 text-[var(--text-secondary)]">
                Every agent gets a live session, a purpose, progress notes, and
                salvage evidence another agent can read later.
              </p>
            </div>
            <div className="p-4  bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
              <p className="font-bold text-[var(--text-primary)] m-0 mb-1">
                Files, locks, and services
              </p>
              <p className="text-[length:var(--type-panel-body-compact-size)] m-0 text-[var(--text-secondary)]">
                File claims, locks, service names, tunnels, and runtime records
                stay scoped to the project boundary.
              </p>
            </div>
            <div className="p-4  bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
              <p className="font-bold text-[var(--text-primary)] m-0 mb-1">
                Channels and inboxes
              </p>
              <p className="text-[length:var(--type-panel-body-compact-size)] m-0 text-[var(--text-secondary)]">
                Agents can publish events, send direct handoffs, and inspect
                unread work without sharing one terminal.
              </p>
            </div>
            <div className="p-4  bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
              <p className="font-bold text-[var(--text-primary)] m-0 mb-1">
                Fleets and spawned jobs
              </p>
              <p className="text-[length:var(--type-panel-body-compact-size)] m-0 text-[var(--text-secondary)]">
                Background agents, one-shot jobs, budgets, model readiness, and
                recovery history become visible in the same control plane.
              </p>
            </div>
          </div>

          <p>
            That is the mental model for the rest of the tutorials: first the
            harbor, then the work. The following lessons teach each primitive
            as something that happens inside that boundary.
          </p>
        </section>

        {/* The Formal Verification Note */}
        <Surface depth="raised" radius="none" className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Zap size={18} className="text-[var(--brand-primary)]" />
            <p className="text-[length:var(--type-meta-size)] font-black uppercase tracking-widest text-[var(--text-muted)] m-0">
              Implementation Detail
            </p>
          </div>
          <p className="m-0 text-[var(--text-secondary)]">
            Harbor Cards are standard JWTs signed with HMAC-SHA256 using a
            per-daemon secret key. The daemon generates this key on first run
            and stores it in the SQLite database. Tokens cannot be forged
            without access to the daemon's database file, and each token's JTI
            (unique identifier) is tracked so it can be revoked independently.
          </p>
        </Surface>
      </div>
    </TutorialLayout>
  );
}
