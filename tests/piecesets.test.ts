import { it, expect, beforeEach } from 'vitest';
import { PIECE_SETS, currentPieceSet, setPieceSet, pieceImageUrl } from '../src/ui/piecesets';

/** Minimal in-memory localStorage stub -- vitest's default (jsdom-less) node
 * environment has no `localStorage` global, and even under jsdom we don't
 * want state leaking between tests. Reassigned fresh before each test. */
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

it('manifest lists classic first, unique ids, and includes all six generated sets', () => {
  const ids = PIECE_SETS.map(s => s.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids[0]).toBe('classic');
  expect(PIECE_SETS[0].builtin).toBe(true);
  for (const id of ['fireice', 'halloween', 'pets', 'dessert', 'mythical', 'robots', 'aliens', 'medieval', 'greek', 'dinosaurs', 'christmas']) {
    expect(ids).toContain(id);
  }
});

it('pieceImageUrl formats a pieces/<id>/<key>.png path', () => {
  expect(pieceImageUrl('fireice', 'wk')).toBe('pieces/fireice/wk.png');
  expect(pieceImageUrl('robots', 'bp')).toBe('pieces/robots/bp.png');
});

it('currentPieceSet defaults to classic when nothing is stored', () => {
  expect(currentPieceSet()).toBe('classic');
});

it('currentPieceSet falls back to classic on an unknown/garbage stored value', () => {
  localStorage.setItem('pieceset', 'not-a-real-set');
  expect(currentPieceSet()).toBe('classic');
});

it('setPieceSet persists a valid id, readable back via currentPieceSet', () => {
  setPieceSet('halloween');
  expect(localStorage.getItem('pieceset')).toBe('halloween');
  expect(currentPieceSet()).toBe('halloween');
});
