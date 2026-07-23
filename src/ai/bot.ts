import type { Color, CorrosionUnit, GameState, Move, PieceType } from '../engine/types';
import { fileOf, rankOf, sq, inBounds } from '../engine/board';
import { legalMoves } from '../engine/legal';
import { applyMove, other } from '../engine/game';
import { pseudoMoves } from '../engine/movegen';

export type BotLevel = 1 | 2 | 3;

const PIECE_VALUES: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// A hostile-corrosion-cell march is fatal to non-king pieces, so a square in
// its path is heavily discounted rather than fully written off -- the piece
// might still move away before the phase resolves.
const CORROSION_THREAT_SURVIVAL = 0.4; // i.e. a 60% penalty

const MOBILITY_CAP = 40;
const MOBILITY_WEIGHT = 0.01;
const PURPLE_KING_WEIGHT = 3;

const WIN_SCORE = 100_000;
const SEARCH_TIME_BUDGET_MS = 1500;

const KING_DELTAS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

function pickRandom<T>(items: T[], rng: () => number): T {
  const idx = Math.min(Math.floor(rng() * items.length), items.length - 1);
  return items[idx];
}

function findKingSquare(state: GameState, color: Color): number {
  for (let i = 0; i < state.board.length; i++) {
    const p = state.board[i];
    if (p && p.color === color && p.type === 'k') return i;
  }
  return -1;
}

// Squares a corrosion cell will occupy after its next march (cell + dir *
// size keeps the file fixed and shifts the rank by one). This mirrors the
// engine's own step-3 march math but does not attempt to replicate the full
// corrosionPhase (bounce-at-edge, promotion, annihilation, etc.) -- it's a
// cheap one-ply lookahead used purely to steer the bot's evaluation, not a
// ground truth simulation.
function threatenedSquares(state: GameState): Map<number, CorrosionUnit[]> {
  const map = new Map<number, CorrosionUnit[]>();
  const total = state.size * state.size;
  for (const unit of state.corrosions) {
    for (const cell of unit.cells) {
      const target = cell + unit.dir * state.size;
      if (target < 0 || target >= total) continue;
      const existing = map.get(target);
      if (existing) existing.push(unit);
      else map.set(target, [unit]);
    }
  }
  return map;
}

function corrosionHits(unit: CorrosionUnit, pieceColor: Color): boolean {
  return unit.cls === 3 || unit.color !== pieceColor;
}

function weightedMaterial(state: GameState, color: Color, threats: Map<number, CorrosionUnit[]>): number {
  let total = 0;
  for (let i = 0; i < state.board.length; i++) {
    const p = state.board[i];
    if (!p || p.color !== color) continue;
    let value = PIECE_VALUES[p.type];
    if (p.type !== 'k') {
      const units = threats.get(i);
      if (units && units.some(u => corrosionHits(u, color))) {
        value *= CORROSION_THREAT_SURVIVAL;
      }
    }
    total += value;
  }
  return total;
}

function mobilityCount(state: GameState, color: Color): number {
  let count = 0;
  for (let i = 0; i < state.board.length; i++) {
    const p = state.board[i];
    if (p && p.color === color) count += pseudoMoves(state, i).length;
  }
  return count;
}

function kingPurplePenalty(state: GameState, color: Color): number {
  const kingSq = findKingSquare(state, color);
  if (kingSq === -1) return 0;
  const size = state.size;
  const f0 = fileOf(kingSq, size);
  const r0 = rankOf(kingSq, size);
  let count = 0;
  for (const [df, dr] of KING_DELTAS) {
    const f = f0 + df;
    const r = r0 + dr;
    if (!inBounds(f, r, size)) continue;
    if (state.purple.includes(sq(f, r, size))) count++;
  }
  return count;
}

/**
 * Static evaluation of `state` from `forColor`'s perspective. Higher is
 * better for `forColor`. Combines: material (promotion-adjusted, since the
 * board already holds the post-promotion piece type), a penalty for pieces
 * sitting on squares a hostile-or-class-3 corrosion cell will reach next
 * phase, a small mobility term, and a small penalty for a king boxed in by
 * purple squares.
 */
export function evaluate(state: GameState, forColor: Color): number {
  const enemyColor = other(forColor);
  const threats = threatenedSquares(state);

  let score = weightedMaterial(state, forColor, threats) - weightedMaterial(state, enemyColor, threats);

  const forMobility = Math.min(mobilityCount(state, forColor), MOBILITY_CAP);
  const enemyMobility = Math.min(mobilityCount(state, enemyColor), MOBILITY_CAP);
  score += (forMobility - enemyMobility) * MOBILITY_WEIGHT;

  score -= kingPurplePenalty(state, forColor) * PURPLE_KING_WEIGHT;
  score += kingPurplePenalty(state, enemyColor) * PURPLE_KING_WEIGHT;

  return score;
}

function terminalScore(state: GameState, forColor: Color): number {
  if (!state.result) return 0;
  if (state.result.winner === forColor) return WIN_SCORE;
  if (state.result.winner === null) return 0;
  return -WIN_SCORE;
}

function scoreState(state: GameState, forColor: Color): number {
  return state.result ? terminalScore(state, forColor) : evaluate(state, forColor);
}

function moveOrderKey(state: GameState, m: Move): number {
  let key = 0;
  const dest = state.board[m.to];
  if (dest) key += 10 + PIECE_VALUES[dest.type];
  if (m.promotion) key += 8;
  return key;
}

function orderMoves(state: GameState, moves: Move[]): Move[] {
  return [...moves].sort((a, b) => moveOrderKey(state, b) - moveOrderKey(state, a));
}

function chooseRandom(moves: Move[], rng: () => number): Move {
  return pickRandom(moves, rng);
}

function chooseGreedy(state: GameState, moves: Move[], rng: () => number): Move {
  const botColor = state.turn;
  let bestScore = -Infinity;
  let best: Move[] = [];
  for (const m of moves) {
    const next = applyMove(state, m);
    const score = scoreState(next, botColor);
    if (score > bestScore) {
      bestScore = score;
      best = [m];
    } else if (score === bestScore) {
      best.push(m);
    }
  }
  return pickRandom(best, rng);
}

// Worst-case (for the bot) score across the opponent's replies to `state`,
// with alpha-beta pruning against the best score the bot has already locked
// in for a different candidate move at the top level.
function worstCaseReply(state: GameState, botColor: Color, alpha: number, deadline: number): number {
  const replies = orderMoves(state, legalMoves(state));
  let worst = Infinity;
  let evaluatedAny = false;
  for (const reply of replies) {
    if (evaluatedAny && Date.now() >= deadline) break;
    const afterOpp = applyMove(state, reply);
    const score = scoreState(afterOpp, botColor);
    evaluatedAny = true;
    if (score < worst) worst = score;
    if (worst <= alpha) break; // this move already can't beat the current best
  }
  // If we couldn't even evaluate one reply before running out of time, fall
  // back to the static evaluation of `state` itself.
  return evaluatedAny ? worst : evaluate(state, botColor);
}

// Depth-2 alpha-beta search: the bot's own move, then the opponent's best
// reply. applyMove() only runs the real corrosion phase when the mover is
// Black, so exactly one of the two plies searched here reflects an actual
// march (with swaps, strikes, and promotions already resolved) -- the other
// ply's state still holds un-marched corrosions, and it's there that
// evaluate()'s one-ply threat-lookahead term (see threatenedSquares) is
// doing real work instead of being redundant with the engine. Concretely:
// if the bot is White, its own move (ply 1) leaves corrosions un-marched
// (the lookahead matters) and Black's reply (ply 2) marches them for real;
// if the bot is Black, its own move (ply 1) marches them for real and
// White's reply (ply 2) is the un-marched ply where the lookahead matters.
function chooseAlphaBeta(state: GameState, moves: Move[], rng: () => number, timeBudgetMs: number): Move {
  const botColor = state.turn;
  const deadline = Date.now() + timeBudgetMs;
  const ordered = orderMoves(state, moves);

  let bestScore = -Infinity;
  let best: Move[] = [];
  let alpha = -Infinity;

  for (const m of ordered) {
    if (best.length > 0 && Date.now() >= deadline) break;
    const afterOwn = applyMove(state, m);
    const score = afterOwn.result
      ? terminalScore(afterOwn, botColor)
      : worstCaseReply(afterOwn, botColor, alpha, deadline);
    if (score > bestScore) {
      bestScore = score;
      best = [m];
      alpha = bestScore;
    } else if (score === bestScore) {
      best.push(m);
    }
  }
  return pickRandom(best, rng);
}

export interface ChooseBotMoveOptions {
  /** Soft time budget (ms) for level 3's search. Defaults to 1500. */
  timeBudgetMs?: number;
}

/**
 * Choose a move for the bot at the given difficulty level.
 * - Level 1 "Rusty": uniform random legal move.
 * - Level 2 "Corrode": greedy 1-ply evaluation.
 * - Level 3 "Meltdown": depth-2 alpha-beta (own move + opponent's best
 *   reply) with capture/promotion move ordering and a soft time budget
 *   (`opts.timeBudgetMs`, default 1500; ignored by levels 1-2).
 *
 * `rng` is injectable (defaults to Math.random) so callers can get
 * deterministic behavior for tests/replays. Throws if the game is already
 * over; never returns a move that isn't in legalMoves(state).
 */
export function chooseBotMove(
  state: GameState,
  level: BotLevel,
  rng: () => number = Math.random,
  opts?: ChooseBotMoveOptions,
): Move {
  if (state.result) throw new Error('Cannot choose a bot move: game is already over');
  const moves = legalMoves(state);
  if (moves.length === 0) throw new Error('Cannot choose a bot move: no legal moves available');

  switch (level) {
    case 1: return chooseRandom(moves, rng);
    case 2: return chooseGreedy(state, moves, rng);
    case 3: return chooseAlphaBeta(state, moves, rng, opts?.timeBudgetMs ?? SEARCH_TIME_BUDGET_MS);
  }
}
