# Plan 006: "Corroded" game theme — make gameplay look like the key art

> **Executor instructions**: follow steps in order, verify each, honor STOP
> conditions, update your row in `plans/README.md` when done.
> **Drift check**: read live `src/ui/boardthemes.ts`, `src/ui/settings.ts`,
> `src/style.css`, `src/main.ts` — several plans landed after this was
> written. STOP only if board themes or the settings modal are missing.

## Status
- **Priority**: P1 · **Effort**: M · **Risk**: MED (visual, but touches board rendering + page chrome)
- **Depends on**: 005 (board themes), the acid-texture VFX iteration (public/vfx assets + sprite pattern)
- **Category**: direction · **Planned at**: 2026-07-23

## Why this matters
The user: "the splash screen image looks awesome — I wish the gameplay looked
more like it." The hero art (public/art/hero.png) is dark, cinematic: cracked
near-black stone board, volcanic seams, green corrosion glow, smoky void
background. Gameplay currently looks like daytime chess.com. This plan adds a
"Corroded" board theme + matching game ambience that carries the key art's
look into play, defaulting ON (it's the game's identity) while keeping the
existing bright themes selectable.

## Current state
- Board colors = CSS custom props `--board-light/--board-dark/--board-lastmove`
  set by `applyBoardTheme` (src/ui/boardthemes.ts, manifest of 6 flat-color
  themes, persisted 'boardtheme', applied at boot from main.ts).
- Squares are conic-gradient generated (style.css size blocks) — flat colors
  only; no texture support yet.
- Corrosion units use acid sprite textures from public/vfx/ (see
  exec-vfx's latest commit) — pattern to copy for board textures.
- Page background: flat #312e2b; game layout = player bars + board + sidebar
  card (style.css).
- Piece sets: cburnett default + generated sets via #pieceset-style overrides.

## Assets to generate (Replicate; token via gg/.mcp.json — never print it;
  reuse the predict+rembg script pattern from scripts/generate-pieces.mjs,
  though rembg is NOT needed for opaque tiles)
Save to public/vfx/board/:
- stone-dark.png, stone-light.png: SEAMLESS-tileable top-down cracked dark
  stone slab textures — near-black charcoal (dark) and slightly lighter
  graphite (light), subtle cracks, faint acid-green veins in the DARK
  variant only, muted so pieces stay readable. Prompt for "seamless tileable
  texture, top-down, flat lighting, no text"; verify tileability by eye at
  2x2 repeat (minor seams acceptable at square scale since each square shows
  one tile).
- ambience.png: OPTIONAL — if hero.png (blurred+darkened via CSS) suffices
  for the page backdrop, skip generating a separate ambience image.

## Steps
1. **Texture support in board themes**: extend the BoardTheme shape with
   optional `lightTex`/`darkTex` URLs. `applyBoardTheme` sets two more custom
   props (`--board-light-tex`/`--board-dark-tex`, value `url(...)` or `none`).
   In style.css's square rendering: current conic-gradient approach can't
   place per-square images — add two absolutely-positioned tiling layers
   under cg-board (or repeating background-image with background-size equal
   to 2 squares using the checker technique: one full-board layer tiled with
   the dark texture + the conic-gradient as an alpha MASK for light squares
   is complex — simplest robust approach: keep the conic-gradient color
   checker as the base, overlay ONE `background-image:
   var(--board-dark-tex); background-size: <square>px; mix-blend-mode:
   overlay/multiply; opacity ~0.9` texture layer across the whole board so
   cracks show on all squares while the checker tint differentiates
   light/dark). Choose the simplest approach that looks good and works on
   BOTH 8x8 and 12x12 (`data-size` aware sizing); document the choice.
2. **"Corroded" theme entry**: id 'corroded', label "Corroded", light
   #3a3d3a / dark #1f2320 (tune against the textures), lastmove a dim acid
   green (e.g. rgba(127,255,90,0.25)), textures from step 1. Make it the
   DEFAULT for new users (currentBoardTheme fallback 'corroded' instead of
   'green'); existing persisted choices are untouched.
3. **Game ambience**: when the corroded theme is active, the game view's page
   background becomes the key-art mood: body/game-layout gets a fixed,
   blurred, heavily darkened hero backdrop (`url('art/hero.png')`,
   `filter: blur(12px) brightness(0.35)` on a ::before layer or
   `background-blend-mode`) + a vignette; sidebar/player-bar cards get a
   touch more translucency (`rgba(...,0.85)` + `backdrop-filter: blur(6px)`
   with a solid fallback). Non-corroded themes keep the current flat page.
   Toggle via a `data-boardtheme` attribute on <body> set by applyBoardTheme.
4. **Legibility pass**: pieces (cburnett + generated sets) and corrosion
   overlays must stay readable on the dark board: if cburnett black pieces
   sink into the dark squares, add a subtle drop-shadow/outline to piece
   elements ONLY under `[data-boardtheme='corroded']` (style.css,
   `filter: drop-shadow(0 1px 2px rgba(0,0,0,.9)) drop-shadow(0 0 1px rgba(255,255,255,.25))`
   or similar); coordinate labels bumped to a lighter color under the theme.
5. **Settings preview** already renders board colors from the manifest —
   ensure the preview shows the corroded texture too (preview squares can
   use the same overlay technique at small scale; a flat-color approximation
   is acceptable fallback, note which).
6. **Verify** (headless, own port, NEVER :5174): screenshots — corroded
   gameplay 8x8 and 12x12 with pieces + corrosion + purple void (compare
   side-by-side vibe with hero.png), settings modal showing Corroded
   selected, one bright theme (green) unchanged, last-move highlight visible
   on corroded. tsc/vitest/build clean (adjust boardthemes tests for the new
   fields/default).

## Done criteria
- [ ] Corroded theme default; gameplay reads as the key art's dark world
- [ ] 8x8 + 12x12 textured; pieces/overlays/coords legible (screenshot proof)
- [ ] Other themes unaffected; persistence works; tests updated and green
- [ ] Only in-scope files (boardthemes.ts, settings.ts, style.css, main.ts,
      tests, public/vfx/board/) modified; README row updated

## STOP conditions
- The texture overlay technique can't work without modifying cgboard.ts
  internals → report options, don't touch the adapter.
- Legibility can't be achieved without redesigning piece sets → ship the
  theme non-default and report.

## Maintenance
- Texture layering is per-board-theme data; future textured themes (walnut
  wood grain etc.) reuse the same fields.
