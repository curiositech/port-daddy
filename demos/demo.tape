Output demos/demo.gif
Output demos/demo.mp4
Output demos/demo.txt

Require pd

Set FontSize 18
Set Width 1200
Set Height 800
Set Padding 40
Set Theme "Catppuccin Macchiato"

Type "pd begin 'Exploring the Harbor' --identity gemini:orchestrator"
Sleep 500ms
Enter

Sleep 3s

Type "pd discover"
Sleep 500ms
Enter

Sleep 3s

Type "pd claim_port --identity test:app"
Sleep 500ms
Enter

Sleep 3s

Type "pd end"
Sleep 500ms
Enter

Sleep 3s