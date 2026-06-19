# port-conflict-dual.tape
Output demos/gifs/port-conflict-dual.gif

Set FontSize 18
Set Width 1200
Set Height 600
Set Padding 40

# --- LIGHT MODE START ---
Set Theme "Catppuccin Latte"
Type "# Mode: Light"
Enter
Sleep 500ms

Type "pd demo port-conflict"
Enter
Sleep 4s

Type "pd claim myapp:api"
Enter
Sleep 1s

# --- THEME SWITCH ---
Set Theme "Catppuccin Macchiato"
Type "# Switching to Dark Mode..."
Enter
Sleep 1s

Type "pd claim myapp:worker"
Enter
Sleep 1s

Type "pd ps"
Enter
Sleep 3s
