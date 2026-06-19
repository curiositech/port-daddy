# coordination-dual.tape
Output demos/gifs/coordination-dual.gif

Set FontSize 18
Set Width 1200
Set Height 600
Set Padding 40

# --- LIGHT MODE START ---
Set Theme "Catppuccin Latte"
Type "# Mode: Light"
Enter
Sleep 500ms

Type "pd demo coordination"
Enter
Sleep 4s

Type "pd integration needs myapp:frontend 'Waiting for API'"
Enter
Sleep 1s

# --- THEME SWITCH ---
Set Theme "Catppuccin Macchiato"
Type "# Switching to Dark Mode..."
Enter
Sleep 1s

Type "pd integration ready myapp:api 'Endpoints live!'"
Enter
Sleep 1s

Type "pd briefing"
Enter
Sleep 3s
