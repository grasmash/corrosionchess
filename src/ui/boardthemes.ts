export interface BoardTheme {
  id: string;
  label: string;
  light: string;
  dark: string;
  /** Last-move highlight color (translucent). Kept the same
   * chess.com-style yellow-green across every theme -- like chess.com's own
   * board skins, only the square colors change per theme; the highlight
   * overlay stays a consistent, always-legible yellow -- EXCEPT 'corroded'
   * (plan 006), which dims this to a translucent acid green so the
   * highlight doesn't clash with the theme's dark-world palette. */
  lastmove: string;
  /** Optional tileable texture URLs (plan 006) layered over the flat
   * light/dark checker via style.css's `--board-*-tex` custom props; themes
   * without these render as flat color exactly as before. `none` (the CSS
   * keyword, not JS `undefined`) is what style.css's fallback expects when a
   * theme doesn't set one. */
  lightTex?: string;
  darkTex?: string;
}

const LASTMOVE = 'rgba(245, 246, 130, 0.5)';
/** Dim acid-green last-move highlight, used only by 'corroded' -- see the
 * `lastmove` doc comment above. */
const CORRODED_LASTMOVE = 'rgba(127, 255, 90, 0.25)';

/**
 * Mirrors piecesets.ts's manifest shape/API. `green` is the default (and
 * must stay first -- matches style.css's `:root` fallback values).
 * 'corroded' (plan 006) is the DEFAULT for new users -- see
 * `currentBoardTheme` below -- carrying the key art's dark-world look into
 * gameplay; it stays last in this list so existing persisted indices/tests
 * that reference the first six themes by position are undisturbed.
 */
export const BOARD_THEMES: BoardTheme[] = [
  { id: 'green', label: 'Green', light: '#ebecd0', dark: '#779556', lastmove: LASTMOVE },
  { id: 'brown', label: 'Brown', light: '#f0d9b5', dark: '#b58863', lastmove: LASTMOVE },
  { id: 'blue', label: 'Blue', light: '#dee3e6', dark: '#8ca2ad', lastmove: LASTMOVE },
  { id: 'purple', label: 'Purple', light: '#e8e0ec', dark: '#9f7fbd', lastmove: LASTMOVE },
  { id: 'walnut', label: 'Walnut', light: '#e6d1b1', dark: '#8b6d4f', lastmove: LASTMOVE },
  { id: 'slate', label: 'Slate', light: '#c7cdd1', dark: '#5b6975', lastmove: LASTMOVE },
  {
    id: 'corroded',
    label: 'Corroded',
    // Lightened from the original #3a3d3a, and further than the first
    // #4a4e4a pass (redesign follow-up): the dark stone texture's own
    // luminance is very low (median ~21/255 -- it's meant to read as
    // near-black), and `multiply` blending is MULTIPLICATIVE, so it crushes
    // a modest light/dark gap down to single digits regardless (measured:
    // #4a4e4a vs `dark` #1f2320 still only differed by ~7-15/255 once
    // blended at the overlay's original 0.9 opacity -- not "obvious at a
    // glance"). This wider gap against `dark` (#1f2320), combined with the
    // overlay opacity coming down to 0.6 below (style.css), is tuned to
    // clear ~40/255 post-blend -- see that rule's own comment for the math.
    light: '#6e7268',
    dark: '#1f2320',
    lastmove: CORRODED_LASTMOVE,
    lightTex: 'vfx/board/stone-light.png',
    darkTex: 'vfx/board/stone-dark.png',
  },
];

const STORAGE_KEY = 'boardtheme';
/** New-user default (plan 006) -- the key art's look is the game's identity,
 * so a fresh browser lands on 'corroded' rather than 'green'. Anyone with an
 * existing persisted choice (including 'green') is untouched -- this only
 * affects the fallback path in `currentBoardTheme` below. */
const DEFAULT_THEME = 'corroded';

function isKnownTheme(id: string): boolean {
  return BOARD_THEMES.some(t => t.id === id);
}

/** Reads the persisted board-theme id, falling back to `DEFAULT_THEME` if
 * nothing is stored, the value doesn't match a known theme, or
 * `localStorage` throws (private-browsing/storage-disabled -- see
 * piecesets.ts's `currentPieceSet` for the same guard and rationale). */
export function currentBoardTheme(): string {
  let stored: string | null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    return DEFAULT_THEME;
  }
  return stored && isKnownTheme(stored) ? stored : DEFAULT_THEME;
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
 * Sets the `--board-*` custom properties on `:root` that style.css's
 * board-square/last-move rules read via `var(...)` -- no cgboard/adapter
 * changes needed, same mechanism as piecesets.ts's injected stylesheet but
 * even simpler since these are just CSS variables, not per-piece rules.
 * Also stamps `data-boardtheme` on `<body>` (plan 006) so style.css can key
 * the page-wide "game ambience" backdrop (hero art + vignette) to the
 * corroded theme specifically, without a third mechanism alongside these
 * custom props.
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
  // Resolve the base-relative texture paths against the document base HERE,
  // not in CSS: a relative url() carried through a custom property gets
  // resolved against the stylesheet that consumes it (the built
  // assets/index-*.css on a production build), not the page -- which 404s
  // under the GitHub Pages subpath deploy.
  root.setProperty('--board-light-tex', theme.lightTex ? `url(${new URL(theme.lightTex, document.baseURI).href})` : 'none');
  root.setProperty('--board-dark-tex', theme.darkTex ? `url(${new URL(theme.darkTex, document.baseURI).href})` : 'none');
  document.body.dataset.boardtheme = theme.id;
}
