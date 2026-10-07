# explorer

Every file of the repository you are working in, read-only: the tree on the
left, the file under the cursor on the right. A code viewer with the editing
taken out.

`^e` opens it and closes it, from navigation, from insert and from inside —
like git mode's own key.

Two tabs, as neo-tree has sources. **Changes** is the work: every changed file
with its lines added and removed, folders open. **Files** is the whole
repository, folders closed. You arrive on Changes when there is work to see,
on Files when there is none, and `tab` switches — the file on screen is
brought into view in the other tab. A folder that holds a single folder and
nothing else is one row (`src/main/java`), and guides tie each row to its
folder.

Each file has a Nerd Font icon by its kind, as nvim-tree draws them, and a
folder's icon says whether it is open — `kit.fileIcon`, the same glyphs git
mode's sidebar draws. The colours are the theme's syntax
colours, not the brands' — TypeScript is drawn in the colour the theme gives
types — so they hold in every theme. On a terminal without a Nerd Font, turn
them off: `icons: false` in the plugin's config, which brings back `▸`/`▾`.

The file follows the cursor. `l` on a file hands it the keys: `j`/`k` scroll
it, and `h` or `esc` hand them back to the tree.

| Key               | In the tree                                         |
| ----------------- | --------------------------------------------------- |
| `j` / `k`         | next / previous row                                 |
| `l` / `⏎`         | open or close the folder; on a file, read it        |
| `h`               | close the folder, or go up to the one you are in    |
| `P` / `⌫`         | up to the folder you are in / and close it          |
| `K` / `J`         | first / last row of the folder                      |
| `gg` / `G`        | first / last row                                    |
| `tab`             | Changes or Files                                    |
| `W` / `E`         | close / open every folder                           |
| `/`               | fuzzy search; `⏎` keeps it, `esc` drops it          |
| `]` / `[`         | next / previous changed file, opening what it is in |
| `↓` `↑` `^d` `^u` | scroll the file, wherever the keys are              |
| `s`               | a changed file as a diff, or as it is on disk       |
| `m`               | Markdown rendered, or as source                     |
| `r`               | read the files again                                |
| `?`               | every key                                           |
| `esc`             | out of the file, out of the search, then close      |
| `q` / `^e`        | close                                               |

The mouse does what the keys do: a click opens a file, opens or closes a
folder, and the wheel scrolls the tree.

## Nothing here draws a file

The right side is `kit.FileView`, which is git mode's own renderers. A changed
file is split against HEAD, exactly as git mode shows it; anything else —
untouched, or untracked, which has nothing to be compared with — is drawn once,
in one column, with the same highlighting and wrapping. Markdown is rendered,
images and PDFs are drawn as pictures on a Kitty-compatible terminal, and a
binary or oversized file says so.

So the plugin is a tree and some keys: `src/tree.ts` turns `git.files()` into
rows, `src/state.ts` is every way a key moves through them, and both are tested
as plain functions.

## Large repositories

The tree is `kit.VirtualList`: only the rows on screen are drawn, so twenty
thousand files open at once move as fast as twenty. The folders are built once
per listing, and a keypress only walks the ones that are open. The file on the
right is read once the cursor stops on it, not for every row it passes.

## What it does not do

The tree is read when the view opens and on `r`, not watched. Search matches
paths, not contents.
