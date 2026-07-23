# Plan 001: Animated corrosion VFX — corrosive, dangerous, evil

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat a3dd8a2..HEAD -- src/ui/overlays.ts src/style.css src/main.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (visual-only, but touches the render loop both game modes share)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `a3dd8a2`, 2026-07-22

## Why this matters

Corrosion is the game's identity, but it currently renders as flat translucent
color rectangles — it reads as UI highlighting, not as acid eating the board.
The user wants it to look corrosive, dangerous, evil: animated on entry
(spawn), movement (the once-per-round march), and destruction (both a
corrosion unit dying and a piece being destroyed by corrosion). The engine
already provides stable unit identity (`GameState.corrosions[].id`), which is
what makes proper per-unit animation possible.

## Current state

- `src/ui/overlays.ts` — the whole overlay renderer. `renderOverlays(container, view, gs)`
  clears the layer with `layer.replaceChildren()` and rebuilds per-square
  "marker" divs each call (lines 81–163). Cells from all units are grouped
  per square into buckets (`bySquare`, line 94), so unit identity is erased
  before rendering — nothing can animate between renders.
- `src/style.css:211-290` — overlay styles: `.corrosion-overlay-layer`
  (absolute, pointer-events:none), `.corrosion-marker`, `.corrosion-cell`
  with color variants `--w` (silver/teal tint), `--b` (navy tint), `--cls3`
  (red), `.corrosion-purple-bg`, `.corrosion-purple-skull` (☠ glyph),
  `.corrosion-badge` (class/stack labels, 4 corner variants).
- `src/main.ts` — two `render()` functions call
  `renderOverlays(boardEl, view, state)`: hotseat flow (line 383–386) and
  online flow (line 530–532). Both close over a `state: GameState` variable
  that is reassigned on every applied move.
- Engine facts you need (do not modify the engine):
  - `GameState.corrosions: CorrosionUnit[]` where
    `CorrosionUnit = { id: number; color: 'w'|'b'; cls: 1|2|3; cells: number[]; dir: 1|-1; bornRound: number }`.
    `id` is stable for a unit's whole life; cells move one rank per round
    (`cell + dir*size`); a class-1 promoting to class-2 KEEPS its id and gains
    a second cell; class-2 → class-3 keeps id, collapses to one cell.
  - `GameState.purple: number[]` — purple square indices; squares get added by
    class-3 marches and removed when a king lands on them.
  - `GameState.board: (Piece|null)[]` — pieces; a piece destroyed by corrosion
    simply disappears from `board` between the pre-move and post-move states.
  - Square index = `rank * size + file`, `size` is 8 or 12.
- Geometry: `view.squareEl()` returns `{ boardPx(): DOMRect, squarePx(sq): {x,y,w} }`
  (screen pixels; overlay converts to layer-relative by subtracting
  `board.left/top` — see overlays.ts:110-113). Orientation (black at bottom
  for online guest) is already baked into `squarePx`.
- Convention: UI files are plain TS + DOM, no framework; `import type` for
  types (verbatimModuleSyntax); CSS lives in `src/style.css` with
  chess.com-dark palette variables at the top of the file.

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npx tsc --noEmit`  | exit 0              |
| Tests     | `npx vitest run`    | all pass (54+)      |
| Build     | `npm run build`     | exit 0              |
| Dev       | `npm run dev`       | serves on a free port (use `lsof -ti:PORT | xargs kill` scoped to YOUR port to stop — never `pkill -f vite`) |

## Scope

**In scope** (the only files you should modify):
- `src/ui/overlays.ts` (rewrite)
- `src/style.css` (overlay section + new keyframes/filters)
- `src/main.ts` (only: thread the previous GameState into renderOverlays calls)
- `index.html` (only if an inline `<svg><defs>` filter block is needed)

**Out of scope** (do NOT touch):
- `src/engine/**` and `tests/**` — the engine is reviewed and frozen; VFX must
  be derivable from state diffs alone.
- `src/ui/cgboard.ts`, `src/ui/boardview.ts`, `src/ui/hud.ts`, `src/ui/setup.ts`,
  `src/net/**`.
- The chessgroundx piece/board rendering.

## Steps

### Step 1: Restructure overlays into two sublayers with per-unit identity

Rewrite `src/ui/overlays.ts`:

- Signature becomes
  `renderOverlays(container: HTMLElement, view: BoardView, gs: GameState, prev?: GameState | null): void`.
  `prev` is the state before the last applied move (null/undefined on first
  render → render everything with no entry animations).
- Layer structure inside `.corrosion-overlay-layer`:
  1. `.corrosion-units-layer` — one persistent div per (unit id, cell index):
     key `` `${unit.id}:${i}` `` kept in a `Map<string, HTMLDivElement>` stored
     on the layer element (e.g. a module-level `WeakMap<HTMLElement, Map<...>>`).
     Each div carries classes `corrosion-unit corrosion-unit--{w|b|cls3}` and
     is positioned with `transform: translate(xpx, ypx)` + width/height.
  2. `.corrosion-info-layer` — rebuilt each render exactly like today (purple
     bg, skull, class/stack badges, purple-inset rings). Reuse the existing
     bucketing code for badges; only the colored tint rectangles move into
     the units layer.
- Diff logic per render:
  - **march**: key exists in map and its stored square differs → update
    transform; CSS `transition: transform 480ms cubic-bezier(.5,0,.2,1)`
    animates the ooze. Add class `is-marching` for the transition duration
    (remove on `transitionend`).
  - **spawn**: key absent in map but present in `gs` → create div with class
    `is-spawning` (entry keyframe, see Step 2), remove the class on
    `animationend`.
  - **death**: key present in map but unit id/cell gone from `gs` → add class
    `is-dying`, remove the element on `animationend` (fallback timeout 900ms).
  - **piece destroyed by corrosion** (user-specified sequence — the piece
    turns purple, cracks, then falls into the corrosion and dissolves into
    the bubbles): for every square where `prev.board[sq]` was a piece,
    `gs.board[sq]` is null, AND the square was the target of a corrosion cell
    (present in `gs` or `prev` corrosion cells at that square) — spawn a
    transient **piece ghost**: a div at that square showing the SAME piece
    image the board just removed, animated through the corrode-out keyframes
    (Step 2) and auto-removed on `animationend` (fallback timeout 1400ms).
    Getting the piece image: `prev.board[sq]` gives `{color, type}`; create a
    `<piece>` element with the same classes chessgroundx uses (inspect
    `src/ui/pieces-cburnett.css` for the exact class scheme, e.g.
    `white`/`black` + role class) inside the units layer — the existing piece
    CSS then supplies the sprite via background-image; size/position it
    yourself with transform + width/height and `pointer-events:none`. If the
    class scheme doesn't resolve outside chessgroundx's own wrapper, fall back
    to copying `background-image` via `getComputedStyle` from a live piece
    element of the same color+type elsewhere on the board (there almost always
    is one; if none exists, skip the ghost and play only the kill-burst ring).
    Also add class `is-feeding` (~1s) to the corrosion unit div on that square
    so its bubbling visibly intensifies while the piece dissolves into it.
    Do NOT try to distinguish normal captures: a normal capture has the
    capturing piece standing on the square in `gs.board`, so the "now null"
    condition already excludes it.
  - **purple spawn**: square in `gs.purple` but not `prev.purple` → the info
    layer's purple bg gets class `is-purpling` (etch-in animation).
- Resize/geometry: positions are recomputed every render (as today). Guard the
  march transition so a pure re-render at the same square doesn't animate
  (only add `is-marching` when the square actually changed).
- Keep the current inset-when-purple behavior for unit divs standing on purple.

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 2: The corrosive look (CSS)

Replace the flat tints in `src/style.css` with layered, animated acid. Define
CSS custom properties on `.corrosion-overlay-layer` so themes can restyle
later (this is the per-piece-style theming hook — document it in a comment):

```css
.corrosion-overlay-layer {
  --acid-w: 160 230 210;   /* rgb triplets */
  --acid-b: 60 200 90;
  --acid-cls3: 255 60 40;
  --void: 128 0 160;
}
```

- `.corrosion-unit`: irregular blob, not a rectangle — use a `border-radius`
  like `58% 42% 55% 45% / 48% 55% 45% 52%`, background of two stacked
  `radial-gradient`s (bright core → transparent edge) over
  `rgb(var(--acid-*) / 0.55)`, plus `filter: url(#acid-goo)` if the SVG filter
  from Step 3 is present. Continuous idle animation `acid-pulse` (2.8s
  ease-in-out infinite alternate: subtle scale 0.96↔1.03 + glow
  `drop-shadow(0 0 6px rgb(var(--acid-*) / .8))` intensity shift) and
  `acid-blob` (8s infinite: slowly morph the border-radius corners) so it
  bubbles even when idle.
- Rising bubbles: `.corrosion-unit::after` — repeating radial-gradient dots,
  `mask-image: linear-gradient(transparent, black)`, animating
  `background-position` upward, 3s linear infinite.
- Drips: `.corrosion-unit::before` — 2–3 small elongated blobs hanging below
  the bottom edge (radial-gradients), animating scaleY subtly.
- `is-spawning` keyframe `acid-splash` (~450ms): scale 0.2→1.15→1 with
  brightness spike and a splatter shadow.
- `is-dying` keyframe `acid-dissolve` (~600ms): scale up 1→1.25, blur 0→6px,
  opacity →0.
- `.corrosion-unit--cls3`: angry — faster pulse (1.2s), ember-orange core over
  red, extra `drop-shadow` red glow; add a slow `cls3-seethe` rotation of the
  blob shape.
- Piece corrode-out (the ghost from Step 1), keyframes `piece-corrode`
  (~1.2s total, three phases):
  1. 0–250ms **purpling**: `filter: sepia(1) hue-rotate(230deg) saturate(2.2)
     brightness(0.8)` ramps in — the piece visibly turns purple.
  2. 200–500ms **cracking**: a crack overlay fades in on the ghost's
     `::after` — jagged dark fracture lines built from 3–4 thin
     `linear-gradient` slivers at different angles (or an inline SVG
     data-URI of crack strokes), `mix-blend-mode: multiply`.
  3. 400–1200ms **falling in / dissolving**: `translateY(12%)` sink +
     `scale(0.7)` shrink toward the blob, `blur(4px)`, opacity → 0, while
     small bubble dots (reuse the rising-bubble gradient) rise across it.
  Plus `.corrosion-kill-burst` accent (~700ms one-shot, spawned alongside the
  ghost): expanding acid-green ring flash at the square.
- `.corrosion-unit.is-feeding`: temporarily faster/larger bubble animation and
  a brightness spike (~1s), so the acid visibly "eats".
- Purple: `.corrosion-purple-bg` becomes a "void": near-black purple with a
  slowly rotating conic-gradient smoke overlay (12s linear infinite) and a
  faint inner shadow; `.corrosion-purple-skull` gets a 4s flicker (opacity
  .7↔1). `is-purpling` keyframe (~500ms): etch in from transparent with a
  brightness flash.
- Marching: `.corrosion-unit.is-marching` may add a squash-stretch scaleY
  wobble on top of the transform transition.
- **Accessibility**: wrap ALL infinite animations and transitions in
  `@media (prefers-reduced-motion: no-preference) { ... }` so reduced-motion
  users get the static (current) look. One-shot spawn/death animations may
  remain but shorten to 150ms under reduced motion.
- Badges/skull/info layer visuals stay as-is (they sit above the units layer).

**Verify**: `npm run build` → exit 0.

### Step 3 (optional, skip if time-boxed): SVG goo filter

Add to `index.html` (inside `<body>`, hidden): an `<svg width="0" height="0">`
with `<filter id="acid-goo">` using `feTurbulence` (fractalNoise,
baseFrequency ~0.9) + `feDisplacementMap` (scale ~6) to roughen unit edges.
Reference it from `.corrosion-unit { filter: url(#acid-goo) drop-shadow(...); }`.
If it visibly tanks frame rate on the 12x12 dev scenario (Step 5), drop the
filter reference and keep the CSS-only look — note the decision in the report.

**Verify**: `npm run build` → exit 0.

### Step 4: Thread `prev` state through main.ts

In BOTH `render()` functions in `src/main.ts` (hotseat ~line 383, online
~line 530): keep a `let prevState: GameState | null = null`; call
`renderOverlays(boardEl, view, state, prevState)` and set `prevState = state`
AFTER the render call. Reset `prevState = null` when a new game starts
(each flow function's setup already recreates the board — initialize the
variable there). Change nothing else in main.ts.

**Verify**: `npx tsc --noEmit` → exit 0; `npx vitest run` → all pass.

### Step 5: Visual verification in the browser

`npm run dev` (background), open with chrome-devtools MCP (load via
ToolSearch). The DEV-gated debug buttons at the bottom of the game view
("Load corrosion dev scenario", "Force corrosion phase") drive everything
without playing long games:

1. Start an 8x8 hotseat game, play `e2e4 d7d5 e4xd5` — corrosion spawns at e4
   with the splash animation (screenshot during + after).
2. Click "Force corrosion phase" — the unit oozes one square forward
   (screenshot mid-transition if possible, else confirm via DOM class
   `is-marching` toggling and final position).
3. Load the dev scenario + force phases until: a piece is destroyed by
   corrosion (kill-burst visible), two opposite corrosions annihilate
   (both dissolve), a class-3 marches leaving purple (void look + etch-in).
4. 12x12 game: overlays still positioned exactly on squares (compare against
   a known piece square), idle bubbling visible, no jank (scroll/drag feels
   smooth).
5. `list_console_messages` → no errors.
6. Screenshot set saved under `.superpowers/sdd/vfx-*.png`.
Kill your dev server (scoped to your port).

**Verify**: screenshots show blob-shaped animated corrosion (not flat
rectangles), kill-burst, void purple; console clean.

## Test plan

No engine tests change (engine untouched). This feature is DOM/CSS; the
project has no jsdom setup — verification is the browser pass in Step 5 plus:
- `npx vitest run` still green (proves no engine/API regression),
- `npx tsc --noEmit` clean,
- `npm run build` clean.

## Done criteria

- [ ] `npx tsc --noEmit` exits 0
- [ ] `npx vitest run` exits 0 (54+ tests)
- [ ] `npm run build` exits 0
- [ ] `git status` shows modifications only to in-scope files
- [ ] Screenshots demonstrate: spawn splash, march ooze, unit dissolve,
      piece kill-burst, purple void + etch-in, idle bubbling
- [ ] `@media (prefers-reduced-motion)` guard present in style.css
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- overlays.ts/main.ts don't match the "Current state" excerpts (drift).
- The per-unit keyed approach conflicts with how `squarePx` handles
  orientation for the online guest (markers land on wrong squares when
  orientation is 'b') and you cannot fix it inside overlays.ts alone.
- Animating requires modifying the engine or emitting events from it.
- Frame rate on the 12x12 dev scenario is visibly bad even after dropping the
  SVG filter (Step 3 fallback) — report rather than shipping jank.

## Maintenance notes

- The CSS custom properties (`--acid-w`, `--acid-b`, `--acid-cls3`, `--void`)
  are the theming surface: a future piece-set selector can restyle corrosion
  per theme by scoping overrides under `[data-pieceset='<name>']` on the board
  wrap. Do not hardcode colors outside those properties.
- The (unit id, cell index) key assumes cell order within a unit is stable
  across a render; the engine appends/removes cells only during promotions —
  if a future engine change reorders `cells`, the map keys must switch to
  (unit id, square).
- Reviewer should scrutinize: listener leaks (`animationend`/`transitionend`
  handlers must be `{ once: true }`), and the fallback removal timers.
