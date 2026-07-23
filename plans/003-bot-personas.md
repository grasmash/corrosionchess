# Plan 003: Bot personas — chess.com-style bot roster with personalities

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: plans 001 (VFX) and 002 (notation) land before
> this one and rewrite parts of `src/main.ts`, `src/ui/hud.ts`,
> `src/style.css`. Read those files fresh; the excerpts below describe the
> pre-001/002 shape and the INTERFACES are what's guaranteed. STOP only if a
> named export you depend on (`chooseBotMove`, `legalMoves`, `applyMove`,
> `renderHud`, `showSetup`) is missing or has a different signature.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED (touches both game flows' UI wiring)
- **Depends on**: plans/001-corrosion-vfx.md, plans/002-move-log-notation.md (merge order only)
- **Category**: direction
- **Planned at**: commit `cd19570`, 2026-07-22

## Why this matters

The game has hotseat and online play but no single-player opponent. The user
wants chess.com-style bots: a selection screen of characters with names,
ratings, avatars, and personalities that chat during the game. The engine-level
AI already exists (`src/ai/bot.ts`, reviewed); this plan wraps it in personas
and UI.

## The roster (user-specified — names/ratings/personality verbatim)

| id    | Name | Rating | Personality | Strength mapping |
|-------|------|--------|-------------|------------------|
| toby  | Toby | 100  | dog, obsessed with treats | L1 (random) + 20% pure-random override |
| bella | Bella| 250  | obsessed with the four-move checkmate | L2, blunderChance 0.35, scholar's-mate opening book (below) |
| mom   | Mom  | 250  | obsessed with gardening and flowers | L2, blunderChance 0.35 |
| dad   | Dad  | 300  | likes to talk about chess | L2, blunderChance 0.25 |
| addie | Addie| 700  | likes to talk about dolls | L2, blunderChance 0.10, evalNoise ±0.5 |
| theo  | Theo | 1300 | likes gaming and treats | L3, blunderChance 0.03 |

Ratings top out around 2000 in this game's scale (user note).

**The Bob army (user-specified):** every other bot in the roster is named
Bob. Fill the roster out chess.com-style with 8 Bobs at ratings
150, 400, 600, 800, 1000, 1200, 1500, 2000 — ids `bob150`…`bob2000`, all
displayed simply as "Bob". Strength via a shared helper
`paramsForRating(rating): { level, blunderChance }` (piecewise: ≤200 → L1;
201–900 → L2 with blunderChance sliding 0.4→0.05; >900 → L3 with
blunderChance sliding 0.05→0). Bobs share one deadpan quip pool (identical
personality is the joke — "I'm Bob.", "Bob move.", etc.); write ~8 lines
covering all QuipEvents, reused across all Bobs.

**Joe (user-specified):** exactly one bot named Joe, rating 550
(`paramsForRating(550)`), whose personality is that he is emphatically not
Bob ("There are so many Bobs.", "It's Joe. JOE.").

Selection screen grouping: "Family & Pets" section (the six above, in rating
order), then "The Bobs" section (8 Bobs ascending + Joe inserted at his
rating position between bob400 and bob600, visually identical cards except
the name/rating). Use `paramsForRating` for the six family bots' table values
too where they coincide — but keep their table-specified overrides (Bella's
opening book, Toby's L1) exactly as specified.

Bella's opening book (as Black or White): each turn, if one of these moves is
legal, play it with 85% probability, in order of preference: as White
`e2e4, d1h5 (Qh5), f1c4 (Bc4), h5xf7 (Qxf7)`; as Black `e7e5, d8h5→(mirror:
d8h4 is not the mirror — use d8f6/f8c5 variants; concretely: e7e5, d8f6 (Qf6),
f8c5 (Bc5), f6xf2 (Qxf2))`. Encode as square-name pairs resolved via
`fromAlg`; on the big board shift by the offset (+2 files/ranks) — compute
from `pawnStartRank`/`offsetOf`, don't hardcode both variants.

## Current state (interfaces you rely on)

- `src/ai/bot.ts` — `chooseBotMove(state: GameState, level: 1|2|3, rng?: () => number): Move`
  and `evaluate(state, forColor)`. Reviewed and frozen; do not modify —
  compose around it.
- `src/engine/game.ts` — `newGame(config)`, `applyMove(prev, m)` (throws on
  illegal). `src/engine/legal.ts` — `legalMoves(state, from?)`.
  `src/engine/board.ts` — `fromAlg(alg, size)`, `offsetOf(size)`.
- `src/ui/setup.ts` — `showSetup(onStart)` with `SetupResult { config, mode:
  'hotseat'|'host'|'join', joinId? }`. You will add mode `'bot'` + a
  `personaId?` field.
- `src/main.ts` — `startGame`-style flow functions per mode; a `render()`
  closure per flow calls board `setState` + `renderOverlays` + `renderHud`.
- `src/ui/hud.ts` — `renderHud(el, gs, opts)` sidebar renderer (post-002 it
  renders the full move log).
- Conventions: plain TS + DOM, `import type`, styles in `src/style.css`
  (append a clearly-commented BOTS block), chess.com-dark palette variables
  at top of style.css, buttons `.btn .btn-primary/.btn-secondary`.

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npx tsc --noEmit`  | exit 0              |
| Tests     | `npx vitest run`    | all pass            |
| Build     | `npm run build`     | exit 0              |

## Scope

**In scope**:
- `src/ai/personas.ts` (create) + `tests/personas.test.ts` (create)
- `src/ui/botselect.ts` (create)
- `src/ui/setup.ts` (add "Play vs Bot" entry point)
- `src/main.ts` (new `startBotGame` flow)
- `src/ui/hud.ts` (chat-bubble panel section)
- `src/style.css` (append BOTS block)

**Out of scope** (do NOT touch):
- `src/ai/bot.ts`, `src/engine/**`, `src/net/**`, `src/ui/overlays.ts`,
  `src/ui/cgboard.ts`/`boardview.ts`
- Avatar image generation (art pipeline runs separately; you only reference
  `public/avatars/<id>.png` with a fallback)

## Steps

### Step 1: `src/ai/personas.ts` (TDD)

```ts
export interface Persona {
  id: string; name: string; rating: number; tagline: string;
  avatar: string;                       // 'avatars/<id>.png'
  level: 1 | 2 | 3;
  blunderChance: number;                // probability of playing a random legal move
  evalNoiseNote?: string;               // documented, implemented via blunderChance only in v1
  opening?: { prefs: [string, string][]; prob: number }; // [fromAlg, toAlg] pairs on 8x8 coords
  quips: Record<QuipEvent, string[]>;   // >=3 lines each
}
export type QuipEvent = 'start' | 'botCaptures' | 'botLosesPiece' |
  'corrosionSpawns' | 'corrosionKills' | 'check' | 'botWins' | 'botLoses' | 'idle';
export const PERSONAS: Persona[];
export function choosePersonaMove(state: GameState, p: Persona, rng?: () => number): Move;
export function pickQuip(p: Persona, ev: QuipEvent, rng?: () => number): string;
```

`choosePersonaMove`: (1) opening pref — if `p.opening` and rng() < prob, scan
prefs in order, translate to the current board size (add `offsetOf(size)` to
both file and rank of each square when size is 12), play the first pair that
is in `legalMoves`; (2) else if rng() < blunderChance → uniform random legal
move; (3) else `chooseBotMove(state, p.level, rng)`.

Quips: write them yourself, in character, 3–5 per event per persona. Tone:
family-friendly, short (≤70 chars). Toby: treats/dog-brain ("Is the rook made
of bacon?"). Bella: four-move-mate bragging. Addie: dolls. Theo: gaming slang
+ treats. Mom: gardening/flowers metaphors ("Your pawns need pruning, dear").
Dad: chess-dad wisdom. Corrosion events get themed lines too.

Tests (`tests/personas.test.ts`, seeded rng): roster shape (6 personas, all
quip events non-empty); choosePersonaMove always legal over 20 plies at each
level; Bella with rng forced under prob plays e2e4 then Qh5 line when legal
(construct the position); blunderChance=1 persona returns uniform-random
member of legalMoves; big-board opening translation lands on c4→c6-style
shifted squares (verify Bella's first White move on 12x12 is the shifted e-pawn push).

**Verify**: `npx vitest run tests/personas.test.ts` → all pass.

### Step 2: Bot selection screen (`src/ui/botselect.ts`)

`showBotSelect(onPick: (p: Persona) => void, onBack: () => void): void` —
renders into `#app`: header "Play a Bot", a card grid (chess.com-style): each
card = avatar (56px, rounded; `<img src="avatars/<id>.png">` with
`onerror` fallback swapping in a `.avatar-fallback` div showing the persona's
initial on a colored circle — REQUIRED, art may not exist yet), name, rating
badge, tagline. Click → highlight card + a "Play" `.btn-primary` button
becomes enabled → `onPick`. "Back" `.btn-secondary` → `onBack`.
Setup screen gets a third button "Play vs Bot" (`SetupResult` mode `'bot'`,
`personaId` set after selection; simplest: `showSetup`'s onStart fires with
mode 'bot' and main.ts then shows botselect before starting the game).

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 3: Bot game flow in `src/main.ts`

`startBotGame(config, persona)`: human = White, persona = Black (v1).
Reuse the hotseat flow's board/render wiring. After every human move that
doesn't end the game: disable input (`dests` empty), show "typing"-style
thinking indicator in the chat panel, then after `300 + rng*900` ms compute
`choosePersonaMove` (wrap in try/catch; on throw log to console and fall back
to `chooseBotMove(state, 1)`), apply, re-render, re-enable input. L3 can take
~1s — run the think delay and the compute together (the compute IS the delay
when slow; don't stack a fixed sleep on top of a slow compute).
Quip triggers after each applied move (bot's or human's), fed from state
diff: game start → 'start'; bot's move captured something → 'botCaptures';
human captured a bot piece → 'botLosesPiece'; new corrosion unit this move →
'corrosionSpawns'; a piece destroyed by the corrosion phase → 'corrosionKills';
human in check → 'check'; result → 'botWins'/'botLoses'. Show at most one
quip per move (priority: result > corrosionKills > check > captures > spawn),
~30% chance to stay silent on non-result events so it doesn't spam.

### Step 4: Chat panel in the sidebar (`src/ui/hud.ts` + CSS)

Above the move log: persona header (avatar+name+rating) and a chat area
showing the last 3 quips as chess.com-style speech bubbles (white bubble,
dark text, rounded, small avatar beside). Only rendered when `opts.persona`
is provided — hotseat/online flows unchanged. Append `.bot-*`/`.chat-*`
styles in the BOTS block of style.css (match the existing card/palette
variables).

**Verify**: `npx tsc --noEmit` → exit 0; `npx vitest run` → all pass;
`npm run build` → exit 0.

### Step 5: Browser verification

`npm run dev` (own port; kill only your port when done — never `pkill -f vite`):
1. Setup → "Play vs Bot" → roster renders (fallback avatars OK), pick Toby →
   game starts, Toby greets, plays fast legal (often silly) moves.
2. New game → Bella: as Black she goes for e5/Qf6/Bc5/Qxf2 when you let her;
   verify at least the first two book moves; verify a quip about the
   four-move mate appears at start.
3. New game → Theo on 12x12 + all tiers: plays sensible moves within ~2s
   each; capture something → corrosion spawns → themed quips fire; play to
   any conclusion or resign via New game.
4. Verify hotseat and online flows still work (start each briefly).
5. No console errors. Screenshots: bot-select screen, mid-game with chat
   bubbles → `.superpowers/sdd/bots-*.png`.

## Test plan

Covered in Step 1 (personas unit tests). UI flows verified in browser (no
jsdom in project). Full suite + tsc + build green.

## Done criteria

- [ ] `npx tsc --noEmit` exits 0; `npx vitest run` exits 0 (new persona tests pass)
- [ ] `npm run build` exits 0
- [ ] Screenshots: roster screen with 6 cards + in-game chat bubbles
- [ ] Bella demonstrably attempts the scholar's-mate line
- [ ] Hotseat + online flows unaffected (verified in browser)
- [ ] `git status` — only in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- `chooseBotMove` signature differs from the interface above.
- Wiring the bot flow requires modifying `src/net/**` or `src/ai/bot.ts`.
- L3 move computation regularly exceeds ~4s on the 12x12 in your browser test
  — report perf numbers instead of shipping a frozen-feeling game.

## Maintenance notes

- Avatar art: a separate art task generates `public/avatars/<id>.png`
  (cartoon portraits: dogs Toby & Bella, kid Addie with a doll, kid Theo with
  a controller, Mom with flowers, Dad with a chess piece). The `onerror`
  fallback means shipping order doesn't matter.
- Future: color choice for human, adaptive persona (rating tracks wins),
  more personas up to ~2000. `PERSONAS` is the only place to add entries.
- Reviewer: scrutinize the async bot-move race (human clicking during bot
  think — input must be gated), and quip-trigger diff logic vs the corrosion
  phase (only runs after Black/bot moves).
