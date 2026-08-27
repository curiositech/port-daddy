import { motion } from "framer-motion";
import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Surface } from "@/components/ui/Surface";
import { Tag, Search, Network, Layers, GitBranch, Filter } from "lucide-react";

export function SemanticIdentities() {
  return (
    <TutorialLayout
      title="Name Work Inside the Harbor"
      description="Every service, agent, session, and channel in a harbor has a project:stack:context name. This is not decoration; it is how other agents find the work."
      number={3}
      total={22}
      level="Beginner"
      readTime="8 min read"
      prev={{ title: "Install and Verify the Daemon", href: "/tutorials/getting-started" }}
      next={{
        title: "Multi-Agent Orchestration",
        href: "/tutorials/multi-agent",
      }}
    >
      <motion.div className="space-y-16">
        {/* Why Names */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <Surface
              depth="flat"
              radius="none"
              padding="none"
              className="w-12 h-12 flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
            >
              <Tag className="text-[var(--brand-accent)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">The Problem With Port Numbers</motion.h2>
          </motion.div>
          <motion.p>
            Port 3000. Port 3001. Port 8080. What&apos;s running where? If you
            have three agents and five services, you&apos;re playing a guessing
            game. A port number tells you nothing about what it&apos;s for.
          </motion.p>
          <motion.p>
            Port Daddy replaces port numbers with{" "}
            <strong>semantic identities</strong>. Instead of &ldquo;give me a
            port,&rdquo; you say &ldquo;I am <code>myapp:api:main</code>.&rdquo;
            The daemon assigns the same port every time &mdash; deterministic
            hashing means the name IS the port.
          </motion.p>

          <motion.div className="grid sm:grid-cols-2 gap-6">
            <Surface depth="flat" radius="none" className="p-6 space-y-3">
              <motion.p
                className="m-0 font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)] line-through"
              >
                Without identities
              </motion.p>
              <CodeBlock copyable={false} language="bash">{`PORT=3000 node server.js
PORT=3001 node worker.js
# Which is which? Who knows.`}</CodeBlock>
            </Surface>
            <Surface depth="raised" radius="none" className="p-6 space-y-3">
              <motion.p
                className="m-0 font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]"
              >
                With identities
              </motion.p>
              <CodeBlock copyable={false} language="bash">{`PORT=$(pd claim myapp:api:main -q) node server.js
PORT=$(pd claim myapp:worker:main -q) node worker.js
# Names describe what they are.
# Expected result: each service starts with a stable port assigned from its semantic identity.`}</CodeBlock>
            </Surface>
          </motion.div>
        </section>

        {/* The Format */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface
              depth="flat"
              radius="none"
              padding="none"
              className="w-12 h-12 flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
            >
              <Layers className="text-[var(--brand-primary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">
              The Format: project:stack:context
            </motion.h2>
          </motion.div>

          <motion.p>
            Every identity has up to three segments, separated by colons:
          </motion.p>

          <Surface depth="raised" radius="none" className="p-8 overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Segment</th>
                  <th>Meaning</th>
                  <th>Example</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="py-2 pr-4">
                    <code style={{ color: "var(--brand-primary)" }}>
                      project
                    </code>
                  </td>
                  <td className="py-2 pr-4">Which project or repo</td>
                  <td className="py-2">
                    <code>myapp</code>, <code>port-daddy</code>,{" "}
                    <code>bosun</code>
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">
                    <code style={{ color: "var(--brand-secondary)" }}>
                      stack
                    </code>
                  </td>
                  <td className="py-2 pr-4">Which service layer</td>
                  <td className="py-2">
                    <code>api</code>, <code>frontend</code>, <code>worker</code>
                    , <code>db</code>
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">
                    <code style={{ color: "var(--brand-accent)" }}>
                      context
                    </code>
                  </td>
                  <td className="py-2 pr-4">Which environment or branch</td>
                  <td className="py-2">
                    <code>main</code>, <code>staging</code>,{" "}
                    <code>feature-auth</code>
                  </td>
                </tr>
              </tbody>
            </table>
          </Surface>

          <motion.p>
            You can use one, two, or all three segments. More segments = more
            specific.
          </motion.p>

          <CodeBlock copyable={false} language="bash">{`pd claim myapp                    # Just a project
pd claim myapp:api                # Project + stack
pd claim myapp:api:main           # Project + stack + context
pd claim myapp:api:feature-auth   # Same stack, different branch
# Expected result: each narrower identity gets its own deterministic claim.`}</CodeBlock>
        </section>

        {/* Wildcards and the Trie */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface
              depth="flat"
              radius="none"
              padding="none"
              className="w-12 h-12 flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
            >
              <Search className="text-[var(--brand-secondary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">Wildcard Queries</motion.h2>
          </motion.div>

          <motion.p>
            This is where the structure earns its keep. Because identities have
            a fixed shape, you can query across them with wildcards:
          </motion.p>

          <CodeBlock copyable={false} language="bash">{`# Find everything in myapp
pd find 'myapp:*'
# → myapp:api:main (port 3100)
# → myapp:frontend:main (port 3101)
# → myapp:worker:main (port 3102)

# Find all API services across all projects
pd find '*:api:*'
# → myapp:api:main (port 3100)
# → bosun:api:main (port 3200)
# → marketing:api:staging (port 3300)

# Find all services on feature branches
pd find 'myapp:*:feature-*'
# → myapp:api:feature-auth (port 3150)
# → myapp:frontend:feature-auth (port 3151)`}</CodeBlock>

          <Surface depth="flat" radius="none" className="p-6 space-y-3">
            <motion.p
              className="text-[length:var(--type-panel-body-compact-size)] font-bold m-0"
              style={{ color: "var(--brand-primary)" }}
            >
              Under the hood: the Semantic Trie
            </motion.p>
            <motion.p
              className="text-[length:var(--type-meta-size)] m-0 leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              Port Daddy indexes every identity in an in-memory radix trie.
              Lookups are O(k) where k is the length of the key &mdash; not the
              number of entries. That means{" "}
              <code>pd find &apos;myapp:*&apos;</code> is instant even with
              10,000 registered services. The trie populates from SQLite on
              daemon startup and stays in sync on every claim/release.
            </motion.p>
          </Surface>
        </section>

        {/* Identities Everywhere */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface
              depth="flat"
              radius="none"
              padding="none"
              className="w-12 h-12 flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
            >
              <Network className="text-[var(--brand-accent)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">Identities Are Everywhere</motion.h2>
          </motion.div>

          <motion.p>
            Semantic identities aren&apos;t just for ports. Every coordination
            primitive in Port Daddy uses them:
          </motion.p>

          <motion.div className="space-y-3">
            {[
              {
                label: "Services",
                example: "pd claim myapp:api:main",
                desc: "Port assignment scoped to identity",
              },
              {
                label: "Agents",
                example: "pd agent register --identity myapp:fleet:qa",
                desc: "Agent registration with project scope",
              },
              {
                label: "Sessions",
                example: 'pd begin "Investigate API drift" --identity myapp:api --lifecycle durable',
                desc: "Work sessions tied to what you're building",
              },
              {
                label: "Fleet",
                example: 'harbor: "{project}:fleet"',
                desc: "Fleet agents share a scoped harbor",
              },
              {
                label: "Salvage",
                example: "pd salvage --project myapp",
                desc: "Find dead agents in your project only",
              },
              {
                label: "DNS",
                example: "pd dns resolve myapp:api",
                desc: "Local DNS records follow identities",
              },
            ].map((item) => (
              <Surface
                key={item.label}
                depth="raised"
                radius="none"
                className="p-4 flex items-start gap-4"
              >
                <span
                  className="w-16 shrink-0 font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]"
                >
                  {item.label}
                </span>
                <div className="flex-1 min-w-0">
                  <code
                    className="font-mono text-[length:var(--type-meta-size)] text-[var(--text-primary)]"
                  >
                    {item.example}
                  </code>
                  <p
                    className="m-0 mt-1 text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-muted)]"
                  >
                    {item.desc}
                  </p>
                </div>
              </Surface>
            ))}
          </motion.div>
        </section>

        {/* Branches as Context */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface
              depth="flat"
              radius="none"
              padding="none"
              className="w-12 h-12 flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
            >
              <GitBranch className="text-[var(--brand-primary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">Branches as Context</motion.h2>
          </motion.div>

          <motion.p>
            The <code>context</code> segment is where branches live. Two agents
            working on different feature branches get different ports
            automatically:
          </motion.p>

          <CodeBlock copyable={false} language="bash">{`# Agent on main branch
pd claim myapp:api:main          # → port 3100

# Agent on feature-auth branch (different port, no conflict)
pd claim myapp:api:feature-auth  # → port 3150

# Agent on feature-payments branch
pd claim myapp:api:feature-pay   # → port 3175

# Find all branches of the API
pd find 'myapp:api:*'
# → myapp:api:main (3100)
# → myapp:api:feature-auth (3150)
# → myapp:api:feature-pay (3175)`}</CodeBlock>

          <motion.p>
            The name is the coordination handle. Other agents can resolve the
            same work without guessing which process, branch, or service you
            meant.
          </motion.p>
        </section>

        {/* Naming Conventions */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4">
            <Surface
              depth="flat"
              radius="none"
              padding="none"
              className="w-12 h-12 flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
            >
              <Filter className="text-[var(--brand-secondary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">Naming Conventions</motion.h2>
          </motion.div>

          <Surface depth="raised" radius="none" className="p-8 overflow-x-auto">
            <table className="w-full text-[length:var(--type-panel-body-compact-size)]">
              <thead>
                <tr style={{ color: "var(--text-muted)" }}>
                  <th className="text-left pb-3 pr-4 font-semibold">Pattern</th>
                  <th className="text-left pb-3 pr-4 font-semibold">Use</th>
                  <th className="text-left pb-3 font-semibold">Query</th>
                </tr>
              </thead>
              <tbody style={{ color: "var(--text-secondary)" }}>
                <tr
                  className="border-t"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  <td className="py-2 pr-4">
                    <code>project:stack:main</code>
                  </td>
                  <td className="py-2 pr-4">Production/default services</td>
                  <td className="py-2">
                    <code>pd find &apos;*:*:main&apos;</code>
                  </td>
                </tr>
                <tr
                  className="border-t"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  <td className="py-2 pr-4">
                    <code>project:fleet:agent</code>
                  </td>
                  <td className="py-2 pr-4">Fleet agents in a project</td>
                  <td className="py-2">
                    <code>pd find &apos;project:fleet:*&apos;</code>
                  </td>
                </tr>
                <tr
                  className="border-t"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  <td className="py-2 pr-4">
                    <code>project:db:test</code>
                  </td>
                  <td className="py-2 pr-4">Test databases</td>
                  <td className="py-2">
                    <code>pd find &apos;*:db:test&apos;</code>
                  </td>
                </tr>
                <tr
                  className="border-t"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  <td className="py-2 pr-4">
                    <code>project:stack:feature-*</code>
                  </td>
                  <td className="py-2 pr-4">Feature branch services</td>
                  <td className="py-2">
                    <code>pd find &apos;project:*:feature-*&apos;</code>
                  </td>
                </tr>
              </tbody>
            </table>
          </Surface>
        </section>

        {/* Summary */}
        <section>
          <Surface depth="raised" radius="none" className="p-8 space-y-4">
            <motion.h3 className="m-0 font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] tracking-[var(--tracking-display-nav)] text-[var(--text-primary)]">
              The idea in one sentence
            </motion.h3>
            <motion.p
              className="m-0 text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]"
            >
              Name your services with <code>project:stack:context</code> and
              Port Daddy gives you deterministic ports, wildcard discovery,
              branch isolation, fleet scoping, and salvage filtering &mdash; all
              from the name alone. The name is the API.
            </motion.p>
          </Surface>
        </section>
      </motion.div>
    </TutorialLayout>
  );
}
