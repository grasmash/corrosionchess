# Corrosion Chess Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browser-based chess variant "Corrosion Chess" — standard chess plus corrosion mechanics, playable hotseat and online via shared URL.

**Architecture:** Pure headless TypeScript rules engine (board-size parametric, fully unit-tested), thin UI layer (chessgroundx renderer with custom-renderer fallback behind a `BoardView` interface, plus an absolutely-positioned overlay layer for corrosion/purple), PeerJS P2P transport for online play. Engine state is plain JSON — serialization is trivial and deterministic replay keeps peers in sync.

**Tech Stack:** Vite, TypeScript, Vitest, chessgroundx (GPL-3.0, board UI), PeerJS (WebRTC).

**Spec:** `docs/superpowers/specs/2026-07-22-corrosion-chess-design.md` — the authority on all rules. Read it before starting any engine task.

## Global Constraints

- Board sizes: 8x8 standard; 12x12 "big board" with the 8x8 army centered both axes (white back rank = rank index 2, white pawns = 3, black pawns = 8, black back rank = 9, files index 2–9). Offset is always `(size - 8) / 2`.
- Square indexing everywhere: `sq = rank * size + file`, 0-based, rank 0 = White's near edge. White corrosion direction = +1 rank per corrosion phase.
- Corrosion phase runs once per full round, immediately after Black's move.
- Corrosion of classes 1/2 is consumed when it destroys a piece; class 3 likewise (its purple trail remains).
- Kings: immune to all corrosion, capture corrosion for free, block corrosion (corrosion entering any king's square is destroyed), never in check from corrosion.
- Purple squares: no piece may land on or slide through them; knights may jump over but not land; either king may land (square is cleansed immediately in engine terms).
- Config toggles: tier1 (spawning), tier2 (class 1→2), tier3 (class 2→3), bigBoard. UI enforces tier3⇒tier2⇒tier1.
- Engine is pure and headless: no DOM imports anywhere under `src/engine/`.
- Out of scope v1: AI, clocks, draw-by-repetition/50-move, persistence, accounts, mobile layout.
- TDD every engine task: failing test → run → implement → pass → commit. Run tests with `npx vitest run <file>`.
- Commit after every task (and at each step marked Commit). Message style: `feat: …` / `test: …` / `chore: …`.

---

## File Structure

```
index.html
package.json / tsconfig.json / vite.config.ts
src/
  engine/types.ts       shared types (no logic)
  engine/board.ts       geometry helpers + initialState()
  engine/movegen.ts     isAttacked, pseudoMoves (purple-aware rays)
  engine/legal.ts       legalMoves, inCheck, applyMoveCore (chess execution)
  engine/corrosion.ts   corrosionPhase()
  engine/game.ts        applyMove orchestrator, game-end detection
  ui/boardview.ts       BoardView interface + square-geometry helpers
  ui/cgboard.ts         chessgroundx implementation of BoardView
  ui/customboard.ts     fallback DOM renderer (only if spike fails)
  ui/overlays.ts        corrosion/purple overlay layer
  ui/setup.ts           config screen + mode select
  ui/hud.ts             turn indicator, event log, game-over banner, promotion picker
  net/peer.ts           PeerJS host/join + message protocol
  main.ts               wiring
  style.css
tests/
  board.test.ts  movegen.test.ts  legal.test.ts  rules.test.ts
  game.test.ts  corrosion.test.ts  promotion.test.ts  serialize.test.ts
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `src/style.css`, `.gitignore`

**Interfaces:**
- Produces: working `npm run dev`, `npx vitest run` (0 tests, exit 0).

- [ ] **Step 1: Scaffold**

```bash
cd /Users/matthewgrasmick/Sites/corrosionchess
npm create vite@latest . -- --template vanilla-ts
npm install
npm install chessgroundx peerjs
npm install -D vitest
```

If `npm create vite` refuses a non-empty dir (docs/, .git exist), scaffold in a temp dir and copy files in — do not delete docs or .git.

- [ ] **Step 2: Add test script**

In `package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 3: Strip Vite demo cruft**

Delete `src/counter.ts`, `src/typescript.svg`, `public/vite.svg` if present. Replace `src/main.ts` with:

```ts
import './style.css';
document.querySelector<HTMLDivElement>('#app')!.textContent = 'Corrosion Chess';
```

Replace `src/style.css` with an empty file for now. `index.html` title: `Corrosion Chess`.

- [ ] **Step 4: Verify**

Run: `npx vitest run` → "No test files found" is fine only if exit code 0; otherwise add a placeholder test and delete it in Task 2. Run `npm run build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold Vite + TS + Vitest project"
```

---

### Task 2: Types, geometry, initial setup

**Files:**
- Create: `src/engine/types.ts`, `src/engine/board.ts`
- Test: `tests/board.test.ts`

**Interfaces:**
- Produces (exact — later tasks depend on these):

```ts
// types.ts
export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export interface Piece { color: Color; type: PieceType }
export interface Config { tier1: boolean; tier2: boolean; tier3: boolean; bigBoard: boolean }
export interface CorrosionUnit {
  id: number;
  color: Color;
  cls: 1 | 2 | 3;
  cells: number[];      // squares; 1 cell for cls 1/3, up to 2 for cls 2
  dir: 1 | -1;          // +1 = toward higher ranks
  bornRound: number;    // unit does not move in the phase of the round it was born
}
export interface Move { from: number; to: number; promotion?: PieceType }
export interface LogEvent { round: number; text: string }
export interface GameState {
  size: number;
  board: (Piece | null)[];        // length size*size
  turn: Color;
  castling: { wK: boolean; wQ: boolean; bK: boolean; bQ: boolean };
  epSquare: number | null;
  corrosions: CorrosionUnit[];
  purple: number[];
  round: number;                   // starts at 1
  nextId: number;
  config: Config;
  result: { winner: Color | null; reason: string } | null;
  log: LogEvent[];
}
```

```ts
// board.ts
export const FILES = 'abcdefghijkl';
export function fileOf(s: number, size: number): number;   // s % size
export function rankOf(s: number, size: number): number;   // floor(s / size)
export function sq(file: number, rank: number, size: number): number;
export function inBounds(file: number, rank: number, size: number): boolean;
export function toAlg(s: number, size: number): string;    // 'a1' … 'l12'
export function fromAlg(a: string, size: number): number;
export function offsetOf(size: number): number;            // (size - 8) / 2
export function pawnStartRank(color: Color, size: number): number; // w: off+1, b: size-2-off
export function promotionRank(color: Color, size: number): number; // w: size-1, b: 0
export function enemyEdgeRank(color: Color, size: number): number; // same as promotionRank
export function ownerEdgeRank(color: Color, size: number): number; // w: 0, b: size-1
export function forwardDir(color: Color): 1 | -1;                  // w: 1, b: -1
export function initialState(config: Config): GameState;
```

`initialState`: size = `config.bigBoard ? 12 : 8`; army on files off..off+7; back-rank order r,n,b,q,k,r? — **standard: r n b q k b n r**; white back rank at rank `off`, pawns `off+1`; black pawns `size-2-off`, back rank `size-1-off`. `turn:'w'`, all castling true, `epSquare:null`, `corrosions:[]`, `purple:[]`, `round:1`, `nextId:1`, `result:null`, `log:[]`.

- [ ] **Step 1: Write failing tests** (`tests/board.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { initialState, toAlg, fromAlg, sq, pawnStartRank, offsetOf } from '../src/engine/board';

const cfg = (bigBoard: boolean) => ({ tier1: true, tier2: true, tier3: true, bigBoard });

describe('geometry', () => {
  it('round-trips algebraic on both sizes', () => {
    expect(toAlg(0, 8)).toBe('a1');
    expect(toAlg(63, 8)).toBe('h8');
    expect(toAlg(143, 12)).toBe('l12');
    expect(fromAlg('e4', 8)).toBe(sq(4, 3, 8));
    expect(fromAlg('c3', 12)).toBe(sq(2, 2, 12));
  });
});

describe('initialState 8x8', () => {
  const s = initialState(cfg(false));
  it('places standard army', () => {
    expect(s.board[fromAlg('e1', 8)]).toEqual({ color: 'w', type: 'k' });
    expect(s.board[fromAlg('d8', 8)]).toEqual({ color: 'b', type: 'q' });
    expect(s.board[fromAlg('a2', 8)]).toEqual({ color: 'w', type: 'p' });
    expect(s.board.filter(Boolean).length).toBe(32);
  });
});

describe('initialState 12x12', () => {
  const s = initialState(cfg(true));
  it('centers army both axes', () => {
    expect(offsetOf(12)).toBe(2);
    expect(s.size).toBe(12);
    expect(s.board[fromAlg('g3', 12)]).toEqual({ color: 'w', type: 'k' }); // file 6 = c+4 → e-file shifted by 2 → g
    expect(s.board[fromAlg('f10', 12)]).toEqual({ color: 'b', type: 'q' });
    expect(s.board[fromAlg('c4', 12)]).toEqual({ color: 'w', type: 'p' });
    expect(s.board[fromAlg('b2', 12)]).toBeNull(); // outside army footprint
    expect(s.board.filter(Boolean).length).toBe(32);
    expect(pawnStartRank('w', 12)).toBe(3);
    expect(pawnStartRank('b', 12)).toBe(8);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run tests/board.test.ts` → module not found.
- [ ] **Step 3: Implement `types.ts` and `board.ts` exactly per the interface block above.**
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: engine types, board geometry, initial setup"`

---

### Task 3: Attack detection and pseudo-legal moves (purple-aware)

**Files:**
- Create: `src/engine/movegen.ts`
- Test: `tests/movegen.test.ts`

**Interfaces:**
- Consumes: Task 2 types/board.
- Produces:

```ts
export function isAttacked(state: GameState, square: number, by: Color): boolean;
export function pseudoMoves(state: GameState, from: number): Move[];
```

Rules for both functions:
- Sliding rays (b/r/q) stop at the first occupied square (capture if enemy) **and cannot enter or pass a purple square**.
- Knights ignore blockers but may not **land** on purple.
- Kings: single step; MAY land on purple (cleansed in apply); castling handled here too — see below.
- Pawns: forward 1 to empty non-purple square; double from `pawnStartRank` if both squares empty and non-purple; diagonal capture onto enemy piece (non-purple); en passant onto `state.epSquare`; if destination rank is `promotionRank`, emit one Move per promotion piece `q,r,b,n`.
- Landing on a square containing corrosion is always geometrically allowed (corrosion is not a blocker); consequences resolve in apply.
- Non-king pieces may never land on purple, period.
- Castling (`pseudoMoves` for king on its start square with rights): all squares strictly between king and rook empty and non-purple; king's start, transit, and destination squares not attacked by the enemy; encode as king-moves-two-files Move. Rook and king start squares per setup (offset-aware: e-file+off, rooks at off and off+7).

`isAttacked` must use the same ray/purple logic (a slider does not attack through purple). Pawn attack direction = `forwardDir(color)` diagonals.

- [ ] **Step 1: Write failing tests** (`tests/movegen.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { initialState, fromAlg } from '../src/engine/board';
import { pseudoMoves, isAttacked } from '../src/engine/movegen';
import type { GameState } from '../src/engine/types';

const cfg = { tier1: true, tier2: true, tier3: true, bigBoard: false };
const empty8 = (): GameState => {
  const s = initialState(cfg);
  s.board = s.board.map(() => null);
  return s;
};
const put = (s: GameState, a: string, color: 'w' | 'b', type: any) => {
  s.board[fromAlg(a, s.size)] = { color, type };
};
const dests = (s: GameState, a: string) =>
  pseudoMoves(s, fromAlg(a, s.size)).map(m => m.to).sort((x, y) => x - y);

it('knight from b1 in initial position', () => {
  const s = initialState(cfg);
  expect(dests(s, 'b1')).toEqual([fromAlg('a3', 8), fromAlg('c3', 8)].sort((x, y) => x - y));
});

it('rook blocked by purple', () => {
  const s = empty8();
  put(s, 'a1', 'w', 'r');
  s.purple = [fromAlg('a4', 8)];
  const d = dests(s, 'a1');
  expect(d).toContain(fromAlg('a3', 8));
  expect(d).not.toContain(fromAlg('a4', 8));
  expect(d).not.toContain(fromAlg('a5', 8));
});

it('knight may jump over purple but not land on it', () => {
  const s = empty8();
  put(s, 'b1', 'w', 'n');
  s.purple = [fromAlg('b2', 8), fromAlg('c3', 8)];
  const d = dests(s, 'b1');
  expect(d).toContain(fromAlg('a3', 8));
  expect(d).not.toContain(fromAlg('c3', 8));
});

it('king may land on purple', () => {
  const s = empty8();
  put(s, 'e1', 'w', 'k');
  s.purple = [fromAlg('e2', 8)];
  expect(dests(s, 'e1')).toContain(fromAlg('e2', 8));
});

it('pawn double-step blocked by purple transit', () => {
  const s = empty8();
  put(s, 'e2', 'w', 'p');
  s.purple = [fromAlg('e3', 8)];
  expect(dests(s, 'e2')).toEqual([]);
});

it('pawn promotion emits four moves', () => {
  const s = empty8();
  put(s, 'a7', 'w', 'p');
  const ms = pseudoMoves(s, fromAlg('a7', 8));
  expect(ms.map(m => m.promotion).sort()).toEqual(['b', 'n', 'q', 'r']);
});

it('en passant target is generated', () => {
  const s = empty8();
  put(s, 'e5', 'w', 'p');
  put(s, 'd5', 'b', 'p');
  s.epSquare = fromAlg('d6', 8);
  expect(dests(s, 'e5')).toContain(fromAlg('d6', 8));
});

it('isAttacked respects purple blocking', () => {
  const s = empty8();
  put(s, 'a1', 'b', 'r');
  s.purple = [fromAlg('a4', 8)];
  expect(isAttacked(s, fromAlg('a3', 8), 'b')).toBe(true);
  expect(isAttacked(s, fromAlg('a6', 8), 'b')).toBe(false);
});

it('castling kingside available in cleared initial position', () => {
  const s = initialState(cfg);
  s.board[fromAlg('f1', 8)] = null;
  s.board[fromAlg('g1', 8)] = null;
  expect(dests(s, 'e1')).toContain(fromAlg('g1', 8));
});

it('12x12 pawn double-step from c4', () => {
  const s = initialState({ ...cfg, bigBoard: true });
  expect(dests(s, 'c4')).toContain(fromAlg('c6', 12));
});
```

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement `movegen.ts`.** Core shape:

```ts
import type { GameState, Move, Color, PieceType } from './types';
import { fileOf, rankOf, sq, inBounds, pawnStartRank, promotionRank, forwardDir, offsetOf } from './board';

const N = [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
const B = [[1,1],[1,-1],[-1,1],[-1,-1]];
const R = [[1,0],[-1,0],[0,1],[0,-1]];
const K = [...B, ...R];
const isPurple = (s: GameState, x: number) => s.purple.includes(x);

function ray(s: GameState, from: number, df: number, dr: number, out: number[]) {
  const size = s.size;
  let f = fileOf(from, size) + df, r = rankOf(from, size) + dr;
  while (inBounds(f, r, size)) {
    const t = sq(f, r, size);
    if (isPurple(s, t)) break;
    if (s.board[t]) { out.push(t); break; }
    out.push(t);
    f += df; r += dr;
  }
}

export function attackSquares(s: GameState, from: number): number[] {
  // piece-type dispatch: knight/king steps (bounds-checked), slider rays via ray(),
  // pawn = the two forward diagonals. Knight/king/pawn steps exclude nothing except
  // off-board here; landing filters differ between attack and move contexts below.
}

export function isAttacked(s: GameState, target: number, by: Color): boolean {
  for (let i = 0; i < s.board.length; i++) {
    const p = s.board[i];
    if (!p || p.color !== by) continue;
    if (attackSquares(s, i).includes(target)) return true;
  }
  return false;
}

export function pseudoMoves(s: GameState, from: number): Move[] {
  // pawns: pushes (empty + non-purple, double via pawnStartRank), captures/ep, promotions
  // knights/sliders/king: attackSquares minus (friendly-occupied) minus (purple unless king)
  // king on start square with rights: add castling per rules above
}
```

Implement fully (no stubs). Castling start squares: king at `sq(4 + off, backRank, size)`, rooks at `sq(off, backRank, size)` / `sq(7 + off, backRank, size)` where `off = offsetOf(size)`, `backRank = color === 'w' ? off : size - 1 - off`.

- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat: purple-aware attack detection and pseudo-legal move generation"`

---

### Task 4: Chess move execution and full legality

**Files:**
- Create: `src/engine/legal.ts`
- Test: `tests/legal.test.ts`

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces:

```ts
export function applyMoveCore(s: GameState, m: Move): void;
// Mutates s: executes the chess move ONLY (no corrosion spawn/phase, no result calc):
// - moves piece, handles capture removal, en passant capture, castling rook hop,
//   promotion, castling-rights updates, epSquare set/clear
// - resolves corrosion-capture landing: if destination holds cells of hostile corrosion
//   (opposite color, or any class 3), destroy those cells; if mover is NOT a king,
//   destroy the mover too. Remove now-empty units.
// - if mover is a king landing on purple, remove that square from s.purple (cleanse)
// - flips s.turn
export function inCheck(s: GameState, color: Color): boolean;   // king attacked?
export function legalMoves(s: GameState, from?: number): Move[];
// pseudoMoves filtered: clone (structuredClone), applyMoveCore, then !inCheck(clone, mover)
```

Note the subtlety: capturing enemy corrosion destroys the mover — legality must reflect the post-destruction board (e.g. that "capture" can expose your king). `applyMoveCore` runs the destruction before the check test, so filtering via clone+apply handles it for free.

- [ ] **Step 1: Write failing tests** (`tests/legal.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { initialState, fromAlg } from '../src/engine/board';
import { applyMoveCore, legalMoves, inCheck } from '../src/engine/legal';
import type { GameState } from '../src/engine/types';

const cfg = { tier1: true, tier2: true, tier3: true, bigBoard: false };
const empty8 = (): GameState => { const s = initialState(cfg); s.board = s.board.map(() => null); return s; };
const put = (s: GameState, a: string, color: 'w'|'b', type: any) => { s.board[fromAlg(a, s.size)] = { color, type }; };
const mv = (s: GameState, from: string, to: string, promotion?: any) =>
  ({ from: fromAlg(from, s.size), to: fromAlg(to, s.size), promotion });

it('pinned piece cannot move', () => {
  const s = empty8();
  put(s, 'e1', 'w', 'k'); put(s, 'e2', 'w', 'r'); put(s, 'e8', 'b', 'r');
  expect(legalMoves(s, fromAlg('e2', 8)).every(m => [fromAlg('e3',8),fromAlg('e4',8),fromAlg('e5',8),fromAlg('e6',8),fromAlg('e7',8),fromAlg('e8',8)].includes(m.to))).toBe(true);
});

it('en passant executes: captured pawn removed', () => {
  const s = empty8();
  put(s, 'e5', 'w', 'p'); put(s, 'd5', 'b', 'p');
  put(s, 'a1', 'w', 'k'); put(s, 'h8', 'b', 'k');
  s.epSquare = fromAlg('d6', 8);
  applyMoveCore(s, mv(s, 'e5', 'd6'));
  expect(s.board[fromAlg('d5', 8)]).toBeNull();
  expect(s.board[fromAlg('d6', 8)]).toEqual({ color: 'w', type: 'p' });
});

it('castling moves the rook too', () => {
  const s = initialState(cfg);
  s.board[fromAlg('f1', 8)] = null; s.board[fromAlg('g1', 8)] = null;
  applyMoveCore(s, mv(s, 'e1', 'g1'));
  expect(s.board[fromAlg('f1', 8)]).toEqual({ color: 'w', type: 'r' });
  expect(s.castling.wK).toBe(false);
});

it('capturing enemy corrosion destroys the mover (non-king)', () => {
  const s = empty8();
  put(s, 'a1', 'w', 'k'); put(s, 'h8', 'b', 'k'); put(s, 'd4', 'w', 'r');
  s.corrosions = [{ id: 1, color: 'b', cls: 1, cells: [fromAlg('d6', 8)], dir: -1, bornRound: 0 }];
  applyMoveCore(s, mv(s, 'd4', 'd6'));
  expect(s.board[fromAlg('d6', 8)]).toBeNull();
  expect(s.corrosions).toEqual([]);
});

it('king captures corrosion for free and cleanses purple on landing', () => {
  const s = empty8();
  put(s, 'e1', 'w', 'k'); put(s, 'h8', 'b', 'k');
  s.corrosions = [{ id: 1, color: 'b', cls: 1, cells: [fromAlg('e2', 8)], dir: -1, bornRound: 0 }];
  s.purple = [fromAlg('e2', 8)];
  applyMoveCore(s, mv(s, 'e1', 'e2'));
  expect(s.board[fromAlg('e2', 8)]).toEqual({ color: 'w', type: 'k' });
  expect(s.corrosions).toEqual([]);
  expect(s.purple).toEqual([]);
});

it('suicidal corrosion capture that exposes king is illegal', () => {
  const s = empty8();
  put(s, 'e1', 'w', 'k'); put(s, 'e2', 'w', 'r'); put(s, 'e8', 'b', 'r'); put(s, 'h8', 'b', 'k');
  s.corrosions = [{ id: 1, color: 'b', cls: 1, cells: [fromAlg('a2', 8)], dir: -1, bornRound: 0 }];
  // Re2xa2 (rook takes corrosion) would destroy the rook and expose e1 to e8 rook
  expect(legalMoves(s, fromAlg('e2', 8)).map(m => m.to)).not.toContain(fromAlg('a2', 8));
});

it('scholars mate leaves black with zero legal moves and inCheck', () => {
  const s = initialState(cfg);
  const play = (a: string, b: string) => applyMoveCore(s, mv(s, a, b));
  play('e2','e4'); play('e7','e5'); play('d1','h5'); play('b8','c6');
  play('f1','c4'); play('g8','f6'); play('h5','f7');
  expect(inCheck(s, 'b')).toBe(true);
  const all = Array.from({ length: 64 }, (_, i) => i)
    .filter(i => s.board[i]?.color === 'b')
    .flatMap(i => legalMoves(s, i));
  expect(all).toEqual([]);
});
```

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement `legal.ts` fully per the interface comment block.** `legalMoves(s)` with no `from` iterates every square of `s.turn`'s pieces.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat: move execution, corrosion-capture resolution, legality and check"`

---

### Task 5: Game orchestrator — applyMove, corrosion spawn, game end

**Files:**
- Create: `src/engine/game.ts`
- Test: `tests/game.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4; `corrosionPhase` from Task 6 (import it now; Task 6 creates the module — for THIS task create `src/engine/corrosion.ts` containing only `export function corrosionPhase(s: GameState): void {}` as a stub to be filled by Task 6).
- Produces:

```ts
export function newGame(config: Config): GameState;       // initialState wrapper
export function applyMove(prev: GameState, m: Move): GameState;
// 1. throw if prev.result, or m not in legalMoves(prev, m.from)
// 2. s = structuredClone(prev)
// 3. wasPieceCapture = destination holds enemy piece OR move is en passant
// 4. mover = s.board[m.from]; moverColor = s.turn
// 5. applyMoveCore(s, m)
// 6. if wasPieceCapture && s.config.tier1:
//      s.corrosions.push({ id: s.nextId++, color: moverColor, cls: 1,
//        cells: [m.from], dir: forwardDir(moverColor), bornRound: s.round })
//      log "Corrosion spawns at <alg>"
// 7. if moverColor === 'b': corrosionPhase(s); s.round++
// 8. computeResult(s): if legalMoves(s) empty →
//      inCheck(s, s.turn) ? { winner: other(s.turn), reason: 'checkmate' }
//                         : { winner: null, reason: 'stalemate' }
// 9. return s
export function other(c: Color): Color;
```

- [ ] **Step 1: Write failing tests** (`tests/game.test.ts`)

```ts
import { it, expect } from 'vitest';
import { newGame, applyMove } from '../src/engine/game';
import { fromAlg } from '../src/engine/board';

const cfg = { tier1: true, tier2: true, tier3: true, bigBoard: false };
const mv = (s: any, a: string, b: string) => ({ from: fromAlg(a, s.size), to: fromAlg(b, s.size) });

it('capture spawns corrosion on the origin square, mover color', () => {
  let s = newGame(cfg);
  s = applyMove(s, mv(s, 'e2', 'e4'));
  s = applyMove(s, mv(s, 'd7', 'd5'));
  s = applyMove(s, mv(s, 'e4', 'd5')); // pawn takes pawn
  expect(s.corrosions).toHaveLength(1);
  expect(s.corrosions[0]).toMatchObject({ color: 'w', cls: 1, cells: [fromAlg('e4', 8)], dir: 1 });
});

it('no spawn when tier1 disabled', () => {
  let s = newGame({ ...cfg, tier1: false });
  s = applyMove(s, mv(s, 'e2', 'e4'));
  s = applyMove(s, mv(s, 'd7', 'd5'));
  s = applyMove(s, mv(s, 'e4', 'd5'));
  expect(s.corrosions).toEqual([]);
});

it('capturing corrosion does not spawn corrosion', () => {
  let s = newGame(cfg);
  s.board = s.board.map(() => null);
  s.board[fromAlg('a1', 8)] = { color: 'w', type: 'k' };
  s.board[fromAlg('h8', 8)] = { color: 'b', type: 'k' };
  s.board[fromAlg('d4', 8)] = { color: 'w', type: 'r' };
  s.corrosions = [{ id: 1, color: 'b', cls: 1, cells: [fromAlg('d6', 8)], dir: -1, bornRound: 0 }];
  s = applyMove(s, mv(s, 'd4', 'd6'));
  expect(s.corrosions).toEqual([]);
});

it('fools mate produces checkmate result', () => {
  let s = newGame(cfg);
  s = applyMove(s, mv(s, 'f2', 'f3'));
  s = applyMove(s, mv(s, 'e7', 'e5'));
  s = applyMove(s, mv(s, 'g2', 'g4'));
  s = applyMove(s, mv(s, 'd8', 'h4'));
  expect(s.result).toEqual({ winner: 'b', reason: 'checkmate' });
});

it('round increments only after black moves', () => {
  let s = newGame(cfg);
  s = applyMove(s, mv(s, 'e2', 'e4'));
  expect(s.round).toBe(1);
  s = applyMove(s, mv(s, 'e7', 'e5'));
  expect(s.round).toBe(2);
});
```

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement `game.ts` + the empty `corrosionPhase` stub.**
- [ ] **Step 4: Run, verify PASS (full suite: `npx vitest run`).**
- [ ] **Step 5: Commit** — `git commit -am "feat: game orchestrator with corrosion spawning and game-end detection"`

---

### Task 6: Corrosion phase — march, strikes, annihilation, king block

**Files:**
- Modify: `src/engine/corrosion.ts` (replace stub)
- Test: `tests/corrosion.test.ts`

**Interfaces:**
- Consumes: everything prior.
- Produces: `corrosionPhase(s: GameState): void` — mutates `s`. Resolution order (deterministic, documented in code):

```
1. movers = units with bornRound < s.round
2. For each mover of cls 3: if next rank off-board, flip dir. Then paint every cell it
   currently occupies purple (addPurple, dedup) — it "leaves" them this phase.
3. Move: every mover's cells += dir * size. (cls 1/2 never step off-board: promotions in
   Task 7 fire on LANDING on the edge rank, so by induction they are never ON the edge
   heading outward. Until Task 7 lands, guard: cells that would leave the board are
   removed, unit dropped if empty.)
4. Swap annihilation: for every pair of units hostile to each other (colors differ, or
   either is cls 3) where some cell of A moved old→new and some cell of B moved
   new→old (exact swap), destroy both those cells.
5. Same-square annihilation: group surviving moved cells by square; if a square holds
   cells from two units hostile to each other, destroy ALL cells on that square.
6. Purple deaths: any cell of cls 1/2 standing on purple is destroyed (cls 3 immune).
7. Strikes: for each surviving mover cell, p = board[cell]:
   - p is a king (either color) → cell destroyed. log "Corrosion blocked by king".
   - cls 3 && p is any non-king piece → board[cell] = null; cell consumed. log.
   - cls 1/2 && p is enemy non-king piece → board[cell] = null; cell consumed.
     log "Corrosion destroys <piece> at <alg>".
   - cls 1/2 && p friendly → nothing (co-occupies).
8. Remove units with zero cells. (Promotions appended here by Task 7.)
```

Hostility helper: `hostile(a, b) = a.color !== b.color || a.cls === 3 || b.cls === 3`.

- [ ] **Step 1: Write failing tests** (`tests/corrosion.test.ts`)

```ts
import { it, expect } from 'vitest';
import { newGame } from '../src/engine/game';
import { corrosionPhase } from '../src/engine/corrosion';
import { fromAlg } from '../src/engine/board';
import type { GameState, CorrosionUnit } from '../src/engine/types';

const cfg = { tier1: true, tier2: true, tier3: true, bigBoard: false };
const base = (): GameState => {
  const s = newGame(cfg);
  s.board = s.board.map(() => null);
  s.board[fromAlg('a1', 8)] = { color: 'w', type: 'k' };
  s.board[fromAlg('h8', 8)] = { color: 'b', type: 'k' };
  s.round = 5;
  return s;
};
const unit = (o: Partial<CorrosionUnit>): CorrosionUnit =>
  ({ id: 99, color: 'w', cls: 1, cells: [], dir: 1, bornRound: 0, ...o });

it('marches one square toward enemy side', () => {
  const s = base();
  s.corrosions = [unit({ cells: [fromAlg('d4', 8)] })];
  corrosionPhase(s);
  expect(s.corrosions[0].cells).toEqual([fromAlg('d5', 8)]);
});

it('does not move in its born round', () => {
  const s = base();
  s.corrosions = [unit({ cells: [fromAlg('d4', 8)], bornRound: 5 })];
  corrosionPhase(s);
  expect(s.corrosions[0].cells).toEqual([fromAlg('d4', 8)]);
});

it('destroys enemy piece and is consumed', () => {
  const s = base();
  s.board[fromAlg('d5', 8)] = { color: 'b', type: 'n' };
  s.corrosions = [unit({ cells: [fromAlg('d4', 8)] })];
  corrosionPhase(s);
  expect(s.board[fromAlg('d5', 8)]).toBeNull();
  expect(s.corrosions).toEqual([]);
});

it('passes through friendly piece', () => {
  const s = base();
  s.board[fromAlg('d5', 8)] = { color: 'w', type: 'n' };
  s.corrosions = [unit({ cells: [fromAlg('d4', 8)] })];
  corrosionPhase(s);
  expect(s.board[fromAlg('d5', 8)]).toEqual({ color: 'w', type: 'n' });
  expect(s.corrosions[0].cells).toEqual([fromAlg('d5', 8)]);
  corrosionPhase(s);
  expect(s.corrosions[0].cells).toEqual([fromAlg('d6', 8)]);
});

it('king blocks: corrosion destroyed, king unharmed', () => {
  const s = base();
  s.corrosions = [unit({ color: 'b', dir: -1, cells: [fromAlg('h9'.replace('9','7') as any, 8)] })];
  s.corrosions[0].cells = [fromAlg('h7', 8)]; // marches down onto black... use white king square instead:
  s.corrosions = [unit({ color: 'b', dir: -1, cells: [fromAlg('a2', 8)] })];
  corrosionPhase(s);
  expect(s.board[fromAlg('a1', 8)]).toEqual({ color: 'w', type: 'k' });
  expect(s.corrosions).toEqual([]);
});

it('opposite colors annihilate on same square', () => {
  const s = base();
  s.corrosions = [
    unit({ id: 1, color: 'w', dir: 1, cells: [fromAlg('d4', 8)] }),
    unit({ id: 2, color: 'b', dir: -1, cells: [fromAlg('d6', 8)] }),
  ];
  corrosionPhase(s);
  expect(s.corrosions).toEqual([]);
});

it('opposite colors annihilate on swap', () => {
  const s = base();
  s.corrosions = [
    unit({ id: 1, color: 'w', dir: 1, cells: [fromAlg('d4', 8)] }),
    unit({ id: 2, color: 'b', dir: -1, cells: [fromAlg('d5', 8)] }),
  ];
  corrosionPhase(s);
  expect(s.corrosions).toEqual([]);
});

it('same color stacks and passes through', () => {
  const s = base();
  s.corrosions = [
    unit({ id: 1, color: 'w', cells: [fromAlg('d4', 8)] }),
    unit({ id: 2, color: 'w', cells: [fromAlg('d3', 8)], }),
  ];
  s.board[fromAlg('d5', 8)] = { color: 'w', type: 'b' }; // parks unit 1 via friendly? no — friendly doesn't stop it.
  s.corrosions[0].cells = [fromAlg('d4', 8)];
  corrosionPhase(s);
  expect(s.corrosions).toHaveLength(2); // both alive, one at d5, one at d4
});

it('non-class-3 corrosion dies entering purple', () => {
  const s = base();
  s.purple = [fromAlg('d5', 8)];
  s.corrosions = [unit({ cells: [fromAlg('d4', 8)] })];
  corrosionPhase(s);
  expect(s.corrosions).toEqual([]);
});

it('class 3 paints purple behind it, kills own-color piece, bounces at edge', () => {
  const s = base();
  s.board[fromAlg('d5', 8)] = { color: 'w', type: 'q' }; // own color — class 3 kills it
  s.corrosions = [unit({ cls: 3, color: 'w', dir: 1, cells: [fromAlg('d4', 8)] })];
  corrosionPhase(s);
  expect(s.purple).toContain(fromAlg('d4', 8));
  expect(s.board[fromAlg('d5', 8)]).toBeNull();
  expect(s.corrosions).toEqual([]); // consumed on strike
  // bounce: fresh unit at edge
  const s2 = base();
  s2.corrosions = [unit({ cls: 3, color: 'w', dir: 1, cells: [fromAlg('d8', 8)] })];
  corrosionPhase(s2);
  expect(s2.corrosions[0].dir).toBe(-1);
  expect(s2.corrosions[0].cells).toEqual([fromAlg('d7', 8)]);
  expect(s2.purple).toContain(fromAlg('d8', 8));
});
```

Fix the sloppy king-block test while implementing: it should simply place a black class-1 at a2 marching down onto the white king at a1 (delete the dead first lines).

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement `corrosionPhase` per the numbered resolution order.** Add `addPurple(s, sq)` (dedup) and log lines for every destruction event.
- [ ] **Step 4: Run full suite, verify PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat: corrosion phase - march, strikes, annihilation, king block, purple deaths"`

---

### Task 7: Class promotions (1→2, 2→3) and tier gating

**Files:**
- Modify: `src/engine/corrosion.ts`
- Test: `tests/promotion.test.ts`

**Interfaces:**
- Consumes: Task 6 resolution pipeline.
- Produces: extended `corrosionPhase`. Append after step 7 (strikes), before final cleanup:

```
8. Class-1 promotion: unit with cls===1 whose single cell landed on
   enemyEdgeRank(unit.color):
   - tier2 off → remove unit. log "Corrosion fizzles at the edge".
   - tier2 on → cls = 2, dir = -dir, cells = [edgeCell, edgeCell + dir*size]
     (dir already flipped: trail cell is one rank back toward enemy edge... concretely:
     for white unit at rank size-1: cells = [sq(f,size-1), sq(f,size-2)], dir = -1).
     log "Corrosion strengthens to class 2". The NEW trail cell must be resolved:
     run steps 5–7 for it (annihilation vs cells there, purple death, strike/king block).
9. Class-2 promotion: unit with cls===2 whose lead cell (the one furthest along dir)
   landed on ownerEdgeRank(unit.color):
   - tier3 off → remove unit. log.
   - tier3 on → cls = 3, cells = [that edge cell], dir = -dir.
     log "Corrosion goes CRITICAL (class 3)".
10. Degradation note: cls-2 unit reduced to one cell keeps cls 2 (still promotes at
    owner edge); nothing to implement beyond NOT special-casing it.
```

- [ ] **Step 1: Write failing tests** (`tests/promotion.test.ts`)

```ts
import { it, expect } from 'vitest';
import { newGame } from '../src/engine/game';
import { corrosionPhase } from '../src/engine/corrosion';
import { fromAlg } from '../src/engine/board';
import type { GameState, CorrosionUnit } from '../src/engine/types';

const mk = (tier2 = true, tier3 = true): GameState => {
  const s = newGame({ tier1: true, tier2, tier3, bigBoard: false });
  s.board = s.board.map(() => null);
  s.board[fromAlg('a1', 8)] = { color: 'w', type: 'k' };
  s.board[fromAlg('h8', 8)] = { color: 'b', type: 'k' };
  s.round = 5;
  return s;
};
const unit = (o: Partial<CorrosionUnit>): CorrosionUnit =>
  ({ id: 1, color: 'w', cls: 1, cells: [], dir: 1, bornRound: 0, ...o });

it('class 1 reaching enemy edge becomes class 2 pair heading home', () => {
  const s = mk();
  s.corrosions = [unit({ cells: [fromAlg('d7', 8)] })];
  corrosionPhase(s);
  const u = s.corrosions[0];
  expect(u.cls).toBe(2);
  expect(u.dir).toBe(-1);
  expect(u.cells.sort((a, b) => a - b)).toEqual([fromAlg('d7', 8), fromAlg('d8', 8)]);
});

it('tier2 disabled: class 1 fizzles at edge', () => {
  const s = mk(false);
  s.corrosions = [unit({ cells: [fromAlg('d7', 8)] })];
  corrosionPhase(s);
  expect(s.corrosions).toEqual([]);
});

it('class 2 pair marches as a pair', () => {
  const s = mk();
  s.corrosions = [unit({ cls: 2, dir: -1, cells: [fromAlg('d8', 8), fromAlg('d7', 8)] })];
  corrosionPhase(s);
  expect(s.corrosions[0].cells.sort((a, b) => a - b)).toEqual([fromAlg('d6', 8), fromAlg('d7', 8)]);
});

it('class 2 trail cell strikes piece on spawn square', () => {
  const s = mk();
  s.board[fromAlg('d7', 8)] = { color: 'b', type: 'n' };
  s.corrosions = [unit({ cells: [fromAlg('d7', 8)] })];
  // white class1 at d7 would need d7 empty to be there; move it: start at d6, piece at d7? then strike happens first.
  // Correct scenario: class1 lands on d8 (edge) while enemy piece sits on d7 → trail cell strikes it.
  s.board[fromAlg('d7', 8)] = null;
  s.corrosions = [unit({ cells: [fromAlg('d7', 8)] })];
  s.board[fromAlg('d7', 8)] = { color: 'b', type: 'n' }; // co-occupied: corrosion passed onto piece square? Not possible for enemy — simplify:
  // FINAL scenario (use this, delete the above churn when writing the real test):
  const s2 = mk();
  s2.corrosions = [unit({ cells: [fromAlg('d7', 8)] })];
  s2.board[fromAlg('d7', 8)] = null;
  corrosionPhase(s2); // lands d8, promotes, trail at d7 (empty) — fine
  const s3 = mk();
  s3.board[fromAlg('d7', 8)] = { color: 'b', type: 'n' };
  s3.corrosions = [unit({ cells: [fromAlg('d6', 8)] })];
  corrosionPhase(s3); // moves d6→d7, strikes knight, consumed — never promotes
  expect(s3.board[fromAlg('d7', 8)]).toBeNull();
  expect(s3.corrosions).toEqual([]);
});

it('class 2 reaching owner edge becomes class 3', () => {
  const s = mk();
  s.corrosions = [unit({ cls: 2, dir: -1, cells: [fromAlg('d2', 8), fromAlg('d3', 8)] })];
  corrosionPhase(s);
  const u = s.corrosions[0];
  expect(u.cls).toBe(3);
  expect(u.dir).toBe(1);
  expect(u.cells).toEqual([fromAlg('d1', 8)]);
});

it('tier3 disabled: class 2 removed at owner edge', () => {
  const s = mk(true, false);
  s.corrosions = [unit({ cls: 2, dir: -1, cells: [fromAlg('d2', 8), fromAlg('d3', 8)] })];
  corrosionPhase(s);
  expect(s.corrosions).toEqual([]);
});

it('degraded single-cell class 2 still promotes to class 3 at owner edge', () => {
  const s = mk();
  s.corrosions = [unit({ cls: 2, dir: -1, cells: [fromAlg('d2', 8)] })];
  corrosionPhase(s);
  expect(s.corrosions[0].cls).toBe(3);
});

it('12x12: promotions use true board edges', () => {
  const s = newGame({ tier1: true, tier2: true, tier3: true, bigBoard: true });
  s.board = s.board.map(() => null);
  s.board[fromAlg('a1', 12)] = { color: 'w', type: 'k' };
  s.board[fromAlg('l12', 12)] = { color: 'b', type: 'k' };
  s.round = 5;
  s.corrosions = [unit({ cells: [fromAlg('f11', 12)] })];
  corrosionPhase(s);
  expect(s.corrosions[0].cls).toBe(2);
  expect(s.corrosions[0].cells.sort((a, b) => a - b)).toEqual([fromAlg('f11', 12), fromAlg('f12', 12)]);
});
```

Clean the churny fourth test when writing it for real — keep only the s3 scenario plus one asserting a class-2 trail cell created on promotion strikes an enemy piece standing one rank behind the edge:

```ts
it('promotion trail cell strikes enemy piece behind the edge', () => {
  const s = mk();
  s.board[fromAlg('d7', 8)] = { color: 'b', type: 'n' };
  s.corrosions = [unit({ cells: [fromAlg('d7', 8)] })];
  // cell co-occupies d7 with enemy? impossible in play; instead place unit at d6 with d7 EMPTY and knight on d8:
  // knight on edge square d8: unit moves d6→d7, next phase d7→d8 strikes knight, consumed. Promotion only on landing empty edge.
});
```

If constructing the trail-strike scenario proves impossible through legal play (enemy piece must sit on the trail square at the instant of promotion — possible: enemy knight on d7 while corrosion passes it as… corrosion strikes enemy on entry, so enemy can never be co-occupied), then the trail cell can only collide with corrosion cells or purple. Test THAT instead: enemy corrosion cell sitting on d7 at promotion time annihilates the new trail cell, leaving a single-cell class 2. Delete the impossible scenario.

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement steps 8–9 in `corrosionPhase`.**
- [ ] **Step 4: Run full suite, verify PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat: corrosion class promotions with tier gating"`

---

### Task 8: Determinism and serialization

**Files:**
- Test: `tests/serialize.test.ts`

**Interfaces:**
- Consumes: full engine.
- Produces: proof that `GameState` survives `JSON.parse(JSON.stringify(s))` and that replaying a move list yields identical states — multiplayer depends on both.

- [ ] **Step 1: Write tests**

```ts
import { it, expect } from 'vitest';
import { newGame, applyMove } from '../src/engine/game';
import { legalMoves } from '../src/engine/legal';

const cfg = { tier1: true, tier2: true, tier3: true, bigBoard: true };

it('JSON round-trip preserves state and remains playable', () => {
  let s = newGame(cfg);
  const revived = JSON.parse(JSON.stringify(s));
  expect(revived).toEqual(s);
  expect(() => applyMove(revived, legalMoves(revived)[0])).not.toThrow();
});

it('replay determinism: same moves → same state (150 plies of first-legal-move)', () => {
  const play = () => {
    let s = newGame(cfg);
    const moves = [];
    for (let i = 0; i < 150 && !s.result; i++) {
      const ms = legalMoves(s);
      const m = ms[i % ms.length];   // deterministic pseudo-variety
      moves.push(m);
      s = applyMove(s, m);
    }
    return { s, moves };
  };
  const a = play();
  let b = newGame(cfg);
  for (const m of a.moves) b = applyMove(b, m);
  expect(JSON.stringify(b)).toBe(JSON.stringify(a.s));
});
```

- [ ] **Step 2: Run, verify PASS (this is a property test of existing code — failures are engine bugs; fix them).**
- [ ] **Step 3: Commit** — `git commit -am "test: serialization round-trip and replay determinism"`

---

### Task 9: Board rendering spike — chessgroundx behind BoardView

**Files:**
- Create: `src/ui/boardview.ts`, `src/ui/cgboard.ts`
- Modify: `src/main.ts`, `src/style.css`, `index.html`

**Interfaces:**
- Produces:

```ts
// boardview.ts
export interface BoardView {
  mount(el: HTMLElement): void;
  setState(gs: GameState, dests: Map<number, number[]>): void; // dests = legal targets per from-square for the side to move
  onMove(cb: (from: number, to: number) => void): void;
  setOrientation(c: Color): void;
  squareEl(): { boardPx: () => DOMRect; squarePx: (sq: number) => { x: number; y: number; w: number } };
  // geometry hook the overlay layer (Task 10) uses to position corrosion markers
}
export function createBoardView(size: number): BoardView; // picks cgboard (or customboard fallback)
```

- [ ] **Step 1: Read chessgroundx docs.** `node_modules/chessgroundx/README.md` plus the `Config` type in `node_modules/chessgroundx/dist/config.d.ts` — confirm: `dimensions: {width, height}` support, FEN handling for 12-rank boards (multi-digit empties), `movable.dests` keyed by square name, piece-set CSS assets shipped in the package (`assets/` dir). Also check key naming for files beyond `h` (chessgroundx uses letters up to `p` for wide boards — confirm `a`–`l` works and whether ranks >9 use `a10` style keys or the `:`-prefixed convention; adapt `toAlg`-to-key mapping in `cgboard.ts` accordingly, keeping the engine's own `toAlg` unchanged).
- [ ] **Step 2: Implement `cgboard.ts`:** instantiate chessgroundx with fen generated from `GameState` (write `stateToFen(gs)` inside `cgboard.ts` — standard FEN piece letters, numbers for gaps, multi-digit allowed, ranks from top), `movable: { free: false, dests, color: gs.turn === 'w' ? 'white' : 'black', events: { after: cb } }`, `dimensions: { width: gs.size, height: gs.size }`. Import the package CSS (`chessgroundx/assets/chessground.base.css` + a board theme + a piece set css) in `main.ts`.
- [ ] **Step 3: Wire a temporary demo in `main.ts`:** hotseat loop — `newGame`, render, on move → `applyMove` → re-render. Both board sizes reachable via `?big=1` query param.
- [ ] **Step 4: Verify in browser:** `npm run dev`, load `/` and `/?big=1`. Acceptance: 8x8 and 12x12 both render with correctly placed pieces; legal moves enforced (illegal drags snap back); a capture works.
- [ ] **Step 5 (only if chessgroundx fails 12x12 after honest effort — e.g. broken keys/FEN beyond 8 ranks):** implement `src/ui/customboard.ts`: CSS grid of `size × size` divs, piece SVGs from chessgroundx's cburnett asset css (or unicode glyphs as last resort), click-source-then-click-target move input, selected-square + legal-dest highlighting. Same `BoardView` interface; `createBoardView` returns it. Record the decision in the plan file under this task.
- [ ] **Step 6: Commit** — `git commit -am "feat: board rendering via chessgroundx behind BoardView interface"`

---

### Task 10: Corrosion + purple overlay layer

**Files:**
- Create: `src/ui/overlays.ts`
- Modify: `src/main.ts`, `src/style.css`

**Interfaces:**
- Consumes: `BoardView.squareEl()` geometry; `GameState.corrosions`, `.purple`.
- Produces: `renderOverlays(container: HTMLElement, view: BoardView, gs: GameState): void` — clears and redraws an absolutely-positioned, `pointer-events: none` div layered over the board.

Visual spec:
- Class 1/2 white corrosion: translucent pale green (`rgba(190, 255, 190, 0.55)`) with a dark border; black corrosion: translucent dark green (`rgba(20, 90, 20, 0.55)`).
- Class 2 cells additionally show badge "2"; class 3 cell: translucent red (`rgba(255, 40, 40, 0.6)`), badge "3".
- Stacks (multiple same-color cells on one square): count badge "×N".
- Purple squares: solid purple tint (`rgba(128, 0, 160, 0.8)`) with a ☠ glyph.
- Badges: small corner label, monospace, readable on both board colors.

- [ ] **Step 1: Implement `overlays.ts`** — group `flatMap` of all unit cells by square, compute per-square visual (annihilation rules guarantee only same-color stacking, but code defensively: mixed → render both halves). Position via `squarePx`.
- [ ] **Step 2: Wire into the demo loop; add a debug button "force corrosion phase" (dev only) to eyeball marching without playing 20 moves.** Manually verify: spawn via capture shows overlay; marching updates; purple renders after a class-3 walk (use the debug button plus a hand-built state in `main.ts` dev block).
- [ ] **Step 3: Remove/gate the debug button behind `import.meta.env.DEV`.**
- [ ] **Step 4: Commit** — `git commit -am "feat: corrosion and purple square overlay rendering"`

---

### Task 11: Setup screen, HUD, hotseat game flow

**Files:**
- Create: `src/ui/setup.ts`, `src/ui/hud.ts`
- Modify: `src/main.ts`, `src/style.css`, `index.html`

**Interfaces:**
- Consumes: engine + BoardView + overlays.
- Produces:

```ts
// setup.ts
export interface SetupResult { config: Config; mode: 'hotseat' | 'host' | 'join'; joinId?: string }
export function showSetup(onStart: (r: SetupResult) => void): void;
export function encodeConfig(c: Config): string;  // e.g. "t123b" style compact token
export function decodeConfig(s: string): Config;
// hud.ts
export function renderHud(el: HTMLElement, gs: GameState, opts: { youAre?: Color }): void;
// turn indicator ("White to move" / "You" / "Opponent"), last 8 log events, result banner
export function pickPromotion(color: Color): Promise<PieceType>; // modal with q/r/b/n buttons
```

Setup screen contents: title; checkboxes Tier 1 / Tier 2 / Tier 3 (tier N disabled+unchecked unless tier N-1 checked — enforce in change handlers), checkbox "Enlarged board (12x12)"; buttons: "Play hotseat", "Create online game"; joining is automatic when URL contains `#join=`.

Game flow in `main.ts`:
- Parse `location.hash`; `#join=<id>&cfg=<token>` → join mode (Task 12), else show setup.
- Hotseat: single board, orientation flips are NOT needed (shared screen, white at bottom); on move needing promotion, await `pickPromotion`.
- On `gs.result`: banner with reason + "New game" button (back to setup).

- [ ] **Step 1: Implement setup + hud + promotion picker.**
- [ ] **Step 2: Write config token tests** (`tests/setup.test.ts` — encode/decode round-trip for all 16 combos; import from `src/ui/setup.ts` is fine, it has no DOM at module top level — keep DOM work inside functions).

```ts
import { it, expect } from 'vitest';
import { encodeConfig, decodeConfig } from '../src/ui/setup';

it('config token round-trips all combinations', () => {
  for (let i = 0; i < 16; i++) {
    const c = { tier1: !!(i & 1), tier2: !!(i & 2), tier3: !!(i & 4), bigBoard: !!(i & 8) };
    expect(decodeConfig(encodeConfig(c))).toEqual(c);
  }
});
```

- [ ] **Step 3: Run tests, verify PASS. Manual browser pass: full hotseat game on both sizes, tier toggles honored (tier1 off → no corrosion ever), promotion picker works, checkmate banner shows.**
- [ ] **Step 4: Commit** — `git commit -am "feat: setup screen, HUD, promotion picker, hotseat flow"`

---

### Task 12: Online play via PeerJS

**Files:**
- Create: `src/net/peer.ts`
- Modify: `src/main.ts`, `src/ui/hud.ts`

**Interfaces:**
- Produces:

```ts
export type NetMsg =
  | { type: 'init'; config: Config; state: GameState; yourColor: Color }
  | { type: 'move'; seq: number; move: Move }
  | { type: 'resync-request' }
  | { type: 'resync'; seq: number; state: GameState };
export interface Session {
  send(m: NetMsg): void;
  onMessage(cb: (m: NetMsg) => void): void;
  onStatus(cb: (s: 'connecting' | 'open' | 'closed') => void): void;
}
export function host(onReady: (id: string) => void, onConn: (s: Session) => void): void;
export function join(id: string, onConn: (s: Session) => void): void;
```

Protocol (host = White, guest = Black — keep it simple v1):
- Host clicks "Create online game" → `host()` → on ready, show share URL `${location.origin}${location.pathname}#join=<peerId>&cfg=<token>` with copy button, "waiting for opponent…".
- Guest opens URL → `join()` → host receives connection, sends `init`.
- Each local move: apply locally, `send({type:'move', seq})`; `seq` = ply count. Receiver: if `seq` is the expected next ply, `applyMove`; else `send({type:'resync-request'})`; host answers with full state.
- Board orientation: each player sees own color at bottom (`setOrientation`).
- Input gating: only allow drags when `gs.turn === yourColor` and connection open.
- Disconnect: status banner "Opponent disconnected — waiting…" (PeerJS `close`/`error` events); host keeps state; guest may reload URL to rejoin (host re-sends `init` with current state on new connection).

- [ ] **Step 1: Implement `peer.ts` + wire host/join flows into `main.ts` and hud status line.**
- [ ] **Step 2: Manual verification — two browser windows (normal + incognito):** create game in one, open URL in other; play several moves incl. a capture (corrosion visible on both); kill guest window, rejoin via URL, state restored; confirm big-board + tier config carried via URL.
- [ ] **Step 3: Commit** — `git commit -am "feat: online play over PeerJS with URL join and resync"`

---

### Task 13: Polish, README, final verification

**Files:**
- Create: `README.md`
- Modify: `src/style.css`, any rough edges found

- [ ] **Step 1: Styling pass** — dark page background, centered board, clean sidebar (HUD + log), setup screen presentable. No framework; ~100 lines CSS.
- [ ] **Step 2: `README.md`** — what it is, Theo's rules summarized (link the spec), `npm install`, `npm run dev`, how to play hotseat, how to host/join online, config toggles, license notes (chessgroundx GPL-3.0 → project GPL-3.0; add LICENSE file).
- [ ] **Step 3: Full verification** — `npx vitest run` all green; `npm run build` clean; one full hotseat game 8x8; one big-board game reaching at least class 2 corrosion (use dev debug button for a class-3/purple spot check); one online game across two windows.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: polish, README, GPL license"`

---

## Self-Review Notes (completed)

- Spec coverage: spawn/march/strike/pass-through (T5/T6), annihilation+swap (T6), stacking annotation (T10), piece-captures-corrosion incl. king-free + suicide legality (T4), king block (T6), class 1→2 with reversal + endmost-squares split (T7), lone-cell degradation (T7), class 2→3 collapse + bounce + purple trail + affects-everyone (T6/T7), purple blocking/knight-jump/king-cleanse (T3/T4), tier toggles (T5/T7/T11), 12x12 centered + true-edge promotion (T2/T7), corrosion-induced check handled by result calc after phase (T5), hotseat (T11), URL multiplayer + resync (T12), determinism for sync (T8).
- Known intentional simplification: king landing on purple cleanses immediately (spec's "neutralized while standing" is behaviorally identical given corrosion dies on king contact anyway).
- Type consistency: `CorrosionUnit.cls`/`cells`/`dir`/`bornRound`, `legalMoves(s, from?)`, `applyMoveCore` naming used consistently across tasks.
