// Plan 001 (VFX) iteration: a DEV-only showcase that plays each corrosion
// animation in isolation with the REAL rendering pipeline -- a small real
// 8x8 board (createBoardView + renderOverlays, no mocks), a rail of buttons
// that each stage a scripted `GameState` via direct engine calls
// (applyMove/corrosionPhase, exactly what a real game calls) and then
// trigger the actual transition, a "Slow motion" toggle (sets --vfx-speed
// on the board container; every corrosion animation-duration/transition in
// style.css consumes that custom property, see the big comment above the
// `no-preference` media query block there), and "Replay".
//
// Reachable two ways (both DEV-gated by the caller, main.ts): a "VFX Lab"
// button in the dev-tools row, and the `#vfxlab` hash.

import { createBoardView } from './boardview';
import type { CgBoardView } from './cgboard';
import { renderOverlays } from './overlays';
import { newGame, applyMove } from '../engine/game';
import { corrosionPhase } from '../engine/corrosion';
import { fromAlg } from '../engine/board';
import type { Config, CorrosionUnit, GameState } from '../engine/types';

const SIZE = 8;
const LAB_CONFIG: Config = { tier1: true, tier2: true, tier3: true, bigBoard: false };

function sq(alg: string): number {
  return fromAlg(alg, SIZE);
}

/** A fresh, otherwise-empty board (both kings placed in far corners, out of
 * every scenario's way, so engine helpers that assume a king exists --
 * findKing/inCheck/computeResult -- always have one) at round 2, so a unit
 * staged with `bornRound: 1` is already a "mover" the instant a scenario's
 * `play()` runs a phase, with no throwaway warm-up phase needed first. */
function emptyBoardState(): GameState {
  const s = newGame(LAB_CONFIG);
  s.board = s.board.map(() => null);
  s.board[sq('a1')] = { color: 'w', type: 'k' };
  s.board[sq('h8')] = { color: 'b', type: 'k' };
  s.corrosions = [];
  s.purple = [];
  s.log = [];
  s.round = 2;
  s.turn = 'w';
  return s;
}

function oneRoundPhase(staged: GameState): GameState {
  const next = structuredClone(staged);
  corrosionPhase(next);
  next.round++;
  return next;
}

function unit(u: Omit<CorrosionUnit, 'id'> & { id: number }): CorrosionUnit {
  return u;
}

interface Scenario {
  label: string;
  /** Builds the staged pre-state, shown first with no entry animations
   * (prev=null) so the viewer can see the "before" clearly. */
  stage: () => GameState;
  /** Applies the real transition (a real Move via applyMove, or a direct
   * corrosionPhase call -- exactly what production code does internally in
   * either case) to the staged state, returning the "after" state. Rendered
   * against the staged state as `prev`, triggering the actual animation
   * pipeline the same way a real game would. */
  play: (staged: GameState) => GameState;
}

const SCENARIOS: Scenario[] = [
  {
    label: 'Corrosion spawns',
    // White rook captures a black pawn -- isolated to just the spawn (only
    // BLACK's move triggers a corrosion phase, so a white capture alone
    // can't also trigger a march in the same click).
    stage: () => {
      const s = emptyBoardState();
      s.board[sq('a4')] = { color: 'w', type: 'r' };
      s.board[sq('a5')] = { color: 'b', type: 'p' };
      return s;
    },
    play: staged => applyMove(staged, { from: sq('a4'), to: sq('a5') }),
  },
  {
    label: 'March',
    stage: () => {
      const s = emptyBoardState();
      s.corrosions = [unit({ id: 901, color: 'w', cls: 1, cells: [sq('d4')], dir: 1, bornRound: 1 })];
      return s;
    },
    play: oneRoundPhase,
  },
  {
    label: 'Piece killed by corrosion',
    // White cls-2's LEAD cell (d4) marches onto d5 -- an enemy pawn waiting
    // there gets struck. Deliberately cls-2 (lead + trail), not cls-1: per
    // corrosion.ts's strikeAt, the STRIKING CELL is destroyed along with the
    // piece it kills (a real "mutual kamikaze" mechanic, not a bug -- found
    // while building this scenario, see the exec report) -- for a cls-1 unit
    // that means the WHOLE unit dies in the same instant, muddying an
    // isolated demo of the kill choreography with a second, simultaneous
    // death animation. Cls-2's surviving trail cell (d3->d4) keeps the unit
    // on the board so the kill choreography reads on its own. This is the
    // exact scenario the "reads as a plain disappear" complaint was about --
    // see the exec report for the full diagnostic.
    stage: () => {
      const s = emptyBoardState();
      s.board[sq('d5')] = { color: 'b', type: 'p' };
      s.corrosions = [unit({ id: 902, color: 'w', cls: 2, cells: [sq('d4'), sq('d3')], dir: 1, bornRound: 1 })];
      return s;
    },
    play: oneRoundPhase,
  },
  {
    label: 'Annihilation',
    // White cls-1 at d3 (marching up) and black cls-1 at d5 (marching down)
    // both land on d4 this phase -- same-square annihilation destroys both
    // (corrosion.ts step 5).
    stage: () => {
      const s = emptyBoardState();
      s.corrosions = [
        unit({ id: 903, color: 'w', cls: 1, cells: [sq('d3')], dir: 1, bornRound: 1 }),
        unit({ id: 904, color: 'b', cls: 1, cells: [sq('d5')], dir: -1, bornRound: 1 }),
      ];
      return s;
    },
    play: oneRoundPhase,
  },
  {
    label: 'Class 1→2 split',
    // A cls-1 cell already sitting on the enemy edge rank (d8, white's
    // enemy edge) promotes to cls-2 on its next moving phase, gaining a
    // second (trail) cell -- corrosion.ts step 8.
    stage: () => {
      const s = emptyBoardState();
      s.corrosions = [unit({ id: 905, color: 'w', cls: 1, cells: [sq('d8')], dir: 1, bornRound: 1 })];
      return s;
    },
    play: oneRoundPhase,
  },
  {
    label: 'Class 2→3 + purple trail',
    // A cls-2 unit whose lead cell (d1, white's own edge) has already
    // arrived promotes to cls-3 and bounces (dir flips) on the first phase;
    // NOW being cls-3, the SECOND phase paints purple under its
    // pre-move position (corrosion.ts step 2) before it marches off again --
    // two phases in one click show both the promotion/bounce and the
    // resulting void trail.
    stage: () => {
      const s = emptyBoardState();
      s.corrosions = [unit({ id: 906, color: 'w', cls: 2, cells: [sq('d1'), sq('d2')], dir: -1, bornRound: 1 })];
      return s;
    },
    play: staged => oneRoundPhase(oneRoundPhase(staged)),
  },
  {
    label: 'Piece captures corrosion',
    // A rook moving onto enemy (hostile) corrosion is destroyed along with
    // it -- mutual destruction, corrosion.ts's resolveCorrosionCapture via
    // legal.ts's applyMoveCore.
    stage: () => {
      const s = emptyBoardState();
      s.board[sq('a1')] = null;
      s.board[sq('b1')] = { color: 'w', type: 'k' };
      s.board[sq('a1')] = { color: 'w', type: 'r' };
      s.corrosions = [unit({ id: 907, color: 'b', cls: 1, cells: [sq('a4')], dir: -1, bornRound: 1 })];
      return s;
    },
    play: staged => applyMove(staged, { from: sq('a1'), to: sq('a4') }),
  },
  {
    label: 'King cleanses purple',
    stage: () => {
      const s = emptyBoardState();
      s.board[sq('a1')] = null;
      s.board[sq('e1')] = { color: 'w', type: 'k' };
      s.purple = [sq('e2')];
      return s;
    },
    play: staged => applyMove(staged, { from: sq('e1'), to: sq('e2') }),
  },
];

export function mountVfxLab(onBack: () => void): void {
  const appEl = document.querySelector<HTMLDivElement>('#app')!;
  appEl.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'vfxlab';

  const title = document.createElement('h1');
  title.className = 'setup-title';
  title.textContent = 'VFX Lab';

  const subtitle = document.createElement('p');
  subtitle.className = 'setup-rules-hint';
  subtitle.textContent = 'Each button stages a scripted position with the real engine, then plays the real transition.';

  const boardWrap = document.createElement('div');
  boardWrap.className = 'board-wrap vfxlab-board';
  boardWrap.id = 'vfxlab-board';

  const view = createBoardView(SIZE);
  view.mount(boardWrap);

  const status = document.createElement('div');
  status.className = 'vfxlab-status';
  status.textContent = 'Pick a scenario below.';

  const controlsRow = document.createElement('div');
  controlsRow.className = 'vfxlab-controls';

  const slowMoLabel = document.createElement('label');
  slowMoLabel.className = 'vfxlab-slowmo';
  const slowMoCheckbox = document.createElement('input');
  slowMoCheckbox.type = 'checkbox';
  slowMoLabel.append(slowMoCheckbox, document.createTextNode(' Slow motion (0.25x)'));

  const replayBtn = document.createElement('button');
  replayBtn.className = 'btn btn-secondary';
  replayBtn.textContent = 'Replay';
  replayBtn.disabled = true;

  const backBtn = document.createElement('button');
  backBtn.className = 'btn btn-secondary';
  backBtn.textContent = 'Back';
  backBtn.onclick = onBack;

  controlsRow.append(slowMoLabel, replayBtn, backBtn);

  const rail = document.createElement('div');
  rail.className = 'vfxlab-rail';

  slowMoCheckbox.onchange = () => {
    // `--vfx-speed` is a DURATION multiplier (see the big comment in
    // style.css) -- "4" here is what makes the toggle's own "0.25x" label
    // true, since duration and playback rate are inverses of each other.
    // Scoped to this board container specifically (custom properties
    // inherit down through the DOM), not :root, so it can never leak into a
    // real concurrent game.
    boardWrap.style.setProperty('--vfx-speed', slowMoCheckbox.checked ? '4' : '1');
  };

  let lastScenario: Scenario | null = null;

  function render(state: GameState, prev: GameState | null): void {
    view.setState(state, new Map());
    renderOverlays(boardWrap, view, state, prev);
  }

  function run(scenario: Scenario): void {
    lastScenario = scenario;
    replayBtn.disabled = false;
    status.textContent = `${scenario.label} -- staged.`;
    const staged = scenario.stage();
    render(staged, null);
    window.setTimeout(() => {
      const after = scenario.play(staged);
      render(after, staged);
      status.textContent = `${scenario.label} -- playing.`;
    }, 500);
  }

  for (const scenario of SCENARIOS) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary vfxlab-scenario-btn';
    btn.textContent = scenario.label;
    btn.onclick = () => run(scenario);
    rail.appendChild(btn);
  }

  replayBtn.onclick = () => {
    if (lastScenario) run(lastScenario);
  };

  wrap.append(title, subtitle, boardWrap, status, controlsRow, rail);
  appEl.appendChild(wrap);

  // Same manual-verification hook as the other mount functions in main.ts --
  // not part of BoardView's contract.
  (window as unknown as { __cg: ReturnType<CgBoardView['api']> }).__cg = (view as unknown as CgBoardView).api();
}
