import type { BoardView } from './boardview';
import type { Color, GameState, Piece } from '../engine/types';
import { forwardDir } from '../engine/board';

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
const VOID_LAYER_CLASS = 'corrosion-void-layer';
const UNITS_LAYER_CLASS = 'corrosion-units-layer';
const INFO_LAYER_CLASS = 'corrosion-info-layer';
const DANGER_LAYER_CLASS = 'corrosion-danger-layer';

/** The currently selected square and its legal destinations (from
 * `computeDests`), threaded in from main.ts (via BoardView.onSelect, see
 * cgboard.ts) so the danger-ring affordance below knows which destination
 * squares to flag. `null`/absent when nothing is selected. */
export interface SelectionInfo {
  sq: number;
  dests: number[];
}

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
  sprite: HTMLDivElement;
  chevrons: HTMLDivElement;
  sq: number;
}

// Two photographed acid-splat sprites per color (picked by unit id % 2, for
// per-unit variety) plus one for class-3 (always the same -- design calls
// for it to read as visually distinct/uniform "critical" acid regardless of
// owner, same reasoning as unitVariantClass below). Paths are under
// public/vfx/, served at this root path by Vite in both dev and build.
const SPRITE_PATHS: Record<'w' | 'b' | 'cls3', string[]> = {
  w: ['vfx/acid-w-1.png', 'vfx/acid-w-2.png'],
  b: ['vfx/acid-b-1.png', 'vfx/acid-b-2.png'],
  cls3: ['vfx/acid-cls3-1.png'],
};

function spriteFor(color: Color, cls: 1 | 2 | 3, unitId: number): string {
  const options = SPRITE_PATHS[cls === 3 ? 'cls3' : color];
  return options[unitId % options.length];
}

/**
 * On-screen march direction, expressed as the clockwise `rotate` angle (in
 * degrees) that turns an element authored to point "up" (12 o'clock, i.e.
 * toward -Y) so it instead points toward the unit's actual march direction.
 * Computed from `squarePx(cell)` vs `squarePx(cell + dir*size)` -- the pixel
 * delta between the unit's current square and the one it marches into next
 * -- rather than from `dir` alone, so it automatically accounts for board
 * orientation (a guest viewing the board flipped sees the same unit marching
 * the opposite screen direction, and this recomputes correctly for that
 * without knowing about orientation itself).
 *
 * Corrosion only ever marches along a file (never diagonally -- `dir` shifts
 * rank only), so in practice this always comes out to ~0deg or ~180deg; the
 * general vector form still handles it correctly and doesn't hardcode that
 * assumption.
 */
function marchAngleDeg(sq: number, dir: 1 | -1, size: number, squarePx: SquarePx): number {
  const from = squarePx(sq);
  const to = squarePx(sq + dir * size);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.atan2(dx, -dy) * (180 / Math.PI);
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
 * Reads the `--vfx-speed` custom property currently in effect for `el`
 * (inherited from an ancestor -- see the big comment above the
 * `no-preference` media query block in style.css). Defaults to `1`
 * (normal speed) wherever it's unset, i.e. everywhere outside the VFX Lab.
 * JS-driven timings (the phase-A wait, and every fallback-removal timer
 * below) multiply by this so they stay in sync with the CSS animation
 * durations, which consume the same custom property directly -- without
 * this, toggling "Slow motion" in the lab would stretch the CSS animations
 * but leave the JS timers firing at normal speed, desyncing the
 * choreography's phases from what's actually on screen.
 */
function vfxSpeed(el: HTMLElement): number {
  const raw = getComputedStyle(el).getPropertyValue('--vfx-speed').trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Removes `el` on `event` (once), with a fallback timer in case the event
 * never fires -- e.g. `prefers-reduced-motion` strips the transition/keyframe
 * this element was relying on, or the element gets detached some other way.
 */
function autoRemove(el: HTMLElement, event: 'animationend' | 'transitionend', fallbackMs: number): void {
  const timer = window.setTimeout(() => el.remove(), fallbackMs * vfxSpeed(el));
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
  const timer = window.setTimeout(() => el.classList.remove(cls), fallbackMs * vfxSpeed(el));
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

/**
 * All squares "touched by corrosion" in `gs`, used to recognize a piece
 * destroyed by corrosion (as opposed to a normal capture) below: every cell's
 * resting square, PLUS one step either side of it along its unit's `dir`.
 *
 * The extra one-step squares matter because of a real gap this covers: per
 * corrosion.ts's strikeAt, a cell that successfully destroys a piece is
 * REMOVED from its unit in that same corrosionPhase call -- it never
 * "rests" at the strike square in any `GameState` snapshot this module ever
 * sees, before or after. A plain "does this square hold a resting cell in
 * prev or gs" check (an earlier version of this function) misses that
 * square entirely unless some OTHER cell happens to coincidentally occupy
 * it too -- which is common in a busy multi-unit real game (masking this for
 * a long time) but reliably absent in an isolated single-unit repro, which
 * is how the VFX Lab's "Piece killed by corrosion" scenario first exposed
 * it: the ghost/kill choreography silently never fired at all for a
 * lead-cell-strikes-and-dies kill. See the exec report for the full
 * diagnostic -- this is likely the actual, or at least a major, cause of
 * the "reads as a plain disappear" complaint that started this VFX Lab
 * work, more so than mere noticeability. Over-including a few extra squares
 * here is safe: the caller's `before && !after` check already excludes
 * normal captures regardless (the capturing piece stands on `after`).
 */
function allCorrosionSquares(gs: GameState): Set<number> {
  const s = new Set<number>();
  for (const u of gs.corrosions) {
    for (const c of u.cells) {
      s.add(c);
      s.add(c + u.dir * gs.size);
      s.add(c - u.dir * gs.size);
    }
  }
  // Purple squares consume non-king pieces standing on them during the
  // corrosion phase (see corrosion.ts's purple-decay step) -- include them
  // so those kills get the same ghost/dissolve treatment as strikes.
  for (const p of gs.purple) s.add(p);
  return s;
}

/**
 * True when a pawn vanishing from `sq` is explained by en passant rather
 * than corrosion. Unlike a normal capture, en passant does NOT leave the
 * capturing piece standing on the captured pawn's square -- the capturing
 * pawn lands one rank further on (the square it just passed over), so the
 * general "a piece is standing there now, so it can't have been corrosion"
 * reasoning in the caller doesn't cover this case on its own. This can
 * collide with a real corrosion-destroy check because a corrosion cell
 * legitimately co-occupying that square (a stable, reachable board state)
 * is exactly the condition the caller is scanning for.
 *
 * Signature of an en passant vacate: the vanished piece is a pawn of color
 * `C`, and the square the *opposing* pawn would have landed on (one rank
 * toward `C`'s own back rank is wrong -- it's one rank in the CAPTURING
 * side's forward direction, since that's the square it passed over) now
 * holds an enemy pawn that wasn't there before the move. That destination
 * square is always empty pre-move (chess rule -- en passant's target square
 * has no piece to "capture" there), so `prev.board[epSq] == null` plus a
 * freshly-arrived opposing pawn at `epSq` is a safe, sufficient signature.
 */
function isEnPassantVacate(prev: GameState, gs: GameState, sq: number, vacated: Piece): boolean {
  if (vacated.type !== 'p') return false;
  const capturingColor: Color = vacated.color === 'w' ? 'b' : 'w';
  const epSq = sq + gs.size * forwardDir(capturingColor);
  if (epSq < 0 || epSq >= gs.size * gs.size) return false;
  const landed = gs.board[epSq];
  return !!landed && landed.color === capturingColor && landed.type === 'p' && prev.board[epSq] == null;
}

function pieceGhostClass(p: Piece): string {
  return `corrosion-piece-ghost ${p.type}-piece ${p.color === 'w' ? 'white' : 'black'}`;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Creates the piece-corrode ghost in its intact, PRE-destruction state: no
 * filter, no cracks, just the piece's own sprite standing where the real
 * piece used to be. Deliberately does NOT add `is-corroding` or schedule any
 * removal -- the caller (killPieceOnSquare) decides when the destruction
 * actually starts (immediately, or after the arriving corrosion blob's march
 * finishes), matching the two-phase choreography design.
 */
function createIntactGhost(unitsLayer: HTMLDivElement, piece: Piece, square: number, squarePx: SquarePx, board: DOMRect): HTMLElement {
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
  return el;
}

function spawnKillBurst(unitsLayer: HTMLDivElement, square: number, squarePx: SquarePx, board: DOMRect): void {
  const pos = squarePx(square);
  const el = document.createElement('div');
  el.className = 'corrosion-kill-burst';
  el.style.width = `${pos.w}px`;
  el.style.height = `${pos.w}px`;
  el.style.translate = `${pos.x - board.left}px ${pos.y - board.top}px`;
  unitsLayer.appendChild(el);
  autoRemove(el, 'animationend', 1000);
}

/**
 * Runs the full two-phase corrosion kill choreography for a piece vacated at
 * `square`:
 *
 * - Phase A (only when `delayed` -- a corrosion cell just marched onto this
 *   square this render, and reduced-motion isn't active): the ghost stands
 *   fully intact for the same ~480ms the marching blob's `translate`
 *   transition takes (see `.corrosion-unit.is-marching` in style.css) so the
 *   piece visibly still "stands its ground" while the acid visibly arrives,
 *   rather than dissolving at the same instant the blob is still sliding in.
 *   A plain `setTimeout` (rather than chaining off the marching unit's own
 *   `transitionend`) is used deliberately: under reduced motion the march
 *   transition is removed entirely (see the `@media` split in style.css), so
 *   `transitionend` would simply never fire there -- `prefersReducedMotion()`
 *   lets this function skip the wait altogether in that case with one
 *   code path instead of a transitionend-plus-fallback-timer dance.
 * - Phase B (immediately if not `delayed` -- e.g. a corrosion cell spawned
 *   directly onto an occupied square rather than marching there): the ghost
 *   gets `is-corroding` (jolt/flash/crack/sink, see `piece-corrode` in
 *   style.css), an enlarged kill-burst ring fires, and any unit div(s)
 *   currently standing on the square get `is-feeding` (bubble surge).
 */
function killPieceOnSquare(
  unitsLayer: HTMLDivElement,
  piece: Piece,
  square: number,
  squarePx: SquarePx,
  board: DOMRect,
  delayed: boolean,
  unitEntriesAt: () => HTMLDivElement[]
): void {
  const ghost = createIntactGhost(unitsLayer, piece, square, squarePx, board);

  const startPhaseB = () => {
    const reduced = prefersReducedMotion();
    ghost.classList.add('is-corroding');
    // Fallback slightly longer than the 1.7s `piece-corrode`/`is-feeding`
    // CSS durations they back up (see style.css) -- both are scaled by the
    // same `--vfx-speed` via vfxSpeed() inside autoRemove/autoRemoveClass.
    autoRemove(ghost, 'animationend', reduced ? 300 : 1900);
    spawnKillBurst(unitsLayer, square, squarePx, board);
    for (const unitEl of unitEntriesAt()) {
      unitEl.classList.add('is-feeding');
      autoRemoveClass(unitEl, 'is-feeding', 'animationend', reduced ? 300 : 1800);
    }
  };

  if (delayed && !prefersReducedMotion()) {
    // 480ms matches `.corrosion-unit.is-marching`'s `translate` transition
    // duration in style.css -- keep these two in sync. Scaled by the same
    // `--vfx-speed` the CSS duration itself consumes -- see vfxSpeed()'s
    // comment -- so this wait stretches along with the march transition
    // under the VFX Lab's slow-motion toggle instead of firing at normal
    // speed while the CSS animation plays 4x slower.
    window.setTimeout(startPhaseB, 480 * vfxSpeed(unitsLayer));
  } else {
    startPhaseB();
  }
}

// Persistent unit id -> (that unit's current cell divs) map, one per
// units-sublayer element (a fresh element per new game, since
// buildGameLayout() rebuilds `boardEl` from scratch -- see main.ts). This is
// what makes per-unit animation possible: unlike the old bucket-by-square
// rendering, a unit's divs survive across renders.
//
// Entries are matched to this render's cells by EXPECTED POSITION (unchanged
// square, or one march-step away using the unit's current `dir`), not by
// array index -- a previous version keyed by `${unitId}:${cellIndex}` and
// broke when a unit lost a cell mid-array (e.g. a cls-2 unit's LEAD cell
// striking and destroying a piece, per corrosion.ts's strikeAt, which also
// removes that same cell -- the SURVIVING trail cell shifts from index 1 to
// index 0, so the old index-0 entry (the lead's div, which just died) got
// mistaken for "still alive, just standing still" while the real survivor's
// march went unrendered and a phantom death animation played at the wrong
// square. Found via the VFX Lab's "Piece killed by corrosion" scenario --
// see the exec report.
const unitMaps = new WeakMap<HTMLDivElement, Map<number, UnitDivEntry[]>>();

/**
 * Tracks the last (prev, gs) pair whose piece-destroy events (see below)
 * have already been turned into a `killPieceOnSquare` choreography, keyed
 * by units-layer element. `renderOverlays` can legitimately be called more
 * than once for the exact same (prev, gs) pair -- e.g. the danger-ring
 * affordance re-renders on every selection change, which fires again right
 * after a move completes (chessground's own `select` event covers both) --
 * and without this guard, a re-render with an unchanged (prev, gs) would
 * re-detect the same destroyed piece and spawn a second, duplicate ghost
 * playing the kill choreography twice. The spawn/march/death per-unit loop
 * above doesn't need this: it's already idempotent by construction (it
 * diffs against the persisted DOM map, not against object identity), so
 * calling it again with unchanged `gs.corrosions` just finds no changes.
 */
const lastProcessedTransition = new WeakMap<HTMLDivElement, { prev: GameState; gs: GameState }>();

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
  const currentUnitIds = new Set(gs.corrosions.map(u => u.id));

  // Death: a whole unit id that existed last render but is gone now (fully
  // annihilated, or every remaining cell died to purple/a strike in the same
  // phase).
  for (const [unitId, entries] of map) {
    if (!currentUnitIds.has(unitId)) {
      for (const entry of entries) playDeath(entry.el);
      map.delete(unitId);
    }
  }

  // Squares a corrosion cell marched onto this render (not spawned onto, not
  // already there from a prior render) -- read below by the piece-destroy
  // choreography to decide whether the kill needs to wait for the arriving
  // blob (phase A) or can start destroying immediately. Built from the
  // per-cell match loop below for SURVIVING cells; a cell that struck a
  // piece and was removed in the same corrosionPhase call (see strikeAt in
  // corrosion.ts) never appears in `gs.corrosions` to be counted there, so
  // it's topped up afterward from `prev` directly -- see the comment past
  // the loop below. Without that, a march-kill (the common case phase A
  // exists for) would skip straight to phase B every time, silently losing
  // the "acid visibly arriving" buildup for exactly the kills it matters
  // most for.
  const marchedToSquare = new Set<number>();

  // Squares where a corrosion unit was born FRESH this render (see the
  // `isSpawn` check inside the per-cell loop below) -- read by the
  // piece-destroy detection past this loop to recognize a specific
  // false-positive: `engine/game.ts`'s `applyMove` always spawns a brand-new
  // tier-1 unit at `m.from` (the CAPTURING piece's own origin square) on
  // every capturing move, unconditionally -- so that square goes from
  // "had a piece" (the mover, pre-move) to "empty" (gs.board, the mover
  // walked away) in the exact same instant it gains its first-ever
  // corrosion cell. That satisfies the naive "before && !after, square
  // touched by corrosion" kill signature perfectly despite the mover being
  // very much alive elsewhere on the board -- without this, every single
  // capturing move played a false "piece destroyed by corrosion" ghost
  // dissolve on the mover's own vacated square. A square that already had
  // corrosion touching it BEFORE this render (`prevCorrSquares`) is still
  // eligible for a real kill even if a cell there also happens to be
  // freshly (re)spawned-looking this render -- see the check below.
  const newlySpawnedSquares = new Set<number>();

  // Spawn/march/update, per unit -- matching this unit's OLD divs to its
  // CURRENT cells by expected position (see the WeakMap comment above)
  // rather than trusting array order to stay stable.
  for (const u of gs.corrosions) {
    const oldEntries = map.get(u.id) ?? [];
    const claimed = new Array<boolean>(oldEntries.length).fill(false);
    const newEntries: UnitDivEntry[] = [];

    // Match cells to old entries in three PRIORITY passes rather than one
    // combined check -- "moved" must win over "unchanged" when both are
    // possible for the same current cell, or a marching unit's cells get
    // mismatched. Concretely: lead=d4, trail=d3, dir=+1, lead strikes and
    // dies, trail survives and moves to d4 -- the surviving cell's new
    // square (d4) is BOTH "unchanged" from the dead lead's old square AND
    // "moved" from the trail's old square. Checking "unchanged" first (as an
    // earlier version of this loop did) wrongly binds the survivor to the
    // dead lead's div, leaving the actual survivor (trail) undetected as
    // having moved (no march animation) and playing the death animation at
    // the trail's old square instead of where the strike actually happened.
    // Checking "moved" first resolves the ambiguity correctly. Found via the
    // VFX Lab's "Piece killed by corrosion" scenario -- see the exec report.
    const cellMatch = new Array<number>(u.cells.length).fill(-1);
    const matchPass = (expectedOldSq: (cellSq: number) => number) => {
      u.cells.forEach((cellSq, ci) => {
        if (cellMatch[ci] !== -1) return;
        const target = expectedOldSq(cellSq);
        for (let i = 0; i < oldEntries.length; i++) {
          if (claimed[i] || oldEntries[i].sq !== target) continue;
          cellMatch[ci] = i;
          claimed[i] = true;
          break;
        }
      });
    };
    matchPass(cellSq => cellSq - u.dir * gs.size); // moved forward by dir
    matchPass(cellSq => cellSq); // unchanged (non-mover this phase)
    matchPass(cellSq => cellSq + u.dir * gs.size); // moved backward (dir just flipped)

    u.cells.forEach((cellSq, ci) => {
      const matchIdx = cellMatch[ci];
      const pos = squarePx(cellSq);
      const inset = purpleSquares.has(cellSq) ? pos.w * 0.12 : 0;
      const x = pos.x - board.left + inset;
      const y = pos.y - board.top + inset;
      const size = pos.w - inset * 2;

      let entry: UnitDivEntry;
      const isSpawn = matchIdx === -1;
      if (!isSpawn) {
        // `claimed[matchIdx]` was already set true inside matchPass above.
        entry = oldEntries[matchIdx];
      } else {
        const el = document.createElement('div');
        const sprite = document.createElement('div');
        sprite.className = 'corrosion-unit-sprite';
        const chevrons = document.createElement('div');
        chevrons.className = 'corrosion-unit-chevrons';
        // 2-3 leading-edge chevrons (see marchAngleDeg / the CSS `--march-angle`
        // custom property for the direction math); populated once here, styled
        // and animated entirely from CSS/the custom property below.
        chevrons.innerHTML = '<span class="chevron"></span><span class="chevron"></span><span class="chevron"></span>';
        el.append(sprite, chevrons);
        unitsLayer.appendChild(el);
        entry = { el, sprite, chevrons, sq: cellSq };
      }

      // Donut/ring instead of a solid blob when a piece currently occupies
      // this square (a friendly pass-through co-occupancy, e.g. corrosion
      // spawning onto the capturing piece's own square) -- the raised
      // opacities below would otherwise fully hide the piece under the blob.
      // The sprite texture is hidden and the flat `--donut` gradient ring
      // (already correct and verified) takes over as the sole visible layer --
      // simpler and lower-risk than mask-image-ing a hole into a photographed
      // sprite, and explicitly sanctioned as the fallback for this case.
      const hasPiece = gs.board[cellSq] != null;
      entry.el.className = unitVariantClass(u.color, u.cls) + (hasPiece ? ' corrosion-unit--donut' : '');
      entry.el.style.width = `${size}px`;
      entry.el.style.height = `${size}px`;
      entry.sprite.style.backgroundImage = `url(${spriteFor(u.color, u.cls, u.id)})`;
      entry.sprite.style.display = hasPiece ? 'none' : '';
      // Drives both the chevrons' pointing direction and (via the same
      // variable, see style.css) the drips' bias toward the trailing/back
      // edge -- recomputed every render since a class-3 unit's `dir` flips
      // when it bounces off a board edge.
      entry.el.style.setProperty('--march-angle', `${marchAngleDeg(cellSq, u.dir, gs.size, squarePx)}deg`);

      if (isSpawn) newlySpawnedSquares.add(cellSq);
      const moved = !isSpawn && entry.sq !== cellSq;
      if (moved) marchedToSquare.add(cellSq);
      // Standalone `translate`, not the `transform` shorthand -- see the
      // comment in createIntactGhost above. The idle `acid-pulse` keyframes
      // animate the standalone `scale` property and `march-wobble` animates
      // the `transform` shorthand; all three are independent properties that
      // compose, so this position, the idle pulse, and the march wobble can
      // all be in effect on the same div at once without one clobbering
      // another the way two rules both setting `transform` would.
      entry.el.style.translate = `${x}px ${y}px`;
      entry.sq = cellSq;

      if (isSpawn) {
        if (!firstRender) {
          entry.el.classList.add('is-spawning');
          autoRemoveClass(entry.el, 'is-spawning', 'animationend', 500);
        }
      } else if (moved) {
        entry.el.classList.add('is-marching');
        autoRemoveClass(entry.el, 'is-marching', 'transitionend', 550);
      }

      newEntries.push(entry);
    });

    // Old cells of THIS unit that found no match this render died this
    // phase (e.g. a lead cell that struck a piece while its trail sibling
    // survived, or lost to purple/annihilation individually).
    for (let i = 0; i < oldEntries.length; i++) {
      if (!claimed[i]) playDeath(oldEntries[i].el);
    }

    map.set(u.id, newEntries);
  }

  // Top up `marchedToSquare` with cells that marched into a square and were
  // immediately consumed striking a piece there (see the comment above this
  // set's declaration) -- computed straight from `prev`, since such a cell
  // never survives into `gs.corrosions` for the loop above to have counted
  // it. Uses each prev unit's OWN `dir`, which is correct for cls-1/2 (never
  // flips mid-strike); a cls-3 bounce technically flips `dir` before this
  // same phase's movement, so this could in principle miss a cls-3 strike's
  // phase-A timing right at a bounce, but cls-3's hostile-with-everything
  // semantics make that a narrow edge case, not the common one this exists
  // for.
  if (prev) {
    for (const u of prev.corrosions) {
      for (const c of u.cells) marchedToSquare.add(c + u.dir * gs.size);
    }
  }

  // Piece destroyed by corrosion: was a piece before the last applied move,
  // is empty now, and the square was touched by a corrosion cell either
  // before or after the move. A normal capture never satisfies this because
  // the capturing piece is standing on the square in `gs.board` -- except en
  // passant, which vacates the captured pawn's square without the capturing
  // pawn ever landing there, so that case needs an explicit exclusion (see
  // isEnPassantVacate).
  const lastTransition = lastProcessedTransition.get(unitsLayer);
  const alreadyProcessed = !!lastTransition && lastTransition.prev === prev && lastTransition.gs === gs;
  if (!firstRender && prev && !alreadyProcessed) {
    lastProcessedTransition.set(unitsLayer, { prev, gs });
    const prevCorrSquares = allCorrosionSquares(prev);
    const currCorrSquares = allCorrosionSquares(gs);
    const size = gs.size;
    for (let sq = 0; sq < size * size; sq++) {
      const before = prev.board[sq];
      const after = gs.board[sq];
      // A square whose ONLY corrosion is a unit born THIS render, with no
      // corrosion touching it before -- always the mover's-own-origin
      // false positive above, never a real kill (see newlySpawnedSquares).
      const isFreshSpawnResidue = newlySpawnedSquares.has(sq) && !prevCorrSquares.has(sq);
      if (
        before &&
        !after &&
        (prevCorrSquares.has(sq) || currCorrSquares.has(sq)) &&
        !isFreshSpawnResidue &&
        !isEnPassantVacate(prev, gs, sq, before)
      ) {
        killPieceOnSquare(unitsLayer, before, sq, squarePx, board, marchedToSquare.has(sq), () =>
          [...map.values()].flat().filter(entry => entry.sq === sq).map(entry => entry.el)
        );
      }
    }
  }
}

/**
 * Purple base tint, in its OWN sublayer beneath `.corrosion-units-layer`
 * (see renderOverlays) rather than inside the badges/skull info layer. Used
 * to sit inside the same marker as the skull/badges, both stacked above the
 * whole units layer -- which meant a live corrosion cell standing on its own
 * purple square (the common case for class-3, which repaints purple under
 * itself every surviving phase) was almost entirely hidden underneath the
 * purple tint, sprite/chevrons included, no matter how the unit itself was
 * inset. Splitting the void into its own bottom-most sublayer restores the
 * originally-intended stacking (purple base -> corrosion -> badges/skull,
 * all legible at once) without touching the skull/badge code below at all.
 */
function renderVoid(voidLayer: HTMLDivElement, gs: GameState, prev: GameState | null | undefined, squarePx: SquarePx, board: DOMRect): void {
  voidLayer.replaceChildren();

  const purpleSquares = new Set(gs.purple);
  const prevPurpleSquares = new Set(prev?.purple ?? []);
  const firstRender = prev == null;

  for (const square of purpleSquares) {
    const pos = squarePx(square);
    const purpleBg = document.createElement('div');
    purpleBg.className = 'corrosion-purple-bg';
    purpleBg.style.left = `${pos.x - board.left}px`;
    purpleBg.style.top = `${pos.y - board.top}px`;
    purpleBg.style.width = `${pos.w}px`;
    purpleBg.style.height = `${pos.w}px`;
    if (!firstRender && !prevPurpleSquares.has(square)) purpleBg.classList.add('is-purpling');
    voidLayer.appendChild(purpleBg);
  }
}

function renderInfo(infoLayer: HTMLDivElement, gs: GameState, squarePx: SquarePx, board: DOMRect): void {
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

    // Skull is still in this (topmost) layer -- "painted last, always on
    // top" -- so it never gets washed out by the corrosion unit now sitting
    // visually above the purple tint in the layer between this one and the
    // void layer below.
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
 * True when a corrosion cell at `sq` is hostile to `moverColor` -- i.e. the
 * exact same rule legal.ts's `resolveCorrosionCapture` uses to decide
 * whether landing there triggers the capture/mutual-destruction resolution
 * (opposite color, or class-3 regardless of color). A square with only
 * FRIENDLY non-class-3 corrosion is safe to land on (harmless
 * co-occupancy per the README) and gets no danger-ring treatment.
 */
function hostileCorrosionAt(gs: GameState, sq: number, moverColor: Color): boolean {
  return gs.corrosions.some(u => u.cells.includes(sq) && (u.cls === 3 || u.color !== moverColor));
}

/**
 * The danger/safe-capture ring affordance: for the currently selected piece
 * (if any), flags every one of its legal destination squares that holds
 * HOSTILE corrosion. A king gets a visually distinct "safe capture" ring
 * instead of a danger one -- kings destroy any hostile corrosion they land
 * on for free (see legal.ts's resolveCorrosionCapture: `!moverIsKing` is
 * what gates the mover itself also being destroyed), everything else dies
 * along with the corrosion it captures. Rendered in its own topmost
 * sublayer (see renderOverlays) so it's never washed out by a unit's own
 * blob/badges/void sitting underneath it, and is always fully rebuilt
 * (`replaceChildren`) each call since it has no persistent-across-renders
 * state to preserve -- unlike the units layer, there's nothing here to
 * animate BETWEEN renders, only to show or hide per the current selection.
 */
function renderDanger(dangerLayer: HTMLDivElement, gs: GameState, selection: SelectionInfo | null | undefined, squarePx: SquarePx, board: DOMRect): void {
  dangerLayer.replaceChildren();
  if (!selection) return;

  const piece = gs.board[selection.sq];
  if (!piece) return; // stale selection (e.g. the piece there got captured/moved since it was selected)

  const isKing = piece.type === 'k';

  for (const dest of selection.dests) {
    if (!hostileCorrosionAt(gs, dest, piece.color)) continue;
    const pos = squarePx(dest);
    const marker = document.createElement('div');
    marker.className = `corrosion-danger-marker corrosion-danger-marker--${isKing ? 'safe' : 'hostile'}`;
    marker.style.left = `${pos.x - board.left}px`;
    marker.style.top = `${pos.y - board.top}px`;
    marker.style.width = `${pos.w}px`;
    marker.style.height = `${pos.w}px`;

    const badge = document.createElement('div');
    badge.className = 'corrosion-danger-badge';
    badge.textContent = isKing ? '🛡' : '☠';
    marker.appendChild(badge);

    dangerLayer.appendChild(marker);
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
 *
 * `selection`, when present, is the currently selected square and its legal
 * destinations (see SelectionInfo) -- drives the danger/safe-capture ring
 * affordance on hostile-corrosion destination squares. Callers should
 * re-invoke `renderOverlays` with the SAME `gs`/`prev` whenever selection
 * changes (see BoardView.onSelect) to keep this in sync as the player
 * clicks around, independent of a full game-state re-render; that's safe to
 * do repeatedly -- everything else in this function is either idempotent
 * (the units diff) or explicitly guarded against double-firing for an
 * unchanged (prev, gs) pair (the piece-destroy choreography).
 */
export function renderOverlays(
  container: HTMLElement,
  view: BoardView,
  gs: GameState,
  prev?: GameState | null,
  selection?: SelectionInfo | null
): void {
  const layer = ensureLayer(container);

  const { boardPx, squarePx } = view.squareEl();
  const board = boardPx();
  const containerRect = container.getBoundingClientRect();
  layer.style.left = `${board.left - containerRect.left}px`;
  layer.style.top = `${board.top - containerRect.top}px`;
  layer.style.width = `${board.width}px`;
  layer.style.height = `${board.height}px`;

  // DOM order matters here -- see the comment above renderVoid -- and
  // ensureSublayer only creates a layer once and appends in call order, so
  // this order (void, units, info, danger) is also the paint order: purple
  // base tint at the bottom, corrosion units above it, badges/skull above
  // that, and the selection-driven danger/safe ring topmost of all -- it's
  // an active input affordance the player needs to see clearly regardless
  // of whatever else is happening on that square.
  const voidLayer = ensureSublayer(layer, VOID_LAYER_CLASS);
  const unitsLayer = ensureSublayer(layer, UNITS_LAYER_CLASS);
  const infoLayer = ensureSublayer(layer, INFO_LAYER_CLASS);
  const dangerLayer = ensureSublayer(layer, DANGER_LAYER_CLASS);

  renderVoid(voidLayer, gs, prev, squarePx, board);
  renderUnits(unitsLayer, gs, prev, squarePx, board);
  renderInfo(infoLayer, gs, squarePx, board);
  renderDanger(dangerLayer, gs, selection, squarePx, board);
}
