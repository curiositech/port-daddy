# Reproducible terminal capture for the ordinary Sugar-first Parley arrival card.
# Run from the repository root after selecting an isolated codebase berth and
# setting PORT_DADDY_CONTEXT_DIR. The tape creates the matching peer in a
# separate local context with output suppressed; the visible proof is the
# ordinary agent arrival. Credentials are intentionally not embedded here.
Output "docs/pr-assets/pr-sugar-first-parley/sugar-parley-card.gif"

Set Shell "zsh"
Set FontSize 18
Set Width 1120
Set Height 720
Set Padding 22
Set Theme "Catppuccin Mocha"
Set TypingSpeed 24ms
Env PEER_CONTEXT "/Users/erichowens/coding/tmp/sugar-parley-vhs-peer-fixture-20260827"

Sleep 700ms
Type "PORT_DADDY_CONTEXT_DIR=$PEER_CONTEXT PORT_DADDY_NON_INTERACTIVE=1 node bin/port-daddy-cli.js begin 'Build a shared collaboration interface' --identity sugarprooflive:visual:peer --lifecycle durable --sidequest 'Visual proof peer fixture for Sugar Parley' --files lib/sugar-parley.ts --force >/dev/null 2>&1"
Enter
Sleep 1200ms
Type "node bin/port-daddy-cli.js begin 'Build a shared collaboration interface' --identity sugarprooflive:visual:terminal --lifecycle durable --sidequest 'Visual proof fixture for Sugar Parley' --files lib/sugar-parley.ts --force"
Enter
Sleep 7s
Screenshot "docs/pr-assets/pr-sugar-first-parley/sugar-parley-card.png"
Enter
Sleep 2200ms
