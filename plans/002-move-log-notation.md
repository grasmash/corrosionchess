# Plan 002: Full move log in chess notation + missing corrosion events

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat a3dd8a2..HEAD -- src/engine/game.ts src/engine/legal.ts src/ui/hud.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch treat it as a STOP condition — EXCEPT pure-formatting or
> unrelated-hunk drift in `src/ui/hud.ts` (other UI work may land first);
> for hud.ts, re-locate the log-rendering block and continue.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW-MED (engine file edits, but purely additive logging + one new module)
- **Depends on**: none (independent of plan 001)
- **Category**: direction
- **Planned at**: commit `a3dd8a2`, 2026-07-22

## Why this matters

The sidebar log currently shows only corrosion events ("Corrosion spawns at
e4") — the moves themselves never appear, so the game has no record a chess
player can read. The user asked for every move in chess notation alongside
corrosion spawn/destroy events. Additionally, one destruction event is
currently silent: a piece capturing enemy corrosion (mover destroyed) logs
nothing.

## Current state

- `src/engine/game.ts` — `applyMove(prev, m)` orchestrator. Clones state,
  computes `wasPieceCapture` BEFORE `applyMoveCore`, calls
  `applyMoveCore(s, m)`, pushes a corrosion-spawn log entry when a capture
  spawns corrosion, then (after Black's move) runs `corrosionPhase(s)` and
  `s.round++`, then computes `s.result`. Log entries are
  `{ round: number; text: string }` pushed to `s.log`.
- `src/engine/legal.ts` — `applyMoveCore` executes the chess move including
  the corrosion-capture resolution (landing on hostile corrosion destroys the
  cells, and the mover too unless it's a king ~lines 41-60, 121-130). No log
  entry is emitted there (the function has access to the state `s`).
- `src/engine/corrosion.ts` — `corrosionPhase` already logs piece
  destructions, king blocks, annihilations, promotions. DO NOT modify it.
- `src/ui/hud.ts` — `renderHud(el, gs, opts)` renders `gs.log.slice(-8)` as
  plain text lines into the scrollable sidebar body.
- Engine conventions: pure headless TS, `import type`, square helpers in
  `src/engine/board.ts` (`toAlg(sq, size)`, `fileOf`, `rankOf`, `FILES`),
  `legalMoves(s, from?)` in legal.ts, `inCheck(s, color)` in legal.ts.
  Existing test style: see `tests/game.test.ts` (vitest, builds positions by
  mutating `newGame(cfg)` state directly).
- Board sizes 8 and 12; algebraic squares go up to `l12`. Castling is encoded
  as the king moving two files. En passant target lives in `s.epSquare`.
  Move: `{ from, to, promotion? }`.

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npx tsc --noEmit`  | exit 0              |
| Tests     | `npx vitest run`    | all pass            |
| One file  | `npx vitest run tests/notation.test.ts` | all pass |

## Scope

**In scope**:
- `src/engine/notation.ts` (create)
- `src/engine/game.ts` (add move-log entry + import)
- `src/engine/legal.ts` (add ONE log line for the corrosion-capture mover
  death; no other changes)
- `src/ui/hud.ts` (log rendering only: show full log, autoscroll)
- `tests/notation.test.ts` (create)

**Out of scope** (do NOT touch):
- `src/engine/corrosion.ts`, `src/engine/movegen.ts`, `src/engine/board.ts`,
  `src/engine/types.ts`
- `src/ui/overlays.ts`, `src/style.css` beyond a minimal log-line style hook
  if needed (plan 001 owns those files — if you need a style, add a single
  class rule at the END of style.css)
- The `NetMsg` protocol and `src/net/**` (log travels inside GameState
  already)

## Steps

### Step 1: `src/engine/notation.ts` — SAN for this variant (TDD)

Write `tests/notation.test.ts` FIRST (cases in Test plan), then implement:

```ts
import type { GameState, Move } from './types';
export function moveToSan(pre: GameState, m: Move): string;
```

Rules (standard SAN, adapted):
- Piece letters N/B/R/Q/K, pawns none. Destination via `toAlg(m.to, pre.size)`.
- Capture `x`: piece on `m.to` in `pre.board`, or en passant
  (`m.to === pre.epSquare` and mover is a pawn). Pawn captures prefix the
  origin file letter (`exd5`).
- Disambiguation: if another piece of the same type+color also has `m.to` in
  its `legalMoves(pre, otherFrom)` targets, add origin file; if same file,
  add origin rank (SAN standard). Compute with the existing `legalMoves` —
  correctness over speed.
- Castling: king moves two files → `O-O` (toward h/l side) or `O-O-O`.
- Promotion: `=Q` / `=R` / `=B` / `=N` suffix.
- Check/checkmate suffix: apply the move on a clone
  (`structuredClone(pre)` + `applyMoveCore`) and use `inCheck` on the
  opponent + whether opponent has zero legal moves → `+` or `#`. NOTE:
  corrosion-capture can destroy the mover — that's fine, `applyMoveCore`
  already resolves it; just read the resulting state.
- 12x12: nothing special — `toAlg` already emits `c4`, `l12`, etc.

**Verify**: `npx vitest run tests/notation.test.ts` → all pass.

### Step 2: Log the move in `applyMove`

In `src/engine/game.ts`, compute `const san = moveToSan(prev, m)` FIRST
(against the pre-move state), then after the move executes push the entry
BEFORE any corrosion-spawn/phase entries of that call:

- White's move: `text: `${s.round}. ${san}`` — Black's: `text: `${s.round}… ${san}``
  (use the actual round number of the move being played, i.e. the value
  before any `round++` in this call).

**Verify**: `npx vitest run tests/game.test.ts` → existing tests still pass
(they don't assert log contents for moves; if one does fail on log ordering,
STOP — report instead of editing the test).

### Step 3: Log the silent corrosion-capture death

In `src/engine/legal.ts`, at the point where a non-king mover is destroyed by
capturing hostile corrosion, push:
`{ round: s.round, text: `${PieceName} destroyed capturing corrosion at ${toAlg(m.to, s.size)}` }`
where PieceName is the full name (pawn/knight/bishop/rook/queen — kings never
die here). Also log the plain corrosion capture (king or piece) as
`Corrosion captured at <alg>` — one entry per event, keep wording simple.
`applyMoveCore` is also used speculatively by `legalMoves` filtering on
clones — log entries on discarded clones are harmless (they're thrown away
with the clone), so no guard is needed. Do NOT add a guard parameter.

**Verify**: `npx vitest run` → all pass.

### Step 4: HUD shows the full log

In `src/ui/hud.ts`: render ALL of `gs.log` (drop the `slice(-8)`), and after
rendering set the scroll container's `scrollTop = scrollHeight` so the newest
entry is visible (the sidebar body is already `overflow-y: auto`). Move
entries (matching `/^\d+[.…]/`) should get a `log-move` class; corrosion
events a `log-event` class (style hook: muted color for events, normal for
moves — if adding CSS, one rule block at the END of style.css).

**Verify**: `npx tsc --noEmit` → exit 0; `npm run build` → exit 0.

### Step 5: Browser sanity

`npm run dev`, play scholar's mate in hotseat: log shows
`1. e4` `1… e5` `2. Qh5` `2… Nc6` `3. Bc4` `3… Nf6` `4. Qxf7#` and the game
ends. Play a capture + wait a round: corrosion spawn/march/destroy events
interleaved with the numbered moves. Screenshot to
`.superpowers/sdd/notation-log.png`. Kill your dev server (scoped to your own
port — NEVER `pkill -f vite`).

## Test plan

`tests/notation.test.ts` (model after `tests/game.test.ts` position-building):
1. `1. e4` pawn push; `exd5` pawn capture; en passant `exd6`.
2. `Nf3`; knight disambiguation `Nbd2` (two knights reaching d2 by file);
   rank disambiguation `R1a3` (rooks on a1/a5, target a3).
3. Castling both sides → `O-O`, `O-O-O`.
4. Promotion `a8=Q`; underpromotion capture `bxa8=N`.
5. Check `Qh5+`-style position; mate → `#` (scholar's mate final move
   `Qxf7#`).
6. 12x12: a move to a double-digit rank renders e.g. `Qf10` (build from
   `newGame({bigBoard: true, ...})`).
7. game.ts integration: after `applyMove` of e2e4, `s.log` contains an entry
   with text `1. e4`; after a capture that spawns corrosion, the move entry
   appears BEFORE the spawn entry.
8. legal.ts integration: rook captures corrosion → log contains
   `Rook destroyed capturing corrosion at <sq>`.

**Verification**: `npx vitest run` → all pass including 8+ new tests.

## Done criteria

- [ ] `npx tsc --noEmit` exits 0
- [ ] `npx vitest run` exits 0, new notation tests present and passing
- [ ] Hotseat scholar's mate produces the exact numbered log above
      (screenshot saved)
- [ ] No modifications outside in-scope files (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Current-state excerpts don't match (engine drift) — except hud.ts as noted.
- Any existing engine test fails after Step 2/3 and the fix would require
  changing that test or `corrosion.ts`.
- Disambiguation via `legalMoves` proves too slow in tests (>5s a run) — stop
  and report; do not hand-roll attack tables.

## Maintenance notes

- `moveToSan` must be called with the PRE-move state; calling it post-move
  silently produces wrong captures/disambiguation. The game.ts call site is
  the only intended consumer.
- Plan 001 (VFX) also touches main.ts/style.css — merge order is irrelevant
  except both may append to style.css; trivial conflict.
- Deferred: clickable move list / jump-to-position (needs state history —
  out of scope here).
