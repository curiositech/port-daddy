# Port Daddy Fleet — bash prompt integration
#
# Shows fleet agent status after each command.
#
# Install: add to .bashrc:
#   source /path/to/port-daddy/completions/fleet-prompt.bash

_pd_fleet_prompt() {
  # Skip if pd isn't installed
  command -v pd &>/dev/null || return

  # Skip if no fleet config in this repo
  local root
  root=$(git rev-parse --show-toplevel 2>/dev/null) || return
  [ -f "$root/pd-fleet.yml" ] || [ -f "$root/pd-fleet.yaml" ] || [ -f "$root/.portdaddy/fleet.yml" ] || return

  local line
  line=$(timeout 0.2 pd fleet prompt 2>/dev/null) || return
  [ -n "$line" ] && echo "$line"
}

# Append to PROMPT_COMMAND (bash's equivalent of precmd)
PROMPT_COMMAND="_pd_fleet_prompt${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
