import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  MediaStream,
  mediaDevices,
} from 'react-native-webrtc';
import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';
import {
  signalingService,
  normalizeRoomId,
  AudioOfferPayload,
  AudioAnswerPayload,
  IceCandidatePayload,
  UserJoinedPayload,
  UserLeftPayload,
} from './signalingService';

// Standard public STUN servers for robust NAT traversal across 4G/5G mobile carriers and Wi-Fi
export const DEFAULT_RTC_CONFIGURATION = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 10,
};

// Enforced mobile voice processing constraints for clear production comms
export const MOBILE_AUDIO_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1, // Mono broadcast intercom stream to preserve cellular bandwidth
  } as any,
  video: false,
};

type RemoteStreamCallback = (peerId: string, stream: MediaStream) => void;
type PeerDisconnectedCallback = (peerId: string) => void;

/**
 * WebRTCAudioService
 * Manages full-duplex, low-latency mesh voice communication between Director and Camera Operators.
 * Resilient against carrier NAT firewalls, cellular handoffs, and mid-production crew connect/disconnects.
 */
export class WebRTCAudioService {
  private localStream: MediaStream | null = null;
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private iceCandidateQueues: Map<string, any[]> = new Map();

  private roomId: string | null = null;
  private localUserId: string | null = null;
  private isCallActive = false;
  private isMicEnabled = false;

  private unsubscribers: Array<() => void> = [];
  private onRemoteStreamCallbacks: Set<RemoteStreamCallback> = new Set();
  private onPeerDisconnectedCallbacks: Set<PeerDisconnectedCallback> = new Set();

  /**
   * Initializes local audio stream and starts mesh WebRTC call.
   */
  async startAudioCall(roomId: string, userId: string): Promise<boolean> {
    const cleanRoomId = normalizeRoomId(roomId);
    if (this.isCallActive && this.localStream) {
      if (this.roomId !== cleanRoomId) {
        this.roomId = cleanRoomId;
        this.localUserId = userId;
        this.peerConnections.forEach((pc) => {
          try { pc.close(); } catch {}
        });
        this.peerConnections.clear();
        this.iceCandidateQueues.clear();
        this.bindSignalingListeners();
      }
      return true;
    }

    this.roomId = cleanRoomId;
    this.localUserId = userId;

    try {
      // Configure audio session for background intercom communication
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          interruptionModeIOS: InterruptionModeIOS.DuckOthers,
          allowsRecordingIOS: true,
          shouldDuckAndroid: false,
          interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
          playThroughEarpieceAndroid: false,
        });
      } catch (audioModeErr) {
        console.warn('[WebRTCAudioService] Note: Audio.setAudioModeAsync warning:', audioModeErr);
      }

      // 1. Acquire local microphone stream with enforced voice constraints
      const stream = (await mediaDevices.getUserMedia(
        MOBILE_AUDIO_CONSTRAINTS
      )) as MediaStream;

      this.localStream = stream;

      // Apply initial mic mute state
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = this.isMicEnabled;
      });

      // 2. Bind signaling service event listeners for WebRTC negotiation
      this.bindSignalingListeners();

      this.isCallActive = true;
      console.log('[WebRTCAudioService] Audio call started for user:', userId, 'in room:', roomId);
      return true;
    } catch (error) {
      console.error('[WebRTCAudioService] Failed to start audio call:', error);
      return false;
    }
  }

  /**
   * Subscribes to signaling events to negotiate mesh connections automatically
   */
  private bindSignalingListeners(): void {
    this.unbindSignalingListeners();

    // When another peer joins the room mid-production, initiate WebRTC offer
    const unsubJoin = signalingService.on<UserJoinedPayload>('USER_JOINED', async (payload) => {
      const remoteUser = payload.user;
      if (!remoteUser || remoteUser.id === this.localUserId) return;
      // Glare avoidance: Only existing peers initiate an offer when a new peer joins.
      // Newly joined peers (receiving isSyncReply) wait for the existing peer's offer.
      if (payload.isSyncReply) return;

      console.log('[WebRTCAudioService] Peer joined room:', remoteUser.id, '- Initiating offer');
      await this.initiateOffer(remoteUser.id);
    });

    // When a peer leaves, close their connection
    const unsubLeave = signalingService.on<UserLeftPayload>('USER_LEFT', (payload) => {
      console.log('[WebRTCAudioService] Peer left room:', payload.userId);
      this.closePeerConnection(payload.userId);
    });

    // Handle incoming WebRTC audio offer
    const unsubOffer = signalingService.on<AudioOfferPayload>('AUDIO_OFFER', async (payload, message) => {
      if (payload.toUserId && payload.toUserId !== this.localUserId) return;
      if (payload.fromUserId === this.localUserId) return;

      console.log('[WebRTCAudioService] Received AUDIO_OFFER from:', payload.fromUserId);
      await this.handleOffer(payload.fromUserId, payload.sdp);
    });

    // Handle incoming WebRTC audio answer
    const unsubAnswer = signalingService.on<AudioAnswerPayload>('AUDIO_ANSWER', async (payload, message) => {
      if (payload.toUserId && payload.toUserId !== this.localUserId) return;
      if (payload.fromUserId === this.localUserId) return;

      console.log('[WebRTCAudioService] Received AUDIO_ANSWER from:', payload.fromUserId);
      await this.handleAnswer(payload.fromUserId, payload.sdp);
    });

    // Handle incoming ICE candidate
    const unsubCandidate = signalingService.on<IceCandidatePayload>(
      'ICE_CANDIDATE',
      async (payload, message) => {
        if (payload.toUserId && payload.toUserId !== this.localUserId) return;
        if (payload.fromUserId === this.localUserId) return;

        await this.handleRemoteCandidate(payload.fromUserId, payload.candidate);
      }
    );

    this.unsubscribers.push(unsubJoin, unsubLeave, unsubOffer, unsubAnswer, unsubCandidate);
  }

  private unbindSignalingListeners(): void {
    this.unsubscribers.forEach((unsub) => unsub());
    this.unsubscribers = [];
  }

  /**
   * Creates or retrieves an RTCPeerConnection for a specific remote peer
   */
  private getOrCreatePeerConnection(remoteUserId: string): RTCPeerConnection {
    let pc = this.peerConnections.get(remoteUserId);
    if (pc) return pc;

    pc = new RTCPeerConnection(DEFAULT_RTC_CONFIGURATION);
    this.peerConnections.set(remoteUserId, pc);

    // Attach local audio tracks to send to the peer
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc!.addTrack(track, this.localStream!);
      });
    }

    // Handle local ICE candidates and broadcast to the specific peer
    pc.onicecandidate = (event: any) => {
      if (event.candidate && this.localUserId) {
        signalingService.send<IceCandidatePayload>('ICE_CANDIDATE', {
          candidate: event.candidate,
          fromUserId: this.localUserId,
          toUserId: remoteUserId,
        });
      }
    };

    // Handle incoming remote audio stream
    pc.ontrack = (event: any) => {
      console.log('[WebRTCAudioService] Received remote audio track from:', remoteUserId);
      if (event.streams && event.streams[0]) {
        const stream = event.streams[0] as MediaStream;
        this.notifyRemoteStream(remoteUserId, stream);
      }
    };

    // Handle connection state changes with network handover resilience
    let disconnectTimer: any = null;
    pc.onconnectionstatechange = () => {
      if (!pc) return;
      const state = pc.connectionState;
      console.log(`[WebRTCAudioService] Peer ${remoteUserId} connection state: ${state}`);

      if (state === 'connected') {
        if (disconnectTimer) {
          clearTimeout(disconnectTimer);
          disconnectTimer = null;
        }
      } else if (state === 'disconnected') {
        // Network handover window: Wait 5 seconds before attempting ICE restart
        if (!disconnectTimer) {
          disconnectTimer = setTimeout(() => {
            if (pc && pc.connectionState === 'disconnected') {
              console.warn(`[WebRTCAudioService] Peer ${remoteUserId} still disconnected. Initiating ICE restart...`);
              this.initiateOffer(remoteUserId, true);
            }
            disconnectTimer = null;
          }, 5000);
        }
      } else if (state === 'failed') {
        if (disconnectTimer) {
          clearTimeout(disconnectTimer);
          disconnectTimer = null;
        }
        console.warn(`[WebRTCAudioService] Peer ${remoteUserId} connection failed. Attempting ICE restart...`);
        this.initiateOffer(remoteUserId, true).catch(() => {
          this.closePeerConnection(remoteUserId);
        });
      } else if (state === 'closed') {
        if (disconnectTimer) {
          clearTimeout(disconnectTimer);
          disconnectTimer = null;
        }
        this.closePeerConnection(remoteUserId);
      }
    };

    return pc;
  }

  /**
   * Initiates an offer to a remote peer (Offerer role)
   */
  private async initiateOffer(remoteUserId: string, iceRestart = false): Promise<void> {
    try {
      const pc = this.getOrCreatePeerConnection(remoteUserId);
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
        iceRestart,
      });

      await pc.setLocalDescription(offer);

      if (this.localUserId) {
        signalingService.send<AudioOfferPayload>('AUDIO_OFFER', {
          sdp: pc.localDescription,
          fromUserId: this.localUserId,
          toUserId: remoteUserId,
        });
      }
    } catch (error) {
      console.error('[WebRTCAudioService] Error initiating offer to:', remoteUserId, error);
    }
  }

  /**
   * Handles an incoming offer from a remote peer (Answerer role)
   */
  private async handleOffer(fromUserId: string, sdp: any): Promise<void> {
    try {
      const pc = this.getOrCreatePeerConnection(fromUserId);

      // Glare handling: If an offer is received while we also sent a local offer
      if (pc.signalingState !== 'stable') {
        const isPolite = (this.localUserId || '').localeCompare(fromUserId) > 0;
        if (!isPolite) {
          console.log('[WebRTCAudioService] Glare collision detected: Impolite peer ignoring incoming offer.');
          return;
        }
        console.log('[WebRTCAudioService] Glare collision detected: Polite peer rolling back local description.');
        await pc.setLocalDescription(new RTCSessionDescription({ type: 'rollback', sdp: '' }));
      }

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));

      // Process any buffered ICE candidates received before remote description was ready
      await this.flushIceCandidateQueue(fromUserId, pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      if (this.localUserId) {
        signalingService.send<AudioAnswerPayload>('AUDIO_ANSWER', {
          sdp: pc.localDescription,
          fromUserId: this.localUserId,
          toUserId: fromUserId,
        });
      }
    } catch (error) {
      console.error('[WebRTCAudioService] Error handling offer from:', fromUserId, error);
    }
  }

  /**
   * Handles an incoming answer from a remote peer
   */
  private async handleAnswer(fromUserId: string, sdp: any): Promise<void> {
    try {
      const pc = this.peerConnections.get(fromUserId);
      if (!pc) return;

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      await this.flushIceCandidateQueue(fromUserId, pc);
    } catch (error) {
      console.error('[WebRTCAudioService] Error handling answer from:', fromUserId, error);
    }
  }

  /**
   * Handles remote ICE candidate with queue buffering to avoid race conditions
   */
  private async handleRemoteCandidate(fromUserId: string, candidate: any): Promise<void> {
    try {
      const pc = this.peerConnections.get(fromUserId);
      if (!pc || !pc.remoteDescription) {
        // Buffer candidate until remote description is settled
        const queue = this.iceCandidateQueues.get(fromUserId) || [];
        queue.push(candidate);
        this.iceCandidateQueues.set(fromUserId, queue);
        return;
      }

      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.warn('[WebRTCAudioService] Error adding ICE candidate:', error);
    }
  }

  private async flushIceCandidateQueue(peerId: string, pc: RTCPeerConnection): Promise<void> {
    const queue = this.iceCandidateQueues.get(peerId);
    if (!queue || queue.length === 0) return;

    for (const cand of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (err) {
        console.warn('[WebRTCAudioService] Error adding queued candidate:', err);
      }
    }
    this.iceCandidateQueues.delete(peerId);
  }

  /**
   * Toggles microphone transmission state at the hardware track level
   */
  setMicEnabled(enabled: boolean): void {
    this.isMicEnabled = enabled;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });
      console.log(`[WebRTCAudioService] Microphone track transmission ${enabled ? 'ENABLED' : 'MUTED'}`);
    }
  }

  getMicEnabled(): boolean {
    return this.isMicEnabled;
  }

  /**
   * Closes a specific peer's connection cleanly
   */
  private closePeerConnection(peerId: string): void {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      try {
        pc.close();
      } catch (e) {
        // no-op
      }
      this.peerConnections.delete(peerId);
      this.iceCandidateQueues.delete(peerId);
      this.notifyPeerDisconnected(peerId);
    }
  }

  /**
   * Ends the entire WebRTC audio call, stops media hardware, and resets peer mesh
   */
  async endAudioCall(): Promise<void> {
    this.unbindSignalingListeners();

    // Close all peer connections
    this.peerConnections.forEach((pc) => {
      try {
        pc.close();
      } catch {}
    });
    this.peerConnections.clear();
    this.iceCandidateQueues.clear();

    // Stop and release local microphone hardware
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      this.localStream = null;
    }

    this.isCallActive = false;
    this.roomId = null;
    this.localUserId = null;
    console.log('[WebRTCAudioService] Audio call ended and hardware released');
  }

  async unlockAudioPlayback(): Promise<void> {
    return Promise.resolve();
  }

  onRemoteStream(callback: RemoteStreamCallback): () => void {
    this.onRemoteStreamCallbacks.add(callback);
    return () => {
      this.onRemoteStreamCallbacks.delete(callback);
    };
  }

  onPeerDisconnected(callback: PeerDisconnectedCallback): () => void {
    this.onPeerDisconnectedCallbacks.add(callback);
    return () => {
      this.onPeerDisconnectedCallbacks.delete(callback);
    };
  }

  private notifyRemoteStream(peerId: string, stream: MediaStream): void {
    this.onRemoteStreamCallbacks.forEach((cb) => {
      try {
        cb(peerId, stream);
      } catch (e) {
        console.error('[WebRTCAudioService] Error in remote stream callback:', e);
      }
    });
  }

  private notifyPeerDisconnected(peerId: string): void {
    this.onPeerDisconnectedCallbacks.forEach((cb) => {
      try {
        cb(peerId);
      } catch (e) {
        console.error('[WebRTCAudioService] Error in peer disconnect callback:', e);
      }
    });
  }

  getConnectedPeers(): string[] {
    return Array.from(this.peerConnections.keys());
  }

  getIsCallActive(): boolean {
    return this.isCallActive;
  }
}

// Global service instance
export const webrtcAudioService = new WebRTCAudioService();
export default webrtcAudioService;
