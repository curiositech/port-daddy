# Port Daddy Fleet — PowerShell prompt integration
#
# Shows fleet agent status after each command.
#
# Install: add to $PROFILE:
#   . /path/to/port-daddy/completions/fleet-prompt.ps1

# Save the original prompt function
if (-not (Get-Command _pd_original_prompt -ErrorAction SilentlyContinue)) {
    $function:_pd_original_prompt = $function:prompt
}

function prompt {
    # Check for fleet results (only if pd is installed)
    if (Get-Command pd -ErrorAction SilentlyContinue) {
        try {
            $line = & pd fleet prompt 2>$null
            if ($line) {
                Write-Host $line
            }
        } catch {
            # Silent — never break the prompt
        }
    }

    # Call original prompt
    _pd_original_prompt
}
