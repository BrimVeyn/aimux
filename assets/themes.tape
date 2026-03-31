Output assets/themes.gif

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

# Launch a tab so there's content visible
Ctrl+N
Sleep 1s
Enter
Sleep 4s

# Open theme picker with Ctrl+T
Ctrl+T
Sleep 1.5s

# Browse themes with j/k
Type "j"
Sleep 1s
Type "j"
Sleep 1s
Type "j"
Sleep 1s

# Select a theme
Enter
Sleep 2s

# Open theme picker again
Ctrl+T
Sleep 1.5s

# Browse more
Type "j"
Sleep 1s
Type "j"
Sleep 1s

# Select another theme
Enter
Sleep 2s

# Open theme picker one more time
Ctrl+T
Sleep 1.5s

# Go back to first theme
Type "k"
Sleep 1s
Type "k"
Sleep 1s
Type "k"
Sleep 1s
Type "k"
Sleep 1s

Enter
Sleep 2s

# Exit
Ctrl+C
Sleep 1s
