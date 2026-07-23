import type { Color, GameState, PieceType } from '../engine/types';

const PROMOTION_CHOICES: { type: PieceType; label: string }[] = [
  { type: 'q', label: 'Queen' },
  { type: 'r', label: 'Rook' },
  { type: 'b', label: 'Bishop' },
  { type: 'n', label: 'Knight' },
];

function colorName(c: Color): string {
  return c === 'w' ? 'White' : 'Black';
}

function turnText(gs: GameState, youAre?: Color): string {
  if (youAre) {
    return gs.turn === youAre ? 'Your move' : "Opponent's move";
  }
  return `${colorName(gs.turn)} to move`;
}

function resultText(gs: GameState): string {
  const { winner, reason } = gs.result!;
  return winner ? `${colorName(winner)} wins by ${reason}` : `Draw by ${reason}`;
}

export type NetStatus = 'connecting' | 'open' | 'closed';

function netStatusText(s: NetStatus): string {
  switch (s) {
    case 'connecting':
      return 'Connecting…';
    case 'open':
      return 'Connected';
    case 'closed':
      return 'Opponent disconnected — waiting…';
  }
}

export interface HudOptions {
  youAre?: Color;
  onNewGame?: () => void;
  /** Task 12: online games only -- omit entirely for hotseat. */
  netStatus?: NetStatus;
}

/**
 * Renders the (optional) net status line, turn indicator, last 8 log
 * events, and (when the game has ended) a result banner with a "New game"
 * button into `el`. Full redraw each call, matching the rest of the UI
 * layer's render-from-state pattern.
 */
export function renderHud(el: HTMLElement, gs: GameState, opts: HudOptions = {}): void {
  el.innerHTML = '';

  if (opts.netStatus) {
    const net = document.createElement('div');
    net.className = `hud-net-status hud-net-status--${opts.netStatus}`;
    net.textContent = netStatusText(opts.netStatus);
    el.appendChild(net);
  }

  const turn = document.createElement('div');
  turn.className = 'hud-turn';
  turn.textContent = gs.result ? resultText(gs) : turnText(gs, opts.youAre);
  el.appendChild(turn);

  if (gs.result) {
    const banner = document.createElement('div');
    banner.className = 'hud-result-banner';
    banner.textContent = resultText(gs);

    const newGameBtn = document.createElement('button');
    newGameBtn.textContent = 'New game';
    newGameBtn.onclick = () => opts.onNewGame?.();

    banner.appendChild(newGameBtn);
    el.appendChild(banner);
  }

  const log = document.createElement('div');
  log.className = 'hud-log';
  const recent = gs.log.slice(-8);
  for (const entry of recent) {
    const line = document.createElement('div');
    line.className = 'hud-log-entry';
    line.textContent = `#${entry.round} ${entry.text}`;
    log.appendChild(line);
  }
  el.appendChild(log);
}

/**
 * Shows a modal with a button per promotion choice (queen/rook/bishop/
 * knight) and resolves with the chosen PieceType once the player picks one.
 */
export function pickPromotion(color: Color): Promise<PieceType> {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'promotion-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'promotion-modal';

    const title = document.createElement('div');
    title.className = 'promotion-modal-title';
    title.textContent = `${colorName(color)} promotion`;
    modal.appendChild(title);

    const choices = document.createElement('div');
    choices.className = 'promotion-modal-choices';

    for (const { type, label } of PROMOTION_CHOICES) {
      const btn = document.createElement('button');
      btn.className = `promotion-choice promotion-choice--${type}`;
      btn.textContent = label;
      btn.onclick = () => {
        overlay.remove();
        resolve(type);
      };
      choices.appendChild(btn);
    }

    modal.appendChild(choices);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  });
}
