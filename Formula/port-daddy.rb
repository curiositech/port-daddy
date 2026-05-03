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
    # Refresh the agent-skill symlinks after every install/upgrade so newly
    # added runtime targets (e.g. a future Windsurf path) get linked without
    # the user remembering to re-run `pd setup`. Only the skill step runs —
    # daemon, MCP, FleetBar, and project init each have their own lifecycle
    # and should not be touched silently on every brew upgrade.
    return if ENV["HOME"].nil? || ENV["HOME"].empty?

    pd = opt_bin/"pd"
    return unless pd.exist?

    ohai "Refreshing port-daddy agent skill symlinks"
    system pd.to_s, "setup", "--no-daemon", "--no-mcp", "--no-fleetbar", "--no-init"
  end

  def caveats
    <<~EOS
      The Port Daddy agent skill is installed at:
        #{opt_pkgshare}/skills/port-daddy-agent-skill

      To make it discoverable by agent runtimes:
        pd setup                  # user-level links
        cd your-project && pd init # project-local links

      Setup links the same canonical skill into every supported runtime:
        ~/.codex/skills/port-daddy-agent-skill
        ~/.claude/skills/port-daddy-agent-skill
        ~/.agents/skills/port-daddy-agent-skill
        ~/.codeium/windsurf/skills/port-daddy-agent-skill
        ~/.continue/prompts/port-daddy-agent-skill
        ~/.config/cline/skills/port-daddy-agent-skill
        ~/.gemini/extensions/port-daddy/skills/port-daddy-agent-skill
        ~/.cursor/rules/port-daddy-agent-skill.md

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
