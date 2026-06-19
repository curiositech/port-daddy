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

    # Ship the agent skill alongside the daemon so `pd setup` can symlink the
    # same instruction manual into Codex, Claude, AGENTS-aware, Gemini, and
    # compatible editor runtimes without copy drift.
    pkgshare.install "skills/port-daddy-agent-skill" => "skills/port-daddy-agent-skill"
  end

  def post_install
    # Refresh the cross-tool skill symlink union after every install/upgrade so
    # Codex, Claude, Gemini, and editor runtimes follow the current Windags and
    # workgroup skill sources without a manual copy step. Only the skill step
    # runs - daemon, MCP, FleetBar, and project init each have their own
    # lifecycle and should not be touched silently on every brew upgrade.
    return if ENV["HOME"].nil? || ENV["HOME"].empty?

    pd = opt_bin/"pd"
    return unless pd.exist?

    ohai "Refreshing Port Daddy cross-tool skill symlinks"
    system pd.to_s, "setup", "--no-daemon", "--no-mcp", "--no-fleetbar", "--no-init"
  end

  def caveats
    <<~EOS
      The Port Daddy agent skill is installed at:
        #{opt_pkgshare}/skills/port-daddy-agent-skill

      To make it discoverable by agent runtimes:
        pd setup                  # user-level links
        cd your-project && pd init # project-local links

      Setup links Port Daddy's canonical skill and the local skill union into:
        ~/.codex/skills/port-daddy-agent-skill
        ~/.claude/skills/port-daddy-agent-skill
        ~/.agents/skills/port-daddy-agent-skill
        ~/.gemini/skills/port-daddy-agent-skill
        ~/.config/cline/skills/port-daddy-agent-skill
        ~/.gemini/extensions/port-daddy/skills/port-daddy-agent-skill
        ~/.cursor/skills/port-daddy-agent-skill
        ~/.continue/skills/port-daddy-agent-skill
        ~/.windsurf/skills/port-daddy-agent-skill
        ...and other AGENTS-aware/editor skill registries

      Verify from the console:
        pd setup --status
        pd status

      Or open FleetBar/Fleet Control Center and confirm the selected project,
      daemon health, agent roster, and resources agree with `pd status`.
    EOS
  end

  test do
    system "#{bin}/pd", "version"
    assert_predicate pkgshare/"skills/port-daddy-agent-skill/SKILL.md", :exist?
  end
end
