import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Badge } from "@/components/ui/Badge";
import { Box, Layers, Zap, Activity, Anchor, ArrowRight } from "lucide-react";
import { Surface } from "@/components/ui/Surface";

export function Monorepo() {
  return (
    <TutorialLayout
      title="Map a Monorepo Harbor"
      description="Scan a large repo, detect service boundaries, register them inside the harbor, and bring the local stack up and down cleanly."
      number={5}
      total={22}
      level="Intermediate"
      readTime="10 min read"
      prev={{
        title: "Multi-Agent Orchestration",
        href: "/tutorials/multi-agent",
      }}
      next={{
        title: "Debugging with Port Daddy",
        href: "/tutorials/debugging",
      }}
    >
      <div className="space-y-12">
        {/* Intro Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Layers className="text-[var(--brand-accent)]" size={20} />
            </div>
            <h2 className="m-0">The Monorepo Nightmare</h2>
          </div>
          <p>
            You have fifteen services, three databases, a search engine, and a
            handful of agents trying to understand the same repo.{" "}
            <strong>Fleet Management</strong> turns that into a harbor-scoped
            service mesh with one place to inspect what is running.
          </p>
          <div className="space-y-3 pt-2">
            <p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)] m-0">
              <Zap
                size={14}
                className="inline text-[var(--brand-secondary)] mr-1"
              />
              <strong>Zero-Config DNS</strong> -- Services find each other via
              semantic names instead of hardcoded <code>localhost:3001</code>{" "}
              URLs.
            </p>
            <p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)] m-0">
              <Anchor
                size={14}
                className="inline text-[var(--brand-secondary)] mr-1"
              />
              <strong>Atomic Assignment</strong> -- Ports are hashed from
              directory paths, ensuring the same service always gets the same
              port.
            </p>
          </div>
        </section>

        {/* Step 1: Scanning */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Box className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">1. Index the Fleet</h2>
          </div>

          <p>
            Use the <code>scan</code> command to let Port Daddy auto-detect
            every service in your project. It supports over 60 frameworks out of
            the box.
          </p>

          <CodeBlock copyable={false} language="bash">
            {`$ pd scan ./services\n\n✓ Found 12 services in 1.4s\n  - services/auth (Next.js)\n  - services/api (Express)\n  - services/worker (Go)`}
          </CodeBlock>

          <p className="m-0 text-[length:var(--type-panel-body-compact-size)] border-l-4 border-[var(--brand-secondary)] pl-4 text-[var(--text-secondary)]">
            Port Daddy creates a local SQLite registry of your services,
            allowing agents to query the fleet status at any time.
          </p>
        </section>

        {/* Step 2: Launching */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Activity className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">2. Bring the Stack Up</h2>
          </div>

          <p>
            The <code>pd up</code> command launches your services in dependency
            order, assigning atomic ports and wiring up the internal DNS.
          </p>

          <CodeBlock copyable={false} language="bash">
            {`$ pd up\n\n[payment-stack] Starting 12 services...\n✓ [auth]   Started on port 3101\n✓ [api]    Started on port 3102\n✓ [worker] Started on port 3103\n\nMesh health: 100% (All services responding)`}
          </CodeBlock>

          <Surface depth="flat" radius="none" className="p-5 space-y-3">
            <p className="text-[length:var(--type-meta-size)] font-black uppercase tracking-widest text-[var(--text-muted)] m-0">
              Internal Service Mesh
            </p>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-[length:var(--type-meta-size)] font-mono">
                <span>
                  <code className="text-[var(--brand-primary)]">
                    auth.pd.local
                  </code>
                  <ArrowRight
                    size={12}
                    className="inline text-[var(--text-muted)] mx-2"
                  />
                  <code className="text-[var(--text-secondary)]">
                    localhost:3101
                  </code>
                </span>
                <Badge variant="teal">Healthy</Badge>
              </div>
              <div className="flex items-center justify-between text-[length:var(--type-meta-size)] font-mono">
                <span>
                  <code className="text-[var(--brand-primary)]">
                    api.pd.local
                  </code>
                  <ArrowRight
                    size={12}
                    className="inline text-[var(--text-muted)] mx-2"
                  />
                  <code className="text-[var(--text-secondary)]">
                    localhost:3102
                  </code>
                </span>
                <Badge variant="teal">Healthy</Badge>
              </div>
            </div>
          </Surface>
        </section>

        {/* Resilience Callout */}
        <section className="p-6 text-center space-y-4">
          <p className="text-[length:var(--type-panel-title-nav-size)] max-w-xl mx-auto text-[var(--text-secondary)]">
            Fleet management isn't just about starting scripts -- it's about
            building a <strong>shared environment</strong>. When your frontend
            agent needs the API, it doesn't search for a port. It asks the Port
            Daddy mesh for the API identity.
          </p>
        </section>
      </div>
    </TutorialLayout>
  );
}
