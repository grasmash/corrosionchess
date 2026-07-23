export interface PieceSet {
  id: string;
  label: string;
  /** True only for the built-in cburnett set, which has no generated PNGs
   * and needs no injected stylesheet -- see `applyPieceSet`. */
  builtin?: boolean;
}

/**
 * Only sets with a COMPLETE 12-PNG folder under `public/pieces/<id>/` belong
 * here. `christmas`, `greek`, `aliens`, `medieval`, `dinosaurs` are missing
 * art (pipeline blocked) -- adding one is a one-line change once its folder
 * is complete, but do not list it before then.
 */
export const PIECE_SETS: PieceSet[] = [
  { id: 'classic', label: 'Classic', builtin: true },
  { id: 'fireice', label: 'Ice vs Fire' },
  { id: 'halloween', label: 'Halloween' },
  { id: 'pets', label: 'Dogs vs Cats' },
  { id: 'dessert', label: 'Dessert' },
  { id: 'mythical', label: 'Mythical' },
  { id: 'robots', label: 'Robots' },
];

const STORAGE_KEY = 'pieceset';
const STYLE_EL_ID = 'pieceset-style';

/** role letter × color letter -> the cburnett-scheme class pair rendered by
 * chessgroundx's util.js pieceClasses() (confirmed in pieces-cburnett.css):
 * `.cg-wrap piece.<role>-piece.<color>`, roles p/n/b/r/q/k, colors
 * white/black (full words, not w/b). */
const ROLE_LETTERS = ['p', 'n', 'b', 'r', 'q', 'k'] as const;
const COLORS: { letter: 'w' | 'b'; cssClass: 'white' | 'black' }[] = [
  { letter: 'w', cssClass: 'white' },
  { letter: 'b', cssClass: 'black' },
];

function isKnownSet(id: string): boolean {
  return PIECE_SETS.some(s => s.id === id);
}

/** Reads the persisted piece-set id, falling back to `'classic'` if nothing
 * is stored or the stored value doesn't match a known set (e.g. an old id
 * from a since-removed set, or hand-edited localStorage). */
export function currentPieceSet(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored && isKnownSet(stored) ? stored : 'classic';
}

/** Persists the choice and immediately re-skins any mounted board. */
export function setPieceSet(id: string): void {
  localStorage.setItem(STORAGE_KEY, id);
  applyPieceSet(id);
}

/** `pieces/<id>/<key>.png`, `key` being the two-letter color+role code (e.g.
 * `wk`, `bp`) chessgroundx-style asset naming already uses. Relative (no
 * leading slash) so it resolves under Vite's base path in both dev and a
 * subpath-deployed build. */
export function pieceImageUrl(id: string, key: string): string {
  return `pieces/${id}/${key}.png`;
}

function getOrCreateStyleEl(): HTMLStyleElement {
  let el = document.getElementById(STYLE_EL_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_EL_ID;
    document.head.appendChild(el);
  }
  return el;
}

/**
 * Overrides the cburnett background-images with a generated set's PNGs by
 * filling a single injected `<style>` element -- no cgboard/adapter changes
 * needed since chessgroundx pieces are plain CSS backgrounds keyed by class.
 * `'classic'` (or any unknown id) empties the style element, which falls
 * back to pieces-cburnett.css's own rules.
 */
export function applyPieceSet(id: string): void {
  // No-op outside a browser (e.g. under vitest's DOM-free node environment,
  // where setPieceSet's persistence logic is exercised without a real page)
  // -- keeps this module importable/testable without a DOM shim.
  if (typeof document === 'undefined') return;
  const styleEl = getOrCreateStyleEl();
  const set = PIECE_SETS.find(s => s.id === id);

  if (!set || set.builtin) {
    styleEl.textContent = '';
    return;
  }

  const rules: string[] = [];
  for (const role of ROLE_LETTERS) {
    for (const { letter, cssClass } of COLORS) {
      const key = `${letter}${role}`;
      const url = pieceImageUrl(id, key);
      rules.push(
        `.cg-wrap piece.${role}-piece.${cssClass} { background-image: url('${url}'); background-size: contain; }`
      );
    }
  }
  styleEl.textContent = rules.join('\n');
}
