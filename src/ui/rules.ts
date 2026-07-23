// User-facing "How Corrosion Works" modal (plan 007): plain-language rule
// sections, each with an optional live example played on a real mini-board
// via the shared scenario machinery (scenarios.ts) -- the same "real
// engine, real board, real animation" staging the DEV-only VFX Lab uses,
// just user-facing and reachable from the splash screen / in-game sidebar.

import { findScenario, createScenarioPlayer } from './scenarios';
import type { ScenarioPlayer } from './scenarios';

interface RuleSection {
  title: string;
  /** Plain-language rule text, kept to ≤2 sentences per the plan. */
  body: string;
  /** Scenario id (scenarios.ts) to play on demand, if this section has one
   * (the last "Tiers" section is text-only). */
  scenarioId?: string;
}

const SECTIONS: RuleSection[] = [
  {
    title: 'The basics',
    body: 'Corrosion Chess plays like normal chess, with one twist: every capture leaves a spreading acid behind on the board.',
    scenarioId: 'spawn',
  },
  {
    title: 'It marches',
    body: 'Once spawned, corrosion advances one square toward the enemy side every round -- it never stops on its own.',
    scenarioId: 'march',
  },
  {
    title: 'It destroys enemy pieces',
    body: 'Any enemy piece the corrosion marches onto is destroyed. The acid is used up doing it -- that cell is gone too.',
    scenarioId: 'piece-kill',
  },
  {
    title: 'It spares your own pieces',
    body: "Corrosion passes harmlessly through your own pieces -- it only ever destroys the opponent's.",
    scenarioId: 'friendly-pass',
  },
  {
    title: 'Opposing acids destroy each other',
    body: 'When white and black corrosion march onto the same square, they annihilate each other completely.',
    scenarioId: 'annihilation',
  },
  {
    title: 'Reaching the far edge: Class 2',
    body: "When corrosion reaches the enemy's back rank, it upgrades to Class 2 -- a longer, two-cell trail that's harder to avoid.",
    scenarioId: 'split',
  },
  {
    title: 'Coming home: Class 3 and purple',
    body: 'If Class 2 corrosion makes it all the way back to ITS OWN back rank, it becomes Class 3 -- it now hurts everyone, and paints the squares it leaves a deadly purple void.',
    scenarioId: 'purple-trail',
  },
  {
    title: 'Purple squares',
    body: 'Nobody may move onto a purple square -- except a king, who cleanses it back to normal by stepping on it. And if purple ever spreads beneath a standing piece, the void consumes it; only kings are immune.',
    scenarioId: 'king-cleanse',
  },
  {
    title: 'Sacrifice plays',
    body: 'Any piece can step onto enemy corrosion to destroy it -- but both are destroyed together. Your king, though, can safely eat enemy corrosion for free.',
    scenarioId: 'piece-captures-corrosion',
  },
  {
    title: 'Tiers',
    body: 'The setup screen\'s Tier toggles control how far this escalates: Tier 1 is capture-spawned corrosion only; Tier 2 adds Class 2 upgrades; Tier 3 adds Class 3 and the purple void.',
  },
];

function buildSectionNav(activeIndex: number, onSelect: (i: number) => void): HTMLDivElement {
  const nav = document.createElement('div');
  nav.className = 'rules-nav';
  SECTIONS.forEach((section, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `rules-nav-item ${i === activeIndex ? 'rules-nav-item--active' : ''}`;
    btn.textContent = `${i + 1}. ${section.title}`;
    btn.onclick = () => onSelect(i);
    nav.appendChild(btn);
  });
  return nav;
}

/**
 * Shows the "How Corrosion Works" modal: a section list (left column on
 * wide layouts, stacked above the content on narrow ones -- see the RULES
 * CSS block) and the currently-selected section's text plus, if it has one,
 * a "▶ Show me" button that plays its scenario on a shared mini-board (one
 * board reused across sections, not nine live boards at once) with a
 * Replay button once played. Esc, the backdrop, or Close dismiss.
 */
export function showRules(onClose: () => void): void {
  let activeIndex = 0;
  let player: ScenarioPlayer | null = null;
  let hasPlayed = false;

  const overlay = document.createElement('div');
  overlay.className = 'promotion-modal-overlay';
  overlay.onclick = e => {
    if (e.target === overlay) close();
  };

  const modal = document.createElement('div');
  modal.className = 'promotion-modal rules-modal';
  overlay.appendChild(modal);

  const header = document.createElement('div');
  header.className = 'rules-header';
  const title = document.createElement('div');
  title.className = 'promotion-modal-title';
  title.textContent = 'How Corrosion Works';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn-secondary rules-close-btn';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.onclick = () => close();
  header.append(title, closeBtn);
  modal.appendChild(header);

  const body = document.createElement('div');
  body.className = 'rules-body';
  modal.appendChild(body);

  const navHolder = document.createElement('div');
  navHolder.className = 'rules-nav-holder';
  body.appendChild(navHolder);

  const content = document.createElement('div');
  content.className = 'rules-content';
  body.appendChild(content);

  function close(): void {
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
    onClose();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKeydown);

  function renderSection(): void {
    navHolder.innerHTML = '';
    navHolder.appendChild(buildSectionNav(activeIndex, i => {
      activeIndex = i;
      hasPlayed = false;
      renderSection();
    }));

    content.innerHTML = '';
    const section = SECTIONS[activeIndex];

    const sectionTitle = document.createElement('h2');
    sectionTitle.className = 'rules-section-title';
    sectionTitle.textContent = section.title;
    content.appendChild(sectionTitle);

    const sectionBody = document.createElement('p');
    sectionBody.className = 'rules-section-body';
    sectionBody.textContent = section.body;
    content.appendChild(sectionBody);

    if (section.scenarioId) {
      const scenarioId = section.scenarioId;
      const stage = document.createElement('div');
      stage.className = 'rules-stage';

      const status = document.createElement('div');
      status.className = 'vfxlab-status rules-stage-status';
      status.textContent = 'Tap "Show me" to play this example.';

      if (!player) player = createScenarioPlayer(text => (status.textContent = text));
      player.boardEl.classList.add('rules-board');
      // Eagerly show THIS section's starting position -- without this, the
      // shared board keeps showing whatever the PREVIOUSLY viewed section
      // last played (its end-state), under the new section's text, until
      // Show Me is clicked.
      player.stage(findScenario(scenarioId));

      const showBtn = document.createElement('button');
      showBtn.className = 'btn btn-primary';
      showBtn.textContent = '▶ Show me';
      showBtn.onclick = () => {
        hasPlayed = true;
        showBtn.textContent = '↻ Replay';
        player!.run(findScenario(scenarioId));
      };
      if (hasPlayed) showBtn.textContent = '↻ Replay';

      stage.append(player.boardEl, status, showBtn);
      content.appendChild(stage);
    }
  }

  renderSection();
  document.body.appendChild(overlay);
}
