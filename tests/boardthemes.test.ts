import { it, expect, beforeEach } from 'vitest';
import { BOARD_THEMES, currentBoardTheme, setBoardTheme } from '../src/ui/boardthemes';

/** Same in-memory localStorage stub pattern as tests/piecesets.test.ts. */
function makeStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = makeStorageStub();
});

const HEX_RE = /^#[0-9a-f]{6}$/i;

it('manifest lists green first (matches style.css :root fallback), unique ids, and valid hex colors', () => {
  const ids = BOARD_THEMES.map(t => t.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids[0]).toBe('green');
  for (const t of BOARD_THEMES) {
    expect(t.light).toMatch(HEX_RE);
    expect(t.dark).toMatch(HEX_RE);
    expect(typeof t.lastmove).toBe('string');
    expect(t.lastmove.length).toBeGreaterThan(0);
  }
  for (const id of ['green', 'brown', 'blue', 'purple', 'walnut', 'slate', 'corroded']) {
    expect(ids).toContain(id);
  }
});

it('corroded theme (plan 006 default) carries both texture URLs; other themes carry neither', () => {
  const corroded = BOARD_THEMES.find(t => t.id === 'corroded')!;
  // Base-relative (no leading slash): the app deploys under a subpath on
  // GitHub Pages (grasmash.github.io/corrosionchess/), where absolute /vfx/
  // URLs 404 — see vite.config.ts's `base: './'` comment.
  expect(corroded.lightTex).toBe('vfx/board/stone-light.png');
  expect(corroded.darkTex).toBe('vfx/board/stone-dark.png');
  for (const t of BOARD_THEMES.filter(t => t.id !== 'corroded')) {
    expect(t.lightTex).toBeUndefined();
    expect(t.darkTex).toBeUndefined();
  }
});

it('currentBoardTheme defaults to corroded when nothing is stored (plan 006: new-user default)', () => {
  expect(currentBoardTheme()).toBe('corroded');
});

it('currentBoardTheme falls back to corroded on an unknown/garbage stored value', () => {
  localStorage.setItem('boardtheme', 'not-a-real-theme');
  expect(currentBoardTheme()).toBe('corroded');
});

it('currentBoardTheme respects an existing persisted green choice (plan 006: default change does not migrate prior users)', () => {
  localStorage.setItem('boardtheme', 'green');
  expect(currentBoardTheme()).toBe('green');
});

it('setBoardTheme persists a valid id, readable back via currentBoardTheme', () => {
  setBoardTheme('brown');
  expect(localStorage.getItem('boardtheme')).toBe('brown');
  expect(currentBoardTheme()).toBe('brown');
});
