# hero.tape — The core Port Daddy lifecycle in 20 seconds
# For README hero GIF and website landing page

Output demos/hero.gif

Set FontSize 16
Set Width 1000
Set Height 650
Set Padding 30
Set TypingSpeed 40ms
Set Theme "Catppuccin Macchiato"

# Clean start
Hide
Type "pd release demo:api -q 2>/dev/null; pd release demo:web -q 2>/dev/null; pd release demo:db -q 2>/dev/null; clear"
Enter
Sleep 500ms
Show

# 1. Status check
Type "pd status"
Enter
Sleep 2s

# 2. Begin a session
Type "pd begin 'Building the auth module' --identity myapp:backend --lifecycle durable"
Enter
Sleep 2s

# 3. Claim ports
Type "pd claim myapp:api"
Enter
Sleep 1.5s

Type "pd claim myapp:web"
Enter
Sleep 1.5s

Type "pd claim myapp:db"
Enter
Sleep 1.5s

# 4. Find services
Type "pd find 'myapp:*'"
Enter
Sleep 2.5s

# 5. Leave a note
Type "pd note 'Auth endpoints wired. JWT refresh working. Ready for review.'"
Enter
Sleep 2s

# 6. Done
Type "pd done"
Enter
Sleep 2.5s

# Hold for readability
Sleep 2s
