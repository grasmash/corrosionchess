# Plan 007: Rules explainer with live simulated examples

> **Executor instructions**: follow steps in order, verify each, honor STOP
> conditions, update your row in `plans/README.md` when done.
> **Drift check**: read live `src/ui/vfxlab.ts`, `src/ui/splash.ts`,
> `src/ui/hud.ts`, `src/main.ts`, `src/style.css`. STOP only if the VFX Lab's
> scenario machinery is missing.

## Status
- **Priority**: P1 · **Effort**: M · **Risk**: LOW-MED
- **Depends on**: VFX Lab (landed, src/ui/vfxlab.ts) · **Category**: direction
- **Planned at**: 2026-07-23

## Why this matters
User request: "a modal or something that explains the rules in simple terms
and ideally with simulated examples the person can use to visualize the
different special corrosion behaviors." The VFX Lab already stages scripted
scenarios on a real board with the real engine + real animations — the
explainer reuses that machinery with plain-language rule text, user-facing
(not DEV-gated).

## Current state
- `src/ui/vfxlab.ts` — DEV-gated lab: scripted scenario stagers (spawn,
  march, piece-kill, annihilation, 1→2 split, 2→3 + purple, piece-captures-
  corrosion, king-cleanse) built on `newGame`/hand-built states +
  `renderOverlays` + a mini board view, slow-mo via `--vfx-speed`. Refactor
  the SCENARIOS (stage function + play function + board mount) into a shared
  module (e.g. `src/ui/scenarios.ts`) consumed by BOTH vfxlab and the new
  explainer — do not duplicate the staging logic.
- Entry points to add: a "How to Play" button on the splash (secondary, near
  Settings gear) and a "?" button in the game sidebar action row.
- Modal conventions: settings modal in `src/ui/settings.ts` (dark card,
  Cancel/Save layout); promotion modal in hud.ts. Match the card language.
- User-facing (NOT DEV-gated); must be tree-shake-safe to INCLUDE in prod.

## Scope
**In**: `src/ui/rules.ts` (create), `src/ui/scenarios.ts` (create, extracted
from vfxlab.ts), `src/ui/vfxlab.ts` (consume shared module), `src/ui/splash.ts`,
`src/ui/hud.ts` (or wherever the sidebar action row lives — likely main.ts),
`src/main.ts`, `src/style.css` (RULES block).
**Out**: engine/**, net/**, ai/**, overlays.ts internals, settings.ts.

## Content (write the copy — simple, short, friendly; ≤2 sentences per rule)
Pager/accordion of sections, each with text + an embedded mini-board that
plays its scenario on demand ("▶ Show me") with a replay button:
1. The basics: normal chess + "captures leave acid behind" (spawn scenario)
2. Corrosion marches one square toward the enemy every round (march)
3. It destroys enemy pieces it touches — and is used up doing it (piece-kill)
4. It passes through your own pieces (friendly pass — add this scenario to
   the shared module if the lab lacks it; the engine supports it)
5. Opposing acids destroy each other (annihilation)
6. Reaching the far edge: class 2 — two cells marching home (split)
7. Class 2 reaching home: class 3 — hurts EVERYONE, paints deadly purple
   (2→3 + purple)
8. Purple squares: nobody may enter... except kings, who cleanse them
   (king-cleanse)
9. Sacrifice play: any piece can step onto enemy acid to destroy it — both
   die; your KING eats acid for free (piece-captures-corrosion; mention the
   danger-ring UI cue)
10. Tiers: the setup toggles control how far this escalates (text only)
Modal: title "How Corrosion Works", section list on the left or top-pager
dots, mini-board sized ~320px, Esc/backdrop/Close dismisses, scroll-safe on
short screens, `prefers-reduced-motion` honored (scenarios still play, one-
shot anims shortened as already implemented).

## Steps
1. Extract `src/ui/scenarios.ts` (stagers + play + mini-board mount + optional
   slow-mo hook) from vfxlab.ts; vfxlab consumes it; add the friendly-pass
   scenario. Verify: tsc/vitest/build clean, lab still works headlessly.
2. Build `src/ui/rules.ts` modal per Content above; wire splash "How to Play"
   + in-game "?" buttons.
3. Verify headlessly (own port; user's server :1212 untouched): open from
   splash and from a game; play scenarios 1, 3, 7, 9 and screenshot each
   mid-animation; Esc closes; prod build includes it (grep dist for a rules
   string) while vfxlab stays DEV-only (grep dist for a lab-only string = 0
   matches). tsc/vitest/build clean.

## Done criteria
- [ ] Modal reachable from splash + in-game; all 9 playable examples work
- [ ] vfxlab refactor introduces no regressions (still DEV-only)
- [ ] tsc/vitest/build clean; screenshots delivered
- [ ] Only in-scope files; README row updated

## STOP conditions
- Scenario extraction requires touching engine files.
- Prod bundle balloons >300KB from this change (scenarios should be code, not
  assets).

## Maintenance
- New rules (future variants) = one section entry + one scenario in the
  shared module.
