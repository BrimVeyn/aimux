# assets/demo.tape — the README hero shot.
#
# One screen with the whole surface on it: projects and their workspaces on
# the left, agents in tabs — one answered, one asking, one still working — and
# on the right the git pane, showing either the working-copy diff or the
# branch's open pull request with its CI checks.
#
#   ./assets/demo-setup.sh   # empty catalog, three projects, the layout
#   vhs assets/demo.tape
#
# Needs vhs, ttyd, ffmpeg, an authenticated `claude`, and `gh` logged in to
# the first demo project's repo — the github tab is filmed reading a real PR.
#
# Everything between `Hide` and `Show` still runs; it just is not filmed. That
# is where the workspace gets populated, so the GIF opens on a full screen
# instead of three minutes of setup. Prompts are deliberately one-liners: the
# tape waits out every real answer, so a curious question costs 30s of runtime.
#
# Two things the tape has to know about the agents it launches:
#   - a tab launch drops aimux into INSERT, so keys after `Enter` go to the
#     agent, not to aimux
#   - `Down` + `Enter` answers Claude's first-run "do you trust this folder"
#     gate; on an already-trusted folder it just submits an empty prompt
#
# Project filters match name *and* path, so they are picked with the paths in
# mind: "share" would also match aimux, which lives under ~/.local/share.

Output assets/demo.gif

Set Shell "bash"
Set FontFamily "FiraCode Nerd Font Mono"
Set FontSize 13
Set Width 1620
Set Height 900
Set Padding 0
# Catppuccin Frappé, so the terminal underneath matches the theme aimux paints.
Set Theme { "name": "Catppuccin Frappe", "background": "#303446", "foreground": "#c6d0f5", "cursor": "#f2d5cf", "selection": "#626880", "black": "#51576d", "red": "#e78284", "green": "#a6d189", "yellow": "#e5c890", "blue": "#8caaee", "magenta": "#f4b8e4", "cyan": "#81c8be", "white": "#b5bfe2", "brightBlack": "#626880", "brightRed": "#e78284", "brightGreen": "#a6d189", "brightYellow": "#e5c890", "brightBlue": "#8caaee", "brightMagenta": "#f4b8e4", "brightCyan": "#81c8be", "brightWhite": "#a5adce" }
Set Framerate 24
Set TypingSpeed 45ms

Hide

Type "cd /Users/nbardavid/.local/share/aimux/worktrees/aimux/dahlia && clear"
Enter

# Tabs are spawned by the terminal manager, which inherits the env it was
# started with. Recording from inside a Claude Code session would otherwise
# hand every agent its parent's session markers — and they say so on screen.
Type "unset ${!CLAUDE@}"
Enter
Type "AIMUX_PROFILE=demo bun run src/index.tsx restart-terminal-manager"
Enter
Sleep 8s
Type "clear"
Enter

Type "AIMUX_PROFILE=demo bun run src/index.tsx"
Enter
Wait+Screen@90s /NORMAL/
Sleep 2s

# --- project 2: aimux-docs — an agent and a shell --------------------------
Ctrl+G
Sleep 800ms
Type "docs"
Sleep 800ms
Enter
Sleep 1500ms

Ctrl+N
Sleep 800ms
Enter
Sleep 8s
Down
Enter
Sleep 5s
Type "In one line, what is this site built with"
Enter
Sleep 20s
Ctrl+Z
Sleep 800ms

Ctrl+N
Sleep 800ms
Type "term"
Sleep 600ms
Enter
Sleep 3s
Type "git log --graph --oneline --all -20 | cat"
Enter
Sleep 2s
Ctrl+Z
Sleep 800ms

# --- project 3: share-terminal — just a shell ------------------------------
Ctrl+G
Sleep 800ms
Type "terminal"
Sleep 800ms
Enter
Sleep 1500ms

Ctrl+N
Sleep 800ms
Type "term"
Sleep 600ms
Enter
Sleep 3s
Type "git log --oneline -20 | cat"
Enter
Sleep 2s
Ctrl+Z
Sleep 800ms

# --- project 1: aimux — the one the shot lives in --------------------------
Ctrl+G
Sleep 800ms
Type "aimux"
Sleep 800ms
Enter
Sleep 1500ms

# [1] answered — this is the tab the GIF opens on.
Ctrl+N
Sleep 800ms
Enter
Sleep 8s
Down
Enter
Sleep 5s
Type "In one line, what does this project do"
Enter
Sleep 20s
Ctrl+Z
Sleep 800ms

# [2] a plain shell.
Ctrl+N
Sleep 800ms
Type "term"
Sleep 600ms
Enter
Sleep 3s
Type "git log --graph --oneline --all -20 | cat"
Enter
Sleep 2s
Ctrl+Z
Sleep 800ms

# [3] asking — a tool call it has no standing permission for, so it stops and
# waits for an answer it never gets. That is the "waiting" state in the bar.
Ctrl+N
Sleep 800ms
Enter
Sleep 8s
Down
Enter
Sleep 5s
Type "Run bun --version"
Enter
Sleep 10s
Ctrl+Z
Sleep 800ms

# [4] working — started last and given something long enough that it is still
# thinking all the way through the shot.
Ctrl+N
Sleep 800ms
Enter
Sleep 8s
Down
Enter
Sleep 5s
Type "Walk through every file in src/ui/components/git and explain how they fit together"
Enter
Sleep 3s
Ctrl+Z
Sleep 800ms

# Park on the answered tab.
Ctrl+W
Type "1"
Sleep 1500ms
Screenshot assets/demo.png

# --- filmed from here ------------------------------------------------------
Show

# The screen it opens on: three projects with their branches and workspaces,
# four tabs in three different states, and the PR row above the git pane.
Sleep 1500ms

# Tabs of the active project — the asking one, then the working one.
Type "l"
Sleep 800ms
Type "l"
Sleep 1000ms

# Another project — sidebar, tabs and git pane all follow.
Ctrl+G
Sleep 600ms
Type "docs"
Sleep 700ms
Enter
Sleep 1200ms
Ctrl+G
Sleep 500ms
Type "aimux"
Sleep 600ms
Enter
Sleep 1200ms

# Full-screen review: file list left, highlighted diff right. Ctrl+N walks
# files rather than folders, so it lands on real edits instead of a new file.
Ctrl+D
Sleep 900ms
Ctrl+N
Sleep 800ms
Ctrl+N
Sleep 1000ms
Type "v"
Sleep 1500ms
Escape
Sleep 600ms

# And the other face of the git pane: the open PR and its checks.
Type "g"
Sleep 2500ms
