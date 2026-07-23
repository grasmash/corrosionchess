import type { GameState } from '../engine/types';

/**
 * Plan 008: sound effects + background music. Two layers:
 *
 * 1. SFX are synthesized in code with the Web Audio API -- no asset files,
 *    nothing to license, works offline by construction. `SFX` below is a
 *    table of ~15-line tweakable synthesis functions, one per `SoundEvent`.
 * 2. Music is a single generated audio loop (see scripts/generate-audio.mjs),
 *    played via a plain `<audio loop>` element and runtime-cached by the PWA
 *    config (vite.config.ts) like the piece/board art already is.
 *
 * Persistence follows the exact pattern in boardthemes.ts: `currentX()`
 * reads localStorage in a try/catch with a default fallback, `setX()` writes
 * in a try/catch and applies immediately. Storage keys are bare lowercase
 * strings, matching 'boardtheme'/'pieceset'/'lastconfig'.
 */

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
  try { localStorage.setItem(SFX_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
}
export function setMusicOn(on: boolean): void {
  try { localStorage.setItem(MUSIC_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
  if (on) startMusic(); else stopMusic();
}
export function setVolume(v: number): void {
  try { localStorage.setItem(VOLUME_KEY, String(v)); } catch { /* storage unavailable */ }
  if (musicEl) musicEl.volume = v * MUSIC_LEVEL;
}

// ---------- pure event mapper (unit-testable, no DOM) ----------

/**
 * Diffs `prev` -> `next` into an ordered list of sounds to play. Mirrors
 * `fireQuipsForMove`'s priority (result > corrosion kill > check > capture >
 * spawn) in main.ts -- but unlike quips, several sounds can fire together
 * for one transition (e.g. a corrosion kill plus a fresh spawn on the same
 * move), so this returns an array rather than picking one winner.
 */
export function soundEventsForTransition(prev: GameState, next: GameState): SoundEvent[] {
  const out: SoundEvent[] = [];
  const newLog = next.log.slice(prev.log.length).map(e => e.text);
  const san = newLog.find(t => /^\d+[.…]/.test(t)) ?? '';

  if (newLog.some(t => t.startsWith('Corrosion destroys ') || t.includes('destroyed capturing corrosion') || t.startsWith('Purple void consumes')))
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
    // Plain move vs capture: SAN 'x' marks captures (see moveToSan).
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

/**
 * Call once from main.ts on the first user gesture (pointerdown) so the
 * AudioContext is unlocked before any sound is needed -- browsers refuse to
 * start audio before a user gesture (autoplay policy).
 */
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

/** One synthesis function per event -- independent, safe to retune freely. */
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

/**
 * Main entry for game flows. `humanColor` (bot/online) flips win->lose when
 * the human lost; omit for hotseat (always plays the 'win' fanfare -- there
 * is no "human" side in hotseat). Dedupes on `next` object identity since
 * render() can run more than once for the same state transition (e.g. the
 * onSelect re-render in main.ts also calls renderOverlays with the same
 * (prevState, state) pair).
 */
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
    // RELATIVE path -- resolves under the GitHub Pages subpath deploy (see
    // vite.config.ts's `base: './'` comment); never '/audio/...'.
    musicEl = new Audio('audio/music-loop.mp3');
    musicEl.loop = true;
  }
  musicEl.volume = currentVolume() * MUSIC_LEVEL;
  void musicEl.play().catch(() => { /* pre-gesture autoplay block: unlockAudio retries */ });
}
function stopMusic(): void { musicEl?.pause(); }
