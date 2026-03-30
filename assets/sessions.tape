Output assets/sessions.gif

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

# Session picker on startup -- create a session
Type "n"
Sleep 1s

# Search for a project directory
Type "aimux"
Sleep 2s

# Select the directory
Enter
Sleep 1s

# Confirm session name
Enter
Sleep 2s

# Open session picker again
Ctrl+G
Sleep 1s

# Create a second session
Type "n"
Sleep 1s
Type "other"
Sleep 2s
Enter
Sleep 1s
Enter
Sleep 2s

# Open session picker to switch
Ctrl+G
Sleep 1s

# Filter sessions by name
Type "/"
Sleep 500ms
Type "aimux"
Sleep 1s
Enter
Sleep 500ms

# Select and switch to filtered session
Enter
Sleep 2s

# Rename the session
Ctrl+G
Sleep 1s
Type "r"
Sleep 500ms
Type "my-project"
Enter
Sleep 2s

Escape
Sleep 1s

# Exit
Ctrl+C
Sleep 1s
