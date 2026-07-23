import type { Config } from '../engine/types';

/** UI-only color preference -- deliberately NOT part of the engine's
 * `Config` (tiers/board size only, engine-consumed as-is); this is resolved
 * to an actual `Color` by the caller (main.ts) at game-start time, since
 * "random" has no meaning to the color-agnostic engine. */
export type PlayAs = 'white' | 'black' | 'random';

export interface SetupResult {
  config: Config;
  mode: 'hotseat' | 'host' | 'join' | 'bot';
  joinId?: string;
  /** Set once a persona has been picked on the bot-select screen; absent for
   * the initial `onStart({mode:'bot'})` fired by this screen's "Play vs Bot"
   * button (main.ts shows the roster before this is known). */
  personaId?: string;
  /** Only meaningful for 'bot' and 'host' (the config screen hides the
   * picker entirely for 'hotseat', where color choice is irrelevant --
   * both players share one board). Absent for 'hotseat'. */
  playAs?: PlayAs;
}

/**
 * Compact config token: a 4-bit mask (tier1|tier2<<1|tier3<<2|bigBoard<<3)
 * rendered as a single hex digit. E.g. all-off is "0", all-on is "f".
 * Round-trips all 16 combinations (see tests/setup.test.ts).
 */
export function encodeConfig(c: Config): string {
  const mask = (c.tier1 ? 1 : 0) | (c.tier2 ? 2 : 0) | (c.tier3 ? 4 : 0) | (c.bigBoard ? 8 : 0);
  return mask.toString(16);
}

export function decodeConfig(s: string): Config {
  const mask = parseInt(s, 16) || 0;
  return {
    tier1: !!(mask & 1),
    tier2: !!(mask & 2),
    tier3: !!(mask & 4),
    bigBoard: !!(mask & 8),
  };
}

/** Short "Tiers 1-3 · 12×12"-style summary shown in the in-game sidebar
 * header, so players can see what variant they're mid-game in without
 * digging through the log. */
export function describeConfig(c: Config): string {
  const highestTier = c.tier3 ? 3 : c.tier2 ? 2 : c.tier1 ? 1 : 0;
  const tierText = highestTier === 0 ? 'No corrosion' : highestTier === 1 ? 'Tier 1' : `Tiers 1-${highestTier}`;
  const boardText = c.bigBoard ? '12×12' : '8×8';
  return `${tierText} · ${boardText}`;
}

const LAST_CONFIG_KEY = 'lastconfig';
/** First-ever-visit default (user request): Tier 1 + Tier 2 on, Tier 3 and
 * the 12x12 board off. Only used when nothing has been persisted yet --
 * once a player has confirmed any config, `currentLastConfig` returns that
 * instead (see below). */
const DEFAULT_CONFIG: Config = { tier1: true, tier2: true, tier3: false, bigBoard: false };

/**
 * Reads the last config a player confirmed (Start Game / Create Game /
 * Choose Bot), so re-entering the config screen from splash prefills their
 * previous toggle selections instead of resetting them. Falls back to
 * `DEFAULT_CONFIG` if nothing is stored yet or `localStorage` throws
 * (private-browsing/storage-disabled -- same guard as piecesets.ts/
 * boardthemes.ts). Reuses `encodeConfig`/`decodeConfig`'s existing
 * single-hex-digit token rather than a new format.
 */
export function currentLastConfig(): Config {
  let stored: string | null;
  try {
    stored = localStorage.getItem(LAST_CONFIG_KEY);
  } catch {
    return DEFAULT_CONFIG;
  }
  if (!stored || !/^[0-9a-f]$/i.test(stored)) return DEFAULT_CONFIG;
  return decodeConfig(stored);
}

/** Persists the config a player just confirmed. Swallows a persistence
 * failure -- the caller's own in-memory nav state (main.ts's `lastConfig`)
 * still remembers it for the rest of this session either way, it just
 * won't survive a reload. */
export function setLastConfig(c: Config): void {
  try {
    localStorage.setItem(LAST_CONFIG_KEY, encodeConfig(c));
  } catch {
    /* storage unavailable -- in-memory nav state still covers this session */
  }
}

const LAST_PLAYAS_KEY = 'lastplayas';
const DEFAULT_PLAYAS: PlayAs = 'white';
const PLAYAS_VALUES: PlayAs[] = ['white', 'black', 'random'];

/** Same persistence pattern as `currentLastConfig`/`setLastConfig`, its own
 * storage key since color choice isn't part of the engine's `Config`. */
export function currentLastPlayAs(): PlayAs {
  let stored: string | null;
  try {
    stored = localStorage.getItem(LAST_PLAYAS_KEY);
  } catch {
    return DEFAULT_PLAYAS;
  }
  return PLAYAS_VALUES.includes(stored as PlayAs) ? (stored as PlayAs) : DEFAULT_PLAYAS;
}

export function setLastPlayAs(p: PlayAs): void {
  try {
    localStorage.setItem(LAST_PLAYAS_KEY, p);
  } catch {
    /* storage unavailable -- in-memory nav state still covers this session */
  }
}

/** Per-mode copy: the splash screen is the ONLY place a player picks a mode
 * (Play Bots / Pass & Play / Play Online) -- this config card just
 * configures the corrosion tiers/board size for whichever mode was already
 * chosen, so its title and primary-button label reflect that mode instead
 * of asking the player to choose again. */
const MODE_TITLE: Record<'hotseat' | 'host' | 'bot', string> = {
  hotseat: 'Pass & Play',
  host: 'Play Online',
  bot: 'Play a Bot',
};
const MODE_PRIMARY_LABEL: Record<'hotseat' | 'host' | 'bot', string> = {
  hotseat: 'Start Game',
  host: 'Create Game',
  bot: 'Choose Bot',
};

/**
 * Renders the config card (tier toggles + board size) into `#app` for a mode
 * already chosen on the splash screen, and invokes `onStart` once the player
 * confirms. Enforces the tier dependency chain (tier N requires tier N-1
 * checked) directly in the checkbox change handlers, not just visually.
 * `onBack` wires the Back button, which returns to the splash screen (the
 * only mode chooser -- see plan note above). `initialConfig` prefills the
 * toggles (typically the caller's last-confirmed config, via
 * `currentLastConfig`) so returning here -- from splash OR from the bot
 * roster's Back button -- doesn't reset the player's selections.
 * `initialPlayAs` prefills the "Play as" color picker, shown only for
 * 'bot'/'host' (hotseat shares one board, so color choice is meaningless
 * there and the row is omitted entirely).
 */
export function showSetup(
  onStart: (r: SetupResult) => void,
  onBack: () => void,
  mode: 'hotseat' | 'host' | 'bot',
  initialConfig: Config,
  initialPlayAs: PlayAs,
): void {
  const el = document.querySelector<HTMLDivElement>('#app');
  if (!el) throw new Error('showSetup: #app element not found');
  el.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'setup-screen';

  const title = document.createElement('h1');
  title.className = 'setup-title';
  title.textContent = MODE_TITLE[mode];
  wrap.appendChild(title);

  const form = document.createElement('div');
  form.className = 'setup-form';

  function makeToggle(id: string, label: string): { row: HTMLLabelElement; input: HTMLInputElement } {
    const row = document.createElement('label');
    row.className = 'setup-toggle';
    row.htmlFor = id;

    const text = document.createElement('span');
    text.className = 'setup-toggle-label';
    text.textContent = label;

    const switchEl = document.createElement('span');
    switchEl.className = 'toggle-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    const track = document.createElement('span');
    track.className = 'toggle-track';
    const thumb = document.createElement('span');
    thumb.className = 'toggle-thumb';
    track.appendChild(thumb);
    switchEl.append(input, track);

    row.append(text, switchEl);
    return { row, input };
  }

  const tier1 = makeToggle('tier1', 'Tier 1 corrosion (spawns on capture)');
  const tier2 = makeToggle('tier2', 'Tier 2 corrosion');
  const tier3 = makeToggle('tier3', 'Tier 3 corrosion');
  const bigBoard = makeToggle('bigBoard', 'Enlarged board (12x12)');

  // Prefill from the caller's `initialConfig` (last-confirmed selections,
  // or DEFAULT_CONFIG on a first-ever visit -- see `currentLastConfig`).
  // Set before syncTierChain() runs below so it computes tier2/tier3's
  // disabled state from these values, not from all-unchecked; syncTierChain
  // also self-heals an invalid stored combo (e.g. tier3 on with tier2 off).
  tier1.input.checked = initialConfig.tier1;
  tier2.input.checked = initialConfig.tier2;
  tier3.input.checked = initialConfig.tier3;
  bigBoard.input.checked = initialConfig.bigBoard;

  // Dependency chain: tier N requires tier N-1. Enforce in the change
  // handlers (not just via a one-time `disabled` computed at render time)
  // so unchecking a lower tier immediately cascades to the ones above it.
  function syncTierChain(): void {
    tier2.input.disabled = !tier1.input.checked;
    if (!tier1.input.checked) tier2.input.checked = false;

    tier3.input.disabled = !tier2.input.checked;
    if (!tier2.input.checked) tier3.input.checked = false;
  }

  tier1.input.addEventListener('change', syncTierChain);
  tier2.input.addEventListener('change', syncTierChain);
  tier3.input.addEventListener('change', syncTierChain);
  syncTierChain();

  form.append(tier1.row, tier2.row, tier3.row, bigBoard.row);
  wrap.appendChild(form);

  // "Play as" color picker: bot/host only -- hotseat shares one board
  // between two humans, so a color choice has no meaning there.
  let selectedPlayAs: PlayAs = initialPlayAs;
  if (mode === 'bot' || mode === 'host') {
    const colorRow = document.createElement('div');
    colorRow.className = 'setup-color-row';

    const colorLabel = document.createElement('span');
    colorLabel.className = 'setup-toggle-label';
    colorLabel.textContent = 'Play as';
    colorRow.appendChild(colorLabel);

    const colorOptions = document.createElement('div');
    colorOptions.className = 'setup-color-options';

    const optionLabels: { value: PlayAs; label: string }[] = [
      { value: 'white', label: 'White' },
      { value: 'black', label: 'Black' },
      { value: 'random', label: 'Random' },
    ];
    const optionBtns = optionLabels.map(({ value, label }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'setup-color-btn';
      btn.textContent = label;
      btn.setAttribute('aria-pressed', String(value === selectedPlayAs));
      if (value === selectedPlayAs) btn.classList.add('setup-color-btn--active');
      btn.onclick = () => {
        selectedPlayAs = value;
        for (const other of colorOptions.querySelectorAll('.setup-color-btn')) {
          other.classList.remove('setup-color-btn--active');
          other.setAttribute('aria-pressed', 'false');
        }
        btn.classList.add('setup-color-btn--active');
        btn.setAttribute('aria-pressed', 'true');
      };
      return btn;
    });
    colorOptions.append(...optionBtns);
    colorRow.appendChild(colorOptions);
    wrap.appendChild(colorRow);
  }

  const buttons = document.createElement('div');
  buttons.className = 'setup-buttons';

  function currentConfig(): Config {
    return {
      tier1: tier1.input.checked,
      tier2: tier2.input.checked,
      tier3: tier3.input.checked,
      bigBoard: bigBoard.input.checked,
    };
  }

  const backBtn = document.createElement('button');
  backBtn.className = 'btn btn-secondary';
  backBtn.textContent = 'Back';
  backBtn.onclick = onBack;

  const primaryBtn = document.createElement('button');
  primaryBtn.className = 'btn btn-primary';
  primaryBtn.textContent = MODE_PRIMARY_LABEL[mode];
  primaryBtn.onclick = () =>
    onStart({
      config: currentConfig(),
      mode,
      playAs: mode === 'bot' || mode === 'host' ? selectedPlayAs : undefined,
    });

  buttons.append(backBtn, primaryBtn);
  wrap.appendChild(buttons);

  const rulesHint = document.createElement('p');
  rulesHint.className = 'setup-rules-hint';
  rulesHint.textContent = 'Corrosion spawns on capture and marches every round — see the README for full rules.';
  wrap.appendChild(rulesHint);

  el.appendChild(wrap);
}
