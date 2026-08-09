import { Client, IMessage } from '@stomp/stompjs';
import { getStorage } from '../utils';
import { useAuthStore } from '../store/authStore';
import { BASE_URL } from '../api/client';

const storage = getStorage('spotibase-auth');

type RealtimeHandler = (payload: any) => void;

interface RealtimeOptions {
  onNotification?: RealtimeHandler;
  onQueueUpdate?: RealtimeHandler;
  onPresence?: RealtimeHandler;
  onUnreadCount?: RealtimeHandler;
  onPlaylistUpdate?: (playlistId: string, payload: any) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

class RealtimeClient {
  private client: Client | null = null;
  private options: RealtimeOptions = {};
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private playlistSubscriptions = new Map<string, any>();

  /** Build the WS URL from the REST base URL. */
  private getWsUrl(): string {
    const base = BASE_URL.replace(/\/api\/v1\/?$/, '').replace(/^https/, 'wss').replace(/^http/, 'ws');
    return `${base}/ws`;
  }

  connect(options: RealtimeOptions) {
    this.options = { ...options };
    const token = storage.getString('accessToken');

    if (!token || this.connected) return;

    this.client = new Client({
      brokerURL: this.getWsUrl(),
      connectHeaders: {
        Authorization: `Bearer ${token}`,
      },
      reconnectDelay: 5000,
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
      debug: (msg) => {
        if (__DEV__) console.log('[Realtime]', msg);
      },
    });

    this.client.onConnect = () => {
      this.connected = true;
      this.options.onConnected?.();

      // Subscribe to user channels
      this.client!.subscribe('/user/queue/notifications', (msg: IMessage) => {
        this.options.onNotification?.(JSON.parse(msg.body));
      });
      this.client!.subscribe('/user/queue/queue-updates', (msg: IMessage) => {
        this.options.onQueueUpdate?.(JSON.parse(msg.body));
      });
      this.client!.subscribe('/user/queue/presence', (msg: IMessage) => {
        this.options.onPresence?.(JSON.parse(msg.body));
      });
      this.client!.subscribe('/user/queue/unread-count', (msg: IMessage) => {
        this.options.onUnreadCount?.(JSON.parse(msg.body));
      });

      // Announce presence
      this.client!.publish({ destination: '/app/presence.online' });
    };

    this.client.onDisconnect = () => {
      this.connected = false;
      this.options.onDisconnected?.();
    };

    this.client.onStompError = (frame) => {
      console.error('[Realtime] STOMP error:', frame.headers['message']);
    };

    this.client.activate();
  }

  disconnect() {
    if (this.client) {
      try {
        this.client.publish({ destination: '/app/presence.offline' });
      } catch {}
      this.client.deactivate();
      this.client = null;
    }
    this.connected = false;
    this.playlistSubscriptions.clear();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
  }

  /** Subscribe to a collaborative playlist topic. Returns unsubscribe fn. */
  subscribeToPlaylist(playlistId: string, handler: (payload: any) => void): () => void {
    if (!this.client || !this.connected) return () => {};

    const sub = this.client.subscribe(`/topic/playlists/${playlistId}`, (msg: IMessage) => {
      handler(JSON.parse(msg.body));
    });

    this.playlistSubscriptions.set(playlistId, sub);
    // Announce join
    try {
      this.client.publish({ destination: `/app/playlist.${playlistId}.join` });
    } catch {}

    return () => {
      sub.unsubscribe();
      this.playlistSubscriptions.delete(playlistId);
      try {
        this.client?.publish({ destination: `/app/playlist.${playlistId}.leave` });
      } catch {}
    };
  }

  /** Send a playlist edit event to collaborators. */
  sendPlaylistEdit(playlistId: string, payload: any) {
    try {
      this.client?.publish({
        destination: `/app/playlist.${playlistId}.edit`,
        body: JSON.stringify({ type: 'PLAYLIST_EDIT', data: payload, at: Date.now() }),
      });
    } catch {}
  }

  /** Send playback state to other devices. */
  sendQueueSync(payload: any) {
    try {
      this.client?.publish({
        destination: '/app/queue.sync',
        body: JSON.stringify({ ...payload, at: Date.now() }),
      });
    } catch {}
  }

  get isConnected() {
    return this.connected;
  }
}

export const realtime = new RealtimeClient();

/** Connect realtime when the user logs in. Call once from App. */
export function setupRealtime(options: RealtimeOptions) {
  realtime.connect(options);

  // Reconnect on auth changes
  useAuthStore.subscribe((state, prev) => {
    const authed = state.isAuthenticated;
    const wasAuthed = prev.isAuthenticated;
    if (authed && !wasAuthed) {
      setTimeout(() => realtime.connect(options), 500);
    } else if (!authed && wasAuthed) {
      realtime.disconnect();
    }
  });
}

export default realtime;