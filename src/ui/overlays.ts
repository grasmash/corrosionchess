import type { BoardView } from './boardview';
import type { Color, GameState } from '../engine/types';

// Class-1/2 corrosion is tinted by owner color; class 3 is always red
// regardless of owner (per the design spec, "critical" corrosion looks the
// same for both sides). Bucketing keys therefore split cls-3 cells off from
// a same-color cls-1/2 stack even though `hostile()` in engine/corrosion.ts
// would normally have annihilated any such overlap before a phase finishes
// resolving -- this is the "code defensively" case from the task brief: it
// can only be observed transiently/via the dev tools, never after a real
// phase completes, but we still render it as two visually distinct halves
// rather than silently merging or dropping cells.
const LAYER_CLASS = 'corrosion-overlay-layer';

interface CellEntry {
  color: Color;
  cls: 1 | 2 | 3;
}

interface Bucket {
  key: string;
  color: Color;
  cls3: boolean;
  hasCls2: boolean;
  count: number;
}

function bucketKeyFor(e: CellEntry): string {
  return e.cls === 3 ? `${e.color}3` : e.color;
}

function ensureLayer(container: HTMLElement): HTMLDivElement {
  const existing = container.querySelector<HTMLDivElement>(`:scope > .${LAYER_CLASS}`);
  if (existing) return existing;
  const layer = document.createElement('div');
  layer.className = LAYER_CLASS;
  container.appendChild(layer);
  return layer;
}

function badgeEl(text: string, corner: 'tl' | 'tr' | 'bl' | 'br'): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `corrosion-badge corrosion-badge--${corner}`;
  el.textContent = text;
  return el;
}

/**
 * One "half" (or full square, when it's the only bucket) of a corrosion tint.
 *
 * `inset`: true when the square is *also* purple (e.g. a class-3 unit
 * standing on a square it, or another class-3 unit, already painted purple
 * earlier -- purple is immune-exempt for cls3, so this is a normal, reachable
 * board state, not just a defensive edge case). Shrinking the tint leaves a
 * visible ring of the purple base tint around it so both are legible at
 * once, rather than the corrosion color fully overpainting the purple.
 */
function bucketEl(b: Bucket, index: number, total: number, inset: boolean): HTMLDivElement {
  const half = document.createElement('div');
  half.className = `corrosion-cell corrosion-cell--${b.cls3 ? 'cls3' : b.color}`;
  const sliceWidth = 100 / total;
  const pad = inset ? sliceWidth * 0.12 : 0;
  half.style.left = `${sliceWidth * index + pad}%`;
  half.style.width = `${sliceWidth - pad * 2}%`;
  if (inset) {
    half.style.top = '12%';
    half.style.bottom = '12%';
    half.style.borderRadius = '3px';
  }
  return half;
}

/**
 * Clears and redraws the pointer-events:none overlay layer for corrosion
 * units and purple squares on top of the board rendered by `view`.
 *
 * `container` must be the same element passed to `view.mount()` -- overlay
 * markers are positioned using `view.squareEl()`'s pixel geometry, which is
 * computed against that element's box.
 */
export function renderOverlays(container: HTMLElement, view: BoardView, gs: GameState): void {
  const layer = ensureLayer(container);
  layer.replaceChildren();

  const { boardPx, squarePx } = view.squareEl();
  const board = boardPx();
  const containerRect = container.getBoundingClientRect();
  layer.style.left = `${board.left - containerRect.left}px`;
  layer.style.top = `${board.top - containerRect.top}px`;
  layer.style.width = `${board.width}px`;
  layer.style.height = `${board.height}px`;

  // Group every corrosion unit's cells by square.
  const bySquare = new Map<number, CellEntry[]>();
  for (const { sq: square, color, cls } of gs.corrosions.flatMap(u =>
    u.cells.map(c => ({ sq: c, color: u.color, cls: u.cls }))
  )) {
    const list = bySquare.get(square);
    if (list) list.push({ color, cls });
    else bySquare.set(square, [{ color, cls }]);
  }

  const purpleSquares = new Set(gs.purple);
  const squares = new Set<number>([...bySquare.keys(), ...purpleSquares]);

  for (const square of squares) {
    const pos = squarePx(square);
    const marker = document.createElement('div');
    marker.className = 'corrosion-marker';
    marker.style.left = `${pos.x - board.left}px`;
    marker.style.top = `${pos.y - board.top}px`;
    marker.style.width = `${pos.w}px`;
    marker.style.height = `${pos.w}px`;

    const isPurple = purpleSquares.has(square);

    // Purple is split into a base tint (painted first, under everything) and
    // a skull glyph (painted last, always on top) so a co-located corrosion
    // cell -- inset via `bucketEl`'s `inset` flag below -- can never fully
    // wash either one out. See the reviewer note on Task 10 for the bug this
    // fixes: a live cls-3 cell standing on its own already-purple square
    // (normal after it bounces off the board edge and retreads its trail)
    // used to render as solid red with no purple/skull visible at all.
    if (isPurple) {
      const purpleBg = document.createElement('div');
      purpleBg.className = 'corrosion-purple-bg';
      marker.appendChild(purpleBg);
    }

    const entries = bySquare.get(square);
    if (entries) {
      const buckets = new Map<string, Bucket>();
      for (const e of entries) {
        const key = bucketKeyFor(e);
        const existing = buckets.get(key);
        if (existing) {
          existing.count++;
          if (e.cls === 2) existing.hasCls2 = true;
        } else {
          buckets.set(key, { key, color: e.color, cls3: e.cls === 3, hasCls2: e.cls === 2, count: 1 });
        }
      }
      const bucketList = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
      const total = bucketList.length;
      bucketList.forEach((b, i) => {
        marker.appendChild(bucketEl(b, i, total, isPurple));
        const leftHalf = i === 0;
        const clsText = b.cls3 ? '3' : b.hasCls2 ? '2' : null;
        if (clsText) marker.appendChild(badgeEl(clsText, leftHalf ? 'tl' : 'tr'));
        if (b.count > 1) marker.appendChild(badgeEl(`×${b.count}`, leftHalf ? 'bl' : 'br'));
      });
    }

    if (isPurple) {
      const skull = document.createElement('div');
      skull.className = 'corrosion-purple-skull';
      skull.textContent = '☠'; // skull and crossbones
      marker.appendChild(skull);
    }

    layer.appendChild(marker);
  }
}
