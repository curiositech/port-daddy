# vhs tape — pd-console visual artifact tour (PR #306 test plan)
Output core/pd-console/docs/artifacts/console-tour.gif
Set FontSize 16
Set Width 1400
Set Height 900
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms

Type "./core/target/release/pd-console"
Enter
Sleep 3s
Screenshot core/pd-console/docs/artifacts/pane-default.png
Type ":sorties"
Enter
Sleep 3s
Screenshot core/pd-console/docs/artifacts/pane-sorties.png
Type ":dispatch"
Enter
Sleep 3s
Screenshot core/pd-console/docs/artifacts/pane-dispatch.png
Type ":q"
Enter
Sleep 1s
