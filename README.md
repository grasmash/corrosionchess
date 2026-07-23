# Corrosion Chess

A browser-based chess variant. Standard chess, plus **corrosion** — a spreading
hazard that spawns wherever a piece is captured and marches across the board
on its own each round, mutating into nastier forms the longer it survives.
Rules were designed by Theo; the full spec lives in
[`docs/superpowers/specs/2026-07-22-corrosion-chess-design.md`](docs/superpowers/specs/2026-07-22-corrosion-chess-design.md).

Play locally on one screen (hotseat) or online with a friend by sharing a
URL — no accounts, no server to run, no paid infrastructure.

## Corrosion rules, summarized

All standard chess rules apply (movement, castling, en passant, promotion,
check/checkmate/stalemate) on top of this:

- **Spawning (Tier 1):** whenever a piece captures an enemy piece, a corrosion
  cell of the capturer's color appears on the square the capturing piece just
  vacated. Corrosion never spawns from capturing corrosion, and corrosion
  destroying a piece doesn't spawn more of itself.
- **Marching:** once per full round (after Black moves), every corrosion unit
  advances one square straight down its file, toward the enemy side. It's not
  a physical blocker — pieces slide through it freely — but *landing* on it
  matters:
  - Lands on an enemy piece → the piece dies, the corrosion is consumed.
  - Lands on a friendly piece → harmless, they co-occupy the square.
  - Lands on a king's square (either color) → the corrosion is destroyed;
    kings are always immune and may capture any corrosion for free.
  - Lands on opposite-color corrosion → mutual annihilation (including
    swap-collisions where two units cross the same edge).
  - Lands on same-color corrosion → stacks freely (shown with a count badge).
  - A non-king piece may also move *onto* enemy corrosion as a sacrifice —
    both are destroyed.
- **Class 2 (Tier 2):** a class-1 unit that reaches the far edge splits into a
  linked pair occupying the two endmost squares of its file, now marching
  back toward its owner's side.
- **Class 3 (Tier 3):** a class-2 unit that returns to its owner's edge
  collapses into a single **class 3** — rendered red, hostile to *everyone*
  including its own side (kings still immune). It never fades on its own and
  bounces off each edge forever, but is consumed when it strikes a non-king
  piece (its purple trail remains); either king may capture it for free. This
  makes sacrificing a piece to remove a class 3 a core tactic. Every square it
  leaves turns **purple**; purple squares are lethal to any other corrosion
  that enters them and illegal for pieces to move onto or through (knights may
  jump over purple, just not land on it) — except a king, which may step onto
  a purple square safely and permanently cleanses it on the way out.
- Each tier requires the one below it; disabling a tier just means the
  corrosion that would have been promoted is removed instead.

See the design spec linked above for the complete, unabridged rules
(annihilation edge cases, check interactions, etc).

## Install & run

```sh
npm install
npm run dev
```

Open the printed local URL. `npm run build` produces a static production
build (`dist/`) deployable to any static host — the game needs no backend.

## How to play

### Hotseat

From the setup screen, pick your tiers/board size and click **Play hotseat**.
Both players share the same browser tab/window, taking turns at the board.

### Online (host/join)

1. Click **Create online game**. A shareable link appears once the signaling
   handshake completes (this needs internet access — matchmaking uses
   PeerJS's public broker, but gameplay itself is direct peer-to-peer after
   that).
2. Send the link to your opponent. The **host always plays White**; whoever
   opens the link joins as Black.
3. Play — moves sync live over the P2P connection. If your opponent's
   connection drops, the game state is preserved on the host and the guest
   can rejoin from the same link; a brief resync exchange catches both sides
   back up.

## Configuration (setup screen)

- **Tier 1** — corrosion spawns on capture. Off = vanilla chess.
- **Tier 2** — class 1 → class 2 promotion at the far edge. Requires Tier 1.
- **Tier 3** — class 2 → class 3 promotion (the immortal purple-trailing
  unit). Requires Tier 2.
- **Enlarged board (12x12)** — a 144-square board with the standard army
  centered on both axes (back rank on rank 3/10, pawns on rank 4/9, files
  c–j); pawns promote at the true board edge (rank 12/1).

Whatever the host picks rides along in the game link — both players always
play the same configuration.

## License

This project is licensed under the **GNU General Public License v3.0** (see
[`LICENSE`](LICENSE)). It's GPL-3.0 because the board renderer,
[chessgroundx](https://github.com/gbtami/chessgroundx) (a fork of lichess's
Chessground), is itself GPL-3.0 licensed, and that copyleft propagates to
this project as a whole.
