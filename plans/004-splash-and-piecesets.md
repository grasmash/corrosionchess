# Plan 004: Splash home screen + piece-set picker

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. On a STOP condition, stop and report. When done, update your
> status row in `plans/README.md`.
>
> **Drift check (run first)**: read the live `src/main.ts`, `src/ui/setup.ts`,
> `src/ui/hud.ts`, `src/style.css` — plans 001–003 rewrote parts of them. The
> interfaces named below are what's guaranteed; STOP only if a named export is
> missing or differently shaped.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (touches app entry flow + piece rendering CSS)
- **Depends on**: 001, 002, 003 (all landed)
- **Category**: direction
- **Planned at**: commit `3897f62`, 2026-07-22

## Why this matters

Seven AI-generated piece sets sit unused in `public/pieces/`, and the
generated key art (`public/art/hero.png`, `hero-tall.png`, `mark.png`) has no
home. The user asked for a "super cool splash / home screen" and themeable
pieces. This plan wires both in, chess.com-style.

## Current state

- Entry flow: `src/main.ts` `start()` parses `location.hash`; `#join=` →
  online join; else `showSetup(onStart)` from `src/ui/setup.ts` renders the
  config card (tier toggles, board size, Play Hotseat / Create Online Game /
  Play vs Bot buttons). Bot mode goes through `showBotSelect` (src/ui/botselect.ts).
- Pieces are rendered by chessgroundx as `<piece>` elements whose
  background-image comes from `src/ui/pieces-cburnett.css` (selectors like
  `piece.white.p-piece` etc. — read the file for the exact class scheme;
  ranks use role-classes, colors `white`/`black`).
- Complete generated sets (12 PNGs each, keys wk..bp) in
  `public/pieces/<id>/`: `fireice`, `halloween`, `pets`, `dessert`,
  `mythical`, `robots`. INCOMPLETE (do NOT list): `christmas`, `greek`,
  `aliens`, `medieval`, `dinosaurs` (art pipeline blocked; the manifest must
  make adding them a one-line change).
- Art: `public/art/hero.png` (16:9, negative space upper-left),
  `hero-tall.png` (9:16, negative space top), `mark.png` (1:1 knight emblem).
- Conventions: plain TS+DOM, `import type`, chess.com-dark palette CSS vars,
  `.btn .btn-primary/.btn-secondary`, cards `--panel`/`--border`. localStorage
  is not yet used anywhere.

## Commands

| Purpose   | Command             | Expected |
|-----------|---------------------|----------|
| Typecheck | `npx tsc --noEmit`  | exit 0   |
| Tests     | `npx vitest run`    | all pass (99+) |
| Build     | `npm run build`     | exit 0   |

## Scope

**In scope**: `src/ui/splash.ts` (create), `src/ui/piecesets.ts` (create),
`src/ui/settings.ts` (create), `src/main.ts`, `src/ui/setup.ts` (minor),
`src/style.css` (append SPLASH + SETTINGS blocks), `index.html` (favicon,
preload), `tests/piecesets.test.ts` (create).

**Out of scope**: engine/**, net/**, ai/**, overlays.ts, cgboard/boardview
internals (piece-set CSS works purely via stylesheet injection — do not touch
the board adapter), generating any art.

## Steps

### Step 1: Piece-set manifest + dynamic CSS (`src/ui/piecesets.ts`, TDD)

```ts
export interface PieceSet { id: string; label: string; builtin?: boolean }
export const PIECE_SETS: PieceSet[]; // [{id:'classic', label:'Classic', builtin:true}, {id:'fireice', label:'Ice vs Fire'}, {id:'halloween', label:'Halloween'}, {id:'pets', label:'Dogs vs Cats'}, {id:'dessert', label:'Dessert'}, {id:'mythical', label:'Mythical'}, {id:'robots', label:'Robots'}]
export function currentPieceSet(): string;            // localStorage 'pieceset' | 'classic'; unknown id → 'classic'
export function setPieceSet(id: string): void;        // persist + applyPieceSet
export function applyPieceSet(id: string): void;      // see below
export function pieceImageUrl(id: string, key: string): string; // 'pieces/<id>/<key>.png'
```

`applyPieceSet`: maintain a single `<style id="pieceset-style">` element in
`<head>`. For `classic`, empty it (falls back to pieces-cburnett.css). For a
generated set, fill it with rules that override the cburnett backgrounds for
every color×role combination using the EXACT selector scheme found in
`src/ui/pieces-cburnett.css` (read it; mirror its specificity and add
`!important` only if its selectors otherwise tie). Map role→key letter
(pawn→p, knight→n, bishop→b, rook→r, queen→q, king→k; colors white→w,
black→b) via `pieceImageUrl`. Set `background-size: contain` if cburnett's
rules don't already.

Tests (`tests/piecesets.test.ts` — pure logic only, no DOM): manifest ids
unique + include the six generated sets + classic first; `pieceImageUrl`
formatting; `currentPieceSet` fallback on garbage (mock localStorage via a
tiny injectable getter/setter or `globalThis.localStorage` stub — keep the
module top-level DOM-free so vitest can import it, same pattern as setup.ts).

**Verify**: `npx vitest run tests/piecesets.test.ts` → pass.

### Step 2: Settings modal (`src/ui/settings.ts`)

`showSettings(onClose: () => void): void` — chess.com-style modal card
(dark, rounded, like the promotion modal): a live preview strip at the top
(two rows: black pieces rnbqkbnr over pawns — plain `<img>` tags via
`pieceImageUrl`, on alternating green squares built with CSS), a "Pieces"
dropdown (`<select>`) listing `PIECE_SETS` labels, and Cancel / Save buttons
(`.btn-secondary` / `.btn-primary`). Changing the dropdown updates the
preview instantly; Save persists via `setPieceSet` + closes; Cancel reverts
to the stored value + closes. For `classic`, preview uses the cburnett
sprites — simplest: render `<piece>`-classed divs for classic, imgs for
generated sets, OR just show a text note "Classic (default)" with the piece
divs; pick one and keep it clean.
Add a gear button (⚙, `.btn-secondary`, small) to the game sidebar action row
and to the splash screen (Step 3) that opens it.

### Step 3: Splash home screen (`src/ui/splash.ts`)

`showSplash(onPlay: (mode: 'hotseat'|'host'|'bot') => void): void` — replaces
`showSetup` as the app's landing view:
- Full-viewport hero: `background: center/cover url('art/hero.png')` with a
  dark gradient scrim (`linear-gradient(rgba(20,18,16,.2), rgba(20,18,16,.85))`)
  for text legibility; `@media (max-aspect-ratio: 1/1)` swaps to
  `hero-tall.png` with the scrim weighted toward the top.
- Upper-left/center content (the art's negative space): `mark.png` as a
  ~72px logo, title "CORROSION CHESS" (bold, letterspaced, subtle acid-green
  text-shadow), tagline "Capture. Corrode. Survive."
- Three big buttons: "Play Bots" (primary), "Pass & Play", "Play Online" +
  a small ⚙ Settings button. Each routes into the EXISTING flows: keep
  `showSetup`'s config card as step 2 (mode preselected — add an optional
  `mode` param to `showSetup` or a lightweight config-only variant; smallest
  honest change wins, document what you did) so tier/board toggles remain
  reachable for every mode.
- `index.html`: set favicon to `art/mark.png` (`<link rel="icon">`).
- On app boot (`start()`), call `applyPieceSet(currentPieceSet())` once
  before any board renders, and route `#join=` links STRAIGHT to the join
  flow (splash must not swallow invite links).

### Step 4: Wire + polish

- New Game / game-over "New game" buttons return to the splash (not the bare
  setup card).
- Ensure the settings gear works mid-game: applying a set re-skins the live
  board (chessgroundx pieces are plain CSS backgrounds — injected style
  updates apply immediately; verify).
- CSS: SPLASH + SETTINGS blocks appended to style.css; responsive (board
  flows already handle narrow widths — splash must too); respect
  `prefers-reduced-motion` if you add any splash animation.

**Verify**: `npx tsc --noEmit`, `npx vitest run`, `npm run build` all clean.

### Step 5: Browser verification (own dev port; kill only your port)

1. Splash renders with hero art, logo, buttons (screenshot desktop + narrow).
2. Play Bots → roster → game; gear → switch to Ice vs Fire → Save → live
   board re-skins instantly (screenshot before/after).
3. Reload → selection persisted; splash → Pass & Play → board uses persisted
   set on 8x8 AND 12x12 (screenshot 12x12 with a themed set — confirm piece
   images scale to the smaller squares).
4. Corrosion overlays still position/animate correctly with themed pieces
   (spawn a capture; the overlay layer is independent but LOOK anyway).
5. Online: create game → invite URL still works end-to-end with a second
   page; guest sees THEIR OWN stored piece set (sets are local, not synced —
   expected; note it).
6. Settings Cancel reverts preview; unknown localStorage value falls back to
   classic. No console errors anywhere. Screenshots →
   `.superpowers/sdd/splash-*.png`, `settings-*.png`.

## Done criteria

- [ ] tsc/vitest/build clean; new piecesets tests pass
- [ ] Splash with hero art + working routing (incl. #join= passthrough)
- [ ] Piece-set switching live-re-skins and persists; 12x12 verified
- [ ] Screenshots delivered (splash desktop+narrow, settings modal, themed
      board 8x8+12x12)
- [ ] `git status` — only in-scope files
- [ ] `plans/README.md` row updated

## STOP conditions

- pieces-cburnett.css's selector scheme can't be overridden by injected
  styles without editing cgboard internals → report, don't touch the adapter.
- Any engine/net regression appears in the suite.
- Hero art files missing.

## Maintenance notes

- Adding a future set (christmas/greek/aliens/medieval/dinosaurs when art
  completes) = one line in `PIECE_SETS`. Do NOT list incomplete sets.
- Corrosion VFX theming hook (`--acid-*` custom props, see plan 001) is the
  place to give piece sets matching corrosion colors later — out of scope
  here.
- The bot avatars (public/avatars/) may not exist yet; splash/botselect
  fallbacks already handle that.
