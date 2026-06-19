# coordination.tape
# Demonstrating Agent-to-Agent signaling

Output demos/gifs/coordination.gif

Set FontSize 18
Set Width 1200
Set Height 600
Set Theme "Catppuccin Macchiato"
Set Padding 40

# Scenario Start
Type "pd demo coordination"
Sleep 500ms
Enter

Sleep 5s

# Show real coordination commands
Type "pd integration needs myapp:frontend 'Waiting for auth API'"
Sleep 500ms
Enter
Sleep 1s

Type "pd integration ready myapp:api 'Endpoints live at /api/v1/*'"
Sleep 500ms
Enter
Sleep 1s

# Check briefing
Type "pd briefing"
Sleep 500ms
Enter
Sleep 3s
