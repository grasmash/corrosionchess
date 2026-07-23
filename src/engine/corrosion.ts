import type { CorrosionUnit, GameState, PieceType } from './types';
import { rankOf, toAlg, enemyEdgeRank, ownerEdgeRank } from './board';

export function addPurple(s: GameState, sq: number): void {
  if (!s.purple.includes(sq)) s.purple.push(sq);
}

function hostile(a: CorrosionUnit, b: CorrosionUnit): boolean {
  return a.color !== b.color || a.cls === 3 || b.cls === 3;
}

// Shared per-square resolution helpers — used both by the bulk step-5/6/7
// passes below (over every square in play) and by promotion (step 8), which
// introduces a brand-new trail cell that never went through those passes and
// must be resolved against whatever already occupies that square.

function ownersAtSquare(units: CorrosionUnit[], square: number): CorrosionUnit[] {
  return units.filter(u => u.cells.includes(square));
}

function hasHostilePair(owners: CorrosionUnit[]): boolean {
  for (let i = 0; i < owners.length; i++) {
    for (let j = i + 1; j < owners.length; j++) {
      if (owners[i] !== owners[j] && hostile(owners[i], owners[j])) return true;
    }
  }
  return false;
}

// Step-5-equivalent for a single square: if a hostile pair of units both
// hold cells on `square`, every unit's cell there is destroyed.
function annihilateAtSquare(s: GameState, square: number): void {
  const owners = ownersAtSquare(s.corrosions, square);
  if (hasHostilePair(owners)) {
    for (const u of owners) u.cells = u.cells.filter(c => c !== square);
  }
}

// Step-6-equivalent for a single unit's cell.
function purpleDeathAtSquare(s: GameState, u: CorrosionUnit, square: number): void {
  if (u.cls === 3) return;
  if (!u.cells.includes(square)) return;
  if (!s.purple.includes(square)) return;
  u.cells = u.cells.filter(c => c !== square);
  s.log.push({ round: s.round, text: `Corrosion dies in purple at ${toAlg(square, s.size)}` });
}

// Step-7-equivalent for a single unit's cell.
function strikeAt(s: GameState, u: CorrosionUnit, square: number): void {
  if (!u.cells.includes(square)) return;
  const p = s.board[square];
  if (!p) return;
  const alg = toAlg(square, s.size);
  if (p.type === 'k') {
    u.cells = u.cells.filter(c => c !== square);
    s.log.push({ round: s.round, text: 'Corrosion blocked by king' });
  } else if (u.cls === 3 || p.color !== u.color) {
    s.board[square] = null;
    u.cells = u.cells.filter(c => c !== square);
    s.log.push({ round: s.round, text: `Corrosion destroys ${pieceName(p.type)} at ${alg}` });
  }
  // else: cls 1/2 && friendly — nothing (co-occupies)
}

// The cls-2 cell furthest along the unit's direction of travel (the one
// that reaches ownerEdgeRank first).
function leadCell(u: CorrosionUnit, size: number): number {
  return u.cells.reduce((best, c) =>
    (u.dir === 1 ? rankOf(c, size) > rankOf(best, size) : rankOf(c, size) < rankOf(best, size)) ? c : best
  );
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
  const squaresInPlay = new Set<number>();
  for (const u of s.corrosions) for (const c of u.cells) squaresInPlay.add(c);
  for (const square of squaresInPlay) annihilateAtSquare(s, square);

  // 6. Purple deaths: any cell of cls 1/2 standing on purple is destroyed
  //    (cls 3 immune) — applies to ALL units' cells, movers and dormant
  //    born-this-round units alike, consistent with the step-5 ruling.
  for (const u of s.corrosions) {
    for (const c of [...u.cells]) purpleDeathAtSquare(s, u, c);
  }

  // Surviving mover cells for step 7, now that steps 4-6 have finished
  // destroying cells (movers only — dormant cells never strike).
  const survivors = moved.filter(m => m.unit.cells.includes(m.to));

  // 7. Strikes: for each surviving mover cell, p = board[cell]
  for (const m of survivors) strikeAt(s, m.unit, m.to);

  // 8. Class-1 promotion: a cls-1 mover whose single cell landed on the
  //    enemy edge either fizzles out (tier2 off) or strengthens into a
  //    cls-2 pair heading back home (tier2 on). Eligibility is captured
  //    from `movers` BEFORE any mutation below, so a unit promoted here
  //    cannot be re-evaluated by the cls-2 promotion pass in the same phase.
  const promoteCls1 = movers.filter(
    u => u.cls === 1 && u.cells.length === 1 && rankOf(u.cells[0], size) === enemyEdgeRank(u.color, size)
  );
  // 9. Class-2 promotion: a cls-2 mover whose lead cell landed on its own
  //    edge either fizzles out (tier3 off) or goes critical as a cls-3 unit
  //    (tier3 on). Captured up front for the same reason as promoteCls1.
  const promoteCls2 = movers.filter(
    u => u.cls === 2 && u.cells.length > 0 && rankOf(leadCell(u, size), size) === ownerEdgeRank(u.color, size)
  );

  for (const u of promoteCls1) {
    const edgeCell = u.cells[0];
    if (!s.config.tier2) {
      u.cells = [];
      s.log.push({ round: s.round, text: 'Corrosion fizzles at the edge' });
      continue;
    }
    const newDir = (u.dir * -1) as 1 | -1;
    const trailCell = edgeCell + newDir * size;
    u.cls = 2;
    u.dir = newDir;
    u.cells = [edgeCell, trailCell];
    s.log.push({ round: s.round, text: 'Corrosion strengthens to class 2' });

    // The trail cell is brand new this phase — it never went through
    // steps 5-7, so resolve it against whatever already occupies that
    // square (enemy corrosion, purple, or a piece) now.
    annihilateAtSquare(s, trailCell);
    purpleDeathAtSquare(s, u, trailCell);
    strikeAt(s, u, trailCell);
  }

  for (const u of promoteCls2) {
    const edgeCell = leadCell(u, size);
    if (!s.config.tier3) {
      u.cells = [];
      s.log.push({ round: s.round, text: 'Corrosion fizzles at the edge' });
      continue;
    }
    u.cls = 3;
    u.dir = (u.dir * -1) as 1 | -1;
    u.cells = [edgeCell];
    s.log.push({ round: s.round, text: 'Corrosion goes CRITICAL (class 3)' });
  }

  // 10. Remove units with zero cells.
  //     This is the only place s.corrosions needs filtering: every step above
  //     checks/mutates unit.cells directly (never s.corrosions membership), so
  //     an emptied-but-not-yet-removed unit simply contributes zero cells to
  //     any intermediate pass and is harmless until this final cleanup.
  s.corrosions = s.corrosions.filter(u => u.cells.length > 0);
}
