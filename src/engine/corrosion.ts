import type { CorrosionUnit, GameState } from './types';
import { rankOf, toAlg } from './board';

export function addPurple(s: GameState, sq: number): void {
  if (!s.purple.includes(sq)) s.purple.push(sq);
}

function hostile(a: CorrosionUnit, b: CorrosionUnit): boolean {
  return a.color !== b.color || a.cls === 3 || b.cls === 3;
}

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
  //    if it ends up empty.
  const oldToNew = new Map<number, { unit: CorrosionUnit; old: number; niu: number }>();
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
      oldToNew.set(c, { unit: u, old: c, niu });
    }
    u.cells = newCells;
  }
  s.corrosions = s.corrosions.filter(u => u.cells.length > 0);

  // Build the set of surviving mover cells (post-move) with their unit + origin.
  type Moved = { unit: CorrosionUnit; from: number; to: number };
  const moved: Moved[] = [];
  for (const entry of oldToNew.values()) {
    if (entry.unit.cells.includes(entry.niu)) {
      moved.push({ unit: entry.unit, from: entry.old, to: entry.niu });
    }
  }

  // 4. Swap annihilation: for every pair of units hostile to each other where
  //    some cell of A moved old->new and some cell of B moved new->old (exact
  //    swap), destroy both those cells.
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

  // 5. Same-square annihilation: group surviving moved cells by square; if a
  //    square holds cells from two units hostile to each other, destroy ALL
  //    cells on that square.
  const bySquare = new Map<number, Moved[]>();
  for (const m of moved) {
    if (destroyed.has(m)) continue;
    const arr = bySquare.get(m.to) ?? [];
    arr.push(m);
    bySquare.set(m.to, arr);
  }
  for (const [, group] of bySquare) {
    let anyHostilePair = false;
    for (let i = 0; i < group.length && !anyHostilePair; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[i].unit !== group[j].unit && hostile(group[i].unit, group[j].unit)) {
          anyHostilePair = true;
          break;
        }
      }
    }
    if (anyHostilePair) {
      for (const m of group) destroyed.add(m);
    }
  }

  for (const m of destroyed) {
    m.unit.cells = m.unit.cells.filter(c => c !== m.to);
  }
  s.corrosions = s.corrosions.filter(u => u.cells.length > 0);

  const survivors = moved.filter(m => !destroyed.has(m) && m.unit.cells.includes(m.to));

  // 6. Purple deaths: any cell of cls 1/2 standing on purple is destroyed
  //    (cls 3 immune).
  for (const m of survivors) {
    if (m.unit.cls !== 3 && s.purple.includes(m.to)) {
      m.unit.cells = m.unit.cells.filter(c => c !== m.to);
      s.log.push({ round: s.round, text: `Corrosion dies in purple at ${toAlg(m.to, size)}` });
    }
  }
  s.corrosions = s.corrosions.filter(u => u.cells.length > 0);

  // 7. Strikes: for each surviving mover cell, p = board[cell]
  for (const m of survivors) {
    if (!m.unit.cells.includes(m.to)) continue; // died in purple above
    const p = s.board[m.to];
    if (!p) continue;
    const alg = toAlg(m.to, size);
    if (p.type === 'k') {
      m.unit.cells = m.unit.cells.filter(c => c !== m.to);
      s.log.push({ round: s.round, text: 'Corrosion blocked by king' });
    } else if (m.unit.cls === 3) {
      s.board[m.to] = null;
      m.unit.cells = m.unit.cells.filter(c => c !== m.to);
      s.log.push({ round: s.round, text: `Corrosion destroys ${p.type} at ${alg}` });
    } else if (p.color !== m.unit.color) {
      s.board[m.to] = null;
      m.unit.cells = m.unit.cells.filter(c => c !== m.to);
      s.log.push({ round: s.round, text: `Corrosion destroys ${p.type} at ${alg}` });
    }
    // else: cls 1/2 && friendly — nothing (co-occupies)
  }

  // 8. Remove units with zero cells. (Promotions appended here by Task 7.)
  s.corrosions = s.corrosions.filter(u => u.cells.length > 0);
}
