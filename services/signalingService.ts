import { Platform } from 'react-native';
import { Participant, UserRole, TallyState } from '../context/IntercomContext';

export type SignalingEventType =
  | 'USER_JOINED'
  | 'USER_LEFT'
  | 'TALLY_UPDATE'
  | 'MUTE_REMOTE_OPERATOR'
  | 'REMOTE_MUTE_TOGGLE'
  | 'AUDIO_OFFER'
  | 'AUDIO_ANSWER'
  | 'ICE_CANDIDATE'
  | 'webrtc-offer'
  | 'webrtc-answer'
  | 'webrtc-ice-candidate'
  | 'PING'
  | 'PONG';

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

export interface SignalingMessage<T = any> {
  type: SignalingEventType;
  roomId: string;
  senderId: string;
  senderName?: string;
  senderRole?: UserRole;
  timestamp: number;
  payload: T;
}

export interface UserJoinedPayload {
  user: Participant;
  isSyncReply?: boolean;
}

export interface UserLeftPayload {
  userId: string;
  cameraId?: string;
}

export interface TallyUpdatePayload {
  cameraId: string;
  state: 'PREVIEW' | 'PROGRAM' | 'IDLE';
  activePreviewCamera: string | null;
  activeProgramCamera: string | null;
  senderRole: 'director';
  directorId: string;
}

export interface MuteRemoteOperatorPayload {
  targetUserId: string;
  targetCameraId?: string;
  mute: boolean;
  senderRole: 'director';
  directorId: string;
}

export interface RemoteMuteTogglePayload {
  targetCamera?: string | number;
  targetCameraId?: string;
  targetUserId?: string;
  forceMute?: boolean;
  mute?: boolean;
  senderRole: 'director';
  directorId: string;
}

export interface AudioOfferPayload {
  sdp: any;
  fromUserId: string;
  toUserId?: string;
}

export interface AudioAnswerPayload {
  sdp: any;
  fromUserId: string;
  toUserId?: string;
}

export interface IceCandidatePayload {
  candidate: any;
  fromUserId: string;
  toUserId?: string;
}

type MessageHandler<T = any> = (payload: T, message: SignalingMessage<T>) => void;
type ConnectionStatusHandler = (status: ConnectionStatus) => void;

/**
 * Normalizes and sanitizes room names dynamically:
 * - Trims surrounding whitespace
 * - Strips accents/diacritics
 * - Converts to uppercase for uniform case-insensitivity
 * - Replaces any whitespace or underscore sequences with a hyphen
 * - Allows alphanumeric characters and hyphens
 * - Deduplicates hyphens and trims leading/trailing hyphens
 * - Defaults to 'DEFAULT' if empty
 */
export function normalizeRoomId(rawRoomId: string | null | undefined): string {
  if (!rawRoomId || typeof rawRoomId !== 'string') {
    return 'DEFAULT';
  }
  const cleaned = rawRoomId
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return cleaned || 'DEFAULT';
}

/**
 * Resolves default signaling WebSocket URL:
 * 1. Environment variable EXPO_PUBLIC_SIGNALING_URL (e.g. wss://my-app.onrender.com)
 * 2. URL parameter ?signaling=... or ?ws=... in browser (e.g. for Render/Railway cloud tests)
 * 3. Localhost / local LAN fallback: ws://<hostname>:3001
 * 4. Android emulator fallback: ws://10.0.2.2:3001
 */
export function getDefaultSignalingUrl(): string {
  if (process.env.EXPO_PUBLIC_SIGNALING_URL) {
    return process.env.EXPO_PUBLIC_SIGNALING_URL;
  }

  if (typeof window !== 'undefined' && window.location && window.location.search) {
    try {
      const params = new URLSearchParams(window.location.search);
      const customParam = params.get('signaling') || params.get('ws');
      if (customParam) {
        return customParam;
      }
    } catch {}
  }

  // 3. Web runtime auto-detection
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    const isSecure = window.location.protocol === 'https:';
    const protocol = isSecure ? 'wss:' : 'ws:';
    const hostname = window.location.hostname || 'localhost';
    const port = window.location.port;

    // If running in local Expo dev server (typically port 8081 or 19006),
    // target the separate local signaling server on port 3001
    const isLocalDevPort = port === '8081' || port === '19006';
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';

    if (isLocalhost && isLocalDevPort) {
      return `${protocol}//${hostname}:3001`;
    }

    // In production (Render, Railway, or served directly from the server on the same host & port):
    // Use window.location.host which includes port only if non-standard
    return `${protocol}//${window.location.host}`;
  }

  return Platform.OS === 'android' ? 'ws://10.0.2.2:3001' : 'ws://localhost:3001';
}

/**
 * SignalingService
 * Ultra-lightweight, resilient real-time signaling service supporting:
 * 1. Multi-Tab Local Sync on Web via BroadcastChannel ('intercom_tally_channel')
 * 2. Cross-device and mobile sync via WebSocket with automatic exponential backoff
 * 3. Strict Director-only switching authorization enforcement
 */
export class SignalingService {
  private ws: WebSocket | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private serverUrl: string = getDefaultSignalingUrl();

  private roomId: string | null = null;
  private currentUser: Participant | null = null;

  private status: ConnectionStatus = 'disconnected';
  private isIntentionallyClosed = false;

  // Reconnection backoff parameters
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 30;
  private readonly baseReconnectDelayMs = 1000;
  private readonly maxReconnectDelayMs = 20000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Mobile keepalive heartbeat
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly heartbeatIntervalMs = 20000;

  // Event listener registries
  private listeners: Map<SignalingEventType, Set<MessageHandler>> = new Map();
  private statusListeners: Set<ConnectionStatusHandler> = new Set();

  // Outgoing offline buffer
  private offlineQueue: Array<SignalingMessage> = [];

  constructor(serverUrl?: string) {
    this.serverUrl = serverUrl || getDefaultSignalingUrl();
    this.setupWindowUnloadListener();
  }

  getServerUrl(): string {
    return this.serverUrl;
  }

  private setupWindowUnloadListener(): void {
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('beforeunload', () => {
        if (this.currentUser && this.broadcastChannel) {
          const leaveMsg: SignalingMessage<UserLeftPayload> = {
            type: 'USER_LEFT',
            roomId: this.roomId || '',
            senderId: this.currentUser.id,
            senderName: this.currentUser.name,
            senderRole: this.currentUser.role,
            timestamp: Date.now(),
            payload: {
              userId: this.currentUser.id,
              cameraId: this.currentUser.cameraId,
            },
          };
          try {
            this.broadcastChannel.postMessage(leaveMsg);
          } catch {}
        }
      });
    }
  }

  setServerUrl(url: string): void {
    this.serverUrl = url;
    if (this.status === 'connected' && this.roomId && this.currentUser) {
      this.connect(this.roomId, this.currentUser);
    }
  }

  /**
   * Connects to signaling service.
   * On Web: sets up BroadcastChannel ('intercom_tally_channel') for instantaneous multi-tab sync.
   * On Mobile / Web: initiates WebSocket connection for remote cross-device peers.
   */
  async connect(roomId: string, user: Participant, customUrl?: string): Promise<void> {
    if (customUrl) {
      this.serverUrl = customUrl;
    }

    this.roomId = normalizeRoomId(roomId);
    this.currentUser = user;
    this.isIntentionallyClosed = false;
    this.clearReconnectTimer();

    // 1. Initialize BroadcastChannel on web for multi-tab sync without requiring an external server
    if (typeof BroadcastChannel !== 'undefined') {
      this.initBroadcastChannel();
    }

    // 2. Connect WebSocket for remote network / mobile connections
    this.updateStatus(this.broadcastChannel ? 'connected' : (this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting'));
    this.initiateWebSocket();
  }

  private initBroadcastChannel(): void {
    if (typeof BroadcastChannel === 'undefined') return;

    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close();
      } catch {}
      this.broadcastChannel = null;
    }

    try {
      const channelName = `intercom_tally_${this.roomId || 'DEFAULT'}`;
      this.broadcastChannel = new BroadcastChannel(channelName);
      this.broadcastChannel.onmessage = (event: MessageEvent) => {
        this.handleIncomingBroadcastMessage(event.data);
      };
      console.log(`[SignalingService] BroadcastChannel "${channelName}" active for multi-tab sync`);

      // Broadcast join to existing tabs
      if (this.currentUser) {
        this.send<UserJoinedPayload>('USER_JOINED', {
          user: this.currentUser,
          isSyncReply: false,
        });
      }
    } catch (err) {
      console.warn('[SignalingService] BroadcastChannel init error:', err);
    }
  }

  disconnect(): void {
    this.isIntentionallyClosed = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();

    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close();
      } catch {}
      this.broadcastChannel = null;
    }

    if (this.ws) {
      try {
        this.ws.close(1000, 'Intentional disconnect');
      } catch {}
      this.ws = null;
    }

    this.roomId = null;
    this.currentUser = null;
    this.offlineQueue = [];
    this.reconnectAttempts = 0;
    this.updateStatus('disconnected');
  }

  private initiateWebSocket(): void {
    if (this.ws) {
      try {
        this.ws.onopen = null as any;
        this.ws.onmessage = null as any;
        this.ws.onerror = null as any;
        this.ws.onclose = null as any;
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    try {
      const url = `${this.serverUrl}?roomId=${encodeURIComponent(
        this.roomId || ''
      )}&userId=${encodeURIComponent(this.currentUser?.id || '')}`;

      const socket = new WebSocket(url);
      this.ws = socket;

      socket.onopen = () => {
        if (this.ws !== socket) return;

        console.log('[SignalingService] WebSocket connected:', url);
        this.reconnectAttempts = 0;
        this.updateStatus('connected');
        this.startHeartbeat();

        if (this.currentUser) {
          this.send<UserJoinedPayload>('USER_JOINED', {
            user: this.currentUser,
            isSyncReply: false,
          });
        }

        this.flushOfflineQueue();
      };

      socket.onmessage = (event: WebSocketMessageEvent) => {
        if (this.ws !== socket) return;
        this.handleIncomingRawMessage(event.data);
      };

      socket.onerror = (error) => {
        if (this.ws !== socket) return;
        console.warn('[SignalingService] WebSocket error (offline or server unreachable):', error);
      };

      socket.onclose = (event: WebSocketCloseEvent) => {
        if (this.ws !== socket) return;
        this.stopHeartbeat();
        this.ws = null;

        if (!this.isIntentionallyClosed) {
          // If we have BroadcastChannel active, stay 'connected' locally for multi-tab
          if (!this.broadcastChannel) {
            this.updateStatus('reconnecting');
          }
          this.scheduleReconnect();
        } else {
          this.updateStatus('disconnected');
        }
      };
    } catch (error) {
      console.warn('[SignalingService] Error creating WebSocket:', error);
      if (!this.isIntentionallyClosed) {
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.isIntentionallyClosed) return;
    this.clearReconnectTimer();

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      if (!this.broadcastChannel) {
        this.updateStatus('disconnected');
      }
      return;
    }

    const factor = Math.pow(1.8, this.reconnectAttempts);
    const calculatedDelay = Math.min(
      this.maxReconnectDelayMs,
      this.baseReconnectDelayMs * factor
    );
    const jitter = (Math.random() - 0.5) * 0.3 * calculatedDelay;
    const finalDelay = Math.max(1000, Math.floor(calculatedDelay + jitter));

    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      if (!this.isIntentionallyClosed && this.roomId && this.currentUser) {
        this.initiateWebSocket();
      }
    }, finalDelay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send('PING', { ping: Date.now() });
      }
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private handleIncomingBroadcastMessage(data: any): void {
    try {
      if (!data || typeof data !== 'object') return;
      const message = data as SignalingMessage;

      // Filter by room ID (defense in depth)
      if (this.roomId && normalizeRoomId(message.roomId) !== this.roomId) return;

      // Ignore our own echo
      if (this.currentUser && message.senderId === this.currentUser.id) return;

      this.dispatchMessage(message);
    } catch (err) {
      console.warn('[SignalingService] Error processing BroadcastChannel message:', err);
    }
  }

  private handleIncomingRawMessage(rawData: string | any): void {
    try {
      if (typeof rawData !== 'string') return;
      const parsed: SignalingMessage = JSON.parse(rawData);

      if (parsed.type === 'PING') {
        this.send('PONG', { pong: Date.now() });
        return;
      }
      if (parsed.type === 'PONG') {
        return;
      }

      this.dispatchMessage(parsed);
    } catch (err) {
      console.warn('[SignalingService] Error parsing incoming raw message:', err);
    }
  }

  private dispatchMessage(message: SignalingMessage): void {
    const callbacks = this.listeners.get(message.type);
    if (callbacks) {
      callbacks.forEach((cb) => {
        try {
          cb(message.payload, message);
        } catch (handlerErr) {
          console.error(`[SignalingService] Error in handler for ${message.type}:`, handlerErr);
        }
      });
    }
  }

  /**
   * Broadcasts a typed event across BroadcastChannel (multi-tab) and WebSocket (network).
   * STRICT DIRECTOR CHECK: Rejects TALLY_UPDATE if sender is not Director!
   */
  send<T>(type: SignalingEventType, payload: T): boolean {
    if (!this.roomId || !this.currentUser) {
      console.warn('[SignalingService] Cannot send event: Not joined in a room');
      return false;
    }

    // STRICT DIRECTOR CONTROL AUTHORITY ENFORCEMENT
    if (type === 'TALLY_UPDATE' || type === 'MUTE_REMOTE_OPERATOR') {
      if (this.currentUser.role !== 'director') {
        console.warn(
          `[SignalingService] UNAUTHORIZED: User "${this.currentUser.name}" (${this.currentUser.role}) does NOT have Director authority to emit ${type}`
        );
        return false;
      }
    }

    const message: SignalingMessage<T> = {
      type,
      roomId: this.roomId,
      senderId: this.currentUser.id,
      senderName: this.currentUser.name,
      senderRole: this.currentUser.role,
      timestamp: Date.now(),
      payload,
    };

    // 1. Multi-Tab Local Sync via BroadcastChannel
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(message);
      } catch (err) {
        console.warn('[SignalingService] BroadcastChannel postMessage error:', err);
      }
    }

    // 2. Transmit via WebSocket for mobile / remote peers
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
        return true;
      } catch (err) {
        console.warn('[SignalingService] Error transmitting WebSocket message:', err);
        this.bufferMessage(message);
        return false;
      }
    } else {
      this.bufferMessage(message);
      // Return true if delivered locally via BroadcastChannel
      return !!this.broadcastChannel;
    }
  }

  private bufferMessage(message: SignalingMessage): void {
    if (
      message.type === 'TALLY_UPDATE' ||
      message.type === 'USER_JOINED' ||
      message.type === 'MUTE_REMOTE_OPERATOR'
    ) {
      if (message.type === 'TALLY_UPDATE') {
        this.offlineQueue = this.offlineQueue.filter((m) => m.type !== 'TALLY_UPDATE');
      }
      this.offlineQueue.push(message);
      // Cap buffer size to prevent memory leaks during extended disconnection
      if (this.offlineQueue.length > 50) {
        this.offlineQueue.shift();
      }
    }
  }

  private flushOfflineQueue(): void {
    if (this.offlineQueue.length === 0) return;
    const queued = [...this.offlineQueue];
    this.offlineQueue = [];

    queued.forEach((msg) => {
      try {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(msg));
        }
      } catch (e) {
        console.warn('[SignalingService] Error flushing queued message:', e);
      }
    });
  }

  on<T>(type: SignalingEventType, handler: MessageHandler<T>): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    const set = this.listeners.get(type)!;
    set.add(handler as MessageHandler);

    return () => {
      this.off(type, handler);
    };
  }

  off<T>(type: SignalingEventType, handler: MessageHandler<T>): void {
    const set = this.listeners.get(type);
    if (set) {
      set.delete(handler as MessageHandler);
    }
  }

  onConnectionChange(handler: ConnectionStatusHandler): () => void {
    this.statusListeners.add(handler);
    handler(this.status);

    return () => {
      this.statusListeners.delete(handler);
    };
  }

  getConnectionStatus(): ConnectionStatus {
    return this.status;
  }

  private updateStatus(newStatus: ConnectionStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.statusListeners.forEach((handler) => {
        try {
          handler(newStatus);
        } catch (e) {
          console.error('[SignalingService] Error in connection status listener:', e);
        }
      });
    }
  }
}

export const signalingService = new SignalingService();
export default signalingService;
