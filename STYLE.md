# TUI style

How aimux is drawn, and why. These are rules for building new screens, not a
record of old ones — if a rule and the existing code disagree, the code is what
is wrong.

The whole document reduces to one sentence: **separate regions by the surface
they sit on, never by a line drawn between them, and say each thing exactly
once.** Everything below is that sentence applied to a specific decision.

---

## 1. Layers, not lines

A terminal has no shadows and no depth. There are two ways to say "this region
is not that region": draw a rule between them, or paint them different colours.
Rules are the obvious choice and the wrong one.

A rule is a thing you have to look past to read what it separates. Ten of them
on a screen is a grid of boxes, and the eye spends its first pass finding the
content inside the boxes rather than reading it. A background change costs no
cells, cannot collide with the content, and is read without being noticed.

**So: no rules, no frames, no borders.** Regions are told apart by the surface
they are painted on. Sections within a region are told apart by a blank row.

This has consequences that are easy to get wrong, which is what the rest of this
document is about.

## 2. The surface ladder

Three background tokens, three roles. The role is fixed; the appearance is not.

| token               | role                                                                                                          | examples                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `background`        | **the page.** Content the user came to read or type into.                                                     | terminal panes, the settings body               |
| `backgroundPanel`   | **chrome.** Things that frame the page and are not the point of the screen.                                   | side bars, the tab bar, modals, cards           |
| `backgroundElement` | **an element on a surface.** Something you act on, or a band that must stand apart from the chrome around it. | buttons, inputs, the status bar, floating menus |

Two rules make this work, and both are violated by accident constantly:

**Never use the same token for a surface and for something sitting on it.** A
panel card on a panel bar has no edge. An element-toned band under an
element-toned button is one shape. Before choosing a token, ask what it will be
drawn _on top of_ — and for something that floats (a menu, a popover), ask what
it _could_ be drawn on top of, which is usually more surfaces than you assumed.

**Never reason about which token is lighter.** aimux ships tens of themes and
their scales run in opposite directions — some recess each step, some lift it.
"One step lighter so it looks raised" is true in half of them and inverted in the
rest. The only property you may rely on is that the three tokens _differ_. Design
for contrast, never for direction.

## 3. A surface is painted once

If a region is one thing, paint it once at the top of that region and let
everything inside inherit it.

Painting each child separately is the most common way to reintroduce the lines
you just removed: the gaps between the children, and any footer or gutter that is
not one of them, keep showing the layer underneath. The result is a set of
stripes that reads exactly like a rule — worse, actually, because it is
accidental and inconsistent.

If two things inside one region need to be told apart, that is a blank row's job,
not a colour's.

## 4. Selection is the one place colour is spent

Selection is the single thing on a screen that must be findable without reading.
A step of grey does not do it, so a selected row is **filled with `primary`**.

A fill that strong leaves room for exactly one legible ink on top of it: the page
background. This is not a preference, it is arithmetic — an accent is chosen to
contrast with the page, so the page contrasts with the accent, and nothing else
reliably does. Therefore:

- Everything drawn on a selected row collapses to that one ink. Muted subtitles,
  warning marks, accent badges: on the selected row they are all the same colour.
  Do not try to preserve a scale on top of a fill.
- Use the _opaque_ page background for that ink, not the live theme token —
  transparent mode resolves the token to nothing and the text disappears while
  the fill, which is an accent, stays.
- A row that carries a colour scale of its own — a gauge, a value whose colour
  _is_ its state — cannot be filled without swallowing the thing it exists to
  show. Those rows get the element tone instead. This is a real exception, not an
  excuse; it applies when the row's colours are information, not decoration.

## 5. When a frame is still allowed

Three cases, and they are the only ones:

1. **There is no background to separate with.** In transparent mode every chrome
   token resolves to nothing, so a floating surface has no edge at all. It gets a
   border there and only there.
2. **The border colour is the information.** A severity outline, a focus ring
   that says which pane has keyboard focus. Here the border is content, not
   decoration.
3. Nothing else. In particular, a _filled_ control does not also get a frame —
   the fill already said it is a control, and the frame costs two rows to repeat
   it. Buttons are filled, never outlined.

## 6. Removing chrome is not removing affordance

Everything drawn in a TUI also occupies cells, and those cells are often a
hit-box: a border you can grab to resize, a rule you can drag, a gutter that
keeps content off an edge.

**Take the paint, keep the cells.** A border becomes padding of the same width.
A drawn resize handle becomes a blank row that is still grabbable. A separator
column becomes a gutter painted in its own surface. Geometry is unchanged, so
nothing that depended on it — mouse targets, size reporting, layout maths — has
to be touched, and the change stays a paint change instead of turning into a
layout change with its own bugs.

The inverse also holds and is worth saying plainly: **an affordance that looks
real must be real.** A field drawn like a text box that cannot be edited, a
gutter that looks grabbable and is not — these are worse than not drawing them.

## 7. Say it once

Screens accumulate labels the way code accumulates comments: every one made
sense when it was added, and together they are noise.

Before adding a line of prose to a screen, find where that fact is already
stated. Typically it already appears in several of these:

1. the control itself — a value, a placeholder, a filled state
2. the heading of the screen or section
3. a label above the field
4. a description under the label
5. a footer hint
6. a global keybind overlay

**Keep the highest one on that list that actually carries the fact, and delete
the rest.** A placeholder that _is_ the default value does not need a sentence
explaining what the default is. A list of assistants does not need a title
telling you to choose an assistant. A heading can ask the question and the
subtitle answer what becomes of the answer, and then the field needs no label.

**Titles name, they do not instruct.** "New tab", not "New tab: choose
assistant". The screen in front of the user says what to do; the title says where
they are.

**Do not restate what a global affordance already shows.** If the keybind overlay
lists the keys for this mode, an inline hint line repeating them is pure
duplication. The one exception is a destructive confirmation, where the keys
belong under the user's eyes rather than in a corner.

## 8. Density

Vertical space is the scarcest thing on the screen and the easiest to waste.

- A blank row is a separator. It is _the_ separator.
- Several short facts belong on one line joined by `·`, not stacked.
- Fixed-height regions stay fixed. A footer that grows and shrinks moves the list
  above it, and a list that shifts while you walk down it is unusable.
- A row count or a state readout is information; the key that changes it is
  usually already in the overlay. Show the state, not the key.

## 9. Theme-proofing

Every visual decision is made in tens of palettes, only one of which you are
looking at.

- Choose tokens **by role**, never by how they look in the current theme.
- Any colour you pick must come from the token set. A literal hex in a component
  is a bug in every theme but one.
- Check that a state survives transparent mode, where the chrome backgrounds
  resolve away. Anything whose _only_ signal is a chrome background disappears
  there and needs a second signal or an explicit opaque colour.
- When you need a state to remain visible against a surface that might be
  anything, an accent works and a grey does not.

## 10. Reviewing a screen

Five questions, in order. Most problems are caught by the first two.

1. **Is there a line drawn anywhere?** If yes, does it fall under one of the
   three cases in §5? If not, delete it and give the two regions different
   surfaces, or a blank row.
2. **Does any element share a token with the surface it sits on?** Including
   surfaces it can float over, not just the one under it right now.
3. **Is any fact stated twice?** Walk the six levels in §7 and cut to one.
4. **Did any removed pixel take an affordance with it?** Padding where the border
   was, a grabbable blank row where the rule was.
5. **Does it hold in a theme whose scale runs the other way, and in transparent
   mode?**
