class PortDaddy < Formula
  desc "Authoritative port manager for multi-agent development"
  homepage "https://github.com/curiositech/port-daddy"
  url "https://github.com/curiositech/port-daddy/archive/refs/tags/v3.7.0.tar.gz"
  sha256 "REPLACE_WITH_ACTUAL_SHA256" # Placeholder for release pipeline
  license "MIT"

  depends_on "node"
  depends_on "gitleaks"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]

    # Ship the agent skill alongside the daemon so `pd setup` can symlink the
    # same instruction manual into Codex, Claude, AGENTS-aware, Gemini, and
    # compatible editor runtimes without copy drift.
    pkgshare.install "skills/port-daddy-agent-skill" => "skills/port-daddy-agent-skill"

    # Port Daddy Pilot source rendered by `pd setup` into each runtime's
    # native agent format. See lib/pilot-agent-render.ts.
    pkgshare.install "agents/port-daddy-pilot" => "agents/port-daddy-pilot"

    # SessionStart steering hook wired by `pd init`; dependency-free and
    # daemon-independent.
    pkgshare.install "hooks/sessionstart-pilot.mjs" => "hooks/sessionstart-pilot.mjs"
  end

  def post_install
    # Refresh the cross-tool skill symlink union after every install/upgrade so
    # Codex, Claude, Gemini, and editor runtimes follow the current Jury-rig and
    # workgroup skill sources without a manual copy step. Daemon, MCP, FleetBar,
    # and project init each have their own lifecycle and are skipped here.
    #
    # This setup call ALSO pre-downloads the local embedding model
    # (Xenova/all-MiniLM-L6-v2, ~27 MB) on first install so semantic operations
    # work offline-first (ADR-0061). It is idempotent (skips if already cached, so
    # upgrades are instant) and best-effort (an offline install never fails — the
    # runtime fetches lazily later). Pass --no-prefetch to skip.
    return if ENV["HOME"].nil? || ENV["HOME"].empty?

    pd = opt_bin/"pd"
    return unless pd.exist?

    ohai "Refreshing Port Daddy cross-tool skill symlinks + pre-downloading embedding model"
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

      Setup also renders the Port Daddy Pilot agent — the ideal Port Daddy
      operating persona — into every local LLM runtime's native format:
        ~/.claude/agents/port-daddy-pilot.md      (Claude Code / Desktop)
        ~/.codex/agents/port-daddy-pilot.toml     (Codex CLI)
        ~/.gemini/commands/pd-pilot.toml          (Gemini CLI: /pd-pilot)
        ~/.agents/agents/port-daddy-pilot.md      (generic AGENTS-aware drop)
      Antigravity (agy) imports the Gemini command when you run
      `agy plugin import`. In a Port Daddy project the SessionStart hook steers
      new sessions to this agent automatically unless you pass --agent <other>.

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
    assert_predicate pkgshare/"agents/port-daddy-pilot/AGENT.md", :exist?
    assert_predicate pkgshare/"agents/port-daddy-pilot/agent.config.json", :exist?
    assert_predicate pkgshare/"hooks/sessionstart-pilot.mjs", :exist?
  end
end
