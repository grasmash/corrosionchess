export interface BoardTheme {
  id: string;
  label: string;
  light: string;
  dark: string;
  /** Last-move highlight color (translucent). Kept the same
   * chess.com-style yellow-green across every theme -- like chess.com's own
   * board skins, only the square colors change per theme; the highlight
   * overlay stays a consistent, always-legible yellow. */
  lastmove: string;
}

const LASTMOVE = 'rgba(245, 246, 130, 0.5)';

/**
 * Mirrors piecesets.ts's manifest shape/API. `green` is the default (and
 * must stay first -- matches style.css's `:root` fallback values).
 */
export const BOARD_THEMES: BoardTheme[] = [
  { id: 'green', label: 'Green', light: '#ebecd0', dark: '#779556', lastmove: LASTMOVE },
  { id: 'brown', label: 'Brown', light: '#f0d9b5', dark: '#b58863', lastmove: LASTMOVE },
  { id: 'blue', label: 'Blue', light: '#dee3e6', dark: '#8ca2ad', lastmove: LASTMOVE },
  { id: 'purple', label: 'Purple', light: '#e8e0ec', dark: '#9f7fbd', lastmove: LASTMOVE },
  { id: 'walnut', label: 'Walnut', light: '#e6d1b1', dark: '#8b6d4f', lastmove: LASTMOVE },
  { id: 'slate', label: 'Slate', light: '#c7cdd1', dark: '#5b6975', lastmove: LASTMOVE },
];

const STORAGE_KEY = 'boardtheme';

function isKnownTheme(id: string): boolean {
  return BOARD_THEMES.some(t => t.id === id);
}

/** Reads the persisted board-theme id, falling back to `'green'` if nothing
 * is stored, the value doesn't match a known theme, or `localStorage`
 * throws (private-browsing/storage-disabled -- see piecesets.ts's
 * `currentPieceSet` for the same guard and rationale). */
export function currentBoardTheme(): string {
  let stored: string | null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    return 'green';
  }
  return stored && isKnownTheme(stored) ? stored : 'green';
}

/** Persists the choice and immediately re-skins the live board. Swallows a
 * persistence failure (see `currentBoardTheme`) -- the in-memory re-skin via
 * `applyBoardTheme` still happens either way. */
export function setBoardTheme(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* storage unavailable -- re-skin still applies for this session */
  }
  applyBoardTheme(id);
}

/**
 * Sets the three `--board-*` custom properties on `:root` that style.css's
 * board-square/last-move rules read via `var(...)` -- no cgboard/adapter
 * changes needed, same mechanism as piecesets.ts's injected stylesheet but
 * even simpler since these are just CSS variables, not per-piece rules.
 */
export function applyBoardTheme(id: string): void {
  // No-op outside a browser -- keeps this module importable/testable
  // without a DOM shim (mirrors piecesets.ts's applyPieceSet).
  if (typeof document === 'undefined') return;
  const theme = BOARD_THEMES.find(t => t.id === id) ?? BOARD_THEMES[0];
  const root = document.documentElement.style;
  root.setProperty('--board-light', theme.light);
  root.setProperty('--board-dark', theme.dark);
  root.setProperty('--board-lastmove', theme.lastmove);
}
