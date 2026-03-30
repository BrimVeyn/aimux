Output assets/selection.gif

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

# Create session
Type "n"
Sleep 1s
Type "aimux"
Sleep 2s
Enter
Sleep 1s
Enter
Sleep 2s

# Launch a tab with echo to generate selectable text
Ctrl+N
Sleep 1s

# Select shell option (navigate down if needed)
Type "jjj"
Sleep 500ms
Enter
Sleep 2s

# Enter input mode
Type "i"
Sleep 500ms

# Generate some text content to select
Type "echo 'Hello world from aimux -- double-click any word to select it'"
Enter
Sleep 1s
Type "echo 'Or triple-click to select the entire line of text'"
Enter
Sleep 1s
Type "echo '/usr/local/bin/node -- paths are selected as a single word'"
Enter
Sleep 1s
Type "ls -la"
Enter
Sleep 2s

# Double-click on a word (simulate with mouse)
# VHS doesn't support double-click natively, so we show the output
Sleep 3s

# Back to navigation
Ctrl+Z
Sleep 1s

# Exit
Ctrl+C
Sleep 1s
