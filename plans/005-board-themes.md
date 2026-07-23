# Plan 005: Board themes in the settings modal

> **Executor instructions**: follow steps in order, verify each, honor STOP
> conditions, update your row in `plans/README.md` when done.
> **Drift check**: read live `src/ui/settings.ts`, `src/ui/piecesets.ts`,
> `src/style.css` — plan 004 + the in-flight VFX iteration may have touched
> style.css. STOP only if the settings modal or piece-set persistence
> mechanisms are missing.

## Status
- **Priority**: P1 · **Effort**: S · **Risk**: LOW
- **Depends on**: 004 · **Category**: direction
- **Planned at**: commit `78fad2d`, 2026-07-22

## Why this matters
User wants chess.com-style board color themes next to the piece dropdown in
the settings modal (per the chess.com settings screenshots that drove plan
004).

## Current state
- Board squares are CSS-generated on BOTH sizes (conic-gradient checker rules
  in `src/style.css` — `[data-size='8']` and `[data-size='12']` blocks,
  colors currently hardcoded #ebecd0/#779556; last-move highlight ~#f5f682).
- Settings modal: `src/ui/settings.ts` (Pieces dropdown, preview strip,
  Cancel/Save). Persistence pattern: `src/ui/piecesets.ts`
  (localStorage try/catch, apply-on-boot from main.ts, injected style tag /
  CSS variables).
- Live board mount root carries class `pieceset-scope` (plan 004 fix).

## Scope
**In**: `src/ui/boardthemes.ts` (create), `src/ui/settings.ts`,
`src/ui/piecesets.ts` (only if sharing a storage helper is cleaner),
`src/style.css`, `src/main.ts` (boot apply), `tests/boardthemes.test.ts` (create).
**Out**: engine/**, net/**, ai/**, overlays.ts, cgboard/boardview internals.

## Steps
1. **Refactor board colors to CSS custom properties** on `:root`:
   `--board-light`, `--board-dark`, `--board-lastmove` — replace the
   hardcoded values in both size blocks (and the last-move highlight rule)
   with `var(...)`. Default = current green. Verify: build clean, board
   looks identical.
2. **`src/ui/boardthemes.ts`** (mirror piecesets.ts API, TDD):
   `BOARD_THEMES` (id, label, light, dark, lastmove): green (default,
   #ebecd0/#779556), brown (#f0d9b5/#b58863), blue (#dee3e6/#8ca2ad),
   purple (#e8e0ec/#9f7fbd), walnut (#e6d1b1/#8b6d4f), slate
   (#c7cdd1/#5b6975). `currentBoardTheme()` (localStorage 'boardtheme',
   try/catch, fallback green), `setBoardTheme(id)`, `applyBoardTheme(id)`
   (sets the three custom props via `document.documentElement.style.setProperty`).
   Tests: manifest unique ids/valid hex, fallback on garbage (stub
   localStorage), url-free (no DOM at module top level).
3. **Settings modal**: add a "Board" row (dropdown) under "Pieces", exactly
   the same row layout; the preview strip's squares use the selected board
   theme's light/dark live (preview updates on either dropdown change);
   Cancel reverts both, Save persists both.
4. **Boot**: `applyBoardTheme(currentBoardTheme())` alongside the piece-set
   apply in main.ts.
5. **Verify**: tsc/vitest/build clean. Browser (USER'S server runs at :5174 —
   never kill/restart it; use your own port): switch board to brown mid-game
   → live board recolors incl. last-move highlight; preview shows combined
   piece+board selection; persists on reload; 12x12 too; corrosion overlays
   still legible on all 6 themes (spot-check the darkest). Screenshots →
   `.superpowers/sdd/boardthemes-*.png`.

## Done criteria
- [ ] tsc/vitest/build clean, new tests pass
- [ ] Both dropdowns coexist; both persist; both preview live
- [ ] 8x8 + 12x12 recolor; overlays legible on all themes
- [ ] Only in-scope files modified; README row updated

## STOP conditions
- Board color rules turn out to live anywhere besides style.css's two size
  blocks (e.g. inline in cgboard.ts) — report, don't chase.
- Overlay legibility fails badly on a theme — drop that theme from the
  manifest and note it rather than redesigning overlay colors.

## Maintenance
- Future piece-set↔board pairing suggestions ("Halloween board") = data on
  the manifests, not new mechanism.
