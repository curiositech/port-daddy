# pd.fish — Fish shell wrapper for Port Daddy
#
# Source this file from your Fish config to enable automatic environment
# variable injection when running `pd begin`:
#
#   # ~/.config/fish/config.fish
#   source ~/.port-daddy/shell/pd.fish
#
# After sourcing, `pd begin <purpose>` will automatically set PD_AGENT_ID
# and PD_SESSION_ID in your current shell — no eval required.

function pd --wraps=pd --description 'Port Daddy — with shell integration for pd begin'
    if test "$argv[1]" = "begin"
        # Run the real pd binary with PD_EMIT_EXPORTS=1. It emits
        # `set -x PD_AGENT_ID ...` and `set -x PD_SESSION_ID ...` to stdout
        # (fish-flavoured export syntax), and human output goes to stderr.
        set -l _exports (PD_EMIT_EXPORTS=1 command pd $argv)
        for _line in $_exports
            eval $_line
        end
    else
        command pd $argv
    end
end
