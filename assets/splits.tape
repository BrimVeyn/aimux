Output assets/splits.gif

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

# Create a session
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

# Enter input mode and type something
Type "i"
Sleep 500ms
Type "Say hello"
Enter
Sleep 5s

# Enter layout mode with Ctrl+W
Ctrl+W
Sleep 1s

# Split vertically with |
Type "|"
Sleep 1s

# Select assistant and confirm
Enter
Sleep 4s

# Enter input mode in the new pane
Type "i"
Sleep 500ms
Type "Say hi"
Enter
Sleep 5s

# Enter layout mode again
Ctrl+W
Sleep 1s

# Split horizontally with -
Type "-"
Sleep 1s

# Select assistant and confirm
Enter
Sleep 4s

# Navigate between panes
Ctrl+W
Sleep 500ms
Type "h"
Sleep 1s
Type "l"
Sleep 1s
Type "k"
Sleep 1s
Type "j"
Sleep 1s

# Resize panes
Type "H"
Sleep 500ms
Type "H"
Sleep 500ms
Type "L"
Sleep 500ms
Type "L"
Sleep 500ms

# Back to navigation
Escape
Sleep 1s

# Exit
Ctrl+C
Sleep 1s
