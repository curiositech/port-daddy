# Port Daddy Fleet — zsh prompt integration
#
# Shows fleet agent status in your terminal after each command.
# Only prints when there's something new to show.
#
# Install:
#   Add to your .zshrc:
#     source /path/to/port-daddy/completions/fleet-prompt.zsh
#
#   Or if pd is installed globally:
#     source "$(pd --completions-dir)/fleet-prompt.zsh"
#
# What you'll see:
#   $ git commit -m "fix: token refresh"
#   [main abc1234] fix: token refresh
#   fleet: qa ✓  tests ✓  docs updated
#   $ _
#
# The fleet line only appears when agents have new results.
# If nothing happened since the last prompt, nothing prints.
# If the daemon is down, nothing prints. Never errors.

_pd_fleet_prompt() {
  # Skip if pd isn't installed
  command -v pd &>/dev/null || return

  # Fast path: skip if no pd-fleet.yml in current git repo
  # (checks once per directory change, cached)
  if [[ "$_pd_fleet_last_dir" != "$PWD" ]]; then
    _pd_fleet_last_dir="$PWD"
    _pd_fleet_has_config=""
    local root
    root=$(git rev-parse --show-toplevel 2>/dev/null) || return
    [[ -f "$root/pd-fleet.yml" || -f "$root/pd-fleet.yaml" || -f "$root/.portdaddy/fleet.yml" ]] && _pd_fleet_has_config=1
  fi
  [[ -z "$_pd_fleet_has_config" ]] && return

  # Call pd fleet prompt — async-safe, never blocks more than 200ms
  local line
  line=$(timeout 0.2 pd fleet prompt 2>/dev/null) || return
  [[ -n "$line" ]] && echo "$line"
}

# Register as a precmd hook (runs before each prompt)
autoload -Uz add-zsh-hook
add-zsh-hook precmd _pd_fleet_prompt
