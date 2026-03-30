Output assets/demo.gif

Set Shell "bash"
Set FontSize 14
Set Width 1200
Set Height 700
Set Padding 0
Set Theme "Dracula"
Set TypingSpeed 60ms

# Start aimux
Type "bun run start"
Enter
Sleep 3s

# Session picker appears on startup
# Create a new session with n
Type "n"
Sleep 1s

# Directory picker: search for a project
Type "aimux"
Sleep 2s

# Select the directory with Enter
Enter
Sleep 1s

# Session name is auto-filled, confirm it
Enter
Sleep 2s

# Open new tab modal (Ctrl+N)
Ctrl+N
Sleep 1s

# Claude is pre-selected, press Enter to launch
Enter
Sleep 4s

# Enter terminal input mode
Type "i"
Sleep 500ms

# Type a message to Claude
Type "Say hello in one sentence"
Enter
Sleep 5s

# Back to navigation mode with Ctrl+Z
Ctrl+Z
Sleep 1s

# Open another tab
Ctrl+N
Sleep 1s

# Launch another Claude tab
Enter
Sleep 4s

# Rename the tab with r
Type "r"
Sleep 1s
Type "refactor-session"
Enter
Sleep 1s

# Switch between tabs with k (go to first tab)
Type "k"
Sleep 1s

# Switch back with j
Type "j"
Sleep 1s

# Toggle sidebar off
Ctrl+B
Sleep 1s

# Toggle sidebar back on
Ctrl+B
Sleep 1s

# Open session picker
Ctrl+G
Sleep 1s

# Create a second session
Type "n"
Sleep 1s
Type "other"
Sleep 2s

# Select a directory
Enter
Sleep 1s

# Confirm session name
Enter
Sleep 2s

# Switch back to first session
Ctrl+G
Sleep 1s

# Filter sessions
Type "/"
Sleep 500ms
Type "aimux"
Sleep 1s
Enter
Sleep 500ms

# Select and switch
Enter
Sleep 2s

# Show help modal
Type "?"
Sleep 2s
Escape
Sleep 1s

# Exit
Ctrl+C
Sleep 1s
