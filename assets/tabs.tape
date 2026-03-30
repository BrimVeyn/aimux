Output assets/tabs.gif

Set Shell "bash"
Set FontSize 14
Set Width 1200
Set Height 700
Set Padding 0
Set Theme "Dracula"
Set TypingSpeed 60ms

# Start aimux (assume a session already exists)
Type "bun run start"
Enter
Sleep 3s

# Create session if needed
Type "n"
Sleep 1s
Type "aimux"
Sleep 2s
Enter
Sleep 1s
Enter
Sleep 2s

# Launch a Claude tab
Ctrl+N
Sleep 1s
Enter
Sleep 4s

# Enter input mode and send a message
Type "i"
Sleep 500ms
Type "Say hello in one sentence"
Enter
Sleep 5s

# Back to navigation
Ctrl+Z
Sleep 1s

# Open another tab
Ctrl+N
Sleep 1s
Enter
Sleep 4s

# Rename the tab
Type "r"
Sleep 500ms
Type "code-review"
Enter
Sleep 1s

# Navigate tabs with j/k
Type "k"
Sleep 1s
Type "j"
Sleep 1s

# Reorder tabs with Shift+J
Type "J"
Sleep 1s
Type "K"
Sleep 1s

# Toggle sidebar
Ctrl+B
Sleep 1s
Ctrl+B
Sleep 1s

# Show help
Type "?"
Sleep 2s
Escape
Sleep 1s

# Exit
Ctrl+C
Sleep 1s
