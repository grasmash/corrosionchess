import 'chessgroundx/assets/chessground.base.css';
import 'chessgroundx/assets/chessground.brown.css';
// NOTE: chessgroundx's own assets/chessground.cburnett.css ships with piece
// selectors that don't match the classes its runtime actually emits (see
// src/ui/pieces-cburnett.css for details) -- using our locally-corrected copy
// instead so piece art renders.
import './ui/pieces-cburnett.css';
import './style.css';

import { createBoardView } from './ui/boardview';
import type { CgBoardView } from './ui/cgboard';
import { newGame, applyMove } from './engine/game';
import { legalMoves } from './engine/legal';
import type { GameState, Move } from './engine/types';

// --- Temporary hotseat demo (Task 9 spike). Task 11 replaces this with the
// real UI shell, move history, and a proper promotion picker. ---

const params = new URLSearchParams(window.location.search);
const bigBoard = params.get('big') === '1';

let state: GameState = newGame({ tier1: false, tier2: false, tier3: false, bigBoard });

const appEl = document.querySelector<HTMLDivElement>('#app')!;
appEl.innerHTML = '<div class="board-wrap" id="board"></div><div id="status"></div>';

const boardEl = document.getElementById('board')!;
const statusEl = document.getElementById('status')!;

const view = createBoardView(state.size);
view.mount(boardEl);

function computeDests(gs: GameState): Map<number, number[]> {
  const dests = new Map<number, number[]>();
  if (gs.result) return dests;
  for (const m of legalMoves(gs)) {
    const arr = dests.get(m.from);
    if (arr) arr.push(m.to);
    else dests.set(m.from, [m.to]);
  }
  return dests;
}

function statusText(gs: GameState): string {
  if (gs.result) {
    const { winner, reason } = gs.result;
    return winner ? `${winner === 'w' ? 'White' : 'Black'} wins by ${reason}` : `Draw by ${reason}`;
  }
  return `${gs.turn === 'w' ? 'White' : 'Black'} to move`;
}

function render(): void {
  view.setState(state, computeDests(state));
  statusEl.textContent = statusText(state);
}

view.onMove((from, to) => {
  if (state.result) return;
  const candidates = legalMoves(state, from).filter(m => m.to === to);
  if (candidates.length === 0) return; // shouldn't happen: cg only offers dests we gave it
  // Auto-queen: Task 11 adds a real promotion picker; for this demo, any move
  // that legal.ts emits with a `promotion` field is played as a queen promotion.
  const promotes = candidates.some(m => m.promotion);
  const move: Move = promotes ? { from, to, promotion: 'q' } : { from, to };
  state = applyMove(state, move);
  render();
});

render();

// Expose the raw chessgroundx Api for the Task 9 acceptance-check / manual
// verification only (e.g. `window.__cg.selectSquare('e2'); window.__cg.selectSquare('e4');`
// drives a move through the same click-to-move pipeline a real click would).
// Not part of the BoardView contract.
(window as unknown as { __cg: ReturnType<CgBoardView['api']> }).__cg = (view as unknown as CgBoardView).api();
