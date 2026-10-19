import {
  signalingService,
  normalizeRoomId,
  AudioOfferPayload,
  AudioAnswerPayload,
  IceCandidatePayload,
  UserJoinedPayload,
  UserLeftPayload,
} from './signalingService';

// Standard public STUN servers for robust NAT traversal
export const DEFAULT_RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
  ],
};

// Web voice processing constraints
export const MOBILE_AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
  video: false,
};

type RemoteStreamCallback = (peerId: string, stream: MediaStream) => void;
type PeerDisconnectedCallback = (peerId: string) => void;

/**
 * WebRTCAudioService (Web Platform Implementation)
 * Uses standard browser W3C WebRTC APIs (RTCPeerConnection, navigator.mediaDevices)
 */
export class WebRTCAudioService {
  private localStream: MediaStream | null = null;
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private iceCandidateQueues: Map<string, any[]> = new Map();
  private remoteAudioElements: Map<string, HTMLAudioElement> = new Map();

  private roomId: string | null = null;
  private localUserId: string | null = null;
  private isCallActive = false;
  private isMicEnabled = true; // Default to UNMUTED (active talkback) upon entering room

  private unsubscribers: Array<() => void> = [];
  private onRemoteStreamCallbacks: Set<RemoteStreamCallback> = new Set();
  private onPeerDisconnectedCallbacks: Set<PeerDisconnectedCallback> = new Set();

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
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia(MOBILE_AUDIO_CONSTRAINTS);
          this.localStream = stream;

          this.localStream.getAudioTracks().forEach((track) => {
            track.enabled = this.isMicEnabled;
          });
        } catch (micErr) {
          console.warn(
            '[WebRTCAudioService-Web] Microphone access denied or delayed. Running in receive mode:',
            micErr
          );
          this.localStream = null;
        }
      } else {
        console.warn('[WebRTCAudioService-Web] MediaDevices not available in this environment');
      }

      this.bindSignalingListeners();
      this.isCallActive = true;
      console.log('[WebRTCAudioService-Web] Audio call started for user:', userId, 'in room:', roomId);
      return true;
    } catch (error) {
      console.error('[WebRTCAudioService-Web] Failed to start audio call:', error);
      return false;
    }
  }

  private bindSignalingListeners(): void {
    this.unbindSignalingListeners();

    const unsubJoin = signalingService.on<UserJoinedPayload>('USER_JOINED', async (payload) => {
      const remoteUser = payload.user;
      if (!remoteUser || remoteUser.id === this.localUserId) return;
      // Glare avoidance: Only existing peers initiate an offer when a new peer joins.
      // Newly joined peers (receiving isSyncReply) wait for the existing peer's offer.
      if (payload.isSyncReply) return;

      console.log('[WebRTCAudioService-Web] Peer joined:', remoteUser.id, '- Initiating offer');
      await this.initiateOffer(remoteUser.id);
    });

    const unsubLeave = signalingService.on<UserLeftPayload>('USER_LEFT', (payload) => {
      console.log('[WebRTCAudioService-Web] Peer left:', payload.userId);
      this.closePeerConnection(payload.userId);
    });

    const handleOfferMsg = async (payload: AudioOfferPayload) => {
      if (payload.toUserId && payload.toUserId !== this.localUserId) return;
      if (payload.fromUserId === this.localUserId) return;

      console.log('[WebRTCAudioService-Web] Received SDP offer from:', payload.fromUserId);
      await this.handleOffer(payload.fromUserId, payload.sdp);
    };

    const handleAnswerMsg = async (payload: AudioAnswerPayload) => {
      if (payload.toUserId && payload.toUserId !== this.localUserId) return;
      if (payload.fromUserId === this.localUserId) return;

      console.log('[WebRTCAudioService-Web] Received SDP answer from:', payload.fromUserId);
      await this.handleAnswer(payload.fromUserId, payload.sdp);
    };

    const handleCandidateMsg = async (payload: IceCandidatePayload) => {
      if (payload.toUserId && payload.toUserId !== this.localUserId) return;
      if (payload.fromUserId === this.localUserId) return;

      await this.handleRemoteCandidate(payload.fromUserId, payload.candidate);
    };

    const unsubOffer1 = signalingService.on<AudioOfferPayload>('AUDIO_OFFER', handleOfferMsg);
    const unsubOffer2 = signalingService.on<AudioOfferPayload>('webrtc-offer' as any, handleOfferMsg);

    const unsubAnswer1 = signalingService.on<AudioAnswerPayload>('AUDIO_ANSWER', handleAnswerMsg);
    const unsubAnswer2 = signalingService.on<AudioAnswerPayload>('webrtc-answer' as any, handleAnswerMsg);

    const unsubCandidate1 = signalingService.on<IceCandidatePayload>('ICE_CANDIDATE', handleCandidateMsg);
    const unsubCandidate2 = signalingService.on<IceCandidatePayload>('webrtc-ice-candidate' as any, handleCandidateMsg);

    this.unsubscribers.push(
      unsubJoin,
      unsubLeave,
      unsubOffer1,
      unsubOffer2,
      unsubAnswer1,
      unsubAnswer2,
      unsubCandidate1,
      unsubCandidate2
    );
  }

  private unbindSignalingListeners(): void {
    this.unsubscribers.forEach((unsub) => unsub());
    this.unsubscribers = [];
  }

  private getOrCreatePeerConnection(remoteUserId: string): RTCPeerConnection {
    let pc = this.peerConnections.get(remoteUserId);
    if (pc) return pc;

    pc = new RTCPeerConnection(DEFAULT_RTC_CONFIGURATION);
    this.peerConnections.set(remoteUserId, pc);

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc!.addTrack(track, this.localStream!);
      });
    }

    pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate && this.localUserId) {
        signalingService.send<IceCandidatePayload>('ICE_CANDIDATE', {
          candidate: event.candidate,
          fromUserId: this.localUserId,
          toUserId: remoteUserId,
        });
      }
    };

    pc.ontrack = (event: RTCTrackEvent) => {
      console.log('[WebRTCAudioService-Web] Received remote audio track from:', remoteUserId);
      const stream =
        event.streams && event.streams[0]
          ? event.streams[0]
          : new MediaStream([event.track]);

      this.attachRemoteAudioStream(remoteUserId, stream);
      this.notifyRemoteStream(remoteUserId, stream);
    };

    let disconnectTimer: any = null;
    pc.onconnectionstatechange = () => {
      if (!pc) return;
      const state = pc.connectionState;
      console.log(`[WebRTCAudioService-Web] Peer ${remoteUserId} connection state: ${state}`);

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
              console.warn(`[WebRTCAudioService-Web] Peer ${remoteUserId} still disconnected. Initiating ICE restart...`);
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
        console.warn(`[WebRTCAudioService-Web] Peer ${remoteUserId} connection failed. Attempting ICE restart...`);
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

  private async initiateOffer(remoteUserId: string, iceRestart = false): Promise<void> {
    try {
      const pc = this.getOrCreatePeerConnection(remoteUserId);
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
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
      console.error('[WebRTCAudioService-Web] Error initiating offer to:', remoteUserId, error);
    }
  }

  private async handleOffer(fromUserId: string, sdp: any): Promise<void> {
    try {
      const pc = this.getOrCreatePeerConnection(fromUserId);

      // Glare handling: If an offer is received while we also sent a local offer
      if (pc.signalingState !== 'stable') {
        const isPolite = (this.localUserId || '').localeCompare(fromUserId) > 0;
        if (!isPolite) {
          console.log('[WebRTCAudioService-Web] Glare collision detected: Impolite peer ignoring incoming offer.');
          return;
        }
        console.log('[WebRTCAudioService-Web] Glare collision detected: Polite peer rolling back local description.');
        await pc.setLocalDescription({ type: 'rollback' });
      }

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
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
      console.error('[WebRTCAudioService-Web] Error handling offer from:', fromUserId, error);
    }
  }

  private async handleAnswer(fromUserId: string, sdp: any): Promise<void> {
    try {
      const pc = this.peerConnections.get(fromUserId);
      if (!pc) return;

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      await this.flushIceCandidateQueue(fromUserId, pc);
    } catch (error) {
      console.error('[WebRTCAudioService-Web] Error handling answer from:', fromUserId, error);
    }
  }

  private async handleRemoteCandidate(fromUserId: string, candidate: any): Promise<void> {
    try {
      const pc = this.peerConnections.get(fromUserId);
      if (!pc || !pc.remoteDescription) {
        const queue = this.iceCandidateQueues.get(fromUserId) || [];
        queue.push(candidate);
        this.iceCandidateQueues.set(fromUserId, queue);
        return;
      }

      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.warn('[WebRTCAudioService-Web] Error adding ICE candidate:', error);
    }
  }

  private async flushIceCandidateQueue(peerId: string, pc: RTCPeerConnection): Promise<void> {
    const queue = this.iceCandidateQueues.get(peerId);
    if (!queue || queue.length === 0) return;

    for (const cand of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (err) {
        console.warn('[WebRTCAudioService-Web] Error adding queued candidate:', err);
      }
    }
    this.iceCandidateQueues.delete(peerId);
  }

  setMicEnabled(enabled: boolean): void {
    this.isMicEnabled = enabled;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });
      console.log(`[WebRTCAudioService-Web] Microphone track transmission ${enabled ? 'ENABLED' : 'MUTED'}`);
    }
  }

  getMicEnabled(): boolean {
    return this.isMicEnabled;
  }

  private attachRemoteAudioStream(peerId: string, stream: MediaStream): void {
    if (typeof document === 'undefined') return;

    let audioEl = this.remoteAudioElements.get(peerId);
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.id = `remote-audio-${peerId}`;
      audioEl.autoplay = true;
      (audioEl as any).playsInline = true;
      (audioEl as any).playsinline = true;
      audioEl.setAttribute('playsinline', '');
      audioEl.setAttribute('webkit-playsinline', '');
      audioEl.setAttribute('autoplay', '');
      audioEl.style.display = 'none';
      document.body.appendChild(audioEl);
      this.remoteAudioElements.set(peerId, audioEl);
    }

    audioEl.srcObject = stream;
    audioEl.play().catch((err) => {
      console.warn(`[WebRTCAudioService-Web] Remote audio play waiting for user unlock (${peerId}):`, err);
    });
  }

  private removeRemoteAudioStream(peerId: string): void {
    const audioEl = this.remoteAudioElements.get(peerId);
    if (audioEl) {
      try {
        audioEl.pause();
        audioEl.srcObject = null;
        audioEl.remove();
      } catch {}
      this.remoteAudioElements.delete(peerId);
    }
  }

  /**
   * Directly unlocks HTML5 audio playback for all remote WebRTC audio elements.
   * Call on direct user gesture ("ENTER PRODUCTION INTERCOM").
   */
  async unlockAudioPlayback(): Promise<void> {
    if (typeof document === 'undefined') return;

    for (const [, audioEl] of this.remoteAudioElements) {
      try {
        await audioEl.play();
      } catch {}
    }

    // Play a silent 1-sample data URI audio element to grant global playback permission to WebKit/Safari
    try {
      const dummy = document.createElement('audio');
      dummy.setAttribute('playsinline', '');
      dummy.setAttribute('webkit-playsinline', '');
      dummy.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
      await dummy.play();
      dummy.remove();
    } catch {}
  }

  private closePeerConnection(peerId: string): void {
    this.removeRemoteAudioStream(peerId);
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      try {
        pc.close();
      } catch {}
      this.peerConnections.delete(peerId);
      this.iceCandidateQueues.delete(peerId);
      this.notifyPeerDisconnected(peerId);
    }
  }

  async endAudioCall(): Promise<void> {
    this.unbindSignalingListeners();

    // Remove all remote audio elements from DOM
    this.remoteAudioElements.forEach((_, peerId) => {
      this.removeRemoteAudioStream(peerId);
    });
    this.remoteAudioElements.clear();

    this.peerConnections.forEach((pc) => {
      try {
        pc.close();
      } catch {}
    });
    this.peerConnections.clear();
    this.iceCandidateQueues.clear();

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
    console.log('[WebRTCAudioService-Web] Audio call ended and hardware released');
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
        console.error('[WebRTCAudioService-Web] Error in remote stream callback:', e);
      }
    });
  }

  private notifyPeerDisconnected(peerId: string): void {
    this.onPeerDisconnectedCallbacks.forEach((cb) => {
      try {
        cb(peerId);
      } catch (e) {
        console.error('[WebRTCAudioService-Web] Error in peer disconnect callback:', e);
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

export const webrtcAudioService = new WebRTCAudioService();
export default webrtcAudioService;
