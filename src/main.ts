import 'chessgroundx/assets/chessground.base.css';
import 'chessgroundx/assets/chessground.brown.css';
// NOTE: chessgroundx's own assets/chessground.cburnett.css ships with piece
// selectors that don't match the classes its runtime actually emits (see
// src/ui/pieces-cburnett.css for details) -- using our locally-corrected copy
// instead so piece art renders.
import './ui/pieces-cburnett.css';
import './style.css';

import { createBoardView } from './ui/boardview';
import type { CgBoardView } from './ui/cgboard';
import { renderOverlays } from './ui/overlays';
import { showSetup, encodeConfig, decodeConfig } from './ui/setup';
import type { SetupResult } from './ui/setup';
import { renderHud, pickPromotion } from './ui/hud';
import type { NetStatus } from './ui/hud';
import { newGame, applyMove } from './engine/game';
import { legalMoves } from './engine/legal';
import { corrosionPhase } from './engine/corrosion';
import { sq, offsetOf, forwardDir } from './engine/board';
import type { Color, Config, GameState, Move } from './engine/types';
import { host, join, teardownPeer } from './net/peer';
import type { NetMsg, Session } from './net/peer';

const appEl = document.querySelector<HTMLDivElement>('#app')!;

function computeDests(gs: GameState): Map<number, number[]> {
  const dests = new Map<number, number[]>();
  if (gs.result) return dests;
  for (const m of legalMoves(gs)) {
    const arr = dests.get(m.from);
    if (arr) {
      // A promotion square offers 4 legal moves (one per promotable piece)
      // that share the same from/to -- dedupe so chessgroundx only sees one
      // destination per square instead of 4 identical entries.
      if (!arr.includes(m.to)) arr.push(m.to);
    } else {
      dests.set(m.from, [m.to]);
    }
  }
  return dests;
}

function backToSetup(): void {
  teardownPeer();
  history.replaceState(null, '', window.location.pathname + window.location.search);
  start();
}

/** Top-level router: `#join=<id>&cfg=<token>` vs. the setup screen. */
function start(): void {
  const hash = window.location.hash.replace(/^#/, '');
  const hashParams = new URLSearchParams(hash);
  const joinId = hashParams.get('join');

  if (joinId) {
    const config = parseCfgToken(hashParams.get('cfg'));
    if (!config) {
      showJoinError('This game link is missing or has an invalid configuration.');
      return;
    }
    startJoinGame(joinId, config);
    return;
  }

  showSetup(result => {
    if (result.mode === 'host') {
      startHostGame(result.config);
    } else {
      // Only 'hotseat' and 'host' are reachable from showSetup: 'join' is
      // intercepted by start() above before showSetup() ever runs.
      startGame(result);
    }
  });
}

/**
 * Strict validator for the `cfg=` URL param. `decodeConfig` (used
 * internally, where the token always came from our own `encodeConfig`) maps
 * any garbage to an all-off config for convenient round-tripping -- but a
 * `cfg=` value arriving via a shared URL is untrusted input, so reject
 * anything outside the single-hex-digit alphabet `encodeConfig` actually
 * produces rather than silently starting a mis-configured game.
 */
function parseCfgToken(token: string | null): Config | null {
  if (!token || !/^[0-9a-f]$/i.test(token)) return null;
  return decodeConfig(token);
}

function showJoinError(message: string): void {
  appEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'join-placeholder';

  const title = document.createElement('h1');
  title.textContent = 'Corrosion Chess';

  const msg = document.createElement('p');
  msg.textContent = message;

  const backBtn = document.createElement('button');
  backBtn.textContent = 'Back to setup';
  backBtn.onclick = backToSetup;

  wrap.append(title, msg, backBtn);
  appEl.appendChild(wrap);
}

/** Clipboard write with a `document.execCommand` fallback for contexts
 * (older browsers, non-secure origins) where the async Clipboard API isn't
 * available. */
function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      resolve();
    } catch (e) {
      reject(e);
    } finally {
      ta.remove();
    }
  });
}

/** Host flow: create a Peer, show the share URL + "waiting for opponent"
 * once the broker assigns an ID, and mount the online game screen the
 * moment a guest connects (host is always White). Re-fires for subsequent
 * connections too (a guest rejoining via the same URL after a drop), in
 * which case the already-mounted game just re-wires to the fresh session. */
function startHostGame(config: Config): void {
  appEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'host-wait-screen';

  const title = document.createElement('h1');
  title.textContent = 'Corrosion Chess';

  const status = document.createElement('p');
  status.textContent = 'Setting up game…';

  const urlRow = document.createElement('div');
  urlRow.className = 'host-wait-url-row';
  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.id = 'join-url';
  urlInput.name = 'join-url';
  urlInput.setAttribute('aria-label', 'Game join link');
  urlInput.readOnly = true;
  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy link';
  copyBtn.disabled = true;
  copyBtn.onclick = () => {
    copyText(urlInput.value)
      .then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.textContent = 'Copy link';
        }, 1500);
      })
      .catch(() => {
        /* clipboard denied -- the URL is still selectable in the input */
      });
  };
  urlRow.append(urlInput, copyBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = backToSetup;

  wrap.append(title, status, urlRow, cancelBtn);
  appEl.appendChild(wrap);

  // The PeerJS cloud broker requires internet access; if it's unreachable
  // this fires and tells the user rather than leaving them on "Setting up
  // game..." forever.
  const readyTimeout = setTimeout(() => {
    status.textContent =
      'Could not reach the PeerJS signaling server (offline?). Online play needs internet access.';
  }, 8000);

  let rewireSession: ((s: Session) => void) | null = null;

  host(
    peerId => {
      clearTimeout(readyTimeout);
      const url = `${window.location.origin}${window.location.pathname}#join=${peerId}&cfg=${encodeConfig(config)}`;
      urlInput.value = url;
      copyBtn.disabled = false;
      status.textContent = 'Waiting for opponent…';
    },
    session => {
      if (!rewireSession) {
        rewireSession = mountOnlineGame({
          youAre: 'w',
          isHost: true,
          config,
          initialState: newGame(config),
          session,
        });
      } else {
        rewireSession(session);
      }
    }
  );
}

/** Guest flow: create a Peer, connect to the host's ID, and wait for the
 * `init` message (which carries the host-authoritative config/state/color)
 * before mounting the online game screen. The URL's `cfg=` token is only
 * used to fail fast on an obviously-broken link -- actual gameplay always
 * uses the config the host sends, never the client-parsed one. */
function startJoinGame(peerId: string, _urlConfig: Config): void {
  appEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'join-placeholder';

  const title = document.createElement('h1');
  title.textContent = 'Corrosion Chess';

  const msg = document.createElement('p');
  msg.textContent = 'Connecting to game…';

  const backBtn = document.createElement('button');
  backBtn.textContent = 'Back to setup';
  backBtn.onclick = backToSetup;

  wrap.append(title, msg, backBtn);
  appEl.appendChild(wrap);

  const connectTimeout = setTimeout(() => {
    msg.textContent =
      'Could not reach the PeerJS signaling server (offline?). Online play needs internet access.';
  }, 8000);

  let mounted = false;

  join(peerId, session => {
    clearTimeout(connectTimeout);
    session.onMessage(m => {
      if (!mounted && m.type === 'init') {
        mounted = true;
        mountOnlineGame({
          youAre: m.yourColor,
          isHost: false,
          config: m.config,
          initialState: m.state,
          session,
        });
      }
    });
    session.onStatus(status => {
      if (!mounted && status === 'closed') {
        msg.textContent = 'Could not connect to the host -- they may be offline or the link expired.';
      }
    });
  });
}

/**
 * Derives the total ply count (half-moves played) purely from `GameState`,
 * with no separate wire field needed: `round` only increments (in
 * `applyMove`) right after Black's move, so `round`+`turn` alone pin down
 * exactly how many plies have been played. Used to seed the local ply
 * counter from the state an `init` message carries -- critical for a guest
 * rejoining mid-game, where otherwise its counter would reset to 0 while
 * the host's has advanced, and the guest's next move would be spuriously
 * rejected by the resync check below until the first resync round-trip.
 */
function plyFromState(gs: GameState): number {
  return 2 * (gs.round - 1) + (gs.turn === 'b' ? 1 : 0);
}

interface OnlineGameParams {
  config: Config;
  youAre: Color;
  isHost: boolean;
  initialState: GameState;
  session: Session;
}

/**
 * Mounts the shared board + HUD for an online game and wires it to a
 * `Session`. Protocol: moves are applied locally first, then broadcast as
 * `{type:'move', seq}` where `seq` is the ply count (see `plyFromState`)
 * both sides keep in lockstep. A mismatched `seq` (e.g. a dropped message)
 * triggers the resync dance -- the guest sends `resync-request`, the host
 * (the only side that ever answers one, since it's the side whose state
 * persists across reconnects) replies with the authoritative `state`+`seq`.
 * The host also self-corrects proactively: if it ever receives a `move`
 * whose `seq` doesn't match, it already knows the truth and sends `resync`
 * unprompted rather than waiting to be asked.
 *
 * Returns a `rewire(session)` function so the host can reattach the same
 * mounted game to a new `Session` when a guest reconnects, re-sending
 * `init` with the current state once the fresh channel opens.
 */
function mountOnlineGame(params: OnlineGameParams): (s: Session) => void {
  const { config, youAre, isHost } = params;
  let state = params.initialState;
  let session = params.session;
  let ply = plyFromState(state);
  let netStatus: NetStatus = 'connecting';

  appEl.innerHTML = '';
  const layout = document.createElement('div');
  layout.className = 'game-layout';
  const boardEl = document.createElement('div');
  boardEl.className = 'board-wrap';
  boardEl.id = 'board';
  const hudEl = document.createElement('div');
  hudEl.id = 'hud';
  layout.append(boardEl, hudEl);
  appEl.appendChild(layout);

  const view = createBoardView(state.size);
  view.mount(boardEl);
  view.setOrientation(youAre);

  function render(): void {
    const canMove = !state.result && state.turn === youAre && netStatus === 'open';
    view.setState(state, canMove ? computeDests(state) : new Map());
    renderOverlays(boardEl, view, state);
    renderHud(hudEl, state, { youAre, netStatus, onNewGame: backToSetup });
  }

  function sendResyncFromHost(): void {
    session.send({ type: 'resync', seq: ply, state });
  }

  function handleIncoming(msg: NetMsg): void {
    switch (msg.type) {
      case 'init':
        // A guest only ever gets this once, before mounting (see
        // startJoinGame) -- but if the host process itself restarted and
        // re-sent one on top of an existing session, treat it the same as
        // a resync: it carries the full authoritative state.
        // init/resync travel host->guest ONLY; the host must never accept a
        // full-state overwrite from the wire (mirrors the resync-request gate
        // below).
        if (!isHost) {
          state = msg.state;
          ply = plyFromState(state);
          render();
        }
        break;
      case 'move':
        if (msg.seq === ply) {
          try {
            state = applyMove(state, msg.move);
            ply++;
            render();
          } catch {
            if (isHost) sendResyncFromHost();
            else session.send({ type: 'resync-request' });
          }
        } else if (isHost) {
          // We're authoritative -- no need to be asked, just correct them.
          sendResyncFromHost();
        } else {
          session.send({ type: 'resync-request' });
        }
        break;
      case 'resync-request':
        if (isHost) sendResyncFromHost();
        break;
      case 'resync':
        // Same host->guest-only invariant as 'init' above.
        if (!isHost) {
          state = msg.state;
          ply = msg.seq;
          render();
        }
        break;
    }
  }

  function wireSession(s: Session): void {
    session = s;
    // A rewired-away-from session (the host's previous connection, when a
    // guest reconnects) keeps emitting events for a while after we've moved
    // on -- e.g. its ICE state finally settling to 'disconnected'/'closed'
    // well after the new connection is already open. Its callbacks below
    // are never unregistered (Session exposes no `off`), so guard each one
    // on `session === s` to make them inert once a newer session has taken
    // over; otherwise a late stale-connection event can clobber the fresh
    // connection's status/state.
    s.onStatus(status => {
      if (session !== s) return;
      netStatus = status;
      render();
    });
    s.onMessage(msg => {
      if (session !== s) return;
      handleIncoming(msg);
    });
    if (isHost) {
      // Send (or re-send, on reconnect) `init` as soon as the channel is
      // actually open -- sending earlier would silently no-op (Session.send
      // drops writes to a not-yet-open connection).
      s.onStatus(status => {
        if (session !== s) return;
        if (status === 'open') {
          s.send({ type: 'init', config, state, yourColor: 'b' });
        }
      });
    }
  }

  wireSession(session);

  function playLocalMove(move: Move): void {
    let next: GameState;
    try {
      next = applyMove(state, move);
    } catch {
      render(); // shouldn't happen: cg only offers dests we gave it
      return;
    }
    state = next;
    session.send({ type: 'move', seq: ply, move });
    ply++;
    render();
  }

  view.onMove((from, to) => {
    if (state.result) return;
    if (state.turn !== youAre || netStatus !== 'open') return; // input gating
    const candidates = legalMoves(state, from).filter(m => m.to === to);
    if (candidates.length === 0) return; // shouldn't happen: cg only offers dests we gave it

    const needsPromotion = candidates.every(m => m.promotion);
    if (needsPromotion) {
      pickPromotion(youAre).then(promotion => playLocalMove({ from, to, promotion }));
    } else {
      playLocalMove(candidates[0]);
    }
  });

  render();

  // Expose the raw chessgroundx Api for manual verification only (see
  // startGame below for the same pattern in hotseat mode).
  (window as unknown as { __cg: ReturnType<CgBoardView['api']> }).__cg = (view as unknown as CgBoardView).api();

  return (s: Session) => wireSession(s);
}

function startGame(setup: SetupResult): void {
  // Only 'hotseat' reaches here: 'host' is wired to startHostGame above, and
  // 'join' is intercepted by start() before showSetup() ever runs.
  let state: GameState = newGame(setup.config);

  appEl.innerHTML = '';
  const layout = document.createElement('div');
  layout.className = 'game-layout';
  const boardEl = document.createElement('div');
  boardEl.className = 'board-wrap';
  boardEl.id = 'board';
  const hudEl = document.createElement('div');
  hudEl.id = 'hud';
  layout.append(boardEl, hudEl);
  appEl.appendChild(layout);

  const view = createBoardView(state.size);
  view.mount(boardEl);

  function render(): void {
    view.setState(state, computeDests(state));
    renderOverlays(boardEl, view, state);
    renderHud(hudEl, state, { onNewGame: start });
  }

  function playMove(move: Move): void {
    try {
      state = applyMove(state, move);
    } catch {
      // Illegal move -- shouldn't happen since chessgroundx is only ever
      // given legal-move-derived dests, but belt-and-braces: just re-render
      // (dests already force a visual snap-back) rather than crash.
    }
    render();
  }

  view.onMove((from, to) => {
    if (state.result) return;
    const candidates = legalMoves(state, from).filter(m => m.to === to);
    if (candidates.length === 0) return; // shouldn't happen: cg only offers dests we gave it

    const needsPromotion = candidates.every(m => m.promotion);
    if (needsPromotion) {
      const color = state.turn;
      pickPromotion(color).then(promotion => playMove({ from, to, promotion }));
    } else {
      playMove(candidates[0]);
    }
  });

  render();

  // Expose the raw chessgroundx Api for manual verification only (e.g.
  // `window.__cg.selectSquare('e2'); window.__cg.selectSquare('e4');` drives
  // a move through the same click-to-move pipeline a real click would).
  // Not part of the BoardView contract.
  (window as unknown as { __cg: ReturnType<CgBoardView['api']> }).__cg = (view as unknown as CgBoardView).api();

  if (import.meta.env.DEV) {
    mountDevTools(
      () => state,
      next => {
        state = next;
        render();
      }
    );
  }
}

start();

// --- Dev-only tools: eyeball corrosion overlay rendering (marching,
// stacking, class-3/purple) and exercise the promotion picker without
// having to play through a full game. Dead-code-eliminated from production
// builds because Vite inlines `import.meta.env.DEV` as a literal `false`
// there. ---
function mountDevTools(getState: () => GameState, setState: (s: GameState) => void): void {
  // A hand-built dev scenario dropped onto the *current* board/kings (so
  // legalMoves/check keep working) rather than a whole synthetic GameState:
  // one white cls-1 unit, a same-square white cls-1 stack (×2 badge), a
  // black cls-2 unit (lead + trail cell), and a white cls-3 unit (paints
  // purple under itself every phase it survives -- see corrosion.ts step 2).
  const buildDevCorrosionState = (base: GameState): GameState => {
    const s = structuredClone(base);
    const size = s.size;
    const off = offsetOf(size);
    const emptyRank = off + 2; // first empty rank in front of white's pawns

    const stackSq = sq(off + 1, emptyRank, size);
    const trailLeadSq = sq(off + 3, emptyRank, size);
    const cls3Sq = sq(off + 5, emptyRank, size);

    s.corrosions = [
      { id: 901, color: 'w', cls: 1, cells: [stackSq], dir: forwardDir('w'), bornRound: 0 },
      { id: 902, color: 'w', cls: 1, cells: [stackSq], dir: forwardDir('w'), bornRound: 0 },
      {
        id: 903,
        color: 'b',
        cls: 2,
        cells: [trailLeadSq, trailLeadSq - forwardDir('b') * size],
        dir: forwardDir('b'),
        bornRound: 0,
      },
      { id: 904, color: 'w', cls: 3, cells: [cls3Sq], dir: forwardDir('w'), bornRound: 0 },
    ];
    // The cls-3 unit starts on an already-purple square: purple is
    // reachable-but-immune for cls3 (see corrosion.ts step 2/6), so this is
    // the normal state after it bounces off the board edge and retreads a
    // square from its own outbound trail -- not a synthetic edge case.
    s.purple = [cls3Sq];
    s.nextId = 1000;
    return s;
  };

  const devTools = document.createElement('div');
  devTools.id = 'dev-tools';

  const seedBtn = document.createElement('button');
  seedBtn.textContent = 'Load corrosion dev scenario';
  seedBtn.onclick = () => setState(buildDevCorrosionState(getState()));

  const phaseBtn = document.createElement('button');
  phaseBtn.textContent = 'Force corrosion phase';
  phaseBtn.onclick = () => {
    const next = structuredClone(getState());
    corrosionPhase(next);
    next.round++;
    setState(next);
  };

  const promotionBtn = document.createElement('button');
  promotionBtn.textContent = 'Test promotion picker';
  promotionBtn.onclick = () => {
    pickPromotion('w').then(choice => {
      console.log('pickPromotion resolved with:', choice);
    });
  };

  devTools.append(seedBtn, phaseBtn, promotionBtn);
  appEl.appendChild(devTools);
}
