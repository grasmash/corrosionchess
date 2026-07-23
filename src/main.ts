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
import { renderOverlays } from './ui/overlays';
import { newGame, applyMove } from './engine/game';
import { legalMoves } from './engine/legal';
import { corrosionPhase } from './engine/corrosion';
import { sq, offsetOf, forwardDir } from './engine/board';
import type { GameState, Move } from './engine/types';

// --- Temporary hotseat demo (Task 9 spike). Task 11 replaces this with the
// real UI shell, move history, and a proper promotion picker. ---

const params = new URLSearchParams(window.location.search);
const bigBoard = params.get('big') === '1';
// Tiers default ON for this demo so captures actually spawn corrosion to look
// at (Task 10 needs that to verify overlay rendering against real play);
// ?tier1=0 / ?tier2=0 / ?tier3=0 opt back out.
const tier1 = params.get('tier1') !== '0';
const tier2 = params.get('tier2') !== '0';
const tier3 = params.get('tier3') !== '0';

let state: GameState = newGame({ tier1, tier2, tier3, bigBoard });

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
  renderOverlays(boardEl, view, state);
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

// --- Task 10 dev-only tools: eyeball corrosion overlay rendering (marching,
// stacking, class-3/purple) without having to play through ~20 real moves to
// get corrosion on the board. Dead-code-eliminated from production builds
// because Vite inlines `import.meta.env.DEV` as a literal `false` there. ---
if (import.meta.env.DEV) {
  // A hand-built dev scenario dropped onto the *current* board/kings (so
  // legalMoves/check keep working) rather than a whole synthetic GameState:
  // one white cls-1 unit, a same-square white cls-1 stack (×2 badge), a
  // black cls-2 unit (lead + trail cell), and a white cls-3 unit (paints
  // purple under itself every phase it survives -- see corrosion.ts step 2).
  const buildDevCorrosionState = (base: GameState): GameState => {
    const s = structuredClone(base);
    const size = s.size;
    const off = offsetOf(size);
    const emptyRank = off + 2; // first empty rank in front of white's pawns

    const stackSq = sq(off + 1, emptyRank, size);
    const trailLeadSq = sq(off + 3, emptyRank, size);
    const cls3Sq = sq(off + 5, emptyRank, size);

    s.corrosions = [
      { id: 901, color: 'w', cls: 1, cells: [stackSq], dir: forwardDir('w'), bornRound: 0 },
      { id: 902, color: 'w', cls: 1, cells: [stackSq], dir: forwardDir('w'), bornRound: 0 },
      {
        id: 903,
        color: 'b',
        cls: 2,
        cells: [trailLeadSq, trailLeadSq - forwardDir('b') * size],
        dir: forwardDir('b'),
        bornRound: 0,
      },
      { id: 904, color: 'w', cls: 3, cells: [cls3Sq], dir: forwardDir('w'), bornRound: 0 },
    ];
    s.purple = [];
    s.nextId = 1000;
    return s;
  };

  const devTools = document.createElement('div');
  devTools.id = 'dev-tools';

  const seedBtn = document.createElement('button');
  seedBtn.textContent = 'Load corrosion dev scenario';
  seedBtn.onclick = () => {
    state = buildDevCorrosionState(state);
    render();
  };

  const phaseBtn = document.createElement('button');
  phaseBtn.textContent = 'Force corrosion phase';
  phaseBtn.onclick = () => {
    const next = structuredClone(state);
    corrosionPhase(next);
    next.round++;
    state = next;
    render();
  };

  devTools.append(seedBtn, phaseBtn);
  appEl.appendChild(devTools);
}
