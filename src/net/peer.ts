import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import type { Color, Config, GameState, Move } from '../engine/types';

export type NetMsg =
  | { type: 'init'; config: Config; state: GameState; yourColor: Color }
  | { type: 'move'; seq: number; move: Move }
  | { type: 'resync-request' }
  | { type: 'resync'; seq: number; state: GameState };

export type NetStatus = 'connecting' | 'open' | 'closed';

export interface Session {
  send(m: NetMsg): void;
  onMessage(cb: (m: NetMsg) => void): void;
  onStatus(cb: (s: NetStatus) => void): void;
}

// Tracked so `teardownPeer()` can release the broker connection (and the
// peer ID) when the player leaves an online game -- otherwise the Peer (and
// its WebSocket to the signaling server) would leak for the lifetime of the
// tab even after returning to the setup screen.
let activePeer: Peer | null = null;

/**
 * Wraps a PeerJS `DataConnection` as a `Session`: multi-subscriber
 * `onMessage`/`onStatus` (both host and guest wiring register more than one
 * handler over a session's life, e.g. on reconnect), plus an `onStatus`
 * that replays the current status to a newly-registered subscriber so
 * nobody joining after the fact misses an already-fired 'open'.
 */
function wrapConnection(conn: DataConnection): Session {
  const messageCbs: ((m: NetMsg) => void)[] = [];
  const statusCbs: ((s: NetStatus) => void)[] = [];
  let status: NetStatus = conn.open ? 'open' : 'connecting';

  function setStatus(next: NetStatus): void {
    if (status === next) return;
    status = next;
    for (const cb of statusCbs.slice()) cb(status);
  }

  conn.on('open', () => setStatus('open'));
  conn.on('close', () => setStatus('closed'));
  conn.on('error', () => setStatus('closed'));
  // `close`/`error` only fire on a *graceful* teardown (the other side
  // calling `conn.close()`, or a negotiation failure). An abrupt disconnect
  // -- the other tab closing, a network drop -- instead only ever surfaces
  // as the underlying RTCPeerConnection's ICE state moving to
  // 'disconnected'/'failed'/'closed'; without watching it too, `status`
  // would incorrectly report 'open' indefinitely after the other side
  // vanishes.
  conn.on('iceStateChanged', iceState => {
    if (iceState === 'disconnected' || iceState === 'failed' || iceState === 'closed') {
      setStatus('closed');
    }
  });
  conn.on('data', data => {
    for (const cb of messageCbs.slice()) cb(data as NetMsg);
  });

  return {
    send(m) {
      // Silently drop rather than throw if the channel isn't open -- callers
      // gate user input on connection status already (see main.ts), so a
      // send that races a status flip is expected, not exceptional.
      if (conn.open) conn.send(m);
    },
    onMessage(cb) {
      messageCbs.push(cb);
    },
    onStatus(cb) {
      statusCbs.push(cb);
      cb(status);
    },
  };
}

/**
 * Starts hosting a game: creates a `Peer` with a broker-assigned ID (shown
 * to the user via `onReady` so they can share the join URL) and invokes
 * `onConn` once per incoming `DataConnection`. This fires more than once
 * over the Peer's life when a guest reconnects (e.g. reloading the join URL
 * after a drop) -- callers are expected to re-wire message/status handling
 * to the fresh `Session` and re-send `init` with the current `GameState`.
 */
export function host(onReady: (id: string) => void, onConn: (s: Session) => void): void {
  const peer = new Peer();
  activePeer = peer;
  peer.on('open', id => onReady(id));
  peer.on('connection', conn => onConn(wrapConnection(conn)));
  peer.on('error', err => console.error('[peer] host error:', err));
}

/**
 * Connects to a hosting peer by its broker ID and invokes `onConn` once the
 * `DataConnection` exists (its `Session` starts in 'connecting' status;
 * callers should wait for 'open' before trusting it).
 */
export function join(id: string, onConn: (s: Session) => void): void {
  const peer = new Peer();
  activePeer = peer;
  peer.on('open', () => {
    const conn = peer.connect(id, { reliable: true });
    onConn(wrapConnection(conn));
  });
  peer.on('error', err => console.error('[peer] join error:', err));
}

/**
 * Destroys the current Peer: closes its connection to the signaling server
 * and all of its DataConnections. Call this when the player leaves an
 * online game (cancel host, back-to-setup, new game) so the broker ID and
 * underlying WebSocket don't leak for the rest of the tab's life.
 */
export function teardownPeer(): void {
  activePeer?.destroy();
  activePeer = null;
}
