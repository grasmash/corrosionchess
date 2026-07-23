# Plan 008: Sound effects + background music with settings toggles

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 54be926..HEAD -- src/main.ts src/ui/settings.ts src/engine/notation.ts vite.config.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (autoplay policy + PWA caching are the tricky parts)
- **Depends on**: none (plans 001–007 are DONE)
- **Category**: direction
- **Planned at**: commit `54be926`, 2026-07-23 (refreshed same day: `src/main.ts` gained a
  service-worker auto-reload block after `start()` at the bottom of the file — commit
  `b4bd647`. Step 2's `pointerdown`/`click` listeners go NEAR that block, after it; do
  not modify it.)

## Why this matters

The game is fully silent. Chess apps live and die on move-feel — the
chess.com "thock" is half the product — and Corrosion Chess additionally has
a signature mechanic (acid corrosion) with elaborate VFX but zero audio
reinforcement. This plan adds: synthesized sound effects for every gameplay
event (move, capture, check, corrosion spawn/strike/death, game end, UI
clicks), an ambient background-music loop, and Settings-modal controls
(SFX toggle, Music toggle, volume slider) that persist like every other
preference in this app.

Two-layer approach, deliberately:

- **SFX are synthesized in code with the Web Audio API** — no asset files,
  nothing to license, works offline by construction, each sound is a ~15-line
  tweakable function. The exact synthesis code is provided below; do not
  design sounds yourself.
- **Music is one generated audio file** (Replicate, mirroring how this repo
  generates piece art), runtime-cached by the existing PWA config.

## Current state

Relevant files and their roles:

- `src/main.ts` — all game flows. Three functions each own a `render()` that
  calls `renderOverlays(boardEl, view, state, prevState, …)` with the
  prev→next state pair: `startGame` (hotseat, ~line 704), `startBotGame`
  (~line 804), `mountOnlineGame` (~line 520s). The bot flow also has
  `fireQuipsForMove(before, after, mover, move)` (~line 857) which diffs the
  two states to pick a quip — **this is the pattern to mirror for sound
  selection** (priority order: result > corrosion kill > check > capture >
  corrosion spawn).
- `src/ui/settings.ts` — settings modal. Fields are built as
  `label.settings-field` > `span.settings-field-label` + `select.settings-select`;
  Save button calls `setPieceSet(...)`/`setBoardTheme(...)` then closes.
  Nothing is applied before Save.
- `src/ui/boardthemes.ts` — the persistence pattern to copy exactly:
  `currentX()` reads localStorage in a try/catch with a default fallback,
  `setX()` writes in a try/catch and applies immediately. Storage keys are
  bare lowercase strings (`'boardtheme'`, `'pieceset'`, `'lastconfig'`).
- `src/engine/game.ts` — `applyMove` pushes log entries; every corrosion
  event is a log line (see the exact strings below).
- `src/engine/notation.ts:60` — SAN gets `'+'` suffix on check, `'#'` on mate:
  `san += legalMoves(clone).length > 0 ? '+' : '#';`
- `src/engine/types.ts:47` — `result: { winner: Color | null; reason: string } | null`.
- `vite.config.ts` — PWA config. `workbox.runtimeCaching` currently has ONE
  entry, `urlPattern: /\/(pieces|art|vfx|avatars)\/.*\.png$/` with
  `cacheName: 'corrosion-art-cache'`. Vite `base` is `'./'`; the app deploys
  to a GitHub Pages SUBPATH (`grasmash.github.io/corrosionchess/`), so **all
  asset paths must be relative — `audio/foo.mp3`, never `/audio/foo.mp3`**.
  This exact bug (absolute `/vfx/...` paths 404ing on Pages) was fixed in
  commit `268a820`; do not reintroduce it.
- `scripts/generate-pieces.mjs` and `scripts/generate-board-textures.mjs` —
  Replicate generation scripts. Token handling to copy (from
  `generate-board-textures.mjs:21`):

  ```js
  let TOKEN = process.env.REPLICATE_API_TOKEN;
  if (!TOKEN) {
    try {
      const mcp = JSON.parse(readFileSync(join(ROOT, '..', 'gg', '.mcp.json'), 'utf8'));
      TOKEN = mcp.mcpServers?.replicate?.env?.REPLICATE_API_TOKEN;
    } catch {}
  }
  ```

Log-line prefixes produced by the engine (grep `s.log.push` in
`src/engine/corrosion.ts`, `src/engine/game.ts`, `src/engine/legal.ts`) —
match with `startsWith`/`includes` on the NEW entries only
(`after.log.slice(before.log.length)`):

| Log text starts with / contains | Event |
|---|---|
| `Corrosion spawns at` | tier-1 spawn |
| `Corrosion destroys ` | corrosion killed a piece |
| `Corrosion dies in purple` | cell death |
| `Corrosion blocked by king` | king block |
| `Corrosion strengthens to class 2` | tier-2 promotion |
| `Corrosion goes CRITICAL` | tier-3 promotion |
| `Corrosion fizzles` / `Corrosion dissipates` | fizzle |
| `destroyed capturing corrosion at` (contains) | mover died capturing a cell |
| `Corrosion captured at` (contains) | mover ate a cell and survived |

Conventions to match: plain TS modules, no framework, no new runtime
dependencies. Heavy doc comments explaining "why" (see any file in
`src/ui/`). Tests in `tests/*.test.ts` with vitest; DOM-dependent modules
guard with `if (typeof document === 'undefined') return;` so they stay
importable under node (see `applyBoardTheme` in `src/ui/boardthemes.ts:113`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Tests | `npm test` | all pass (122 existing at planning time) |
| Build | `npm run build` | exit 0, `files generated … dist/sw.js` |
| Dev server | `npm run dev` | port 1212 — **do NOT kill an already-running instance; it is the user's** |
| Music gen | `node scripts/generate-audio.mjs` | writes `public/audio/music-loop.mp3` |

## Scope

**In scope** (the only files you may modify or create):
- `src/ui/audio.ts` (create)
- `src/main.ts` (wire-up call sites only)
- `src/ui/settings.ts` (add SFX/Music/volume controls)
- `src/style.css` (append slider styles only)
- `vite.config.ts` (runtimeCaching entry only)
- `scripts/generate-audio.mjs` (create)
- `public/audio/music-loop.mp3` (generated)
- `tests/audio.test.ts` (create)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch):
- `src/engine/**` — the engine is frozen; all events are already observable
  via the state diff and log. If you think you need an engine change, STOP.
- `src/ui/overlays.ts` — VFX only. Sound does not belong in the render layer.
- `src/ui/vfxlab.ts`, `src/ui/rules.ts`, `src/ui/scenarios.ts` — simulated
  boards must stay silent; they never call the audio hook, which is achieved
  by NOT adding calls there (no changes needed).
- Service-worker registration code — `vite-plugin-pwa` generates it.

## Git workflow

- Work on `main` (repo convention — all recent work is direct-to-main).
- Commit style: `feat: …` / `fix: …` conventional, body explains why (see
  `git log -5`). One commit for the whole feature is fine; do NOT push unless
  the operator says to.

## Steps

### Step 1: Create `src/ui/audio.ts`

One module, three layers. Use this code as the skeleton — synthesis numbers
are tuned, copy them exactly; doc comments abbreviated here, expand to match
repo style.

```ts
import type { GameState } from '../engine/types';

// ---------- persistence (pattern: boardthemes.ts) ----------
export type SoundEvent =
  | 'move' | 'capture' | 'check' | 'win' | 'lose' | 'draw'
  | 'corrosionSpawn' | 'corrosionKill' | 'corrosionPromote'
  | 'corrosionCritical' | 'corrosionDeath' | 'uiClick';

const SFX_KEY = 'sfxon';
const MUSIC_KEY = 'musicon';
const VOLUME_KEY = 'soundvolume';

export function currentSfxOn(): boolean {
  try { return localStorage.getItem(SFX_KEY) !== '0'; } catch { return true; }
}
export function currentMusicOn(): boolean {
  try { return localStorage.getItem(MUSIC_KEY) === '1'; } catch { return false; }
}
export function currentVolume(): number {
  try {
    const v = parseFloat(localStorage.getItem(VOLUME_KEY) ?? '');
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.7;
  } catch { return 0.7; }
}
export function setSfxOn(on: boolean): void {
  try { localStorage.setItem(SFX_KEY, on ? '1' : '0'); } catch {}
}
export function setMusicOn(on: boolean): void {
  try { localStorage.setItem(MUSIC_KEY, on ? '1' : '0'); } catch {}
  if (on) startMusic(); else stopMusic();
}
export function setVolume(v: number): void {
  try { localStorage.setItem(VOLUME_KEY, String(v)); } catch {}
  if (musicEl) musicEl.volume = v * MUSIC_LEVEL;
}

// ---------- pure event mapper (unit-testable, no DOM) ----------
/** Diff prev->next into an ordered list of sounds. Mirrors
 * fireQuipsForMove's priority: result > corrosion kill > check > capture >
 * spawn — but unlike quips, several can fire together (kill + spawn). */
export function soundEventsForTransition(prev: GameState, next: GameState): SoundEvent[] {
  const out: SoundEvent[] = [];
  const newLog = next.log.slice(prev.log.length).map(e => e.text);
  const san = newLog.find(t => /^\d+[.…]/.test(t)) ?? '';

  if (newLog.some(t => t.startsWith('Corrosion destroys ') || t.includes('destroyed capturing corrosion')))
    out.push('corrosionKill');
  if (newLog.some(t => t.startsWith('Corrosion goes CRITICAL'))) out.push('corrosionCritical');
  else if (newLog.some(t => t.startsWith('Corrosion strengthens'))) out.push('corrosionPromote');
  if (newLog.some(t => t.startsWith('Corrosion spawns at'))) out.push('corrosionSpawn');
  if (newLog.some(t => t.startsWith('Corrosion dies in purple') || t.startsWith('Corrosion fizzles') || t.startsWith('Corrosion dissipates')))
    out.push('corrosionDeath');

  if (next.result && !prev.result) {
    out.push(next.result.winner === null ? 'draw' : 'win'); // caller may swap win->lose
  } else if (san.endsWith('+') || san.endsWith('#')) {
    out.push('check');
  } else if (out.length === 0) {
    // plain move vs capture: SAN 'x' marks captures (see moveToSan)
    out.push(san.includes('x') || newLog.some(t => t.includes('Corrosion captured at')) ? 'capture' : 'move');
  }
  return out;
}

// ---------- WebAudio SFX engine ----------
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  master!.gain.value = currentVolume();
  return ctx;
}

/** Call once from main.ts on the first user gesture (pointerdown) so the
 * context is unlocked before any sound is needed (browser autoplay policy). */
export function unlockAudio(): void { ensureCtx(); if (currentMusicOn()) startMusic(); }

function tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0, freqEnd?: number): void {
  const c = ensureCtx(); if (!c || !master) return;
  const t0 = c.currentTime + when;
  const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.05);
}

function noise(dur: number, gain: number, filterFreq: number, when = 0): void {
  const c = ensureCtx(); if (!c || !master) return;
  const t0 = c.currentTime + when;
  const len = Math.ceil(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq;
  const g = c.createGain(); g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(master); src.start(t0);
}

const SFX: Record<SoundEvent, () => void> = {
  move:              () => { noise(0.06, 0.5, 900); tone(190, 0.07, 'sine', 0.25); },           // wooden thock
  capture:           () => { noise(0.09, 0.7, 700); tone(140, 0.10, 'sine', 0.35); tone(95, 0.12, 'sine', 0.2, 0.03); },
  check:             () => { tone(880, 0.10, 'triangle', 0.22); tone(1108, 0.14, 'triangle', 0.18, 0.09); },
  win:               () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.22, i * 0.13)); },
  lose:              () => { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, 'triangle', 0.2, i * 0.16)); },
  draw:              () => { tone(440, 0.25, 'triangle', 0.18); tone(440, 0.25, 'triangle', 0.14, 0.3); },
  corrosionSpawn:    () => { noise(0.35, 0.30, 2400); tone(300, 0.3, 'sawtooth', 0.05, 0, 140); }, // acid hiss
  corrosionKill:     () => { noise(0.45, 0.5, 1800); tone(220, 0.4, 'sawtooth', 0.12, 0, 60); tone(110, 0.35, 'sine', 0.2, 0.05, 50); },
  corrosionPromote:  () => { tone(160, 0.35, 'sawtooth', 0.12, 0, 320); noise(0.3, 0.2, 2000, 0.05); },
  corrosionCritical: () => { tone(120, 0.5, 'sawtooth', 0.16, 0, 480); tone(60, 0.5, 'square', 0.10); noise(0.5, 0.3, 3000, 0.1); },
  corrosionDeath:    () => { noise(0.2, 0.25, 1200); tone(500, 0.18, 'sine', 0.10, 0, 200); },
  uiClick:           () => { tone(650, 0.04, 'sine', 0.12); },
};

export function playSound(ev: SoundEvent): void {
  if (!currentSfxOn()) return;
  if (typeof window === 'undefined') return;
  SFX[ev]();
}

/** Main entry for game flows. `humanColor` (bot/online) flips win->lose when
 * the human lost; omit for hotseat (always plays 'win' fanfare). Dedupes on
 * `next` object identity — render() can run twice for one transition. */
let lastPlayedFor: GameState | null = null;
export function playSoundsForTransition(prev: GameState | null, next: GameState, humanColor?: 'w' | 'b'): void {
  if (!prev || prev === next || lastPlayedFor === next) return;
  lastPlayedFor = next;
  let delay = 0;
  for (const ev of soundEventsForTransition(prev, next)) {
    const actual = ev === 'win' && humanColor && next.result?.winner !== humanColor ? 'lose' : ev;
    setTimeout(() => playSound(actual), delay);
    delay += 120; // stagger stacked events so they read as distinct
  }
}

// ---------- music ----------
const MUSIC_LEVEL = 0.35; // music sits well under SFX
let musicEl: HTMLAudioElement | null = null;

function startMusic(): void {
  if (typeof document === 'undefined') return;
  if (!musicEl) {
    // RELATIVE path — resolves under the GitHub Pages subpath (see plan).
    musicEl = new Audio('audio/music-loop.mp3');
    musicEl.loop = true;
  }
  musicEl.volume = currentVolume() * MUSIC_LEVEL;
  void musicEl.play().catch(() => { /* pre-gesture autoplay block: unlockAudio retries */ });
}
function stopMusic(): void { musicEl?.pause(); }
```

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 2: Wire main.ts

Four small changes, nothing else:

1. Import: `import { playSoundsForTransition, unlockAudio, playSound } from './ui/audio';`
2. Top-level, once (near the existing `start()` bootstrap at the bottom):
   ```ts
   document.addEventListener('pointerdown', () => unlockAudio(), { once: true });
   document.addEventListener('click', e => {
     if ((e.target as HTMLElement).closest('button')) playSound('uiClick');
   });
   ```
3. In each of the three `render()` functions (`startGame` ~line 727,
   `startBotGame` ~line 840, `mountOnlineGame`'s render), add ONE line
   directly BEFORE `prevState = state;`:
   - hotseat: `playSoundsForTransition(prevState, state);`
   - bot: `playSoundsForTransition(prevState, state, humanColor);`
   - online: `playSoundsForTransition(prevState, state, myColor);` — find the
     local color variable in `mountOnlineGame` (it holds the color this client
     plays; read the function to get its exact name).
4. Do NOT add calls in vfxlab/rules/scenarios.

**Verify**: `npx tsc --noEmit` → exit 0. Then
`grep -c "playSoundsForTransition(prevState" src/main.ts` → `3`.

### Step 3: Settings modal controls

In `src/ui/settings.ts`, after the board-theme field and before the buttons,
add three fields following the existing `settings-field` structure:

- "Sound effects" — `<input type="checkbox">` reflecting `currentSfxOn()`.
- "Music" — checkbox reflecting `currentMusicOn()`.
- "Volume" — `<input type="range" min="0" max="1" step="0.05">` reflecting
  `currentVolume()`, class `settings-slider`.

Modal semantics here are save-on-Save (nothing applies before Save — see the
doc comment on `showSettings`). Track selections in locals like
`selectedPieceSet`; in the Save handler call `setSfxOn`, `setMusicOn`,
`setVolume` alongside the existing `setPieceSet`/`setBoardTheme`.

Append to `src/style.css` (end of file) a minimal
`.settings-slider { width: 100%; accent-color: #7fff5a; }` plus a
`.settings-field input[type='checkbox'] { … }` sizing rule consistent with
the modal's look.

**Verify**: `npx tsc --noEmit` → exit 0; `npm test` → all pass.

### Step 4: Generate the music loop

Create `scripts/generate-audio.mjs` modeled on
`scripts/generate-board-textures.mjs` (same token lookup, same
poll-prediction loop). Model: `meta/musicgen` on Replicate, input:

```js
{
  prompt: 'dark ambient dungeon-synth loop, slow brooding pads, faint metallic drips and distant industrial hum, seamless loop, no drums, no melody spikes, 60 bpm',
  duration: 30,
  output_format: 'mp3',
  model_version: 'stereo-large',
}
```

Save to `public/audio/music-loop.mp3`. Run it:
`node scripts/generate-audio.mjs`. If the token is missing or the model
rejects the input schema, STOP and report (do not swap in a different model
unprompted).

**Verify**: `ls -la public/audio/music-loop.mp3` → exists, size > 200 KB.

### Step 5: PWA caching for audio

In `vite.config.ts`, add a second `runtimeCaching` entry after the PNG one:

```ts
{
  urlPattern: /\/audio\/.*\.mp3$/,
  handler: 'CacheFirst',
  options: {
    cacheName: 'corrosion-audio-cache',
    expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 90 },
    cacheableResponse: { statuses: [0, 200] },
    rangeRequests: true,
  },
},
```

`rangeRequests: true` matters: browsers fetch media with Range headers and a
cached full response without it can fail to play from cache.

**Verify**: `npm run build` → exit 0, output still lists `dist/sw.js`;
`ls dist/audio/music-loop.mp3` → exists.

### Step 6: Tests

Create `tests/audio.test.ts` (node environment, no DOM — the module's
DOM-touching functions all guard on `typeof window`/`typeof document`).
Test the PURE mapper only, using the state-building style of
`tests/game.test.ts` (build via `newGame`, mutate, or fabricate minimal
`GameState` objects with `log`, `result` fields):

1. plain SAN entry, no corrosion lines → `['move']`
2. SAN containing `x` → `['capture']`
3. SAN ending `+` → `['check']`
4. new log containing `Corrosion spawns at e4` + SAN → includes
   `'corrosionSpawn'` and no `'move'`
5. `Corrosion destroys knight at e5` → includes `'corrosionKill'`
6. `prev.result null`, `next.result` winner `'w'` → includes `'win'`
7. winner `null` → includes `'draw'`
8. `Corrosion goes CRITICAL (class 3)` → `'corrosionCritical'`, and NOT
   `'corrosionPromote'`
9. localStorage helpers: `currentVolume()` clamps garbage to default `0.7`
   (node has no localStorage — the try/catch path returns the default; assert
   that).

**Verify**: `npm test` → all pass, including ≥9 new.

## Done criteria

- [ ] `npx tsc --noEmit` exits 0
- [ ] `npm test` exits 0 with ≥9 new audio tests
- [ ] `npm run build` exits 0
- [ ] `grep -c "playSoundsForTransition(prevState" src/main.ts` → 3
- [ ] `grep -rn "'/audio" src/` → no matches (no absolute audio paths)
- [ ] `public/audio/music-loop.mp3` exists and is committed
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` row 008 updated

## STOP conditions

- Drift check fails (excerpts don't match live code).
- `mountOnlineGame`'s render/prevState wiring doesn't match the hotseat/bot
  pattern described here — report what it actually looks like.
- Replicate token unavailable or musicgen schema rejected (step 4).
- You find yourself wanting to edit `src/engine/**` or `overlays.ts`.
- A verification fails twice after a reasonable fix attempt.
- The user's dev server on port 1212 is in the way — never kill it; use a
  different port for any manual check.

## Maintenance notes

- New engine log strings will silently produce no sound; when adding engine
  events, extend `soundEventsForTransition`'s table and its tests.
- The synthesis numbers in `SFX` are tuning knobs — safe to tweak freely;
  each function is independent.
- Music file changes need a new filename (or SW cache bump) to bust the
  90-day CacheFirst entry — prefer `music-loop-2.mp3` + code reference update
  over in-place replacement.
- Deferred (out of this plan): per-event volume mixing UI, multiple music
  tracks, positional/stereo panning of corrosion sounds by board square.
