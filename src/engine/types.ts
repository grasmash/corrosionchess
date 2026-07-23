export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export interface Piece {
  color: Color;
  type: PieceType;
}

export interface Config {
  tier1: boolean;
  tier2: boolean;
  tier3: boolean;
  bigBoard: boolean;
}

export interface CorrosionUnit {
  id: number;
  color: Color;
  cls: 1 | 2 | 3;
  cells: number[];      // squares; 1 cell for cls 1/3, up to 2 for cls 2
  dir: 1 | -1;          // +1 = toward higher ranks
  bornRound: number;    // unit does not move in the phase of the round it was born
}

export interface Move {
  from: number;
  to: number;
  promotion?: PieceType;
}

export interface LogEvent {
  round: number;
  text: string;
}

export interface GameState {
  size: number;
  board: (Piece | null)[];        // length size*size
  turn: Color;
  castling: { wK: boolean; wQ: boolean; bK: boolean; bQ: boolean };
  epSquare: number | null;
  corrosions: CorrosionUnit[];
  purple: number[];
  round: number;                   // starts at 1
  nextId: number;
  config: Config;
  result: { winner: Color | null; reason: string } | null;
  log: LogEvent[];
  /** Halfmoves since the last pawn move or material change (any capture, or
   * a piece destroyed by corrosion). 100 (= 50 full moves) ends the game in
   * a draw. Plain number so JSON round-trips (see tests/serialize.test.ts). */
  halfmoveClock: number;
  /** Occurrence count per position key (see positionKey in game.ts); 3 of a
   * kind ends the game in a draw. Cleared whenever halfmoveClock resets --
   * an irreversible move makes every earlier position unreachable, so the
   * map stays small. Plain Record (not Map) so JSON round-trips. */
  positionCounts: Record<string, number>;
}
