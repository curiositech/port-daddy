class PortDaddy < Formula
  desc "Authoritative port management and service orchestration for multi-agent development"
  homepage "https://github.com/curiositech/port-daddy"
  url "https://github.com/curiositech/port-daddy/archive/refs/tags/v2.0.0.tar.gz"
  sha256 "PLACEHOLDER_SHA256"
  license "MIT"

  depends_on "node@18"

  def install
    # Install Node.js app into libexec
    libexec.install Dir["*"]

    # Install npm dependencies
    system "npm", "install", "--omit=dev", "--prefix", libexec

    # Create unified CLI wrapper in bin
    (bin/"port-daddy").write <<~EOS
      #!/bin/bash
      exec "#{Formula["node@18"].opt_bin}/node" "#{libexec}/bin/port-daddy-cli.js" "$@"
    EOS

    # Install shell completions
    bash_completion.install "#{libexec}/completions/port-daddy.bash" => "port-daddy"
    zsh_completion.install "#{libexec}/completions/port-daddy.zsh" => "_port-daddy"
  end

  def post_install
    # Install launchd daemon via the CLI
    system bin/"port-daddy", "install"
  end

  def caveats
    <<~EOS
      Port Daddy v2 has been installed.

      Start the daemon:
        brew services start port-daddy
        # or: port-daddy start

      Quick start:
        port-daddy up                      # Start your whole stack
        port-daddy claim myapp:api         # Claim a port
        port-daddy detect                  # Detect your framework
        port-daddy doctor                  # Check your environment

      Dashboard: http://localhost:9876
      Docs: https://github.com/curiositech/port-daddy#readme
    EOS
  end

  service do
    run [Formula["node@18"].opt_bin/"node", opt_libexec/"server.js"]
    keep_alive true
    log_path var/"log/port-daddy.log"
    error_log_path var/"log/port-daddy-error.log"
    working_dir opt_libexec
  end

  test do
    # Start daemon temporarily
    fork do
      exec Formula["node@18"].opt_bin/"node", libexec/"server.js"
    end

    sleep 2

    # Test health endpoint
    output = shell_output("curl -sf http://localhost:9876/health")
    assert_match "ok", output
  end
end
