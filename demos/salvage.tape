# salvage.tape — Agent death and recovery
# Shows the salvage protocol: agent crashes, work is preserved, new agent continues

Output demos/salvage.gif

Set FontSize 16
Set Width 1000
Set Height 650
Set Padding 30
Set TypingSpeed 40ms
Set Theme "Catppuccin Macchiato"

Hide
Type "clear"
Enter
Sleep 500ms
Show

# 1. Agent starts work
Type "pd begin 'Refactoring payment flow' --identity payments:api"
Enter
Sleep 2s

# 2. Claims files and leaves notes
Type "pd note 'Extracted PaymentProcessor class. 3 methods migrated.'"
Enter
Sleep 1.5s

Type "pd note 'Found race condition in refund handler — fixing.'"
Enter
Sleep 1.5s

# 3. Check the session
Type "pd sessions --json | head -20"
Enter
Sleep 2.5s

# 4. Simulate death — agent just stops (done without finishing)
Type "# Agent crashes! No graceful shutdown..."
Enter
Sleep 1.5s

# 5. New agent checks salvage queue
Type "pd salvage"
Enter
Sleep 2.5s

# 6. Check notes from the dead agent's session
Type "pd notes --last 5"
Enter
Sleep 2.5s

# 7. Done — show the recovery story
Type "pd done --note 'Continuing from crashed agent. Race condition fixed.'"
Enter
Sleep 2.5s

Sleep 2s
