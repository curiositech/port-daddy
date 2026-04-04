# Port Daddy Fleet — fish prompt integration
#
# Shows fleet agent status after each command.
#
# Install: add to ~/.config/fish/conf.d/pd-fleet.fish
#   or source from config.fish:
#   source /path/to/port-daddy/completions/fleet-prompt.fish

function _pd_fleet_prompt --on-event fish_prompt
    # Skip if pd isn't installed
    command -q pd; or return

    # Skip if no fleet config in this repo
    set -l root (git rev-parse --show-toplevel 2>/dev/null); or return
    test -f "$root/pd-fleet.yml"; or test -f "$root/pd-fleet.yaml"; or test -f "$root/.portdaddy/fleet.yml"; or return

    set -l line (timeout 0.2 pd fleet prompt 2>/dev/null); or return
    test -n "$line"; and echo $line
end
