import type { Config } from '../engine/types';

export interface SetupResult {
  config: Config;
  mode: 'hotseat' | 'host' | 'join';
  joinId?: string;
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

/**
 * Renders the setup screen into `#app` and invokes `onStart` once the user
 * picks a mode. Enforces the tier dependency chain (tier N requires tier
 * N-1 checked) directly in the checkbox change handlers, not just visually.
 */
export function showSetup(onStart: (r: SetupResult) => void): void {
  const el = document.querySelector<HTMLDivElement>('#app');
  if (!el) throw new Error('showSetup: #app element not found');
  el.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'setup-screen';

  const title = document.createElement('h1');
  title.textContent = 'Corrosion Chess';
  wrap.appendChild(title);

  const form = document.createElement('div');
  form.className = 'setup-form';

  function makeCheckbox(id: string, label: string): { row: HTMLLabelElement; input: HTMLInputElement } {
    const row = document.createElement('label');
    row.className = 'setup-checkbox';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    row.appendChild(input);
    row.append(` ${label}`);
    return { row, input };
  }

  const tier1 = makeCheckbox('tier1', 'Tier 1 corrosion (spawns on capture)');
  const tier2 = makeCheckbox('tier2', 'Tier 2 corrosion');
  const tier3 = makeCheckbox('tier3', 'Tier 3 corrosion');
  const bigBoard = makeCheckbox('bigBoard', 'Enlarged board (12x12)');

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

  const hotseatBtn = document.createElement('button');
  hotseatBtn.textContent = 'Play hotseat';
  hotseatBtn.onclick = () => onStart({ config: currentConfig(), mode: 'hotseat' });

  const onlineBtn = document.createElement('button');
  onlineBtn.textContent = 'Create online game';
  onlineBtn.disabled = true;
  onlineBtn.title = 'Online play arrives in Task 12';

  buttons.append(hotseatBtn, onlineBtn);
  wrap.appendChild(buttons);

  el.appendChild(wrap);
}
