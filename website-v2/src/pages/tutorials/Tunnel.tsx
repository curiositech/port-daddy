import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import {
  Globe,
  Zap,
  Share2,
  Network,
  Lock as LockIcon,
} from "lucide-react";

export function Tunnel() {
  return (
    <TutorialLayout
      title="Expose a Harbor Service"
      description="Publish one harbor-owned service through pd tunnel with clear ownership, explicit provider choice, and a reversible path."
      number={7}
      total={21}
      level="Beginner"
      readTime="6 min read"
      prev={{
        title: "Debugging with Port Daddy",
        href: "/tutorials/debugging",
      }}
      next={{ title: "DNS Resolver", href: "/tutorials/dns" }}
    >
      <div className="space-y-12">
        {/* Concept Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Globe className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">Public URLs for Local Services</h2>
          </div>
          <p>
            Port Daddy's tunnel system wraps popular tunnel providers (ngrok,
            cloudflared, localtunnel) to expose your locally-claimed services to
            the internet. It manages the tunnel lifecycle alongside your port
            claims -- start a tunnel, share the URL, stop it when done.
          </p>
          <div className="space-y-3 pt-2">
            <p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)] m-0">
              <LockIcon
                size={14}
                className="inline text-[var(--brand-secondary)] mr-1"
              />
              <strong>Provider Agnostic</strong> -- Works with whichever tunnel
              provider you have installed. Port Daddy detects available
              providers automatically.
            </p>
            <p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)] m-0">
              <Network
                size={14}
                className="inline text-[var(--brand-accent)] mr-1"
              />
              <strong>Lifecycle Managed</strong> -- Tunnels are tied to your
              port claims. The daemon tracks active tunnels and can clean them
              up on shutdown.
            </p>
          </div>
        </section>

        {/* Step 1: Check providers */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Share2 className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">1. Check Available Providers</h2>
          </div>

          <p>
            First, check which tunnel providers are installed on your system.
          </p>

          <CodeBlock copyable={false} language="bash">
            {
              "PD_URL=\"\${PORT_DADDY_URL:-$(cat ~/.port-daddy/daemon.port 2>/dev/null | sed 's#^#http://127.0.0.1:#')}\"\n$ curl \"$PD_URL/tunnel/providers\"\n\n# Returns list of available providers (ngrok, cloudflare, localtunnel)"
            }
          </CodeBlock>

          <p
            className="m-0 text-[length:var(--type-panel-body-compact-size)] border-l-4 border-[var(--brand-secondary)] pl-4"
            style={{ color: "var(--text-secondary)" }}
          >
            Port Daddy doesn't implement its own tunneling -- it spawns your
            existing tunnel provider's CLI (ngrok, cloudflared, or localtunnel),
            parses the public URL from its output, and stores it alongside your
            port claim for other agents to discover.
          </p>
        </section>

        {/* Step 2: Start a tunnel */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Zap className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">2. Start a Tunnel</h2>
          </div>

          <p>
            Start a tunnel for any service that has a claimed port. The provider
            wraps your local port in a public URL.
          </p>

          <CodeBlock copyable={false} language="bash">
            {
              'PD_URL="\${PORT_DADDY_URL:-$(cat ~/.port-daddy/daemon.port 2>/dev/null | sed \'s#^#http://127.0.0.1:#\')}"\n# Start a tunnel using ngrok for a claimed service\n$ curl -X POST "$PD_URL/tunnel/myapp:api" \\\n    -H "Content-Type: application/json" \\\n    -d \'{"provider": "ngrok"}\'\n\n# Response:\n# { "url": "https://abc123.ngrok.io", "provider": "ngrok", "port": 3102 }\n\n# Check tunnel status\n$ curl "$PD_URL/tunnel/myapp:api"\n\n# List all active tunnels\n$ curl "$PD_URL/tunnels"\n\n# Stop a tunnel\n$ curl -X DELETE "$PD_URL/tunnel/myapp:api"'
            }
          </CodeBlock>

          <p
            className="m-0 text-[length:var(--type-panel-body-compact-size)] border-l-4 border-[var(--brand-secondary)] pl-4"
            style={{ color: "var(--text-secondary)" }}
          >
            The tunnel URL is stored in the daemon's service registry. Other
            agents can discover it via <code>pd find</code> or the{" "}
            <code>/tunnel/:id</code> API endpoint, making it easy to share
            public URLs across your swarm automatically.
          </p>
        </section>

        {/* Security Callout */}
        <section className="p-6 text-center space-y-4">
          <p className="text-[length:var(--type-panel-title-nav-size)] max-w-xl mx-auto text-[var(--text-secondary)]">
            Unlike a VPN, Port Daddy tunnels are{" "}
            <strong>per-identity</strong>. You don't expose your whole network --
            only the specific semantic identities you have claimed in your
            harbor.
          </p>
        </section>
      </div>
    </TutorialLayout>
  );
}
