import type { CorrosionUnit, GameState, PieceType } from './types';
import { rankOf, toAlg } from './board';

export function addPurple(s: GameState, sq: number): void {
  if (!s.purple.includes(sq)) s.purple.push(sq);
}

function hostile(a: CorrosionUnit, b: CorrosionUnit): boolean {
  return a.color !== b.color || a.cls === 3 || b.cls === 3;
}

const PIECE_NAMES: Record<PieceType, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

function pieceName(t: PieceType): string {
  return PIECE_NAMES[t];
}

type Moved = { unit: CorrosionUnit; from: number; to: number };

export function corrosionPhase(s: GameState): void {
  const size = s.size;

  // 1. movers = units with bornRound < s.round
  const movers = s.corrosions.filter(u => u.bornRound < s.round);

  // 2. For each mover of cls 3: if next rank off-board, flip dir. Then paint
  //    every cell it currently occupies purple (dedup) — it "leaves" them.
  for (const u of movers) {
    if (u.cls === 3) {
      const nextRank = rankOf(u.cells[0], size) + u.dir;
      if (nextRank < 0 || nextRank >= size) u.dir = (u.dir * -1) as 1 | -1;
      for (const c of u.cells) addPurple(s, c);
    }
  }

  // 3. Move: every mover's cells += dir * size. cls 1/2 cells that would leave
  //    the board are dropped (promotion logic arrives in Task 7); unit removed
  //    if it ends up empty. Recorded as a plain list, NOT a Map keyed by
  //    origin square: two movers can share an origin square (e.g. same-color
  //    units that converged onto one cell in an earlier phase), and a
  //    Map<square, ...> would silently overwrite/drop one of them.
  const moved: Moved[] = [];
  for (const u of movers) {
    const newCells: number[] = [];
    for (const c of u.cells) {
      const rank = rankOf(c, size);
      const newRank = rank + u.dir;
      if (u.cls !== 3 && (newRank < 0 || newRank >= size)) {
        // dropped — off-board guard for cls 1/2 (Task 7 handles promotion)
        continue;
      }
      const niu = c + u.dir * size;
      newCells.push(niu);
      moved.push({ unit: u, from: c, to: niu });
    }
    u.cells = newCells;
  }

  // 4. Swap annihilation: for every pair of units hostile to each other where
  //    some cell of A moved old->new and some cell of B moved new->old (exact
  //    swap), destroy both those cells. Movers only — dormant cells never
  //    moved, so they cannot participate in a swap.
  const destroyed = new Set<Moved>();
  for (let i = 0; i < moved.length; i++) {
    const a = moved[i];
    if (destroyed.has(a)) continue;
    for (let j = 0; j < moved.length; j++) {
      if (i === j) continue;
      const b = moved[j];
      if (destroyed.has(b)) continue;
      if (a.unit === b.unit) continue;
      if (!hostile(a.unit, b.unit)) continue;
      if (a.from === b.to && a.to === b.from) {
        destroyed.add(a);
        destroyed.add(b);
      }
    }
  }
  for (const m of destroyed) {
    m.unit.cells = m.unit.cells.filter(c => c !== m.to);
  }

  // 5. Same-square annihilation: group ALL surviving cells (movers AND
  //    dormant born-this-round units — a corrosion of one color intersecting
  //    a corrosion of another destroys both, whether or not either moved) by
  //    square; if a square holds cells from two units hostile to each other,
  //    destroy ALL cells on that square.
  const cellOwners = new Map<number, CorrosionUnit[]>();
  for (const u of s.corrosions) {
    for (const c of u.cells) {
      const arr = cellOwners.get(c) ?? [];
      arr.push(u);
      cellOwners.set(c, arr);
    }
  }
  for (const [square, owners] of cellOwners) {
    let anyHostilePair = false;
    for (let i = 0; i < owners.length && !anyHostilePair; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        if (owners[i] !== owners[j] && hostile(owners[i], owners[j])) {
          anyHostilePair = true;
          break;
        }
      }
    }
    if (anyHostilePair) {
      for (const u of owners) u.cells = u.cells.filter(c => c !== square);
    }
  }

  // 6. Purple deaths: any cell of cls 1/2 standing on purple is destroyed
  //    (cls 3 immune) — applies to ALL units' cells, movers and dormant
  //    born-this-round units alike, consistent with the step-5 ruling.
  for (const u of s.corrosions) {
    if (u.cls === 3) continue;
    u.cells = u.cells.filter(c => {
      if (!s.purple.includes(c)) return true;
      s.log.push({ round: s.round, text: `Corrosion dies in purple at ${toAlg(c, size)}` });
      return false;
    });
  }

  // Surviving mover cells for step 7, now that steps 4-6 have finished
  // destroying cells (movers only — dormant cells never strike).
  const survivors = moved.filter(m => m.unit.cells.includes(m.to));

  // 7. Strikes: for each surviving mover cell, p = board[cell]
  for (const m of survivors) {
    if (!m.unit.cells.includes(m.to)) continue; // consumed by an earlier strike this same loop
    const p = s.board[m.to];
    if (!p) continue;
    const alg = toAlg(m.to, size);
    if (p.type === 'k') {
      m.unit.cells = m.unit.cells.filter(c => c !== m.to);
      s.log.push({ round: s.round, text: 'Corrosion blocked by king' });
    } else if (m.unit.cls === 3) {
      s.board[m.to] = null;
      m.unit.cells = m.unit.cells.filter(c => c !== m.to);
      s.log.push({ round: s.round, text: `Corrosion destroys ${pieceName(p.type)} at ${alg}` });
    } else if (p.color !== m.unit.color) {
      s.board[m.to] = null;
      m.unit.cells = m.unit.cells.filter(c => c !== m.to);
      s.log.push({ round: s.round, text: `Corrosion destroys ${pieceName(p.type)} at ${alg}` });
    }
    // else: cls 1/2 && friendly — nothing (co-occupies)
  }

  // 8. Remove units with zero cells. (Promotions appended here by Task 7.)
  //    This is the only place s.corrosions needs filtering: every step above
  //    checks/mutates unit.cells directly (never s.corrosions membership), so
  //    an emptied-but-not-yet-removed unit simply contributes zero cells to
  //    any intermediate pass and is harmless until this final cleanup.
  s.corrosions = s.corrosions.filter(u => u.cells.length > 0);
}
