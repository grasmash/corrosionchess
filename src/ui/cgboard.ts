import { Chessground } from 'chessgroundx';
import type { Api } from 'chessgroundx/api';
import type { Config } from 'chessgroundx/config';
import type { Key } from 'chessgroundx/types';
import type { BoardView } from './boardview';
import type { Color, GameState } from '../engine/types';
import { fileOf, rankOf } from '../engine/board';

// chessgroundx key-naming facts (confirmed by reading node_modules/chessgroundx/types.js
// and util.js's key2pos/pos2key):
//   - files: 'a'..'p' (16 letters), directly index-matched to the file number (0-based).
//     Our engine's own FILES ('abcdefghijkl', 12 letters) is a strict subset, so files
//     a-l used for the 12x12 board line up with chessgroundx's file letters as-is.
//   - ranks: NOT "a10"/"a11"-style. chessgroundx uses a fixed 16-char rank alphabet
//     ['1'..'9', ':', ';', '<', '=', '>', '?', '@'] where rank index r (0-based) maps to
//     ranks[r]. These are the ASCII characters immediately following '9' (charCodeAt
//     49+r), so rank 10 (index 9) is ':', rank 11 (index 10) is ';', rank 12 (index 11)
//     is '<'. This is the "colon-prefixed" scheme the task brief warned about -- it is
//     NOT multi-character keys. We must NOT reuse the engine's toAlg() (which produces
//     "a10"/"a11"/"a12") for chessgroundx keys; sqToKey()/keyToSq() below implement the
//     chessgroundx-specific mapping independently, leaving engine/board.ts untouched.
//   - FEN: fen.ts's readBoard() accumulates empty-square digits as `10 * num + digit`,
//     i.e. multi-digit empty runs ("12" for twelve empty squares) parse correctly, and
//     writeBoard()/readBoard() both slice by `bd.height`/`bd.width` from the `dimensions`
//     config, so an ordinary rank-major FEN (ranks high-to-low, top row first) with
//     standard piece letters works unmodified for 12x12 boards.
//   - CSS: the package ships assets/chessground.base.css, chessground.brown.css (board
//     theme) and chessground.cburnett.css (piece set) -- no dist/ subfolder, files sit at
//     the package root. IMPORTANT: chessground.base.css hardcodes `cg-board square` and
//     `piece` at `width/height: 12.5%` (i.e. it assumes an 8-wide board). For a 12x12
//     board this must be overridden to `100% / 12` or pieces render oversized and
//     overlapping; see the `.board-wrap[data-size="12"]` rule in style.css.

const FILE_CHARS = 'abcdefghijklmnop';

function sqToKey(s: number, size: number): Key {
  const file = fileOf(s, size);
  const rank = rankOf(s, size);
  return (FILE_CHARS[file] + String.fromCharCode(49 + rank)) as Key;
}

function keyToSq(key: string, size: number): number {
  const file = key.charCodeAt(0) - 97; // 'a' === 97
  const rank = key.charCodeAt(1) - 49; // '1' === 49
  return rank * size + file;
}

function colorToCg(c: Color): 'white' | 'black' {
  return c === 'w' ? 'white' : 'black';
}

/** Standard FEN piece-placement field (ranks high-to-low, top row first). */
export function stateToFen(gs: GameState): string {
  const { size, board } = gs;
  const rows: string[] = [];
  for (let rank = size - 1; rank >= 0; rank--) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < size; file++) {
      const piece = board[rank * size + file];
      if (!piece) {
        empty++;
        continue;
      }
      if (empty > 0) {
        row += empty;
        empty = 0;
      }
      row += piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
    }
    if (empty > 0) row += empty;
    rows.push(row);
  }
  return rows.join('/');
}

function toDests(dests: Map<number, number[]>, size: number): Map<Key, Key[]> {
  const out = new Map<Key, Key[]>();
  for (const [from, tos] of dests) {
    out.set(sqToKey(from, size), tos.map(t => sqToKey(t, size)));
  }
  return out;
}

export interface CgBoardView extends BoardView {
  /** Raw chessgroundx Api, exposed for the Task 9 demo/verification hook only. */
  api: () => Api | null;
}

export function createCgBoardView(size: number): CgBoardView {
  let api: Api | null = null;
  let wrapEl: HTMLElement | null = null;
  let boardEl: HTMLElement | null = null;
  let orientation: Color = 'w';
  let moveCb: ((from: number, to: number) => void) | null = null;
  let selectCb: ((sq: number | null) => void) | null = null;

  function mount(el: HTMLElement): void {
    wrapEl = el;
    el.classList.add('cg-wrap');
    el.dataset.size = String(size);

    const emptyRank = String(size); // multi-digit empty-run token, e.g. "12" for a 12-wide empty rank
    const config: Config = {
      fen: Array(size).fill(emptyRank).join('/'),
      orientation: colorToCg(orientation),
      dimensions: { width: size, height: size },
      coordinates: true,
      movable: {
        free: false,
        dests: new Map(),
        events: {
          after: (orig, dest) => {
            moveCb?.(keyToSq(orig, size), keyToSq(dest, size));
          },
        },
      },
      premovable: { enabled: false },
      draggable: { enabled: true, showGhost: true },
      selectable: { enabled: true },
      events: {
        // `select` fires for every click/tap attempt regardless of outcome
        // (select.js's select() calls it unconditionally before resolving
        // select/deselect/move), so it can't be read as "the new selection"
        // directly -- queueMicrotask defers to right after that same
        // synchronous call finishes settling `state.selectable.selected`
        // (including running a completed move's own cleanup, which clears
        // it back to undefined), so this always reports the final,
        // settled selection rather than a stale mid-click value.
        select: () => {
          queueMicrotask(() => {
            const selected = api?.state.selectable.selected;
            selectCb?.(typeof selected === 'string' ? keyToSq(selected, size) : null);
          });
        },
      },
    };
    api = Chessground(el, config);
    boardEl = el.querySelector('cg-board');
  }

  function setState(gs: GameState, dests: Map<number, number[]>): void {
    if (!api) throw new Error('BoardView.mount() must be called before setState()');
    const moverColor = gs.result ? undefined : colorToCg(gs.turn);
    api.set({
      fen: stateToFen(gs),
      turnColor: colorToCg(gs.turn),
      movable: {
        free: false,
        color: moverColor,
        dests: toDests(dests, size),
      },
    });
  }

  function onMove(cb: (from: number, to: number) => void): void {
    moveCb = cb;
  }

  function onSelect(cb: (sq: number | null) => void): void {
    selectCb = cb;
  }

  function setOrientation(c: Color): void {
    orientation = c;
    api?.set({ orientation: colorToCg(c) });
  }

  function squareEl() {
    return {
      boardPx: (): DOMRect => (boardEl ?? wrapEl!).getBoundingClientRect(),
      squarePx: (sqIdx: number): { x: number; y: number; w: number } => {
        const rect = (boardEl ?? wrapEl!).getBoundingClientRect();
        const w = rect.width / size;
        const file = fileOf(sqIdx, size);
        const rank = rankOf(sqIdx, size);
        const colFromLeft = orientation === 'w' ? file : size - 1 - file;
        const rowFromTop = orientation === 'w' ? size - 1 - rank : rank;
        return { x: rect.left + colFromLeft * w, y: rect.top + rowFromTop * w, w };
      },
    };
  }

  return { mount, setState, onMove, onSelect, setOrientation, squareEl, api: () => api };
}
