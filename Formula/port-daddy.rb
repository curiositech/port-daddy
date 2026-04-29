class PortDaddy < Formula
  desc "Authoritative port manager for multi-agent development"
  homepage "https://github.com/curiositech/port-daddy"
  url "https://github.com/curiositech/port-daddy/archive/refs/tags/v3.7.0.tar.gz"
  sha256 "REPLACE_WITH_ACTUAL_SHA256" # Placeholder for release pipeline
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]

    # Ship the agent skill alongside the daemon so `pd setup` can symlink it
    # into ~/.claude/skills/port-daddy/. Includes SKILL.md, schemas (semantic
    # identity, fleet schema, tuple, note, pheromone, salvage, MCP catalog),
    # examples (bootstrap, conflict, salvage, fleet, swarm, daemon-down,
    # port-collision), executable scripts (preflight, salvage-triage,
    # session-resume, fleet-validate, agent-handshake), templates, and the
    # static-HTML architecture brief.
    pkgshare.install "skills/port-daddy-agent-skill" => "skills/port-daddy"
  end

  def caveats
    <<~EOS
      The Port Daddy agent skill is installed at:
        #{opt_pkgshare}/skills/port-daddy

      To make it discoverable by Claude Code and other agent runtimes:
        pd setup                  # symlinks into ~/.claude/skills/port-daddy

      Or symlink manually:
        ln -sfn #{opt_pkgshare}/skills/port-daddy ~/.claude/skills/port-daddy
    EOS
  end

  test do
    system "#{bin}/pd", "version"
    assert_predicate pkgshare/"skills/port-daddy/SKILL.md", :exist?
  end
end
