import type { BoardView } from './boardview';
import type { Color, GameState, Piece } from '../engine/types';

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
const UNITS_LAYER_CLASS = 'corrosion-units-layer';
const INFO_LAYER_CLASS = 'corrosion-info-layer';

type SquarePx = (sq: number) => { x: number; y: number; w: number };

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

interface UnitDivEntry {
  el: HTMLDivElement;
  sq: number;
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

function ensureSublayer(layer: HTMLDivElement, cls: string): HTMLDivElement {
  const existing = layer.querySelector<HTMLDivElement>(`:scope > .${cls}`);
  if (existing) return existing;
  const el = document.createElement('div');
  el.className = cls;
  layer.appendChild(el);
  return el;
}

function badgeEl(text: string, corner: 'tl' | 'tr' | 'bl' | 'br'): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `corrosion-badge corrosion-badge--${corner}`;
  el.textContent = text;
  return el;
}

function unitVariantClass(color: Color, cls: 1 | 2 | 3): string {
  const variant = cls === 3 ? 'cls3' : color;
  return `corrosion-unit corrosion-unit--${variant}`;
}

/**
 * Removes `el` on `event` (once), with a fallback timer in case the event
 * never fires -- e.g. `prefers-reduced-motion` strips the transition/keyframe
 * this element was relying on, or the element gets detached some other way.
 */
function autoRemove(el: HTMLElement, event: 'animationend' | 'transitionend', fallbackMs: number): void {
  const timer = window.setTimeout(() => el.remove(), fallbackMs);
  el.addEventListener(
    event,
    () => {
      clearTimeout(timer);
      el.remove();
    },
    { once: true }
  );
}

/** Same idea as `autoRemove` but only strips a transient class instead of
 * removing the element -- used for `is-spawning`/`is-marching`, which mark a
 * persistent unit div mid-animation rather than a one-shot effect. */
function autoRemoveClass(el: HTMLElement, cls: string, event: 'animationend' | 'transitionend', fallbackMs: number): void {
  const timer = window.setTimeout(() => el.classList.remove(cls), fallbackMs);
  el.addEventListener(
    event,
    () => {
      clearTimeout(timer);
      el.classList.remove(cls);
    },
    { once: true }
  );
}

function playDeath(el: HTMLDivElement): void {
  el.classList.add('is-dying');
  autoRemove(el, 'animationend', 900);
}

/** All squares occupied by any corrosion cell in `gs`, used to recognize a
 * piece destroyed by corrosion (as opposed to a normal capture) below. */
function allCorrosionSquares(gs: GameState): Set<number> {
  const s = new Set<number>();
  for (const u of gs.corrosions) for (const c of u.cells) s.add(c);
  return s;
}

function pieceGhostClass(p: Piece): string {
  return `corrosion-piece-ghost ${p.type}-piece ${p.color === 'w' ? 'white' : 'black'}`;
}

function spawnPieceGhost(unitsLayer: HTMLDivElement, piece: Piece, square: number, squarePx: SquarePx, board: DOMRect): void {
  const pos = squarePx(square);
  // Plain `<piece>` tag (not a custom element) so it picks up the exact same
  // `.cg-wrap piece.{type}-piece.{white|black}` background-image rules from
  // pieces-cburnett.css that render the real board pieces -- unitsLayer is a
  // descendant of the `.cg-wrap` element (boardview.mount adds that class to
  // the container renderOverlays is given), so the selector resolves without
  // reaching into chessgroundx's own DOM at all.
  const el = document.createElement('piece');
  el.className = pieceGhostClass(piece);
  el.style.width = `${pos.w}px`;
  el.style.height = `${pos.w}px`;
  // Standalone `translate` (not the `transform` shorthand) for position: the
  // `piece-corrode` keyframes animate `transform: translateY() scale()` on
  // this same element for the sink/shrink effect, and `transform` isn't
  // additive across declarations -- an animated `transform` keyframe would
  // silently discard a `transform: translate(...)` set here. `translate`,
  // `rotate`, `scale`, and `transform` are independent CSS properties that
  // compose (in that fixed order), so this and the keyframe's `transform`
  // both apply. See the same reasoning on the unit divs below.
  el.style.translate = `${pos.x - board.left}px ${pos.y - board.top}px`;
  unitsLayer.appendChild(el);
  autoRemove(el, 'animationend', 1400);
}

function spawnKillBurst(unitsLayer: HTMLDivElement, square: number, squarePx: SquarePx, board: DOMRect): void {
  const pos = squarePx(square);
  const el = document.createElement('div');
  el.className = 'corrosion-kill-burst';
  el.style.width = `${pos.w}px`;
  el.style.height = `${pos.w}px`;
  el.style.translate = `${pos.x - board.left}px ${pos.y - board.top}px`;
  unitsLayer.appendChild(el);
  autoRemove(el, 'animationend', 900);
}

// Persistent (unit id, cell index) -> div map, one per units-sublayer element
// (a fresh element per new game, since buildGameLayout() rebuilds `boardEl`
// from scratch -- see main.ts). This is what makes per-unit animation
// possible: unlike the old bucket-by-square rendering, a unit's div survives
// across renders and is only moved/killed/spawned based on whether its own
// (id, cell index) key is still present in `gs.corrosions`.
const unitMaps = new WeakMap<HTMLDivElement, Map<string, UnitDivEntry>>();

function renderUnits(
  unitsLayer: HTMLDivElement,
  gs: GameState,
  prev: GameState | null | undefined,
  squarePx: SquarePx,
  board: DOMRect
): void {
  let map = unitMaps.get(unitsLayer);
  if (!map) {
    map = new Map();
    unitMaps.set(unitsLayer, map);
  }

  const firstRender = prev == null;
  const purpleSquares = new Set(gs.purple);

  const current = new Map<string, { sq: number; color: Color; cls: 1 | 2 | 3 }>();
  for (const u of gs.corrosions) {
    u.cells.forEach((sq, i) => {
      current.set(`${u.id}:${i}`, { sq, color: u.color, cls: u.cls });
    });
  }

  // Death: a key that existed last render but is gone now (unit annihilated,
  // or a cls-2 collapsing to cls-3 dropped its trail cell).
  for (const [key, entry] of map) {
    if (!current.has(key)) {
      map.delete(key);
      playDeath(entry.el);
    }
  }

  // Spawn/march/update.
  for (const [key, { sq, color, cls }] of current) {
    const pos = squarePx(sq);
    const inset = purpleSquares.has(sq) ? pos.w * 0.12 : 0;
    const x = pos.x - board.left + inset;
    const y = pos.y - board.top + inset;
    const size = pos.w - inset * 2;

    let entry = map.get(key);
    const isSpawn = !entry;
    if (!entry) {
      const el = document.createElement('div');
      unitsLayer.appendChild(el);
      entry = { el, sq };
      map.set(key, entry);
    }

    entry.el.className = unitVariantClass(color, cls);
    entry.el.style.width = `${size}px`;
    entry.el.style.height = `${size}px`;

    const moved = !isSpawn && entry.sq !== sq;
    // Standalone `translate`, not the `transform` shorthand -- see the
    // comment in spawnPieceGhost above. The idle `acid-pulse` keyframes
    // animate the standalone `scale` property and `march-wobble` animates
    // the `transform` shorthand; all three are independent properties that
    // compose, so this position, the idle pulse, and the march wobble can
    // all be in effect on the same div at once without one clobbering
    // another the way two rules both setting `transform` would.
    entry.el.style.translate = `${x}px ${y}px`;
    entry.sq = sq;

    if (isSpawn) {
      if (!firstRender) {
        entry.el.classList.add('is-spawning');
        autoRemoveClass(entry.el, 'is-spawning', 'animationend', 500);
      }
    } else if (moved) {
      entry.el.classList.add('is-marching');
      autoRemoveClass(entry.el, 'is-marching', 'transitionend', 550);
    }
  }

  // Piece destroyed by corrosion: was a piece before the last applied move,
  // is empty now, and the square was touched by a corrosion cell either
  // before or after the move. A normal capture never satisfies this because
  // the capturing piece is standing on the square in `gs.board`.
  if (!firstRender && prev) {
    const prevCorrSquares = allCorrosionSquares(prev);
    const currCorrSquares = allCorrosionSquares(gs);
    const size = gs.size;
    for (let sq = 0; sq < size * size; sq++) {
      const before = prev.board[sq];
      const after = gs.board[sq];
      if (before && !after && (prevCorrSquares.has(sq) || currCorrSquares.has(sq))) {
        spawnPieceGhost(unitsLayer, before, sq, squarePx, board);
        spawnKillBurst(unitsLayer, sq, squarePx, board);
        for (const entry of map.values()) {
          if (entry.sq === sq) {
            entry.el.classList.add('is-feeding');
            autoRemoveClass(entry.el, 'is-feeding', 'animationend', 1100);
          }
        }
      }
    }
  }
}

function renderInfo(infoLayer: HTMLDivElement, gs: GameState, prev: GameState | null | undefined, squarePx: SquarePx, board: DOMRect): void {
  infoLayer.replaceChildren();

  // Group every corrosion unit's cells by square (badges only care about
  // per-square counts/classes, not per-unit identity).
  const bySquare = new Map<number, CellEntry[]>();
  for (const { sq: square, color, cls } of gs.corrosions.flatMap(u =>
    u.cells.map(c => ({ sq: c, color: u.color, cls: u.cls }))
  )) {
    const list = bySquare.get(square);
    if (list) list.push({ color, cls });
    else bySquare.set(square, [{ color, cls }]);
  }

  const purpleSquares = new Set(gs.purple);
  const prevPurpleSquares = new Set(prev?.purple ?? []);
  const firstRender = prev == null;
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
    // cell (a live cls-3 cell standing on its own already-purple square,
    // normal after it bounces off the board edge and retreads its trail)
    // can never fully wash either one out.
    if (isPurple) {
      const purpleBg = document.createElement('div');
      purpleBg.className = 'corrosion-purple-bg';
      if (!firstRender && !prevPurpleSquares.has(square)) purpleBg.classList.add('is-purpling');
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
      bucketList.forEach((b, i) => {
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

    infoLayer.appendChild(marker);
  }
}

/**
 * Renders the pointer-events:none overlay layer for corrosion units and
 * purple squares on top of the board rendered by `view`.
 *
 * `container` must be the same element passed to `view.mount()` -- overlay
 * markers are positioned using `view.squareEl()`'s pixel geometry, which is
 * computed against that element's box.
 *
 * `prev` is the GameState from before the last applied move (or
 * null/undefined on the first render for a given `container`, in which case
 * everything renders with no entry animations). It drives every diff-based
 * animation: march (a unit's square changed), spawn (new unit key), death
 * (unit key gone), piece corrode-out (a piece vanished on a corrosion
 * square), and purple etch-in (a square newly added to `gs.purple`).
 */
export function renderOverlays(container: HTMLElement, view: BoardView, gs: GameState, prev?: GameState | null): void {
  const layer = ensureLayer(container);

  const { boardPx, squarePx } = view.squareEl();
  const board = boardPx();
  const containerRect = container.getBoundingClientRect();
  layer.style.left = `${board.left - containerRect.left}px`;
  layer.style.top = `${board.top - containerRect.top}px`;
  layer.style.width = `${board.width}px`;
  layer.style.height = `${board.height}px`;

  const unitsLayer = ensureSublayer(layer, UNITS_LAYER_CLASS);
  const infoLayer = ensureSublayer(layer, INFO_LAYER_CLASS);

  renderUnits(unitsLayer, gs, prev, squarePx, board);
  renderInfo(infoLayer, gs, prev, squarePx, board);
}
