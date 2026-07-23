import type { Config } from '../engine/types';

export interface SetupResult {
  config: Config;
  mode: 'hotseat' | 'host' | 'join' | 'bot';
  joinId?: string;
  /** Set once a persona has been picked on the bot-select screen; absent for
   * the initial `onStart({mode:'bot'})` fired by this screen's "Play vs Bot"
   * button (main.ts shows the roster before this is known). */
  personaId?: string;
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
 * only mode chooser -- see plan note above).
 */
export function showSetup(
  onStart: (r: SetupResult) => void,
  onBack: () => void,
  mode: 'hotseat' | 'host' | 'bot',
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

  // Default game options (user request): Tier 1 + Tier 2 on, Tier 3 off.
  // Board size stays off (8x8) by default. Set before syncTierChain() runs
  // so it computes tier3's disabled state from these, not from all-unchecked.
  tier1.input.checked = true;
  tier2.input.checked = true;

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
  primaryBtn.onclick = () => onStart({ config: currentConfig(), mode });

  buttons.append(backBtn, primaryBtn);
  wrap.appendChild(buttons);

  const rulesHint = document.createElement('p');
  rulesHint.className = 'setup-rules-hint';
  rulesHint.textContent = 'Corrosion spawns on capture and marches every round — see the README for full rules.';
  wrap.appendChild(rulesHint);

  el.appendChild(wrap);
}
