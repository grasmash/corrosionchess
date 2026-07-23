// Plan 001 (VFX) iteration: a DEV-only showcase that plays each corrosion
// animation in isolation with the REAL rendering pipeline -- a small real
// 8x8 board, a rail of buttons that each stage a scripted `GameState` via
// direct engine calls (exactly what a real game calls) and then trigger the
// actual transition, a "Slow motion" toggle, and "Replay". Staging/board
// machinery lives in `scenarios.ts` (shared with the user-facing rules
// explainer, src/ui/rules.ts) -- this module is just the DEV-only rail/
// controls UI around it.
//
// Reachable two ways (both DEV-gated by the caller, main.ts): a "VFX Lab"
// button in the dev-tools row, and the `#vfxlab` hash.

import { SCENARIOS, createScenarioPlayer } from './scenarios';
import type { Scenario } from './scenarios';

export function mountVfxLab(onBack: () => void): void {
  const appEl = document.querySelector<HTMLDivElement>('#app')!;
  appEl.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'vfxlab';

  const title = document.createElement('h1');
  title.className = 'setup-title';
  title.textContent = 'VFX Lab';

  const subtitle = document.createElement('p');
  subtitle.className = 'setup-rules-hint';
  subtitle.textContent = 'Each button stages a scripted position with the real engine, then plays the real transition.';

  const status = document.createElement('div');
  status.className = 'vfxlab-status';
  status.textContent = 'Pick a scenario below.';

  const player = createScenarioPlayer(text => {
    status.textContent = text;
  });
  player.boardEl.classList.add('vfxlab-board');
  player.boardEl.id = 'vfxlab-board';

  const controlsRow = document.createElement('div');
  controlsRow.className = 'vfxlab-controls';

  const slowMoLabel = document.createElement('label');
  slowMoLabel.className = 'vfxlab-slowmo';
  const slowMoCheckbox = document.createElement('input');
  slowMoCheckbox.type = 'checkbox';
  slowMoLabel.append(slowMoCheckbox, document.createTextNode(' Slow motion (0.25x)'));

  const replayBtn = document.createElement('button');
  replayBtn.className = 'btn btn-secondary';
  replayBtn.textContent = 'Replay';
  replayBtn.disabled = true;

  const backBtn = document.createElement('button');
  backBtn.className = 'btn btn-secondary';
  backBtn.textContent = 'Back';
  backBtn.onclick = onBack;

  controlsRow.append(slowMoLabel, replayBtn, backBtn);

  const rail = document.createElement('div');
  rail.className = 'vfxlab-rail';

  slowMoCheckbox.onchange = () => player.setSlowMo(slowMoCheckbox.checked);

  let lastScenario: Scenario | null = null;

  function run(scenario: Scenario): void {
    lastScenario = scenario;
    replayBtn.disabled = false;
    player.run(scenario);
  }

  for (const scenario of SCENARIOS) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary vfxlab-scenario-btn';
    btn.textContent = scenario.label;
    btn.onclick = () => run(scenario);
    rail.appendChild(btn);
  }

  replayBtn.onclick = () => {
    if (lastScenario) run(lastScenario);
  };

  wrap.append(title, subtitle, player.boardEl, status, controlsRow, rail);
  appEl.appendChild(wrap);
}
