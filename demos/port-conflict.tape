# port-conflict.tape
# Visual proof of port conflict resolution

Output demos/gifs/port-conflict.gif

Set FontSize 18
Set Width 1200
Set Height 600
Set Theme "Catppuccin Macchiato"
Set Padding 40

# Scenario Start
Type "pd demo port-conflict"
Sleep 500ms
Enter

Sleep 5s

# Show real command
Type "pd claim myapp:api"
Sleep 500ms
Enter
Sleep 1s

Type "pd claim myapp:worker"
Sleep 500ms
Enter
Sleep 1s

# Final proof
Type "pd ps"
Sleep 500ms
Enter
Sleep 3s
