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
import { showSetup } from './ui/setup';
import type { SetupResult } from './ui/setup';
import { renderHud, pickPromotion } from './ui/hud';
import { newGame, applyMove } from './engine/game';
import { legalMoves } from './engine/legal';
import { corrosionPhase } from './engine/corrosion';
import { sq, offsetOf, forwardDir } from './engine/board';
import type { GameState, Move } from './engine/types';

const appEl = document.querySelector<HTMLDivElement>('#app')!;

function computeDests(gs: GameState): Map<number, number[]> {
  const dests = new Map<number, number[]>();
  if (gs.result) return dests;
  for (const m of legalMoves(gs)) {
    const arr = dests.get(m.from);
    if (arr) {
      // A promotion square offers 4 legal moves (one per promotable piece)
      // that share the same from/to -- dedupe so chessgroundx only sees one
      // destination per square instead of 4 identical entries.
      if (!arr.includes(m.to)) arr.push(m.to);
    } else {
      dests.set(m.from, [m.to]);
    }
  }
  return dests;
}

/** Top-level router: `#join=<id>` (Task 12 stub) vs. the setup screen. */
function start(): void {
  const hash = window.location.hash.replace(/^#/, '');
  const hashParams = new URLSearchParams(hash);
  const joinId = hashParams.get('join');

  if (joinId) {
    showJoinPlaceholder(joinId);
    return;
  }

  showSetup(result => startGame(result));
}

function showJoinPlaceholder(joinId: string): void {
  appEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'join-placeholder';

  const title = document.createElement('h1');
  title.textContent = 'Corrosion Chess';
  wrap.appendChild(title);

  const msg = document.createElement('p');
  msg.textContent = `Joining game "${joinId}" -- multiplayer arrives in Task 12.`;
  wrap.appendChild(msg);

  const backBtn = document.createElement('button');
  backBtn.textContent = 'Back to setup';
  backBtn.onclick = () => {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    start();
  };
  wrap.appendChild(backBtn);

  appEl.appendChild(wrap);
}

function startGame(setup: SetupResult): void {
  // Only 'hotseat' is reachable today: the setup screen's online button is
  // disabled (Task 12 wires 'host'), and 'join' is intercepted by start()
  // before showSetup() ever runs.
  let state: GameState = newGame(setup.config);

  appEl.innerHTML = '';
  const boardEl = document.createElement('div');
  boardEl.className = 'board-wrap';
  boardEl.id = 'board';
  const hudEl = document.createElement('div');
  hudEl.id = 'hud';
  appEl.append(boardEl, hudEl);

  const view = createBoardView(state.size);
  view.mount(boardEl);

  function render(): void {
    view.setState(state, computeDests(state));
    renderOverlays(boardEl, view, state);
    renderHud(hudEl, state, { onNewGame: start });
  }

  function playMove(move: Move): void {
    try {
      state = applyMove(state, move);
    } catch {
      // Illegal move -- shouldn't happen since chessgroundx is only ever
      // given legal-move-derived dests, but belt-and-braces: just re-render
      // (dests already force a visual snap-back) rather than crash.
    }
    render();
  }

  view.onMove((from, to) => {
    if (state.result) return;
    const candidates = legalMoves(state, from).filter(m => m.to === to);
    if (candidates.length === 0) return; // shouldn't happen: cg only offers dests we gave it

    const needsPromotion = candidates.every(m => m.promotion);
    if (needsPromotion) {
      const color = state.turn;
      pickPromotion(color).then(promotion => playMove({ from, to, promotion }));
    } else {
      playMove(candidates[0]);
    }
  });

  render();

  // Expose the raw chessgroundx Api for manual verification only (e.g.
  // `window.__cg.selectSquare('e2'); window.__cg.selectSquare('e4');` drives
  // a move through the same click-to-move pipeline a real click would).
  // Not part of the BoardView contract.
  (window as unknown as { __cg: ReturnType<CgBoardView['api']> }).__cg = (view as unknown as CgBoardView).api();

  if (import.meta.env.DEV) {
    mountDevTools(
      () => state,
      next => {
        state = next;
        render();
      }
    );
  }
}

start();

// --- Dev-only tools: eyeball corrosion overlay rendering (marching,
// stacking, class-3/purple) and exercise the promotion picker without
// having to play through a full game. Dead-code-eliminated from production
// builds because Vite inlines `import.meta.env.DEV` as a literal `false`
// there. ---
function mountDevTools(getState: () => GameState, setState: (s: GameState) => void): void {
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
  seedBtn.onclick = () => setState(buildDevCorrosionState(getState()));

  const phaseBtn = document.createElement('button');
  phaseBtn.textContent = 'Force corrosion phase';
  phaseBtn.onclick = () => {
    const next = structuredClone(getState());
    corrosionPhase(next);
    next.round++;
    setState(next);
  };

  const promotionBtn = document.createElement('button');
  promotionBtn.textContent = 'Test promotion picker';
  promotionBtn.onclick = () => {
    pickPromotion('w').then(choice => {
      console.log('pickPromotion resolved with:', choice);
    });
  };

  devTools.append(seedBtn, phaseBtn, promotionBtn);
  appEl.appendChild(devTools);
}
