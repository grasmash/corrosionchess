# Corrosion Chess — Design Spec

Date: 2026-07-22
Status: Draft for review

## Overview

Corrosion Chess is a browser-based chess variant. All standard chess rules apply, plus "corrosion" mechanics designed by Theo. Playable locally (hotseat) and online (share a URL, friend joins, live turn-based game). No accounts, no paid infrastructure.

## Technology

| Concern | Choice | Rationale |
|---|---|---|
| Board UI | [chessgroundx](https://github.com/gbtami/chessgroundx) (fork of lichess Chessground) | Lichess-quality rendering, supports non-8x8 board dimensions, no built-in chess logic so custom rules are unrestricted. GPL-3.0. |
| Rules engine | Custom TypeScript engine (this project) | No existing engine supports corrosion or a 12x12 centered setup. Board-size parametric. chess.js/chessops rejected: both hardcode 8x8. |
| Build | Vite + TypeScript | `npm run dev` for local play; static build deployable anywhere for online play. |
| Tests | Vitest | Engine is pure/headless and fully unit-tested. |
| Multiplayer | PeerJS (WebRTC peer-to-peer) | Zero backend. Game ID travels in the URL; free public signaling broker; direct P2P after handshake. |

## Game Configuration (setup screen; encoded in the shared URL)

- **Tier 1 toggle** — corrosion spawning on/off. Off = vanilla chess.
- **Tier 2 toggle** — class 1 → class 2 promotion. Requires Tier 1.
- **Tier 3 toggle** — class 2 → class 3 promotion. Requires Tier 2.
- **Enlarged board toggle** — 8x8 standard, or 12x12 (144 squares) with the standard army centered both axes: white back rank on rank 3, white pawns rank 4, black pawns rank 9, black back rank rank 10, armies on files c–j.

UI enforces the tier dependency chain. Both players always play the host's config (it rides in the URL / join handshake).

## Standard Chess on the 12x12 Board

- All piece movement rules unchanged.
- Castling: normal, relative to the king/rook starting squares on rank 3 / rank 10.
- Pawn double-step from its starting rank; en passant normal.
- Pawns promote at the true board edge (rank 12 for White, rank 1 for Black).
- Check, checkmate, stalemate: standard.

## Corrosion Rules

### Spawning (Tier 1)

- When a piece captures an enemy **piece**, a **class 1 corrosion** of the capturing player's color appears on the square the capturing piece just vacated.
- Capturing a corrosion does **not** spawn new corrosion. Corrosion destroying a piece does not spawn corrosion either.
- A newly spawned corrosion does not move during the round it was created.

### Movement

- All corrosion advances **once per full round**, after Black completes their move (order: White moves → Black moves → corrosion phase → repeat).
- Class 1 moves one square along its file toward the enemy side (white corrosion moves up the board, black corrosion moves down).
- Corrosion is not a physical blocker for pieces: sliding pieces pass freely over squares containing corrosion; only **landing** on enemy corrosion counts as capturing it.

### Corrosion vs pieces

- **Enemy piece on the target square:** the piece is destroyed (removed from the board) and the corrosion is **consumed** in the strike — both disappear.
- **Friendly piece on the target square:** no effect. The corrosion co-occupies that square for the round, then continues next round (rendered stacked).
- **Kings (either color):** immune. Corrosion never gives check. A corrosion that marches into any king's square is destroyed by the block (the king shields everything behind it). A friendly king is treated like the block case, not pass-through — corrosion of either color dies on any king's square. Kings may capture any corrosion for free.
- **Pieces capturing corrosion:** a non-king piece may move onto an enemy corrosion square; both the piece and the corrosion are destroyed (a sacrifice to stop the march). Moving onto a friendly corrosion square is legal and harmless (co-occupancy, rendered stacked).

### Corrosion vs corrosion

- Opposite colors landing on the same square: both destroyed (mutual annihilation). This includes swap-collisions (two corrosions exchanging squares in the same corrosion phase annihilate).
- Same color: pass through / co-occupy freely; the UI annotates stacks with a count badge.

### Class 2 (Tier 2)

- When a class 1 reaches the **enemy edge rank** (true board edge; rank 12/1 on the big board), it multiplies into a **class 2**: two corrosion cells occupying the two endmost squares of that file (e.g. ranks 12 and 11 for a white corrosion), now traveling **back toward its owner's side**, moving as a linked pair, one square per corrosion phase.
- Each cell resolves collisions independently (piece strikes, annihilation, king block). If one cell is destroyed, the surviving cell continues alone as a class-1-strength corrosion traveling its current direction. *(Assumption — flag if wrong.)*
- If Tier 2 is disabled, a class 1 reaching the enemy edge is simply removed.

### Class 3 (Tier 3)

- When a class 2's lead cell reaches the board edge on the owner's side, the unit becomes a single **class 3** on that edge square. *(Assumption: the pair collapses to one red square — flag if wrong.)*
- Class 3 is rendered **red** and is hostile to **everyone**, including its owner's pieces (kings still immune).
- It reverses direction and keeps marching; each edge it reaches, it bounces again. It marches forever until destroyed.
- **Purple trail:** every square a class 3 leaves turns **purple**.
- Striking any non-king piece destroys that piece and consumes the class 3 (its purple trail remains). *(Assumption: consumed-on-strike applies to class 3 like other classes — flag if wrong.)*
- Class 3 is immune to its own purple trail. Other corrosion (any class, any color) entering a purple square is destroyed.
- If Tier 3 is disabled, a class 2 reaching the owner's edge is removed.

### Purple squares

- No piece may move onto or through a purple square (the engine forbids these moves rather than allowing suicides). Knights jump over purple squares safely but may not land on them.
- Exception: **either king** may move onto a purple square safely. While a king stands there the square is neutralized; when the king leaves, the square returns to **normal** (cleansed permanently).

### Check interaction

- Corrosion never delivers check and never threatens a king.
- The corrosion phase can change the position (destroy defenders/blockers). If a player begins their turn in check because of it, normal check rules apply; checkmate/stalemate created by the corrosion phase ends the game immediately.
- Purple squares restrict king mobility and count when determining stalemate/checkmate escape squares.

## Architecture

```
src/
  engine/            pure, headless, deterministic — no DOM
    types.ts         Square, Piece, CorrosionUnit {class, color, cells, dir}, PurpleSet, Config, GameState
    board.ts         parametric board geometry (8x8 / 12x12), setup positions
    movegen.ts       standard chess move generation + legality (check detection)
    rules.ts         corrosion-aware legality filter (purple blocking, corrosion capture, king exceptions)
    corrosion.ts     corrosion phase: advance, strikes, annihilation, class promotion, purple painting
    game.ts          orchestrator: turn sequencer, apply/undo, serialization, game-end detection
  ui/
    board.ts         chessgroundx setup, state sync, move input
    overlays.ts      corrosion tints (white/black/red), class + stack badges, purple squares
    setup.ts         config screen: tier toggles, board size, hotseat vs online, create/join
    hud.ts           turn indicator, event log ("Corrosion destroys Nf6"), game-over banner
  net/
    peer.ts          PeerJS wrapper: host/join, message protocol, reconnect
  main.ts
tests/               Vitest suites per engine module
```

The engine consumes moves and emits a full serializable `GameState`; UI and network are thin layers over it.

## Multiplayer Protocol (PeerJS)

- Host clicks "Create online game" → PeerJS peer ID generated → shareable URL `…/#join=<peerId>` (config encoded alongside).
- Guest opens URL → connects → host sends `{type:"init", config, state, yourColor}`.
- Moves: `{type:"move", seq, move}`. Both sides run the identical deterministic engine; the host is authoritative on conflicts.
- Reconnect: guest re-joins with the same peer ID; host re-sends full state (`seq` guards ordering).
- Hotseat mode skips the net layer entirely.

## Error Handling

- Illegal move attempts: rejected by engine, board snaps back (chessgroundx built-in).
- Peer disconnect: banner with "opponent disconnected — waiting to reconnect", game state preserved on host.
- Malformed/out-of-order network messages: dropped; full-state resync requested.

## Testing

- Engine unit tests: standard chess legality (both board sizes), castling/en passant/promotion, every corrosion rule above (spawn, march timing, friendly pass, consume-on-strike, mutual annihilation, swap-collision, stacking, king block, king free capture, class 1→2 split, lone-cell degradation, class 2→3 collapse, bouncing, purple painting, purple blocking, king cleanse, tier toggles, corrosion-induced check/checkmate).
- Deterministic serialization round-trip tests (multiplayer depends on it).
- Manual playtest checklist for UI/multiplayer.

## Out of Scope (v1)

- AI opponent (hotseat + online only; AI can come later).
- Matchmaking, accounts, spectators, game persistence/history, clocks.
- Mobile-specific layout (works in a desktop browser; responsive enough is fine).

## Decisions Log

- Hotseat + online P2P; no AI (user).
- Corrosion advances once per full round (user).
- Corrosion consumed when it destroys a piece (user).
- Corrosion destroyed when blocked by a king (user).
- 12x12 with army centered both axes (user).
- PeerJS for online (user).
- Promotions/tier-ups at true board edge (user).
