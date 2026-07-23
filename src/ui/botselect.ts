import type { Persona } from '../ai/personas';
import { PERSONAS } from '../ai/personas';

function avatarFallback(p: Persona): HTMLDivElement {
  const fallback = document.createElement('div');
  fallback.className = 'avatar-fallback';
  fallback.textContent = p.name.charAt(0).toUpperCase();
  return fallback;
}

function buildCard(p: Persona, onSelect: (p: Persona) => void): HTMLButtonElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'bot-card';
  card.dataset.personaId = p.id;

  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'bot-card-avatar-wrap';
  const img = document.createElement('img');
  img.className = 'bot-card-avatar';
  img.src = p.avatar;
  img.alt = p.name;
  img.width = 56;
  img.height = 56;
  img.onerror = () => {
    img.replaceWith(avatarFallback(p));
  };
  avatarWrap.appendChild(img);

  const info = document.createElement('div');
  info.className = 'bot-card-info';

  const nameRow = document.createElement('div');
  nameRow.className = 'bot-card-name-row';
  const name = document.createElement('span');
  name.className = 'bot-card-name';
  name.textContent = p.name;
  const rating = document.createElement('span');
  rating.className = 'bot-card-rating';
  rating.textContent = String(p.rating);
  nameRow.append(name, rating);

  const tagline = document.createElement('div');
  tagline.className = 'bot-card-tagline';
  tagline.textContent = p.tagline;

  info.append(nameRow, tagline);
  card.append(avatarWrap, info);

  card.onclick = () => onSelect(p);
  return card;
}

function buildSection(title: string, personas: Persona[], onSelect: (p: Persona) => void): HTMLDivElement {
  const section = document.createElement('div');
  section.className = 'bot-select-section';

  const heading = document.createElement('h2');
  heading.className = 'bot-select-section-title';
  heading.textContent = title;
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'bot-card-grid';
  for (const p of personas) {
    grid.appendChild(buildCard(p, onSelect));
  }
  section.appendChild(grid);

  return section;
}

/**
 * Renders the chess.com-style bot roster into `#app`: a "Family & Pets"
 * section (the six named personas) then "The Bobs" (the Bob army + Joe).
 * Clicking a card highlights it and enables "Play"; "Play" invokes `onPick`,
 * "Back" invokes `onBack`.
 */
export function showBotSelect(onPick: (p: Persona) => void, onBack: () => void): void {
  const el = document.querySelector<HTMLDivElement>('#app');
  if (!el) throw new Error('showBotSelect: #app element not found');
  el.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'bot-select-screen';

  const title = document.createElement('h1');
  title.className = 'setup-title';
  title.textContent = 'Play a Bot';
  wrap.appendChild(title);

  let selected: Persona | null = null;

  const playBtn = document.createElement('button');
  playBtn.className = 'btn btn-primary';
  playBtn.textContent = 'Play';
  playBtn.disabled = true;
  playBtn.onclick = () => {
    if (selected) onPick(selected);
  };

  function selectCard(p: Persona, cardEl: HTMLButtonElement, grid: ParentNode): void {
    selected = p;
    for (const card of grid.querySelectorAll('.bot-card')) {
      card.classList.remove('bot-card--selected');
    }
    cardEl.classList.add('bot-card--selected');
    playBtn.disabled = false;
  }

  const family = PERSONAS.filter(p => p.group === 'family');
  const bobs = PERSONAS.filter(p => p.group === 'bob');
  const coaches = PERSONAS.filter(p => p.group === 'coach');

  const handleSelect = (p: Persona): void => {
    const cardEl = wrap.querySelector<HTMLButtonElement>(`.bot-card[data-persona-id="${p.id}"]`);
    if (cardEl) selectCard(p, cardEl, wrap);
  };

  wrap.appendChild(buildSection('Family & Pets', family, handleSelect));
  wrap.appendChild(buildSection('The Bobs', bobs, handleSelect));
  if (coaches.length > 0) {
    wrap.appendChild(buildSection('Coach', coaches, handleSelect));
  }

  const buttons = document.createElement('div');
  buttons.className = 'setup-buttons bot-select-buttons';

  const backBtn = document.createElement('button');
  backBtn.className = 'btn btn-secondary';
  backBtn.textContent = 'Back';
  backBtn.onclick = onBack;

  buttons.append(backBtn, playBtn);
  wrap.appendChild(buttons);

  el.appendChild(wrap);
}
