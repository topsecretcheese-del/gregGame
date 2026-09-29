# Greg Game

A Mario-style side-scrolling platformer starring Greg, running in the browser.

## Play

Open `index.html` in a browser. No build step or install needed.

| Key | Action |
| --- | --- |
| A / D | Run left / right |
| Space or W | Jump (hold for a higher jump) |
| S | Fall faster |
| Shift | Sprint |

Stomp enemies from above, bump `?` blocks for coins, and reach the flag at the end.

## Editing the level

The level is the `LEVEL_MAP` text grid at the top of `game.js`. Each character is one 32px tile:

`#` ground, `=` brick, `?` question block, `o` coin, `e` enemy, `P` Greg's start, `F` goal flag, `.` empty.
