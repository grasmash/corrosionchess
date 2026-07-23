import { showSettings } from './settings';

/**
 * Full-viewport home screen (chess.com-style) that replaces `showSetup` as
 * the app's landing view. `#join=` links are intercepted by `start()` in
 * main.ts BEFORE this is ever called, so splash never has a chance to
 * swallow an invite link.
 */
export function showSplash(onPlay: (mode: 'hotseat' | 'host' | 'bot') => void): void {
  const el = document.querySelector<HTMLDivElement>('#app');
  if (!el) throw new Error('showSplash: #app element not found');
  el.innerHTML = '';

  const screen = document.createElement('div');
  screen.className = 'splash-screen';

  const content = document.createElement('div');
  content.className = 'splash-content';

  const mark = document.createElement('img');
  mark.className = 'splash-mark';
  mark.src = 'art/mark.png';
  mark.alt = '';
  content.appendChild(mark);

  const title = document.createElement('h1');
  title.className = 'splash-title';
  title.textContent = 'CORROSION CHESS';
  content.appendChild(title);

  const tagline = document.createElement('p');
  tagline.className = 'splash-tagline';
  tagline.textContent = 'Capture. Corrode. Survive.';
  content.appendChild(tagline);

  const buttons = document.createElement('div');
  buttons.className = 'splash-buttons';

  const botBtn = document.createElement('button');
  botBtn.className = 'btn btn-primary';
  botBtn.textContent = 'Play Bots';
  botBtn.onclick = () => onPlay('bot');

  const hotseatBtn = document.createElement('button');
  hotseatBtn.className = 'btn btn-secondary';
  hotseatBtn.textContent = 'Pass & Play';
  hotseatBtn.onclick = () => onPlay('hotseat');

  const onlineBtn = document.createElement('button');
  onlineBtn.className = 'btn btn-secondary';
  onlineBtn.textContent = 'Play Online';
  onlineBtn.onclick = () => onPlay('host');

  buttons.append(botBtn, hotseatBtn, onlineBtn);
  content.appendChild(buttons);

  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'btn btn-secondary splash-settings-btn';
  settingsBtn.textContent = '⚙';
  settingsBtn.setAttribute('aria-label', 'Settings');
  settingsBtn.onclick = () => showSettings(() => {});
  content.appendChild(settingsBtn);

  screen.appendChild(content);
  el.appendChild(screen);
}
